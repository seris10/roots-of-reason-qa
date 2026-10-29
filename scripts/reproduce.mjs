import { spawnSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { readCases, variants, artifactStem, sha256, parseTap, assertOutcome, sourceSnapshot, verifySmoke } from './receipt.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
if (!(args.length === 0 || args.length === 2 && args[0] === '--out' && ['evidence', '.generated/latest'].includes(args[1]))) throw new Error('use_approved_local_output');
const destination = args[1] || '.generated/latest';
const startSource = sourceSnapshot(root);
const git = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
const commit = git.status === 0 ? git.stdout.trim() : null;
const sanitize = value => value.replaceAll(pathToFileURL(root).href, 'file://<repository>').replaceAll(root, '<repository>');
const write = (path, value) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path + '.writing', value);
  renameSync(path + '.writing', path);
};
const cases = readCases(root);
const runs = [];
for (const item of cases) {
  for (const variant of variants) {
    const command = ['--test', '--test-concurrency=1', '--test-reporter=tap', `cases/${item.slug}/acceptance.test.mjs`];
    const environment = { PATH: process.env.PATH || '', QA_VARIANT: variant, NO_COLOR: '1' };
    const startedAt = new Date().toISOString();
    const result = spawnSync(process.execPath, command, { cwd: root, env: environment, encoding: 'utf8', timeout: 120_000, maxBuffer: 8 * 1024 * 1024 });
    const log = sanitize((result.stdout || '') + (result.stderr || ''));
    const summary = parseTap(log);
    assertOutcome({ summary, status: result.status, signal: result.signal, error: result.error }, variant, item);
    const demo = spawnSync(process.execPath, [`cases/${item.slug}/demo.mjs`], { cwd: root, env: environment, encoding: 'utf8', timeout: 60_000, maxBuffer: 2 * 1024 * 1024 });
    if (demo.status !== 0 || demo.signal || demo.error) throw new Error('demo_did_not_complete');
    const observation = JSON.parse(demo.stdout);
    if (observation.caseId !== item.id || observation.variant !== variant) throw new Error('demo_identity_mismatch');
    const folder = join(root, destination, item.slug);
    write(join(folder, `${artifactStem(variant)}.tap`), log);
    write(join(folder, `${artifactStem(variant)}-observation.json`), JSON.stringify(observation, null, 2) + '\n');
    const receipt = {
      schema_version: 1, case_id: item.id, variant, evidence_class: 'new offline synthetic reconstruction',
      started_at_utc: startedAt, completed_at_utc: new Date().toISOString(),
      runtime: { node: process.version, platform: process.platform, architecture: process.arch },
      command: ['node', ...command], source: { commit, ...startSource },
      source_unchanged_during_run: sourceSnapshot(root).sha256 === startSource.sha256,
      assertions: summary, exit_code: result.status, signal: result.signal,
      interpretation: variant === 'fixed' ? 'acceptance assertions passed' : 'expected counterexample refuted the faulty variant',
      log_sha256: sha256(log), observation_sha256: sha256(JSON.stringify(observation, null, 2) + '\n'),
      not_tested: ['original application code', 'live production', 'real family records', 'network/provider behavior', 'physical devices'],
    };
    if (!receipt.source_unchanged_during_run) throw new Error('source_changed_during_run');
    runs.push({ case_id: item.id, slug: item.slug, variant, ...summary, expected_outcome_observed: true });
    console.log(`${item.id} ${variant}: ${summary.pass}/${summary.tests} passed; ${summary.fail} failed; expected outcome observed`);
    if (item.smoke) {
      const smokeArgs = ['--test', '--test-reporter=tap', `cases/${item.slug}/smoke.test.mjs`];
      const smoke = spawnSync(process.execPath, smokeArgs, { cwd: root, env: environment, encoding: 'utf8', timeout: 30_000 });
      const smokeLog = sanitize((smoke.stdout || '') + (smoke.stderr || ''));
      const smokeSummary = parseTap(smokeLog);
      if (smoke.status !== 0 || smokeSummary.tests !== 1 || smokeSummary.pass !== 1 || smokeSummary.fail || smokeSummary.skipped) throw new Error('narrow_smoke_control_failed');
      receipt.smoke = { command: ['node', ...smokeArgs], log_sha256: sha256(smokeLog), assertions: smokeSummary, exit_code: smoke.status, signal: smoke.signal };
      verifySmoke(receipt.smoke, smokeLog);
      write(join(folder, `${artifactStem(variant)}-smoke.tap`), smokeLog);
    }
    write(join(folder, `${artifactStem(variant)}-receipt.json`), JSON.stringify(receipt, null, 2) + '\n');
  }
}
if (sourceSnapshot(root).sha256 !== startSource.sha256) throw new Error('source_changed_during_matrix');
write(join(root, destination, 'summary.json'), JSON.stringify({ schema_version: 1, created_at_utc: new Date().toISOString(), source_sha256: startSource.sha256,
  cases: cases.length, variants_per_case: variants.length, runs, claims: 'All corrected variants pass; both faulty variants are refuted by the named acceptance assertion for each case. Expected-red runs are not passing application tests.' }, null, 2) + '\n');
