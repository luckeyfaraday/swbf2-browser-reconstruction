// Narrow original UV1 extraction. Existing render/collision GLBs are never modified.
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
class BlasterBoltVertex {
 static string root=System.Environment.GetEnvironmentVariable("BF2_REPO_ROOT")??System.IO.Directory.GetCurrentDirectory(),runtime=root+"/tools/frosty-1.0.5.2",work=root+"/tools/bf2-extract/work",output=root+"/exports/rifle-trail/render-material-vertex";
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
  foreach(string line in File.ReadAllLines(root+"/exports/rifle-trail/render-material-vertex-names.txt")){
   var parts=line.Split('|');var entry=h.Ebx(parts[0]);var asset=h.Decode(entry).RootObject;ulong rid=(ResourceRef)J.Get(asset,"MeshSetResource");var resource=h.Res(rid);var mesh=(MESH)h.Mesh(resource);ConvertAssets.Mesh(h,entry,output+"/mesh.glb",0,false,false);
   foreach(int level in parts[1].Split(',').Select(int.Parse)){
    var lod=mesh.Lods[level];byte[] bytes;
    if(lod.ChunkId==Guid.Empty)bytes=lod.InlineData;else using(var source=h.Raw(h.Chunk(lod.ChunkId)))using(var stream=new MemoryStream()){source.CopyTo(stream);bytes=stream.ToArray();}
    int primitive=0;
    for(int sectionIndex=0;sectionIndex<lod.Sections.Count;sectionIndex++){
     var section=lod.Sections[sectionIndex];if(string.IsNullOrEmpty(section.Name)||section.VertexCount==0||section.PrimitiveCount==0)continue;
     var uv0=(float[])attribute.Invoke(null,new object[]{bytes,section,VertexElementUsage.TexCoord0,2});
     var uv1=(float[])attribute.Invoke(null,new object[]{bytes,section,VertexElementUsage.TexCoord1,2});
     var indexBytes=new byte[section.PrimitiveCount*3*4];int width=lod.IndexUnitSize/8;
     for(int i=0;i<indexBytes.Length/4;i++){int at=checked((int)(lod.VertexBufferSize+(section.StartIndex+i)*(long)width));uint value=width==2?BitConverter.ToUInt16(bytes,at):BitConverter.ToUInt32(bytes,at);Buffer.BlockCopy(BitConverter.GetBytes(value),0,indexBytes,i*4,4);}
     string filename=entry.Guid+"-lod"+level+"-primitive"+primitive+".uv1.bin";if(uv1!=null)File.WriteAllBytes(output+"/"+filename,Bytes(uv1));
     var declaration=section.GeometryDeclDesc[0];var extra=new List<object>();
     foreach(var element in declaration.Elements.Where(e=>e.Usage!=VertexElementUsage.Unknown)){
      string usage=element.Usage.ToString();if(usage!="Pos"&&usage!="TexCoord0"&&usage!="Normal"&&usage!="Tangent"&&usage!="Color0"&&usage!="Color1"&&usage!="BoneIndices"&&usage!="TexCoord1"&&usage!="TexCoord2"&&usage!="SubMaterialIndex")continue;
      int components=usage.StartsWith("TexCoord")?2:(usage=="Pos"?3:4);var values=(float[])attribute.Invoke(null,new object[]{bytes,section,element.Usage,components});
      if(values==null)continue;string extraFile=entry.Guid+"-lod"+level+"-primitive"+primitive+"-"+usage+".bin";byte[] extraBytes=Bytes(values);File.WriteAllBytes(output+"/"+extraFile,extraBytes);
      extra.Add(J.Obj("usage",usage,"components",components,"file",extraFile,"sha256",Hash(extraBytes),"bytes",extraBytes.Length,"minimum",values.Min(),"maximum",values.Max(),"first",values.Take(16).ToArray()));
     }
     records.Add(J.Obj("assetId",entry.Guid.ToString(),"meshName",entry.Name,"sourceLod",level,"primitiveIndex",primitive++,"sourceSectionIndex",sectionIndex,"sourceMaterialId",section.MaterialId,"sectionName",section.Name,"vertexCount",section.VertexCount,"indexCount",section.PrimitiveCount*3,"uv0Sha256",uv0==null?null:Hash(Bytes(uv0)),"indexSha256",Hash(indexBytes),"uv1File",uv1==null?null:filename,"uv1Sha256",uv1==null?null:Hash(Bytes(uv1)),"uv1Bytes",uv1==null?0:uv1.Length*4,"resource",h.Entry(resource),"chunkGuid",lod.ChunkId.ToString(),"chunkSha256",Hash(bytes),"vertexOffset",section.VertexOffset,"meshType",mesh.Type.ToString(),"extraAttributes",extra,"elements",declaration.Elements.Where(e=>e.Usage!=VertexElementUsage.Unknown).Select(e=>J.Obj("usage",e.Usage.ToString(),"format",e.Format.ToString(),"stream",e.StreamIndex,"size",e.Size)).ToArray(),"strides",declaration.Streams.Select(s=>s.VertexStride).ToArray()));
    }
   }
  }
  J.Save(output+"/manifest.json",J.Obj("evidenceId","LOCAL-BLASTER-BOLT-VERTEX-001","records",records,"coordinateConversion","none; original UV1 with no V flip","decoder","Pinned original mesh decoder; same stream traversal and float/half conversion as original geometry export","limitations",new[]{"UV1 recovered independently; shader register association must be proven separately."}));
  Console.WriteLine("Recovered original UV records: "+records.Count);return 0;
 }
}
