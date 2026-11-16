import { test as base, chromium, type BrowserContext } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
const extensionPath = fileURLToPath(new URL('../.output/chrome-mv3', import.meta.url));
const pages: Record<string, string> = {};
const test = base.extend<{ context: BrowserContext; base: string }>({
  context: async ({}, use) => { const c = await chromium.launchPersistentContext('', { channel: 'chromium', executablePath: process.env.ZONESHIFT_CHROMIUM || undefined, timezoneId: 'America/Los_Angeles', args: process.env.NOEXT ? [] : [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`] }); await use(c); await c.close(); },
  base: async ({}, use) => { const s: Server = createServer((q, r) => { r.setHeader('content-type', 'text/html'); r.end(pages[q.url!] ?? ''); }); await new Promise<void>((r) => s.listen(0, '127.0.0.1', r)); await use(`http://127.0.0.1:${(s.address() as AddressInfo).port}`); s.close(); },
});
pages['/caret'] = `<!doctype html><meta charset="utf-8"><body><p id="ready">Ready 1:30 AM UTC</p>
<div id="caret"><p id="cp">Call at 4:30 AM UTC today please.</p></div>
<div id="c2" tabindex="-1"><p>Review at 4:30 AM UTC today please.</p></div>
<script>
const ca = document.getElementById('caret'); ca.addEventListener('mousedown', () => { ca.contentEditable = 'true'; });
const c2 = document.getElementById('c2'); c2.addEventListener('click', () => { c2.contentEditable = 'true'; c2.focus(); });
</script>`;
test('caret', async ({ page, base }) => {
  await page.goto(base + '/caret'); await page.waitForTimeout(800);
  const word = process.env.NOEXT ? '#cp' : '#caret zoneshift-text';
  const box = await page.locator(word).boundingBox();
  await page.mouse.click(box!.x + (process.env.NOEXT ? 80 : box!.width / 2), box!.y + box!.height / 2);
  await page.keyboard.type('X');
  console.log('CARET1', await page.locator('#caret').innerHTML(), await page.evaluate(() => document.body.innerText.slice(0, 200)));
  const b2 = await page.locator('#c2 p').boundingBox();
  await page.mouse.click(b2!.x + 120, b2!.y + b2!.height / 2);
  await page.keyboard.type('Y');
  console.log('CARET2', await page.locator('#c2').innerHTML());
});
pages['/modal'] = `<!doctype html><meta charset="utf-8"><body><p id="ready">Ready 1:30 AM UTC</p>
<dialog id="dlg"><p id="dp">Event at 2:30 AM UTC</p><button id="close">Close</button></dialog>
<script>window.addEventListener('load',()=>setTimeout(()=>document.getElementById('dlg').showModal(),100));</script>`;
test('modal dialog', async ({ page, base }) => {
  await page.goto(base + '/modal'); await page.locator('#dp .zoneshift').waitFor();
  await page.locator('#dp .zoneshift-icon').click();
  await page.waitForTimeout(200);
  const r = await page.evaluate(() => {
    const host = document.getElementById('zoneshift-popover');
    if (!host) return { open: false };
    const b = host.shadowRoot!.querySelector('button')!; const rc = b.getBoundingClientRect();
    const hit = document.elementFromPoint(rc.left + 5, rc.top + 5);
    return { open: true, active: document.activeElement?.tagName + '/' + (document.activeElement as any)?.id, hit: hit?.tagName + '#' + (hit as any)?.id, inert: (host as any).inert };
  });
  console.log('MODAL', JSON.stringify(r));
  await page.screenshot({ path: '/tmp/modal.png' });
  // keyboard path
  await page.keyboard.press('Escape');
  await page.locator('#dp .zoneshift-icon').focus(); await page.keyboard.press('Enter'); await page.keyboard.press('Tab');
  console.log('MODAL-KBD', await page.evaluate(() => ({ popover: !!document.getElementById('zoneshift-popover'), active: document.activeElement?.tagName + '/' + document.activeElement?.id + '/' + document.activeElement?.shadowRoot?.activeElement?.textContent, dlgOpen: (document.getElementById('dlg') as HTMLDialogElement).open })));
  await page.keyboard.press('Escape');
  console.log('MODAL-ESC', await page.evaluate(() => ({ popover: !!document.getElementById('zoneshift-popover'), dlgOpen: (document.getElementById('dlg') as HTMLDialogElement).open })));
});
pages['/paste'] = `<!doctype html><meta charset="utf-8"><body><p id="ready">Ready 1:30 AM UTC</p><p id="src">Launch on Friday, November 13, 2026, at 1:30 AM UTC sharp.</p><div id="ed" contenteditable="true" style="border:1px solid;min-height:40px"></div>`;
test('paste into editor', async ({ page, base, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
  await page.goto(base + '/paste'); await page.locator('#src .zoneshift').waitFor();
  await page.evaluate(() => { const r = document.createRange(); r.selectNodeContents(document.getElementById('src')!); getSelection()!.removeAllRanges(); getSelection()!.addRange(r); });
  await page.keyboard.press('Control+C');
  await page.locator('#ed').click(); await page.keyboard.press('Control+V'); await page.waitForTimeout(500);
  console.log('PASTE', await page.locator('#ed').innerHTML());
});
