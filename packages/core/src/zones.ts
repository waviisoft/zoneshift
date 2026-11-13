import type { ZoneRef } from './types';

export interface ZoneReading {
  ref: ZoneRef;
  description: string;
}

export interface ResolvedZone {
  primary: ZoneReading;
  /**
   * For a standard/daylight abbreviation: the region whose clocks it normally
   * describes. Used to detect "EST" written on a date that region is on EDT.
   */
  region?: string;
  /** Other meanings of the same label. */
  alternatives: ZoneReading[];
}

interface Entry {
  /** Fixed offset in minutes, or an IANA id for generic names such as "PT". */
  zone: number | string;
  name: string;
  region?: string;
  alts?: Array<[name: string, zone: number | string]>;
}

const h = (hours: number) => Math.round(hours * 60);

/**
 * Abbreviations are only ever matched directly after a time, in upper case.
 * Generic names (ET, PT, ...) map to a region, never to a fixed offset.
 * Standard-time abbreviations whose region partly ignores daylight saving
 * (MST: Arizona, AEST: Queensland, HST) deliberately have no `region`.
 */
const TABLE: Record<string, Entry> = {
  UTC: { zone: 0, name: 'UTC' },
  GMT: { zone: 0, name: 'GMT' },

  ET: { zone: 'America/New_York', name: 'Eastern Time' },
  CT: { zone: 'America/Chicago', name: 'Central Time' },
  MT: { zone: 'America/Denver', name: 'Mountain Time', alts: [['Arizona', 'America/Phoenix']] },
  PT: {
    zone: 'America/Los_Angeles',
    name: 'Pacific Time',
    alts: [['Pacific Time (British Columbia)', 'America/Vancouver']],
  },

  EST: { zone: h(-5), name: 'Eastern Standard Time', region: 'America/New_York' },
  EDT: { zone: h(-4), name: 'Eastern Daylight Time', region: 'America/New_York' },
  CST: {
    zone: h(-6),
    name: 'Central Standard Time',
    region: 'America/Chicago',
    alts: [['China Standard Time', h(8)]],
  },
  CDT: { zone: h(-5), name: 'Central Daylight Time', region: 'America/Chicago' },
  MST: { zone: h(-7), name: 'Mountain Standard Time' },
  MDT: { zone: h(-6), name: 'Mountain Daylight Time', region: 'America/Denver' },
  PST: { zone: h(-8), name: 'Pacific Standard Time', region: 'America/Los_Angeles' },
  PDT: { zone: h(-7), name: 'Pacific Daylight Time', region: 'America/Los_Angeles' },
  AKST: { zone: h(-9), name: 'Alaska Standard Time', region: 'America/Anchorage' },
  AKDT: { zone: h(-8), name: 'Alaska Daylight Time', region: 'America/Anchorage' },
  HST: { zone: h(-10), name: 'Hawaii Standard Time' },
  AST: {
    zone: h(-4),
    name: 'Atlantic Standard Time',
    region: 'America/Halifax',
    alts: [['Arabia Standard Time', h(3)]],
  },
  ADT: { zone: h(-3), name: 'Atlantic Daylight Time', region: 'America/Halifax' },
  NST: { zone: h(-3.5), name: 'Newfoundland Standard Time', region: 'America/St_Johns' },
  NDT: { zone: h(-2.5), name: 'Newfoundland Daylight Time', region: 'America/St_Johns' },

  WET: { zone: 0, name: 'Western European Time', region: 'Europe/Lisbon' },
  WEST: { zone: h(1), name: 'Western European Summer Time', region: 'Europe/Lisbon' },
  BST: {
    zone: h(1),
    name: 'British Summer Time',
    region: 'Europe/London',
    alts: [['Bangladesh Standard Time', h(6)]],
  },
  CET: { zone: h(1), name: 'Central European Time', region: 'Europe/Berlin' },
  CEST: { zone: h(2), name: 'Central European Summer Time', region: 'Europe/Berlin' },
  EET: { zone: h(2), name: 'Eastern European Time', region: 'Europe/Helsinki' },
  EEST: { zone: h(3), name: 'Eastern European Summer Time', region: 'Europe/Helsinki' },
  MSK: { zone: h(3), name: 'Moscow Time' },

  IST: {
    zone: h(5.5),
    name: 'India Standard Time',
    alts: [
      ['Irish Standard Time', 'Europe/Dublin'],
      ['Israel Standard Time', 'Asia/Jerusalem'],
    ],
  },
  GST: { zone: h(4), name: 'Gulf Standard Time' },
  PKT: { zone: h(5), name: 'Pakistan Standard Time' },
  SGT: { zone: h(8), name: 'Singapore Time' },
  HKT: { zone: h(8), name: 'Hong Kong Time' },
  PHT: { zone: h(8), name: 'Philippine Time' },
  JST: { zone: h(9), name: 'Japan Standard Time' },
  KST: { zone: h(9), name: 'Korea Standard Time' },

  AWST: { zone: h(8), name: 'Australian Western Standard Time' },
  ACST: { zone: h(9.5), name: 'Australian Central Standard Time' },
  ACDT: { zone: h(10.5), name: 'Australian Central Daylight Time', region: 'Australia/Adelaide' },
  AEST: { zone: h(10), name: 'Australian Eastern Standard Time' },
  AEDT: { zone: h(11), name: 'Australian Eastern Daylight Time', region: 'Australia/Sydney' },
  NZST: { zone: h(12), name: 'New Zealand Standard Time', region: 'Pacific/Auckland' },
  NZDT: { zone: h(13), name: 'New Zealand Daylight Time', region: 'Pacific/Auckland' },

  SAST: { zone: h(2), name: 'South Africa Standard Time' },
  WAT: { zone: h(1), name: 'West Africa Time' },
  CAT: { zone: h(2), name: 'Central Africa Time' },
  EAT: { zone: h(3), name: 'East Africa Time' },
};

