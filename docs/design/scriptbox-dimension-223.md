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
| `a1` | `6f87fd0`; root validate, explicit three-path policy and focused command above | Root validation passed; 80/83 focused tests passed. The guest declaration writer emits an unnamed union of objects inside an array without parentheses; named the dependency union using the existing schema title mechanism so generated array types agree with the wire shape. A byte-string comparison incorrectly depended on key order after the bridge normalized schema fields; changed to exact structural comparison of an actual guest observation. The same-level scope fixture had no unreadable room; use a different building level to prove read refusal. No validators changed. |
| `a2` | `2fb352e`; same root/policy/focused commands | Root validation, explicit three-path policy and all 83 tests passed (9 new, 74 existing), zero failures/skips. A bounded companion container retained generated declarations plus actual ready/unresolved/rejected guest observations and host audit evidence. Accepted repository bytes remained unchanged. |

Evidence root: `/ssd1/bim-forge-qualification/issue223-scriptdimension/a2/`. Source bundle/checkout, runtime receipt, two source hashes, full logs, launcher and exact container inspections are retained there. Image ID: `sha256:4b96c3cba2f461d2bb9b6a285e5514fcf58968c9614eddd3441bcdb2def38dff`.

```text
Strict TypeScript valid. 278 source file(s) checked.
tsc --noEmit: exit 0
Policy valid. 3 changed file(s) checked. [explicit command]
tests 83; pass 83; fail 0; skipped 0
```

Root validation's default policy invocation supplies zero paths; the additional explicit policy command checks all three changed paths against the unchanged policy. The product source SHA-256 is `b6d8ac1314a2d17b1f53d90e5974332782d594d85f806a3953b7c484d2955416`; the new guest test SHA-256 is `ca9932bc67c7bb05de532ded0a507cb1916bd2bdf1567bdb84d1206b2e98bb8f`.

| Artifact under `a2/artifacts/` | SHA-256 |
| --- | --- |
| `validate.log` | `88e8cd20531b8823d1c48c3b8105b5404ba43f7d38b4f6163180db78d31aec15` |
| `policy.log` | `33ee8018c571ff808154ec391113e98931c9d0ff5b09a5e8e9d84dcb1828569f` |
| `focused.log` | `29fead4d89c1b6f01f627462b2f7d5ce7f1d5c92be4aaab12135e961ea47a230` |
| `guest-dimension-observation.json` | `1b2b27e158d6c7bfcb888c45018565acf77bea1e2a5ae02aee88f107d729487f` |
| `model-script-api.d.ts` | `1b8579b284f7781da474fab58d3760ebdfb6cca9b1b13c22193014692927512c` |

Only this receipt changes after qualified product/test source `2fb352e`. Final documentation-head root validation and matching source hashes are reported in issue #223. Parent integrates the scoped commits and performs combined browser/proposal/evidence checks; no separate PR, preview cutover, merge or live model changes are included here.
