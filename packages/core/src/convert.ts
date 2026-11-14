import type { Alternative, Conversion, ConvertOptions, Flag, ZoneRef } from './types';
import { fieldsAt, formatOffset, isValidZone, offsetAt, shortZoneName, toEpoch, type Fields } from './tz';
import { resolveZone, ZONE_PATTERN, type ZoneReading } from './zones';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const WD = '(?:Mon(?:day)?|Tue(?:s(?:day)?)?|Wed(?:nesday)?|Thu(?:rs?(?:day)?)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?)';
const MON =
  '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
const MER = '[AaPp](?:\\.[Mm]\\.|[Mm])';

const START = '(?<![A-Za-z\\d])';
const END = '(?![A-Za-z\\d])';
const DAY = '(?<day>\\d{1,2})(?<ord>st|nd|rd|th)?';
const YEAR_OPT = '(?:,?\\s+(?<year>\\d{4}))?';
const WD_OPT = `(?:(?<wd>${WD})\\.?,?\\s+)?`;
const LEFT_JOIN = '(?:,?\\s+(?:at\\s+|@\\s*)?|\\s*[-–—|]\\s+)';
const RIGHT_JOIN = '^(?:,?\\s+(?:on\\s+)?|\\s*[-–—|]\\s+)';

/** A time, optionally followed by a zone. Every candidate conversion starts here. */
const ANCHOR = new RegExp(
  `(?<![\\d:.])(?<hour>\\d{1,2})(?!\\d)(?::(?<minute>\\d{2})(?!\\d)(?::(?<second>\\d{2})(?:[.,]\\d{1,9})?)?)?` +
    `(?:\\s?(?<mer>${MER})(?![A-Za-z]))?` +
    `(?:(?<isoz>Z|[+\\-−]\\d{2}(?::?\\d{2})?)(?![\\dA-Za-z:])|\\s?\\(?(?<zone>${ZONE_PATTERN})(?![A-Za-z]))?`,
  'dg',
);

/** Date forms that may sit directly before the time. */
const LEFT_DATES = [
  new RegExp(`${START}${WD_OPT}(?<mon>${MON})\\.?\\s+${DAY}${YEAR_OPT}${LEFT_JOIN}$`, 'd'),
  new RegExp(`${START}${WD_OPT}${DAY}\\s+(?:of\\s+)?(?<mon>${MON})\\.?${YEAR_OPT}${LEFT_JOIN}$`, 'd'),
  new RegExp(`(?<![\\d-])(?<year>\\d{4})-(?<monnum>\\d{2})-(?<day>\\d{2})(?<isosep>T|\\s)$`, 'd'),
  new RegExp(`${START}(?<wd>${WD})\\.?${LEFT_JOIN}$`, 'd'),
];

/** Date forms that may sit directly after the time and zone. */
const RIGHT_DATES = [
  new RegExp(`${RIGHT_JOIN}${WD_OPT}(?<mon>${MON})\\.?\\s+${DAY}${YEAR_OPT}${END}`, 'd'),
  new RegExp(`${RIGHT_JOIN}${WD_OPT}${DAY}\\s+(?:of\\s+)?(?<mon>${MON})\\.?${YEAR_OPT}${END}`, 'd'),
  new RegExp(`${RIGHT_JOIN}(?<wd>${WD})${END}`, 'd'),
];

/** Words and marks that join the ends of a range ("1–3 PM", "9 till 5"). */
const RANGE_WORD = '(?:[-–—−~]|to|until|till|til|through|thru)';
/** Words and marks that join the items of a list ("1:30 or 3:00", "1:30/3:00"). */
const LIST_WORD = '(?:and|or|&|/|,)';

/**
 * Text before a match that makes it the later end of a range or list whose
 * earlier end has no zone of its own ("1:30–3:00 PM UTC", "9 till 5 PM ET").
 */
