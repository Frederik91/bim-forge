import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import process from 'node:process';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { Type } from 'typebox';
import { Check } from 'typebox/value';
import { runCandidateProcess } from './runner-limits.ts';

const inputSchema=Type.Object({qualified:Type.Literal(false),inputSha256:Type.String({pattern:'^[a-f0-9]{64}$'})},{additionalProperties:true});
async function pixels(file:string){return sharp(file).ensureAlpha().raw().toBuffer();}
function differences(a:Buffer,b:Buffer){if(a.length!==b.length)throw new Error('Pixel size mismatch');let changed=0;for(let i=0;i<a.length;i+=4)if(a[i]!==b[i]||a[i+1]!==b[i+1]||a[i+2]!==b[i+2])changed++;return changed;}
const workerSchema=Type.Object({configuration:Type.Union([Type.Literal('individual'),Type.Literal('retained')]),
  session:Type.Integer({minimum:1,maximum:5}),cycles:Type.Integer({minimum:1,maximum:100}),
  url:Type.String({pattern:'^http://127\\.0\\.0\\.1:[0-9]+$'}),dir:Type.String()},{additionalProperties:false});
async function runWorker():Promise<void>{
  const input:unknown=JSON.parse(process.argv[3]??'null');
  if(!Check(workerSchema,input))throw new Error('Invalid worker invocation');
  const {configuration,session,cycles,url,dir}=input;
      const browserServer=await chromium.launchServer({channel:'chrome',headless:true,timeout:30000});
      process.send?.({browserPid:browserServer.process().pid,phase:'connect'});
      const browser=await chromium.connect(browserServer.wsEndpoint());const errors:string[]=[];
      try{
        const page=await browser.newPage({viewport:{width:800,height:600},deviceScaleFactor:1});page.setDefaultTimeout(120000);
        page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error'||message.type()==='warning'&&message.text().includes('INVALID_'))errors.push(message.text());});
        await page.goto(url);await page.waitForFunction(()=>!!window.productionViewer);
        process.send?.({phase:'replay'});
        const input:unknown=await page.evaluate(value=>window.productionViewer.start(value),configuration);if(!Check(inputSchema,input))throw new Error('Invalid production diagnostic input');
        const cdp=await page.context().newCDPSession(page);const modes=[];
        for(const mode of ['basic','realistic'] satisfies ('basic'|'realistic')[]){
          const overview:unknown=await page.evaluate(value=>window.productionViewer.mode(value),mode);
          await page.locator('canvas').screenshot({path:path.join(dir,mode+'-overview.png')});
          await page.evaluate(()=>window.productionViewer.focus());
          const stages=[];for(const stage of ['baseline','preview','comparison','discard'] satisfies ('baseline'|'preview'|'comparison'|'discard')[]){
            const state:unknown=await page.evaluate(value=>window.productionViewer.stage(value),stage);stages.push({stage,state});
            await page.locator('canvas').screenshot({path:path.join(dir,mode+'-'+stage+'.png')});
          }
          const baseline=await pixels(path.join(dir,mode+'-baseline.png'));const preview=await pixels(path.join(dir,mode+'-preview.png'));
          const comparison=await pixels(path.join(dir,mode+'-comparison.png'));const discard=await pixels(path.join(dir,mode+'-discard.png'));
          const changed={preview:differences(baseline,preview),comparison:differences(baseline,comparison),discard:differences(baseline,discard)};
          if(changed.preview<100||changed.comparison<100||changed.discard!==0)throw new Error('Visible production review mismatch '+JSON.stringify(changed));
          await page.evaluate(()=>window.productionViewer.cycles(2));await cdp.send('HeapProfiler.collectGarbage');
          const before={heap:await cdp.send('Runtime.getHeapUsage'),counts:await page.evaluate(()=>window.productionViewer.counts())};
          const blocks=[];const count=cycles;
          for(let done=0;done<count;){const size=Math.min(20,count-done);await page.evaluate(value=>window.productionViewer.cycles(value),size);done+=size;
            await cdp.send('HeapProfiler.collectGarbage');blocks.push({cycles:done,heap:await cdp.send('Runtime.getHeapUsage'),counts:await page.evaluate(()=>window.productionViewer.counts())});}
          if(JSON.stringify(before.counts)!==JSON.stringify(blocks.at(-1)?.counts))throw new Error('Live production resources grew after discard');
          modes.push({mode,overview,stages,changed,before,blocks});
        }
        if(errors.length)throw new Error(errors.join('\n'));
        process.send?.({phase:'interaction'});
        await page.evaluate(()=>window.productionViewer.uiStart());
        const handle=page.locator('.model-reference-handle');await handle.waitFor({state:'visible'});
        await page.waitForFunction(()=>document.querySelector('.babylon-viewer')?.getAttribute('data-scene-ready')==='true',{},{timeout:15000}).catch(async error=>{await fs.writeFile(path.join(dir,'interaction-dom.html'),await page.content());await page.screenshot({path:path.join(dir,'interaction-failure.png')});throw error;});
        const box=await handle.boundingBox();if(!box)throw new Error('No reference handle bounds');
        await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
        let marked=false;
        for(const [x,y] of [[400,350],[300,350],[500,350],[400,450],[300,450],[500,450]]){
          await page.mouse.move(x,y,{steps:3});
          if((await page.locator('.model-selection-caption').textContent())?.startsWith('Reference location')){marked=true;break;}
        }
        if(!marked)throw new Error('Reference drag never reached a valid floor or wall');
        await page.evaluate(()=>window.productionViewer.uiSwitch());await page.mouse.up();
        const interaction=await page.evaluate(()=>window.productionViewer.uiStatus());
        if(interaction.references!==0||interaction.marking)throw new Error('Cross-project reference drag leaked');
        if(errors.length)throw new Error(errors.join('\n'));
        const result={status:'completed',qualified:false,session,configuration,browserVersion:browser.version(),input,modes,interaction,errors};
        await fs.writeFile(path.join(dir,'result.json'),JSON.stringify(result,null,2));
        await page.evaluate(()=>window.productionViewer.dispose());
        process.stdout.write('Completed '+session+' '+configuration+'\n');
      }catch(error){await fs.writeFile(path.join(dir,'failure.json'),JSON.stringify({status:'failed',qualified:false,error:String(error),errors},null,2));throw error;}
      finally{process.send?.({phase:'close'});await browser.close();await browserServer.close();}
  process.send?.({phase:'completed'});process.disconnect?.();
}
if(process.argv[2]==='--worker')await runWorker();
else await runParent();
async function runParent():Promise<void>{
const root=fileURLToPath(new URL('../../',import.meta.url));
const args=process.argv.slice(2);const allowed=new Set(['--output','--sessions','--cycles']);
for(const item of args.filter(item=>item.startsWith('--')))if(!allowed.has(item))throw new Error('Unknown option '+item);
function option(name:string,fallback:string){const index=args.indexOf(name);if(index<0)return fallback;const value=args[index+1];if(!value||value.startsWith('--'))throw new Error('Missing '+name);return value;}
const sessions=Number(option('--sessions','5')),cycles=Number(option('--cycles','100'));
if(!Number.isSafeInteger(sessions)||sessions<1||sessions>5||!Number.isSafeInteger(cycles)||cycles<1||cycles>100)throw new Error('Invalid bounded run size');
const output=path.resolve(option('--output','artifacts/private/production-viewer/browser-'+Date.now()));
await fs.mkdir(path.dirname(output),{recursive:true});await fs.mkdir(output,{recursive:false});
const assets=path.join(output,'assets');await fs.mkdir(assets);
const hash=(bytes:string|Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const files=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','demo','src','benchmarks/viewer','package.json','package-lock.json'],{cwd:root,encoding:'utf8'}).trim().split(/\r?\n/);
await fs.writeFile(path.join(output,'run.json'),JSON.stringify({qualified:false,source:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
  sourceFiles:await Promise.all(files.map(async file=>({path:file,sha256:hash(await fs.readFile(path.join(root,file)))}))),sessions,cycles,
  cpu:os.cpus()[0]?.model,logicalCpus:os.cpus().length,totalMemoryBytes:os.totalmem(),os:os.release(),node:process.version,
  profile:'local workstation diagnostics; no CPU profiling/tracing; isolated Chrome processes; GPU presentation/memory unavailable'},null,2));
await build({entryPoints:[path.join(root,'benchmarks/viewer/production-browser.ts')],outdir:assets,bundle:true,platform:'browser',format:'esm',target:'es2023',sourcemap:true,logLevel:'warning'});
const assetNames=new Set(await fs.readdir(assets));
const html='<!doctype html><meta charset="utf-8"><title>Production viewer diagnostics</title><link rel="stylesheet" href="/room.css"><style>body{margin:0}canvas{display:block;width:800px;height:600px}</style><canvas width="800" height="600"></canvas><script type="module" src="/production-browser.js"></script>';
const server=createServer(async(request,response)=>{try{
  response.setHeader('Cache-Control','no-store');response.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:");
  const name=request.url?.split('?')[0]?.slice(1)??'';
  if(!name){response.setHeader('Content-Type','text/html');response.end(html);}
  else if(name==='room.css'){response.setHeader('Content-Type','text/css');response.end(await fs.readFile(path.join(root,'demo/room.css')));}
  else if(name==='favicon.ico'){response.writeHead(204);response.end();}
  else if(assetNames.has(name)){response.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':'application/json');response.end(await fs.readFile(path.join(assets,name)));}
  else{response.writeHead(404);response.end();}
}catch(error){response.writeHead(500);response.end();process.stderr.write(String(error));}});
await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw new Error('No address');
const allRuns:unknown[]=[];
try{
  for(let session=1;session<=sessions;session++){
    const order=session%2?['individual','retained'] satisfies ('individual'|'retained')[]:['retained','individual'] satisfies ('individual'|'retained')[];
    for(const configuration of order){
      const dir=path.join(output,String(session)+'-'+configuration);await fs.mkdir(dir);
      const ok=await runCandidateProcess({candidate:configuration==='individual'?'production-individual':'production-retained',output:dir,
        timeoutMs:180000,executable:process.execPath,args:[fileURLToPath(import.meta.url),'--worker',JSON.stringify({
          configuration,session,cycles:session===sessions?cycles:5,url:'http://127.0.0.1:'+address.port,dir})]});
      if(!ok)throw new Error('Production candidate failed; see '+dir);
      const result:unknown=JSON.parse(await fs.readFile(path.join(dir,'result.json'),'utf8'));
      if(!Check(Type.Object({status:Type.Literal('completed'),qualified:Type.Literal(false)},{additionalProperties:true}),result))throw new Error('Invalid worker result');
      allRuns.push(result);
    }
  }
  const comparisons=[];
  for(let session=1;session<=sessions;session++)for(const mode of ['basic','realistic'])for(const stage of ['overview','baseline','preview','comparison','discard']){
    const a=await pixels(path.join(output,session+'-individual',mode+'-'+stage+'.png'));const b=await pixels(path.join(output,session+'-retained',mode+'-'+stage+'.png'));
    comparisons.push({session,mode,stage,differingPixels:differences(a,b),totalPixels:a.length/4});
  }
  await fs.writeFile(path.join(output,'results.json'),JSON.stringify({status:comparisons.every(item=>item.differingPixels===0)?'completed':'failed',qualified:false,runs:allRuns,comparisons},null,2));
  if(comparisons.some(item=>item.differingPixels!==0))throw new Error('Production A/B visual mismatch; see results.json');
}finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}

}
