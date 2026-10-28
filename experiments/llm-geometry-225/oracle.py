"""Independent host grader: project-coordinate convex-hull distance (GJK).

Planner uses local interval arithmetic. This module neither imports planner code
nor uses its valid/nearest results. Only fixed fixture geometry and answers enter.
Cells are convex prism solids; arbitrary IFC/BRep support is outside this pilot.
"""
import itertools
import json
import math
import pathlib
import statistics
import sys
import time

EPS = 1e-6

def add(a, b): return tuple(x+y for x,y in zip(a,b))
def sub(a, b): return tuple(x-y for x,y in zip(a,b))
def mul(a, s): return tuple(x*s for x in a)
def dot(a, b): return sum(x*y for x,y in zip(a,b))

def solve(a, b):
    rows = [list(r)+[v] for r,v in zip(a,b)]
    for i in range(len(b)):
        pivot = max(range(i,len(b)), key=lambda j: abs(rows[j][i]))
        rows[i], rows[pivot] = rows[pivot], rows[i]
        if abs(rows[i][i]) < 1e-14: return None
        div = rows[i][i]
        rows[i] = [x/div for x in rows[i]]
        for j in range(len(b)):
            if i != j:
                fac = rows[j][i]
                rows[j] = [x-fac*y for x,y in zip(rows[j],rows[i])]
    return [r[-1] for r in rows]

def closest(simplex):
    best = None
    for size in range(1,min(4,len(simplex))+1):
        for points in itertools.combinations(simplex,size):
            origin = points[0]
            edges = [sub(p,origin) for p in points[1:]]
            coeff = solve([[dot(a,b) for b in edges] for a in edges],[-dot(a,origin) for a in edges]) if edges else []
            if coeff is None: continue
            weights = [1-sum(coeff)]+coeff
            if min(weights) < -1e-10: continue
            point = tuple(sum(w*p[i] for w,p in zip(weights,points)) for i in range(3))
            if best is None or dot(point,point) < best[0]:
                best = (dot(point,point),point,[p for w,p in zip(weights,points) if w>1e-10])
    if best is None: raise AssertionError('simplex failed')
    return best[1],best[2]

def distance(a,b):
    # Recenter before support arithmetic to avoid cancellation at large offsets.
    anchor = a[0]
    a,b = [sub(p,anchor) for p in a],[sub(p,anchor) for p in b]
    def support(d): return sub(max(a,key=lambda p:dot(p,d)),min(b,key=lambda p:dot(p,d)))
    simplex = [support((1,0,0))]
    v = simplex[0]
    for _ in range(80):
        if dot(v,v)<1e-18: return 0.0
        d = mul(v,-1)
        w = support(d)
        if dot(w,d)-dot(v,d)<1e-12 or w in simplex: return math.sqrt(dot(v,v))
        v,simplex = closest(simplex+[w])
    raise AssertionError('GJK did not converge')

def transform(scene,p):
    for key in ['product','occurrence']:
        frame = scene[key]
        a = math.radians(frame['degrees']); x,y,z=p
        p = (math.cos(a)*x-math.sin(a)*y+frame['offset'][0], math.sin(a)*x+math.cos(a)*y+frame['offset'][1],z+frame['offset'][2])
    return p

def inverse(scene,p):
    for key in ['occurrence','product']:
        frame=scene[key]; x,y,z=sub(p,frame['offset']); a=math.radians(-frame['degrees'])
        p=(math.cos(a)*x-math.sin(a)*y,math.sin(a)*x+math.cos(a)*y,z)
    return p

def solids(scene,obj):
    return [[transform(scene,(x,y,z)) for z in [c['low'],c['high']] for x,y in c['polygon']] for c in obj['cells']]

def cube(center, edge, yaw):
    a=math.radians(yaw); h=edge/2
    return [add(center,(math.cos(a)*x-math.sin(a)*y,math.sin(a)*x+math.cos(a)*y,z)) for z in [-h,h] for x,y in [(-h,-h),(h,-h),(h,h),(-h,h)]]

