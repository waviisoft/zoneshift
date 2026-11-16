import { writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { fieldsAt, toEpoch, ianaOffsetAt } from '../src/tz';

it('engrev tz roundtrip', () => {
  const zones = ['America/New_York','America/Los_Angeles','Europe/London','Europe/Dublin','Asia/Kolkata','Asia/Kathmandu','Pacific/Chatham','Australia/Lord_Howe','America/St_Johns','Pacific/Apia','Pacific/Kiritimati','America/Santiago','Asia/Tehran','Africa/Casablanca','Europe/Moscow','America/Sao_Paulo','Antarctica/Troll','Pacific/Auckland','America/Havana','Asia/Gaza'];
  const out: string[] = [];
  let seed = 42; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  for (const z of zones) {
    let bad = 0, amb = 0, n = 0; const ex: string[] = [];
    for (let i = 0; i < 20000; i++) {
      const t = Math.floor(Date.UTC(1990, 0, 1) + rnd() * (Date.UTC(2035, 0, 1) - Date.UTC(1990, 0, 1)));
      const tt = Math.floor(t / 60000) * 60000;
      const f = fieldsAt({ kind: 'iana', id: z }, tt);
      const back = toEpoch({ kind: 'iana', id: z }, f);
      n++;
      if (back !== tt) {
        // repeated local time? check that back maps to same wall clock
        const f2 = fieldsAt({ kind: 'iana', id: z }, back);
        if (JSON.stringify(f2) === JSON.stringify(f)) amb++;
        else { bad++; if (ex.length < 3) ex.push(`${new Date(tt).toISOString()} -> ${JSON.stringify(f)} -> ${new Date(back).toISOString()}`); }
      }
    }
    // Check transitions: every hour boundary around transitions in 2026 for nonexistent times
    out.push(`${z}: n=${n} repeated-picked-other=${amb} WRONG=${bad} ${ex.join(' | ')}`);
  }
  // Gap behaviour: wall times in the spring-forward gap
  const gaps: Array<[string, number[]]> = [['America/New_York',[2026,3,8,2,30]],['Europe/London',[2026,3,29,1,30]],['Australia/Lord_Howe',[2026,10,4,2,15]],['Pacific/Apia',[2011,12,30,12,0]]];
  for (const [z, [y,mo,d,h,mi]] of gaps) {
    const e = toEpoch({ kind: 'iana', id: z }, { year: y!, month: mo!, day: d!, hour: h!, minute: mi!, second: 0 });
    const f = fieldsAt({ kind: 'iana', id: z }, e);
    out.push(`gap ${z} ${y}-${mo}-${d} ${h}:${mi} -> ${new Date(e).toISOString()} -> wall ${f.hour}:${f.minute} day ${f.day} (offset ${ianaOffsetAt(z, e)})`);
  }
  writeFileSync(process.env.ENGREV_OUT!, out.join('\n') + '\n');
}, 600000);
