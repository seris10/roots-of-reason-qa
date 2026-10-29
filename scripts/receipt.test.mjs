import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTap, assertOutcome, verifyReceipt, sourceSnapshot, sha256, verifyMatrix, verifySmoke } from './receipt.mjs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const contract = { minimum_tests: 2, before_counterexample: 'required counterexample', regression_counterexample: 'required counterexample' };
function tap({ pass = 2, fail = 0, skipped = 0, todo = 0, cancelled = 0 } = {}) {
  const rows = ['TAP version 13']; let n = 0;
  for (let i = 0; i < pass; i++) rows.push(`ok ${++n} - passing control ${i + 1}`);
  for (let i = 0; i < fail; i++) rows.push(`not ok ${++n} - ${i === 0 ? 'required counterexample' : 'other counterexample ' + i}\n  ---\n  failureType: 'testCodeFailure'\n  code: 'ERR_ASSERTION'\n  ...`);
  for (let i = 0; i < skipped; i++) rows.push(`ok ${++n} - skipped control ${i} # SKIP`);
  for (let i = 0; i < todo; i++) rows.push(`ok ${++n} - unfinished control ${i} # TODO`);
  for (let i = 0; i < cancelled; i++) rows.push(`not ok ${++n} - cancelled control ${i}\n  ---\n  failureType: 'cancelledByParent'\n  code: 'ERR_TEST_FAILURE'\n  ...`);
  return rows.join('\n') + `\n1..${n}\n# tests ${n}\n# pass ${pass}\n# fail ${fail}\n# cancelled ${cancelled}\n# skipped ${skipped}\n# todo ${todo}\n`;
}
const run = (text, status = 0) => ({ summary: parseTap(text), status });

