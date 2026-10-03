import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const unused = { argsIgnorePattern: '^_', caughtErrors: 'none' };

export default defineConfig(
  { ignores: ['dist/**', 'node_modules/**', '.notion-test-runs/**'] },
  {
    files: ['**/*.{ts,cjs,mjs}'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['**/*.{cjs,mjs}'],
    extends: [js.configs.recommended],
    rules: { 'no-unused-vars': ['error', unused] },
  },
  {
    files: ['**/*.ts'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    rules: {
      // API境界と既存のテスト用モデルではanyを許容する。
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', unused],
    },
  },
);
