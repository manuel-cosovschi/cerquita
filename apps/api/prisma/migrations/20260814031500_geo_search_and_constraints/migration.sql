-- Everything Prisma cannot express: spatial indexes, full-text search, and the
-- invariants the application relies on but must not be trusted to uphold alone.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Spatial indexes.
--
-- Every map request filters by `ST_Intersects(publicLocation, envelope)` and
-- orders by `ST_Distance`. Without a GiST index those are sequential scans and
-- the map endpoint degrades linearly with the number of listings.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS "Listing_publicLocation_gist"
  ON "Listing" USING GIST ("publicLocation");

-- Radius/proximity matching for saved searches and "Busco" runs against the
-- exact location server-side, so that column needs its own index.
CREATE INDEX IF NOT EXISTS "Listing_exactLocation_gist"
  ON "Listing" USING GIST ("exactLocation");

CREATE INDEX IF NOT EXISTS "Store_publicLocation_gist"
  ON "Store" USING GIST ("publicLocation");

CREATE INDEX IF NOT EXISTS "User_publicLocation_gist"
  ON "User" USING GIST ("publicLocation");

CREATE INDEX IF NOT EXISTS "SavedSearch_center_gist"
  ON "SavedSearch" USING GIST ("center");

-- Partial index for the hot path: the map only ever looks at visible listings,
-- so excluding drafts, sold and removed rows keeps the index small.
CREATE INDEX IF NOT EXISTS "Listing_visible_location_gist"
  ON "Listing" USING GIST ("publicLocation")
  WHERE "status" IN ('active', 'reserved');

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Full-text search.
--
-- The tsvector is maintained by a trigger rather than computed per query.
-- Weights: title (A) outranks tags (B), which outrank description (C), so a
-- listing titled "PlayStation 5" beats one that merely mentions it in passing.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION listing_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW."searchVector" :=
      setweight(to_tsvector('spanish', coalesce(NEW."title", '')), 'A')
   || setweight(to_tsvector('spanish', coalesce(array_to_string(NEW."tags", ' '), '')), 'B')
   || setweight(to_tsvector('spanish', coalesce(NEW."description", '')), 'C');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS listing_search_vector_trigger ON "Listing";
CREATE TRIGGER listing_search_vector_trigger
  BEFORE INSERT OR UPDATE OF "title", "description", "tags" ON "Listing"
  FOR EACH ROW EXECUTE FUNCTION listing_search_vector_update();

CREATE INDEX IF NOT EXISTS "Listing_searchVector_gin"
  ON "Listing" USING GIN ("searchVector");

-- Backfill anything already present.
UPDATE "Listing" SET "title" = "title";

