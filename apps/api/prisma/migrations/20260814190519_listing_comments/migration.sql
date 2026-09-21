-- DropIndex
DROP INDEX "Listing_exactLocation_gist";

-- DropIndex
DROP INDEX "Listing_publicLocation_gist";

-- DropIndex
DROP INDEX "Listing_searchVector_gin";

-- DropIndex
DROP INDEX "Listing_title_trgm";

-- DropIndex
DROP INDEX "SavedSearch_center_gist";

-- DropIndex
DROP INDEX "Store_name_trgm";

-- DropIndex
DROP INDEX "Store_publicLocation_gist";

-- DropIndex
DROP INDEX "User_publicLocation_gist";

-- AlterTable
ALTER TABLE "Listing" ADD COLUMN     "commentCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ListingComment" (
    "id" UUID NOT NULL,
    "listingId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "parentId" UUID,
    "hiddenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ListingComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ListingComment_listingId_createdAt_idx" ON "ListingComment"("listingId", "createdAt");

-- CreateIndex
CREATE INDEX "ListingComment_authorId_idx" ON "ListingComment"("authorId");

-- AddForeignKey
ALTER TABLE "ListingComment" ADD CONSTRAINT "ListingComment_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingComment" ADD CONSTRAINT "ListingComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingComment" ADD CONSTRAINT "ListingComment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ListingComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
