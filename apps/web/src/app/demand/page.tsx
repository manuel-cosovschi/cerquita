'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { ListingSummary } from '@cerquita/types';
import type { LocalDemand } from '@cerquita/api-client';
import { AppScreen, appScreenStyles } from '@/components/AppScreen';
import { ListingCard } from '@/components/ListingCard';
import { api } from '@/lib/api';
import styles from './page.module.css';

/** Shared with the feed, so a position granted once is not asked for twice. */
const POSITION_KEY = 'cerquita.position';

/**
 * What people around here are asking for (spec §51).
 *
 * Read at the moment somebody is deciding what to list, which is why it is
 * linked from the publish chooser and why the ordering is by how UNMET a
 * category is rather than by raw popularity: "12 people want bikes" is
 * interesting, "12 want bikes and nobody is selling one" is actionable.
 *
 * The aggregate is only half of it. Below the counts are the actual nearby
 * wanted posts, because a pattern takes a while to form and a single "busco una
 * heladera" two blocks away is already something you can act on today.
 */
export default function DemandPage() {
  const [position, setPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [asked, setAsked] = useState(false);
  const [demand, setDemand] = useState<LocalDemand | null>(null);
  const [wanted, setWanted] = useState<ListingSummary[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(POSITION_KEY);
      if (stored) setPosition(JSON.parse(stored) as { lat: number; lng: number });
    } catch {
      // Blocked storage just means we ask.
    }
  }, []);

  const load = useCallback(async (where: { lat: number; lng: number }) => {
    setLoading(true);
    // Independent: the counts and the posts are useful separately.
    const [aggregate, posts] = await Promise.allSettled([
      api.demand.near({ lat: where.lat, lng: where.lng, radius: 10_000 }),
      api.search.query({ kind: 'wanted', center: where, sort: 'distance', limit: 12 }),
    ]);

    if (aggregate.status === 'fulfilled') setDemand(aggregate.value);
    if (posts.status === 'fulfilled') setWanted(posts.value.items);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!position) return;
    void load(position);
  }, [load, position]);

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
          // Not remembering it is not a failure worth showing.
        }
      },
      () => {
        // Declining is a valid answer; the screen says what it needs and stops.
      },
    );
  }

  return (
    <AppScreen
      title="Qué se busca"
      subtitle="Lo que la gente de tu zona está pidiendo"
      active="map"
    >
      {!position && (
        <>
          <div className={styles.prompt}>
            <span>Necesitamos tu ubicación para saber qué se busca cerca.</span>
            <button type="button" className={styles.promptButton} onClick={askForPosition}>
              Activar
            </button>
          </div>
          {asked && (
            <p className={styles.state}>
              Sin ubicación no podemos decirte qué se busca por acá. Podés activarla cuando quieras.
            </p>
          )}
        </>
      )}

      {position && loading && <p className={styles.state}>Mirando la zona…</p>}

      {position && !loading && demand && (
        <>
          <p className={styles.summary}>
            {demand.wantedTotal === 0
              ? 'Nadie publicó que busca algo por acá en el último mes.'
              : `${demand.wantedTotal} ${demand.wantedTotal === 1 ? 'persona publicó' : 'personas publicaron'} que buscan algo a menos de ${Math.round(demand.radiusMeters / 1000)} km, en los últimos 30 días.`}
          </p>

          {demand.categories.length > 0 && (
            <section className={styles.section} aria-label="Categorías">
              <h2 className={styles.sectionTitle}>Dónde falta oferta</h2>
              <ul className={styles.list}>
                {[...demand.categories]
                  // Most unmet first: no supply at all outranks a high ratio.
                  .sort((a, b) => unmetScore(b) - unmetScore(a))
                  .map((category) => (
                    <li key={category.categoryId} className={styles.row}>
                      <div className={styles.rowHead}>
                        <p className={styles.name}>{category.name}</p>
                        <span
                          className={`${styles.verdict} ${
                            unmetScore(category) >= 1 ? styles.verdictHot : styles.verdictBalanced
                          }`}
                        >
                          {verdict(category)}
                        </span>
                      </div>

                      <p className={styles.counts}>
                        {category.wantedCount} {category.wantedCount === 1 ? 'busca' : 'buscan'} ·{' '}
                        {category.supplyCount}{' '}
                        {category.supplyCount === 1 ? 'publicación' : 'publicaciones'} en venta
                      </p>

                      <div
                        className={styles.bar}
                        role="img"
                        aria-label={`${category.wantedCount} buscan, ${category.supplyCount} en venta`}
                      >
                        <span
                          className={styles.barWanted}
                          style={{ flexGrow: category.wantedCount }}
                        />
                        <span
                          className={styles.barSupply}
                          style={{ flexGrow: category.supplyCount }}
                        />
                      </div>
                    </li>
                  ))}
              </ul>
            </section>
          )}

          {demand.terms.length > 0 && (
            <section className={styles.section} aria-label="Palabras repetidas">
              <h2 className={styles.sectionTitle}>Lo que más se nombra</h2>
              <div className={styles.terms}>
                {demand.terms.map((entry) => (
                  <Link
                    key={entry.term}
                    href={`/search?q=${encodeURIComponent(entry.term)}`}
                    className={styles.term}
                  >
                    {entry.term}
                    <span className={styles.termCount}>{entry.count}</span>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {demand.categories.length === 0 && demand.terms.length === 0 && demand.wantedTotal > 0 && (
            <p className={styles.state}>
              Todavía no hay un patrón: cada persona busca algo distinto. Abajo están los pedidos
              tal cual los publicaron.
            </p>
          )}

          {wanted.length > 0 && (
            <section className={styles.section} aria-label="Pedidos cerca">
              <h2 className={styles.sectionTitle}>Pedidos cerca tuyo</h2>
              <ul className={styles.list}>
                {wanted.map((listing) => (
                  <li key={listing.id}>
                    <ListingCard listing={listing} />
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className={styles.actions}>
            <Link href="/sell/new?kind=sale" className={appScreenStyles.primary}>
              Publicar algo
            </Link>
            <Link href="/" className={appScreenStyles.secondary}>
              Volver al mapa
            </Link>
          </div>
        </>
      )}
    </AppScreen>
  );
}

/**
 * How unmet a category is.
 *
 * No supply at all is the strongest signal there is, so it scores above any
 * finite ratio rather than being dropped for dividing by zero.
 */
function unmetScore(category: LocalDemand['categories'][number]): number {
  return category.ratio === null ? Number.MAX_SAFE_INTEGER : category.ratio;
}

function verdict(category: LocalDemand['categories'][number]): string {
  if (category.ratio === null) return 'Nadie vende';
  if (category.ratio >= 2) return 'Falta oferta';
  if (category.ratio >= 1) return 'Parejo';
  return 'Bien cubierto';
}
