import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ChangeRequests } from './change-requests.ts';
import { RoomRepository } from '../src/room-model.ts';
import { syntheticResidentialFixture } from '../src/synthetic-residential-fixture.ts';
import type { ModelWorker } from '../src/model-proposal.ts';
import { evidenceAnchor } from './project-evidence-store.ts';
import { parseEvidenceReadSet } from '../src/model-evidence.ts';
import type { EvidenceEntry, EvidencePin } from '../src/model-evidence.ts';

const wallWorker: ModelWorker = {
  identity: { provider: 'test', model: 'design-wall-fixture' },
  async run(session) {
    session.recordProviderEvent({ responseId: 'synthetic-wall-response', inputTokens: 50, outputTokens: 50, totalTokens: 100 });
    const result = await session.executeTool('run_model_script', { language: 'typescript', source: `
      await model.previewWallShift({ wallId: 'wall-living-kitchen', offsetMetres: .2 });
      return { kind: 'propose', review: {
        summary: 'Move the partition 200 mm east.', rationale: 'Widen the living room in this alternative.',
        constraints: 'Keep the baseline and unrelated contents unchanged.', uncertainty: 'Synthetic concept geometry.',
        intent: { interpretation: 'Move the shared partition east.', assumptions: [], certainty: .95, basis: ['Explicit fixture instruction.'] }
      }};
    ` });
    assert.equal(result.ok, true, JSON.stringify(result));
  },
};
async function initial() {
  const fixture = syntheticResidentialFixture();
  return RoomRepository.createProject({ projectId: fixture.projectId, name: 'Synthetic design workflow', snapshot: fixture.snapshot });
}
async function ready(queue: ChangeRequests, id: string) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const ticket = queue.get(id);
    if (ticket.state === 'ready') return ticket;
    assert.ok(ticket.state === 'queued' || ticket.state === 'working', JSON.stringify(ticket));
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('The design proposal did not become reviewable.');
}

