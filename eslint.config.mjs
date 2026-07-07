import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { FlatCompat } from '@eslint/eslintrc';
import eslintConfigPrettier from 'eslint-config-prettier';

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
      'node_modules/**',
      'coverage/**',
      'next-env.d.ts',
      'public/**',
      'src/generated/**',
      'src/types/api.ts', // generated from the OpenAPI spec by `npm run docs:types`
    ],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
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
    },
  },
  // Last: turn off any ESLint rules that would conflict with Prettier formatting.
  eslintConfigPrettier,
];

export default eslintConfig;
