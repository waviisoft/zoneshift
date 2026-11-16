import { expect, it } from 'vitest';
import { convertText } from '../src';
const NOW = Date.UTC(2026, 10, 11, 20, 0, 0);
const utc = (t: string) => convertText(t, { targetZone: 'UTC', now: NOW });
it.each(['Week of Nov 9: 9 PM ET', 'Week of Nov 9 · 9 PM ET', 'Week of Nov 9, 9 PM ET'])('%s keeps its week label', (t) => {
  expect(utc(t)).toBe(t);
});
it('drops or keeps a parenthesised label consistently', () => {
  expect(convertText('14:00 UTC+5:30 (IST, India)', { targetZone: 'America/Los_Angeles', now: NOW })).not.toMatch(/PST \(IST/);
});
