import { describe, expect, it } from 'vitest';
import { convertText, findConversions } from '../src';

// Ranges and lists are converted only when every end carries its own zone, and
// then whole or not at all. Ranges and lists that are left alone are in
// left-alone.test.ts.

const LA = 'America/Los_Angeles';
// Wednesday 2026-11-11 20:00 UTC.
const NOW = Date.UTC(2026, 10, 11, 20, 0, 0);

const to = (zone: string) => (text: string) => convertText(text, { targetZone: zone, now: NOW });
const la = to(LA);

describe('hyphenated ranges of zoned times', () => {
  it('reads "UTC-10 AM" as the start of the second end, not as UTC−10', () => {
    expect(la('9 AM UTC-10 AM UTC')).toBe('1 AM PST-2 AM PST');
    expect(la('2 PM UTC-3 PM UTC')).toBe('6 AM PST-7 AM PST');
    // Each end mirrors its own padding: "9:00" stays one digit, "10:00" two.
    expect(la('9:00 GMT-10:00 GMT')).toBe('1:00 PST-02:00 PST');
    expect(la('9 AM UTC-10:30 AM UTC')).toBe('1 AM PST-2:30 AM PST');
  });
});

describe('a dated range', () => {
  it('gives the second end the shared date', () => {
    expect(la('Jul 13, 2026 1:30 PM UTC–3:00 PM UTC')).toBe('Jul 13, 2026 6:30 AM PDT–8:00 AM PDT');
  });

  it('ends at the first such time after the start when it crosses midnight', () => {
    // 23:30 UTC on 13 July to 01:30 UTC on 14 July: 16:30 to 18:30 PDT, both on 13 July.
    expect(la('Jul 13, 2026 11:30 PM UTC – 1:30 AM UTC')).toBe('Jul 13, 2026 4:30 PM PDT – 6:30 PM PDT');
    const [, end] = findConversions('Jul 13, 2026 11:30 PM UTC – 1:30 AM UTC', { targetZone: LA, now: NOW });
    expect(end!.epochMs).toBe(Date.UTC(2026, 6, 14, 1, 30));
    expect(end!.flags).toEqual([]);
  });

  it('reads the date written on each end when both have one', () => {
    expect(la('Nov 13, 2026 1 PM UTC – Nov 14, 2026 1 PM UTC')).toBe('Nov 13, 2026 5 AM PST – Nov 14, 2026 5 AM PST');
  });

  it('is left alone when it cannot be read whole', () => {
    // The date belongs to both ends, but only the second end is next to it.
    expect(la('1:30 PM UTC – 3:00 PM UTC on Friday, Nov 13')).toBe('1:30 PM UTC – 3:00 PM UTC on Friday, Nov 13');
    // Equal ends: no length, or a whole day?
    expect(la('1:30 PM UTC – 1:30 PM UTC')).toBe('1:30 PM UTC – 1:30 PM UTC');
    // One end has an offset out of range.
    expect(la('1:30 PM UTC – 3:00 PM UTC+15')).toBe('1:30 PM UTC – 3:00 PM UTC+15');
    // A range that runs backwards.
    expect(la('Nov 14, 2026 1 PM UTC – Nov 13, 2026 1 PM UTC')).toBe('Nov 14, 2026 1 PM UTC – Nov 13, 2026 1 PM UTC');
  });
});

describe('a time-only range', () => {
  it('ends at the first such time after the start', () => {
    expect(la('11:30 PM UTC – 1:30 AM UTC')).toBe('3:30 PM PST – 5:30 PM PST');
  });

  it('measures both day markers from the day the range starts', () => {
    expect(la('1:30 AM UTC – 3:00 AM UTC')).toBe('5:30 PM PST (−1 day) – 7:00 PM PST (−1 day)');
    const ends = findConversions('1:30 AM UTC – 3:00 AM UTC', { targetZone: LA, now: NOW });
    expect(ends.map((c) => [c.dayShift, c.flags])).toEqual([
      [-1, ['time-only']],
      [-1, ['time-only']],
    ]);
  });
});

describe('lists of zoned times', () => {
  it('converts every item', () => {
    expect(la('1:30 PM UTC or 3:00 PM UTC')).toBe('5:30 AM PST or 7:00 AM PST');
    expect(la('between 1 PM UTC and 3 PM UTC')).toBe('between 5 AM PST and 7 AM PST');
  });

  it('keeps an item that is already in the reader’s zone', () => {
    expect(la('8 PM ET / 5 PM PT')).toBe('5 PM PST / 5 PM PT');
  });
});
