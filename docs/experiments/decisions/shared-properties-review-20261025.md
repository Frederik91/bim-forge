# Shared-property candidate review

QVM-01 / issue #130, 25 October 2026. EX-03 `w1-ex03-shared-20261025c` covers all three declared assertions through actual bounded state mutations over the W0 two-chair/shared-type fixture.

An occurrence width override changes only chair-a from 0.5 to 0.75; chair-b and shared content remain unchanged. An explicit type edit lists both dependent chairs, distinguishes the masked override from the effectively changed chair-b, and retains before/after evidence. Equal content shares one immutable hash; editing a fork creates new content and changes only chair-b. Thus content equality does not grant shared editing authority.

Root validation, six new tests, collector/schema validation and W0 publication passed on the server. Source is [PR #134](https://github.com/Frederik91/bim-forge/pull/134), commit `8b1c716f7570e11987ae8b66a315ee0834098b05`. Raw evidence root for relative artifact paths: `/ssd1/bim-forge-qualification/qvm-20261025/worker-w1-ex03-shared-20261025c/artifacts`. The actual retained evidence is 337,604 bytes within the predeclared 64 MiB budget; no database or hospital generation was used.

Conclusion remains **inconclusive**. Primitive value kinds come from the fixture definitions; external dictionaries, property-specific units, richer value-status semantics, persistence, concurrent reconciliation and engineering regeneration are not qualified. The result supports separating immutable content, explicit shared definitions and occurrence overrides. It does not adopt a production property model or grant human approval.

Earlier baseline and candidate records remain unchanged. Retain raw evidence through architecture review; no automatic cleanup is configured.
