> Status: **Draft — awaiting owner approval** · Issue: [#11](https://github.com/waviisoft/zoneshift/issues/11) · Depends on: nothing

## Summary

Ranges such as `1:30–3:00 PM UTC`, `1-3 PM UTC`, `9:00 AM UTC to 5:00 PM` and `Nov 12 11 PM – Nov 13 1 AM UTC` convert as one unit with one icon. Both ends move together, and the result never reads as a backwards range. Anything that only looks like a range, or where either end is uncertain, stays as written.

## Decisions for the owner

1. **v1 scope.** Options: the narrow set below, or include the deferred shapes too. **Recommended: narrow.** It covers every example in #11 with the fewest patterns. Deferred shapes are left alone whole (L1) and go to a follow-up issue.

   | In v1 | Deferred (left alone) |
   |---|---|
   | Separators `-` `–` `—` (any spaces or none); `to`, `until` | `through`, `thru`, `till`, `til`; `between X and Y` |
   | 12-hour, meridiem on the end or both ends; 24-hour with minutes on both | `noon`, `midnight`; mixed 12/24-hour |
   | Zone after the end; same label on both ends; zone on the first end only (decision 2) | Different labels as one unit (decision 3); lists (decision 4) |
   | Date or weekday before the start, or before each end | Date after the range or before the end only; ISO timestamps |

2. **Zone on the first end only** (`9:00 AM UTC to 5:00 PM`). Options: v1 with the L8 guard, or defer. **Recommended: v1 with the guard.** It is one of the issue's three examples.
3. **Zone on each end.** Options: (a) same label → one unit; different labels → two conversions as today, both left alone if they would read backwards; (b) always one unit; (c) always two. **Recommended: (a).** One unit fixes today's wrong `(−1 day)` on `11 PM UTC – 1 AM UTC`. Different labels are rare and often an equivalence (`1 PM UTC to 5 AM PST`).
4. **Lists sharing a trailing zone** (`9 AM, 1 PM and 5 PM UTC`). Today only the last item converts: "9 AM, 1 PM and 9 AM PST". Options: leave the whole list alone, keep today's behaviour, or convert every item (new issue). **Recommended: leave alone.** A half-converted list is a wrong conversion.
5. **Overnight inference** (end earlier on the clock, no dates). Options: next day if the range is then ≤ 12 h, always, or never. **Recommended: ≤ 12 h.** This keeps `10 PM – 2 AM` and night shifts, and rejects `3 PM to 1 PM UTC` (usually "moved from").
6. **Day marker on time-only ranges.** Options: (a) one marker for the start's day, after the whole range, or after the start when the converted range crosses midnight; (b) one per end; (c) always after the whole range. **Recommended: (a).** It can't be read as applying to the end alone.
7. **Icons.** Options: one per range, or one per end. **Recommended: one.** Half a range can then never show converted.

No new permissions or network access.

## Behaviour

**B1** Two times joined by a v1 separator, both readable, form one range. Words around it ("from", "between") are untouched. A range is one conversion: `index`/`length` span both ends, `epochMs` is the start, new `endEpochMs` is the end, `dayShift` is the start's.

**B2** Never half-converted. If either end can't be read (invalid hour or date, unknown zone, meridiem not inferable, end not after start, B8), the whole range is left alone, with no icon.

**B3** A zone after the end applies to both ends. A zone on the first end only applies to the end too (decision 2). With no zone, the site default zone applies to both ends, as for single times (end needs a meridiem, `assumed-zone` flag).

**B4** If only the end has a meridiem, the start takes it, unless the start would then be later on the clock than the end; then it takes the other one. So `11–1 PM` is 11 AM–1 PM, `10–11 PM` is 10–11 PM, and `9:30–12 AM` is 9:30 PM–midnight. A start with no minutes and no meridiem needs this (`1-3 PM`). 24-hour ranges need minutes on both ends.

**B5** In a time-only range, the start uses today's date in the source zone. The end is the next time that clock reading comes after the start (same day, or the next day within decision 5's cap). A date or weekday on each end is used as stated. A date or weekday on the start only applies to the start.

