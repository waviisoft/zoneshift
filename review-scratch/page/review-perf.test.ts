import { it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { findConversions } from '@zoneshift/core';
it('engine time', () => {
  const lines: string[] = [];
  for (let i = 0; i < 50000; i++) lines.push(`2026-11-13T01:${String(i % 60).padStart(2, '0')}:00Z INFO request ${i} served`);
  const text = lines.join('\n');
  let t = performance.now();
  const cs = findConversions(text, { targetZone: 'America/Los_Angeles' });
  const big = performance.now() - t;
  t = performance.now();
  for (let i = 0; i < 20000; i++) findConversions(`Item ${i} posted Nov 13, 2026 1:30 AM UTC by someone.`, { targetZone: 'America/Los_Angeles' });
  writeFileSync('/tmp/perf.txt', JSON.stringify({ n: cs.length, bigMs: Math.round(big), prose20kMs: Math.round(performance.now() - t) }));
});
