# A saved upload was missing a promised backup

**Case DATA-01 · Data integrity and boundary testing · Synthetic reconstruction**

A successful upload response can coexist with a missing original in one storage destination. This case measures a serialized request boundary and reads bytes from each destination independently of the producer's receipt.

## The historical finding

An October 2026 private Roots of Reason audit recorded a development upload of a roughly 9.5 MB synthetic image. Two object stores held the original, but a database copy held no original parts. The application had sent every binary part in one batch; the reported serialized request exceeded a 32 MiB boundary. The interface still acknowledged receipt without a clear incomplete-copy alarm.

An independent agent reviewer compared original and derivative hashes at each destination, contradicted the redundancy claim, and reported the counterexample. After parts were written separately, the recorded development checks matched originals of roughly 9.5 MB and 20.65 MB across all three locations. Those are historical development observations. They do not establish current production reliability, real-family acceptance or successful email delivery.

## What this public example reproduces

This is newly written demonstration code using deterministic non-image bytes and three in-memory stores. Its fake RPC measures the actual UTF-8 size of JSON containing numeric byte arrays. A 32 MiB envelope limit is an explicit model assumption. It does not invoke or emulate the complete Cloudflare D1 protocol, and its exact serialized sizes are not claimed to equal the historical provider request.

The `before` variant sends all parts in one envelope and presents a complete receipt when any destination saved. The `fixed` variant writes bounded parts separately, reads back each complete original, compares its length and SHA-256, and distinguishes complete, degraded, unconfirmed and unavailable storage. A write acknowledgement followed by unreadable copies remains unconfirmed: the original may exist, so the example does not claim it was lost. The `regression` variant keeps bounded writes but removes readback validation, planting the narrower fault of trusting write acknowledgements.

The tests use their own reads and SHA-256 calculations. They do not accept a producer's `complete` field as proof that the bytes exist. They cover exact envelope boundaries, large originals, an interrupted part-set, unavailable destinations, acknowledged truncation and all-store failure.

## Run the case

From this case directory, using the repository's supported Node version:

```sh
node --test acceptance.test.mjs
QA_VARIANT=before node --test acceptance.test.mjs
QA_VARIANT=regression node --test acceptance.test.mjs
node demo.mjs
```

The default corrected variant should pass. The other two commands intentionally fail the same acceptance assertions. The repository runner captures these expected red controls without treating them as successful application tests. No credential, service account or network connection is required.

## Attribution

KJR required redundant saving, independent verification and visible failure reporting. Agents implemented the historical mechanisms; an independent agent reviewer identified the batch-boundary counterexample. The private record does not establish KJR as the sole designer or manual author of that fix.

This public reconstruction was prepared with AI assistance under KJR's direction. It is an educational model of the documented failure mechanism, not a copy of private application code or a replay of an archived production release.

## Evidence limits

The local results establish only the assertions over these synthetic stores and modeled serialization. Real storage authorization, D1 runtime limits, image processing, browser draft recovery, notification delivery, attachment usability and production acceptance are not exercised. Those require separate environment-specific evidence.
