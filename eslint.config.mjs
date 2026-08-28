import tsparser from '@typescript-eslint/parser';
import { defineConfig } from 'eslint/config';
import obsidianmd from 'eslint-plugin-obsidianmd';

export default defineConfig([
  {
    // machine-generated artifacts: a minified vendored decoder and the
    // base64-encoded silk.wasm payload. Neither is hand-written source.
    ignores: ['src/core/silk-decoder.ts', 'src/core/silk-data.ts'],
  },
  ...obsidianmd.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: { project: './tsconfig.json' },
    },
  },
]);
