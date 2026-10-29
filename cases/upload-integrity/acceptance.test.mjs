import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { BoundedPartStore, PART_BYTES, RPC_LIMIT_BYTES, batchForFixture, createStores,
  envelopeBytes, syntheticBytes, upload, variantFromEnvironment } from './model.mjs';

const variant = variantFromEnvironment();
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

async function readCopies(stores, key) {
  const reads = {};
  for (const name of ['primary', 'secondary', 'parts']) {
    try { reads[name] = await stores[name].get(key); } catch { reads[name] = null; }
  }
  return reads;
}

test('the measured envelope matches literal serialized JSON, including delimiters', () => {
  const statements = [{ key: 'synthetic', part: 0, parts: 1, bytes: Buffer.from([0, 255]) }];
  const literal = '{"statements":[{"key":"synthetic","part":0,"parts":1,"blob":[0,255]}]}';
  assert.equal(envelopeBytes(statements), Buffer.byteLength(literal));
  assert.equal(envelopeBytes([]), Buffer.byteLength('{"statements":[]}'));
});

test('the modeled RPC accepts its exact byte limit and rejects one byte less atomically', async () => {
  const statements = [{ key: 'boundary', part: 0, parts: 1, bytes: Buffer.from([0, 255]) }];
  const literal = '{"statements":[{"key":"boundary","part":0,"parts":1,"blob":[0,255]}]}';
  const actualSize = Buffer.byteLength(literal);
  const accepts = new BoundedPartStore({ limitBytes: actualSize });
  await accepts.writeBatch(statements);
  assert.deepEqual(await accepts.get('boundary'), Buffer.from([0, 255]));
  const rejects = new BoundedPartStore({ limitBytes: actualSize - 1 });
  await assert.rejects(rejects.writeBatch(statements), /envelope_too_large/);
  assert.equal(await rejects.get('boundary'), null);
});

test('a small accepted upload can be read independently from every required store', async () => {
  const bytes = syntheticBytes(61_534), stores = createStores(), key = 'small-object';
  const receipt = await upload({ bytes, stores, variant, key });
  const readbacks = await readCopies(stores, key);
  for (const saved of Object.values(readbacks)) {
    assert.ok(saved);
    assert.equal(saved.byteLength, bytes.byteLength);
    assert.equal(hash(saved), hash(bytes));
  }
  assert.equal(receipt.saved, true);
  assert.equal(receipt.redundancy, 'complete');
  assert.equal(receipt.copies, 3);
  assert.deepEqual(stores.evidenceRecords.get(key), { bytes: bytes.length, sha256: hash(bytes) });
});

test('a 9.55 MB original has all three complete readbacks despite an oversized aggregate envelope', async () => {
  const bytes = syntheticBytes(9_549_126), stores = createStores(), key = 'large-object';
  assert.ok(envelopeBytes(batchForFixture(key, bytes)) > RPC_LIMIT_BYTES,
    'this fixture crosses the modeled serialized envelope boundary');
  const receipt = await upload({ bytes, stores, variant, key });
  const readbacks = await readCopies(stores, key);
  for (const [name, saved] of Object.entries(readbacks)) {
    assert.ok(saved, `${name} must contain a readable complete original`);
    assert.equal(saved.byteLength, bytes.byteLength, `${name} length`);
    assert.equal(hash(saved), hash(bytes), `${name} hash`);
  }
  assert.equal(stores.parts.storedParts(key), 10);
  assert.ok(stores.parts.requests.every(request => request.accepted && request.encodedBytes <= RPC_LIMIT_BYTES));
  assert.equal(receipt.redundancy, 'complete');
});

test('an original over 20 MB reassembles in order without silent truncation', async () => {
  const bytes = syntheticBytes(20_653_037), stores = createStores(), key = 'larger-object';
  await upload({ bytes, stores, variant, key });
  const readbacks = await readCopies(stores, key);
  assert.equal(stores.parts.storedParts(key), Math.ceil(bytes.length / PART_BYTES));
  for (const [name, saved] of Object.entries(readbacks)) {
    assert.ok(saved, `${name} original exists`);
    assert.equal(hash(saved), hash(bytes), `${name} original preserves all bytes`);
  }
});

