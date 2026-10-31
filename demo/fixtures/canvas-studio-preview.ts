import path from 'node:path';
import { createDemoServer } from '../server.ts';
import { ChangeRequests } from '../change-requests.ts';
import { RoomRepository } from '../../src/room-model.ts';
import { modelScopeFixture } from '../../src/model-scope-fixture.ts';
import { conversationWorker } from './conversation-agent.ts';

const directory = process.env.BIM_CANVAS_FIXTURE_STATE;
if (!directory) throw new Error('Set BIM_CANVAS_FIXTURE_STATE to a disposable directory.');
const file = path.join(directory, 'canvas-studio.sqlite');
const queue = await ChangeRequests.open(file, () => null);
const repo = await RoomRepository.createProject({ projectId: '24100000-0000-4000-8000-000000000001',
  name: 'Canvas Studio · disposable review', snapshot: modelScopeFixture() });
if (!queue.hasProject(repo.projectId)) await queue.importProject(repo.serialize());
await queue.close();
const server = await createDemoServer({ backlogFile: file, modelWorker: conversationWorker });
server.listen(9497, '127.0.0.1', () => console.log('Canvas Studio disposable fixture: http://127.0.0.1:9497'));
