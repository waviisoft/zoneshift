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
const RANGE_WORD = '(?:[-–—]|to|until|through)';

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

/** Text before a match that makes it the end of a range ("1:30–3:00 PM UTC"). */
const RANGE_BEFORE = new RegExp(
  `(?:(?:\\d{1,2}:\\d{2}(?::\\d{2})?|${MER})\\s?${RANGE_WORD}\\s?|(?<![\\d:.])\\d{1,2}(?:[-–—]|\\s(?:to|until|through)\\s))$`,
);
/** Text after a match that makes it the start of a range. */
const RANGE_AFTER = new RegExp(`^\\s?${RANGE_WORD}\\s?(?=\\d)`);

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

interface Candidate {
  text: string;
  start: number;
  end: number;
  parts: Part[];
  zoneToken: string | undefined;
  hasDate: boolean;
  hasWeekday: boolean;
}

/** Re-render the matched text for `epochMs` in the target zone, keeping its format. */
function render(c: Candidate, epochMs: number, sourceDate: Fields, targetZone: string): { text: string; dayShift: number } {
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
        const padded = iso || (p.text.length === 2 && (p.text[0] === '0' || !twelve));
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
  if (!c.hasDate && !c.hasWeekday) {
    dayShift = daysBetween(sourceDate, t);
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
  if (dayText) {
    day = parseInt(dayText, 10);
    month = monthName
      ? MONTHS.findIndex((m) => m.startsWith(monthName.slice(0, 3))) + 1
      : Number(get('monnum'));
    year = Number(get('year') ?? today.year);
    const check = new Date(Date.UTC(year, month - 1, day));
    if (month < 1 || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  } else {
    const wd = get('wd');
    if (wd) {
      // A weekday on its own: the next such day, counting today.
      const wanted = WEEKDAYS.findIndex((w) => w.startsWith(wd.slice(0, 3)));
      const ahead = (wanted - today.weekday + 7) % 7;
      const d = new Date(Date.UTC(year, month - 1, day + ahead));
      year = d.getUTCFullYear();
      month = d.getUTCMonth() + 1;
      day = d.getUTCDate();
    }
  }
  return { year, month, day, hour, minute, second };
}

function collectCandidates(text: string, allowZoneless: boolean): Candidate[] {
  const anchors: RegExpExecArray[] = [];
  for (const m of text.matchAll(ANCHOR) as IterableIterator<RegExpExecArray>) {
    const g = m.groups!;
    if (!g.minute && !g.mer) continue;
    if (!g.zone && !g.isoz && !(allowZoneless && g.mer)) continue;
    anchors.push(m);
  }
  const anchorStarts = new Set(anchors.map((m) => m.index));

  const out: Candidate[] = [];
  let prevEnd = 0;
  for (const m of anchors) {
    const g = m.groups!;
    let start = m.index;
    let end = start + m[0].length;
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

    // Date after the time.
    if (!dateMatch) {
      const rightText = text.slice(end, end + LEFT_WINDOW);
      const closing = g.zone && text[end] === ')' && m[0].includes('(') ? 1 : 0;
      for (const re of RIGHT_DATES) {
        const r = re.exec(rightText.slice(closing));
        if (r) {
          dateMatch = r;
          parts.push(...partsOf(r, end + closing));
          end = end + closing + r[0].length;
          break;
        }
      }
    }

    // Ranges are not handled yet; converting one end alone would mislead.
    if (RANGE_BEFORE.test(text.slice(Math.max(0, start - 24), start))) continue;
    const after = RANGE_AFTER.exec(text.slice(end, end + 12));
    if (after && !anchorStarts.has(end + after[0].length)) continue;

    parts.sort((a, b) => a.start - b.start);
    // Pull a closing parenthesis into the match so a day marker lands outside it.
    if (g.zone && m[0].includes('(') && text[end] === ')' && parts.at(-1)!.type === 'zone') end += 1;

    out.push({
      text,
      start,
      end,
      parts,
      zoneToken: g.zone ?? g.isoz,
      hasDate: parts.some((p) => p.type === 'day'),
      hasWeekday: parts.some((p) => p.type === 'wd'),
    });
    prevEnd = end;
  }
  return out;
}

/** Find every date/time in `text` that can be converted to the target zone. */
export function findConversions(text: string, options: ConvertOptions = {}): Conversion[] {
  const targetZone = options.targetZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const now = options.now ?? Date.now();
  const defaultZone = options.defaultZone && isValidZone(options.defaultZone) ? options.defaultZone : undefined;
  const target: ZoneRef = { kind: 'iana', id: targetZone };
  const results: Conversion[] = [];

  for (const c of collectCandidates(text, defaultZone !== undefined)) {
    const flags: Flag[] = [];
    let primary: ZoneReading;
    let region: string | undefined;
    let otherMeanings: ZoneReading[] = [];

    if (c.zoneToken) {
      const resolved = resolveZone(c.zoneToken);
      if (!resolved) continue;
      ({ primary, region } = resolved);
      otherMeanings = resolved.alternatives;
    } else {
      primary = { ref: { kind: 'iana', id: defaultZone! }, description: `${defaultZone} (site default)` };
      flags.push('assumed-zone');
    }

    const read = (reading: ZoneReading) => {
      const fields = sourceFields(c, fieldsAt(reading.ref, now));
      return fields ? { reading, fields, epochMs: toEpoch(reading.ref, fields) } : null;
    };

    let chosen = read(primary);
    if (!chosen) continue;
    const others: NonNullable<ReturnType<typeof read>>[] = [];

    // "EST" on a date its region observes EDT: offer both readings.
    if (region && primary.ref.kind === 'fixed' && offsetAt({ kind: 'iana', id: region }, chosen.epochMs) !== primary.ref.offsetMinutes) {
      const regional = read({ ref: { kind: 'iana', id: region }, description: `local time in ${region}` });
      if (regional && regional.epochMs !== chosen.epochMs) {
        flags.push('season-mismatch');
        if ((options.seasonMismatch ?? 'regional') === 'regional') {
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

    // Already in the reader's zone: nothing to convert.
    if (offsetAt(chosen.reading.ref, chosen.epochMs) === offsetAt(target, chosen.epochMs)) continue;

    if (!c.hasDate) flags.push('time-only');
    const rendered = render(c, chosen.epochMs, chosen.fields, targetZone);
    const alternatives: Alternative[] = others.map((o) => ({
      description: o.reading.description,
      epochMs: o.epochMs,
      converted: render(c, o.epochMs, o.fields, targetZone).text,
    }));

    results.push({
      index: c.start,
      length: c.end - c.start,
      original: text.slice(c.start, c.end),
      converted: rendered.text,
      epochMs: chosen.epochMs,
      sourceDescription: chosen.reading.description,
      confidence: flags.includes('ambiguous-zone') || flags.includes('season-mismatch') ? 'low' : 'high',
      flags,
      alternatives,
      format: c.parts.some((p) => p.type === 'monnum') ? 'iso' : 'text',
      dayShift: rendered.dayShift,
    });
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
