import { describe, expect, it } from 'vitest';
import { convertText, findConversions, type ConvertOptions } from '../src';

// Time ranges (wiki "Spec: Time ranges", issue #11). A range converts as one
// unit: one conversion whose index and length span both ends, with epochMs the
// start, endEpochMs the end and dayShift the start's (B1). Rules are named as in
// the spec: B1–B10 (Behaviour), L1–L15 (Left alone), the Edge cases table, and
// decisions 1–7. Ranges that are left alone are here too; lists and other
// guards are in left-alone.test.ts.

const LA = 'America/Los_Angeles';
const TOKYO = 'Asia/Tokyo';
const NY = 'America/New_York';
// Wednesday 2026-11-11 20:00 UTC.
const NOW = Date.UTC(2026, 10, 11, 20, 0, 0);
const HOUR = 3_600_000;

const opts = (zone: string, extra: ConvertOptions = {}): ConvertOptions => ({ targetZone: zone, now: NOW, ...extra });
const to = (zone: string, extra: ConvertOptions = {}) => (text: string) => convertText(text, opts(zone, extra));
const la = to(LA);
const tokyo = to(TOKYO);
const find = (text: string, zone = LA, extra: ConvertOptions = {}) => findConversions(text, opts(zone, extra));
/** The single conversion a range must give. */
const one = (text: string, zone = LA, extra: ConvertOptions = {}) => {
  const found = find(text, zone, extra);
  expect(found, `one conversion for "${text}"`).toHaveLength(1);
  return found[0]!;
};
/** Left alone whole: unchanged, and no conversion at all, so no icon (B2). */
const leftAlone = (text: string, zone = LA, extra: ConvertOptions = {}) => {
  expect(convertText(text, opts(zone, extra))).toBe(text);
  expect(find(text, zone, extra)).toEqual([]);
};

describe('Behaviour examples (B1–B9)', () => {
  it.each([
    ['B1, B3', 'Call between 1:30–3:00 PM UTC', LA, 'Call between 5:30–7:00 AM PST'],
    ['B4', 'Open 1-3 PM UTC', LA, 'Open 5-7 AM PST'],
    ['B3, decision 2', '9:00 AM UTC to 5:00 PM', LA, '1:00 AM PST to 9:00 AM'],
    ['B4', '11–1 PM ET', LA, '8–10 AM PST'],
    ['B4', '10–11 PM UTC', LA, '2–3 PM PST'],
    ['B6', '13:00–15:30 UTC', LA, '05:00–07:30 PST'],
    ['B5', '10 PM – 2 AM UTC', LA, '2 PM – 6 PM PST'],
    ['B5, decision 3', '11 PM UTC – 1 AM UTC', LA, '3 PM PST – 5 PM PST'],
    ['B7', '1:30–3:00 AM UTC', LA, '5:30–7:00 PM PST (−1 day)'],
    ['B7', '6 AM – 9 AM UTC', LA, '10 PM (−1 day) – 1 AM PST'],
    ['B6, B7', '12:30–3:00 PM UTC', TOKYO, '9:30 PM–12:00 AM GMT+9'],
    ['B7', '8–10 PM UTC', TOKYO, '5–7 AM GMT+9 (+1 day)'],
    ['B6', 'Nov 12, 1:30–3:00 PM UTC', LA, 'Nov 12, 5:30–7:00 AM PST'],
    ['B6', 'Nov 12, 7–9 AM UTC', LA, 'Nov 11, 11 PM–Nov 12, 1 AM PST'],
    ['B6', 'Friday 7–9 AM UTC', LA, 'Thursday 11 PM–Friday 1 AM PST'],
    ['B5, B6', 'Nov 12 11 PM – Nov 13 1 AM UTC', LA, 'Nov 12 3 PM – Nov 12 5 PM PST'],
    ['B9', '1:30 PM UTC-3:00 PM UTC', LA, '5:30 AM PST-7:00 AM PST'],
  ])('%s: "%s" (reader %s) reads "%s", as one conversion', (_rule, text, zone, expected) => {
    expect(convertText(text, opts(zone))).toBe(expected);
    expect(find(text, zone)).toHaveLength(1);
  });

  it('B3, B6: "Open 9 AM – 5 PM" under site default America/New_York reads "Open 6 AM – 2 PM PST", flagged assumed zone', () => {
    const ny = { defaultZone: NY };
    expect(convertText('Open 9 AM – 5 PM', opts(LA, ny))).toBe('Open 6 AM – 2 PM PST');
    const c = one('Open 9 AM – 5 PM', LA, ny);
    expect(c.flags).toContain('assumed-zone');
    expect(c).toMatchObject({ epochMs: Date.UTC(2026, 10, 11, 14), endEpochMs: Date.UTC(2026, 10, 11, 22) });
  });
});

