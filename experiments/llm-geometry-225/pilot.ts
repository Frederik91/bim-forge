import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fixtures } from './fixtures.ts';
import type { Answer } from './contract.ts';
import { arms, bytes, context, hash, inspectCandidate, proposal } from './geometry.ts';
import { runSandbox, disposeSandbox, sandboxControls } from './sandbox.ts';
async function main() {
  const out=process.argv[2]; if(!out) throw new Error('output directory required'); fs.mkdirSync(out,{recursive:true});
  const scenes=fixtures(), receipts: unknown[]=[];
  for(let repeat=0;repeat<5;repeat++) for(const arm of repeat%2?[...arms].reverse():arms) for(const scene of scenes) {
    const start=performance.now(); let answer:Answer, exactChecks:number|null=0, calls=0, responseBytes:number|null=0, evidence:unknown=null;
    if(scene.status!=='ready') answer={kind:'abstain',reason:scene.status};
    else if(arm==='image') answer={kind:'abstain',reason:'insufficient'};
    else if(arm==='sandbox') { const result=await runSandbox(scene); answer=result.answer; calls=result.calls; evidence=result.evidence;exactChecks=null;responseBytes=null; }
    else { const mode=arm==='summary'?'summary':arm==='raw'||arm==='tools'?'tools':'progressive';
      const candidates=[];
      for(const side of [1,-1] as const) { calls++; const r=inspectCandidate(scene,side,mode); exactChecks+=r.exactChecks;responseBytes+=bytes(r);candidates.push(r);if((arm==='progressive'||arm==='hybrid')&&r.valid)break; }
      const chosen=candidates.find(c=>c.valid); answer=chosen?proposal(scene,chosen.side,chosen.nearest):{kind:'abstain',reason:'no-fit'};
    }
    const elapsedMs=performance.now()-start;
    receipts.push({scene:scene.id,arm,repeat,answer,calls,exactChecks,repairs:0,invalidCalls:0,elapsedMs,inputBytes:bytes(context(scene,arm)),responseBytes,answerBytes:bytes(answer),evidence});
  }
  const data={version:'225-v1',fixtureSha256:hash(scenes),node:process.version,kind:'deterministic-policy-comparison-not-LLM',scenes,receipts};
  fs.writeFileSync(path.join(out,'pilot.json'),JSON.stringify(data,null,2));
  const first=scenes[0];if(!first)throw new Error('empty fixtures');
  fs.writeFileSync(path.join(out,'sandbox-controls.json'),JSON.stringify(await sandboxControls(first),null,2));
  for(const scene of scenes) { fs.writeFileSync(path.join(out,`${scene.id}.svg`),svg(scene)); for(const arm of arms) fs.writeFileSync(path.join(out,`${scene.id}-${arm}.json`),JSON.stringify(context(scene,arm),null,2)); }
  const ids=['c06','c02','c05','c13','c14'];
  const packets=Object.fromEntries((['raw','summary','tools','progressive'] as const).map(arm=>[arm,ids.map(id=>{
    const scene=scenes.find(s=>s.id===id);if(!scene)throw new Error('trial fixture');
    if(arm==='raw'||arm==='summary') return context(scene,arm);
    const metadata=context(scene,'tools');
    if(arm==='progressive')return metadata;
    return {metadata,candidateChecks:scene.status==='ready'?([1,-1] as const).map(side=>{const r=inspectCandidate(scene,side,'tools');const p=proposal(scene,side,r.nearest);if(p.kind!=='proposal')throw new Error('candidate');return {side,center:p.center,yawDegrees:p.yawDegrees,valid:r.valid,nearest:r.nearest};}):{kind:'unavailable',reason:scene.status}};
  })]));
  fs.writeFileSync(path.join(out,'trial-packets.json'),JSON.stringify(packets,null,2));
  console.log(JSON.stringify({fixtureSha256:data.fixtureSha256,receipts:receipts.length,output:out}));
  await disposeSandbox();
}
if(process.argv[1]?.endsWith('/pilot.ts') || process.argv[1]?.endsWith('\\pilot.ts')) await main();
