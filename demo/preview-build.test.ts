import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Type } from 'typebox';
import { Check } from 'typebox/value';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

test('the runtime package includes every local server dependency in the image and build context', async () => {
  const root = new URL('../', import.meta.url);
  const dockerfile = await fs.readFile(new URL('deploy/preview/Dockerfile', root), 'utf8');
  const context = (await fs.readFile(new URL('.dockerignore', root), 'utf8')).split(/\r?\n/)
    .filter(line => line.startsWith('!')).map(line => line.slice(1));
  const copied = [...dockerfile.matchAll(/^COPY\s+(?:--\S+\s+)*(.+)\s+\S+\s*$/gm)]
    .flatMap(match => (match[1] ?? '').trim().split(/\s+/));
  const pending = ['demo/server.ts']; const visited = new Set<string>();
  while (pending.length) {
    const name = pending.pop();
    if (!name || visited.has(name)) continue;
    visited.add(name);
    assert.ok(copied.some(entry => name === entry || name.startsWith(entry.replace(/\/$/, '') + '/')), `Image omits server dependency ${name}`);
    assert.ok(context.some(entry => entry === name || entry.endsWith('/**') && name.startsWith(entry.slice(0, -2))), `Build context omits server dependency ${name}`);
    const url = new URL(name, root);
    const source = await fs.readFile(url, 'utf8');
    for (const match of source.matchAll(/\b(?:from\s*|import\s*(?:\(\s*)?)['"](\.[^'"]+\.ts)['"]/g)) {
      const specifier = match[1]; if (!specifier) continue;
      const dependency = path.relative(fileURLToPath(root), fileURLToPath(new URL(specifier, url))).replaceAll('\\', '/');
      assert.ok(!dependency.startsWith('../'), 'Runtime dependencies must stay within the repository.');
      pending.push(dependency);
    }
  }
  assert.ok(visited.has('demo/project-evidence-store.ts'), 'Evidence retention participates in the real server dependency graph.');
});

test('the built preview is one complete hashed release with every referenced browser asset', async () => {
  const root = new URL('../dist/demo/', import.meta.url);
  const value: unknown = JSON.parse(await fs.readFile(new URL('manifest.json', root), 'utf8'));
  const schema = Type.Object({ version: Type.Literal(1), files: Type.Array(Type.Object({
    name: Type.String({ pattern: '^[a-z.-]+$' }), byteLength: Type.Integer({ minimum: 1 }),
    sha256: Type.String({ pattern: '^[a-f0-9]{64}$' }),
  }, { additionalProperties: false }), { minItems: 5, maxItems: 5 }) }, { additionalProperties: false });
  assert.ok(Check(schema, value));
  assert.deepEqual(value.files.map(file => file.name).sort(), ['canvas-studio.css', 'index.html', 'request-chat.css', 'room-app.mjs', 'room.css']);
  for (const file of value.files) {
    const bytes = await fs.readFile(new URL(file.name, root));
    assert.equal(bytes.byteLength, file.byteLength);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256);
  }
  const html = await fs.readFile(new URL('index.html', root), 'utf8');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length, 'Merged panels must not duplicate DOM identities.');
  assert.equal(ids.filter(id => id === 'request-chat-mount').length, 1);
  for (const id of ['workspace-chrome-mount', 'canvas-proposal-tray-mount', 'workspace-explorer-content', 'workspace-tools-content']) {
    assert.equal(ids.filter(value => value === id).length, 1, `${id} has one authoritative mount`);
  }
  const references = [...html.matchAll(/(?:href|src)="\.\/([^"]+)"/g)].map(match => match[1]);
  assert.ok(references.length >= 3);
  assert.ok(references.every(name => value.files.some(file => file.name === name)), 'A page cannot load CSS or JavaScript from another release.');
  for (const name of ['index.html', 'room.css', 'request-chat.css']) {
    assert.deepEqual(await fs.readFile(new URL(name, root)), await fs.readFile(new URL(name, import.meta.url)));
  }
  const studioCss = await fs.readFile(new URL('canvas-studio.css', root), 'utf8');
  assert.ok(studioCss.includes('.canvas-studio'), 'The shipped release contains the Canvas Studio theme.');
  assert.ok(!studioCss.includes('@import "tailwindcss"'), 'The browser receives compiled Tailwind CSS.');
});
