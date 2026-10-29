# Roots of Reason QA case studies

Three documented failure mechanisms from an AI-assisted tutoring platform, reconstructed with synthetic data and runnable offline. Each case runs the same acceptance assertions against a faulty model, a correction and a narrowly planted regression.

These are newly written educational models. They demonstrate specific failure mechanisms and test designs; they are not archived application code or proof of current production behavior.

[Read the case-study page](https://roots-of-reason-qa-cases.smithsonson.chatgpt.site) · [Contribution and attribution](method/attribution.md) · [Evidence boundaries](method/evidence.md)

## Run the evidence

Use Node **26.13.0**, pinned in [.node-version](.node-version). No package installation, credentials or network access is needed after cloning.

```sh
node scripts/reproduce.mjs
node scripts/check-evidence.mjs .generated/latest
```

The first command runs all three variants of all three cases, captures logs and observations under ignored `.generated/latest/`, and refuses empty, skipped, crashed or unexpectedly green faulty runs. It succeeds when the corrected models pass and the named counterexamples refute both faulty variants. An expected failing control is not counted as a passing application test.

```sh
npm test                 # receipt-instrument controls, then fresh case runs
npm run check:evidence   # check the committed receipts against current code and logs
npm run check:public     # check the publication allowlist and text boundaries
```

## Cases

| Case | Failure | Verification method |
|---|---|---|
| [SYNC-01 Document revisions](cases/document-sync/case-study.md) | Reading a new server revision made an unsent draft appear current; a reload could overwrite another device's work | Edit → remote edit → pull → checkpoint → reload → save; independently inspect the server document |
| [DATA-01 Upload integrity](cases/upload-integrity/case-study.md) | An upload response concealed a missing original in one promised storage destination | Measure a modeled serialized request boundary and hash every independently read original |
| [OPS-01 Bounded escalation](cases/bounded-escalation/case-study.md) | Repeated retries opened more sessions when discovery failed; process-local state vanished on restart | Fake launcher, durable-in-model queue, virtual clock, restart and unknown-inventory controls |

The synchronization case includes a narrow single-device smoke check that passes even in the faulty models. That illustrates the boundary of the assertion; it is not the original historical source-pattern test.

## Inspect the results

[evidence/summary.json](evidence/summary.json) indexes nine acceptance runs. Each case directory under `evidence/` contains a sanitized TAP log, a source-bound receipt and an independently observed scenario for each variant.

Receipts identify the runtime, command, UTC time, source fingerprints, actual exit status, pass/fail/skip counts, the failed assertion names and the log/observation hashes. The source commit identifies the code base at execution time; fingerprints identify the exact executable inputs. A later commit that adds receipts does not mean the tests ran against a different model.

To refresh reviewed evidence after changing executable inputs:

```sh
npm run evidence
npm run check:evidence
```

Do not reuse a green receipt after changing its source. CI reruns the models and checks that the committed receipts still match the named code and artifacts. A successful workflow says nothing about the private tutoring system's health.

## Contribution

KJR owns the project and directed the requirements, challenged unsupported completion claims, and requested stronger QA and independent verification. Agents implemented historical changes and supplied several specific counterexamples and reviews. The new public models, tests and packaging were prepared with Codex under KJR's direction. See the [per-case attribution](method/attribution.md); Git author metadata is not a record of who manually wrote every line.

The historical summaries were checked against a private source trace. Raw transcripts, family records, real work, account identifiers and production access details are excluded. A private provenance mapping is retained outside this repository. Public readers can reproduce the models; the original private environment is not independently replayable from this packet.

## Scope

All state, text, bytes, events and sessions in these examples are synthetic. Tests use no real database, storage provider, mail service, browser account or terminal launcher. The upload envelope is an explicit model, and the orchestration queue survives object restart only in memory. The packet makes no claim of complete fault coverage, exactly-once delivery, physical-device acceptance or a cause for the reported historical machine freeze.

MIT-licensed new example code and documentation. [License](license).
