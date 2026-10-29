import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCases, variants, artifactStem, sha256, verifyReceipt, sourceSnapshot, verifyMatrix, verifySmoke } from './receipt.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const destination = process.argv[2] || 'evidence';
if (!['evidence', '.generated/latest'].includes(destination)) throw new Error('unknown_evidence_location');
const expectedCases = readCases(root);
const measuredRuns = [];
for (const item of expectedCases) for (const variant of variants) {
  const folder = join(root, destination, item.slug);
  const receipt = JSON.parse(readFileSync(join(folder, `${artifactStem(variant)}-receipt.json`), 'utf8'));
  const log = readFileSync(join(folder, `${artifactStem(variant)}.tap`), 'utf8');
  verifyReceipt(receipt, { ...item, variant }, root, log);
  if (item.smoke) verifySmoke(receipt.smoke, readFileSync(join(folder, `${artifactStem(variant)}-smoke.tap`), 'utf8'));
  const observation = readFileSync(join(folder, `${artifactStem(variant)}-observation.json`), 'utf8');
  const data = JSON.parse(observation);
  if (data.caseId !== item.id || data.variant !== variant || sha256(observation) !== receipt.observation_sha256) throw new Error('observation_fingerprint_mismatch');
  if (!receipt.source_unchanged_during_run) throw new Error('source_was_mutated');
  measuredRuns.push({ case_id: item.id, slug: item.slug, variant, ...receipt.assertions, expected_outcome_observed: true });
}
const summary = JSON.parse(readFileSync(join(root, destination, 'summary.json'), 'utf8'));
verifyMatrix(summary, measuredRuns, sourceSnapshot(root).sha256, expectedCases.length);
console.log(`Verified ${expectedCases.length * variants.length} source-bound acceptance receipts and their logs/observations.`);