**B6** Each end renders as a single time would (clock, padding, added minutes, date style). The separator and its spacing are kept exactly. A shared element is written on both ends only when it no longer fits both:
- meridiem: the start gets its own if the ends land in different meridiems (`9:30 PM–12:00 AM`);
- zone label: the start gets its own label and meridiem if the target zone's name differs at the two ends;
- date or weekday: the end gets its own, in the start's format, if the ends land on different dates;
- site default zone: the target zone's name is added once, after the end.

**B7** A time-only range has at most one day marker. It gives the start's day, worded as for single times. It goes after the whole range, or directly after the start when the converted range crosses midnight. Ranges with a date or weekday get no marker.

**B8** The zone label is read once for the range. Confidence, flags and alternatives cover both ends, and each alternative is a whole-range rendering, so one tap switches both. If the ends get different season-mismatch verdicts, the range is left alone. A range is "already local" only if both ends are.

**B9** `UTC`/`GMT` followed directly by `-` or `–` and a time with its own meridiem or zone is a separator, not an offset (`1:30 PM UTC-3:00 PM UTC`). Today this is misread as UTC−3.

**B10** One icon goes after the range. The popover shows the whole original, the whole local range and how it was read. **Show original here** and the page-wide switches act on the whole range. In `code`/`pre`/`samp`/`kbd`, the range gets a hollow icon and converts only on request.

Examples use reader zone America/Los_Angeles and now = Wed 2026-11-11 20:00 UTC, unless the row says otherwise.

| Original | Reader sees | Rule |
|---|---|---|
| `Call between 1:30–3:00 PM UTC` | `Call between 5:30–7:00 AM PST` | B1, B3 |
| `Open 1-3 PM UTC` | `Open 5-7 AM PST` | B4 |
| `9:00 AM UTC to 5:00 PM` | `1:00 AM PST to 9:00 AM` | B3, decision 2 |
| `11–1 PM ET` | `8–10 AM PST` | B4 |
| `10–11 PM UTC` | `2–3 PM PST` | B4 |
| `13:00–15:30 UTC` | `05:00–07:30 PST` | B6 |
| `10 PM – 2 AM UTC` | `2 PM – 6 PM PST` | B5 |
| `11 PM UTC – 1 AM UTC` | `3 PM PST – 5 PM PST` (today: `5 PM PST (−1 day)` on the end) | B5, decision 3 |
| `1:30–3:00 AM UTC` | `5:30–7:00 PM PST (−1 day)` | B7 |
| `6 AM – 9 AM UTC` | `10 PM (−1 day) – 1 AM PST` | B7 |
| `12:30–3:00 PM UTC` (reader Asia/Tokyo) | `9:30 PM–12:00 AM GMT+9` | B6, B7 |
| `8–10 PM UTC` (reader Asia/Tokyo) | `5–7 AM GMT+9 (+1 day)` | B7 |
| `Nov 12, 1:30–3:00 PM UTC` | `Nov 12, 5:30–7:00 AM PST` | B6 |
| `Nov 12, 7–9 AM UTC` | `Nov 11, 11 PM–Nov 12, 1 AM PST` | B6 |
| `Friday 7–9 AM UTC` | `Thursday 11 PM–Friday 1 AM PST` | B6 |
| `Nov 12 11 PM – Nov 13 1 AM UTC` | `Nov 12 3 PM – Nov 12 5 PM PST` | B5, B6 |
| `1:30 PM UTC-3:00 PM UTC` | `5:30 AM PST-7:00 AM PST` (today: `8:30 AM PST`, read as UTC−3) | B9 |
| `Open 9 AM – 5 PM` (site default America/New_York) | `Open 6 AM – 2 PM PST`, flagged assumed zone | B3, B6 |

## Left alone

Nothing here converts or gets an icon unless the row says so. Reader and now as above.

