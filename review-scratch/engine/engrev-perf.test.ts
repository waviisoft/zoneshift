import { writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { findConversions } from '../src';

const NOW = Date.UTC(2026, 10, 11, 20, 0, 0);
it('engrev perf', () => {
  const out: string[] = [];
  const time = (label: string, text: string, opts: any = {}) => {
    const t = performance.now();
    const r = findConversions(text, { targetZone: 'America/Los_Angeles', now: NOW, ...opts });
    out.push(`${label}: ${(performance.now() - t).toFixed(0)} ms, ${text.length} chars, ${r.length} matches`);
  };
  const line = '2026-11-13T01:30:00.123Z INFO  [worker-3] request id=abc123 completed in 12:34 ms at 10:00 UTC\n';
  time('1MB log', line.repeat(Math.ceil(1_000_000 / line.length)));
  time('1MB prose zoneless + default', 'The show starts at 7:00 PM on Friday, November 13. '.repeat(20000), { defaultZone: 'America/New_York' });
  time('1MB digits', '1'.repeat(1_000_000));
  time('1MB 1:1:1', '1:'.repeat(500_000));
  time('1MB 12:00 no zone', '12:00 '.repeat(170_000));
  time('1MB 12:00 PM no zone', '12:00 PM '.repeat(110_000));
  time('1MB weekdays', 'Monday '.repeat(140_000) + '1:30 PM UTC');
  time('1MB spaces then time', ' '.repeat(1_000_000) + '1:30 PM UTC');
  time('1MB "Mon 1 " ', 'Mon 1 '.repeat(170_000) + '1:30 PM UTC');
  time('1MB "1:30 PM UTC "', '1:30 PM UTC '.repeat(80_000));
  time('1MB "1-" ', '1-'.repeat(500_000) + '3 PM UTC');
  time('1MB "UTC+1"', 'UTC+1 '.repeat(160_000));
  time('1MB "1 UTC"', '1 UTC '.repeat(160_000));
  time('1MB "Nov 1, 2026, " ', 'Nov 1, 2026, '.repeat(77_000) + '1:30 PM UTC');
  writeFileSync(process.env.ENGREV_OUT!, out.join('\n') + '\n');
}, 600_000);
