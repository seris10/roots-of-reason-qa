import { pathToFileURL } from 'node:url';
import { Escalator, fixture, resolveVariant } from './model.mjs';

export async function demonstrate(variant = 'fixed') {
  resolveVariant(variant);
  const summaries = {};
  for (const [name, options] of [
    ['unidentified_session', { discoverable: false }],
    ['unknown_inventory', { inventoryKnown: false }],
  ]) {
    const { queue, launcher, clock, worker } = fixture({ variant, ...options });
    for (let drain = 0; drain < 8; drain += 1) {
      await worker.drain();
      clock.advance(10_000);
    }
    const row = queue.read('synthetic-event-001');
    summaries[name] = { drains: 8, sessionsLaunched: launcher.launches.length,
      durableState: row.state, undeliveredEvents: queue.pending().length };
  }
  const { queue, launcher, clock, worker } = fixture({ variant, acknowledgement: 'missing' });
  await worker.drain();
  clock.advance(10_000);
  await new Escalator({ queue, launcher, clock, variant }).drain();
  summaries.restart_after_receipt = { sessionsLaunched: launcher.launches.length,
    recipientCopies: [...launcher.sessions.values()].reduce((sum, session) => sum + session.inbox.length, 0),
    undeliveredEvents: queue.pending().length };
  return { caseId: 'OPS-01', kind: 'synthetic reconstruction', variant,
    clock: 'deterministic virtual milliseconds', observations: summaries };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(await demonstrate(process.argv[2] ?? process.env.QA_VARIANT ?? 'fixed'), null, 2));
}
