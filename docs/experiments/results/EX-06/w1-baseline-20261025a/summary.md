# EX-06: w1-baseline-20261025a

Outcome: failed. Execution: completed.

Does the existing native baseline satisfy the declared EX-06 assertions?

Variant: baseline-room-model.

- declared-independent-metadata-fields: failed; expected A declared rule permits cosmetic name plus classification edits only when dimensions, placement, support, and dependencies stay unchanged.; observed {"kind":"rejected","error":{"name":"Error","message":"Conflicting changes to chair-one. Revise this proposal against the current model."}}
- divergent-same-property: passed; expected Two divergent names on one object conflict and preserve the accepted value.; observed {"kind":"rejected","error":{"name":"Error","message":"Conflicting changes to chair-one. Revise this proposal against the current model."}}
- units-and-dependent-values: passed; expected Units cannot merge as text; individually valid authored heights must recheck the dependent clearance after combination.; observed {"dependency":{"kind":"rejected","error":{"name":"Error","message":"The combined changes fail model validation: Furniture must fit below the room ceiling.. Revise this proposal against the current model."}},"units":{"kind":"rejected","error":{"name":"Error","message":"Unsupported model snapshot."}}}

Limitations:

- Baseline-only execution of the existing native model. This does not qualify an unimplemented VM-C1 candidate.
- Disposable native baseline only; no external engine, IFC exchange, persistent store, or production adoption is qualified.
- Fixture acceptance actors and worker labels exercise API bookkeeping; they are not human approvals or AI execution evidence.
- General typed metadata properties are not represented by this native schema.
- Only canonical native metres and a ceiling inequality are tested; dictionary units and derived property regeneration are absent.
- Operation fixtures are the existing native single-room and asset fixtures; the W0 multilevel fixture is bound as a reference, not executed through a native adapter.
- Rule is a proposed bounded oracle, not an installed product rule. Baseline conservatively conflicts at entity granularity.
