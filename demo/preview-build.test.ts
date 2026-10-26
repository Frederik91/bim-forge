import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Type } from 'typebox';
import { Check } from 'typebox/value';

test('the built preview is one complete hashed release with every referenced browser asset', async () => {
  const root = new URL('../dist/demo/', import.meta.url);
  const value: unknown = JSON.parse(await fs.readFile(new URL('manifest.json', root), 'utf8'));
  const schema = Type.Object({ version: Type.Literal(1), files: Type.Array(Type.Object({
    name: Type.String({ pattern: '^[a-z.-]+$' }), byteLength: Type.Integer({ minimum: 1 }),
    sha256: Type.String({ pattern: '^[a-f0-9]{64}$' }),
  }, { additionalProperties: false }), { minItems: 4, maxItems: 4 }) }, { additionalProperties: false });
  assert.ok(Check(schema, value));
  assert.deepEqual(value.files.map(file => file.name).sort(), ['index.html', 'request-chat.css', 'room-app.mjs', 'room.css']);
  for (const file of value.files) {
    const bytes = await fs.readFile(new URL(file.name, root));
    assert.equal(bytes.byteLength, file.byteLength);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256);
  }
  const html = await fs.readFile(new URL('index.html', root), 'utf8');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length, 'Merged panels must not duplicate DOM identities.');
  assert.equal(ids.filter(id => id === 'request-chat-mount').length, 1);
  const references = [...html.matchAll(/(?:href|src)="\.\/([^"]+)"/g)].map(match => match[1]);
  assert.ok(references.length >= 3);
  assert.ok(references.every(name => value.files.some(file => file.name === name)), 'A page cannot load CSS or JavaScript from another release.');
  for (const name of ['index.html', 'room.css', 'request-chat.css']) {
    assert.deepEqual(await fs.readFile(new URL(name, root)), await fs.readFile(new URL(name, import.meta.url)));
  }
});
