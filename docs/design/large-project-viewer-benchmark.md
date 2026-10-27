# Large-project viewer benchmark setup

Issue: [#192](https://github.com/Frederik91/bim-forge/issues/192).

## Decision status

**Inconclusive.** This delivery builds a runnable benchmark application and both
viewer adapters. A real 200,000+ m² project has not been supplied or admitted.
There is no evidence yet to choose an engine or claim large-project capacity.

The follow-up [initial West Riverside evaluation](../evidence/viewer-benchmark/west-riverside-initial/README.md)
uses all seven public IFC4 discipline exports locally. Its floor area and upstream
release authorization remain unresolved. It is a separate, unqualified workload;
the 200,000+ m² dataset admission and scored comparison remain open under #192.

The implementation plan, commands, supported operations, measurement profile,
and remaining scored work are in [the benchmark README](../../benchmarks/viewer/README.md).
The [dataset checklist](../../benchmarks/viewer/dataset-requirements.md) identifies
the files, rights, project owner, floor-area evidence, coordination data,
representative edits, and hardware still needed.

## Delivered behavior

The CLI builds an independent browser app, serves assets and input geometry on
loopback, and runs Babylon and That Open Fragments in separate browser processes.
The Fragments worker is supplied by the pinned local package. The production
viewer, workspace mounts, accepted models, and storage paths are unchanged.

Both adapters load triangle geometry, preserve stable element IDs, apply bounded
render replacements, select/highlight objects, retrieve properties, ray-pick,
filter, section, show previous/modified/added/removed objects, and dispose their
resources. Shared input geometry, metadata, proposals, camera paths, and world
bounds make the setup inspectable across engines.

The synthetic fixture checks proposal preview, comparison entry/exit, discard,
and stale-revision rejection. Every rendered state is checked against expected
IDs, positions, and geometry bounds. A successful setup always remains
`qualified: false`. Raw timings are retained for instrumentation checks, not
for an engine ranking.

## Implementation findings

Fragments edits produce separate runtime delta models. Picking, visibility,
highlighting, and clipping must include those models. Reading only the original
empty model's bounding boxes does not verify the rendered geometry. The adapter
reads geometry from the runtime models instead.

Element deletion through the high-level Fragments API also deletes its materials
and representations. That conflicts with shared geometry/materials. This adapter
removes instance records and retains shared resources. It resolves temporary
creation references into persistent IDs before later edits.

The adapter bakes positive nonuniform scale into a shared shell per geometry/scale
pair. World-bounds assertions verify the dimensions rather than assuming that a
valid edit request renders the same shape. Further conversion and visual-fidelity
qualification remains required for actual BIM input.

## Evidence and limits

See [the setup evidence](../evidence/viewer-benchmark/setup-192/README.md) for the
exact implementation revision, commands, results, screenshots, and validator
output. The Windows host is a workstation, not the required 16 GB integrated-GPU
laptop. Correctness runs do not establish exclusive-host performance or memory
retention. The initial real-project targets remain unmeasured.

Current rendering comparisons still need a pinned production-viewer baseline,
equal tuning, native conversion, spatial streaming, engineering-fidelity checks,
CPU/process/GPU memory instrumentation, cold/warm repetitions, network shaping,
realistic proposal fan-out, and human-reviewed dataset admission. The current
runner eagerly loads JSON and includes neutral diff/oracle work in its update
times. Those costs must be separated before a scored engine comparison.

Model delta: zero accepted production entities, relationships, or revisions.
The fixture's proposals affect disposable render data only. Rollback removes
the benchmark files and development dependencies. No production-viewer
migration or deployment is part of this delivery.
