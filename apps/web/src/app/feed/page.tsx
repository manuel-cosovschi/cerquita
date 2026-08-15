'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { FeedItem } from '@cerquita/types';
import { formatDistance, formatMoney, money } from '@cerquita/utils';
import { AppScreen, EmptyState, appScreenStyles } from '@/components/AppScreen';
import { Price } from '@/components/Price';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { formatRelativeTime } from '@/lib/time';
import styles from './page.module.css';

/** Where the viewer's last known position is remembered between visits. */
const POSITION_KEY = 'cerquita.position';

const BADGES: Partial<Record<FeedItem['type'], { label: string; className: string }>> = {
  friend_activity: { label: 'De un amigo', className: 'badgeFriend' },
  price_drop: { label: 'Bajó de precio', className: 'badgeDrop' },
  wanted_listing: { label: 'Busca', className: 'badgeWanted' },
  new_auction: { label: 'Subasta', className: 'badgeAuction' },
  store_promotion: { label: 'Promo', className: 'badgeStore' },
};

/**
 * The feed.
 *
 * The map is the home screen in this design; the feed is the way in for someone
 * who wants a specific thing and does not want to explore. Every row leads with
 * the reason it is here, because that reason is the only thing separating this
 * screen from search results.
 *
 * Position is asked for, never taken: without it the feed still works, it just
 * has no "cerca tuyo" rows.
 */
export default function FeedPage() {
  const { user, loading } = useSession();
  const [items, setItems] = useState<FeedItem[] | null>(null);
  const [position, setPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [asked, setAsked] = useState(false);

  // A position granted once is remembered, so the prompt does not reappear on
  // every visit for someone who already said yes.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(POSITION_KEY);
      if (stored) setPosition(JSON.parse(stored) as { lat: number; lng: number });
    } catch {
      // Unparseable or unavailable storage just means we ask again.
    }
  }, []);

  const load = useCallback(async (where: { lat: number; lng: number } | null) => {
    const result = await api.feed.list(where ? { lat: where.lat, lng: where.lng } : {});
    setItems(result);
  }, []);

  useEffect(() => {
    void load(position).catch(() => setItems([]));
    // Refetched when the viewer changes: the whole feed is resolved per person.
  }, [load, position, user?.userId]);

  function askForPosition() {
    setAsked(true);
    if (!navigator.geolocation) return;

    navigator.geolocation.getCurrentPosition(
      (found) => {
        const where = { lat: found.coords.latitude, lng: found.coords.longitude };
        setPosition(where);
        try {
          window.localStorage.setItem(POSITION_KEY, JSON.stringify(where));
        } catch {
          // Not being able to remember it is not a failure worth showing.
        }
      },
      () => {
        // Declining is a valid answer; the feed keeps working without it.
      },
    );
  }

  if (loading || items === null) {
    return (
      <AppScreen title="Feed" active="feed">
        <p className={styles.state}>Cargando…</p>
      </AppScreen>
    );
  }

  return (
    <AppScreen
      title="Feed"
      subtitle={user ? 'Lo que pasa cerca y entre tus contactos' : 'Lo que pasa cerca tuyo'}
      active="feed"
    >
      {!position && !asked && (
        <div className={styles.locationPrompt}>
          <span>Compartí tu ubicación para ver lo que hay cerca.</span>
          <button type="button" className={styles.locationButton} onClick={askForPosition}>
            Activar
          </button>
        </div>
      )}

      {items.length === 0 ? (
        <EmptyState
          title={user ? 'Todavía no hay novedades' : 'Nada por acá todavía'}
          body={
            user
              ? 'Seguí a gente cerca tuyo y guardá lo que te interesa: las novedades aparecen acá.'
              : 'Entrá para ver lo que publican tus amigos y la gente que seguís.'
          }
          actions={
            user ? (
              <Link href="/search" className={appScreenStyles.primary}>
                Buscar gente
              </Link>
            ) : (
              <Link href="/login?next=%2Ffeed" className={appScreenStyles.primary}>
                Entrar
              </Link>
            )
          }
        />
      ) : (
        <ul className={styles.list}>
          {items.map((item) => (
            <li key={item.id}>
              <FeedRow item={item} />
            </li>
          ))}
        </ul>
      )}
    </AppScreen>
  );
}

function FeedRow({ item }: { item: FeedItem }) {
  const badge = BADGES[item.type];

  // A store promotion has no listing behind it: the store is the subject, and
  // the row leads to the store rather than to a product.
  const href = item.listing
    ? `/listing/${item.listing.id}`
    : item.store
      ? `/store/${item.store.handle}`
      : '/';

  return (
    <Link href={href} className={styles.row}>
      <div className={styles.reason}>
        {item.actor?.avatarUrl ? (
          <img className={styles.avatar} src={item.actor.avatarUrl} alt="" />
        ) : (
          <span className={styles.avatar} aria-hidden="true">
            {(item.actor?.displayName ?? item.store?.name ?? '·').slice(0, 1).toUpperCase()}
          </span>
        )}
        <span className={styles.headline}>{item.headline}</span>
        <span className={styles.when}>{formatRelativeTime(item.createdAt)}</span>
      </div>

      {badge && <span className={`${styles.badge} ${styles[badge.className]}`}>{badge.label}</span>}

      {item.listing ? (
        <div className={styles.item}>
          {item.listing.coverImage ? (
            <img className={styles.thumb} src={item.listing.coverImage.url} alt="" />
          ) : (
            <span className={`${styles.thumb} ${styles.thumbPlaceholder}`} aria-hidden="true">
              {item.listing.kind === 'wanted' ? 'Busco' : 'Sin foto'}
            </span>
          )}

          <div className={styles.itemBody}>
            <p className={styles.title}>{item.listing.title}</p>

            {item.listing.price ? (
              <div className={styles.price}>
                <Price price={item.listing.price} size="sm" />
              </div>
            ) : item.listing.maxBudget ? (
              <p className={styles.budget}>
                Hasta{' '}
                {formatMoney(money(item.listing.maxBudget.amount, item.listing.maxBudget.currency))}
              </p>
            ) : null}

            {item.listing.distanceMeters !== undefined && (
              <p className={styles.meta}>a {formatDistance(item.listing.distanceMeters)}</p>
            )}
          </div>
        </div>
      ) : item.store ? (
        <div className={styles.storeRow}>
          {item.store.logoUrl ? (
            <img className={styles.storeLogo} src={item.store.logoUrl} alt="" />
          ) : (
            <span className={styles.storeLogo} aria-hidden="true" />
          )}
          <span className={styles.storeName}>{item.store.name}</span>
        </div>
      ) : null}
    </Link>
  );
}
