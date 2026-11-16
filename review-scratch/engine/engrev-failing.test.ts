import { describe, expect, it } from 'vitest';
import { convertText, findConversions } from '../src';

const LA = 'America/Los_Angeles';
const NOW = Date.UTC(2026, 10, 11, 20, 0, 0);
const to = (zone: string, now = NOW) => (text: string) => convertText(text, { targetZone: zone, now });
const la = to(LA);

describe('B1 hyphenated zoned range is not an offset', () => {
  it('reads "UTC-10 AM" as a range, not UTC−10', () => {
    expect(la('9 AM UTC-10 AM UTC')).toBe('1 AM PST-2 AM PST');
    expect(la('2 PM UTC-3 PM UTC')).toBe('6 AM PST-7 AM PST');
    expect(la('9:00 GMT-10:00 GMT')).toBe('1:00 PST-02:00 PST');
  });
});

describe('B2 ranges and lists joined by words or slashes are skipped', () => {
  it.each([
    'Call between 1:30 PM and 3:00 PM UTC',
    'Either 1:30 or 3:00 PM UTC',
    'Slots 1:30/3:00 PM UTC',
    'Open 9 till 5 PM ET',
  ])('%s', (text) => {
    expect(la(text)).toBe(text);
  });
});

describe('B3 zone-less ranges under a site default zone are not half-converted', () => {
  it.each(['Open 7 PM–9 PM', 'Open 7 PM to 9 PM'])('%s', (text) => {
    expect(convertText(text, { targetZone: LA, now: NOW, defaultZone: 'America/New_York' })).toBe(text);
  });
});

describe('B4 a site default never overrides a zone written in words', () => {
  it.each(['7 PM Pacific', '8 PM Eastern', '7 PM London time'])('%s', (text) => {
    expect(convertText(text, { targetZone: 'America/New_York', now: NOW, defaultZone: 'Europe/Berlin' })).toBe(text);
  });
});

describe('B5 a time next to a date the engine cannot read is left alone', () => {
  it.each([
    '07/04/2026 6:00 PM UTC',
    '4.7.2026 18:00 UTC',
    'july 4, 2026 at 6:00 PM UTC',
    'JULY 4, 2026 at 6:00 PM UTC',
    '2026-07-04, 18:00 UTC',
    '2026-W27-6T18:00Z',
  ])('%s', (text) => {
    expect(la(text)).toBe(text);
  });
});

describe('B6 the second end of a zoned range keeps the shared date', () => {
  it('uses the date for both ends', () => {
    expect(la('Jul 13, 2026 1:30 PM UTC–3:00 PM UTC')).toBe('Jul 13, 2026 6:30 AM PDT–8:00 AM PDT');
  });
});

describe('B7 multi-zone broadcast labels are left alone', () => {
  it.each(['Airs 8 PM ET/PT on NBC', '8 p.m. ET/PT'])('%s', (text) => {
    expect(la(text)).toBe(text);
    expect(to('Europe/London')(text)).toBe(text);
  });
});

describe('B8 weekday ranges and lists are not half-shifted', () => {
  it.each(['Mon–Fri 1 AM UTC', 'Support 1 AM UTC, Mon–Fri', 'Sat & Sun 1 AM UTC', 'Mon, Wed, Fri at 1 AM UTC'])(
    '%s',
    (text) => {
      expect(la(text)).toBe(text);
    },
  );
});

describe('B9 a bare Zulu time does not render as something that looks like a range', () => {
  it('names the zone instead of gluing an offset on', () => {
    expect(la('TAF valid from 10:00Z')).toBe('TAF valid from 02:00 PST');
  });
});

describe('B10 a year-less date picks the year its weekday names', () => {
  it('reads "Sat, Jan 9" in November 2026 as 9 January 2027', () => {
    expect(la('Sat, Jan 9 at 1 AM UTC')).toBe('Fri, Jan 8 at 5 PM PST');
  });
});

describe('B11 an offset written with spaces or a minus sign is not dropped', () => {
  it.each(['14:00 UTC −5', '14:00 GMT + 1'])('%s', (text) => {
    expect(la(text)).not.toMatch(/^06:00 PST/);
  });
});
