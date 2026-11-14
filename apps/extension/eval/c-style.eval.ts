import { html, open, out, pages, test, VARIANT } from './harness';

// B7. Does the converted text look exactly like the site's text? Each case is
// screenshotted; compare.py diffs every variant against the shipping annotator.
const CASES: Record<string, string> = {
  link: `<p><a href="#x" class="wavy">Due Nov 20, 2026 9:00 AM UTC sharp</a></p>`,
  heading: `<h1>Launch 1:30 AM UTC today</h1>`,
  bolditalic: `<p><b><i>Starts 1:30 AM UTC</i></b> then</p>`,
  pre: `<pre>job    Nov 13, 2026 1:30 AM UTC    done</pre>`,
  flex: `<div class="flex">Opens 1:30 AM UTC daily<span>right</span></div>`,
  rtl: `<p dir="rtl">الاجتماع في 1:30 AM UTC غدا</p>`,
  clamp: `<div class="clamp">Line one text text text text text text text text text text text text text text text Nov 13, 2026 1:30 AM UTC text text text text text text text text text text text text text text</div>`,
  ellipsis: `<div class="ell">A long line which ends with a time Nov 13, 2026 1:30 AM UTC and more words beyond</div>`,
  justify: `<p class="just">Words words words words Nov 13, 2026 1:30 AM UTC words words words words words words words words words words words words words words words</p>`,
  hostile: `<p class="hostile">Posted 1:30 AM UTC by <span>Bob</span></p>`,
  descendant: `<p class="desc">Posted 1:30 AM UTC by <span>Bob</span></p>`,
  firstline: `<p class="fline">At 1:30 AM UTC we start the long maintenance window and everyone must log off before then please.</p>`,
  firstletter: `<p class="fletter">1:30 AM UTC is when we start.</p>`,
  transform: `<p class="upper">starts nov 13, 2026 1:30 am utc ok</p>`,
  spacing: `<p class="spaced">Starts 1:30 AM UTC ok</p>`,
  selection: `<p class="selcolor" id="selp">Selected 1:30 AM UTC text</p>`,
};
pages['/style'] = {
  body: html(
    Object.entries(CASES).map(([k, v]) => `<div class="case" id="case-${k}">${v}</div>`).join('\n'),
    `body{font:16px/1.4 serif} .case{margin:6px 0;width:520px;height:96px;overflow:hidden}
     .wavy{text-decoration:underline wavy rgb(255,0,0);color:rgb(0,90,0)}
     .flex{display:flex;justify-content:space-between;width:500px}
     .clamp{width:240px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
     .ell{width:300px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
     .just{text-align:justify;width:300px}
     .hostile *{padding:0 6px;margin:0 9px;border:2px solid red;background:yellow;font-weight:900;display:inline-block}
     .hostile *::before,.hostile *::after{content:"·"}
     .desc span{color:rgb(200,0,0)} .desc *{text-decoration:underline}
     .fline::first-line{color:rgb(0,128,0);font-weight:bold}
     .fletter::first-letter{font-size:32px;color:rgb(255,0,0)}
     .upper{text-transform:uppercase;font-variant-numeric:tabular-nums}
     .spaced{letter-spacing:3px;word-spacing:8px}
     .selcolor::selection{background:rgb(255,0,255);color:rgb(255,255,0)}`,
  ),
};

test('B7 styling screenshots', async ({ page, base }) => {
  await open(page, base + '/style');
  for (const k of Object.keys(CASES)) {
    if (k === 'selection') {
      await page.evaluate(() => {
        const r = document.createRange();
        r.selectNodeContents(document.getElementById('selp')!);
        getSelection()!.removeAllRanges();
        getSelection()!.addRange(r);
      });
    }
    await page.locator(`#case-${k}`).screenshot({ path: `/tmp/zs-eval/style-${VARIANT}-${k}.png` });
  }
  out('B7 heights', await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.case')].map((c) => [c.id, Math.round(c.getBoundingClientRect().height)]))));
});
