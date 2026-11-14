import type { ZoneRef } from './types';

export interface Fields {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number; // 0-23
  minute: number;
  second: number;
}

const MINUTE = 60_000;
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(zone: string): Intl.DateTimeFormat {
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(zone, f);
  }
  return f;
}

export function isValidZone(zone: string): boolean {
  try {
    formatter(zone);
    return true;
  } catch {
    return false;
  }
}

/** Offset of an IANA zone at an instant, in minutes east of UTC. */
export function ianaOffsetAt(zone: string, epochMs: number): number {
  const v: Record<string, number> = {};
  for (const p of formatter(zone).formatToParts(epochMs)) {
    if (p.type !== 'literal') v[p.type] = Number(p.value);
  }
  const asUtc = Date.UTC(v.year!, v.month! - 1, v.day!, v.hour!, v.minute!, v.second!);
  return Math.round((asUtc - Math.floor(epochMs / 1000) * 1000) / MINUTE);
}

export function offsetAt(zone: ZoneRef, epochMs: number): number {
  return zone.kind === 'fixed' ? zone.offsetMinutes : ianaOffsetAt(zone.id, epochMs);
}

/** Wall-clock fields in a zone -> instant. */
export function toEpoch(zone: ZoneRef, f: Fields): number {
  const wall = Date.UTC(f.year, f.month - 1, f.day, f.hour, f.minute, f.second);
  if (zone.kind === 'fixed') return wall - zone.offsetMinutes * MINUTE;
  const first = ianaOffsetAt(zone.id, wall);
  const guess = wall - first * MINUTE;
  const second = ianaOffsetAt(zone.id, guess);
  return second === first ? guess : wall - second * MINUTE;
}

/** Instant -> wall-clock fields in a zone, plus weekday (0 = Sunday). */
export function fieldsAt(zone: ZoneRef, epochMs: number): Fields & { weekday: number } {
  const d = new Date(epochMs + offsetAt(zone, epochMs) * MINUTE);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
    weekday: d.getUTCDay(),
  };
}

const nameFormatters = new Map<string, Intl.DateTimeFormat>();

/** Short display name of an IANA zone at an instant, e.g. "PST". */
export function shortZoneName(zone: string, epochMs: number): string {
  let f = nameFormatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'short' });
    nameFormatters.set(zone, f);
  }
  return f.formatToParts(epochMs).find((p) => p.type === 'timeZoneName')?.value ?? zone;
}

export function formatOffset(offsetMinutes: number, colon: boolean): string {
  const sign = offsetMinutes < 0 ? '-' : '+';
  const abs = Math.abs(offsetMinutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${sign}${hh}${colon ? ':' : ''}${mm}`;
}
