import { afterEach, expect, it, vi } from 'vitest';
import { createAnnotator, MUTATION_DELAY } from '../lib/annotator';
const OPTIONS = { targetZone: 'America/Los_Angeles', now: Date.UTC(2026, 10, 11, 20, 0, 0) };
let stop: (() => void) | undefined;
afterEach(() => { stop?.(); stop = undefined; document.body.innerHTML = ''; vi.useRealTimers(); });

it('a site that puts its annotated snapshot back whenever its content changes does not ping-pong', async () => {
  vi.useFakeTimers();
  document.body.innerHTML = '<div id="f"><p>Fight 3:30 AM UTC.</p></div>';
  stop = createAnnotator(document, OPTIONS).start();
  const f = document.getElementById('f')!;
  const snap = f.innerHTML; // taken while annotated
  let restores = 0;
  const site = new MutationObserver(() => {
    if (restores >= 1000) return site.disconnect(); // safety valve for the test only
    if (f.innerHTML !== snap) { restores++; f.innerHTML = snap; }
  });
  site.observe(f, { childList: true, subtree: true, attributes: true });
  f.innerHTML = snap;
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await vi.advanceTimersByTimeAsync(MUTATION_DELAY * 5);
  expect(restores).toBeLessThan(10);
});
