import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { RoomRepository } from '../src/room-model.ts';
import { createResidentialProject } from '../src/residential-floor.ts';
import { parseModelScopeQuery } from '../src/model-scope-contract.ts';
import { VersionedProjectStore } from './versioned-project-store.ts';
import { ModelScopeStore, ScopeStoreConflict } from './model-scope-store.ts';

function officeQuery() {
  return parseModelScopeQuery({version:1,allOf:[{kind:'in-spaces',spaceIds:['room-office']},
    {kind:'furniture-kind',furnitureKind:'desk'}],anyOf:[],excludeIds:[]});
}
function allDesksQuery() {
  return parseModelScopeQuery({version:1,allOf:[{kind:'furniture-kind',furnitureKind:'desk'}],anyOf:[],excludeIds:[]});
}
function publish(store: VersionedProjectStore, repository: RoomRepository) {
  const reference = store.put(repository);
  store.publish({projectId:repository.projectId,expectedDocumentId:store.current(repository.projectId)?.documentId ?? null,
    reference,origin:'imported',requestId:null,decisionId:null});
  return reference;
}

test('a room working set reads the current revision without hydrating an unrelated proposal history', async t => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  const original = await createResidentialProject('Scoped working-set study');
  const snapshot = structuredClone(original.view(original.head('main')).snapshot);
  const desk = snapshot.entities.find(item => item.id === 'office-desk');
  assert.ok(desk?.type === 'Furniture'); desk.height = .9;
  const repository = await original.proposeReviewedModel({name:'isolated-desk',from:original.head('main'),snapshot,
    review:{requestId:'isolated-desk',selectedObjectIds:['office-desk'],instruction:'Raise this desk.',summary:'Raise the desk.',
      rationale:'Fixture for isolated history.',constraints:'Keep other entities.',uncertainty:'Fixture only.',
      worker:{provider:'fixture',model:'scoped-history',responseIds:[],usage:{inputTokens:0,outputTokens:0,totalTokens:0}},
      toolCalls:[{name:'preview_furnishings',status:'accepted',error:null}],validator:'room-graph-v1'}});
  const projects = new VersionedProjectStore(db); const reference = publish(projects,repository);
  const draft = db.prepare("SELECT hash FROM versioned_bodies WHERE json_extract(body,'$.id')='office-desk' AND json_extract(body,'$.height')=0.9").get();
  assert.ok(draft && typeof draft.hash === 'string');
  db.prepare('UPDATE versioned_bodies SET body=? WHERE hash=?').run('{broken draft',draft.hash);
  assert.throws(() => projects.read(reference), /corruption/);
  const scopeStore = new ModelScopeStore(db,projects);
  const preview = scopeStore.preview({projectId:repository.projectId,baseRevisionId:repository.head('main'),query:officeQuery()});
  assert.deepEqual(preview.scope.targetIds,['office-desk']);
  assert.ok(preview.graph.entities.some(item => item.id === 'office-desk'));
  assert.ok(!preview.graph.entities.some(item => item.id === 'main-bed'));
  assert.equal(preview.scope.baseRevisionId,original.head('main'));
  assert.equal(projects.acceptedHead(repository.projectId),original.head('main'));
});

test('working-set reads retain hosts and reject missing endpoints, cross-project revisions and corrupt selected bodies', async t => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  const repository = await RoomRepository.create('Bounded graph read');
  const other = await createResidentialProject('Unrelated graph');
  const projects = new VersionedProjectStore(db); const reference = publish(projects,repository); publish(projects,other);
  const snapshot = repository.view(repository.head('main')).snapshot;
  const link = snapshot.relationships[0]; assert.ok(link);
  const graph = projects.readItems({reference,revisionId:repository.head('main'),entityIds:[link.source,link.target],relationshipIds:[link.id]});
  assert.equal(graph.entities.length,2); assert.equal(graph.relationships.length,1);
  assert.throws(() => projects.readItems({reference,revisionId:repository.head('main'),entityIds:[link.source],relationshipIds:[link.id]}), /endpoints/);
  assert.throws(() => projects.readGraph({reference,revisionId:other.head('main')}), /outside/);
  const body = db.prepare("SELECT hash FROM versioned_bodies WHERE json_extract(body,'$.id')=?").get(link.source); assert.ok(body && typeof body.hash === 'string');
  db.prepare('UPDATE versioned_bodies SET body=? WHERE hash=?').run('{}',body.hash);
  assert.throws(() => projects.readItems({reference,revisionId:repository.head('main'),entityIds:[link.source],relationshipIds:[]}), /corruption/);
});

