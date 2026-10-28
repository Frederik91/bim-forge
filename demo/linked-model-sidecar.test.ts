import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { LinkedModelStore } from './linked-model-store.ts';

test('network-isolated external sidecar converts using only private spool; original survives application recovery', async t => {
  const root = process.env.IFC_PRIVATE_ROOT; const spool = process.env.IFC_EXTERNAL_SPOOL; const fixture = process.env.IFC_FIXTURE;
  if (!root || !spool || !fixture) throw new Error('Run in the paired app/converter containers with private root, shared spool and generated fixture.');
  const bytes = fs.readFileSync(fixture); const project = randomUUID();
  const store = LinkedModelStore.open({ root, spool }); t.after(() => store.close());
  const link = store.attach({ projectId: project, name: 'isolated-sidecar.ifc', bytes });
  let ready = false;
  for (let i = 0; i < 300; i++) {
    const state = store.get(project, link.id);
    if (state.kind === 'failed') assert.fail(state.error);
    if (state.kind === 'ready') { ready = true; break; }
    await delay(100);
  }
  assert.equal(ready, true); assert.equal(store.prepared(project, link.id).geometry.meshes.length, 4);
  store.close(); const recovered = LinkedModelStore.open({ root, spool }); t.after(() => recovered.close());
  assert.equal(recovered.get(project, link.id).kind, 'ready'); assert.deepEqual(recovered.original(project, link.id), bytes);
  assert.equal(recovered.prepared(project, link.id).manifest.readOnly, true);
});
