'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { Listing } from '@cerquita/types';
import { ApiError } from '@cerquita/api-client';
import { formatDistance, formatMoney, fromMajorUnits, money, toMajorUnitsString } from '@cerquita/utils';
import { Price } from '@/components/Price';
import { Countdown } from '@/components/Countdown';
import { PriceHistory } from '@/components/PriceHistory';
import { Comments } from '@/components/Comments';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import styles from './page.module.css';

/**
 * The listing, as this viewer sees it.
 *
 * The server renders an anonymous copy: that is what gets indexed, and the
 * public price is the honest thing for a search engine to show. But almost
 * everything interesting here is per-viewer — the friend price, "amiga de
 * Nacho", whether you already saved it — so once a session exists the listing
 * is fetched again as you and the anonymous copy is replaced.
 *
 * Prices shown here are never used as the amount charged. Offers and bids send
 * what the user typed and the server re-derives everything else (spec §41).
 */
export function ListingDetail({ initial }: { initial: Listing }) {
  const { user, loading } = useSession();
  const router = useRouter();

  const [listing, setListing] = useState(initial);
  const [panel, setPanel] = useState<'offer' | 'bid' | null>(null);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  // Re-resolve as the viewer. Skipped while anonymous: the server copy already
  // is the anonymous one, and re-fetching it would only cost a round trip.
  useEffect(() => {
    if (!user) {
      setListing(initial);
      return;
    }

    let cancelled = false;
    api.listings
      .get(initial.id)
      .then((result) => {
        if (!cancelled) setListing(result);
      })
      .catch(() => {
        // Keep the anonymous copy on screen rather than blanking the page.
      });

    return () => {
      cancelled = true;
    };
  }, [initial, user]);

  const isAuction = listing.kind === 'auction';
  const isWanted = listing.kind === 'wanted';
  const isOwn = user?.userId === listing.seller.id;
  const currency = listing.price?.effective.currency ?? 'ARS';

  function requireSession(): boolean {
    if (user) return true;
    router.push(`/login?next=${encodeURIComponent(`/listing/${listing.id}`)}`);
    return false;
  }

  async function run(key: string, action: () => Promise<string | void>) {
    setBusy(key);
    setError(null);
    setDone(null);
    try {
      const message = await action();
      if (message) setDone(message);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'No pudimos completar la acción.');
    } finally {
      setBusy(null);
    }
  }

  async function toggleFavorite() {
    if (!requireSession()) return;
    const wasFavorite = listing.isFavorite;

    await run('favorite', async () => {
      if (wasFavorite) await api.favorites.remove(listing.id);
      else await api.favorites.add(listing.id);
      // The count is part of the listing's public face, so it moves with the flag.
      setListing((current) => ({
        ...current,
        isFavorite: !wasFavorite,
        favoriteCount: Math.max(0, current.favoriteCount + (wasFavorite ? -1 : 1)),
      }));
    });
  }

  async function openConversation() {
    if (!requireSession()) return;

    await run('message', async () => {
      const conversation = await api.chat.open({
        recipientId: listing.seller.id,
        listingId: listing.id,
      });
      router.push(`/messages/${conversation.id}`);
    });
  }

  async function setStatus(status: 'active' | 'paused' | 'removed', confirmation: string) {
    await run('status', async () => {
      await api.listings.setStatus(listing.id, status);
      // Re-fetched rather than patched: pausing changes what the rest of the
      // page is allowed to offer, and the server decides that.
      setListing(await api.listings.get(listing.id));
      return confirmation;
    });
  }

  async function addToCart() {
    if (!requireSession()) return;

    await run('cart', async () => {
      await api.cart.add({ listingId: listing.id, quantity: 1 });
      router.push('/cart');
    });
  }

  async function submitAmount() {
    if (!requireSession()) return;

    // Typed in pesos, sent in minor units. Parsing here rather than multiplying
    // by 100 keeps currencies with other exponents correct.
    let parsed;
    try {
      parsed = fromMajorUnits(amount.replace(',', '.'), currency);
    } catch {
      setError('Escribí un monto válido.');
      return;
    }

    if (panel === 'bid') {
      const auction = listing.auction;
      if (!auction) return;

      await run('bid', async () => {
        // `expectedMinimum` is what this screen displayed. If the threshold moved
        // while the panel was open the server rejects the bid instead of quietly
        // charging more than the bidder meant to offer.
        await api.auctions.bid(auction.id, parsed, auction.nextMinimumBid);
        setListing(await api.listings.get(listing.id));
        setPanel(null);
        setAmount('');
        return 'Tu oferta quedó registrada.';
      });
      return;
    }

    await run('offer', async () => {
      await api.offers.create({ listingId: listing.id, amount: parsed });
      setPanel(null);
      setAmount('');
      return 'Le mandamos tu oferta al vendedor.';
    });
  }

  return (
    <div className={styles.page}>
      <header className={styles.topBar}>
        <div className={styles.topBarRow}>
          <Link href="/" className={styles.back}>
            ← Volver al mapa
          </Link>

          <button
            type="button"
            className={`${styles.favorite} ${listing.isFavorite ? styles.favoriteOn : ''}`}
            onClick={() => void toggleFavorite()}
            disabled={busy === 'favorite'}
            aria-pressed={listing.isFavorite}
            aria-label={listing.isFavorite ? 'Quitar de guardados' : 'Guardar'}
          >
            {listing.isFavorite ? '♥' : '♡'}
          </button>
        </div>
      </header>

      <main id="contenido" className={styles.layout}>
        <div className={styles.gallery}>
          {listing.images.length > 0 ? (
            listing.images.map((image) => (
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
            {/* Anything but "active" changes what this page means, so it is said. */}
            {listing.status !== 'active' && (
              <span className={styles.promotedTag}>{statusLabel(listing.status)}</span>
            )}
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

            {/* Without a session the public price is all there is to show. */}
            {!user && !loading && listing.price && (
              <p className={styles.signedOutNote}>
                <Link
                  className={styles.signedOutLink}
                  href={`/login?next=${encodeURIComponent(`/listing/${listing.id}`)}`}
                >
                  Entrá
                </Link>{' '}
                para ver si tenés precio de amigo.
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

              {listing.auction.viewerIsHighestBidder && (
                <p className={styles.reserveNote}>Sos quien va ganando.</p>
              )}
            </section>
          )}

          {error && <p className={`${styles.feedback} ${styles.feedbackError}`}>{error}</p>}
          {done && <p className={`${styles.feedback} ${styles.feedbackOk}`}>{done}</p>}

          {panel && (
            <div className={styles.amountPanel}>
              <label className={styles.amountLabel} htmlFor="amount">
                {panel === 'bid' ? 'Tu oferta' : 'Cuánto ofrecés'}
              </label>
              <div className={styles.amountRow}>
                <input
                  id="amount"
                  className={styles.amountInput}
                  inputMode="decimal"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  placeholder={placeholderFor(listing, panel)}
                />
                <button
                  type="button"
                  className={styles.primary}
                  onClick={() => void submitAmount()}
                  disabled={busy !== null || !amount.trim()}
                >
                  {busy ? 'Enviando…' : 'Confirmar'}
                </button>
              </div>
              <p className={styles.amountHint}>
                {panel === 'bid' && listing.auction
                  ? `Mínimo ${formatMoney(money(listing.auction.nextMinimumBid.amount, listing.auction.nextMinimumBid.currency))}. La subasta la resuelve el servidor, no tu pantalla.`
                  : 'El vendedor puede aceptar, rechazar o contraofertar.'}
              </p>
            </div>
          )}

          {!isOwn && (
            <div className={styles.actions}>
              {isWanted ? (
                <button
                  type="button"
                  className={styles.primary}
                  onClick={() => void openConversation()}
                  disabled={busy === 'message'}
                >
                  {busy === 'message' ? 'Abriendo…' : 'Tengo uno'}
                </button>
              ) : isAuction ? (
                <button
                  type="button"
                  className={styles.primary}
                  onClick={() => {
                    if (!requireSession()) return;
                    setPanel(panel === 'bid' ? null : 'bid');
                    setAmount(suggestedBid(listing));
                  }}
                >
                  Ofertar
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className={styles.primary}
                    onClick={() => void addToCart()}
                    disabled={busy === 'cart' || listing.availableQuantity <= 0}
                  >
                    {listing.availableQuantity <= 0
                      ? 'Sin stock'
                      : busy === 'cart'
                        ? 'Agregando…'
                        : 'Comprar'}
                  </button>
                  {listing.acceptsOffers && (
                    <button
                      type="button"
                      className={styles.secondary}
                      onClick={() => {
                        if (!requireSession()) return;
                        setPanel(panel === 'offer' ? null : 'offer');
                        setAmount('');
                      }}
                    >
                      Hacer una oferta
                    </button>
                  )}
                </>
              )}

              <button
                type="button"
                className={styles.secondary}
                onClick={() => void openConversation()}
                disabled={busy === 'message'}
              >
                Mensaje
              </button>
            </div>
          )}

          {/*
            The seller's own view. Without this, publishing something is a
            one-way door: you could see your listing but not pause or retire it.
          */}
          {isOwn && (
            <div className={styles.actions}>
              {listing.status === 'paused' ? (
                <button
                  type="button"
                  className={styles.primary}
                  onClick={() => void setStatus('active', 'Volvió a estar visible.')}
                  disabled={busy === 'status'}
                >
                  Reactivar
                </button>
              ) : (
                <button
                  type="button"
                  className={styles.secondary}
                  onClick={() => void setStatus('paused', 'Pausada. Nadie la ve por ahora.')}
                  disabled={busy === 'status' || listing.status !== 'active'}
                >
                  Pausar
                </button>
              )}

              <button
                type="button"
                className={styles.secondary}
                onClick={() => {
                  // Retiring is not reversible through the UI, so it asks.
                  if (window.confirm('¿Retirar esta publicación? No se puede deshacer.')) {
                    void setStatus('removed', 'La retiramos.');
                  }
                }}
                disabled={busy === 'status' || listing.status === 'removed'}
              >
                Retirar
              </button>
            </div>
          )}

          <section className={styles.sellerBox} aria-label="Vendedor">
            <div>
              <p className={styles.sellerName}>
                {listing.store?.name ?? listing.seller.displayName}
                {listing.seller.verified && <span className={styles.verified}> ✓</span>}
              </p>
              {/*
                The social reference goes ABOVE the metrics: "amiga de Nacho"
                answers "can I trust this person" better than a star average
                does, which is the whole argument of direction 1c.
              */}
              {listing.socialProof && <p className={styles.socialProof}>{listing.socialProof}</p>}
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
              {[listing.location.neighborhood, listing.location.city].filter(Boolean).join(', ') ||
                'Zona aproximada'}
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

          <Comments listingId={listing.id} count={listing.commentCount ?? 0} />

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

function statusLabel(status: Listing['status']): string {
  const labels: Record<Listing['status'], string> = {
    draft: 'Borrador',
    active: 'Activa',
    reserved: 'Reservada',
    sold: 'Vendida',
    paused: 'Pausada',
    expired: 'Vencida',
    removed: 'Retirada',
  };
  return labels[status];
}

/** Pre-fills the bid box with the smallest bid the server would accept. */
function suggestedBid(listing: Listing): string {
  const minimum = listing.auction?.nextMinimumBid;
  return minimum ? toMajorUnitsString(money(minimum.amount, minimum.currency)) : '';
}

function placeholderFor(listing: Listing, panel: 'offer' | 'bid'): string {
  if (panel === 'bid') return suggestedBid(listing);
  return listing.price ? toMajorUnitsString(money(listing.price.effective.amount, listing.price.effective.currency)) : '';
}