describe('B1 a range is one conversion', () => {
  it('B1: spans both ends, starts at the start, ends at the end, and has the start’s day shift', () => {
    expect(one('Call between 1:30–3:00 PM UTC')).toMatchObject({
      // "from"/"between" are not part of it.
      index: 13,
      length: 16,
      original: '1:30–3:00 PM UTC',
      converted: '5:30–7:00 AM PST',
      epochMs: Date.UTC(2026, 10, 11, 13, 30),
      endEpochMs: Date.UTC(2026, 10, 11, 15, 0),
      dayShift: 0,
      format: 'text',
      confidence: 'high',
      flags: ['time-only'],
      alternatives: [],
    });
  });

  it('B1: dayShift is the start’s when only the start moves to another day', () => {
    expect(one('6 AM – 9 AM UTC')).toMatchObject({
      epochMs: Date.UTC(2026, 10, 11, 6),
      endEpochMs: Date.UTC(2026, 10, 11, 9),
      dayShift: -1,
    });
  });

  it('B1, decision 2: a zone on the first end only gives one conversion spanning both ends', () => {
    expect(one('9:00 AM UTC to 5:00 PM')).toMatchObject({
      index: 0,
      length: 22,
      epochMs: Date.UTC(2026, 10, 11, 9),
      endEpochMs: Date.UTC(2026, 10, 11, 17),
    });
  });

  it('B1, decision 3: the same zone on each end gives one conversion spanning both ends', () => {
    expect(one('Meet 1:30 PM UTC – 3:00 PM UTC')).toMatchObject({
      index: 5,
      length: 25,
      original: '1:30 PM UTC – 3:00 PM UTC',
      converted: '5:30 AM PST – 7:00 AM PST',
      epochMs: Date.UTC(2026, 10, 11, 13, 30),
      endEpochMs: Date.UTC(2026, 10, 11, 15),
    });
  });

  it('B1: two ranges in one text are two conversions', () => {
    expect(la('Morning 9–10 AM UTC. Evening 6–7 PM UTC.')).toBe('Morning 1–2 AM PST. Evening 10–11 AM PST.');
    expect(find('Morning 9–10 AM UTC. Evening 6–7 PM UTC.')).toHaveLength(2);
  });
});

describe('B2 never half-converted', () => {
  it.each([
    // An end that cannot be read: the whole range is left alone, with no icon.
    ['meridiem not inferable (L4)', '9 AM–5 UTC'],
    ['invalid hour (L11)', '10:00–25:00 UTC'],
    ['invalid date (L11)', 'Feb 30, 1–3 PM UTC'],
    ['end not after start (L10)', '3 PM – 3 PM UTC'],
  ])('B2: %s: "%s"', (_why, text) => {
    leftAlone(text);
  });
});

describe('B3 where the zone comes from', () => {
  it('B3: a zone after the end applies to both ends', () => {
    expect(one('1:30–3:00 PM UTC')).toMatchObject({
      epochMs: Date.UTC(2026, 10, 11, 13, 30),
      endEpochMs: Date.UTC(2026, 10, 11, 15),
    });
  });

  it('B3, decision 2: a zone on the first end only applies to the end too', () => {
    expect(la('Open 9:00 AM UTC to 5:00 PM.')).toBe('Open 1:00 AM PST to 9:00 AM.');
  });

  it('B3: with no zone, the site default applies to both ends', () => {
    const ny = to(LA, { defaultZone: NY });
    expect(ny('Open 7 PM–9 PM')).toBe('Open 4 PM–6 PM PST');
    expect(ny('Open 7–9 PM')).toBe('Open 4–6 PM PST');
    expect(one('Open 7–9 PM', LA, { defaultZone: NY })).toMatchObject({
      epochMs: Date.UTC(2026, 10, 12, 0),
      endEpochMs: Date.UTC(2026, 10, 12, 2),
      flags: expect.arrayContaining(['assumed-zone']),
    });
  });

  it.each(['Open 19:00–21:00', 'Open 7:00–9:00'])('B3: under a site default the end needs a meridiem: "%s"', (text) => {
    leftAlone(text, LA, { defaultZone: NY });
  });

  it('B3: with no zone and no site default, a range is left alone', () => {
    leftAlone('Open 9 AM – 5 PM');
  });
});

