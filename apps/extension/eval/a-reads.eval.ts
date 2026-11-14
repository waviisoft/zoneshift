import { expect } from '@playwright/test';
import { helpers, html, open, out, pages, test } from './harness';

// A. What a site reads: the three reproductions, then every read API.

const OBSERVE = `window.__records=[];document.addEventListener('DOMContentLoaded',()=>window.__records.push('--- parsed ---'));new MutationObserver(rs=>{for(const r of rs)window.__records.push(r.type+' '+(r.target.nodeName)+' +'+[...r.addedNodes].map(n=>n.nodeName).join(',')+' -'+[...r.removedNodes].map(n=>n.nodeName).join(','))}).observe(document,{subtree:true,childList:true,characterData:true,attributes:true});`;

pages['/repro'] = {
  body: `<!doctype html><meta charset="utf-8"><title>t</title><script nonce="fixture">${OBSERVE}</script><body>
<p id="ready">Ready at 1:30 AM UTC.</p>
<div id="e1"><p>Meeting at 1:30 AM UTC.</p></div><button id="b1">Edit</button><button id="c1">Cancel</button><button id="s1">Save</button>
<div id="q"><p>Launch at 2:30 AM UTC.</p></div><button id="bq">Edit (quill-like)</button>
<span id="cell">Due 3:30 AM UTC</span>
<span id="cell2">Due 3:45 AM UTC</span>
<div id="snapbox"><p>Snapshot at 4:30 AM UTC.</p></div>
<script nonce="fixture">
window.saved = {};
const e1 = document.getElementById('e1'); let snap;
document.getElementById('b1').onclick = () => { e1.contentEditable = 'true'; snap = e1.innerHTML; e1.focus(); };
document.getElementById('c1').onclick = () => { e1.innerHTML = snap; e1.contentEditable = 'false'; };
document.getElementById('s1').onclick = () => { (saved.e1 ??= []).push(e1.innerHTML); e1.contentEditable = 'false'; };
document.getElementById('bq').onclick = () => { const q = document.getElementById('q'); const h = q.innerHTML; q.innerHTML = ''; const ed = document.createElement('div'); ed.contentEditable = 'true'; ed.id = 'qed'; q.append(ed); ed.innerHTML = h; saved.quill = ed.innerHTML; };
document.getElementById('cell').onclick = (ev) => { const c = ev.currentTarget; const i = document.createElement('input'); i.id = 'cellin'; i.value = c.textContent; c.replaceWith(i); };
document.getElementById('cell2').onclick = (ev) => { const c = ev.currentTarget; const i = document.createElement('input'); i.id = 'cellin2'; i.value = c.innerText; c.replaceWith(i); };
</script></body>`,
};

test('A1 reproductions', async ({ page, base }) => {
  await helpers(page);
  await open(page, base + '/repro');
  await page.waitForTimeout(400);
  // Same-task snapshot with no editing signal at all, then put back and saved.
  const snap = await page.evaluate(() => {
    const b = document.getElementById('snapbox')!;
    const s = b.innerHTML;
    b.innerHTML = s;
    return s;
  });
  await page.waitForTimeout(500);
  const snapAfter = await page.evaluate(() => ({
    html: document.getElementById('snapbox')!.innerHTML,
    shown: (window as any).__zs.shown(document.getElementById('snapbox')),
  }));
  await page.click('#b1');
  await page.waitForTimeout(300);
  await page.click('#c1');
  await page.waitForTimeout(600);
  const afterCancel = await page.locator('#e1').innerHTML();
  await page.click('#b1');
  await page.waitForTimeout(300);
  await page.click('#s1');
  await page.click('#bq');
  await page.waitForTimeout(300);
  await page.locator('#cell').click({ position: { x: 2, y: 2 } });
  await page.locator('#cell2').click({ position: { x: 2, y: 2 } });
  const cell = await page.locator('#cellin').inputValue().catch(() => 'no input');
  const cell2 = await page.locator('#cellin2').inputValue().catch(() => 'no input');
  out('A1 snapshot (same task)', snap);
  out('A1 snapshot put back, after 500ms', snapAfter);
  out('A1 click-to-edit after cancel', afterCancel);
  out('A1 saved', await page.evaluate(() => (window as any).saved));
  out('A1 input from textContent', cell);
  out('A1 input from innerText', cell2);
  const records: string[] = await page.evaluate(() => (window as any).__records);
  const after = records.slice(records.indexOf('--- parsed ---') + 1);
  out('A2 mutation records after parsing (annotation + test actions), first 8 of ' + after.length, after.slice(0, 8));
});

pages['/reads'] = {
  body: html(`<p id="p">Maintenance starts Friday, November 13, 2026, at 1:30 AM UTC and should take an hour.</p>
<p id="w"><span id="wrap">Opens 1:30 AM UTC</span></p><div id="clonebox"></div>`, 'p{font:16px/1.4 sans-serif}'),
};

