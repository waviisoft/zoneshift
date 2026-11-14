import { html, open, out, pages, test } from './harness';

// A2: drag-and-drop of selected text into a textarea and an editor.
pages['/dnd'] = {
  body: html(`<p id="p">Maintenance starts Friday, Nov 13, 2026 at 1:30 AM UTC and should take an hour.</p><textarea id="ta" rows="3" cols="60"></textarea><div id="ed" contenteditable="true" style="min-height:40px;border:1px solid"></div>`, 'p{font:18px/1.5 sans-serif;margin:20px}'),
};
test('A2 drag and drop', async ({ page, base }) => {
  await open(page, base + '/dnd');
  for (const target of ['#ta', '#ed']) {
    await page.evaluate(() => {
      const r = document.createRange();
      r.selectNodeContents(document.getElementById('p')!);
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(r);
    });
    const p = (await page.locator('#p').boundingBox())!;
    const t = (await page.locator(target).boundingBox())!;
    await page.mouse.move(p.x + 40, p.y + p.height / 2);
    await page.mouse.down();
    await page.mouse.move(p.x + 60, p.y + p.height / 2, { steps: 3 });
    await page.mouse.move(t.x + 20, t.y + 10, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    out(`A2 dropped into ${target}`, target === '#ta' ? await page.locator('#ta').inputValue() : (await page.locator('#ed').innerHTML()).replace(/ style="[^"]*"/g, ''));
  }
});