describe('B4 a meridiem written on the end only', () => {
  it('B4: "11–1 PM" is 11 AM–1 PM', () => {
    expect(one('11–1 PM UTC')).toMatchObject({
      epochMs: Date.UTC(2026, 10, 11, 11),
      endEpochMs: Date.UTC(2026, 10, 11, 13),
    });
  });

  it('B4: "10–11 PM" is 10–11 PM', () => {
    expect(one('10–11 PM UTC')).toMatchObject({
      epochMs: Date.UTC(2026, 10, 11, 22),
      endEpochMs: Date.UTC(2026, 10, 11, 23),
    });
  });

  it('B4: "9:30–12 AM" is 9:30 PM–midnight', () => {
    expect(one('9:30–12 AM UTC')).toMatchObject({
      epochMs: Date.UTC(2026, 10, 11, 21, 30),
      endEpochMs: Date.UTC(2026, 10, 12, 0),
    });
    expect(la('9:30–12 AM UTC')).toBe('1:30–4 PM PST');
  });

  it('B4: a start with no minutes and no meridiem takes the end’s ("1-3 PM")', () => {
    expect(one('Open 1-3 PM UTC')).toMatchObject({
      epochMs: Date.UTC(2026, 10, 11, 13),
      endEpochMs: Date.UTC(2026, 10, 11, 15),
    });
  });

  it.each(['13:00–15 UTC', '13–15:00 UTC', '9–17:00 UTC'])('B4: 24-hour ranges need minutes on both ends: "%s"', (text) => {
    leftAlone(text);
  });
});

describe('B5 which day each end falls on', () => {
  it('B5: a time-only range starts on today’s date in the source zone', () => {
    expect(one('1:30–3:00 AM UTC')).toMatchObject({
      epochMs: Date.UTC(2026, 10, 11, 1, 30),
      endEpochMs: Date.UTC(2026, 10, 11, 3),
    });
    // At NOW it is already Thursday 12 November in Tokyo.
    expect(la('1–3 AM JST')).toBe('8–10 AM PST (−1 day)');
    expect(one('1–3 AM JST')).toMatchObject({
      epochMs: Date.UTC(2026, 10, 11, 16),
      endEpochMs: Date.UTC(2026, 10, 11, 18),
      dayShift: -1,
    });
  });

  it('B5: the end is the next time that clock reading comes after the start, the next day if need be', () => {
    expect(one('10 PM – 2 AM UTC')).toMatchObject({
      epochMs: Date.UTC(2026, 10, 11, 22),
      endEpochMs: Date.UTC(2026, 10, 12, 2),
      dayShift: 0,
    });
  });

  it('B5: a date on each end is used as stated', () => {
    expect(one('Nov 12 11 PM – Nov 13 1 AM UTC')).toMatchObject({
      epochMs: Date.UTC(2026, 10, 12, 23),
      endEpochMs: Date.UTC(2026, 10, 13, 1),
    });
  });

  it('B5: a weekday on each end is used as stated', () => {
    expect(la('Friday 11 PM – Saturday 1 AM UTC')).toBe('Friday 3 PM – Friday 5 PM PST');
    const c = one('Friday 11 PM – Saturday 1 AM UTC');
    expect(c).toMatchObject({ endEpochMs: c.epochMs + 2 * HOUR });
  });

  it('B5: a date on the start only applies to the start', () => {
    expect(one('Nov 12, 7–9 AM UTC')).toMatchObject({
      epochMs: Date.UTC(2026, 10, 12, 7),
      endEpochMs: Date.UTC(2026, 10, 12, 9),
      dayShift: 0,
    });
  });
});

