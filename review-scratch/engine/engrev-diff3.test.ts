import { readFileSync, writeFileSync } from 'node:fs';
import { it } from 'vitest';
import * as NEW from '../src';
import * as V2 from './v2/src';
import * as V1 from './old/src';

const NOW = Date.UTC(2026, 10, 11, 20, 0, 0);
it('engrev diff3', () => {
  const cases: Array<[string, string, number?, string?]> = JSON.parse(readFileSync(process.env.ENGREV_FILE!, 'utf8'));
  const only = process.env.ONLY_CHANGED === '1';
  const lines: string[] = [];
  for (const [text, zone, now, def] of cases) {
    const opts: any = { targetZone: zone, now: now ?? NOW, defaultZone: def ?? undefined };
    const a = V1.convertText(text, opts), b = V2.convertText(text, opts), n = NEW.convertText(text, opts);
    const ep = (m: any) => JSON.stringify(m.findConversions(text, opts).map((c: any) => [c.index, c.epochMs]));
    const sameAsV2 = b === n && ep(V2) === ep(NEW);
    if (only && sameAsV2) continue;
    const tag = sameAsV2 ? 'SAME' : n === text ? 'NOW-ALONE' : b === text ? 'NOW-CONV' : 'CHANGED';
    lines.push(`${tag.padEnd(9)} ${JSON.stringify(text)} [${zone}${def ? ' def=' + def : ''}]\n    v1 : ${JSON.stringify(a)}\n    v2 : ${JSON.stringify(b)}\n    new: ${JSON.stringify(n)}`);
    if (process.env.DETAIL) for (const c of NEW.findConversions(text, opts)) lines.push('    ' + JSON.stringify({ o: c.original, conf: c.confidence, flags: c.flags, alts: c.alternatives.map(x => x.description + ' => ' + x.converted), ds: c.dayShift, ep: new Date(c.epochMs).toISOString() }));
  }
  writeFileSync(process.env.ENGREV_OUT!, lines.join('\n') + '\n');
});
