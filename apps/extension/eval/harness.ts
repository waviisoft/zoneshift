import { test as base, chromium, type BrowserContext, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Loads one built variant (EXT=/tmp/zs-ext/<variant>, see ../eval-build.sh)
 * into Chromium, zone Los Angeles. NOEXT=1 runs without any extension.
 * Pages are served with a strict CSP unless `csp: false`.
 */
export const EXT = process.env.EXT ?? '/tmp/zs-ext/mark';
export const VARIANT = process.env.NOEXT ? 'none' : EXT.split('/').pop()!;
export const STRICT = "default-src 'none'; style-src 'nonce-fixture'; script-src 'nonce-fixture'";
export type Fixture = { body: string; type?: string; csp?: string | false };
export const pages: Record<string, Fixture> = {};
export const html = (body: string, css = '', script = '') =>
  `<!doctype html><meta charset="utf-8"><title>t</title><style nonce="fixture">${css}</style><body><p id="ready">Ready at 1:30 AM UTC.</p>${body}${
    script ? `<script nonce="fixture">${script}</script>` : ''
  }</body>`;

export const test = base.extend<{ context: BrowserContext; base: string }>({
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      executablePath: process.env.ZONESHIFT_CHROMIUM || undefined,
      timezoneId: 'America/Los_Angeles',
      viewport: { width: 1000, height: 800 },
      args: process.env.NOEXT ? [] : [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
    });
    await use(context);
    await context.close();
  },
  base: async ({}, use) => {
    const server: Server = createServer((req, res) => {
      const p = pages[req.url!.split('?')[0]!];
      if (!p) {
        res.statusCode = 404;
        res.end();
        return;
      }
      res.setHeader('content-type', p.type ?? 'text/html');
      if (p.csp !== false) res.setHeader('content-security-policy', p.csp ?? STRICT);
      res.end(p.body);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    await use(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    server.close();
  },
});

export async function open(page: Page, url: string) {
  await page.goto(url);
  if (process.env.NOEXT) await page.waitForTimeout(300);
  else await page.waitForFunction(() => document.getElementById('ready')!.textContent !== null && (document.querySelector('zoneshift-run, zoneshift-mark') || (document.getElementById('ready') as any).shadowRoot || document.querySelector('#ready zoneshift-run')), null, { timeout: 10000 });
  await page.waitForTimeout(300);
}
export const out = (label: string, value: unknown) => console.log(`[${VARIANT}] ${label}: ${typeof value === 'string' ? value : JSON.stringify(value)}`);

/** Page-side helpers (added through CDP, so not blocked by the page's CSP). Open roots only. */
export async function helpers(page: Page) {
  await page.addInitScript(() => {
    const roots = (): ShadowRoot[] => {
      const out: ShadowRoot[] = [];
      for (const el of document.querySelectorAll('*')) if (el.shadowRoot && el.id !== 'zoneshift-popover') out.push(el.shadowRoot);
      return out;
    };
    (window as any).__zs = {
      roots,
      marks: () => roots().flatMap((r) => [...r.querySelectorAll<HTMLElement>('.m')]),
      icons: () => [
        ...roots().flatMap((r) => [...r.querySelectorAll<HTMLElement>('.i')]),
        ...document.querySelectorAll<HTMLElement>('zoneshift-icon'),
      ],
      /** What the reader sees: text of the flat tree. */
      shown: (el: Element): string => {
        const walk = (n: Node): string => {
          if (n.nodeType === 3) return (n as Text).data;
          if (n.nodeType !== 1) return '';
          const e = n as Element;
          if (e.localName === 'style') return '';
          if (e.localName === 'slot') return (e as HTMLSlotElement).assignedNodes().map(walk).join('');
          if (e.localName === 'zoneshift-icon') return '';
          if (e.shadowRoot) return [...e.shadowRoot.childNodes].map(walk).join('');
          return [...e.childNodes].map(walk).join('');
        };
        return walk(el);
      },
    };
  });
}
