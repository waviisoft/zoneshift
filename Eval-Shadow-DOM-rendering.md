> Status: **Evaluation** — for the owner's decision · Issue: [#34](https://github.com/waviisoft/zoneshift/issues/34) · Prototype: branch [`eval-34-shadow-dom`](https://github.com/waviisoft/zoneshift/tree/eval-34-shadow-dom) (not for merging)

Branch `eval-34-shadow-dom`, prototype commit `96d562b` on top of `7a67bda`.
Everything marked "verified" was run in Chromium 153 (Chrome for Testing)
through Playwright with the built extension loaded, on pages served with the
strict content-security policy the e2e tests use. Firefox and Safari were not
run; what is said about them is marked **UNVERIFIED**.

## Verdict

**Adopt, with conditions, but not in the form proposed.**

The proposed form leaves the original text unrendered in the light DOM. That
fixes `textContent`, `innerHTML` and `cloneNode`, but it breaks `innerText`
and `Selection.toString()`: both drop the time completely. A click-to-edit
field filled from `innerText` saved `"Due "`. That loses data, which is worse
than today, where the site saves a converted but correct time.

Keeping the original slotted, inside a zero-size, clipped, `aria-hidden` box,
fixes this. Every read API I tried then returns the original (one exception:
a selection that the reader starts inside a time, A2), and the reader
sees exactly what they see today: 16 of 16 styling cases matched the current
build pixel for pixel. The conditions are:

1. The original stays slotted in a hidden box. It is not left unslotted.
2. There is one shadow host per mark, inside the existing `<zoneshift-run>`.
   No root per run, and no shadow root on the page's own elements (see C8,
   C10).
3. Copy and drag-and-drop get a new handler that serialises the flat tree
   through `Selection.getComposedRanges()`. Without it, pasting into a rich
   editor carries our internal markup and *both* times.
4. Before the work is specified, Firefox and Safari are checked for five
   behaviours: `innerText`, plain-text copy, find-in-page,
   `adoptedStyleSheets` from a content script, and `getComposedRanges`.
5. The owner accepts the costs in C8 (about +12–30 % renderer memory, about
   1.0–1.4× annotate time) and the reader-visible rough edges in decisions
   D3 and D4.
6. Shadow DOM is not counted as a fix for #18 (framework-held text nodes). It
   does not help there (C10).

## What was built

`apps/extension/lib/shadow-annotator.ts`, chosen at build time with
`VITE_ZS_RENDER` (`eval-build.sh` builds every variant into `/tmp/zs-ext/`).
The shipping annotator is untouched and still builds by default. Layouts
compared:

| Name used below | Light DOM the page sees | Shadow root renders |
|---|---|---|
| **Current** | `<zoneshift-run>` + `<zoneshift-mark>` + converted text in `<zoneshift-text>` + `<zoneshift-icon>` | none |
| **Mark, unslotted** (as proposed) | `<zoneshift-run>Starts <zoneshift-mark>1:30 AM UTC</zoneshift-mark> today</zoneshift-run>` | per mark: converted text + icon; the original is not rendered |
| **Mark, hidden** (recommended) | same as above | per mark: converted text, then the original slotted into a 0×0 `overflow:hidden` `aria-hidden` box, then the icon |
| **Run** | `<zoneshift-run>` holding the page's own, unsplit Text node | per run: the whole text node, with conversions and icons |
| **In place** | nothing changes; the page's own `<p>`/`<div>`/`<span>` becomes the host | manual slot assignment: other children slotted, the text with the time rendered |

Evaluation pages are in `apps/extension/eval/` (`a-reads`, `b-reader`,
`c-style`, `d-perf`, `e-engineering`, `f-copy`, `g-drag`, `h-dnd`). Run them
with `EXT=/tmp/zs-ext/<variant> pnpm exec playwright test -c eval/playwright.config.ts`.

## Results

"Hidden" means the recommended layout (mark, hidden) unless a row says
otherwise.