describe('B6 how each end is written', () => {
  it.each([
    ['1:30–3:00 PM UTC', '5:30–7:00 AM PST'],
    ['1:30-3:00 PM UTC', '5:30-7:00 AM PST'],
    ['1:30—3:00 PM UTC', '5:30—7:00 AM PST'],
    // A Unicode minus is a range dash too: both ends convert (Decision log, 2026-11-16).
    ['1:30−3:00 PM UTC', '5:30−7:00 AM PST'],
    ['1:30 – 3:00 PM UTC', '5:30 – 7:00 AM PST'],
    ['1:30  -  3:00 PM UTC', '5:30  -  7:00 AM PST'],
    ['1:30 to 3:00 PM UTC', '5:30 to 7:00 AM PST'],
    ['1:30 until 3:00 PM UTC', '5:30 until 7:00 AM PST'],
    ['from 1 PM to 3 PM UTC', 'from 5 AM to 7 AM PST'],
  ])('B6, decision 1: keeps the separator and its spacing exactly: "%s"', (text, expected) => {
    expect(la(text)).toBe(expected);
    expect(find(text)).toHaveLength(1);
  });

  it('B6: each end renders as a single time would (padding, added minutes, meridiem style, brackets)', () => {
    expect(la('13:00–15:30 UTC')).toBe('05:00–07:30 PST');
    expect(to('Asia/Kolkata')('1–3 PM UTC')).toBe('6:30–8:30 PM GMT+5:30');
    expect(la('1–3 pm UTC')).toBe('5–7 am PST');
    expect(la('1:30–3:00 PM (UTC)')).toBe('5:30–7:00 AM (PST)');
  });

  it('B6: the start gets its own meridiem when the ends land in different meridiems', () => {
    expect(tokyo('12:30–3:00 PM UTC')).toBe('9:30 PM–12:00 AM GMT+9');
  });

  it('B6: the end gets its own date, in the start’s format, when the ends land on different dates', () => {
    expect(la('Nov 12, 7–9 AM UTC')).toBe('Nov 11, 11 PM–Nov 12, 1 AM PST');
    expect(la('Friday 7–9 AM UTC')).toBe('Thursday 11 PM–Friday 1 AM PST');
  });

  it('B6: an element written on both ends stays on both', () => {
    expect(la('Nov 12 11 PM – Nov 13 1 AM UTC')).toBe('Nov 12 3 PM – Nov 12 5 PM PST');
    expect(la('10 PM – 2 AM UTC')).toBe('2 PM – 6 PM PST');
  });

  it('B6: under a site default, the target zone’s name is added once, after the end', () => {
    expect(to(LA, { defaultZone: NY })('Open 9 AM – 5 PM')).toBe('Open 6 AM – 2 PM PST');
  });
});

describe('B7 one day marker', () => {
  it('B7: a time-only range has one marker, for the start’s day, after the whole range', () => {
    expect(la('1:30–3:00 AM UTC')).toBe('5:30–7:00 PM PST (−1 day)');
    expect(one('1:30–3:00 AM UTC')).toMatchObject({ dayShift: -1, flags: ['time-only'] });
    expect(tokyo('8–10 PM UTC')).toBe('5–7 AM GMT+9 (+1 day)');
    expect(one('8–10 PM UTC', TOKYO)).toMatchObject({ dayShift: 1 });
  });

  it('B7: the marker goes directly after the start when the converted range crosses midnight', () => {
    expect(la('6 AM – 9 AM UTC')).toBe('10 PM (−1 day) – 1 AM PST');
  });

  it('B7: no marker when the start keeps its day, even if the converted range crosses midnight', () => {
    expect(tokyo('12:30–3:00 PM UTC')).toBe('9:30 PM–12:00 AM GMT+9');
    expect(one('12:30–3:00 PM UTC', TOKYO)).toMatchObject({ dayShift: 0 });
  });

  it('B7: ranges with a date or weekday get no marker', () => {
    expect(la('Nov 12, 7–9 AM UTC')).toBe('Nov 11, 11 PM–Nov 12, 1 AM PST');
    expect(la('Friday 7–9 AM UTC')).toBe('Thursday 11 PM–Friday 1 AM PST');
    expect(one('Nov 12, 7–9 AM UTC')).toMatchObject({ dayShift: 0 });
  });
});

describe('B8 one reading for the whole range', () => {
  it('B8: an ambiguous label is read once; each alternative is a whole range', () => {
    const c = one('Nov 13, 2026 9–11 AM CST', 'UTC');
    expect(c).toMatchObject({
      converted: 'Nov 13, 2026 3–5 PM UTC',
      confidence: 'low',
      flags: ['ambiguous-zone'],
    });
    expect(c.alternatives).toEqual([
      expect.objectContaining({
        description: 'China Standard Time',
        converted: 'Nov 13, 2026 1–3 AM UTC',
        epochMs: Date.UTC(2026, 10, 13, 1),
      }),
    ]);
  });

  it('B8, decision 3: a zoned range with the same ambiguous label carries one set of whole-range alternatives', () => {
    const c = one('Nov 13, 2026 9 AM CST – 11 AM CST', 'UTC');
    expect(c).toMatchObject({ converted: 'Nov 13, 2026 3 PM UTC – 5 PM UTC', confidence: 'low', flags: ['ambiguous-zone'] });
    expect(c.alternatives.map((a) => a.converted)).toEqual(['Nov 13, 2026 1 AM UTC – 3 AM UTC']);
  });

  it('B8: a season mismatch on both ends is flagged once, with a whole-range alternative', () => {
    const c = one('July 15, 2026 1–3 PM EST', 'UTC');
    expect(c).toMatchObject({ converted: 'July 15, 2026 5–7 PM UTC', confidence: 'low', flags: ['season-mismatch'] });
    expect(c.alternatives.map((a) => a.converted)).toEqual(['July 15, 2026 6–8 PM UTC']);
    const literal = one('July 15, 2026 1–3 PM EST', 'UTC', { seasonMismatch: 'literal' });
    expect(literal.converted).toBe('July 15, 2026 6–8 PM UTC');
    expect(literal.alternatives.map((a) => a.converted)).toEqual(['July 15, 2026 5–7 PM UTC']);
  });

  it('B8: different season-mismatch verdicts at the two ends leave the range alone', () => {
    leftAlone('Nov 1, 2026 12:30–3:00 AM EST', 'UTC');
    // Converted end by end before this spec; decision 3 (a) makes it one unit, so it is left alone.
    leftAlone('Nov 1, 2026 12:30 AM EST – 3:00 AM EST', 'UTC');
  });
});