const RANGE_BEFORE = new RegExp(
  `(?:(?:\\d{1,2}:\\d{2}(?::\\d{2})?|${MER})\\s*(?:${RANGE_WORD}|${LIST_WORD})\\s*` +
    `|(?<![\\d:.])\\d{1,2}(?:\\s*[-–—−~/&]\\s*|\\s+(?:to|until|till|til|through|thru|and|or)\\s+))$`,
);
/** Text after a match that makes it the earlier end of a range or list. */
const RANGE_AFTER = new RegExp(
  `^\\s*(?:${RANGE_WORD}\\s*(?=\\d)|${LIST_WORD}\\s*(?=\\d{1,2}(?::\\d{2}|\\s?${MER})))`,
);
/** The text between two recognised times that makes them one range or list. */
const GAP_RANGE = new RegExp(`^\\s*${RANGE_WORD}\\s*$`);
const GAP_LIST = new RegExp(`^\\s*(?:,\\s*)?${LIST_WORD}\\s*$`);
const GAP_MAX = 16;

/** A date that follows the time but is directly followed by another time belongs to that time. */
const TIME_NEXT = new RegExp(`^\\s*,?\\s*(?:at\\s+|@\\s*)?\\d{1,2}(?::\\d{2}|\\s?${MER})`);

/*
 * Dates and day names the engine does not read. A time directly next to one is
 * left alone: converting it as if it were today would give the wrong date and,
 * near a daylight-saving change, the wrong offset.
 */
const UPPER = (src: string) => src.replace(/[a-z]+/g, (w) => w.toUpperCase());
const MON_ANY_CASE_WITH_DAY =
  `(?<![A-Za-z])${MON}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:\\s*[-–—]\\s*\\d{1,2}(?:st|nd|rd|th)?)?(?:,?\\s+\\d{4})?` +
  `|(?<!\\d)\\d{1,2}(?:st|nd|rd|th)?(?:\\s*[-–—]\\s*\\d{1,2}(?:st|nd|rd|th)?)?\\s+(?:of\\s+)?${MON}\\.?(?:,?\\s+\\d{4})?`;
const UNREAD_DATE_I = [
  // Numeric dates: 07/04/2026, 4.7.2026, 2026-07-04, 7/4.
  '\\d{1,4}[./-]\\d{1,2}[./-]\\d{1,4}',
  '(?<![\\d:])\\d{1,2}/\\d{1,2}(?![\\d:])',
  // ISO week and ordinal dates: 2026-W46-5, 2026W465, 2026-315.
  '\\d{4}-?W\\d{2}(?:-?\\d)?',
  '(?<!\\d)\\d{4}-\\d{3}(?!\\d)',
  // A year on its own.
  '(?<![\\d.:/-])(?:1[89]|2\\d)\\d{2}(?![\\d:])',
  // A month in any letter case, with a day: "july 4", "JULY 4, 2026", "4 JULY".
  MON_ANY_CASE_WITH_DAY,
  // Full day names (also plural: "on Mondays") and month names in any case, and relative days.
  '(?<![A-Za-z])(?:(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?|january|february|april|june|july|august|september|october|november|december|tomorrow|yesterday)(?![A-Za-z])',
].join('|');
/** Capitalised or all-caps day and month names (including short forms), alone. */
const UNREAD_DATE_CASED = `(?<![A-Za-z])(?:${WD}|${MON}|${UPPER(WD)}|${UPPER(MON)})(?![A-Za-z])\\.?`;
const JOIN_WORDS = '(?:at|on|from|in|by|of|to|through|thru|till|until|and|or)';
const LEFT_JOIN_ANY = `[\\s,;:()\\[\\]·•]*(?:${JOIN_WORDS}\\s+|[@|&/]\\s*|[-–—]\\s*)?`;
const UNREAD_BEFORE = [
  new RegExp(`(?:${UNREAD_DATE_I})(?:${LEFT_JOIN_ANY}|T)$`, 'i'),
  new RegExp(`(?:${UNREAD_DATE_CASED})${LEFT_JOIN_ANY}$`),
];
const UNREAD_AFTER = [
  new RegExp(`^${LEFT_JOIN_ANY}(?:${UNREAD_DATE_I})`, 'i'),
  new RegExp(`^${LEFT_JOIN_ANY}(?:${UNREAD_DATE_CASED})`),
];
const CONTEXT = 40;

