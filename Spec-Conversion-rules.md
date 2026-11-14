> Status: **As built** — records pull request #26; not yet confirmed by the owner · Issues: #3, #4, #5, #6 · Depends on: nothing

## Summary

The engine (`packages/core`) finds dates and times in a piece of text and rewrites each one in the reader's time zone, keeping the way it was written. It converts only when it knows the source zone, from a label in the text or the site's default zone, and leaves anything it cannot read with confidence exactly as written. This page records what pull request #26 built, at commit `84d9d93`: every example is the output of a passing test, or of the engine at that commit where the row says "(run)".

## Decisions for the owner

These choices were made during the build and its review. The owner has not confirmed them, and any of them can be reopened. Rows 1–12 are already in the Decision log; rows 13–22 are recorded here for the first time. A reason marked "(inferred)" was read from the code; nobody wrote it down during review.

| # | Decision | Not taken | Why |
|---|---|---|---|
| 1 | A range or list converts only when every end has its own zone, and then whole or not at all | Converting the zoned end alone; sharing a trailing zone | Half-converted ranges were the most common wrong output in review |
| 2 | Ranges ending in noon or midnight, weekday ranges and lists, and one time given for several zones (`8 PM ET/PT`) are left alone | Converting the readable part | Same reason as row 1 |
| 3 | A time next to a date the engine cannot read is left alone | Converting it as if it were today | That would give the wrong daylight-saving offset and leave a stale date |
| 4 | `·`, `•` and `:` join a date to its time | Reading only `,` `at` `@` dashes and `\|` | Event listings use them |
| 5 | A year-less date with a weekday takes the nearest year (this, next, last) where they agree; otherwise it is left alone | Always the current year | "Sat, Jan 9" written in November means next January |
| 6 | `+` and `−` after UTC/GMT are always an offset; a hyphen is an offset unless a time with a meridiem follows; offsets run from −12 to +14 | Treating every hyphen as an offset | "9 AM UTC-10 AM UTC" was read as UTC−10 |
| 7 | A bare Zulu time is shown with the zone name; a full ISO timestamp keeps a numeric offset | A numeric offset everywhere | "02:00-08:00" reads like a range |
| 8 | No site default next to a zone written in words | Applying the default anyway | It would override what the page says |
| 9 | A spelled-out standard or daylight name has no other meanings | Giving it its abbreviation's meanings | The full name is not ambiguous |
| 10 | An invalid target zone gives no conversions and does not throw | Throwing; falling back to UTC | A bad setting must never break a page |
| 11 | Custom parser, no dependencies | A date-parsing library | Mirroring needs the position of every date part, and regional zones would override most of a library |
| 12 | An abbreviation in the wrong season defaults to the region's local time; `MST`, `HST`, `AEST` are always literal | Literal by default | The writer usually means the local clock; those three regions partly skip daylight saving |
| 13 | A time needs minutes or a meridiem; a zone-less time under a site default needs a meridiem | Reading bare hours (`13 UTC`) or zone-less `19:00` | Bare numbers are too often not times (inferred) |
| 14 | "Already in the reader's zone" means the same UTC offset at that instant, so `1:00 PM GMT` read in London in winter is left alone | Comparing zone names | The clock reading would not change (inferred) |
| 15 | An ambiguous label is flagged only when its meanings give different instants; the first meaning is the North American or Indian one (table in B6) | Always flagging; a per-site preference | No warning where the meanings agree; preferences need Settings (#20) (inferred) |
| 16 | An offset glued to a time (`01:30+02:00`) is trusted only in an ISO timestamp with `T` or seconds | Trusting it everywhere | "10:30-11:30" is far more often a range |
| 17 | A weekday with no date is the next such day, counting today | The previous or nearest one | Schedules point forward (inferred) |
| 18 | Only upper-case abbreviations are read (`UTC`, not `utc`) | Any case | Lower-case letter runs are usually words (inferred) |
| 19 | A later end of a range is the first such time after the start, within a day; with different labels it must already be after the start on the written date | Always adding a day when needed | A 23-hour range is more likely a mistake |
| 20 | A later end that takes its date from the end before is marked `(+1 day)` against the date as converted | No marker; repeating the date | The reader would otherwise see the wrong day (inferred) |
| 21 | Zone names in the output come from the browser (`GMT+9` for Tokyo) | A bundled zone-name table | No data to bundle or update; a bundled database is the fallback in `docs/design.md` |
| 22 | The site default zone is an engine option only; the extension passes none yet | A built-in default | It needs Settings (#20, #21) |

## Behaviour

Reader zone America/Los_Angeles and now = Wed 2026-11-11 20:00 UTC, unless a row says otherwise. "Summer" means now = 2026-07-15 20:00 UTC.

**When a time converts**

- **B1** A time is digits with minutes (`1:30`, `13:00:45`) or with a meridiem (`1 PM`, `7 p.m.`, `3:00 pm`). The hour must be 1–12 with a meridiem and 0–23 without; minutes and seconds 0–59.
- **B2** It converts only when the source zone is known: a zone label directly after it (one optional space, optional parentheses), an ISO `Z` or offset, or the site default zone (B31).
- **B3** If the source and the reader's zone have the same offset at that instant, nothing is converted and no icon is shown. In a list, that item stays as written while the others convert.
- **B4** Each conversion carries the original and converted text, the instant, how the zone was read, `confidence` (`low` when flagged `ambiguous-zone` or `season-mismatch`), flags, alternatives, `format` (`iso` when the date is numeric ISO) and `dayShift`.

**Zone labels**

- **B5** Labels read: `UTC`, `GMT`; generic `ET` `CT` `MT` `PT`; `Eastern|Central|Mountain|Pacific [Standard|Daylight] Time`; and the abbreviations EST EDT CST CDT MST MDT PST PDT AKST AKDT HST AST ADT NST NDT WET WEST BST CET CEST EET EEST MSK IST GST PKT SGT HKT PHT JST KST AWST ACST ACDT AEST AEDT NZST NZDT SAST WAT CAT EAT.
- **B6** Generic names resolve to a region in the time-zone database. Labels with several meanings are flagged `ambiguous-zone`, with the other meanings as alternatives, when the meanings give different instants:

  | Label | Read as | Alternatives |
  |---|---|---|
  | `CST` | Central Standard Time | China Standard Time |
  | `IST` | India Standard Time | Irish Standard Time, Israel Standard Time |
  | `BST` | British Summer Time | Bangladesh Standard Time |
  | `AST` | Atlantic Standard Time | Arabia Standard Time |
  | `PT`, `Pacific Time` | America/Los_Angeles | British Columbia (America/Vancouver) |
  | `MT`, `Mountain Time` | America/Denver | Arizona (America/Phoenix) |

- **B7** An abbreviation used in the season its region does not observe (`EST` in July) is flagged `season-mismatch` and given low confidence. By default it is read as the region's local time, and the literal reading is offered; option `seasonMismatch: 'literal'` swaps them. This applies to spelled-out standard and daylight names too.
- **B8** `MST`, `HST`, `AEST`, and abbreviations without a region (JST, SGT, MSK and others), are always read at their fixed offset and never flagged.
- **B9** A spelled-out standard or daylight name has no other meanings (no China Standard Time for "Central Standard Time").
- **B10** Offsets: `UTC`/`GMT` then `+`, `−` (Unicode minus) or `-`, one or two hour digits, optional minutes with or without a colon. One space may sit on either side of `+`/`−`, or before a hyphen. Range −12:00 to +14:00.
- **B11** `+` and `−` are never a range dash. A hyphen followed by a time with a meridiem starts a second time. In `9:00 GMT-10:00 GMT`, where the label can never have the offset, the hyphen is a range dash.
- **B12** An offset followed by a label (`UTC+5:30 IST`, `GMT-10:00 (HST)`) is read once, at the written offset, when the label has that offset at that instant. The label is replaced with the reader's zone.

| Original | Reader sees | Rule |
|---|---|---|
| `Nov 13, 2026 9:00 AM ET` (reader UTC) | `Nov 13, 2026 2:00 PM UTC` | B6 |
| `July 15, 2026 9:00 AM Eastern Time` (UTC, summer) | `July 15, 2026 1:00 PM UTC` | B6 |
| `Nov 13, 2026 9:00 AM CST` (UTC) | `Nov 13, 2026 3:00 PM UTC`, low; China Standard Time: `Nov 13, 2026 1:00 AM UTC` | B6 |
| `July 15, 2026 3:00 PM EST` (UTC, summer) | `July 15, 2026 7:00 PM UTC`, low; literal: `July 15, 2026 8:00 PM UTC` | B7 |
| `Nov 13, 2026 3:00 PM EST` (UTC) | `Nov 13, 2026 8:00 PM UTC`, high, no flags | B7 |
| `July 15, 2026 9:00 AM Eastern Standard Time` (UTC, summer) (run) | `July 15, 2026 1:00 PM UTC`, low; literal: `July 15, 2026 2:00 PM UTC` | B7 |
| `July 15, 2026 3:00 PM MST` (UTC, summer) (run) | `July 15, 2026 10:00 PM UTC`, high | B8 |
| `Nov 13, 2026 9:00 AM Central Standard Time` (UTC) | `Nov 13, 2026 3:00 PM UTC`, high, no alternatives | B9 |
| `Nov 13, 2026 10:00 UTC+2` | `Nov 13, 2026 00:00 PST` | B10 |
| `Nov 13, 2026 10:00 GMT-5:30` | `Nov 13, 2026 07:30 PST` | B10 |
| `14:00 UTC −5` / `14:00 UTC -5` | `11:00 PST` | B10 |
| `14:00 GMT + 1` / `14:00 GMT +1` | `05:00 PST` | B10 |
| `12:00 UTC-12:00` / `12:00 UTC+14:00` | `16:00 PST` / `14:00 PST (−1 day)` | B10 |
| `9 AM UTC-10 AM UTC` | `1 AM PST-2 AM PST` | B11 |
| `9:00 GMT-10:00 GMT` | `1:00 PST-02:00 PST` | B11 |
| `Kickoff 14:00 UTC+5:30 IST` | `Kickoff 00:30 PST` | B12 |
| `9:00 GMT-10:00 HST` | `11:00 PST` | B12 |
| `10:00 UTC +09:00 JST` | `17:00 PST (−1 day)` | B12 |
| `14:00 UTC+5:30 (IST)` | `00:30 PST` | B12 |

**Dates**

- **B13** Read directly before the time: `[Weekday,] Month Day[, Year]`, `[Weekday] Day [of] Month[ Year]`, ISO `YYYY-MM-DD` followed by `T` or a space, or a weekday alone. Joined by a comma or space, `at`, `@`, a dash or `|`, `·`, `•`, or `:`. Read directly after the time and zone: the same forms except ISO, after a comma, a space, `on`, a dash or `|`, unless another time follows that date.
- **B14** Month names are capitalised, full or short (`Sep`, `Sept`), with an optional period. Ordinals are read.
- **B15** A date with a year must exist (`Feb 30` does not), and a weekday written with it must match.
- **B16** A year-less date with a weekday takes this, next or last year, whichever is nearest and matches. If none does, it is left alone. Without a weekday, the current year is used.
- **B17** A weekday with no date is the next such day, counting today, and is shifted on output.
- **B18** The written date is used for the offset, not today's.

| Original | Reader sees | Rule |
|---|---|---|
| `Friday, November 13, 2026, at 1:30 AM UTC` | `Thursday, November 12, 2026, at 5:30 PM PST` | B13 |
| `Fri 13th November 2026, 01:30 GMT` | `Thu 12th November 2026, 17:30 PST` | B13, B14 |
| `1 January 2027 at 03:00 UTC` | `31 December 2026 at 19:00 PST` | B13 |
| `1:30 a.m. UTC on Friday, November 13` | `5:30 p.m. PST on Thursday, November 12` | B13 |
| `01:30 (UTC), 13 Nov 2026` | `17:30 (PST), 12 Nov 2026` | B13 |
| `Thu, Nov 12 · 7:00 PM EST` | `Thu, Nov 12 · 4:00 PM PST` | B13 |
| `Nov 12: 7:00 PM EST` | `Nov 12: 4:00 PM PST` | B13 |
| `Sat, Nov 14 · 11:30 PM UTC` (Asia/Tokyo) | `Sun, Nov 15 · 8:30 AM GMT+9` | B13, B18 |
| `Sat, Jan 9 at 1 AM UTC` | `Fri, Jan 8 at 5 PM PST` (9 January 2027) | B16 |
| `Sat, Dec 26 at 1 AM UTC` (now 2027-01-05) | `Fri, Dec 25 at 5 PM PST` (2026) | B16 |
| `Jan 9 at 1 AM UTC` | `Jan 8 at 5 PM PST` | B16 |
| `Saturday, November 14, 2026 at 3 PM UTC` | `Saturday, November 14, 2026 at 7 AM PST` | B15 |
| `Friday at 1:30 AM UTC` | `Thursday at 5:30 PM PST` | B17 |
| `July 4, 2026 at 6:00 PM UTC` | `July 4, 2026 at 11:00 AM PDT` | B18 |

**Time on its own, and day markers**

- **B19** A time with no date is read on today's date in the source zone and flagged `time-only`. When the reader's date differs, a marker follows: `(+1 day)`, `(−1 day)` (Unicode minus), or `(+2 days)` between zones 25 hours apart. The marker goes outside a closing parenthesis. A weekday-only time gets no marker.
- **B20** If the reader's zone needs minutes the original did not have, they are added.

| Original | Reader sees |
|---|---|
| `Doors open at 1:30 AM UTC.` | `Doors open at 5:30 PM PST (−1 day).` |
| `at 8 PM UTC` (Asia/Tokyo) | `at 5 AM GMT+9 (+1 day)` |
| `at 20:00 UTC` | `at 12:00 PST` |
| `5 PM UTC` (Asia/Kolkata) | `10:30 PM GMT+5:30` |
| `1:30 AM (UTC)` | `5:30 PM (PST) (−1 day)` |
| `11 PM UTC-11` (Pacific/Kiritimati) (run) | `12 AM GMT+14 (+2 days)` |

**ISO 8601 and bare Zulu times**

- **B21** A numeric ISO date makes the conversion `format: 'iso'`. A full ISO timestamp keeps its shape, fraction and a numeric offset. `Z` stays `Z` only when the reader is at UTC+0.
- **B22** An offset glued to the time is read only after an ISO date joined by `T`, or with seconds.
- **B23** A `Z` time without an ISO date is shown with the zone name.

| Original | Reader sees |
|---|---|
| `2026-11-13T01:30:00Z` | `2026-11-12T17:30:00-08:00` |
| `2026-11-13T01:30:00.123+02:00` | `2026-11-12T15:30:00.123-08:00` |
| `2026-11-13 01:30 UTC` | `2026-11-12 17:30 PST` |
| `2026-11-13 1:00 PM UTC` | `2026-11-13 5:00 AM PST` |
| `TAF valid from 10:00Z` | `TAF valid from 02:00 PST` |
| `valid from 18:00Z` (Asia/Tokyo) | `valid from 03:00 GMT+9 (+1 day)` |

**Ranges and lists**

- **B24** Two times form a range when joined by `-` `–` `—` `~` `to` `until` `till` `til` `through` `thru`, and a list when joined by `and` `or` `&` `/` `,`, with at most 16 characters between them. `between … and …` is a range.
- **B25** A range or list converts only if every end has its own zone and every end can be read. Each end is rendered on its own; the text between them is kept.
- **B26** A later end without its own date takes the date of the end before. A range end, or a list item with the same label, takes the date as written. A list item with another label takes the date the item before falls on in its own zone.
- **B27** A range end is the first such time after the start. With different labels, the end must already be after the start on the written date. Equal ends, ends a day or more apart, and backwards ranges are left alone.
- **B28** A later end that took the date of the end before and lands on another day in the reader's zone is marked against the date as converted. In a time-only range, every marker is measured from the day the range starts.

| Original | Reader sees | Rule |
|---|---|---|
| `1:30 PM UTC – 3:00 PM UTC` | `5:30 AM PST – 7:00 AM PST` | B25 |
| `2 PM UTC-3 PM UTC` | `6 AM PST-7 AM PST` | B24 |
| `1 PM UTC - 3 PM UTC` | `5 AM PST - 7 AM PST` | B24 |
| `Jul 13, 2026 1:30 PM UTC–3:00 PM UTC` | `Jul 13, 2026 6:30 AM PDT–8:00 AM PDT` | B26 |
| `Jul 13, 2026 11:30 PM UTC – 1:30 AM UTC` | `Jul 13, 2026 4:30 PM PDT – 6:30 PM PDT` (end is 14 July 01:30 UTC) | B27 |
| `Nov 13, 2026 1 PM UTC – Nov 14, 2026 1 PM UTC` | `Nov 13, 2026 5 AM PST – Nov 14, 2026 5 AM PST` | B26 |
| `Nov 13, 2026 1 PM ET – 3 PM PT` (UTC) | `Nov 13, 2026 6 PM UTC – 11 PM UTC` | B27 |
| `Nov 13, 2026 9 AM UTC – 9 PM UTC` (Asia/Tokyo) | `Nov 13, 2026 6 PM GMT+9 – 6 AM GMT+9 (+1 day)` | B28 |
| `Office hours on Thursday at 9 AM UTC and 9 PM UTC` (Asia/Tokyo) | `Office hours on Thursday at 6 PM GMT+9 and 6 AM GMT+9 (+1 day)` | B28 |
| `Nov 13, 2026 1 AM UTC – 3 AM UTC` (Asia/Tokyo) | `Nov 13, 2026 10 AM GMT+9 – 12 PM GMT+9` | B28 |
| `11:30 PM UTC – 1:30 AM UTC` | `3:30 PM PST – 5:30 PM PST` | B27 |
| `1:30 AM UTC – 3:00 AM UTC` | `5:30 PM PST (−1 day) – 7:00 PM PST (−1 day)` | B28 |
| `1:30 PM UTC or 3:00 PM UTC` | `5:30 AM PST or 7:00 AM PST` | B25 |
| `between 1 PM UTC and 3 PM UTC` | `between 5 AM PST and 7 AM PST` | B24 |
| `8 PM ET / 5 PM PT` | `5 PM PST / 5 PM PT` | B3 |
| `Live at 3 PM ET / 12 PM PT` (Europe/London) | `Live at 8 PM GMT / 8 PM GMT` | B25 |

**Site default zone**

- **B29** With `defaultZone` set to a valid zone, a zone-less time with a meridiem converts. It gets the reader's zone name after the time and the `assumed-zone` flag. An invalid `defaultZone` is ignored.
- **B30** The default is not applied to a time next to a zone written in words, or to a zone-less range or list (L5, L4).

| Original (site default) | Reader sees |
|---|---|
| `The show starts at 7:00 PM on Friday, November 13.` (America/New_York) | `…4:00 PM PST on Friday, November 13.`, flagged `assumed-zone` |
| `Open 7 PM` (America/New_York) | `Open 4 PM PST` |
| `Nov 13 • 7:00 PM` (America/New_York) | `Nov 13 • 4:00 PM PST` |
| `7 PM. Doors open at 6.` (Europe/Berlin; reader New York) | `1 PM EST. Doors open at 6.` |
| `Start Time: 7 PM` (Europe/Berlin; reader New York) | `Start Time: 1 PM EST` |
| `7 PM Pacific Time` (Europe/Berlin; reader New York) | `10 PM EST` (the written zone wins) |

**Output and options**

- **B31** The replacement mirrors the original:

  | Part | Kept as written |
  |---|---|
  | Clock | 12- or 24-hour; seconds and fractions; one- or two-digit hour (`01`, 24-hour `13` stay two digits) |
  | Meridiem | Case and dots (`a.m.`, `pm`, `PM`) |
  | Weekday, month | Full or three-letter (`Thurs` becomes `Thu` (run)) |
  | Day | Ordinal suffix recomputed (`13th` → `12th`); leading zero kept |
  | Year | Re-rendered when written |
  | Zone | Replaced by the reader's short zone name from the browser (`PST`, `PDT`, `GMT+9`, `GMT+5:30`); parentheses kept |
  | Everything else | Separators, joins and surrounding text untouched |

- **B32** If `targetZone` is not a valid zone, `findConversions` returns `[]` and `convertText` returns the text unchanged. Neither throws.

## Left alone

Every string below is returned unchanged (reader Los Angeles unless stated). Each group's test also checks nearby text that must still convert.

| # | Case | Test strings |
|---|---|---|
| L1 | **A later end with no zone of its own** | `Call between 1:30–3:00 PM UTC`, `Open 1-3 PM UTC`, `Open 9:00 AM UTC to 5:00 PM`, `Open 9:00 AM UTC through 5:00 PM`, `9 AM UTC-10 AM`, `Open 2 PM GMT-3 PM` |
| L2 | **Ranges and lists joined by words or slashes, zone on the last end only** | `Call between 1:30 PM and 3:00 PM UTC`, `Either 1:30 or 3:00 PM UTC`, `Slots 1:30/3:00 PM UTC`, `Open 9 till 5 PM ET`, `Open 1 & 3 PM UTC`, `Slots 1:30 PM, 3:00 PM UTC`. Still converts: `Meet at 1:30 PM UTC and bring 3 friends`, `Doors 6 PM UTC, show 7 PM UTC` |
| L3 | **A range end the engine does not read** (reader UTC) | `It runs 9 AM ET to noon`, `noon to 9 PM ET`, `Open 9 PM ET – midnight`, `Open 9 PM ET until Midnight`. Still converts: `Lunch at noon, call at 3 PM ET` |
| L4 | **Zone-less ranges and lists under a site default** (New York) | `Open 7 PM–9 PM`, `Open 7 PM to 9 PM`, `Shows at 7 PM or 9 PM`, `Open 7 PM–9 PM ET` |
| L5 | **A zone written in words next to a zone-less time** (default Berlin) | `7 PM Pacific`, `8 PM Eastern`, `7 PM London time`, `7 PM New York time`, `7 PM (London)`, `7 PM local time`, `Pacific: 7 PM`, `(London) 7 PM` |
| L6 | **A date or day the engine does not read, next to the time** | `07/04/2026 6:00 PM UTC`, `4.7.2026 18:00 UTC`, `july 4, 2026 at 6:00 PM UTC`, `JULY 4, 2026 at 6:00 PM UTC`, `2026-07-04, 18:00 UTC`, `2026-W46-5T01:30Z`, `2026-W27-6T18:00Z`, `Ends Friday 11/13 at 11:59 PM ET`, `6:00 PM UTC on 07/04/2026`, `nov 12 · 7:00 PM EST`, `tomorrow at 6 PM UTC`, `1 AM UTC on Mondays`; a year alone: `Room 2000 at 6 PM UTC` (run). Still converts: `The 2026 conference opens at 9 AM UTC`, `We sat at 1 AM UTC` |
| L7 | **One time for several zones** (Los Angeles and London) | `Airs 8 PM ET/PT on NBC`, `8 p.m. ET/PT`, `8 PM (ET/PT)`, `Airs 8 PM ET/7c`. Still converts: `Airs 8 PM ET on NBC` |
| L8 | **Weekday ranges and lists** | `Mon–Fri 1 AM UTC`, `Support 1 AM UTC, Mon–Fri`, `Sat & Sun 1 AM UTC`, `Mon, Wed, Fri at 1 AM UTC`, `Monday through Friday at 9 AM ET`. Still converts: `Fri at 1 AM UTC`, `Support 1 AM UTC, Mon` → `Support 5 PM PST, Sun` |
| L9 | **Weekday contradicts the date, or no nearby year matches** | `Friday, November 14, 2026 at 3 PM UTC`, `Mon, Jan 10, 2027 at 1 AM UTC`, `Sun, Jan 9 at 1 AM UTC` |
| L10 | **An offset the engine does not read** | `14:00 UTC - 5`, `14:00 GMT  +  1`, `Lunch 12:00 UTC-13:00 daily`, `2 PM UTC −3 PM UTC`, `2 PM UTC+3 PM UTC`, `1:30 PM UTC – 3:00 PM UTC+15`; with default Berlin: `10:00 UTC+5 PM`; (run): `12:00 UTC-13`, `12:00 UTC+15` |
| L11 | **An offset whose label does not confirm it** | `3:00 PM UTC+01:00 PST`, `10:00 UTC-04:00 ET` (ET is −5 in November), `9:00 UTC-10:00 CET` |
| L12 | **Ranges that cannot be read whole** | `1:30 PM UTC – 3:00 PM UTC on Friday, Nov 13`, `1:30 PM UTC – 1:30 PM UTC`, `Nov 14, 2026 1 PM UTC – Nov 13, 2026 1 PM UTC`; reader UTC: `Nov 13, 2026 9 PM PT – 11 PM ET`, `Jul 13, 2026 1:30 PM UTC – 3:00 PM CEST` |
| L13 | **Not a valid time or date** | `Score was 10:30-11:30 in the end`, `Version 5 UTC`, `November 13, 2026` (date only), `Feb 30, 2026 1:30 AM UTC`, `at 25:00 UTC`, `a 5 PM ESTimate`; (run): `13 UTC`, `1330 UTC`, `13h30 UTC`, `1:30 PM utc`, `Feb 29, 2027 1 AM UTC`, `2026-11-13 01:30+02:00` |
| L14 | **Zone-less with no site default** | `The show starts at 7:00 PM on Friday.`; with a default, a 24-hour `19:00` (run) |
| L15 | **Already in the reader's zone** | `Nov 13, 2026 5:30 PM PST`; reader Europe/London: `Nov 13, 2026 1:00 PM GMT` (run) |
| L16 | **Invalid target zone** | `1:30 PM UTC` with `Not/AZone` or an empty string |

## Edge cases

| Case | Original (reader) | Result |
|---|---|---|
| Daylight saving in the source zone | `July 4, 2026 at 6:00 PM UTC` | `…11:00 AM PDT`: the written date's offset |
| Skipped hour | `Mar 8, 2026 2:30 AM ET` (UTC) (run) | `Mar 8, 2026 6:30 AM UTC`: converted, not flagged (#28) |
| Repeated hour | `Nov 1, 2026 1:30 AM ET` (UTC) (run) | `Nov 1, 2026 5:30 AM UTC`, the first occurrence; not flagged (#28) |
| Midnight | `at 12:00 AM UTC` (run) | `at 4:00 PM PST (−1 day)` |
| Year boundary | `1 January 2027 at 03:00 UTC` | `31 December 2026 at 19:00 PST` |
| Year boundary forwards | `Dec 31, 2026 11:30 PM UTC` (Asia/Tokyo) (run) | `Jan 1, 2027 8:30 AM GMT+9` |
| Half-hour reader | `5 PM UTC` (Asia/Kolkata) | `10:30 PM GMT+5:30` |
| Quarter-hour reader | `Nov 13, 2026 1:30 AM UTC` (Asia/Kathmandu) (run) | `Nov 13, 2026 7:15 AM GMT+5:45` |
| Zones 25 hours apart | `11 PM UTC-11` (Pacific/Kiritimati) (run) | `12 AM GMT+14 (+2 days)` |
| Ambiguous label already in the reader's zone | `Nov 13, 2026 9:00 AM CST` (America/Chicago) (run) | Left alone; the China reading is not offered (#29) |
| `PT` in November | `Nov 13, 2026 3:00 PM PT` (UTC) (run) | `…11:00 PM UTC`, low; British Columbia: `…10:00 PM UTC`. Depends on the browser's time-zone data, which here has British Columbia on permanent daylight time |
| Small false positives | `3:00 PM CT scan`; `Week of Nov 9: 3 PM ET` (run) | Converted (`1:00 PM PST`; `Nov 9: 12 PM PST`) (#30) |
| Date elsewhere in the sentence | `On July 4 the show starts at 6 PM UTC` (run) | Read as today: `10 AM PST` (#27) |

## Non-goals

| Not handled | Issue |
|---|---|
| Ranges and lists sharing one zone | #11 ([Time ranges](Spec:-Time-ranges)) |
| Numeric dates, two-digit years, lower-case or all-caps months | #12 |
| Languages other than English | #14 |
| `<time datetime>` elements | #15 ([Time elements](Spec:-Time-elements)) |
| Timestamps split across elements | #16 |
| Choosing an alternative reading; remembered preferences | #17 ([Alternative readings](Spec:-Alternative-readings)) |
| Site default zone, target-zone override, season-mismatch setting | #20, #21 ([Settings](Spec:-Settings)) |
| Bundled domain-to-zone list | #22 |
| A date elsewhere in the sentence | #27 |
| Skipped and repeated daylight-saving hours | #28 |
| Ambiguous labels already in the reader's zone | #29 |
| Small false positives ("CT scan", "Week of Nov 9:") | #30 |
| Relative phrases ("in 3 hours"), date-only text | Not planned |

## Acceptance tests

All in `packages/core/test`; 154 tests pass at `84d9d93`.

| Rules | File › describe |
|---|---|
| B1, B13–B18, B21 | `convert.test.ts` › date and time together |
| B10–B12 | `convert.test.ts` › date and time together (offsets, labelled offsets); `left-alone.test.ts` › a hyphenated range is never read as a UTC offset |
| B19, B20, B23 | `convert.test.ts` › time on its own |
| B3, B5–B9 | `convert.test.ts` › zone interpretation, zone table |
| B29 | `convert.test.ts` › zone-less times; `left-alone.test.ts` › zone-less ranges…, a site default is not applied… |
| B32 | `convert.test.ts` › options |
| B24–B28 | `ranges.test.ts` (all blocks); `convert.test.ts` › things left alone |
| L1–L16 | `left-alone.test.ts` (one describe per group); `convert.test.ts` › things left alone; `ranges.test.ts` › a dated range |
| Formatter reuse | `convert.test.ts` › performance |

Rows marked "(run)" have no test yet. They should get one in `convert.test.ts` or `left-alone.test.ts`: the `MST`/`HST`/`AEST` literal reading, the `IST`/`BST`/`AST`/`PT`/`MT` alternatives, spelled-out names in the wrong season, `(+2 days)`, the zone-less 24-hour time, `Room 2000…`, the glued offset without `T`, lower-case labels, and the edge-case rows.
