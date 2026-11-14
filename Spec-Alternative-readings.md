> Status: **Draft — awaiting owner approval** · Issue: [#17](https://github.com/waviisoft/zoneshift/issues/17) · Depends on: nothing to ship; per-site memory depends on Settings (#20)

## Summary

When a zone label could mean several things ("CST", "IST", "3 PM EST" in July), the popover lists each reading with the local time it gives; one tap switches the text. The choice lasts for the page; per-site memory comes with Settings (#20).

## Decisions for the owner

1. **What does a choice apply to?** (a) the tapped time only; (b) every time on this page written with the same label, including later content; (c) the tapped time, plus a "Use for all CST on this page" button. **Recommend (b):** a page means the same thing by "CST" each time. Under (a), drop B7 and the label part of B8; the two ends of a zoned range (#26 converts them as separate times) could then be read differently.
2. **Icon colour after a pick:** (a) stays orange; (b) blue; (c) a new style. **Recommend (b):** orange means "we guessed"; a pick is no longer a guess.
3. **A reading in the reader's own zone** (Dublin reader picks Irish for "3 PM IST"): (a) show its text, "3 PM GMT on Jan 14, 2027"; (b) show the original. **Recommend (a):** shows the label was resolved; every pick behaves alike.
4. **Icon colour: picked on this page versus remembered** (shared with [Settings](Spec:-Settings) decision 11, so both pages agree). This spec recommends blue after a pick (decision 2); Settings recommends a remembered preference stays orange (its decision 5). Options: (a) blue in both cases; (b) orange in both; (c) blue for a pick made on this page, orange when applied from memory. **Recommend (c):** a pick the reader just made is not a guess; a preference set long ago may not fit this page, and a label is never silently reinterpreted.

## Behaviour

For times with at least one `alternatives` entry. Today (#26) the popover shows Original, Local and Read as, one orange note ("The zone label is ambiguous, so this may be wrong.") for every low-confidence time, and its buttons; it offers no readings.

- **B1** Below "Read as", a "Possible meanings" list: the engine's reading, then `alternatives`, in engine order, which never changes after a switch.
- **B2** Each row is a button: line 1 is the page text under that reading; line 2 names the reading (wording table). The current row is checked (`aria-pressed="true"`). Rows wrap; no sideways scrolling. Rows join the popover's Tab cycle: Tab and Shift+Tab stay inside the popover, and opening still moves focus to its first button, now the first row.
- **B3** Reading names (also used by "Read as") give a place or fixed offset, never a raw zone ID; at most ~50 characters.
- **B4** The orange note says why, per flag (both if both), replacing today's single note; after a pick it changes (wording table).
- **B5** Tapping a row closes the popover, returns focus to the icon (as every popover action does), puts that row's line 1 in place of the time's text, updates "Local" and "Read as", and turns the icon blue. Tapping the checked row just confirms it (blue). A pick on a time shown as written (code, log) converts it.
- **B6** "Show original here" shows the original; "Convert to local time" then shows the chosen reading.
- **B7** A pick also applies to every other time (`zoneshift-mark`) on the page with the identical written label that offers the same reading (current or alternative): it switches and turns blue, keeping its shown/original state. Others are unchanged. Both ends of a zoned range such as `9 AM CST – 11 AM CST` carry the label, so a pick on one end switches the other (until [Time ranges](Spec:-Time-ranges) decision 3 makes such a range one unit).
- **B8** Times added later take any choice made for their label (and the page-wide state, as today).
- **B9** "Convert all" / "Show all originals" change state only, never readings.
- **B10** Choices last until the document is reloaded or replaced. Nothing is stored; no permission is added.
- **B11** Engine: each `Conversion` gains `label` (as written, e.g. "CST"); the conversion and each `Alternative` gain a reading key naming the zone read (`iana:America/Chicago`, `fixed:-360`). "Same reading" means equal keys.
- **B12** The icon's accessible label (`zoneshift-icon`, today "Converted to local time. Original: …") names the reading (wording table).

| Element | Wording |
|---|---|
| Row line 2 | if “CST” means China Standard Time (UTC+8) |
| Note, `ambiguous-zone` | “CST” has more than one meaning. Pick the one this page means. |
| Note, `season-mismatch` | “EST” is written, but New York is on daylight time (EDT) on this date. |
| Note after a pick | You chose this meaning. |
| Icon label | Converted to local time, reading CST as China Standard Time. Original: 3:00 PM CST on Jan 14, 2027 |

| Label | Reading names, engine order |
|---|---|
| CST | US Central Standard Time (UTC−6) · China Standard Time (UTC+8) |
| CST in summer | Central Time, Chicago clock (CDT on this date) · US Central Standard Time, exactly UTC−6 · China Standard Time (UTC+8) |
| EST in summer | Eastern Time, New York clock (EDT on this date) · Eastern Standard Time, exactly UTC−5 |
| IST | India Standard Time (UTC+5:30) · Irish Standard Time (Dublin) · Israel Standard Time (Jerusalem) |
| BST | British Summer Time (London) · Bangladesh Standard Time (UTC+6) |
| AST | Atlantic Standard Time (Halifax) · Arabia Standard Time (UTC+3) |
| MT in summer | Mountain Time (Denver) · Mountain Time, Arizona (no daylight saving) |

Examples: reader in America/Los_Angeles; now 2026-11-13 10:00 PST. Every line-1 text below is what the current engine (#26) gives as the conversion or an alternative.

| Original | First shown (icon) | Other rows, line 1 | After tapping second row |
|---|---|---|---|
| 3:00 PM CST on Jan 14, 2027 | 1:00 PM PST on Jan 14, 2027 (orange) | 11:00 PM PST on Jan 13, 2027 | 11:00 PM PST on Jan 13, 2027 (blue) |
| 3 PM EST on July 9, 2026 | 12 PM PDT on July 9, 2026 (orange) | 1 PM PDT on July 9, 2026 | 1 PM PDT on July 9, 2026 (blue) |
| 3 PM CST on July 9, 2026 | 1 PM PDT on July 9, 2026 (orange) | 2 PM PDT on July 9, 2026 · 12 AM PDT on July 9, 2026 | 2 PM PDT on July 9, 2026 (blue) |
| 9:30 AM IST, Thursday, January 14, 2027 | 8:00 PM PST, Wednesday, January 13, 2027 (orange) | 1:30 AM PST, Thursday, January 14, 2027 · 11:30 PM PST, Wednesday, January 13, 2027 | 1:30 AM PST, Thursday, January 14, 2027 (blue) |
| `15:00 CST Jan 14, 2027` in `<code>` | as written (hollow) | 13:00 PST Jan 14, 2027 (checked, not shown) · 23:00 PST Jan 13, 2027 | 23:00 PST Jan 13, 2027 (blue) |
| Page: "3:00 PM CST on Jan 14, 2027" and "Friday at 11 PM CST"; China picked on the first | both orange | — | 11:00 PM PST on Jan 13, 2027 · Friday at 7 AM PST, both blue |

## Left alone

- **L1** All text outside a time's own mark (`zoneshift-mark`).
- **L2** High-confidence times: no list. "10:00 AM MT, Jan 9, 2027" (Arizona agrees in winter); "9 AM PT, July 9, 2026" for a New York reader, shown as "12 PM EDT, July 9, 2026" (British Columbia and the US west coast agree on that date; for the Los Angeles reader it is L5).
- **L3** Other written labels, even with the same meaning: picking China for "CST" leaves "3 PM Central Standard Time" and "15:00 CDT" alone.
- **L4** Other times' shown/original state: a same-label code timestamp takes the reading but stays as written.
- **L5** Times with no icon because the first reading is already the reader's zone: "3 PM CST on Jan 14, 2027" for a Chicago reader; "9:00 IST on 14 January 2027" for a Kolkata reader. Offering readings for them is [#29](https://github.com/waviisoft/zoneshift/issues/29).
- **L6** Site-default (`assumed-zone`) times, spelled-out standard names ("3 PM Central Standard Time", fixed in #26), and `MST`, `HST`, `AEST`, `UTC`, numeric offsets: no alternatives, no list.
- **L7** Other tabs, frames, reloads (B10).
- **L8** The "Original" row and what "Show original here" shows.

## Edge cases

| Case | Original | Expected |
|---|---|---|
| Day/year change | 10 AM CST on Jan 1, 2027 | Rows: 8 AM PST on Jan 1, 2027 · 6 PM PST on Dec 31, 2026 |
| Time only | Friday at 11 PM CST | Rows: Friday at 9 PM PST · Friday at 7 AM PST; each reading assumes today in its own zone and carries its own "(+1 day)" marker when it needs one (neither does here) |
| Half-hour zone | 9:30 AM IST, Thursday, January 14, 2027 | India row keeps minutes: 8:00 PM PST… |
| DST day | 3 PM EST on Mar 8, 2026 | Rows: 12 PM PDT (New York clock) · 1 PM PDT (UTC−5) |
| Clock time that never existed | 2:30 AM EST on Mar 8, 2026 | One reading, UTC−5: 11:30 PM PST on Mar 7, 2026, high confidence. **Engine fix, [#28](https://github.com/waviisoft/zoneshift/issues/28):** today shows 10:30 PM PST on Mar 7, 2026, orange (1:30 AM EST, which nobody wrote), with 11:30 PM PST offered as the literal reading |
| Reading in reader's zone (Phoenix reader) | 10:00 AM MT, July 9, 2026 | Arizona row: 10:00 AM MST, July 9, 2026 (Decision 3) |
| Reading missing elsewhere | "Chicago clock" picked on a July CST | A January CST does not offer it (same instant as UTC−6); stays orange |
| Zoned range, China picked | Nov 13, 2026 9 AM CST – 11 AM CST | Both ends switch (B7). Today the end's China row reads "7 PM PST (−1 day)": its marker is measured from the engine reading's date (Nov 13), so after the pick the page would read "Nov 12, 2026 5 PM PST – 7 PM PST (−1 day)". Expected: no marker on the end, as its start is on Nov 12 under the same reading; whole-range alternatives ([Time ranges](Spec:-Time-ranges) B8) give this if that spec's decision 3 is (a) |
| Page re-renders a time | — | New copy is later content (B8) |
| Page text restored (extension stopped, content became editable) | — | The page's own text comes back whatever was picked; content annotated again later takes the choice (B8) |
| Popover closed by scroll or Escape | — | Nothing chosen; focus returns to the icon |

## Non-goals

- Remembering choices: Settings (#20). It must provide:

| # | Settings must define |
|---|---|
| S1 | Adding the `storage` permission, which the extension no longer requests (removed in #26; owner decision) |
| S2 | The site key: hostname; whether `www.` and subdomains share it |
| S3 | The entry: site + `Conversion.label` → reading key (B11) |
| S4 | Precedence: site choice, then global preference, then season-mismatch default, then engine order |
| S5 | When a pick is saved: every tap, or only via a "Remember for this site" control |
| S6 | Saved choices passed to the annotator at start and applied as a pick (B7, B8), with the icon colour from decision 4; keys an instance does not offer are ignored |
| S7 | Where the reader sees and clears saved choices |

- "This is wrong" feedback: roadmap 4.
- Readings for L5 times: #29. The never-existed engine fix: #28.

## Acceptance tests

- [ ] Engine unit — B11: `label` and unique reading keys for every label in the names table.
- [ ] Engine unit — B3: descriptions match the names table; none contains `/` (today "local time in America/New_York", "Mountain Time (America/Denver)" do).
- [ ] Engine unit — "never existed" edge case (#28).
- [ ] Engine unit — zoned-range edge case: the end's alternative carries no day marker.
- [ ] Annotator unit — B1, B2, B4: IST and summer-CST examples; rows in the Tab cycle.
- [ ] Annotator unit — B5, B6, L8: pick, confirm, code-block pick, original and back; focus on the icon after a pick.
- [ ] Annotator unit — B7, L3, L4: two-CST page plus "Central Standard Time" and a code CST; both ends of a zoned CST range.
- [ ] Annotator unit — B8, B9: later content; page-wide switching keeps readings.
- [ ] Annotator unit — L2, L6, B12.
- [ ] End-to-end (Chromium, Firefox) — B5 at 360 px width; no storage writes, and the manifest still requests no permissions (B10; existing `manifest.spec.ts`).

## Changes to docs/design.md

- Architecture: conversions carry the written label; readings a key and plain name.
- Zone labels: readings named by place or fixed offset; a clock time that never existed in the region is read literally only (#28).
- Decoration: "Solid blue: converted, or a reading the reader chose on this page. A reading applied from memory stays orange" (decision 4).
- Popover: replace "(not built yet)" on alternative readings with B1, B5, B7, B10; the per-flag note replaces the single low-confidence note.
- Settings: the ambiguous-label preference stores label → reading key.
- Roadmap 3: drop "alternative readings" from Remaining.

## Revision history

- 2026-11-13: Reconciled with #26 (commit 84d9d93): spelled-out names no longer get alternatives (L6, Non-goals); never-existed fix referenced as #28 and the reader's-zone gap as #29; B2, B5, B7, B12 and L1 aligned with the new popover and custom elements (focus stays in the popover and returns to the icon); range ends now carrying their own alternatives noted (decision 1, B7, new edge case); decision 4 added to agree icon colour with Settings; examples re-run through the current engine (L2 example corrected); S1 and S6 updated.