/*
 * A zone written in words that the engine does not resolve. A zone-less time
 * next to one is not given the site's default zone.
 */
const ZONE_WORD = '(?:Pacific|Mountain|Central|Eastern|Atlantic|Alaska|Alaskan|Hawaii|Hawaiian|Arizona|Newfoundland)';
const PLACE_TIME = "(?:[A-Z][A-Za-z.'’-]*\\s+){1,3}[Tt]ime(?![A-Za-z])";
const ZONE_WORDS_AFTER = [
  new RegExp(`^\\s*\\(?\\s*${ZONE_WORD}(?![A-Za-z])`),
  // "7 PM London time"; also "7 PM local time", which names the event's zone, not the site's.
  new RegExp(`^\\s*,?\\s*(?:${PLACE_TIME}|local\\s+time(?![A-Za-z]))`),
  new RegExp(`^\\s*\\(\\s*(?!(?:${WD}|${MON})(?![A-Za-z]))[A-Z][A-Za-z]`),
];
const ZONE_WORDS_BEFORE = [
  // Not "<Word> time" before the time: "Start Time: 7 PM" is a label, not a zone.
  new RegExp(`(?<![A-Za-z])(?:${ZONE_WORD}|${ZONE_PATTERN})\\s*[:,]?\\s*$`),
  new RegExp(`\\(\\s*[A-Z][^()]*\\)\\s*[:,]?\\s*$`),
];

/** A second zone label after a slash ("8 PM ET/PT"): the time is given for several zones. */
const SLASH_AFTER = /^\s?\/\s?[A-Za-z0-9]/;
/** A sign and digits after a bare UTC/GMT that were not read as an offset ("UTC - 5"). */
const LOOSE_OFFSET_AFTER = /^\s*[+\-−]\s*\d/;

const LEFT_WINDOW = 80;
const DAY_MS = 86_400_000;

type PartType = 'wd' | 'mon' | 'monnum' | 'day' | 'year' | 'hour' | 'minute' | 'second' | 'mer' | 'zone' | 'isoz';

interface Part {
  type: PartType;
  start: number;
  end: number;
  text: string;
}

function partsOf(m: RegExpExecArray, base: number): Part[] {
  const out: Part[] = [];
  const groups = m.indices?.groups ?? {};
  for (const type of ['wd', 'mon', 'monnum', 'day', 'year', 'hour', 'minute', 'second', 'mer', 'zone', 'isoz'] as const) {
    const span = groups[type];
    if (!span) continue;
    let end = span[1];
    if (type === 'day' && groups.ord) end = groups.ord[1];
    out.push({ type, start: base + span[0], end: base + end, text: m.groups![type]! });
  }
  return out;
}

function ordinal(n: number): string {
  if (n % 100 >= 11 && n % 100 <= 13) return 'th';
  return ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
}

const pad2 = (n: number) => String(n).padStart(2, '0');

function daysBetween(a: Fields, b: Fields): number {
  return Math.round((Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / DAY_MS);
}

function addDays(f: Fields, days: number): Fields & { weekday: number } {
  const d = new Date(Date.UTC(f.year, f.month - 1, f.day + days));
  return { ...f, year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), weekday: d.getUTCDay() };
}

const weekdayIndex = (text: string) => WEEKDAYS.findIndex((w) => w.startsWith(text.slice(0, 3)));
const secondsOfDay = (f: Fields) => f.hour * 3600 + f.minute * 60 + f.second;

