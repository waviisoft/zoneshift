import { test as base, chromium, expect, type BrowserContext } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';

const extensionPath = fileURLToPath(new URL('../.output/chrome-mv3', import.meta.url));
type Page = { body: string; type?: string; csp?: string };
const pages: Record<string, Page> = {};
const html = (b: string) => `<!doctype html><meta charset="utf-8"><title>t</title><body>${b}</body>`;

const test = base.extend<{ context: BrowserContext; base: string }>({
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      executablePath: process.env.ZONESHIFT_CHROMIUM || undefined,
      timezoneId: 'America/Los_Angeles',
      args: process.env.NOEXT ? [] : [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    await use(context);
    await context.close();
  },
  base: async ({}, use) => {
    const server: Server = createServer((req, res) => {
      const p = pages[req.url!.split('?')[0]!];
      if (!p) { res.statusCode = 404; res.end(); return; }
      res.setHeader('content-type', p.type ?? 'text/html');
      if (p.csp) res.setHeader('content-security-policy', p.csp);
      res.end(p.body);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    await use(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    server.close();
  },
});
const idle = (ms = 1500) => new Promise((r) => setTimeout(r, ms));

pages['/flex'] = { body: html(`
  <div id="f" style="display:flex; justify-content:space-between; width:600px; font:16px monospace">Starts 1:30 AM UTC today</div>
  <div id="c" style="display:flex; justify-content:space-between; width:600px; font:16px monospace">Starts 1:30 AM xyz today</div>
  <div id="g" style="display:grid; grid-template-columns: 1fr 1fr; width:600px">Opens 1:30 AM UTC daily<span>right</span></div>`) };
test('flex/grid: annotating does not change the number of flex/grid items', async ({ page, base }) => {
  await page.goto(base + '/flex'); await page.locator('.zoneshift').first().waitFor();
  const info = await page.evaluate(() => {
    const r = (el: Element) => { const rg = document.createRange(); rg.selectNodeContents(el); return [...rg.getClientRects()].map((x) => Math.round(x.top)); };
    const g = document.getElementById('g')!;
    const tops = new Set(r(g));
    return { fRects: document.getElementById('f')!.innerHTML, gridRows: tops.size,
      fText: (() => { const f = document.getElementById('f')!; const rg = document.createRange(); rg.selectNodeContents(f); return [...rg.getClientRects()].map((x) => Math.round(x.left)); })() };
  });
  console.log(JSON.stringify(info));
  await page.screenshot({ path: '/tmp/flex.png' });
  // "Starts" sits at the left edge, "today" at the right, and the mark is centred: a gap of hundreds of px.
  const startsRight = await page.evaluate(() => { const f = document.getElementById('f')!; const rg = document.createRange(); rg.selectNodeContents(f.firstChild!); return rg.getBoundingClientRect().right; });
  const markLeft = (await page.locator('#f .zoneshift').boundingBox())!.x;
  expect(markLeft - startsRight).toBeLessThan(20);
});

pages['/svg'] = { body: html(`<svg width="400" height="60"><text id="t" x="0" y="20">Start 1:30 AM UTC end</text><text id="c" x="0" y="50">Start 1:30 AM xyz end</text></svg>`) };
test('svg <text> keeps its rendered text', async ({ page, base }) => {
  await page.goto(base + '/svg'); await idle();
  const r = await page.evaluate(() => ({
    html: document.getElementById('t')!.innerHTML,
    t: (document.getElementById('t') as unknown as SVGTextElement).getComputedTextLength(),
    c: (document.getElementById('c') as unknown as SVGTextElement).getComputedTextLength(),
    chars: (document.getElementById('t') as unknown as SVGTextElement).getNumberOfChars(),
  }));
  console.log(JSON.stringify(r));
  await page.screenshot({ path: '/tmp/svg.png' });
  expect(r.html).toBe('Start 1:30 AM UTC end');
});

pages['/xhtml'] = { type: 'application/xhtml+xml', body: `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>x</title></head><body>
<form><textarea id="ta" name="note">Meet at 1:30 AM UTC please</textarea></form>
<p>Prose 1:30 AM UTC.</p></body></html>` };
test('xhtml: textarea default value is not rewritten', async ({ page, base }) => {
  await page.goto(base + '/xhtml'); await page.locator('p .zoneshift').waitFor();
  const v = await page.evaluate(() => ({ value: (document.getElementById('ta') as HTMLTextAreaElement).value, inner: document.getElementById('ta')!.innerHTML }));
  console.log(JSON.stringify(v));
  expect(v.value).toBe('Meet at 1:30 AM UTC please');
});

pages['/editable'] = { body: html(`<div id="ed" contenteditable="true"><p>Draft</p><span id="chip" contenteditable="false">Due 1:30 AM UTC</span></div>
  <div id="dm" style="-webkit-user-modify: read-write">Plain 1:30 AM UTC</div>
  <div id="later"><p>Meeting at 1:30 AM UTC.</p></div>`) };
test('editable regions: non-editable islands inside an editor are left alone', async ({ page, base }) => {
  await page.goto(base + '/editable'); await page.locator('#later .zoneshift').waitFor();
  console.log(JSON.stringify(await page.evaluate(() => ({ chip: document.getElementById('chip')!.innerHTML, dm: document.getElementById('dm')!.innerHTML }))));
  await expect(page.locator('#chip .zoneshift')).toHaveCount(0);
});
test('editable: a document that becomes editable carries the marks into what is saved', async ({ page, base }) => {
  await page.goto(base + '/editable'); await page.locator('#later .zoneshift').waitFor();
  const saved = await page.evaluate(() => { const d = document.getElementById('later')!; d.contentEditable = 'true'; return d.innerHTML; });
  console.log(saved);
  expect(saved).not.toContain('zoneshift');
});

pages['/copy'] = { body: html(`<p id="p">Maintenance starts Friday, November 13, 2026, at 1:30 AM UTC and ends soon.</p><div id="sink" contenteditable="true"></div>`) };
test('copy: selection text and pasted HTML', async ({ page, base, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
  await page.goto(base + '/copy'); await page.locator('.zoneshift').waitFor();
  const sel = await page.evaluate(() => { const r = document.createRange(); r.selectNodeContents(document.getElementById('p')!); const s = getSelection()!; s.removeAllRanges(); s.addRange(r); return s.toString(); });
  await page.keyboard.press('Control+C');
  const clip = await page.evaluate(async () => { const items = await navigator.clipboard.read(); const out: Record<string, string> = {}; for (const it of items) for (const t of it.types) out[t] = await (await it.getType(t)).text(); return out; });
  console.log(JSON.stringify({ sel, clip }));
  expect(clip['text/html'] ?? '').not.toContain('zoneshift-icon');
});

pages['/a11y'] = { body: html(`<p>Before <a href="#x">link</a></p><p id="p">At 1:30 AM UTC.</p><p><a id="after" href="#y">after</a></p>
  <div id="row" tabindex="0">Ticket 2:30 AM UTC</div>
  <form id="frm" action="/submitted"><button id="btn" type="submit">Send at 3:30 AM UTC</button></form>
  <p><a id="md" href="#z">Down 4:30 AM UTC</a></p>`) };
pages['/submitted'] = { body: html('submitted') };
test('a11y: focus returns to the icon after Escape and after an action', async ({ page, base }) => {
  await page.goto(base + '/a11y'); await page.locator('.zoneshift').first().waitFor();
  const icon = page.locator('#p .zoneshift-icon');
  await icon.focus(); await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  const afterEsc = await page.evaluate(() => document.activeElement?.className || document.activeElement?.tagName);
  await icon.focus(); await page.keyboard.press('Enter');
  await page.keyboard.press('Enter'); // activates "Show original here"
  const afterAction = await page.evaluate(() => document.activeElement?.className || document.activeElement?.tagName);
  await icon.focus(); await page.keyboard.press('Enter');
  await page.keyboard.press('Shift+Tab');
  const shiftTab = await page.evaluate(() => ({ el: document.activeElement?.id || document.activeElement?.className || document.activeElement?.tagName, open: !!document.getElementById('zoneshift-popover') }));
  console.log(JSON.stringify({ afterEsc, afterAction, shiftTab }));
  expect(afterEsc).toBe('zoneshift-icon');
  expect(afterAction).toBe('zoneshift-icon');
});
test('a11y: icon in a submit button does not submit; Space on focused icon', async ({ page, base }) => {
  await page.goto(base + '/a11y'); await page.locator('#btn .zoneshift').waitFor();
  await page.locator('#btn .zoneshift-icon').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(page.url()).not.toContain('submitted');
  await page.keyboard.press('Escape');
  await page.locator('#btn .zoneshift-icon').focus();
  await page.keyboard.press(' ');
  await idle(300);
  console.log('after space url', page.url(), 'dialog', await page.getByRole('dialog').count());
  expect(page.url()).not.toContain('submitted');
});
test('a11y: pointer events on the icon reach the link (mousedown-navigating sites)', async ({ page, base }) => {
  await page.goto(base + '/a11y'); await page.locator('#md .zoneshift').waitFor();
  await page.evaluate(() => { (window as any).hits = []; for (const t of ['pointerdown', 'mousedown', 'mouseup', 'keydown']) document.getElementById('md')!.addEventListener(t, () => (window as any).hits.push(t)); });
  await page.locator('#md .zoneshift-icon').click();
  console.log('hits', await page.evaluate(() => (window as any).hits));
  const ax = await page.locator('#p .zoneshift-icon').evaluate((e) => ({ name: e.getAttribute('aria-label'), role: e.getAttribute('role'), haspopup: e.getAttribute('aria-haspopup'), expanded: e.getAttribute('aria-expanded') }));
  console.log(JSON.stringify(ax));
});

pages['/tt'] = { csp: "require-trusted-types-for 'script'; trusted-types 'none'; default-src 'none'", body: html(`<p id="p">At 1:30 AM UTC.</p>`) };
test('trusted types + strict CSP', async ({ page, base }) => {
  const errs: string[] = []; page.on('console', (m) => errs.push(m.type() + ': ' + m.text()));
  await page.goto(base + '/tt'); await page.locator('.zoneshift').waitFor();
  await page.locator('.zoneshift-icon').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  const bg = await page.evaluate(() => { const h = document.getElementById('zoneshift-popover')!; return getComputedStyle(h.shadowRoot!.querySelector('.box')!).backgroundColor; });
  console.log('tt', bg, errs);
});

pages['/svgdoc.svg'] = { type: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="50"><text x="0" y="20">At 1:30 AM UTC</text></svg>` };
pages['/doc.xml'] = { type: 'application/xml', body: `<?xml version="1.0"?><root><when>1:30 AM UTC</when></root>` };
test('xml and svg documents', async ({ page, base }) => {
  const msgs: string[] = []; page.on('console', (m) => msgs.push(m.type() + ': ' + m.text())); page.on('pageerror', (e) => msgs.push('pageerror ' + e.message));
  await page.goto(base + '/svgdoc.svg'); await idle();
  const svg = await page.evaluate(() => document.documentElement.outerHTML);
  await page.goto(base + '/doc.xml'); await idle();
  const xml = await page.evaluate(() => document.documentElement.outerHTML.slice(0, 300));
  console.log(JSON.stringify({ svg, xml, msgs }));
});

pages['/rtl'] = { body: html(`<p id="r" dir="rtl" style="font:20px sans-serif">الاجتماع في 1:30 AM UTC غدا</p><h1 id="h">Launch 1:30 AM UTC</h1><p style="font-size:10px" id="s">Small 1:30 AM UTC</p>`) };
test('rtl and size', async ({ page, base }) => {
  await page.goto(base + '/rtl'); await page.locator('.zoneshift').first().waitFor();
  const t = await page.locator('#r .zoneshift > span').first().boundingBox();
  const i = await page.locator('#r .zoneshift-icon').boundingBox();
  const h = await page.locator('#h .zoneshift-icon').boundingBox();
  const s = await page.locator('#s .zoneshift-icon').boundingBox();
  console.log(JSON.stringify({ text: t, icon: i, h1: h, small: s }));
  await page.locator('#r').screenshot({ path: '/tmp/rtl.png' });
});

pages['/shadow'] = { body: html(`<div id="host"></div><script>/*inline allowed*/</script>`) };

const lt = `<script>window.__lt=[];new PerformanceObserver(l=>{for(const e of l.getEntries())window.__lt.push(Math.round(e.duration))}).observe({type:'longtask',buffered:true});</script>`;
{
  const lines: string[] = [];
  for (let i = 0; i < 50000; i++) lines.push(`2026-11-13T01:${String(i % 60).padStart(2, '0')}:00Z INFO request ${i} served`);
  pages['/biglog'] = { body: html(lt + `<pre id="log">${lines.join('\n')}</pre>`) };
  const paras: string[] = [];
  for (let i = 0; i < 20000; i++) paras.push(`<p>Item ${i} posted Nov 13, 2026 1:30 AM UTC by someone.</p>`);
  pages['/bigprose'] = { body: html(lt + paras.join('')) };
}
for (const [path, n] of [['/biglog', 50000], ['/bigprose', 20000]] as const) {
  test(`perf ${path}`, async ({ page, base }) => {
    test.setTimeout(180000);
    const t0 = Date.now();
    await page.goto(base + path);
    const tLoad = Date.now() - t0;
    if (process.env.NOEXT) { await idle(3000); console.log(path, 'baseline', tLoad, JSON.stringify(await page.evaluate(() => (window as any).__lt))); return; }
    await page.waitForFunction((n) => document.querySelectorAll('.zoneshift').length >= n, n, { timeout: 170000, polling: 500 });
    const tAll = Date.now() - t0;
    const lts = await page.evaluate(() => (window as any).__lt);
    const t1 = Date.now();
    await page.locator('.zoneshift-icon').first().click();
    await page.getByRole('button', { name: /all times/ }).click();
    await page.waitForFunction(() => !document.querySelector('.zoneshift[data-zs-state="original"]'));
    const tSetAll = Date.now() - t1;
    await idle(1500);
    const lts2 = await page.evaluate(() => (window as any).__lt);
    console.log(path, JSON.stringify({ tLoad, tAll, longtasks: lts.sort((a: number, b: number) => b - a).slice(0, 5), tSetAll, longtasksAfter: lts2.slice(lts.length).sort((a: number, b: number) => b - a).slice(0, 5) }));
  });
}

pages['/stream'] = { body: html(lt + `<pre id="log"></pre><script>let i=0;const log=document.getElementById('log');window.__start=performance.now();const t=setInterval(()=>{for(let k=0;k<20;k++){const s=String(i%60).padStart(2,'0');log.append('2026-11-13T01:'+s+':00Z INFO line '+(i++)+'\\n');}if(i>=10000)clearInterval(t);},10);</script>`) };
test('perf streaming log', async ({ page, base }) => {
  test.setTimeout(120000);
  await page.goto(base + '/stream');
  await page.waitForFunction(() => document.getElementById('log')!.textContent!.includes('line 9999'), null, { timeout: 100000 });
  await idle(1000);
  const r = await page.evaluate(() => ({ marks: document.querySelectorAll('.zoneshift').length, nodes: document.getElementById('log')!.childNodes.length, lt: (window as any).__lt.length, ltMax: Math.max(0, ...(window as any).__lt), elapsed: Math.round(performance.now() - (window as any).__start) }));
  console.log('stream', JSON.stringify(r));
});

pages['/rerender'] = { body: html(`<p id="clock"></p><script>let n=0;window.__sets=0;const el=document.getElementById('clock');function render(){const want='Server time 1:30 AM UTC';if(el.textContent!==want){el.textContent=want;window.__sets++;}}render();setInterval(render,50);</script>`) };
test('re-render loop: page that restores its text when it differs', async ({ page, base }) => {
  await page.goto(base + '/rerender');
  await idle(3000);
  const r = await page.evaluate(() => ({ sets: (window as any).__sets, text: document.getElementById('clock')!.textContent }));
  console.log('rerender', JSON.stringify(r));
});

pages['/sitecss'] = { body: `<!doctype html><meta charset="utf-8"><style>
  .meta span { font-weight: 700; color: rgb(200, 0, 0); padding: 0 6px; border: 1px solid rgb(0, 0, 0); }
  .meta span + span::before { content: " · "; }
</style><body><p class="meta" id="m"><span>by Bob</span> posted 1:30 AM UTC</p></body>` };
test('site CSS that targets spans restyles the time and the icon', async ({ page, base }) => {
  await page.goto(base + '/sitecss'); await page.locator('.zoneshift').waitFor();
  const r = await page.evaluate(() => {
    const text = document.querySelector('#m .zoneshift > span')!; const icon = document.querySelector('#m .zoneshift-icon')!;
    const cs = getComputedStyle(text); const ic = getComputedStyle(icon); const mk = getComputedStyle(document.querySelector('#m .zoneshift')!);
    return { textWeight: cs.fontWeight, textColor: cs.color, markBorder: mk.borderTopWidth, markPad: mk.paddingLeft, iconPad: ic.paddingLeft, iconBorderColor: ic.borderTopColor, iconBefore: getComputedStyle(icon, '::before').content };
  });
  console.log('sitecss', JSON.stringify(r));
  await page.locator('#m').screenshot({ path: '/tmp/sitecss.png' });
});

pages['/turbo'] = { body: html(`<p>First page 1:30 AM UTC</p>`) };
test('body replaced (Turbo-style navigation) is still annotated', async ({ page, base }) => {
  await page.goto(base + '/turbo'); await page.locator('.zoneshift').waitFor();
  await page.evaluate(() => { const b = document.createElement('body'); b.innerHTML = '<p id="n">Second page 2:30 AM UTC</p>'; document.body.replaceWith(b); });
  await idle(1000);
  await page.evaluate(() => { const p = document.createElement('p'); p.id = 'n2'; p.textContent = 'Later 3:30 AM UTC'; document.body.append(p); });
  await idle(1000);
  console.log('turbo', await page.locator('.zoneshift').count(), await page.locator('body').innerText());
});

pages['/scroll'] = { body: html(`<div id="box" style="height:80px;overflow:auto"><div style="height:2000px">x</div></div><p id="p">At 1:30 AM UTC.</p>
<script>setInterval(()=>{const b=document.getElementById('box');b.scrollTop+=5;},300)</script>`) };
test('an auto-scrolling region elsewhere closes the popover', async ({ page, base }) => {
  await page.goto(base + '/scroll'); await page.locator('.zoneshift').waitFor();
  await page.locator('#p .zoneshift-icon').click();
  await idle(700);
  console.log('scroll: popover open after 700ms =', await page.getByRole('dialog').count());
});

pages['/esc'] = { body: html(`<div id="modal" role="dialog" aria-label="Site modal">Site modal: event at 1:30 AM UTC</div>
<script>document.addEventListener('keydown',e=>{if(e.key==='Escape')document.getElementById('modal').remove();});</script>`) };
test('Escape that closes the popover also closes the site modal', async ({ page, base }) => {
  await page.goto(base + '/esc'); await page.locator('.zoneshift').waitFor();
  await page.locator('.zoneshift-icon').click();
  await page.keyboard.press('Escape');
  console.log('esc: zoneshift popover', await page.locator('#zoneshift-popover').count(), 'site modal', await page.locator('#modal').count());
});
