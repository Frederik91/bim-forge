# Spatial acceptance fixture preparation

Issue #264, epic #251. Preparation checkpoint; not end-to-end qualification.

## Files and ownership

`tests/fixtures/spatial-workspace/fixture.ts` owns the disposable native building,
stable identities, source-bound visual contexts and independent expected delta.
The adjacent README records units and the expected before/after representation.
`demo/spatial-workspace-fixture.test.ts` imports these helpers so the existing
strict typecheck includes them as well as running observable fixture assertions.

No runtime module, validator, production model or shared consumer fixture changed.

## Acceptance data

Use the existing version-two multi-storey native building: three levels, six rooms,
real slabs, stairs, furniture and hosted doors. The ground connecting door changes
from 0.9 m width / 3.0 m offset to 1.1 m / 2.9 m. Its evaluated project centre stays
at [4, 3.45, 0] m. Exactly one Door and one hosted-by relationship change; all other
authored fields remain identical. The expected snapshot is an independent oracle,
never a supplied worker result or accepted geometry shortcut.

## Attempt ledger

1. First validation identified missing type narrowing for a building wall's
   levelId: legacy Wall does not have that field. Added the explicit building-wall
   guard; no fixture or model validator was weakened.
2. `npm run validate` passed: 354 source files checked, typecheck and policy passed.
   `node --test demo/spatial-workspace-fixture.test.ts` passed all three tests,
   zero failures or skips. Whitespace check passed.

## Required next evidence

#270 supplies the real bounded ScriptBox hosted-door operation. Add its
deterministic worker, queue/explicit acceptance, restart and adverse-lifecycle
helpers after that dependency is reviewed. Source-pinned placement adapters consume
#254's actual types; view-session adapters consume #255. #258 still owns the final
integrated browser journey, actual local server evidence and a separately scoped
connected-provider gate. These preparation checks do not prove any of those gates.

Construction-model delta: zero. No provider, deployment or merge.
