# What the evidence establishes

This packet separates a historical observation from a newly executed reconstruction. The model results are inspectable and repeatable without private infrastructure. They do not recreate every condition of the original incident.

## Three variants and one acceptance contract

`before` models the documented faulty behavior. `fixed` models the stated correction. `regression` restores one narrower mistake while retaining other corrections. The same acceptance test file runs for all three variants. The runner requires a named behavioral counterexample for each expected-red run, so a missing module or unrelated setup error cannot count as useful refutation.

The variants are explicit controlled faults. No claim of exhaustive mutation testing is made. The synchronization smoke control is a separate narrow assertion that remains green while the broader contract fails.

## Verification instrument

The receipt parser requires a complete flat TAP plan and uniquely numbered executed records that agree with the footer totals. It rejects missing or ambiguous totals. The outcome checker rejects zero tests, skips, cancellations, todos, signals, timeouts and unexpected exit states. A faulty run must fail the specific assertion listed in `cases.json`; any nonzero command is not enough. Failed controls must carry assertion diagnostics; a setup exception cannot qualify. Variant identity, the exact matrix rows and the full executable file map are checked as well. Instrument tests exercise these refusal cases.

Every receipt hashes the executable inputs, the sanitized log and the scenario observation. The optional single-device smoke log is also hashed and rechecked against its exact one-test contract. `check-evidence.mjs` recomputes those hashes and reparses the log instead of trusting the receipt's counts. Source fingerprints exclude prose, generated evidence and Git metadata to avoid a self-referential hash. They cover the models, acceptance checks, demos, runner scripts, case contracts, package configuration and pinned Node version.

## Observable outcomes

- Document tests inspect the actual in-memory server document and accepted write history after reload and retry.
- Upload tests calculate hashes from independent reads of every modeled store, rather than trusting the upload response. The modeled JSON size is checked against a literal serialized control.
- Escalation tests count actual fake sessions, inspect recipient inboxes and create a new worker over the same queue state. Launch intent, launch acceptance and message acknowledgement remain distinct.

The upload model's successful readback is a local observation, not a guarantee of indefinite durability. The escalation model assumes one queue owner and does not implement distributed locking. A crash after the side effect but before receipt persistence remains explicitly uncertain; it is not marked delivered.

## Claim boundaries

| Evidence | Supports | Does not establish |
|---|---|---|
| Private historical trace | The documented event, method and attribution at its recorded scope | A complete public replay or present production state |
| Synthetic acceptance run | Named assertions on this version of the model | Correctness of the original application |
| Expected-red control | The specified fault can refute the acceptance claim | Detection of every similar defect |
| Scenario JSON and hashes | The named synthetic bytes/state observed in that run | Real storage, physical devices or family acceptance |
| CI success | The public workflow's checks completed on its runner | A deployment or health check of Roots of Reason |

No provider accounts, original family data, historical private assets, tokens, real invitations or live auto-login paths are included. Tests do not send mail or start agent windows. The source manifest is a reproducibility control, not a certification of the private product.
