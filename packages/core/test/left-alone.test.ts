import { describe, expect, it } from 'vitest';
import { convertText, findConversions } from '../src';

// A wrong conversion is worse than a missed one: each group below lists text the
// engine must leave exactly as written, then nearby text it must still convert,
// to show the guard is no broader than it needs to be.

const LA = 'America/Los_Angeles';
// Wednesday 2026-11-11 20:00 UTC.
const NOW = Date.UTC(2026, 10, 11, 20, 0, 0);

const to = (zone: string, defaultZone?: string) => (text: string) =>
  convertText(text, { targetZone: zone, now: NOW, defaultZone });
const la = to(LA);

describe('a hyphenated range is never read as a UTC offset', () => {
  it.each(['9 AM UTC-10 AM', 'Open 2 PM GMT-3 PM'])('%s (second end has no zone)', (text) => {
    expect(la(text)).toBe(text);
  });

  it('still reads a real offset', () => {
    expect(la('10:00 UTC-10')).toBe('12:00 PST');
    expect(la('Nov 13, 2026 10:00 GMT-5:30')).toBe('Nov 13, 2026 07:30 PST');
  });
});

describe('ranges and lists joined by words or slashes', () => {
  it.each([
    'Call between 1:30 PM and 3:00 PM UTC',
    'Either 1:30 or 3:00 PM UTC',
    'Slots 1:30/3:00 PM UTC',
    'Open 9 till 5 PM ET',
    'Open 1 & 3 PM UTC',
    'Slots 1:30 PM, 3:00 PM UTC',
    'Open 9:00 AM UTC through 5:00 PM',
  ])('%s', (text) => {
    expect(la(text)).toBe(text);
  });

  it('still converts a single time next to "and" or a comma', () => {
    expect(la('Meet at 1:30 PM UTC and bring 3 friends')).toBe('Meet at 5:30 AM PST and bring 3 friends');
    expect(la('Doors 6 PM UTC, show 7 PM UTC')).toBe('Doors 10 AM PST, show 11 AM PST');
  });
});

describe('zone-less ranges and lists under a site default zone', () => {
  const ny = to(LA, 'America/New_York');

  it.each(['Open 7 PM–9 PM', 'Open 7 PM to 9 PM', 'Shows at 7 PM or 9 PM', 'Open 7 PM–9 PM ET'])('%s', (text) => {
    expect(ny(text)).toBe(text);
  });

  it('still converts a single zone-less time', () => {
    expect(ny('Open 7 PM')).toBe('Open 4 PM PST');
  });
});

describe('a site default is not applied next to a zone written in words', () => {
  const berlin = to('America/New_York', 'Europe/Berlin');

  it.each([
    '7 PM Pacific',
    '8 PM Eastern',
    '7 PM London time',
    '7 PM New York time',
    '7 PM (London)',
    '7 PM local time',
    'Pacific: 7 PM',
    '(London) 7 PM',
  ])('%s', (text) => {
    expect(berlin(text)).toBe(text);
  });

  it('still applies it to ordinary sentences', () => {
    expect(berlin('7 PM. Doors open at 6.')).toBe('1 PM EST. Doors open at 6.');
    expect(berlin('7 PM Friday')).toBe('1 PM EST Friday');
    expect(berlin('Start Time: 7 PM')).toBe('Start Time: 1 PM EST');
  });

  it('converts a zone it does resolve rather than the default', () => {
    expect(berlin('7 PM Pacific Time')).toBe('10 PM EST');
  });
});

describe('a time next to a date the engine cannot read', () => {
  it.each([
    '07/04/2026 6:00 PM UTC',
    '4.7.2026 18:00 UTC',
    'july 4, 2026 at 6:00 PM UTC',
    'JULY 4, 2026 at 6:00 PM UTC',
    '2026-07-04, 18:00 UTC',
    '2026-W46-5T01:30Z',
    '2026-W27-6T18:00Z',
    'Ends Friday 11/13 at 11:59 PM ET',
    '6:00 PM UTC on 07/04/2026',
    'nov 12 · 7:00 PM EST',
    'tomorrow at 6 PM UTC',
    '1 AM UTC on Mondays',
  ])('%s', (text) => {
    expect(la(text)).toBe(text);
  });

  it('still converts the dates it reads, and times with no date nearby', () => {
    expect(la('July 4, 2026 at 6:00 PM UTC')).toBe('July 4, 2026 at 11:00 AM PDT');
    expect(la('2026-07-04 18:00 UTC')).toBe('2026-07-04 11:00 PDT');
    expect(la('2026-11-13T01:30:00Z')).toBe('2026-11-12T17:30:00-08:00');
    expect(la('The 2026 conference opens at 9 AM UTC')).toBe('The 2026 conference opens at 1 AM PST');
    expect(la('We sat at 1 AM UTC')).toBe('We sat at 5 PM PST (−1 day)');
  });
});

