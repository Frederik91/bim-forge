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
| `a2` | `5bc1aa0`; `npm run validate`, explicit four-path policy and focused command below | All passed: 61/61 tests (8 new, 53 existing), zero failures/skips. The original red regressions pass; exact acceptance boundaries and both live instruction seams are covered. A bounded companion container retained a compact synthetic receipt with four actual guest executions, audit records and unchanged accepted-state proof. |

Focused green command:

```sh
node --test --test-concurrency=1 src/model-script-review.test.ts src/model-script.test.ts src/model-script-wall.test.ts src/model-script-dimension.test.ts src/room-dimension-preview.test.ts src/visual-request.test.ts
```

Evidence root: `/ssd1/bim-forge-qualification/issue223-reviewcontract/`. `a1/` retains the original red proof and unchanged product source bundle; `a2/` retains the qualified bundle/checkout, runner, Node `v24.22.1`, exact container inspections, full logs, source hashes and `artifacts/review-contract-receipt.json`. The receipt shows overlength/newline failures, successful exact600/corrected proposals, completed geometry host calls and cleared failed previews. Its synthetic model delta remains a +100 mm shared partition move, adjacent centreline spans 3/3 -> 3.1/2.9 m and evaluated hosted-opening motion, without accepted-state changes.

```text
Strict TypeScript valid. 290 source file(s) checked.
tsc --noEmit: exit 0
Policy valid. 4 changed file(s) checked. [explicit command]
tests 61; pass 61; fail 0; skipped 0
```

The unchanged root policy invocation supplies zero paths; an additional explicit command checks all four changed paths. Image ID: `sha256:4b96c3cba2f461d2bb9b6a285e5514fcf58968c9614eddd3441bcdb2def38dff`.

| Artifact | SHA-256 |
| --- | --- |
| `a1/artifacts/red.log` | `ac45d39f18af74bdde2844da9e1ab438b506692e6ba98b486a1782e72c49242a` |
| `a2/artifacts/validate.log` | `0fae94202dc2818448f38daa7dec35af2d4c50535e23abfa2fe25363c00f3c14` |
| `a2/artifacts/policy.log` | `6f3926ab3331c9844fc51585523a80c2468c3bd63deb9aaade6f52757b715842` |
| `a2/artifacts/focused.log` | `0b8cd032f22b608f9f5542fee155bb693c9bb7f2ade5b86b56d38c79b25a1890` |
| `a2/artifacts/review-contract-receipt.json` | `4d3d12b258bc90649b18c93ae12e9dd9bbafd0831509a8c08b502f1721dd1945` |

Qualified source hashes: `src/model-script.ts` = `14eac6343aace20a8be0690fea58783752523eb722c3e4b905407db09905f9a6`; `src/model-proposal.ts` = `a827ea13f80d426593b16bae7f129eb9a2580a39f4191190559c76ec4504a3eb`; `src/model-script-review.test.ts` = `fa55790d54bff2da92f3cdfe2d56ccc98d1c00523069e4ecee9f1db8d7e916fd`.

Only this note changes after product/test qualification. Final documentation-head root validation and identical source hashes are reported in issue #223. Parent owns registration, the combined PR224 checks, live provider retry and deployment. This synthetic deterministic correction does not claim live source interpretation or IFC/context qualification.
