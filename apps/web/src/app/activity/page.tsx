'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { NotificationItem, Offer } from '@cerquita/types';
import { ApiError, type FriendRequest } from '@cerquita/api-client';
import { formatMoney, fromMajorUnits, money, toMajorUnitsString } from '@cerquita/utils';
import { AppScreen, EmptyState, appScreenStyles } from '@/components/AppScreen';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { formatRelativeTime } from '@/lib/time';
import styles from './page.module.css';

/**
 * Activity.
 *
 * Offers and friend requests are decisions somebody is waiting on; notifications
 * are news. They are grouped by that distinction rather than by type, because
 * the reason to open this screen is "does anything need me".
 *
 * Without it, a buyer could send an offer and a seller had nowhere to answer it
 * — the negotiation the API supports had no surface at all.
 */
export default function ActivityPage() {
  const { user, loading } = useSession();

  const [offers, setOffers] = useState<Offer[]>([]);
  const [requests, setRequests] = useState<FriendRequest[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [reviewable, setReviewable] = useState<Array<{ orderId: string; reference: string }>>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    // Each source is independent: one failing should not blank the other two.
    const [offerResult, requestResult, notificationResult, reviewResult] = await Promise.allSettled(
      [
        api.offers.list(),
        api.social.pendingFriendRequests(),
        api.notifications.list(),
        api.reviews.pending(),
      ],
    );

    if (offerResult.status === 'fulfilled') setOffers(offerResult.value);
    if (requestResult.status === 'fulfilled') setRequests(requestResult.value);
    if (notificationResult.status === 'fulfilled') {
      setNotifications(notificationResult.value.items);
    }
    if (reviewResult.status === 'fulfilled') setReviewable(reviewResult.value);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!user) return;
    void load();
  }, [load, user]);

  if (loading) {
    return (
      <AppScreen title="Actividad" active="profile">
        <p className={styles.state}>Cargando…</p>
      </AppScreen>
    );
  }

  if (!user) {
    return (
      <AppScreen title="Actividad" active="profile">
        <EmptyState
          title="Iniciá sesión"
          body="Acá aparecen las ofertas que te hacen, las solicitudes de amistad y tus avisos."
          actions={
            <Link href="/login?next=%2Factivity" className={appScreenStyles.primary}>
              Entrar
            </Link>
          }
        />
      </AppScreen>
    );
  }

  if (!ready) {
    return (
      <AppScreen title="Actividad" active="profile">
        <p className={styles.state}>Cargando…</p>
      </AppScreen>
    );
  }

  const unreadCount = notifications.filter((entry) => !entry.readAt).length;
  const isEmpty =
    offers.length === 0 &&
    requests.length === 0 &&
    notifications.length === 0 &&
    reviewable.length === 0;

  async function act(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'No pudimos completar la acción.');
    }
  }

  return (
    <AppScreen title="Actividad" active="profile">
      {error && <p className={styles.error}>{error}</p>}

      {isEmpty && (
        <EmptyState
          title="Nada pendiente"
          body="Cuando alguien te haga una oferta, te agregue o te escriba, lo vas a ver acá."
          actions={
            <Link href="/" className={appScreenStyles.primary}>
              Explorar el mapa
            </Link>
          }
        />
      )}

      {reviewable.length > 0 && (
        <section className={styles.section} aria-label="Calificaciones pendientes">
          <h2 className={styles.sectionTitle}>Para calificar</h2>
          <ul className={styles.list}>
            {reviewable.map((entry) => (
              <li key={entry.orderId}>
                <ReviewCard entry={entry} onAct={act} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {requests.length > 0 && (
        <section className={styles.section} aria-label="Solicitudes de amistad">
          <h2 className={styles.sectionTitle}>Solicitudes</h2>
          <ul className={styles.list}>
            {requests.map((request) => (
              <li key={request.id} className={styles.card}>
                <div className={styles.offerHead}>
                  {request.from.avatarUrl ? (
                    <img className={styles.avatar} src={request.from.avatarUrl} alt="" />
                  ) : (
                    <span className={styles.avatar} aria-hidden="true">
                      {request.from.displayName.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  <Link href={`/user/${request.from.username}`} className={styles.who}>
                    {request.from.displayName} te quiere agregar
                  </Link>
                  <span className={styles.when}>{formatRelativeTime(request.createdAt)}</span>
                </div>

                <div className={styles.actions}>
                  <button
                    type="button"
                    className={styles.primary}
                    onClick={() =>
                      void act(() => api.social.respondToFriendship(request.id, 'accepted'))
                    }
                  >
                    Aceptar
                  </button>
                  <button
                    type="button"
                    className={styles.secondary}
                    onClick={() =>
                      void act(() => api.social.respondToFriendship(request.id, 'rejected'))
                    }
                  >
                    Rechazar
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {offers.length > 0 && (
        <section className={styles.section} aria-label="Ofertas">
          <h2 className={styles.sectionTitle}>Ofertas</h2>
          <ul className={styles.list}>
            {offers.map((offer) => (
              <li key={offer.id}>
                <OfferCard offer={offer} viewerId={user.userId} onAct={act} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {notifications.length > 0 && (
        <section className={styles.section} aria-label="Avisos">
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>Avisos</h2>
            {unreadCount > 0 && (
              <button
                type="button"
                className={styles.markAll}
                onClick={() => void act(() => api.notifications.markAllRead())}
              >
                Marcar todo como leído
              </button>
            )}
          </div>

          <ul className={styles.list}>
            {notifications.map((entry) => (
              <li key={entry.id}>
                <NotificationRow
                  entry={entry}
                  onRead={() => void act(() => api.notifications.markRead(entry.id))}
                />
              </li>
            ))}
          </ul>
        </section>
      )}
    </AppScreen>
  );
}

/**
 * Rating the other party after an order.
 *
 * Stars are the whole form; the comment is optional. A required comment is how
 * you get an empty review section — most people will rate and very few will
 * write, and the rating is the part the next buyer needs.
 */
function ReviewCard({
  entry,
  onAct,
}: {
  entry: { orderId: string; reference: string };
  onAct: (action: () => Promise<unknown>) => Promise<void>;
}) {
  const [rating, setRating] = useState(0);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  return (
    <div className={styles.card}>
      <div className={styles.offerHead}>
        <span className={styles.who}>¿Cómo fue la operación #{entry.reference}?</span>
      </div>

      <div className={styles.stars} role="radiogroup" aria-label="Calificación">
        {[1, 2, 3, 4, 5].map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={rating === value}
            aria-label={`${value} de 5`}
            className={`${styles.star} ${value <= rating ? styles.starOn : ''}`}
            onClick={() => setRating(value)}
          >
            ★
          </button>
        ))}
      </div>

      <label className="sr-only" htmlFor={`review-${entry.orderId}`}>
        Comentario
      </label>
      <input
        id={`review-${entry.orderId}`}
        className={styles.counterInput}
        style={{ marginTop: 12, fontWeight: 400 }}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        placeholder="Contá cómo fue (opcional)"
        maxLength={1000}
      />

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.primary}
          disabled={busy || rating === 0}
          onClick={async () => {
            setBusy(true);
            await onAct(() =>
              api.reviews.create({
                orderId: entry.orderId,
                rating,
                body: body.trim() || undefined,
              }),
            );
            setBusy(false);
          }}
        >
          {busy ? 'Enviando…' : 'Calificar'}
        </button>
      </div>
    </div>
  );
}

function OfferCard({
  offer,
  viewerId,
  onAct,
}: {
  offer: Offer;
  viewerId: string;
  onAct: (action: () => Promise<unknown>) => Promise<void>;
}) {
  const [countering, setCountering] = useState(false);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);

  // Whoever the offer is TO is the one who can answer it. After a counter that
  // flips, which is why it is derived per offer rather than from "am I the
  // seller" — the seller who counter-offered is now waiting on the buyer.
  const mine = offer.fromUser.id === viewerId;
  const counterpart = mine ? offer.toUser : offer.fromUser;
  const canAnswer = !mine && offer.status === 'pending';

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    try {
      await onAct(action);
      setCountering(false);
      setAmount('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.card}>
      <div className={styles.offerHead}>
        {counterpart.avatarUrl ? (
          <img className={styles.avatar} src={counterpart.avatarUrl} alt="" />
        ) : (
          <span className={styles.avatar} aria-hidden="true">
            {counterpart.displayName.slice(0, 1).toUpperCase()}
          </span>
        )}
        <Link href={`/user/${counterpart.username}`} className={styles.who}>
          {mine
            ? `Le ofreciste a ${counterpart.displayName}`
            : `${counterpart.displayName} te ofreció`}
        </Link>
        <span className={styles.when}>{formatRelativeTime(offer.createdAt)}</span>
      </div>

      {offer.listing && (
        <Link href={`/listing/${offer.listing.id}`} className={styles.subject}>
          {offer.listing.coverImage ? (
            <img className={styles.thumb} src={offer.listing.coverImage.url} alt="" />
          ) : (
            <span className={styles.thumb} aria-hidden="true" />
          )}
          <span className={styles.subjectTitle}>{offer.listing.title}</span>
        </Link>
      )}

      <div className={styles.amounts}>
        <span className={styles.amount}>
          {formatMoney(money(offer.amount.amount, offer.amount.currency))}
        </span>
        {/* Neutral wording: this card is read by both sides, and "pedís" would
            be addressing the seller on the buyer's own screen. */}
        {offer.listing?.price && (
          <span className={styles.asking}>
            precio{' '}
            {formatMoney(money(offer.listing.price.list.amount, offer.listing.price.list.currency))}
          </span>
        )}
      </div>

      {offer.message && <p className={styles.message}>{offer.message}</p>}

      {offer.status !== 'pending' && (
        <span
          className={`${styles.status} ${offer.status === 'accepted' ? styles.statusAccepted : ''}`}
        >
          {statusLabel(offer.status)}
        </span>
      )}

      {canAnswer && (
        <>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.primary}
              disabled={busy}
              onClick={() => void run(() => api.offers.respond(offer.id, { action: 'accept' }))}
            >
              Aceptar
            </button>
            <button
              type="button"
              className={styles.secondary}
              disabled={busy}
              onClick={() => {
                setCountering((current) => !current);
                // Pre-filled with the current offer so the seller edits a
                // number rather than inventing one from nothing.
                setAmount(toMajorUnitsString(money(offer.amount.amount, offer.amount.currency)));
              }}
            >
              Contraofertar
            </button>
            <button
              type="button"
              className={styles.danger}
              disabled={busy}
              onClick={() => void run(() => api.offers.respond(offer.id, { action: 'reject' }))}
            >
              Rechazar
            </button>
          </div>

          {countering && (
            <div className={styles.counter}>
              <label className="sr-only" htmlFor={`counter-${offer.id}`}>
                Tu contraoferta
              </label>
              <input
                id={`counter-${offer.id}`}
                className={styles.counterInput}
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
              <button
                type="button"
                className={styles.primary}
                disabled={busy || !amount.trim()}
                onClick={() =>
                  void run(() =>
                    api.offers.respond(offer.id, {
                      action: 'counter',
                      // Typed in pesos, sent in minor units.
                      amount: fromMajorUnits(amount.replace(',', '.'), offer.amount.currency),
                    }),
                  )
                }
              >
                Enviar
              </button>
            </div>
          )}
        </>
      )}

      {mine && offer.status === 'pending' && (
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.danger}
            disabled={busy}
            onClick={() => void run(() => api.offers.cancel(offer.id))}
          >
            Cancelar mi oferta
          </button>
        </div>
      )}
    </div>
  );
}

function NotificationRow({ entry, onRead }: { entry: NotificationItem; onRead: () => void }) {
  const unread = !entry.readAt;
  // Deep links are `cerquita://listing/<id>` for the mobile app; on the web the
  // scheme is rewritten to a path rather than followed.
  const href = webPathFor(entry.deepLink);

  const body = (
    <>
      {unread ? <span className={styles.dot} /> : <span className={styles.dotPlaceholder} />}
      <span className={styles.notificationBody}>
        <span className={styles.notificationTitle}>{entry.title}</span>
        {entry.body && <span className={styles.notificationText}>{entry.body}</span>}
      </span>
      <span className={styles.when}>{formatRelativeTime(entry.createdAt)}</span>
    </>
  );

  const className = `${styles.notification} ${unread ? styles.unread : ''}`;

  return href ? (
    <Link href={href} className={className} onClick={() => unread && onRead()}>
      {body}
    </Link>
  ) : (
    <div className={className} onClick={() => unread && onRead()}>
      {body}
    </div>
  );
}

function webPathFor(deepLink: string | undefined): string | null {
  if (!deepLink?.startsWith('cerquita://')) return null;
  const path = deepLink.slice('cerquita://'.length);
  if (path.startsWith('listing/')) return `/${path}`;
  if (path.startsWith('chat/')) return `/messages/${path.slice('chat/'.length)}`;
  if (path.startsWith('order/')) return `/${path}`;
  return null;
}

function statusLabel(status: Offer['status']): string {
  const labels: Record<Offer['status'], string> = {
    pending: 'Pendiente',
    accepted: 'Aceptada',
    rejected: 'Rechazada',
    countered: 'Contraofertada',
    expired: 'Vencida',
    cancelled: 'Cancelada',
    completed: 'Completada',
  };
  return labels[status];
}