/** Exposed for tests. */
export const ZONE_TABLE: Readonly<Record<string, Entry>> = TABLE;

const LONG_NAME = /^(Eastern|Central|Mountain|Pacific)(?:\s(Standard|Daylight))?\sTime$/;
const UTC_OFFSET = /^(?:UTC|GMT)\s?([+\-−])(\d{1,2})(?::?(\d{2}))?$/;
const ISO_OFFSET = /^([+\-−])(\d{2})(?::?(\d{2}))?$/;

const abbreviations = Object.keys(TABLE)
  .filter((k) => k !== 'UTC' && k !== 'GMT')
  .sort((a, b) => b.length - a.length)
  .join('|');

/** Regex source matching a zone label that follows a time. */
export const ZONE_PATTERN =
  '(?:UTC|GMT)(?:(?:[+\\-−]|\\s\\+)\\d{1,2}(?::?\\d{2})?(?!\\d))?' +
  '|(?:Eastern|Central|Mountain|Pacific)(?:\\s(?:Standard|Daylight))?\\sTime' +
  `|(?:${abbreviations})`;

function toRef(zone: number | string): ZoneRef {
  return typeof zone === 'number' ? { kind: 'fixed', offsetMinutes: zone } : { kind: 'iana', id: zone };
}

function fixed(sign: string, hours: string, minutes: string | undefined, label: string): ResolvedZone | null {
  const total = Number(hours) * 60 + Number(minutes ?? 0);
  if (total > 14 * 60 || Number(minutes ?? 0) > 59) return null;
  const offsetMinutes = sign === '+' ? total : -total;
  return { primary: { ref: { kind: 'fixed', offsetMinutes }, description: label }, alternatives: [] };
}

/** Interpret a zone label as matched by ZONE_PATTERN, "Z", or an ISO offset. */
export function resolveZone(token: string): ResolvedZone | null {
  if (token === 'Z') return resolveZone('UTC');

  let m = UTC_OFFSET.exec(token) ?? ISO_OFFSET.exec(token);
  if (m) return fixed(m[1]!, m[2]!, m[3], token.startsWith('U') || token.startsWith('G') ? token : `UTC${token}`);

  let key = token;
  m = LONG_NAME.exec(token);
  if (m) key = m[1]![0]! + (m[2] ? m[2][0]! : '') + 'T';

  const entry = TABLE[key];
  if (!entry) return null;
  const description = typeof entry.zone === 'string' ? `${entry.name} (${entry.zone})` : entry.name;
  return {
    primary: { ref: toRef(entry.zone), description },
    region: entry.region,
    alternatives: (entry.alts ?? []).map(([name, zone]) => ({ ref: toRef(zone), description: name })),
  };
}
