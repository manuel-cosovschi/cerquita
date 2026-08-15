import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { Listing } from '@cerquita/types';
import { ApiError } from '@cerquita/api-client';
import { formatDistance, formatMoney, money } from '@cerquita/utils';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { theme } from '@/lib/theme';

/**
 * A listing.
 *
 * Everything here is resolved for the viewer by the server: the price, whether
 * it is a friend price, "amiga de Nacho", whether it is already saved. The
 * screen refetches when the session changes rather than trying to patch any of
 * that locally — pricing is never the client's to compute (spec §23).
 */
export default function ListingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useSession();

  const [listing, setListing] = useState<Listing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    api.listings
      .get(id)
      .then((result) => {
        if (!cancelled) setListing(result);
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(cause instanceof ApiError ? cause.message : 'No pudimos cargar la publicación.');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [id, user?.userId]);

  if (error) return <Text style={styles.state}>{error}</Text>;
  if (!listing) return <ActivityIndicator style={styles.state} color={theme.color.accent} />;

  const isOwn = user?.userId === listing.seller.id;

  async function act(action: () => Promise<unknown>) {
    if (!user) {
      router.push('/account');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'No pudimos completar la acción.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.content}>
      {listing.images[0] ? (
        <Image source={{ uri: listing.images[0].url }} style={styles.hero} />
      ) : (
        <View style={[styles.hero, styles.heroEmpty]}>
          <Text style={styles.heroEmptyText}>
            {listing.kind === 'wanted' ? 'Publicación "Busco"' : 'Sin fotos'}
          </Text>
        </View>
      )}

      <Text style={styles.title}>{listing.title}</Text>

      {listing.price && (
        <View style={styles.priceRow}>
          <Text style={styles.price}>
            {formatMoney(money(listing.price.effective.amount, listing.price.effective.currency))}
          </Text>
          {listing.price.discountBasisPoints > 0 && (
            <Text style={styles.listPrice}>
              {formatMoney(money(listing.price.list.amount, listing.price.list.currency))}
            </Text>
          )}
        </View>
      )}

      {listing.price && listing.price.tier !== 'public' && (
        <Text style={styles.socialNote}>
          {listing.price.tier === 'friend'
            ? 'Estás viendo el precio de amigo.'
            : 'Estás viendo el precio para seguidores.'}
        </Text>
      )}

      <View style={styles.seller}>
        <Text style={styles.sellerName}>{listing.store?.name ?? listing.seller.displayName}</Text>
        {/* The reference above the rating, same as the web: it answers "can I
            trust this person" better than a star average. */}
        {listing.socialProof && <Text style={styles.proof}>{listing.socialProof}</Text>}
        <Text style={styles.sellerMeta}>
          {listing.seller.rating !== undefined
            ? `${listing.seller.rating.toFixed(1)} ★ · ${listing.seller.reviewCount} reseñas`
            : 'Sin reseñas todavía'}
        </Text>
      </View>

      {!isOwn && (
        <View style={styles.actions}>
          <Pressable
            style={[styles.primary, busy && styles.disabled]}
            disabled={busy}
            onPress={() =>
              void act(async () => {
                const conversation = await api.chat.open({
                  recipientId: listing.seller.id,
                  listingId: listing.id,
                });
                router.push(`/chat/${conversation.id}`);
              })
            }
          >
            <Text style={styles.primaryText}>Mensaje</Text>
          </Pressable>

          <Pressable
            style={[styles.secondary, busy && styles.disabled]}
            disabled={busy}
            onPress={() =>
              void act(async () => {
                if (listing.isFavorite) await api.favorites.remove(listing.id);
                else await api.favorites.add(listing.id);
                setListing(await api.listings.get(listing.id));
              })
            }
          >
            <Text style={styles.secondaryText}>
              {listing.isFavorite ? '♥ Guardado' : '♡ Guardar'}
            </Text>
          </Pressable>
        </View>
      )}

      {listing.description ? (
        <>
          <Text style={styles.sectionTitle}>Descripción</Text>
          <Text style={styles.body}>{listing.description}</Text>
        </>
      ) : null}

      <Text style={styles.sectionTitle}>Dónde está</Text>
      <Text style={styles.body}>
        {[listing.location.neighborhood, listing.location.city].filter(Boolean).join(', ') ||
          'Zona aproximada'}
        {listing.distanceMeters !== undefined
          ? ` · a ${formatDistance(listing.distanceMeters)}`
          : ''}
      </Text>
      {/* Spec §10, §47: the exact point is never sent, and the screen says so. */}
      <Text style={styles.fineprint}>
        Ubicación aproximada (±{listing.location.precisionMeters} m). La dirección exacta se acuerda
        por chat.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  state: { marginTop: theme.space.xl, textAlign: 'center', color: theme.color.textTertiary },
  content: { padding: theme.space.md, paddingBottom: theme.space.xxl, gap: theme.space.xs },
  hero: {
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.color.surfaceSunken,
  },
  heroEmpty: { alignItems: 'center', justifyContent: 'center' },
  heroEmptyText: { color: theme.color.textTertiary, fontSize: theme.font.size.sm },
  title: {
    marginTop: theme.space.md,
    fontSize: theme.font.size.xxl,
    fontWeight: theme.font.weight.black,
    color: theme.color.text,
  },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: theme.space.sm },
  price: {
    fontSize: theme.font.size.xxl,
    fontWeight: theme.font.weight.black,
    color: theme.color.text,
  },
  listPrice: {
    fontSize: theme.font.size.md,
    color: theme.color.textTertiary,
    textDecorationLine: 'line-through',
  },
  socialNote: {
    fontSize: theme.font.size.sm,
    fontWeight: theme.font.weight.semibold,
    color: theme.color.friend,
  },
  seller: {
    marginTop: theme.space.md,
    padding: theme.space.md,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.color.surface,
  },
  sellerName: {
    fontSize: theme.font.size.md,
    fontWeight: theme.font.weight.bold,
    color: theme.color.text,
  },
  proof: {
    marginTop: 2,
    fontSize: theme.font.size.base,
    fontWeight: theme.font.weight.semibold,
    color: theme.color.friend,
  },
  sellerMeta: { marginTop: 2, fontSize: theme.font.size.sm, color: theme.color.textTertiary },
  actions: { flexDirection: 'row', gap: theme.space.sm, marginTop: theme.space.md },
  primary: {
    flex: 1,
    height: 48,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.color.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { color: theme.color.textInverse, fontWeight: theme.font.weight.bold },
  secondary: {
    flex: 1,
    height: 48,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.color.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: { color: theme.color.text, fontWeight: theme.font.weight.bold },
  disabled: { opacity: 0.55 },
  sectionTitle: {
    marginTop: theme.space.lg,
    fontSize: theme.font.size.md,
    fontWeight: theme.font.weight.bold,
    color: theme.color.text,
  },
  body: {
    fontSize: theme.font.size.base,
    lineHeight: 21,
    color: theme.color.textSecondary,
  },
  fineprint: { marginTop: 4, fontSize: theme.font.size.xs, color: theme.color.textTertiary },
});
