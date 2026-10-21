# Verifier agent contract

## Required checks

- policy and protected-path check;
- schema/serialization validity;
- deterministic model fixture comparison;
- geometry validity when geometry is touched;
- coordination/clash checks when coordination is touched;
- regression checks for affected queries and exports;
- security and secret scanning.

## Output

A machine-readable report with validator name/version, inputs, pass/fail result, findings, evidence links, and a final recommendation. A verifier may block a pull request but may not dismiss a failure or merge it.
