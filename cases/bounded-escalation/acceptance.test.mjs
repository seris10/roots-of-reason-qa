import assert from 'node:assert/strict';
import test from 'node:test';
import { Escalator, MAX_LAUNCHES, RETRY_BASE_MS, SimulatedCrash, fixture, resolveVariant } from './model.mjs';

const variant = resolveVariant(process.env.QA_VARIANT ?? 'fixed');
const eventId = 'synthetic-event-001';

test('eight drains cannot launch more than three unidentified sessions; undelivered work stays visible', async () => {
  const { queue, launcher, clock, worker } = fixture({ variant, discoverable: false });
  for (let drain = 0; drain < 8; drain += 1) {
    await worker.drain();
    clock.advance(10_000);
  }
  assert.equal(launcher.sessions.size, 3);
  assert.equal(launcher.launches.length, MAX_LAUNCHES);
  const saved = queue.read(eventId);
  assert.equal(saved.attempts, 3);
  assert.equal(saved.state, 'operator_attention');
  assert.equal(saved.deliveredAt, null);
  assert.equal(queue.pending().length, 1);
});

test('an unavailable inventory is not an empty inventory and cannot authorize a launch', async () => {
  const { queue, launcher, clock, worker } = fixture({ variant, inventoryKnown: false });
  for (let drain = 0; drain < 8; drain += 1) {
    await worker.drain();
    clock.advance(10_000);
  }
  assert.equal(launcher.launches.length, 0);
  assert.equal(queue.read(eventId).attempts, 0);
  assert.equal(queue.read(eventId).state, 'inventory_unavailable');
  assert.equal(queue.pending().length, 1);
});

test('a known empty inventory permits one launch but launch acceptance does not acknowledge delivery', async () => {
  const { queue, launcher, clock, worker } = fixture({ variant });
  await worker.drain();
  assert.equal(launcher.launches.length, 1);
  assert.equal(launcher.sessions.values().next().value.inbox.length, 0);
  assert.equal(queue.read(eventId).deliveredAt, null);
  clock.advance(RETRY_BASE_MS);
  await worker.drain();
  assert.deepEqual(launcher.sessions.values().next().value.inbox, [eventId]);
  assert.equal(queue.read(eventId).state, 'delivered');
  assert.equal(queue.pending().length, 0);
});

test('restarting after a recorded session receipt reuses that session rather than opening another', async () => {
  const { queue, launcher, clock, worker } = fixture({ variant, acknowledgement: 'missing' });
  await worker.drain();
  clock.advance(RETRY_BASE_MS);
  const restarted = new Escalator({ queue, launcher, clock, variant });
  await restarted.drain();
  assert.equal(launcher.launches.length, 1);
  assert.deepEqual(launcher.sessions.values().next().value.inbox, [eventId]);
  assert.equal(queue.read(eventId).state, 'waiting_for_acknowledgement');
  assert.equal(queue.pending().length, 1);
});

test('a crash after a launch side effect leaves explicit uncertainty and never launches again automatically', async () => {
  const { queue, launcher, clock, worker } = fixture({ variant });
  await assert.rejects(worker.drain({ crashAfterLaunch: true }), SimulatedCrash);
  clock.advance(10_000);
  const restarted = new Escalator({ queue, launcher, clock, variant });
  await restarted.drain();
  assert.equal(launcher.sessions.size, 1);
  assert.equal(queue.read(eventId).state, 'launch_uncertain');
  assert.equal(queue.read(eventId).deliveredAt, null);
  assert.equal(queue.pending().length, 1);
});

test('repeated immediate drains obey backoff rather than exhausting the launch allowance', async () => {
  const { queue, launcher, clock, worker } = fixture({ variant, discoverable: false });
  for (let drain = 0; drain < 8; drain += 1) await worker.drain();
  assert.equal(launcher.launches.length, 1);
  assert.equal(queue.read(eventId).attempts, 1);
  assert.equal(queue.read(eventId).deliveredAt, null);
  clock.advance(RETRY_BASE_MS - 1);
  await worker.drain();
  assert.equal(launcher.launches.length, 1);
  clock.advance(1);
  await worker.drain();
  assert.equal(launcher.launches.length, 2);
});

test('a missing acknowledgement preserves work even when the recipient already received the event', async () => {
  const { queue, launcher, clock, worker } = fixture({ variant, acknowledgement: 'missing' });
  await worker.drain();
  clock.advance(10_000);
  await worker.drain();
  assert.deepEqual(launcher.sessions.values().next().value.inbox, [eventId]);
  assert.equal(queue.read(eventId).deliveredAt, null);
  assert.equal(queue.pending().length, 1);
});

test('an acknowledgement naming another event cannot mark this event delivered', async () => {
  const { queue, launcher, clock, worker } = fixture({ variant, acknowledgement: 'wrong-event' });
  await worker.drain();
  clock.advance(10_000);
  await worker.drain();
  assert.equal(launcher.messageAttempts.length, 1);
  assert.equal(queue.read(eventId).deliveredAt, null);
  assert.equal(queue.pending().length, 1);
});