describe('B9 hyphens between zoned times', () => {
  it('B9: "13:00 UTC-14:00 UTC" is a range, not an offset', () => {
    expect(la('13:00 UTC-14:00 UTC')).toBe('05:00 PST-06:00 PST');
    expect(one('13:00 UTC-14:00 UTC')).toMatchObject({
      epochMs: Date.UTC(2026, 10, 11, 13),
      endEpochMs: Date.UTC(2026, 10, 11, 14),
    });
  });

  it('B9: "1:30 PM UTC-3:00 PM UTC" is one range', () => {
    expect(one('1:30 PM UTC-3:00 PM UTC')).toMatchObject({
      converted: '5:30 AM PST-7:00 AM PST',
      epochMs: Date.UTC(2026, 10, 11, 13, 30),
      endEpochMs: Date.UTC(2026, 10, 11, 15),
    });
  });

  it('B9: "Nov 13, 2026 10:00 UTC+2" is still an offset', () => {
    expect(la('Nov 13, 2026 10:00 UTC+2')).toBe('Nov 13, 2026 00:00 PST');
    expect(one('Nov 13, 2026 10:00 UTC+2').epochMs).toBe(Date.UTC(2026, 10, 13, 8));
  });
});

describe('Edge cases', () => {
  it('daylight saving changes in the source zone inside the range: each end uses its own offset', () => {
    expect(to('UTC')('Nov 1, 2026 12:30–3:00 AM ET')).toBe('Nov 1, 2026 4:30–8:00 AM UTC');
    const c = one('Nov 1, 2026 12:30–3:00 AM ET', 'UTC');
    expect(c).toMatchObject({ epochMs: Date.UTC(2026, 10, 1, 4, 30), endEpochMs: Date.UTC(2026, 10, 1, 8) });
    expect(c).toMatchObject({ endEpochMs: c.epochMs + 3.5 * HOUR });
  });

  it('daylight saving changes in the target zone inside the range', () => {
    expect(la('Nov 1, 2026 8:00–10:00 AM UTC')).toBe('Nov 1, 2026 1:00 AM PDT–2:00 AM PST');
  });

  it('season-mismatch verdicts differ between the ends: left alone (B8)', () => {
    leftAlone('Nov 1, 2026 12:30–3:00 AM EST', 'UTC');
  });

  it('an end in a skipped or repeated local hour is read exactly as a single time would be', () => {
    const [start] = find('Nov 1, 2026 1:30 AM ET');
    const [end] = find('Nov 1, 2026 2:30 AM ET');
    expect(one('Nov 1, 2026 1:30–2:30 AM ET')).toMatchObject({ epochMs: start!.epochMs, endEpochMs: end!.epochMs });
  });

  it('half-hour zone', () => {
    expect(to('Asia/Kolkata')('1–3 PM UTC')).toBe('6:30–8:30 PM GMT+5:30');
  });

  it('ends at midnight', () => {
    expect(la('10 PM – 12 AM UTC')).toBe('2 PM – 4 PM PST');
    expect(tokyo('10 PM – 12 AM UTC')).toBe('7 AM – 9 AM GMT+9 (+1 day)');
    expect(one('10 PM – 12 AM UTC')).toMatchObject({
      epochMs: Date.UTC(2026, 10, 11, 22),
      endEpochMs: Date.UTC(2026, 10, 12, 0),
    });
  });

  it('noon and midnight inference: "12–1 PM" is noon–1 PM, "11–12 AM" is 11 PM–midnight (B4)', () => {
    expect(one('12–1 PM UTC')).toMatchObject({
      epochMs: Date.UTC(2026, 10, 11, 12),
      endEpochMs: Date.UTC(2026, 10, 11, 13),
    });
    expect(la('12–1 PM UTC')).toBe('4–5 AM PST');
    expect(one('11–12 AM UTC')).toMatchObject({
      epochMs: Date.UTC(2026, 10, 11, 23),
      endEpochMs: Date.UTC(2026, 10, 12, 0),
    });
    expect(la('11–12 AM UTC')).toBe('3–4 PM PST');
  });

  it('year boundary', () => {
    expect(la('Jan 1, 2027 7–9 AM UTC')).toBe('Dec 31, 2026 11 PM–Jan 1, 2027 1 AM PST');
  });

  it('year boundary in the other direction', () => {
    expect(tokyo('Dec 31, 2026 11 PM – 1 AM UTC')).toBe('Jan 1, 2027 8 AM – 10 AM GMT+9');
    expect(one('Dec 31, 2026 11 PM – 1 AM UTC', TOKYO)).toMatchObject({
      epochMs: Date.UTC(2026, 11, 31, 23),
      endEpochMs: Date.UTC(2027, 0, 1, 1),
    });
  });

  it('overnight cap (decision 5): 12 h converts, 13 h is left alone', () => {
    const c = one('7 PM – 7 AM UTC');
    expect(c).toMatchObject({ epochMs: Date.UTC(2026, 10, 11, 19), endEpochMs: Date.UTC(2026, 10, 12, 7) });
    expect(la('7 PM – 7 AM UTC')).toBe('11 AM – 11 PM PST');
    leftAlone('6 PM – 7 AM UTC');
    // Just past the cap.
    leftAlone('7 PM – 7:30 AM UTC');
  });

  it('ambiguous label', () => {
    expect(to('UTC')('Nov 13, 2026 9–11 AM CST')).toBe('Nov 13, 2026 3–5 PM UTC');
  });

  it('season mismatch on both ends', () => {
    expect(to('UTC')('July 15, 2026 1–3 PM EST')).toBe('July 15, 2026 5–7 PM UTC');
  });

  it('a change of time that reads like a range is read as an overnight range', () => {
    expect(la('Moved from 9 PM to 1 AM UTC')).toBe('Moved from 1 PM to 5 PM PST');
    expect(one('Moved from 9 PM to 1 AM UTC')).toMatchObject({
      epochMs: Date.UTC(2026, 10, 11, 21),
      endEpochMs: Date.UTC(2026, 10, 12, 1),
    });
  });
});

