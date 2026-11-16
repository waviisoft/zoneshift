#!/usr/bin/env node
// Regression guard for .github/workflows/ci.yml hardening (issue #33).
//
// This is a plain-text/line-based check, not a full YAML parser: the workflow's
// shape is simple and fixed, and this avoids adding a YAML dependency just for
// a CI sanity check. It asserts three things every future edit to the workflow
// must keep true:
//
//   1. Every `uses:` step is pinned to a 40-character commit SHA (not a tag or
//      branch), with a trailing comment noting the human-readable version.
//   2. Both the `test` and `e2e` jobs declare `timeout-minutes`.
//   3. The `concurrency` block does not unconditionally cancel in-progress
//      runs on `refs/heads/main`.
//
// Run directly: node .github/scripts/verify-ci-workflow.mjs [path-to-workflow]

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SHA_RE = /^[0-9a-f]{40}$/;

export function verifyWorkflow(yaml) {
  const errors = [];
  const lines = yaml.split('\n');

  // --- 1. every `uses:` is pinned to a 40-char commit SHA, with a version comment.
  const usesLineRe = /^\s*-\s*uses:\s*(\S+)(?:\s+#\s*(.+))?\s*$/;
  lines.forEach((line, i) => {
    const match = line.match(usesLineRe);
    if (!match) return;
    const [, ref, comment] = match;
    const at = ref.lastIndexOf('@');
    if (at === -1) {
      errors.push(`line ${i + 1}: "${ref}" has no @ref at all`);
      return;
    }
    const action = ref.slice(0, at);
    const pin = ref.slice(at + 1);
    if (!SHA_RE.test(pin)) {
      errors.push(`line ${i + 1}: ${action}@${pin} is not pinned to a 40-character commit SHA`);
    }
    if (!comment || !comment.trim()) {
      errors.push(`line ${i + 1}: ${action}@${pin} has no trailing "# vX.Y.Z" comment for readability`);
    }
  });

  // --- 2. `timeout-minutes` present on every job under `jobs:`.
  const jobsIdx = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  if (jobsIdx === -1) {
    errors.push('no top-level "jobs:" key found');
  } else {
    // A job id is a line indented exactly two spaces, e.g. "  test:".
    const jobLineRe = /^  ([A-Za-z0-9_-]+):\s*$/;
    const jobs = [];
    for (let i = jobsIdx + 1; i < lines.length; i++) {
      const m = lines[i].match(jobLineRe);
      if (m) jobs.push({ name: m[1], start: i });
    }
    jobs.forEach((job, idx) => {
      const end = idx + 1 < jobs.length ? jobs[idx + 1].start : lines.length;
      const body = lines.slice(job.start, end);
      const hasTimeout = body.some((l) => /^\s{4}timeout-minutes:\s*\d+/.test(l));
      if (!hasTimeout) {
        errors.push(`job "${job.name}" has no timeout-minutes`);
      }
    });
    if (jobs.length === 0) {
      errors.push('"jobs:" key found but no jobs detected under it');
    }
  }

  // --- 3. concurrency block must not unconditionally cancel runs on main.
  const concurrencyIdx = lines.findIndex((l) => /^concurrency:\s*$/.test(l));
  if (concurrencyIdx === -1) {
    errors.push('no top-level "concurrency:" key found');
  } else {
    let end = lines.length;
    for (let i = concurrencyIdx + 1; i < lines.length; i++) {
      if (/^\S/.test(lines[i])) {
        end = i;
        break;
      }
    }
    const block = lines.slice(concurrencyIdx, end).join('\n');
    const cancelLine = block.match(/cancel-in-progress:\s*(.+)$/m);
    if (!cancelLine) {
      errors.push('concurrency block has no cancel-in-progress key');
    } else {
      const value = cancelLine[1].trim();
      if (value === 'true') {
        errors.push(
          'concurrency.cancel-in-progress is unconditionally "true", which also cancels in-progress runs on main',
        );
      } else if (!/refs\/heads\/main/.test(value)) {
        errors.push(
          `concurrency.cancel-in-progress ("${value}") does not reference refs/heads/main, so it is not provably main-safe`,
        );
      }
    }
  }

  return errors;
}

function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const target = process.argv[2] ?? join(here, '..', 'workflows', 'ci.yml');
  const yaml = readFileSync(target, 'utf8');
  const errors = verifyWorkflow(yaml);
  if (errors.length > 0) {
    console.error(`verify-ci-workflow: ${errors.length} problem(s) found in ${target}:`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exitCode = 1;
  } else {
    console.log(`verify-ci-workflow: ${target} OK`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