interface Candidate {
  text: string;
  start: number;
  end: number;
  /** Span of the time and its zone, without any date before or after it. */
  timeStart: number;
  timeEnd: number;
  parts: Part[];
  zoneToken: string | undefined;
  hasDate: boolean;
  hasWeekday: boolean;
  /** The candidate must be left alone; so must every candidate it is linked to. */
  drop: boolean;
  /** How this candidate joins the one before it, when it is a later end of a range or item of a list. */
  link?: 'range' | 'list';
}

/**
 * Re-render the matched text for `epochMs` in the target zone, keeping its format.
 * `markerDate` is the source date a day marker is measured from, or null for no marker.
 */
function render(
  c: Candidate,
  epochMs: number,
  markerDate: Fields | null,
  targetZone: string,
): { text: string; dayShift: number } {
  const target: ZoneRef = { kind: 'iana', id: targetZone };
  const t = fieldsAt(target, epochMs);
  const has = (type: PartType) => c.parts.some((p) => p.type === type);
  const iso = has('monnum');
  const lastTimePart = [...c.parts].reverse().find((p) => ['hour', 'minute', 'second', 'mer'].includes(p.type));

  const renderPart = (p: Part): string => {
    switch (p.type) {
      case 'wd':
        return p.text.length >= 6 ? WEEKDAYS[t.weekday]! : WEEKDAYS[t.weekday]!.slice(0, 3);
      case 'mon':
        return MONTHS.includes(p.text) ? MONTHS[t.month - 1]! : MONTHS[t.month - 1]!.slice(0, 3);
      case 'monnum':
        return pad2(t.month);
      case 'day': {
        const digits = /^\d+/.exec(p.text)![0];
        const day = iso || (digits.length === 2 && digits[0] === '0') ? pad2(t.day) : String(t.day);
        return /\D$/.test(c.text.slice(p.start, p.end)) ? day + ordinal(t.day) : day;
      }
      case 'year':
        return String(t.year);
      case 'hour': {
        const twelve = has('mer');
        const value = twelve ? t.hour % 12 || 12 : t.hour;
        // Mirror the original: "01" and 24-hour "13" stay two digits, "1" stays one.
        const padded = p.text.length === 2 && (p.text[0] === '0' || !twelve);
        const hour = padded ? pad2(value) : String(value);
        return !has('minute') && t.minute !== 0 ? `${hour}:${pad2(t.minute)}` : hour;
      }
      case 'minute':
        return pad2(t.minute);
      case 'second':
        return pad2(t.second);
      case 'mer': {
        const letter = t.hour < 12 ? 'a' : 'p';
        const dotted = p.text.includes('.');
        const s = dotted ? `${letter}.m.` : `${letter}m`;
        return p.text[0] === p.text[0]!.toUpperCase() ? s.toUpperCase() : s;
      }
      case 'zone':
        return shortZoneName(targetZone, epochMs);
      case 'isoz': {
        // "10:00Z" without an ISO date: a numeric offset glued to the time
        // ("02:00-08:00") would read as a range, so name the zone instead.
        if (p.text === 'Z' && !iso) return ` ${shortZoneName(targetZone, epochMs)}`;
        const offset = offsetAt(target, epochMs);
        if (offset === 0 && p.text === 'Z') return 'Z';
        return formatOffset(offset, p.text === 'Z' || p.text.includes(':'));
      }
    }
  };

  let out = '';
  let pos = c.start;
  for (const p of c.parts) {
    out += c.text.slice(pos, p.start) + renderPart(p);
    // Zone-less source text: name the zone the result is in.
    if (p === lastTimePart && !c.zoneToken) out += ` ${shortZoneName(targetZone, epochMs)}`;
    pos = p.end;
  }
  out += c.text.slice(pos, c.end);

  let dayShift = 0;
  if (markerDate) {
    dayShift = daysBetween(markerDate, t);
    if (dayShift !== 0) {
      const marker = ` (${dayShift > 0 ? '+' : '−'}${Math.abs(dayShift)} day${Math.abs(dayShift) === 1 ? '' : 's'})`;
      out += marker;
    }
  }
  return { text: out, dayShift };
}