test('saved smart areas retain query versions across restart and use project-bound compare-and-swap', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(),'bim-scopes-'));
  t.after(() => fs.rm(directory,{recursive:true,force:true}));
  const file = path.join(directory,'scopes.sqlite');
  let db = new DatabaseSync(file); let projects = new VersionedProjectStore(db); let scopes = new ModelScopeStore(db,projects);
  t.after(() => db.close());
  const repository = await createResidentialProject('Saved areas'); const other = await createResidentialProject('Separate saved areas');
  publish(projects,repository); publish(projects,other);
  const first = scopes.save({projectId:repository.projectId,id:'east-wing',name:'East wing',query:officeQuery(),expectedVersion:null});
  const frozen = scopes.preview({projectId:repository.projectId,baseRevisionId:repository.head('main'),query:first.query});
  const second = scopes.save({projectId:repository.projectId,id:first.id,name:'All desks',query:allDesksQuery(),expectedVersion:first.version});
  assert.notEqual(second.version,first.version);
  assert.deepEqual(scopes.save({projectId:repository.projectId,id:first.id,name:second.name,query:second.query,expectedVersion:first.version}),second);
  assert.throws(() => scopes.save({projectId:repository.projectId,id:first.id,name:'Conflicting edit',query:first.query,expectedVersion:first.version}), ScopeStoreConflict);
  assert.deepEqual(frozen.scope.query,first.query,'Changing the live saved definition cannot rewrite submitted membership.');
  assert.equal(scopes.list(other.projectId).length,0);
  assert.throws(() => scopes.load({projectId:other.projectId,id:first.id}),ScopeStoreConflict);
  db.close(); db = new DatabaseSync(file); projects = new VersionedProjectStore(db); scopes = new ModelScopeStore(db,projects);
  assert.deepEqual(scopes.load({projectId:repository.projectId,id:first.id}),second);
  assert.equal(projects.acceptedHead(repository.projectId),repository.head('main'));
});

test('saved scope publication failures preserve the prior query and derived cache corruption rebuilds safely', async t => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  const repository = await createResidentialProject('Atomic scopes'); const projects = new VersionedProjectStore(db); publish(projects,repository);
  const scopes = new ModelScopeStore(db,projects);
  const first = scopes.save({projectId:repository.projectId,id:'office',name:'Office',query:officeQuery(),expectedVersion:null});
  db.exec("CREATE TRIGGER refuse_scope_update BEFORE UPDATE ON model_scope_heads BEGIN SELECT RAISE(FAIL,'scope head unavailable'); END");
  assert.throws(() => scopes.save({projectId:repository.projectId,id:'office',name:'Whole building desks',query:allDesksQuery(),expectedVersion:first.version}), /scope head unavailable/);
  assert.deepEqual(scopes.load({projectId:repository.projectId,id:'office'}),first);
  db.exec('DROP TRIGGER refuse_scope_update');
  db.exec("UPDATE model_scope_projection SET payload='invalid cache'");
  const preview = scopes.preview({projectId:repository.projectId,baseRevisionId:repository.head('main'),query:first.query});
  assert.deepEqual(preview.scope.targetIds,['office-desk']);
  assert.equal(scopes.list(repository.projectId).length,1);
});
