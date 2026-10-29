export const VARIANTS = Object.freeze(['before', 'fixed', 'regression']);
export const MAX_LAUNCHES = 3;
export const RETRY_BASE_MS = 1_000;

export function resolveVariant(value = 'fixed') {
  if (!VARIANTS.includes(value)) throw new Error('Unknown QA variant');
  return value;
}

export class VirtualClock {
  constructor() { this.milliseconds = 0; }
  now() { return this.milliseconds; }
  advance(milliseconds) {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) throw new Error('Invalid clock advance');
    this.milliseconds += milliseconds;
  }
}

export class DurableQueue {
  constructor() { this.records = new Map(); }
  enqueue(eventId) {
    if (this.records.has(eventId)) return;
    this.records.set(eventId, {
      eventId, state: 'pending', attempts: 0, retryAt: 0,
      targetSessionId: null, launchInProgress: false, deliveredAt: null,
    });
  }
  read(eventId) { return structuredClone(this.records.get(eventId)); }
  pending() { return [...this.records.values()].filter(row => row.deliveredAt === null); }
}

export class FakeLauncher {
  constructor({ inventoryKnown = true, discoverable = true, acknowledgement = 'valid' } = {}) {
    this.inventoryKnown = inventoryKnown;
    this.discoverable = discoverable;
    this.acknowledgement = acknowledgement;
    this.sessions = new Map();
    this.launches = [];
    this.messageAttempts = [];
  }
  inventory() {
    return this.inventoryKnown
      ? { known: true, sessions: this.discoverable ? [...this.sessions.values()] : [] }
      : { known: false, sessions: null };
  }
  launch(eventId) {
    const sessionId = `synthetic-session-${this.launches.length + 1}`;
    this.sessions.set(sessionId, { sessionId, inbox: [] });
    this.launches.push({ sessionId, eventId });
    return { accepted: true, sessionId: this.discoverable ? sessionId : null };
  }
  send(sessionId, eventId) {
    const session = this.sessions.get(sessionId);
    this.messageAttempts.push({ sessionId, eventId });
    if (!session) return { accepted: false };
    session.inbox.push(eventId);
    if (this.acknowledgement === 'missing') return null;
    if (this.acknowledgement === 'wrong-event') return { accepted: true, sessionId, eventId: 'synthetic-unrelated-event' };
    return { accepted: true, sessionId, eventId };
  }
}

export class SimulatedCrash extends Error {
  constructor() { super('Synthetic interruption after launcher side effect, before receipt persistence'); }
}

export class Escalator {
  constructor({ queue, launcher, clock, variant = 'fixed' }) {
    this.queue = queue;
    this.launcher = launcher;
    this.clock = clock;
    this.variant = resolveVariant(variant);
    this.runtimeTargets = new Map();
  }

  async drain({ crashAfterLaunch = false } = {}) {
    for (const row of this.queue.pending()) {
      const corrected = this.variant !== 'before';
      const inventory = this.launcher.inventory();

      if (this.variant === 'fixed' && !inventory.known) {
        row.state = 'inventory_unavailable';
        continue;
      }
      if (corrected && row.launchInProgress) {
        row.state = 'launch_uncertain';
        continue;
      }
      if (corrected && this.clock.now() < row.retryAt) continue;

      const sessions = inventory.known ? inventory.sessions : [];
      const target = corrected ? row.targetSessionId : this.runtimeTargets.get(row.eventId);
      if (target && sessions.some(session => session.sessionId === target)) {
        const acknowledgement = this.launcher.send(target, row.eventId);
        if (acknowledgement?.accepted === true && acknowledgement.sessionId === target
          && acknowledgement.eventId === row.eventId) {
          row.state = 'delivered';
          row.deliveredAt = this.clock.now();
        } else {
          row.state = 'waiting_for_acknowledgement';
          row.retryAt = this.clock.now() + RETRY_BASE_MS;
        }
        continue;
      }

      if (corrected && row.attempts >= MAX_LAUNCHES) {
        row.state = 'operator_attention';
        continue;
      }
      row.attempts += 1;
      if (corrected) row.launchInProgress = true;
      const receipt = this.launcher.launch(row.eventId);
      if (crashAfterLaunch) throw new SimulatedCrash();

      if (corrected) {
        row.launchInProgress = false;
        row.targetSessionId = receipt.sessionId;
      } else {
        this.runtimeTargets.set(row.eventId, receipt.sessionId);
      }
      row.retryAt = this.clock.now() + RETRY_BASE_MS * 2 ** (row.attempts - 1);
      row.state = corrected && row.attempts >= MAX_LAUNCHES && receipt.sessionId === null
        ? 'operator_attention' : 'waiting_for_identity';
    }
  }
}

export function fixture({ variant = 'fixed', ...launcherOptions } = {}) {
  const queue = new DurableQueue();
  const launcher = new FakeLauncher(launcherOptions);
  const clock = new VirtualClock();
  queue.enqueue('synthetic-event-001');
  const worker = new Escalator({ queue, launcher, clock, variant });
  return { queue, launcher, clock, worker };
}