test('baseline and alternative commands replay after later metadata and survive restart without changing main', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bim-design-command-'));
  const file = path.join(directory, 'queue.sqlite');
  let queue = await ChangeRequests.open(file, () => null);
  t.after(async () => { await queue.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const original = await initial(); await queue.importProject(original.serialize());
  const command = { commandId: 'capture-as-is', name: 'As-is', from: original.freezeDesignTarget({ kind: 'main' }) };
  const captured = await queue.designCommand(original.projectId, 'baseline', command);
  assert.equal(captured.created.kind, 'baseline');
  if (captured.created.kind !== 'baseline') throw new Error('Expected a baseline.');
  const fork = { commandId: 'fork-kitchen', baselineId: captured.created.id, name: 'Wider kitchen' };
  const alternative = await queue.designCommand(original.projectId, 'alternative', fork);
  const replay = await queue.designCommand(original.projectId, 'baseline', command);
  assert.deepEqual(replay.created, captured.created);
  assert.equal(replay.project, alternative.project);
  await assert.rejects(queue.designCommand(original.projectId, 'baseline', { ...command, name: 'Different payload' }), /different inputs/);
  const restored = await RoomRepository.restore(replay.project);
  assert.equal(restored.head('main'), original.head('main'));
  assert.deepEqual(restored.designView(captured.created).snapshot, original.view(original.head('main')).snapshot);
  await queue.close(); queue = await ChangeRequests.open(file, () => null);
  const resumed = await queue.designCommand(original.projectId, 'alternative', fork);
  assert.deepEqual(resumed.created, alternative.created);
  assert.equal((await RoomRepository.restore(resumed.project)).designTargets().length, 3);
});

test('a queued wall request accepts only into its frozen alternative and retains native decisions after restart', { timeout: 60_000 }, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bim-design-accept-'));
  const file = path.join(directory, 'queue.sqlite');
  let queue = await ChangeRequests.open(file, () => wallWorker);
  t.after(async () => { await queue.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const original = await initial(); await queue.importProject(original.serialize());
  const captured = await queue.designCommand(original.projectId, 'baseline', {
    commandId: 'baseline-wall', name: 'As-is', from: original.freezeDesignTarget({ kind: 'main' }),
  });
  if (captured.created.kind !== 'baseline') throw new Error('Expected a baseline.');
  const fork = await queue.designCommand(original.projectId, 'alternative', { commandId: 'alternative-wall', name: 'Wider kitchen', baselineId: captured.created.id });
  if (fork.created.kind !== 'alternative') throw new Error('Expected an alternative.');
  const repository = await RoomRepository.restore(fork.project);
  const target = repository.freezeDesignTarget(fork.created);
  const request = { requestId: 'alternative-wall-request', proposalName: 'alternative-wall-proposal', target,
    baseRevisionId: target.revisionId, selectedObjectIds: ['wall-living-kitchen'], instruction: 'Move the living/kitchen partition 200 mm east.', visualIntent: { kind: 'selection' } };
  const submitted = await queue.submit(repository.serialize(), request);
  await ready(queue, submitted.id);
  const result = await queue.decide(submitted.id, { action: 'accept', decisionId: 'accept-alternative-wall', expectedRequestId: request.requestId });
  const accepted = await RoomRepository.restore(result.project);
  assert.equal(accepted.head('main'), original.head('main'));
  assert.deepEqual(accepted.designView(captured.created).snapshot, original.view(original.head('main')).snapshot);
  const wall = accepted.designView(fork.created).snapshot.entities.find(item => item.id === 'wall-living-kitchen');
  assert.ok(wall?.type === 'Wall'); assert.equal(wall.start[0], 5.2);
  assert.equal(accepted.review(request.proposalName).decision.status, 'accepted');
  await queue.close(); queue = await ChangeRequests.open(file, () => wallWorker);
  assert.equal(queue.get(submitted.id).state, 'completed');
  const saved = queue.project(original.projectId); assert.ok(saved);
  assert.equal((await RoomRepository.restore(saved)).designView(fork.created).revisionId, accepted.designView(fork.created).revisionId);
});

async function claims(queue: ChangeRequests, repository: RoomRepository) {
  const source = await queue.addSource({ projectId: repository.projectId, id: randomUUID(), name: 'synthetic-plan.txt',
    mediaType: 'text/plain', bytes: Buffer.from(syntheticResidentialFixture().sources.plan.text), signal: new AbortController().signal });
  queue.retainProjectSource(repository.projectId, source);
  const entry = (id: string, value: number, entityId = 'wall-living-kitchen'): EvidenceEntry => ({ id,
    anchor: evidenceAnchor(repository, repository.head('main'), entityId),
    property: { definitionId: 'concept-dimension', valueKind: 'length' }, predecessor: null,
    assertion: { kind: 'documented', value: { kind: 'length', value, unit: 'm' },
      citations: [{ sourceId: source.id, sha256: source.sha256, locator: 'Generated test value; not a survey.' }] } });
  const append = (entry: EvidenceEntry) => queue.recordEvidence(repository.projectId, { commandId: `record-${entry.id}`, entry });
  return { source, entry, append };
}

const evidenceWorker: ModelWorker = {
  identity: { provider: 'test', model: 'evidence-wall-fixture' },
  async run(session) {
    assert.ok(session.input && typeof session.input === 'object' && 'sourceEvidence' in session.input);
    const context = session.input.sourceEvidence;
    assert.ok(context && typeof context === 'object' && 'readSet' in context && 'entries' in context);
    const readSet = parseEvidenceReadSet(context.readSet);
    const subject = readSet.subjects[0]?.subject; const pin = readSet.pins[0];
    assert.ok(subject && pin);
    const uses = [{ pin, subject, rationale: 'Use the generated plan claim for this design only; retain the conflicting claim for human review.' }];
    session.recordProviderEvent({ responseId: `evidence-${readSet.pins[0]?.entryId}`, inputTokens: 50, outputTokens: 50, totalTokens: 100 });
    const result = await session.executeTool('run_model_script', { language: 'typescript', source: `
      await model.previewWallShift({wallId:'wall-living-kitchen',offsetMetres:.2});
      return {kind:'propose',review:{summary:'Shift the shared wall 200 mm.',rationale:'Use the chosen plan claim as a reviewed design assumption.',
        constraints:'Preserve other designs and source history.',uncertainty:'Generated contradictory evidence; not a survey.',
        evidenceUses:${JSON.stringify(uses)},intent:{interpretation:'Explore a partition shift.',assumptions:['Use the generated plan claim.'],certainty:.9,basis:['Selected source evidence.']}}};
    ` });
    assert.equal(result.ok, true, JSON.stringify(result));
  },
};

test('retained evidence, conflicting claims and a reviewed assumption survive alternative acceptance and restart', { timeout: 60_000 }, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bim-evidence-design-'));
  const file = path.join(directory, 'queue.sqlite');
  let queue = await ChangeRequests.open(file, () => evidenceWorker);
  t.after(async () => { await queue.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const original = await initial(); await queue.importProject(original.serialize());
  const evidence = await claims(queue, original);
  const plan = await evidence.append(evidence.entry('generated-plan-claim', 5));
  const competing = await evidence.append(evidence.entry('generated-competing-claim', 5.2));
  const baseline = await queue.designCommand(original.projectId, 'baseline', { commandId: 'evidence-baseline', name: 'As-is', from: original.freezeDesignTarget({ kind: 'main' }) });
  if (baseline.created.kind !== 'baseline') throw new Error('Expected a baseline.');
  const fork = await queue.designCommand(original.projectId, 'alternative', { commandId: 'evidence-alternative', name: 'Partition study', baselineId: baseline.created.id });
  if (fork.created.kind !== 'alternative') throw new Error('Expected an alternative.');
  const repository = await RoomRepository.restore(fork.project); const target = repository.freezeDesignTarget(fork.created);
  const input = { requestId: 'evidence-wall-request', target, baseRevisionId: target.revisionId,
    selectedObjectIds: ['wall-living-kitchen'], instruction: 'Explore moving this wall 200 mm east using the plan claim; keep the contradictory claim visible.',
    visualIntent: { kind: 'selection' }, evidencePins: [plan, competing] };
  const submitted = await queue.submit(repository.serialize(), input);
  const proposal = await ready(queue, submitted.id);
  assert.deepEqual(proposal.evidence?.target, target.target);
  const accepted = await queue.decide(submitted.id, { action: 'accept', decisionId: 'accept-evidence-study', expectedRequestId: input.requestId });
  const saved = await RoomRepository.restore(accepted.project);
  assert.equal(saved.head('main'), original.head('main'));
  assert.deepEqual(saved.designView(baseline.created).snapshot, original.view(original.root()).snapshot);
  assert.equal(saved.review(submitted.request.proposalName).evidenceUses?.[0]?.pin.entryId, plan.entryId);
  assert.equal(queue.listEvidence(original.projectId, null).entries.length, 2);
  assert.ok(!accepted.project.includes(syntheticResidentialFixture().sources.plan.text));
  await queue.close(); queue = await ChangeRequests.open(file, () => null);
  assert.equal(queue.get(submitted.id).state, 'completed');
  assert.equal(queue.listProjectSources(original.projectId, null).sources[0]?.sha256, evidence.source.sha256);
  assert.deepEqual(queue.source(original.projectId, evidence.source.id).bytes, Buffer.from(syntheticResidentialFixture().sources.plan.text));
});

test('unrelated claims preserve readiness while a new relevant claim blocks acceptance without changing geometry', { timeout: 60_000 }, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bim-evidence-freshness-'));
  const queue = await ChangeRequests.open(path.join(directory, 'queue.sqlite'), () => evidenceWorker);
  t.after(async () => { await queue.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const repository = await initial(); await queue.importProject(repository.serialize());
  const evidence = await claims(queue, repository);
  const plan = await evidence.append(evidence.entry('freshness-plan', 5));
  const input = { requestId: 'freshness-wall-request', baseRevisionId: repository.head('main'),
    selectedObjectIds: ['wall-living-kitchen'], instruction: 'Explore a 200 mm partition shift.', visualIntent: { kind: 'selection' }, evidencePins: [plan] };
  const submitted = await queue.submit(repository.serialize(), input); await ready(queue, submitted.id);
  await evidence.append(evidence.entry('unrelated-bed-evidence', 2, 'main-bed'));
  assert.equal((await queue.refreshProposal(submitted.id)).state, 'ready');
  await evidence.append(evidence.entry('new-wall-claim', 5.1));
  assert.equal((await queue.refreshProposal(submitted.id)).state, 'needs-input');
  await assert.rejects(queue.decide(submitted.id, { action: 'accept', decisionId: 'blocked-stale-evidence', expectedRequestId: input.requestId }), /candidate set changed/);
  assert.equal((await RoomRepository.restore(queue.project(repository.projectId))).head('main'), repository.head('main'));
});

test('a chat reply replaces or clears evidence context without rewriting earlier messages', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bim-evidence-chat-'));
  const queue = await ChangeRequests.open(path.join(directory, 'queue.sqlite'), () => null);
  t.after(async () => { await queue.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const repository = await initial(); await queue.importProject(repository.serialize());
  const evidence = await claims(queue, repository);
  const first = await evidence.append(evidence.entry('chat-plan-first', 5));
  const second = await evidence.append(evidence.entry('chat-plan-second', 5.2));
  const submitted = await queue.submit(repository.serialize(), { requestId: 'evidence-chat', baseRevisionId: repository.head('main'),
    selectedObjectIds: ['wall-living-kitchen'], instruction: 'Study the partition.', visualIntent: { kind: 'selection' }, evidencePins: [first] });
  let ticket = queue.get(submitted.id);
  async function reply(messageId: string, pins: EvidencePin[]) {
    ticket = await queue.appendMessage(submitted.id, { messageId, expectedSequence: ticket.conversation?.sequence,
      baseRevisionId: repository.head('main'), text: 'Use this evidence selection for the next turn.', sources: [], visual: null, evidencePins: pins });
  }
  await reply('replace-evidence-context', [second]);
  assert.deepEqual(ticket.evidence?.pins, [second]);
  await reply('clear-evidence-context', []);
  assert.equal(ticket.evidence, undefined);
  const messages = ticket.conversation?.messages.filter(message => message.kind === 'user');
  assert.deepEqual(messages?.map(message => message.evidencePins), [[first], [second], []]);
});
