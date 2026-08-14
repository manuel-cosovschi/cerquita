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
  surfaceSunken: palette.neutral[100],
  surfaceOverlay: palette.neutral[0],
  scrim: 'rgba(11, 13, 15, 0.45)',

  textPrimary: palette.neutral[900],
  textSecondary: palette.neutral[600],
  textTertiary: palette.neutral[500],
  textInverse: palette.neutral[0],
  textOnBrand: palette.neutral[0],
  textOnAccent: palette.neutral[0],

  border: palette.neutral[200],
  borderStrong: palette.neutral[300],
  borderFocus: palette.brand[500],

  brand: palette.brand[500],
  brandHover: palette.brand[600],
  brandPressed: palette.brand[700],
  brandSubtle: palette.brand[50],
  brandOnSubtle: palette.brand[700],

  success: palette.success[500],
  successSubtle: palette.success[100],
  warning: palette.warning[500],
  warningSubtle: palette.warning[100],
  danger: palette.danger[500],
  dangerSubtle: palette.danger[100],

  sale: palette.brand[500],
  saleSubtle: palette.brand[50],
  auction: palette.accent[500],
  auctionSubtle: palette.accent[50],
  wanted: palette.social[500],
  wantedSubtle: palette.social[50],
  store: palette.neutral[800],
  storeSubtle: palette.neutral[100],
  friend: palette.social[600],
  friendSubtle: palette.social[100],
  follower: palette.brand[600],
  followerSubtle: palette.brand[100],
  discount: palette.accent[600],
  discountSubtle: palette.accent[100],

  mapCluster: palette.neutral[900],
  mapClusterText: palette.neutral[0],
  mapMarkerBorder: palette.neutral[0],
  mapSelected: palette.brand[500],
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
  textSecondary: palette.neutral[300],
  textTertiary: palette.neutral[400],
  textInverse: palette.neutral[900],
  textOnBrand: palette.neutral[0],
  textOnAccent: palette.neutral[0],

  border: palette.neutral[700],
  borderStrong: palette.neutral[600],
  borderFocus: palette.brand[300],

  brand: palette.brand[400],
  brandHover: palette.brand[300],
  brandPressed: palette.brand[200],
  brandSubtle: palette.brand[900],
  brandOnSubtle: palette.brand[200],

  success: palette.success[500],
  successSubtle: '#0f3524',
  warning: palette.warning[500],
  warningSubtle: '#3a2c08',
  danger: palette.danger[500],
  dangerSubtle: '#3d1513',

  sale: palette.brand[400],
  saleSubtle: palette.brand[900],
  auction: palette.accent[400],
  auctionSubtle: palette.accent[900],
  wanted: palette.social[400],
  wantedSubtle: palette.social[900],
  store: palette.neutral[100],
  storeSubtle: palette.neutral[800],
  friend: palette.social[300],
  friendSubtle: palette.social[900],
  follower: palette.brand[300],
  followerSubtle: palette.brand[900],
  discount: palette.accent[400],
  discountSubtle: palette.accent[900],

  mapCluster: palette.neutral[50],
  mapClusterText: palette.neutral[950],
  mapMarkerBorder: palette.neutral[900],
  mapSelected: palette.brand[400],
};

export const colorSchemes: Record<ColorScheme, SemanticColors> = { light, dark };

export const colors = light;
