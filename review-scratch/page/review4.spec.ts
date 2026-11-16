import { test as base, chromium, type BrowserContext, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
const extensionPath = process.env.EXT || fileURLToPath(new URL('../.output/chrome-mv3', import.meta.url));
const pages: Record<string, string> = {};
const test = base.extend<{ context: BrowserContext; base: string }>({
  context: async ({}, use) => { const c = await chromium.launchPersistentContext('', { channel: 'chromium', executablePath: process.env.ZONESHIFT_CHROMIUM || undefined, timezoneId: 'America/Los_Angeles', args: process.env.NOEXT ? [] : [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`] }); await use(c); await c.close(); },
  base: async ({}, use) => { const s: Server = createServer((q, r) => { r.setHeader('content-type', 'text/html'); r.end(pages[q.url!.split('?')[0]!] ?? ''); }); await new Promise<void>((r) => s.listen(0, '127.0.0.1', r)); await use(`http://127.0.0.1:${(s.address() as AddressInfo).port}`); s.close(); },
});
const H = (b: string, css = '') => `<!doctype html><meta charset="utf-8"><style>${css}</style><body><p id="ready">Ready 1:30 AM UTC</p>${b}</body>`;
async function copyOf(page: Page, setup: string) {
  await page.evaluate(setup);
  await page.keyboard.press('Control+C');
  return page.evaluate(async () => { const o: Record<string, string> = {}; for (const it of await navigator.clipboard.read()) for (const t of it.types) o[t] = await (await it.getType(t)).text(); return o; });
}
const sel = (start: string, end: string) => `(() => { const r = document.createRange(); r.setStartBefore(document.querySelector('${start}')); r.setEndAfter(document.querySelector('${end}')); getSelection().removeAllRanges(); getSelection().addRange(r); })()`;
pages['/copy'] = H(`
<div id="a"><h2 id="h">Launch <b>notes</b></h2><p id="p1">See <a href="/docs/launch" id="lnk">the docs</a> <span class="sr-only">(opens in new tab)</span> before 1:30 AM UTC.</p>
<p id="p2"><span class="ln" style="user-select:none">42</span> Deploy 2:30 AM UTC <img src="/logo.png" alt="logo" width="10"></p></div>
<table id="t"><tr><td id="c1">Start</td><td id="c2">1:30 AM UTC</td></tr><tr><td>End</td><td id="c4">3:30 AM UTC</td></tr></table>
<p id="nm">No marks here, just <a href="/x">a link</a>.</p>
<div id="own"><p id="op">Own handler 4:30 AM UTC</p></div>
<p id="part">Window opens Friday, November 13, 2026, at 1:30 AM UTC for all.</p>
<input id="in" value="type 1:30 AM UTC here">
`, `.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)} h2{color:rgb(200,0,0)} .hidden{display:none}`);
test('copy handler', async ({ page, base, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
  await page.goto(base + '/copy'); await page.waitForTimeout(800);
  const strip = (s?: string) => (s ?? '').replace(/ style="[^"]*"/g, '').replace(/<meta[^>]*>/, '');
  const out: Record<string, unknown> = {};
  let c = await copyOf(page, sel('#h', '#p2')); out.block = { plain: c['text/plain'], html: strip(c['text/html']) };
  c = await copyOf(page, sel('#c1', '#c4')); out.table = { plain: JSON.stringify(c['text/plain']), html: strip(c['text/html']) };
  c = await copyOf(page, sel('#nm', '#nm')); out.nomarks = strip(c['text/html']).slice(0, 200);
  // selection partly inside a mark: from the middle of the converted time into the following text
  if (!process.env.NOEXT) { c = await copyOf(page, `(() => { const t = document.querySelector('#part zoneshift-text').firstChild; const r = document.createRange(); r.setStart(t, 12); r.setEnd(document.querySelector('#part zoneshift-run').lastChild, 4); getSelection().removeAllRanges(); getSelection().addRange(r); })()`);
  out.partial = { plain: c['text/plain'], html: strip(c['text/html']) }; }
  // site handler that sets data and stops propagation but does not preventDefault
  await page.evaluate(() => document.getElementById('own')!.addEventListener('copy', (e) => { e.stopPropagation(); }));
  c = await copyOf(page, sel('#op', '#op')); out.siteStops = strip(c['text/html']);
  // input selection
  await page.locator('#in').focus(); await page.locator('#in').selectText(); await page.keyboard.press('Control+C');
  out.input = await page.evaluate(async () => (await navigator.clipboard.readText()));
  console.log('COPY4', JSON.stringify(out, null, 1));
});
pages['/pre'] = H(`<pre id="log">2026-11-13T01:30:00Z INFO  server started
2026-11-13T01:30:02Z WARN  cache cold
2026-11-13T01:30:05Z INFO  ready</pre><p>x</p>`);
test('copy from pre', async ({ page, base, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
  await page.goto(base + '/pre'); await page.waitForTimeout(800);
  const c = await copyOf(page, `(() => { const p = document.getElementById('log'); const r = document.createRange(); const walker = document.createTreeWalker(p, 4); const texts = []; while (walker.nextNode()) texts.push(walker.currentNode); r.setStart(texts[0], 0); const last = texts[texts.length - 1]; r.setEnd(last, last.data.length); getSelection().removeAllRanges(); getSelection().addRange(r); })()`);
  // paste into a contenteditable to see how it renders
  await page.evaluate(() => { const d = document.createElement('div'); d.id = 'sink'; d.contentEditable = 'true'; document.body.append(d); });
  await page.locator('#sink').click(); await page.keyboard.press('Control+V'); await page.waitForTimeout(300);
  console.log('PRE', JSON.stringify({ plain: c['text/plain'], html: (c['text/html'] ?? '').replace(/ style="[^"]*"/g, ' style=…'), pastedText: await page.locator('#sink').innerText() }, null, 1));
});
pages['/snap'] = H(`
<div id="s1"><p>Meeting at 1:30 AM UTC.</p></div>
<dialog id="dlg"><div id="dc"><p>In dialog 2:30 AM UTC</p></div><button id="x">x</button></dialog>
<div id="fight"><p>Fight 3:30 AM UTC.</p></div>
<div id="evil"></div>
<div id="nested"><p>Outer 4:30 AM UTC</p></div>
`);
test('snapshots', async ({ page, base }) => {
  await page.goto(base + '/snap'); await page.waitForTimeout(800);
  const out: Record<string, unknown> = {};
  // snapshot in converted state, switch page-wide to original, restore snapshot
  out.stateSwitch = await page.evaluate(async () => {
    const s = document.getElementById('s1')!; const snap = s.innerHTML;
    (document.querySelector('#s1 zoneshift-icon') as HTMLElement).click();
    const btn = [...document.getElementById('zoneshift-popover')!.shadowRoot!.querySelectorAll('button')].find((b) => b.textContent === 'Show all originals on this page')!; btn.click();
    s.innerHTML = snap; await new Promise((r) => setTimeout(r, 400));
    return s.innerText + ' | state=' + s.querySelector('zoneshift-mark')?.getAttribute('data-zs-state');
  });
  // popover open inside a modal dialog, snapshot the dialog content, then restore it
  out.dialogSnap = await page.evaluate(async () => {
    const d = document.getElementById('dlg') as HTMLDialogElement; d.showModal(); await new Promise((r) => setTimeout(r, 50));
    (document.querySelector('#dc zoneshift-icon') as HTMLElement).click(); await new Promise((r) => setTimeout(r, 50));
    const snap = d.innerHTML; const open = !!document.getElementById('zoneshift-popover');
    d.close(); await new Promise((r) => setTimeout(r, 50));
    const afterClose = { popoverStillThere: !!document.getElementById('zoneshift-popover'), active: document.activeElement?.tagName };
    d.innerHTML = snap; await new Promise((r) => setTimeout(r, 400));
    return { open, snapHasPopover: snap.includes('zoneshift-popover'), afterClose, after: d.innerHTML.replace(/ style="[^"]*"/g, '').slice(0, 400), popovers: document.querySelectorAll('zoneshift-popover').length };
  });
  // reopen dialog: is a stale popover shown?
  out.reopen = await page.evaluate(async () => { const d = document.getElementById('dlg') as HTMLDialogElement; d.showModal(); await new Promise((r) => setTimeout(r, 50)); const hosts = [...document.querySelectorAll('zoneshift-popover')].map((h) => ({ shown: (h as HTMLElement).matches(':popover-open'), rect: h.getBoundingClientRect().height })); d.close(); return hosts; });
  // tampered data-zs-original
  out.evil = await page.evaluate(async () => {
    const e = document.getElementById('evil')!;
    e.innerHTML = '<p>Pay <zoneshift-mark data-zs-original="&lt;img src=x onerror=alert(1)&gt; to evil.example">$5</zoneshift-mark> now</p>';
    await new Promise((r) => setTimeout(r, 400));
    return { html: e.innerHTML, imgs: e.querySelectorAll('img').length, text: e.innerText };
  });
  // nested copies: a copied run placed inside another copied mark's text
  out.nested = await page.evaluate(async () => {
    const n = document.getElementById('nested')!; const run = n.querySelector('zoneshift-run')!.outerHTML;
    n.innerHTML = '<p>' + run.replace('</zoneshift-text>', run + '</zoneshift-text>') + '</p>';
    await new Promise((r) => setTimeout(r, 400));
    return n.innerText + ' | marks=' + n.querySelectorAll('zoneshift-mark').length + ' | html=' + n.innerHTML.length;
  });
  // fight: site restores its snapshot whenever innerHTML differs
  out.fight = await page.evaluate(async () => {
    const f = document.getElementById('fight')!; const snap = f.innerHTML; let n = 0;
    const t = setInterval(() => { if (f.innerHTML !== snap) { f.innerHTML = snap; n++; } }, 50);
    await new Promise((r) => setTimeout(r, 3000)); clearInterval(t);
    return { rewritesIn3s: n, text: f.innerText };
  });
  console.log('SNAP', JSON.stringify(out, null, 1));
});
pages['/shadow'] = H(`<div id="host"></div><div id="src"><p>Shadow 1:30 AM UTC</p></div><iframe id="fr" srcdoc="<body><div id=in></div></body>"></iframe>`);
test('copies into shadow root and iframe', async ({ page, base }) => {
  await page.goto(base + '/shadow'); await page.waitForTimeout(800);
  const r = await page.evaluate(async () => {
    const html = document.getElementById('src')!.innerHTML;
    const sr = document.getElementById('host')!.attachShadow({ mode: 'open' }); sr.innerHTML = html;
    const fr = (document.getElementById('fr') as HTMLIFrameElement).contentDocument!; fr.getElementById('in')!.innerHTML = html;
    await new Promise((r) => setTimeout(r, 400));
    return { shadow: sr.innerHTML.slice(0, 120), iframe: fr.body.innerHTML.slice(0, 120) };
  });
  console.log('SHADOW', JSON.stringify(r));
});
pages['/fight'] = H(`<div id="fight"><p>Fight 3:30 AM UTC.</p></div><div id="fight2"><p>Fight 4:30 AM UTC.</p></div>`);
test('fight', async ({ page, base }) => {
  await page.goto(base + '/fight'); await page.waitForTimeout(800);
  const r = await page.evaluate(async () => {
    const out: Record<string, unknown> = {};
    // 1. snapshot captured with the popover open (aria-expanded="true")
    const f = document.getElementById('fight')!;
    (f.querySelector('zoneshift-icon') as HTMLElement).click();
    const snap = f.innerHTML;
    document.body.click();
    let n = 0; const t0 = performance.now();
    const t = setInterval(() => { if (f.innerHTML !== snap) { f.innerHTML = snap; n++; } }, 50);
    await new Promise((r) => setTimeout(r, 5000)); clearInterval(t);
    out.expandedSnap = { rewritesIn5s: n, text: f.innerText };
    // 2. a framework-style re-render: site rewrites when textContent differs
    const g = document.getElementById('fight2')!; const want = g.textContent; let m = 0;
    const t2 = setInterval(() => { if (g.textContent !== want) { g.innerHTML = '<p>Fight 4:30 AM UTC.</p>'; m++; } }, 50);
    await new Promise((r) => setTimeout(r, 5000)); clearInterval(t2);
    out.textContentFight = { rewritesIn5s: m };
    return out;
  });
  console.log('FIGHT', JSON.stringify(r));
});
test('fight via site MutationObserver', async ({ page, base }) => {
  test.setTimeout(30000);
  await page.goto(base + '/fight'); await page.waitForTimeout(800);
  if (process.env.NOPOP) await page.evaluate(() => { (window as any).NOPOP = 1; });
  await page.evaluate(() => {
    const f = document.getElementById('fight')!;
    if (!(window as any).NOPOP) (f.querySelector('zoneshift-icon') as HTMLElement).click();
    const snap = f.innerHTML; document.body.click();
    (window as any).n = 0;
    new MutationObserver(() => { if (f.innerHTML !== snap) { (window as any).n++; f.innerHTML = snap; } }).observe(f, { childList: true, subtree: true, attributes: true });
    f.innerHTML = snap;
  }).catch((e) => console.log('evaluate error', String(e).slice(0, 100)));
  const t0 = Date.now();
  const n = await Promise.race([page.evaluate(() => (window as any).n), new Promise((r) => setTimeout(() => r('HUNG (no answer in 10s)'), 10000))]);
  console.log('MOFIGHT', n, 'after', Date.now() - t0, 'ms');
  await page.waitForTimeout(2000);
  const n2 = await Promise.race([page.evaluate(() => (window as any).n), new Promise((r) => setTimeout(() => r('HUNG'), 10000))]);
  console.log('MOFIGHT2', n2);
});
pages['/sel'] = H(`<div id="ce"><p id="cp">Call at 4:30 AM UTC today please.</p></div><p id="plain">Plain 5:30 AM UTC words after</p>
<dialog id="dlg"><p id="dp">Dialog 2:30 AM UTC</p></dialog>
<script>const ce=document.getElementById('ce'); ce.addEventListener('mousedown',()=>{ce.contentEditable='true';}); window.esc=0; document.addEventListener('keydown',e=>{if(e.key==='Escape')window.esc++;});</script>`);
test('selection gestures and dialog close', async ({ page, base }) => {
  await page.goto(base + '/sel'); await page.waitForTimeout(800);
  const b = await page.locator('#plain zoneshift-text').boundingBox();
  await page.mouse.dblclick(b!.x + 5, b!.y + b!.height / 2);
  const dbl = await page.evaluate(() => getSelection()!.toString());
  await page.mouse.move(b!.x + 2, b!.y + b!.height / 2); await page.mouse.down(); await page.mouse.move(b!.x + b!.width + 60, b!.y + b!.height / 2, { steps: 5 }); await page.mouse.up();
  const drag = await page.evaluate(() => getSelection()!.toString());
  const c = await page.locator('#ce zoneshift-text').boundingBox();
  await page.mouse.dblclick(c!.x + c!.width / 2, c!.y + c!.height / 2);
  const dblEdit = await page.evaluate(() => ({ s: getSelection()!.toString(), html: document.getElementById('ce')!.innerHTML }));
  // dialog closes with popover open
  await page.evaluate(() => (document.getElementById('dlg') as HTMLDialogElement).showModal());
  await page.locator('#dp zoneshift-icon').click();
  await page.evaluate(() => (document.getElementById('dlg') as HTMLDialogElement).close());
  await page.keyboard.press('Escape');
  const esc = await page.evaluate(() => ({ esc: (window as any).esc, expanded: document.querySelector('#dp zoneshift-icon')!.getAttribute('aria-expanded') }));
  console.log('SELG', JSON.stringify({ dbl, drag, dblEdit, esc }));
});
