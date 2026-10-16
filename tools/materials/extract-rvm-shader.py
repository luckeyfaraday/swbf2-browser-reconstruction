"""Trace one source shader's RVM references and disassemble its DXBC locally."""
import pathlib,json,struct,uuid,ctypes,hashlib,argparse,collections
root=pathlib.Path(__file__).resolve().parents[2]
ap=argparse.ArgumentParser();ap.add_argument('--name-hash',type=int,default=1716682052);ap.add_argument('--out',default='exports/materials/floor-shader');ap.add_argument('--directory',default='exports/materials/rvm');a=ap.parse_args();r=root/a.directory
i=json.loads((r/'block-index.json').read_text());b=i['blocks'];d=(r/'0.res').read_bytes();m=json.loads((r/'material-blocks.json').read_text())
surface=next(x for x in m.values() if x['type'].endswith('SurfaceShader') and x['values'][0]['name_hash']==a.name_hash);guid=surface['values'][0]['guid'];guidraw=uuid.UUID(guid).bytes_le
seeds=[k for k,x in b.items() if x['type'].endswith('RvmPermutationSet') and d[x['offset']:x['offset']+16]==guidraw]
assert len(seeds)==1
out=root/a.out;out.mkdir(parents=True,exist_ok=True)
pending=list(seeds);seen=set();edges=[];shaders=[]
lib=ctypes.WinDLL('C:/Windows/System32/d3dcompiler_47.dll');fn=lib.D3DDisassemble
fn.argtypes=[ctypes.c_void_p,ctypes.c_size_t,ctypes.c_uint,ctypes.c_char_p,ctypes.POINTER(ctypes.c_void_p)];fn.restype=ctypes.c_long
def disassemble(raw):
 buf=ctypes.create_string_buffer(raw);blob=ctypes.c_void_p();hr=fn(buf,len(raw),0,None,ctypes.byref(blob))
 if hr<0:raise ValueError('D3DDisassemble HRESULT '+hex(hr&0xffffffff))
 table=ctypes.cast(blob,ctypes.POINTER(ctypes.POINTER(ctypes.c_void_p))).contents
 ptr=ctypes.WINFUNCTYPE(ctypes.c_void_p,ctypes.c_void_p)(table[3])(blob);size=ctypes.WINFUNCTYPE(ctypes.c_size_t,ctypes.c_void_p)(table[4])(blob)
 text=ctypes.string_at(ptr,size).rstrip(b'\0').decode('utf-8');ctypes.WINFUNCTYPE(ctypes.c_ulong,ctypes.c_void_p)(table[2])(blob)
 return text
while pending:
 key=pending.pop()
 if key in seen:continue
 seen.add(key);x=b[key];raw=d[x['offset']:x['offset']+x['size']]
 if len(seen)>15000:raise ValueError('Shader traversal budget exceeded')
 if x['type'].endswith('Dx11ByteCodeElement'):
  assert raw[:4]==b'DXBC';length=struct.unpack_from('<I',raw,24)[0];assert 32<=length<=len(raw);bytecode=raw[:length]
  asm=disassemble(bytecode);file=out/(key+'.asm');file.write_text(asm)
  (out/(key+'.dxbc')).write_bytes(bytecode)
  shaders.append({'hash':key,'sourceOffset':x['offset'],'sourceBytes':x['size'],'bytecodeBytes':length,'sha256':hashlib.sha256(bytecode).hexdigest(),'disassembly':file.name,'stage':next((line.strip() for line in asm.splitlines() if line.strip().startswith(('ps_','vs_','hs_','ds_','cs_','gs_'))),None)})
  continue
 # Encoded references can occupy 4-byte aligned slots even in packed profiles.
 for off in range(0,len(raw)-7,4):
  value=struct.unpack_from('<Q',raw,off)[0];child=f'{value&0xffffffffff:010x}'
  if child in b:
   edges.append({'from':key,'offset':off,'encoded':str(value),'to':child});pending.append(child)
report={'evidenceId':'LOCAL-RVM-SHADER-001','sourceNameHash':a.name_hash,'sourceGuid':guid,'surface':surface,'rootBlocks':seeds,'blocks':{k:b[k] for k in seen},'edges':edges,'shaders':shaders,'limitations':['Reference graph follows stored hash identities; pass selection and full shader semantics are not yet reconstructed.','DXBC is disassembled only, never executed.']}
(out/'graph.json').write_text(json.dumps(report,indent=2));print(json.dumps({'blocks':len(seen),'shaders':len(shaders),'stages':dict(collections.Counter(x['stage'] for x in shaders))}))
