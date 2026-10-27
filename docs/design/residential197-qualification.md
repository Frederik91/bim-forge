# Residential workflow qualification

Parent [#197](https://github.com/Frederik91/bim-forge/issues/197), aggregate draft [#204](https://github.com/Frederik91/bim-forge/pull/204). Qualified product code: `384b2ceb0d371581bcb4bb7cd2ce12d2849d047c`, based on published main `f59687e`. Subsequent receipt changes are documentation only.

## Result and reproducibility

On the server, root `npm run validate`, explicit policy validation of all 59 changed paths, `npm run build:demo`, and all standard test files passed. Test files from the normal qualification, application and asset scripts ran with `node --test --test-concurrency=1 --test-timeout=60000` so the one-CPU container did not multiply test workers beyond its resource budget. No tests or validators were removed or weakened.

```text
Strict TypeScript valid. 262 source file(s) checked.
tsc --noEmit: exit 0
Policy valid. 59 changed file(s) checked.
tests 805; pass 802; fail 0; cancelled 0; skipped 3
```

The existing skips are the opt-in real-browser benchmark hang case and two platform-specific administrator/symlink dispatch cases. They are not qualified by this run. The full suite is correctness evidence, not a performance measurement.

All builds and tests ran in isolated server containers using cached image `bim-qvm-tools:20261025`, image ID `sha256:4b96c3cba2f461d2bb9b6a285e5514fcf58968c9614eddd3441bcdb2def38dff`, Node 24.22.1, one CPU, 2 GiB memory/swap ceiling, read-only root/source/dependencies, no network, and SSD-backed temporary/build/evidence directories. Dependencies were mounted from `/ssd1/bim-forge-qualification/all-ready-195/final/dependencies`. The full qualification retained actual Git objects in a read-only bare bundle checkout; binding tests verified real committed bytes, not a fabricated source identity.

Evidence root: `/ssd1/bim-forge-qualification/residential197/combined-a3/`. It retains `source.tar`, `source.bundle`, `run.sh`, `artifacts/source-commit.txt`, changed paths, container inspection and complete logs.

| Artifact | SHA-256 |
| --- | --- |
| `artifacts/validate.log` | `650a31f7497d375c5a79d7c729825bea1e6a401f5094d9d33f9313aafe6df13b` |
| `artifacts/build.log` | `26c6610d019a9ae2f5b74a17626772e7f257cb9e386fc6fe6fb1d351c93fa4ab` |
| `artifacts/focused.log` | `0027f917387d803106374a0f08562b1a73551954519f6578e3736e2386e43dfb` |

## Browser behavior and inspectable delta

The browser used a separate server container, an internal Docker network and an SSH tunnel. No application runtime or build ran on the desktop. The fixture database is separate from preview. A clearly identified deterministic QA worker exercised the real ScriptBox, proposal, SQLite and HTTP paths; this is not an evaluation of an actual model's interpretation quality and used no live credentials.

Through the UI:

1. Created a generated eight-room residential project with a fresh UUID. Recovered interrupted source initialization after a page/container restart through the explicit generated-evidence action. Retained three synthetic source files and three documented claims, including the visible 5 m / 5.2 m contradiction.
2. Captured As-is, forked Wider living room, selected the partition and attached both conflicting claims through the chat `+` menu. Observed working progress, a 3D delta with four changed entities, and an exact proposal-specific evidence choice.
3. Explicitly accepted the proposal. The decision appeared in chat; only the selected alternative advanced. Main and the immutable baseline retained their original revision.
4. Maintained two independent unsent chats with different evidence. Reopening restored text and pins; removing a pin then choosing another did not resurrect it. Confirmed revision-navigation discard cleared the unsent evidence.
5. Verified the fixed baseline disabled message input while offering Create alternative. Browser error/warning logs were empty at the final check.

| Design | Before | After acceptance |
| --- | --- | --- |
| Main | `81007dea8a` | `81007dea8a` |
| As-is baseline | `81007dea8a` | `81007dea8a` |
| Wider living room | `81007dea8a` | `ef90ce111e` |

The partition shifts 200 mm east. Adjacent room boundaries and supported wall topology are validated together; the hosted opening follows its host. Unrelated furnishing and other-level behavior has deterministic fixture coverage. Original evidence, conflicting claims and source bytes remain unchanged. The accepted review hashes its chosen evidence and rationale rather than resolving the global ledger.

Browser bootstrap, state, code/build hashes and container receipts are retained under `ui-a1`, `ui-a2` and `ui-a3` in the same SSD evidence root. The local capture `artifacts/private/residential197-review.png` shows the 3D proposal and explicit source assumption; it contains generated data only.

## Corrections and attempt ledger

The owner authorized ten interactive qualification attempts. Each retry followed diagnosis; the global factory policy remains unchanged. The final documentation-only validation is reported on draft #204 separately from the product-code proof above.

| Run | Outcome / correction |
| --- | --- |
| `queue-a1` | Compile refused a missing import and unparsed entry; fixed the boundary. |
| `queue-a2` | Compile refused unbranded target comparison, readonly journal pins and unknown test input; fixed typing without casts. |
| `queue-a3` | 52/55 checks passed; three fixtures used the wrong intent certainty/basis format. Corrected fixtures to the existing contract. |
| `queue-a4` | 70/71 checks passed; static serving lacked a built bundle. Added the build step to the harness. |
| `combined-a1` | 791 passed, four failed, three skipped. Three binding checks lacked actual Git metadata; one legacy assertion expected its original diagnostic. Added real Git objects and preserved the diagnostic. |
| `queue-a5` | Compile caught an unbranded UI target and use of a name absent from the graph view. Used native target parsing and the design catalogue. |
| `combined-a2` | Full suite: 799 passed, zero failures, three existing skips. |
| `queue-a6` | 89/89 focused checks and root/build passed after the browser exposed a fetch-receiver issue; added its regression. |
| `combined-a3` | Full suite: 802 passed, zero failures, three existing skips. Also covers a revision/rejection race and authoritative composer/panel synchronization found during review. |

Independent reviews covered native target authority, pure wall dependencies, evidence supersession/lineage and queue authority. The inherited revision/rejection race was fixed by comparing the complete captured/latest ticket inside the revision transaction; its async regression proves a later human rejection cannot be overwritten. Evidence is rechecked inside acceptance's existing SQLite transaction after async preparation. Stale context, cancellation/generation fences and command receipts remain enforced.

## Release and scope limits

This draft changes geometry and storage authority and requires human review. The published preview was not replaced during qualification; its remote health endpoint remained healthy and ChatGPT connected. No live model/source data, credentials, branch protections or paused factory automations were changed.

V3 envelopes can retain baselines, alternatives and external evidence pins. Older readers cannot consume newly written V3 state: a deployment needs a paired runtime/browser release and a pre-activation data backup. Source bytes remain private and external to portable model JSON; portable pins alone do not claim complete source availability.

Existing 100-item arrays, 32 revisions, 256 KiB portable documents and bounded evidence/source limits remain. The wall operation supports a defined rectangular topology, not a general solver. The [IFC spike](ifc-link-202.md) is a bounded server-side artifact prototype; production IFC upload/navigation, arbitrary files, large-project viewing, actual-phone/touch behavior and surveyed-house accuracy remain unqualified. No PostgreSQL cutover or new capacity claim is included.
