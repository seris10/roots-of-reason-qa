import { readFileSync, lstatSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const scope = JSON.parse(readFileSync(join(root, 'publication-scope.json'), 'utf8'));
if (scope.schema_version !== 1 || !Array.isArray(scope.files) || !scope.files.length) throw new Error('publication_scope_invalid');
const allowed = new Set(scope.files);
if (allowed.size !== scope.files.length) throw new Error('duplicate_publication_path');
const violations = [];
for (const path of allowed) {
  if (path.startsWith('/') || path.includes('..') || path.includes('\\') || /(?:^|\/)(?:\.env|node_modules|\.git)(?:\/|$)/.test(path)) throw new Error('unsafe_publication_path');
  const full = join(root, path);
  if (!lstatSync(full).isFile() || lstatSync(full).isSymbolicLink()) throw new Error('publication_file_missing_or_linked');
  const bytes = readFileSync(full);
  if (bytes.includes(0)) { violations.push({ path, reason: 'unexpected_binary' }); continue; }
  const text = bytes.toString('utf8');
  const tests = [
    [/\/(?:Users|home)\/[^\s"'<>]+/, 'absolute_user_path'],
    [/\b(?:sk-proj-|gh[pousr]_)[A-Za-z0-9_-]{12,}/, 'credential_pattern'],
    [/Bearer\s+[A-Za-z0-9_-]{20,}/, 'bearer_value'],
    [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/, 'email_address'],
    [/https?:\/\/(?:hub|my|auth|math|read)\.rootsofreason\.org\b/, 'live_application_address'],
    [/\b(?:[a-z]+-)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i, 'unexpected_resource_identifier'],
  ];
  for (const [pattern, reason] of tests) if (pattern.test(text)) violations.push({ path, reason });
}
const tracked = spawnSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' });
if (tracked.status !== 0) throw new Error('tracked_scope_unavailable');
for (const path of tracked.stdout.split('\0').filter(Boolean)) if (!allowed.has(path)) violations.push({ path, reason: 'tracked_file_outside_allowlist' });
if (violations.length) { console.error(JSON.stringify({ ok: false, violations }, null, 2)); process.exit(1); }
console.log(`Public scope checked: ${allowed.size} explicitly allowed text files; no configured privacy-pattern findings. Manual review remains necessary.`);
