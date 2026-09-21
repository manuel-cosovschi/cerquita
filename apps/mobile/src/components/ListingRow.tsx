import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import type { ListingSummary } from '@cerquita/types';
import { formatDistance, formatMoney, money } from '@cerquita/utils';
import { theme } from '@/lib/theme';

/**
 * One listing in a list.
 *
 * The same three facts the web card leads with, in the same order: photo,
 * title, price — and the social tier under it when there is one, because a
 * friend price is the reason to look twice and hiding it behind a tap would
 * waste the mechanism the whole product is built on.
 */
export function ListingRow({ listing, onPress }: { listing: ListingSummary; onPress: () => void }) {
  const isWanted = listing.kind === 'wanted';

  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={listing.title}
    >
      {listing.coverImage ? (
        <Image source={{ uri: listing.coverImage.url }} style={styles.thumb} />
      ) : (
        <View style={[styles.thumb, styles.thumbEmpty]}>
          <Text style={styles.thumbEmptyText}>{isWanted ? 'Busco' : 'Sin foto'}</Text>
        </View>
      )}

      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={2}>
          {listing.title}
        </Text>

        {listing.price ? (
          <View style={styles.priceRow}>
            <Text style={styles.price}>
              {formatMoney(money(listing.price.effective.amount, listing.price.effective.currency))}
            </Text>
            {/* The struck-through list price only appears when it differs. */}
            {listing.price.discountBasisPoints > 0 && (
              <Text style={styles.listPrice}>
                {formatMoney(money(listing.price.list.amount, listing.price.list.currency))}
              </Text>
            )}
          </View>
        ) : listing.maxBudget ? (
          <Text style={styles.budget}>
            Hasta {formatMoney(money(listing.maxBudget.amount, listing.maxBudget.currency))}
          </Text>
        ) : null}

        <View style={styles.metaRow}>
          <Text style={styles.meta} numberOfLines={1}>
            {listing.store?.name ?? listing.seller.displayName}
          </Text>
          {listing.distanceMeters !== undefined && (
            <Text style={styles.meta}>· {formatDistance(listing.distanceMeters)}</Text>
          )}
        </View>

        {listing.price && listing.price.tier !== 'public' && (
          <Text style={styles.socialNote}>
            {listing.price.tier === 'friend' ? 'Precio de amigo' : 'Precio para seguidores'}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: theme.space.md,
    padding: theme.space.md,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.color.surface,
  },
  pressed: { opacity: 0.7 },
  thumb: {
    width: 84,
    height: 84,
    borderRadius: theme.radius.md,
    backgroundColor: theme.color.surfaceSunken,
  },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  thumbEmptyText: { fontSize: theme.font.size.xs, color: theme.color.textTertiary },
  body: { flex: 1, minWidth: 0 },
  title: {
    fontSize: theme.font.size.md,
    fontWeight: theme.font.weight.semibold,
    color: theme.color.text,
  },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: theme.space.sm, marginTop: 4 },
  price: {
    fontSize: theme.font.size.lg,
    fontWeight: theme.font.weight.black,
    color: theme.color.text,
  },
  listPrice: {
    fontSize: theme.font.size.sm,
    color: theme.color.textTertiary,
    textDecorationLine: 'line-through',
  },
  budget: {
    marginTop: 4,
    fontSize: theme.font.size.md,
    fontWeight: theme.font.weight.bold,
    color: theme.color.wanted,
  },
  metaRow: { flexDirection: 'row', gap: 4, marginTop: 4 },
  meta: { fontSize: theme.font.size.sm, color: theme.color.textTertiary },
  socialNote: {
    marginTop: 2,
    fontSize: theme.font.size.sm,
    fontWeight: theme.font.weight.semibold,
    color: theme.color.friend,
  },
});
