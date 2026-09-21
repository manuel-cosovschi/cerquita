import { generateCssVariables } from '@cerquita/design-tokens';

/**
 * The design tokens, emitted as CSS custom properties at build time.
 *
 * This is the only bridge between the token package and the stylesheets: no
 * component hardcodes a colour or a spacing value, so replacing the exported
 * design means changing `packages/design-tokens/src/primitives.ts` and nothing
 * in this app.
 */
export const tokensCss = generateCssVariables();
