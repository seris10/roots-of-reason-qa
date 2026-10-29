import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import { join, relative } from 'node:path';

export const variants = Object.freeze(['before', 'fixed', 'regression']);
export const artifactStem = variant => variant === 'fixed' ? 'after' : variant;
export const sha256 = value => createHash('sha256').update(value).digest('hex');

export function readCases(root) {
  const config = JSON.parse(readFileSync(join(root, 'cases.json'), 'utf8'));
  if (config.schema_version !== 1 || !Array.isArray(config.cases) || !config.cases.length) throw new Error('case_list_empty_or_invalid');
  const ids = new Set(), slugs = new Set();
  for (const item of config.cases) {
    if (!/^[A-Z]+-\d{2}$/.test(item.id) || !/^[a-z]+(?:-[a-z]+)*$/.test(item.slug)
      || ids.has(item.id) || slugs.has(item.slug) || !Number.isSafeInteger(item.minimum_tests) || item.minimum_tests < 1
      || !item.before_counterexample || !item.regression_counterexample) throw new Error('case_contract_invalid');
    ids.add(item.id); slugs.add(item.slug);
  }
  return config.cases;
}

export function parseTap(output) {
  if ([...output.matchAll(/^TAP version 13\s*$/gm)].length !== 1 || /^Bail out!/m.test(output)) throw new Error('tap_header_or_bailout_invalid');
  const value = name => {
    const matches = [...output.matchAll(new RegExp(`^# ${name} (\\d+)\\s*$`, 'gm'))];
    if (matches.length !== 1) throw new Error(`summary_${name}_missing_or_ambiguous`);
    return Number(matches[0][1]);
  };
  const counts = Object.fromEntries(['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'].map(name => [name, value(name)]));
  if (!Object.values(counts).every(Number.isSafeInteger) || Object.values(counts).some(value => value < 0)
    || counts.tests !== counts.pass + counts.fail + counts.cancelled + counts.skipped + counts.todo) throw new Error('summary_counts_inconsistent');
  const plans = [...output.matchAll(/^1\.\.(\d+)\s*$/gm)];
  const matches = [...output.matchAll(/^(not )?ok (\d+) - (.+)$/gm)];
  if (plans.length !== 1 || Number(plans[0][1]) !== counts.tests || matches.length !== counts.tests) throw new Error('tap_plan_or_executed_records_disagree');
  const records = matches.map((match, index) => {
    const block = output.slice(match.index, matches[index + 1]?.index ?? output.length);
    const directive = /\s+#\s*(SKIP|TODO)\b/i.exec(match[3])?.[1]?.toLowerCase() || null;
    return { number: Number(match[2]), name: match[3].replace(/\s+#\s*(?:SKIP|TODO)\b.*$/i, '').trim(),
      ok: !match[1], directive, code: /^  code: ['"]?([A-Z_]+)['"]?\s*$/m.exec(block)?.[1] || null,
      failure_type: /^  failureType: ['"]?([A-Za-z]+)['"]?\s*$/m.exec(block)?.[1] || null };
  });
  if (records.some((record, index) => record.number !== index + 1) || new Set(records.map(record => record.name)).size !== records.length) throw new Error('tap_record_identity_invalid');
  const cancelled = record => record.failure_type === 'cancelledByParent';
  const measured = { pass: records.filter(record => record.ok && !record.directive).length,
    fail: records.filter(record => !record.ok && !record.directive && !cancelled(record)).length,
    skipped: records.filter(record => record.directive === 'skip').length,
    todo: records.filter(record => record.directive === 'todo').length,
    cancelled: records.filter(cancelled).length };
  if (Object.entries(measured).some(([name, value]) => counts[name] !== value)) throw new Error('tap_executed_counts_disagree');
  const failures = records.filter(record => !record.ok && !record.directive && !cancelled(record));
  return { ...counts, failed_test_names: failures.map(record => record.name),
    failure_diagnostics: failures.map(({ name, code, failure_type }) => ({ name, code, failure_type })) };
}

export function assertOutcome({ summary, status, signal = null, error = null }, variant, contract) {
  if (!variants.includes(variant)) throw new Error('unknown_variant');
  if (error || signal || !Number.isInteger(status)) throw new Error('run_did_not_complete');
  if (!summary || summary.tests < contract.minimum_tests || summary.skipped || summary.cancelled || summary.todo) throw new Error('run_incomplete');
  if (variant === 'fixed') {
    if (status !== 0 || summary.fail !== 0 || summary.pass !== summary.tests) throw new Error('corrected_variant_not_green');
  } else {
    const expected = contract[`${variant}_counterexample`];
    if (status !== 1 || summary.fail < 1 || !summary.failed_test_names.includes(expected)) throw new Error('control_did_not_refute_expected_claim');
    if (summary.failure_diagnostics.length !== summary.fail || summary.failure_diagnostics.some(failure => failure.code !== 'ERR_ASSERTION' || failure.failure_type !== 'testCodeFailure')) throw new Error('control_failed_for_non_assertion_reason');
  }
}

export function sourceSnapshot(root) {
  const files = {};
  const add = path => { files[relative(root, path).replaceAll('\\', '/')] = sha256(readFileSync(path)); };
  for (const name of ['cases.json', 'package.json', '.node-version']) add(join(root, name));
  for (const directory of ['cases', 'scripts']) {
    const walk = path => {
      for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const next = join(path, entry.name);
        if (lstatSync(next).isSymbolicLink()) throw new Error('source_symlink_refused');
        if (entry.isDirectory()) walk(next);
        else if (entry.name.endsWith('.mjs')) add(next);
      }
    };
    walk(join(root, directory));
  }
  const ordered = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
  return { sha256: sha256(JSON.stringify(ordered)), files: ordered };
}

export function verifyReceipt(receipt, expected, root, log) {
  if (receipt.schema_version !== 1 || receipt.case_id !== expected.id || !variants.includes(receipt.variant) || receipt.variant !== expected.variant) throw new Error('receipt_identity_invalid');
  const current = sourceSnapshot(root);
  if (receipt.source.sha256 !== current.sha256 || JSON.stringify(receipt.source.files) !== JSON.stringify(current.files)) throw new Error('source_fingerprint_stale');
  if (receipt.log_sha256 !== sha256(log)) throw new Error('log_fingerprint_mismatch');
  const measured = parseTap(log);
  if (JSON.stringify(measured) !== JSON.stringify(receipt.assertions)) throw new Error('log_summary_disagrees');
  assertOutcome({ summary: measured, status: receipt.exit_code, signal: receipt.signal }, receipt.variant, expected);
}

export function verifyMatrix(summary, measuredRuns, sourceSha256, caseCount) {
  if (summary.schema_version !== 1 || summary.cases !== caseCount || summary.variants_per_case !== variants.length
    || measuredRuns.length !== caseCount * variants.length || JSON.stringify(summary.runs) !== JSON.stringify(measuredRuns)
    || summary.source_sha256 !== sourceSha256) throw new Error('matrix_incomplete_or_stale');
}

export function verifySmoke(smoke, log) {
  if (!smoke || smoke.exit_code !== 0 || smoke.signal || smoke.log_sha256 !== sha256(log)) throw new Error('smoke_receipt_invalid');
  const measured = parseTap(log);
  if (measured.tests !== 1 || measured.pass !== 1 || measured.fail || measured.skipped || measured.todo || measured.cancelled
    || JSON.stringify(measured) !== JSON.stringify(smoke.assertions)) throw new Error('smoke_contract_invalid');
}
