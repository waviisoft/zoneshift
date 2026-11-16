import { describe, expect, it } from 'vitest';
import { convertText, findConversions } from '../src';

const LA = 'America/Los_Angeles';
const NOW = Date.UTC(2026, 10, 11, 20, 0, 0);
const to = (zone: string) => (text: string) => convertText(text, { targetZone: zone, now: NOW });

describe('R1 an offset with minutes followed by its abbreviation is not split into a range', () => {
  it.each([
    ['3:00 PM UTC+01:00 CET', Date.UTC(2026, 10, 11, 14)],
    ['Kickoff 14:00 UTC+5:30 IST', Date.UTC(2026, 10, 12, 8, 30)],
    ['10:00 UTC-08:00 PST', Date.UTC(2026, 10, 11, 18)],
    ['9:00 GMT-10:00 HST', Date.UTC(2026, 10, 11, 19)],
    ['18:00 GMT+10:00 AEST', Date.UTC(2026, 10, 12, 8)],
  ])('%s', (text, instant) => {
    const found = findConversions(text, { targetZone: LA, now: NOW });
    // Left alone, or read once at the written offset; never two ends.
    expect(found.length).toBeLessThanOrEqual(1);
    for (const c of found) expect(c.epochMs).toBe(instant);
  });
});

describe('R2 a dated list item that falls on another day shows it', () => {
  it.each([
    ['Office hours on Nov 13, 2026 at 9 AM UTC and 9 PM UTC', /and 6 AM GMT\+9 \(\+1 day\)$/],
    ['Office hours on Thursday at 9 AM UTC and 9 PM UTC', /and 6 AM GMT\+9 \(\+1 day\)$/],
  ])('%s', (text, marked) => {
    const out = to('Asia/Tokyo')(text);
    // Left alone, or the second item carries the day it falls on.
    expect(out === text || marked.test(out)).toBe(true);
  });
});

describe('R3 a range ending at noon or midnight is not half-converted', () => {
  it.each(['It runs 9 AM ET to noon', 'noon to 9 PM ET', 'Open 9 PM ET – midnight'])('%s', (text) => {
    expect(to('UTC')(text)).toBe(text);
  });
});
