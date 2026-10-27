import { Type } from 'typebox';
import type { Static, TSchema } from 'typebox';
import { Check } from 'typebox/value';
export { ObservationSchema, parseObservations } from '../contracts/schema.ts';
export type { Observation } from '../contracts/schema.ts';

const text = Type.String({ minLength: 1, maxLength: 256 });
export const Sha256Schema = Type.String({ pattern: '^[a-f0-9]{64}$' });
const object = <T extends Record<string, TSchema>>(properties: T) => Type.Object(properties, { additionalProperties: false });
const pin = object({ version: text, sha256: Sha256Schema });
export const InterpretationSchema = object({ schema: pin, dictionary: pin, canonicalization: pin, kernel: pin });
export const ArtifactSchema = object({ sha256: Sha256Schema, byteLength: Type.Integer({ minimum: 0, maximum: 64 * 1024 * 1024 }),
  mediaType: text, role: Type.Union([
    Type.Literal('model'), Type.Literal('linked-model'), Type.Literal('review'), Type.Literal('validation'),
    Type.Literal('schema'), Type.Literal('dictionary'), Type.Literal('canonicalization'), Type.Literal('kernel'),
  ]),
});
export const RevisionSchema = object({ revisionId: text, parents: Type.Array(text, { maxItems: 8, uniqueItems: true }),
  modelSha256: Sha256Schema, requiredArtifacts: Type.Array(Sha256Schema, { minItems: 1, maxItems: 10000, uniqueItems: true }),
  interpretation: InterpretationSchema,
});
export const PackageSchema = object({ format: Type.Literal('bim-forge-w6-package-v1'), projectId: text,
  artifacts: Type.Array(ArtifactSchema, { minItems: 1, maxItems: 10000 }),
  revisions: Type.Array(RevisionSchema, { minItems: 1, maxItems: 10000 }),
  branches: Type.Array(object({ name: text, revisionId: text }), { minItems: 1, maxItems: 1000 }),
});
export const PointerSchema = object({ manifestSha256: Sha256Schema });
export const RunnerInputSchema = object({ sourcePackage: text, upgradedPackage: text, outputRoot: text,
  runId: Type.String({ pattern: '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$' }),
});
export type PackageManifest = Static<typeof PackageSchema>;
export type Revision = Static<typeof RevisionSchema>;
export type RunnerInput = Static<typeof RunnerInputSchema>;

export function parseManifest(input: unknown): PackageManifest {
  if (!Check(PackageSchema, input)) throw new Error('Invalid W6 portable package manifest.');
  const artifactIds = new Set(input.artifacts.map((artifact) => artifact.sha256));
  const revisionIds = new Set(input.revisions.map((revision) => revision.revisionId));
  if (artifactIds.size !== input.artifacts.length || revisionIds.size !== input.revisions.length
      || new Set(input.branches.map((branch) => branch.name)).size !== input.branches.length) {
    throw new Error('Duplicate artifact, revision, or branch identity.');
  }
  const visited = new Set<string>();
  // Packages are a closed ancestry set in topological order, including the roots.
  for (const revision of input.revisions) {
    if (!revision.parents.every((parent) => visited.has(parent))) throw new Error('Missing, cyclic, or unordered ancestry.');
    const required = new Set(revision.requiredArtifacts);
    if (!required.has(revision.modelSha256) || !revision.requiredArtifacts.every((hash) => artifactIds.has(hash))) {
      throw new Error('Revision references an absent artifact.');
    }
    if (!input.artifacts.some((artifact) => artifact.sha256 === revision.modelSha256 && artifact.role === 'model')) {
      throw new Error('Revision model hash must identify a model artifact.');
    }
    for (const role of ['schema', 'dictionary', 'canonicalization', 'kernel'] satisfies (keyof Revision['interpretation'])[]) {
      const pinned = revision.interpretation[role];
      if (!required.has(pinned.sha256)
          || !input.artifacts.some((artifact) => artifact.sha256 === pinned.sha256 && artifact.role === role)) {
        throw new Error(`Revision is missing its pinned ${role} artifact.`);
      }
    }
    visited.add(revision.revisionId);
  }
  if (!input.branches.every((branch) => revisionIds.has(branch.revisionId))) throw new Error('Branch head is absent.');
  return input;
}

export function parseRunnerInput(input: unknown): RunnerInput {
  if (!Check(RunnerInputSchema, input)) throw new Error('Invalid W6 runner input.');
  return input;
}
