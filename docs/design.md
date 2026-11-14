# Zoneshift design

## Architecture

1. **Core engine** (`packages/core`): text in, conversions out. Each conversion
   carries the position, replacement text, instant, how the source zone was
   read, flags, and alternative readings. No DOM, no network, no dependencies.
2. **Page annotator** (content script): finds text nodes, replaces converted
   spans, draws the decoration and popover.
3. **Extension shell** (Manifest V3, built with WXT): settings, per-site
   options, locally stored feedback.

## Conversion rules

**When to convert**

- A wrong conversion is worse than a missed one. When the engine cannot be
  sure, it leaves the text alone.
- Only when the source zone is known. In order of trust: a zone in the text
  (`UTC`, `GMT+2`, `EST`, ISO 8601 offsets), then the user's default zone for
  the site, then (future) a bundled domain-to-zone list. Otherwise leave alone.
- The site default is not applied to a time next to a zone written in words
  that the engine does not resolve: "7 PM Pacific", "8 PM Eastern",
  "7 PM London time", "7 PM local time", "7 PM (London)", "Pacific: 7 PM".
- Text already in the reader's zone is left alone.
- Date-only text and relative phrases ("in 3 hours") are left alone.
- A time directly next to a date or day name the engine does not read
  ("07/04/2026 6:00 PM UTC", "july 4, 2026 at…", "2026-W46-5T01:30Z",
  "tomorrow at 6 PM UTC", "1 AM UTC on Mondays") is left alone, rather than
  converted as if it were today.
- A weekday that contradicts its date ("Friday, November 14, 2026", a
  Saturday) is left alone: one of them is wrong and we cannot tell which.
- A date without a year but with a weekday ("Sat, Jan 9") is read in the year,
  nearest to today, in which that date has that weekday; if none of last,
  this or next year matches, it is left alone. Without a weekday, the current
  year is assumed.

**Ranges and lists**

- A range ("1:30 PM UTC – 3:00 PM UTC", "9 AM UTC-10 AM UTC") or list
  ("1:30 PM UTC or 3:00 PM UTC", "3 PM ET / 12 PM PT") is converted only when
  every end carries its own zone, and then whole or not at all: if one end
  cannot be read, none is converted.
- Ranges and lists where only the last end has a zone ("1:30–3:00 PM UTC",
  "between 1:30 PM and 3:00 PM UTC", "1:30 or 3:00 PM UTC", "1:30/3:00 PM UTC",
  "9 till 5 PM ET") are left alone, and so are zone-less ranges under a site
  default ("7 PM–9 PM") and ranges with an end the engine does not read as a
  time ("9 AM ET to noon", "9 PM ET – midnight").
- Weekday ranges and lists ("Mon–Fri 1 AM UTC", "Sat & Sun",
  "Mon, Wed, Fri at…") are left alone: shifting one named day would mislead.
- A later end without a date takes the date of the end before it. A range end
  is the first such time after the start, so "Jul 13 11:30 PM UTC – 1:30 AM
  UTC" ends on 14 July; equal ends, ends more than a day apart, and ranges that
  run backwards are left alone. When the ends have different labels the end
  must fall after the start on the written date ("Nov 13 9 PM PT – 11 PM ET",
  which would need a 23-hour range, is left alone). A list item takes the same
  date; an item with another label ("11 PM PT / 2 AM ET") takes the date the
  item before falls on in its own zone.
- A later end that took the date of the end before it and lands on another
  day in the reader's zone is marked against the date as converted: "Nov 13
  9 AM UTC and 9 PM UTC" in Tokyo is "6 PM GMT+9 and 6 AM GMT+9 (+1 day)".
