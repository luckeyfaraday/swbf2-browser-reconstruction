"""Skeleton-association sanity check for an extracted skinned component.

Reads a converter GLB (source bind-space positions) plus its .skin.json and reports,
per section, the distance from every vertex to the bind (ModelPose) position of its
strongest influence, and the bounding box. Used as corroboration only: it cannot
prove the skeleton, but a wrong skeleton produces large distances.
Usage: python vader-skeleton-fit.py COMPONENT.glb COMPONENT.skin.json [REPORT.json]
"""
import json,struct,sys,pathlib
import numpy as np
glb=pathlib.Path(sys.argv[1]).read_bytes();skin=json.loads(pathlib.Path(sys.argv[2]).read_text())
n=struct.unpack_from('<I',glb,12)[0];doc=json.loads(glb[20:20+n]);binoff=28+n
def acc(i):
    a=doc['accessors'][i];v=doc['bufferViews'][a['bufferView']];comp={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}[a['type']]
    dt={5126:np.float32,5123:np.uint16,5125:np.uint32}[a['componentType']]
    return np.frombuffer(glb,dtype=dt,count=a['count']*comp,offset=binoff+v.get('byteOffset',0)+a.get('byteOffset',0)).reshape(a['count'],comp)
bones=skin['bones'];modelpos=np.array([b['model'][12:15] for b in bones]);names=[b['name'] for b in bones]
out={'source':skin['source'],'skeleton':skin['skeleton'],'sections':[]};allpos=[]
for prim,sec in zip(doc['meshes'][0]['primitives'],skin['sections']):
    p=acc(prim['attributes']['POSITION']);allpos.append(p)
    J=np.array(sec['joints']).reshape(-1,8);W=np.array(sec['weights']).reshape(-1,8)
    strongest=J[np.arange(len(J)),W.argmax(1)];d=np.linalg.norm(p-modelpos[strongest],axis=1)
    out['sections'].append({'name':sec['name'],'vertices':len(p),'medianDistanceToStrongestBone':float(np.median(d)),'p95':float(np.percentile(d,95)),'max':float(d.max())})
allp=np.concatenate(allpos);out['bboxMin']=allp.min(0).tolist();out['bboxMax']=allp.max(0).tolist()
out['headBoneModelY']=float(modelpos[names.index('Head')][1]) if 'Head' in names else None
text=json.dumps(out,indent=1);print(text)
if len(sys.argv)>3:pathlib.Path(sys.argv[3]).write_text(text)
