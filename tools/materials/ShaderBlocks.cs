using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.Security.Cryptography;

// Read-only adapter for the pre-1.0.5.4 split shader depot format.
// Layout reference: tools/frosty-source/FrostyCmd/ShaderBlockDepotDump.cs.
// Every decoded parameter retains its raw type/hash/bytes and resource identity.
static class ShaderBlocks {
 public static int TextureIndex(Historical h,string namesFile,string output){
  var rows=new List<object>();var errors=new List<object>();
  foreach(string name in File.ReadAllLines(namesFile).Where(s=>!string.IsNullOrWhiteSpace(s)).Distinct(StringComparer.OrdinalIgnoreCase))try{
   var e=h.Ebx(name);if(e==null)throw new Exception("Texture EBX not found");
   var a=h.Decode(e);rows.Add(J.Obj("name",e.Name,"fileGuid",e.Guid.ToString(),"rootInstanceGuid",a.RootInstanceGuid.ToString(),"sha1",e.Sha1.ToString()));
  }catch(Exception ex){errors.Add(J.Obj("name",name,"error",ex.GetBaseException().Message));}
  J.Save(Path.Combine(output,"texture-identities.json"),J.Obj("evidenceId","LOCAL-TEXTURE-IDENTITY-001","textures",rows,"errors",errors,"complete",errors.Count==0));
  Console.WriteLine("Texture identity index: "+rows.Count+" metadata records, "+errors.Count+" errors; no texture pixel chunks exported");return errors.Count==0?0:3;
 }
 public static int Dump(Historical h,string namesFile,string output) {
  var names=new HashSet<string>(File.ReadAllLines(namesFile).Where(s=>!string.IsNullOrWhiteSpace(s)).Select(s=>s.Trim()),StringComparer.OrdinalIgnoreCase);
  var roots=h.Res().Where(r=>r.ResType==3639990959u && names.Any(n=>r.Name.StartsWith(n+"_entry_",StringComparison.OrdinalIgnoreCase))).ToList();
  var pending=new Queue<ulong>(roots.Select(r=>r.ResRid));var seen=new HashSet<ulong>();var blocks=new List<object>();var errors=new List<object>();
  var known=new Dictionary<uint,string>();
  foreach(string n in new[]{"BaseColor","_BaseColor","Basecolor","CS","_CS","CW","MSR","MSW","NS","NW","_NAM_texcoord0","__NormalEmissiveAO","Normal","_Normal","Normals","Emissive","BakedTexture","Diffuse","Color","Roughness","Metallic","Smoothness","AOTexture","NormalDetail","Base_CS_Input","Tiling_CS_Input","Tiling_CS_NM","Unique_RGBA_In","RGBA","__WearMap","__IdMap"})foreach(string s in new[]{n,n.ToLowerInvariant(),n+"-Array"})if(!known.ContainsKey(Fnv(s)))known[Fnv(s)]=s;
  while(pending.Count>0) {
   ulong rid=pending.Dequeue();if(!seen.Add(rid))continue;
   if(seen.Count>20000)throw new Exception("Shader depot traversal budget exceeded");
   var e=h.Res(rid);if(e==null){errors.Add(J.Obj("resourceId",rid.ToString(),"error","Missing resource"));continue;}
   try {
    if(e.ResMeta.Length<16)throw new Exception("Short resource metadata");
    int kind=BitConverter.ToInt32(e.ResMeta,12);byte[] bytes;
    using(var s=h.Raw(e))using(var m=new MemoryStream()){s.CopyTo(m);bytes=m.ToArray();}
    var b=J.Obj("source",h.Entry(e),"kind",kind,"bytes",bytes.Length);using(var sha=SHA256.Create())b["sha256"]=BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-","").ToLowerInvariant();
    using(var r=new BinaryReader(new MemoryStream(bytes))) {
     b["hash"]=r.ReadUInt64().ToString();long offset=r.ReadInt64();b["pointer"]=offset;
     if(kind==0||kind==2) {
      int count=r.ReadInt32();if(count<0||count>10000)throw new Exception("Invalid child count");Align(r,16);
      var children=new List<string>();for(int i=0;i<count;i++){ulong child=r.ReadUInt64();children.Add(child.ToString());pending.Enqueue(child);}b["children"]=children;
     } else if(kind==1||kind==3) {
      int size=r.ReadInt32();b["declaredSize"]=size;
      if(kind==3){b["lod"]=r.ReadInt32();b["meshGuid"]=new Guid(r.ReadBytes(16)).ToString();}
      Align(r,16);int count=r.ReadInt32();if(count<0||count>10000)throw new Exception("Invalid parameter count");
      var parameters=new List<object>();for(int i=0;i<count;i++){
       long location=r.BaseStream.Position;ulong packed=r.ReadUInt64();uint type=r.ReadUInt32();ushort used=r.ReadUInt16();uint hash=((uint)r.ReadUInt16()<<16)|(uint)(packed>>48);int length=r.ReadInt32();if(type==0xad0abfd3)length=16;
       if(length<0||length>1048576||length>r.BaseStream.Length-r.BaseStream.Position)throw new Exception("Parameter length outside resource");byte[] value=r.ReadBytes(length);string label;
       var p=J.Obj("offset",location,"nameHash",hash,"name",known.TryGetValue(hash,out label)?label:null,"typeHash",type,"used",used,"rawHex",BitConverter.ToString(value).Replace("-","").ToLowerInvariant(),"packedFlags",(packed&0x0000FFFFFFFFFFFFUL).ToString());
       if(type==0xad0abfd3){var guid=new Guid(value);var texture=h.Ebx(guid);p["textureGuid"]=guid.ToString();p["textureName"]=texture==null?null:texture.Name;}
       else if(type==0x0b87fa95&&length==16)p["value"]=Enumerable.Range(0,4).Select(k=>BitConverter.ToSingle(value,k*4)).ToArray();
       else if(type==0x7f39a7b4&&length==4)p["value"]=BitConverter.ToSingle(value,0);
       else if(type==0xb0bc3c22&&length==4)p["value"]=BitConverter.ToUInt32(value,0);
       else if(type==0x0cc971f4&&length==8)p["value"]=BitConverter.ToUInt64(value,0).ToString();
       parameters.Add(p);
      }b["parameters"]=parameters;
     } else throw new Exception("Unrecognized split shader block kind "+kind);
     b["parsedBytes"]=r.BaseStream.Position;b["remainingBytes"]=r.BaseStream.Length-r.BaseStream.Position;
    }
    blocks.Add(b);
   }catch(Exception ex){errors.Add(J.Obj("resourceId",rid.ToString(),"name",e.Name,"error",ex.GetBaseException().Message));}
  }
  J.Save(Path.Combine(output,"shader-blocks.json"),J.Obj("evidenceId","LOCAL-SHADERBLOCKS-001","roots",roots.Select(r=>J.Obj("name",r.Name,"resourceId",r.ResRid.ToString())).ToArray(),"requestedNames",names.ToArray(),"blocks",blocks,"errors",errors,"complete",roots.Count>0&&errors.Count==0,"limitations",new[]{"Parameter names are exact FNV1 hash matches to a bounded candidate dictionary; unmapped hashes remain null.","Texture GUID links are source observations. Shader semantics and graph precedence still require reconstruction.","Split-block parser follows historical Frosty source; full RVM shader programs are not decoded."}));
  Console.WriteLine("Shader blocks: "+roots.Count+" roots, "+blocks.Count+" blocks, "+errors.Count+" errors");return roots.Count>0&&errors.Count==0?0:3;
 }
 static void Align(BinaryReader r,int alignment){r.BaseStream.Position=(r.BaseStream.Position+alignment-1)&~(alignment-1);if(r.BaseStream.Position>r.BaseStream.Length)throw new EndOfStreamException();}
 // Frosty's Fnv1.HashString uses its historical 5381/33 variant (fnv.cpp).
 static uint Fnv(string s){uint h=5381;foreach(byte c in System.Text.Encoding.UTF8.GetBytes(s)){h=unchecked(h*33);h^=c;}return h;}
}