describe('Left alone', () => {
  it.each([
    'noon–3 PM UTC',
    'noon UTC – 3 PM UTC',
    'midnight UTC – 2 AM UTC',
    '9 AM till 5 PM UTC',
    '9 AM through 5 PM UTC',
    'between 1 and 3 PM UTC',
    '1 PM UTC – 3',
    '3 PM UTC - 4 people',
    // Any amount of whitespace.
    'noon UTC  –  3 PM UTC',
    '9 AM   through   5 PM UTC',
  ])('L1: range-like phrases outside v1: "%s"', (text) => {
    leftAlone(text);
  });

  it.each([
    'pages 1-3',
    'ages 9–5',
    'won 3-1',
    '1-3 hours',
    '30–45 min',
    '9 to 5',
    '9–5 UTC',
    '13–15 UTC',
    'v2.1–2.3',
    '555-0134',
    '1-800-555-0199',
  ])('L2: numbers that are not times: "%s"', (text) => {
    leftAlone(text);
    leftAlone(text, LA, { defaultZone: NY });
  });

  it.each(['5-7 PM2.5', 'AM1–AM3 slots'])('L3: meridiem letters followed by a digit, even with a site default: "%s"', (text) => {
    leftAlone(text);
    leftAlone(text, LA, { defaultZone: NY });
  });

  it.each(['9 AM–17:00 UTC', '9 AM–5 UTC'])('L4: mismatched clocks: "%s"', (text) => {
    leftAlone(text);
  });

  it.each(['Nov 12–14', '12–14 November 2026', 'Nov 12 – Dec 3', 'Nov 12–14, 1 AM UTC'])(
    'L5: date-only ranges: "%s"',
    (text) => {
      leftAlone(text);
    },
  );

  it.each(['9 AM, 1 PM and 5 PM UTC', '1 PM or 3 PM UTC', 'between 1 PM and 3 PM UTC', '9–10 AM, 1 PM UTC'])(
    'L6: lists sharing one zone: "%s"',
    (text) => {
      leftAlone(text);
    },
  );

  it('L6: a list where every item has its own zone still converts item by item', () => {
    expect(la('1 PM UTC, 3 PM UTC')).toBe('5 AM PST, 7 AM PST');
    expect(find('1 PM UTC, 3 PM UTC')).toHaveLength(2);
  });

  it('L7: different stated zones stay separate conversions', () => {
    expect(to('UTC')('Nov 13, 2026 1 PM ET – 3 PM PT')).toBe('Nov 13, 2026 6 PM UTC – 11 PM UTC');
    expect(find('Nov 13, 2026 1 PM ET – 3 PM PT', 'UTC')).toHaveLength(2);
  });

  it.each(['9 AM PT – 12 PM ET', '11 PM ET – 1 AM PT'])('L7: different zones that do not run forwards: "%s"', (text) => {
    leftAlone(text, 'UTC');
  });

  it.each([
    '9:00 AM UTC to 5:00 PM local',
    '9 AM UTC – 5 PM local time',
    '9 AM UTC – 5 PM your time',
    '9 AM UTC – 5 PM BRT',
    '9 AM UTC – 5 PM EOD',
  ])('L8: zone on the first end, with a label of its own on the end: "%s"', (text) => {
    leftAlone(text);
  });

  it.each([
    ['2026-11-13T01:30Z–2026-11-13T03:00Z', '2026-11-12T17:30-08:00–2026-11-12T19:00-08:00'],
    ['2026-11-13T01:30Z/2026-11-13T03:00Z', '2026-11-12T17:30-08:00/2026-11-12T19:00-08:00'],
  ])('L9: ISO timestamps never join a range: "%s" stays two ISO timestamps', (text, converted) => {
    const found = find(text);
    expect(found.map((c) => c.format)).toEqual(['iso', 'iso']);
    expect(found.map((c) => c.original)).toEqual(['2026-11-13T01:30Z', '2026-11-13T03:00Z']);
    expect(la(text)).toBe(converted);
  });

  it('L9: an ISO date before a range is deferred', () => {
    leftAlone('2026-11-13 01:30–03:00 UTC');
  });

  it.each(['3 PM – 3 PM UTC', '3 PM to 1 PM UTC', '6 PM – 7 AM UTC', '9:00–5:00 UTC', 'Nov 13 1 AM – Nov 12 11 PM UTC'])(
    'L10: implausible ranges: "%s"',
    (text) => {
      leftAlone(text);
    },
  );

  it('L10, decision 5: a zoned range with the same label takes the 12 h overnight cap', () => {
    // Converted as "7 AM PST to 5 AM PST (+1 day)" before this spec.
    leftAlone('3 PM UTC to 1 PM UTC');
  });

  it.each(['Feb 30, 1–3 PM UTC', '11:30–13:00 PM UTC', '10:00–25:00 UTC'])('L11: either end invalid: "%s"', (text) => {
    leftAlone(text);
  });

  it.each(['1–3 PM PST', '9 AM PT – 5 PM PT'])('L12: already in the reader’s zone at both ends: "%s"', (text) => {
    leftAlone(text);
  });

  it('L15: dotted times are not supported yet', () => {
    leftAlone('1.30–3.00 pm UTC');
  });
});

