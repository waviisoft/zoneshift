import { describe, expect, it } from 'vitest';
import { convertText, findConversions } from '../src';
import { ianaOffsetAt } from '../src/tz';
import { ZONE_TABLE } from '../src/zones';

const LA = 'America/Los_Angeles';
// Wednesday 2026-11-11 20:00 UTC: winter time in North America and Europe.
const NOW = Date.UTC(2026, 10, 11, 20, 0, 0);
const SUMMER = Date.UTC(2026, 6, 15, 20, 0, 0);

const to = (zone: string, now = NOW) => (text: string) => convertText(text, { targetZone: zone, now });
const la = to(LA);

describe('date and time together', () => {
  it('shifts weekday, day and zone, keeping the format', () => {
    expect(la('Friday, November 13, 2026, at 1:30 AM UTC')).toBe('Thursday, November 12, 2026, at 5:30 PM PST');
  });

  it('keeps surrounding text', () => {
    expect(la('Launch is Nov 13, 2026 1:30 AM UTC, see you there.')).toBe(
      'Launch is Nov 12, 2026 5:30 PM PST, see you there.',
    );
  });

  it('handles day-first dates, ordinals and 24-hour times', () => {
    expect(la('Fri 13th November 2026, 01:30 GMT')).toBe('Thu 12th November 2026, 17:30 PST');
    expect(la('1 January 2027 at 03:00 UTC')).toBe('31 December 2026 at 19:00 PST');
  });

  it('handles a date after the time', () => {
    expect(la('1:30 a.m. UTC on Friday, November 13')).toBe('5:30 p.m. PST on Thursday, November 12');
    expect(la('01:30 (UTC), 13 Nov 2026')).toBe('17:30 (PST), 12 Nov 2026');
  });

  it('uses the daylight name and offset in summer', () => {
    expect(la('July 4, 2026 at 6:00 PM UTC')).toBe('July 4, 2026 at 11:00 AM PDT');
  });

  it('converts ISO 8601 timestamps', () => {
    expect(la('2026-11-13T01:30:00Z')).toBe('2026-11-12T17:30:00-08:00');
    expect(la('2026-11-13T01:30:00.123+02:00')).toBe('2026-11-12T15:30:00.123-08:00');
    expect(la('2026-11-13 01:30 UTC')).toBe('2026-11-12 17:30 PST');
  });

  it('labels machine-style timestamps so callers can treat them differently', () => {
    const formats = (text: string) => findConversions(text, { targetZone: LA, now: NOW }).map((c) => c.format);
    expect(formats('2026-11-13T01:30:00Z and Nov 13, 2026 1:30 AM UTC')).toEqual(['iso', 'text']);
  });

  it('shifts a lone weekday', () => {
    expect(la('Friday at 1:30 AM UTC')).toBe('Thursday at 5:30 PM PST');
  });

  it('reads explicit offsets', () => {
    expect(la('Nov 13, 2026 10:00 UTC+2')).toBe('Nov 13, 2026 00:00 PST');
    expect(la('Nov 13, 2026 10:00 GMT-5:30')).toBe('Nov 13, 2026 07:30 PST');
  });
});

describe('time on its own', () => {
  it('marks a move to the previous day', () => {
    expect(la('Doors open at 1:30 AM UTC.')).toBe('Doors open at 5:30 PM PST (−1 day).');
    const [c] = findConversions('1:30 AM UTC', { targetZone: LA, now: NOW });
    expect(c).toMatchObject({ dayShift: -1, flags: ['time-only'], confidence: 'high' });
  });

  it('marks a move to the next day', () => {
    expect(to('Asia/Tokyo')('at 8 PM UTC')).toBe('at 5 AM GMT+9 (+1 day)');
  });

  it('adds no marker when the day is unchanged', () => {
    expect(la('at 20:00 UTC')).toBe('at 12:00 PST');
  });

  it('adds minutes when the target zone needs them', () => {
    expect(to('Asia/Kolkata')('5 PM UTC')).toBe('10:30 PM GMT+5:30');
  });

  it('keeps the marker outside parentheses', () => {
    expect(la('1:30 AM (UTC)')).toBe('5:30 PM (PST) (−1 day)');
  });
});

