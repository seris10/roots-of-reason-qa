import { createDocumentSync, createMemoryStorage, createVersionedServer } from './model.mjs';

export async function runScenario(variant = 'fixed') {
  const server = createVersionedServer();
  const storage = createMemoryStorage();
  const connect = () => createDocumentSync({ server, storage, variant });
  const client = connect();
  await client.open();
  client.edit('Unsent first-device draft');
  server.write({ basisRevision: 1, text: 'New second-device note', mutationId: 'device-b:1' });
  const beforeReload = await client.pull();
  const reloaded = connect();
  const afterReload = await reloaded.open();
  const attemptedSave = await reloaded.save();
  return {
    caseId: 'SYNC-01',
    reconstruction: 'synthetic state-machine example; no application or browser data',
    variant,
    beforeReload: { mode: beforeReload.mode, localText: beforeReload.local.text, remoteText: beforeReload.remote.text },
    afterReload: { mode: afterReload.mode, localText: afterReload.local.text },
    attemptedSave: attemptedSave.status,
    storedDocument: server.inspect().document,
    acceptedWrites: server.inspect().acceptedWrites.length,
  };
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  console.log(JSON.stringify(await runScenario(process.argv[2] || process.env.QA_VARIANT || 'fixed'), null, 2));
}
