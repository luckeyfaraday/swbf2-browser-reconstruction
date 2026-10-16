"""Corroborate the hilt attachment with decoded Vader animation (no game access).

Samples clips from web/public/assets/characters/vader-animations.glb (separate Vader
animation checkpoint; skeleton-only, Walrus_HumanMale names), places the hilt in Wep_Root
space with the identity offset recorded in saber-evidence.json, and reports the grip
distance to RightHand plus the blade direction (hilt +Y) in model space.
Usage (workspace root): python tools/characters/vader-attach-check.py idle run-fwd block-idle
Output: exports/characters/vader-saber/attach-check.json
"""
import json,struct,sys,pathlib
import numpy as np
def load(p):
    b=open(p,'rb').read();n=struct.unpack_from('<I',b,12)[0];d=json.loads(b[20:20+n]);return d,b,28+n
anim,ab,aoff=load('web/public/assets/characters/vader-animations.glb')
def acc(d,b,off,i):
    a=d['accessors'][i];v=d['bufferViews'][a['bufferView']];comp={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}[a['type']]
    dt={5126:np.float32,5123:np.uint16,5125:np.uint32}[a['componentType']]
    return np.frombuffer(b,dtype=dt,count=a['count']*comp,offset=off+v.get('byteOffset',0)+a.get('byteOffset',0)).reshape(a['count'],comp)
def qm(q):
    x,y,z,w=q;return np.array([[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w)],[2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w)],[2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]])
nodes=anim['nodes'];name2i={n.get('name'):i for i,n in enumerate(nodes)}
parent={}
for i,n in enumerate(nodes):
    for c in n.get('children',[]): parent[c]=i
def pose(clip,t):
    a=next(x for x in anim['animations'] if x['name']==clip)
    trs={i:[np.array(n.get('translation',[0,0,0]),float),np.array(n.get('rotation',[0,0,0,1]),float),np.array(n.get('scale',[1,1,1]),float)] for i,n in enumerate(nodes)}
    for ch in a['channels']:
        s=a['samplers'][ch['sampler']];T=acc(anim,ab,aoff,s['input'])[:,0];V=acc(anim,ab,aoff,s['output'])
        k=min(np.searchsorted(T,t),len(T)-1);path=ch['target']['path'];node=ch['target']['node']
        val=V[k].astype(float)
        if path=='translation':trs[node][0]=val
        elif path=='rotation':trs[node][1]=val/np.linalg.norm(val)
        elif path=='scale':trs[node][2]=val
    W={}
    def world(i):
        if i in W:return W[i]
        t,q,s=trs[i];M=np.eye(4);M[:3,:3]=qm(q)*s;M[:3,3]=t
        W[i]=world(parent[i])@M if i in parent else M;return W[i]
    return world
hilt=np.array([[0,-0.198,0],[0,0.0859,0],[0,-0.07,0]])  # hilt-mesh Y extent ends and a mid-grip point (hilt local Y axis)
rows=[]
for clip in sys.argv[1:]:
    a=next(x for x in anim['animations'] if x['name']==clip)
    dur=max(acc(anim,ab,aoff,s['input'])[-1,0] for s in a['samplers'])
    for t in [0,dur/2]:
        w=pose(clip,t);W=w(name2i['Wep_Root']);RH=w(name2i['RightHand'])[:3,3];LH=w(name2i['LeftHand'])[:3,3]
        pts=(W[:3,:3]@hilt.T).T+W[:3,3]
        blade_dir=W[:3,:3]@np.array([0,1,0])
        rows.append({'clip':clip,'time':round(float(t),3),'wepRoot':W[:3,3].round(4).tolist(),'rightHand':RH.round(4).tolist(),'midGripToRightHand':round(float(np.linalg.norm(pts[2]-RH)),4),'midGripToLeftHand':round(float(np.linalg.norm(pts[2]-LH)),4),'bladeDirectionModel':blade_dir.round(3).tolist()})
        print(rows[-1])
out={'evidenceId':'VADER-SABER-ATTACH-CHECK-001','animationFile':'web/public/assets/characters/vader-animations.glb','animationEvidence':anim.get('extras',{}).get('evidenceId'),'hiltOffset':'identity in Wep_Root space','samples':rows,'note':'corroboration only: depends on the separate animation decode'}
pathlib.Path('exports/characters/vader-saber/attach-check.json').write_text(json.dumps(out,indent=1))
