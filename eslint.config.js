// Flat-config ESLint. Run with `npm run lint`.
//
// Two environments share the repo: the server (Node, no DOM) and the web app
// (browser globals + React + JSX). Tests use vitest globals. Rules that would
// need per-file types (type-aware linting) are deliberately skipped to keep lint
// fast and to avoid coupling to the per-workspace tsconfigs.

import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'server/admin.db*', '*.config.ts'] },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Everything: TS + JS test files under src, plus shared.
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: { sourceType: 'module' },
      globals: {
        // Node everywhere — tests run under vitest, config files under node.
        process: 'readonly',
        console: 'readonly',
        require: 'readonly',
        __dirname: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
      },
    },
  },

  // Server: pure Node, no browser.
  {
    files: ['server/**/*.ts'],
    languageOptions: {
      globals: {
        global: 'readonly',
        AbortController: 'readonly',
        structuredClone: 'readonly',
      },
    },
  },

  // Web app: browser globals.
  {
    files: ['web/**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        location: 'readonly',
        history: 'readonly',
        localStorage: 'readonly',
        sessionStorage: 'readonly',
        fetch: 'readonly',
        requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly',
        HTMLCanvasElement: 'readonly',
        SVGSVGElement: 'readonly',
        Event: 'readonly',
        MouseEvent: 'readonly',
        KeyboardEvent: 'readonly',
        HTMLElement: 'readonly',
        Node: 'readonly',
        Element: 'readonly',
        NodeJS: 'readonly',
        matchMedia: 'readonly',
        getComputedStyle: 'readonly',
        CustomEvent: 'readonly',
        Blob: 'readonly',
        FileReader: 'readonly',
        Image: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },

  // Server: Fastify handlers are typed via the `any` request/reply from its
  // plugin types rather than hand-written generics, so `any` is the codebase
  // convention there. Keep the errors that actually catch bugs.
  {
    files: ['server/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },

  // Tests: vitest globals.
  {
    files: ['**/*.test.{ts,tsx}', '**/*.test.js'],
    languageOptions: {
      globals: {
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        vi: 'readonly',
      },
    },
  },

  prettier,
)
