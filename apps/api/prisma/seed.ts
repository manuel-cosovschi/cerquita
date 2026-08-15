/**
 * Development seed (spec §88).
 *
 * Builds a dataset rich enough to actually exercise the product: sales, "Busco"
 * posts, a live auction and a scheduled one, friends and followers with real
 * social pricing, two stores with variants, promotions, offers and a chat.
 *
 * Locations are scattered around Buenos Aires so the map, clustering, radius
 * filters and distance labels all have something meaningful to show.
 *
 * Idempotent: running it twice does not duplicate anything.
 */

import { PrismaClient, type Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import { fuzzCoordinates, slugify, type Coordinates } from '@cerquita/utils';

const prisma = new PrismaClient();

/** Obelisco — the centre everything is scattered around. */
const CENTER: Coordinates = { lat: -34.6037, lng: -58.3816 };
const FUZZ_METERS = 350;
const SEED_PASSWORD = 'cerquita-demo-2026';

/** Deterministic offset in metres, so the seed produces the same map every run. */
function near(offsetNorthM: number, offsetEastM: number): Coordinates {
  const latDelta = offsetNorthM / 111_320;
  const lngDelta = offsetEastM / (111_320 * Math.cos((CENTER.lat * Math.PI) / 180));
  return { lat: CENTER.lat + latDelta, lng: CENTER.lng + lngDelta };
}

/** ARS pesos -> centavos. */
const ars = (pesos: number): number => pesos * 100;

async function main(): Promise<void> {
  console.log('Seeding Cerquita…');

  const passwordHash = await argon2.hash(SEED_PASSWORD, {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });

  await prisma.globalConfig.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });

  const categories = await seedCategories();
  const users = await seedUsers(passwordHash);
  await seedRelationships(users);
  const stores = await seedStores(users);
  const listings = await seedListings(users, stores, categories);
  await seedAuctions(listings);
  await seedPromotions(stores, listings);
  await seedOffers(users, listings);
  await seedConversations(users, listings);
  await seedSavedSearches(users, categories);

  console.log('\nSeed complete.');
  console.log(`  Users:    ${Object.keys(users).length}`);
  console.log(`  Stores:   ${Object.keys(stores).length}`);
  console.log(`  Listings: ${Object.keys(listings).length}`);
  console.log(`\n  Sign in with any of:`);
  for (const user of Object.values(users)) {
    console.log(`    ${user.email}  /  ${SEED_PASSWORD}`);
  }
}

/* ── categories ───────────────────────────────────────────────────────────── */

const CATEGORY_TREE = [
  { name: 'Tecnología', icon: 'cpu', children: ['Consolas', 'Celulares', 'Computadoras', 'Audio'] },
  { name: 'Deportes', icon: 'bike', children: ['Bicicletas', 'Camisetas', 'Running'] },
  { name: 'Hogar', icon: 'sofa', children: ['Muebles', 'Electrodomésticos', 'Decoración'] },
  { name: 'Herramientas', icon: 'wrench', children: ['Eléctricas', 'Manuales'] },
  { name: 'Moda', icon: 'shirt', children: ['Zapatillas', 'Abrigos'] },
];

async function seedCategories(): Promise<Record<string, string>> {
  const bySlug: Record<string, string> = {};

  for (const parent of CATEGORY_TREE) {
    const parentSlug = slugify(parent.name);
    const parentRow = await prisma.category.upsert({
      where: { slug: parentSlug },
      update: {},
      create: { slug: parentSlug, name: parent.name, icon: parent.icon },
    });
    bySlug[parentSlug] = parentRow.id;

    for (const childName of parent.children) {
      const childSlug = slugify(childName);
      const childRow = await prisma.category.upsert({
        where: { slug: childSlug },
        update: {},
        create: { slug: childSlug, name: childName, parentId: parentRow.id },
      });
      bySlug[childSlug] = childRow.id;
    }
  }

  return bySlug;
}

/* ── users ────────────────────────────────────────────────────────────────── */

interface SeedUser {
  id: string;
  email: string;
  username: string;
}

