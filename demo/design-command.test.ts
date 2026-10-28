import assert from 'node:assert/strict';
import test from 'node:test';
import { DesignCommands } from './design-command.ts';

test('interrupted alternative creation retries identically but switching baseline or project gets a new identity', () => {
  let sequence = 0; const commands = new DesignCommands(() => String(++sequence));
  const fork = { kind: 'fork', projectId: 'house-a', baselineId: 'as-is-a', name: 'Option 1' } satisfies Parameters<DesignCommands['id']>[0];
  assert.equal(commands.id(fork), '1'); assert.equal(commands.id({ ...fork }), '1');
  assert.equal(commands.id({ ...fork, baselineId: 'as-is-b' }), '2');
  assert.equal(commands.id({ ...fork, projectId: 'house-b' }), '3');
  assert.equal(commands.id({ ...fork, name: 'Option 2' }), '4');
  commands.complete('fork'); assert.equal(commands.id({ ...fork, name: 'Option 2' }), '5');
});

test('capture retry identity includes source design, revision and name', () => {
  let sequence = 0; const commands = new DesignCommands(() => String(++sequence));
  const capture = { kind: 'capture', projectId: 'house-a', target: { kind: 'main' }, revisionId: 'revision-a', name: 'As-is' } satisfies Parameters<DesignCommands['id']>[0];
  assert.equal(commands.id(capture), '1'); assert.equal(commands.id({ ...capture }), '1');
  assert.equal(commands.id({ ...capture, revisionId: 'revision-b' }), '2');
  assert.equal(commands.id({ ...capture, name: 'Measured' }), '3');
  commands.complete('capture'); assert.equal(commands.id(capture), '4');
});
