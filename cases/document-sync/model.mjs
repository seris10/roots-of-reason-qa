export const VARIANTS = Object.freeze(['before', 'fixed', 'regression']);

const copy = value => structuredClone(value);

export function createMemoryStorage() {
  const rows = new Map();
  return {
    read(key) { return rows.has(key) ? copy(rows.get(key)) : null; },
    write(key, value) { rows.set(key, copy(value)); },
  };
}

export function createVersionedServer(text = 'Shared planning note') {
  let document = { revision: 1, text };
  let available = true;
  let loseAcknowledgement = false;
  const receipts = new Map();
  const writes = [];
  return {
    read() {
      if (!available) throw new Error('synthetic_service_unavailable');
      return copy(document);
    },
    write(request) {
      if (!available) throw new Error('synthetic_service_unavailable');
      const previous = receipts.get(request.mutationId);
      if (previous) {
        const same = previous.request.text === request.text && previous.request.basisRevision === request.basisRevision;
        return same ? { ...copy(previous.result), replayed: true } : { status: 'mutation_conflict' };
      }
      if (request.basisRevision !== document.revision) return { status: 'conflict', document: copy(document) };
      document = { revision: document.revision + 1, text: request.text };
      const result = { status: 'saved', document: copy(document) };
      receipts.set(request.mutationId, { request: copy(request), result: copy(result) });
      writes.push(copy(request));
      if (loseAcknowledgement) {
        loseAcknowledgement = false;
        throw new Error('synthetic_acknowledgement_lost');
      }
      return result;
    },
    setAvailable(value) { available = Boolean(value); },
    loseNextAcknowledgement() { loseAcknowledgement = true; },
    inspect() { return { document: copy(document), acceptedWrites: copy(writes) }; },
  };
}

export function createDocumentSync({ server, storage, clientId = 'device-a', variant = 'fixed' }) {
  if (!VARIANTS.includes(variant)) throw new Error('unknown_variant');
  const key = `document:${clientId}`;
  let local = storage.read(key);
  let observed = null;
  let mode = local ? 'not_connected' : 'not_loaded';

  function checkpoint() {
    const stored = copy(local);
    // The planted regression changes only the durable checkpoint, so a reload is required to expose it.
    if (variant === 'regression' && stored.dirty && observed && observed.revision > stored.basisRevision) {
      stored.basisRevision = observed.revision;
    }
    storage.write(key, stored);
  }

  function snapshot() {
    return { mode, local: copy(local), remote: copy(observed) };
  }

  async function pull() {
    try {
      observed = await server.read();
    } catch {
      mode = 'offline';
      return snapshot();
    }
    if (!local) {
      local = { text: observed.text, basisRevision: observed.revision, dirty: false, nextMutation: 1, pending: null };
    } else if (!local.dirty) {
      local.text = observed.text;
      local.basisRevision = observed.revision;
    } else if (variant === 'before') {
      local.basisRevision = observed.revision;
    }
    mode = local.pending ? 'pending' : local.dirty && local.basisRevision !== observed.revision ? 'conflict' : 'ready';
    checkpoint();
    return snapshot();
  }

  return {
    open: pull,
    pull,
    snapshot,
    edit(text) {
      if (!local) throw new Error('document_not_loaded');
      local.text = String(text);
      local.dirty = true;
      checkpoint();
      return snapshot();
    },
    resolveConflict({ text, expectedRemoteRevision }) {
      if (mode !== 'conflict' || expectedRemoteRevision !== observed?.revision) throw new Error('conflict_context_required');
      local.text = String(text);
      local.basisRevision = expectedRemoteRevision;
      local.dirty = true;
      local.pending = null;
      mode = 'ready';
      checkpoint();
    },
    async save() {
      if (!local) throw new Error('document_not_loaded');
      if (mode === 'conflict') return { status: 'conflict', document: copy(observed) };
      if (!local.dirty) return { status: 'unchanged' };
      if (!local.pending) {
        local.pending = { text: local.text, basisRevision: local.basisRevision, mutationId: `${clientId}:${local.nextMutation++}` };
        checkpoint();
      }
      const submitted = copy(local.pending);
      let result;
      try {
        result = await server.write(submitted);
      } catch {
        mode = 'offline';
        checkpoint();
        return { status: 'retry' };
      }
      if (result.status === 'conflict') {
        observed = result.document;
        local.pending = null;
        mode = 'conflict';
        checkpoint();
        return copy(result);
      }
      if (result.status !== 'saved') return copy(result);
      observed = result.document;
      local.basisRevision = result.document.revision;
      local.dirty = local.text !== submitted.text;
      local.pending = null;
      mode = 'ready';
      checkpoint();
      return copy(result);
    },
  };
}
