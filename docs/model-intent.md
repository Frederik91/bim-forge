# Scene-grounded interpretation

A reviewable proposal is usually more useful than a clarification when the user can cheaply correct a bounded assumption. The agent interprets the request using the selected identities and the exact scene returned by `model.inspect()`. There is no phrase matcher, preferred cardinal direction, permanent workstation group, or numerical certainty threshold.

## Assumptions belong in the proposal

The agent compares plausible destinations and scopes using geometry, orientation, visual references and declared relationships. It chooses a reasonable interpretation, makes the smallest change that satisfies it, and records its assumptions for human review. Explicit exclusions and marked destinations override inferred defaults.

Moving an object that supports contents normally moves those contents with the same transform. Their identities, support references, orientations and relative placement stay intact. The agent must not ask a question merely because leaving them fixed would invalidate the existing relationship. Nearby loose objects do not become members of an implicit assembly. The agent can infer functional scope when the request and scene support it, but must distinguish that assumption from a declared relationship.

Plural instructions apply to matching objects in the stated scope. Selecting one example does not turn “all desks” into “only this desk.” Each destination is interpreted from that object's context rather than using one wall for the entire project.

The agent still asks a focused question when it cannot form a useful bounded proposal, explicit requirements conflict, necessary facts are unavailable, or the requested work is unsupported. Destructive changes, authority boundaries and safety claims are not resolved by guessing.

## Certainty describes interpreted intent, not correctness

Fresh scripted proposals require this review field:

```typescript
intent: {
	interpretation: 'A concise description of the chosen outcome.',
	assumptions: ['An inferred choice for the reviewer to check.'],
	certainty: 85,
	basis: 'Brief observable evidence and important alternatives.'
}
```

`certainty` is the agent's integer self-rating from 0 to 100. It is not a measured probability, a geometry-validity score, or an approval. The UI labels it **Self-rated, not a calibrated probability** and shows the interpretation, basis and assumptions alongside it. No acceptance or validation path branches on the number. A low score can accompany a valid proposal; a high score cannot make an invalid proposal ready.

The assessment parser accepts only plain data with exact fields. Interpretation is limited to 240 characters, basis to 400 characters, and assumptions to eight entries of 160 characters each. Empty assumptions are allowed when the outcome needs no inferred choices. No default score is fabricated when reading historical saved reviews.

`src/model-intent.ts` owns the shared guidance and parser. The provider instructions and ScriptBox guide use the same policy. `src/model-script.ts` requires the assessment for fresh proposals. Storage preserves its optional historical absence, and the browser renders supplied values as text.

Geometry, hosting, support, room boundaries, revision binding and explicit human acceptance remain separate checks. This change does not add missing shell-topology operations or construction validation.

## Verification

The [validation report](validation/issue-107-model-intent.md) records live model samples, deterministic tests and the server-hosted review UI. Live samples demonstrate observed behavior on their fixtures, not a calibrated reliability rate. The saved samples can be rechecked without a model connection.
