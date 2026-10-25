# Independent proposal acceptance — issue #117

## Reproduction and cause

Prepare one request to widen the office desk and another to widen the main-bedroom bed against the same residential model revision. Accept the desk, then the bed. The original server rejected the bed with “This proposal is based on an older or unaccepted model. Revise it against the current accepted model.”

The backlog invalidated every other ready ticket after acceptance and every result finishing against an older revision. Its acceptance path restored the proposal's complete historical project rather than applying its delta to the current accepted model. The UI also instructed users to revise whenever revision IDs differed.

## Plan and change

- `src/room-model.ts`: reconcile base/current/proposed snapshots by stable entity and relationship identity; validate the combined snapshot; retain both histories and the original proposal evidence. Record the resulting revision separately in the accepted decision's optional `appliedRevisionId`.
- `demo/change-requests.ts`: assess actual compatibility when work completes, when another request is accepted and when a proposal is opened. Recover compatible old `needs-input` tickets. Keep decision/request identity checks, idempotency and transactional compare-and-swap protection.
- `demo/server.ts` and `demo/room-app.ts`: reassess an opened ticket before enabling its actions and replace the blanket stale-base warning with an explanation that unrelated accepted changes are retained.
- Tests: add `demo/proposal-reconciliation.test.ts` to `npm test`; strengthen the existing same-door conflict assertion.
- Validators: keep all snapshot, ancestry, content-hash, family-identity, evidence, history and size validation. Restore recomputes each applied revision from its accepted predecessor and the original reviewed delta, refusing mismatches.

`accept` remains the synchronous operation for a proposal whose base is the current model, and now refuses stale acceptance. `acceptFrom` imports and reconciles a separately prepared proposal before acceptance. Neither API runs an agent.

## Acceptance evidence

All builds and tests ran in an isolated Docker container on `192.168.1.17`, Node 24.22.1. No shared-preview data, credentials or deployment configuration were changed.

See [verification.txt](verification.txt) for the initial failing reproduction, final validation and test output:

- Original regression: **1 failed**, matching the reported acceptance failure.
- Targeted core/backlog tests: **65 passed**.
- Final reconciliation tests: **8 passed**.
- Full `npm test`: **437 tests**, **435 passed**, **2 skipped**, **0 failed** under root. The two existing permission checks skipped for root were rerun as UID 65032:33: **2 passed, 0 skipped**. Thus all 437 unique tests passed across these runs.
- `npm run validate` and the demo build passed; explicit policy validation checked all 12 changed paths.

The eight new cases cover independent desk/bed acceptance, completion after another acceptance, recovery of a durable old blocked ticket without an agent, simultaneous decisions and retry, unrelated additions/removals/hosting changes, overlapping geometry on different object IDs, incompatible opening/host changes, and tampered applied-revision evidence. Original request identity, attempts, source proposal revisions, script evidence and revision history are retained. The existing same-door test continues to require revision and now identifies `door-entry` as the conflict.

### UI test and model delta

Through the browser, created a disposable residential project, selected the office desk and main-bedroom bed in their rooms, and submitted both requests before accepting either. A deterministic worker used the real ScriptBox and proposal pipeline; this is not a test of live AI intent inference. Both proposals used base `5b5a358a2a…`.

Accepted the desk through the UI. Reopened the bed request and verified **Accept this version was enabled**: [second-ready.png](second-ready.png). Accepted the bed without revising it. Both requests appeared as completed, each still on attempt 1: [both-accepted.png](both-accepted.png).

A separate read-only inspection of the candidate's SQLite state restored and validated the saved project and asserted:

| Object | Before width | Accepted width |
| --- | ---: | ---: |
| office-desk | 1.6 m | 1.8 m |
| main-bed | 1.8 m | 2.0 m |

Only these two entities changed. No entities were added or removed; no relationships changed. Both tickets retained their request IDs, one attempt and zero revisions. See the full [model delta and decisions](model-delta.json).

## Limits and review

Different edits to the same entity or relationship remain conservative conflicts. Different objects can also conflict through combined model validation. This does not infer every semantic dependency in the user's natural-language intent. The 32-revision/branch and 256 KiB preview limits remain enforced; applying an older proposal adds one revision retaining the accepted predecessor.

The original review remains bound to the original proposal and is displayed against that base. Acceptance revalidates against the latest model. No proposal is automatically accepted. Existing saved files remain readable unchanged; older application builds cannot read decisions containing the new `appliedRevisionId` field. This model/schema behavior requires human review. The PR is stacked on #116 and is not merged or deployed.

## Run record

| Attempt | Evidence | Outcome |
| --- | --- | --- |
| 1 | Deterministic red reproduction → reconciliation tests and full suite green → two UI acceptances and persisted delta | Draft PR for human review |
