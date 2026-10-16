// Bounded original static-mesh attribute extraction. No render GLB changes.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using FrostySdk.Ebx;
using FrostySdk.Resources;
using MESH = FrostySdk.Resources.KfpaShNjvicnKuxFGsstgYcOEjJ;
class NativeTangentWitness {
 static string root=System.Environment.GetEnvironmentVariable("BF2_REPO_ROOT")??System.IO.Directory.GetCurrentDirectory(),runtime=root+"/tools/frosty-1.0.5.2",work=root+"/tools/bf2-extract/work",output=root+"/exports/materials/native-tangent-witness";
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode)]static extern IntPtr LoadLibrary(string path);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode)]static extern bool SetDllDirectory(string path);
 static string Hash(byte[] bytes){using(var h=SHA256.Create())return BitConverter.ToString(h.ComputeHash(bytes)).Replace("-","").ToLowerInvariant();}
 static byte[] Bytes(float[] values){var bytes=new byte[values.Length*4];Buffer.BlockCopy(values,0,bytes,0,bytes.Length);return bytes;}
 static int Main(){
  if(Hash(File.ReadAllBytes(runtime+"/FrostySdk.dll")).ToUpperInvariant()!=Historical.ExpectedSdkHash)throw new Exception("SDK hash mismatch");
  if(Hash(File.ReadAllBytes(work+"/Profiles/StarWarsIISDK.dll")).ToUpperInvariant()!=Historical.ExpectedGameSdkHash)throw new Exception("Schema hash mismatch");
  Directory.SetCurrentDirectory(work);SetDllDirectory(null);LoadLibrary(work+"/ThirdParty/libzstd.1.1.5.dll");
  AppDomain.CurrentDomain.AssemblyResolve+=(sender,e)=>{string name=new AssemblyName(e.Name).Name;if(name=="EbxClasses")return Assembly.LoadFrom(work+"/Profiles/StarWarsIISDK.dll");foreach(string prefix in new[]{runtime,work+"/ThirdParty"})if(File.Exists(prefix+"/"+name+".dll"))return Assembly.LoadFrom(prefix+"/"+name+".dll");return null;};
  return Run();
 }
 [MethodImpl(MethodImplOptions.NoInlining)]static int Run(){
  var h=new Historical();h.ProfileOnly();h.Open("C:/Games/Star Wars - Battlefront 2");Directory.CreateDirectory(output);var records=new List<object>();
  var attribute=typeof(ConvertAssets).GetMethod("Attribute",BindingFlags.NonPublic|BindingFlags.Static);
  foreach(string suffix in new[]{"dsi_wall_01_368_a_mesh","dsi_wall_01_w256_h128_a_mesh"}){
   var entry=h.Ebx("objects/architecture/_galacticempire/deathstar_interior/"+suffix);var asset=h.Decode(entry).RootObject;ulong rid=(ResourceRef)J.Get(asset,"MeshSetResource");var resource=h.Res(rid);var mesh=(MESH)h.Mesh(resource);
   if(mesh.Type!=MeshType.MeshType_Rigid)throw new Exception("Only rigid witnesses are in scope");
   int level=0;var lod=mesh.Lods[level];byte[] bytes;
   if(lod.ChunkId==Guid.Empty)bytes=lod.InlineData;else using(var source=h.Raw(h.Chunk(lod.ChunkId)))using(var stream=new MemoryStream()){source.CopyTo(stream);bytes=stream.ToArray();}
   int primitive=0;
   for(int sectionIndex=0;sectionIndex<lod.Sections.Count;sectionIndex++){
    var section=lod.Sections[sectionIndex];if(string.IsNullOrEmpty(section.Name)||section.VertexCount==0||section.PrimitiveCount==0)continue;
    var declaration=section.GeometryDeclDesc[0];var fields=new List<object>();var localOffsets=new int[declaration.Streams.Length];
    foreach(var element in declaration.Elements.Where(e=>e.Usage!=VertexElementUsage.Unknown)){
     string usage=element.Usage.ToString();int stream=element.StreamIndex,local=localOffsets[stream];localOffsets[stream]+=element.Size;
     int stride=declaration.Streams[stream].VertexStride;long start=section.VertexOffset;
     for(int i=0;i<stream;i++)start+=(long)declaration.Streams[i].VertexStride*section.VertexCount;
     var first=ConvertAssets.Components(bytes,checked((int)(start+local)),element.Format);int components=first.Length;
     var values=(float[])attribute.Invoke(null,new object[]{bytes,section,element.Usage,components});
     var raw=new byte[checked((int)section.VertexCount*element.Size)];
     for(int i=0;i<section.VertexCount;i++)Buffer.BlockCopy(bytes,checked((int)(start+(long)i*stride+local)),raw,i*element.Size,element.Size);
     string stem=entry.Guid+"-lod0-primitive"+primitive+"-"+usage;
     File.WriteAllBytes(output+"/"+stem+".raw.bin",raw);File.WriteAllBytes(output+"/"+stem+".f32.bin",Bytes(values));
     fields.Add(J.Obj("usage",usage,"format",element.Format.ToString(),"stream",stream,"size",element.Size,"declaredOffset",element.Offset,"traversedOffset",local,"streamStart",start,"stride",stride,"components",components,"rawFile",stem+".raw.bin","rawSha256",Hash(raw),"floatFile",stem+".f32.bin","floatSha256",Hash(Bytes(values)),"first",values.Take(components*3).ToArray()));
    }
    var indexBytes=new byte[section.PrimitiveCount*3*4];int width=lod.IndexUnitSize/8;
    for(int i=0;i<indexBytes.Length/4;i++){int at=checked((int)(lod.VertexBufferSize+(section.StartIndex+i)*(long)width));uint value=width==2?BitConverter.ToUInt16(bytes,at):BitConverter.ToUInt32(bytes,at);Buffer.BlockCopy(BitConverter.GetBytes(value),0,indexBytes,i*4,4);}
    string indexFile=entry.Guid+"-lod0-primitive"+primitive+".indices.bin";File.WriteAllBytes(output+"/"+indexFile,indexBytes);
    records.Add(J.Obj("assetId",entry.Guid.ToString(),"meshName",entry.Name,"sourceLod",level,"primitiveIndex",primitive++,"sourceSectionIndex",sectionIndex,"sourceMaterialId",section.MaterialId,"sectionName",section.Name,"vertexCount",section.VertexCount,"indexCount",section.PrimitiveCount*3,"indexFile",indexFile,"indexSha256",Hash(indexBytes),"fields",fields,"resource",h.Entry(resource),"chunkGuid",lod.ChunkId.ToString(),"chunkSha256",Hash(bytes),"meshType",mesh.Type.ToString(),"vertexOffset",section.VertexOffset));
   }
  }
  J.Save(output+"/manifest.json",J.Obj("evidenceId","BF2-NATIVE-TANGENT-WITNESS-001","records",records,"coordinateConversion","none; original source components and raw bytes retained","limitations",new[]{"Source attribute extraction does not by itself establish the native conversion into the shader's prepared stream."}));
  Console.WriteLine("Recovered original tangent witness sections: "+records.Count);return 0;
 }
}
