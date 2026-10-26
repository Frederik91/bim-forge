import path from 'node:path';
import { createDemoServer } from '../server.ts';
import { ChangeRequests } from '../change-requests.ts';
import { RoomRepository } from '../../src/room-model.ts';
import { modelScopeFixture } from '../../src/model-scope-fixture.ts';
import { conversationWorker } from './conversation-agent.ts';

// Fresh disposable state only. No preview credentials or accepted production model data.
const file = path.join(process.env.BIM_CONVERSATION_FIXTURE_STATE ?? '/tmp', 'conversation-browser.sqlite');
const queue = await ChangeRequests.open(file, () => null);
const repo = await RoomRepository.createProject({ projectId: '18100000-0000-4000-8000-000000000001',
  name: 'Conversation qualification house', snapshot: modelScopeFixture() });
if (!queue.hasProject(repo.projectId)) await queue.importProject(repo.serialize());
await queue.close();
const server = await createDemoServer({ backlogFile: file, modelWorker: conversationWorker });
server.listen(9496, '127.0.0.1', () => console.log('Disposable conversation qualification: http://127.0.0.1:9496'));
