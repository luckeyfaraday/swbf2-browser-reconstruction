using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Runtime.CompilerServices;
using FrostySdk.Ebx;
using FrostySdk.Resources;
using MESH = FrostySdk.Resources.KfpaShNjvicnKuxFGsstgYcOEjJ;

// Shares the pinned, read-only historical SDK adapter; writes only selected character data.
class CharacterProgram {
 static Dictionary<string,string> opts = new Dictionary<string,string>();
 static int Main(string[] args) {
  try {
   for(int i=0;i<args.Length;i+=2)opts[args[i].TrimStart('-')]=args[i+1];
   string runtime=Path.GetFullPath(Get("runtime","../frosty-1.0.5.2"));
   string work=Path.GetFullPath(Get("work","../bf2-extract/work"));
   opts["game"]=Path.GetFullPath(Get("game",null));opts["out"]=Path.GetFullPath(Get("out",null));
   // Reuse the adapter's SDK hashes, dependency loader, isolated work and native codec setup.
   int ready=(int)typeof(Program).GetMethod("Main",BindingFlags.Static|BindingFlags.NonPublic).Invoke(null,new object[]{new string[]{"schema","--runtime",runtime,"--work",work,"--types","SkeletonAsset","--out",Path.Combine(opts["out"],"schema.json")}});
   if(ready!=0)return ready;
   return Run();
  }catch(Exception ex){Console.Error.WriteLine(ex.GetBaseException());return 1;}
 }
 static string Get(string k,string fallback){string v;return opts.TryGetValue(k,out v)?v:fallback;}
 static IEnumerable<object> Items(object x){return x==null?Enumerable.Empty<object>():((IEnumerable)x).Cast<object>();}
 static float[] Matrix(object t){var values=new List<float>();foreach(string axis in new string[]{"right","up","forward","trans"}){object v=J.Get(t,axis);foreach(string c in new string[]{"x","y","z"})values.Add(Convert.ToSingle(J.Get(v,c)));values.Add(axis=="trans"?1:0);}return values.ToArray();}
 static float[] Attr(byte[] data,object section,VertexElementUsage usage,int components){return (float[])typeof(ConvertAssets).GetMethod("Attribute",BindingFlags.Static|BindingFlags.NonPublic).Invoke(null,new object[]{data,section,usage,components});}
 [MethodImpl(MethodImplOptions.NoInlining)]static int Run(){
  var h=new Historical();h.ProfileOnly();h.Open(opts["game"]);
  string resourcePrefix=Get("resource-prefix",null);
  if(resourcePrefix!=null){var resources=h.Res().Where(e=>e.Name.StartsWith(resourcePrefix,StringComparison.OrdinalIgnoreCase)).ToArray();J.Save(Path.Combine(opts["out"],"resource-inventory.json"),J.Obj("prefix",resourcePrefix,"count",resources.Length,"resources",resources.Select(e=>h.Entry(e)).ToArray()));Console.WriteLine("Inventory resources: "+resources.Length);return 0;}
  string name=Get("name",null),skeletonName=Get("skeleton","Characters/Rigs/Humanoids/Walrus_HumanMale");
  int lodIndex=int.Parse(Get("lod","1"));
  var entry=h.Ebx(name);if(entry==null)throw new Exception("Missing mesh: "+name);
  var asset=h.Decode(entry);object root=asset.RootObject;
  ulong rid=(ResourceRef)J.Get(root,"MeshSetResource");var mesh=(MESH)h.Mesh(h.Res(rid));var lod=mesh.Lods[lodIndex];
  string output=Path.Combine(opts["out"],Get("id","model"));
  ConvertAssets.Mesh(h,entry,output+".glb",lodIndex,true,false);
  var graph=new EbxJson(g=>{var e=h.Ebx(g);return e==null?null:e.Name;});J.Save(output+".ebx.json",J.Obj("entry",h.Entry(entry),"asset",graph.Asset(asset)));
  var bones=new List<object>();int standardCount=0;
  if(mesh.Type==MeshType.MeshType_Skinned){
   var skEntry=h.Ebx(skeletonName);if(skEntry==null)throw new Exception("Missing skeleton: "+skeletonName);
   var sk=h.Decode(skEntry);object skRoot=sk.RootObject;
   var names=Items(J.Get(skRoot,"BoneNames")).ToArray();var hierarchy=Items(J.Get(skRoot,"Hierarchy")).ToArray();var locals=Items(J.Get(skRoot,"LocalPose")).ToArray();var models=Items(J.Get(skRoot,"ModelPose")).ToArray();standardCount=names.Length;
   if(names.Length!=hierarchy.Length||names.Length!=locals.Length||names.Length!=models.Length)throw new Exception("Skeleton array mismatch");
   for(int i=0;i<names.Length;i++)bones.Add(J.Obj("name",names[i].ToString(),"parent",Convert.ToInt32(hierarchy[i]),"local",Matrix(locals[i]),"model",Matrix(models[i]),"procedural",false));
   object proc=J.Get(root,"SkinnedProceduralAnimation");int n=0;
   foreach(object b in Items(J.Get(proc,"Bones")))bones.Add(J.Obj("name","PROC_"+n++,"parent",J.Get(b,"ParentIndex"),"local",Matrix(J.Get(b,"Pose")),"model",Matrix(J.Get(b,"LocalPose")),"procedural",true));
   foreach(object r in Items(J.Get(proc,"RootPoses"))){int i=Convert.ToInt32(J.Get(r,"Index"));((Dictionary<string,object>)bones[i])["model"]=Matrix(J.Get(r,"LocalPose"));}
   J.Save(output+".skeleton.ebx.json",J.Obj("entry",h.Entry(skEntry),"asset",graph.Asset(sk)));
  }else if(mesh.Type==MeshType.MeshType_Composite){
   foreach(var t in lod.PartTransforms){float[] m=new float[]{t.right.x,t.right.y,t.right.z,0,t.up.x,t.up.y,t.up.z,0,t.forward.x,t.forward.y,t.forward.z,0,t.trans.x,t.trans.y,t.trans.z,1};bones.Add(J.Obj("name","Part_"+bones.Count,"parent",-1,"local",m,"model",m,"procedural",false));}
   standardCount=bones.Count;
  }
  byte[] bytes;
  if(lod.ChunkId==Guid.Empty)bytes=lod.InlineData;else using(var s=h.Raw(h.Chunk(lod.ChunkId)))using(var m=new MemoryStream()){s.CopyTo(m);bytes=m.ToArray();}
  var sections=new List<object>();int total=0,maxJoint=0;int allZero=0;
  foreach(var sec in lod.Sections){
   if(string.IsNullOrEmpty(sec.Name)||sec.VertexCount==0||sec.PrimitiveCount==0)continue;
   var ji=Attr(bytes,sec,VertexElementUsage.BoneIndices,4);var jw=Attr(bytes,sec,VertexElementUsage.BoneWeights,4);
   var ji2=Attr(bytes,sec,VertexElementUsage.BoneIndices2,4);var jw2=Attr(bytes,sec,VertexElementUsage.BoneWeights2,4);
   if(ji==null&&bones.Count>0)throw new Exception("Mesh skin missing JOINTS in "+sec.Name);
   int count=checked((int)sec.VertexCount);var joints=new ushort[count*8];var weights=new float[count*8];
   for(int v=0;v<count;v++){
    float sum=0;
    for(int c=0;c<8;c++){
     float[] indices=c<4?ji:ji2,w=c<4?jw:jw2;int index=v*4+c%4;
     int j=indices==null?0:(int)indices[index];float weight=w==null?0:w[index];
     if(mesh.Type==MeshType.MeshType_Composite&&c==0)weight=1;
     if(weight<=0)j=0;
     // SWBF2 uses direct skeleton indices; bit15 selects the mesh procedural bone array.
     if((j&0x8000)!=0)j=j-0x8000+standardCount;
     if(weight>0&&(j<0||j>=bones.Count))throw new Exception("Joint outside skeleton: "+j+" bones="+bones.Count+" section="+sec.Name);
     joints[v*8+c]=(ushort)j;weights[v*8+c]=weight;sum+=weight;maxJoint=Math.Max(maxJoint,j);
    }
    if(bones.Count>0&&sum==0){allZero++;throw new Exception("Zero skin weight at vertex "+v+" of "+sec.Name);}
    if(sum>0)for(int c=0;c<8;c++)weights[v*8+c]/=sum;
   }
   sections.Add(J.Obj("name",sec.Name,"materialId",sec.MaterialId,"vertexCount",count,"joints",joints,"weights",weights,"boneList",sec.BoneList,"declaration",sec.GeometryDeclDesc[0].Elements.Where(e=>e.Usage!=VertexElementUsage.Unknown).Select(e=>J.Obj("usage",e.Usage.ToString(),"format",e.Format.ToString(),"stream",e.StreamIndex,"offset",e.Offset)).ToArray()));total+=count;
  }
  J.Save(output+".skin.json",J.Obj("schemaVersion",1,"source",name,"sourceGuid",entry.Guid.ToString(),"sourceSha1",entry.Sha1.ToString(),"resourceId",rid.ToString(),"chunkGuid",lod.ChunkId.ToString(),"lod",lodIndex,"meshType",mesh.Type.ToString(),"skeleton",skeletonName,"standardBoneCount",standardCount,"bones",bones,"sections",sections,"vertexCount",total,"maxJoint",maxJoint,"zeroWeightVertices",allZero,"animationsRecovered",false,"bindingRule","SWBF2 direct bone indices; 0x8000 selects mesh procedural bones; ModelPose inverse is bind matrix"));
  Console.WriteLine("Exported "+name+": "+total+" vertices, "+bones.Count+" bones, maximum joint "+maxJoint);return 0;
 }
}
