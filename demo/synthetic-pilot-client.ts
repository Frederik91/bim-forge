import { syntheticResidentialFixture } from '../src/synthetic-residential-fixture.ts';
import { evidenceCanonical } from '../src/model-evidence.ts';
import type { EvidenceEntry } from '../src/model-evidence.ts';
import type { RoomRepository } from '../src/room-model.ts';
import type { RequestSource } from '../src/request-sources.ts';
import { ProjectEvidenceClient } from './project-evidence-client.ts';
import { uploadSourceFile } from './request-source-ui.ts';

async function hash(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}
async function sourceId(projectId: string, name: string): Promise<string> {
  const digest = await hash(`synthetic-residential-197\n${projectId}\n${name}`);
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-${digest.slice(12, 16)}-${digest.slice(16, 20)}-${digest.slice(20, 32)}`;
}

/** Explicit generated sample initialization, never evidence extraction from a user's house. */
export async function initializeSyntheticEvidence(repository: RoomRepository, signal: AbortSignal,
  fetcher: typeof fetch = fetch): Promise<void> {
  const fixture = syntheticResidentialFixture();
  const revisionId = repository.root();
  const root = repository.view(revisionId).snapshot;
  if (evidenceCanonical(root) !== evidenceCanonical(fixture.snapshot)) throw new Error('Synthetic evidence can only initialize the generated residential sample.');
  const client = new ProjectEvidenceClient(fetcher);
  const documents = [
    { name: 'synthetic-plan.txt', text: fixture.sources.plan.text },
    { name: 'synthetic-brief.txt', text: fixture.sources.brief.text },
    { name: 'synthetic-measurements.txt', text: 'GENERATED TEST DATA; invented values, not field measurements.\n' + JSON.stringify(fixture.sources.measurements, null, 2) },
  ];
  const sources: RequestSource[] = [];
  for (const document of documents) {
    signal.throwIfAborted();
    const source = await uploadSourceFile({ projectId: repository.projectId,
      id: await sourceId(repository.projectId, document.name), file: new File([document.text], document.name, { type: 'text/plain' }), signal, fetcher });
    sources.push(await client.retain(repository.projectId, source, signal));
  }
  const plan = sources[0]; const measurements = sources[2];
  if (!plan || !measurements) throw new Error('Synthetic source initialization is incomplete. Retry the sample setup.');
  const descriptions = [
    { id: 'synthetic-partition-plan', entityId: 'wall-living-kitchen', definitionId: 'concept-coordinate-x', value: 5, source: plan,
      locator: 'Generated plan: wall-living-kitchen x=5.0; not a survey.' },
    { id: 'synthetic-partition-conflict', entityId: 'wall-living-kitchen', definitionId: 'concept-coordinate-x', value: 5.2, source: measurements,
      locator: 'INTENTIONAL CONTRADICTION: synthetic-measurement-partition-conflict-198, valueM=5.2. Invented test value.' },
    { id: 'synthetic-door-width', entityId: 'door-living-kitchen', definitionId: 'concept-opening-width', value: .9, source: measurements,
      locator: 'synthetic-measurement-door-width-198, valueM=0.9. Generated concept value, not regulatory evidence.' },
  ];
  for (const description of descriptions) {
    signal.throwIfAborted();
    const entity = root.entities.find(item => item.id === description.entityId);
    if (!entity) throw new Error('The generated evidence anchor is missing.');
    const entry: EvidenceEntry = { id: description.id, predecessor: null,
      anchor: { projectId: repository.projectId, revisionId, entityId: entity.id, bodyHash: await hash(evidenceCanonical(entity)), target: { kind: 'main' } },
      property: { definitionId: description.definitionId, valueKind: 'length' },
      assertion: { kind: 'documented', value: { kind: 'length', value: description.value, unit: 'm' },
        citations: [{ sourceId: description.source.id, sha256: description.source.sha256, locator: description.locator }] } };
    await client.append(repository.projectId, `initialize-${description.id}`, entry, signal);
  }
}
