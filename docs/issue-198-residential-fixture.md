# Synthetic residential fixture (#198)

Parent: #197. Base: `f59687e`. Branch: `feature/issue-198-residential-fixture`.

## Plan and ownership

1. Add `src/synthetic-residential-fixture.ts`, reusing `residentialFloor()` with its eight spaces, eleven shared/exterior walls, hosted openings, sixteen furnishings and two supported devices. Add one living/kitchen doorway and its native host relationship; preserve every existing entity and relationship.
2. Return synthetic plan, measurement and text descriptors beside the snapshot, including an explicit unresolved 0.2 m partition contradiction. Expose room/wall ownership, hosted openings, supports and a native semantic delta for inspection.
3. Add `src/synthetic-residential-fixture.test.ts`. Assert stable bytes across processes, native validation/rejections, source isolation, repository round-trip and existing portable caps. Run root validation and this test file only in a bounded, network-isolated server container with clean SSD sources and existing SSD dependencies. Record results here before a draft PR.

These three new files are this issue's entire ownership. Shared package scripts, repository implementation, server, viewer and UI are outside this slice. Geometry requires parent/human review before merge.

## Integration API

`syntheticResidentialFixture()` and the derived `SyntheticResidentialFixture` type are exported from `src/synthetic-residential-fixture.ts`. Every call returns fresh fixture descriptors and a native validated snapshot; the native validator freezes/sorts the model. Generation has no I/O, random values, timestamps, real project data or credentials.

| Result field | Meaning |
| --- | --- |
| `id` | Stable fixture identifier `synthetic-residential-198` |
| `projectId` | Fixed disposable native project UUID `00000198-0000-4000-8000-000000000198`; use this field for `RoomRepository.createProject` |
| `snapshot` | Current native metre-based model; pass to `validateSnapshot` or `RoomRepository.createProject` |
| `sources.plan` | Synthetic text plan with room coordinates, partition/door dimensions and referenced object IDs |
| `sources.measurements` | Three invented measurements: partition x=5.0 m, conflicting x=5.2 m, doorway width=0.9 m |
| `sources.brief` | Synthetic design request naming the affected rooms, partition and hosted doorway |
| `inventory` | Floor bounds; room bounds/furnishings; wall geometry/adjacent rooms; opening hosts; door connections; furniture room/support IDs |
| `deltaFromResidentialFloor` | Native `diffSnapshots` output against the unchanged original fixture |

Descriptors are disposable test inputs, not an authoritative evidence schema, provenance classification, ingestion API, persisted source record or conflict-resolution engine. `contradictsSourceIds` explicitly identifies the conflicting inputs. Nothing applies that value to accepted geometry. Parent work owns translating these descriptors into the reviewed evidence contract.

To inspect the complete fixture inside the qualification container:

```sh
node --input-type=module -e 'import { syntheticResidentialFixture } from "./src/synthetic-residential-fixture.ts"; console.log(JSON.stringify(syntheticResidentialFixture(), null, 2));'
```

For a disposable native project, use the UUID separately from the descriptive fixture identifier:

```ts
const { projectId, snapshot } = syntheticResidentialFixture();
const repository = await RoomRepository.createProject({ projectId, name: 'Synthetic residential 198', snapshot });
```

## Inventory and delta

| Item | Before (`residentialFloor`) | Generated fixture |
| --- | --- | --- |
| Floor | 12 x 9 m; ground elevation 0 | Unchanged |
| Spaces / walls / furnishings | 8 / 11 / 16 | Unchanged |
| Doors / windows / hosting relationships | 8 / 5 / 13 | 9 / 5 / 14 |
| Native entities | 49 | 50 |
| Supported devices | `office-laptop`, `office-monitor` on `office-desk` | Unchanged |
| Partition | `wall-living-kitchen`: [5,0] to [5,4], thickness 0.15 m | Unchanged; adjacent rooms `room-kitchen`, `room-living` |

Only `door-living-kitchen` (0.9 x 2.1 m) and `host-door-living-kitchen` (target `wall-living-kitchen`, offset 2.8 m) are added. Nothing is removed or modified. The doorway connects living/kitchen and needs clearance on both sides. All original doorway paths to the exterior remain.

The synthetic measurement `synthetic-measurement-partition-conflict-198` claims x=5.2 m, contradicting `synthetic-plan-198` and `synthetic-measurement-partition-plan-198`. The model remains at x=5.0 m. Moving only that wall to the contradictory coordinate fails native enclosure validation; dependent room-bound changes belong to the parent's bounded geometry slice.

## Qualification run ledger

Initially stopped after three failed attempts under AGENTS.md and `policy/loop-constraints.md`. The owner then explicitly authorized ten TOTAL attempts per item for this interactive qualification work, overriding that local stop rule. Attempts 1-3 remain counted below. Global factory policy and all validators remain unchanged. No local npm/test/build, merge, deployment or issue closure is permitted.

