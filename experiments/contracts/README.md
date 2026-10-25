# Qualification contract v1

Tracking: W0 [#123](https://github.com/Frederik91/bim-forge/issues/123). This contract validates experiment evidence. It does not qualify VM-C1 by itself.

Stream runners emit JSON case observations with these exact fields:

```json
{"experimentId":"EX-04","caseId":"independent-desk-bed","expected":"both edits retained","observed":"both edits retained","passed":true,"limitations":[]}
```

`schema.ts` exports authoritative TypeBox schemas and inferred `Observation`, `Coverage`, and `Run` types. A terminal `Run` uses `recordKind: run`, typed design/definition commit and hash bindings, source/runner commits, actual environment and commands, dataset manifest hash, observations, complete coverage accounting, errors, limitations, and hashed artifact references. Templates and missing evidence are refused.

For every assertion in the bound registry definition, coverage names that exact assertion, the observed case IDs, and `covered`, `partial`, or `not-covered`. A passed run needs successful observations, covered assertions, no errors, and no case-level limitations. Partial coverage must remain inconclusive. A successful process does not establish complete experiment coverage.

`records.ts` exports `bindingFor`, `sha256`, `describeArtifact`, `verifyRun`, and `publishRun`. Bindings must match committed bytes. Verification checks the historical Git objects, every registry assertion, and artifact lengths and hashes. Artifacts are referenced relative to an explicit evidence root. Publication uses a new run directory and exclusive terminal-file link, refuses existing IDs, and publishes the terminal result only after its summary is ready. Interrupted pending directories do not contain a terminal result and require a new run ID. Reviews are separate immutable records.

The CLI validates a runner's observation array or verifies and publishes a completed record:

```sh
node experiments/contracts/cli.ts observations observations.json
node experiments/contracts/cli.ts verify result-input.json /evidence
node experiments/contracts/cli.ts publish result-input.json /evidence docs/experiments/results
npm run test:qualification-contracts
```

Run from the repository root with its Git object database available, inside the server container. Source and evidence must be retained independently of the container. The tiny fixture is `experiments/fixtures/tiny-building.json`; `parseFixture` checks its shape, identities, endpoints, opening hosts, and instance types. It is a semantic fixture, not a solved or construction-qualified model.

The qualification Dockerfile extends the cached preview build image with Git, PostgreSQL client tools, and Python virtual-environment support. Record the resulting image ID per run. Experimental Python packages live in a separately pinned environment on the test data volume. The first container check exposed missing Git in the preview build image; this explicit tools image supplies the required Git-object verification dependency.

The root strict-TypeScript checker and tsconfig include `experiments` and `benchmarks`. Stream-specific dependencies belong in isolated experimental packages. W0 does not add experimental database drivers to production dependencies.