test('a completed corrected run is accepted', () => assert.doesNotThrow(() => assertOutcome(run(tap()), 'fixed', contract)));
test('empty output cannot become a green run', () => assert.throws(() => parseTap(''), /invalid/));
test('zero executed tests cannot satisfy the contract', () => assert.throws(() => assertOutcome(run(tap({ pass: 0 })), 'fixed', contract), /incomplete/));
test('an all-skipped run is incomplete even with exit zero', () => assert.throws(() => assertOutcome(run(tap({ pass: 0, skipped: 2 })), 'fixed', contract), /incomplete/));
test('a cancelled run is incomplete', () => assert.throws(() => assertOutcome(run(tap({ pass: 1, cancelled: 1 })), 'fixed', contract), /incomplete/));
test('a todo is not a passing acceptance assertion', () => assert.throws(() => assertOutcome(run(tap({ pass: 1, todo: 1 })), 'fixed', contract), /incomplete/));
test('ambiguous duplicate summaries are rejected', () => assert.throws(() => parseTap(tap() + '# tests 2\n'), /ambiguous/));
test('inconsistent totals are rejected', () => assert.throws(() => parseTap(tap().replace('# tests 2', '# tests 3')), /inconsistent/));
test('an expected red control needs the named counterexample', () => assert.throws(() => assertOutcome(run(tap({ pass: 1, fail: 1 }).replace('required counterexample', 'unrelated failed assertion'), 1), 'before', contract), /expected_claim/));
test('a green faulty variant is a failed refutation control', () => assert.throws(() => assertOutcome(run(tap()), 'regression', contract), /expected_claim/));
test('a crash exit cannot masquerade as an expected assertion failure', () => assert.throws(() => assertOutcome(run(tap({ pass: 1, fail: 1 }), 137), 'before', contract), /expected_claim/));
test('a signal or timeout cannot masquerade as a completed run', () => assert.throws(() => assertOutcome({ ...run(tap()), signal: 'SIGTERM' }, 'fixed', contract), /complete/));
test('a completed named counterexample is accepted as an expected red control', () => assert.doesNotThrow(() => assertOutcome(run(tap({ pass: 1, fail: 1 }), 1), 'before', contract)));
test('summary-only counters without a plan and executed records cannot pass', () => assert.throws(() => parseTap('TAP version 13\n# tests 2\n# pass 2\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n'), /plan_or_executed/));
test('a missing TAP plan invalidates otherwise complete records', () => assert.throws(() => parseTap(tap().replace('1..2\n', '')), /plan_or_executed/));
test('a duplicate executed record cannot satisfy the plan', () => assert.throws(() => parseTap(tap().replace('ok 2', 'ok 1')), /identity_invalid/));
test('a failed record cannot hide behind a green footer', () => assert.throws(() => parseTap(tap().replace('ok 2', 'not ok 2')), /executed_counts/));
test('a bailout invalidates an otherwise green report', () => assert.throws(() => parseTap(tap() + 'Bail out! synthetic interruption\n'), /bailout/));
test('the right test name with a non-assertion failure cannot pass expected red', () => assert.throws(() => assertOutcome(run(tap({ pass: 1, fail: 1 }).replace("code: 'ERR_ASSERTION'", "code: 'ERR_TEST_FAILURE'"), 1), 'before', contract), /non_assertion/));

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const expected = { id: 'SYNTH-01', ...contract, variant: 'fixed' };
function receiptFixture() {
  const log = tap();
  return { log, receipt: { schema_version: 1, case_id: 'SYNTH-01', variant: 'fixed', source: sourceSnapshot(root),
    log_sha256: sha256(log), assertions: parseTap(log), exit_code: 0, signal: null } };
}
test('a valid source-bound receipt agrees with its independently parsed log', () => {
  const {log,receipt}=receiptFixture();assert.doesNotThrow(()=>verifyReceipt(receipt,expected,root,log));
});
test('a changed log invalidates its receipt hash', () => {
  const {log,receipt}=receiptFixture();assert.throws(()=>verifyReceipt(receipt,expected,root,log+'# extra observation\n'),/fingerprint_mismatch/);
});
test('a stale executable fingerprint invalidates a receipt', () => {
  const {log,receipt}=receiptFixture();receipt.source.sha256='0'.repeat(64);assert.throws(()=>verifyReceipt(receipt,expected,root,log),/fingerprint_stale/);
});
test('changing a receipt count without changing the log is rejected', () => {
  const {log,receipt}=receiptFixture();receipt.assertions.pass=999;assert.throws(()=>verifyReceipt(receipt,expected,root,log),/summary_disagrees/);
});
test('a fixed receipt cannot be substituted for a before receipt', () => {
  const {log,receipt}=receiptFixture();assert.throws(()=>verifyReceipt(receipt,{...expected,variant:'before'},root,log),/identity_invalid/);
});
test('a forged source file map is rejected even if its aggregate field is unchanged', () => {
  const {log,receipt}=receiptFixture();receipt.source.files['cases.json']='0'.repeat(64);assert.throws(()=>verifyReceipt(receipt,expected,root,log),/fingerprint_stale/);
});
const measured = ['before','fixed','regression'].map(variant=>({case_id:'SYNTH-01',variant,tests:2}));
const matrix = () => ({schema_version:1,cases:1,variants_per_case:3,source_sha256:'synthetic-digest',runs:structuredClone(measured)});
test('a complete matrix agrees with all independently validated receipt rows',()=>assert.doesNotThrow(()=>verifyMatrix(matrix(),measured,'synthetic-digest',1)));
test('a duplicated matrix row cannot replace a different variant',()=>{const data=matrix();data.runs[2]=data.runs[0];assert.throws(()=>verifyMatrix(data,measured,'synthetic-digest',1),/matrix/);});
test('matrix counts cannot disagree with their receipts',()=>{const data=matrix();data.runs[0].tests=999;assert.throws(()=>verifyMatrix(data,measured,'synthetic-digest',1),/matrix/);});
const smokeFixture = () => { const log=tap({pass:1});return {log,receipt:{log_sha256:sha256(log),assertions:parseTap(log),exit_code:0,signal:null}}; };
test('a complete one-test smoke receipt is validated independently',()=>{const {log,receipt}=smokeFixture();assert.doesNotThrow(()=>verifySmoke(receipt,log));});
test('a changed smoke log invalidates its parent receipt',()=>{const {log,receipt}=smokeFixture();assert.throws(()=>verifySmoke(receipt,log+'# changed\n'),/smoke_receipt/);});
test('a two-test smoke cannot replace the declared one-test control',()=>{const log=tap(),receipt={log_sha256:sha256(log),assertions:parseTap(log),exit_code:0,signal:null};assert.throws(()=>verifySmoke(receipt,log),/smoke_contract/);});