All source archives were generated from the isolated worktree index. Server sources were extracted into clean directories, never over cached `/app` files. Server run root: `/ssd1/bim-forge-qualification/issue-198-f9Ij3L`. Existing image: `bim-qvm-tools:20261025` (`sha256:4b96c3cba2f461d2bb9b6a285e5514fcf58968c9614eddd3441bcdb2def38dff`). Dependencies: `/ssd1/bim-forge-qualification/all-ready-195/final/dependencies`, mounted read-only. Containers used `--network none`, 2 CPUs, 2 GiB memory/swap, 128 PIDs, read-only root/source/dependencies, no capabilities, no new privileges, a 128 MiB temporary filesystem, SSD artifacts/npm cache and disabled Docker log storage. No image builds, installations or prunes ran.

| Attempt | Evidence | Outcome |
| --- | --- | --- |
| 1 | `artifacts/run-a1.log` | Container failed before validation: absent `/app/node_modules` mount point under read-only source. Added an empty SSD source mount directory. |
| 2 | `artifacts/run-a2.log` | Root lint passed; typecheck rejected two source-reference assertions because descriptor strings were checked against a set inferred as branded native IDs. Fixed the test set type to `Set<string>` and aligned cap expectations with the native bounded-array errors. |
| 3 | `artifacts/run-a3.log` | Root `npm run validate` passed (242 TypeScript files; typecheck; policy). Changed-file policy passed for all three owned paths. Own tests: 9 total, 7 pass, 2 fail, 0 skipped. Both failures are `Invalid project identity.` from `RoomRepository.createProject`, before repository assertions execute. |
| 4 | `artifacts/run-a4.log` | Separate fixed synthetic UUID added as `projectId`; both repository tests use that field. Fresh `source-a4` archive: root `npm run validate` PASS, changed-file policy PASS (three paths), own tests 9/9 PASS, zero failures/skips. Fixture/project artifacts emitted and inspected. |

Attempt 3's passing assertions covered bytes across a separate process, valid eight-room topology, inventory/support/host ownership, the exact two-item native delta, explicit contradictory source descriptors outside the model, validator rejection of missing hosts/overrun/blocked door/lost support, and isolation between generator calls. Repository round-trip, full cap assertions and repository-preservation-on-conflict were unqualified because creation failed first. That attempt's post-test fixture/project artifact emission did not run.

Root cause: the fixture's `id` was used as a native project ID, but native project identity requires a UUID. Attempt 4 retains the fixture identifier, adds a fixed synthetic UUID `projectId`, and uses it in repository creation. No validator changed.

Final validator output (attempt 4):

```text
Strict TypeScript valid. 242 source file(s) checked.
tsc --noEmit: exit 0
Policy valid. 0 changed file(s) checked.
Policy valid. 3 changed file(s) checked.
tests 9; pass 9; fail 0; cancelled 0; skipped 0; todo 0
```

Commands: `npm run validate`; `node scripts/validate-policy.ts --changed-files src/synthetic-residential-fixture.ts src/synthetic-residential-fixture.test.ts docs/issue-198-residential-fixture.md`; `node --test src/synthetic-residential-fixture.test.ts`. Only this issue's focused tests ran; no full-suite/build claim. Local Git whitespace inspection also passed.

Artifacts beside the logs: `fixture.json` (pretty-printed complete fixture/inventory/delta) and `project.json` (portable native repository). Compact fixture JSON is 17,593 UTF-8 bytes, SHA-256 `1c7f175ada0b0b017d601601718d0bf8b635f78d348e4e7804462644cbbad76c`. The native portable project is 8,562 UTF-8 bytes with one initial revision, `81007dea8a0b15393a00e8df405feaa0249b1a74e79228d7e2b10bff552db253`. These sizes exclude the artifact files' trailing newline; the fixture hash covers compact `JSON.stringify(syntheticResidentialFixture())`, not the pretty-printed file.

Attempt 4 also passes the previously blocked assertions: deterministic repository creation and round-trip, rejection above 100 entities/relationships, 32 revisions and 256 KiB, and unchanged repository bytes after attempting an invalid contradictory wall move. Full attempt history is retained; four of the owner-authorized ten total attempts were used.

## Limits

Current caps remain 100 entities / 100 relationships per snapshot, 32 revisions and 256 KiB per portable repository, with the existing furnishing/room limits. The snapshot has 50 entities and 14 relationships; its portable project is 8,562 bytes with one initial revision and passes native round-trip. The root test script is unchanged; run this new test file explicitly until parent integration adds it to the shared test command.

This proves synthetic mechanics only. It does not qualify real-house reconstruction, surveyed accuracy, regulations, arbitrary topology, a dependency solver, named alternative workflows, real evidence ingestion, IFC loading, UI behavior, large-project performance or deployment. No merge, deployment, live model mutation or issue closure is part of this slice.
