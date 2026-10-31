# Centred hosted-door proposal evidence

Refs #270, prerequisite for #264 and epic #251. Baseline: `b5f01e2` on `codex/spatial-workspace-foundation`.

## Plan and ownership

`src/hosted-opening.ts` owns the bounded native preview and exact input schema. `src/model-script.ts` exposes `model.previewHostedDoorWidth({doorId,widthMetres,anchor:'centre'})` through the existing private draft stage. Focused module, script and queue tests exercise the real path; `package.json` includes them in the normal suite.

Only the selected `Door.width` and existing `hosted-by.offset` can change. Host ID, relationship ID, every unrelated object, snapshot format and accepted model remain intact. Existing snapshot, scope, fit, overlap, room, roof, furnishing, asset and stair clearance validators apply. Acceptance remains the existing explicit queue decision and accepted-head publication path.

## Inspectable model delta

The trusted `multiStoreySnapshot()` contains three levels with two rooms per level, hosted doors, plants, slabs, stairs and an attic roof. No shell reconstruction is used.

| Field | Before | Proposal |
| --- | --- | --- |
| Door | `level-ground-door-inner` | same native ID |
| Width | 0.9 m | 1.1 m |
| Host relationship | `host-level-ground-door-inner` | same ID |
| Wall | `level-ground-wall-inner` | same ID |
| Host offset | 3.0 m | 2.9 m |
| Project-space centre at floor elevation | `[4,3.45,0]` m | `[4,3.45,0]` m |
| Stored entity delta | — | selected Door only |
| Stored relationship delta | — | existing host offset only |
| Added or removed records | — | none |

Independent tests calculate centres from each snapshot's actual wall direction, door width and hosted offset. Horizontal, vertical, reversed horizontal, reversed vertical and elevated attic cases retain their centres and exact two-record deltas. The API reports independently evaluated before/after width, offset and centre values.

## Scope and atomicity

Frozen scope must permit the Door entity write and existing host relationship write. Read-only context does not grant either. The preview requires the host, level, same-host opening entities and relationships, plus affected room, roof, furnishing, asset/family and incident stair context to already be readable. Newly required context causes rejection with a fresh-scope request; authority never expands.

Exact finite input schemas reject extra fields, unsupported anchors, missing or non-Door native IDs, IFC/linked identities, out-of-bounds dimensions and sub-millimetre dimensions. Centre anchoring rejects a resulting half-millimetre offset, existing noncanonical grid values, missing/multiple hosts and diagonal walls. Host-end overflow, sibling opening overlap and enlarged clearance conflicts reject atomically. A failed later operation preserves the prior valid private draft. Read-only ScriptBox capability denies the method before staging.

The queue proof runs actual TypeScript in ScriptBox WASM, reaches a pending reviewed proposal, retains the accepted head, closes and reopens the queue, then explicitly accepts. The accepted result contains the same two-record delta. One awaited teardown closes queue resources before removing its temporary folder.

## Validation and attempt ledger

- Attempt 1: TypeScript check passed; API construction rejected the initial tuple result schema because ScriptBox does not support its `additionalItems` keyword. No model or accepted data changed.
- Attempt 2: the supported array schema with `minItems:3,maxItems:3` passed all 9 focused tests and the 146-test regression. Follow-up review made existing grid preservation explicit and evaluated reported after-centres independently. That follow-up's named local function lost TypeScript's earlier Door/Wall narrowing; runtime tests still passed, but validation correctly rejected it.
- Attempt 3: use a locally initialized arrow function so the type checker retains the already validated Door/Wall types; final validation and focused tests pass.
- `npm ci --ignore-scripts`: 203 packages installed, audit reported 0 vulnerabilities.
- `npm run validate`: strict TypeScript scan, `tsc --noEmit` and policy validation passed.
- Targeted regression across model, parameter, scope, wall, room-dimension, ScriptBox review and conversation queue paths: 146 tests passed, 0 failed, 0 skipped.
- Final focused rerun and changed-path policy result are recorded in the pull request.

## Review limits

This is deterministic native concept-model evidence. No provider, IFC-kernel, renderer, browser navigation or live model qualification is claimed. Native hosts must be axis aligned. Existing prototype clearances are retained; no regulatory clearance or compliance claim is added. Human review is required for this geometry change.
