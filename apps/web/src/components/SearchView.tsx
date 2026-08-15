'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { ListingSummary } from '@cerquita/types';
import type { PersonResult, SocialHint, StoreResult } from '@cerquita/api-client';
import { api } from '@/lib/api';
import { AppScreen, EmptyState, appScreenStyles } from './AppScreen';
import { ListingCard } from './ListingCard';
import styles from './SearchView.module.css';

type Tab = 'things' | 'people' | 'stores' | 'wanted';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'things', label: 'Cosas' },
  { id: 'people', label: 'Gente' },
  { id: 'stores', label: 'Tiendas' },
  { id: 'wanted', label: 'Buscan' },
];

/**
 * Search, direction 1c: things are one tab among four.
 *
 * "buscás personas igual que objetos" is the actual product argument — in a
 * hyperlocal marketplace you frequently remember who had the thing rather than
 * the listing itself. Splitting the tabs also lets each one paginate on its own
 * rather than interleaving four result shapes into one ranked list.
 */
export function SearchView() {
  /*
   * `?q=` runs the search on arrival, so anything in the app can link straight
   * to results: the demand screen's repeated terms, a category, a shared link.
   * Read once as the initial value rather than watched — after that the input
   * is the source of truth, and re-syncing would fight the person typing.
   */
  const initialQuery = useSearchParams().get('q')?.trim() ?? '';
  const [query, setQuery] = useState(initialQuery);
  const [submitted, setSubmitted] = useState(initialQuery);
  const [tab, setTab] = useState<Tab>('things');

  const [things, setThings] = useState<ListingSummary[]>([]);
  const [people, setPeople] = useState<PersonResult[]>([]);
  const [stores, setStores] = useState<StoreResult[]>([]);
  const [hint, setHint] = useState<SocialHint | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');

  const run = useCallback(async (text: string, activeTab: Tab) => {
    if (!text) return;
    setStatus('loading');

    try {
      // The social hint is fetched alongside every tab: it is the one result
      // that is useful regardless of which tab you are on. It must never fail
      // the search, so it degrades to null.
      const hintPromise = api.search.socialHint(text).catch(() => null);

      if (activeTab === 'people') {
        setPeople(await api.search.people(text));
      } else if (activeTab === 'stores') {
        setStores(await api.search.stores(text));
      } else {
        const result = await api.search.query({
          q: text,
          kind: activeTab === 'wanted' ? 'wanted' : 'sale',
          sort: 'relevance',
          limit: 24,
        });
        setThings(result.items);
      }

      setHint(await hintPromise);
      setStatus('idle');
    } catch {
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    void run(submitted, tab);
  }, [submitted, tab, run]);

  return (
    <AppScreen title="Buscar" active="map">
      <form
        className={styles.form}
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          setSubmitted(query.trim());
        }}
      >
        <label htmlFor="q" className="sr-only">
          Buscar cosas, gente o tiendas
        </label>
        <input
          id="q"
          className={styles.input}
          type="search"
          placeholder="¿Qué estás buscando?"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          autoComplete="off"
        />
      </form>

      <div className={styles.tabs} role="tablist" aria-label="Tipo de resultado">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={tab === entry.id}
            className={`${styles.tab} ${tab === entry.id ? styles.tabActive : ''}`}
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {/* The graph turned into a result, not decoration. */}
      {hint && submitted && (
        <p className={styles.hint}>
          <strong>{hint.label}</strong>
        </p>
      )}

      {!submitted && (
        <EmptyState
          title="Buscá lo que necesitás"
          body="Podés buscar cosas, y también personas y tiendas cerca tuyo."
        />
      )}

      {submitted && status === 'error' && (
        <EmptyState
          title="No pudimos buscar"
          body="Revisá tu conexión y probá de nuevo."
          actions={
            <button
              type="button"
              className={appScreenStyles.primary}
              onClick={() => void run(submitted, tab)}
            >
              Reintentar
            </button>
          }
        />
      )}

      {submitted && status !== 'error' && (
        <Results
          tab={tab}
          things={things}
          people={people}
          stores={stores}
          loading={status === 'loading'}
          query={submitted}
        />
      )}
    </AppScreen>
  );
}

function Results({
  tab,
  things,
  people,
  stores,
  loading,
  query,
}: {
  tab: Tab;
  things: ListingSummary[];
  people: PersonResult[];
  stores: StoreResult[];
  loading: boolean;
  query: string;
}) {
  if (loading) {
    return (
      <ul className={styles.list} aria-hidden="true">
        {Array.from({ length: 4 }, (_, index) => (
          <li key={index}>
            <div className={styles.skeleton} />
          </li>
        ))}
      </ul>
    );
  }

  if (tab === 'people') {
    if (people.length === 0) {
      return <EmptyState title={`Nadie coincide con "${query}"`} body="Probá con otro nombre." />;
    }
    return (
      <ul className={styles.list}>
        {people.map((person) => (
          <li key={person.id}>
            <Link href={`/user/${person.username}`} className={styles.row}>
              <span className={styles.avatar} aria-hidden="true">
                {person.displayName.slice(0, 1)}
              </span>
              <span className={styles.rowBody}>
                <span className={styles.rowTitle}>{person.displayName}</span>
                {/* The reason to trust them comes before the metrics. */}
                {person.socialProof && <span className={styles.proof}>{person.socialProof}</span>}
                <span className={styles.rowMeta}>
                  {person.area ? `${person.area} · ` : ''}
                  {person.salesCount} venta{person.salesCount === 1 ? '' : 's'}
                  {person.rating !== undefined
                    ? ` · ${person.rating.toFixed(1)} ★ (${person.reviewCount})`
                    : ''}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    );
  }

  if (tab === 'stores') {
    if (stores.length === 0) {
      return <EmptyState title={`No hay tiendas para "${query}"`} body="Probá con otro nombre." />;
    }
    return (
      <ul className={styles.list}>
        {stores.map((store) => (
          <li key={store.id}>
            <Link href={`/store/${store.handle}`} className={styles.row}>
              <span className={`${styles.avatar} ${styles.avatarStore}`} aria-hidden="true">
                {store.name.slice(0, 1)}
              </span>
              <span className={styles.rowBody}>
                <span className={styles.rowTitle}>{store.name}</span>
                <span className={styles.rowMeta}>
                  {store.activeListingCount} producto
                  {store.activeListingCount === 1 ? '' : 's'}
                  {store.address ? ` · ${store.address}` : ''}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    );
  }

  if (things.length === 0) {
    return (
      <EmptyState
        title={`No encontramos "${query}"`}
        body={
          tab === 'wanted'
            ? 'Nadie está buscando eso por acá todavía.'
            : 'Probá ampliar el radio o publicá que lo buscás.'
        }
        actions={
          <Link href="/wanted/new" className={appScreenStyles.primary}>
            Publicar que busco
          </Link>
        }
      />
    );
  }

  return (
    <ul className={styles.list}>
      {things.map((listing) => (
        <li key={listing.id}>
          <ListingCard listing={listing} />
        </li>
      ))}
    </ul>
  );
}
