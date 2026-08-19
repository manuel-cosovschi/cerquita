import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  LayoutChangeEvent,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { MapMarker } from '@cerquita/types';
import {
  boundsCenter,
  formatMoneyCompact,
  fromScreen,
  metersPerPixel,
  money,
  serializeBoundingBox,
  toScreen,
  viewportBounds,
  zoomForBounds,
  type Coordinates,
  type Viewport,
} from '@cerquita/utils';
import { api } from '@/lib/api';
import { theme } from '@/lib/theme';

/**
 * The map, on a phone (spec §9, §61).
 *
 * The same Web Mercator projection the web surface uses, from the same module:
 * markers are positioned by real projection rather than a linear stretch, so
 * panning is geographically correct and the two platforms cannot disagree about
 * where something is.
 *
 * No tile layer, exactly like the web: the app is fully usable without a tile
 * provider or an API key, and dropping one in later is a rendering change that
 * moves no marker.
 *
 * Gestures are pan-to-drag with buttons for zoom. Pinch is deliberately left
 * out rather than half-implemented — the two-finger maths belongs to a gesture
 * library this app does not otherwise need, and buttons work for everyone,
 * including somebody holding a coffee.
 */

/** Buenos Aires. Only until the phone or the person says otherwise. */
const FALLBACK_CENTER: Coordinates = { lat: -34.6037, lng: -58.3816 };

const MIN_ZOOM = 3;
const MAX_ZOOM = 19;

export default function MapScreen() {
  const router = useRouter();

  const [size, setSize] = useState({ width: 0, height: 0 });
  const [center, setCenter] = useState<Coordinates>(FALLBACK_CENTER);
  const [zoom, setZoom] = useState(14);
  const [markers, setMarkers] = useState<MapMarker[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<MapMarker | null>(null);

  /*
   * The drag offset lives in state so the markers move with the finger, but the
   * viewport it is relative to lives in a ref: the pan responder is created
   * once and would otherwise close over the first centre forever.
   */
  const [drag, setDrag] = useState({ x: 0, y: 0 });
  const viewportRef = useRef<Viewport>({ center, zoom, width: 0, height: 0 });

  viewportRef.current = { center, zoom, width: size.width, height: size.height };

  const load = useCallback(async (viewport: Viewport) => {
    if (viewport.width === 0 || viewport.height === 0) return;

    setError(null);
    try {
      const response = await api.map.query({
        bbox: serializeBoundingBox(viewportBounds(viewport)),
        zoom: Math.round(viewport.zoom),
        viewerLat: viewport.center.lat,
        viewerLng: viewport.center.lng,
      });
      setMarkers(response.markers);
    } catch {
      setError('No pudimos cargar el mapa.');
    } finally {
      setLoading(false);
    }
  }, []);

  // Ask once. Declining is a real answer: the map simply opens over the city.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted' || cancelled) return;

      const position = await Location.getCurrentPositionAsync({});
      if (cancelled) return;

      setCenter({ lat: position.coords.latitude, lng: position.coords.longitude });
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  /*
   * Loads on arrival and after every settled move.
   *
   * The web map had exactly this bug: it measured itself but only reported
   * upward when dragged, so the home screen rendered, hydrated, and made no
   * requests at all. Depending on the viewport rather than on a gesture is what
   * prevents it.
   */
  useEffect(() => {
    void load({ center, zoom, width: size.width, height: size.height });
  }, [load, center, zoom, size.width, size.height]);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) =>
          Math.abs(gesture.dx) > 4 || Math.abs(gesture.dy) > 4,

        onPanResponderMove: (_event, gesture) => setDrag({ x: gesture.dx, y: gesture.dy }),

        onPanResponderRelease: (_event, gesture) => {
          const viewport = viewportRef.current;
          if (viewport.width === 0) return;

          // Where the centre of the screen ended up, in coordinates: dragging
          // right moves the map right, so the centre moves left.
          const moved = fromScreen(
            { x: viewport.width / 2 - gesture.dx, y: viewport.height / 2 - gesture.dy },
            viewport,
          );

          setDrag({ x: 0, y: 0 });
          setCenter(moved);
        },

        onPanResponderTerminate: () => setDrag({ x: 0, y: 0 }),
      }),
    [],
  );

  const viewport: Viewport = { center, zoom, width: size.width, height: size.height };
  const scale = Math.round(metersPerPixel(center.lat, zoom) * 60);

  return (
    <View style={styles.screen}>
      <View
        style={styles.surface}
        onLayout={(event: LayoutChangeEvent) => {
          const { width, height } = event.nativeEvent.layout;
          setSize({ width, height });
        }}
        {...pan.panHandlers}
      >
        {size.width > 0 &&
          markers.map((marker) => {
            const at = toScreen(marker.point, viewport);

            return (
              <MarkerPin
                key={marker.id}
                marker={marker}
                x={at.x + drag.x}
                y={at.y + drag.y}
                selected={selected?.id === marker.id}
                onPress={() => {
                  if (marker.type === 'cluster') {
                    setSelected(null);
                    setZoom(zoomForBounds(marker.bounds, size.width, size.height));
                    setCenter(boundsCenter(marker.bounds));
                    return;
                  }
                  setSelected(marker);
                }}
              />
            );
          })}

        {loading && <ActivityIndicator style={styles.loader} color={theme.color.accent} />}

        <View style={styles.zoomColumn}>
          <ZoomButton label="+" onPress={() => setZoom((z) => Math.min(MAX_ZOOM, z + 1))} />
          <ZoomButton label="−" onPress={() => setZoom((z) => Math.max(MIN_ZOOM, z - 1))} />
        </View>

        <View style={styles.scaleBar}>
          <View style={styles.scaleLine} />
          <Text style={styles.scaleText}>
            {scale >= 1000 ? `${Math.round(scale / 100) / 10} km` : `${scale} m`}
          </Text>
        </View>
      </View>

      {error && <Text style={styles.error}>{error}</Text>}

      {selected && selected.type !== 'cluster' && (
        <Pressable
          style={styles.card}
          accessibilityRole="button"
          onPress={() => {
            if (selected.type === 'listing') router.push(`/listing/${selected.id}`);
          }}
        >
          <Text style={styles.cardTitle} numberOfLines={1}>
            {selected.type === 'listing' ? selected.title : selected.name}
          </Text>
          <Text style={styles.cardMeta}>
            {selected.type === 'listing'
              ? describeListing(selected)
              : `${selected.activeListingCount} ${
                  selected.activeListingCount === 1 ? 'publicación' : 'publicaciones'
                }`}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

function describeListing(marker: Extract<MapMarker, { type: 'listing' }>): string {
  if (marker.kind === 'wanted') {
    return marker.maxBudget
      ? `Busca · hasta ${formatMoneyCompact(money(marker.maxBudget.amount, marker.maxBudget.currency))}`
      : 'Busca';
  }

  if (!marker.price) return marker.kind === 'auction' ? 'Subasta' : 'En venta';

  const price = formatMoneyCompact(money(marker.price.amount, marker.price.currency));
  return marker.kind === 'auction' ? `Subasta · ${price}` : price;
}

function MarkerPin({
  marker,
  x,
  y,
  selected,
  onPress,
}: {
  marker: MapMarker;
  x: number;
  y: number;
  selected: boolean;
  onPress: () => void;
}) {
  const label =
    marker.type === 'cluster'
      ? String(marker.count)
      : marker.type === 'store'
        ? '◆'
        : marker.kind === 'wanted'
          ? '?'
          : '•';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibleName(marker)}
      onPress={onPress}
      style={[
        styles.pin,
        marker.type === 'cluster' && styles.pinCluster,
        marker.type === 'listing' && marker.kind === 'wanted' && styles.pinWanted,
        marker.type === 'listing' && marker.kind === 'auction' && styles.pinAuction,
        marker.type === 'store' && styles.pinStore,
        selected && styles.pinSelected,
        // Centred on the point rather than hanging from its top-left corner.
        { left: x - PIN / 2, top: y - PIN / 2 },
      ]}
    >
      <Text style={styles.pinLabel}>{label}</Text>
    </Pressable>
  );
}

function accessibleName(marker: MapMarker): string {
  if (marker.type === 'cluster') {
    return `${marker.count} publicaciones agrupadas`;
  }
  if (marker.type === 'store') return marker.name;
  return marker.title;
}

function ZoomButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      style={styles.zoomButton}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label === '+' ? 'Acercar' : 'Alejar'}
    >
      <Text style={styles.zoomLabel}>{label}</Text>
    </Pressable>
  );
}

