import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCases, variants } from './receipt.mjs';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const expected = { summary: JSON.parse(readFileSync(join(root, 'evidence/summary.json'), 'utf8')), observations: {} };
for (const item of readCases(root)) {
  expected.observations[item.slug] = {};
  for (const variant of variants) expected.observations[item.slug][variant] = JSON.parse(readFileSync(join(root, 'evidence', item.slug, `${variant}-observation.json`), 'utf8'));
}
const html = readFileSync(join(root, 'portfolio/index.html'), 'utf8');
const blocks = [...html.matchAll(/<script id="case-evidence" type="application\/json">([\s\S]*?)<\/script>/g)];
if (blocks.length !== 1 || JSON.stringify(JSON.parse(blocks[0][1])) !== JSON.stringify(expected)) throw new Error('portfolio_evidence_stale_or_invalid');
for (const item of readCases(root)) if (!html.includes(`data-case="${item.slug}"`)) throw new Error('portfolio_case_missing');
console.log('Portfolio embedded evidence agrees with all nine recorded scenarios and the summary.');
