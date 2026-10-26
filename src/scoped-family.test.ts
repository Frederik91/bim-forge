import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomRepository, previewAssets, diffSnapshots } from './room-model.ts';
import { modelScopeFixture } from './model-scope-fixture.ts';
import { previewAssetFamilyVariant } from './asset-family.ts';
import { assertModelScopeWrites, freezeModelScope } from './model-scope.ts';
import { prepareModelProposal } from './model-proposal.ts';
import { modelWorkingGraph } from './model-script.ts';
import type { ModelScopeQuery } from './model-scope-contract.ts';

const query:ModelScopeQuery={version:1,allOf:[{kind:'ids',ids:['living-person']}],anyOf:[],excludeIds:[]};
test('scoped subset variants create only a definition used by existing writable occurrences',()=>{
  const before=modelScopeFixture(); const original=before.entities.find(entity=>entity.id==='standing-person'); assert.ok(original?.type==='AssetFamily');
  const binding=freezeModelScope({graph:before,query,baseRevisionId:'a'.repeat(64)});
  const variant={...original,id:'reviewed-person',name:'Reviewed person variant'};
  const after=previewAssetFamilyVariant({snapshot:before,familyId:original.id,targetIds:['living-person'],variant});
  assert.doesNotThrow(()=>assertModelScopeWrites({before,after,binding}));
  assert.ok(modelWorkingGraph(after,binding).entities.some(entity=>entity.id===variant.id));
  assert.ok(!binding.writableIds.includes(variant.id));
  assert.deepEqual(after.entities.find(entity=>entity.id==='bedroom-person'),before.entities.find(entity=>entity.id==='bedroom-person'));
  assert.deepEqual(after.entities.find(entity=>entity.id===original.id),original);
  const orphan=previewAssets(before,{families:[variant],instances:[],removeInstanceIds:[]});
  assert.throws(()=>assertModelScopeWrites({before,after:orphan,binding}),/out-of-scope/i);
  const sibling=previewAssetFamilyVariant({snapshot:before,familyId:original.id,targetIds:['living-person','bedroom-person'],variant});
  assert.throws(()=>assertModelScopeWrites({before,after:sibling,binding}),/out-of-scope/i);
  const instance=after.entities.find(entity=>entity.id==='living-person');assert.ok(instance?.type==='AssetInstance');
  const extra=previewAssets(after,{families:[],instances:[{...instance,id:'unapproved-person',position:[4.5,2.8]}],removeInstanceIds:[]});
  assert.throws(()=>assertModelScopeWrites({before,after:extra,binding}),/out-of-scope/i);
  const alternate=previewAssets(before,{families:[{...original,id:'unobserved-family'}],instances:[],removeInstanceIds:[]});
  const alternateBinding=freezeModelScope({graph:alternate,query,baseRevisionId:'b'.repeat(64)});
  const rebound=previewAssets(alternate,{families:[],instances:[{...instance,familyId:'unobserved-family'}],removeInstanceIds:[]});
  assert.throws(()=>assertModelScopeWrites({before:alternate,after:rebound,binding:alternateBinding}),/out-of-scope family dependency/i);
});

test('a real scoped ScriptBox variant stays visible and accepts without changing its shared original or sibling',async()=>{
  const repo=await RoomRepository.createProject({projectId:crypto.randomUUID(),name:'Scoped family variant',snapshot:modelScopeFixture()});
  const before=repo.view(repo.head('main')).snapshot;
  const result=await prepareModelProposal(repo,{requestId:'scoped-variant',proposalName:'scoped-variant',baseRevisionId:repo.head('main'),
    selectedObjectIds:['living-person'],instruction:'Create a variant of the selected person only.',visualIntent:{kind:'selection'},scope:{query}},
  {identity:{provider:'integration-fixture',model:'scoped-family-variant'},async run(session){
    const output=await session.executeTool('run_model_script',{language:'typescript',source:`
      const view=await model.inspect();
      const original=view.model.entities.find(entity=>entity.type==='AssetFamily');
      const instance=view.model.entities.find(entity=>entity.id==='living-person');
      if(original?.type!=='AssetFamily'||instance?.type!=='AssetInstance')throw new Error('Missing family context.');
      await model.previewAssets({families:[{...original,id:'reviewed-person',name:'Reviewed person variant'}],
        instances:[{...instance,familyId:'reviewed-person'}],removeInstanceIds:[]});
      const updated=await model.inspect();
      if(!updated.model.entities.some(entity=>entity.id==='reviewed-person'))throw new Error('Authored definition disappeared.');
      return {kind:'propose',review:{summary:'Create an explicit variant for one occurrence.',rationale:'Preserve the shared original.',
        constraints:'Keep all unselected occurrences unchanged.',uncertainty:'Concept proxy only.',
        intent:{interpretation:'Create a selected-occurrence variant.',assumptions:[],certainty:100,basis:'Explicit fixture scope.'}}};
    `}); assert.equal(output.ok,true,JSON.stringify(output));
  }});
  assert.equal(result.status,'ready'); const accepted=result.repository.accept('scoped-variant',{decisionId:'accept-variant',actor:'Human reviewer'});
  const after=accepted.view(accepted.head('main')).snapshot; const delta=diffSnapshots(before,after);
  assert.deepEqual(delta.entities.added.map(entity=>entity.id),['reviewed-person']);
  assert.deepEqual(delta.entities.modified.map(entity=>entity.id),['living-person']);
  for(const id of ['standing-person','bedroom-person'])assert.deepEqual(after.entities.find(entity=>entity.id===id),before.entities.find(entity=>entity.id===id));
  assert.equal((await RoomRepository.restore(accepted.serialize())).serialize(),accepted.serialize());
});
