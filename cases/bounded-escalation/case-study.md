# Bounded escalation when session discovery fails

**OPS-01 · Orchestration QA · Synthetic reconstruction**

An escalation worker should retain an undelivered event without opening a new session on every poll. Session inventory can be unavailable, a newly opened session can remain unidentified, and a restart can occur between launching a session and recording its receipt.

The historical Roots of Reason investigation records an independent reviewer observing eight drains produce eight sessions while 25 separate upload/alert tests passed. A corrected isolated candidate produced at most three launches and produced none when session inventory was unavailable. A separate restart path duplicated a session while waiting for its identity. These are documented historical observations; this public example is newly written code that models their failure mechanisms.

## The missed boundary

The producer's successful event handling did not establish the desktop consumer's behavior. Treating an unknown inventory as an empty valid inventory allowed another launch. Keeping a discovered target only in process memory lost it after restart. Neither a launch request nor a missing acknowledgement establishes delivery.

## Reproduce

From the repository root:

```sh
node cases/bounded-escalation/demo.mjs before
node cases/bounded-escalation/demo.mjs fixed
node --test cases/bounded-escalation/acceptance.test.mjs
QA_VARIANT=before node --test cases/bounded-escalation/acceptance.test.mjs
QA_VARIANT=regression node --test cases/bounded-escalation/acceptance.test.mjs
```

The default fixed variant must pass. The before and regression commands must exit nonzero. The shared repository runner verifies these expected outcomes without treating an expected red run as a publication failure.

| Control | Before model | Fixed model | Planted regression |
|---|---|---|---|
| Eight drains, new sessions unidentifiable | Eight launches | Three launches, event retained for attention | Three launches |
| Eight drains, inventory unavailable | Launches continue | Zero launches, event retained | Unknown inventory is incorrectly treated as empty |
| Restart after a session receipt | Process-local target is lost | Durable target is reused | Durable target is reused |
| Crash after launch, before receipt persistence | Another launch is possible | Explicit uncertain state; no automatic relaunch | Same uncertainty handling as fixed |

## Verification design

All variants face the same eight acceptance tests. Assertions count the fake launcher's actual sessions, inspect recipient inboxes and reload durable queue state through a new worker instance. A virtual clock tests backoff without timing sleeps. The regression variant restores only the unknown-inventory error while retaining other corrections.

The corrected model writes launch intent before the side effect and stores a returned session identity durably. If interrupted before storing the receipt, it preserves an explicit `launch_uncertain` state for reconciliation. It does not pretend that an uncertain launch is delivered or repeatedly launch in order to hide uncertainty.

## Contribution and attribution

KJR required loud failure reporting and stronger reliability/verification across the system. Historical agent implementations and independent agent review supplied the particular launch/restart counterexamples and corrections described here. The public reconstruction and acceptance tests were prepared with Codex for KJR. It is not a claim that KJR manually wrote every implementation or originated every mechanism.

## Limits

This model uses fake sessions, an in-memory store that survives worker-object restart, and a deterministic clock. It makes no OS calls and opens no windows. It does not test process death, disk durability, launcher identity discovery, actual notification delivery or production behavior. Persistence across machine failure would require a real durable store and its own tests. It assumes one queue owner; concurrent-worker lease/locking behavior is not modeled.

An ambiguous acknowledgement can still result in repeated recipient copies; exactly-once delivery is not claimed. The launch cap limits resource growth but does not itself guarantee delivery. The historical candidate was verified in isolation; these results do not establish its later production activation. The reported computer freeze has no proven causal link to this candidate.
