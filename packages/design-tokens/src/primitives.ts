/**
 * PROVISIONAL PRIMITIVE VALUES.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * This is the ONLY file in the repository that holds raw visual values.
 * Everything else in the codebase reads semantic tokens from `./semantic.ts`,
 * which are defined in terms of the primitives below.
 *
 * The Claude Design export ("Cerquita - Design Exploration Board.dc.html") could
 * not be read in the environment where this was authored — the design MCP
 * requires an interactive `/design-login`. See `docs/design-audit.md`.
 *
 * When the export is available, replace the values in this file with the ones
 * extracted from it. No other file needs to change: component code, the web
 * app, the admin app and the mobile app all consume semantic tokens.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Raw color ramps. Replace wholesale with the ramps read off the export. */
export const palette = {
  // Neutral ramp — surfaces, text, borders.
  neutral: {
    0: '#ffffff',
    50: '#f7f8f9',
    100: '#eef0f2',
    200: '#e0e3e7',
    300: '#c8ccd2',
    400: '#9aa1aa',
    500: '#6f7781',
    600: '#515861',
    700: '#3a4048',
    800: '#24282e',
    900: '#14171a',
    950: '#0b0d0f',
  },
  // Brand ramp — primary actions, active map state.
  brand: {
    50: '#eef8f3',
    100: '#d3ede1',
    200: '#a6dbc4',
    300: '#6cc4a1',
    400: '#38a97e',
    500: '#188f66',
    600: '#0f7353',
    700: '#0d5c43',
    800: '#0c4835',
    900: '#0a3a2c',
  },
  // Accent ramp — auctions, countdowns, urgency ("Ahora").
  accent: {
    50: '#fff3ec',
    100: '#ffe0cd',
    200: '#ffc09b',
    300: '#ff9a60',
    400: '#fb7a33',
    500: '#e85d14',
    600: '#c2470d',
    700: '#9b380d',
    800: '#7c2f10',
    900: '#652910',
  },
  // Social ramp — friend/follower relationship affordances.
  social: {
    50: '#f0f1ff',
    100: '#e0e2ff',
    200: '#c4c8ff',
    300: '#a0a5fb',
    400: '#7f83f2',
    500: '#6266e2',
    600: '#4b4ec4',
    700: '#3d3f9e',
    800: '#33357e',
    900: '#2d2f63',
  },
  success: { 100: '#d8f2e2', 500: '#1c9a5c', 700: '#136b40' },
  warning: { 100: '#fdf0cd', 500: '#c99110', 700: '#8d640a' },
  danger: { 100: '#fbdedd', 500: '#d33d38', 700: '#962a26' },
} as const;

/**
 * Spacing scale, in px. 4px base grid.
 * Verify the grid against the export before treating card/sheet padding as final.
 */
export const space = {
  0: 0,
  1: 2,
  2: 4,
  3: 8,
  4: 12,
  5: 16,
  6: 20,
  7: 24,
  8: 32,
  9: 40,
  10: 48,
  11: 64,
  12: 80,
} as const;

/** Corner radii, in px. */
export const radius = {
  none: 0,
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  '2xl': 28,
  pill: 999,
  full: 9999,
} as const;

/** Font families. `system` keeps the app readable until the export's faces are known. */
export const fontFamily = {
  sans: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  // Prices and countdowns benefit from tabular figures so digits stop jittering.
  numeric:
    "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
} as const;

/** Font sizes, in px. */
export const fontSize = {
  '2xs': 10,
  xs: 12,
  sm: 13,
  base: 15,
  md: 16,
  lg: 18,
  xl: 22,
  '2xl': 27,
  '3xl': 34,
} as const;

export const fontWeight = {
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
} as const;

/** Line heights, unitless multipliers. */
export const lineHeight = {
  tight: 1.15,
  snug: 1.3,
  normal: 1.45,
  relaxed: 1.6,
} as const;

export const letterSpacing = {
  tight: '-0.02em',
  normal: '0',
  wide: '0.02em',
  wider: '0.06em',
} as const;

/**
 * Elevation. Map markers and bottom sheets are the two places where shadow
 * accuracy matters most — they read against a busy map surface.
 */
export const shadow = {
  none: 'none',
  sm: '0 1px 2px rgba(11, 13, 15, 0.06), 0 1px 3px rgba(11, 13, 15, 0.08)',
  md: '0 2px 6px rgba(11, 13, 15, 0.07), 0 6px 16px rgba(11, 13, 15, 0.09)',
  lg: '0 4px 12px rgba(11, 13, 15, 0.08), 0 12px 32px rgba(11, 13, 15, 0.12)',
  marker: '0 2px 8px rgba(11, 13, 15, 0.22)',
  sheet: '0 -2px 12px rgba(11, 13, 15, 0.10)',
} as const;

export const borderWidth = {
  none: 0,
  hairline: 1,
  thick: 2,
} as const;

/** Motion. Kept short — this is a map-first product and transitions block panning. */
export const duration = {
  instant: 0,
  fast: 120,
  normal: 200,
  slow: 320,
} as const;

export const easing = {
  standard: 'cubic-bezier(0.2, 0, 0.2, 1)',
  decelerate: 'cubic-bezier(0, 0, 0.2, 1)',
  accelerate: 'cubic-bezier(0.4, 0, 1, 1)',
} as const;

/** z-index scale. Explicit so the map, sheets and modals never fight. */
export const zIndex = {
  base: 0,
  map: 10,
  mapMarker: 20,
  mapMarkerActive: 30,
  overlayControls: 40,
  bottomSheet: 50,
  header: 60,
  modal: 70,
  toast: 80,
} as const;

/** Breakpoints, in px. Mobile-first; desktop gets the split map/results layout. */
export const breakpoint = {
  sm: 480,
  md: 768,
  lg: 1024,
  xl: 1280,
  '2xl': 1536,
} as const;

/**
 * Map marker geometry. Markers are a first-class component in Cerquita, so their
 * dimensions are tokens rather than per-screen magic numbers.
 */
export const marker = {
  dotSize: 12,
  pinWidth: 34,
  pinHeight: 42,
  thumbSize: 44,
  clusterSizeSm: 36,
  clusterSizeMd: 46,
  clusterSizeLg: 58,
  tailSize: 6,
} as const;

/** Minimum interactive target, in px. Never go below this — see docs/design-system.md. */
export const touchTarget = {
  min: 44,
  comfortable: 48,
} as const;
