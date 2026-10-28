import assert from 'node:assert/strict';
import test from 'node:test';
import type { RequestSource } from '../src/request-sources.ts';
import { ProjectEvidenceClient } from './project-evidence-client.ts';
import { retainSubmittedSources } from './submitted-sources.ts';

const source: RequestSource = { id: '00000000-0000-0000-0000-000000000001', name: 'plan.txt',
  mediaType: 'text/plain', byteLength: 4, sha256: 'a'.repeat(64) };

test('sending attachments retains their exact identity in the bound project through the existing client', async () => {
  const calls: string[] = [];
  const client = new ProjectEvidenceClient(async (input, init) => {
    calls.push(String(input)); assert.equal(init?.method, 'POST');
    return new Response(JSON.stringify({ source }), { status: 200 });
  });
  await retainSubmittedSources({ projectId: 'project-213', sources: [source], client });
  assert.deepEqual(calls, ['/api/projects/project-213/project-sources']);
});

test('a failed retention blocks sending without silently skipping an attachment', async () => {
  let calls = 0;
  const client = new ProjectEvidenceClient(async () => { calls++; return new Response(JSON.stringify({ error: 'Unavailable' }), { status: 503 }); });
  await assert.rejects(retainSubmittedSources({ projectId: 'project-213', sources: [source, { ...source, id: '00000000-0000-0000-0000-000000000002' }], client }));
  assert.equal(calls, 1);
});
