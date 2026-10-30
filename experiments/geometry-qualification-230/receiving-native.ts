import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { RoomRepository, validateSnapshot } from '../../src/room-model.ts';

// Broad ordinary receiving context, not a placement answer. It deliberately contains
// no candidate object, dimensions, normals, query results, private oracle facts or IFC.
// The separate source keeps all its real nested placements and rotated geometry.
export function receivingSnapshot() {
  return validateSnapshot({ version: 2, units: 'm', entities: [
    { id: 'receiving-level', type: 'Level', name: 'Receiving floor', elevation: 3.5 },
    { id: 'receiving-hall', type: 'Space', name: 'Receiving hall', levelId: 'receiving-level',
      bounds: { minX: 0, minY: 0, maxX: 50, maxY: 50 } },
    { id: 'service-room', type: 'Space', name: 'Service room', levelId: 'receiving-level',
      bounds: { minX: 0, minY: 50, maxX: 50, maxY: 55 } },
    { id: 'receiving-south', type: 'Wall', name: 'South enclosure', levelId: 'receiving-level', start: [0, 0], end: [50, 0], thickness: .2, height: 4 },
    { id: 'receiving-north', type: 'Wall', name: 'North enclosure', levelId: 'receiving-level', start: [0, 55], end: [50, 55], thickness: .2, height: 4 },
    { id: 'receiving-west', type: 'Wall', name: 'West enclosure', levelId: 'receiving-level', start: [0, 0], end: [0, 55], thickness: .2, height: 4 },
    { id: 'receiving-east', type: 'Wall', name: 'East enclosure', levelId: 'receiving-level', start: [50, 0], end: [50, 55], thickness: .2, height: 4 },
    { id: 'service-partition', type: 'Wall', name: 'Service partition', levelId: 'receiving-level', start: [0, 50], end: [50, 50], thickness: .2, height: 4 },
    { id: 'receiving-entry', type: 'Door', name: 'Receiving entrance', width: 1.2, height: 2.2 },
    { id: 'service-entry', type: 'Door', name: 'Service entrance', width: 1, height: 2.2 },
    { id: 'receiving-slab', type: 'Slab', name: 'Receiving floor slab', levelId: 'receiving-level',
      bounds: { minX: 0, minY: 0, maxX: 50, maxY: 55 }, thickness: .25 },
    // Elevated exterior doors do not establish ground exits. Provide a real
    // connected ground floor/stair while retaining the receiving floor at 3.5m.
    { id: 'ground-level', type: 'Level', name: 'Ground access floor', elevation: 0 },
    { id: 'ground-hall', type: 'Space', name: 'Ground access hall', levelId: 'ground-level',
      bounds: { minX: 0, minY: 0, maxX: 50, maxY: 50 } },
    { id: 'ground-service', type: 'Space', name: 'Ground service room', levelId: 'ground-level',
      bounds: { minX: 0, minY: 50, maxX: 50, maxY: 55 } },
    { id: 'ground-south', type: 'Wall', name: 'Ground south enclosure', levelId: 'ground-level', start: [0, 0], end: [50, 0], thickness: .2, height: 3 },
    { id: 'ground-north', type: 'Wall', name: 'Ground north enclosure', levelId: 'ground-level', start: [0, 55], end: [50, 55], thickness: .2, height: 3 },
    { id: 'ground-west', type: 'Wall', name: 'Ground west enclosure', levelId: 'ground-level', start: [0, 0], end: [0, 55], thickness: .2, height: 3 },
    { id: 'ground-east', type: 'Wall', name: 'Ground east enclosure', levelId: 'ground-level', start: [50, 0], end: [50, 55], thickness: .2, height: 3 },
    { id: 'ground-partition', type: 'Wall', name: 'Ground service partition', levelId: 'ground-level', start: [0, 50], end: [50, 50], thickness: .2, height: 3 },
    { id: 'ground-entry', type: 'Door', name: 'Ground exterior entrance', width: 1.2, height: 2.2 },
    { id: 'ground-service-entry', type: 'Door', name: 'Ground service entrance', width: 1, height: 2.2 },
    { id: 'ground-slab', type: 'Slab', name: 'Ground access slab', levelId: 'ground-level',
      bounds: { minX: 0, minY: 0, maxX: 50, maxY: 55 }, thickness: .25 },
    { id: 'receiving-stair', type: 'Stair', name: 'Receiving floor access stair', fromLevelId: 'ground-level', toLevelId: 'receiving-level',
      start: [40, 36], end: [40, 42], width: 1.2, steps: 20 },
  ], relationships: [
    { id: 'host-receiving-entry', type: 'hosted-by', source: 'receiving-entry', target: 'receiving-south', offset: 2 },
    { id: 'host-service-entry', type: 'hosted-by', source: 'service-entry', target: 'service-partition', offset: 2 },
    { id: 'host-ground-entry', type: 'hosted-by', source: 'ground-entry', target: 'ground-south', offset: 2 },
    { id: 'host-ground-service-entry', type: 'hosted-by', source: 'ground-service-entry', target: 'ground-partition', offset: 2 },
  ] });
}

export async function receivingProject(projectId = '00000234-0000-4000-8000-000000000234') {
  return RoomRepository.createProject({ projectId, name: 'Invented IFC receiving context 234', snapshot: receivingSnapshot() });
}

async function main(): Promise<void> {
  assert.equal(process.env.QUAL_SERVER_CONTAINER, 'issue234', 'Generate only in the reserved server container.');
  await fs.stat('/.dockerenv');
  const directory = process.env.QUAL_ARTIFACTS;
  assert.ok(directory && path.resolve(directory).startsWith('/ssd1/'));
  const source = process.env.QUAL_SOURCE_SHA;
  assert.ok(source && /^[a-f0-9]{40}$/.test(source));
  const project = await receivingProject(process.env.QUAL_PROJECT_ID);
  const serialized = project.serialize();
  const restored = await RoomRepository.restore(serialized);
  assert.equal(restored.serialize(), serialized);
  const filename = path.join(directory, 'receiving-project.json');
  await fs.writeFile(filename, serialized, { flag: 'wx' });
  await fs.writeFile(path.join(directory, 'receiving-native-receipt.json'), JSON.stringify({
    source, projectId: project.projectId, revision: project.head('main'),
    sha256: createHash('sha256').update(serialized).digest('hex'),
    snapshotValidated: true, portableRoundtrip: true, generatedAssets: 0,
    scope: 'Synthetic broad receiving context only; no baseline, alternative, candidate or acceptance yet',
    importPath: '#import-file', qualification: 'Native generation/restore only; UI import and live placement are separate pending checks',
  }, null, 2) + '\n', { flag: 'wx' });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
