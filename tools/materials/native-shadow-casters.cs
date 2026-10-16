// Read-only original mesh metadata. Never extracts vertex chunks or changes GLBs.
using System;
using System.Collections;
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
class NativeShadowCasters {
 static string root=System.Environment.GetEnvironmentVariable("BF2_REPO_ROOT")??System.IO.Directory.GetCurrentDirectory(),runtime=root+"/tools/frosty-1.0.5.2",work=root+"/tools/bf2-extract/work";
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode)]static extern IntPtr LoadLibrary(string path);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode)]static extern bool SetDllDirectory(string path);
 static string Hash(byte[] bytes){using(var h=SHA256.Create())return BitConverter.ToString(h.ComputeHash(bytes)).Replace("-","").ToLowerInvariant();}
 static string Hex(byte[] bytes){return BitConverter.ToString(bytes).Replace("-","").ToLowerInvariant();}
 static object Flags(object x){object value=J.Get(x,"Flags");return value==null?null:J.Obj("value",Convert.ToUInt64(value).ToString(),"decoderName",value.ToString());}
 static int Main(string[] args){
  if(args.Length<2||args.Length>3)throw new ArgumentException("Expected names-file, output-directory and optional --geometry");
  if(args.Length==3&&args[2]!="--geometry")throw new ArgumentException("Unknown mode");
  if(Hash(File.ReadAllBytes(runtime+"/FrostySdk.dll")).ToUpperInvariant()!=Historical.ExpectedSdkHash)throw new Exception("SDK hash mismatch");
  if(Hash(File.ReadAllBytes(work+"/Profiles/StarWarsIISDK.dll")).ToUpperInvariant()!=Historical.ExpectedGameSdkHash)throw new Exception("Schema hash mismatch");
  Directory.SetCurrentDirectory(work);SetDllDirectory(null);LoadLibrary(work+"/ThirdParty/libzstd.1.1.5.dll");
  AppDomain.CurrentDomain.AssemblyResolve+=(sender,e)=>{string name=new AssemblyName(e.Name).Name;if(name=="EbxClasses")return Assembly.LoadFrom(work+"/Profiles/StarWarsIISDK.dll");foreach(string prefix in new[]{runtime,work+"/ThirdParty"})if(File.Exists(prefix+"/"+name+".dll"))return Assembly.LoadFrom(prefix+"/"+name+".dll");return null;};
  return Run(args[0],args[1],args.Length==3);
 }
 [MethodImpl(MethodImplOptions.NoInlining)]static int Run(string names,string output,bool geometry){
  var h=new Historical();h.ProfileOnly();h.Open("C:/Games/Star Wars - Battlefront 2");Directory.CreateDirectory(output);var records=new List<object>();
  foreach(string line in File.ReadAllLines(names)){
   string name=line.Split('|')[0];var entry=h.Ebx(name);var asset=h.Decode(entry).RootObject;ulong rid=(ResourceRef)J.Get(asset,"MeshSetResource");var resource=h.Res(rid);var mesh=(MESH)h.Mesh(resource);
   byte[] bytes;using(var source=h.Raw(resource))using(var stream=new MemoryStream()){source.CopyTo(stream);bytes=stream.ToArray();}
   var ranges=new List<object>();ranges.Add(J.Obj("offset",0,"hex",Hex(bytes.Take(160).ToArray())));
   var lods=new List<object>();
   for(int level=0;level<mesh.Lods.Count;level++){
    var lod=mesh.Lods[level];long offset=BitConverter.ToInt64(bytes,32+level*8);
    // BF2 resource layout: uint type,maxInstances,sectionCount; uint64 sectionPointer;
    // five packed count/pointer pairs followed by flags. Validate every range.
    var categories=new List<object>();var membership=new int[lod.Sections.Count];
    for(int cat=0;cat<5;cat++){
     int at=checked((int)offset+20+cat*12),count=BitConverter.ToInt32(bytes,at);long pointer=BitConverter.ToInt64(bytes,at+4);
     if(count<0||count>lod.Sections.Count||pointer<0||pointer+count>bytes.Length)throw new Exception("Category range invalid: "+name);
     var indices=bytes.Skip((int)pointer).Take(count).Select(v=>(int)v).ToArray();foreach(int index in indices){if(index>=membership.Length)throw new Exception("Category index invalid");membership[index]|=1<<cat;}
     categories.Add(J.Obj("index",cat,"count",count,"pointer",pointer,"sections",indices));
     if(count!=0)ranges.Add(J.Obj("offset",pointer,"hex",Hex(bytes.Skip((int)pointer).Take(count).ToArray())));
    }
    if(BitConverter.ToInt32(bytes,checked((int)offset+8))!=lod.Sections.Count)throw new Exception("Section count mismatch");
    ranges.Add(J.Obj("offset",offset,"hex",Hex(bytes.Skip((int)offset).Take(96).ToArray())));
    byte[] vertices=null;
    bool selected=geometry&&level==0&&mesh.Type==MeshType.MeshType_Rigid;
    if(selected){if(lod.ChunkId==Guid.Empty)vertices=lod.InlineData;else using(var stream=h.Raw(h.Chunk(lod.ChunkId)))using(var temp=new MemoryStream()){stream.CopyTo(temp);vertices=temp.ToArray();}}
    int primitive=0;var sections=new List<object>();
    for(int index=0;index<lod.Sections.Count;index++){
     var section=lod.Sections[index];bool exported=!string.IsNullOrEmpty(section.Name)&&section.VertexCount!=0&&section.PrimitiveCount!=0;
     object geometryRecord=null;
     if(selected&&section.VertexCount!=0&&section.PrimitiveCount!=0){
      if(section.PrimitiveType.ToString()!="PrimitiveType_TriangleList")throw new Exception("Non-triangle caster witness");
      var attribute=typeof(ConvertAssets).GetMethod("Attribute",BindingFlags.Static|BindingFlags.NonPublic);
      var positions=(float[])attribute.Invoke(null,new object[]{vertices,section,VertexElementUsage.Pos,3});if(positions==null)throw new Exception("Missing position");
      var posBytes=new byte[positions.Length*4];Buffer.BlockCopy(positions,0,posBytes,0,posBytes.Length);
      var indexBytes=new byte[checked((int)section.PrimitiveCount*3*4)];int width=lod.IndexUnitSize/8;
      for(int j=0;j<indexBytes.Length/4;j++){int at=checked((int)(lod.VertexBufferSize+(section.StartIndex+j)*(long)width));uint value=width==2?BitConverter.ToUInt16(vertices,at):BitConverter.ToUInt32(vertices,at);if(value>=section.VertexCount)throw new Exception("Index beyond section");Buffer.BlockCopy(BitConverter.GetBytes(value),0,indexBytes,j*4,4);}
      string prefix=entry.Guid+"-lod"+level+"-section"+index;File.WriteAllBytes(output+"/"+prefix+".positions.bin",posBytes);File.WriteAllBytes(output+"/"+prefix+".indices.bin",indexBytes);
      geometryRecord=J.Obj("positionsFile",prefix+".positions.bin","positionsSha256",Hash(posBytes),"indicesFile",prefix+".indices.bin","indicesSha256",Hash(indexBytes),"chunkSha256",Hash(vertices),"coordinateConversion","none; original rigid positions and winding preserved");
     }
     sections.Add(J.Obj("sourceSectionIndex",index,"browserPrimitiveIndex",exported?(object)primitive++:null,"name",section.Name,"materialId",section.MaterialId,"vertexCount",section.VertexCount,"indexCount",section.PrimitiveCount*3,"categoryMask",membership[index],"geometry",geometryRecord));
    }
    lods.Add(J.Obj("sourceLod",level,"resourceOffset",offset,"flags",Flags(lod),"rawFlags",BitConverter.ToUInt32(bytes,checked((int)offset+80)),"chunkGuid",lod.ChunkId.ToString(),"categories",categories,"sections",sections));
   }
   records.Add(J.Obj("assetId",entry.Guid.ToString(),"meshName",entry.Name,"resource",h.Entry(resource),"resourceBytes",bytes.Length,"resourceSha256",Hash(bytes),"decoderFlags",Flags(mesh),"decoderFlagsOffset",112,"rawHeaderWordOffset",136,"rawHeaderWord",BitConverter.ToUInt32(bytes,136),"meshType",mesh.Type.ToString(),"lods",lods,"sourceByteRanges",ranges));
  }
  J.Save(output+"/metadata.json",J.Obj("evidenceId","BF2-NATIVE-SHADOW-CASTER-METADATA-001","records",records,"decoderSdkSha256",Historical.ExpectedSdkHash.ToLowerInvariant(),"scope",geometry?"Original metadata and selected rigid LOD0 positions/indices":"Original MeshSet resource metadata only; no vertex/index chunks extracted","limitations",new[]{"Pinned decoder Flags reads resource+112; source header word+136 is retained separately and has no assigned semantic bit labels yet.","Category 4 agrees with native MeshSubsetCategoryFlags_Shadow=16; caller selection and override precedence remain separate.","Browser map asset castShadow is hard-coded by finalize-scene.mjs and is not source eligibility evidence.","Original runtime quality/LOD selection and entity-level overrides remain to be linked."}));
  Console.WriteLine("Recovered source caster metadata for "+records.Count+" mesh resources");return 0;
 }
}
