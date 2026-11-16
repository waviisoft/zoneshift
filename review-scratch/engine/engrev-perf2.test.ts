import { writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { findConversions } from '../src';
const NOW = Date.UTC(2026, 10, 11, 20, 0, 0);
it('engrev perf2', () => {
  const out: string[] = [];
  const time = (label: string, text: string, opts: any = {}) => {
    const t = performance.now();
    const r = findConversions(text, { targetZone: 'America/Los_Angeles', now: NOW, ...opts });
    out.push(`${label}: ${(performance.now() - t).toFixed(0)} ms, ${r.length} matches`);
  };
  const line = '2026-11-13T01:30:00.123Z INFO  [worker-3] request id=abc123 completed in 12:34 ms at 10:00 UTC\n';
  time('1MB log', line.repeat(Math.ceil(1_000_000 / line.length)));
  time('1MB "1:30 PM UTC "', '1:30 PM UTC '.repeat(80_000));
  time('1MB "1:30 PM UTC – "', '1:30 PM UTC – '.repeat(70_000));
  time('1MB "1:30 PM UTC or "', '1:30 PM UTC or '.repeat(65_000));
  time('1MB prose default', 'The show starts at 7:00 PM on Friday, November 13. '.repeat(20000), { defaultZone: 'America/New_York' });
  time('1MB "Mon " + time', 'Mon '.repeat(250_000) + '1:30 PM UTC');
  time('1MB "Nov 1 " + time', 'Nov 1 '.repeat(170_000) + '1:30 PM UTC');
  time('1MB "A " + time default', 'A '.repeat(500_000) + '7 PM', { defaultZone: 'America/New_York' });
  time('1MB "(A " + time default', '(A '.repeat(330_000) + '7 PM', { defaultZone: 'America/New_York' });
  time('1MB "Ab Cd " time default', 'Ab Cd '.repeat(170_000) + '7 PM Time', { defaultZone: 'America/New_York' });
  time('100k "1 " + 7 PM default', ('1 '.repeat(30) + '7 PM ').repeat(3000), { defaultZone: 'America/New_York' });
  time('1MB "7 PM (Ab " default', '7 PM (Ab '.repeat(110_000), { defaultZone: 'America/New_York' });
  writeFileSync(process.env.ENGREV_OUT!, out.join('\n') + '\n');
}, 600_000);