test('A2 read APIs', async ({ page, base, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
  await helpers(page);
  await open(page, base + '/reads');
  const r = await page.evaluate(() => {
    const p = document.getElementById('p')!;
    const z = (window as any).__zs;
    const range = document.createRange();
    range.selectNodeContents(p);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
    const selText = getSelection()!.toString();
    const rangeText = range.toString();
    getSelection()!.removeAllRanges();
    const mark = p.querySelector('zoneshift-mark, zoneshift-run');
    // Light-DOM range over the original time text.
    const t = [...p.querySelectorAll('*')].concat([p]).flatMap((e) => [...e.childNodes]).find((n) => n.nodeType === 3 && (n as Text).data.includes('1:30 AM UTC')) as Text | undefined;
    let timeRect = null;
    if (t) {
      const rr = document.createRange();
      const i = t.data.indexOf('Friday');
      rr.setStart(t, Math.max(0, i));
      rr.setEnd(t, t.data.indexOf('UTC') + 3);
      const b = rr.getBoundingClientRect();
      timeRect = { w: Math.round(b.width), h: Math.round(b.height), rects: rr.getClientRects().length };
    }
    const sm = z.marks()[0];
    const shownRect = sm ? sm.getBoundingClientRect() : null;
    // caretPositionFromPoint at the middle of the converted text.
    let caret = null;
    if (sm) {
      const b = sm.firstChild!.nodeType === 3 ? (() => { const q = document.createRange(); q.selectNodeContents(sm.firstChild!); return q.getBoundingClientRect(); })() : sm.getBoundingClientRect();
      const cp = (document as any).caretPositionFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      const cpS = (document as any).caretPositionFromPoint(b.left + b.width / 2, b.top + b.height / 2, { shadowRoots: z.roots() });
      const cr = (document as any).caretRangeFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      const d = (n: Node | null) => (n ? (n.nodeType === 3 ? `#text "${(n as Text).data.slice(0, 30)}"` : (n as Element).localName) + (n.getRootNode() instanceof ShadowRoot ? ' (in shadow)' : '') : 'null');
      caret = { caretPositionFromPoint: cp && `${d(cp.offsetNode)} @${cp.offset}`, withShadowRoots: cpS && `${d(cpS.offsetNode)} @${cpS.offset}`, caretRangeFromPoint: cr && `${d(cr.startContainer)} @${cr.startOffset}`, elementFromPoint: d(document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)) };
    }
    const clone = p.cloneNode(true) as HTMLElement;
    clone.id = 'clone';
    const cloneText = clone.textContent;
    document.getElementById('clonebox')!.append(clone);
    const cloneShown = z.shown(clone);
    const cloneInnerText = clone.innerText;
    const wrapEl = document.getElementById('wrap')!;
    return {
      textContent: p.textContent,
      innerHTML: p.innerHTML,
      innerText: p.innerText,
      shown: z.shown(p),
      outerTextOfMark: mark ? (mark as HTMLElement).innerText : null,
      selectionToString: selText,
      rangeToString: rangeText,
      emptyMark: p.querySelector('zoneshift-mark')?.matches(':empty') ?? null,
      emptyRun: p.querySelector('zoneshift-run')?.matches(':empty') ?? null,
      pEmpty: p.matches(':empty'),
      pChildNodes: p.childNodes.length,
      pRect: Math.round(p.getBoundingClientRect().height),
      lightTimeRange: timeRect,
      shownMarkRect: shownRect && { w: Math.round(shownRect.width), h: Math.round(shownRect.height) },
      caret,
      cloneTextContent: cloneText,
      cloneShownAfterInsert: cloneShown,
      cloneInnerText,
      spanWithTime_innerText: wrapEl.innerText,
      spanWithTime_innerHTML: wrapEl.innerHTML,
      shadowRootFromPage: (document.querySelector('zoneshift-mark, zoneshift-run') as any)?.shadowRoot ? 'visible' : (p as any).shadowRoot ? 'p.shadowRoot visible' : 'null',
    };
  });
  for (const [k, v] of Object.entries(r)) out('A2 ' + k, v);
  await page.evaluate(() => getSelection()!.removeAllRanges());
  await page.evaluate(() => document.getElementById('clonebox')!.replaceChildren());
  // Native copy of the whole paragraph (no copy handler in the prototype).
  await page.evaluate(() => {
    const range = document.createRange();
    range.selectNodeContents(document.getElementById('p')!);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
  });
  await page.keyboard.press('Control+C');
  const clip = await page.evaluate(async () => {
    const o: Record<string, string> = {};
    for (const it of await navigator.clipboard.read()) for (const t of it.types) o[t] = await (await it.getType(t)).text();
    return o;
  });
  out('A2 native copy text/plain', clip['text/plain']);
  out('A2 native copy text/html', (clip['text/html'] ?? '').replace(/ style="[^"]*"/g, ' style=…'));
  // execCommand('copy') with a page copy listener that reads the selection.
  const viaExec = await page.evaluate(() => {
    let seen = '';
    const h = (e: ClipboardEvent) => { seen = getSelection()!.toString(); };
    document.addEventListener('copy', h);
    const ok = document.execCommand('copy');
    document.removeEventListener('copy', h);
    return { ok, selectionInCopyHandler: seen };
  });
  out('A2 execCommand copy', viaExec);
  await page.locator('#p').screenshot({ path: `/tmp/zs-eval/${process.env.NOEXT ? 'none' : process.env.EXT!.split('/').pop()}-reads.png` });
});