/** Source wall-clock fields for a candidate, given "today" in the source zone. */
function sourceFields(c: Candidate, today: Fields & { weekday: number }): Fields | null {
  const get = (type: PartType) => c.parts.find((p) => p.type === type)?.text;

  let hour = Number(get('hour'));
  const mer = get('mer');
  if (mer) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (mer[0]!.toLowerCase() === 'p' ? 12 : 0);
  } else if (hour > 23) return null;
  const minute = Number(get('minute') ?? 0);
  const second = Number(get('second') ?? 0);
  if (minute > 59 || second > 59) return null;

  let { year, month, day } = today;
  const monthName = get('mon');
  const dayText = get('day');
  const wd = get('wd');
  const valid = (y: number, m: number, d: number) => {
    const check = new Date(Date.UTC(y, m - 1, d));
    return m >= 1 && check.getUTCMonth() === m - 1 && check.getUTCDate() === d;
  };
  const weekdayOf = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).getUTCDay();

  if (dayText) {
    day = parseInt(dayText, 10);
    month = monthName
      ? MONTHS.findIndex((m) => m.startsWith(monthName.slice(0, 3))) + 1
      : Number(get('monnum'));
    const yearText = get('year');
    if (yearText) {
      year = Number(yearText);
      if (!valid(year, month, day)) return null;
      // A weekday that contradicts the date: one of them is wrong, and we cannot tell which.
      if (wd && weekdayOf(year, month, day) !== weekdayIndex(wd)) return null;
    } else if (wd) {
      // "Sat, Jan 9" in November: the year, nearest to today, in which Jan 9 is a Saturday.
      const found = [today.year, today.year + 1, today.year - 1].find(
        (y) => valid(y, month, day) && weekdayOf(y, month, day) === weekdayIndex(wd),
      );
      if (found === undefined) return null;
      year = found;
    } else {
      year = today.year;
      if (!valid(year, month, day)) return null;
    }
  } else if (wd) {
    // A weekday on its own: the next such day, counting today.
    const ahead = (weekdayIndex(wd) - today.weekday + 7) % 7;
    ({ year, month, day } = addDays(today, ahead));
  }
  return { year, month, day, hour, minute, second };
}

function collectCandidates(text: string, allowZoneless: boolean): Candidate[] {
  const out: Candidate[] = [];
  let prevEnd = 0;
  for (const m of text.matchAll(ANCHOR) as IterableIterator<RegExpExecArray>) {
    const g = m.groups!;
    if (!g.minute && !g.mer) continue;
    if (!g.zone && !g.isoz && !(allowZoneless && g.mer)) continue;
    const timeStart = m.index;
    const timeEnd = timeStart + m[0].length;
    let start = timeStart;
    let end = timeEnd;
    if (start < prevEnd) continue;
    const parts = partsOf(m, 0);

    // Date before the time.
    const leftBase = Math.max(prevEnd, start - LEFT_WINDOW);
    const leftText = text.slice(leftBase, start);
    let dateMatch: RegExpExecArray | null = null;
    for (const re of LEFT_DATES) {
      dateMatch = re.exec(leftText);
      if (dateMatch) break;
    }
    if (dateMatch) {
      start = leftBase + dateMatch.index;
      parts.unshift(...partsOf(dateMatch, leftBase));
    }

    // A numeric offset glued to the time ("10:30-11:30" is far more often a
    // range) is only trusted in a full ISO timestamp.
    if (g.isoz && g.isoz !== 'Z') {
      const isoDate = dateMatch?.groups?.monnum;
      if (!isoDate || !(dateMatch!.groups!.isosep === 'T' || g.second)) continue;
    }

    // Date after the time, unless another time follows it ("1 PM UTC – Fri 2 AM UTC").
    if (!dateMatch) {
      const rightText = text.slice(end, end + LEFT_WINDOW);
      const closing = g.zone && text[end] === ')' && m[0].includes('(') ? 1 : 0;
      for (const re of RIGHT_DATES) {
        const r = re.exec(rightText.slice(closing));
        if (r) {
          if (TIME_NEXT.test(rightText.slice(closing + r[0].length))) break;
          dateMatch = r;
          parts.push(...partsOf(r, end + closing));
          end = end + closing + r[0].length;
          break;
        }
      }
    }

    parts.sort((a, b) => a.start - b.start);
    // Pull a closing parenthesis into the match so a day marker lands outside it.
    if (g.zone && m[0].includes('(') && text[end] === ')' && parts.at(-1)!.type === 'zone') end += 1;

    out.push({
      text,
      start,
      end,
      timeStart,
      timeEnd,
      parts,
      zoneToken: g.zone ?? g.isoz,
      hasDate: parts.some((p) => p.type === 'day'),
      hasWeekday: parts.some((p) => p.type === 'wd'),
      drop: false,
    });
    prevEnd = end;
  }
  return out;
}

