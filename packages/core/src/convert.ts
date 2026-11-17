import type { Alternative, Conversion, ConvertOptions, Flag, ZoneRef } from './types';
import { fieldsAt, formatOffset, isValidZone, offsetAt, shortZoneName, toEpoch, type Fields } from './tz';
import { resolveZone, ZONE_PATTERN, ZONE_PATTERN_NO_OFFSET, type ResolvedZone, type ZoneReading } from './zones';

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
// Also the separators of event listings: "Thu, Nov 12 · 7:00 PM", "Nov 12: 7:00 PM".
const LEFT_JOIN = '(?:,?\\s+(?:at\\s+|@\\s*)?|\\s*[-–—|]\\s+|\\s*[·•]\\s*|:\\s+)';
const RIGHT_JOIN = '^(?:,?\\s+(?:on\\s+)?|\\s*[-–—|]\\s+)';

/**
 * A time, optionally followed by a zone. Every candidate conversion starts
 * here. Meridiem letters followed by a digit ("PM2.5") are not a meridiem.
 */
const anchorSource = (zone: string, isoOffset = true) =>
  `(?<![\\d:.])(?<hour>\\d{1,2})(?!\\d)(?::(?<minute>\\d{2})(?!\\d)(?::(?<second>\\d{2})(?:[.,]\\d{1,9})?)?)?` +
  `(?:\\s?(?<mer>${MER})(?![A-Za-z\\d]))?` +
  `(?:${isoOffset ? '(?<isoz>Z|[+\\-−]\\d{2}(?::?\\d{2})?)(?![\\dA-Za-z:])|' : ''}\\s?\\(?(?<zone>${zone})(?![A-Za-z]))?`;
const ANCHOR = anchorSource(ZONE_PATTERN);
/** The same, reading "GMT-10:00 GMT" as "GMT" followed by a range dash. */
const ANCHOR_NO_OFFSET = anchorSource(ZONE_PATTERN_NO_OFFSET);
/** The same without a glued numeric offset: "10:30-11:30" outside an ISO timestamp. */
const ANCHOR_NO_ISO = anchorSource(ZONE_PATTERN, false);

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

/**
 * Words and marks that join the ends of a range ("1–3 PM", "9 till 5"). A plus
 * sign is never a range dash: after UTC/GMT it is an offset. A Unicode minus
 * is one when a time follows it ("2 PM UTC −3 PM UTC"); "UTC −5" is an offset.
 */
const RANGE_WORD = '(?:[-–—−~]|to|until|till|til|through|thru)';
/**
 * The separators of a range whose ends share a zone, meridiem or date
 * ("1:30–3:00 PM UTC", "9:00 AM UTC to 5:00 PM"). Ranges whose ends each
 * carry a zone may also use the other range words.
 */
const SHARED_GAP = /^\s*(?:[-–—−]|to|until)\s*$/;
/** After a time with no minutes or meridiem: it can only be the start of such a range ("1-3 PM"). */
const HOUR_START = /^\s*(?:[-–—−]|to\s|until\s)\s*\d/;
/** Before a number: a month name, so the number is a day ("Nov 12–14"). */
const MONTH_BEFORE = new RegExp(`(?<![A-Za-z])${MON}\\.?\\s*$`, 'i');
/**
 * After the end of a range whose zone is on the first end only: the end
 * carries a label of its own ("5:00 PM local", "5 PM BRT"), so the first
 * end's zone may not apply to it.
 */
