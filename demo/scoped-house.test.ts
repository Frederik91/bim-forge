import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createDemoServer } from './server.ts';
import type { DemoServer } from './server.ts';
import { RoomRepository, diffSnapshots } from '../src/room-model.ts';
import { modelScopeFixture } from '../src/model-scope-fixture.ts';
import { parseFrozenModelScope } from '../src/model-scope-contract.ts';
import { scopedHouseWorker } from './fixtures/scoped-house-agent.ts';

function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function project(value: unknown): string {
  assert.ok(object(value) && typeof value.project === 'string'); return value.project;
}
function ticket(value: unknown): Record<string, unknown> {
  assert.ok(object(value) && object(value.ticket)); return value.ticket;
}
async function call(server: DemoServer, target: string, body?: unknown) {
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const bytes = body === undefined ? undefined : JSON.stringify(body);
  return new Promise<{status:number;value:unknown}>((resolve,reject) => {
    const request = http.request({hostname:'127.0.0.1',port:address.port,path:target,method:bytes === undefined?'GET':'POST',
      headers:bytes === undefined?{}:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(bytes)}}, response => {
      const chunks:Buffer[]=[]; response.on('data',(chunk:Buffer)=>chunks.push(chunk));
      response.on('end',()=>{try {const value:unknown=JSON.parse(Buffer.concat(chunks).toString('utf8')); resolve({status:response.statusCode??0,value});}catch(error){reject(error);}});
    }); request.once('error',reject); request.end(bytes);
  });
}
async function start(file:string) {
  const server=await createDemoServer({backlogFile:file,modelWorker:scopedHouseWorker});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve)); return server;
}
async function stop(server:DemoServer) {
  await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve())); await server.closeModelWorkers();
}
async function ready(server:DemoServer,id:string) {
  const deadline=Date.now()+120_000;
  while(Date.now()<deadline) {
    const result=await call(server,`/api/change-requests/${id}`); assert.equal(result.status,200);
    const current=ticket(result.value); if(current.state==='ready')return current;
    assert.ok(current.state==='queued'||current.state==='working',JSON.stringify(current));
    await new Promise(resolve=>setTimeout(resolve,20));
  } throw new Error('The scoped request did not become reviewable.');
}

test('HTTP room and shared-family scopes survive restart and preserve unrelated accepted edits', {timeout:180_000}, async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'bim-scopes171-')); const file=path.join(directory,'scope.sqlite');
  const repo=await RoomRepository.createProject({projectId:crypto.randomUUID(),name:'Scoped house integration',snapshot:modelScopeFixture()});
  let server=await start(file); let closed=false;
  t.after(async()=>{if(!closed)await stop(server); await fs.rm(directory,{recursive:true,force:true});});
  const endpoint=`/api/projects/${repo.projectId}`;
  assert.equal((await call(server,'/api/projects',{project:repo.serialize()})).status,200);
  const room={version:1,allOf:[{kind:'in-spaces',spaceIds:['room-office']},{kind:'furniture-kind',furnitureKind:'desk'}],anyOf:[],excludeIds:[]};
  const family={version:1,allOf:[{kind:'asset-family',familyId:'standing-person'}],anyOf:[],excludeIds:[]};
  const preview=await call(server,endpoint+'/scope-preview',{baseRevisionId:repo.head('main'),query:family});
  assert.equal(preview.status,200); assert.ok(object(preview.value));
  const frozen=parseFrozenModelScope(preview.value.scope); assert.deepEqual(frozen.targetIds,['bedroom-person','living-person']);
  assert.ok(frozen.contextIds.includes('standing-person')); assert.ok(!frozen.writableIds.includes('standing-person'));
  const saved=await call(server,endpoint+'/scopes',{id:'all-people',name:'All people',query:family,expectedVersion:null});
  assert.equal(saved.status,200);
  for(const [id,query,selected,savedScopeId] of [
    ['scope-http-desk',room,'office-desk',undefined],['scope-http-people',family,'living-person','all-people'],
  ] satisfies Array<[string,unknown,string,string|undefined]>) {
    const ack=await call(server,'/api/change-requests',{project:repo.serialize(),request:{requestId:id,proposalName:id,
      baseRevisionId:repo.head('main'),selectedObjectIds:[selected],instruction:'Apply the qualification dimensions and inspection interval.',
      visualIntent:{kind:'selection'},scope:{query,...(savedScopeId?{savedScopeId}:{})}}});
    assert.equal(ack.status,202,JSON.stringify(ack.value)); await ready(server,id);
  }
  await stop(server); closed=true; server=await start(file); closed=false;
  const recovered=await ready(server,'scope-http-people'); assert.deepEqual(parseFrozenModelScope(recovered.scope),frozen);
  for(const id of ['scope-http-desk','scope-http-people']) {
    const result=await call(server,`/api/change-requests/${id}/decision`,{action:'accept',decisionId:'accept-'+id,expectedRequestId:id});
    assert.equal(result.status,200,JSON.stringify(result.value)); assert.equal(ticket(result.value).state,'completed');
  }
  const accepted=await RoomRepository.restore(project((await call(server,endpoint)).value));
  const before=repo.view(repo.head('main')).snapshot; const after=accepted.view(accepted.head('main')).snapshot;
  assert.deepEqual(diffSnapshots(before,after).entities.modified.map(item=>item.id).sort(),['bedroom-person','living-person','office-desk']);
  for(const entity of after.entities) {
    if(entity.type==='AssetInstance')assert.equal(entity.size.height,1.9);
    if(entity.id==='office-desk'&&entity.type==='Furniture')assert.equal(entity.width,1.8);
    if(['office-monitor','office-laptop','standing-person'].includes(entity.id))assert.deepEqual(entity,before.entities.find(item=>item.id===entity.id));
  }
  const definitions=await call(server,endpoint+'/scopes'); assert.equal(definitions.status,200);
  assert.ok(object(definitions.value)&&Array.isArray(definitions.value.scopes)&&definitions.value.scopes.length===1);
});