const USERS = [
  {
    username: 'manuel',
    displayName: 'Manuel',
    area: 'Palermo, CABA',
    bio: 'Vendo lo que ya no uso. Entrego en mano.',
    // Manuel gives followers 5% and friends 15% — the exact scenario in the spec.
    followerDiscountBps: 500,
    friendDiscountBps: 1500,
    verified: true,
    offset: [0, 0] as const,
  },
  {
    username: 'fran',
    displayName: 'Fran',
    area: 'Villa Crespo, CABA',
    bio: 'Fierrero y bicicletero.',
    followerDiscountBps: 300,
    friendDiscountBps: 1000,
    verified: false,
    offset: [900, -600] as const,
  },
  {
    username: 'bruno',
    displayName: 'Bruno',
    area: 'Almagro, CABA',
    bio: 'Compro y vendo tecnología.',
    followerDiscountBps: 0,
    friendDiscountBps: 800,
    verified: true,
    offset: [-700, 400] as const,
  },
  {
    username: 'lucia',
    displayName: 'Lucía',
    area: 'Caballito, CABA',
    bio: 'Subastas y objetos raros.',
    followerDiscountBps: 500,
    friendDiscountBps: 500,
    verified: true,
    offset: [-1400, -900] as const,
  },
  {
    username: 'santiago',
    displayName: 'Santiago',
    area: 'Recoleta, CABA',
    bio: 'Mudanza: vendo todo.',
    followerDiscountBps: 1000,
    friendDiscountBps: 2000,
    verified: false,
    offset: [1200, 800] as const,
  },
];

async function seedUsers(passwordHash: string): Promise<Record<string, SeedUser>> {
  const users: Record<string, SeedUser> = {};

  for (const spec of USERS) {
    const email = `${spec.username}@cerquita.dev`;

    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: {
        email,
        username: spec.username,
        displayName: spec.displayName,
        passwordHash,
        bio: spec.bio,
        area: spec.area,
        verified: spec.verified,
        emailVerifiedAt: new Date(),
        followerDiscountBps: spec.followerDiscountBps,
        friendDiscountBps: spec.friendDiscountBps,
      },
      select: { id: true, email: true, username: true },
    });

    const exact = near(spec.offset[0], spec.offset[1]);
    await writePoint('User', user.id, exact);

    users[spec.username] = user;
  }

  // One administrator so the admin panel is reachable in development.
  const adminEmail = 'admin@cerquita.dev';
  await prisma.user.upsert({
    where: { email: adminEmail },
    update: { adminRole: 'super_admin' },
    create: {
      email: adminEmail,
      username: 'admin',
      displayName: 'Administración',
      passwordHash,
      adminRole: 'super_admin',
      emailVerifiedAt: new Date(),
      verified: true,
    },
  });

  return users;
}

/**
 * Writes both the exact and the derived public point.
 *
 * Mirrors what the application does on every write, so seeded rows are
 * indistinguishable from real ones — including the fuzzing.
 */
async function writePoint(
  table: 'User' | 'Listing' | 'Store',
  id: string,
  exact: Coordinates,
): Promise<void> {
  const publicPoint = fuzzCoordinates(exact, id, FUZZ_METERS);

  // The table name is from a closed union, never user input.
  await prisma.$executeRawUnsafe(
    `UPDATE "${table}"
       SET "exactLocation"  = ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
           "publicLocation" = ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography
     WHERE "id" = $5::uuid`,
    exact.lng,
    exact.lat,
    publicPoint.lng,
    publicPoint.lat,
    id,
  );
}

/* ── social graph ─────────────────────────────────────────────────────────── */

