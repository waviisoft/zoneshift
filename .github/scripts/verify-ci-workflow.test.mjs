#!/usr/bin/env node
// Regression tests for verify-ci-workflow.mjs (issue #33 / PR #35 review finding).
//
// Run directly: node --test .github/scripts/verify-ci-workflow.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyWorkflow } from './verify-ci-workflow.mjs';

const VALID_SHA = 'a'.repeat(40);

function minimalWorkflow(stepsYaml) {
  return [
    'jobs:',
    '  test:',
    '    timeout-minutes: 15',
    '    steps:',
    stepsYaml,
    'concurrency:',
    '  cancel-in-progress: ${{ github.ref != \'refs/heads/main\' }}',
    '',
  ].join('\n');
}

test('catches an unpinned action given on its own `uses:` line under a `- name:` step (two-line form)', () => {
  const yaml = minimalWorkflow(
    ['      - name: Checkout', '        uses: actions/checkout@v1'].join('\n'),
  );
  const errors = verifyWorkflow(yaml);
  assert.ok(
    errors.some((e) => /actions\/checkout@v1 is not pinned/.test(e)),
    `expected an "not pinned" error for the two-line uses: form, got: ${JSON.stringify(errors)}`,
  );
});

test('still accepts a properly pinned action in the single-line `- uses:` form (happy path, no regression)', () => {
  const yaml = minimalWorkflow(
    [`      - uses: actions/checkout@${VALID_SHA} # v4.4.0`].join('\n'),
  );
  const errors = verifyWorkflow(yaml);
  assert.deepEqual(
    errors,
    [],
    `expected no errors for a correctly pinned single-line uses:, got: ${JSON.stringify(errors)}`,
  );
});

test('still accepts a properly pinned action in the two-line `- name:` / `uses:` form', () => {
  const yaml = minimalWorkflow(
    [
      '      - name: Checkout',
      `        uses: actions/checkout@${VALID_SHA} # v4.4.0`,
    ].join('\n'),
  );
  const errors = verifyWorkflow(yaml);
  assert.deepEqual(
    errors,
    [],
    `expected no errors for a correctly pinned two-line uses:, got: ${JSON.stringify(errors)}`,
  );
});
