import { execSync } from 'node:child_process';
import { html, out, pages, test, VARIANT } from './harness';

// C8. Performance on the reviewer's pages: annotate time, longest tasks,
// "Convert all" time, renderer memory, DOM node count.
const LT = `window.__lt=[];new PerformanceObserver(l=>{for(const e of l.getEntries())window.__lt.push([Math.round(e.startTime),Math.round(e.duration)])}).observe({type:'longtask',buffered:true});`;
{
  const lines: string[] = [];
  for (let i = 0; i < 50000; i++) lines.push(`2026-11-13T01:${String(i % 60).padStart(2, '0')}:00Z INFO request ${i} served`);
  pages['/biglog'] = { body: html(`<pre id="log">${lines.join('\n')}</pre><p id="end">End 2:30 AM UTC</p>`, '', LT) };
  const paras: string[] = [];
  for (let i = 0; i < 20000; i++) paras.push(`<p>Item ${i} posted Nov 13, 2026 1:30 AM UTC by someone.</p>`);
  pages['/bigprose'] = { body: html(paras.join('') + '<p id="end">End 2:30 AM UTC</p>', '', LT) };
}
pages['/stream'] = {
  body: html(`<pre id="log"></pre>`, '', LT + `let i=0;const log=document.getElementById('log');window.__start=performance.now();const t=setInterval(()=>{for(let k=0;k<20;k++){const s=String(i%60).padStart(2,'0');log.append('2026-11-13T01:'+s+':00Z INFO line '+(i++)+'\\n');}if(i>=10000){clearInterval(t);window.__end=performance.now();}},10);`),
};

/** Count of recognised times on the page and how many show the original (all layouts). */
const COUNT = () => {
  let n = 0;
  let original = 0;
  const cur = document.getElementsByClassName('zoneshift');
  if (cur.length) {
    for (const m of cur) {
      n++;
      if ((m as HTMLElement).dataset.zsState === 'original') original++;
    }
    return { n, original };
  }
  const visit = (root: ShadowRoot) => {
    for (const m of root.querySelectorAll<HTMLElement>('.m')) {
      n++;
      if (m.dataset.state === 'original') original++;
    }
  };
  for (const el of document.querySelectorAll('zoneshift-mark, zoneshift-run, p, pre')) if (el.shadowRoot) visit(el.shadowRoot);
  return { n, original };
};

function rendererRss(): number {
  const lines = execSync('ps -eo pid,rss,args').toString().split('\n').filter((l) => l.includes('--type=renderer') && !l.includes('--extension-process'));
  return Math.max(0, ...lines.map((l) => Number(l.trim().split(/\s+/)[1]) || 0)) / 1024;
}

for (const [path, n] of [['/bigprose', 20001], ['/biglog', 50001]] as const) {
  test(`C8 perf ${path}`, async ({ page, base }) => {
    test.setTimeout(400000);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    const t0 = Date.now();
    await page.goto(base + path, { timeout: 120000 });
    const tLoad = Date.now() - t0;
    if (!process.env.NOEXT) await page.waitForFunction(COUNT_FN(n), null, { timeout: 300000, polling: 1000 });
    const tAll = Date.now() - t0;
    await page.waitForTimeout(1500);
    const lts: [number, number][] = await page.evaluate(() => (window as any).__lt.slice());
    const metrics = Object.fromEntries(((await cdp.send('Performance.getMetrics')) as any).metrics.map((m: any) => [m.name, m.value]));
    await cdp.send('HeapProfiler.collectGarbage');
    await page.waitForTimeout(500);
    const rss = rendererRss();
    const result: Record<string, unknown> = {
      tLoad, tAnnotated: tAll, longest: lts.map((l) => l[1]).sort((a, b) => b - a).slice(0, 4),
      nodes: metrics.Nodes, jsHeapMB: Math.round(metrics.JSHeapUsedSize / 1e6), rendererRssMB: Math.round(rss),
      layoutMs: Math.round(metrics.LayoutDuration * 1000), styleMs: Math.round(metrics.RecalcStyleDuration * 1000),
    };
    if (!process.env.NOEXT) {
      // "Convert all": time from the click on the popover button until the next frame.
      await page.locator('#end .i, #end zoneshift-icon').first().click();
      const before = lts.length;
      const t1 = Date.now();
      await page.getByRole('button', { name: 'Convert all times on this page' }).click();
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0))));
      result.tConvertAll = Date.now() - t1;
      await page.waitForTimeout(1500);
      const lts2: [number, number][] = await page.evaluate(() => (window as any).__lt.slice());
      result.longestAfterConvertAll = lts2.slice(before).map((l) => l[1]).sort((a, b) => b - a).slice(0, 3);
      result.state = await page.evaluate(COUNT);
    }
    out(`C8 ${path}`, result);
  });
}

function COUNT_FN(n: number) {
  return new Function(`return (${COUNT.toString()})().n >= ${n};`) as () => boolean;
}

test('C8 perf streaming log', async ({ page, base }) => {
  test.setTimeout(120000);
  await page.goto(base + '/stream');
  await page.waitForFunction(() => (window as any).__end, null, { timeout: 100000 });
  await page.waitForTimeout(1500);
  const r = await page.evaluate(() => ({ lt: (window as any).__lt.length, ltMax: Math.max(0, ...(window as any).__lt.map((l: number[]) => l[1])), elapsed: Math.round((window as any).__end - (window as any).__start) }));
  out('C8 /stream', { ...r, state: await page.evaluate(COUNT) });
});
