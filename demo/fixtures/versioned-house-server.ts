import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs/promises';
import { createDemoServer } from '../server.ts';
import { createResidentialProject } from '../../src/residential-floor.ts';
import { RoomRepository } from '../../src/room-model.ts';
import { houseFixtureWorker } from './versioned-house-agent.ts';

// Explicit disposable fixture entrypoint, never the preview's normal startup path.
if (process.env.BIM_FORGE_FIXTURE !== 'versioned-house-161') throw new Error('Explicit house fixture opt-in is required.');
const directory = process.env.BIM_FORGE_FIXTURE_DIRECTORY;
if (!directory || !/^\/work\/[A-Za-z0-9/_-]+$/.test(directory)) throw new Error('Fixture data must be inside its disposable /work mount.');
const origin = process.env.BIM_FORGE_FIXTURE_ORIGIN;
if (!origin || !/^https:\/\/192\.168\.1\.17:9491$/.test(origin)) throw new Error('Fixture uses its separate declared HTTPS origin.');
const fixtureUrl = new URL(origin);
await fs.mkdir(directory, { recursive: true });
const seedFile = `${directory}/seed-project.json`;
let repository: RoomRepository;
try { repository = await RoomRepository.restore(await fs.readFile(seedFile, 'utf8')); }
catch (error) {
  if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
  repository = await createResidentialProject('Disposable house integration fixture');
  await fs.writeFile(seedFile, repository.serialize(), { flag: 'wx' });
}
const socketPath = `${directory}/house.sock`;
const server = await createDemoServer({ runtimeMode: 'remote', publicOrigin: origin,
  backlogFile: `${directory}/house.sqlite`, modelWorker: houseFixtureWorker(repository) });
await new Promise<void>((resolve) => server.listen(socketPath, resolve));
const proxy = https.createServer({ key: await fs.readFile(`${directory}/tls/key.pem`), cert: await fs.readFile(`${directory}/tls/cert.pem`) }, (request, response) => {
  const upstream = http.request({ socketPath, path: request.url ?? '/', method: request.method ?? 'GET', headers: request.headers }, (result) => {
    response.writeHead(result.statusCode ?? 502, result.headers); result.pipe(response);
  });
  upstream.on('error', () => { if (!response.headersSent) response.writeHead(502); response.end(); });
  request.once('aborted', () => upstream.destroy()); request.pipe(upstream);
});
await new Promise<void>((resolve) => proxy.listen(9491, '0.0.0.0', resolve));

async function post(target: string, value: unknown): Promise<void> {
  const bytes = JSON.stringify(value);
  await new Promise<void>((resolve, reject) => {
    const request = http.request({ socketPath, path: target, method: 'POST', headers: {
      Host: fixtureUrl.host, Origin: fixtureUrl.origin, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bytes),
    } }, (response) => {
      response.resume(); response.once('end', () => {
        if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) resolve();
        else reject(new Error(`Fixture setup refused ${target}: ${response.statusCode}`));
      });
    });
    request.once('error', reject); request.end(bytes);
  });
}
let seeded = true;
try { await fs.access(`${directory}/seeded`); }
catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') seeded = false; else throw error; }
if (!seeded) {
  await post('/api/projects', { project: repository.serialize() });
  for (const id of ['office-desk', 'main-bed']) {
    await post('/api/change-requests', { project: repository.serialize(), request: {
      requestId: id, proposalName: id, baseRevisionId: repository.head('main'), selectedObjectIds: [id],
      instruction: 'Widen the selected furnishing by 0.2 m.', visualIntent: { kind: 'selection' },
    } });
  }
  await fs.writeFile(`${directory}/seeded`, 'Two deterministic fixture requests acknowledged.\n', { flag: 'wx' });
}
process.stdout.write(`${JSON.stringify({ status: 'fixture-listening', origin, projectId: repository.projectId,
  agent: 'deterministic integration fixture; no ChatGPT account', seeded })}\n`);

let closing = false;
async function close(): Promise<void> {
  if (closing) return; closing = true;
  await new Promise<void>((resolve, reject) => proxy.close((error) => error ? reject(error) : resolve()));
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await server.closeModelWorkers();
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  void close().catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.message : 'Fixture cleanup failed.'}\n`); process.exitCode = 1; });
});
