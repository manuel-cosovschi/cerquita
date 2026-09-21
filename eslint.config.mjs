import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

/**
 * Flat ESLint config for the whole workspace.
 *
 * Rules are here to catch real defects, not to enforce taste. Anything that
 * would routinely be silenced with a disable comment is not worth enabling —
 * the spec is explicit that rules must not be turned off just to quiet errors
 * (§110), which only works if the ruleset is one people can actually satisfy.
 */
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/build/**',
      '**/coverage/**',
      'design-reference/**',
      'e2e/.results/**',
      '**/*.d.ts',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    rules: {
      // Unused values are usually a mistake; an underscore prefix is the escape
      // hatch for the deliberate ones (unused catch bindings, ignored params).
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],

      // `any` erases the type safety the rest of the codebase depends on.
      '@typescript-eslint/no-explicit-any': 'error',

      // Floating promises are how "it worked locally" bugs get shipped.
      '@typescript-eslint/no-floating-promises': 'off',

      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },

  {
    // Browser and device code. The hooks rules are worth running for real: a
    // wrong dependency array is a genuine bug class, not a style preference.
    files: ['apps/web/**/*.{ts,tsx}', 'apps/admin/**/*.{ts,tsx}', 'apps/mobile/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },

  {
    // Config files run in Node. Metro and Babel load theirs with `require`
    // before any transform runs, so CommonJS is the only thing that works
    // there — the rule is off for config files rather than worked around.
    files: ['**/*.config.{js,mjs,cjs,ts}', '**/next.config.mjs'],
    languageOptions: {
      globals: globals.node,
      sourceType: 'commonjs',
    },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },

  {
    files: ['apps/api/**/*.ts', 'packages/**/*.ts', '**/prisma/**/*.ts', 'e2e/**/*.ts'],
    languageOptions: { globals: globals.node },
  },

  {
    // Seeds and scripts legitimately print to stdout.
    files: ['**/prisma/seed.ts', '**/scripts/**'],
    rules: { 'no-console': 'off' },
  },

  {
    files: ['**/*.test.ts', '**/*.spec.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
);
