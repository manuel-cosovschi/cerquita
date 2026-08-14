/**
 * Semantic tokens — the layer every app and component is allowed to read.
 *
 * Rule: application code never imports `primitives.ts`. It imports these names.
 * That is what makes the design export swappable and dark mode addable without
 * touching screens (spec §65, §69).
 */

import { palette } from './primitives.js';

export type ColorScheme = 'light' | 'dark';

/** Every semantic color role in the product. Both schemes must define all of them. */
export interface SemanticColors {
  // Surfaces
  background: string;
  surface: string;
  surfaceRaised: string;
  surfaceSunken: string;
  /** Sheets and popovers sitting above the map. */
  surfaceOverlay: string;
  scrim: string;

  // Text
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  textInverse: string;
  textOnBrand: string;
  textOnAccent: string;

  // Lines
  border: string;
  borderStrong: string;
  borderFocus: string;

  // Actions
  brand: string;
  brandHover: string;
  brandPressed: string;
  brandSubtle: string;
  brandOnSubtle: string;

  // Status
  success: string;
  successSubtle: string;
  warning: string;
  warningSubtle: string;
  danger: string;
  dangerSubtle: string;

  // Domain roles — these carry product meaning, not just decoration.
  /** Direct-sale listings. */
  sale: string;
  saleSubtle: string;
  /** Auctions, countdowns, "Ahora" urgency. */
  auction: string;
  auctionSubtle: string;
  /** "Busco" (wanted) posts. */
  wanted: string;
  wantedSubtle: string;
  /** Stores. */
  store: string;
  storeSubtle: string;
  /** Friend relationship. */
  friend: string;
  friendSubtle: string;
  /** Follower relationship. */
  follower: string;
  followerSubtle: string;
  /** Price-drop / discount emphasis. */
  discount: string;
  discountSubtle: string;

  // Map chrome
  mapCluster: string;
  mapClusterText: string;
  mapMarkerBorder: string;
  mapSelected: string;
}

const light: SemanticColors = {
  background: palette.neutral[50],
  surface: palette.neutral[0],
  surfaceRaised: palette.neutral[0],
  surfaceSunken: palette.neutral[150],
  surfaceOverlay: palette.neutral[0],
  scrim: 'rgba(20, 18, 16, 0.45)',

  textPrimary: palette.neutral[900],
  textSecondary: 'rgba(20, 18, 16, 0.62)',
  textTertiary: 'rgba(20, 18, 16, 0.42)',
  textInverse: palette.neutral[0],
  // The export puts DARK text on the orange, not white. Reversing it would
  // fail contrast and lose the design's warmth.
  textOnBrand: palette.accent.onAccent,
  textOnAccent: palette.accent.onAccent,

  border: 'rgba(20, 18, 16, 0.09)',
  borderStrong: 'rgba(20, 18, 16, 0.14)',
  borderFocus: palette.info[500],

  // Brand is the INK, not the orange: the primary CTA ("Comprar ahora") and the
  // active nav item are near-black. Orange is the accent, used for the second
  // action and for urgency.
  brand: palette.neutral[900],
  brandHover: palette.neutral[800],
  brandPressed: palette.neutral[950],
  brandSubtle: palette.neutral[200],
  brandOnSubtle: palette.neutral[900],

  success: palette.success[500],
  successSubtle: palette.success[100],
  warning: palette.warning[500],
  warningSubtle: palette.warning[100],
  danger: palette.danger[500],
  dangerSubtle: palette.danger[100],

  // Direct sale carries no colour of its own — it is the ink default. Colour is
  // reserved for what deviates: auctions, friends, wanted posts.
  sale: palette.neutral[900],
  saleSubtle: palette.neutral[200],
  auction: palette.accent[500],
  auctionSubtle: palette.accent[100],
  wanted: palette.social[600],
  wantedSubtle: palette.social[100],
  store: palette.neutral[900],
  storeSubtle: palette.neutral[200],
  friend: palette.social[700],
  friendSubtle: palette.social[100],
  follower: palette.neutral[700],
  followerSubtle: palette.neutral[200],
  discount: palette.accent[700],
  discountSubtle: palette.accent[100],

  mapCluster: palette.neutral[900],
  mapClusterText: palette.neutral[0],
  mapMarkerBorder: palette.neutral[0],
  mapSelected: palette.accent[500],
};

/**
 * Dark scheme.
 *
 * The exported board did not define a dark theme (it could not be read — see
 * docs/design-audit.md), so this is a structurally complete but UNVERIFIED
 * mapping. It exists so dark mode is a token swap later rather than an app-wide
 * refactor (spec §69). Do not ship it as the default until it has been designed.
 */
const dark: SemanticColors = {
  background: palette.neutral[950],
  surface: palette.neutral[900],
  surfaceRaised: palette.neutral[800],
  surfaceSunken: palette.neutral[950],
  surfaceOverlay: palette.neutral[800],
  scrim: 'rgba(0, 0, 0, 0.6)',

  textPrimary: palette.neutral[50],
  textSecondary: 'rgba(246, 242, 234, 0.62)',
  textTertiary: 'rgba(246, 242, 234, 0.42)',
  textInverse: palette.neutral[900],
  textOnBrand: palette.neutral[900],
  textOnAccent: palette.accent.onAccent,

  border: 'rgba(246, 242, 234, 0.12)',
  borderStrong: 'rgba(246, 242, 234, 0.2)',
  borderFocus: palette.info[500],

  // Inverted: on a dark canvas the cream becomes the primary action surface.
  brand: palette.neutral[50],
  brandHover: palette.neutral[100],
  brandPressed: palette.neutral[200],
  brandSubtle: palette.neutral[800],
  brandOnSubtle: palette.neutral[50],

  success: palette.success[500],
  successSubtle: '#062e2c',
  warning: palette.warning[500],
  warningSubtle: '#3a2308',
  danger: palette.danger[500],
  dangerSubtle: '#3d1513',

  sale: palette.neutral[50],
  saleSubtle: palette.neutral[800],
  // The export already proves this pairing: on its dark auction card the timer
  // is the lighter orange, not the base one.
  auction: palette.accent[300],
  auctionSubtle: '#3a2308',
  wanted: palette.social[500],
  wantedSubtle: '#062e2c',
  store: palette.neutral[50],
  storeSubtle: palette.neutral[800],
  friend: palette.social[500],
  friendSubtle: '#062e2c',
  follower: palette.neutral[300],
  followerSubtle: palette.neutral[800],
  discount: palette.accent[300],
  discountSubtle: '#3a2308',

  mapCluster: palette.neutral[50],
  mapClusterText: palette.neutral[900],
  mapMarkerBorder: palette.neutral[900],
  mapSelected: palette.accent[500],
};

export const colorSchemes: Record<ColorScheme, SemanticColors> = { light, dark };

export const colors = light;
