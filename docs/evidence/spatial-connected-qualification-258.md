# Connected native spatial qualification — #258

One real connected-provider request passed on 2026-10-31. This qualifies the single native door workflow; it is not a general interpretation-accuracy claim.

## Plan and budget

Use the shipped Inside workspace, existing account connection, real production model worker, new disposable house and a separate temporary SQLite store. Select the actual ground connecting door and submit: “Widen this door from 900 mm to 1100 mm, preserving its centre and existing host. Keep every other object unchanged.” Compare the entire result against the independent #264 snapshot oracle before clicking the existing explicit Accept action in this disposable project.

The budget was written before opening the connection: **one worker invocation**, **180 seconds** per production worker turn, no outer retry and no second request. Normal production tool calls and observation continuations within that invocation retain their existing bounds. `scripts/qualify-spatial-provider.ts` requires `--run-one-provider-request`, refuses a second worker invocation and is deliberately absent from ordinary test commands.

Runtime source: `895e6c26464ceff85acc8da7b7089c4dd44bc042` (the complete combined runtime before later presentation repairs). The qualification harness was a separately validated, uncommitted addition at execution time; its exact bytes are committed beside this report. No runtime source was modified in this lane.

Harness SHA-256: `e31eda7d570395d0cd61c5e187e28f46a80fb316fa54f49858a54e12060c8ee8`.

## Observed result

- Budget recorded at 16:16:06 UTC; actual worker started 16:16:11; proposal checked and explicitly accepted by 16:16:38.
- Exactly **one** worker invocation; server terminal state **ready**; zero browser errors.
- Real proposal equals the **entire independent expected snapshot**, including unchanged unrelated geometry and relationships.
- Door width **0.9 → 1.1 m**; hosting offset **3.0 → 2.9 m**; centre remains **[4, 3.45, 0] m**; host and wall IDs unchanged.
- Delta contains exactly one modified Door and one modified hosted-by relationship; no additions or removals.
- The accepted main revision remained unchanged until the existing UI **Accept into Main** button was clicked. The resulting accepted snapshot equals that same oracle.
- The request retained a placed origin and exact revision-qualified native targets. The actual shipped UI included both the selected door and `level-ground` in selected IDs and placement targets; this run does not claim a door-only scope.
- Two script evidence entries were retained (`not-run`, then `passed`) within the same invocation. The worker reached a validated proposal; no failing validator was weakened or skipped.

## Evidence

[Budget](spatial-connected-qualification-258/budget.json), [result](spatial-connected-qualification-258/result.json), [before/proposed/accepted facts and placement](spatial-connected-qualification-258/facts.json), [complete model delta](spatial-connected-qualification-258/delta.json), [actual proposal screenshot](spatial-connected-qualification-258/proposal.png).

The raw full ticket is retained only in the local disposable evidence directory, excluded from Git. Its SHA-256 is `c98256457f30266e4ae30004dbf6e4e13b743e92bb76db81dcbd938074d6c364`. No account details, credentials, provider payload or production model data were copied into public evidence.

## Validation and replay

- `npm ci --ignore-scripts`: passed; zero reported vulnerabilities.
- `npm run validate`: passed; strict TypeScript checked 385 source files, typecheck and policy passed.
- `npm run build:demo`: passed.
- Running the qualification script without the explicit flag rejects before opening any provider connection.
- `node scripts/qualify-spatial-provider.ts --run-one-provider-request`: passed as recorded above. **This command spends one new provider request. Do not rerun it as ordinary regression testing.**

The browser and ephemeral server were closed, workers drained, and account connection closed after evidence capture. Disposable database/evidence remains under `%TEMP%/bim-forge-provider-251-JYos9J`; no persistent preview or deployment was started by this lane. Model delta outside this disposable project: **zero**.

Combined Linux, linked IFC, later presentation repair and persistent local-server qualification remain with their owners. This report neither changes GitHub readiness nor merges or closes anything.
