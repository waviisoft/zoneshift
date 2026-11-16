import { test as base, chromium, expect, type BrowserContext, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';

const extensionPath = process.env.EXT || fileURLToPath(new URL('../.output/chrome-mv3', import.meta.url));
const pages: Record<string, { body: string; type?: string }> = {};
const html = (b: string, css = '') => `<!doctype html><meta charset="utf-8"><title>t</title><style>${css}</style><body><p id="ready">Ready at 1:30 AM UTC.</p>${b}</body>`;
const test = base.extend<{ context: BrowserContext; base: string }>({
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium', executablePath: process.env.ZONESHIFT_CHROMIUM || undefined, timezoneId: 'America/Los_Angeles',
      args: process.env.NOEXT ? [] : [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    await use(context); await context.close();
  },
  base: async ({}, use) => {
    const server: Server = createServer((req, res) => {
      const p = pages[req.url!.split('?')[0]!];
      if (!p) { res.statusCode = 404; res.end(); return; }
      res.setHeader('content-type', p.type ?? 'text/html'); res.end(p.body);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    await use(`http://127.0.0.1:${(server.address() as AddressInfo).port}`); server.close();
  },
});
const open = async (page: Page, url: string) => { await page.goto(url); if (!process.env.NOEXT) await page.locator('#ready .zoneshift').waitFor(); else await page.waitForTimeout(500); };

// ---------- layout / selectors ----------
pages['/sel'] = { body: html(`
<p id="a"><b class="tag">NEW</b> Posted 1:30 AM UTC</p>
<p id="b"><b class="solo">NEW</b> Posted 1:30 AM UTC</p>
<p id="c" class="owl">Posted 1:30 AM UTC <b class="owlb">pin</b></p>
<p id="d">Posted 1:30 AM UTC <em class="first">x</em></p>
<ul id="e" class="crumbs"><li>Home</li><li>Updated 1:30 AM UTC</li></ul>
`, `.tag:last-child{color:rgb(255,0,0)} .solo:only-child{background:rgb(255,255,0)} .owl > * + *{margin-left:40px} #d > em:first-child{color:rgb(0,0,255)}`) };
test('sibling selectors on the page', async ({ page, base }) => {
  await open(page, base + '/sel');
  const r = await page.evaluate(() => ({
    lastChildColor: getComputedStyle(document.querySelector('.tag')!).color,
    onlyChildBg: getComputedStyle(document.querySelector('.solo')!).backgroundColor,
    owlMargin: getComputedStyle(document.querySelector('.owlb')!).marginLeft,
    firstChildColor: getComputedStyle(document.querySelector('.first')!).color,
  }));
  console.log('SEL', process.env.NOEXT ? 'baseline' : 'ext', JSON.stringify(r));
});

pages['/inherit'] = { body: html(`
<p id="fl" class="fl">1:30 AM UTC is when we start.</p>
<p id="fline" class="fline">At 1:30 AM UTC we start the long maintenance window and everyone must log off.</p>
<p id="sel" class="sel">Selected 1:30 AM UTC text</p>
<div class="ell" id="ell">This is a long line which ends with a time 1:30 AM UTC and more words beyond it all</div>
<div class="clamp" id="clamp">Line one text text text text text text text text text text text text text text 1:30 AM UTC text text text text text text text text text text text text text text text text</div>
<p><a id="lnk" href="#">Due 1:30 AM UTC</a></p>
<p class="just" id="just">Words words words words 1:30 AM UTC words words words words words words words words words words words words words words words</p>
<div class="contents"><span id="dc">Shown 1:30 AM UTC</span></div>
<p class="nosel" id="nosel">Unselectable 1:30 AM UTC</p>
<pre id="pre" class="prews">a    1:30 AM UTC    b</pre>
<p id="undef">Custom 1:30 AM UTC</p>
`, `.fl::first-letter{font-size:40px;color:rgb(255,0,0)} .fline::first-line{color:rgb(0,128,0)} .sel::selection{background:rgb(255,0,255)}
.ell{width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis} .clamp{width:200px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
a{text-decoration:underline wavy rgb(255,0,0)} .just{text-align:justify;width:300px} .contents{display:contents;color:rgb(1,2,3)} .nosel{user-select:none}
:not(:defined){outline:3px solid rgb(255,0,0)}`) };
test('inheritance into runs', async ({ page, base }) => {
  await open(page, base + '/inherit');
  const r = await page.evaluate(() => {
    const t = (sel: string) => document.querySelector(sel + ' zoneshift-text') ?? document.querySelector(sel)!;
    const run = document.querySelector('#undef zoneshift-run');
    return {
      firstLetter: getComputedStyle(document.getElementById('fl')!, '::first-letter').color,
      ellH: document.getElementById('ell')!.getBoundingClientRect().height,
      clampH: document.getElementById('clamp')!.getBoundingClientRect().height,
      linkDecoTextColor: getComputedStyle(t('#lnk')).color,
      dcColor: getComputedStyle(t('#dc')).color,
      noselUS: getComputedStyle(t('#nosel')).userSelect,
      preWS: getComputedStyle(t('#pre')).whiteSpace,
      undefOutline: run ? getComputedStyle(run).outlineStyle : 'n/a',
    };
  });
  console.log('INH', JSON.stringify(r));
  for (const id of ['fl', 'fline', 'ell', 'clamp', 'lnk', 'just', 'nosel']) await page.locator('#' + id).screenshot({ path: `/tmp/inh-${id}.png` });
  // selection colour
  await page.evaluate(() => { const r = document.createRange(); r.selectNodeContents(document.getElementById('sel')!); getSelection()!.removeAllRanges(); getSelection()!.addRange(r); });
  await page.locator('#sel').screenshot({ path: '/tmp/inh-sel.png' });
  // unselectable paragraph: is the time selectable/copyable now?
  await page.evaluate(() => { const r = document.createRange(); r.selectNodeContents(document.getElementById('nosel')!.parentElement!); getSelection()!.removeAllRanges(); getSelection()!.addRange(r); });
  console.log('NOSEL selection', JSON.stringify(await page.evaluate(() => getSelection()!.toString())));
});

// ---------- editors ----------
pages['/edit'] = { body: html(`
<div id="e1"><p>Meeting at 1:30 AM UTC.</p></div><button id="b1">Edit</button><button id="c1">Cancel</button><button id="s1">Save</button>
<div id="q"><p>Launch at 2:30 AM UTC.</p></div><button id="bq">Edit (quill-like)</button>
<span id="cell">Due 3:30 AM UTC</span>
<div id="caret"><p>Call at 4:30 AM UTC today please.</p></div>
<script>
window.saved = [];
const e1 = document.getElementById('e1'); let snap;
document.getElementById('b1').onclick = () => { e1.contentEditable = 'true'; snap = e1.innerHTML; e1.focus(); };
document.getElementById('c1').onclick = () => { e1.innerHTML = snap; e1.contentEditable = 'false'; };
document.getElementById('s1').onclick = () => { window.saved.push(e1.innerHTML); e1.contentEditable = 'false'; };
// Quill/TinyMCE-inline style: read the container's HTML, then build the editor from it.
document.getElementById('bq').onclick = () => { const q = document.getElementById('q'); const h = q.innerHTML; q.innerHTML = ''; const ed = document.createElement('div'); ed.contentEditable = 'true'; ed.id = 'qed'; q.append(ed); ed.innerHTML = h; window.saved.push(ed.innerHTML); };
// x-editable style: click a value, edit it in an input initialised from its text.
document.getElementById('cell').onclick = (ev) => { const c = ev.currentTarget; const i = document.createElement('input'); i.id = 'cellin'; i.value = c.textContent; c.replaceWith(i); };
// click-to-edit with caret where the user clicked
const ca = document.getElementById('caret');
ca.addEventListener('mousedown', () => { ca.contentEditable = 'true'; });
</script>`) };
test('editor patterns', async ({ page, base }) => {
  await open(page, base + '/edit');
  await page.locator('#e1 .zoneshift').waitFor();
  // edit -> cancel -> edit -> save without changes
  await page.click('#b1'); await page.waitForTimeout(300); await page.click('#c1'); await page.waitForTimeout(600);
  const afterCancel = await page.locator('#e1').innerHTML();
  await page.click('#b1'); await page.waitForTimeout(300); await page.click('#s1');
  // quill-like
  await page.click('#bq'); await page.waitForTimeout(300);
  // x-editable
  await page.locator('#cell').click({ position: { x: 2, y: 2 } });
  const cellVal = await page.locator('#cellin').inputValue().catch(() => 'no input');
  const saved = await page.evaluate(() => (window as any).saved);
  console.log('EDIT', JSON.stringify({ afterCancel, saved, cellVal }, null, 1));
  // caret: click in the middle of the converted text
  const box = await page.locator('#caret zoneshift-text').boundingBox();
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.keyboard.type('X');
  console.log('CARET', await page.locator('#caret').innerHTML(), JSON.stringify(await page.evaluate(() => { const s = getSelection()!; return { node: s.anchorNode?.nodeName, data: (s.anchorNode as Text)?.data, off: s.anchorOffset, active: document.activeElement?.id }; })));
});

// ---------- boundary rule ----------
pages['/boundary'] = { body: html(`
<p id="b1"><b>Nov 13, 2026</b> at 1:30 AM UTC</p>
<p id="b2"><a href="#">Friday</a> at 1:30 AM UTC</p>
<p id="b3">Starts 1:30 AM <abbr title="Coordinated Universal Time">UTC</abbr></p>
<p id="b4">Starts <b>1:30 AM UTC</b> on <b>Friday, November 13</b></p>
<p id="b5">10:00 AM GMT<sup>+1</sup> daily</p>
<p id="b6"><span>Jul 1, 2026</span> 1:30 PM UTC</p>
<p id="b7">Due <a href="#">Nov 13, 2026 1:30 AM UTC</a> sharp</p>
<p id="b8">Opens <time>Nov 13, 2026</time> 1:30 AM UTC</p>
<p id="b9">From <b>9:00 AM UTC</b> to <b>10:00 AM UTC</b></p>
<p id="b10"><b>Mon–Fri</b> 1 AM UTC</p>
<p id="b11"><b>Tomorrow</b> at 6 PM UTC</p>
<p id="b12">Window 1:30 AM UTC<br>-3:00 AM UTC</p>
<p id="b13">Built 2026-11-13T01:30:00<b>Z</b></p>
<p id="b14"><b>1:30</b> PM UTC</p>
<p id="b15">At <b>1:30 AM UTC</b>–<b>3:00 AM UTC</b></p>
`) };
test('boundary rule', async ({ page, base }) => {
  await open(page, base + '/boundary');
  await page.waitForTimeout(500);
  const r = await page.evaluate(() => [...document.querySelectorAll('p[id^=b]')].map((p) => `${p.id}: ${(p as HTMLElement).innerText.replace(/\n/g, '⏎')}  [marks ${p.querySelectorAll('zoneshift-mark').length}]`));
  console.log('BOUNDARY\n' + r.join('\n'));
  // later additions that change / do not change the reading
  const later = await page.evaluate(async () => {
    const out: string[] = [];
    const p = document.getElementById('b14')!.cloneNode(false) as HTMLElement; p.id = 'L1'; p.textContent = 'Call at 10:00 AM UTC'; document.body.append(p);
    await new Promise((r) => setTimeout(r, 400)); out.push('L1 before: ' + p.innerText);
    p.append('+2 tomorrow'); await new Promise((r) => setTimeout(r, 400)); out.push('L1 after +2: ' + p.innerText + ' marks=' + p.querySelectorAll('zoneshift-mark').length);
    const q = document.createElement('p'); q.textContent = '1:30 AM UTC'; document.body.append(q); await new Promise((r) => setTimeout(r, 400));
    q.prepend('Jul 1, 2026 at '); await new Promise((r) => setTimeout(r, 400)); out.push('L2: ' + q.innerText + ' marks=' + q.querySelectorAll('zoneshift-mark').length);
    const s = document.createElement('p'); s.textContent = 'Meet 1:30 AM UTC'; document.body.append(s); await new Promise((r) => setTimeout(r, 400));
    const b = document.createElement('b'); b.textContent = ' on Friday, November 13'; s.append(b); await new Promise((r) => setTimeout(r, 400));
    out.push('L3 (date element appended): ' + s.innerText + ' marks=' + s.querySelectorAll('zoneshift-mark').length);
    return out;
  });
  console.log(later.join('\n'));
});

// ---------- keyboard ----------
pages['/kbd'] = { body: html(`<p id="p">At 1:30 AM UTC.</p><input id="in"><a id="after" href="#x">after</a>
<script>window.keys=[];document.addEventListener('keydown',e=>keys.push('doc '+e.key));</script>`) };
test('keyboard after close and with popover closed', async ({ page, base }) => {
  await open(page, base + '/kbd');
  await page.locator('#in').focus(); await page.keyboard.type('a b'); await page.keyboard.press('Enter'); await page.keyboard.press('Escape');
  const inVal = await page.locator('#in').inputValue();
  await page.locator('#p .zoneshift-icon').focus(); await page.keyboard.press('Enter'); await page.keyboard.press('Escape'); await page.keyboard.press('Tab');
  const afterTab = await page.evaluate(() => document.activeElement?.id);
  await page.locator('#p .zoneshift-icon').click();
  const snap = await page.locator('zoneshift-popover').ariaSnapshot().catch((e) => 'err ' + e);
  const ax = await page.locator('#p zoneshift-icon').ariaSnapshot();
  // open popover then remove the time from the page
  await page.evaluate(() => document.getElementById('p')!.remove());
  await page.waitForTimeout(100);
  const afterRemove = await page.evaluate(() => ({ open: !!document.getElementById('zoneshift-popover'), active: document.activeElement?.tagName }));
  console.log('KBD', JSON.stringify({ inVal, keys: await page.evaluate(() => (window as any).keys), afterTab, afterRemove }), '\n', ax, '\n', snap);
});

// ---------- copy ----------
pages['/copy'] = { body: html(`<p id="p">Maintenance starts Friday, November 13, 2026, at 1:30 AM UTC and ends soon.</p>`) };
test('copy', async ({ page, base, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
  await open(page, base + '/copy');
  const sel = await page.evaluate(() => { const r = document.createRange(); r.selectNodeContents(document.getElementById('p')!); getSelection()!.removeAllRanges(); getSelection()!.addRange(r); return getSelection()!.toString(); });
  await page.keyboard.press('Control+C');
  const clip = await page.evaluate(async () => { const out: Record<string, string> = {}; for (const it of await navigator.clipboard.read()) for (const t of it.types) out[t] = await (await it.getType(t)).text(); return out; });
  console.log('COPY', JSON.stringify({ sel, plain: clip['text/plain'], html: clip['text/html']?.replace(/style="[^"]*"/g, 'style=…') }));
});

// ---------- loops / perf ----------
pages['/rerender'] = { body: html(`<p id="clock"></p><script>window.__sets=0;const el=document.getElementById('clock');function render(){const want='Server time 1:30 AM UTC';if(el.textContent!==want){el.textContent=want;window.__sets++;}}render();setInterval(render,50);</script>`) };
test('rerender churn', async ({ page, base }) => {
  await open(page, base + '/rerender'); await page.waitForTimeout(3000);
  console.log('RERENDER', JSON.stringify(await page.evaluate(() => ({ sets: (window as any).__sets }))));
});
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
    test.setTimeout(240000);
    const t0 = Date.now();
    await page.goto(base + path, { timeout: 120000 });
    const tLoad = Date.now() - t0;
    await page.waitForFunction((n) => document.querySelectorAll('.zoneshift').length >= n, n + 1, { timeout: 200000, polling: 500 });
    const tAll = Date.now() - t0;
    const lts = await page.evaluate(() => (window as any).__lt.slice());
    const t1 = Date.now();
    await page.locator('#ready .zoneshift-icon').click();
    await page.getByRole('button', { name: 'Convert all times on this page' }).click();
    await page.waitForFunction(() => !document.querySelector('.zoneshift[data-zs-state="original"]'), null, { timeout: 200000 });
    const tSetAll = Date.now() - t1;
    await page.waitForTimeout(1500);
    const lts2 = await page.evaluate(() => (window as any).__lt);
    console.log('PERF', path, JSON.stringify({ tLoad, tAll, longtasks: [...lts].sort((a: number, b: number) => b - a).slice(0, 5), tSetAll, longtasksAfter: lts2.slice(lts.length).sort((a: number, b: number) => b - a).slice(0, 5) }));
  });
}
pages['/stream'] = { body: html(lt + `<pre id="log"></pre><script>let i=0;const log=document.getElementById('log');window.__start=performance.now();const t=setInterval(()=>{for(let k=0;k<20;k++){const s=String(i%60).padStart(2,'0');log.append('2026-11-13T01:'+s+':00Z INFO line '+(i++)+'\\n');}if(i>=10000){clearInterval(t);window.__end=performance.now();}},10);</script>`) };
test('perf streaming log', async ({ page, base }) => {
  test.setTimeout(120000);
  await open(page, base + '/stream');
  await page.waitForFunction(() => (window as any).__end, null, { timeout: 100000 });
  await page.waitForTimeout(1000);
  console.log('STREAM', JSON.stringify(await page.evaluate(() => ({ marks: document.querySelectorAll('.zoneshift').length, lt: (window as any).__lt.length, ltMax: Math.max(0, ...(window as any).__lt), elapsed: Math.round((window as any).__end - (window as any).__start) }))));
});