const OWN_LABEL_AFTER = /^\s*\(?\s*(?:local|your\s+time|[A-Z]{2,5})(?![A-Za-z])/;
/** At most this much time between the ends of a range whose end was moved to the next day. */
const OVERNIGHT_MAX = 12 * 3_600_000;
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
/**
 * "noon to 9 PM ET", "noon UTC – 3 PM UTC", "9 PM ET – midnight": a range end
 * the engine does not read as a time. Words in any case; a zone label between
 * the word and the separator is matched case-sensitively, like everywhere else.
 */
const anyCase = (src: string) => src.replace(/[a-z]/g, (ch) => `[${ch}${ch.toUpperCase()}]`);
const NOON = anyCase('(?:noon|midnight|midday)');
const NOON_SEPARATOR = `(?:${anyCase(RANGE_WORD)}|${anyCase(LIST_WORD)})`;
const NOON_BEFORE = new RegExp(
  `(?<![A-Za-z])${NOON}(?:\\s*\\(?\\s*(?:${ZONE_PATTERN})\\s*\\)?)?\\s*${NOON_SEPARATOR}\\s*$`,
);
const NOON_AFTER = new RegExp(`^\\s*${NOON_SEPARATOR}\\s*${NOON}(?![A-Za-z])`);
/** A sign between a bare UTC/GMT and the next time ("2 PM UTC −3 PM UTC"). */
const SIGN_BEFORE = /(?:UTC|GMT)\s*[+\-−]\s*$/;
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
const DATE_PARTS = new Set<PartType>(['wd', 'mon', 'monnum', 'day', 'year']);
const partOf = (c: Candidate, type: PartType) => c.parts.find((p) => p.type === type);

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
  /**
   * No zone, and not convertible on its own (no meridiem or no site default):
   * kept only as an end of a range that shares a zone ("1:30" in "1:30–3:00 PM UTC").
   */
  bare: boolean;
  /** The candidate must be left alone; so must every candidate it is linked to. */
  drop: boolean;
  /** How this candidate joins the one before it, when it is a later end of a range or item of a list. */
  link?: 'range' | 'list';
  /** On the start of a range converted as one unit: where its zone comes from. */
  unit?: Unit;
}

/**
 * A range converted as one unit, by where its zone is written: on each end
 * with the same label ("11 PM UTC – 1 AM UTC"), on the first end only
 * ("9:00 AM UTC to 5:00 PM"), after the end ("1:30–3:00 PM UTC"), or nowhere,
 * under a site default ("7 PM–9 PM").
 */
type Unit = 'each' | 'first' | 'last' | 'default';

const dayMarker = (days: number) =>
  ` (${days > 0 ? '+' : '−'}${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'})`;

/**
 * Re-render the text of `c` between `from` and `to` for `epochMs` in the target
 * zone, keeping its format. `twelve`: the hour is on a 12-hour clock.
 * `afterTime` is inserted after the last part of the time itself.
 */
function renderSpan(
  c: Candidate,
  from: number,
  to: number,
  epochMs: number,
  targetZone: string,
  twelve: boolean,
  afterTime = '',
): string {
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
  let pos = from;
  for (const p of c.parts) {
    if (p.start < from || p.end > to) continue;
    out += c.text.slice(pos, p.start) + renderPart(p);
    if (p === lastTimePart) out += afterTime;
    pos = p.end;
  }
  return out + c.text.slice(pos, to);
}

/**
 * Re-render a single time for `epochMs` in the target zone, keeping its format.
 * `markerDate` is the source date a day marker is measured from, or null for no marker.
 */
function render(
  c: Candidate,
  epochMs: number,
  markerDate: Fields | null,
  targetZone: string,
): { text: string; dayShift: number } {
  // Zone-less source text: name the zone the result is in.
  const zoneName = c.zoneToken ? '' : ` ${shortZoneName(targetZone, epochMs)}`;
  let text = renderSpan(c, c.start, c.end, epochMs, targetZone, partOf(c, 'mer') !== undefined, zoneName);
  let dayShift = 0;
  if (markerDate) {
    dayShift = daysBetween(markerDate, fieldsAt({ kind: 'iana', id: targetZone }, epochMs));
    if (dayShift !== 0) text += dayMarker(dayShift);
  }
  return { text, dayShift };
}

/**
 * Source wall-clock fields for a candidate, given "today" in the source zone.
 * `mer` stands in for a meridiem the candidate does not write itself.
 */