// Ranges whose ends each carry a zone, built in #26; decision 3 (a) makes the
// ones with the same label one unit with one day marker.

describe('hyphenated ranges of zoned times', () => {
  it('reads "UTC-10 AM" as the start of the second end, not as UTC−10', () => {
    expect(la('9 AM UTC-10 AM UTC')).toBe('1 AM PST-2 AM PST');
    expect(la('2 PM UTC-3 PM UTC')).toBe('6 AM PST-7 AM PST');
    // Each end mirrors its own padding: "9:00" stays one digit, "10:00" two.
    expect(la('9:00 GMT-10:00 GMT')).toBe('1:00 PST-02:00 PST');
    expect(la('9 AM UTC-10:30 AM UTC')).toBe('1 AM PST-2:30 AM PST');
  });

  it('reads a spaced Unicode minus as a range dash, not as UTC−3 (Decision log, 2026-11-16)', () => {
    // Converts the same as the tight form; the spacing around the dash is kept as written.
    expect(la('2 PM UTC −3 PM UTC')).toBe('6 AM PST −7 AM PST');
    expect(one('2 PM UTC −3 PM UTC')).toMatchObject({
      epochMs: Date.UTC(2026, 10, 11, 14),
      endEpochMs: Date.UTC(2026, 10, 11, 15),
    });
  });

  it('decision 3: gives one conversion when both ends have the same label', () => {
    for (const text of ['9 AM UTC-10 AM UTC', '2 PM UTC-3 PM UTC', '9:00 GMT-10:00 GMT', '9 AM UTC-10:30 AM UTC']) {
      expect(find(text), text).toHaveLength(1);
    }
  });
});

