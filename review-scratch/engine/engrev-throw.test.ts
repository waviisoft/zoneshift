import { writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { findConversions } from '../src';
it('engrev throw', () => {
  const out: string[] = [];
  for (const tz of ['Not/AZone', 'utc', 'EST5EDT', '']) {
    try { out.push(tz + ' => ' + JSON.stringify(findConversions('1:30 PM UTC', { targetZone: tz, now: Date.UTC(2026,10,11) }).map(c=>c.converted))); }
    catch (e) { out.push(tz + ' => THROWS ' + (e as Error).name + ': ' + (e as Error).message); }
  }
  try { out.push('no-zone text, bad target => ' + JSON.stringify(findConversions('hello world', { targetZone: 'Not/AZone' }))); } catch (e) { out.push('no-zone text, bad target => THROWS'); }
  writeFileSync(process.env.ENGREV_OUT!, out.join('\n') + '\n');
});