function sourceFields(c: Candidate, today: Fields & { weekday: number }, mer = partOf(c, 'mer')?.text): Fields | null {
  const get = (type: PartType) => c.parts.find((p) => p.type === type)?.text;

  let hour = Number(get('hour'));
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

const primaryOffset = (z: ResolvedZone) => (z.primary.ref.kind === 'fixed' ? z.primary.ref.offsetMinutes : undefined);

/** Offsets a zone label can have, at the instants given. */
function labelOffsets(label: ResolvedZone, instants: number[]): number[] {
  const refs: ZoneRef[] = [label.primary.ref, ...label.alternatives.map((a) => a.ref)];
  if (label.region) refs.push({ kind: 'iana', id: label.region });
  return instants.flatMap((t) => refs.map((r) => offsetAt(r, t)));
}

function collectCandidates(text: string, allowZoneless: boolean, now: number): Candidate[] {
  const out: Candidate[] = [];
  let prevEnd = 0;
  let lastEnd = 0;
  const year = new Date(now).getUTCFullYear();
  const seasons = [Date.UTC(year, 0, 15), Date.UTC(year, 6, 15)];
  const anchors = new RegExp(ANCHOR, 'dg');
  const reread = (m: RegExpExecArray, source: string): RegExpExecArray => {
    const plain = new RegExp(source, 'dy');
    plain.lastIndex = m.index;
    const p = plain.exec(text);
    if (!p) return m;
    anchors.lastIndex = p.index + p[0].length;
    return p;
  };
  // A time needs minutes or a meridiem, except as the start of a range ("1-3 PM UTC").
  const notATime = (m: RegExpExecArray) => {
    const g = m.groups!;
    return !g.minute && !g.mer && (g.zone !== undefined || g.isoz !== undefined || !HOUR_START.test(text.slice(m.index + m[0].length)));
  };
  for (let m = anchors.exec(text); m; m = anchors.exec(text)) {
    // "9:00 GMT-10:00 GMT": the label can never have the offset, so with a
    // minus sign this is a range; so is "12:00 UTC-13:00", whose offset is out
    // of range. (With "+" it is an offset with a wrong label, which fails
    // when converted.)
    const zone = m.groups!.zone;
    if (zone && /^(?:UTC|GMT)\s?[-−]/.test(zone)) {
      const resolved = resolveZone(zone);
      const offset = resolved ? primaryOffset(resolved) : undefined;
      if (!resolved || (resolved.label && offset !== undefined && !labelOffsets(resolved.label, seasons).includes(offset))) {
        m = reread(m, ANCHOR_NO_OFFSET);
      }
    }
    if (notATime(m)) continue;
    const timeStart = m.index;
    if (timeStart < lastEnd) continue;

    // Date before the time.
    let start = timeStart;
    const leftBase = Math.max(prevEnd, start - LEFT_WINDOW);
    const leftText = text.slice(leftBase, start);
    let dateMatch: RegExpExecArray | null = null;
    for (const re of LEFT_DATES) {
      dateMatch = re.exec(leftText);
      if (dateMatch) break;
    }
    if (dateMatch) start = leftBase + dateMatch.index;

    // A numeric offset glued to the time ("10:30-11:30" is far more often a
    // range) is only trusted in a full ISO timestamp.
    const { isoz, second } = m.groups!;
    if (isoz && isoz !== 'Z') {
      const isoDate = dateMatch?.groups?.monnum;
      if (!isoDate || !(dateMatch!.groups!.isosep === 'T' || second)) {
        m = reread(m, ANCHOR_NO_ISO);
        if (notATime(m)) continue;
      }
    }
    const g = m.groups!;
    const zoned = g.zone !== undefined || g.isoz !== undefined;
    const bare = !zoned && !(allowZoneless && g.mer);
    // "Nov 12–14": a day, not an hour.
    if (bare && !g.minute && !g.mer && MONTH_BEFORE.test(text.slice(Math.max(0, timeStart - 12), timeStart))) continue;
    const timeEnd = timeStart + m[0].length;
    let end = timeEnd;
    const parts = partsOf(m, 0);
    if (dateMatch) parts.push(...partsOf(dateMatch, leftBase));

    // Date after the time, unless another time follows it ("1 PM UTC – Fri 2 AM UTC").
    const openParen = (m[0].match(/\(/g)?.length ?? 0) > (m[0].match(/\)/g)?.length ?? 0);
    if (!dateMatch) {
      const rightText = text.slice(end, end + LEFT_WINDOW);
      const closing = g.zone && text[end] === ')' && openParen ? 1 : 0;
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
    if (g.zone && openParen && text[end] === ')' && parts.at(-1)!.type === 'zone') end += 1;

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
      bare,
      drop: false,
    });
    // A bare time may still be dropped, so it does not end the window a later date is looked for in.
    if (!bare) prevEnd = end;
    lastEnd = end;
  }
  return out;
}

