import { helpers, html, open, out, pages, test } from './harness';

// B3 follow-up: what a copy handler can put on the clipboard (prototype handler, 'mark' layouts).
pages['/copy'] = {
  body: html(`<p id="p">Maintenance starts <b>Friday</b>, Nov 13, 2026 at 1:30 AM UTC and should take an hour.</p><p id="q">Second 2:30 AM UTC line.</p><div id="ed" contenteditable="true" style="min-height:30px"></div>`,
    'p{font:18px/1.5 sans-serif;margin:20px}'),
};
const clip = (page: any) =>
  page.evaluate(async () => {
    const o: Record<string, string> = {};
    for (const it of await navigator.clipboard.read()) for (const t of it.types) o[t] = await (await it.getType(t)).text();
    return { plain: o['text/plain'], html: (o['text/html'] ?? '').replace(/ style="[^"]*"/g, '').replace(/<meta[^>]*>/, '') };
  });

test('B3 copy handler', async ({ page, base, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
  await helpers(page);
  await open(page, base + '/copy');
  const geo = await page.evaluate(() => {
    const p = document.getElementById('p')!;
    const m = (window as any).__zs.marks().find((x: Element) => p.contains((x.getRootNode() as ShadowRoot).host)) ?? p.querySelector('zoneshift-text');
    const r = m.getBoundingClientRect();
    const pr = document.getElementById('q')!.getBoundingClientRect();
    return { mx: r.left, mw: r.width, my: r.top + r.height / 2, qx: pr.left + 60, qy: pr.top + pr.height / 2, px: p.getBoundingClientRect().left + 1 };
  });
  const run = async (label: string, act: () => Promise<void>) => {
    await page.mouse.click(5, 700);
    await act();
    await page.keyboard.press('Control+C');
    out(label, { selection: await page.evaluate(() => getSelection()!.toString()), clipboard: await clip(page) });
  };
  await run('B3 handler: drag whole first line', async () => {
    await page.mouse.move(geo.px, geo.my);
    await page.mouse.down();
    await page.mouse.move(geo.mx + geo.mw + 400, geo.my, { steps: 8 });
    await page.mouse.up();
  });
  await run('B3 handler: drag from the middle of the time into the next paragraph', async () => {
    await page.mouse.move(geo.mx + geo.mw * 0.5, geo.my);
    await page.mouse.down();
    await page.mouse.move(geo.qx, geo.qy, { steps: 8 });
    await page.mouse.up();
  });
  await run('B3 handler: drag inside the time only', async () => {
    await page.mouse.move(geo.mx + geo.mw * 0.2, geo.my);
    await page.mouse.down();
    await page.mouse.move(geo.mx + geo.mw * 0.7, geo.my, { steps: 8 });
    await page.mouse.up();
  });
  await run('B3 handler: double-click a word of the time', async () => page.mouse.dblclick(geo.mx + geo.mw * 0.3, geo.my));
  await run('B3 handler: select all', async () => page.keyboard.press('Control+A'));
  // Paste into the page's editor.
  await page.mouse.click(5, 700);
  await page.mouse.move(geo.px, geo.my);
  await page.mouse.down();
  await page.mouse.move(geo.mx + geo.mw + 400, geo.my, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.press('Control+C');
  await page.locator('#ed').click();
  await page.keyboard.press('Control+V');
  await page.waitForTimeout(300);
  out('B3 handler: pasted into an editor', await page.locator('#ed').innerHTML());
});

// C10/C9 follow-up for the in-place layout: is a child the page adds laid out in the same task?
pages['/sync'] = { body: html(`<p id="p">Starts 1:30 AM UTC today</p>`) };
test('C10 in-place: synchronous layout of children the page adds', async ({ page, base }) => {
  await open(page, base + '/sync');
  const r = await page.evaluate(async () => {
    const p = document.getElementById('p')!;
    const s = document.createElement('span');
    s.textContent = ' NEW';
    p.append(s);
    const sameTask = { width: Math.round(s.getBoundingClientRect().width), pHeight: p.offsetHeight, inner: p.innerText };
    await Promise.resolve();
    const afterMicrotask = Math.round(s.getBoundingClientRect().width);
    await new Promise((r) => requestAnimationFrame(r));
    return { sameTask, afterMicrotask, afterFrame: Math.round(s.getBoundingClientRect().width) };
  });
  out('C10 in-place sync layout', r);
});

// What a manual-slot shadow root does once nobody assigns new children (after the
// content script stops, or is unloaded in a browser that kills it). Page world, no extension needed.
pages['/orphan'] = { body: html(`<p id="p">Hello <b>world</b></p>`, '', `
  const p = document.getElementById('p');
  const root = p.attachShadow({ mode: 'open', slotAssignment: 'manual' });
  for (const c of [...p.childNodes]) { const s = document.createElement('slot'); root.append(s); s.assign(c); }
  const b = document.createElement('i'); b.id = 'late'; b.textContent = ' added later';
  p.append(b);
  window.result = { lateWidth: b.getBoundingClientRect().width, text: p.innerText, html: p.innerHTML };`) };
test('C9 orphaned manual-slot host', async ({ page, base }) => {
  await page.goto(base + '/orphan');
  out('C9 orphaned manual-slot host', await page.evaluate(() => (window as any).result));
});

// A2 follow-up: where the page's own Range over its text lands.
pages['/rects'] = { body: html(`<p id="p">Call at 4:30 AM UTC today please.</p>`, 'p{font:16px sans-serif}') };
test('A2 Range rects over the original text', async ({ page, base }) => {
  await open(page, base + '/rects');
  out('A2 rects', await page.evaluate(() => {
    const p = document.getElementById('p')!;
    const texts: Text[] = [];
    const w = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    while (w.nextNode()) texts.push(w.currentNode as Text);
    const t = texts.find((x) => x.data.includes('4:30'))!;
    const r = document.createRange();
    r.setStart(t, t.data.indexOf('4:30'));
    r.setEnd(t, t.data.indexOf('UTC') + 3);
    const b = r.getBoundingClientRect();
    const whole = document.createRange();
    whole.selectNodeContents(p);
    const wb = whole.getBoundingClientRect();
    return { timeRange: `${Math.round(b.width)}x${Math.round(b.height)} at x=${Math.round(b.left)}`, paragraphRange: `${Math.round(wb.width)}x${Math.round(wb.height)}` };
  }));
});
