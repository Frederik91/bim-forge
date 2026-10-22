# Bounded application development

The owner delegates routine factory preparation, implementation, testing, and draft publication to the coordinating agent. These steps do not need a new permission prompt for each task. The owner still decides which changes to merge. Human change review accepts the intended behavior, not a claim of source-code audit.

## Application task contract

The additions-only worker accepts a pair of new files such as `src/model-summary.mjs` and `src/model-summary.test.mjs`. Names use lowercase words separated by hyphens. Nested directories and changes to existing source remain unsupported. Existing fixed factory profiles retain their contracts.

Every application module exports `evaluate(input)`. The command reads JSON from standard input and prints one JSON result line. Invalid command input produces only `Invalid application input` and a newline on standard error, with a nonzero exit. The function throws on invalid input. Modules operate on supplied disposable data, not production models or external services.

The exact task still binds an open issue snapshot, a pinned base revision, a ready read-only plan, the two paths, and independently prepared expected results. Distinct valid and invalid cases must cover both the command and the function. The coordinator prepares these cases before generation. Generated tests supplement those cases and do not replace them.

The worker cannot change permissions, storage schemas, geometry, coordination, credentials, network rules, deployment settings, or repository instructions through this contract. Describing a task as read-only does not prove arbitrary generated code is correct. Candidate execution remains credential-free and isolated. Technical inspection remains an agent responsibility before merge.

## Scheduled execution and supervision

The VM's hourly timer remains the only coding schedule. A coordinating agent can prepare and stage an exact task within the owner's delegation, without asking the owner to approve each setup action. The worker cannot select issues or grant itself authority. A thread follow-up can supervise completion but does not add a second coding timer or replace the always-on server.

The existing administrator-owned activation selects one exact scope and deployment. Approval expires within 24 hours. Each activation is single-use. Normal approvals allow at most three starts per UTC day including manual work. During supervised factory setup, the owner authorized an exact approval of up to six starts. After qualification, subsequent approvals return to three. All starts remain counted, and each issue retains its cumulative three-start ceiling. Failure does not automatically retry. A repeated wake reuses the terminal receipt. Expired or changed scopes stop rather than refreshing themselves. This change does not add an open-ended task queue or automatic intake from public issue text.

Pauses, measured deployment checks, isolated identities, resource limits, short-lived publishing credentials, and draft-only publication stay active. The App cannot approve its own work or merge it. Branch protections still require the owner and trusted checks.

## Change reviews

Generated descriptions explain what changes, why it matters, risks, measured checks, remaining gaps, and the requested decision. Detailed identifiers belong in a collapsible section. Successful tests do not become a claim of completed independent code review. Source merge, deployment, and scheduled activation are distinct events.

## Readiness evidence

The factory is ready for bounded read-only application work only after the reviewed release is installed and a fresh application task completes generation, independent cases, repository tests, and draft publication on the VM. A repeated wake must avoid another model call and duplicate publication. Hourly recurrence must be active, and pause and cleanup checks must retain their evidence.

An idle wake, a passing source test, or a merged PR alone is not readiness. The coordinator reports the actual scope of readiness. Storage, geometry, a user interface, and modifications to existing application files need further capabilities and review. This is not a general-purpose autonomous application builder.