- A date written only after the last end ("1:30 PM UTC – 3:00 PM UTC on
  Friday, Nov 13") belongs to every end, which the engine cannot yet show, so
  the range is left alone.

**Zone labels**

- Generic names ("Pacific Time", `PT`, `ET`) resolve to a region through the
  time-zone database, never to a fixed offset.
- A label with several meanings (`CST`, `IST`, `BST`, `AST`; `PT` where British
  Columbia and the US west coast differ) is flagged low-confidence when the
  meanings give different instants, and the alternatives are offered.
- A standard/daylight abbreviation used in the wrong season ("3 PM EST" in
  July) is never silently reinterpreted. It is flagged, both readings are
  offered, and a setting picks which is shown first (default: the region's
  local time).
- `MST`, `HST` and `AEST` are always read literally, because parts of their
  regions do not observe daylight saving.
- A spelled-out standard/daylight name ("Central Standard Time") has one
  meaning; only the abbreviation (`CST`) gets the alternatives.
- A time given for several zones at once ("8 PM ET/PT", "8 PM ET/7c") is left alone.
- Offsets may be written `UTC+2`, `UTC +2`, `GMT + 1`, `UTC −5` (Unicode minus)
  or `UTC -5`, from UTC−12 to UTC+14. `UTC - 5`, with a hyphen between spaces,
  could be a range and is left alone; a UTC/GMT time is never converted while
  ignoring an offset after it.
- A plus sign or Unicode minus after UTC/GMT is always an offset, never a range
  dash. A hyphen followed by digits and a meridiem ("9 AM UTC-10 AM UTC") is a
  range dash.
- An offset followed by a zone label ("14:00 UTC+5:30 IST", "9:00 GMT-10:00
  HST") is converted once, at the written offset, when the label has that
  offset at that instant; the label is replaced with the reader's zone. If the
  label can never have that offset and the sign is a hyphen ("9:00 GMT-10:00
  GMT"), it is read as a range. Otherwise ("3:00 PM UTC+01:00 PST", or
  "UTC-04:00 ET" in winter) it is left alone.

**Output**

- The replacement mirrors the original: 12/24-hour, month and weekday style,
  ordinals, padding, punctuation.
- With a date, the weekday, day, month and year are re-rendered.
- A time on its own assumes today's date in the source zone and gets
  `(+1 day)` / `(−1 day)` when the day changes. In a time-only range, each
  end's marker is measured from the day the range starts.
- A `Z` time without an ISO date ("10:00Z") is shown with the zone name
  ("02:00 PST"), because a numeric offset glued to it would read as a range.
  Full ISO timestamps keep a numeric offset.
- A weekday with no date ("Friday at 1:30 AM UTC") shifts the weekday.
- A zone-less time converted through a site default gets the target zone name
  appended and an "assumed zone" flag.

**Not handled yet**

- Ranges and lists whose ends do not each carry a zone (see above).
- Numeric dates (`03/04/2026`), two-digit years, all-caps or lower-case month
  names: a time next to one is left alone. A date joined to its time by `·`,
  `•` or `:` (event listings: "Thu, Nov 12 · 7:00 PM EST") is read.
- A date elsewhere in the sentence ("On July 4 the show starts at 6 PM UTC")
  is not linked to the time, which is read as today.
- Languages other than English.
- `<time datetime>` elements (highest-confidence source; annotator work).
- Zone names come from the browser's `Intl` data, so some zones render as
  `GMT+1` rather than `CET`, and rule changes arrive only with browser updates.
  A bundled, updatable time-zone database is the fallback if this proves
  inadequate.

## Decoration and popover

- Every recognised time gets a small clock icon after it. The icon is the
  only decoration: the text itself is never underlined or restyled, so it
  cannot clash with the site's own styling. The icon is drawn in CSS (no image)
  and takes the surrounding text size.
  - Solid blue: converted. Solid orange: converted, low confidence.
  - Hollow, muted: recognised but left as written; conversion on request.
- Prose times are converted immediately. Timestamps in code and log blocks
  (`code`, `pre`, `samp`, `kbd`) and ISO 8601 timestamps anywhere are left as
  written until the reader asks, because they are often copied or compared.
- The popover can switch one time, or every time on the page in either
  direction. A page-wide choice also applies to content added afterwards.
  Remembering that choice per site belongs with settings.
- Tap or click (never hover-only, so it works on touch) opens a popover in a
  shadow root:
  - original text and how it was read;
  - alternative readings, one tap to switch (not built yet);
  - **Show original here** / **Convert to local time** for this one instance;
  - **Convert all times on this page** / **Show all originals on this page**;
  - **This is wrong** (not built yet): wrong zone, not a date/time, wrong
    date, day/month swapped, other, plus free text.
- A `MutationObserver` annotates content added after load. Framework-rendered
  pages can still overwrite or object to changed text nodes; the planned
  fallback leaves the text untouched and shows the conversion only in the
  popover.
- A timestamp split across several elements (syntax-highlighted logs) is not
  recognised yet.

## Feedback

Reports are stored locally and can be sent as a prefilled GitHub issue that the
user reviews before submitting. Each accepted report becomes a test case.
The extension itself makes no network requests.

## Settings

- On/off per site.
- Default zone per site, for zone-less times.
- Target zone override (default: the browser's zone).
- Season-mismatch default reading.
- Preferred reading of ambiguous labels, globally and per site.

## Browsers

| Target | Route | State |
|---|---|---|
| Chrome, Edge, Brave, Opera | Chrome Web Store, Edge Add-ons | Builds |
| Firefox desktop and Android | addons.mozilla.org | Builds |
| Safari on macOS | Xcode wrapper | Specified, not started |
| Safari on iOS/iPadOS | Same Xcode project, iOS target | Specified, not started |
| Chrome on Android | Not possible: no extension support | |

### Safari

- `wxt build -b safari` produces the web-extension bundle;
  `xcrun safari-web-extension-converter` wraps it in an Xcode project with
  macOS and iOS targets. The project is generated once and committed under
  `apps/safari`; the bundle is rebuilt into it on each release.
- Requires a Mac and a paid Apple Developer account. Distribution is through
  the App Store for both platforms.
- The containing app is a single screen explaining how to enable the extension.
- iOS constraints the shared code must respect from the start: tap-driven UI,
  popover sized for narrow viewports, no reliance on persistent background
  pages, and Safari's per-site permission prompts.

## Roadmap

1. Scaffold: repo, CI, extension skeleton. **Done.**
2. Core engine and test corpus. **Started**: see "Not handled yet".
3. Annotator on desktop Chromium and Firefox. **Started**: icon marker,
   popover, per-item and page-wide switching, late-added content. Remaining:
   `<time>` elements, alternative readings, split timestamps, framework
   fallback.
4. Settings and feedback flow.
5. Safari on macOS, then iOS.
6. Store releases and automated packaging.
7. Later: more languages, the bundled domain-to-zone list.
