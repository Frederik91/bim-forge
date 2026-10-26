import path from 'node:path';
import { createDemoServer } from '../server.ts';
import { ChangeRequests } from '../change-requests.ts';
import { RoomRepository } from '../../src/room-model.ts';
import { modelScopeFixture } from '../../src/model-scope-fixture.ts';
import { scopedHouseWorker } from './scoped-house-agent.ts';

// Disposable server-container fixture. Never imports preview credentials or model data.
const file=path.join(process.env.BIM_SCOPE_FIXTURE_STATE??'/tmp','scope-browser.sqlite');
const queue=await ChangeRequests.open(file,()=>null);
const repo=await RoomRepository.createProject({projectId:'17100000-0000-4000-8000-000000000001',name:'Scope qualification house',snapshot:modelScopeFixture()});
if(!queue.hasProject(repo.projectId))await queue.importProject(repo.serialize()); await queue.close();
const server=await createDemoServer({backlogFile:file,modelWorker:scopedHouseWorker});
server.listen(9493,'127.0.0.1',()=>console.log('Disposable scope qualification: http://127.0.0.1:9493'));
