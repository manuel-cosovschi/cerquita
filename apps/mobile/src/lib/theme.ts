import { colors, fontSize, radius, space } from '@cerquita/design-tokens';

/**
 * The design tokens, as React Native values.
 *
 * The web apps consume the same tokens as CSS custom properties; React Native
 * has no CSS, so this is the one place the same names are turned into plain
 * numbers and strings. Nothing in the app reaches past this into the token
 * package, for the same reason no web component reads `primitives.ts`: swapping
 * the exported design has to remain a one-file change.
 *
 * Values that CSS expresses as strings ("14px") become numbers here, because
 * that is what the layout engine takes.
 */

const px = (value: string | number): number =>
  typeof value === 'number' ? value : Number.parseFloat(value);

export const theme = {
  color: {
    background: colors.background,
    surface: colors.surface,
    surfaceSunken: colors.surfaceSunken,
    border: colors.border,
    borderStrong: colors.borderStrong,

    text: colors.textPrimary,
    textSecondary: colors.textSecondary,
    textTertiary: colors.textTertiary,
    textInverse: colors.textInverse,
    textOnAccent: colors.textOnAccent,

    brand: colors.brand,
    accent: colors.auction,
    accentText: colors.auctionText,
    friend: colors.friend,
    friendRing: colors.friendRing,
    friendSubtle: colors.friendSubtle,
    wanted: colors.wanted,
    wantedSubtle: colors.wantedSubtle,
    danger: colors.danger,
    dangerSubtle: colors.dangerSubtle,
    success: colors.success,
    successSubtle: colors.successSubtle,
  },

  space: {
    xs: px(space[2]),
    sm: px(space[3]),
    md: px(space[5]),
    lg: px(space[7]),
    xl: px(space[9]),
    xxl: px(space[11]),
  },

  radius: {
    sm: px(radius.sm),
    md: px(radius.md),
    lg: px(radius.lg),
    xl: px(radius.xl),
    pill: 999,
    full: 9999,
  },

  font: {
    /*
     * The export's two faces. On a device without them loaded, React Native
     * falls back to the system face rather than failing — which is why the
     * weights are carried separately and not baked into a family name.
     */
    display: undefined as string | undefined,
    body: undefined as string | undefined,
    size: {
      xs: px(fontSize['2xs']),
      sm: px(fontSize.sm),
      base: px(fontSize.base),
      md: px(fontSize.md),
      lg: px(fontSize.lg),
      xl: px(fontSize.xl),
      xxl: px(fontSize['2xl']),
    },
    weight: {
      regular: '400' as const,
      semibold: '600' as const,
      bold: '700' as const,
      black: '800' as const,
    },
  },
} as const;

export type Theme = typeof theme;
