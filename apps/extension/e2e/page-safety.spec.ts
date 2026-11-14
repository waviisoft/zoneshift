import { test as base, chromium, expect, type BrowserContext, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';

/**
 * The page is never corrupted or restyled: foreign content, form controls,
 * editable content, site CSS, flex and grid layouts, keyboard and focus.
 * Loads the built Chrome extension (run `pnpm build:chrome` first).
 */

const extensionPath = fileURLToPath(new URL('../.output/chrome-mv3', import.meta.url));
// The same strict policy as the main fixture: page styles need the nonce, and
// page scripts cannot run (tests add listeners with page.evaluate instead).
const CSP = "default-src 'none'; style-src 'nonce-fixture'";

type Fixture = { body: string; type?: string };
const pages: Record<string, Fixture> = {};
const html = (body: string, css = '') =>
  `<!doctype html><meta charset="utf-8"><title>t</title><style nonce="fixture">${css}</style><body>${body}</body>`;

const test = base.extend<{ context: BrowserContext; base: string }>({
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      executablePath: process.env.ZONESHIFT_CHROMIUM || undefined,
      timezoneId: 'America/Los_Angeles',
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    await use(context);
    await context.close();
  },
  base: async ({}, use) => {
    const server: Server = createServer((req, res) => {
      const page = pages[req.url!.split('?')[0]!];
      if (!page) {
        res.statusCode = 404;
        res.end();
        return;
      }
      res.setHeader('content-type', page.type ?? 'text/html');
      res.setHeader('content-security-policy', CSP);
      res.end(page.body);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    await use(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    server.close();
  },
});

/** Every page has a #ready paragraph; its mark shows the annotator has run. */
const READY = '<p id="ready">Ready at 1:30 AM UTC.</p>';
async function open(page: Page, url: string) {
  await page.goto(url);
  await page.locator('#ready .zoneshift').waitFor();
}
const settle = (page: Page) => page.waitForTimeout(500);

pages['/foreign'] = {
  body: html(`${READY}
    <svg width="400" height="60"><text id="t" x="0" y="20">Start 1:30 AM UTC end</text><title id="st">1:30 AM UTC</title></svg>
    <math><mtext id="m">1:30 AM UTC</mtext></math>
    <input id="in" list="d"><datalist id="d"><option id="o">1:30 AM UTC</option></datalist>`),
};
test('leaves SVG, MathML and form options alone', async ({ page, base }) => {
  await open(page, `${base}/foreign`);
  await settle(page);
  for (const id of ['t', 'st', 'm', 'o']) {
    expect(await page.locator(`#${id}`).evaluate((e) => e.innerHTML), id).toBe(id === 't' ? 'Start 1:30 AM UTC end' : '1:30 AM UTC');
  }
  // The SVG text still renders all of its characters.
  expect(await page.locator('#t').evaluate((e) => (e as SVGTextElement).getNumberOfChars())).toBe(21);
});

pages['/xhtml'] = {
  type: 'application/xhtml+xml',
  body: `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>x</title></head><body>
<p id="ready">Ready at 1:30 AM UTC.</p>
<form><textarea id="ta" name="note">Meet at 1:30 AM UTC please</textarea>
<select id="sel"><option>2:30 AM UTC</option></select></form>
</body></html>`,
};
test('on an XHTML page, converts prose but leaves form controls alone', async ({ page, base }) => {
  await open(page, `${base}/xhtml`);
  await expect(page.locator('#ready')).toHaveText('Ready at 5:30 PM PST (−1 day).');
  expect(await page.locator('#ta').evaluate((e) => (e as HTMLTextAreaElement).value)).toBe('Meet at 1:30 AM UTC please');
  expect(await page.locator('#ta').evaluate((e) => e.innerHTML)).toBe('Meet at 1:30 AM UTC please');
  expect(await page.locator('#sel option').evaluate((e) => e.childNodes.length + ' ' + e.textContent)).toBe('1 2:30 AM UTC');
});

pages['/editable'] = {
  body: html(
    `${READY}
    <div id="ed" contenteditable="true"><p>Draft</p><span id="chip" contenteditable="false">Due 1:30 AM UTC</span></div>
    <div id="um" class="user-modify">Plain 1:30 AM UTC</div>
    <div id="later"><p>Meeting at 1:30 AM UTC.</p></div>
    <div id="styled" tabindex="0"><p>Review at 2:30 AM UTC.</p></div>`,
    '.user-modify { -webkit-user-modify: read-write; }',
  ),
};
test('leaves editors alone, including non-editable islands and CSS-editable regions', async ({ page, base }) => {
  await open(page, `${base}/editable`);
  await settle(page);
  await expect(page.locator('#ed .zoneshift')).toHaveCount(0);
  await expect(page.locator('#um .zoneshift')).toHaveCount(0);
});
test('content that becomes editable gets its own text back before it can be saved', async ({ page, base }) => {
  await open(page, `${base}/editable`);
  await page.locator('#later .zoneshift').waitFor();
  // The marks go at the next microtask, before the site can react to input.
  const saved = await page.evaluate(async () => {
    const d = document.getElementById('later')!;
    d.contentEditable = 'true';
    await Promise.resolve();
    return d.innerHTML;
  });
  expect(saved).toBe('<p>Meeting at 1:30 AM UTC.</p>');
  await settle(page);
  await expect(page.locator('#later .zoneshift')).toHaveCount(0);

  // Made editable by a style, which no observer sees: focus going in restores it.
  await page.locator('#styled .zoneshift').waitFor();
  await page.evaluate(() => document.getElementById('styled')!.classList.add('user-modify'));
  await page.locator('#styled').focus();
  expect(await page.locator('#styled').evaluate((e) => e.innerHTML)).toBe('<p>Review at 2:30 AM UTC.</p>');
});
test('a document switched to design mode gets its own text back', async ({ page, base }) => {
  await open(page, `${base}/editable`);
  await page.evaluate(() => {
    document.designMode = 'on';
  });
  await page.locator('#later p').click();
  await expect(page.locator('.zoneshift')).toHaveCount(0);
  expect(await page.locator('#later').evaluate((e) => e.innerHTML)).toBe('<p>Meeting at 1:30 AM UTC.</p>');
});

pages['/layout'] = {
  body: html(
    `${READY}
    <div id="f" class="flex">Starts 1:30 AM UTC today</div>
    <div id="g" class="grid">Opens 1:30 AM UTC daily<span id="gs">right</span></div>`,
    `.flex { display: flex; justify-content: space-between; width: 600px; font: 16px monospace; }
     .grid { display: grid; grid-template-columns: 1fr 1fr; width: 600px; }`,
  ),
};
test('a flex or grid container keeps the same number of items', async ({ page, base }) => {
  await open(page, `${base}/layout`);
  await page.locator('#f .zoneshift').waitFor();
  await expect(page.locator('#f')).toHaveText('Starts 5:30 PM PST (−1 day) today');
  // One item, so space-between does not spread the words across the row.
  const flex = await page.locator('#f').evaluate((f) => {
    const range = document.createRange();
    range.selectNodeContents(f);
    return { children: f.childNodes.length, width: range.getBoundingClientRect().width };
  });
  expect(flex.children).toBe(1);
  expect(flex.width).toBeLessThan(400);
  // Still two grid cells side by side: the text and the span share a row.
  const run = await page.locator('#g > zoneshift-run').boundingBox();
  const span = await page.locator('#gs').boundingBox();
  expect(Math.abs(run!.y - span!.y)).toBeLessThan(2);
  expect(span!.x).toBeGreaterThan(run!.x + 250);
});

pages['/sitecss'] = {
  body: html(
    `${READY}
    <p class="meta" id="m"><span>by Bob</span> posted 1:30 AM UTC</p>
    <p class="hostile" id="h">Posted 1:30 AM UTC</p>
    <p id="clean">Posted 1:30 AM UTC</p>`,
    `.meta span { font-weight: 700; color: rgb(200, 0, 0); padding: 0 6px; border: 1px solid rgb(0, 0, 0); }
     .meta span + span::before { content: " · "; }
     .hostile * { padding: 0 6px; margin: 0 9px; border: 2px solid red; width: 40px; background: yellow; }
     .hostile *::before, .hostile *::after { content: "·"; }
     p { font-size: 16px; color: rgb(20, 30, 40); }`,
  ),
};
test('site CSS aimed at spans or every element does not restyle the time or the icon', async ({ page, base }) => {
  await open(page, `${base}/sitecss`);
  for (const id of ['m', 'h']) {
    const r = await page.locator(`#${id}`).evaluate((p) => {
      const style = (sel: string, pseudo?: string) => getComputedStyle(p.querySelector(sel)!, pseudo);
      const box = (e: Element) => e.getBoundingClientRect();
      return {
        weights: ['zoneshift-run', 'zoneshift-mark', 'zoneshift-text'].map((s) => style(s).fontWeight),
        colors: ['zoneshift-run', 'zoneshift-mark', 'zoneshift-text'].map((s) => style(s).color),
        boxes: ['zoneshift-run', 'zoneshift-mark', 'zoneshift-text'].map(
          (s) => style(s).paddingLeft + style(s).borderLeftWidth + style(s).marginLeft,
        ),
        generated: ['zoneshift-run', 'zoneshift-mark', 'zoneshift-text'].flatMap((s) => [
          style(s, '::before').content,
          style(s, '::after').content,
        ]),
        icon: {
          width: Math.round(box(p.querySelector('zoneshift-icon')!).width),
          padding: style('zoneshift-icon').paddingLeft,
          border: style('zoneshift-icon').borderTopColor,
          background: style('zoneshift-icon').backgroundColor,
          before: style('zoneshift-icon', '::before').content,
        },
      };
    });
    const clean = await page
      .locator('#clean zoneshift-icon')
      .evaluate((i) => Math.round(i.getBoundingClientRect().width));
    expect(r.weights, id).toEqual(['400', '400', '400']);
    expect(r.colors, id).toEqual(Array(3).fill('rgb(20, 30, 40)'));
    expect(r.boxes, id).toEqual(Array(3).fill('0px0px0px'));
    expect(r.generated, id).toEqual(Array(6).fill('none'));
    expect(r.icon, id).toEqual({
      width: clean,
      padding: '0px',
      border: 'rgb(37, 99, 235)',
      background: 'rgb(37, 99, 235)',
      before: '""',
    });
  }
});

pages['/rtl'] = { body: html(`${READY}<p id="r" dir="rtl">الاجتماع في 1:30 AM UTC غدا</p>`) };
test('the gap before the icon follows the writing direction', async ({ page, base }) => {
  await open(page, `${base}/rtl`);
  const icon = page.locator('#r .zoneshift-icon');
  await expect(icon).toHaveCSS('margin-left', '0px');
  expect(parseFloat(await icon.evaluate((e) => getComputedStyle(e).marginRight))).toBeGreaterThan(0);
});

pages['/keys'] = {
  body: html(`${READY}
    <p id="p">At 1:30 AM UTC.</p>
    <div id="row" tabindex="0">Ticket 2:30 AM UTC</div>
    <form id="frm" action="/submitted"><button id="btn" type="submit">Send at 3:30 AM UTC</button></form>
    <p><a id="md" href="#z">Down 4:30 AM UTC</a></p>
    <div id="modal" role="dialog" aria-label="Site modal">Site modal</div>`),
};
pages['/submitted'] = { body: html('submitted') };
test('focus returns to the icon when the popover closes, and stays in it while open', async ({ page, base }) => {
  await open(page, `${base}/keys`);
  const icon = page.locator('#p .zoneshift-icon');
  const active = () =>
    page.evaluate(() => {
      const a = document.activeElement;
      return a?.shadowRoot?.activeElement?.textContent ?? a?.className ?? a?.tagName;
    });
  await icon.focus();
  await page.keyboard.press('Enter');
  await expect(icon).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  expect(await active()).toBe('zoneshift-icon');
  await expect(icon).toHaveAttribute('aria-expanded', 'false');

  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter'); // "Show original here"
  await expect(page.getByRole('dialog', { name: 'Zoneshift' })).toHaveCount(0);
  expect(await active()).toBe('zoneshift-icon');

  await page.keyboard.press('Enter');
  await page.keyboard.press('Shift+Tab');
  expect(await active()).toBe('Show all originals on this page');
  await page.keyboard.press('Tab');
  expect(await active()).toBe('Convert to local time');
  await expect(page.getByRole('dialog', { name: 'Zoneshift' })).toBeVisible();
});
test('keys and presses on the icon do not reach the page, a link or a button', async ({ page, base }) => {
  await open(page, `${base}/keys`);
  await page.evaluate(() => {
    const hits: string[] = ((window as unknown as { hits: string[] }).hits = []);
    document.getElementById('row')!.addEventListener('keydown', (e) => hits.push(`row ${e.key}`));
    for (const type of ['pointerdown', 'mousedown', 'mouseup', 'pointerup']) {
      document.getElementById('md')!.addEventListener(type, () => hits.push(`link ${type}`));
    }
  });
  const hits = () => page.evaluate(() => (window as unknown as { hits: string[] }).hits);

  await page.locator('#row .zoneshift-icon').focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await page.locator('#md .zoneshift-icon').click();
  await page.keyboard.press('Escape');
  expect(await hits()).toEqual([]);

  // Neither a click nor Space on the icon submits the form around it.
  await page.locator('#btn .zoneshift-icon').click();
  await expect(page.getByRole('dialog', { name: 'Zoneshift' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.locator('#btn .zoneshift-icon').focus();
  await page.keyboard.press(' ');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  expect(page.url()).not.toContain('submitted');
});
test('Escape closes only the popover; with the popover closed it is the page’s', async ({ page, base }) => {
  await open(page, `${base}/keys`);
  await page.evaluate(() =>
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') document.getElementById('modal')?.remove();
    }),
  );
  await page.locator('#p .zoneshift-icon').click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Zoneshift' })).toHaveCount(0);
  await expect(page.locator('#modal')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('#modal')).toHaveCount(0);
});

pages['/scroll'] = {
  body: html(
    `${READY}<div id="box" class="box"><div class="tall">x</div></div><p id="p">At 1:30 AM UTC.</p><div class="tall"></div>`,
    '.box { height: 80px; overflow: auto; } .tall { height: 2000px; }',
  ),
};
test('scrolling another box leaves the popover open; scrolling the page closes it', async ({ page, base }) => {
  await open(page, `${base}/scroll`);
  await page.locator('#p .zoneshift-icon').click();
  await page.evaluate(() => {
    document.getElementById('box')!.scrollTop += 50;
  });
  await page.waitForTimeout(200);
  await expect(page.getByRole('dialog', { name: 'Zoneshift' })).toBeVisible();
  await page.evaluate(() => window.scrollBy(0, 50));
  await expect(page.getByRole('dialog', { name: 'Zoneshift' })).toHaveCount(0);
});

pages['/turbo'] = { body: html(READY) };
test('content is still annotated after the site replaces <body>', async ({ page, base }) => {
  await open(page, `${base}/turbo`);
  await page.evaluate(() => {
    const body = document.createElement('body');
    body.innerHTML = '<p id="n">Second page 2:30 AM UTC</p>';
    document.body.replaceWith(body);
  });
  await expect(page.locator('#n')).toHaveText('Second page 6:30 PM PST (−1 day)');
  await page.evaluate(() => document.body.insertAdjacentHTML('beforeend', '<p id="n2">Later 3:30 AM UTC</p>'));
  await expect(page.locator('#n2')).toHaveText('Later 7:30 PM PST (−1 day)');
});

pages['/image.svg'] = {
  type: 'image/svg+xml',
  body: '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="50"><text x="0" y="20">At 1:30 AM UTC</text></svg>',
};
pages['/data.xml'] = { type: 'application/xml', body: '<?xml version="1.0"?><root><when>1:30 AM UTC</when></root>' };
test('SVG and XML documents are left alone', async ({ page, base }) => {
  await page.goto(`${base}/image.svg`);
  await settle(page);
  expect(await page.evaluate(() => document.documentElement.outerHTML)).toBe(
    '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="50"><text x="0" y="20">At 1:30 AM UTC</text></svg>',
  );
  await page.goto(`${base}/data.xml`);
  await settle(page);
  expect(await page.evaluate(() => document.querySelector('when')!.textContent)).toBe('1:30 AM UTC');
  expect(await page.evaluate(() => document.getElementsByTagName('zoneshift-run').length)).toBe(0);
});

pages['/copies'] = {
  body: html(`${READY}
    <div id="e1"><p>Meeting at 1:30 AM UTC.</p></div>
    <button id="edit">Edit</button><button id="cancel">Cancel</button><button id="save">Save</button>
    <div id="slide"><p>Kick-off 2:30 AM UTC</p></div>
    <p id="src">Launch on Friday, November 13, 2026, at 1:30 AM UTC sharp.</p>
    <div id="ed" contenteditable="true"></div>`),
};
test('edit, cancel from a snapshot, edit, save: the site saves the original time', async ({ page, base }) => {
  await open(page, `${base}/copies`);
  await page.locator('#e1 .zoneshift').waitFor();
  // A common click-to-edit: snapshot for Cancel taken as editing starts.
  await page.evaluate(() => {
    const w = window as unknown as { saved: string[] };
    w.saved = [];
    const e = document.getElementById('e1')!;
    let snapshot = '';
    document.getElementById('edit')!.onclick = () => {
      e.contentEditable = 'true';
      snapshot = e.innerHTML;
      e.focus();
    };
    document.getElementById('cancel')!.onclick = () => {
      e.innerHTML = snapshot;
      e.contentEditable = 'false';
    };
    document.getElementById('save')!.onclick = () => {
      w.saved.push(e.innerHTML);
      e.contentEditable = 'false';
    };
  });
  await page.click('#edit');
  await page.click('#cancel');
  // After Cancel the time is converted again, with a working icon.
  await expect(page.locator('#e1')).toHaveText('Meeting at 5:30 PM PST (−1 day).');
  await page.locator('#e1 .zoneshift-icon').click();
  await expect(page.getByRole('dialog', { name: 'Zoneshift' })).toContainText('1:30 AM UTC');
  await page.keyboard.press('Escape');
  await page.click('#edit');
  await page.click('#save');
  expect(await page.evaluate(() => (window as unknown as { saved: string[] }).saved)).toEqual([
    '<p>Meeting at 1:30 AM UTC.</p>',
  ]);
});
test('a cloned slide gets a working icon that follows the page-wide choice', async ({ page, base }) => {
  await open(page, `${base}/copies`);
  await page.locator('#slide .zoneshift').waitFor();
  await page.evaluate(() => {
    const copy = document.getElementById('slide')!.cloneNode(true) as HTMLElement;
    copy.id = 'copy';
    document.body.append(copy);
  });
  await expect(page.locator('#copy')).toHaveText('Kick-off 6:30 PM PST (−1 day)');
  await page.locator('#copy .zoneshift-icon').click();
  await page.getByRole('button', { name: 'Show all originals on this page' }).click();
  await expect(page.locator('#copy')).toHaveText('Kick-off 2:30 AM UTC');
  await expect(page.locator('#slide')).toHaveText('Kick-off 2:30 AM UTC');
});
test('copying puts only the shown text on the clipboard, and pasting into an editor carries no marks', async ({
  page,
  base,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
  await open(page, `${base}/copies`);
  await page.locator('#src .zoneshift').waitFor();
  const shown = await page.locator('#src').innerText();
  await page.evaluate(() => {
    const range = document.createRange();
    range.selectNodeContents(document.getElementById('src')!);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
  });
  await page.keyboard.press('Control+C');
  const clip = await page.evaluate(async () => {
    const out: Record<string, string> = {};
    for (const item of await navigator.clipboard.read()) {
      for (const type of item.types) out[type] = await (await item.getType(type)).text();
    }
    return out;
  });
  expect(clip['text/plain']).toBe(shown);
  // Plain text only: the browser's HTML would carry Zoneshift's elements.
  expect(clip['text/html']).toBeUndefined();
  await page.locator('#ed').click();
  await page.keyboard.press('Control+V');
  await expect(page.locator('#ed')).toContainText('5:30 PM PST');
  expect(await page.locator('#ed').innerHTML()).not.toMatch(/zoneshift|data-zs-/);
});

pages['/modal'] = {
  body: html(`${READY}<dialog id="dlg"><p id="dp">Event at 2:30 AM UTC</p><button id="close">Close</button></dialog>`),
};
test('the popover works inside a modal dialog', async ({ page, base }) => {
  await open(page, `${base}/modal`);
  await page.evaluate(() => (document.getElementById('dlg') as HTMLDialogElement).showModal());
  await page.locator('#dp .zoneshift-icon').click();
  const dialog = page.getByRole('dialog', { name: 'Zoneshift' });
  await expect(dialog).toBeVisible();
  // On top of the modal and focusable, not behind it and inert.
  const r = await page.evaluate(() => {
    const host = document.getElementById('zoneshift-popover')!;
    const button = host.shadowRoot!.querySelector('button')!;
    const box = button.getBoundingClientRect();
    return {
      hit: document.elementFromPoint(box.left + 5, box.top + 5) === host,
      focused: host.shadowRoot!.activeElement === button,
    };
  });
  expect(r).toEqual({ hit: true, focused: true });
  await dialog.getByRole('button', { name: 'Show original here' }).click();
  await expect(page.locator('#dp')).toHaveText('Event at 2:30 AM UTC');
  // Escape closes only the popover; the site's dialog stays open.
  await page.locator('#dp .zoneshift-icon').click();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => (document.getElementById('dlg') as HTMLDialogElement).open)).toBe(true);
});

pages['/caret'] = {
  body: html(`${READY}
    <div id="c1"><p>Call at 4:30 AM UTC today please.</p></div>
    <div id="c2" tabindex="-1"><p>Review at 4:30 AM UTC today please.</p></div>`),
};
test('click-to-edit keeps the caret where the reader clicked', async ({ page, base }) => {
  await open(page, `${base}/caret`);
  await page.locator('#c2 .zoneshift').waitFor();
  await page.evaluate(() => {
    const c1 = document.getElementById('c1')!;
    c1.addEventListener('mousedown', () => (c1.contentEditable = 'true'));
    const c2 = document.getElementById('c2')!;
    c2.addEventListener('click', () => {
      c2.contentEditable = 'true';
      c2.focus();
    });
  });
  for (const id of ['c1', 'c2']) {
    // Click inside the word "today", after the time.
    const box = await page.locator(`#${id} zoneshift-run`).evaluate((run) => {
      const text = run.lastChild as Text;
      const range = document.createRange();
      range.setStart(text, text.data.indexOf('today') + 2);
      range.setEnd(text, text.data.indexOf('today') + 3);
      const r = range.getBoundingClientRect();
      return { x: r.left + 1, y: r.top + r.height / 2 };
    });
    await page.mouse.click(box.x, box.y);
    await page.keyboard.type('X');
    const word = id === 'c1' ? 'Call' : 'Review';
    await expect(page.locator(`#${id}`)).toHaveText(`${word} at 4:30 AM UTC toXday please.`);
  }
});

pages['/fight'] = {
  body: html(`${READY}<div id="f"><p>Fight 3:30 AM UTC.</p></div><div id="g"><p>Fight 4:30 AM UTC.</p></div>`),
};
test('a site observer that puts an annotated snapshot back does not hang the page, and settles', async ({
  page,
  base,
}) => {
  await open(page, `${base}/fight`);
  await page.locator('#f .zoneshift').waitFor();
  await page.evaluate(() => {
    const w = window as unknown as { n: number };
    const f = document.getElementById('f')!;
    // Taken with the popover open, so it never matches what the annotator makes.
    (f.querySelector('zoneshift-icon') as HTMLElement).click();
    const snapshot = f.innerHTML;
    document.body.click();
    w.n = 0;
    new MutationObserver(() => {
      if (f.innerHTML !== snapshot) {
        w.n++;
        f.innerHTML = snapshot;
      }
    }).observe(f, { childList: true, subtree: true, attributes: true });
    f.innerHTML = snapshot;
  });
  const count = () => page.evaluate(() => (window as unknown as { n: number }).n);
  // The page still answers, and the fight stops within a few rounds.
  const started = Date.now();
  await count();
  expect(Date.now() - started).toBeLessThan(1000);
  await page.waitForTimeout(2000);
  const settled = await count();
  expect(settled).toBeLessThanOrEqual(6);
  await page.waitForTimeout(1500);
  expect(await count()).toBe(settled);
});
test('a site that keeps restoring its own text is left alone after a few rounds', async ({ page, base }) => {
  await open(page, `${base}/fight`);
  await page.locator('#g .zoneshift').waitFor();
  const rewrites = await page.evaluate(async () => {
    const g = document.getElementById('g')!;
    const want = 'Fight 4:30 AM UTC.';
    let n = 0;
    const t = setInterval(() => {
      if (g.textContent !== want) {
        g.innerHTML = '<p>Fight 4:30 AM UTC.</p>';
        n++;
      }
    }, 50);
    await new Promise((r) => setTimeout(r, 3000));
    clearInterval(t);
    return n;
  });
  expect(rewrites).toBeLessThanOrEqual(7);
});

pages['/clip'] = {
  body: html(
    `${READY}
    <div id="a"><h2 id="h">Launch <b>notes</b></h2>
    <p id="p1">See <a href="/docs/launch">the docs</a> before 1:30 AM UTC.</p>
    <p id="p2"><span class="nosel">42</span> Deploy 2:30 AM UTC <img src="/logo.png" alt="logo" width="10"></p></div>
    <table id="t"><tr><td id="c1">Start</td><td>1:30 AM UTC</td></tr><tr><td>End</td><td id="c4">3:30 AM UTC</td></tr></table>
    <pre id="log">2026-11-13T01:30:00Z INFO  server started
2026-11-13T01:30:02Z WARN  cache cold
2026-11-13T01:30:05Z INFO  ready</pre>
    <p id="nm">No marks here, just <a href="/x">a link</a>.</p>
    <div id="own"><p id="op">Own handler 4:30 AM UTC</p></div>
    <div id="sink" contenteditable="true"></div>`,
    '.nosel { user-select: none; }',
  ),
};
const selectBetween = (page: Page, start: string, end: string) =>
  page.evaluate(
    ([s, e]) => {
      const r = document.createRange();
      r.setStartBefore(document.querySelector(s)!);
      r.setEndAfter(document.querySelector(e)!);
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(r);
    },
    [start, end] as const,
  );
async function copied(page: Page): Promise<Record<string, string>> {
  await page.keyboard.press('Control+C');
  return page.evaluate(async () => {
    const out: Record<string, string> = {};
    for (const item of await navigator.clipboard.read()) {
      for (const type of item.types) out[type] = await (await item.getType(type)).text();
    }
    return out;
  });
}
/** What Chromium itself copies for the same selections, without the extension. */
async function baseline(base: string, selections: [string, string][]): Promise<Record<string, string>[]> {
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    executablePath: process.env.ZONESHIFT_CHROMIUM || undefined,
    timezoneId: 'America/Los_Angeles',
  });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
  const page = await context.newPage();
  await page.goto(`${base}/clip`);
  const out = [];
  for (const [s, e] of selections) {
    await selectBetween(page, s, e);
    out.push(await copied(page));
  }
  await context.close();
  return out;
}
const SELECTIONS: [string, string][] = [
  ['#h', '#p2'],
  ['#c1', '#c4'],
  ['#log', '#log'],
  ['#nm', '#nm'],
];
test('copying times gives the browser’s own plain text, and no HTML; other copies are untouched', async ({
  page,
  base,
  context,
}) => {
  const [blocks, table, log, noMarks] = await baseline(base, SELECTIONS);
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
  await open(page, `${base}/clip`);
  await page.locator('#c4 .zoneshift').waitFor();
  const results = [];
  for (const [s, e] of SELECTIONS) {
    await selectBetween(page, s, e);
    results.push(await copied(page));
  }
  const converted = (text: string) =>
    text
      .replace('1:30 AM UTC.', '5:30 PM PST (−1 day).')
      .replace('2:30 AM UTC', '6:30 PM PST (−1 day)')
      .replace('Start\t1:30 AM UTC', 'Start\t5:30 PM PST (−1 day)')
      .replace('3:30 AM UTC', '7:30 PM PST (−1 day)');
  // Blocks (with a link, an unselectable number and an image's alt text),
  // a table, and a log left as written: the browser's plain text with the
  // shown times, and no HTML.
  expect(results[0]).toEqual({ 'text/plain': converted(blocks!['text/plain']!) });
  expect(results[0]!['text/plain']).toContain('logo');
  expect(results[1]).toEqual({ 'text/plain': converted(table!['text/plain']!) });
  expect(results[2]).toEqual({ 'text/plain': log!['text/plain'] });
  // Nothing annotated in the selection: exactly what the browser copies.
  expect(results[3]).toEqual(noMarks);
  expect(noMarks!['text/html']).toContain('href=');
});
test('copied log lines paste as lines, and pasted times carry no marks', async ({ page, base, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
  await open(page, `${base}/clip`);
  await page.locator('#log .zoneshift').first().waitFor();
  // Selected inside the log, from its first text to its last, as a reader would.
  await page.evaluate(() => {
    const walker = document.createTreeWalker(document.getElementById('log')!, NodeFilter.SHOW_TEXT);
    const texts: Text[] = [];
    while (walker.nextNode()) texts.push(walker.currentNode as Text);
    const last = texts[texts.length - 1]!;
    getSelection()!.setBaseAndExtent(texts[0]!, 0, last, last.data.length);
  });
  await page.keyboard.press('Control+C');
  await page.locator('#sink').click();
  await page.keyboard.press('Control+V');
  await expect(page.locator('#sink')).toHaveText(/server started/);
  expect((await page.locator('#sink').innerText()).trim().split('\n')).toHaveLength(3);
  await page.evaluate(() => (document.getElementById('sink')!.innerHTML = ''));
  await selectBetween(page, '#p1', '#p1');
  await page.keyboard.press('Control+C');
  await page.locator('#sink').click();
  await page.keyboard.press('Control+V');
  await expect(page.locator('#sink')).toContainText('See the docs before 5:30 PM PST (−1 day).');
  expect(await page.locator('#sink').innerHTML()).not.toMatch(/zoneshift|data-zs-/);
});
test('a site copy handler that stops the event cannot leave marks on the clipboard', async ({
  page,
  base,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
  await open(page, `${base}/clip`);
  await page.locator('#op .zoneshift').waitFor();
  await page.evaluate(() => document.getElementById('own')!.addEventListener('copy', (e) => e.stopPropagation()));
  await selectBetween(page, '#op', '#op');
  expect(await copied(page)).toEqual({ 'text/plain': 'Own handler 8:30 PM PST (−1 day)' });
});