| # | Case | Examples (all unchanged) |
|---|---|---|
| L1 | **Range-like phrases outside v1.** One end is never converted alone; the whole phrase stays as written, with any amount of whitespace. Today several of these convert the end only. | `noon–3 PM UTC`, `9 AM till 5 PM UTC`, `9 AM through 5 PM UTC`, `between 1 and 3 PM UTC`, `1 PM UTC – 3`, `3 PM UTC - 4 people` |
| L2 | **Numbers that are not times:** no meridiem and no minutes, so neither end is a time, even with a zone nearby | `pages 1-3`, `ages 9–5`, `won 3-1`, `1-3 hours`, `30–45 min`, `9 to 5`, `9–5 UTC`, `13–15 UTC`, `v2.1–2.3`, `555-0134`, `1-800-555-0199` |
| L3 | **Meridiem letters followed by a digit** are not a meridiem, even with a site default zone | `5-7 PM2.5`, `AM1–AM3 slots` |
| L4 | **Mismatched clocks:** mixed 12/24-hour, or a meridiem on the start only | `9 AM–17:00 UTC`, `9 AM–5 UTC` |
| L5 | **Date-only ranges.** A single time after a date range is not a time range and behaves as today (time-only, with the date range text untouched). | `Nov 12–14`, `12–14 November 2026`, `Nov 12 – Dec 3`; `Nov 12–14, 1 AM UTC` → `Nov 12–14, 5 PM PST (−1 day)` as today |
| L6 | **Lists sharing one zone** (decision 4): times joined by `,` `and` `or` `&` `/` where only the last carries the zone. This changes today's behaviour. Lists where every item has its own zone still convert item by item. | `9 AM, 1 PM and 5 PM UTC`, `1 PM or 3 PM UTC`, `between 1 PM and 3 PM UTC`, `9–10 AM, 1 PM UTC`; but `1 PM UTC, 3 PM UTC` → `5 AM PST, 7 AM PST` |
| L7 | **Different stated zones on the two ends** (decision 3) stay two separate conversions, as today. They are both left alone if the end's instant would come before the start's. | Reader UTC: `9 AM PT – 12 PM ET` → `5 PM UTC – 5 PM UTC`, two icons (an equivalence, not a range); `11 PM ET – 1 AM PT` left alone |
| L8 | **Zone on the first end, with a label of its own on the end:** a word such as `local`, `your time` or `local time`, or 2–5 capital letters that aren't a known zone | `9:00 AM UTC to 5:00 PM local`, `9 AM UTC – 5 PM BRT`, `9 AM UTC – 5 PM EOD` |
| L9 | **ISO timestamps** never join a range. Each stays an individual ISO timestamp (hollow icon) as today, and an ISO date before a range is deferred. | `2026-11-13T01:30Z–2026-11-13T03:00Z` (two hollow icons), `2026-11-13T01:30Z/2026-11-13T03:00Z` (two), `2026-11-13 01:30–03:00 UTC` (left alone) |
| L10 | **Implausible ranges:** zero length; an inferred overnight of more than 12 hours (decision 5); explicit dates running backwards | `3 PM – 3 PM UTC`, `3 PM to 1 PM UTC`, `6 PM – 7 AM UTC`, `9:00–5:00 UTC` (read as 24-hour: 20 h), `Nov 13 1 AM – Nov 12 11 PM UTC` |
| L11 | **Either end invalid** | `Feb 30, 1–3 PM UTC`, `11:30–13:00 PM UTC`, `10:00–25:00 UTC` |
| L12 | **Already in the reader's zone** at both ends | `1–3 PM PST`, `9 AM PT – 5 PM PT` |
| L13 | **Range split across elements:** a time at the edge of a text node, joined by a separator to a time or number in the adjacent inline text, is not converted alone. Today the end converts. | `<b>9 AM</b> – 5 PM UTC`, `<span>1</span>-3 PM UTC` |
| L14 | **Code and log blocks** (not converted automatically): the range is recognised and gets a hollow icon, but stays as written until the reader asks | `<code>2-3 PM UTC</code>`, `<pre>13:00–14:00 UTC</pre>` |
| L15 | **Dotted times** are not supported yet | `1.30–3.00 pm UTC` |

## Edge cases

