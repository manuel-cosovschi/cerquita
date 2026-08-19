'use client';

import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import type { ListingSummary, OpeningHours, Store } from '@cerquita/types';
import { ApiError } from '@cerquita/api-client';
import { AppScreen } from '@/components/AppScreen';
import { ListingCard } from '@/components/ListingCard';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import styles from './page.module.css';
import { Stat } from '@/components/Stat';

const WEEKDAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

/**
 * A storefront.
 *
 * Same shape as a person's profile on purpose — identity, actions, numbers,
 * then what they have — so a buyer moving between the two never has to relearn
 * the screen. What differs is what a business is asked: whether it is open now,
 * and where it actually is.
 *
 * Stores have no friends and no friend pricing (spec §30): a business offers
 * promotions, not relationships. That is why there is no "add as friend" here.
 */
export default function StorePage() {
  const params = useParams<{ handle: string }>();
  const handle = params.handle;
  const { user } = useSession();

  const [store, setStore] = useState<Store | null>(null);
  const [listings, setListings] = useState<ListingSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const found = await api.stores.get(handle);
      setStore(found);
      const page = await api.stores.listings(found.id);
      setListings(page.items);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'No pudimos cargar esta tienda.');
    }
  }, [handle]);

  // Re-runs per viewer: following state and resolved prices both depend on it.
  useEffect(() => {
    void load();
  }, [load, user?.userId]);

  if (error) {
    return (
      <AppScreen title="Tienda" active="map">
        <p className={styles.state}>{error}</p>
      </AppScreen>
    );
  }

  if (!store) {
    return (
      <AppScreen title="Tienda" active="map">
        <p className={styles.state}>Cargando…</p>
      </AppScreen>
    );
  }

  async function toggleFollow() {
    if (!store) return;
    if (!user) {
      window.location.assign(`/login?next=${encodeURIComponent(`/store/${handle}`)}`);
      return;
    }

    setBusy(true);
    try {
      // Two endpoints, not a toggle: following used to be a one-way door
      // because only the POST existed, so this button did nothing once it read
      // "Siguiendo". The truth still comes back from a reload rather than from
      // flipping a boolean here.
      if (store.isFollowedByViewer) await api.stores.unfollow(store.id);
      else await api.stores.follow(store.id);
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'No pudimos completar la acción.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppScreen title={store.name} active="map">
      {store.coverUrl && <img className={styles.cover} src={store.coverUrl} alt="" />}

      <div className={styles.header}>
        {store.logoUrl ? (
          <img className={styles.logo} src={store.logoUrl} alt="" />
        ) : (
          <span className={styles.logo} aria-hidden="true">
            {store.name.slice(0, 1).toUpperCase()}
          </span>
        )}

        <div className={styles.identity}>
          <h2 className={styles.name}>
            {store.name}
            {store.verified && (
              <>
                {' '}
                <span title="Tienda verificada">✓</span>
                <span className="sr-only">Verificada</span>
              </>
            )}
          </h2>
          <p className={styles.handle}>@{store.handle}</p>

          {/* The single most useful fact about a shop, when it is known. */}
          {store.isOpenNow !== undefined && (
            <span className={store.isOpenNow ? styles.openNow : styles.closedNow}>
              {store.isOpenNow ? 'Abierto ahora' : 'Cerrado ahora'}
            </span>
          )}

          {store.description && <p className={styles.description}>{store.description}</p>}
          {store.address && <p className={styles.address}>{store.address}</p>}
        </div>
      </div>

      <div className={styles.actions}>
        <button
          type="button"
          className={`${styles.action} ${
            store.isFollowedByViewer ? styles.actionDone : styles.actionPrimary
          }`}
          onClick={() => void toggleFollow()}
          disabled={busy}
        >
          {store.isFollowedByViewer ? 'Siguiendo' : 'Seguir'}
        </button>
      </div>

      <div className={styles.stats}>
        <Stat value={store.followerCount} label="Seguidores" one="Seguidor" />
        <Stat value={store.activeListingCount} label="Publicaciones" one="Publicación" />
        <Stat
          value={store.rating !== undefined ? Number(store.rating.toFixed(1)) : 0}
          label="Reputación"
        />
      </div>

      {store.openingHours && store.openingHours.length > 0 && (
        <section className={styles.hours} aria-label="Horarios">
          <h3 className={styles.hoursTitle}>Horarios</h3>
          <ul className={styles.hoursList}>
            {store.openingHours.map((entry) => (
              <li key={`${entry.weekday}-${entry.opensAt}`} className={styles.hoursRow}>
                <span>{WEEKDAYS[entry.weekday]}</span>
                <span>
                  {formatMinutes(entry.opensAt)} – {formatMinutes(entry.closesAt)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {listings === null ? (
        <p className={styles.state}>Cargando…</p>
      ) : listings.length === 0 ? (
        <p className={styles.state}>Esta tienda todavía no publicó nada.</p>
      ) : (
        <div className={styles.grid}>
          {listings.map((listing) => (
            <ListingCard key={listing.id} listing={listing} />
          ))}
        </div>
      )}
    </AppScreen>
  );
}

/** Opening hours are stored as minutes from midnight, store-local. */
function formatMinutes(minutes: OpeningHours['opensAt']): string {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}
