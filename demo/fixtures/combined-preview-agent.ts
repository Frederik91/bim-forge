import { Check } from 'typebox/value';
import { Type } from 'typebox';
import { RoomRepository } from '../../src/room-model.ts';
import { modelScopeFixture } from '../../src/model-scope-fixture.ts';
import type { ModelWorker } from '../../src/model-proposal.ts';
import { conversationWorker } from './conversation-agent.ts';
import { houseFixtureWorker } from './versioned-house-agent.ts';

export function combinedFixtureRepository(projectId = crypto.randomUUID()): Promise<RoomRepository> {
  return RoomRepository.createProject({ projectId, name: 'Combined workspace qualification', snapshot: modelScopeFixture() });
}

/** Declared fixture intentions; actual ScriptBox, persistence and engineering validators. */
export function combinedPreviewWorker(repository: RoomRepository): ModelWorker {
  const bed = houseFixtureWorker(repository);
  return { identity: { provider: 'integration-fixture', model: 'combined-preview' }, async run(session) {
    const schema = Type.Object({ request: Type.Object({ selectedObjectIds: Type.Array(Type.String()) }) });
    if (!Check(schema, session.input)) throw new Error('Combined fixture requires selected object evidence.');
    if (session.input.request.selectedObjectIds.includes('main-bed')) await bed.run(session);
    else await conversationWorker.run(session);
  } };
}
