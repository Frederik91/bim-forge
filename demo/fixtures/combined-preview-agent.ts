import { Check } from 'typebox/value';
import { Type } from 'typebox';
import { RoomRepository } from '../../src/room-model.ts';
import { modelScopeFixture } from '../../src/model-scope-fixture.ts';
import type { ModelWorker } from '../../src/model-proposal.ts';
import { conversationWorker } from './conversation-agent.ts';

export function combinedFixtureRepository(projectId = crypto.randomUUID()): Promise<RoomRepository> {
  return RoomRepository.createProject({ projectId, name: 'Combined workspace qualification', snapshot: modelScopeFixture() });
}

/** Declared fixture intentions; actual ScriptBox, persistence and engineering validators. */
export function combinedPreviewWorker(repository: RoomRepository): ModelWorker {
  const original = repository.view(repository.head('main')).snapshot;
  return { identity: { provider: 'integration-fixture', model: 'combined-preview' }, async run(session) {
    const schema = Type.Object({ request: Type.Object({ selectedObjectIds: Type.Array(Type.String()) }) });
    if (!Check(schema, session.input)) throw new Error('Combined fixture requires selected object evidence.');
    if (session.input.request.selectedObjectIds.includes('main-bed')) {
      if (!original.entities.some(entity => entity.id === 'main-bed')) throw new Error('Missing fixture bed.');
      const result = await session.executeTool('run_model_script', { language: 'typescript', source: `
        const view = await model.inspect();
        const bed = view.model.entities.find(entity => entity.id === 'main-bed');
        if (bed?.type !== 'Furniture') throw new Error('Missing selected bed.');
        await model.previewParameters({edits:[{definitionId:'geometry-width',name:'Width',value:{kind:'length',value:bed.width+.2,unit:'m'}}]});
        return {kind:'propose',review:{summary:'Widen the selected bed by 0.2 m.',rationale:'Exercise an independent accepted change.',
          constraints:'Preserve every other entity and its metadata.',uncertainty:'Deterministic qualification fixture.',
          intent:{interpretation:'Widen this bed only.',assumptions:[],certainty:100,basis:'Explicit fixture dimensions.'}}};
      ` });
      if (!result.ok) throw new Error(JSON.stringify(result));
    }
    else await conversationWorker.run(session);
  } };
}
