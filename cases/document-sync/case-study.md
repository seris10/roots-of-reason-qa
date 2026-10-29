# Document synchronization that preserves unsent work

Case SYNC-01 · Synthetic reconstruction of a documented failure mechanism

An offline draft must not silently overwrite a newer edit from another device. A revision identifies the document on which the draft was based. Observing a newer revision does not mean the unsent draft was created from that revision.

## Historical finding

A private review of August 2026 Roots of Reason code history recorded two related failures: unsent text could be replaced during synchronization, and an attempted repair stamped the latest server revision onto unsent local content. A source-pattern test required the faulty stamping form. An independent agent reviewer supplied the missing sequence counterexample; subsequent code and tests preserved the basis revision and added sequence and planted-regression checks. The inspected historical record explicitly left browser and two-device acceptance untested.

KJR directed the broader requirement that QA claims match their actual assertions. Historical implementation and the specific counterexample are attributed to agents in the private evidence record. The originating human requirement for this particular synchronization repair is not established. This public example was newly implemented with AI assistance; it is not an archived production source file or a rerun of the historical application.

## Reproduction

Run the same acceptance assertions against each variant from the repository root:

```sh
node --test cases/document-sync/acceptance.test.mjs
QA_VARIANT=before node --test cases/document-sync/acceptance.test.mjs
QA_VARIANT=regression node --test cases/document-sync/acceptance.test.mjs
QA_VARIANT=before node --test cases/document-sync/smoke.test.mjs
node cases/document-sync/demo.mjs fixed
```

The `before` variant advances an unsent draft's basis when it reads the server. The `fixed` variant preserves that basis until an acknowledged save or an explicit conflict resolution. The `regression` variant makes the narrower mistake only when writing the durable checkpoint: it initially shows a conflict, but a reload loses that protection. The fault variants are expected to fail acceptance.

The separate smoke control covers only a single-device save. It passes with all three variants, including the faulty ones. That result is valid for its small assertion and insufficient evidence for concurrent synchronization. It is a new illustrative control, not the original historical source-pattern test.

## What the checks establish

The tests use two synthetic device actions, a versioned in-memory server and durable-in-model storage. They inspect the server's actual document and accepted write history after edit, pull, serialize, reload and save. Additional checks cover a clean refresh, unavailable reads/writes, lost acknowledgement replay, explicit conflict resolution, another remote edit and a late save acknowledgement while typing continues.

The server's revision precondition is a separate boundary from the client. A stale resolution cannot overwrite a subsequent remote edit. A stable request identity prevents a lost acknowledgement from producing a second accepted write.

No source-string match is used to establish synchronization correctness. No browser, physical second device, database service, network or live family account is exercised. The controlled fault variants demonstrate detection of these specified faults, not complete mutation coverage or proof that the live application is correct.
