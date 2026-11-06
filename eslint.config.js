import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'

/**
 * Flat ESLint config for Glaze Music.
 *
 * Philosophy: catch real bugs, don't relitigate formatting. Prettier owns
 * whitespace/quotes/semicolons; ESLint owns correctness.
 *
 * The rules that earn their keep here:
 *   - react-hooks/rules-of-hooks      → hook order violations (crashes at runtime)
 *   - react-hooks/exhaustive-deps     → stale-closure bugs in effects
 *   - no-undef                        → the `ytAuthCookies` class of bug: a typo
 *                                       that silently creates a global
 *   - no-dupe-keys / no-dupe-args     → real logic errors
 */
export default [
  {
    ignores: [
      'dist/**',
      'dist-electron/**',
      'node_modules/**',
      'build/**',
      'yt_cache/**',
      'yt_cache_test/**',
      'public/**',
      'assets/**',
      // Tooling data, not source: research clones and scratch scripts live here.
      // Vite already ignores it; ESLint used to choke on a cloned repo's files.
      '.workbuddy-ai/**',
      '*.config.js',
      'test.cjs',
      'test.js',
    ],
  },

  // ── Main process + build scripts (CommonJS, Node) ──────────────────────────
  {
    files: ['electron/**/*.cjs', 'scripts/**/*.cjs', '*.cjs'],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-console': 'off', // the main process legitimately logs
    },
  },

  // ── Renderer (JSX, browser) ────────────────────────────────────────────────
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser },
    },
    settings: { react: { version: '18.3' } },
    plugins: { react, 'react-hooks': reactHooks },
    rules: {
      ...js.configs.recommended.rules,
      ...react.configs.flat.recommended.rules,

      // The new JSX transform means React need not be in scope.
      'react/react-in-jsx-scope': 'off',
      // This codebase uses JSDoc, not PropTypes.
      'react/prop-types': 'off',
      'react/no-unescaped-entities': 'off',
      // Not a bug, and the codebase does it deliberately in a few places.
      'react/display-name': 'off',

      // ── The rules that actually matter ─────────────────────────────────────
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-console': 'off',
    },
  },
]