async function seedRelationships(users: Record<string, SeedUser>): Promise<void> {
  // Referenced by username so a typo fails loudly here rather than silently
  // seeding an incomplete social graph.
  const get = (username: string): SeedUser => {
    const user = users[username];
    if (!user) throw new Error(`Seed user "${username}" was not created`);
    return user;
  };

  // Friendships (bilateral) — stored under the canonical ordering the database
  // CHECK constraint enforces.
  const friendships: Array<[string, string, 'accepted' | 'pending']> = [
    ['manuel', 'fran', 'accepted'],
    ['manuel', 'bruno', 'accepted'],
    ['fran', 'lucia', 'accepted'],
    ['santiago', 'manuel', 'pending'],
  ];

  for (const [requesterName, addresseeName, status] of friendships) {
    const requester = get(requesterName);
    const addressee = get(addresseeName);
    const [userAId, userBId] =
      requester.id < addressee.id ? [requester.id, addressee.id] : [addressee.id, requester.id];

    await prisma.friendship.upsert({
      where: { userAId_userBId: { userAId, userBId } },
      update: { status },
      create: { userAId, userBId, requesterId: requester.id, status },
    });
  }

  // Follows (unilateral).
  const follows: Array<[string, string]> = [
    ['santiago', 'manuel'],
    ['lucia', 'manuel'],
    ['bruno', 'lucia'],
    ['fran', 'santiago'],
    ['manuel', 'lucia'],
  ];

  for (const [followerName, followeeName] of follows) {
    const follower = get(followerName);
    const followee = get(followeeName);
    await prisma.follow.upsert({
      where: { followerId_followeeId: { followerId: follower.id, followeeId: followee.id } },
      update: {},
      create: { followerId: follower.id, followeeId: followee.id },
    });
  }
}

/* ── stores ───────────────────────────────────────────────────────────────── */

interface SeedStore {
  id: string;
  handle: string;
}

async function seedStores(users: Record<string, SeedUser>): Promise<Record<string, SeedStore>> {
  const specs = [
    {
      handle: 'casaca-de-cancha',
      name: 'Casaca de Cancha',
      description: 'Camisetas de fútbol retro y actuales. Cambios sin cargo.',
      categories: ['Deportes', 'Moda'],
      owner: users.manuel!,
      offset: [400, 1100] as const,
      address: 'Av. Corrientes 2100, CABA',
      followerDiscountBps: 500,
    },
    {
      handle: 'ferreteria-pepe',
      name: 'Ferretería Pepe',
      description: 'Herramientas y ferretería general. Retiro en el local.',
      categories: ['Herramientas', 'Hogar'],
      owner: users.fran!,
      offset: [-500, 900] as const,
      address: 'Av. Rivadavia 3400, CABA',
      followerDiscountBps: 300,
    },
    {
      handle: 'tecno-almagro',
      name: 'Tecno Almagro',
      description: 'Tecnología nueva y reacondicionada con garantía.',
      categories: ['Tecnología'],
      owner: users.bruno!,
      offset: [-900, -1200] as const,
      address: 'Av. Medrano 500, CABA',
      followerDiscountBps: 400,
    },
  ];

  const stores: Record<string, SeedStore> = {};

  for (const spec of specs) {
    const store = await prisma.store.upsert({
      where: { handle: spec.handle },
      update: {},
      create: {
        handle: spec.handle,
        name: spec.name,
        description: spec.description,
        categories: spec.categories,
        verified: true,
        hasPhysicalLocation: true,
        address: spec.address,
        deliveryMethods: ['pickup', 'shipping'],
        followerDiscountBps: spec.followerDiscountBps,
        members: { create: { userId: spec.owner.id, role: 'owner' } },
        openingHours: {
          create: [1, 2, 3, 4, 5].map((weekday) => ({
            weekday,
            opensAt: 9 * 60,
            closesAt: 18 * 60,
          })),
        },
      },
      select: { id: true, handle: true },
    });

    await writePoint('Store', store.id, near(spec.offset[0], spec.offset[1]));
    stores[spec.handle] = store;
  }

  return stores;
}

/* ── listings ─────────────────────────────────────────────────────────────── */

interface ListingSpec {
  key: string;
  kind: 'sale' | 'wanted' | 'auction';
  title: string;
  description: string;
  category: string;
  seller: string;
  store?: string;
  price?: number;
  maxBudget?: number;
  condition?: 'new' | 'like_new' | 'good' | 'fair' | 'for_parts';
  quantity?: number;
  offset: readonly [number, number];
  tags: string[];
  wantedRadiusMeters?: number;
  /** Earlier prices, oldest first, so the price-history chart has real data. */
  priceHistory?: number[];
}

