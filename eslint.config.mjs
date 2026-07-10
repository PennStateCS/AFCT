import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { FlatCompat } from '@eslint/eslintrc';
import eslintConfigPrettier from 'eslint-config-prettier';
import pluginQuery from '@tanstack/eslint-plugin-query';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  // Global ignores (previously handled implicitly by `next lint`): build output,
  // generated files, deps, and static assets should not be linted.
  {
    ignores: [
      '.next/**',
      '.claude/**', // scratch git worktrees and agent state, not project source
      'node_modules/**',
      'coverage/**',
      'next-env.d.ts',
      'public/**',
      'src/generated/**',
      'src/types/api.ts', // generated from the OpenAPI spec by `npm run docs:types`
    ],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  // TanStack Query correctness rules: stable QueryClient, exhaustive query-key
  // deps, no void queryFn, correct infinite-query/mutation property order, etc.
  ...pluginQuery.configs['flat/recommended'],
  {
    // require() is idiomatic (and hoisting-safe) inside vitest `vi.mock` factories,
    // which are hoisted above the file's imports. Enforce ESM imports only in
    // non-test code.
    files: ['**/*.test.ts', '**/*.test.tsx'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      // Test doubles and partial mocks routinely need `any` to stub shapes the
      // production types would otherwise force us to fully construct. Relax it
      // for tests only; production code stays strict.
      '@typescript-eslint/no-explicit-any': 'off',
      // Inline mock components (e.g. vi.mock factories) don't need display names.
      'react/display-name': 'off',
    },
  },
  {
    rules: {
      // Honor the conventional `_` prefix for intentionally-unused identifiers.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      // Type-only imports must use `import type`, so the compiler and bundler can
      // erase them cleanly (pairs with verbatimModuleSyntax in tsconfig). Inline
      // `import()` type annotations are left alone: they already erase fine and a
      // few test files rely on them.
      '@typescript-eslint/consistent-type-imports': ['error', { disallowTypeAnnotations: false }],
    },
  },
  // Type-aware linting for source code (not tests). These rules need the TS
  // program, so we turn on projectService here and scope it to src, away from the
  // test files (already relaxed above and noisy for these checks). The headline
  // rule is no-floating-promises, which flags unawaited promises.
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    ignores: ['**/*.test.ts', '**/*.test.tsx'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: __dirname,
      },
    },
    rules: {
      // No `any` in source (tests keep it relaxed above). Source is already clean;
      // the JFF/CFG viewers keep their own file-scoped disables where XML parsing
      // genuinely needs it.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      // Real misuse (e.g. an async fn in an `if`) is an error; the noisy JSX
      // `onClick={async …}` void-return case is allowed via attributes:false.
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false } },
      ],
    },
  },
  // Last: turn off any ESLint rules that would conflict with Prettier formatting.
  eslintConfigPrettier,
];

export default eslintConfig;
