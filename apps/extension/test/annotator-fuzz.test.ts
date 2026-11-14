import { afterEach, describe, expect, it } from 'vitest';
import { findConversions } from '@zoneshift/core';
import { createAnnotator } from '../lib/annotator';

/**
 * Seeded fuzz test: random strings built from time-like pieces, annotated
 * whole and split across text nodes. Deterministic, and fast enough for
 * every run.
 */

const OPTIONS = { targetZone: 'America/Los_Angeles', now: Date.UTC(2026, 10, 11, 20, 0, 0) };
const PIECES = [
  'Friday, November 13, 2026, at 1:30 AM UTC', 'Nov 13, 2026 1:30 AM UTC', '1:30 AM UTC', '2026-11-13T01:30:00Z',
  '1:30–3:00 PM UTC', '9:00 AM UTC–10:00 AM UTC', 'Nov 13, 2026 10:00 UTC+2', '1:30 a.m. UTC on Friday, November 13',
  '01:30 (UTC), 13 Nov 2026', 'Friday at 1:30 AM UTC', '3 PM EST', '9:00 AM CST', '10:00 GMT-5:30', 'from 1 to 3 PM UTC',
  'between 9:00 and 10:00 UTC', '7:00 PM', 'Nov 13, 2026', '2026-11-13 01:30 UTC', '12:00 UTC', '10:00–11:00 GMT',
  '1:30 AM UTC to 3:00 AM', '2026-11-13', 'UTC', '13:00', ' and ', ', ', ' — ', ' at ', ' on ', '\n', ' (', ') ',
  'Monday', 'at noon UTC', '1:30', ' PM ', 'UTC+2', '+2', '-5', 'Nov', '11:59 PM PT', '12 PM ET', '5pm BST', '17:00 IST',
];
const RUNS = 1500;

/** Linear congruential generator, so every run sees the same cases. */
function random(seed: number) {
  return () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('fuzz', () => {
  it('marks what the engine finds and restores the exact original text', () => {
    const r = random(42);
    const problems: string[] = [];
    for (let i = 0; i < RUNS; i++) {
      let text = '';
      for (let n = 1 + Math.floor(r() * 6); n > 0; n--) text += PIECES[Math.floor(r() * PIECES.length)];
      document.body.innerHTML = '<p></p>';
      const p = document.querySelector('p')!;
      const node = document.createTextNode(text);
      p.append(node);
      const a = createAnnotator(document, OPTIONS);
      a.annotate(document.body);
      const expected = findConversions(text, OPTIONS).length;
      const marks = p.querySelectorAll('.zoneshift').length;
      if (marks !== expected) problems.push(`${marks} marks, engine ${expected}: ${JSON.stringify(text)}`);
      a.setAll('original');
      if (p.textContent !== text) problems.push(`shown original ${JSON.stringify(p.textContent)}: ${JSON.stringify(text)}`);
      a.restore(document.body);
      if (p.firstChild !== node || p.childNodes.length !== 1) problems.push(`restore: ${JSON.stringify(text)}`);
    }
    expect(problems).toEqual([]);
  });

  it('never shows a reading the unsplit text does not support when text is split across nodes', () => {
    const r = random(7);
    const problems: string[] = [];
    for (let i = 0; i < RUNS; i++) {
      let text = '';
      for (let n = 2 + Math.floor(r() * 3); n > 0; n--) text += PIECES[Math.floor(r() * PIECES.length)];
      const cut = 1 + Math.floor(r() * (text.length - 1));
      document.body.innerHTML = '<p></p>';
      const p = document.querySelector('p')!;
      const first = document.createTextNode(text.slice(0, cut));
      const second = document.createTextNode(text.slice(cut));
      // Half the time the second part sits in an inline element.
      if (r() < 0.5) p.append(first, second);
      else {
        const b = document.createElement('b');
        b.append(second);
        p.append(first, b);
      }
      const a = createAnnotator(document, OPTIONS);
      a.annotate(document.body);
      a.setAll('original');
      const whole = findConversions(text, OPTIONS);
      // Each mark must end where a reading of the whole text ends, and start
      // where it starts (same instant) or inside it (a date before it was not
      // part of this node: "Nov 13 at" + "1:30 AM UTC").
      for (const run of p.querySelectorAll('zoneshift-run')) {
        const offset = run === p.firstChild ? 0 : cut;
        let pos = 0;
        for (const child of run.childNodes) {
          if (child.nodeType === 3) {
            pos += (child as Text).data.length;
            continue;
          }
          const original = (child as HTMLElement).querySelector('zoneshift-text')!.textContent!;
          const start = offset + pos;
          const end = start + original.length;
          const ok = whole.some((w) => w.index + w.length === end && w.index <= start);
          if (!ok) problems.push(`${JSON.stringify(original)} at ${start}: ${JSON.stringify([text.slice(0, cut), text.slice(cut)])}`);
          pos += original.length;
        }
      }
      a.restore(document.body);
      if (p.textContent !== text || p.firstChild !== first) problems.push(`restore: ${JSON.stringify(text)}`);
    }
    expect(problems).toEqual([]);
  });
});