const LISTINGS: ListingSpec[] = [
  {
    key: 'ps5',
    kind: 'sale',
    title: 'PlayStation 5 con dos joysticks',
    description:
      'PS5 edición con lectora, impecable, poco uso. Incluye dos joysticks y todos los cables. Se puede probar antes de comprar.',
    category: 'consolas',
    seller: 'manuel',
    price: ars(550_000),
    condition: 'like_new',
    offset: [150, 200],
    tags: ['ps5', 'playstation', 'consola', 'sony'],
    priceHistory: [ars(600_000), ars(570_000)],
  },
  {
    key: 'iphone',
    kind: 'sale',
    title: 'iPhone 15 Pro 256GB',
    description: 'iPhone 15 Pro titanio natural, batería 94%, libre. Con caja y funda.',
    category: 'celulares',
    seller: 'bruno',
    store: 'tecno-almagro',
    price: ars(980_000),
    condition: 'good',
    offset: [-880, -1180],
    tags: ['iphone', 'apple', 'celular'],
  },
  {
    key: 'bici',
    kind: 'sale',
    title: 'Bicicleta mountain bike rodado 29',
    description: 'MTB rodado 29, 21 velocidades, frenos a disco. Recién service.',
    category: 'bicicletas',
    seller: 'fran',
    price: ars(350_000),
    condition: 'good',
    offset: [880, -580],
    tags: ['bicicleta', 'mtb', 'mountain bike', 'rodado 29'],
    priceHistory: [ars(420_000)],
  },
  {
    key: 'macbook',
    kind: 'sale',
    title: 'MacBook Air M2 8/256',
    description: 'MacBook Air M2, 8GB RAM, 256GB SSD. Ciclos de batería bajos.',
    category: 'computadoras',
    seller: 'santiago',
    price: ars(1_150_000),
    condition: 'like_new',
    offset: [1180, 820],
    tags: ['macbook', 'apple', 'notebook', 'm2'],
  },
  {
    key: 'taladro',
    kind: 'sale',
    title: 'Taladro percutor 750W',
    description: 'Taladro percutor con maletín y set de mechas. Nuevo, sin uso.',
    category: 'electricas',
    seller: 'fran',
    store: 'ferreteria-pepe',
    price: ars(85_000),
    condition: 'new',
    quantity: 8,
    offset: [-480, 920],
    tags: ['taladro', 'herramienta', 'percutor'],
  },
  {
    key: 'sillon',
    kind: 'sale',
    title: 'Sillón de tres cuerpos',
    description: 'Sillón tres cuerpos gris, muy cómodo. Retiro en Recoleta, no hago envíos.',
    category: 'muebles',
    seller: 'santiago',
    price: ars(240_000),
    condition: 'good',
    offset: [1250, 760],
    tags: ['sillon', 'sofa', 'mueble', 'living'],
  },
  {
    key: 'busco-ps5',
    kind: 'wanted',
    title: 'Busco PlayStation 5',
    description: 'Busco PS5 en buen estado, con lectora. Pago en efectivo, retiro yo.',
    category: 'consolas',
    seller: 'lucia',
    maxBudget: ars(550_000),
    offset: [-1380, -880],
    tags: ['ps5', 'playstation', 'busco'],
    wantedRadiusMeters: 5000,
  },
  {
    key: 'busco-macbook',
    kind: 'wanted',
    title: 'Busco MacBook Air M2',
    description: 'Necesito una MacBook Air M2 para trabajar. Hasta $900.000.',
    category: 'computadoras',
    seller: 'fran',
    maxBudget: ars(900_000),
    offset: [920, -640],
    tags: ['macbook', 'notebook', 'busco'],
    wantedRadiusMeters: 8000,
  },
  {
    key: 'busco-bici',
    kind: 'wanted',
    title: 'Busco bicicleta para niño',
    description: 'Busco bici rodado 20 para mi hijo. Puede ser usada.',
    category: 'bicicletas',
    seller: 'bruno',
    maxBudget: ars(120_000),
    offset: [-680, 420],
    tags: ['bicicleta', 'niño', 'rodado 20'],
    wantedRadiusMeters: 3000,
  },
  /*
   * The rest of the "busco" posts exist so local demand (§51) has a real
   * pattern to report rather than one post per category, which never crosses
   * the threshold and leaves that screen permanently empty.
   *
   * Two shapes on purpose: bicicletas has three people asking against one bike
   * on sale ("falta oferta"), and electrodomésticos has two asking with nothing
   * on sale at all ("nadie vende") — the two verdicts the screen can give.
   */
  {
    key: 'busco-bici-ruta',
    kind: 'wanted',
    title: 'Busco bicicleta de ruta talle M',
    description: 'Arranco a entrenar y no quiero gastar en una nueva. Talle M o 54.',
    category: 'bicicletas',
    seller: 'santiago',
    maxBudget: ars(400_000),
    offset: [1120, 380],
    tags: ['bicicleta', 'ruta', 'busco'],
    wantedRadiusMeters: 6000,
  },
  {
    key: 'busco-bici-fija',
    kind: 'wanted',
    title: 'Busco bicicleta fija para casa',
    description: 'Para el invierno. Que ande bien, no me importa la estética.',
    category: 'bicicletas',
    seller: 'manuel',
    maxBudget: ars(180_000),
    offset: [-260, 1080],
    tags: ['bicicleta', 'fija', 'busco'],
    wantedRadiusMeters: 4000,
  },
  {
    key: 'busco-heladera',
    kind: 'wanted',
    title: 'Busco heladera con freezer',
    description: 'Me mudo el mes que viene y necesito heladera. Retiro con flete.',
    category: 'electrodomesticos',
    seller: 'fran',
    maxBudget: ars(350_000),
    offset: [640, -1180],
    tags: ['heladera', 'freezer', 'busco'],
    wantedRadiusMeters: 7000,
  },
  {
    key: 'busco-heladera-chica',
    kind: 'wanted',
    title: 'Busco heladera chica para oficina',
    description: 'Una heladera bajo mesada para la oficina. Puede ser usada.',
    category: 'electrodomesticos',
    seller: 'lucia',
    maxBudget: ars(150_000),
    offset: [-940, -520],
    tags: ['heladera', 'oficina', 'busco'],
    wantedRadiusMeters: 5000,
  },
  {
    key: 'auction-iphone',
    kind: 'auction',
    title: 'iPhone 15 Pro Max — SUBASTA',
    description: 'Subasto iPhone 15 Pro Max 512GB. Arranca sin reserva alta, mirá el historial.',
    category: 'celulares',
    seller: 'lucia',
    condition: 'good',
    offset: [-1420, -940],
    tags: ['iphone', 'subasta', 'apple'],
  },
  {
    key: 'auction-camiseta',
    kind: 'auction',
    title: 'Camiseta Argentina 2026 firmada — SUBASTA',
    description: 'Camiseta oficial firmada. Empieza hoy a las 21:00.',
    category: 'camisetas',
    seller: 'manuel',
    store: 'casaca-de-cancha',
    condition: 'new',
    offset: [380, 1080],
    tags: ['camiseta', 'argentina', 'subasta', 'firmada'],
  },
];

