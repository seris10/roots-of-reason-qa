import { createHash } from 'node:crypto';

export const RPC_LIMIT_BYTES = 32 * 1024 * 1024;
export const PART_BYTES = 1_000_000;
export const STORE_NAMES = Object.freeze(['primary', 'secondary', 'parts']);

export function variantFromEnvironment() {
  const variant = process.env.QA_VARIANT || 'fixed';
  if (!['before', 'fixed', 'regression'].includes(variant)) {
    throw new Error('QA_VARIANT must be before, fixed, or regression');
  }
  return variant;
}

export function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function syntheticBytes(size) {
  if (!Number.isSafeInteger(size) || size < 1) throw new Error('invalid_fixture_size');
  const bytes = Buffer.alloc(size);
  for (let index = 0; index < size; index += 1) bytes[index] = (index * 73 + 31) & 255;
  return bytes;
}

function split(key, bytes) {
  const count = Math.ceil(bytes.byteLength / PART_BYTES);
  return Array.from({ length: count }, (_, part) => ({
    key,
    part,
    parts: count,
    bytes: bytes.subarray(part * PART_BYTES, Math.min((part + 1) * PART_BYTES, bytes.byteLength)),
  }));
}

function wire(statement) {
  return { key: statement.key, part: statement.part, parts: statement.parts, blob: Array.from(statement.bytes) };
}

// This equals the UTF-8 size of the complete JSON envelope without retaining one large string.
export function envelopeBytes(statements) {
  let total = Buffer.byteLength('{"statements":[') + Buffer.byteLength(']}');
  for (let index = 0; index < statements.length; index += 1) {
    total += Buffer.byteLength(JSON.stringify(wire(statements[index]))) + (index === 0 ? 0 : 1);
  }
  return total;
}

export class ObjectStore {
  constructor({ failWrite = false, failRead = false, truncateRead = false } = {}) {
    this.options = { failWrite, failRead, truncateRead };
    this.objects = new Map();
  }

  async put(key, bytes) {
    if (this.options.failWrite) throw new Error('synthetic_store_write_failed');
    this.objects.set(key, Buffer.from(bytes));
  }

  async get(key) {
    if (this.options.failRead) throw new Error('synthetic_store_read_failed');
    const stored = this.objects.get(key);
    if (!stored) return null;
    const result = Buffer.from(stored);
    return this.options.truncateRead ? result.subarray(0, Math.max(0, result.length - 1)) : result;
  }
}

export class BoundedPartStore {
  constructor({ limitBytes = RPC_LIMIT_BYTES, failWrite = false, failRead = false,
    truncateRead = false, failPart = null } = {}) {
    this.options = { limitBytes, failWrite, failRead, truncateRead, failPart };
    this.objects = new Map();
    this.requests = [];
  }

  async writeBatch(statements) {
    const encodedBytes = envelopeBytes(statements);
    const rejected = encodedBytes > this.options.limitBytes || this.options.failWrite
      || statements.some(statement => statement.part === this.options.failPart);
    this.requests.push({ encodedBytes, parts: statements.length, accepted: !rejected });
    if (rejected) throw new Error(encodedBytes > this.options.limitBytes
      ? 'synthetic_rpc_envelope_too_large' : 'synthetic_part_write_failed');
    for (const statement of statements) {
      let object = this.objects.get(statement.key);
      if (!object) {
        object = { count: statement.parts, rows: new Map() };
        this.objects.set(statement.key, object);
      }
      object.rows.set(statement.part, Buffer.from(statement.bytes));
    }
  }

  async get(key) {
    if (this.options.failRead) throw new Error('synthetic_part_read_failed');
    const object = this.objects.get(key);
    if (!object) return null;
    const ordered = Array.from({ length: object.count }, (_, index) => object.rows.get(index));
    if (ordered.some(bytes => !bytes)) throw new Error('synthetic_part_set_incomplete');
    const result = Buffer.concat(ordered);
    return this.options.truncateRead ? result.subarray(0, Math.max(0, result.length - 1)) : result;
  }

  storedParts(key) {
    return this.objects.get(key)?.rows.size || 0;
  }
}

export function createStores(options = {}) {
  return {
    primary: new ObjectStore(options.primary),
    secondary: new ObjectStore(options.secondary),
    parts: new BoundedPartStore(options.parts),
    evidenceRecords: new Map(),
  };
}

export function batchForFixture(key, bytes) {
  return split(key, bytes);
}

export async function upload({ bytes, stores, variant = 'fixed', key = 'synthetic-upload' }) {
  if (!['before', 'fixed', 'regression'].includes(variant)) throw new Error('invalid_variant');
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) throw new Error('photo_bytes_required');
  const writes = Object.fromEntries(STORE_NAMES.map(name => [name, false]));
  for (const name of ['primary', 'secondary']) {
    try { await stores[name].put(key, bytes); writes[name] = true; } catch {}
  }
  try {
    const statements = split(key, bytes);
    if (variant === 'before') await stores.parts.writeBatch(statements);
    else for (const statement of statements) await stores.parts.writeBatch([statement]);
    writes.parts = true;
  } catch {}

  const verified = { ...writes };
  if (variant === 'fixed') {
    const expectedHash = digest(bytes);
    for (const name of STORE_NAMES) {
      try {
        const saved = await stores[name].get(key);
        verified[name] = saved !== null && saved.byteLength === bytes.byteLength && digest(saved) === expectedHash;
      } catch { verified[name] = false; }
    }
  }
  const copies = Object.values(verified).filter(Boolean).length;
  const saved = copies > 0;
  const unconfirmed = !saved && Object.values(writes).some(Boolean);
  const complete = variant === 'before' ? saved : copies === STORE_NAMES.length;
  if (saved) stores.evidenceRecords.set(key, { bytes: bytes.byteLength, sha256: digest(bytes) });
  return {
    key,
    saved,
    redundancy: unconfirmed ? 'unconfirmed' : !saved ? 'unavailable' : complete ? 'complete' : 'degraded',
    copies,
    copiesRequired: STORE_NAMES.length,
    acknowledgement: unconfirmed ? 'save-unconfirmed' : !saved ? 'not-saved' : complete ? 'received' : 'saved-copy-incomplete',
    alert: unconfirmed ? 'upload-unconfirmed' : !saved ? 'upload-failed' : complete ? 'upload-saved' : 'copy-incomplete',
    draftRetained: !saved,
    evidenceRecordCreated: stores.evidenceRecords.has(key),
  };
}
