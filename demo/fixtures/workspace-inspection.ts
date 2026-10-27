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
  const liveTable = input.request.instruction.toLowerCase().includes('live table');
  const source = liveTable ? `
    const inspected = await model.inspect();
    const furnishings = inspected.model.entities.filter(item => item.type === 'Furniture' && item.id === 'level-ground-plant').map(item => {
      if (item.type !== 'Furniture') throw new Error('Furniture required.');
      return {id:item.id,type:item.type,name:item.name,kind:item.kind,position:item.position,width:item.width,depth:item.depth,height:item.height,rotationDeg:item.rotationDeg,supportId:item.supportId};
    });
    await model.previewRoomFurnishings({roomId:'level-ground-west',furnishings:[...furnishings,{id:'live-table',type:'Furniture',name:'Live draft table',kind:'table',position:[2,4],width:0.6,depth:0.6,height:0.6,rotationDeg:0,supportId:null}]});
    return {kind:'propose',review:{summary:'Add the live draft table.',rationale:'Demonstrate a validated addition before the worker finishes.',constraints:'All other rooms and existing items remain unchanged.',uncertainty:'Disposable UI fixture.',intent:{interpretation:'Add one table.',assumptions:[],certainty:100,basis:'Explicit fixture instruction.'}}};
  ` : input.request.instruction.includes('1.2') ? `
    await model.inspect();
    await model.previewParameters({edits:[{definitionId:'geometry-height',name:'Height',value:{kind:'length',value:1.2,unit:'m'}}]});
    return {kind:'propose',review:{summary:'Increase the selected plant height to 1.2 m.',
      rationale:'Use the clarified height and preserve all other model entities.',constraints:'Only the frozen plant target changes.',
      uncertainty:'Deterministic UI fixture; not construction approval.',intent:{interpretation:'Set the plant height to 1.2 m.',
      assumptions:[],certainty:100,basis:'Explicit fixture reply and bounded target.'}}};
  ` : `await model.inspect(); return {kind:'clarify',question:'What height should this plant have?',options:['1.2 m','Keep current height']};`;
  const result = await session.executeTool('run_model_script', { language: 'typescript', source });
  if (!result.ok) throw new Error(`Fixture ScriptBox operation failed: ${typeof result.error === 'string' ? result.error : 'No diagnostic supplied.'}`);
  await setTimeout(liveTable ? 25000 : 2500, undefined, { signal: session.signal });
  if (liveTable && input.request.instruction.toLowerCase().includes('discard')) throw new Error('Fixture provider failure after tentative preview.');
} };
const server = await createDemoServer({ backlogFile: file, modelWorker: worker });
server.listen(19591, '127.0.0.1', () => console.log('Disposable workspace inspection fixture: 19591'));
