import { test as base, chromium, expect, type BrowserContext } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';

/**
 * Loads the built Chrome extension (run `pnpm build:chrome` first) into
 * Chromium with the browser zone set to Los Angeles, and drives a real page.
 */

const extensionPath = fileURLToPath(new URL('../.output/chrome-mv3', import.meta.url));
const fixture = readFileSync(new URL('./fixtures/page.html', import.meta.url));

const test = base.extend<{ context: BrowserContext; url: string }>({
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      // Set to use an already-installed Chromium instead of Playwright's download.
      executablePath: process.env.ZONESHIFT_CHROMIUM || undefined,
      timezoneId: 'America/Los_Angeles',
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    await use(context);
    await context.close();
  },
  url: async ({}, use) => {
    const server: Server = createServer((_req, res) => {
      res.setHeader('content-type', 'text/html');
      // A strict policy: only the fixture's own stylesheet is allowed, so the
      // extension must work without inline styles, scripts or images.
      res.setHeader('content-security-policy', "default-src 'none'; style-src 'nonce-fixture'");
      res.end(fixture);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    await use(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`);
    server.close();
  },
});

test.beforeEach(async ({ page, url }) => {
  await page.goto(url);
  await page.locator('.zoneshift').first().waitFor();
});

test('converts prose and leaves technical timestamps until asked', async ({ page }) => {
  await expect(page.locator('#prose')).toHaveText(
    'Maintenance starts Thursday, November 12, 2026, at 5:30 PM PST and should take an hour.',
  );
  await expect(page.locator('#link')).toHaveText('Nov 20, 2026 7:00 AM PST');
  await expect(page.locator('#iso')).toHaveText('Build finished at 2026-11-13T04:10:09Z according to the API.');
  await expect(page.locator('#log')).toContainText('2026-11-13T01:30:00Z INFO  server started');
  await expect(page.locator('#plain .zoneshift')).toHaveCount(0);
  await expect(page.locator('.zoneshift[data-zs-state="original"]')).toHaveCount(3);
});

test('shows a clock icon and leaves the site text styling alone', async ({ page }) => {
  const icon = page.locator('#prose .zoneshift-icon');
  await expect(icon).toBeVisible();
  const box = await icon.boundingBox();
  expect(box!.width).toBeGreaterThan(6);
  expect(Math.abs(box!.width - box!.height)).toBeLessThan(1);
  // The stylesheet applied despite the page's content-security policy.
  await expect(icon).toHaveCSS('border-top-left-radius', '50%');
  await expect(icon).toHaveCSS('background-color', 'rgb(37, 99, 235)');
  await expect(page.locator('#link .zoneshift-icon')).toHaveCSS('background-color', 'rgb(217, 119, 6)');
  await expect(page.locator('#link')).toHaveCSS('text-decoration-style', 'wavy');
  await expect(page.locator('#link .zoneshift')).toHaveCSS('text-decoration-line', 'none');
});

test('popover converts one timestamp, then the whole page', async ({ page }) => {
  await page.locator('#log .zoneshift-icon').first().click();
  const dialog = page.getByRole('dialog', { name: 'Zoneshift' });
  await expect(dialog).toContainText('2026-11-12T17:30:00-08:00');
  await dialog.getByRole('button', { name: 'Convert to local time' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('#log')).toContainText('2026-11-12T17:30:00-08:00 INFO');
  await expect(page.locator('#log')).toContainText('2026-11-13T01:30:02Z WARN');

  await page.locator('#iso .zoneshift-icon').click();
  await page.getByRole('button', { name: 'Convert all times on this page' }).click();
  await expect(page.locator('.zoneshift[data-zs-state="original"]')).toHaveCount(0);
  await expect(page.locator('#log')).toContainText('2026-11-12T17:30:02-08:00 WARN');

  await page.locator('#iso .zoneshift-icon').click();
  await page.getByRole('button', { name: 'Show all originals on this page' }).click();
  await expect(page.locator('#prose')).toContainText('Friday, November 13, 2026, at 1:30 AM UTC');
});

test('icon inside a link opens the popover instead of navigating', async ({ page, url }) => {
  await page.locator('#link .zoneshift-icon').click();
  await expect(page.getByRole('dialog', { name: 'Zoneshift' })).toContainText('ambiguous');
  expect(page.url()).toBe(url);
  await page.getByRole('button', { name: 'Show original here' }).click();
  await expect(page.locator('#link')).toHaveText('Nov 20, 2026 9:00 AM CST');
});

test('popover is keyboard-accessible and closes on Escape', async ({ page }) => {
  await page.locator('#prose .zoneshift-icon').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Zoneshift' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Zoneshift' })).toHaveCount(0);
});

test('content added later follows the page-wide choice', async ({ page }) => {
  await page.locator('#iso .zoneshift-icon').click();
  await page.getByRole('button', { name: 'Convert all times on this page' }).click();
  await page.evaluate(() => {
    document.getElementById('late')!.textContent = 'Added later: 2026-11-13T09:00:00Z';
  });
  await expect(page.locator('#late')).toHaveText('Added later: 2026-11-13T01:00:00-08:00');
});
