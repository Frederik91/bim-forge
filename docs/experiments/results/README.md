# Experiment results

Qualification execution is in progress. Terminal records are added here only after the corresponding server evidence has been collected and checked. Running work and reviewed results are recorded separately in the registry.

Each terminal run adds a unique `<experiment-id>/<run-id>/result.json` and a concise `summary.md`. Run IDs must be collision-resistant and assigned before execution. Files in a completed run directory are immutable.

A reviewer adds a separate immutable record under `docs/experiments/decisions/` and references the run. The coordinator links both records from the registry. A later review never modifies the original result.

The summary states the hypothesis, exact design/definition bindings, observed assertions, conclusion, limitations, reproduction command, and effects on open decisions. Link large raw artifacts using durable references and SHA-256 values. Do not commit database dumps, secrets, real hospital data, or large generated datasets.

Use the [result template](../templates/run-result.json) and [program procedure](../README.md). An issue comment, proposed benchmark size, or empty result directory is not an executed result. W0 supplies the executable record validator; W7 reviews evidence and updates the shared registry.
