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
const H = (b: string) => `<!doctype html><meta charset="utf-8"><body><p id="ready">Ready 1:30 AM UTC</p>${b}</body>`;
/** Responsiveness probe: max latency of a 50 ms setTimeout loop running in the page. */
const probe = `window.__lag=0;(function t(){const s=performance.now();setTimeout(()=>{window.__lag=Math.max(window.__lag,performance.now()-s-50);t();},50);})();`;
const marks = (sel: string) => `document.querySelectorAll('${sel} zoneshift-mark').length`;

pages['/fights'] = H(`<div id="mo"><p>A 3:30 AM UTC.</p></div><div id="mop"><p>B 4:30 AM UTC.</p></div><div id="tm"><p>C 5:30 AM UTC.</p></div>
<div id="ws"><p>D 6:30 AM UTC.</p></div><div id="alt"><p>E 7:30 AM UTC.</p></div><div id="many"></div>`);
test('R1 fights over 20 s', async ({ page, base }) => {
  test.setTimeout(90000);
  await page.goto(base + '/fights'); await page.waitForTimeout(800);
  await page.evaluate(`(${() => {
    const w = window as any; w.c = {};
    const fight = (id: string, popover: boolean, viaMO: boolean, vary?: (s: string, n: number) => string) => {
      const f = document.getElementById(id)!;
      if (popover) (f.querySelector('zoneshift-icon') as HTMLElement).click();
      const snap = f.innerHTML.replace('aria-expanded="false"', 'aria-expanded="true"'); if (popover) document.body.click();
      w.c[id] = 0; let n = 0;
      const want = () => (vary ? vary(snap, n) : snap);
      const act = () => { if (w.c[id] > 100000) return; if (f.innerHTML !== want()) { w.c[id]++; n++; f.innerHTML = want(); } };
      if (viaMO) { new MutationObserver(act).observe(f, { childList: true, subtree: true, attributes: true, characterData: true }); f.innerHTML = want(); w.c[id]++; }
      else setInterval(act, 50);
    };
    fight('mo', false, true);
    fight('mop', true, true);
    fight('tm', true, false);
    fight('ws', false, true, (s, n) => s.replace('D ', 'D' + ' '.repeat(1 + (n % 7))));
    fight('alt', false, true, (s, n) => (n % 2 ? s : s.replace('E ', 'E. ')));
    const many = document.getElementById('many')!;
    for (let i = 0; i < 100; i++) { const d = document.createElement('div'); d.id = 'm' + i; d.innerHTML = `<p>M${i} 8:30 AM UTC</p>`; many.append(d); }
  }})()`);
  await page.waitForTimeout(800);
  await page.evaluate(`(${() => {
    const w = window as any;
    for (let i = 0; i < 100; i++) { const f = document.getElementById('m' + i)!; const snap = f.innerHTML.replace('aria-expanded="false"', 'aria-expanded="true"'); w.c['m' + i] = 0;
      new MutationObserver(() => { if (w.c['m' + i] > 100000) return; if (f.innerHTML !== snap) { w.c['m' + i]++; f.innerHTML = snap; } }).observe(f, { childList: true, subtree: true });
      f.innerHTML = snap; }
  }})()`);
  await page.evaluate(probe);
  const samples: string[] = [];
  for (let s = 0; s < 20; s++) {
    await page.waitForTimeout(1000);
    const t0 = Date.now();
    const r = await page.evaluate(() => { const c = (window as any).c; let many = 0; for (let i = 0; i < 100; i++) many += c['m' + i]; return { mo: c.mo, mop: c.mop, tm: c.tm, ws: c.ws, alt: c.alt, many, lag: Math.round((window as any).__lag) }; });
    samples.push(`${s + 1}s ${JSON.stringify(r)} evalMs=${Date.now() - t0}`);
  }
  console.log('R1\n' + samples.join('\n'));
});