describe('a dated range', () => {
  it('gives the second end the shared date', () => {
    expect(la('Jul 13, 2026 1:30 PM UTC–3:00 PM UTC')).toBe('Jul 13, 2026 6:30 AM PDT–8:00 AM PDT');
    expect(find('Jul 13, 2026 1:30 PM UTC–3:00 PM UTC')).toHaveLength(1);
  });

  it('ends at the first such time after the start when it crosses midnight', () => {
    // 23:30 UTC on 13 July to 01:30 UTC on 14 July: 16:30 to 18:30 PDT, both on 13 July.
    expect(la('Jul 13, 2026 11:30 PM UTC – 1:30 AM UTC')).toBe('Jul 13, 2026 4:30 PM PDT – 6:30 PM PDT');
    expect(one('Jul 13, 2026 11:30 PM UTC – 1:30 AM UTC')).toMatchObject({
      epochMs: Date.UTC(2026, 6, 13, 23, 30),
      endEpochMs: Date.UTC(2026, 6, 14, 1, 30),
      flags: [],
    });
  });

  it('reads the date written on each end when both have one', () => {
    expect(la('Nov 13, 2026 1 PM UTC – Nov 14, 2026 1 PM UTC')).toBe('Nov 13, 2026 5 AM PST – Nov 14, 2026 5 AM PST');
    expect(find('Nov 13, 2026 1 PM UTC – Nov 14, 2026 1 PM UTC')).toHaveLength(1);
  });

  it('decision 3, B6: writes the end’s date instead of a day marker', () => {
    expect(la('Jan 1, 2027 7 AM UTC – 9 AM UTC')).toBe('Dec 31, 2026 11 PM PST – Jan 1, 2027 1 AM PST');
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

describe('a later end that falls on another day than the first', () => {
  it('is marked against the date as converted in a list', () => {
    expect(tokyo('Office hours on Nov 13, 2026 at 9 AM UTC and 9 PM UTC')).toBe(
      'Office hours on Nov 13, 2026 at 6 PM GMT+9 and 6 AM GMT+9 (+1 day)',
    );
    expect(tokyo('Office hours on Thursday at 9 AM UTC and 9 PM UTC')).toBe(
      'Office hours on Thursday at 6 PM GMT+9 and 6 AM GMT+9 (+1 day)',
    );
  });

  it('decision 3, B6: gets its own date in a range with the same label on each end', () => {
    expect(tokyo('Nov 13, 2026 9 AM UTC – 9 PM UTC')).toBe('Nov 13, 2026 6 PM GMT+9 – Nov 14, 2026 6 AM GMT+9');
    expect(one('Nov 13, 2026 9 AM UTC – 9 PM UTC', TOKYO)).toMatchObject({
      dayShift: 0,
      epochMs: Date.UTC(2026, 10, 13, 9),
      endEpochMs: Date.UTC(2026, 10, 13, 21),
    });
  });

  it('is not marked when it falls on the same day', () => {
    expect(tokyo('Nov 13, 2026 1 AM UTC – 3 AM UTC')).toBe('Nov 13, 2026 10 AM GMT+9 – 12 PM GMT+9');
    expect(find('Nov 13, 2026 1 AM UTC – 3 AM UTC', TOKYO)).toHaveLength(1);
  });
});

describe('a time-only range', () => {
  it('ends at the first such time after the start', () => {
    expect(la('11:30 PM UTC – 1:30 AM UTC')).toBe('3:30 PM PST – 5:30 PM PST');
  });

  it('decision 6, B7: has one day marker, for the day the range starts', () => {
    expect(la('1:30 AM UTC – 3:00 AM UTC')).toBe('5:30 PM PST – 7:00 PM PST (−1 day)');
    expect(one('1:30 AM UTC – 3:00 AM UTC')).toMatchObject({ dayShift: -1, flags: ['time-only'] });
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

describe('edge of the input', () => {
  it('finds nothing in empty or broken range text', () => {
    for (const text of ['', '–', '1:30–', '– PM UTC', '1:30–3:00']) {
      expect(find(text), JSON.stringify(text)).toEqual([]);
    }
  });

  it('converts nothing for an invalid target zone', () => {
    expect(findConversions('1:30–3:00 PM UTC', { targetZone: 'Not/AZone', now: NOW })).toEqual([]);
  });
});
