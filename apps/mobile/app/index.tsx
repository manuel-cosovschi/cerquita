import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import type { ListingSummary } from '@cerquita/types';
import { ListingRow } from '@/components/ListingRow';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { theme } from '@/lib/theme';

/**
 * The nearby list.
 *
 * The web app's home is the map; on a phone the first screen is a list, because
 * a hyperlocal search on a small screen is mostly "what is around me right
 * now", and a list answers that with less panning. The map is one tap away, on
 * the same data and the same projection.
 *
 * Location is asked for once and declining is a real answer: without it the
 * list falls back to the newest listings rather than an empty screen.
 */
export default function NearbyScreen() {
  const router = useRouter();
  const { user, loading: sessionLoading } = useSession();

  const [items, setItems] = useState<ListingSummary[]>([]);
  const [query, setQuery] = useState('');
  const [center, setCenter] = useState<{ lat: number; lng: number } | null>(null);
  const [locationDenied, setLocationDenied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocationDenied(true);
        return;
      }
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setCenter({ lat: position.coords.latitude, lng: position.coords.longitude });
    })().catch(() => setLocationDenied(true));
  }, []);

  const load = useCallback(
    async (text: string) => {
      setError(null);
      try {
        const page = await api.search.query({
          q: text.trim() || undefined,
          center: center ?? undefined,
          // Without a position there is nothing to sort by distance, so the
          // newest listings are the honest fallback.
          sort: center ? 'distance' : 'newest',
          limit: 24,
        });
        setItems(page.items);
      } catch {
        setError('No pudimos cargar las publicaciones.');
      }
    },
    [center],
  );

  // Runs again once a position arrives and whenever the viewer changes: prices
  // and social proof are both resolved per viewer.
  useEffect(() => {
    if (sessionLoading) return;
    setLoading(true);
    void load(query).finally(() => setLoading(false));
    // `query` is deliberately not a dependency — searching is submit-driven, so
    // the list does not refetch on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, sessionLoading, user?.userId]);

  return (
    <View style={styles.screen}>
      <View style={styles.searchRow}>
        <TextInput
          style={styles.search}
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={() => void load(query)}
          placeholder="¿Qué estás buscando?"
          placeholderTextColor={theme.color.textTertiary}
          returnKeyType="search"
          accessibilityLabel="Buscar"
        />
        <Pressable
          style={styles.mapButton}
          onPress={() => router.push('/map')}
          accessibilityRole="button"
          accessibilityLabel="Ver en el mapa"
        >
          <Text style={styles.mapButtonLabel}>Mapa</Text>
        </Pressable>
        <Pressable
          style={styles.accountButton}
          onPress={() => router.push('/account')}
          accessibilityRole="button"
          accessibilityLabel="Tu cuenta"
        >
          <Text style={styles.accountInitial}>
            {(user?.username ?? '?').slice(0, 1).toUpperCase()}
          </Text>
        </Pressable>
      </View>

      {locationDenied && (
        <Text style={styles.note}>Sin tu ubicación mostramos lo más nuevo, no lo más cercano.</Text>
      )}

      {error && <Text style={styles.error}>{error}</Text>}

      {loading ? (
        <ActivityIndicator style={styles.loader} color={theme.color.accent} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <ListingRow listing={item} onPress={() => router.push(`/listing/${item.id}`)} />
          )}
          ListEmptyComponent={
            <Text style={styles.empty}>
              {query.trim() ? `No encontramos "${query.trim()}" por acá.` : 'No hay nada por acá.'}
            </Text>
          }
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void load(query).finally(() => setRefreshing(false));
              }}
              tintColor={theme.color.accent}
            />
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.color.background },
  searchRow: {
    flexDirection: 'row',
    gap: theme.space.sm,
    paddingHorizontal: theme.space.md,
    paddingBottom: theme.space.sm,
  },
  search: {
    flex: 1,
    height: 46,
    paddingHorizontal: theme.space.md,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.color.surface,
    fontSize: theme.font.size.md,
    color: theme.color.text,
  },
  mapButton: {
    height: 46,
    paddingHorizontal: theme.space.md,
    borderRadius: theme.radius.full,
    backgroundColor: theme.color.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapButtonLabel: {
    fontSize: theme.font.size.sm,
    fontWeight: theme.font.weight.bold,
    color: theme.color.text,
  },
  accountButton: {
    width: 46,
    height: 46,
    borderRadius: theme.radius.full,
    backgroundColor: theme.color.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  accountInitial: {
    color: theme.color.textInverse,
    fontWeight: theme.font.weight.bold,
    fontSize: theme.font.size.md,
  },
  note: {
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.xs,
    fontSize: theme.font.size.sm,
    color: theme.color.textTertiary,
  },
  error: {
    marginHorizontal: theme.space.md,
    marginBottom: theme.space.sm,
    padding: theme.space.sm,
    borderRadius: theme.radius.md,
    backgroundColor: theme.color.dangerSubtle,
    color: theme.color.danger,
    fontSize: theme.font.size.sm,
  },
  loader: { marginTop: theme.space.xl },
  list: { padding: theme.space.md, gap: theme.space.sm },
  empty: {
    marginTop: theme.space.xl,
    textAlign: 'center',
    color: theme.color.textTertiary,
    fontSize: theme.font.size.md,
  },
});
