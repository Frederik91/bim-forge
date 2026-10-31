# Spatial acceptance fixtures and offline queue evidence

Issue #264, epic #251. Deterministic queue qualification; final integrated UI
qualification remains #258.

## Files and ownership

`tests/fixtures/spatial-workspace/fixture.ts` owns the disposable native building,
stable identities, source-bound visual contexts and independent expected delta.
The adjacent README records units and the expected before/after representation.
`demo/spatial-workspace-fixture.test.ts` imports these helpers so the existing
strict typecheck includes them as well as running observable fixture assertions.

The completion plan adds dedicated `worker.ts` and `harness.ts`, exercised from
`demo/spatial-workspace-journey.test.ts`; package.json registers these checks.
Use existing snapshot validators, placement parsers, ScriptBox WASM, queue,
conversation, persistence and decision authority. No runtime module, validator,
production model, camera, Plan implementation or deployment configuration changes.

## Acceptance data

Use the existing version-two multi-storey native building: three levels, six rooms,
real slabs, stairs, furniture and hosted doors. The ground connecting door changes
from 0.9 m width / 3.0 m offset to 1.1 m / 2.9 m. Its evaluated project centre stays
at [4, 3.45, 0] m. Exactly one Door and one hosted-by relationship change; all other
authored fields remain identical. The expected snapshot is an independent oracle,
never a supplied worker result or accepted geometry shortcut.

The offline worker calls `model.previewHostedDoorWidth` inside the actual ScriptBox
WASM host, which generates and validates the candidate. Full snapshot/delta and
independent centre/width/host assertions compare against the separate oracle.
All additions, removals, modifications and authored fields are checked.

Actual route: fixture request -> ChangeRequests.submit -> offline ModelWorker ->
run_model_script -> model.previewHostedDoorWidth -> validated pending proposal ->
queue restart -> ChangeRequests.decide(accept) -> accepted versioned project.
The complete accepted baseline stays unchanged until explicit decision. Replaying
acceptance is idempotent; accepted geometry survives another restart.

## Qualified deterministic cases

- Pending proposal, frozen door scope and passed script validation; accepted head
  unchanged before decision and through restart.
- Two distinct same-origin/same-door tickets with mixed targets; lost-ack replay,
  changed-origin conflict, follow-up replay and reload retain one original
  source-pinned origin and separate task identities.
- Region-only worker receives zero object IDs and exact region, then executes a
  real clarification asking for a door. Acceptance rejects; no nearby door is
  silently selected and no model change occurs.
- Legacy absent placement and explicitly unplaced tasks stay discoverable.
  Missing historical target resolves missing while origin stays current; new
  submission rejects without substituting a nearby native object.
- A deterministic hook pauses after real proposal creation. Cancellation aborts
  the worker; the late staged result cannot replace cancelled state or accepted
  geometry, including after reload.
- Follow-up supersedes the paused result. The old turn gets an explanation rather
  than a proposal message; only the newer turn gets a ready result. An older
  expectedRequestId cannot accept it.
- Competing same-door proposals: accepting the first makes the second need input;
  stale acceptance rejects while its result stays inspectable.
- Shutdown during actual work drains the worker; reopening retries as numeric
  attempt 2 without duplicating the task or publishing the staged proposal.
- Intentional worker failure after execution leaves geometry unchanged; explicit
  retry succeeds as attempt 2 with durable original placement.
- Acceptance makes retained native pins historical/stale without moving the origin.

## Attempt ledger

1. First validation identified missing type narrowing for a building wall's
   levelId: legacy Wall does not have that field. Added the explicit building-wall
   guard; no fixture or model validator was weakened.
2. `npm run validate` passed: 354 source files checked, typecheck and policy passed.
   `node --test demo/spatial-workspace-fixture.test.ts` passed all three tests,
   zero failures or skips. Whitespace check passed.

3. Added actual worker/harness and journeys: strict validation passed (367 source
   files), as did all 10 initial fixture/journey checks, zero failures or skips.
4. Added interrupted-work and explicit retry cases. Combined command passed all
   28 checks, zero failures or skips:

   `node --test demo/spatial-workspace-fixture.test.ts demo/spatial-workspace-journey.test.ts demo/task-placement.test.ts src/hosted-opening.test.ts src/model-script-hosted-opening.test.ts demo/hosted-opening-queue.test.ts`

5. Final `npm run validate` passed: strict TypeScript lint checked 367 files,
   typecheck passed, policy passed. `npm run test:spatial-acceptance` passed all 12
   checks, zero failures/skips. Explicit changed-path policy passed for all 8 PR
   paths (below the 12-file cap); `git diff --check` passed. The new npm command
   is included in npm test without removing placement or hosted-door coverage.

## Limits and review decision

These checks exercise offline workers, WASM and persisted queue behavior.
#258 owns browser navigation, graphics, camera, Plan, local server and final
combined-release evidence. Connected-provider interpretation requires its own
scoped gate. These checks do not prove those gates. The hook models a staged
result returning on abort; it does not certify remote-provider process cleanup.

Construction-model delta outside disposable fixtures: zero. Human review decides
readiness and merge. No provider, deployment, issue closure or merge.