def inside(poly,p):
    cross=[(poly[(i+1)%len(poly)][0]-v[0])*(p[1]-v[1])-(poly[(i+1)%len(poly)][1]-v[1])*(p[0]-v[0]) for i,v in enumerate(poly)]
    return min(cross)>=-EPS or max(cross)<=EPS

def geometry(scene,answer):
    task=scene['task']; edge=task['cube']; points=cube(answer['center'],edge,answer['yawDegrees'])
    distances={o['pin']['object']:min((distance(points,s) for s in solids(scene,o)),default=math.inf) for o in scene['objects']}
    local=[inverse(scene,p) for p in points]
    support=next((o for o in scene['objects'] if o['pin']['object']==task['support']),None)
    supported=bool(support and any(abs(c['high']-min(p[2] for p in local))<=EPS and all(inside(c['polygon'],p) for p in local[:4]) for c in support['cells']))
    collision=any(d<EPS for name,d in distances.items() if name not in [task['support'],task['wall']['object']])
    room=all(task['roomY'][0]-EPS<=p[1]<=task['roomY'][1]+EPS for p in local)
    return distances,not collision and room and supported

def grade(scene,answer):
    if not isinstance(answer,dict) or answer.get('kind') not in ['proposal','abstain']: return {'solved':False,'violations':['invalid-contract']}
    if answer['kind']=='abstain':
        expected=scene['status'] if scene['status']!='ready' else None
        ok=answer.get('reason')==expected
        return {'solved':ok,'safe':True,'abstain':True,'violations':[],'requiredAbstention':ok}
    failures=[]; task=scene['task']
    if scene['status']!='ready': failures.append(scene['status'])
    if answer.get('wall')!=task['wall'] or answer.get('adjacent')!=task['wall']['object']: failures.append('hallucinated-or-unpinned-id')
    for field in ['target','support','level','room']:
        if answer.get(field)!=task[field]: failures.append(field)
    if not isinstance(answer.get('center'),list) or len(answer['center'])!=3 or not all(isinstance(n,(float,int)) and math.isfinite(n) for n in answer['center']): return {'solved':False,'violations':['invalid-coordinates']}
    if not isinstance(answer.get('yawDegrees'),(int,float)) or not math.isfinite(answer['yawDegrees']): return {'solved':False,'violations':['invalid-yaw']}
    if answer.get('side') not in [-1,1]: failures.append('side')
    d,feasible=geometry(scene,answer)
    wall_distance=d[task['wall']['object']]
    if abs(wall_distance-task['clearance'])>EPS: failures.append('clearance')
    if not feasible: failures.append('collision-support-room')
    local=inverse(scene,answer['center'])
    if abs(local[0]-task['station'])>EPS or abs(local[2]-task['base']-task['cube']/2)>EPS: failures.append('station-height')
    if (1 if local[1]>0 else -1)!=answer.get('side'): failures.append('side-frame')
    if abs((answer['yawDegrees']-scene['product']['degrees']-scene['occurrence']['degrees'])%90)>EPS: failures.append('orientation')
    positive={'center':transform(scene,(task['station'],.1+task['clearance']+task['cube']/2,task['base']+task['cube']/2)), 'yawDegrees':scene['product']['degrees']+scene['occurrence']['degrees']}
    if answer.get('side')==-1 and geometry(scene,positive)[1]: failures.append('preferred-free-side')
    near=[(name,value) for name,value in d.items() if name!=task['support']]
    minimum=min((v for _,v in near),default=math.inf)
    valid_nearest=[n for n,v in near if abs(v-minimum)<EPS]
    if answer.get('nearest') not in valid_nearest: failures.append('nearest-id')
    return {'solved':not failures,'safe':not failures,'abstain':False,'violations':failures,'clearanceMetres':wall_distance if math.isfinite(wall_distance) else None,'nearestIds':valid_nearest}

