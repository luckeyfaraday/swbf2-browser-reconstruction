"""Exact float32 sincos inputs from retained original VS camera fixtures."""
import hashlib,json,math,pathlib,struct
ROOT=pathlib.Path(__file__).resolve().parents[2];OUT=ROOT/'exports/rifle-trail/render-trig-warp';OUT.mkdir(exist_ok=True)
source=(ROOT/'exports/rifle-trail/vertex-warp/input.bin').read_bytes();cases,vertices=struct.unpack_from('<II',source,4);start=16+vertices*20
f=lambda v:struct.unpack('<f',struct.pack('<f',v))[0]
angles=[];associations=[]
for c in range(cases):
 at=start+c*1656;time=struct.unpack_from('<f',source,at+1048)[0];seed=struct.unpack_from('<e',source,at+912+86)[0]
 phase=f(float(math.floor(f(time*20)))+f(float(math.floor(seed))*100))
 pair=[f(f(f(phase+shift)*17)+f(74.4))for shift in(1,101)]
 angles.extend([pair,[seed,seed]]);associations.append({'case':c,'noiseAngles':pair,'rotationAngle':seed})
packed=b''.join(struct.pack('<2f',*a)for a in angles);(OUT/'input.bin').write_bytes(packed)
(OUT/'inputs.json').write_text(json.dumps({'evidenceId':'LOCAL-BLASTER-BOLT-TRIG-WARP-001','sourceVertexInputSha256':hashlib.sha256(source).hexdigest(),'pairs':angles,'associations':associations,'inputSha256':hashlib.sha256(packed).hexdigest()},indent=2))
print(json.dumps({'cases':cases,'probePairs':len(angles),'bytes':len(packed)}))
