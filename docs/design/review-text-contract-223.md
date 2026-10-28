# Review-text contract feedback

Scoped correction for [#223](https://github.com/Frederik91/bim-forge/issues/223), parent draft [#224](https://github.com/Frederik91/bim-forge/pull/224). Base `c74d9245d3b80986aca7ba27f268cbf415bf4df1`. Own only `src/model-script.ts`, `src/model-proposal.ts`, `src/model-script-review.test.ts` and this note. Parent owns test registration, combined qualification and deployment; no separate PR.

## Diagnosis and red proof

The retained live symptom was successful geometry followed by `invalid-proposal: Review text requires 1 to 600 readable characters.` No credentials, live projects or full provider transcripts were read. The diagnosing-bugs skill's feedback loop uses an invented two-room fixture through the actual ScriptBox WASM guest:

```sh
node --test --test-concurrency=1 src/model-script-review.test.ts
```

At test-only commit `b782cda`, a completed `model.previewWallShift` host call precedes rejection of either a 601-character constraints value or a newline. Both failing regressions retain the exact generic live diagnostic. The independent exact-600/corrected-concise test passes. Verdict: 3 tests, 1 pass, 2 expected failures. Accepted repository/base bytes remain unchanged, and the invalid execution's last preview is null. This isolates terminal review validation from geometry and source interpretation.

Ranked hypotheses were missing text rules in agent guidance, generic diagnostics hiding the repair, and lost geometry/guest state. Completed geometry calls plus exact-boundary/corrected success exclude the latter in this reproduction. Source inspection confirms both instruction paths described the review shape without text bounds, while one boolean guard collapsed type/blank/control/length failures into a generic diagnostic. Existing private-draft/rollback behavior is correct and unchanged. The fix addresses the shared contract and feedback, rather than changing geometry or relaxing validation.

## Shared contract and unchanged accepted language

`MODEL_REVIEW_TEXT_CONTRACT` in `src/model-script.ts` owns immutable `maximumLengths` for `summary:240`, `rationale:800`, `constraints:600`, `uncertainty:400`, plus the existing forbidden-control pattern and its shared description. `MODEL_REVIEW_TEXT_GUIDANCE` derives all four bounds and text rules from that contract and is included verbatim in `/guides/model.md` and `model-proposal.ts` initial provider instructions. The existing dependency direction already imports model-script from model-proposal; no new source module or authority is introduced.

Proposal text validation names `review.<field>` and distinguishes wrong JSON type, empty/whitespace-only string, forbidden controls and overlength. Control and overlength errors include actual raw length and maximum; errors never echo supplied field contents. For example: `review.constraints length 601 exceeds maximum 600; shorten this field to 1-600 characters on a single line.` The invalid proposal still discards the private execution and clears its preview. A repair replays the complete proposed operations and returns a valid review; no automatic mutation, truncation, fact omission or acceptance occurs.

Accepted language is unchanged: strings require non-whitespace content; length is JavaScript `string.length` (UTF-16 code units), measured before the pre-existing successful return's `trim()`. Every U+0000..U+001F character remains forbidden. No new whitespace normalization or Unicode-control ban is added; historical acceptance outside the exact C0 range is retained. The guidance recommends single-line text without that precise forbidden range. Geometry, native/schema/evidence/target acceptance, intent parsing, decline/clarify behavior, raw source retention and provider budgets remain unchanged.

The guest regression covers the original 601/newline symptom with successful staged geometry, exact600 and corrected concise proposals, all four exact maxima/max+1 values, type versus blank diagnostics, all 32 C0 controls, historical Unicode acceptance/trim behavior, raw padded length and astral UTF-16 counting. It reads actual guest docs and captures actual initial provider instructions to verify identical generated guidance and unchanged accepted base. Existing script intent tests, wall and dimension guest tests run alongside it.

## Qualification and ledger

All builds/tests are isolated server-container-only over SSH `frederik@192.168.1.17`, using read-only source/dependencies, network none, 1 CPU, 2 GiB memory/swap ceiling, 256 PIDs and dropped capabilities. Source bundles, logs, cache and temporary artifacts stay on `/ssd1`. Image `bim-qvm-tools:20261025`, cached dependencies `/ssd1/bim-forge-qualification/all-ready-195/final/dependencies`. Owner allowance: ten total attempts for this new correction; no global factory policy changes.

| Attempt | Commands / source | Outcome |
| --- | --- | --- |
| `a1` | `b782cda`; the red command above, product source unchanged from base | 1 pass / 2 expected diagnostic failures, exact live symptom reproduced; completed geometry and discard/base/preview fences verified. |
| Pending | Root validation, explicit four-path policy and focused script/review/wall/dimension/intent checks | Not yet qualified |
