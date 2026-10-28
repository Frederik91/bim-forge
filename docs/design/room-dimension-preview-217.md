# Dimension-driven partition previews

Issue [#217](https://github.com/Frederik91/bim-forge/issues/217), parent [#197](https://github.com/Frederik91/bim-forge/issues/197). Base: `882a50b7599ff926fb0648c2e070c51a2cffccfd`. Ownership: four new module, fixture, test and design files; integration belongs to the parent and [#216](https://github.com/Frederik91/bim-forge/issues/216).

`previewWallShift` already translates complete shared partitions, updates rectangular room boundaries and terminating junctions, retains hosted-opening semantics, and refuses invalid dependent geometry. This slice adds one missing relationship: a confirmed centreline room span drives that existing operation while checking named minimum clear spans. It also makes the evaluated before/after room dimensions and opening endpoints directly inspectable. It does not introduce a solver or new model entities.

## Pure API

`src/room-dimension-preview.ts` exports `previewRoomDimensionChange(baseSnapshot: unknown, input: RoomDimensionRequest): RoomDimensionPreview`.

```ts
const result = previewRoomDimensionChange(snapshot, {
  roomId: 'room-a',
  wallId: sharedPartitionId,
  axis: 'x',
  measurement: { kind: 'confirmed', metres: 3.3, sourceRef: 'synthetic-measurement:room-a-x' },
  minimumClearSpans: [{ roomId: 'room-b', axis: 'x', metres: 2.5 }],
});
```

The driving span is between room boundary centrelines, along global X or Y. The selected wall must bound that room on the corresponding side, cover its entire side and belong to the same level. A larger span moves a maximum-side wall positively or a minimum-side wall negatively, irrespective of wall endpoint order. The derived nonzero millimetre-grid offset must fit the existing one-metre operation bound. An already satisfied driving dimension is refused as a no-op. The base snapshot and request are never modified.

Confirmed metre dimensions must be positive, on the millimetre grid and no greater than 1000 m. These bounds only limit the request; existing geometry and portable-document bounds still apply. Source references must be nonempty strings of at most 256 characters. Up to 24 minimum clear-span constraints are allowed, unique by room/axis. Their results are sorted by room ID and axis. Every named constraint must hold after the proposed move, including constraints on unaffected rooms; a failed constraint throws and returns no candidate. Existing violations can be repaired by a candidate that satisfies the requested minimum.

`status: 'ready'` returns the original `WallShiftPreview` fields (`snapshot`, stored `delta`, `impacts`), derived `offsetMetres`, copied measurement, sorted `clearSpanChecks` with before/after metres, and sorted `dependencies`:

- `kind: 'room'`: ID, before/after boundary bounds, centreline spans and clear spans.
- `kind: 'opening'`: ID, before/after host ID and world XY start/end points along the host direction.
- Each record distinguishes `storedChanged` (entity body) from `evaluatedChanged`. An opening can move in world coordinates while its body and hosting link remain unchanged. A resizing perpendicular host can change its link offset while keeping both entity body and world geometry unchanged. The original relationship delta exposes that offset change.

Room records cover the driving room, all affected room boundaries and all named minimum constraints. Opening records cover the existing helper's evaluated hosted-opening dependency set. Other dependencies, such as junction walls, contents and envelopes, remain exposed through the unchanged `impacts`/`delta` fields. This is a bounded evaluation report, not a claim to enumerate every possible BIM dependency. Clear spans use the existing `clearSpaceBounds` convention: the maximum half-thickness of the room's boundary walls is inset on every side. This deliberately preserves the current conservative convention; it does not claim face-specific surveyed clear dimensions. Reported numeric differences below floating-point noise are normalized at 1e-9 m.

`measurement` can instead be `{ kind: 'unresolved', reason, sourceRefs }`, where `reason` is `unknown-scale`, `ambiguous-dimension` or `contradictory-evidence`. One to 24 source refs are required, then copied, deduplicated and sorted. The result has `status: 'unresolved'` and the measurement only: it has no snapshot, delta or inferred offset. Base/room/wall/constraint references still need to be valid. Unresolved evidence does not certify that the requested wall operation would be supported after the evidence is resolved.

## Evidence, scope and integration

The request is a typed internal API, not a wire parser. Network/ScriptBox callers must parse unknown requests at their existing boundary. `baseSnapshot` is parsed by the existing native validator. The module neither reads source bytes nor resolves claims. A caller marking a measurement `confirmed` must already have confirmed scale, units, centreline-versus-clear semantics and the selected evidence interpretation. `sourceRef` is opaque context, not an evidence read set, freshness token, authorization or engineering fact. Unknown scale, ambiguity and contradictions must remain unresolved until the existing evidence workflow supports an explicit, reviewable choice.

Minimal parent wiring specification:

1. Inspect the frozen writable design target's snapshot, room and selected complete partition. Derive a confirmed centreline measurement from the existing evidence flow, or pass an unresolved reason. Do not translate image pixels or silently substitute clear width for centreline width here.
2. Call the pure API and surface unresolved evidence with no proposal when its status is unresolved. For a ready preview, show the original model delta, evaluated room/opening changes, requested clear minima and source context in the existing chat/review surface.
3. Route the derived `{ wallId, offsetMetres }` through the existing bounded wall proposal path, with the same frozen target, evidence read set, scope and freshness fences. If intervening geometry or evidence changes, recompute the complete dimension/constraint preview against that exact snapshot before preparing a replacement proposal. Never submit an old candidate against a new target.
4. Retain explicit human acceptance. This helper has no repository, persistence, baseline, main-pointer, ScriptBox or acceptance authority. It does not independently attach constraint enforcement to later native acceptance; parent integration must keep the measurement/constraint context bound to the prepared proposal.

Supported topology is exactly the existing complete interior axis-aligned partition operation: adjacent rectangular room sides, supported terminating junctions and hosted doors/windows, at most one metre. Exterior shifts, partial-side operations, unsupported crossings/collinear continuations, arbitrary angles, cyclic or multiple-driving-dimension solves and uncertain scale conversion remain unsupported. Unknown relationship kinds are not silently solved. Minimum clear spans are supplied design constraints, not a building-code compliance assertion.

## Fixture and acceptance evidence

`src/room-dimension-fixture.ts` supplies an invented 6 x 4 m floor with two adjacent 3 x 4 m rooms, a shared hosted door/window and an exterior exit. Increasing Room A's centreline X span to 3.3 m translates the shared partition by +0.3 m. Room A's conservative clear span changes 2.85 -> 3.15 m; Room B's changes 2.85 -> 2.55 m. Shared door endpoints change `(3, 1)..(3, 1.9)` -> `(3.3, 1)..(3.3, 1.9)`; the window similarly moves. Their entity bytes and hosting relationships remain unchanged. Native IDs and unrelated entities remain unchanged.

Focused coverage also includes the opposite side, horizontal/reversed hosts, all three unresolved-evidence reasons, impossible minima, invalid units/grid/bounds/references, no-op/oversized operations, conservative thickness semantics, unaffected constraints, multi-level isolation and rejection by the original hosted-fit validator. The original `wall-dependencies.test.ts` suite runs alongside the new tests. No UI change is made by this slice; browser evidence belongs to parent integration.

Direct integration command (no root package edits):

```sh
node --test src/room-dimension-preview.test.ts src/wall-dependencies.test.ts
```

## Qualification ledger

Builds/tests run only in isolated server containers over SSH, with source/dependencies mounted read-only, network disabled, one CPU, 2 GiB memory/swap ceiling and 256 PIDs. All source/dependency/temp/artifact files reside on `/ssd1`. Image: `bim-qvm-tools:20261025`; cached dependencies: `/ssd1/bim-forge-qualification/all-ready-195/final/dependencies`. The owner-authorized allowance is ten total interactive attempts, without changing factory policy or validators. Human merge review is required.

| Attempt | Source / commands | Result |
| --- | --- | --- |
| `a1` | `b7aa472`; `npm run validate`, explicit four-path policy check; new dimensions, wall dependencies, floor layout, building levels and ScriptBox wall tests | 52/53 tests passed; typecheck refused an inferred heterogeneous test tuple. The one runtime failure incorrectly inferred level ownership from an ID prefix (the ground entry door is named `door-entry`). Corrected the test tuple type and asserted actual `entityLevel` ownership. No product or validator changes. |
