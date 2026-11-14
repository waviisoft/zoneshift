/** A time zone: either a fixed UTC offset or an IANA region with its own rules. */
export type ZoneRef =
  | { kind: 'fixed'; offsetMinutes: number }
  | { kind: 'iana'; id: string };

export type Flag =
  /** The zone label has more than one meaning, and they give different instants. */
  | 'ambiguous-zone'
  /** A standard/daylight abbreviation was used in the wrong season for its region. */
  | 'season-mismatch'
  /** The text carried no zone; the caller's default zone was assumed. */
  | 'assumed-zone'
  /** No date in the text; today's date in the source zone was assumed. */
  | 'time-only';

export interface Alternative {
  /** Human-readable description of this reading, e.g. "China Standard Time". */
  description: string;
  epochMs: number;
  /** The replacement text under this reading. */
  converted: string;
}

export interface Conversion {
  /** Position of the matched text in the input. */
  index: number;
  length: number;
  original: string;
  /** Replacement text, mirroring the original's format. */
  converted: string;
  /** The instant the text was read as. */
  epochMs: number;
  /** How the source zone was read, e.g. "UTC" or "Eastern Time (America/New_York)". */
  sourceDescription: string;
  confidence: 'high' | 'low';
  flags: Flag[];
  /** Other plausible readings that yield a different instant. */
  alternatives: Alternative[];
  /** 'iso' for machine-style timestamps (2026-11-13T01:30:00Z), 'text' for prose. */
  format: 'iso' | 'text';
  /**
   * For time-only text: target date minus source date, in days. Usually -1, 0
   * or 1; zones more than 24 hours apart (Pacific/Kiritimati and
   * Pacific/Pago_Pago are 25) can give -2 or 2. Always 0 when the text has a date or
   * weekday. For the later end of a time-only range or list, measured from the
   * source date of the first end.
   */
  dayShift: number;
}

export interface ConvertOptions {
  /**
   * IANA zone to convert into. Defaults to the system zone. If it is not a
   * valid zone, nothing is converted: findConversions returns [] and
   * convertText returns the text unchanged. Neither throws.
   */
  targetZone?: string;
  /** Reference instant for text without a full date. Defaults to Date.now(). */
  now?: number;
  /** IANA zone assumed for times that carry no zone (per-site default). */
  defaultZone?: string;
  /**
   * What to show first when e.g. "EST" appears on a date its region observes EDT.
   * 'regional' reads it as the region's local time; 'literal' as the fixed offset.
   * Either way the conversion is flagged and the other reading is offered.
   */
  seasonMismatch?: 'regional' | 'literal';
}
