import assert from 'node:assert/strict';
import test from 'node:test';
import { createDocumentSync, createMemoryStorage, createVersionedServer } from './model.mjs';

test('one device can save a local edit when no other device changes the document', async () => {
  const server = createVersionedServer();
  const client = createDocumentSync({ server, storage: createMemoryStorage(), variant: process.env.QA_VARIANT || 'fixed' });
  await client.open();
  client.edit('Single-device edit');
  assert.equal((await client.save()).status, 'saved');
  assert.equal(server.inspect().document.text, 'Single-device edit');
});
