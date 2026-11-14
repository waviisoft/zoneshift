Zoneshift is an open-source browser extension that shows dates and times on web pages in the reader's own time zone.

This wiki holds the **product specs**. Code, tests and the overall design (`docs/design.md`) live in the [repository](https://github.com/waviisoft/zoneshift); work is tracked under the [epic](https://github.com/waviisoft/zoneshift/issues/1).

## How specs work

1. A feature that changes what a reader sees gets a spec page here before any code is written. Each spec is tied to one issue.
2. A spec starts as **Draft**. The owner approves it; the page is then marked **Approved** with the date.
3. Code is written from the approved spec, one pull request per issue. The pull request is reviewed against the spec's *Behaviour*, *Left alone* and *Acceptance tests* sections.
4. A change to an approved spec goes back to Draft for the changed part and is approved again.

Every spec has the same sections: Summary, Decisions for the owner, Behaviour, Left alone, Edge cases, Non-goals, Acceptance tests, Changes to `docs/design.md`.

## Specs

| Spec | Issue | Status |
|---|---|---|
| [Alternative readings](Spec:-Alternative-readings) | [#17](https://github.com/waviisoft/zoneshift/issues/17) | Draft |
| [Time elements](Spec:-Time-elements) | [#15](https://github.com/waviisoft/zoneshift/issues/15) | Draft |
| [Time ranges](Spec:-Time-ranges) | [#11](https://github.com/waviisoft/zoneshift/issues/11) | Draft |
| [Settings](Spec:-Settings) | [#20](https://github.com/waviisoft/zoneshift/issues/20) | Draft |

## Built without a spec page

The first slice (conversion engine, clock icon, popover, opt-in log and ISO timestamps, late-added content: issues #2–#10) was built from `docs/design.md` and is in [pull request #26](https://github.com/waviisoft/zoneshift/pull/26).