async function seedListings(
  users: Record<string, SeedUser>,
  stores: Record<string, SeedStore>,
  categories: Record<string, string>,
): Promise<Record<string, string>> {
  const created: Record<string, string> = {};

  for (const spec of LISTINGS) {
    const seller = users[spec.seller];
    const categoryId = categories[spec.category];
    if (!seller || !categoryId) continue;

    // Idempotency: a listing is identified by its title and seller.
    const existing = await prisma.listing.findFirst({
      where: { title: spec.title, sellerId: seller.id },
      select: { id: true },
    });
    if (existing) {
      created[spec.key] = existing.id;
      continue;
    }

    const data: Prisma.ListingCreateInput = {
      kind: spec.kind,
      // Created as a draft so the location can be written before it goes live,
      // which is what the published-requires-location constraint expects.
      status: 'draft',
      title: spec.title,
      description: spec.description,
      tags: spec.tags,
      seller: { connect: { id: seller.id } },
      category: { connect: { id: categoryId } },
      condition: spec.condition,
      priceAmount: spec.price,
      maxBudgetAmount: spec.maxBudget,
      wantedRadiusMeters: spec.wantedRadiusMeters,
      quantity: spec.quantity ?? 1,
      acceptsOffers: spec.kind === 'sale',
      deliveryMethods: spec.kind === 'wanted' ? [] : ['pickup', 'meetup'],
      publishedAt: new Date(),
    };

    if (spec.store && stores[spec.store]) {
      data.store = { connect: { id: stores[spec.store]!.id } };
    }

    const listing = await prisma.listing.create({ data, select: { id: true } });

    await writePoint('Listing', listing.id, near(spec.offset[0], spec.offset[1]));
    await prisma.listing.update({ where: { id: listing.id }, data: { status: 'active' } });

    await prisma.listingImage.create({
      data: {
        listingId: listing.id,
        // Placeholder imagery: the seed must not depend on a network fetch, and
        // these are clearly stand-ins rather than pretending to be real photos.
        url: placeholderImage(spec.title, 1200, 900),
        thumbnailUrl: placeholderImage(spec.title, 400, 300),
        width: 1200,
        height: 900,
        position: 0,
        alt: spec.title,
      },
    });

    // Price history, oldest first, then the current price as the latest point.
    const history = [...(spec.priceHistory ?? []), ...(spec.price ? [spec.price] : [])];
    for (const [index, amount] of history.entries()) {
      await prisma.listingPriceHistory.create({
        data: {
          listingId: listing.id,
          priceAmount: amount,
          reason: index === 0 ? 'published' : index === history.length - 1 ? null : 'price_drop',
          recordedAt: new Date(Date.now() - (history.length - index) * 4 * 24 * 3600 * 1000),
        },
      });
    }

    created[spec.key] = listing.id;
  }

  return created;
}

