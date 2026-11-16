import { it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { findConversions } from '@zoneshift/core';
import { createAnnotator } from '../lib/annotator';
const OPTIONS = { targetZone: 'America/Los_Angeles', now: Date.UTC(2026, 10, 11, 20, 0, 0) };
const P = ['Friday, November 13, 2026, at 1:30 AM UTC', 'Nov 13, 2026 1:30 AM UTC', '1:30 AM UTC', '2026-11-13T01:30:00Z', '1:30–3:00 PM UTC',
 '9:00 AM UTC–10:00 AM UTC', 'Nov 13, 2026 10:00 UTC+2', '1:30 a.m. UTC on Friday, November 13', 'Friday at 1:30 AM UTC', '3 PM EST', '9:00 AM CST',
 'from 1 to 3 PM UTC', '7:00 PM', 'Nov 13, 2026', 'Jul 1, 2026', '12:00 UTC', '1:30 AM UTC to 3:00 AM', 'UTC', '13:00', ' and ', ', ', ' — ', ' at ', ' on ',
 'Monday', '1:30', ' PM ', 'UTC+2', '+2', '-5', 'Nov', '11:59 PM PT', '5pm BST', ' or ', ' to ', '–', 'tomorrow', ' every day ', 'Saturday, Nov 14, 2026', 'GMT', ' (', ') ', 'some long filler words here to push context ', '2026', '13'];
const rnd = (s: number) => () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
it('split fuzz', () => {
  const r = rnd(7); const bad: string[] = [];
  for (let i = 0; i < 4000; i++) {
    const parts: string[] = [];
    for (let n = 2 + Math.floor(r() * 5); n > 0; n--) parts.push(P[Math.floor(r() * P.length)]!);
    const whole = parts.join('');
    const W = findConversions(whole, OPTIONS);
    document.body.innerHTML = '<p></p>';
    const p = document.querySelector('p')!;
    // each part a text node, some wrapped in <b>
    const offs: number[] = []; let o = 0;
    for (const part of parts) { offs.push(o); o += part.length; if (r() < 0.3) { const b = document.createElement('b'); b.textContent = part; p.append(b); } else p.append(part); }
    const a = createAnnotator(document, OPTIONS); const stop = a.start(); a.setAll('converted');
    // walk marks; compute global position by walking text in order using original text
    let pos = 0; const found: { start: number; end: number; epoch: number; conv: string }[] = [];
    const walk = (n: Node) => {
      if (n.nodeType === 3) { pos += (n as Text).data.length; return; }
      const el = n as Element;
      if (el.localName === 'zoneshift-mark') { const orig = (el.lastElementChild as HTMLElement).getAttribute('aria-label')!.replace(/^Converted to local time\. Original: /, ''); found.push({ start: pos, end: pos + orig.length, epoch: 0, conv: el.firstElementChild!.textContent! }); pos += orig.length; return; }
      if (el.localName === 'zoneshift-icon') return;
      for (const c of [...n.childNodes]) walk(c);
    };
    walk(p);
    if (pos !== whole.length) { bad.push('LEN ' + JSON.stringify(parts)); }
    for (const f of found) {
      const ok = W.some((w) => w.index + w.length === f.end && w.index <= f.start && (w.index === f.start ? w.converted === f.conv : w.converted.endsWith(f.conv.replace(/\s*\([+−-]\d+ days?\)$/u, ''))));
      if (!ok) bad.push(JSON.stringify(parts) + ' -> ' + f.conv + ' | whole: ' + JSON.stringify(W.map((w) => [w.original, w.converted])));
    }
    stop();
  }
  writeFileSync('/tmp/split.txt', bad.length + '\n' + bad.slice(0, 30).join('\n'));
}, 300000);
