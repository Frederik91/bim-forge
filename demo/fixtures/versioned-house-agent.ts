import type { ModelWorker } from '../../src/model-proposal.ts';
import type { RoomRepository } from '../../src/room-model.ts';

/** Deterministic test agent; exercises actual ScriptBox and proposal validation. */
export function houseFixtureWorker(repository: RoomRepository, wait: () => Promise<void> = async () => {}): ModelWorker {
  const snapshot = repository.view(repository.head('main')).snapshot;
  return {
    identity: { provider: 'integration-fixture', model: 'deterministic-house-change' },
    async run(session) {
      const input = session.input;
      if (!input || typeof input !== 'object' || !('request' in input) || !input.request || typeof input.request !== 'object'
          || !('selectedObjectIds' in input.request) || !Array.isArray(input.request.selectedObjectIds)) throw new Error('Fixture requires a selected object.');
      const id = input.request.selectedObjectIds[0];
      if (id !== 'office-desk' && id !== 'main-bed') throw new Error('Fixture supports the two declared furnishing changes only.');
      await wait();
      if (session.signal.aborted) return;
      const furnishings = snapshot.entities.filter((entity) => entity.type === 'Furniture')
        .map((entity) => entity.id === id ? { ...entity, width: entity.width + .2 } : entity);
      const result = await session.executeTool('run_model_script', {
        language: 'typescript',
        source: `await model.inspect();
await model.previewFurnishings(${JSON.stringify({ furnishings })});
return {kind:'propose',review:{intent:{interpretation:'Widen the selected furnishing by 0.2 m.',assumptions:[],certainty:100,basis:'Deterministic integration fixture.'},
summary:'Widen the selected furnishing by 0.2 m.',rationale:'Change only the selected furnishing.',constraints:'Retain all other objects and relationships.',uncertainty:'Test fixture, not engineering approval.'}};`,
      });
      if (!result.ok) throw new Error('Fixture proposal was refused by the actual model tool.');
    },
  };
}