/**
 * Join candidates into ranges and lists, and mark those that must be left
 * alone. A range or list is converted whole or not at all.
 */
function applyGuards(text: string, cands: Candidate[]): void {
  for (let i = 1; i < cands.length; i++) {
    const prev = cands[i - 1]!;
    const c = cands[i]!;
    const gap = text.slice(prev.end, c.start);
    if (gap.length > GAP_MAX) continue;
    if (GAP_RANGE.test(gap)) c.link = 'range';
    else if (GAP_LIST.test(gap)) {
      // "between 1 PM UTC and 3 PM UTC" is a range.
      c.link = /\bbetween\s+$/i.test(text.slice(Math.max(0, prev.start - 10), prev.start)) ? 'range' : 'list';
    }
  }

  for (let i = 0; i < cands.length; i++) {
    const c = cands[i]!;
    const prev = cands[i - 1];
    const next = cands[i + 1];
    const nextLinked = next?.link !== undefined;
    const before = text.slice(Math.max(prev?.end ?? 0, c.start - CONTEXT), c.start);
    const after = text.slice(c.end, Math.min(c.end + CONTEXT, next?.start ?? Infinity));
    const afterTime = text.slice(c.timeEnd, Math.min(c.timeEnd + CONTEXT, next?.start ?? Infinity));
    const beforeTime = text.slice(Math.max(prev?.end ?? 0, c.timeStart - CONTEXT), c.timeStart);
    const drop = () => (c.drop = true);

    // Ranges and lists: every end needs its own zone ("7 PM–9 PM" under a
    // site default, "1:30 or 3:00 PM UTC" are left alone).
    if (c.link) {
      if (!c.zoneToken || !prev!.zoneToken) drop();
    } else if (RANGE_BEFORE.test(text.slice(Math.max(prev?.end ?? 0, c.start - 24), c.start))) drop();
    if (!nextLinked && RANGE_AFTER.test(after)) drop();

    // "8 PM ET/PT": the time is given for several zones.
    if (c.zoneToken && !nextLinked && SLASH_AFTER.test(afterTime)) drop();

    // "14:00 UTC - 5": an offset we did not read. Never convert without it.
    if (c.zoneToken && /^(?:UTC|GMT)$/.test(c.zoneToken) && !nextLinked && LOOSE_OFFSET_AFTER.test(afterTime)) drop();

    // A zone-less time next to a zone written in words is not given the site default.
    if (!c.zoneToken) {
      if (ZONE_WORDS_AFTER.some((re) => re.test(afterTime))) drop();
      if (ZONE_WORDS_BEFORE.some((re) => re.test(beforeTime))) drop();
    }

    // A date or day name we do not read, directly next to the time ("07/04/2026
    // 6:00 PM UTC", "Mon–Fri 1 AM UTC", "1 AM UTC, Mon–Fri").
    if (UNREAD_BEFORE.some((re) => re.test(before)) || UNREAD_AFTER.some((re) => re.test(after))) drop();
  }

  // A range or list is converted whole or not at all.
  for (let i = 0; i < cands.length; ) {
    let j = i + 1;
    while (j < cands.length && cands[j]!.link) j++;
    if (cands.slice(i, j).some((c) => c.drop)) for (let k = i; k < j; k++) cands[k]!.drop = true;
    i = j;
  }
}

