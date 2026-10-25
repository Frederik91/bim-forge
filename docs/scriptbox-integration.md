# ScriptBox model authoring

Issue: [103](https://github.com/Frederik91/bim-forge/issues/103).

## Implementation plan and acceptance

- [x] Ground the migration in the running residential-floor revision and the pinned ScriptBox source.
- [x] Compare persistent script checkpoints with atomic per-script drafts. Select the atomic design after independent review.
- [x] Implement and verify the runtime, proposal, persistence and cancellation changes together.
- [x] Verify feature parity, negative cases, container packaging and the server-hosted UI.
- [x] Remove replaced executable authoring paths.
- [x] Open [draft PR 104](https://github.com/Frederik91/bim-forge/pull/104) with validation evidence. Human approval is required before merge or replacement of the shared preview.

The application baseline is `10982ab9c97d3bde9c95a7b8515bba39d7c591a7`, the revision running on the server when this work began. `main` did not yet contain its backlog, Babylon viewer or residential-floor changes. The integration branch therefore starts from that feature revision.

The implementation changes these files and responsibilities:

| Files | Responsibility and acceptance evidence |
| --- | --- |
| `src/model-script.ts`, `src/model-script.test.ts` | Typed ScriptBox host API, private execution draft, generated declarations/docs, limits, atomic rollback and real-package tests. |
| `src/model-proposal.ts` | Bind the immutable revision and selection, enforce aggregate budgets, coordinate the provider and materialize only validated terminal results. |
| `src/script-evidence.ts`, `src/room-model.ts`, `src/room-model.test.ts` | Bound application-owned execution evidence and preserve exact restoration of historical reviews. Model validators and revision hashing remain authoritative. |
| `demo/change-requests.ts`, `src/codex-app-server.ts`, their tests and server wiring | Abort matching attempts and provider turns, retain durable execution records, preserve backlog/decision behavior and clean up on shutdown. |
| Office, visual-request and residential-floor tests | Preserve shell edits, complete furnishing sets, supported devices, freestanding placement, room-local preservation and explicit transfers through real scripts. |
| Package manifests and preview Docker build inputs | Install the pinned npm package reproducibly without .NET or a runtime artifact download. |

Model entity types do not change. Review evidence gains an optional field, and the queue gains execution records. Existing geometry, support, clearance, floor-plan, identity and hosting validators must not be weakened. No script receives an accepted-model write or approval API.

## Why one atomic script

The previous AI interface exposed inspection, rectangle preview, whole-model furnishing replacement, room furnishing replacement, submit and decline as separate function tools. `prepareModelProposal` held a mutable candidate between those calls. It created the reviewed repository only after the provider finished successfully.

Two designs were compared:

1. A script execution tool plus separate submit/decline tools, retaining a successful candidate checkpoint between scripts.
2. One script execution tool whose return value identifies observation, proposal or clarification, with a private draft per execution.

The second design removes checkpoint selection and submission ordering from the provider contract. It can express every currently supported model outcome. Independent design review preferred it for candidate ownership, cancellation and the smaller interface. The first design's useful constraints remain: defer repository creation until provider success, retain complete inspection context and refuse caught host-integrity failures.

The tradeoff is deliberate. Partial geometry does not persist between script calls. An observation can inform a later script, but the later script starts from the same immutable base and must repeat its complete proposed computation. A script can correct expected validation errors within its own execution.

The public authoring sequence is:

```text
Saved request, revision and selection
  -> run_model_script
     -> typed model methods operating on a private draft
     -> ScriptBox terminal outcome
     -> application validation and host-computed delta
  -> successful provider completion
  -> durable proposal and 2D/3D review
  -> separate explicit human acceptance
```

The script never supplies an authoritative snapshot, delta, validation result or audit record. The host computes those values.

## Script contract

`run_model_script` accepts `language` and an async-function `source` body. Both JavaScript and TypeScript use the same runtime validation and capabilities. TypeScript additionally checks against generated declarations before execution.

Registered methods call existing domain operations directly:

- `model.inspect()` returns the draft, bound revision and selected IDs, floor/room bounds, clear bounds, door connections, coordinate conventions and suggested dimensions. Room `entityIds` describe actual furnishing/equipment membership.
- `model.previewRectangle(layout)` changes a single-room rectangular shell and door. Spatial-reference requests and multi-room shell edits remain prohibited.
- `model.previewFurnishings({ furnishings })` replaces the complete furnishing set while retaining walls, openings, equipment and hosting.
- `model.previewRoomFurnishings({ roomId, furnishings })` replaces one room's furnishings and retains other rooms exactly.
- `docs.*` reads generated API docs and the static model guide. No private external documentation source or guest network access is registered.

A script returns exactly one decision shape:

```typescript
return {kind: 'observe', observation: await model.inspect()};
```

```typescript
const view = await model.inspect();
const layout = view.placement.layout;
if (layout === null) throw new Error('A single room is required.');
await model.previewRectangle({...layout, door: {...layout.door, widthMm: 1200}});
return {kind: 'propose', review: {
	summary: 'Widen the entry.',
	rationale: 'The requested width fits the current host.',
	constraints: 'Retain the shell and all other hosted objects.',
	uncertainty: 'Concept model requiring human review.'
}};
```

```typescript
return {kind: 'decline', reason: 'Should the devices move with the desk?',
	uncertainty: 'The requested device destination is unclear.'};
```

Observation and clarification discard any staged changes. A proposal requires a nonempty validated delta. A provider failure after a valid script still publishes no proposal. Old executable authoring tool names are not an alternative execution path; they remain valid only as historical saved evidence.

Selection and proximity still express context, not implicit group membership or authorization. Natural-language intent remains partly an agent interpretation problem. Geometry validation and sandbox capabilities do not prove that an interpretation matches the request. Human review remains required.

## Dependency provenance

The application pins the published npm package from [ScriptBox commit `129f538fb28de883e7dfc1753f4c9524c8c37445`](https://github.com/Frederik91/ScriptBox/tree/129f538fb28de883e7dfc1753f4c9524c8c37445). It is not an independently modified runtime fork. The former local 0.1.0 tarball and Docker packaging path have been removed.

- Package: `@frederik91/scriptbox` `0.1.1`, exact version.
- Registry artifact: `https://registry.npmjs.org/@frederik91/scriptbox/-/scriptbox-0.1.1.tgz`.
- Lockfile integrity: `sha512-lxlttFnydcXWfH2S4CKYjG14KW540elqgDqyl/OHtKVxbHc7wU+pPW1IUI9mtViiOdnNcWKJXlxhhU/taUiJAQ==`.
- Guest ABI: 2. Bootstrap version: 3.
- Guest SHA-256: `a52c2b3ca778ceed0bbc5b84a72c9686e5b663c7ef253af0b9b717b46d09768b`.
- Node image used for server builds/tests: `node@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205`.

The original 0.1.0 package was built and packed in a server container. Version 0.1.1 changes publication metadata, version identity and documentation, not the runtime source or guest artifact. The npm lockfile pins its registry artifact and integrity. The application and production-image tests are rerun against the published package; see the [registry-upgrade evidence](validation/issue-104-npm-preview.md). The original validation report remains a historical record of the 0.1.0 qualification.

## Verification

The [validation report](validation/issue-103-scriptbox.md) records the real-package tests, negative regressions, historical saved-data roundtrips, production-style image checks and live server UI scenarios. Builds and tests run in server containers, not on the Windows workstation.

The migration does not add adjacent-room topology editing. That operation still needs a trusted model implementation. ScriptBox makes supported operations composable; it does not create missing geometry capabilities.
