import assert from 'node:assert/strict';
import test from 'node:test';
import { createDocumentSync, createMemoryStorage, createVersionedServer } from './model.mjs';

const variant = process.env.QA_VARIANT || 'fixed';

async function fixture() {
  const server = createVersionedServer();
  const storage = createMemoryStorage();
  const connect = () => createDocumentSync({ server, storage, variant });
  const client = connect();
  await client.open();
  return { server, client, connect };
}

function remoteEdit(server, text = 'Edited on the second device') {
  const before = server.read();
  return server.write({ basisRevision: before.revision, text, mutationId: `device-b:${before.revision}` });
}

test('an unsent local edit and a newer remote edit remain an explicit conflict', async () => {
  const { server, client } = await fixture();
  client.edit('Offline draft on the first device');
  remoteEdit(server);
  const state = await client.pull();
  assert.equal(state.mode, 'conflict');
  assert.equal(state.local.text, 'Offline draft on the first device');
  assert.equal(state.remote.text, 'Edited on the second device');
  assert.equal(server.inspect().acceptedWrites.length, 1);
});

test('serialize, reload, pull and save cannot overwrite a newer remote edit', async () => {
  const { server, client, connect } = await fixture();
  client.edit('Unsent text that must survive reload');
  remoteEdit(server);
  await client.pull();
  const reloaded = connect();
  await reloaded.open();
  const result = await reloaded.save();
  assert.equal(result.status, 'conflict');
  assert.equal(server.inspect().document.text, 'Edited on the second device');
  assert.equal(server.inspect().acceptedWrites.length, 1);
  assert.equal(reloaded.snapshot().local.text, 'Unsent text that must survive reload');
});

test('a clean local copy adopts a newer remote document and survives reload', async () => {
  const { server, client, connect } = await fixture();
  remoteEdit(server, 'A newer shared note');
  await client.pull();
  const reloaded = connect();
  await reloaded.open();
  assert.equal(reloaded.snapshot().local.text, 'A newer shared note');
  assert.equal(reloaded.snapshot().local.dirty, false);
  assert.equal((await reloaded.save()).status, 'unchanged');
  assert.equal(server.inspect().acceptedWrites.length, 1);
});

test('a failed write retains the original draft and retry writes it once', async () => {
  const { server, client } = await fixture();
  client.edit('Draft preserved through an outage');
  server.setAvailable(false);
  assert.equal((await client.save()).status, 'retry');
  assert.equal(client.snapshot().local.text, 'Draft preserved through an outage');
  assert.equal(client.snapshot().local.dirty, true);
  assert.equal(server.inspect().acceptedWrites.length, 0);
  server.setAvailable(true);
  assert.equal((await client.save()).status, 'saved');
  assert.equal(server.inspect().document.text, 'Draft preserved through an outage');
  assert.equal(server.inspect().acceptedWrites.length, 1);
});

test('a lost acknowledgement survives reload without a duplicate revision', async () => {
  const { server, client, connect } = await fixture();
  client.edit('Saved text with a lost acknowledgement');
  server.loseNextAcknowledgement();
  assert.equal((await client.save()).status, 'retry');
  assert.equal(server.inspect().acceptedWrites.length, 1);
  const reloaded = connect();
  await reloaded.open();
  const retry = await reloaded.save();
  assert.equal(retry.status, 'saved');
  assert.equal(retry.replayed, true);
  assert.equal(server.inspect().document.revision, 2);
  assert.equal(server.inspect().acceptedWrites.length, 1);
  assert.equal(reloaded.snapshot().local.dirty, false);
});

test('an explicit conflict resolution is required before replacing remote text', async () => {
  const { server, client } = await fixture();
  client.edit('First device proposal');
  remoteEdit(server);
  await client.pull();
  assert.doesNotThrow(() => client.resolveConflict({ text: 'Explicitly merged note', expectedRemoteRevision: 2 }));
  assert.equal((await client.save()).status, 'saved');
  assert.equal(server.inspect().document.text, 'Explicitly merged note');
  assert.equal(server.inspect().document.revision, 3);
});

test('a second remote change refuses a stale explicit resolution', async () => {
  const { server, client } = await fixture();
  client.edit('First device proposal');
  remoteEdit(server);
  await client.pull();
  assert.doesNotThrow(() => client.resolveConflict({ text: 'Merge based on the first remote edit', expectedRemoteRevision: 2 }));
  remoteEdit(server, 'A second remote edit');
  const result = await client.save();
  assert.equal(result.status, 'conflict');
  assert.equal(server.inspect().document.text, 'A second remote edit');
  assert.equal(server.inspect().acceptedWrites.length, 2);
  assert.equal(client.snapshot().local.text, 'Merge based on the first remote edit');
});

test('a failed read preserves the durable draft instead of substituting an empty document', async () => {
  const { server, client, connect } = await fixture();
  client.edit('Still here when reading fails');
  server.setAvailable(false);
  const reloaded = connect();
  assert.equal((await reloaded.open()).mode, 'offline');
  assert.equal(reloaded.snapshot().local.text, 'Still here when reading fails');
  assert.equal(server.inspect().acceptedWrites.length, 0);
});

test('a late save acknowledgement does not mark a newer local edit as saved', async () => {
  const server = createVersionedServer();
  const write = server.write.bind(server);
  let release;
  server.write = request => new Promise(resolve => { release = () => resolve(write(request)); });
  const client = createDocumentSync({ server, storage: createMemoryStorage(), variant });
  await client.open();
  client.edit('Submitted draft');
  const saving = client.save();
  client.edit('New text typed while saving');
  release();
  assert.equal((await saving).status, 'saved');
  assert.equal(server.inspect().document.text, 'Submitted draft');
  assert.equal(client.snapshot().local.text, 'New text typed while saving');
  assert.equal(client.snapshot().local.dirty, true);
});