interface Context {
  targetZone: string;
  target: ZoneRef;
  now: number;
  defaultZone: string | undefined;
  seasonMismatch: 'regional' | 'literal';
}

/** What a later end of a range or list needs from the end before it. */
interface Previous {
  epochMs: number;
  /** Source wall-clock fields the previous end was read as. */
  fields: Fields;
  zoneToken: string | undefined;
  /** The text of the group's first end carried a date or weekday. */
  dated: boolean;
  /** The text of the group's first end carried a date. */
  hasDate: boolean;
  /** Source date day markers are measured from, or null when the group is dated. */
  markerDate: Fields | null;
}

type Reading = { reading: ZoneReading; fields: Fields; epochMs: number };

/**
 * Convert one candidate. Returns null when it cannot be read with confidence;
 * otherwise the conversion (absent when the text is already in the reader's
 * zone) and what a following end of the same range or list needs.
 */
function convertOne(
  c: Candidate,
  ctx: Context,
  prev: Previous | undefined,
): { conversion?: Conversion; state: Previous } | null {
  const flags: Flag[] = [];
  let primary: ZoneReading;
  let region: string | undefined;
  let otherMeanings: ZoneReading[] = [];

  if (c.zoneToken) {
    const resolved = resolveZone(c.zoneToken);
    if (!resolved) return null;
    ({ primary, region } = resolved);
    otherMeanings = resolved.alternatives;
  } else {
    primary = { ref: { kind: 'iana', id: ctx.defaultZone! }, description: `${ctx.defaultZone} (site default)` };
    flags.push('assumed-zone');
  }

  const ownDate = c.hasDate || c.hasWeekday;
  // "1:30 PM UTC – 3:00 PM UTC on Friday": the first end has no date of its own.
  if (prev && ownDate && !prev.dated) return null;
  // A later end without a date takes the date of the end before it.
  const inherit = prev !== undefined && !ownDate;
  let dayOffset = 0;

  // Same label: the date as written for the end before. Another label: the
  // date the end before falls on in this end's zone.
  const sameLabel = inherit && c.zoneToken !== undefined && c.zoneToken === prev.zoneToken;
  const read = (reading: ZoneReading): Reading | null => {
    const base = !inherit ? null : sameLabel ? prev.fields : fieldsAt(reading.ref, prev.epochMs);
    const today = base ? addDays(base, dayOffset) : fieldsAt(reading.ref, ctx.now);
    const fields = sourceFields(c, today);
    return fields ? { reading, fields, epochMs: toEpoch(reading.ref, fields) } : null;
  };

  // The end of a range is the first such time after its start ("11:30 PM – 1:30 AM UTC").
  if (inherit && c.link === 'range') {
    const first = read(primary);
    if (!first) return null;
    if (sameLabel) {
      const wall = secondsOfDay(first.fields);
      if (wall === secondsOfDay(prev.fields)) return null;
      if (wall < secondsOfDay(prev.fields)) dayOffset = 1;
    } else if (first.epochMs <= prev.epochMs) dayOffset = 1;
  }

  let chosen = read(primary);
  if (!chosen) return null;
  const others: Reading[] = [];

  // "EST" on a date its region observes EDT: offer both readings.
  if (region && primary.ref.kind === 'fixed' && offsetAt({ kind: 'iana', id: region }, chosen.epochMs) !== primary.ref.offsetMinutes) {
    const regional = read({ ref: { kind: 'iana', id: region }, description: `local time in ${region}` });
    if (regional && regional.epochMs !== chosen.epochMs) {
      flags.push('season-mismatch');
      if (ctx.seasonMismatch === 'regional') {
        others.push({ ...chosen, reading: { ...primary, description: `${primary.description}, taken literally` } });
        chosen = regional;
      } else {
        others.push(regional);
      }
    }
  }

  for (const meaning of otherMeanings) {
    const alt = read(meaning);
    if (alt && alt.epochMs !== chosen.epochMs) {
      if (!flags.includes('ambiguous-zone')) flags.push('ambiguous-zone');
      others.push(alt);
    }
  }

  // A range must run forwards, and an end that took its start's date must fall within a day of it.
  if (prev && c.link === 'range') {
    if (chosen.epochMs <= prev.epochMs) return null;
    if (inherit && chosen.epochMs - prev.epochMs >= DAY_MS) return null;
  }

  const state: Previous = inherit
    ? { ...prev, epochMs: chosen.epochMs, fields: chosen.fields, zoneToken: c.zoneToken }
    : {
        epochMs: chosen.epochMs,
        fields: chosen.fields,
        zoneToken: c.zoneToken,
        dated: ownDate,
        hasDate: c.hasDate,
        markerDate: ownDate ? null : chosen.fields,
      };

  // Already in the reader's zone: nothing to convert.
  if (offsetAt(chosen.reading.ref, chosen.epochMs) === offsetAt(ctx.target, chosen.epochMs)) return { state };

  if (!state.hasDate) flags.push('time-only');
  const markerFor = (r: Reading) => (state.markerDate === null ? null : inherit ? state.markerDate : r.fields);
  const rendered = render(c, chosen.epochMs, markerFor(chosen), ctx.targetZone);
  const alternatives: Alternative[] = others.map((o) => ({
    description: o.reading.description,
    epochMs: o.epochMs,
    converted: render(c, o.epochMs, markerFor(o), ctx.targetZone).text,
  }));

  return {
    state,
    conversion: {
      index: c.start,
      length: c.end - c.start,
      original: c.text.slice(c.start, c.end),
      converted: rendered.text,
      epochMs: chosen.epochMs,
      sourceDescription: chosen.reading.description,
      confidence: flags.includes('ambiguous-zone') || flags.includes('season-mismatch') ? 'low' : 'high',
      flags,
      alternatives,
      format: c.parts.some((p) => p.type === 'monnum') ? 'iso' : 'text',
      dayShift: rendered.dayShift,
    },
  };
}

