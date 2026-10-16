import json,pathlib,functools,zlib,struct,collections
root=pathlib.Path(__file__).resolve().parents[2];d=json.loads(next((root/'exports/characters/animation-selected').glob('C_HM*')).read_text());targets=set(d['mappings'])
def fnv(s,a=False,seed=2166136261):return functools.reduce(lambda h,c:((h^c)*16777619 if a else (h*16777619)^c)&0xffffffff,s,seed)
def poly(s,m,seed=0,xor=False):return functools.reduce(lambda h,c:((h*m)^c if xor else h*m+c)&0xffffffff,s,seed)
def murmur2(s,seed=0):
 h=seed^len(s);m=0x5bd1e995;n=len(s)//4
 for i in range(n):
  k=struct.unpack_from('<I',s,i*4)[0];k=k*m&0xffffffff;k^=k>>24;k=k*m&0xffffffff;h=((h*m)^k)&0xffffffff
 t=s[n*4:]
 if t:
  for i,v in enumerate(t):h^=v<<(8*i)
  h=h*m&0xffffffff
 h^=h>>13;h=h*m&0xffffffff;h^=h>>15;return h
def murmur3(s,seed=0):
 h=seed;rot=lambda x,n:((x<<n)|(x>>(32-n)))&0xffffffff
 for i in range(len(s)//4):
  k=struct.unpack_from('<I',s,i*4)[0];k=k*0xcc9e2d51&0xffffffff;k=rot(k,15)*0x1b873593&0xffffffff;h^=k;h=(rot(h,13)*5+0xe6546b64)&0xffffffff
 t=s[len(s)//4*4:];k=sum(v<<(8*i)for i,v in enumerate(t))
 if t:k=k*0xcc9e2d51&0xffffffff;k=rot(k,15)*0x1b873593&0xffffffff;h^=k
 h^=len(s);h^=h>>16;h=h*0x85ebca6b&0xffffffff;h^=h>>13;h=h*0xc2b2ae35&0xffffffff;return h^(h>>16)
funcs={'fnv1':fnv,'fnv1a':lambda s:fnv(s,True),'fnv0':lambda s:fnv(s,False,0),'djbadd':lambda s:poly(s,33,5381),'djbxor':lambda s:poly(s,33,5381,True),'djb0':lambda s:poly(s,33),'sdbm':lambda s:poly(s,65599),'crc':zlib.crc32,'murmur2':murmur2,'murmur2magic':lambda s:murmur2(s,0x9747b28c),'murmur3':murmur3}
for name,fn in funcs.items():
 for case in [str,str.lower,str.upper]:
  matches=[(x['name'],fn(case(x['name']).encode()))for x in d['slots'] if fn(case(x['name']).encode())in targets]
  if matches:print(name,case.__name__,len(matches),matches[:8])
for case in [str,str.lower,str.upper]:
 for multiplier,xorafter in [(16777619,True),(16777619,False),(33,True),(33,False),(65599,False)]:
  inv=pow(multiplier,-1,2**32);counts=collections.Counter()
  for x in d['slots']:
   name=case(x['name']).encode()
   for target in targets:
    h=target
    for c in name[::-1]:h=((h*inv)^c)&0xffffffff if xorafter else ((h^c)*inv)&0xffffffff
    counts[h]+=1
  print('seed candidates',case.__name__,multiplier,xorafter,counts.most_common(3))
