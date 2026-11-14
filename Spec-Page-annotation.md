> Status: **As built** — records pull request #26; not yet confirmed by the owner · Issues: #7, #8, #9, #10 · Depends on: nothing

## Summary

On every web page, the extension shows times in the reader's own zone and puts a small clock icon after each one. Prose times are converted straight away. Log lines and ISO timestamps stay as written until the reader asks. The icon opens a popover with the original, how it was read, and buttons to switch one time or the whole page. The site's text, styles, layout, editors and key handling are never disturbed. This page records what pull request #26 built, at commit `84d9d93` (`apps/extension`): examples come from passing tests, and "(code)" marks behaviour read from the code that no test covers.

## Decisions for the owner

These choices were made during the build and its review. The owner has not confirmed them, and any of them can be reopened. Rows 1–6 are already in the Decision log. A reason marked "(inferred)" was read from the code; nobody wrote it down during review.

| # | Decision | Not taken | Why |
|---|---|---|---|
| 1 | The extension requests no permissions; `storage` was removed | Keeping `storage` for Settings | Nothing used it, and the owner had not agreed |
| 2 | Never touched: SVG, MathML, form controls and options, editable content (including content that becomes editable, which gets its own text back), non-HTML documents | Annotating and hoping | Each was a reproduced page-corruption bug in review |
| 3 | Custom elements (`zoneshift-run`, `-mark`, `-text`, `-icon`), one wrapper per text node | `span` wrappers; splitting the text node | Site CSS for `span` restyled times; split nodes broke flex and grid layouts |
| 4 | A time is left alone when the neighbouring text would change how it reads | Reading each text node alone | "10:00 AM UTC" + "+2" was converted two hours wrong |
| 5 | Closing returns focus to the icon; keys and presses on the icon stay off the page; Escape is taken only while the popover is open | Default browser focus and event flow | Keyboard users lost their place; Enter on an icon also fired the page's handlers |
| 6 | Firefox ID `zoneshift@waviisoft.com`, declaring no data collection | — | Permanent once published; confirm before first publication (#23) |
| 7 | One icon per converted time, so each end of a range or list has its own icon and switches on its own | One icon per range | The engine returns one conversion per end; [Time ranges](Spec:-Time-ranges) (#11) recommends one icon |
| 8 | One popover note for any low-confidence reading: "The zone label is ambiguous, so this may be wrong." It also shows for a season mismatch | Separate wording per flag | Placeholder until alternative readings (#17) (inferred) |
| 9 | A time shown as written has a hollow, muted icon, whatever its confidence | An orange outline for low confidence | Fewer states to learn (inferred) |
| 10 | `tt` counts as code, along with `code`, `pre`, `samp`, `kbd` | Only the four in `docs/design.md` | Old markup for monospace text (inferred) |
| 11 | Also never touched: `noembed`, `noframes`, `xmp`, `plaintext`, and text outside `<body>` | Only the list in `docs/design.md` | Not rendered as page text (inferred) |
| 12 | A page-wide choice lasts for this page view and covers content added later; it is not remembered | Remembering it per site | Needs `storage`, so it waits for Settings (#20) |
| 13 | Every popover action closes the popover; clicking the icon again closes it too | Staying open after an action | One action is the common case (inferred) |
| 14 | Content added later is annotated in batches, 200 ms after the first change | Annotating at once | Streaming logs and live clocks change often (inferred) |
| 15 | Content is not annotated again while it is editable; it is annotated again once editing ends | Never again on that page | Pages switch editing on and off (inferred) |
| 16 | Top frame only: frames are not annotated | All frames | Not reviewed yet; covered by #32 |
| 17 | The reader's zone is the browser's zone; no site default is passed | A default zone | Needs Settings (#20, #21) |
| 18 | Times already in the reader's zone, and times the engine leaves alone, get no icon | A hollow "already local" icon | Only conversions carry an icon (inferred) |

## Behaviour

Reader zone America/Los_Angeles, now = Wed 2026-11-11 20:00 UTC.

**Icon and states**

- **B1** After every time the engine converts, the page shows a clock icon drawn in CSS: a circle with two hands, about 0.7em, taking the size of the surrounding text, with a gap before it on the reading-direction side. The time's own text is never underlined, coloured or restyled.
- **B2** Icon states:

  | State | Icon |
  |---|---|
  | Converted, high confidence | Solid blue (`#2563eb`), white hands |
  | Converted, low confidence (ambiguous label or season mismatch) | Solid orange (`#d97706`), white hands |
  | Shown as written (opt-in, or switched back) | Hollow, in the page's text colour, 55% opacity; full opacity on hover (code) |
  | Keyboard focus | 2px blue outline (code) |

- **B3** The icon is a focusable `role="button"` with `aria-haspopup="dialog"` and `aria-expanded`. Its label is "Converted to local time. Original: …" when converted and "Local time: …" when shown as written.

**Converted straight away, or on request**

- **B4** Prose times are converted when the page loads (when the document is idle).
- **B5** Times inside `code`, `pre`, `samp`, `kbd` (and `tt`, code) and ISO 8601 timestamps anywhere (`format: 'iso'`) are shown as written, with a hollow icon, until the reader asks. In a code block, a line break ends the text that is read with a time.

**Popover**

- **B6** A tap, click, Enter or Space on the icon opens one popover. Opening another closes the first, and clicking the same icon again closes it. The popover has role `dialog`, is labelled "Zoneshift", and is drawn in its own shadow root, so neither page styles nor a strict content-security policy affect it.
- **B7** Contents, in order:
  - **Original**, **Local**, **Read as** (the engine's description, such as "Central Standard Time");
  - for low confidence: "The zone label is ambiguous, so this may be wrong.";
  - **Show original here** (when converted) or **Convert to local time** (when shown as written), for this one time;
  - **Convert all times on this page**;
  - **Show all originals on this page**.
- **B8** Each button acts and closes the popover. The page-wide buttons switch every icon on the page, and content added later starts in that state.
- **B9** It is placed under the icon, or above it when there is no room, at least 8px inside the viewport, up to 320px wide (narrower on small screens). It follows the system's dark mode (code).
- **B10** Not built yet: alternative readings (#17) and **This is wrong** (#19).

| Page HTML | Reader sees |
|---|---|
| `<p>Starts Friday, November 13, 2026, at 1:30 AM UTC sharp.</p>` | `Starts Thursday, November 12, 2026, at 5:30 PM PST sharp.` + blue icon |
| `<p>Nov 20, 2026 9:00 AM CST</p>` | `Nov 20, 2026 7:00 AM PST` + orange icon; popover Read as "Central Standard Time", with the note |
| `<code>job ran Nov 13, 2026 1:30 AM UTC ok</code>` | Unchanged + hollow icon |
| `<p>Built at 2026-11-13T04:10:09Z by CI.</p>` | Unchanged + hollow icon |
| `<pre>2026-11-13T01:30:00Z INFO a␤2026-11-13T01:30:02Z WARN b␤</pre>` | Unchanged; two hollow icons |
| The `<pre>` above, after **Convert to local time** on the first icon | `2026-11-12T17:30:00-08:00 INFO a`; second line unchanged |
| `<p>At 1:30 AM UTC and 2:30 AM UTC.</p>`, first switched back | `At 1:30 AM UTC and 6:30 PM PST (−1 day).` |
| `<p>The show starts at 7:00 PM.</p>` | Unchanged, no icon (no zone) |

**Content added later**

- **B11** Text added to the page after load is annotated after 200 ms, in its default state or in the page-wide state if the reader chose one. This includes a replaced `<body>` (Turbo-style navigation) and content added to the new body.
- **B12** When text added next to a converted time changes how it reads, the conversion is undone and the text is read again with its new neighbour.
- **B13** Marks the page removes are not kept in memory. A clock that rewrites its text 50 times leaves one mark.

**Page structure**

- **B14** A text node holding a converted time is replaced by one `<zoneshift-run>` holding the text and, for each time, a `<zoneshift-mark>` with `<zoneshift-text>` and `<zoneshift-icon>`. The page's own text node is kept, unchanged, and can be put back at any time.
- **B15** The wrappers are reset (`all: unset`, no generated content) and inherit everything from the page. The icon's rules are `!important`, so rules such as `.meta *` or `*::before` cannot distort it. None of these rules applies to page elements.
- **B16** Text inside a link keeps the site's decoration (a wavy underline stays wavy), and the mark adds none.

**Text-node boundaries**

- **B17** A time is converted only if reading it together with up to 64 characters of neighbouring text gives the same match. Neighbouring text is read through inline elements (`a`, `b`, `span`, `em`, `code` …); a block element or line break ends it.
- **B18** A time at the edge of its text node is left alone if the next text continues it without a space: a letter, digit, `+`, `-`, `−`, a dash, `:` or `/`.
- **B19** Text before a time may only add a date or weekday that leaves the local time unchanged.

| Page HTML (text nodes split as shown) | Reader sees |
|---|---|
| `Call at 10:00 AM UTC` + ` sharp.` | `Call at 2:00 AM PST sharp.` |
| `<b>Friday</b> at 1:30 AM UTC` | `Friday at 5:30 PM PST (−1 day)` |
| `Nov 13 at ` + `1:30 AM UTC` | `Nov 13 at 5:30 PM PST (−1 day)` |

**Keyboard, focus and pointer**

- **B20** Opening the popover moves focus to its first button. Tab and Shift+Tab cycle through its buttons. Escape, or any action, closes it and returns focus to the icon. Focus moving elsewhere, or a click outside, closes it.
- **B21** Enter, Space and pointer presses on the icon never reach the page's handlers or a surrounding link, button or form: the icon in a link does not navigate, and in a submit button it does not submit. Other keys on the icon, and presses elsewhere in the link, still reach the page. Keys typed in the popover never reach the page.
- **B22** Escape is taken only while the popover is open. With it closed, Escape is the page's, for example to close the site's own dialog.
- **B23** The popover closes when the page, or a container around the icon, scrolls. It stays open when another box scrolls.

**Permissions and teardown**

- **B24** The extension requests no permissions, optional permissions or host permissions, and makes no network requests. Its content script runs on all URLs, in the top frame only.
- **B25** When the extension is updated, disabled or removed, it stops watching, closes the popover, removes its listeners and puts back every original text node (the same node objects).

## Left alone

No icon, and the HTML is unchanged byte for byte (annotator unit tests, unless "e2e" is shown).

| # | Case | Test HTML |
|---|---|---|
| L1 | **Not page text** | `<script type="text/plain">1:30 AM UTC</script>`, `<style>/* 1:30 AM UTC */</style>`, `<noscript>1:30 AM UTC</noscript>`, `<title>1:30 AM UTC</title>`; also `template`, `iframe`, `object`, `canvas`, `audio`, `video`, `noembed`, `noframes`, `xmp`, `plaintext`, and anything outside `<body>` (code) |
| L2 | **`<time>` elements** (for now, #15) | `<time datetime="2026-11-13T01:30Z">1:30 AM UTC</time>` |
| L3 | **SVG and MathML**, including HTML inside `foreignObject` | `<svg><text x="0" y="10">1:30 AM UTC</text></svg>`, `<svg><title>1:30 AM UTC</title>…</svg>`, `<svg><foreignObject><p>1:30 AM UTC</p></foreignObject></svg>`, `<math><mtext>1:30 AM UTC</mtext></math>`; e2e: SVG text still renders all 21 characters |
| L4 | **Form controls, options and values** | `<textarea>1:30 AM UTC</textarea>`, `<datalist id="d"><option>1:30 AM UTC</option></datalist>`, `<select><option>1:30 AM UTC</option><optgroup label="x"><option>2:30 AM UTC</option></optgroup></select>`, `<input value="1:30 AM UTC">`, `<button value="1:30 AM UTC">Send</button>`; on an XHTML page, `<textarea>` and `<select>` (unit and e2e) |
| L5 | **Editable content** | `<div contenteditable="true">1:30 AM UTC</div>`, `<div contenteditable="plaintext-only">1:30 AM UTC</div>`, a `contenteditable="false"` island inside an editor, `<div role="textbox" aria-multiline="true">1:30 AM UTC</div>` (also `searchbox`, `combobox`, `spinbutton`, code); e2e: a region made editable by CSS (`-webkit-user-modify: read-write`) |
| L6 | **Content that becomes editable** gets its own text nodes back, with no marks | `contenteditable` set (by the next microtask), focus entering a region made editable by a style, `designMode` switched on, annotated content moved into an editor. A script that switches editing on and reads the HTML in the same task still sees the marks |
| L7 | **A time that continues into the next element or node** | `<p>Call at <b>10:00 AM UTC</b>+2 tomorrow</p>`, `<p>From 1:30<b>–3:00 PM UTC</b></p>`, `<p>Built 2026-11-13T<b>01:30:00Z</b></p>`; split nodes `Call at 10:00 AM UTC` + `+2 tomorrow`, `From 1:30` + `–3:00 PM UTC`, `Call at 10:00 AM UTC` + ` tomorrow` |
| L8 | **A date before it that changes the offset** | `Jul 1, 2026 at ` + `1:30 PM UTC` (July is daylight time) |
| L9 | **Text added later that changes the reading** | `Call at 10:00 AM UTC`, then `+2 tomorrow` appended: back to `Call at 10:00 AM UTC+2 tomorrow`, no icon |
| L10 | **Non-HTML documents** | XML and SVG documents (unit and e2e: `/image.svg`, `/data.xml`) |
| L11 | **Its own output** | Annotating twice gives one mark; the popover is never annotated |
| L12 | **Site styling** (e2e) | Under `.meta span {…}` and `.hostile * {…}` rules the wrappers keep weight 400, the page's colour, no padding, border or margin, and no generated content; the icon matches an icon on a clean paragraph |
| L13 | **Layout** (e2e) | `display:flex; justify-content:space-between` container still has one child; a grid row keeps the text and its neighbour side by side |

## Edge cases

| Case | Result |
|---|---|
| Right-to-left text (`dir="rtl"`) | The gap before the icon is on the right (e2e) |
| Strict content-security policy (`default-src 'none'`) | The icon's stylesheet and the popover still apply (e2e) |
| Time inside a link | The icon opens the popover; the page does not navigate (unit and e2e) |
| Time inside a submit button | Click or Space on the icon does not submit the form (e2e) |
| Popover's time removed by the page | The popover closes (code) |
| `designMode` with marks present | Every mark is removed at the next change or focus (unit and e2e) |
| Every original restored | `setAll('original')` restores the exact text of 1,500 seeded random strings, and restore puts back the same node (fuzz) |
| Split text | Over 1,500 seeded random splits, no mark shows a reading the unsplit text does not support (fuzz) |

## Non-goals

| Not handled | Issue |
|---|---|
| `<time datetime>` elements | #15 |
| Timestamps split across elements (syntax-highlighted logs) | #16 |
| Alternative readings in the popover | #17 |
| Framework-owned text that the site rewrites or objects to; fallback to popover-only | #18 |
| **This is wrong** and feedback reports | #19 |
| Settings, per-site memory of the page-wide choice, site default zone | #20, #21 |
| Performance on very long pages | #31 |
| Accessibility review, frames, times updated in place | #32 |
| Safari; store submission | #24; #25 |

## Acceptance tests

At `84d9d93`: 73 annotator unit tests and 22 end-to-end tests (Chromium) pass.

| Rules | Tests |
|---|---|
| B1–B5, B14–B16, L1–L5, L7, L11 | `apps/extension/test/annotator.test.ts` › marking |
| B17–B19, B12, L7–L9 | `annotator.test.ts` › text-node boundaries |
| B8 | `annotator.test.ts` › switching |
| B6–B8, B20–B23 | `annotator.test.ts` › popover |
| B11–B13, B25 | `annotator.test.ts` › content added later |
| L6 | `annotator.test.ts` › editable content |
| L10 | `annotator.test.ts` › other documents |
| B17–B19, restore | `annotator-fuzz.test.ts` › fuzz |
| B1, B2, B4–B8, B11, B16, B20 | `apps/extension/e2e/extension.spec.ts` (fixture `e2e/fixtures/page.html`, strict CSP) |
| B24 | `e2e/manifest.spec.ts` |
| L3–L6, L10, L12, L13, B1, B11, B20–B23 | `e2e/page-safety.spec.ts` |

Not covered by a test: `tt` and the extra skipped elements, text outside `<body>`, popover placement and dark mode, hover opacity, `dblclick`/`auxclick`/touch presses, `keypress`, `beforeinput` as an edit signal, the popover closing when its time is removed, and any Firefox run.