describe('a time given for several zones', () => {
  it.each(['Airs 8 PM ET/PT on NBC', '8 p.m. ET/PT', '8 PM (ET/PT)', 'Airs 8 PM ET/7c'])('%s', (text) => {
    expect(la(text)).toBe(text);
    expect(to('Europe/London')(text)).toBe(text);
  });

  it('still converts one zone, and a list of zoned times', () => {
    expect(la('Airs 8 PM ET on NBC')).toBe('Airs 5 PM PST on NBC');
    expect(to('Europe/London')('Live at 3 PM ET / 12 PM PT')).toBe('Live at 8 PM GMT / 8 PM GMT');
  });
});

describe('weekday ranges and lists', () => {
  it.each([
    'Mon–Fri 1 AM UTC',
    'Support 1 AM UTC, Mon–Fri',
    'Sat & Sun 1 AM UTC',
    'Mon, Wed, Fri at 1 AM UTC',
    'Monday through Friday at 9 AM ET',
  ])('%s', (text) => {
    expect(la(text)).toBe(text);
  });

  it('still shifts a single weekday', () => {
    expect(la('Fri at 1 AM UTC')).toBe('Thu at 5 PM PST');
    expect(la('Support 1 AM UTC, Mon')).toBe('Support 5 PM PST, Sun');
  });
});

describe('a weekday that contradicts its date', () => {
  it.each(['Friday, November 14, 2026 at 3 PM UTC', 'Mon, Jan 10, 2027 at 1 AM UTC'])('%s', (text) => {
    expect(la(text)).toBe(text);
  });

  it('still converts when they agree', () => {
    expect(la('Saturday, November 14, 2026 at 3 PM UTC')).toBe('Saturday, November 14, 2026 at 7 AM PST');
  });
});

describe('an offset the engine does not read', () => {
  it.each(['14:00 UTC - 5', '14:00 GMT  +  1', 'Lunch 12:00 UTC-13:00 daily'])('%s', (text) => {
    expect(la(text)).toBe(text);
  });

  it('still reads offsets from −12 to +14', () => {
    expect(la('12:00 UTC-12:00')).toBe('16:00 PST');
    expect(la('12:00 UTC+14:00')).toBe('14:00 PST (−1 day)');
  });

  it('still converts a hyphenated range of zoned times', () => {
    expect(la('1 PM UTC - 3 PM UTC')).toBe('5 AM PST - 7 AM PST');
  });
});

describe('an offset followed by a label that does not confirm it', () => {
  it.each([
    // "+" is never a range dash, so a wrong label cannot be explained away.
    '3:00 PM UTC+01:00 PST',
    // ET is UTC−5 in November: offset and label disagree.
    '10:00 UTC-04:00 ET',
    // A hyphen that could be a range, but the two ends are the same instant.
    '9:00 UTC-10:00 CET',
  ])('%s', (text) => {
    expect(findConversions(text, { targetZone: LA, now: NOW })).toEqual([]);
  });

  it.each(['2 PM UTC −3 PM UTC', '2 PM UTC+3 PM UTC'])('%s (a sign is not a range dash)', (text) => {
    expect(la(text)).toBe(text);
  });

  it('does not let a later time take the site default after a sign', () => {
    expect(to(LA, 'Europe/Berlin')('10:00 UTC+5 PM')).toBe('10:00 UTC+5 PM');
  });
});

describe('a range ending at noon or midnight', () => {
  it.each(['It runs 9 AM ET to noon', 'noon to 9 PM ET', 'Open 9 PM ET – midnight', 'Open 9 PM ET until Midnight'])(
    '%s',
    (text) => {
      expect(to('UTC')(text)).toBe(text);
    },
  );

  it('still converts a time in the same sentence as noon', () => {
    expect(to('UTC')('Lunch at noon, call at 3 PM ET')).toBe('Lunch at noon, call at 8 PM UTC');
  });
});

describe('a range whose ends have different labels and would run almost a day', () => {
  it.each(['Nov 13, 2026 9 PM PT – 11 PM ET', 'Jul 13, 2026 1:30 PM UTC – 3:00 PM CEST'])('%s', (text) => {
    expect(to('UTC')(text)).toBe(text);
  });

  it('still converts one that runs forwards on the written date', () => {
    expect(to('UTC')('Nov 13, 2026 1 PM ET – 3 PM PT')).toBe('Nov 13, 2026 6 PM UTC – 11 PM UTC');
  });
});
