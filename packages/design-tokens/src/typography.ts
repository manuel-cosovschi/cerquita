/**
 * Named type styles. Screens reference these by name so a change to, say, the
 * price style lands everywhere at once.
 */

import { fontFamily, fontSize, fontWeight, letterSpacing, lineHeight } from './primitives.js';

export interface TextStyle {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  lineHeight: number;
  letterSpacing: string;
}

const sans = fontFamily.sans;
const numeric = fontFamily.numeric;

export const textStyles = {
  displayLg: {
    fontFamily: sans,
    fontSize: fontSize['3xl'],
    fontWeight: fontWeight.bold,
    lineHeight: lineHeight.tight,
    letterSpacing: letterSpacing.tight,
  },
  displaySm: {
    fontFamily: sans,
    fontSize: fontSize['2xl'],
    fontWeight: fontWeight.bold,
    lineHeight: lineHeight.tight,
    letterSpacing: letterSpacing.tight,
  },
  titleLg: {
    fontFamily: sans,
    fontSize: fontSize.xl,
    fontWeight: fontWeight.semibold,
    lineHeight: lineHeight.snug,
    letterSpacing: letterSpacing.tight,
  },
  titleMd: {
    fontFamily: sans,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
    lineHeight: lineHeight.snug,
    letterSpacing: letterSpacing.normal,
  },
  titleSm: {
    fontFamily: sans,
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    lineHeight: lineHeight.snug,
    letterSpacing: letterSpacing.normal,
  },
  body: {
    fontFamily: sans,
    fontSize: fontSize.base,
    fontWeight: fontWeight.regular,
    lineHeight: lineHeight.normal,
    letterSpacing: letterSpacing.normal,
  },
  bodyStrong: {
    fontFamily: sans,
    fontSize: fontSize.base,
    fontWeight: fontWeight.medium,
    lineHeight: lineHeight.normal,
    letterSpacing: letterSpacing.normal,
  },
  caption: {
    fontFamily: sans,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.regular,
    lineHeight: lineHeight.normal,
    letterSpacing: letterSpacing.normal,
  },
  captionStrong: {
    fontFamily: sans,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    lineHeight: lineHeight.snug,
    letterSpacing: letterSpacing.normal,
  },
  /** Badge / chip lettering — "SUBASTA", "BUSCO", "AMIGO". */
  label: {
    fontFamily: sans,
    fontSize: fontSize['2xs'],
    fontWeight: fontWeight.bold,
    lineHeight: lineHeight.tight,
    letterSpacing: letterSpacing.wider,
  },
  /** Prices in cards and detail views. Tabular so columns line up. */
  price: {
    fontFamily: numeric,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    lineHeight: lineHeight.tight,
    letterSpacing: letterSpacing.tight,
  },
  priceLg: {
    fontFamily: numeric,
    fontSize: fontSize['2xl'],
    fontWeight: fontWeight.bold,
    lineHeight: lineHeight.tight,
    letterSpacing: letterSpacing.tight,
  },
  priceSm: {
    fontFamily: numeric,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
    lineHeight: lineHeight.tight,
    letterSpacing: letterSpacing.normal,
  },
  /** Auction countdowns. Tabular figures stop the timer from shifting width. */
  countdown: {
    fontFamily: numeric,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
    lineHeight: lineHeight.tight,
    letterSpacing: letterSpacing.wide,
  },
  /** Text inside a map marker — small, dense, must stay legible over imagery. */
  marker: {
    fontFamily: numeric,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
    lineHeight: lineHeight.tight,
    letterSpacing: letterSpacing.normal,
  },
} as const satisfies Record<string, TextStyle>;

export type TextStyleName = keyof typeof textStyles;
