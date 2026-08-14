/**
 * CSS custom-property generation for the web and admin apps.
 *
 * Mobile (React Native) consumes the TS tokens directly; the web side gets CSS
 * variables so styling stays in stylesheets rather than inline objects.
 */

import { colorSchemes, type ColorScheme, type SemanticColors } from './semantic.js';
import {
  borderWidth,
  duration,
  easing,
  fontSize,
  fontWeight,
  layout,
  letterSpacing,
  lineHeight,
  mapTiles,
  marker,
  radius,
  ring,
  shadow,
  space,
  touchTarget,
  zIndex,
  fontFamily,
} from './primitives.js';

const kebab = (value: string): string =>
  value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

function colorVars(scheme: SemanticColors): string[] {
  return Object.entries(scheme).map(([name, value]) => `  --color-${kebab(name)}: ${value};`);
}

function scaleVars(prefix: string, scale: Record<string, string | number>, unit = ''): string[] {
  return Object.entries(scale).map(
    ([name, value]) =>
      `  --${prefix}-${kebab(String(name))}: ${typeof value === 'number' && unit ? `${value}${unit}` : value};`,
  );
}

/** Scheme-independent tokens. Emitted once. */
function staticVars(): string[] {
  return [
    ...scaleVars('space', space, 'px'),
    ...scaleVars('radius', radius, 'px'),
    ...scaleVars('font-size', fontSize, 'px'),
    ...scaleVars('font-weight', fontWeight),
    ...scaleVars('line-height', lineHeight),
    ...scaleVars('shadow', shadow),
    ...scaleVars('ring', ring),
    ...scaleVars('layout', layout, 'px'),
    ...scaleVars('letter-spacing', letterSpacing),
    ...scaleVars('border-width', borderWidth, 'px'),
    ...scaleVars('duration', duration, 'ms'),
    ...scaleVars('easing', easing),
    ...scaleVars('z', zIndex),
    ...scaleVars('marker', marker, 'px'),
    ...scaleVars('touch-target', touchTarget, 'px'),
    `  --font-family-display: ${fontFamily.display};`,
    `  --font-family-sans: ${fontFamily.sans};`,
    `  --font-family-numeric: ${fontFamily.numeric};`,
    `  --map-tile-filter: ${mapTiles.filter};`,
    `  --map-tile-filter-quiet: ${mapTiles.filterQuiet};`,
  ];
}

/**
 * Emits the full stylesheet.
 *
 * Theming follows the three-state rule: bare `:root` carries the complete light
 * palette, `prefers-color-scheme: dark` overrides it only when the user has not
 * chosen explicitly, and `[data-theme]` wins in both directions.
 */
export function generateCssVariables(): string {
  const lightBlock = [':root {', ...staticVars(), ...colorVars(colorSchemes.light), '}'].join('\n');

  const darkVars = colorVars(colorSchemes.dark).join('\n');

  const systemDark = [
    '@media (prefers-color-scheme: dark) {',
    '  :root:not([data-theme="light"]) {',
    darkVars.replace(/^ {2}/gm, '    '),
    '  }',
    '}',
  ].join('\n');

  const explicitDark = [':root[data-theme="dark"] {', darkVars, '}'].join('\n');
  const explicitLight = [
    ':root[data-theme="light"] {',
    colorVars(colorSchemes.light).join('\n'),
    '}',
  ].join('\n');

  return [lightBlock, systemDark, explicitDark, explicitLight].join('\n\n') + '\n';
}

/** CSS variable name for a semantic color, e.g. `textPrimary` -> `var(--color-text-primary)`. */
export function colorVar(name: keyof SemanticColors): string {
  return `var(--color-${kebab(name)})`;
}

export type { ColorScheme };
