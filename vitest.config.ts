import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const resolve = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/**
 * One Vitest project for the whole workspace.
 *
 * Workspace packages are aliased straight to their TypeScript sources so tests
 * run against the code as written, with no build step between editing and
 * testing.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@cerquita/utils': resolve('./packages/utils/src/index.ts'),
      '@cerquita/types': resolve('./packages/types/src/index.ts'),
      '@cerquita/domain': resolve('./packages/domain/src/index.ts'),
      '@cerquita/design-tokens': resolve('./packages/design-tokens/src/index.ts'),
      '@cerquita/validation': resolve('./packages/validation/src/index.ts'),
    },
  },
  test: {
    include: ['packages/**/*.test.ts', 'apps/api/**/*.spec.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**'],
    environment: 'node',
    passWithNoTests: true,
  },
});