// ---------- false positives ----------
pages['/fp'] = H(`<div id="chat"></div><div id="list"></div><p id="clock"></p><p id="clock2"></p><div id="car"><div id="track"><div class="slide"><p>Slide 1:30 AM UTC</p></div></div></div><div id="vl" style="height:200px;overflow:auto"><div id="vlin"></div></div>`);
test('false positives', async ({ page, base }) => {
  test.setTimeout(400000);
  await page.goto(base + '/fp'); await page.waitForTimeout(800);
  const conv = (sel: string) => page.evaluate((s) => document.querySelectorAll(s + ' zoneshift-mark').length, sel);
  // 1. streaming markdown: a message re-rendered with innerHTML on every token (every 50 ms) for 4 s
  const stream = async (target: string, whole: boolean, seconds: number) => page.evaluate(async ([target, whole, seconds]) => {
    const host = document.getElementById(target as string)!; const msg = document.createElement('div'); host.append(msg);
    const words = 'The deploy window opens at 1:30 AM UTC and closes at 3:00 AM UTC tonight lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua'.split(' ');
    let i = 0; const w = window as any; w.msgs ??= {}; const prev: string[] = (w.msgs[target as string] ??= []).slice();
    await new Promise<void>((res) => { const t = setInterval(() => { i++; const text = words.slice(0, Math.min(words.length, 7 + i)).join(' ') + ' ' + 'x'.repeat(i % 3);
      if (whole) host.innerHTML = prev.map((p) => `<div><p>${p}</p></div>`).join('') + `<div><p>${text}</p></div>`; else msg.innerHTML = `<p>${text}</p>`;
      if (i >= (seconds as number) * 20) { clearInterval(t); w.msgs[target as string].push(text); res(); } }, 50); });
  }, [target, whole, seconds]);
  const waitConverted = async (sel: string, need: number, maxMs: number) => { const t0 = Date.now(); while (Date.now() - t0 < maxMs) { if ((await conv(sel)) >= need) return Date.now() - t0; await page.waitForTimeout(250); } return `>${maxMs}`; };
  const out: string[] = [];
  await stream('chat', false, 4); out.push('chat msg: after stream ends, converted in ' + (await waitConverted('#chat', 2, 40000)) + ' ms'); console.log(out.at(-1));
  for (let k = 1; k <= 3; k++) { await stream('list', true, 4); out.push(`whole-list stream #${k}: converted in ` + (await waitConverted('#list', 2 * k, 70000)) + ' ms'); console.log(out.at(-1)); }
  // 2. ticking clock: same text every 250 ms; then a real clock (new text every second)
  await page.evaluate(() => { const c = document.getElementById('clock')!; setInterval(() => { c.textContent = 'Server time 1:30 AM UTC'; }, 250); let s = 0; const d = document.getElementById('clock2')!; setInterval(() => { s++; d.textContent = `Now 1:${String(s % 60).padStart(2, '0')} AM UTC`; }, 1000); });
  const clockSamples: string[] = [];
  for (let s = 0; s < 12; s++) { await page.waitForTimeout(1000); clockSamples.push(`${await conv('#clock')}/${await conv('#clock2')}`); }
  out.push('clock same-text(250ms)/real-clock(1s) marks per second: ' + clockSamples.join(' '));
  // 3. carousel: re-clone the slides every 500 ms (Swiper loop-style)
  await page.evaluate(() => { const track = document.getElementById('track')!; const orig = track.querySelector('.slide')!; setInterval(() => { track.querySelectorAll('.clone').forEach((c) => c.remove()); const a = orig.cloneNode(true) as HTMLElement; a.classList.add('clone'); const b = orig.cloneNode(true) as HTMLElement; b.classList.add('clone'); track.prepend(a); track.append(b); }, 500); });
  const carSamples: string[] = [];
  for (let s = 0; s < 12; s++) { await page.waitForTimeout(1000); carSamples.push(await page.evaluate(() => { const cl = [...document.querySelectorAll('#track .clone')]; const live = cl.filter((c) => c.querySelector('zoneshift-run')).length; const dead = cl.filter((c) => c.querySelector('zoneshift-mark') && !c.querySelector('zoneshift-run')).length; return `${live}L/${cl.filter(c=>!c.querySelector('zoneshift-mark')).length}P`; })); }
  out.push('carousel clones (L=annotated, P=plain) per second: ' + carSamples.join(' '));
  // 4. virtualised list: re-render visible rows (innerHTML) on every scroll event
  await page.evaluate(() => { const vl = document.getElementById('vl')!; const inner = document.getElementById('vlin')!; inner.style.height = 1000 * 20 + 'px'; inner.style.position = 'relative';
    const render = () => { const first = Math.floor(vl.scrollTop / 20); let h = ''; for (let i = first; i < first + 12; i++) h += `<div style="position:absolute;top:${i * 20}px">Row ${i} at ${1 + (i % 11)}:30 AM UTC</div>`; inner.innerHTML = h; };
    render(); vl.addEventListener('scroll', render); });
  await page.waitForTimeout(600);
  const vs: string[] = [];
  for (let s = 0; s < 6; s++) { for (let k = 0; k < 10; k++) { await page.evaluate(() => { document.getElementById('vl')!.scrollTop += 7; }); await page.waitForTimeout(50); } vs.push(String(await conv('#vl'))); }
  out.push('virtual list marks while scrolling (sampled each 0.5 s): ' + vs.join(' '));
  const t0 = Date.now(); out.push('virtual list after scrolling stops: 12 marks in ' + (await waitConverted('#vl', 12, 70000)) + ' ms'); void t0;
  console.log('FP\n' + out.join('\n'));
});
pages['/clock'] = H(`<p id="c1"></p><p id="c2"></p><p id="c3"></p>`);
test('clocks', async ({ page, base }) => {
  test.setTimeout(60000);
  await page.goto(base + '/clock'); await page.waitForTimeout(800);
  await page.evaluate(() => {
    let s = 0; const a = document.getElementById('c1')!, b = document.getElementById('c2')!, c = document.getElementById('c3')!;
    setInterval(() => { s++; a.textContent = `Now 1:${String(s % 60).padStart(2, '0')} AM UTC`; }, 1000);
    setInterval(() => { b.textContent = 'Same 1:30 AM UTC'; }, 250);
    let t = 0; setInterval(() => { t++; c.textContent = `Tick 1:${String(Math.floor(t / 10) % 60).padStart(2, '0')} AM UTC`; }, 100);
  });
  const out: string[] = [];
  for (let i = 0; i < 40; i++) { await page.waitForTimeout(500); out.push(await page.evaluate(() => ['c1', 'c2', 'c3'].map((id) => document.querySelectorAll(`#${id} zoneshift-mark`).length).join(''))); }
  console.log('CLOCKS (c1 new text/1s, c2 same text/250ms, c3 same text 10x then new, every 100ms), every 0.5 s:\n' + out.join(' '));
});
pages['/copysite'] = H(`
<div id="a"><p id="pa">Alpha 1:30 AM UTC with <img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="[img]" width="5"> picture</p></div>
<div id="b"><p id="pb">Beta 2:30 AM UTC</p></div>
<div id="c"><p id="pc">Gamma 3:30 AM UTC</p></div>
<div id="ed" contenteditable="true"><p id="pe">Editable 4:30 AM UTC text</p></div>
<textarea id="ta">Area 5:30 AM UTC</textarea><input id="in" value="Input 6:30 AM UTC">
<p id="pd">Delta 7:30 AM UTC end</p>
<script>
// b: attribution script that appends a line and sets both formats, with preventDefault
document.getElementById('b').addEventListener('copy', (e) => { const s = getSelection().toString(); e.clipboardData.setData('text/plain', s + '\\nRead more: example'); e.clipboardData.setData('text/html', '<b>' + s + '</b>'); e.preventDefault(); });
// c: site handler that only reads and logs, bails if defaultPrevented (some analytics)
window.cLog = []; document.getElementById('c').addEventListener('copy', (e) => { window.cLog.push(e.defaultPrevented ? 'saw defaultPrevented' : 'saw normal'); });
// ed: editor with its own copy logic that checks defaultPrevented first (ProseMirror-style guard)
window.edLog = []; document.getElementById('ed').addEventListener('copy', (e) => { if (e.defaultPrevented) { window.edLog.push('skipped'); return; } e.clipboardData.setData('text/plain', 'EDITOR:' + getSelection().toString()); e.preventDefault(); window.edLog.push('handled'); });
window.selChanges = 0; document.addEventListener('selectionchange', () => window.selChanges++);
</script>`);
test('copy listener vs site handlers', async ({ page, base, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
  await page.goto(base + '/copysite'); await page.waitForTimeout(800);
  const read = () => page.evaluate(async () => { const o: Record<string, string> = {}; for (const it of await navigator.clipboard.read()) for (const t of it.types) o[t] = await (await it.getType(t)).text(); return o; });
  const selectAll = (id: string, backwards = false) => page.evaluate(([id, backwards]) => { const p = document.getElementById(id as string)!; const s = getSelection()!; const r = document.createRange(); r.selectNodeContents(p); s.removeAllRanges(); if (backwards) { s.setBaseAndExtent(r.endContainer, r.endOffset, r.startContainer, r.startOffset); } else s.addRange(r); }, [id, backwards]);
  const out: Record<string, unknown> = {};
  await selectAll('pb'); await page.keyboard.press('Control+C'); out.attribution = await read();
  await selectAll('pc'); await page.keyboard.press('Control+C'); out.analytics = { clip: await read(), log: await page.evaluate(() => (window as any).cLog) };
  await page.locator('#pe').click(); await page.keyboard.press('Control+A'); await page.keyboard.press('Control+C'); out.editor = { clip: await read(), log: await page.evaluate(() => (window as any).edLog) };
  await page.locator('#ta').focus(); await page.locator('#ta').selectText(); await page.keyboard.press('Control+C'); out.textarea = await read();
  await page.locator('#in').focus(); await page.locator('#in').selectText(); await page.keyboard.press('Control+C'); out.input = await read();
  // alt-text splicing: selectionchange count and selection direction preserved
  await selectAll('pa', true);
  await page.waitForTimeout(100);
  const before = await page.evaluate(() => { (window as any).selChanges = 0; const s = getSelection()!; return { a: s.anchorOffset, f: s.focusOffset, an: s.anchorNode?.nodeName, fn: s.focusNode?.nodeName, dir: (s as any).direction }; });
  await page.keyboard.press('Control+C'); await page.waitForTimeout(100);
  const after = await page.evaluate(() => { const s = getSelection()!; return { a: s.anchorOffset, f: s.focusOffset, an: s.anchorNode?.nodeName, fn: s.focusNode?.nodeName, dir: (s as any).direction, changes: (window as any).selChanges }; });
  out.alt = { clip: await read(), before, after };
  // cut in editable content containing nothing of ours vs. a page selection (not editable)
  await selectAll('pd'); await page.keyboard.press('Control+X'); out.cutPage = { clip: await read(), text: await page.locator('#pd').innerText() };
  console.log('COPYSITE', JSON.stringify(out, null, 1));
});