const PIN = 34;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.color.background },
  surface: {
    flex: 1,
    overflow: 'hidden',
    backgroundColor: theme.color.surfaceSunken,
  },
  loader: { position: 'absolute', top: theme.space.md, alignSelf: 'center' },

  pin: {
    position: 'absolute',
    width: PIN,
    height: PIN,
    borderRadius: theme.radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.color.brand,
  },
  pinCluster: { backgroundColor: theme.color.text },
  pinWanted: { backgroundColor: theme.color.wanted },
  pinAuction: { backgroundColor: theme.color.accent },
  pinStore: { backgroundColor: theme.color.friend },
  pinSelected: {
    borderWidth: 3,
    borderColor: theme.color.textInverse,
  },
  pinLabel: {
    color: theme.color.textInverse,
    fontWeight: theme.font.weight.black,
    fontSize: theme.font.size.sm,
  },

  zoomColumn: {
    position: 'absolute',
    right: theme.space.md,
    bottom: theme.space.xl,
    gap: theme.space.xs,
  },
  zoomButton: {
    width: 44,
    height: 44,
    borderRadius: theme.radius.full,
    backgroundColor: theme.color.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoomLabel: {
    fontSize: theme.font.size.lg,
    fontWeight: theme.font.weight.black,
    color: theme.color.text,
  },

  scaleBar: {
    position: 'absolute',
    left: theme.space.md,
    bottom: theme.space.md,
    alignItems: 'flex-start',
  },
  scaleLine: {
    width: 60,
    height: 2,
    backgroundColor: theme.color.textSecondary,
  },
  scaleText: {
    fontSize: theme.font.size.xs,
    color: theme.color.textSecondary,
  },

  error: {
    padding: theme.space.md,
    color: theme.color.danger,
    fontSize: theme.font.size.sm,
  },

  card: {
    margin: theme.space.md,
    padding: theme.space.md,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.color.surface,
    gap: theme.space.xs,
  },
  cardTitle: {
    fontSize: theme.font.size.md,
    fontWeight: theme.font.weight.black,
    color: theme.color.text,
  },
  cardMeta: {
    fontSize: theme.font.size.sm,
    color: theme.color.textSecondary,
  },
});