/**
 * An inline SVG data URI. Keeps the seed offline and makes it obvious in the UI
 * that these are placeholders, not photographs.
 */
function placeholderImage(label: string, width: number, height: number): string {
  const hue = [...label].reduce((acc, char) => (acc + char.charCodeAt(0)) % 360, 0);
  const text = label.length > 28 ? `${label.slice(0, 27)}…` : label;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="hsl(${hue} 45% 88%)"/><text x="50%" y="50%" font-family="system-ui,sans-serif" font-size="${Math.round(width / 22)}" fill="hsl(${hue} 40% 32%)" text-anchor="middle" dominant-baseline="middle">${escapeXml(text)}</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (char) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[char] ?? char,
  );
}

/* ── auctions ─────────────────────────────────────────────────────────────── */

async function seedAuctions(listings: Record<string, string>): Promise<void> {
  const now = Date.now();

  // One auction already running and closing soon, so "Ahora" and the countdown
  // have something to show the moment the app opens.
  const liveId = listings['auction-iphone'];
  if (liveId) {
    const existing = await prisma.auction.findUnique({ where: { listingId: liveId } });
    if (!existing) {
      await prisma.auction.create({
        data: {
          listingId: liveId,
          status: 'live',
          startsAt: new Date(now - 2 * 3600 * 1000),
          endsAt: new Date(now + 4 * 3600 * 1000),
          startingPriceAmount: ars(600_000),
          minimumIncrementAmount: ars(10_000),
          reservePriceAmount: ars(700_000),
          buyNowPriceAmount: ars(1_100_000),
          highestBidAmount: ars(620_000),
          bidCount: 3,
          participantCount: 2,
        },
      });
    }
  }

  // One scheduled auction, to exercise "Empieza hoy 21:00" and "Recordarme".
  const scheduledId = listings['auction-camiseta'];
  if (scheduledId) {
    const existing = await prisma.auction.findUnique({ where: { listingId: scheduledId } });
    if (!existing) {
      const startsAt = new Date(now + 6 * 3600 * 1000);
      await prisma.auction.create({
        data: {
          listingId: scheduledId,
          status: 'scheduled',
          startsAt,
          endsAt: new Date(startsAt.getTime() + 48 * 3600 * 1000),
          startingPriceAmount: ars(120_000),
          minimumIncrementAmount: ars(5_000),
        },
      });
    }
  }
}

