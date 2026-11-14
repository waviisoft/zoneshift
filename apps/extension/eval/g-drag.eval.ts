import { helpers, html, open, out, pages, test, VARIANT } from './harness';

// B3: drags that start or end inside a converted time.
pages['/drag'] = {
  body: html(`<p id="p">Maintenance starts Friday, Nov 13, 2026 at 1:30 AM UTC and should take an hour.</p><p id="q">Second line here.</p>`, 'p{font:18px/1.5 sans-serif;margin:20px}'),
};
test('B3 drag boundaries', async ({ page, base, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
  await helpers(page);
  await open(page, base + '/drag');
  const g = await page.evaluate(() => {
    const p = document.getElementById('p')!;
    const m = (window as any).__zs.marks().find((x: Element) => p.contains((x.getRootNode() as ShadowRoot).host) || (x.getRootNode() as ShadowRoot).host === p) ?? p.querySelector('zoneshift-text');
    const r = m.getBoundingClientRect();
    const q = document.getElementById('q')!.getBoundingClientRect();
    return { mx: r.left, mw: r.width, my: r.top + r.height / 2, qx: q.left + 80, qy: q.top + q.height / 2, px: p.getBoundingClientRect().left + 1 };
  });
  const drag = async (name: string, from: [number, number], to: [number, number]) => {
    await page.mouse.click(900, 700);
    await page.mouse.move(...from);
    await page.mouse.down();
    await page.mouse.move(...to, { steps: 10 });
    await page.mouse.up();
    await page.screenshot({ path: `/tmp/zs-eval/${VARIANT}-${name}.png`, clip: { x: 0, y: 40, width: 1000, height: 110 } });
    await page.keyboard.press('Control+C');
    const plain = await page.evaluate(async () => (await navigator.clipboard.readText()));
    out(`B3 ${name}`, { selection: await page.evaluate(() => getSelection()!.toString()), clipboard: plain });
  };
  await drag('from-mid-time-to-next-paragraph', [g.mx + g.mw * 0.5, g.my], [g.qx, g.qy]);
  await drag('from-line-start-to-mid-time', [g.px, g.my], [g.mx + g.mw * 0.5, g.my]);
  await page.mouse.click(900, 700);
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Control+C');
  out('B3 select all', { clipboard: await page.evaluate(async () => (await navigator.clipboard.readText())) });
});
