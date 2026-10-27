# Evidence review domain seam (#197)

Owned files: `src/room-model.ts`, `src/model-script.ts`,
`src/model-proposal.ts`, `src/evidence-review.test.ts`, and this note.

Plan: add optional `evidenceUses: EvidenceUse[]` to `ScriptReviewText` and
`ProposalReview`. Parse strict guest decisions, persist exact choices in native
reviews, and reject choices without a read set, exact pins/subjects, or the
request/review target binding. Bind generation to immutable flat evidence
entries and pass actual competing facts to the worker. Preserve absent optional
fields and existing revision hashes for legacy reviews.

`ModelProposalOptions.evidenceContext` requires `readSet: EvidenceReadSet` and
`entries: readonly EvidenceEntry[]`; optional `sources: readonly RequestSource[]`
and typed `issues` accept the store review context after flattening
`context.entries.map(item => item.entry)`. Uses contain exactly `pin`, `subject`,
and `rationale`. Subject includes the complete `anchor.target`.

The domain validates returned choices against its bound data and cannot query
the database. The queue owns live `verifyForReview({repository, readSet, uses})`
both before acceptance and inside its acceptance transaction. An acknowledged
value conflict is a proposal-local assumption; competing claims remain intact.
Unknown values, unavailable sources and read-set drift remain blocking.

Acceptance evidence: real ScriptBox WASM proposal with a chosen competing fact,
unchanged accepted model, deterministic wall delta, exact native restore and
tampering negatives; legacy serialization and revision hashes preserved.
Run validation and focused tests only in a fresh SSD-backed server container
using cached image `bim-qvm-tools:20261025`, read-only current dependencies,
one CPU, 2 GiB memory and no network. No merge or deploy.

## Qualification and handoff

Base: `0981e3abb2ae48dea60a7db39516274562501b86`.
Exported options type: `ProposalEvidenceContext`. The domain also exports
`assertEvidenceUsesBound(readSet, uses)` for exact frozen pin/subject checks.
The proposal host additionally checks the chosen entry hash, complete subject,
known value assertion and absence of a correction in the bound context.

Attempt 1 passed validation and 121 existing checks; eight new cases failed
setup because the test actor identity contained a space. Attempt 2 corrected
the fixture identity and added explicit unknown/resolution/supersession checks.
It passed `npm run validate` and all 130 focused checks (zero skips), including
nine dedicated tests. No local builds/tests ran. Source SHA-256 values match
the successful server archive. Policy validation in that archive reports zero
Git changed paths; the local owned-file diff passes whitespace checks.

Raw logs, archive hashes and owned-source hashes:
`/ssd1/bim-forge-qualification/residential197/evidence-review-a2/artifacts/`.
Cached image ID:
`sha256:4b96c3cba2f461d2bb9b6a285e5514fcf58968c9614eddd3441bcdb2def38dff`.
Source and dependencies were mounted read-only; only the fresh slot's temp
directory was writable. The qualification container exited and was removed.

Focused invocation: `node --test --test-concurrency=1 --test-timeout=60000
src/evidence-review.test.ts src/model-script.test.ts
src/model-script-wall.test.ts src/model-evidence.test.ts
src/design-targets.test.ts src/room-model.test.ts
demo/project-evidence-store.test.ts`.
The parent must include `src/evidence-review.test.ts` explicitly in combined
qualification; package scripts are outside this ownership scope. Queue/store,
server, UI and packages were not edited. Native authority follow-up remains
with the parent after this handoff.
