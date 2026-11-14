import { defineConfig } from '@playwright/test';
// Evaluation of #34 (shadow-DOM rendering). Not part of CI.
export default defineConfig({ testDir: '.', testMatch: '*.eval.ts', reporter: 'list', workers: 1, timeout: 120000 });
