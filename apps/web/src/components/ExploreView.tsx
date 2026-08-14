'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ListingSummary, MapLayer, MapMarker } from '@cerquita/types';
import { serializeBoundingBox, type BoundingBox, type Coordinates } from '@cerquita/utils';
import { viewportBounds } from '@/lib/projection';
import { api } from '@/lib/api';
import { MapSurface } from './MapSurface';
import { LayerChips } from './LayerChips';
import { ResultsPanel } from './ResultsPanel';
import styles from './ExploreView.module.css';

/** Obelisco. Used until the browser grants a location (spec §102: ask in context). */
const FALLBACK_CENTER: Coordinates = { lat: -34.6037, lng: -58.3816 };
const DEFAULT_ZOOM = 14;

interface ViewportState {
  center: Coordinates;
  zoom: number;
  width: number;
  height: number;
}

/**
 * The desktop home: results on the left, map on the right (spec §60).
 *
 * Not a widened mobile layout. The two panes are a single synchronized view:
 * hovering either side highlights the other, selecting a marker scrolls its card
 * into view, and moving the map arms "Buscar en esta zona" instead of silently
 * refetching — the user decides when the results change under them (spec §10).
 */
export function ExploreView() {
  const [viewport, setViewport] = useState<ViewportState>({
    center: FALLBACK_CENTER,
    zoom: DEFAULT_ZOOM,
    width: 0,
    height: 0,
  });
  /** The viewport the current results belong to. Drives the "search here" prompt. */
  const [searchedBounds, setSearchedBounds] = useState<BoundingBox | null>(null);
  const [pendingBounds, setPendingBounds] = useState<BoundingBox | null>(null);

  const [layer, setLayer] = useState<MapLayer>('all');
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');

  const [markers, setMarkers] = useState<MapMarker[]>([]);
  const [clustered, setClustered] = useState(false);
  const [results, setResults] = useState<ListingSummary[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [hoveredId, setHoveredId] = useState<string | undefined>();
  const [selectedId, setSelectedId] = useState<string | undefined>();

  const requestId = useRef(0);

  const load = useCallback(
    async (bounds: BoundingBox, current: ViewportState, activeLayer: MapLayer, text: string) => {
      const id = ++requestId.current;
      setStatus('loading');
      setErrorMessage(null);

      try {
        const bbox = serializeBoundingBox(bounds);

        // Markers and result cards come from different endpoints on purpose: the
        // map wants a bounded, possibly clustered set; the list wants ranked,
        // paginated detail. One request each, never one per marker.
        const [mapResponse, searchResponse] = await Promise.all([
          api.map.query({
            bbox,
            zoom: Math.round(current.zoom),
            layer: activeLayer,
            q: text || undefined,
          }),
          api.search.query({
            q: text || undefined,
            bbox,
            kind: layerToKind(activeLayer),
            center: current.center,
            sort: text ? 'relevance' : 'distance',
            limit: 24,
          }),
        ]);

        // A slower earlier request must not overwrite a newer one's results.
        if (id !== requestId.current) return;

        setMarkers(mapResponse.markers);
        setClustered(mapResponse.clustered);
        setResults(searchResponse.items);
        setSearchedBounds(bounds);
        setPendingBounds(null);
        setStatus('idle');
      } catch (error) {
        if (id !== requestId.current) return;
        setStatus('error');
        setErrorMessage(
          error instanceof Error ? error.message : 'No pudimos cargar las publicaciones',
        );
      }
    },
    [],
  );

  /** First load, once the map has measured itself. */
  useEffect(() => {
    if (viewport.width === 0 || searchedBounds) return;
    const bounds = boundsOf(viewport);
    if (bounds) void load(bounds, viewport, layer, submittedQuery);
  }, [viewport, searchedBounds, layer, submittedQuery, load]);

  /** Layer and query changes refetch immediately — the user asked for them. */
  useEffect(() => {
    if (viewport.width === 0) return;
    const bounds = boundsOf(viewport);
    if (bounds) void load(bounds, viewport, layer, submittedQuery);
    // Panning is handled separately, so viewport is deliberately not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layer, submittedQuery]);

  const handleViewportChange = useCallback((next: ViewportState) => {
    setViewport(next);
    const bounds = boundsOf(next);
    // Arm the prompt rather than refetching: results shifting mid-pan is
    // disorienting, and every pan would be a wasted query.
    if (bounds) setPendingBounds(bounds);
  }, []);

  const searchThisArea = () => {
    if (!pendingBounds) return;
    void load(pendingBounds, viewport, layer, submittedQuery);
  };

  const handleMarkerClick = (marker: MapMarker) => {
    if (marker.type === 'listing') setSelectedId(marker.id);
  };

  const visibleResults = useMemo(() => results, [results]);

  return (
    <div className={styles.layout}>
      <header className={styles.header}>
        <a href="/" className={styles.logo}>
          Cerquita
        </a>

        <form
          className={styles.searchForm}
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            setSubmittedQuery(query.trim());
          }}
        >
          <label htmlFor="q" className="sr-only">
            Buscar productos cerca tuyo
          </label>
          <input
            id="q"
            className={styles.searchInput}
            type="search"
            placeholder="¿Qué estás buscando?"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            autoComplete="off"
          />
          <button type="submit" className={styles.searchButton}>
            Buscar
          </button>
        </form>

        <nav className={styles.actions} aria-label="Acciones">
          <a href="/sell" className={styles.publishButton}>
            Publicar
          </a>
        </nav>
      </header>

      <main id="contenido" className={styles.body}>
        <ResultsPanel
          results={visibleResults}
          status={status}
          errorMessage={errorMessage}
          query={submittedQuery}
          clustered={clustered}
          hoveredId={hoveredId}
          selectedId={selectedId}
          onHover={setHoveredId}
          onSelect={setSelectedId}
          onRetry={() => {
            const bounds = searchedBounds ?? boundsOf(viewport);
            if (bounds) void load(bounds, viewport, layer, submittedQuery);
          }}
          onWidenSearch={() =>
            handleViewportChange({ ...viewport, zoom: Math.max(3, viewport.zoom - 2) })
          }
        />

        <section className={styles.mapPane} aria-label="Mapa">
          <div className={styles.mapOverlay}>
            <LayerChips value={layer} onChange={setLayer} />
          </div>

          {pendingBounds && (
            <div className={styles.searchHere}>
              <button type="button" onClick={searchThisArea} className={styles.searchHereButton}>
                Buscar en esta zona
              </button>
            </div>
          )}

          <MapSurface
            center={viewport.center}
            zoom={viewport.zoom}
            markers={markers}
            loading={status === 'loading'}
            hoveredId={hoveredId}
            selectedId={selectedId}
            onViewportChange={handleViewportChange}
            onMarkerClick={handleMarkerClick}
            onMarkerHover={setHoveredId}
            tileUrlTemplate={process.env.NEXT_PUBLIC_MAP_TILE_URL}
          />
        </section>
      </main>
    </div>
  );
}

/** The map has to have measured itself before its bounds mean anything. */
function boundsOf(viewport: ViewportState): BoundingBox | null {
  if (viewport.width === 0 || viewport.height === 0) return null;
  return viewportBounds(viewport);
}

function layerToKind(layer: MapLayer): 'sale' | 'wanted' | 'auction' | undefined {
  switch (layer) {
    case 'sales':
      return 'sale';
    case 'wanted':
      return 'wanted';
    case 'auctions':
      return 'auction';
    default:
      return undefined;
  }
}