| # | Question | Result | Evidence |
|---|---|---|---|
| A1 | The three reproductions | **Solved by every shadow layout.** Same-task snapshot: `<p><zoneshift-run>Snapshot at <zoneshift-mark>4:30 AM UTC</zoneshift-mark>.</zoneshift-run></p>`. Quill-style editor saved the same markup with the original time. Input filled from `textContent`: `Due 3:30 AM UTC`. In place leaves the snapshot byte-identical (`<p>Snapshot at 4:30 AM UTC.</p>`). Current saves `8:30 PM PST (−1 day)` plus our attributes. | `a-reads` A1 |
| A1 | …input filled from `innerText` | **Unslotted: `"Due "` (the time is lost).** Hidden: `Due 3:45 AM UTC` (original). Run and in place, unslotted: `""` (the whole run's text is lost). | `a-reads` A1 |
| A1 | Markup in a snapshot; sanitisers | The snapshot holds one wrapper element per text node and one per time, with **no attributes** and the original text. DOMPurify 3.4 with its default config removes unknown and custom elements but keeps their content, so the snapshot becomes `<p>Snapshot at 4:30 AM UTC.</p>`. Current becomes `…8:30 PM PST (−1 day).` A variant with no light-DOM change exists (in place), but it is rejected (C10). | `/tmp/dp/dp.cjs` (jsdom) |
| A2 | `textContent`, `innerHTML`, `cloneNode` | Original in every shadow layout. | `a-reads` A2 |
| A2 | `innerText`, `Selection.toString()` | Unslotted: `"Maintenance starts  and should take an hour."` (time missing). Hidden: original. Run/in place (hidden): `innerText` is the original, but **`Selection.toString()` after a mouse drag is `""`**, because the selection collapses to the host in the light DOM. **Every shadow layout:** when the reader's selection starts inside a time (a drag, a double-click), `Selection.toString()` gives the page the shown, converted text, cut at the end of that time (`"26 at 5:30 PM PST"`, `"November"`). | `a-reads`, `b-reader` B3, `g-drag` |
| A2 | `Range.toString()` | Original, every layout. | `a-reads` |
| A2 | Native copy (Ctrl+C) | Plain text: **converted**, in every layout (Chromium serialises the flat tree). HTML: our shadow markup, with inline styles; in the hidden layouts it also carries `<slot>original</slot>`. | `a-reads`, `b-reader` B3 |
| A2 | `execCommand('copy')`; a site's own copy handler | The handler's `getSelection().toString()` gets the original (hidden) or text with the time missing (unslotted). | `a-reads` |
| A2 | Drag-and-drop text | Into a textarea: converted (all layouts). **Into a rich editor, hidden: `…5:30 PM PSTFriday, Nov 13, 2026 at 1:30 AM UTC…` (both times).** Run: our spans and `<slot>` land in the site's editor. | `h-dnd` |
| A2 | `window.find` | Converted text: found, but the selection is retargeted to the host and its rectangle is 0×0. Hidden layouts: the **invisible original is also found** (rect 37×74 inside the 0-width box). | `b-reader` B4 |
| A2 | MutationObserver | Wrapper layouts: the same records as today (`P +ZONESHIFT-RUN −#text`). Attaching roots and switching times produce no records. In place: no records at all. | `a-reads` A2 |
| A2 | `:empty` | Hosts are never `:empty` (they hold the original), same as today. | `a-reads` |
| A2 | Layout and geometry | Element boxes (`<p>` height, host width) have the converted width, as today. **A Range over the page's own time text is 0×0 at x=0 (unslotted) or a tall, narrow box (hidden, 33×53),** not where the time is drawn. Site features that anchor to selected text (quote, highlight, comment) will be placed wrongly near times. | `f-copy` A2 rects |
| A2 | `caretPositionFromPoint` | Without the `shadowRoots` option it returns a host-level position (`zoneshift-run @1`; in place `body @0`). With our roots passed it returns the shadow text and offset. | `a-reads` |
| B3 | Selecting by drag, double-click, triple-click, Select All | **Highlight is identical to current** in all cases, including drags that start or end inside a time and continue into the next paragraph (screenshots). Double-click selects one word of the converted text. Native plain-text copy matches the highlight. | `b-reader` B3, `g-drag` |
| B3 | Can a copy handler carry the text as shown? | Yes for whole times. My light-DOM handler (mark layouts) produced correct plain text and HTML with the page's own structure (`<b>Friday</b>` kept, no Zoneshift markup); the paste into an editor was clean. **It failed when a drag started or ended inside a time** (`"26 at 5:30 PM PST"` instead of the rest of the line). A correct handler must walk the flat tree of `getComposedRanges()`. Native copy proves Chromium has this information, but the work is not done. | `f-copy`, `g-drag` |
| B4 | Find-in-page (Ctrl+F) | Not driven (browser UI). Inferred from `window.find`: the converted text matches. In the hidden layouts the invisible original probably matches too, highlighting nothing visible. **UNVERIFIED** for Ctrl+F in all browsers. | `b-reader` B4 |
| B5 | Accessibility | Chromium's accessibility tree (CDP) is identical to current for unslotted and hidden: `StaticText "Thursday, November 12, 2026, at 5:30 PM PST"` read once, the original not exposed, icon `button "Converted to local time. Original: …"`. (Playwright's own `ariaSnapshot` showed both texts for unslotted: that is a Playwright artefact, not the browser.) Screen-reader virtual cursors read the accessibility tree, so they should read the converted text once: **UNVERIFIED** with a real screen reader. | `b-reader` B5 |
| B6 | Printing | PDF shows the converted text (all layouts). | `b-reader` B6 |
| B6 | Save as MHTML | Chromium writes the root as `<template shadowmode="open">…converted…</template>` followed by the original light text. How it reopens: **UNVERIFIED**. "Webpage, Complete": **UNVERIFIED**. | `b-reader` B6 |
| B6 | Browser translation | Not run. Firefox Translations is reported not to handle shadow DOM ([bug 1841656](https://bugzilla.mozilla.org/show_bug.cgi?id=1841656)); Safari had the same report ([WebKit 253130](https://bugs.webkit.org/show_bug.cgi?id=253130)). Expected result: the sentence is translated but the converted time stays in English, and the light-DOM original may be translated invisibly. Chrome Translate: **UNVERIFIED**. | — |
| B6 | Reader modes, text-to-speech | Firefox Reader View works on a clone of the document, and clones carry no shadow roots, so it would show original times without icons. Chrome Reading Mode and speech built on the accessibility tree would show and read the converted text. **UNVERIFIED** (not run). | `e-engineering` C11 shows what a clone contains |
| B7 | Styling | **16 of 16 cases pixel-identical to current**, in every layout: link with a wavy underline, h1, bold/italic, `pre`, flex item, RTL, line-clamp, ellipsis, justify, hostile `.x *` rules with `::before`, descendant rules, `::first-line`, `::first-letter`, `text-transform` and tabular numbers, letter/word spacing, `::selection`. Two prototype bugs were found and fixed on the way: a `:host` reset restyled the page's own element in place, and a hidden box placed first took `::first-letter`. | `c-style` + `compare.py` |
| C8 | Performance | See the table below. One root per mark costs about +12 % renderer memory on 20k prose times and +21 % on 50k log lines. The hidden original adds more. | `d-perf`, 3 runs each |
| C9 | Strict CSP, Trusted Types, XHTML | All work: no CSP or Trusted Types violations, icon styled. Both `adoptedStyleSheets` and a `<style>` element inside the root work from the content script under `style-src 'nonce-…'`. XHTML pages render the same. | `e-engineering` C9 |
| C9 | Page defines `zoneshift-mark` / patches `attachShadow` | **The page's custom-element constructor runs on elements the content script creates** (in current too: current then shows `"Meet at PAGE please."`). In the prototype the page attached its own root first, ours threw, and the time was left alone. Calls we make from the isolated world never pass through the page's patched `attachShadow`. | `e-engineering` C9 |
| C9 | Open vs closed | Open: the page reads the converted text via `host.shadowRoot`. Closed: `shadowRoot` is null to the page. Click and keyboard both work with closed roots (host bookkeeping plus pointer/focus tests). | `e-engineering` C9 |
| C9 | Isolated world vs page | Chromium shares the DOM between worlds: open roots attached by the content script are visible to the page. Firefox reaches page DOM through Xray wrappers and has open bugs on `adoptedStyleSheets` from content scripts ([1827104](https://bugzilla.mozilla.org/show_bug.cgi?id=1827104), [1817675](https://bugzilla.mozilla.org/show_bug.cgi?id=1817675)). The shipping popover already depends on this. **UNVERIFIED.** | — |
| C10 | Framework-held text nodes (#18) | **Shadow DOM does not help** in the mark or run layouts. Mark: the held Text node is detached (split), `removeChild`/`insertBefore` throw `NotFoundError`, and a `nodeValue` update is invisible, all as today. Run: the node stays intact but moves into the run, so the same throws happen. **Only "in place" fixes it:** `removeChild` and `insertBefore` succeed and `nodeValue` updates re-render. But in place is unsafe (next row). | `e-engineering` C10 |
| C10 | Why "in place" is rejected | (a) A child the page adds is **not laid out until our microtask runs**: width 0 and missing from `innerText` in the same task. (b) A shadow root cannot be removed: once we stop, or are unloaded in a browser that kills content scripts, **children added later stay invisible for good** (shown in the page world). (c) The page's own later `attachShadow` on that element **throws `NotSupportedError`**. (d) Only some elements can host a root (not `a`, `li`, `td`, `pre`, `code`, `b`…), so a wrapper fallback is needed anyway. (e) Flex items split unless wrapped (fixed in the prototype). (f) A drag selection is `""` to the page. (g) The slowest: 4.2 s longest task on 20k paragraphs. | `f-copy` C10/C9, `e-engineering` |
| C11 | Clones, copies, editing | A clone shows the original, with no icon; the prototype re-annotates it within 200 ms. That self-heals and is safe. Restore-on-edit is still needed (the caret cannot enter shadow text, and the wrappers must go), but it is no longer safety-critical. Without the caret fix, a click inside a time in click-to-edit put the caret at the start (`XCall at…`). | `e-engineering` C11, `a-reads` A1 |
| C12 | Tests and rules that change | Listed in "Engineering notes". Running the existing e2e suite against the prototype: 24 of 27 fail, nearly all at the shared wait for the light-DOM `.zoneshift` class. Unit tests (happy-dom) assert converted `textContent` throughout. | e2e run |

### C8 performance (medians of 3 runs; renderer RSS after GC)

| Page | Measure | No extension | Current | Mark, unslotted | **Mark, hidden** | Run, hidden | In place, hidden |
|---|---|---|---|---|---|---|---|
| 20k paragraphs, 1 time each | annotated after | — | 3.99 s | 4.12 s | 5.51 s | 5.17 s | 6.86 s |
| | longest task | 0.22 s | 2.03 s | 2.07 s | 2.29 s | 2.15 s | 4.21 s |
| | renderer RSS | 183 MB | 485 MB | 543 MB | 635 MB | 645 MB | 687 MB |
| | "Convert all" (longest task) | — | 1.30 s (0.72) | 1.38 s (0.71) | 2.34 s (1.56) | 1.58 s (0.87) | 1.55 s (0.79) |
| 50k-line `pre` (one text node) | annotated after | — | 3.84 s | 4.98 s | 5.71 s | 3.93 s | = run |
| | longest task | 0.25 s | 1.38 s | 1.79 s | 2.08 s | 1.41 s | = run |
| | renderer RSS | 174 MB | 622 MB | 750 MB | 773 MB | 631 MB | = run |
| | "Convert all" (longest task) | — | 3.00 s (2.01) | 3.77 s (2.17) | 5.34 s (3.63) | 2.70 s (1.75) | = run |
| 10k streamed lines | page's own loop (5.1 s without us) | 5.1 s | 15.5 s | 18.7 s | 17.6 s | 23.9 s | 22.0 s |
| | long tasks (max) | 0 | 44 (93 ms) | 93 (206 ms) | 57 (183 ms) | 168 (263 ms) | 160 (179 ms) |

Per mark against per run: in the 50k-line log, one root per mark (50k roots)
costs about +130 MB and +30 % annotate time over current. One root per run
(one root) costs nothing over current. On prose, where each text node has one
time, they are equal. Per run is still worse overall, because the page sees an
empty selection for any drag in a paragraph with a time (A2), and the whole
paragraph's text becomes shadow content. Per mark is better. The log-block
cost can likely be removed by attaching a root only when a mark is shown
converted: technical blocks start as originals. That is **not measured**.
The hidden layout's slow "Convert all" comes from rebuilding the slot on every
switch in the prototype. Changing only the text node should bring it to the
unslotted figure; that is not measured either.

## Decisions for the owner

**D1. Where the original lives.**
Options: (a) unslotted, as proposed; (b) slotted in a hidden box.
(a) makes `innerText` and `Selection.toString()` lose the time, which is real
data loss. (b) keeps every page read on the original, but a hidden text box
exists: find matches it, and the page's Range geometry for that text is wrong.
**Recommend (b).**

**D2. What copy and drag carry.**
Options: (a) the text as shown (today's rule); (b) the original; (c) the
browser default.
(c) is not acceptable: the HTML carries our markup and, with (b) of D1, both
times. (a) needs the flat-tree handler described above, for copy and for
`dragstart`. (b) is simpler but surprises a reader who selected what they saw.
**Recommend (a)**, the same rule as today. Accept that a site's own copy
handler still sees, through `getSelection()`, the original (or, for a
selection started inside a time, part of the converted text).

**D3. Find-in-page.**
With D1(b), searching the original probably highlights an invisible spot, and
searching the converted text works. There is no layout that avoids this
without losing `innerText`.
**Recommend accepting it** and documenting it. Verify in each browser before
release.

**D4. Whether the page may see the shadow root.**
Open: the page and its scripts can read the converted text and change it.
Closed: invisible to the page; other extensions can still reach it through
their own APIs; our code keeps the root references.
**Recommend closed.** The page has no legitimate use for it, and "the page
reads only its own text" is the point of #34.

**D5. Layout.**
Per mark, per run, or in place.
**Recommend per mark.** Reject in place outright, because it can make page
content invisible after we stop (C10). Consider attaching roots lazily, only
for times shown converted.

**D6. #18.**
Shadow DOM does not solve framework-owned text. That needs its own decision.
The design's planned fallback (leave the text alone, conversion in the
popover) is the candidate. **Recommend** tracking it separately, and not
expecting #34 to close it.

**D7. Release gate.**
**Recommend** that the five Firefox/Safari checks in condition 4 block
writing the spec, not just the release.

## Engineering notes for whoever writes the spec

- **Structure.** Keep `<zoneshift-run>` as one inline item per text node.
  Each time becomes `<zoneshift-mark>` holding the original text, with a
  closed root. Inside the root: a content span holding the converted text,
  then the hidden box (`display:inline-block; width:0; height:0;
  overflow:hidden; aria-hidden`) with the `<slot>`, then the icon span. The
  hidden box must come after the converted text, or it takes `::first-letter`.
  "Show original here" renders a plain `<slot>`. Consider `white-space:nowrap`
  in the hidden box, so the page's Range over the original gets one line
  instead of a tall box. Not tested.
- **Styles.** Use one constructed sheet shared by every root.
  `:host { all: unset !important }` belongs only on our own hosts, never on a
  page element. The shadow-scoped rules no longer need `!important` against
  page rules, which cannot reach inside. A `<style>` element in the root
  worked under strict CSP in Chromium and is the fallback for Firefox's
  `adoptedStyleSheets` bugs (**UNVERIFIED**).
- **Events.** With closed roots, `composedPath()` stops at the host. Keep a
  WeakMap from host to root. Find the icon through `root.activeElement` for
  keys and the icon's rectangle for pointer events; both are verified. The
  page sees `document.activeElement` as the host while the icon has focus.
- **`attachShadow` can throw.** A page that defines our tag name runs its own
  constructor on our elements, and may already have attached a root. Catch the
  error and leave that text alone. This hazard exists today too (current
  rendered the page's "PAGE").
- **Copy and drag.** Build both from `getComposedRanges({ shadowRoots: <ours> })`
  by walking the flat tree. Emit the page's own elements, our converted text,
  no icon, no hidden box. A light-DOM approach fails for selections that begin
  or end inside a time (`g-drag`). `getComposedRanges` support:
  [Chromium intent to ship](https://groups.google.com/a/chromium.org/g/blink-dev/c/4dsh58Y4ZrE),
  [Firefox bug 1903870](https://bugzilla.mozilla.org/show_bug.cgi?id=1903870),
  [support table](https://caniuse.com/wf-composed-ranges). Versions are
  **UNVERIFIED**.
- **What becomes unnecessary.** `data-zs-original` (the light DOM is the
  original). The "known limitation" paragraph. The safety role of the
  copies machinery: a snapshot, clone or paste now holds original text. Keep
  a smaller version that unwraps copies and annotates them again, so they get
  icons.
- **What remains.** Restore when content becomes editable (no longer
  time-critical). Caret mapping, rewritten to use
  `caretPositionFromPoint(x, y, { shadowRoots })`. Context and boundary
  rules, unchanged. `stop()` unwrapping runs (verified to leave no roots,
  because the roots go with their hosts). The copy handler, now harder.
- **Rules in `docs/design.md` that change:**
  - "Page structure": new markup, and no `data-zs-original`.
  - "Known limitation, accepted by the owner": resolved for `textContent`,
    `innerHTML`, `innerText`, `Selection.toString()`, clones and sanitisers.
    It stays true for find-in-page and page Range geometry.
  - "Copies": no longer a safety rule.
  - "Copying … puts the text as shown": kept, with a new mechanism, and
    extended to drag-and-drop.
  - "The wrappers are reset … the icon's own rules are `!important`":
    replaced by shadow scoping.
  - New rule: we never attach a root to an element we did not create.
- **Tests that change.**
  - `extension.spec.ts`: every `toHaveText` on converted text (Playwright's
    text matching walks shadow roots and slots, so the hidden original may
    also appear in the text; not checked); the
    `.zoneshift` / `.zoneshift-icon` / `data-zs-state` locators; the CSS
    checks on `zoneshift-text`.
  - `page-safety.spec.ts`: "site CSS aimed at spans…" (rewritten against the
    shadow parts), "copying puts the shown text…" (new handler), "click-to-edit
    keeps the caret…" (new mapping), "edit, cancel from a snapshot…" (passes
    trivially), "a cloned slide…" (re-annotation still wanted).
  - `test/annotator.test.ts` and the fuzz test: almost every assertion on
    `textContent`.
  - New tests needed: `innerText` and `Selection.toString()` return the
    original; DOMPurify output; drag-and-drop into an editor; closed-root
    keyboard and pointer; a page-defined `zoneshift-mark`.

## Alternatives, judged from this evidence

**(i) CSS generated content over a visually hidden original.** This shares
the hidden-original trade-offs measured here: `innerText`, selection and
snapshots read the original, find matches invisible text, and page Range
geometry is wrong. It loses what shadow text gave the reader. Generated
content cannot be selected or copied, and it is generally not found by
find-in-page (known behaviour, not run here). The converted string would also sit in an attribute that a
snapshot carries, unless a sanitiser strips the element. It is cheaper (no
roots), but the reader cannot copy the time they see. Not prototyped.

**(ii) An overlay with no DOM change.** The "in place" measurements show the
limit. Even with the page DOM untouched, the original glyphs must be hidden
and the line must make room: converted text usually has another length
(`1:30 AM UTC` becomes `5:30 PM PST (−1 day)`). An overlay cannot reflow the line, and it must follow
every layout change. Copy, find, selection and accessibility would all see
only the original, with nothing to carry the converted text. Not prototyped;
I would not pursue it.

**(iii) Icon only, conversion in the popover.** Every site-read API returns
the original, and translation, find, copy and accessibility are untouched for
the text, because only an empty icon element is inserted. Sanitisers drop it.
If the icon is placed after the whole text node instead of splitting it, the
page's Text node is never moved. That is the only design here that also helps
#18 without the "in place" hazards (reasoned from C10, not run). The reader
loses the at-a-glance conversion, which is the product. It is the right
fallback for framework-owned text, not the main design.

## Everything UNVERIFIED

- Firefox and Safari: every behaviour in this document. In particular
  `innerText` with slotted/unslotted text; native plain-text copy of shadow
  text; Ctrl+F in shadow trees; `adoptedStyleSheets` and `<style>` in a root
  from a content script ([1827104](https://bugzilla.mozilla.org/show_bug.cgi?id=1827104),
  [1817675](https://bugzilla.mozilla.org/show_bug.cgi?id=1817675));
  `getComposedRanges` versions; Xray visibility of open and closed roots;
  whether a disabled extension's observers die (the "in place" orphan risk).
- Chromium Ctrl+F (only `window.find` was run).
- Chrome Translate on shadow content. Firefox and Safari translation are known
  only from the bug reports linked above.
- Reader modes and text-to-speech; a real screen reader's virtual cursor.
- How a saved MHTML reopens; "Save page as → Webpage, Complete".
- Lazy root attachment and a slot-preserving "Convert all": their effect on
  memory and time is predicted, not measured.
