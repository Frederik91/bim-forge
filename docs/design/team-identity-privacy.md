# Team identity, privacy, and proposal publication

Design gate: [#259](https://github.com/Frederik91/bim-forge/issues/259), under [#251](https://github.com/Frederik91/bim-forge/issues/251). Status: proposed contract for human review on 2026-10-31. No identity provider or voice provider is selected.

The first spatial-workspace milestone is single-engineer. This document specifies requirements for a later team release. It adds no authentication, permissions, audience selector, migration, or implemented privacy guarantee. The [implementation plan](spatial-workspace-implementation.md) and #261 shared contracts keep that boundary. Shared presence, human conversation, voice, and cross-agent coordination remain gated on later enforcement and qualification. Speech plus drawing #250 remains deferred.

## Current behavior and disclosure inventory

Source baseline: `7cc79034a772e1e56fdbbba7e64d2a5aeb792597`, containing the planning change over production `bc7fbd392f036a6fda055599854f29670a27f279`. These are source observations, not a fresh production deployment audit.

`demo/server.ts` checks the host, same origin, request bounds, and headers. Those checks do not identify a BIM participant. `CodexAccountConnection` in `src/codex-app-server.ts` supplies one server AI connection and a worker. Connecting or signing out that service is separate from joining a BIM project. An OpenAI account, selected model, browser tab, network origin, device code, or request ID cannot serve as participant identity.

`ChangeRequests` opens SQLite-backed project, ticket, message, execution, source, scope, and evidence stores. Ticket reads and summaries take project or ticket IDs without a participant. `list()` derives titles from first-message text and includes request metadata. A summary is therefore sensitive even when it omits the transcript. Decisions and evidence commands use the literal actor `preview-human`; that is historical preview attribution, not a verified human identity.

The following inventory names each current route family and each future disclosure that must use one authoritative access policy. An ID, revision hash, content hash, cursor, or source pin proves neither access nor ownership.

| Operation or disclosure | Current owner and behavior | Required future access check |
| --- | --- | --- |
| Project list, names, count, open, import | `GET/POST /api/projects`, `GET /api/projects/:projectId`; `ChangeRequests.projects`, `project`, `importProject` | Filter membership before names, counts, pagination, or serialization. Import cannot claim an existing project's identity or permissions. |
| Accepted model and target history | `GET /api/projects/:projectId/history`; `VersionedProjectStore` documents, revisions, reviews, publications; baselines and alternatives commands | Check project and target permission, then construct an audience-safe history and portable model. Embedded reviews and request references need the same check as top-level routes. |
| Ticket creation and collection | `POST /api/change-requests`, `GET /api/projects/:projectId/change-requests` | Bind creator and project membership on the server. Filter tickets before title, request, status, count, ordering, cursor, or project response generation. |
| Direct ticket, result, activity, executions | `GET /api/change-requests/:ticketId`, including `refreshProposal` and execution evidence | Resolve authorized ticket before result refresh or serialization. Do not reveal unauthorized existence through side effects, activity, or timing classes. |
| Draft, message, revise, decision | Ticket suffixes `/draft` GET and `/messages`, `/revision`, `/decision` POST | Check read or action capability, resource audience, current membership, and exact target. Read access does not grant acceptance or publication. |
| Source upload and download | `POST/GET /api/projects/:projectId/sources/:sourceId`; `RequestSourceStore` blobs, identities, bindings, memberships, retention | Upload owner plus project access; download requires an accessible binding or explicit shared publication. Project ID alone is insufficient. Include filename, digest, type, size, rendered PDF pages, and prepared text. |
| Retained project sources | `GET/POST /api/projects/:projectId/project-sources` | Retention is an explicit publication action when it broadens access. Private attachments cannot appear in the shared source page automatically. |
| Evidence list, append, dependencies, read sets | `GET/POST /api/projects/:projectId/evidence`; `ProjectEvidenceStore` entries, receipts, read sets, source closure | Check the complete dependency closure. Reject publication if recipients cannot read required evidence. Do not reveal a private conflict, missing pin, citation, or its identifier. |
| Scope preview and saved scope | `/api/projects/:projectId/scope-preview` POST and `/scopes` GET/POST; `ModelScopeStore` | Check model and scope audience before names, queries, entity membership, preview, or mutation. A model authoring scope is not a conversation audience. |
| Baselines and alternatives | `/api/projects/:projectId/baselines` and `/alternatives` POST | Check design-target capability and closure. Creating a target is not permission to expose a private proposal or its provenance. |
| Linked IFC metadata, bytes, conversion, placement, versions | `/api/projects/:projectId/ifc-links`, `/catalog`, `/:linkId`, `/prepared`, `/original`, `/candidate`, `/placement`, `/cancel`, `/versions/:versionId/review`, `/original`, `/adopt`; `linked-model-routes.ts` and `LinkedModelStore` | Check project, stable link, exact version, and action before catalog, conversion, original bytes, geometry, diagnostics, or adoption. Current `authorize` callback checks same origin. |
| AI connection and health | `/api/auth/session`, `/qr`, `/start`, `/models`, `/model`, `/cancel`, `/signout`; `/api/health` | Separate operator capability from participant permissions. Restrict AI account details and device login material; public health is minimal and excludes private workload counts. |
| Search, counts, task location, agent graphics | No dedicated conversation search or spatial-agent service in this baseline; UI groups fetched tickets | Apply filtering before indexes, result ranking, autocomplete, counts, same-place grouping, target highlights, location, avatar, or occupancy hint. Do not send hidden records for browser filtering. |
| Export, browser recovery, reimport | `room-app.ts` downloads `savedText` and legacy recovery bytes; `RoomRepository` serializes portable projects | Server supplies only the authorized portable closure. Reimport never restores privileges or publishes private data. Legacy browser recovery is quarantined on actor change. |
| Errors, HTTP methods, availability, quotas | Route-specific statuses and error messages; global upload limits; store integrity and freshness errors | Unavailable private and absent resources have equivalent external responses. Keep private IDs, content, workload, and provider diagnostics out of errors and quota hints. |
| Future notifications and channels | No BIM participant event subscription is implemented here. Current ticket polling exposes activity | Filter polling, replay, subscriptions, websocket or event streams, presence, human text, voice, notifications, audit views, exports, and coordination with the same policy. |
| Worker and operator data | Queue, execution evidence, geometry receipts, temporary prepared sources, AI context; SQLite and IFC files | Give workers only authorized dependencies. Protect internal logs, backups, indexes, spool, and temporary files. Operator filesystem access is a separate trust boundary. |

## Proposed identity and access model

These are conceptual entities for later schema review, not payload additions to the single-engineer implementation.

| Concept | Proposed meaning |
| --- | --- |
| Participant | Stable server identity independent of display name, company, discipline, AI account, and login method. A verified session resolves to this identity. |
| Project membership | Participant, project, active or revoked state, capabilities, company memberships, discipline memberships, and a policy generation. Membership is server managed and changes are attributed. |
| Capability | Explicit read model, create task, contribute, publish, review or accept model change, manage membership, or operate AI connection. Administrative membership does not imply private-content access. |
| Conversation owner | Immutable creator identity plus a separately recorded current custodian where transfer is allowed. Authorship never changes after transfer. |
| Audience | Exactly one personal owner, a project, a named company within a project, a named discipline within a project, or an explicit company-and-discipline intersection within a project. |
| Resource binding | Conversation, message, attachment, evidence, proposal, execution, graphic, or derived document linked to its owning project and audience. An accessible project does not make every child accessible. |
| Publication | Immutable recipient-facing copy of a reviewed proposal package, with its own shared task identity, audience, dependency manifest, publication actor, and timestamp. |
| Attribution | Server-recorded participant or service actor, action, command ID, time, exact source revision and proposal, and membership or policy generation at authorization. |

An active project membership is required for every project resource, including a participant's personal conversation. Audience membership alone never crosses a project boundary. Company and discipline labels are project-managed IDs, not user-supplied strings or email-domain inference. A company audience includes active members of that company in this project. A discipline audience includes active members of that discipline in this project. The intersection requires both memberships. A participant with several memberships has access through each permitted audience. There is no implicit union when both labels are selected.

The proposed default for a new task is personal. A personal conversation reveals neither content nor existence to other participants, including project administrators. Denial covers title, origin, status, source names, counts, activity, transcripts, notifications, and derived hints. An owner who loses project membership cannot continue to read the conversation through an old session.

All endpoint handlers and internal jobs obtain a server-issued authorization context. The same policy decides discovery, read, contribute, publish, decide, export, and subscribe. The policy checks current membership and resource association before resource-dependent work. Commands never accept a client-provided actor or capability as authority. Command deduplication binds actor, project, action, and payload so another actor cannot replay a receipt. Store checks protect asynchronous paths and transaction boundaries as well as HTTP handlers.

### Proposed access matrix

Every grant below requires active project membership and any relevant action capability. A revoked identity has no access, even to formerly owned personal work. A member outside a resource's audience has the same denial as an outsider. Company and discipline columns describe eligible audience members, not global organizational roles.

| Resource or action | Personal owner | Project audience member | Company audience member | Discipline audience member | Project administrator outside audience | Outsider or revoked |
| --- | --- | --- | --- | --- | --- | --- |
| Discover or read another person's personal task and derivatives | No | No | No | No | No | No |
| Discover or read own personal task and derivatives | Yes | Only if owner | Only if owner | Only if owner | Only if owner | No |
| Discover or read shared task and complete published package | If in audience | Yes for project audience | Yes for matching company audience | Yes for matching discipline audience | Only if in audience | No |
| Read company-and-discipline intersection | If both match | Only if both match | Only if discipline also matches | Only if company also matches | Only if both match | No |
| Contribute to shared task | If in audience and contributor | If contributor | If contributor | If contributor | Only if in audience and contributor | No |
| Publish a personal proposal | Owner with publication capability | No authority over another's personal task | No authority over another's personal task | No authority over another's personal task | No authority over another's personal task | No |
| Broaden shared publication audience | Publisher with capability and closure review | No automatic grant | No automatic grant | No automatic grant | No override outside audience | No |
| Accept a proposal into a shared design target | After explicit publication and reviewer capability | If package and target are accessible and reviewer | Same | Same | Same | No |
| Manage memberships or operate AI service | Only with separate capability | Only with separate capability | Only with separate capability | Only with separate capability | Only with separate capability | No |

The matrix does not grant acceptance merely because a user can publish. Each model decision retains current source freshness, target, geometry, evidence, and exact-proposal guards. For the proposed first team policy, accepted main and shared alternatives are project-visible. Their complete engineering review package must be project-visible before acceptance. Narrow company or discipline proposals remain unaccepted review work until explicitly published to the target's full audience. A later design may support restricted design targets, but that is a separate policy and implementation gate.

Administrators may see membership and service-operation records needed for their role. Those records exclude private conversation IDs, private workload counts, task locations, and content. Deployment operators may technically access plaintext server state and AI-provider context. This proposal does not promise secrecy from an operator with filesystem access or from the configured AI service. Any exceptional private-data access needs a separately agreed policy, restricted operator process, and audit. No administrator inspection control is implied by this document.

## Explicit private-to-shared publication

Publication copies selected review material into a new shared package. It does not change the original personal conversation's audience or expose its private lineage ID.

1. The owner selects an exact proposal revision and target, destination audience, public title, explanation, and permitted engineering attribution. The server rechecks ownership, publication capability, current audience membership, and source freshness.
2. The server builds the full dependency closure. The preview includes the proposal delta, source pins, necessary evidence, attachments or approved extracts, task origin if selected, and all recipient-visible author names. It also includes embedded review, metadata, error, and history text that would be copied.
3. The preview identifies private dependencies and blocks incomplete publication. The owner can explicitly publish each dependency when permitted, choose an approved shared substitute with truthful provenance, or stop. An AI summary is disclosure and requires the same preview. Silent omission, hidden dependency IDs, and redaction that removes required engineering evidence are invalid.
4. The owner confirms the exact package manifest, audience, and preview version. A changed audience, dependency, permission, or proposal invalidates confirmation. Publication uses an idempotent command and an atomic manifest commit.
5. Recipients receive a new shared task and immutable proposal package. They see the publication actor, original proposal author where approved, source revisions, evidence, and publisher explanation. Private transcript, private task ID, prior drafts, worker prompt, and omitted sources remain inaccessible. A restricted internal lineage record may link the copies without appearing in shared IDs, URLs, errors, or exports.
6. A qualified reviewer separately accepts the exact published proposal against the authoritative target head. Publishing does not accept geometry. Acceptance records both publisher and reviewer and preserves existing model validators.

Personal work cannot update a shared accepted target directly. That would reveal its effects and often its review history without publication. Proposed shared acceptance requires a complete package visible to everyone who can read that target. Before accepting, the UI states that the model delta and decision attribution become visible to that audience.

Later private messages and proposal revisions do not flow into an existing publication. An update requires a new confirmed package version and another freshness check. Shared discussion remains on the shared task. Shared-to-private reclassification cannot erase recipients' prior knowledge or downloaded exports. Proposed withdrawal hides future discovery where allowed, marks accessible published references as withdrawn, and keeps the engineering decision record for accepted work. It cannot retract an accepted change or promise deletion from an AI provider. Audience expansion is another publication review; audience reduction immediately revokes future access and invalidates caches and subscriptions.

## Actor changes, revocation, and workers

`room-app.ts` currently stores a last-project choice in local storage, a project-bound floor draft in session storage, and in-memory task presentation. `room-store.ts` supports IndexedDB browser recovery. These keys do not carry a verified BIM actor. The future release must inventory every cache and recovery path before offering account switching.

An actor change first locks and clears the current presentation. Abort polling, uploads, downloads, worker-result delivery, and subscriptions. Clear task drafts, transcript, tray, titles, counts, selected IDs, origin, highlights, evidence panels, attachments, prepared bytes, object URLs, navigation history, and account details. Namespace permitted persistence by verified actor, project, and policy generation. Remove or quarantine legacy browser records without showing their content to the next actor. Restore any quarantined record only through an explicit authorized recovery review. Do not copy a private draft into another actor's composer.

Every asynchronous result carries a binding to actor, project, and current policy generation. A response from an earlier binding cannot repaint, recreate graphics, populate a cache, export data, or submit a decision. Cross-tab invalidation, back-forward restoration, browser restart, offline recovery, and service-worker caches need the same rule if present in the implementation. Future private responses remain non-cacheable by shared intermediaries. UI clearing complements server authorization and cannot replace it.

Revocation commits an authoritative policy-generation change. New reads, writes, exports, stream messages, and reconnects fail after that commit. An existing session or subscription does not retain access until token expiry. No later worker commit or model acceptance may succeed under an older generation. Future qualification must measure and document the maximum client stale-display interval; the proposed target is at most five seconds while connected, with an immediate local lock on an authorization failure. An offline client locks private presentation when its short authorization lease expires and requires fresh authorization before restoration. The lease duration is a human policy decision below.

Queue entries record the initiating participant, project, audience, dependencies, and authorized action. A worker acts as a restricted service on that participant's behalf, not as the service-wide AI account owner. Reauthorize at dequeue, before preparing or sending sources to the AI service, at each dependency fetch or continuation, and before publishing a result or committing a model decision. Use the current generation in the final transaction so a revoke-versus-commit race has a single order. A generation check before an unrelated asynchronous wait is insufficient.

Revocation cancels queued and active work under the removed grant and stops further source delivery. Already transmitted bytes cannot be recalled. Late results are discarded or quarantined in restricted operational storage and cannot appear in shared activity, errors, drafts, or acceptance. Cancellation and provider-process cleanup remain different states. Do not claim provider cleanup has completed without authoritative evidence. Shared work may continue only through an explicitly attributed handoff to an authorized participant with a new authorization context. No administrator may adopt a personal conversation by changing membership metadata.

## Ownership migration and rollback requirements

The first team implementation needs a reviewed migration plan for SQLite records, content-addressed project bodies, IFC storage, indexes, prepared files, logs, backups, and browser recovery. A new participant column alone does not protect historical project serialization.

- Back up a consistent snapshot and inventory all ticket, message, submission, execution, geometry receipt, decision, source-binding, retention, scope, evidence, and project-publication references. Record counts and hashes in an operator-only migration report. Do not expose that report to project members.
- Preserve historical `preview-human` attribution as unverified legacy authorship. A verified maintainer explicitly maps eligible preview-owned projects and conversations to a custodian. Do not infer authorship from the AI login, first visitor, imported project name, or ticket ID.
- Quarantine ambiguous ownership and legacy portable documents until a human reviews their complete disclosure closure. Default migrated conversations to personal after explicit custodianship. Existing shared model and evidence need an explicit audience decision. A new member receives none of the quarantined data by default.
- Store new ownership and policy metadata separately where required to preserve immutable historical hashes. Do not silently rewrite decision history to claim verified authorship. If portable document contents must change, version that format and prove reconstruction and source-pin behavior.
- Bind migrated sources and evidence to their allowed uses. A blob reused in personal and shared work needs explicit shared publication metadata. Deduplication must not expose cross-audience existence through hashes, hit rates, errors, or byte counts.
- Migrate atomically or use a resumable journal with deterministic states. Crash, repeated startup, duplicate commands, mixed-version readers, and partial index rebuilds must fail closed. Keep workers stopped until authorization and ownership are complete.
- Enforce a storage-version fence. A participant-less server cannot open the team database. Rollback means restoring a verified pre-team snapshot in an isolated single-engineer environment, or running a reviewed compatible rollback that preserves access metadata. Never reopen migrated team state with the old server to restore availability.
- Review data retained after revocation, participant deletion, publication withdrawal, and export. Preserve engineering attribution with a stable tombstone when policy requires it. Rejoining does not silently restore personal custody, roles, subscriptions, or worker grants. Restore only through an explicit reviewed grant.

## Human policy decisions still open

These defaults are recommendations for review, not accepted policy or implemented behavior. Approving this documentation does not authorize schema or permission changes.

| Decision needed | Proposed default | Why the human decision matters |
| --- | --- | --- |
| New-task audience | Personal, with an explicit publication action | Changes whether ordinary work is discoverable by colleagues. |
| Company and discipline rules | Project-managed named audiences; both selected means intersection | A union can disclose work to an unintended company or discipline. |
| Administrator visibility | No personal content or existence; operator access handled separately | Technical support and organizational oversight may require a different agreed process. |
| Shared target visibility and acceptance | Main and shared alternatives are project-visible; require project-visible complete package before acceptance | Narrow review work cannot silently leak through accepted geometry or embedded review history. |
| Attribution shown on publication | Verified publisher and reviewer; original author disclosed in preview; no private task identity | Attribution affects accountability and participant privacy. Required engineering authorship cannot be silently anonymized. |
| Custody of legacy or departed-owner work | Explicit verified custodian for legacy work; personal work locked after departure; shared work uses explicit handoff | Reassignment must not become a private-data back door. |
| Retention, deletion, and withdrawal | Retain accepted engineering decision packages; keep personal retention configurable and settle a duration before team launch | No duration, deletion SLA, backup expiry, or provider retention promise is selected here. |
| Offline access and revocation lease | No persistent offline private content in the first team release; at most five seconds for a connected view to lock after revocation | Convenience trades against how long already displayed content remains visible. A later offline mode needs explicit duration and evidence. |
| Exceptional private-data access | No product administrator override initially | Any later support or legal access process changes the privacy promise and requires separate review. |
| Membership and decision roles | Explicit contributor, publisher, reviewer, membership manager, and AI operator capabilities; no self-granted role | The maintainer must decide who can publish and approve engineering changes. Separation of publisher and reviewer is not assumed. |

## Future qualification contract

No test in this section is claimed as executed by #259. Later implementation must add deterministic store and HTTP tests, real browser cache tests, and worker race tests. Test fixtures use two active members, A and B, outsider O, and formerly active revoked identity R. Use separate sessions for each. Give A and B different companies and disciplines, then change their memberships to test each matching and nonmatching case. Use a separate administrator test session to test the administrator policy.

| Test group | Required observable evidence |
| --- | --- |
| Identity and authority | AI sign-in, sign-out, model choice, renamed participant, forged actor, forged capability, and reused session never change BIM ownership or membership. O cannot import over an existing project. |
| Complete access matrix | Run every inventory row as A, B, O, and R for personal, project, company, discipline, and intersection resources. Include allowed and denied reads and mutations, wrong project, wrong linked version, and guessed valid IDs. |
| No private existence | Add, update, run, cancel, fail, and delete A's personal task while B observes. B's lists, titles, counts, search, ordering, cursors, response bodies, agent positions, grouping, highlights, occupancy, activity, quota hints, and notifications remain equivalent to an absent task. |
| Direct IDs and errors | Compare unauthorized personal IDs with nonexistent well-formed IDs for every route, method, binary response, error shape, status, headers, and resource-dependent timing class. Include conditional, range, HEAD, and unsupported-method requests where accepted by the implementation. Keep private details out of diagnostic IDs and logs returned to clients. |
| Attachments and evidence | Deny direct bytes, filename, digest, prepared PDF or image, text, retained-source listing, evidence dependency, conflict, receipt, read set, execution, and geometry receipt when the parent grant is absent. Guessing a hash or accessing the same blob through another binding grants no broader access. |
| History, export, and import | Inspect serialized project documents, embedded reviews, revision metadata, target histories, download filenames, recovery exports, and reimport results. Personal instructions, source names, internal lineage, and private IDs are absent from shared packages. Privileges never travel with an export. |
| Publication and acceptance | Preview all copied fields. Test missing private dependency, substitution with truthful provenance, changed manifest, changed audience, concurrent revoke, duplicate command, crash, retry, late result, and new revision. Publish changes no accepted geometry. Separate explicit acceptance changes only the exact validated delta and records publisher and reviewer. |
| Audience transitions | Project, company, discipline, and intersection membership changes invalidate old access. Expansion requires new confirmation; reduction revokes future delivery. Withdrawal preserves accepted engineering evidence and does not claim downloaded copies are erased. |
| Actor and project switch | With A's draft, attachment URL, evidence panel, open agent, and pending response, switch to B and another project. Verify empty private presentation, no stale redraw, no draft transfer, no back-button disclosure, and safe IndexedDB or session-storage recovery. Repeat in two tabs and after restart. |
| Revocation races | Revoke R while queued, preparing sources, calling the worker, awaiting a reply, publishing, accepting, uploading, or downloading. After the authoritative generation change, no old-grant commit succeeds, no new protected bytes or events begin delivery, and late work stays inaccessible. Test both possible serialized orders for an in-flight commit. Previously delivered bytes cannot be recalled. |
| Reconnect and expiry | Disconnect then revoke, expire session, restart server, resume polling or stream with an old cursor, reconnect a subscription, and rejoin. Reauthorize before replay and enforce the agreed display lease. No private task IDs appear in global event sequence gaps or resume errors. |
| Cross-agent and human channels | Another agent, overlap detector, shared presence, recipient picker, or future human text/voice channel receives only authorized data. A private task creates no coordination or occupancy hint. Human text or speech never becomes an agent command implicitly. |
| Migration and rollback | Test ambiguous `preview-human` ownership, legacy source reuse, malformed portable documents, interrupted and repeated migration, backup restore, mixed versions, and old-server opening. Verify hashes, complete reference inventory, quarantine, and version-fence rejection. |
| Operational disclosure | Client errors, operator dashboards exposed to members, AI session details, workload limits, metrics, indexes, temporary files, backups, and service credentials do not cross their approved boundary. Provider failure and cancellation do not reveal another participant's job. |

Tests must inspect real response bytes and browser state, not only hidden UI elements or policy-function return values. A privacy suite uses disposable data and independent expected results. Existing geometry, source freshness, accepted-head, and evidence validators remain required. Timing and workload isolation need measured tolerances in the later implementation plan; this design does not claim perfect traffic-analysis resistance.

## Recommended future implementation issues

These are proposed issue boundaries, not newly opened issues or authorization to implement them.

1. Review and accept the policy decisions above, participant model, and role assignment process. Choose identity transport only after requirements are settled. Deliver the threat model and session contract.
2. Implement reviewed ownership metadata and storage migration, quarantine, format fences, backup, and rollback. Include fixture migration evidence before any team data enters the system.
3. Enforce one participant-aware policy across the complete current route and store inventory, portable reconstruction, sources, evidence, scopes, linked IFC, and AI operator controls. Gate team access until this issue and its negative tests pass.
4. Implement actor-bound browser state, queue authorization, worker revocation, and commit ordering. These tests must pass with the server enforcement before account switching is enabled.
5. Implement explicit publication packages, dependency preview, attributed decisions, and shared-target acceptance rules. Qualify the private-to-shared journey and rollback behavior.
6. Qualify the complete four-actor matrix and migration against the integrated deployment. Human review decides whether the team release is allowed. Only then plan filtered presence, human text or voice, and cross-agent coordination as separate work.

The #253 task controller and #257 task-agent integration may proceed for the single-engineer milestone without these future entities. Their current project-plus-ticket identity remains a UI binding. Their projections, graphics, and read APIs must not be presented as participant privacy controls.
