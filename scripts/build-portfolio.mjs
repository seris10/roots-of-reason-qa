import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCases, variants, artifactStem } from './receipt.mjs';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const summary = JSON.parse(readFileSync(join(root, 'evidence/summary.json'), 'utf8'));
const observations = {};
for (const item of readCases(root)) {
  observations[item.slug] = {};
  for (const variant of variants) observations[item.slug][variant] = JSON.parse(readFileSync(join(root, 'evidence', item.slug, `${artifactStem(variant)}-observation.json`), 'utf8'));
}
const json = JSON.stringify({ summary, observations }).replaceAll('<', '\\u003c');
const template = readFileSync(join(root, 'portfolio/template.html'), 'utf8');
if (template.split('__EVIDENCE_JSON__').length !== 2) throw new Error('template_evidence_slot_invalid');
writeFileSync(join(root, 'portfolio/index.html'), template.replace('__EVIDENCE_JSON__', json));
console.log('Portfolio page built from the recorded synthetic observation/summary files.');
