import { writeFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { findConversions } from '@zoneshift/core';
import { createAnnotator, MUTATION_DELAY } from '../lib/annotator';

const OPTIONS = { targetZone: 'America/Los_Angeles', now: Date.UTC(2026, 10, 11, 20, 0, 0) };
const pieces = [
  'Friday, November 13, 2026, at 1:30 AM UTC', 'Nov 13, 2026 1:30 AM UTC', '1:30 AM UTC', '2026-11-13T01:30:00Z',
  '1:30–3:00 PM UTC', '9:00 AM UTC–10:00 AM UTC', 'Nov 13, 2026 10:00 UTC+2', '1:30 a.m. UTC on Friday, November 13',
  '01:30 (UTC), 13 Nov 2026', 'Friday at 1:30 AM UTC', '3 PM EST', '9:00 AM CST', '10:00 GMT-5:30', 'from 1 to 3 PM UTC',
  'between 9:00 and 10:00 UTC', '7:00 PM', 'Nov 13, 2026', '2026-11-13 01:30 UTC', '12:00 UTC', '10:00–11:00 GMT',
  '1:30 AM UTC to 3:00 AM', '2026-11-13', 'UTC', '13:00', ' and ', ', ', ' — ', ' at ', ' on ', '\n', ' (', ') ',
  'Monday', 'at noon UTC', '1:30', ' PM ', 'UTC+2', 'Nov', '11:59 PM PT', '12 PM ET', '5pm BST', '17:00 IST',
];

function rnd(seed: number) { return () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff); }

describe('fuzz: annotator output vs engine on whole text', () => {
  afterEach(() => { document.body.innerHTML = ''; vi.useRealTimers(); });
  it('mark count equals the engine count; originals round-trip; no overlaps', async () => {
    vi.useFakeTimers();
    const r = rnd(42);
    const problems: string[] = [];
    for (let i = 0; i < 3000; i++) {
      const n = 1 + Math.floor(r() * 6);
      let text = '';
      for (let j = 0; j < n; j++) text += pieces[Math.floor(r() * pieces.length)];
      const cs = findConversions(text, OPTIONS);
      let last = 0;
      for (const c of cs) {
        if (c.index < last) problems.push(`overlap: ${JSON.stringify(text)}`);
        if (text.slice(c.index, c.index + c.length) !== c.original) problems.push(`original!=slice: ${JSON.stringify(text)}`);
        last = c.index + c.length;
      }
      document.body.innerHTML = '';
      const p = document.createElement('p');
      p.textContent = text;
      document.body.append(p);
      const a = createAnnotator(document, OPTIONS);
      const stop = a.start();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(MUTATION_DELAY + 50);
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(MUTATION_DELAY + 50);
      const marks = document.querySelectorAll('.zoneshift').length;
      if (marks !== cs.length) problems.push(`marks ${marks} vs engine ${cs.length}: ${JSON.stringify(text)} -> ${JSON.stringify(p.textContent)}`);
      a.setAll('original');
      if (p.textContent !== text) problems.push(`restore: ${JSON.stringify(text)} -> ${JSON.stringify(p.textContent)}`);
      stop();
    }
    writeFileSync('/tmp/fuzz.txt', problems.length + '\n' + [...new Set(problems)].slice(0, 40).join('\n'));
  }, 120000);
});
