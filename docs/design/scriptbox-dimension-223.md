# ScriptBox dimension preview integration

Scoped follow-on for [#223](https://github.com/Frederik91/bim-forge/issues/223), based on integration commit `b9ec06f84b2a32c9a78682aeec83cb8519b436c3`. Own only `src/model-script.ts`, `src/model-script-dimension.test.ts` and this note. Parent owns root test registration, request/server/UI integration and the single integration draft PR.

## API and authority

The real guest API now exposes `model.previewRoomDimensionChange(input)` with the pure [dimension-preview contract](room-dimension-preview-217.md). A closed ScriptBox input schema supplies generated TypeScript declarations and method documentation from the same registration. The method is registered as `draft-write` and included in normal model-script capabilities. A read-only capability policy denies it before entering the handler, including unresolved requests.

```ts
const result = await model.previewRoomDimensionChange({
  roomId: 'room-a', wallId: partitionId, axis: 'x',
  measurement: { kind: 'confirmed', metres: 3.3, sourceRef: 'opaque-interpretation-context' },
  minimumClearSpans: [{ roomId: 'room-b', axis: 'x', metres: 2.5 }],
});
if (result.status === 'unresolved') {
  // Ask for scale/dimension/evidence clarification. No draft mutation occurred.
}
```

`confirmed` is an agent/user interpretation to present for human review. It does not verify source evidence, resolve conflicting claims, bypass an evidence read set or confer acceptance authority. `sourceRef` remains bounded opaque context; it creates no evidence entry/use and changes no frozen target. A valid proposal still needs review text and separate human acceptance through the unchanged application pipeline.

The driving measurement is explicitly a room centreline span. `minimumClearSpans` use the current conservative clear-space convention: maximum boundary half-thickness is inset on every side. They are design constraints, not surveyed face-specific widths or code compliance assertions. Positive millimetre-grid driving values derive only an existing bounded complete-partition shift; original native geometry validators remain authoritative.

The handler evaluates the pure helper on the current private draft. For a ready result it calls the existing `stage` path, retaining native snapshot validation, frozen write checks against the execution base, abort/revocation fences and preview publication. The returned `model` is the existing working-graph projection; `changes` is cumulative from the execution base. `offsetMetres`, measurement, `impacts`, sorted `dependencies` and `clearSpanChecks` describe this operation, including evaluated opening motion when opening bytes remain unchanged. The private snapshot is never accepted or persisted by this method.

Unresolved measurements support `unknown-scale`, `ambiguous-dimension` and `contradictory-evidence`. They return only `{status:'unresolved',measurement}`; they do not call `stage`, assign the draft or publish a nonnull preview. A prior valid draft remains intact. Invalid constraints/geometry become recoverable audited `ModelValidationError` app errors, preserving an earlier valid draft. Runtime boundary/capability violations remain integrity failures, as with other host calls.

Frozen scope must permit reading the driving wall, driving room and every minimum-constraint room. An arbitrary named room cannot expose dimensions outside the existing readable closure. Evaluated dependency records use that same read projection. This adds no write authority: every stored geometry write, including adjacent Spaces, must pass the original `assertModelScopeWrites`. No model scope, evidence pin, accepted pointer, baseline or target is edited.

Parent integration must bind the request interpretation/constraints to its exact frozen snapshot and evidence context, retain review/source history and recompute after any intervening authority or model change. This method does not add durable constraint metadata or new acceptance rules. Combined browser checks and root test registration remain parent work.

## Verification

Direct command for parent registration:

```sh
node --test --test-concurrency=1 src/model-script-dimension.test.ts src/model-script-wall.test.ts src/room-dimension-preview.test.ts src/wall-dependencies.test.ts src/model-scope.test.ts src/model-script.test.ts
```

New checks execute the actual ScriptBox WASM guest bridge and generated TypeScript API, rather than mocking the handler. They cover exact ready dependency output and host audit, all unresolved reasons/no mutation, cumulative changes from a prior wall draft, failed minimum atomicity, closed wire schemas, denied read-only capability, adjacent-room write refusal, explicitly authorized scoped writes/read projection, unreadable constraint references and abort/host-call budgets. The synthetic two-room fixture's 3 -> 3.3 m centreline span produces a +0.3 m partition shift, 2.85 -> 3.15/2.55 m adjacent clear spans and evaluated shared door/window motion. It preserves accepted repository bytes and unrelated geometry.

All builds/tests are server-container-only on `frederik@192.168.1.17`, with source/dependencies read-only, network disabled, 1 CPU, 2 GiB memory/swap ceiling and 256 PIDs. Source bundles, dependencies, cache/temp and evidence stay on `/ssd1`. Image `bim-qvm-tools:20261025` supplies Node24.22.1; dependencies are reused read-only from `/ssd1/bim-forge-qualification/all-ready-195/final/dependencies`. No root installs or validator changes. Parent-authorized retry allowance for this new wiring item is ten total attempts; human merge remains required.

| Attempt | Source and commands | Outcome |
| --- | --- | --- |
| Pending | Root validate, explicit three-path policy and focused command above | Not yet qualified |