/**
 * Keep a bare time only where it can be an end of a range that shares a zone:
 * next to another time across a range dash, "to" or "until".
 */
function keepRangeEnds(text: string, cands: Candidate[]): Candidate[] {
  const joined = (a: Candidate | undefined, b: Candidate | undefined) => {
    if (!a || !b) return false;
    const gap = text.slice(a.end, b.start);
    return gap.length <= GAP_MAX && SHARED_GAP.test(gap);
  };
  return cands.filter((c, i) => !c.bare || joined(cands[i - 1], c) || joined(c, cands[i + 1]));
}

/**
 * How the ends of a two-ended range are converted: as one unit (and where its
 * zone comes from), end by end ('ends': each end has its own zone and they
 * differ, or an ISO timestamp), or not at all (null).
 */
function unitOf(text: string, a: Candidate, b: Candidate): Unit | 'ends' | null {
  const iso = partOf(a, 'monnum') || partOf(b, 'monnum');
  const dateAfter = (c: Candidate) => c.parts.some((p) => DATE_PARTS.has(p.type) && p.start >= c.timeEnd);
  if (a.zoneToken && b.zoneToken) {
    // ISO timestamps never join a range.
    return a.zoneToken === b.zoneToken && !iso && !dateAfter(a) ? 'each' : 'ends';
  }
  if (!SHARED_GAP.test(text.slice(a.end, b.start))) return null;
  // Not yet: an ISO date before the range, a date before the end only, or a date after the range.
  if (iso || dateAfter(a) || dateAfter(b)) return null;
  if ((b.hasDate || b.hasWeekday) && !(a.hasDate || a.hasWeekday)) return null;
  const aMer = partOf(a, 'mer');
  const bMer = partOf(b, 'mer');
  const minutes = partOf(a, 'minute') && partOf(b, 'minute');
  if (a.zoneToken) {
    // "9 AM UTC – 5 PM BRT": the end has a label of its own.
    if (OWN_LABEL_AFTER.test(text.slice(b.end, b.end + 16))) return null;
    return (aMer && bMer) || (!aMer && !bMer && minutes) ? 'first' : null;
  }
  // No zone on either end, and no site default for the end.
  if (!b.zoneToken && b.bare) return null;
  // A meridiem on the start only ("9 AM–17:00 UTC"); a 24-hour range needs minutes on both ends.
  if (aMer && !bMer) return null;
  if (!bMer && !minutes) return null;
  return b.zoneToken ? 'last' : 'default';
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

  // A two-ended range may share a zone between its ends; any other range or
  // list needs a zone on every end ("1:30 or 3:00 PM UTC" is left alone).
  forEachGroup(cands, (group) => {
    if (group.length === 2 && group[1]!.link === 'range') {
      const unit = unitOf(text, group[0]!, group[1]!);
      if (unit === null) for (const c of group) c.drop = true;
      else if (unit !== 'ends') group[0]!.unit = unit;
    } else if (group.length > 1 && group.some((c) => !c.zoneToken)) {
      for (const c of group) c.drop = true;
    }
  });

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

    if (!c.link) {
      const before24 = text.slice(Math.max(prev?.end ?? 0, c.start - 24), c.start);
      if (RANGE_BEFORE.test(before24)) drop();
      // Wider: "midnight Eastern Standard Time until " is 37 characters.
      if (NOON_BEFORE.test(text.slice(Math.max(prev?.end ?? 0, c.start - 48), c.start))) drop();
      // "2 PM UTC −3 PM UTC": the sign is not a range dash, and not an offset we read.
      if (SIGN_BEFORE.test(text.slice(Math.max(0, c.start - 8), c.start))) drop();
    }
    if (!nextLinked && (RANGE_AFTER.test(after) || NOON_AFTER.test(after))) drop();

    // "8 PM ET/PT": the time is given for several zones.
    if (c.zoneToken && !nextLinked && SLASH_AFTER.test(afterTime)) drop();

    // "14:00 UTC - 5": an offset we did not read. Never convert without it.
    // Not cut at the next candidate: in "UTC+5 PM" the next one starts after the sign.
    const signAfter = text.slice(c.timeEnd, c.timeEnd + CONTEXT);
    if (c.zoneToken && /^(?:UTC|GMT)$/.test(c.zoneToken) && !nextLinked && LOOSE_OFFSET_AFTER.test(signAfter)) drop();

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
  forEachGroup(cands, (group) => {
    if (group.some((c) => c.drop)) for (const c of group) c.drop = true;
  });
}

