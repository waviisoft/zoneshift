> Status: **Draft — awaiting owner approval** · Issue: [#15](https://github.com/waviisoft/zoneshift/issues/15) · Depends on: nothing

## Summary

Zoneshift reads the instant from a `<time>` element's `datetime` and converts the visible text, even text that states no zone, so bylines, blog dates and forum posts show in the reader's zone. Relative text ("3 hours ago") and times the site already localises are never rewritten.

## Decisions for the owner

1. **Relative text ("3 hours ago").** (a) Hollow icon; popover shows the exact local time. (b) Leave alone. **Recommend (a)**: it adds the exact time without rewriting anything.
2. **Date-only text ("November 13, 2026").** (a) Hollow icon only when the reader's local date differs from the date shown. (b) Always. (c) Never. **Recommend (a)**: an icon on every blog date is clutter.
3. **Text disagrees with `datetime`.** (a) Hollow icon; popover says so and offers conversion from `datetime`, orange if accepted. (b) Leave alone, no icon. **Recommend (a)**: usually the text is in the publisher's zone and `datetime` is right.
4. **Text the engine cannot mirror ("13.11.2026 09:00").** (a) Hollow icon, local time in the popover, no in-place conversion. (b) Leave alone, no icon. **Recommend (a)**: the answer without a garbled rewrite.
5. **`<time>` with no usable instant.** (a) Apply the ordinary text rules to its text. (b) Keep skipping it. **Recommend (a)**: such text is as convertible there as anywhere.
6. **A site script that keeps undoing a conversion.** (a) Write at most twice per element per page load, then fall back to (4). (b) No limit. **Recommend (a)**: no loops or flicker.

No new permissions are needed.

## Behaviour

**B1. Instant.** A trimmed `datetime` counts only if it is `YYYY-MM-DD`, `T` or a space, `HH:MM`, optional `:SS` and fraction of any length, then `Z` or `±HH:MM` / `±HHMM` within −12:00…+14:00, all fields in range. Anything else: L1.

**B2. Already localised.** Zone-less text that, read in the reader's zone, gives the instant (either reading of a repeated hour) is left alone, no icon.

**B3. Agreement.** Otherwise the text is read in the zone it states, or else at the `datetime` offset. It agrees when every field it shows (weekday, day, month, year, hour, minute, second) matches the instant in that zone, truncated or rounded to the text's smallest field. A missing year comes from the instant. Zone-less text must also agree in the site default zone, if the reader set one.

**B4. Converted.** Agreeing text converts in place under the existing output rules; `(±1 day)` for time-only text is measured from the instant's date at its offset. Solid blue, high confidence. For ambiguous or season-mismatched labels the agreeing meaning is chosen, with no alternatives.

**B5. Source.** Popover "Read as": `the page's machine-readable time (<datetime as written>)`, or `<zone description>, confirmed by the page's machine-readable time` when the text stated a zone.

**B6. Disagreement.** Not converted. Hollow icon; popover shows the local time from `datetime` and "The visible text does not match the page's machine-readable time." **Convert to local time** renders the instant in the text's format, orange icon. **Convert all times on this page** skips it.

**B7. Date-only text.** Never rewritten; no convert button. Hollow icon only when the local date differs; popover shows full local date and time.

**B8. Relative text** ("3 hours ago", "3h", "yesterday") with no clock time: as B7, but the icon always shows. "Today at 3:00 PM" is time-only text: the clock time converts, the words stay.

**B9. Unmirrorable** (no recognisable date/time, a range, or split across child elements): as B8.

**B10. Live elements.** The converted text replaces the element's own text node with a `zoneshift-run`, as for any text (#26), so the original node can always be put back; the `zoneshift-icon` goes right after the `<time>` element, outside it. Stopping, `restore`, and content becoming editable put the original text node back and remove that icon. The element's text is judged against `datetime` alone, so the text-node boundary rule does not apply inside it; `<time>` stays a boundary for times outside it, as today. Site changes to its text or `datetime` are re-evaluated within `MUTATION_DELAY` (today the observer on `documentElement` sees added nodes and `contenteditable` only, so text and `datetime` changes need watching too); Zoneshift's own writes are not. After two writes to one element, it falls back to B9. Never-touched rules (editable content, SVG, form controls) apply first.

**B11. Technical and ISO.** In `code`/`pre`/`samp`/`kbd`, or with ISO 8601 visible text, agreeing elements stay as written with a hollow icon until asked (existing rule).

Reader zone `America/Los_Angeles`; now 2026-11-13 10:00 AM PST (18:00Z).

| Markup | Reader sees |
|---|---|
| `<time datetime="2026-11-13T09:00:00Z">Nov 13, 2026, 9:00 AM UTC</time>` | `Nov 13, 2026, 1:00 AM PST`, blue |
| `<time datetime="2026-11-13T14:30:00+00:00">November 13, 2026 at 14:30</time>` (news byline) | `November 13, 2026 at 06:30 PST`, blue |
| `<time class="entry-date" datetime="2026-11-12T21:15:00+01:00">November 12, 2026 at 9:15 pm</time>` (WordPress) | `November 12, 2026 at 12:15 pm PST`, blue |
| `<time datetime="2026-11-13T15:00:00+05:30">Nov 13, 3:00 PM IST</time>` | `Nov 13, 1:30 AM PST`, blue; "India Standard Time, confirmed by…" |
| `<time datetime="2026-11-14T02:00:00+01:00">02:00</time>` | `17:00 PST (−1 day)`, blue |
| `<time class="u-dt" datetime="2026-11-13T15:00:00+0000">Today at 3:00 PM</time>` (forum) | `Today at 7:00 AM PST`, blue |
| `<time datetime="2026-11-13T17:45:00Z">Nov 13, 9:45 AM</time>` | unchanged, no icon (B2) |
| `<time datetime="2026-11-13T09:00:00Z">Nov 13, 2026, 10:00 AM</time>` | unchanged, hollow; popover `Fri, Nov 13, 2026, 1:00 AM PST` + disagreement note |
| `<time datetime="2026-11-14T01:30:00+01:00">14 November 2026</time>` | unchanged, hollow; popover `Fri, Nov 13, 2026, 4:30 PM PST` |
| `<time datetime="2026-11-13T21:00:00+01:00">13 November 2026</time>` | unchanged, no icon (same local date) |
| `<time datetime="2026-11-13T15:00:00Z">3 hours ago</time>` | unchanged, hollow; popover `Fri, Nov 13, 2026, 7:00 AM PST` |
| `<time datetime="2026-11-13T15:00:00.000Z">3h</time>` (social feed) | unchanged, hollow; same popover |
| `<time datetime="2026-11-13T09:00:00+01:00">13.11.2026 09:00</time>` | unchanged, hollow; popover `Fri, Nov 13, 2026, 12:00 AM PST` |
| `<pre>… <time datetime="2026-11-13T09:00:00Z">2026-11-13T09:00:00Z</time></pre>` | unchanged, hollow; on request `2026-11-13T01:00:00-08:00` |

Today (#26) every row is unchanged with no icon: the annotator skips `<time>`. The in-place outputs were checked against the current engine with the zone written out ("November 13, 2026 at 14:30 UTC" → "November 13, 2026 at 06:30 PST", "02:00 UTC+1" → "17:00 PST (−1 day)"), since it does not read `datetime`; popover texts (`Fri, Nov 13, 2026, …`) are new wording, not engine output.

## Left alone

No icon and no change unless stated.

**L1.** Non-instant `datetime` values get only the ordinary text rules (decision 5):

| Kind | Examples |
|---|---|
| Date, month, week, year | `2026-11-13`, `11-13`, `2026-11`, `2026-W46`, `2026` |
| Time or offset only | `09:00`, `09:00Z`, `+05:30` |
| Duration | `PT2H`, `2h 30m` |
| Local date-time, no offset | `2026-11-13T09:00`, `2026-11-13 09:00` |
| Invalid | `2026-13-45T25:00Z`, `2026-11-13T09:00+25:00`, `Nov 13 2026 9:00 UTC`, `1763024400`, `""` |

**L2.** Site-localising custom elements `relative-time`, `local-time`, `time-ago`, `time-until`, `<time is="relative-time">` (GitHub): no icon, and their fallback text (`Nov 13, 2026, 3:00 PM UTC`) is not processed. Today only `<time is=…>` is skipped; the other elements' text is annotated like any text, so they join the never-touched list.

**L3.** `datetime`, `title`, `class` and `data-*` attributes are never modified; the element is never removed or replaced.

**L4.** Relative text with a `title` holding a date or time: `<time datetime="2026-11-13T15:00:00Z" title="Friday, November 13, 2026 at 7:00:00 AM PST">3 hr. ago</time>`.

**L5.** Empty `<time>`, or text with no digits or relative words.

**L6.** Date-only text whose `datetime` is midnight at its own offset (`2026-11-13T00:00:00Z`): a placeholder time.

**L7.** Relative, date-only and unmirrorable text, even on **Convert all times on this page**; text outside the element ("Posted by").

**L8.** `<time>` inside content Zoneshift never touches (editable regions, SVG and MathML, form controls): skipped as today, whatever its `datetime`.

## Edge cases

Reader `America/Los_Angeles` unless stated.

| Case | Expected |
|---|---|
| Repeated hour: `datetime="2026-11-01T01:30:00-08:00"`, "Nov 1, 2026, 1:30 AM" (or `-07:00`) | Left alone (B2: either reading counts) |
| Skipped hour: `datetime="2026-03-08T02:30:00-08:00"`, "Mar 8, 2026, 2:30 AM" | `Mar 8, 2026, 3:30 AM PDT` |
| Year boundary: `datetime="2027-01-01T03:00:00+00:00"`, "Jan 1, 2027, 03:00" | `Dec 31, 2026, 19:00 PST` |
| No year, last year: `datetime="2025-12-31T23:00:00Z"`, "Dec 31, 11:00 PM", seen in 2026 | Agrees; `Dec 31, 3:00 PM PST` |
| Half-hour zones: "9:00 AM UTC" at `2026-11-13T09:00:00Z`, reader `Asia/Kolkata` / `Asia/Kathmandu` | `2:30 PM GMT+5:30` / `2:45 PM GMT+5:45` |
| Rounding: `datetime="2026-11-13T09:00:59.900Z"` | "9:00 AM UTC", "9:01 AM UTC" agree; "9:02 AM UTC" disagrees (B6) |
| Wrong weekday: "Thu, Nov 13, 2026, 9:00 AM", instant is a Friday | Disagreement (B6) |
| Site default `Europe/Paris`, `datetime="2026-11-13T10:00:00Z"`, "10:00 AM" | Disagreement (B3, B6) |
| False `Z`, no site default | Undetectable; converted per B4; reader can show the original |
| `<time>` inside a link | Tapping the icon does not follow the link |
| Feed refresh changes `datetime` | Re-evaluated (B10); popover shows the current value |

## Non-goals

- Timestamps outside `<time>`: `title`-only spans, `data-time` attributes, JSON-LD and `itemprop="datePublished"` — no issue yet.
- Ranges ([Time ranges](Spec:-Time-ranges), #11), numeric dates (#12), non-English text — "Not handled yet" in docs/design.md.
- Per-site setting to hide relative-text icons — settings (roadmap 4).
- Alternative readings ([Alternative readings](Spec:-Alternative-readings), #17), **This is wrong** — own issues.

## Acceptance tests

| Rule | Level | Check |
|---|---|---|
| B1, L1 | Engine unit | Every L1 value rejected; `±HHMM`, 1–9 fraction digits, −12:00/+14:00 limits accepted |
| B2 | Engine unit | Reader-zone match, both readings of the repeated hour |
| B3 | Engine unit | Field agreement; year from instant; truncation and rounding; wrong weekday; site-default guard |
| B4 | Engine unit | Every example and edge-case string exactly; `IST`/`CST`/`EST`-in-July resolve high, no alternatives |
| B5, B6 | Annotator unit | Both "Read as" wordings; disagreement note; convert gives orange; page-wide convert skips |
| B7–B9, L7 | Annotator unit | Text unchanged, hollow icon, no convert button; date-only icon only when date differs |
| B10, L3 | Annotator unit | Icon is the element's next sibling; attributes identical after annotate, convert, revert; stop and `restore` put back the same text node and remove the icon |
| B4 | Annotator unit | The existing test listing `<time datetime="2026-11-13T01:30Z">1:30 AM UTC</time>` among markup that is never marked flips: it now converts |
| L2, L8 | Annotator unit | `relative-time` and friends, and `<time>` in an editable region, unchanged with no icon |
| B11 | Annotator unit | `<time>` in `pre` and ISO text start as written |
| L2, L4–L6 | Annotator unit | No icon, no DOM change |
| Decision 5 | Annotator unit | `<time datetime="2026-11-13">Nov 13, 9:00 AM UTC</time>` converted by text rules |
| B10 | End-to-end | Script updating "x minutes ago" every second for 10 s: zero Zoneshift mutations, no flicker |
| B10 | End-to-end | Script resetting converted text on every change: at most two writes, then B9, page stable |
| B10 | End-to-end | Changed `datetime` re-evaluated within `MUTATION_DELAY` |
| L2 | End-to-end | GitHub `relative-time` fixture untouched (Chromium, Firefox) |
| B6–B9 | End-to-end | Popover usable by tap at 360 px width |

## Changes to docs/design.md

- **When to convert**: `<time datetime>` instants first in the trust order; new "Machine-readable times" subsection (B1–B11).
- **Never touched**: remove "`<time>` elements (for now)"; add `relative-time`, `local-time`, `time-ago`, `time-until` (L2).
- **Text-node boundaries**: the text inside `<time>` is judged against `datetime`, not its neighbours (B10).
- "Date-only text and relative phrases are left alone": add "inside `<time>` they may get a hollow icon".
- **Not handled yet**: remove `<time datetime>` elements.
- **Decoration and popover**: hollow icons may lack a convert action; `<time>` icon after the element; disagreement note; "machine-readable time" wording.
- **MutationObserver**: `<time>` text and `datetime` changes are re-evaluated (the observer also watches text changes and the `datetime` attribute), own writes ignored, two-write limit.
- **Roadmap 3**: remove `<time>` elements from "Remaining".

## Revision history

- 2026-11-13: Reconciled with #26 (commit 84d9d93): confirmed `<time>` is still skipped; B10 aligned with custom elements, `restore`/stop, the text-node boundary rule and the observer on `documentElement` (which today sees no text or `datetime` changes); L2 notes the custom elements are not skipped today; L8 added; in-place example outputs checked against the current engine with the zone written out (all unchanged); acceptance tests add the existing test that flips and restore; design.md edits cover the never-touched list.
