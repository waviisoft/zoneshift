> Status: **Draft — awaiting owner approval** · Issue: [#20](https://github.com/waviisoft/zoneshift/issues/20) · Depends on: nothing (builds on the existing annotator)

## Summary

The reader can turn Zoneshift off per site, have a site remember "convert all" or "show originals", choose the zone times are shown in, and choose which reading of an ambiguous or out-of-season label comes first, globally or per site. A small toolbar popup covers the current site; an options page covers the rest. Later features (#17, #18, #19, #21, #22) plug into the same store.

## Decisions for the owner

1. **Permissions.** The extension requests no permissions today: #26 removed `storage` from the manifest until this spec is approved, and an end-to-end test (`manifest.spec.ts`) asserts the empty list. **Approving this spec means agreeing to add `storage`.** For per-site state the popup can then (a) message the page's content script, needing nothing more, or (b) also add `activeTab` to read the tab's address. **Recommended: (a) — add `storage` and nothing else.** One permission; works the same on Safari. Cost: one generic message on pages Zoneshift cannot run on (B11).
2. **`storage.local` or `storage.sync`.** Sync means no request from the extension, but the vendor's account sync copies the data, including the site list, to its servers. **Recommended: local** — nothing leaves the device, consistent with "makes no network requests"; Chrome's ~100 KB sync quota would also cap the site list. Feedback reports (#19) are local either way.
3. **What a "site" is.** Hostname, registrable domain, or origin. **Recommended: hostname, leading `www.` removed** — predictable and data-free. Registrable domain needs a bundled public-suffix list kept current (else it merges `alice.github.io` with `bob.github.io`); origin splits `http`/`https` and ports, which readers would not expect.
4. **Remembering the page-wide choice.** (a) Every page-wide tap is remembered for the site; (b) a separate "Remember for this site" tap. **Recommended: (a)** — one tap fewer; the popup always shows it with **Forget**.
5. **Do preferred readings keep the orange flag?** **Recommended: yes** — a label is never silently reinterpreted, and a global preference is easy to forget. See decision 11 for how this fits a pick made on the page.
6. **Private windows.** (a) Stored settings apply; changes made there last until the last private window closes and are never saved; (b) save as normal. **Recommended: (a)** — a saved hostname is a record of a visit.
7. **#21 default zone per site.** (a) Define its storage key and a reserved slot here, #21 adds control and rules; (b) ship the control here. **Recommended: (a)** — storage is cheap (the engine already accepts a default zone), but zone-less conversion has its own reader-visible rules to specify and test.
8. **Counts in the popup** ("12 times found · 9 converted"). **Recommended: include** — the only proof Zoneshift ran on a page; one message.
9. **Export/import.** **Recommended: out of v1** — little data, the versioning rule (B17) keeps it possible, and it avoids validating imported files now.
10. **Pull requests** (rule: one PR per issue). (a) Split #20 into three sub-issues, one PR each; (b) three PRs referencing #20; (c) one PR. **Recommended: (a)**, each testable alone: PR 1 storage, versioning, engine reading preferences, live apply/restore, page-wide memory from the popover; PR 2 toolbar popup; PR 3 options page.
11. **Icon colour: picked on this page versus remembered** (shared with [Alternative readings](Spec:-Alternative-readings) decision 4, so both pages agree). That spec recommends blue after a pick on the page; decision 5 here keeps a remembered preference orange. Options: (a) blue in both cases; (b) orange in both; (c) blue for a pick made on this page, orange when applied from memory (site or global). **Recommended: (c)** — a pick the reader just made is not a guess; a preference set long ago may not fit this page, and a label is never silently reinterpreted.

## Behaviour

**Site and settings**

- **B1** A site is the tab's hostname, lowercased, leading `www.` removed. `www.example.com` = `example.com`; `docs.example.com` is separate. Scheme and port are ignored. All `file://` pages are one site, "Local files".
- **B2** Settings:

| Setting | Scope | Default | What the reader sees change | Set in |
|---|---|---|---|---|
| On for this site | site | On | Off: no icons, no conversions on the site | popup, options |
| Page-wide choice | site | None (prose converted; code/ISO as written) | Convert all: every recognised time converted, code/ISO included. Show originals: all as written, hollow icons | popover, popup, options |
| Show times in | global | Browser zone | Conversions render in this zone; times already in it are left alone | options |
| Out-of-season abbreviations, shown first | global | Region's local time | "3:00 PM EST" in July → 12:00 PM PDT, or 1:00 PM PDT if literal | options |
| Ambiguous labels, shown first | global, per label | Engine's first reading | Chosen meaning shown first (B8) | options |
| Remembered readings | site, per label | None | As above for this site; also covers out-of-season labels | popup (forget), options |
| Default zone for zone-less times | site | None | Reserved for #21 | reserved slot |
| Fallback mode | site | Off | Reserved for #18 | reserved slot |
| Use built-in site zones | global | Set by #22 | Reserved for #22 | reserved slot |

  The ambiguous labels are those the engine treats as ambiguous (today MT, PT, CST, AST, BST, IST); the options page lists them from the engine.
- **B3** Precedence. A site that is off overrides everything. Source zone: zone in the text → site default zone (#21) → built-in list (#22, if on) → leave alone. Label reading: site's remembered reading → global preference → engine's first reading. Shown/original: tap on that time (this page view) → site's page-wide choice → built-in default.
- **B4** A missing value means the default. A site entry with only default values is removed, so the options list shows only sites with something set.

**Live effect**

- **B5** Changes apply without reload, within 1 second, to every open tab they affect (site setting: that site's tabs; global: all tabs).
- **B6** Turning a site off restores every marked time's original text, removes icons and popover, and stops annotating added content; the page's text is identical to the text it would have without Zoneshift. The annotator's stop (#26) already does this, putting back the page's own text nodes; turning a site off uses it. Turning it on annotates as on a fresh load.
- **B7** Changing the target zone or a reading re-annotates open pages (the annotator's `restore`, then annotate); per-time taps there are dropped, the page-wide choice stays.

**Readings and page-wide memory**

- **B8** A preferred reading changes only which meaning is shown first: the time stays orange (decision 11), the other meanings stay on offer, and "Read as" names the source, e.g. "China Standard Time (your choice for this site)".
- **B9** The page-wide buttons (popover and popup) store the choice for the site; later loads apply it from the start, including to added content. A remembered "Convert all" counts as the reader asking, so code and ISO timestamps convert too. **Forget** restores the built-in default.
- **B10** "Browser zone" is read when the page loads; a reader who changes the system zone while travelling sees it after a reload.

**Toolbar popup**

- **B11** Works at 320 px, by tap or keyboard, nothing hover-only. Shows: the site; on/off switch; counts (marked times, and how many show converted) as of opening; the zone times are shown in (read-only); the two page-wide buttons with the remembered choice and **Forget**; this site's remembered readings, each with **Forget**; **All settings**. Not in it: zone picker, global preferences, other sites, feedback reports, reset, per-time controls. If the page does not answer (browser pages, extension stores, tabs opened before install) it shows only "Zoneshift isn't running on this page. Browser pages and extension stores can't be changed; other pages start working after a reload." and **All settings**.

```
+--------------------------------------+   +--------------------------------------+
| Zoneshift          news.example.com  |   | Zoneshift          docs.example.com  |
|--------------------------------------|   |--------------------------------------|
| On for this site              [ ON ] |   | On for this site              [OFF ] |
| 12 times found · 9 converted         |   | Times on this site are left as       |
| Shown in America/Los_Angeles         |   | written.                             |
|   (browser zone)                     |   |--------------------------------------|
|--------------------------------------|   | All settings  >                      |
| This page                            |   +--------------------------------------+
| [ Convert all ]  [ Show originals ]  |
| Remembered: Convert all   [Forget]   |
|--------------------------------------|
| Remembered readings                  |
| CST = China Standard Time [Forget]   |
| EST = taken literally     [Forget]   |
|  (later: #18 fallback switch here)   |
|--------------------------------------|
| All settings  >                      |
+--------------------------------------+
```

**Options page**

- **B12** Works at 320 px. Sections:
  - **Time zone**: "Browser zone (currently …)" (default) or "This zone" with a search over the browser's own zone list, matching id or city with spaces ("new york"), each result with its current UTC offset.
  - **Readings**: the out-of-season choice and one dropdown per ambiguous label.
  - **Sites**: every site with an entry, alphabetical, with a filter box; each row has a summary, **Edit** (inline: the popup's controls plus reserved slots) and **Remove** (immediate). Sites are added from the popup.
  - **Reset all settings**, after confirmation; feedback reports are kept.

```
Zoneshift settings
==========================================================
TIME ZONE
  Show times in
  (o) Browser zone - currently America/Los_Angeles
  ( ) This zone: [ berl_                        ]
                 | Europe/Berlin       UTC+1    |
----------------------------------------------------------
READINGS
  Out-of-season abbreviations ("3:00 PM EST" in July)
  (o) Region's local time first  ( ) Taken literally first
  Ambiguous labels - show first:
  CST [Central Standard Time   v]   IST [India Standard Time v]
  AST [Atlantic Standard Time  v]   BST [British Summer Time v]
  MT  [Mountain Time           v]   PT  [Pacific Time        v]
----------------------------------------------------------
SITES                                [ Filter ________ ]
  docs.example.com   Off                    [Edit] [Remove]
  news.example.com   Convert all · CST      [Edit] [Remove]
   v news.example.com
     On for this site                 [ ON ]
     Page-wide   ( ) None (o) Convert all ( ) Originals
     CST = China Standard Time            [Forget]
     (slot: #21 default zone)  (slot: #18 fallback mode)
  (slot: #22 [x] Use built-in site zones)
----------------------------------------------------------
(slot: #19 feedback reports)
----------------------------------------------------------
[ Reset all settings ] -> "Reset all settings to defaults?
                           Feedback reports are kept."
                           [Cancel] [Reset]
```

**Robustness and hooks**

- **B13** Unreadable storage or an invalid value (wrong type, unknown label, zone the browser no longer knows) counts as the default. A saved target zone the browser does not know is replaced by the browser zone before it reaches the engine, which would otherwise convert nothing (since #26 it returns no conversions for an invalid zone rather than throwing). The page is still annotated and no error reaches it; the options page says "Some settings couldn't be read and were reset to defaults." Invalid values are replaced at the next save.
- **B14** A failed save shows "Couldn't save this change" and changes nothing on any page.
- **B15** Private windows (where the reader allowed Zoneshift): stored settings apply; changes follow decision 6.
- **B16** Hooks: #17 writes the site's remembered readings; #18 adds a site switch; #21 a site zone; #22 a global switch that the reader's settings always beat (B3); #19 keeps reports in their own local store, never deleted by reset or **Remove**.
- **B17** Versioning: stored data carries a version number; a build migrates older data forward once, on first read, and never writes an older shape. New optional keys with a default need no version bump, and keys a build does not recognise are kept untouched.

**Examples** — browser zone America/Los_Angeles, now 2026-11-13 10:00 PST.

| Setting state | Original | Reader sees |
|---|---|---|
| Defaults | Doors open 7:00 PM UTC | Doors open 11:00 AM PST (blue) |
| Site off | Doors open 7:00 PM UTC | unchanged, no icon |
| Show times in Europe/Berlin | Doors open 7:00 PM UTC | Doors open 8:00 PM GMT+1 |
| Show times in Asia/Kolkata | Doors open 7:00 PM UTC | Doors open 12:30 AM GMT+5:30 (+1 day) |
| Defaults | Call at 3:00 PM CST | Call at 1:00 PM PST (orange; China offered) |
| Site reading CST = China | Call at 3:00 PM CST | Call at 11:00 PM PST (−1 day) (orange; Central offered) |
| Defaults | Webinar: July 9, 2026, 3:00 PM EST | Webinar: July 9, 2026, 12:00 PM PDT (orange) |
| Out-of-season: literal first | Webinar: July 9, 2026, 3:00 PM EST | Webinar: July 9, 2026, 1:00 PM PDT (orange) |
| Defaults | Build finished at 2026-11-13T04:10:09Z | unchanged, hollow icon |
| Site remembers Convert all | Build finished at 2026-11-13T04:10:09Z | Build finished at 2026-11-12T20:10:09-08:00 |
| Site remembers Show originals | Doors open 7:00 PM UTC | unchanged, hollow icon |

Every converted text above is what the current engine (#26) gives with that target zone and season-mismatch option; the "CST = China" row is today's China alternative, which the preference would put first.

## Left alone

- **L1** A site that is off: no text changed, no icon, no element added, no reaction to added content.
- **L2** Other sites: turning `docs.example.com` off leaves `example.com` and `www.example.com` on.
- **L3** A remembered "Convert all" does not widen recognition: "The show starts at 7:00 PM." stays, no icon.
- **L4** Times already in the chosen zone: with Europe/Berlin, "Doors open 8:00 PM CET" in November is unchanged.
- **L5** A preference applies to the label as written: "CST = China" does not change "CDT", "CT" or the spelled-out "3 PM Central Standard Time".
- **L6** Per-time taps are never remembered.
- **L7** Restoring (B6) touches only Zoneshift's own elements; a mark the page already removed is not put back.
- **L8** Pages where Zoneshift cannot run: nothing changes, no error.
- **L9** Stored settings, from a private window (decision 6).
- **L10** Feedback reports, on reset or removing a site.
- **L11** The site's styling: settings add no decoration beyond the existing icon.

## Edge cases

- **Daylight saving in the target zone**: with Europe/London, "July 9, 2026, 7:00 PM UTC" → "July 9, 2026, 8:00 PM GMT+1"; "Nov 20, 2026, 7:00 PM UTC" is left alone (London is on UTC then).
- **Year boundary**: with Asia/Tokyo, "Dec 31, 2026, 11:30 PM UTC" → "Jan 1, 2027, 8:30 AM GMT+9".
- **Half-hour zone**: Asia/Kolkata gives "(+1 day)" as in the examples.
- **Saved zone no longer known** (e.g. a renamed id): browser zone is used; options shows "Saved zone not recognised: Europe/Kiev — using browser zone."
- **Stored reading names a meaning the engine no longer has**: ignored, default applies.
- **Two tabs on one site**: turning it off in one turns it off in the other within 1 second.
- **Remembered "Show originals", then a tap on one time**: that time converts; not remembered.
- **`localhost:3000` and `localhost:8080`** are one site; raw IP addresses are sites.
- **Storage full**: B14.

## Non-goals

- Default-zone control and rules (#21); alternative-readings UI in the popover (#17 — this spec only stores the choice); fallback behaviour (#18); domain-to-zone list (#22); feedback UI and report format (#19).
- Global pause (the browser's extension toggle does it), allow-list mode, per-path rules, "include subdomains".
- Export/import and sync, unless decisions 2 or 9 go the other way.

## Acceptance tests

- [ ] Engine unit: a CST preference makes China primary, keeps `ambiguous-zone`, offers Central (B8); it does not affect "Central Standard Time", CDT or CT (L5).
- [ ] Annotator unit: a stored invalid target zone is replaced by the browser zone, so the page still converts (B13). The engine side (no conversions, no throw) is already tested in #26.
- [ ] Engine unit: every row of the examples table, with the stated zone and now.
- [ ] Annotator unit: site key for `www.`, subdomains, ports, `file://` (B1, L2).
- [ ] Annotator unit: missing, invalid or newer-version data give defaults without throwing; unknown keys survive a save; a migration from the previous version runs once (B4, B13, B17).
- [ ] Annotator unit: precedence site → global → default (B3).
- [ ] Annotator unit: turning a site off restores exact original `textContent` (the same text nodes) and removes icons, popover and observer, through the existing stop (B6, L1, L7).
- [ ] Annotator unit: a remembered page-wide choice applies at load and to added content, code/ISO included (B9, L3).
- [ ] Annotator unit: a target-zone change re-annotates and drops per-time taps (B7, L6).
- [ ] Annotator unit: a private-window change is not written to storage (B15, L9).
- [ ] End-to-end: popup on the fixture shows site, counts, switch; switching off restores the page in that tab and a second tab within 1 second (B5, B11).
- [ ] End-to-end: popup on a browser internal page shows the "isn't running" message (B11, L8).
- [ ] End-to-end: popup and options page usable at 320 px by tap and keyboard (B11, B12).
- [ ] End-to-end: zone search finds "new york"; choosing it changes an open page without reload (B5, B12).
- [ ] End-to-end: Remove and Reset restore defaults and leave feedback reports (B12, B16, L10).
- [ ] End-to-end: a failed save shows the error and changes nothing (B14).
- [ ] End-to-end: manifest permissions equal the approved list (decision 1): the existing `manifest.spec.ts` test "asks for no permissions" flips to expect exactly `storage`, with no optional or host permissions.

## Changes to docs/design.md

- **Settings**: replace "Not built yet. The extension currently requests no permissions; `storage` arrives with settings, once agreed" and the list with B1–B3, the `storage` permission (decision 1) and a link to this spec; mark "Default zone per site" as #21.
- **Decoration and popover**: replace "Remembering that choice per site belongs with settings" with B9, including that a remembered "Convert all" counts as the reader asking.
- **Zone labels**: a preferred reading changes only the order; the time stays flagged (B8).
- **Decoration**: a reading applied from memory keeps the orange icon; one picked on the page is blue (decision 11, shared with Alternative readings).
- **Architecture, item 3**: name the popup and options page, `storage.local` (or sync, per decision 2) and private-window handling (decision 6).
- **Conversion rules**: "reader's zone" means the "Show times in" setting.
- **Roadmap item 4**: settings in progress.

## Revision history

- 2026-11-13: Reconciled with #26 (commit 84d9d93): decision 1 rewritten, since `storage` is no longer in the manifest and approving this spec means agreeing to add it; decision 11 added so icon colour agrees with Alternative readings; B6, B7 and the off-switch test now build on the annotator's existing stop and `restore`; the invalid-target-zone test moved from the engine (which now returns no conversions instead of throwing) to the annotator; the manifest test that flips named; examples re-run through the current engine (unchanged).