-- Trigram index for short and misspelled queries, which tsquery handles poorly
-- ("ps5" vs "PS 5", "bicileta" vs "bicicleta").
CREATE INDEX IF NOT EXISTS "Listing_title_trgm"
  ON "Listing" USING GIN ("title" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Store_name_trgm"
  ON "Store" USING GIN ("name" gin_trgm_ops);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Invariants.
--
-- These duplicate rules the application already enforces. That is the point: a
-- bug, a migration script or a psql session must not be able to produce a row
-- that violates them.
-- ─────────────────────────────────────────────────────────────────────────────

-- A listing that is visible to anyone MUST have both locations. Drafts may not
-- yet — which is why `ListingsService.create` inserts as draft, writes the
-- points, then activates, all inside one transaction.
ALTER TABLE "Listing" DROP CONSTRAINT IF EXISTS "listing_published_requires_location";
ALTER TABLE "Listing" ADD CONSTRAINT "listing_published_requires_location"
  CHECK (
    "status" = 'draft'
    OR ("exactLocation" IS NOT NULL AND "publicLocation" IS NOT NULL)
  );

-- Stock can never be oversold. The checkout path guards this with a conditional
-- UPDATE; this makes it structurally impossible regardless of the code path.
ALTER TABLE "Listing" DROP CONSTRAINT IF EXISTS "listing_stock_non_negative";
ALTER TABLE "Listing" ADD CONSTRAINT "listing_stock_non_negative"
  CHECK ("reserved" >= 0 AND "sold" >= 0 AND "quantity" - "reserved" - "sold" >= 0);

-- Money is always a non-negative integer count of minor units.
ALTER TABLE "Listing" DROP CONSTRAINT IF EXISTS "listing_price_non_negative";
ALTER TABLE "Listing" ADD CONSTRAINT "listing_price_non_negative"
  CHECK (("priceAmount" IS NULL OR "priceAmount" >= 0)
     AND ("maxBudgetAmount" IS NULL OR "maxBudgetAmount" >= 0));

ALTER TABLE "Order" DROP CONSTRAINT IF EXISTS "order_totals_non_negative";
ALTER TABLE "Order" ADD CONSTRAINT "order_totals_non_negative"
  CHECK ("subtotal" >= 0 AND "total" >= 0 AND "platformFee" >= 0 AND "shippingTotal" >= 0);

-- Social discounts are basis points: 0-10000 inclusive.
ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "user_discount_bps_range";
ALTER TABLE "User" ADD CONSTRAINT "user_discount_bps_range"
  CHECK ("followerDiscountBps" BETWEEN 0 AND 10000
     AND "friendDiscountBps" BETWEEN 0 AND 10000);

ALTER TABLE "Listing" DROP CONSTRAINT IF EXISTS "listing_discount_bps_range";
ALTER TABLE "Listing" ADD CONSTRAINT "listing_discount_bps_range"
  CHECK (("followerDiscountBps" IS NULL OR "followerDiscountBps" BETWEEN 0 AND 10000)
     AND ("friendDiscountBps" IS NULL OR "friendDiscountBps" BETWEEN 0 AND 10000));

-- Reviews are 1-5 stars.
ALTER TABLE "Review" DROP CONSTRAINT IF EXISTS "review_rating_range";
ALTER TABLE "Review" ADD CONSTRAINT "review_rating_range"
  CHECK ("rating" BETWEEN 1 AND 5);

-- A friendship row is stored under a canonical ordering so (A,B) and (B,A)
-- cannot both exist, and nobody can befriend themselves.
ALTER TABLE "Friendship" DROP CONSTRAINT IF EXISTS "friendship_canonical_order";
ALTER TABLE "Friendship" ADD CONSTRAINT "friendship_canonical_order"
  CHECK ("userAId" < "userBId");

ALTER TABLE "Follow" DROP CONSTRAINT IF EXISTS "follow_not_self";
ALTER TABLE "Follow" ADD CONSTRAINT "follow_not_self"
  CHECK ("followerId" <> "followeeId");

-- An auction's amounts must be internally consistent.
ALTER TABLE "Auction" DROP CONSTRAINT IF EXISTS "auction_amounts_coherent";
ALTER TABLE "Auction" ADD CONSTRAINT "auction_amounts_coherent"
  CHECK (
    "startingPriceAmount" > 0
    AND "minimumIncrementAmount" > 0
    AND ("reservePriceAmount" IS NULL OR "reservePriceAmount" >= "startingPriceAmount")
    AND ("buyNowPriceAmount" IS NULL OR "buyNowPriceAmount" > "startingPriceAmount")
    AND "endsAt" > "startsAt"
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Seed the singleton configuration row so the API never boots without it.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO "GlobalConfig" ("id", "updatedAt") VALUES (1, NOW())
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "FeatureFlag" ("key", "enabled", "description", "rolloutPercent", "updatedAt")
VALUES
  ('auctions',         true,  'Subastas en vivo',                    100, NOW()),
  ('aiSearch',         true,  'Búsqueda en lenguaje natural',        100, NOW()),
  ('aiListing',        false, 'Asistente de publicación con IA',     100, NOW()),
  ('payments',         true,  'Checkout y pagos',                    100, NOW()),
  ('stores',           true,  'Tiendas',                             100, NOW()),
  ('proSubscriptions', false, 'Planes Cerquita Pro',                 100, NOW())
ON CONFLICT ("key") DO NOTHING;