/**
 * Find every date/time in `text` that can be converted to the target zone.
 * Returns no conversions when `targetZone` is not a valid IANA zone.
 */
export function findConversions(text: string, options: ConvertOptions = {}): Conversion[] {
  const targetZone = options.targetZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (!isValidZone(targetZone)) return [];
  const ctx: Context = {
    targetZone,
    target: { kind: 'iana', id: targetZone },
    now: options.now ?? Date.now(),
    defaultZone: options.defaultZone && isValidZone(options.defaultZone) ? options.defaultZone : undefined,
    seasonMismatch: options.seasonMismatch ?? 'regional',
  };

  const cands = collectCandidates(text, ctx.defaultZone !== undefined);
  applyGuards(text, cands);

  const results: Conversion[] = [];
  for (let i = 0; i < cands.length; ) {
    let j = i + 1;
    while (j < cands.length && cands[j]!.link) j++;
    const group = cands.slice(i, j);
    i = j;
    if (group[0]!.drop) continue;

    // Every end must be readable, or none is converted.
    const converted: Conversion[] = [];
    let prev: Previous | undefined;
    let ok = true;
    for (const c of group) {
      const r = convertOne(c, ctx, prev);
      if (!r) {
        ok = false;
        break;
      }
      if (r.conversion) converted.push(r.conversion);
      prev = r.state;
    }
    if (ok) results.push(...converted);
  }
  return results;
}

/** Convenience: apply every conversion and return the rewritten text. */
export function convertText(text: string, options: ConvertOptions = {}): string {
  let out = '';
  let pos = 0;
  for (const c of findConversions(text, options)) {
    out += text.slice(pos, c.index) + c.converted;
    pos = c.index + c.length;
  }
  return out + text.slice(pos);
}
