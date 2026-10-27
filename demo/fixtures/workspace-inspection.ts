import fs from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';
import { createDemoServer } from '../server.ts';
import { ChangeRequests } from '../change-requests.ts';
import { RoomRepository } from '../../src/room-model.ts';
import { multiStoreySnapshot } from '../../src/multi-storey-house.ts';
import type { ModelWorker } from '../../src/model-proposal.ts';

if (process.env.BIM_FORGE_WORKSPACE_FIXTURE !== '191') throw new Error('Explicit workspace fixture opt-in required.');
const directory = '/work/workspace-191';
await fs.mkdir(directory, { recursive: true });
let repository: RoomRepository;
try { repository = await RoomRepository.restore(await fs.readFile(directory + '/seed.json', 'utf8')); }
catch (error) {
  if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
  repository = await RoomRepository.createProject({ projectId: '19100000-0000-4000-8000-000000000001', name: 'Workspace inspection house', snapshot: multiStoreySnapshot() });
  await fs.writeFile(directory + '/seed.json', repository.serialize(), { flag: 'wx' });
}
const file = directory + '/queue.sqlite';
const queue = await ChangeRequests.open(file, () => null);
if (!queue.hasProject(repository.projectId)) await queue.importProject(repository.serialize());
await queue.close();
const worker: ModelWorker = { identity: { provider: 'integration-fixture', model: 'workspace-inspection' }, async run(session) {
  const input = session.input;
  if (!input || typeof input !== 'object' || !('request' in input) || !input.request || typeof input.request !== 'object'
    || !('instruction' in input.request) || typeof input.request.instruction !== 'string') throw new Error('Fixture request missing.');
  await setTimeout(2500, undefined, { signal: session.signal });
  const source = input.request.instruction.includes('1.2') ? `
    await model.inspect();
    await model.previewParameters({edits:[{definitionId:'geometry-height',name:'Height',value:{kind:'length',value:1.2,unit:'m'}}]});
    return {kind:'propose',review:{summary:'Increase the selected plant height to 1.2 m.',
      rationale:'Use the clarified height and preserve all other model entities.',constraints:'Only the frozen plant target changes.',
      uncertainty:'Deterministic UI fixture; not construction approval.',intent:{interpretation:'Set the plant height to 1.2 m.',
      assumptions:[],certainty:100,basis:'Explicit fixture reply and bounded target.'}}};
  ` : `await model.inspect(); return {kind:'clarify',question:'What height should this plant have?',options:['1.2 m','Keep current height']};`;
  const result = await session.executeTool('run_model_script', { language: 'typescript', source });
  if (!result.ok) throw new Error('Fixture ScriptBox operation failed.');
  await setTimeout(2500, undefined, { signal: session.signal });
} };
const server = await createDemoServer({ backlogFile: file, modelWorker: worker });
server.listen(19591, '127.0.0.1', () => console.log('Disposable workspace inspection fixture: 19591'));
