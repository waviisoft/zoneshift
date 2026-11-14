import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

/** Checks the built Chrome manifest (run `pnpm build:chrome` first). */
const manifest = JSON.parse(readFileSync(new URL('../.output/chrome-mv3/manifest.json', import.meta.url), 'utf8'));

test('the Chrome build asks for no permissions', () => {
  // Every permission must be agreed with the owner first.
  expect(manifest.permissions ?? []).toEqual([]);
  expect(manifest.optional_permissions ?? []).toEqual([]);
  expect(manifest.host_permissions ?? []).toEqual([]);
});

test('the Chrome build carries no Firefox-only keys', () => {
  expect(manifest.browser_specific_settings).toBeUndefined();
});