describe('zone interpretation', () => {
  it('treats generic names as regions', () => {
    expect(to('UTC')('Nov 13, 2026 9:00 AM ET')).toBe('Nov 13, 2026 2:00 PM UTC');
    expect(to('UTC', SUMMER)('July 15, 2026 9:00 AM Eastern Time')).toBe('July 15, 2026 1:00 PM UTC');
  });

  it('flags a standard-time abbreviation used in summer and offers both readings', () => {
    const text = 'July 15, 2026 3:00 PM EST';
    const [c] = findConversions(text, { targetZone: 'UTC', now: SUMMER });
    expect(c).toMatchObject({ converted: 'July 15, 2026 7:00 PM UTC', confidence: 'low', flags: ['season-mismatch'] });
    expect(c!.alternatives.map((a) => a.converted)).toEqual(['July 15, 2026 8:00 PM UTC']);

    const [literal] = findConversions(text, { targetZone: 'UTC', now: SUMMER, seasonMismatch: 'literal' });
    expect(literal!.converted).toBe('July 15, 2026 8:00 PM UTC');
    expect(literal!.alternatives.map((a) => a.converted)).toEqual(['July 15, 2026 7:00 PM UTC']);
  });

  it('does not flag an abbreviation used in the right season', () => {
    const [c] = findConversions('Nov 13, 2026 3:00 PM EST', { targetZone: 'UTC', now: NOW });
    expect(c).toMatchObject({ converted: 'Nov 13, 2026 8:00 PM UTC', confidence: 'high', flags: [] });
  });

  it('flags labels with several meanings', () => {
    const [c] = findConversions('Nov 13, 2026 9:00 AM CST', { targetZone: 'UTC', now: NOW });
    expect(c).toMatchObject({ converted: 'Nov 13, 2026 3:00 PM UTC', confidence: 'low', flags: ['ambiguous-zone'] });
    expect(c!.alternatives).toEqual([
      expect.objectContaining({ description: 'China Standard Time', converted: 'Nov 13, 2026 1:00 AM UTC' }),
    ]);
  });

  it('skips text already in the reader’s zone', () => {
    expect(la('Nov 13, 2026 5:30 PM PST')).toBe('Nov 13, 2026 5:30 PM PST');
  });
});

describe('zone-less times', () => {
  it('leaves them alone by default', () => {
    expect(la('The show starts at 7:00 PM on Friday.')).toBe('The show starts at 7:00 PM on Friday.');
  });

  it('uses a per-site default zone when given', () => {
    const text = 'The show starts at 7:00 PM on Friday, November 13.';
    const [c] = findConversions(text, { targetZone: LA, now: NOW, defaultZone: 'America/New_York' });
    expect(c).toMatchObject({ converted: '4:00 PM PST on Friday, November 13', flags: ['assumed-zone'] });
  });
});

describe('things left alone', () => {
  it.each([
    'Call between 1:30–3:00 PM UTC',
    'Open 1-3 PM UTC',
    'Open 9:00 AM UTC to 5:00 PM',
    'Score was 10:30-11:30 in the end',
    'Version 5 UTC',
    'November 13, 2026',
    'Feb 30, 2026 1:30 AM UTC',
    'at 25:00 UTC',
    'a 5 PM ESTimate',
  ])('%s', (text) => {
    expect(la(text)).toBe(text);
  });

  it('converts both ends of a range when each has a zone', () => {
    expect(la('1:30 PM UTC – 3:00 PM UTC')).toBe('5:30 AM PST – 7:00 AM PST');
  });
});

describe('zone table', () => {
  it.each(Object.entries(ZONE_TABLE).filter(([, e]) => e.region))(
    '%s matches its region for part of the year',
    (_abbr, entry) => {
      const offsets = [0, 3, 6, 9].map((month) => ianaOffsetAt(entry.region!, Date.UTC(2025, month, 15)));
      expect(offsets).toContain(entry.zone);
    },
  );
});
