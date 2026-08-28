import tsparser from '@typescript-eslint/parser';
import { defineConfig } from 'eslint/config';
import obsidianmd from 'eslint-plugin-obsidianmd';

export default defineConfig([
  {
    // vendored minified decoder + the base64 silk.wasm payload (src/vendor/):
    // verbatim third-party output shipped as plain JavaScript, never edited
    ignores: ['src/vendor/**'],
  },
  ...obsidianmd.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: { project: './tsconfig.json' },
    },
  },
  {
    // tests/ runs in Node, not inside Obsidian: `window.setTimeout`
    // does not exist there, the transport is Node's fetch (not requestUrl),
    // and progress output via console is the whole point of the smoke CLI.
    // In-file disable comments are not an option — the reviewer ruleset
    // forbids them via eslint-comments/no-restricted-disable — so these
    // runtime-guideline rules are exempted here at the config level.
    files: ['tests/**/*.ts'],
    rules: {
      'no-console': 'off',
      'obsidianmd/rule-custom-message': 'off',
      'obsidianmd/prefer-window-timers': 'off',
      'obsidianmd/no-global-this': 'off',
      'no-restricted-globals': 'off',
    },
  },
]);
