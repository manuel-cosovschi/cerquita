import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Listing } from '@cerquita/types';
import { formatDistance, formatMoney, money } from '@cerquita/utils';
import { serverApi } from '@/lib/api';
import { Price } from '@/components/Price';
import { Countdown } from '@/components/Countdown';
import { PriceHistory } from '@/components/PriceHistory';
import styles from './page.module.css';

interface PageProps {
  params: Promise<{ id: string }>;
}

async function loadListing(id: string): Promise<Listing | null> {
  try {
    return await serverApi.listings.get(id);
  } catch {
    return null;
  }
}

/**
 * Dynamic metadata so a shared listing link previews correctly and the page is
 * indexable (spec §94).
 */
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const listing = await loadListing(id);

  if (!listing) return { title: 'Publicación no encontrada' };

  const price = listing.price
    ? formatMoney(money(listing.price.effective.amount, listing.price.effective.currency))
    : undefined;

  return {
    title: listing.title,
    description: listing.description.slice(0, 160) || `${listing.title} en Cerquita`,
    openGraph: {
      title: price ? `${listing.title} — ${price}` : listing.title,
      description: listing.description.slice(0, 200),
      images: listing.coverImage ? [{ url: listing.coverImage.url }] : undefined,
      type: 'website',
    },
  };
}

export default async function ListingPage({ params }: PageProps) {
  const { id } = await params;
  const listing = await loadListing(id);

  if (!listing) notFound();

  const isAuction = listing.kind === 'auction';
  const isWanted = listing.kind === 'wanted';

  return (
    <div className={styles.page}>
      <header className={styles.topBar}>
        <Link href="/" className={styles.back}>
          ← Volver al mapa
        </Link>
      </header>

      <main id="contenido" className={styles.layout}>
        <div className={styles.gallery}>
          {listing.images.length > 0 ? (
            listing.images.map((image) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={image.id}
                src={image.url}
                alt={image.alt ?? listing.title}
                className={styles.image}
                width={image.width}
                height={image.height}
              />
            ))
          ) : (
            <div className={styles.imagePlaceholder}>
              {isWanted ? 'Publicación "Busco"' : 'Sin fotos'}
            </div>
          )}
        </div>

        <div className={styles.details}>
          <div className={styles.tags}>
            {isAuction && <span className={styles.auctionTag}>Subasta</span>}
            {isWanted && <span className={styles.wantedTag}>Busco</span>}
            {listing.isPromoted && <span className={styles.promotedTag}>Destacado</span>}
          </div>

          <h1 className={styles.title}>{listing.title}</h1>

          <div className={styles.priceBlock}>
            {listing.price && <Price price={listing.price} size="lg" />}

            {isWanted && listing.maxBudget && (
              <p className={`${styles.budget} numeric`}>
                Presupuesto máximo:{' '}
                {formatMoney(money(listing.maxBudget.amount, listing.maxBudget.currency))}
              </p>
            )}

            {listing.price && listing.price.tier !== 'public' && (
              <p className={styles.socialNote}>
                {listing.price.tier === 'friend'
                  ? 'Estás viendo el precio de amigo.'
                  : 'Estás viendo el precio para seguidores.'}
              </p>
            )}
          </div>

          {isAuction && listing.auction && (
            <section className={styles.auctionBox} aria-label="Estado de la subasta">
              <div className={styles.auctionRow}>
                <span>Oferta actual</span>
                <strong className="numeric">
                  {formatMoney(
                    money(
                      listing.auction.currentPrice.amount,
                      listing.auction.currentPrice.currency,
                    ),
                  )}
                </strong>
              </div>
              <div className={styles.auctionRow}>
                <span>Próxima puja mínima</span>
                <strong className="numeric">
                  {formatMoney(
                    money(
                      listing.auction.nextMinimumBid.amount,
                      listing.auction.nextMinimumBid.currency,
                    ),
                  )}
                </strong>
              </div>
              <div className={styles.auctionRow}>
                <span>Participantes</span>
                <strong className="numeric">{listing.auction.participantCount}</strong>
              </div>
              <div className={styles.auctionRow}>
                <span>{listing.auction.status === 'scheduled' ? 'Empieza' : 'Termina'}</span>
                <strong>
                  <Countdown
                    endsAt={
                      listing.auction.status === 'scheduled'
                        ? listing.auction.startsAt
                        : listing.auction.endsAt
                    }
                    compact
                  />
                </strong>
              </div>

              {listing.auction.hasReserve && (
                <p className={styles.reserveNote}>
                  {listing.auction.reserveMet
                    ? 'El precio de reserva fue alcanzado.'
                    : 'Todavía no se alcanzó el precio de reserva.'}
                </p>
              )}
            </section>
          )}

          <div className={styles.actions}>
            {isWanted ? (
              <button type="button" className={styles.primary}>
                Tengo uno
              </button>
            ) : isAuction ? (
              <button type="button" className={styles.primary}>
                Ofertar
              </button>
            ) : (
              <>
                <button type="button" className={styles.primary}>
                  Comprar
                </button>
                {listing.acceptsOffers && (
                  <button type="button" className={styles.secondary}>
                    Hacer una oferta
                  </button>
                )}
              </>
            )}
            <button type="button" className={styles.secondary}>
              Mensaje
            </button>
          </div>

          <section className={styles.sellerBox} aria-label="Vendedor">
            <div>
              <p className={styles.sellerName}>
                {listing.store?.name ?? listing.seller.displayName}
                {listing.seller.verified && <span className={styles.verified}> ✓</span>}
              </p>
              <p className={styles.sellerMeta}>
                {listing.seller.rating !== undefined
                  ? `${listing.seller.rating.toFixed(1)} ★ · ${listing.seller.reviewCount} reseñas`
                  : 'Sin reseñas todavía'}
              </p>
            </div>
            <Link href={`/user/${listing.seller.username}`} className={styles.secondary}>
              Ver perfil
            </Link>
          </section>

          {listing.description && (
            <section aria-label="Descripción">
              <h2 className={styles.sectionTitle}>Descripción</h2>
              <p className={styles.description}>{listing.description}</p>
            </section>
          )}

          <section aria-label="Ubicación">
            <h2 className={styles.sectionTitle}>Dónde está</h2>
            <p className={styles.location}>
              {[listing.location.neighborhood, listing.location.city]
                .filter(Boolean)
                .join(', ') || 'Zona aproximada'}
              {listing.distanceMeters !== undefined && (
                <> · a {formatDistance(listing.distanceMeters)}</>
              )}
            </p>
            {/*
              The exact address is never shown. The API only ever returns an
              approximate point, and this states that plainly (spec §10, §47).
            */}
            <p className={styles.locationNote}>
              Ubicación aproximada (±{listing.location.precisionMeters} m). La dirección exacta se
              acuerda por chat.
            </p>
          </section>

          {listing.priceHistory.length > 1 && (
            <section aria-label="Historial de precios">
              <h2 className={styles.sectionTitle}>Historial de precios</h2>
              <PriceHistory points={listing.priceHistory} />
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
