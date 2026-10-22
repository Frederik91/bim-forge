# Single-use schedule admission

This library prepares the admission boundary for hourly coding and draft publication. It does not install a timer, start a model, or publish. The manual CLI does not yet accept schedule approvals. Human review is required before deployment or integration.

## Approval contract

`parseScheduleApproval(bytes, approvedSha256, now)` validates exact-byte approval data. Supply a Buffer of at most 16 KiB and its independently approved lowercase SHA-256. JSON must be compact `JSON.stringify` output followed by exactly one newline. This canonical form rejects duplicate fields, extra whitespace, alternate encodings, and ambiguous numeric representations. UTF-8 decoding is strict.

An approval has exactly seven fields:

```json
{"version":1,"repository":"Frederik91/bim-forge","scopeSha256":"<64 lowercase hex>","deploymentSha256":"<64 lowercase hex>","notBefore":"2026-10-22T00:00:00.000Z","expiresAt":"2026-10-23T00:00:00.000Z","dailyLimit":1}
```

The example is not a valid approval. Both digests must be real reviewed values. Dates use UTC with milliseconds. Admission requires `notBefore <= now < expiresAt`, a window no longer than 24 hours, and a daily limit from 1 to 6. Unknown fields, including commands and publishing controls, fail validation. The returned object is frozen.

Normal operational approvals use three starts. The owner authorized up to six during supervised factory setup, limited to the exact approval window. The parser ceiling is not a default allowance or standing authorization. Existing approvals and all recorded starts remain unchanged. After qualification, subsequent approvals return to three. The cumulative issue ceiling remains three even under a six-start daily approval.

`deploymentSha256` is a binding, not a measurement. A future trusted dispatcher must capture the real installed controller, runtime, generator, service, adapter, verifier, and case identity. Supplying a string to this library does not attest that identity or grant authority.

## Shared reservation

The future dispatcher calls the existing `openCodingRun` with `schedule: { approvalBytes, approvedSha256, deploymentSha256 }`. It must obtain the first two values from protected administrator-owned approval state and the third from actual reviewed deployment measurement. The scope bytes stay separately protected and must hash to `scopeSha256`.

Under the existing exclusive lease, the store validates the approval and all accounting timestamps. It counts both manual and scheduled starts on the current UTC day before admitting scheduled work. This cap limits scheduled admission; the existing explicitly administered manual interface remains compatible and is not globally rate-limited by a caller's approval.

The initial durable run record contains `scheduleApprovalSha256`. That same record consumes the approval and the issue attempt before any future generator starts. There is no separate timer counter or approval-consumption journal to synchronize. A duplicate approval returns the same completed record, including a failed result, without a new attempt. Busy, interrupted, ambiguous, corrupt, or future-dated state stops admission. No lease is stolen and no history is deleted.

A scheduled call cannot set `retry`. Another approval for an already attempted scope cannot trigger a retry. A changed scope still shares the three-start lifetime issue budget. Expired approvals fail admission even if their receipt remains readable for administrator inspection.

The existing coding test entry imports the approval contract tests. No manifest edit is needed, so this change can coexist with the schedule-check trial's new test entry.

## Still required before activation

The library does not prove remote issue/main/pause state or enforce expiry after admission. A future reviewed dispatcher must add live binding checks, repeated local pause and expiry checks, a whole-job monotonic deadline, controlled candidate execution, safe publication preauthorization, and lost-response reconciliation. Publishing still needs an exact-byte package in the protected spool and fresh publisher gates. No timer may treat a successful parser result or a readiness report as permission to bypass those checks.
