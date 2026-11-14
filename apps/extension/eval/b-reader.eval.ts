import { helpers, html, open, out, pages, test, VARIANT } from './harness';

// B. What the reader gets: selection, copy, find, accessibility, print, MHTML.

pages['/sel'] = {
  body: html(`<p id="p">Maintenance starts Friday, November 13, 2026, at 1:30 AM UTC and should take an hour.</p><p id="after">Next paragraph.</p>`,
    'p{font:18px/1.5 sans-serif;margin:20px} ::selection{background:rgb(255,200,0)}'),
};

const clip = (page: any) =>
  page.evaluate(async () => {
    const o: Record<string, string> = {};
    for (const it of await navigator.clipboard.read()) for (const t of it.types) o[t] = await (await it.getType(t)).text();
    return { plain: o['text/plain'], html: (o['text/html'] ?? '').replace(/ style="[^"]*"/g, '').replace(/<meta[^>]*>/, '') };
  });
const selState = (page: any) =>
  page.evaluate(() => {
    const s = getSelection()!;
    const roots = (window as any).__zs.roots();
    let composed = 'n/a';
    if ((s as any).getComposedRanges) {
      const rs = (s as any).getComposedRanges({ shadowRoots: roots });
      composed = rs.map((r: any) => `${r.startContainer.nodeName}@${r.startOffset}..${r.endContainer.nodeName}${r.endContainer.getRootNode() instanceof ShadowRoot ? '(shadow)' : ''}@${r.endOffset}`).join(' | ');
    }
    return { toString: s.toString(), anchor: s.anchorNode?.nodeName + '@' + s.anchorOffset, focus: s.focusNode?.nodeName + '@' + s.focusOffset, composed };
  });

test('B3 selection and copy', async ({ page, base, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
  await helpers(page);
  await open(page, base + '/sel');
  const box = (await page.locator('#p').boundingBox())!;
  // Drag across the whole sentence.
  await page.mouse.move(box.x + 1, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 5 });
  await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  out('B3 drag selection', await selState(page));
  await page.locator('#p').screenshot({ path: `/tmp/zs-eval/${VARIANT}-drag.png` });
  await page.keyboard.press('Control+C');
  out('B3 drag copy', await clip(page));
  // Drag starting inside the converted text.
  const m = await page.evaluate(() => {
    const p = document.getElementById('p')!;
    const el = (window as any).__zs.marks().find((m: Element) => p.contains((m.getRootNode() as ShadowRoot).host) || (m.getRootNode() as ShadowRoot).host === p) ?? p.querySelector('zoneshift-text');
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top + r.height / 2, w: r.width };
  });
  await page.mouse.move(m.x + m.w * 0.4, m.y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 2, m.y, { steps: 8 });
  await page.mouse.up();
  out('B3 drag from inside the time', await selState(page));
  await page.locator('#p').screenshot({ path: `/tmp/zs-eval/${VARIANT}-drag-inside.png` });
  await page.keyboard.press('Control+C');
  out('B3 drag-inside copy', await clip(page));
  // Double-click on a word of the converted text, triple-click.
  await page.mouse.dblclick(m.x + m.w * 0.3, m.y);
  out('B3 double-click in time', await selState(page));
  await page.locator('#p').screenshot({ path: `/tmp/zs-eval/${VARIANT}-dbl.png` });
  await page.keyboard.press('Control+C');
  out('B3 double-click copy', await clip(page));
  await page.mouse.click(m.x + m.w * 0.3, m.y, { clickCount: 3 });
  out('B3 triple-click in time', await selState(page));
  await page.keyboard.press('Control+C');
  out('B3 triple-click copy', await clip(page));
  await page.mouse.click(5, 5);
  await page.keyboard.press('Control+A');
  out('B3 select all', await selState(page));
  await page.keyboard.press('Control+C');
  out('B3 select-all copy', await clip(page));
  await page.screenshot({ path: `/tmp/zs-eval/${VARIANT}-selectall.png`, clip: { x: 0, y: 0, width: 1000, height: 200 } });
});

test('B4 window.find', async ({ page, base }) => {
  await helpers(page);
  await open(page, base + '/sel');
  for (const q of ['5:30 PM PST', '1:30 AM UTC', 'Thursday', 'Friday']) {
    const r = await page.evaluate((q) => {
      getSelection()!.removeAllRanges();
      const found = (window as any).find(q);
      const s = getSelection()!;
      const rect = s.rangeCount ? s.getRangeAt(0).getBoundingClientRect() : null;
      return { found, sel: s.toString(), at: s.anchorNode ? `${s.anchorNode.nodeName}${s.anchorNode.getRootNode() instanceof ShadowRoot ? '(shadow)' : ''}` : null, rect: rect && `${Math.round(rect.width)}x${Math.round(rect.height)}` };
    }, q);
    out(`B4 window.find("${q}")`, r);
  }
});

test('B5 accessibility', async ({ page, base }) => {
  await helpers(page);
  await open(page, base + '/sel');
  out('B5 ariaSnapshot #p', (await page.locator('#p').ariaSnapshot()).replace(/\n/g, ' ⏎ '));
  const cdp = await page.context().newCDPSession(page);
  const { nodes } = (await cdp.send('Accessibility.getFullAXTree')) as any;
  const byId = new Map(nodes.map((n: any) => [n.nodeId, n]));
  const { root } = (await cdp.send('DOM.getDocument')) as any;
  const { nodeId } = (await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#p' })) as any;
  const { node } = (await cdp.send('DOM.describeNode', { nodeId })) as any;
  const para = nodes.find((n: any) => n.backendDOMNodeId === node.backendNodeId);
  const lines: string[] = [];
  const walk = (n: any, d: number) => {
    if (!n) return;
    if (!n.ignored) lines.push(`${'  '.repeat(d)}${n.role?.value} "${n.name?.value ?? ''}"`);
    for (const c of n.childIds ?? []) walk(byId.get(c), n.ignored ? d : d + 1);
  };
  walk(para, 0);
  out('B5 accessibility tree of #p (CDP)', lines.filter((l) => !l.includes('InlineTextBox')).join(' ⏎ '));
});

test('B6 print and MHTML', async ({ page, base }) => {
  await helpers(page);
  await open(page, base + '/sel');
  const pdf = `/tmp/zs-eval/${VARIANT}.pdf`;
  await page.pdf({ path: pdf });
  const cdp = await page.context().newCDPSession(page);
  const { data } = (await cdp.send('Page.captureSnapshot', { format: 'mhtml' })) as any;
  const body = data.replace(/=\r?\n/g, '').replace(/=3D/g, '=').replace(/=E2=88=92/g, '−');
  const i = body.indexOf('Maintenance');
  out('B6 MHTML (Save as single file) around the time', body.slice(i - 40, i + 600).replace(/\s+/g, ' '));
});
