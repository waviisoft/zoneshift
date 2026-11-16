import { readFileSync, writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { convertText, findConversions } from '../src';

const NOW = Date.UTC(2026, 10, 11, 20, 0, 0);
it('engrev probe', () => {
  const lines: string[] = [];
  const log = (x: string) => lines.push(x);
  const cases: Array<[string, string, number?, string?, string?]> = JSON.parse(readFileSync(process.env.ENGREV_FILE!, 'utf8'));
  for (const [text, zone, now, def, sm] of cases) {
    const opts: any = { targetZone: zone, now: now ?? NOW, defaultZone: def ?? undefined, seasonMismatch: sm ?? undefined };
    const out = convertText(text, opts);
    const cs = findConversions(text, opts);
    log('@@ ' + JSON.stringify(text) + ' -> ' + JSON.stringify(out) + (out === text ? ' [UNCHANGED]' : ''));
    for (const c of cs) log('@@    ' + JSON.stringify({ i: c.index, l: c.length, o: c.original, conf: c.confidence, flags: c.flags, src: c.sourceDescription, alts: c.alternatives.map(a => a.description + ' => ' + a.converted), ds: c.dayShift, fmt: c.format }));
  }
  writeFileSync(process.env.ENGREV_OUT!, lines.join('\n') + '\n');
});
