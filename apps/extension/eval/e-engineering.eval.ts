import { helpers, html, open, out, pages, test, VARIANT } from './harness';

// C9-C11. CSP, Trusted Types, XHTML, custom elements, attachShadow patches,
// open/closed roots, framework-held text nodes, clones, editing.

const VIOL = `window.__viol=[];document.addEventListener('securitypolicyviolation',e=>window.__viol.push(e.violatedDirective+' '+e.blockedURI+' '+(e.sample||'')));`;

pages['/csp'] = { body: html(`<p id="p">Starts 1:30 AM UTC.</p>`, '', VIOL) };
pages['/tt'] = {
  body: html(`<p id="p">Starts 1:30 AM UTC.</p>`, '', VIOL),
  csp: "default-src 'none'; style-src 'nonce-fixture'; script-src 'nonce-fixture'; require-trusted-types-for 'script'; trusted-types 'none'",
};
for (const path of ['/csp', '/tt']) {
  test(`C9 ${path}: icon styled, no violations, popover opens`, async ({ page, base }) => {
    const errors: string[] = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await helpers(page);
    await open(page, base + path);
    const r = await page.evaluate(() => {
      const icon = (window as any).__zs.icons().find((i: Element) => document.getElementById('p')!.contains((i.getRootNode() as ShadowRoot).host ?? i) || (i.getRootNode() as ShadowRoot).host === document.getElementById('p'));
      return { radius: icon && getComputedStyle(icon).borderTopLeftRadius, bg: icon && getComputedStyle(icon).backgroundColor, sheetError: document.documentElement.dataset.zsSheetError ?? null };
    });
    await page.locator('#p .i, #p zoneshift-icon').first().click();
    const dialog = await page.getByRole('dialog', { name: 'Zoneshift' }).count();
    await page.waitForTimeout(200);
    out(`C9 ${path}`, { ...r, popoverOpen: dialog === 1, violations: await page.evaluate(() => (window as any).__viol), consoleErrors: errors });
  });
}

pages['/xhtml'] = {
  type: 'application/xhtml+xml',
  body: `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>x</title></head><body>
<p id="ready">Ready at 1:30 AM UTC.</p><p id="p">Meet at 2:30 AM UTC please.</p></body></html>`,
};
test('C9 XHTML', async ({ page, base }) => {
  await helpers(page);
  await open(page, base + '/xhtml');
  out('C9 XHTML', await page.evaluate(() => ({ shown: (window as any).__zs.shown(document.getElementById('p')), textContent: document.getElementById('p')!.textContent, html: document.getElementById('p')!.innerHTML })));
});

pages['/ce'] = {
  body: `<!doctype html><meta charset="utf-8"><title>t</title><body>
<script nonce="fixture">
window.__log=[];
customElements.define('zoneshift-mark', class extends HTMLElement { constructor(){ super(); window.__log.push('page constructor ran'); try { this.attachShadow({mode:'open'}).textContent='PAGE'; } catch(e) { window.__log.push('page attachShadow threw ' + e.name); } } });
const orig = Element.prototype.attachShadow;
Element.prototype.attachShadow = function (...a) { window.__log.push('patched attachShadow called on ' + this.localName); return orig.apply(this, a); };
</script>
<p id="ready">Ready at 1:30 AM UTC.</p><p id="p">Meet at 2:30 AM UTC please.</p></body>`,
};
test('C9 page defines our tag and patches attachShadow', async ({ page, base }) => {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await helpers(page);
  await page.goto(base + '/ce');
  await page.waitForTimeout(1200);
  out('C9 custom element + patched attachShadow', await page.evaluate(() => ({ log: (window as any).__log, shown: (window as any).__zs.shown(document.getElementById('p')), html: document.getElementById('p')!.innerHTML })));
  out('C9 console errors', errors);
});

pages['/reach'] = { body: html(`<p id="p">Meet at 2:30 AM UTC please.</p><div id="host"><span>child</span> Due 3:30 AM UTC</div>`) };
test('C9 what the page can reach', async ({ page, base }) => {
  await helpers(page);
  await open(page, base + '/reach');
  const r = await page.evaluate(() => {
    const p = document.getElementById('p')!;
    const host = p.querySelector('zoneshift-mark, zoneshift-run') ?? p;
    const root = (host as any).shadowRoot as ShadowRoot | null;
    let pageAttach = 'n/a';
    try {
      document.getElementById('host')!.attachShadow({ mode: 'open' });
      pageAttach = 'page attachShadow on #host ok';
    } catch (e) {
      pageAttach = 'page attachShadow on #host threw ' + (e as Error).name;
    }
    return {
      host: host.localName,
      shadowRootVisibleToPage: !!root,
      pageCanReadConverted: root ? root.textContent : null,
      pageAttach,
      hostShown: (window as any).__zs.shown(document.getElementById('host')),
    };
  });
  out('C9 reach', r);
  // Interaction with closed roots: click and keyboard.
  const icon = page.locator('#p .i, #p zoneshift-icon');
  if (await icon.count()) await icon.first().click();
  else {
    const box = await page.evaluate(() => {
      const h = document.querySelector('#p zoneshift-mark')!;
      const r = h.getBoundingClientRect();
      return { x: r.right - 6, y: r.top + r.height / 2 };
    });
    await page.mouse.click(box.x, box.y);
  }
  const clickOpens = await page.getByRole('dialog', { name: 'Zoneshift' }).count();
  await page.keyboard.press('Escape');
  await page.locator('#ready').click();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  const focused = await page.evaluate(() => document.activeElement?.localName + (document.activeElement?.id ? '#' + document.activeElement.id : ''));
  await page.keyboard.press('Enter');
  const keyOpens = await page.getByRole('dialog', { name: 'Zoneshift' }).count();
  out('C9 icon interaction', { clickOpens, focusedAfterTabs: focused, keyOpens });
});

