import fs from 'node:fs/promises';
import { createDemoServer } from '../server.ts';
import { ChangeRequests } from '../change-requests.ts';
import { RoomRepository } from '../../src/room-model.ts';
import { combinedFixtureRepository, combinedPreviewWorker } from './combined-preview-agent.ts';

if (process.env.BIM_FORGE_COMBINED_FIXTURE !== '185') throw new Error('Explicit combined fixture opt-in required.');
const directory = process.env.BIM_FORGE_FIXTURE_DIRECTORY;
if (!directory || !/^\/work\/[A-Za-z0-9/_-]+$/.test(directory)) throw new Error('Fixture state must be in its private /work mount.');
await fs.mkdir(directory, { recursive: true });
const seed = directory + '/seed.json';
let repository: RoomRepository;
try { repository = await RoomRepository.restore(await fs.readFile(seed, 'utf8')); }
catch (error) {
  if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
  repository = await combinedFixtureRepository('18500000-0000-4000-8000-000000000001');
  await fs.writeFile(seed, repository.serialize(), { flag: 'wx' });
}
const file = directory + '/combined.sqlite';
const queue = await ChangeRequests.open(file, () => null);
if (!queue.hasProject(repository.projectId)) await queue.importProject(repository.serialize());
await queue.close();
const server = await createDemoServer({ backlogFile: file, modelWorker: combinedPreviewWorker(repository) });
server.listen(19585, '127.0.0.1', () => console.log('Disposable combined workspace: http://127.0.0.1:19585'));
