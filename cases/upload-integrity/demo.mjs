import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { RPC_LIMIT_BYTES, batchForFixture, createStores, envelopeBytes, syntheticBytes,
  upload, variantFromEnvironment } from './model.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

async function observe(stores, key, expected) {
  const copies = {};
  for (const name of ['primary', 'secondary', 'parts']) {
    try {
      const bytes = await stores[name].get(key);
      copies[name] = bytes === null ? { readable: false } : {
        readable: true, bytes: bytes.length, sha256: sha256(bytes), matchesOriginal: sha256(bytes) === sha256(expected),
      };
    } catch { copies[name] = { readable: false }; }
  }
  return copies;
}

export async function runDemo(variant = 'fixed') {
  const bytes = syntheticBytes(9_549_126), key = 'synthetic-large-object', stores = createStores();
  const receipt = await upload({ bytes, key, stores, variant });
  const altered = syntheticBytes(8192), alteredKey = 'synthetic-truncation', alteredStores = createStores({ parts: { truncateRead: true } });
  const alteredReceipt = await upload({ bytes: altered, key: alteredKey, stores: alteredStores, variant });
  return {
    caseId: 'DATA-01', evidenceClass: 'new offline synthetic reconstruction', variant,
    model: 'JSON numeric-byte arrays in a bounded RPC envelope; no Cloudflare service invoked',
    largeOriginal: {
      bytes: bytes.length, sha256: sha256(bytes),
      aggregateEnvelopeBytes: envelopeBytes(batchForFixture(key, bytes)), limitBytes: RPC_LIMIT_BYTES,
      receipt, independentReadbacks: await observe(stores, key, bytes),
      rpcRequests: stores.parts.requests,
    },
    acknowledgedTruncation: {
      bytes: altered.length, receipt: alteredReceipt,
      independentReadbacks: await observe(alteredStores, alteredKey, altered),
    },
    notTested: ['actual D1 serialization or quotas', 'real object storage', 'image processing', 'email or notification delivery', 'live production behavior'],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(await runDemo(variantFromEnvironment()), null, 2));
}