| Case | Original (reader) | Result |
|---|---|---|
| Daylight saving changes in the source zone inside the range | `Nov 1, 2026 12:30–3:00 AM ET` (UTC) | `Nov 1, 2026 4:30–8:00 AM UTC`. Each end uses its own offset, so the range is 3 h 30 m. |
| Daylight saving changes in the target zone inside the range | `Nov 1, 2026 8:00–10:00 AM UTC` | `Nov 1, 2026 1:00 AM PDT–2:00 AM PST` (B6) |
| Season-mismatch verdicts differ between the ends | `Nov 1, 2026 12:30–3:00 AM EST` | Left alone (B8) |
| An end in a skipped or repeated local hour | `Nov 1, 2026 1:30–2:30 AM ET` | Each end is read exactly as a single time would be |
| Half-hour zone | `1–3 PM UTC` (Asia/Kolkata) | `6:30–8:30 PM GMT+5:30` |
| Ends at midnight | `10 PM – 12 AM UTC` | `2 PM – 4 PM PST`; in Tokyo, `7 AM – 9 AM GMT+9 (+1 day)` |
| Noon and midnight inference | `12–1 PM UTC`, `11–12 AM UTC` | Read as noon–1 PM and 11 PM–midnight (B4) |
| Year boundary | `Jan 1, 2027 7–9 AM UTC` | `Dec 31, 2026 11 PM–Jan 1, 2027 1 AM PST` |
| Year boundary in the other direction | `Dec 31, 2026 11 PM – 1 AM UTC` (Asia/Tokyo) | `Jan 1, 2027 8 AM – 10 AM GMT+9` |
| Overnight cap | `7 PM – 7 AM UTC` / `6 PM – 7 AM UTC` | The first (12 h) is converted; the second (13 h) is left alone |
| Ambiguous label | `Nov 13, 2026 9–11 AM CST` (UTC) | `Nov 13, 2026 3–5 PM UTC`, orange icon; alternative China Standard Time: `Nov 13, 2026 1–3 AM UTC` |
| Season mismatch on both ends | `July 15, 2026 1–3 PM EST` (UTC) | `July 15, 2026 5–7 PM UTC`, flagged season mismatch; alternative (EST taken literally): `July 15, 2026 6–8 PM UTC` |
| A change of time that reads like a range | `Moved from 9 PM to 1 AM UTC` | Read as an overnight range. Both clock times convert correctly. Known limit: if the writer meant an earlier time, a day marker (if shown) may be off. |

## Non-goals

- Deferred shapes from decision 1: a follow-up issue, to be filed when this spec is approved.
- Converting lists as a unit (a new issue, if decision 4 is accepted).
- Recognising ranges split across elements: goes with split timestamps (roadmap item 3).
- Popover UI for alternative readings (roadmap item 3). This spec only fixes what the alternatives contain.

## Acceptance tests

Engine unit:
- [ ] Every Behaviour example row, with the stated reader zone and now (B1–B9).
- [ ] A range yields exactly one conversion with `epochMs`, `endEpochMs` and `dayShift` as in B1.
- [ ] Every L1–L12 and L15 row gives exactly its stated result.
- [ ] Every Edge cases row.
- [ ] B8: alternatives of an ambiguous range are whole ranges; `confidence` is `'low'`.
- [ ] B9: `13:00 UTC-14:00 UTC` is a range; `Nov 13, 2026 10:00 UTC+2` is still an offset.
- [ ] The existing left-alone cases `Call between 1:30–3:00 PM UTC`, `Open 1-3 PM UTC` and `Open 9:00 AM UTC to 5:00 PM` move to the conversion tests; `Score was 10:30-11:30 in the end` stays left alone.

Annotator unit:
- [ ] One icon per range, after the end (B10).
- [ ] The popover shows the whole range; **Show original here** and the page-wide switches restore it exactly.
- [ ] L13 and L14.

End-to-end:
- [ ] Fixture page: `1:30–3:00 PM UTC` converts with one icon and toggles back exactly; `9 AM, 1 PM and 5 PM UTC` stays untouched.

## Changes to docs/design.md

- **When to convert:** add "A time that is one end of a range, or one item of a list sharing a zone, is never converted on its own."
- **Output:** add that a range converts as one unit, shared parts are written on both ends only when needed (B6), and there is one day marker (B7). Overnight inference is capped at 12 h.
- **Not handled yet:** replace the ranges bullet with the deferred shapes, and add lists.
- **Decoration and popover:** "every recognised time or range gets one icon". **Show original here** acts on the whole range.
