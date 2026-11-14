Decisions about Zoneshift, newest first within each section. A spec page holds the detail; this page says what was decided, by whom, and where it is written down. **Owner** means decided by the project owner. **Build** means decided during implementation or review and not yet confirmed by the owner; these can be reopened.

## Product rules (Owner)

| Decision | Detail |
|---|---|
| Convert only when the source zone is known | Stated in the text, or the reader's default zone for that site. Otherwise the text is left alone. A bundled domain-to-zone list is wanted later ([#22](https://github.com/waviisoft/zoneshift/issues/22)). |
| A wrong conversion is worse than a missed one | When the engine cannot be sure, it leaves the text alone. Every new pattern needs a "left alone" test. |
| Zone labels are read cautiously | Generic names ("Pacific Time") resolve by region through the time-zone database, never a fixed offset. A label is never silently reinterpreted: it is flagged and the alternatives are offered. |
| The only decoration is an icon | The site's text is never styled, because sites have their own text decoration. |
| Log lines and ISO 8601 timestamps are opt-in | Left as written, with the option to convert one or the whole page. |
| The reader stays in control | The reader can see the original, show it in place, and say a conversion is wrong and why. |
| Feedback goes to GitHub | As a prefilled issue the reader reviews first. The extension makes no network requests of its own. |
| No new permissions without the owner's agreement | Applies to every feature. |
| Browsers | Chromium, Firefox, Safari on macOS and iOS. Safari ([#24](https://github.com/waviisoft/zoneshift/issues/24)) and store submission ([#25](https://github.com/waviisoft/zoneshift/issues/25)) wait for the owner. |
| Name and licence | Zoneshift, MIT. |

## Process (Owner, 2026-11-13)

| Decision | Detail |
|---|---|
| Product specs live on this wiki | A feature that changes what a reader sees gets a spec page before code is written. |
| The owner approves specs | A spec is Draft until the owner approves it. |
| Code is merged on an independent reviewer's approval | Each code pull request is reviewed by an agent that did not write it; the coordinator merges once that reviewer approves and CI is green. One pull request per issue. |
| Every change has tests | Engine, page and end-to-end, plus a "left alone" test for nearby text. |
| No AI model names in commits, pull requests or code | |

## Product decisions made during the build (Owner)

| Date | Decision | Detail |
|---|---|---|
| 2026-11-13 | Conversions are written into the page's text in place for the first slice, with a known limitation. Showing them without changing the page's own text must be specified and built before any store release. | A site that reads its own page (an editor that builds itself from the page's HTML, or a click-to-edit field filled from the visible text) can save the converted time into its data; no signal arrives in time to put the original back. Reproduced in the review of [#26](https://github.com/waviisoft/zoneshift/pull/26). Accepted for now because nothing is published. Tracked in [#34](https://github.com/waviisoft/zoneshift/issues/34), which blocks [#25](https://github.com/waviisoft/zoneshift/issues/25). |

## Engine (Build)

Full detail: [Conversion rules](Spec:-Conversion-rules). Also written down in `docs/design.md` and tested in `packages/core/test`. Decided in the first slice and its review ([#26](https://github.com/waviisoft/zoneshift/pull/26)).

| Date | Decision | Why |
|---|---|---|
| 2026-11-13 | A time that is one end of a range, or one item of a list, converts only when every end carries its own zone. Otherwise the whole range or list is left alone. | Half-converted ranges ("between 1:30 PM and 7:00 AM PST") were the most common wrong output in review. Shared-zone ranges are specified separately in [Time ranges](Spec:-Time-ranges). |
| 2026-11-13 | Ranges ending in "noon" or "midnight", weekday ranges and lists ("Mon–Fri 1 AM UTC"), and times given for several zones ("8 PM ET/PT") are left alone. | Same reason. |
| 2026-11-13 | A time next to a date the engine cannot read (numeric, lower-case or all-caps month, ISO week date) is left alone, not converted as today. | Converting as today gives the wrong daylight-saving offset and leaves a stale date. Numeric dates are [#12](https://github.com/waviisoft/zoneshift/issues/12). |
| 2026-11-13 | A date joined to its time by `·`, `•` or `:` is read ("Thu, Nov 12 · 7:00 PM EST"). | Common event-listing style. |
| 2026-11-13 | A year-less date with a weekday takes the nearest year in which the weekday matches; a weekday that contradicts its date is left alone. | "Sat, Jan 9" written in November means next January. |
| 2026-11-13 | `+` and the Unicode minus are never a range dash. A hyphen after UTC/GMT is an offset unless what follows makes it a second time. An offset may carry its own label ("UTC+5:30 IST") and is read once when they agree. Negative offsets stop at −12. | "9 AM UTC-10 AM UTC" was read as UTC−10. |
| 2026-11-13 | A bare Zulu time ("10:00Z") is shown with the zone name; a full ISO timestamp keeps its ISO shape with a numeric offset. | "02:00-08:00" reads like a range. |
| 2026-11-13 | A site default zone is not applied when a zone is written in words next to the time ("7 PM Pacific", "7 PM London time"). | The default would override what the page says. |
| 2026-11-13 | A spelled-out standard or daylight name ("Central Standard Time") has no other meanings (it is not offered China Standard Time). It is still flagged, with the literal reading offered, when used in the wrong season. | The full name is not ambiguous, but a wrong-season name is still never silently reinterpreted. |
| 2026-11-13 | An invalid target zone gives no conversions; it does not throw. | A bad setting must never break a page. |
| Earlier | Custom parser, no `chrono-node`; the engine has no dependencies. | Mirroring the original format needs the position of every date part, and region-based zones meant overriding most of the library. |
| Earlier | "3 PM EST" in July defaults to the region's local time, flagged low-confidence, with the literal reading offered. `MST`, `HST` and `AEST` are always read literally. | |

## Page and extension (Build)

Full detail: [Page annotation](Spec:-Page-annotation).

| Date | Decision | Why |
|---|---|---|
| 2026-11-13 | The extension requests no permissions. `storage` was removed until the [Settings](Spec:-Settings) spec is approved. | Nothing used it, and the owner had not agreed to it. |
| 2026-11-13 | Never touched: SVG, MathML, form controls and their options, editable content (including content that becomes editable after load, which gets its original text back), and non-HTML documents. | Each was a reproduced page-corruption bug in review. |
| 2026-11-13 | Marks use custom elements (`zoneshift-run`, `zoneshift-mark`, `zoneshift-icon`), one wrapper per text node. | Site CSS aimed at `span` restyled the conversion, and splitting a text node broke flex and grid layouts. |
| 2026-11-13 | A time is left alone when neighbouring text in the next node or inline element would change how it reads. | "10:00 AM UTC" followed by "+2" in the next text node was converted two hours wrong. |
| 2026-11-13 | Closing the popover returns focus to the icon; keys and presses on the icon do not reach the page; Escape is taken only while the popover is open. | Keyboard users were sent to the top of the page; Enter on an icon also triggered the page's own handlers. |
| Earlier | Firefox extension ID `zoneshift@waviisoft.com`. Permanent once published; to be confirmed before first publication ([#23](https://github.com/waviisoft/zoneshift/issues/23)). | |

## Ideas considered, not decided

| Date | Idea | Where it stands |
|---|---|---|
| 2026-11-13 | A small on-device model to help detect date and time strings. | Feasible: a few-megabyte token-classification model can run in the extension with WebAssembly, bundled, with no network requests. It would judge context ("3:00 PM CT scan", lists, "Room 2000 at 6 PM UTC") and could only veto or tag; the conversion itself stays deterministic. It needs labelled real-world examples, which the feedback flow ([#19](https://github.com/waviisoft/zoneshift/issues/19)) would supply. Coordinator's recommendation: not in the first version; revisit once feedback reports exist. The owner has not decided. |
| Earlier | Proposing a web standard for localisable dates: extending `<time>` to accept RFC 9557 strings and opt in to browser localisation. | No work done. Zoneshift is in effect a prototype of the behaviour. |

## Open, waiting on the owner

- The decisions listed at the top of each Draft spec: [Alternative readings](Spec:-Alternative-readings), [Time elements](Spec:-Time-elements), [Time ranges](Spec:-Time-ranges), [Settings](Spec:-Settings).
- Icon colour when a reading was chosen: the two specs recommend differently (blue after a pick on the page; orange for a remembered preference).
- Whether the Build decisions above stand.
