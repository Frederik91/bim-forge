import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { CodexAccountConnection } from '../src/codex-app-server.ts';
import { ChangeRequests } from '../demo/change-requests.ts';
import { RoomRepository, validateSnapshot } from '../src/room-model.ts';
import { floorBounds, doorConnections } from '../src/floor-plan.ts';
import { sourceFloorImage, sourceFloorPdf } from './fixtures/source-floor.ts';
import type { SourceMediaType } from '../src/request-sources.ts';

// Explicit manual evaluation: requires the existing server-side ChatGPT sign-in.
// Only synthetic projects and a separate backlog database are used.
const output = process.env.BIM_SOURCE_EVIDENCE;
if (!output || !path.isAbsolute(output)) throw new Error('Set BIM_SOURCE_EVIDENCE to a private absolute evaluation directory.');
await mkdir(output, { recursive: true });
const codex = await CodexAccountConnection.open();
if (!codex.publicSession().connected) { codex.close(); throw new Error('The server ChatGPT session must be connected for this manual evaluation.'); }
const queue = await ChangeRequests.open(path.join(output, `evaluation-${randomUUID()}.sqlite`), () => codex.modelWorker());
const outcomes = [];
try {
  const files: { name: string; mediaType: SourceMediaType; bytes: Buffer }[] = [
    { name: 'synthetic-floor.png', mediaType: 'image/png', bytes: await sourceFloorImage() },
    { name: 'synthetic-floor.pdf', mediaType: 'application/pdf', bytes: sourceFloorPdf() },
  ];
  for (const file of files) {
    const repository = await RoomRepository.create('Synthetic source reconstruction');
    const source = await queue.addSource({ ...file, projectId: repository.projectId, id: randomUUID(), signal: new AbortController().signal });
    const requestId = randomUUID();
    const ticket = await queue.submit(repository.serialize(), { requestId, baseRevisionId: repository.head('main'), selectedObjectIds: ['wall-north'],
      instruction: 'Draw the floor plan from the attached reference. Use its dimension labels and opening locations. Explain scale assumptions and any omitted details in the proposal.',
      visualIntent: { kind: 'selection' }, sources: [source], authoringScope: 'floor-plan-reconstruction' });
    const deadline = Date.now() + 180000;
    while (['queued', 'working'].includes(queue.get(ticket.id).state) && Date.now() < deadline) await new Promise<void>(resolve => setTimeout(resolve, 250));
    const result = queue.get(ticket.id);
    await writeFile(path.join(output, `${file.name}.activity.json`), JSON.stringify({ state: result.state, error: result.error, activity: result.activity }, null, 2));
    assert.equal(result.state, 'ready', result.error ?? JSON.stringify(result.result?.review)); assert.ok(result.result);
    const proposed = await RoomRepository.restore(result.result.project);
    const snapshot = validateSnapshot(proposed.view(proposed.head(result.request.proposalName)).snapshot);
    assert.equal(snapshot.entities.filter(item => item.type === 'Space').length, 2);
    const bounds = floorBounds(snapshot);
    assert.equal(bounds.maxX - bounds.minX, 6); assert.equal(bounds.maxY - bounds.minY, 4);
    assert.equal(snapshot.entities.filter(item => item.type === 'Wall').length, 5);
    assert.equal(doorConnections(snapshot).length, 2);
    assert.equal(doorConnections(snapshot).filter(item => !item.exterior).length, 1);
    assert.equal(proposed.head('main'), repository.head('main'));
    assert.equal(queue.project(repository.projectId), repository.serialize());
    assert.deepEqual(proposed.review(result.request.proposalName).sources, [source]);
    await writeFile(path.join(output, file.name), file.bytes);
    await writeFile(path.join(output, `${file.name}.project.json`), proposed.serialize());
    outcomes.push({ format: file.mediaType, status: 'ready', sourceSha256: source.sha256, review: result.result.review });
  }
  await writeFile(path.join(output, 'results.json'), JSON.stringify(outcomes, null, 2));
  process.stdout.write(JSON.stringify({ passed: outcomes.length, directory: output }) + '\n');
} finally { await queue.close(); codex.close(); }
