using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using FrostySdk.Ebx;
using MESH = FrostySdk.Resources.KfpaShNjvicnKuxFGsstgYcOEjJ;
using EBX = FrostySdk.Managers.VmDbVirBuUgxTCCQioDVXY;

static class MeshInfo {
 public static int Dump(Historical h,IEnumerable<EBX> entries,string output) {
  var rows=new List<object>();var errors=new List<object>();
  // This private field is the uint read immediately after the FullName/Name
  // offsets in the pinned constructor at IL_00bd/IL_00c2. The modern analogue
  // calls the same field MeshSet.NameHash. Validate against raw RES bytes too.
  var hashField=typeof(MESH).GetField("QnovLdxyFItCydoxDxeatlFwBqueBXRge",BindingFlags.NonPublic|BindingFlags.Instance);
  if(hashField==null||hashField.FieldType!=typeof(uint))throw new Exception("Pinned MeshSet name-hash field not found");
  foreach(var entry in entries)try {
   object root=h.Decode(entry).RootObject;object resource=J.Get(root,"MeshSetResource");
   if(!(resource is ResourceRef))throw new Exception("Asset does not reference MeshSetResource");
   ulong rid=(ResourceRef)resource;var res=h.Res(rid);if(res==null)throw new Exception("MeshSet resource missing");
   var mesh=(MESH)h.Mesh(res);uint nameHash=(uint)hashField.GetValue(mesh);
   // 32-byte AABB + seven pointer slots (six LOD + profile extra) + two
   // name offsets. The historical MaxLodCount includes the extra pointer.
   int hashOffset=32+mesh.MaxLodCount*8+16;uint rawHash,rawType;
   using(var stream=h.Raw(res))using(var reader=new BinaryReader(stream)) {stream.Position=hashOffset;rawHash=reader.ReadUInt32();rawType=reader.ReadUInt32();}
   if(rawHash!=nameHash||rawType!=(uint)mesh.Type)throw new Exception("Raw MeshSet header disagrees with decoded name hash or mesh type");
   var lods=new List<object>();
   for(int i=0;i<mesh.Lods.Count;i++) {
    var lod=mesh.Lods[i];var sections=new List<object>();
    for(int j=0;j<lod.Sections.Count;j++) {
     var sec=lod.Sections[j];
     sections.Add(J.Obj("index",j,"materialId",sec.MaterialId,"name",sec.Name,"vertexOffset",sec.VertexOffset,"vertexCount",sec.VertexCount,"startIndex",sec.StartIndex,"primitiveCount",sec.PrimitiveCount,"primitiveType",sec.PrimitiveType.ToString(),"exportedByStaticConverter",!string.IsNullOrEmpty(sec.Name)&&sec.VertexCount>0&&sec.PrimitiveCount>0));
    }
    lods.Add(J.Obj("index",i,"type",lod.Type.ToString(),"chunkGuid",lod.ChunkId.ToString(),"indexUnitSize",lod.IndexUnitSize,"vertexBufferSize",lod.VertexBufferSize,"indexBufferSize",lod.IndexBufferSize,"string01",lod.String01,"string02",lod.String02,"string03",lod.String03,"sections",sections));
   }
   rows.Add(J.Obj("name",entry.Name,"guid",entry.Guid.ToString(),"entry",h.Entry(entry),"resourceId",rid.ToString(),"resource",h.Entry(res),"meshType",mesh.Type.ToString(),"meshFullName",mesh.FullName,"meshName",mesh.Name,"meshSetNameHash",nameHash,"meshSetNameHashHex","0x"+nameHash.ToString("x8"),"nameHashSource",J.Obj("privateField",hashField.Name,"constructorIl","IL_00bd ReadUInt32 -> IL_00c2 stfld","rawResourceOffset",hashOffset,"rawValueAgrees",true),"lods",lods));
  }catch(Exception ex){errors.Add(J.Obj("name",entry.Name,"error",ex.GetBaseException().ToString()));Console.Error.WriteLine("[mesh-info error] "+entry.Name+": "+ex.GetBaseException().Message);}
  J.Save(Path.Combine(output,"mesh-info.json"),J.Obj("evidenceId","BF2-MESHSET-METADATA-001","createdAtUtc",DateTime.UtcNow.ToString("o"),"complete",errors.Count==0&&rows.Count>0,"results",rows,"errors",errors,"geometryWritten",false,"note","NameHash comes from shipped MeshSet RES, not EBX name hashing. Original LOD/section indices include non-rendering sections."));
  Console.WriteLine("MeshSet metadata: "+rows.Count+" complete, "+errors.Count+" errors");return errors.Count==0&&rows.Count>0?0:3;
 }
}
