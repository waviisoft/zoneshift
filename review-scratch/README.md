# Review scratch files from pull request #26

Reproductions, fuzz harnesses, differential corpora and performance pages the
two reviewers wrote while reviewing #26. Not for merging as they are: paths and
imports assume the reviewers' working copies, and some cases were already moved
into the real suites.

- `page/` — annotator and extension: happy-dom tests and Playwright specs
  (site CSS, editors, snapshots and fights, copy and paste, dialogs, caret,
  selection, performance pages).
- `engine/` — conversion engine: failing-case files from each round, the
  old-versus-new differential, time-zone and performance probes.

Use: when working on #18, #27–#32 or #34, lift the relevant cases into
`packages/core/test`, `apps/extension/test` or `apps/extension/e2e`.
