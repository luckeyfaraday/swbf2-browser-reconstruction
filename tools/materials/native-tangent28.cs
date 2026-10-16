// Narrow continuation of the proven 36-byte source tangent witness. Read-only
// source access, no native converter inference and no browser asset mutation.
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
class NativeTangent28 {
 static string root=System.Environment.GetEnvironmentVariable("BF2_REPO_ROOT")??System.IO.Directory.GetCurrentDirectory(),runtime=root+"/tools/frosty-1.0.5.2",work=root+"/tools/bf2-extract/work",output=root+"/exports/materials/native-tangent-coverage";
 static long written=0;static int selectedStride=28;
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode)]static extern IntPtr LoadLibrary(string path);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode)]static extern bool SetDllDirectory(string path);
 static string Hash(byte[] bytes){using(var h=SHA256.Create())return BitConverter.ToString(h.ComputeHash(bytes)).Replace("-","").ToLowerInvariant();}
 static void Write(string name,byte[] bytes){written+=bytes.Length;if(written>16*1024*1024)throw new Exception("Bounded tangent export exceeds16MiB");File.WriteAllBytes(output+"/"+name,bytes);}
 static int Main(string[] args){
  if(args.Length>0)output=Path.GetFullPath(args[0]);if(args.Length>1)selectedStride=int.Parse(args[1]);
  if(selectedStride!=28)throw new Exception("Unproven tangent stream stride");
  if(Hash(File.ReadAllBytes(runtime+"/FrostySdk.dll")).ToUpperInvariant()!=Historical.ExpectedSdkHash)throw new Exception("SDK hash mismatch");
  if(Hash(File.ReadAllBytes(work+"/Profiles/StarWarsIISDK.dll")).ToUpperInvariant()!=Historical.ExpectedGameSdkHash)throw new Exception("Schema hash mismatch");
  Directory.SetCurrentDirectory(work);SetDllDirectory(null);LoadLibrary(work+"/ThirdParty/libzstd.1.1.5.dll");
  AppDomain.CurrentDomain.AssemblyResolve+=(sender,e)=>{string name=new AssemblyName(e.Name).Name;if(name=="EbxClasses")return Assembly.LoadFrom(work+"/Profiles/StarWarsIISDK.dll");foreach(string prefix in new[]{runtime,work+"/ThirdParty"})if(File.Exists(prefix+"/"+name+".dll"))return Assembly.LoadFrom(prefix+"/"+name+".dll");return null;};
  return Run();
 }
 [MethodImpl(MethodImplOptions.NoInlining)]static int Run(){
  var h=new Historical();h.ProfileOnly();h.Open("C:/Games/Star Wars - Battlefront 2");Directory.CreateDirectory(output);var records=new List<object>();
  string[] usages=new[]{"Pos","BinormalSign","Normal","Tangent","TexCoord0"};
  string[] formats=new[]{"Half3","Half","Half4","Half4","Half2"};
  int[] offsets=new[]{0,6,8,16,24};
  foreach(string line in File.ReadAllLines(output+"/names.txt")){
   var parts=line.Split('|');int level=int.Parse(parts[1]);var selected=new HashSet<int>(parts[2].Split(',').Select(int.Parse));
   var entry=h.Ebx(parts[0]);var asset=h.Decode(entry).RootObject;ulong rid=(ResourceRef)J.Get(asset,"MeshSetResource");var resource=h.Res(rid);var mesh=(MESH)h.Mesh(resource);var lod=mesh.Lods[level];
   byte[] bytes=null;string chunkHash=null;int primitive=0;
   for(int sectionIndex=0;sectionIndex<lod.Sections.Count;sectionIndex++){
    var section=lod.Sections[sectionIndex];if(string.IsNullOrEmpty(section.Name)||section.VertexCount==0||section.PrimitiveCount==0)continue;
    int primitiveIndex=primitive++;if(!selected.Contains(section.MaterialId))continue;
    var declaration=section.GeometryDeclDesc[0];var elements=declaration.Elements.Where(e=>e.Usage!=VertexElementUsage.Unknown).ToArray();var fields=new List<object>();var localOffsets=new int[declaration.Streams.Length];
    bool direct=elements.Length==usages.Length&&declaration.Streams[0].VertexStride==selectedStride;
    for(int i=0;i<elements.Length;i++){
     var e=elements[i];int stream=e.StreamIndex,local=localOffsets[stream];localOffsets[stream]+=e.Size;
     direct&=i<usages.Length&&e.Usage.ToString()==usages[Math.Min(i,usages.Length-1)]&&e.Format.ToString()==formats[Math.Min(i,formats.Length-1)]&&stream==0&&e.Offset==offsets[Math.Min(i,offsets.Length-1)]&&local==e.Offset;
     fields.Add(J.Obj("usage",e.Usage.ToString(),"format",e.Format.ToString(),"stream",stream,"size",e.Size,"declaredOffset",e.Offset,"traversedOffset",local,"stride",declaration.Streams[stream].VertexStride));
    }
    var record=J.Obj("assetId",entry.Guid.ToString(),"meshName",entry.Name,"sourceLod",level,"primitiveIndex",primitiveIndex,"sourceSectionIndex",sectionIndex,"sourceMaterialId",section.MaterialId,"sectionName",section.Name,"vertexCount",section.VertexCount,"indexCount",section.PrimitiveCount*3,"fields",fields,"resource",h.Entry(resource),"chunkGuid",lod.ChunkId.ToString(),"meshType",mesh.Type.ToString(),"vertexOffset",section.VertexOffset,"exactPreparedLayout",direct,"rigidSource",mesh.Type==MeshType.MeshType_Rigid);
    if(direct&&mesh.Type==MeshType.MeshType_Rigid){
     if(bytes==null){if(lod.ChunkId==Guid.Empty)bytes=lod.InlineData;else using(var source=h.Raw(h.Chunk(lod.ChunkId)))using(var stream=new MemoryStream()){source.CopyTo(stream);bytes=stream.ToArray();}chunkHash=Hash(bytes);}
     var vertices=new byte[checked((int)section.VertexCount*selectedStride)];Buffer.BlockCopy(bytes,checked((int)section.VertexOffset),vertices,0,vertices.Length);
     var indices=new byte[checked((int)section.PrimitiveCount*3*4)];int width=lod.IndexUnitSize/8;
     for(int i=0;i<indices.Length/4;i++){int at=checked((int)(lod.VertexBufferSize+(section.StartIndex+i)*(long)width));uint value=width==2?BitConverter.ToUInt16(bytes,at):BitConverter.ToUInt32(bytes,at);Buffer.BlockCopy(BitConverter.GetBytes(value),0,indices,i*4,4);}
     string stem=entry.Guid+"-lod"+level+"-primitive"+primitiveIndex;Write(stem+".vertices.bin",vertices);Write(stem+".indices.bin",indices);
     record["vertexFile"]=stem+".vertices.bin";record["vertexSha256"]=Hash(vertices);record["indexFile"]=stem+".indices.bin";record["indexSha256"]=Hash(indices);record["chunkSha256"]=chunkHash;
    }
    records.Add(record);
   }
  }
  J.Save(output+"/manifest.json",J.Obj("evidenceId","BF2-NATIVE-TANGENT28-001","records",records,"bytesWritten",written,"sourceStride",selectedStride,"scope","Selected source material sections only. Exact requested rigid source layouts retain raw vertex bytes and indices; all other layouts metadata only."));
  Console.WriteLine("Source tangent coverage records: "+records.Count+", bytes: "+written);return 0;
 }
}
