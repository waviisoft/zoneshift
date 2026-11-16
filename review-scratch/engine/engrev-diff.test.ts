import { readFileSync, writeFileSync } from 'node:fs';
import { it } from 'vitest';
import * as NEW from '../src';
import * as OLD from './old/src';

const NOW = Date.UTC(2026, 10, 11, 20, 0, 0);
it('engrev diff', () => {
  const cases: Array<[string, string, number?, string?]> = JSON.parse(readFileSync(process.env.ENGREV_FILE!, 'utf8'));
  const lines: string[] = [];
  for (const [text, zone, now, def] of cases) {
    const opts: any = { targetZone: zone, now: now ?? NOW, defaultZone: def ?? undefined };
    const o = OLD.convertText(text, opts);
    const n = NEW.convertText(text, opts);
    const tag = o === n ? 'SAME' : n === text ? 'NOW-ALONE' : o === text ? 'NOW-CONV' : 'CHANGED';
    lines.push(`${tag.padEnd(9)} ${JSON.stringify(text)} [${zone}${def ? ' def=' + def : ''}]\n    old: ${JSON.stringify(o)}\n    new: ${JSON.stringify(n)}`);
    if (process.env.DETAIL) for (const c of NEW.findConversions(text, opts)) lines.push('    ' + JSON.stringify({ o: c.original, conf: c.confidence, flags: c.flags, alts: c.alternatives.map(a => a.description + ' => ' + a.converted), ds: c.dayShift, ep: new Date(c.epochMs).toISOString() }));
  }
  writeFileSync(process.env.ENGREV_OUT!, lines.join('\n') + '\n');
});
