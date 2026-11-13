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

- Only when the source zone is known. In order of trust: a zone in the text
  (`UTC`, `GMT+2`, `EST`, ISO 8601 offsets), then the user's default zone for
  the site, then (future) a bundled domain-to-zone list. Otherwise leave alone.
- Text already in the reader's zone is left alone.
- Date-only text and relative phrases ("in 3 hours") are left alone.

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

**Output**

- The replacement mirrors the original: 12/24-hour, month and weekday style,
  ordinals, padding, punctuation.
- With a date, the weekday, day, month and year are re-rendered.
- A time on its own assumes today's date in the source zone and gets
  `(+1 day)` / `(−1 day)` when the day changes.
- A weekday with no date ("Friday at 1:30 AM UTC") shifts the weekday.
- A zone-less time converted through a site default gets the target zone name
  appended and an "assumed zone" flag.

**Not handled yet**

- Ranges ("1:30–3:00 PM UTC") are skipped unless each end has its own zone.
- Numeric dates (`03/04/2026`), two-digit years, all-caps month names.
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