/** Each range or list (or single time): a candidate and the ones linked after it. */
function forEachGroup(cands: Candidate[], fn: (group: Candidate[]) => void): void {
  for (let i = 0; i < cands.length; ) {
    let j = i + 1;
    while (j < cands.length && cands[j]!.link) j++;
    fn(cands.slice(i, j));
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
  /**
   * What day markers on later ends that take this group's date are measured
   * from: the source date for a time-only group ("1:30 AM UTC – 3:00 AM UTC"),
   * the date as converted for a dated one ("Nov 13 9 AM UTC – 9 PM UTC").
   */
  markerDate: Fields;
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
  let label: ResolvedZone | undefined;

  if (c.zoneToken) {
    const resolved = resolveZone(c.zoneToken);
    if (!resolved) return null;
    label = resolved.label;
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

  // A range end, or a list item with the same label, takes the date as written
  // for the end before. A list item with another label ("11 PM PT / 2 AM ET")
  // takes the date the item before falls on in its own zone.
  const sameLabel = inherit && c.zoneToken !== undefined && c.zoneToken === prev.zoneToken;
  const writtenDate = sameLabel || c.link === 'range';
  const read = (reading: ZoneReading): Reading | null => {
    const base = !inherit ? null : writtenDate ? prev.fields : fieldsAt(reading.ref, prev.epochMs);
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
    } else if (first.epochMs <= prev.epochMs) {
      // Different labels and the end, on the written date, is not after the
      // start ("Nov 13, 2026 9 PM PT – 11 PM ET"): adding a day would make a
      // 23-hour range, more likely a mistake than what was meant.
      return null;
    }
  }

  let chosen = read(primary);
  if (!chosen) return null;
  const others: Reading[] = [];

  // "UTC+5:30 IST": the label must have the written offset at that instant.
  if (label && !labelOffsets(label, [chosen.epochMs]).includes(primaryOffset({ primary, alternatives: [] })!)) return null;

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
        // Dated: later ends that took this date are marked against the date as converted.
        markerDate: ownDate ? fieldsAt(ctx.target, chosen.epochMs) : chosen.fields,
      };

  // Already in the reader's zone: nothing to convert.
  if (offsetAt(chosen.reading.ref, chosen.epochMs) === offsetAt(ctx.target, chosen.epochMs)) return { state };

  if (!state.hasDate) flags.push('time-only');
  const markerFor = (r: Reading) => (inherit ? state.markerDate : ownDate ? null : r.fields);
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

/** Both ends of a range, read under one reading of its zone. */
interface RangeReading {
  reading: ZoneReading;
  start: Fields;
  end: Fields;
  epochMs: number;
  endEpochMs: number;
}

/** The meridiem a start without one takes from the end: "11–1 PM" is 11 AM–1 PM, "10–11 PM" 10–11 PM. */
function startMeridiem(a: Candidate, b: Candidate, endMer: string): string {
  const pm = endMer[0]!.toLowerCase() === 'p';
  const wall = (c: Candidate, pm: boolean) =>
    ((Number(partOf(c, 'hour')!.text) % 12) + (pm ? 12 : 0)) * 60 + Number(partOf(c, 'minute')?.text ?? 0);
  return wall(a, pm) > wall(b, pm) ? (pm ? 'am' : 'pm') : endMer;
}

/**
 * Render a range converted as one unit. Each end renders as a single time
 * would; what is written once is repeated on the start only when it no longer
 * fits both ends, and a time-only range gets one day marker, for the start's day.
 */
function renderRange(
  a: Candidate,
  b: Candidate,
  unit: Unit,
  twelve: boolean,
  r: RangeReading,
  ctx: Context,
): { text: string; dayShift: number } {
  const tz = ctx.targetZone;
  const startAt = fieldsAt(ctx.target, r.epochMs);
  const endAt = fieldsAt(ctx.target, r.endEpochMs);
  const sameDate = daysBetween(startAt, endAt) === 0;

  // The meridiem or zone written on the end only, repeated on the start when it differs there.
  let startExtra = '';
  if (unit === 'last' || unit === 'default') {
    const aMer = partOf(a, 'mer');
    const bMer = partOf(b, 'mer');
    const numberEnd = [...b.parts].reverse().find((p) => ['hour', 'minute', 'second'].includes(p.type))!.end;
    const merText = bMer && !aMer ? renderSpan(b, numberEnd, bMer.end, r.epochMs, tz, true) : '';
    const merDiffers = merText !== '' && startAt.hour < 12 !== endAt.hour < 12;
    if (shortZoneName(tz, r.epochMs) !== shortZoneName(tz, r.endEpochMs)) {
      if (unit === 'default') startExtra = `${merText} ${shortZoneName(tz, r.epochMs)}`;
      else {
        const zone = (partOf(b, 'zone') ?? partOf(b, 'isoz'))!;
        const from = aMer && bMer ? bMer.end : numberEnd;
        const paren = b.text[zone.end] === ')' && b.text.slice(from, zone.start).includes('(') ? 1 : 0;
        startExtra = renderSpan(b, from, zone.end + paren, r.epochMs, tz, true);
      }
    } else if (merDiffers) startExtra = merText;
  }
  const start = renderSpan(a, a.start, a.end, r.epochMs, tz, twelve, startExtra);
  // The zone written on the start only, repeated on the end when it differs there.
  let endZone = unit === 'default' ? ` ${shortZoneName(tz, r.endEpochMs)}` : '';
  if (unit === 'first' && shortZoneName(tz, r.epochMs) !== shortZoneName(tz, r.endEpochMs)) {
    const zone = (partOf(a, 'zone') ?? partOf(a, 'isoz'))!;
    const from = partOf(a, 'mer')?.end ?? [...a.parts].reverse().find((p) => ['hour', 'minute', 'second'].includes(p.type))!.end;
    const paren = a.text[zone.end] === ')' && a.text.slice(from, zone.start).includes('(') ? 1 : 0;
    endZone = renderSpan(a, from, zone.end + paren, r.endEpochMs, tz, true);
  }
  const end = renderSpan(b, b.start, b.end, r.endEpochMs, tz, partOf(b, 'mer') !== undefined, endZone);

  // A date written on the start only is written on the end too when the ends land on different dates.
  const aDated = a.hasDate || a.hasWeekday;
  const bDated = b.hasDate || b.hasWeekday;
  const endDate = aDated && !bDated && !sameDate ? renderSpan(a, a.start, a.timeStart, r.endEpochMs, tz, false) : '';

  let dayShift = 0;
  let afterStart = '';
  let afterEnd = '';
  if (!aDated && !bDated) {
    dayShift = daysBetween(r.start, startAt);
    // After the start when the range crosses midnight, so it cannot be read as the end's.
    if (dayShift !== 0) (sameDate ? (afterEnd = dayMarker(dayShift)) : (afterStart = dayMarker(dayShift)));
  }
  return { text: start + afterStart + a.text.slice(a.end, b.start) + endDate + end + afterEnd, dayShift };
}

/**
 * Convert a two-ended range as one unit: one zone reading for both ends, both
 * converted or neither. Null when it cannot be read with confidence or is
 * already in the reader's zone at both ends.
 */
function convertRange(a: Candidate, b: Candidate, unit: Unit, ctx: Context): Conversion | null {
  const flags: Flag[] = [];
  let primary: ZoneReading;
  let region: string | undefined;
  let otherMeanings: ZoneReading[] = [];
  let label: ResolvedZone | undefined;
  const token = unit === 'first' ? a.zoneToken : unit === 'default' ? undefined : b.zoneToken;
  if (token) {
    const resolved = resolveZone(token);
    if (!resolved) return null;
    label = resolved.label;
    ({ primary, region } = resolved);
    otherMeanings = resolved.alternatives;
  } else {
    primary = { ref: { kind: 'iana', id: ctx.defaultZone! }, description: `${ctx.defaultZone} (site default)` };
    flags.push('assumed-zone');
  }

  const endMer = partOf(b, 'mer')?.text;
  let startMer = partOf(a, 'mer')?.text;
  if (!startMer && endMer && (unit === 'last' || unit === 'default')) startMer = startMeridiem(a, b, endMer);
  const aDated = a.hasDate || a.hasWeekday;
  const bDated = b.hasDate || b.hasWeekday;
  // "1:30 PM UTC – 3:00 PM UTC on Friday": the start has no date of its own.
  if (bDated && !aDated) return null;

  // The start falls on its date, or today in the source zone. The end falls on
  // its own date, or else is the next time that clock reading comes after the start.
  const read = (reading: ZoneReading): RangeReading | null => {
    const today = fieldsAt(reading.ref, ctx.now);
    const start = sourceFields(a, today, startMer);
    if (!start) return null;
    let end = sourceFields(b, bDated ? today : addDays(start, 0), endMer);
    if (!end) return null;
    const overnight = !bDated && secondsOfDay(end) <= secondsOfDay(start);
    if (overnight) end = addDays(end, 1);
    const epochMs = toEpoch(reading.ref, start);
    const endEpochMs = toEpoch(reading.ref, end);
    if (endEpochMs <= epochMs || (overnight && endEpochMs - epochMs > OVERNIGHT_MAX)) return null;
    return { reading, start, end, epochMs, endEpochMs };
  };

  let chosen = read(primary);
  if (!chosen) return null;
  const others: RangeReading[] = [];
  const instants = (r: RangeReading) => [r.epochMs, r.endEpochMs];

  // "UTC+5:30 IST": the label must have the written offset at both ends.
  const written = primaryOffset({ primary, alternatives: [] });
  if (label && instants(chosen).some((t) => !labelOffsets(label, [t]).includes(written!))) return null;

  // "EST" on a date its region observes EDT: offer both readings, if both ends agree.
  if (region && primary.ref.kind === 'fixed') {
    const regionRef: ZoneRef = { kind: 'iana', id: region };
    const [startOff, endOff] = instants(chosen).map((t) => offsetAt(regionRef, t) !== written);
    if (startOff !== endOff) return null;
    const regional = startOff ? read({ ref: regionRef, description: `local time in ${region}` }) : null;
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

  // Already in the reader's zone at both ends: nothing to convert.
  const ref = chosen.reading.ref;
  if (instants(chosen).every((t) => offsetAt(ref, t) === offsetAt(ctx.target, t))) return null;

  if (!a.hasDate && !b.hasDate) flags.push('time-only');
  const twelve = startMer !== undefined;
  const rendered = renderRange(a, b, unit, twelve, chosen, ctx);
  return {
    index: a.start,
    length: b.end - a.start,
    original: a.text.slice(a.start, b.end),
    converted: rendered.text,
    epochMs: chosen.epochMs,
    endEpochMs: chosen.endEpochMs,
    sourceDescription: chosen.reading.description,
    confidence: flags.includes('ambiguous-zone') || flags.includes('season-mismatch') ? 'low' : 'high',
    flags,
    alternatives: others.map((o) => ({
      description: o.reading.description,
      epochMs: o.epochMs,
      converted: renderRange(a, b, unit, twelve, o, ctx).text,
    })),
    format: 'text',
    dayShift: rendered.dayShift,
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

  const cands = keepRangeEnds(text, collectCandidates(text, ctx.defaultZone !== undefined, ctx.now));
  applyGuards(text, cands);

  const results: Conversion[] = [];
  forEachGroup(cands, (group) => {
    if (group[0]!.drop) return;
    const unit = group[0]!.unit;
    if (unit) {
      const range = convertRange(group[0]!, group[1]!, unit, ctx);
      if (range) results.push(range);
      return;
    }

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
  });
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
