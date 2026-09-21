'use client';

import { useEffect, useRef } from 'react';
import type { ListingSummary } from '@cerquita/types';
import { ListingCard } from './ListingCard';
import styles from './ResultsPanel.module.css';

export interface ResultsPanelProps {
  results: ListingSummary[];
  status: 'idle' | 'loading' | 'error';
  errorMessage: string | null;
  query: string;
  clustered: boolean;
  hoveredId?: string;
  selectedId?: string;
  onHover: (id: string | undefined) => void;
  onSelect: (id: string) => void;
  onRetry: () => void;
  onWidenSearch: () => void;
}

/**
 * The results column.
 *
 * Every state the spec asks for is handled (§67): loading skeletons, empty with
 * a way forward, error with a retry. Selecting a marker scrolls the matching
 * card into view, which is the other half of the map↔list sync (§61).
 */
export function ResultsPanel({
  results,
  status,
  errorMessage,
  query,
  clustered,
  hoveredId,
  selectedId,
  onHover,
  onSelect,
  onRetry,
  onWidenSearch,
}: ResultsPanelProps) {
  const listRef = useRef<HTMLUListElement>(null);

  // Keep the selected card visible when the selection came from the map.
  useEffect(() => {
    if (!selectedId || !listRef.current) return;
    const node = listRef.current.querySelector(`[data-listing-id="${selectedId}"]`);
    node?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedId]);

  return (
    <aside className={styles.panel} aria-label="Resultados">
      <div className={styles.summary} aria-live="polite">
        {status === 'loading' ? (
          <span>Buscando…</span>
        ) : status === 'error' ? (
          <span>No pudimos cargar los resultados</span>
        ) : (
          <span>
            <strong>{results.length}</strong>{' '}
            {results.length === 1 ? 'publicación' : 'publicaciones'}
            {query && (
              <>
                {' '}
                para <strong>{query}</strong>
              </>
            )}
          </span>
        )}

        {clustered && status === 'idle' && (
          <p className={styles.hint}>
            Hay muchas publicaciones en esta zona. Acercá el mapa para verlas una por una.
          </p>
        )}
      </div>

      {status === 'error' && (
        <div className={styles.state} role="alert">
          <p className={styles.stateTitle}>Algo salió mal</p>
          <p className={styles.stateBody}>{errorMessage}</p>
          <button type="button" className={styles.primaryAction} onClick={onRetry}>
            Reintentar
          </button>
        </div>
      )}

      {status === 'loading' && results.length === 0 && (
        <ul className={styles.list} aria-hidden="true">
          {Array.from({ length: 5 }, (_, index) => (
            <li key={index}>
              <div className={styles.skeleton} />
            </li>
          ))}
        </ul>
      )}

      {status === 'idle' && results.length === 0 && (
        // An empty state that only says "nothing here" is a dead end; each of
        // these gives the user a way to keep going (spec §103).
        <div className={styles.state}>
          <p className={styles.stateTitle}>
            {query ? `No encontramos "${query}" por acá` : 'No hay publicaciones en esta zona'}
          </p>
          <p className={styles.stateBody}>Probá ampliar el radio o crear un aviso.</p>
          <div className={styles.stateActions}>
            <button type="button" className={styles.primaryAction} onClick={onWidenSearch}>
              Ampliar radio
            </button>
            <a href="/wanted/new" className={styles.secondaryAction}>
              Publicar que busco
            </a>
            <a href="/alerts/new" className={styles.secondaryAction}>
              Crear alerta
            </a>
          </div>
        </div>
      )}

      {results.length > 0 && (
        <ul className={styles.list} ref={listRef}>
          {results.map((listing) => (
            <li key={listing.id} data-listing-id={listing.id}>
              <ListingCard
                listing={listing}
                hovered={hoveredId === listing.id}
                selected={selectedId === listing.id}
                onHover={onHover}
                onSelect={onSelect}
              />
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
