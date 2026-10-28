import { createApiKit, createRuntime, DocsTree, Type } from '@frederik91/scriptbox';
import type { Scene } from './fixtures.ts';
import { inspectCandidate, proposal } from './pilot.ts';
import { parseAnswer } from './contract.ts';
import assert from 'node:assert/strict';

const api=createApiKit<Scene>();
const geometry=api.namespace({name:'geometry',description:'Read-only synthetic fixture queries. No files, network or model writes.',methods:{
  inspect:api.method({summary:'Check an oriented cube at one of the two task-defined candidate stations; not a general placement solver.',effect:'read',params:{side:Type.Union([Type.Literal(1),Type.Literal(-1)])},
    result:Type.Object({side:Type.Union([Type.Literal(1),Type.Literal(-1)]),valid:Type.Boolean(),nearest:Type.String(),exactChecks:Type.Number()}),handler:({side},call)=>inspectCandidate(call.context,side,'progressive')}),
}});
const runtimePromise=createRuntime<Scene>({apis:[geometry],docs:[new DocsTree().addFile('/pilot.md','Read-only candidate checking','Return chosen side and nearest or abstain.')],contractVersion:'geometry225-v1',policyVersion:'readonly225-v1',compilerWorkers:1,sealResults:true,
  limits:{memoryBytes:32*1024*1024,compilerHeapMb:256,sourceBytes:4096,resultBytes:8192,hostCalls:4,evidenceRecords:4,timeoutMs:5000}});
const source='const a=await geometry.inspect(1); const b=await geometry.inspect(-1); const c=a.valid?a:b.valid?b:null; return c?{side:c.side,nearest:c.nearest}:null;';
export async function runSandbox(scene:Scene) {
  const runtime=await runtimePromise;
  const session=runtime.createSession({context:structuredClone(scene),capabilities:['geometry.inspect']});
  try {
    const result=await session.execute({language:'typescript',source});
    if(result.status!=='completed') throw new Error(JSON.stringify(result));
    const value=result.value;
    if(value===null) return {answer:parseAnswer({kind:'abstain',reason:'no-fit'}),calls:result.evidence.calls.length,evidence:result.evidence};
    if(typeof value!=='object' || Array.isArray(value) || !('side' in value) || !('nearest' in value) || (value.side!==1 && value.side!==-1) || typeof value.nearest!=='string') throw new Error('Invalid sandbox choice');
    return {answer:proposal(scene,value.side,value.nearest),calls:result.evidence.calls.length,evidence:result.evidence};
  } finally { await session.dispose(); }
}
export async function disposeSandbox() { await (await runtimePromise).dispose(); }
export async function sandboxControls(scene:Scene) {
  const runtime=await runtimePromise;
  const cases=[
    {name:'invalid-side-type',source:'return await geometry.inspect(0);',capabilities:['geometry.inspect'],hostCalls:4,timeoutMs:1000,completed:false},
    {name:'no-host-globals',source:'return ["process","fetch","require"].map(k => k in globalThis);',capabilities:[],hostCalls:4,timeoutMs:1000,completed:true},
    {name:'denied-capability',source:'return await geometry.inspect(1);',capabilities:[],hostCalls:4,timeoutMs:1000,completed:false},
    {name:'call-budget',source:'await geometry.inspect(1); return await geometry.inspect(-1);',capabilities:['geometry.inspect'],hostCalls:1,timeoutMs:1000,completed:false},
    {name:'timeout',source:'while (true) {}',capabilities:[],hostCalls:4,timeoutMs:100,completed:false},
    {name:'source-budget',source:`return ${JSON.stringify('x'.repeat(5000))};`,capabilities:[],hostCalls:4,timeoutMs:1000,completed:false},
  ];
  const results=[];
  for(const item of cases) {
    const session=runtime.createSession({context:scene,capabilities:item.capabilities,limits:{hostCalls:item.hostCalls,timeoutMs:item.timeoutMs}});
    try { const result=await session.execute({language:'typescript',source:item.source});
      assert.equal(result.status==='completed',item.completed,item.name);
      if(item.name==='no-host-globals' && result.status==='completed') assert.deepEqual(result.value,[false,false,false]);
      results.push({name:item.name,outcome:result});
    } finally { await session.dispose(); }
  }
  return results;
}