def selfcheck():
    box=cube((0,0,0),1,0)
    assert abs(distance(box,cube((2,0,0),1,0))-1)<EPS
    assert distance(box,cube((0,0,0),.2,37))<EPS
    assert abs(distance(box,cube((2,2,0),1,0))-math.sqrt(2))<EPS
    assert abs(distance(box,cube((0,0,2),1,0))-1)<EPS
    assert distance(box,cube((.4,.4,0),1,37))<EPS
    for deg in [0,13,37,90,173]:
        assert abs(distance(cube((200000,-100000,2),1,deg),cube((200000+2*math.cos(math.radians(deg)),-100000+2*math.sin(math.radians(deg)),2),1,deg))-1)<EPS

def main():
    selfcheck()
    root=pathlib.Path(sys.argv[1]); data=json.loads((root/'pilot.json').read_text()); scenes={s['id']:s for s in data['scenes']}
    start=time.monotonic(); graded=[]
    for receipt in data['receipts']:
        graded.append({**receipt,'grade':grade(scenes[receipt['scene']],receipt['answer'])})
    # Negative controls prove the grader can reject wrong units, coordinates,
    # yaw, IDs, target, support, stale/missing geometry and a hidden collision.
    good=next(r['answer'] for r in graded if r['scene']=='c01' and r['arm']=='tools')
    controls=[]
    for label,patch,scene_id in [('units',{'center':[2000,850,250]},'c01'),('clearance',{'center':[2,.6,.25]},'c01'),('yaw',{'yawDegrees':37},'c01'),('id',{'nearest':'invented'},'c01'),('target',{'target':'main'},'c01'),('support',{'support':'invented'},'c01'),('stale',{},'c13'),('missing',{},'c12'),('hidden-collision',{},'c05')]:
        result=grade(scenes[scene_id],{**good,**patch}); assert not result['solved'],label
        controls.append({'label':label,'grade':result})
    summary=[]
    for arm in dict.fromkeys(r['arm'] for r in graded):
        rows=[r for r in graded if r['arm']==arm]; first=[r for r in rows if r['repeat']==0]
        summary.append({'arm':arm,'uniqueCases':len(first),'solved':sum(r['grade']['solved'] for r in first),'proposals':sum(r['answer']['kind']=='proposal' for r in first),'abstentions':sum(r['answer']['kind']=='abstain' for r in first),'violations':sum(bool(r['grade']['violations']) for r in first),'inputBytes':sum(r['inputBytes'] for r in first),'calls':sum(r['calls'] for r in first),'timingMs':{'median':statistics.median(r['elapsedMs'] for r in rows),'min':min(r['elapsedMs'] for r in rows),'max':max(r['elapsedMs'] for r in rows)},'repeatOutcomesIdentical':all(grade(scenes[r['scene']],r['answer'])==next(f['grade'] for f in first if f['scene']==r['scene']) for r in rows)})
    result={'fixtureSha256':data['fixtureSha256'],'kind':data['kind'],'summary':summary,'negativeControls':controls,'oracleSelfChecks':10,'gradingSeconds':time.monotonic()-start,'receipts':graded}
    (root/'graded.json').write_text(json.dumps(result,indent=2,allow_nan=False))
    if len(sys.argv)>2:
        trials=json.loads(pathlib.Path(sys.argv[2]).read_text())
        evaluated=[{**t,'grade':grade(scenes[t['scene']],t['answer'])} for t in trials['trials']]
        (root/'llm-graded.json').write_text(json.dumps({'acquisition':trials['acquisition'],'trials':evaluated},indent=2,allow_nan=False))
    print(json.dumps({'summary':summary,'negativeControls':len(controls),'gradingSeconds':result['gradingSeconds']}))

if __name__=='__main__': main()