test('one failed store preserves surviving originals and reports degraded redundancy', async () => {
  const bytes = syntheticBytes(4096), stores = createStores({ primary: { failWrite: true } }), key = 'one-store-down';
  const receipt = await upload({ bytes, stores, variant, key });
  assert.equal(await stores.primary.get(key), null);
  assert.equal(hash(await stores.secondary.get(key)), hash(bytes));
  assert.equal(hash(await stores.parts.get(key)), hash(bytes));
  assert.equal(receipt.saved, true);
  assert.equal(receipt.redundancy, 'degraded');
  assert.equal(receipt.acknowledgement, 'saved-copy-incomplete');
  assert.equal(receipt.alert, 'copy-incomplete');
  assert.equal(receipt.copies, 2);
});

test('an acknowledged but truncated copy cannot produce a complete-redundancy receipt', async () => {
  const bytes = syntheticBytes(8192), stores = createStores({ parts: { truncateRead: true } }), key = 'truncated-copy';
  const receipt = await upload({ bytes, stores, variant, key });
  assert.notEqual(hash(await stores.parts.get(key)), hash(bytes));
  assert.equal(hash(await stores.primary.get(key)), hash(bytes));
  assert.equal(hash(await stores.secondary.get(key)), hash(bytes));
  assert.equal(receipt.redundancy, 'degraded');
  assert.equal(receipt.copies, 2);
  assert.equal(receipt.alert, 'copy-incomplete');
});

test('a partial part-set is not mistaken for a durable original', async () => {
  const bytes = syntheticBytes(1_000_001), stores = createStores({ parts: { failPart: 1 } }), key = 'interrupted-parts';
  const receipt = await upload({ bytes, stores, variant, key });
  await assert.rejects(stores.parts.get(key), /incomplete/);
  assert.equal(receipt.redundancy, 'degraded');
  assert.equal(receipt.copies, 2);
  assert.equal(receipt.alert, 'copy-incomplete');
});

test('all-store failure retains the draft and creates no successful evidence receipt', async () => {
  const bytes = syntheticBytes(4096), stores = createStores({
    primary: { failWrite: true }, secondary: { failWrite: true }, parts: { failWrite: true },
  }), key = 'all-stores-down';
  const receipt = await upload({ bytes, stores, variant, key });
  assert.deepEqual(await readCopies(stores, key), { primary: null, secondary: null, parts: null });
  assert.equal(receipt.saved, false);
  assert.equal(receipt.redundancy, 'unavailable');
  assert.equal(receipt.draftRetained, true);
  assert.equal(receipt.evidenceRecordCreated, false);
  assert.equal(stores.evidenceRecords.size, 0);
  assert.equal(receipt.acknowledgement, 'not-saved');
  assert.equal(receipt.alert, 'upload-failed');
});

test('unreadable acknowledgements cannot establish saved bytes', async () => {
  const bytes = syntheticBytes(4096), stores = createStores({
    primary: { failRead: true }, secondary: { failRead: true }, parts: { failRead: true },
  });
  const receipt = await upload({ bytes, stores, variant, key: 'unverified-writes' });
  assert.equal(receipt.saved, false);
  assert.equal(receipt.redundancy, 'unconfirmed');
  assert.equal(receipt.acknowledgement, 'save-unconfirmed');
  assert.equal(receipt.draftRetained, true);
  assert.equal(receipt.evidenceRecordCreated, false);
  assert.equal(stores.evidenceRecords.size, 0);
  stores.primary.options.failRead = false;
  assert.equal(hash(await stores.primary.get('unverified-writes')), hash(bytes),
    'the bytes can exist even when their saving could not be confirmed');
});
