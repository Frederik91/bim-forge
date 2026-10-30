import { createHash } from 'node:crypto';
import { projectPoint, vertices, rect } from './fixtures.ts';
import type { Scene, Cell, V3 } from './fixtures.ts';
import type { Answer } from './contract.ts';
export const arms = ['raw', 'summary', 'tools', 'progressive', 'sandbox', 'image', 'hybrid'] as const;
export type Arm = typeof arms[number];
export const bytes = (x: unknown) => Buffer.byteLength(JSON.stringify(x));
export const hash = (x: unknown) => createHash('sha256').update(JSON.stringify(x)).digest('hex');
const bounds = (points: V3[]) => ({ min: [0,1,2].map(i => Math.min(...points.map(p => p[i] ?? 0))), max: [0,1,2].map(i => Math.max(...points.map(p => p[i] ?? 0))) });
function aggregate(cells: Cell[]): Cell[] {
  if (!cells.length) return [];
  const p = cells.flatMap(c => c.polygon);
  return [rect(Math.min(...p.map(p => p[0])),Math.min(...p.map(p => p[1])),Math.max(...p.map(p => p[0])),Math.max(...p.map(p => p[1])),Math.min(...cells.map(c => c.low)),Math.max(...cells.map(c => c.high)))];
}
// Pilot cells are rectangular prisms. Planner uses interval gaps in local coordinates;
// the independent Python grader uses project-coordinate convex meshes and GJK.
function distance(a: Cell, b: Cell): number {
  const ax = a.polygon.map(p => p[0]), ay = a.polygon.map(p => p[1]);
  const bx = b.polygon.map(p => p[0]), by = b.polygon.map(p => p[1]);
  return Math.hypot(Math.max(0,Math.min(...ax)-Math.max(...bx),Math.min(...bx)-Math.max(...ax)),Math.max(0,Math.min(...ay)-Math.max(...by),Math.min(...by)-Math.max(...ay)),Math.max(0,a.low-b.high,b.low-a.high));
}
function penetrates(a: Cell,b: Cell): boolean {
  const aa=aggregate([a])[0], bb=aggregate([b])[0]; if (!aa || !bb) return false;
  const ax=aa.polygon.map(p=>p[0]), ay=aa.polygon.map(p=>p[1]), bx=bb.polygon.map(p=>p[0]), by=bb.polygon.map(p=>p[1]);
  return Math.min(...ax)<Math.max(...bx)-1e-8 && Math.max(...ax)>Math.min(...bx)+1e-8 && Math.min(...ay)<Math.max(...by)-1e-8 && Math.max(...ay)>Math.min(...by)+1e-8 && a.low<b.high-1e-8 && a.high>b.low+1e-8;
}
export function candidate(scene: Scene,side: 1|-1): Cell {
  const h=scene.task.cube/2, y=side*(.1+scene.task.clearance+h);
  return rect(scene.task.station-h,y-h,scene.task.station+h,y+h,scene.task.base,scene.task.base+scene.task.cube);
}
export function inspectCandidate(scene: Scene,side: 1|-1,mode: 'summary'|'tools'|'progressive') {
  const c=candidate(scene,side), y=c.polygon.map(p=>p[1]);
  let exactChecks=0;
  const distances: {id:string; distance:number}[]=[];
  let collision=false;
  for (const object of scene.objects) {
    const box=aggregate(object.cells);
    const cells=mode==='summary'?box:object.cells;
    if (mode!=='summary') exactChecks+=cells.length;
    if (object.pin.object!==scene.task.support && cells.some(b=>penetrates(c,b))) collision=true;
    if (object.pin.object!==scene.task.support && cells.length) distances.push({id:object.pin.object,distance:Math.min(...cells.map(b=>distance(c,b)))});
  }
  distances.sort((a,b)=>a.distance-b.distance || a.id.localeCompare(b.id));
  const support=scene.objects.find(o=>o.pin.object===scene.task.support);
  const supportFits=!!support?.cells.some(b=>b.high===scene.task.base && c.polygon.every(([x,y])=>x>=Math.min(...b.polygon.map(p=>p[0])) && x<=Math.max(...b.polygon.map(p=>p[0])) && y>=Math.min(...b.polygon.map(p=>p[1])) && y<=Math.max(...b.polygon.map(p=>p[1]))));
  return {side,valid:!collision && supportFits && Math.min(...y)>=scene.task.roomY[0] && Math.max(...y)<=scene.task.roomY[1],nearest:distances[0]?.id??'',exactChecks};
}
export function proposal(scene: Scene, side: 1|-1,nearest: string): Answer {
  const c=candidate(scene,side), a=c.polygon[0], b=c.polygon[2]; if(!a||!b) throw new Error('candidate');
  return {kind:'proposal',center:projectPoint(scene,[(a[0]+b[0])/2,(a[1]+b[1])/2,(c.low+c.high)/2]),yawDegrees:scene.product.degrees+scene.occurrence.degrees,side,target:scene.task.target,wall:scene.task.wall,support:scene.task.support,level:scene.task.level,room:scene.task.room,adjacent:scene.task.wall.object,nearest};
}
export function context(scene: Scene, arm: Arm): unknown {
  const common={version:'225-v1',scene:scene.id,status:scene.status,currentRevision:scene.revision,task:scene.task,sourceUnit:scene.unit,outputUnit:'m',frame:'project-z-up',product:scene.product,occurrence:scene.occurrence};
  if(arm==='image') return {...common,warning:'View can omit hidden/occluded geometry; exact geometry unavailable.',view:svg(scene)};
  if(arm==='raw') return {...common,geometryMeaning:'Union of convex solids. Each solid lists bottom then top polygon vertices; source units before product/occurrence transforms.',objects:scene.objects.map(o=>({...o,solidsVerticesSourceUnits:o.cells.map(c=>vertices({...scene,product:{degrees:0,offset:[0,0,0]},occurrence:{degrees:0,offset:[0,0,0]}},[c]).map(p=>p.map(n=>n*(scene.unit==='mm'?1000:1)))),cells:undefined}))};
  if(arm==='summary') return {...common,objects:scene.objects.map(o=>({pin:o.pin,kind:o.kind,level:o.level,room:o.room,text:o.text,localBounds:aggregate(o.cells),projectAabb:bounds(vertices(scene,o.cells))}))};
  return {...common,objects:scene.objects.map(o=>({pin:o.pin,kind:o.kind,level:o.level,room:o.room,text:o.text})),api:'inspect(side: 1|-1) -> {valid,nearest}; read-only geometry oracle, not write authority',...(arm==='hybrid'?{view:svg(scene)}:{})};
}
export function svg(scene: Scene): string {
  const shapes=scene.objects.filter(o=>!o.hidden && o.kind!=='Slab').flatMap(o=>o.cells.filter(c=>c.low<1.5 && c.high>0).map(c=>`<polygon points="${c.polygon.map(([x,y])=>`${80+x*60},${220-y*60}`).join(' ')}" fill="${o.pin.object==='w1'?'#587ca2':'#b98263'}" stroke="white"/><text x="${80+(c.polygon[0]?.[0]??0)*60}" y="${210-(c.polygon[0]?.[1]??0)*60}" font-size="12">${o.pin.object}</text>`));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="420"><rect width="480" height="420" fill="#eee"/>${shapes.join('')}<text x="10" y="400">top segmentation; w1 wall; display is not complete geometry</text></svg>`;
}