/* ── promotions ───────────────────────────────────────────────────────────── */

async function seedPromotions(
  stores: Record<string, SeedStore>,
  listings: Record<string, string>,
): Promise<void> {
  const store = stores['casaca-de-cancha'];
  if (!store) return;

  const existing = await prisma.promotion.findFirst({ where: { storeId: store.id } });
  if (existing) return;

  // A flash sale, so the "Ahora" layer and the countdown badge have real data.
  await prisma.promotion.create({
    data: {
      storeId: store.id,
      kind: 'flash_sale',
      label: '20% OFF por 2 horas',
      basisPoints: 2000,
      requiredTier: 'public',
      startsAt: new Date(Date.now() - 30 * 60 * 1000),
      endsAt: new Date(Date.now() + 90 * 60 * 1000),
      active: true,
    },
  });

  const taladroId = listings['taladro'];
  if (taladroId) {
    await prisma.promotion.create({
      data: {
        kind: 'follower_discount',
        label: 'Seguidores -10%',
        basisPoints: 1000,
        requiredTier: 'follower',
        active: true,
        listings: { create: { listingId: taladroId } },
      },
    });
  }
}

/* ── offers & chat ────────────────────────────────────────────────────────── */

async function seedOffers(
  users: Record<string, SeedUser>,
  listings: Record<string, string>,
): Promise<void> {
  const ps5 = listings['ps5'];
  const manuel = users['manuel'];
  const santiago = users['santiago'];
  if (!ps5 || !manuel || !santiago) return;

  const existing = await prisma.offer.findFirst({ where: { listingId: ps5 } });
  if (existing) return;

  await prisma.offer.create({
    data: {
      listingId: ps5,
      fromUserId: santiago.id,
      toUserId: manuel.id,
      amount: ars(500_000),
      message: '¿Aceptás 500 mil en efectivo hoy?',
      expiresAt: new Date(Date.now() + 2 * 3600 * 1000),
    },
  });
}

async function seedConversations(
  users: Record<string, SeedUser>,
  listings: Record<string, string>,
): Promise<void> {
  const ps5 = listings['ps5'];
  const manuel = users['manuel'];
  const santiago = users['santiago'];
  if (!ps5 || !manuel || !santiago) return;

  const existing = await prisma.conversation.findFirst({ where: { listingId: ps5 } });
  if (existing) return;

  const conversation = await prisma.conversation.create({
    data: {
      context: 'listing',
      contextId: ps5,
      listingId: ps5,
      members: { create: [{ userId: manuel.id }, { userId: santiago.id }] },
    },
  });

  const messages = [
    { senderId: santiago.id, body: 'Hola! Sigue disponible la PS5?' },
    { senderId: manuel.id, body: 'Sí, disponible. La podés ver cuando quieras.' },
    { senderId: santiago.id, body: 'Genial, te hice una oferta.' },
  ];

  for (const [index, message] of messages.entries()) {
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        senderId: message.senderId,
        body: message.body,
        createdAt: new Date(Date.now() - (messages.length - index) * 10 * 60 * 1000),
      },
    });
  }
}

async function seedSavedSearches(
  users: Record<string, SeedUser>,
  categories: Record<string, string>,
): Promise<void> {
  const lucia = users['lucia'];
  const consolas = categories['consolas'];
  if (!lucia || !consolas) return;

  const existing = await prisma.savedSearch.findFirst({ where: { userId: lucia.id } });
  if (existing) return;

  const saved = await prisma.savedSearch.create({
    data: {
      userId: lucia.id,
      name: 'PS5 cerca',
      text: 'PS5',
      categoryIds: [consolas],
      kinds: ['sale'],
      maxPrice: ars(600_000),
      radiusMeters: 5000,
      notify: true,
    },
  });

  await prisma.$executeRawUnsafe(
    `UPDATE "SavedSearch"
       SET "center" = ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
     WHERE "id" = $3::uuid`,
    CENTER.lng,
    CENTER.lat,
    saved.id,
  );
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
