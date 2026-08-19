'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { ListingSummary } from '@cerquita/types';
import { AppScreen, EmptyState, appScreenStyles } from '@/components/AppScreen';
import { ListingCard } from '@/components/ListingCard';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import styles from './page.module.css';

/**
 * Saved listings.
 *
 * Prices are re-resolved on every load rather than cached with the favourite:
 * the whole reason to save something here is to watch what happens to its price,
 * and a stale number would defeat that.
 */
export default function FavoritesPage() {
  const { user, loading } = useSession();
  const [items, setItems] = useState<ListingSummary[] | null>(null);

  useEffect(() => {
    if (!user) {
      setItems(null);
      return;
    }

    let cancelled = false;
    api.favorites
      .list()
      .then((page) => {
        if (!cancelled) setItems(page.items);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      });

    return () => {
      cancelled = true;
    };
  }, [user]);

  if (loading) {
    return (
      <AppScreen title="Guardados" active="profile">
        <p className={styles.state}>Cargando…</p>
      </AppScreen>
    );
  }

  if (!user) {
    return (
      <AppScreen title="Guardados" active="profile">
        <EmptyState
          title="Iniciá sesión"
          body="Guardá lo que te interesa y enterate cuando baje de precio."
          actions={
            <Link href="/login?next=%2Ffavorites" className={appScreenStyles.primary}>
              Entrar
            </Link>
          }
        />
      </AppScreen>
    );
  }

  if (items === null) {
    return (
      <AppScreen title="Guardados" active="profile">
        <p className={styles.state}>Cargando…</p>
      </AppScreen>
    );
  }

  if (items.length === 0) {
    return (
      <AppScreen title="Guardados" active="profile">
        <EmptyState
          title="Todavía no guardaste nada"
          body="Tocá el corazón en cualquier publicación y va a aparecer acá."
          actions={
            <Link href="/" className={appScreenStyles.primary}>
              Explorar el mapa
            </Link>
          }
        />
      </AppScreen>
    );
  }

  return (
    <AppScreen
      title="Guardados"
      subtitle={`${items.length} guardado${items.length === 1 ? '' : 's'}`}
      active="profile"
    >
      <div className={styles.grid}>
        {items.map((listing) => (
          <ListingCard key={listing.id} listing={listing} />
        ))}
      </div>
    </AppScreen>
  );
}