// C10. A framework holding the page's own Text node (React keeps one per text child).
pages['/react'] = {
  body: html(`<p id="a">Starts 1:30 AM UTC today</p><p id="b">Ends 2:30 AM UTC today</p><p id="c">Opens 3:30 AM UTC <b>x</b></p><div id="d">Item: 4:30 AM UTC</div>`, '',
    `window.held = { a: document.getElementById('a').firstChild, b: document.getElementById('b').firstChild, c: document.getElementById('c').firstChild, d: document.getElementById('d').firstChild };`),
};
test('C10 framework-held text nodes', async ({ page, base }) => {
  await helpers(page);
  await open(page, base + '/react');
  const r = await page.evaluate(async () => {
    const h = (window as any).held;
    const z = (window as any).__zs;
    const res: Record<string, unknown> = {};
    res.heldStillInParent = Object.fromEntries(Object.entries(h).map(([k, t]: [string, any]) => [k, t.parentNode?.localName ?? null]));
    // React commitTextUpdate: nodeValue on the held node.
    h.a.nodeValue = 'Starts 9:00 AM UTC tomorrow';
    await new Promise((r) => setTimeout(r, 400));
    res.afterNodeValue = { shown: z.shown(document.getElementById('a')), textContent: document.getElementById('a')!.textContent };
    // React removeChild.
    try {
      document.getElementById('b')!.removeChild(h.b);
      res.removeChild = 'ok, shown now: "' + z.shown(document.getElementById('b')) + '"';
    } catch (e) {
      res.removeChild = 'threw ' + (e as Error).name + ', shown: "' + z.shown(document.getElementById('b')) + '"';
    }
    // React insertBefore with the held node as reference.
    try {
      const n = document.createElement('i');
      n.textContent = 'new ';
      document.getElementById('c')!.insertBefore(n, h.c);
      res.insertBefore = 'ok, shown now: "' + z.shown(document.getElementById('c')) + '"';
    } catch (e) {
      res.insertBefore = 'threw ' + (e as Error).name;
    }
    // React setTextContent on a single text child (element.textContent = ...).
    document.getElementById('d')!.textContent = 'Item: 5:30 AM UTC';
    await new Promise((r) => setTimeout(r, 400));
    res.afterTextContent = z.shown(document.getElementById('d'));
    return res;
  });
  for (const [k, v] of Object.entries(r)) out('C10 ' + k, v);
});

// C11. Clones and editing.
pages['/clone'] = { body: html(`<div id="slide"><p>Kick-off 2:30 AM UTC</p></div><div id="e"><p>Call at 4:30 AM UTC today please.</p></div>`) };
test('C11 clone and click-to-edit', async ({ page, base }) => {
  await helpers(page);
  await open(page, base + '/clone');
  const r = await page.evaluate(async () => {
    const z = (window as any).__zs;
    const copy = document.getElementById('slide')!.cloneNode(true) as HTMLElement;
    copy.id = 'copy';
    const before = { html: copy.innerHTML };
    document.body.append(copy);
    const shownAtInsert = z.shown(copy);
    await new Promise((r) => setTimeout(r, 400));
    return { cloneMarkup: before.html, shownAtInsert, shownAfter400ms: z.shown(copy), htmlAfter400ms: copy.innerHTML };
  });
  for (const [k, v] of Object.entries(r)) out('C11 ' + k, v);
  // Click-to-edit (contenteditable on mousedown), click in "today" after the time, type.
  await page.evaluate(() => {
    const e = document.getElementById('e')!;
    e.addEventListener('mousedown', () => (e.contentEditable = 'true'));
  });
  const box = await page.evaluate(() => {
    const p = document.querySelector('#e p')!;
    const r = p.getBoundingClientRect();
    return { x: r.left, y: r.top + r.height / 2, w: r.width };
  });
  const textWidth = await page.evaluate(() => {
    const r = document.createRange();
    r.selectNodeContents(document.querySelector('#e p')!);
    return r.getBoundingClientRect().width;
  });
  out('C11 width of the paragraph text as the page measures it (Range over light DOM)', Math.round(textWidth));
  // Click roughly inside the converted time.
  const m = await page.evaluate(() => {
    const p = document.querySelector('#e p')!;
    const mk = (window as any).__zs.marks().find((x: Element) => p.contains((x.getRootNode() as ShadowRoot).host) || (x.getRootNode() as ShadowRoot).host === p) ?? p.querySelector('zoneshift-text');
    const r = mk.getBoundingClientRect();
    return { x: r.left + r.width * 0.5, y: r.top + r.height / 2 };
  });
  await page.mouse.click(m.x, m.y);
  await page.keyboard.type('X');
  out('C11 click-to-edit inside the time, typed X', await page.locator('#e').innerHTML());
});
