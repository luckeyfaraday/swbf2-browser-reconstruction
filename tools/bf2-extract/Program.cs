using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using EBX = FrostySdk.Managers.VmDbVirBuUgxTCCQioDVXY;

class Program {
 static string root=AppDomain.CurrentDomain.BaseDirectory, runtime,work;
 static Dictionary<string,string> opts=new Dictionary<string,string>();
 [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]static extern bool SetDllDirectory(string path);
 [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]static extern IntPtr LoadLibrary(string path);
 static int Main(string[] args) {
  try {
   if(args.Length==0||args[0]=="help"||args[0]=="--help") {Help();return 0;}
   if(!new string[]{"selftest","schema","inventory","export","raw","mesh","mesh-info","texture","dds-png","shaderblocks","texture-identities"}.Contains(args[0]))throw new ArgumentException("Unknown command "+args[0]);
   for(int i=1;i<args.Length;i++){if(!args[i].StartsWith("--"))throw new ArgumentException("Expected option: "+args[i]);string key=args[i].Substring(2);opts[key]=i+1<args.Length&&!args[i+1].StartsWith("--")?args[++i]:"true";}
   foreach(string key in new string[]{"runtime","work","game","out","input","names"})if(opts.ContainsKey(key))opts[key]=Path.GetFullPath(Require(key));
   foreach(string key in new string[]{"max-assets","depth","lod"})if(opts.ContainsKey(key)){int value;if(!int.TryParse(opts[key],out value)||value<(key=="max-assets"?1:0))throw new ArgumentException("Invalid --"+key);}
   runtime=Path.GetFullPath(Opt("runtime",Path.Combine(root,"..","frosty-1.0.5.2")));
   string sdk=Path.Combine(runtime,"FrostySdk.dll");
   if(Hash(sdk)!="9A08B4176A394F409FEFECEB4833E2F9054AE52AD3FAB8358437D8276EB3D0E5")throw new Exception("Unsupported FrostySdk.dll hash; this adapter is pinned to official 1.0.5.2.");
   if(Hash(Path.Combine(runtime,"Profiles","StarWarsIISDK.dll"))!="F5A57713170D210132464CCFB4C182A80E89C263E8455DBB0746F572E3B5F047")throw new Exception("Unsupported historical game SDK hash.");
   work=Path.GetFullPath(Opt("work",Path.Combine(root,"work")));
   if(Under(work,runtime))throw new Exception("Work directory must not be in vendor runtime.");
   string game=Opt("game",null);if(game!=null&&Under(work,game))throw new Exception("Work directory must not be in game installation.");
   string output=Opt("out",null);if(output!=null&&(Under(output,runtime)||(game!=null&&Under(output,game))))throw new Exception("Output must be outside the game and vendor runtime.");
   PrepareWork();
   AppDomain.CurrentDomain.AssemblyResolve += Resolve;
   return Run(args[0]);
  } catch(Exception e){Console.Error.WriteLine(e);return 1;}
 }
 static Assembly Resolve(object sender,ResolveEventArgs e) {
  string name=new AssemblyName(e.Name).Name;
  if(name=="EbxClasses")return Assembly.LoadFrom(Path.Combine(work,"Profiles","StarWarsIISDK.dll"));
  foreach(string sub in new string[]{"","ThirdParty"}){string f=Path.Combine(runtime,sub,name+".dll");if(File.Exists(f))return Assembly.LoadFrom(f);}
  return null;
 }
 static void PrepareWork(){
  Directory.CreateDirectory(Path.Combine(work,"Profiles"));Directory.CreateDirectory(Path.Combine(work,"ThirdParty"));
  string schemaSource=Path.Combine(runtime,"Profiles","StarWarsIISDK.dll"),schemaTarget=Path.Combine(work,"Profiles","StarWarsIISDK.dll");
  if(!File.Exists(schemaTarget))File.Copy(schemaSource,schemaTarget);
  else if(Hash(schemaTarget)!=Historical.ExpectedGameSdkHash)throw new Exception("Isolated schema hash differs from pinned SDK; use a new --work directory rather than replacing a potentially loaded assembly.");
  foreach(string f in Directory.GetFiles(Path.Combine(runtime,"ThirdParty"),"*.dll")) {string dest=Path.Combine(work,"ThirdParty",Path.GetFileName(f));if(!File.Exists(dest))File.Copy(f,dest);}
  Directory.SetCurrentDirectory(work);SetDllDirectory(null);
  Environment.SetEnvironmentVariable("PATH",Path.Combine(work,"ThirdParty")+";"+Environment.GetEnvironmentVariable("PATH"));
  // Frosty's ZStd binder passes a relative "thirdparty/..." path to LoadLibraryEx.
  // Restore current-directory lookup and scope the dependency PATH to this process.
  // Preload this profile's exact library by absolute path before it binds exports.
  string zstd=Path.Combine(work,"ThirdParty","libzstd.1.1.5.dll");
  if(LoadLibrary(zstd)==IntPtr.Zero)throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(),"Cannot preload "+zstd);
 }
 [MethodImpl(MethodImplOptions.NoInlining)]static int Run(string command){
  if(command=="dds-png"){ConvertAssets.DdsToPng(Require("input"),Require("out"));return 0;}
  var h=new Historical();h.ProfileOnly();
  if(command=="selftest")return Selftest(h);
  if(command=="schema")return Schema(h);
  string game=Path.GetFullPath(Require("game"));
  string output=Path.GetFullPath(Require("out"));
  if(Under(output,game)||Under(output,runtime))throw new Exception("Output must be outside the game and vendor runtime.");
  if(!Directory.Exists(Path.Combine(game,"Data")))throw new Exception("Game root must contain Data.");
  Directory.CreateDirectory(output);
  Console.Error.WriteLine("Opening game data read-only: "+game);
  h.Open(game);
  J.Save(Path.Combine(output,"session.json"),J.Obj("profile",h.ProfileInfo(),"gameRoot",game,"patchHead",h.Fs.Head,"baseHead",h.Fs.Base,"toolSdkSha256",Historical.ExpectedSdkHash,"gameSdkSha256",Historical.ExpectedGameSdkHash,"createdUtc",DateTime.UtcNow.ToString("o"),"command",command,"options",opts));
  if(command=="shaderblocks")return ShaderBlocks.Dump(h,Require("names"),output);
  if(command=="texture-identities")return ShaderBlocks.TextureIndex(h,Require("names"),output);
  if(command=="mesh-info")return MeshInfo.Dump(h,Select(h),output);
  if(command=="inventory")return Inventory(h,output);
  if(command=="export")return Export(h,output);
  if(command=="raw")return Raw(h,output);
  if(command=="mesh"||command=="texture")return ConvertSelected(h,output,command);
  throw new ArgumentException("Unknown command "+command);
 }
 static List<EBX> Select(Historical h){
  string name=Opt("name",null),bundle=Opt("bundle",null),type=Opt("type",null),contains=Opt("contains",bundle==null?"DeathStar02_01":"");
  if(name!=null){var x=h.Ebx(name);if(x==null)throw new Exception("Asset not found: "+name);return new List<EBX>{x};}
  string names=Opt("names",null);if(names!=null){var list=new List<EBX>();foreach(string line in File.ReadAllLines(names).Where(s=>!string.IsNullOrWhiteSpace(s)).Distinct(StringComparer.OrdinalIgnoreCase)){var entry=h.Ebx(line.Trim());if(entry==null)throw new Exception("Asset not found: "+line);if(type==null||Match(entry.Type,type))list.Add(entry);}return list;}
  var wantedBundles=new HashSet<int>();if(bundle!=null)foreach(var b in h.Bundles())if(Match(b.Name,bundle))wantedBundles.Add(h.BundleId(b));
  return h.Ebx().Where(e=>(opts.ContainsKey("all")||Match(e.Name,contains))&&(bundle==null||e.Bundles.Any(id=>wantedBundles.Contains(id)))&&(type==null||Match(e.Type,type))).OrderBy(e=>e.Name).ToList();
 }
 static int Inventory(Historical h,string output){
  var selected=Select(h);
  using(var w=new StreamWriter(Path.Combine(output,"inventory.ebx.ndjson"),false,new System.Text.UTF8Encoding(false)))foreach(var e in selected)w.WriteLine(J.Encode(h.Entry(e)));
  if(opts.ContainsKey("ebx-only")){J.Save(Path.Combine(output,"inventory.summary.json"),J.Obj("selectedEbx",selected.Count,"scope","EBX-only; resource and bundle inventories omitted","complete",selected.Count>0));Console.WriteLine("Indexed selected EBX assets: "+selected.Count);return selected.Count==0?2:0;}
  var ids=new HashSet<int>(selected.SelectMany(e=>e.Bundles));
  J.Save(Path.Combine(output,"inventory.bundles.json"),h.Bundles().Where(b=>ids.Contains(h.BundleId(b))).Select(b=>J.Obj("id",h.BundleId(b),"name",b.Name,"type",b.Type.ToString(),"superBundleId",b.SuperBundleId)).ToArray());
  using(var w=new StreamWriter(Path.Combine(output,"inventory.res.ndjson"),false,new System.Text.UTF8Encoding(false)))foreach(var e in h.Res().Where(e=>e.Bundles.Any(id=>ids.Contains(id))))w.WriteLine(J.Encode(h.Entry(e)));
  using(var w=new StreamWriter(Path.Combine(output,"inventory.chunks.ndjson"),false,new System.Text.UTF8Encoding(false)))foreach(var e in h.Chunks().Where(e=>e.Bundles.Any(id=>ids.Contains(id))))w.WriteLine(J.Encode(h.Entry(e)));
  J.Save(Path.Combine(output,"inventory.summary.json"),J.Obj("selectedEbx",selected.Count,"selectedBundles",ids.Count,"contains",Opt("contains",Opt("bundle",null)==null?"DeathStar02_01":""),"complete",selected.Count>0));
  Console.WriteLine("Indexed selected EBX assets: "+selected.Count);return selected.Count==0?2:0;
 }
 static int Export(Historical h,string output){
  int max=int.Parse(Opt("max-assets","2000")),depth=int.Parse(Opt("depth","0"));
  var q=new Queue<Tuple<EBX,int>>();foreach(var e in Select(h))q.Enqueue(Tuple.Create(e,0));
  var seen=new HashSet<Guid>();var results=new List<object>();var errors=new List<object>();var deferred=new HashSet<Guid>();var copiedResources=new HashSet<ulong>();var copiedChunks=new HashSet<Guid>();int count=0;
  while(q.Count>0&&count<max){var item=q.Dequeue();var e=item.Item1;if(!seen.Add(e.Guid))continue;count++;
   try {
    var asset=h.Decode(e);var graph=new EbxJson(g=>{var d=h.Ebx(g);return d==null?null:d.Name;});var data=graph.Asset(asset);
    string file=FileName(e)+".json";J.Save(Path.Combine(output,"ebx",file),J.Obj("entry",h.Entry(e),"asset",data));
    var deps=asset.Dependencies.Concat(graph.ExternalGuids).Where(g=>g!=Guid.Empty).Distinct().ToArray();
    foreach(Guid id in deps){var dep=h.Ebx(id);if(dep==null)errors.Add(J.Obj("name",e.Name,"kind","unresolved-dependency","guid",id.ToString()));else if(!seen.Contains(id)){if(item.Item2<depth)q.Enqueue(Tuple.Create(dep,item.Item2+1));else deferred.Add(id);}}
    if(opts.ContainsKey("raw")){
     Copy(h.Raw(e),Path.Combine(output,"raw","ebx",FileName(e)+".ebx"));
     foreach(ulong rid in graph.ResourceIds.Where(r=>r!=0)){if(copiedResources.Contains(rid))continue;var res=h.Res(rid);if(res!=null){Copy(h.Raw(res),Path.Combine(output,"raw","res",rid+".res"));var chunks=h.KnownResourceChunks(res);J.Save(Path.Combine(output,"raw","res",rid+".json"),J.Obj("entry",h.Entry(res),"knownReferencedChunks",chunks.Select(g=>g.ToString()).ToArray(),"chunkReferenceParser",res.ResType==(uint)FrostySdk.Managers.ResourceType.MeshSet?"MeshSet":res.ResType==(uint)FrostySdk.Managers.ResourceType.Texture?"Texture":"not-implemented-for-this-resource-type"));foreach(Guid chunkId in chunks)graph.ChunkCandidates.Add(chunkId);copiedResources.Add(rid);}else errors.Add(J.Obj("name",e.Name,"kind","unresolved-resource","rid",rid.ToString()));}
     foreach(Guid id in graph.ChunkCandidates){if(copiedChunks.Contains(id))continue;var chunk=h.Chunk(id);if(chunk!=null){Copy(h.Raw(chunk),Path.Combine(output,"raw","chunk",id+".chunk"));J.Save(Path.Combine(output,"raw","chunk",id+".json"),h.Entry(chunk));copiedChunks.Add(id);}}
    }
    results.Add(J.Obj("name",e.Name,"type",e.Type,"guid",e.Guid.ToString(),"file","ebx/"+file,"depth",item.Item2,"dependencies",deps.Select(g=>g.ToString()).ToArray(),"resources",graph.ResourceIds.Select(r=>r.ToString()).ToArray(),"serializationErrors",graph.Errors.Count));
    if(graph.Errors.Count>0)errors.Add(J.Obj("name",e.Name,"kind","serialization","errors",graph.Errors));
    Console.Error.WriteLine("[export "+count+"] "+e.Name);
   }catch(Exception ex){errors.Add(J.Obj("name",e.Name,"error",ex.GetBaseException().ToString()));Console.Error.WriteLine("[error] "+e.Name+": "+ex.GetBaseException().Message);}
  }
  var remaining=q.Where(t=>!seen.Contains(t.Item1.Guid)).Select(t=>t.Item1.Guid).Distinct().ToArray();var atDepthLimit=deferred.Where(g=>!seen.Contains(g)).ToArray();
  bool complete=remaining.Length==0&&errors.Count==0&&count>0;J.Save(Path.Combine(output,"export.manifest.json"),J.Obj("complete",complete,"scope","selected seeds and dependency depth "+depth,"dependencyClosureComplete",complete&&atDepthLimit.Length==0,"depthLimitDependencies",atDepthLimit.Select(g=>g.ToString()).ToArray(),"attempted",count,"remainingQueue",remaining.Select(g=>g.ToString()).ToArray(),"results",results,"errors",errors));return complete?0:3;
 }
 static int Raw(Historical h,string output){
  string kind=Require("kind"),id=Require("id");
  if(kind=="res"){ulong rid;var r=ulong.TryParse(id,out rid)?h.Res(rid):h.Res(id);if(r==null)throw new Exception("RES not found");Copy(h.Raw(r),Path.Combine(output,r.ResRid+".res"));J.Save(Path.Combine(output,r.ResRid+".json"),h.Entry(r));}
  else if(kind=="chunk"){var r=h.Chunk(Guid.Parse(id));if(r==null)throw new Exception("Chunk not found");Copy(h.Raw(r),Path.Combine(output,r.Id+".chunk"));J.Save(Path.Combine(output,r.Id+".json"),h.Entry(r));}
  else if(kind=="ebx"){Guid guid;var r=Guid.TryParse(id,out guid)?h.Ebx(guid):h.Ebx(id);if(r==null)throw new Exception("EBX not found");Copy(h.Raw(r),Path.Combine(output,r.Guid+".ebx"));J.Save(Path.Combine(output,r.Guid+".json"),h.Entry(r));}
  else throw new ArgumentException("kind must be ebx, res, or chunk");return 0;
 }
 static int Selftest(Historical h){
  var checks=new List<object>();
  foreach(string name in new string[]{"RigidMeshAsset","ReferenceObjectData","StaticModelGroupEntityData","LinearTransform","Vec3","SoldierEntityData","FiringFunctionData"}) {object value=h.NewObject(name);if(value==null)throw new Exception("Cannot create "+name);checks.Add(J.Obj("type",name,"created",true));}
  var sample=h.NewObject("ReferenceObjectData");sample.GetType().GetMethod("SetInstanceGuid").Invoke(sample,new object[]{new FrostySdk.Ebx.AssetClassGuid(Guid.NewGuid(),0)});
  var graph=new EbxJson(null);var encoded=J.Encode(graph.Document(Guid.NewGuid(),Guid.Empty,new object[]{sample},new Guid[0]));
  if(graph.Errors.Count!=0||!encoded.Contains("BlueprintTransform")||!encoded.Contains("$id"))throw new Exception("Typed graph serialization failed");
  object reference=graph.Value(new FrostySdk.Ebx.PointerRef(sample),0);if(!J.Encode(reference).Contains("$ref"))throw new Exception("Internal reference preservation failed");
  Guid external=Guid.NewGuid(),externalClass=Guid.NewGuid();object ext=graph.Value(new FrostySdk.Ebx.PointerRef(new FrostySdk.IO.DXhosMFsVvtMybFGVDabgDWHQKpeljIYS{FileGuid=external,ClassGuid=externalClass}),0);if(!J.Encode(ext).Contains(external.ToString())||!J.Encode(ext).Contains(externalClass.ToString()))throw new Exception("External reference preservation failed");
  object resource=graph.Value(new FrostySdk.Ebx.ResourceRef(18446744073709551615UL),0);if(!J.Encode(resource).Contains("18446744073709551615"))throw new Exception("64-bit resource identity lost");
  checks.Add(J.Obj("typedEbxGraph",true,"internalReferences",true,"externalReferences",true,"uint64ResourcesPreserved",true));
  if(ConvertAssets.Half(0x3c00)!=1||ConvertAssets.Half(0xc000)!=-2||ConvertAssets.Half(1)<=0)throw new Exception("Half float decoding failed");
  checks.Add(J.Obj("halfFloatDecoding",true));
  string triangle=Path.Combine(root,"selftest-triangle.glb");ConvertAssets.Glb(triangle,new List<GeometryPart>{new GeometryPart{Name="synthetic-test-only",Positions=new float[]{0,0,0,1,0,0,0,1,0},Normals=new float[]{0,0,1,0,0,1,0,0,1},Uv=new float[]{0,0,1,0,0,1},Indices=new uint[]{0,1,2}}},J.Obj("synthetic",true));
  using(var reader=new BinaryReader(File.OpenRead(triangle))){if(reader.ReadUInt32()!=0x46546c67||reader.ReadUInt32()!=2||reader.ReadUInt32()!=reader.BaseStream.Length)throw new Exception("GLB header verification failed");}
  checks.Add(J.Obj("glbHeader",true,"synthetic",true));
  string dds=Path.Combine(root,"selftest-red.dds"),png=Path.Combine(root,"selftest-red.png");ConvertAssets.TestDds(dds);ConvertAssets.DdsToPng(dds,png);checks.Add(J.Obj("nativeDdsToPng",true,"synthetic",true));
  var report=J.Obj("passed",true,"gameFilesRead",false,"profile",h.ProfileInfo(),"checks",checks,"typedGraphBytes",encoded.Length,"sdkSha256",Historical.ExpectedSdkHash,"gameSdkSha256",Historical.ExpectedGameSdkHash);
  string dest=Path.GetFullPath(Opt("out",Path.Combine(root,"selftest.json")));J.Save(dest,report);Console.WriteLine(J.Encode(report));return 0;
 }
 static int Schema(Historical h){
  var rows=new List<object>();
  IEnumerable<string> names=opts.ContainsKey("types")?Require("types").Split(',').Select(s=>s.Trim()).Where(s=>s.Length>0):h.ObjectType("Asset").Assembly.GetTypes().Where(t=>Match(t.Name,Require("contains"))).Select(t=>t.Name).OrderBy(s=>s);
  foreach(string name in names){
   Type type=h.ObjectType(name);if(type==null){rows.Add(J.Obj("name",name,"available",false));continue;}
   var graph=new EbxJson(null);object sample=null;string error=null;
   try{sample=graph.Value(h.NewObject(name),0);}catch(Exception ex){error=ex.GetBaseException().Message;}
   rows.Add(J.Obj("name",name,"available",true,"baseType",type.BaseType==null?null:type.BaseType.FullName,"classAttributes",type.GetCustomAttributesData().Select(a=>J.Obj("type",a.AttributeType.FullName,"arguments",a.ConstructorArguments.Select(v=>v.Value==null?null:v.Value.ToString()).ToArray())).ToArray(),"properties",type.GetProperties().Where(p=>p.GetIndexParameters().Length==0).Select(p=>J.Obj("name",p.Name,"type",p.PropertyType.FullName)).ToArray(),"defaultObject",sample,"errors",graph.Errors,"creationError",error));
  }
  J.Save(Require("out"),J.Obj("schemaVersion",1,"gameFilesRead",false,"evidenceClass","tool SDK schema and defaults only; no installed game values","profile",h.ProfileInfo(),"types",rows));return 0;
 }
 static int ConvertSelected(Historical h,string output,string kind){var results=new List<object>();var errors=new List<object>();int lod=int.Parse(Opt("lod","0"));foreach(var entry in Select(h)){try{string file=Path.Combine(output,FileName(entry)+(kind=="mesh"?".glb":".dds"));var meta=kind=="mesh"?ConvertAssets.Mesh(h,entry,file,lod,opts.ContainsKey("allow-unbound"),opts.ContainsKey("flip-v")):ConvertAssets.Texture(h,entry,file);if(kind=="texture"&&opts.ContainsKey("png"))ConvertAssets.DdsToPng(file,Path.ChangeExtension(file,"png"));results.Add(J.Obj("name",entry.Name,"guid",entry.Guid.ToString(),"file",Path.GetFileName(file),"metadata",meta));}catch(Exception e){errors.Add(J.Obj("name",entry.Name,"error",e.GetBaseException().ToString()));Console.Error.WriteLine("[error] "+entry.Name+": "+e.GetBaseException().Message);}}J.Save(Path.Combine(output,kind+".manifest.json"),J.Obj("results",results,"errors",errors,"complete",errors.Count==0&&results.Count>0));return errors.Count==0&&results.Count>0?0:3;}
 static void Copy(Stream source,string dest){if(source==null)throw new IOException("Asset stream missing");Directory.CreateDirectory(Path.GetDirectoryName(dest));using(source)using(var f=File.Create(dest))source.CopyTo(f);}
 static string SafeName(string name){return string.Concat(name.Select(c=>char.IsLetterOrDigit(c)||c=='-'||c=='_'||c=='.'?c:'_'));}
 static string FileName(EBX e){string name=SafeName(e.Name);if(name.Length>100)name=name.Substring(name.Length-100);return name+"__"+e.Guid;}
 static bool Match(string text,string part){return text!=null&&text.IndexOf(part,StringComparison.OrdinalIgnoreCase)>=0;}
 static string Opt(string k,string fallback){string v;return opts.TryGetValue(k,out v)?v:fallback;}
 static string Require(string k){string v=Opt(k,null);if(string.IsNullOrEmpty(v)||v=="true")throw new ArgumentException("Missing --"+k);return v;}
 static bool Under(string candidate,string parent){return Path.GetFullPath(candidate).TrimEnd('\\','/').StartsWith(Path.GetFullPath(parent).TrimEnd('\\','/')+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase)||string.Equals(Path.GetFullPath(candidate).TrimEnd('\\','/'),Path.GetFullPath(parent).TrimEnd('\\','/'),StringComparison.OrdinalIgnoreCase);}
 static string Hash(string path){using(var sha=SHA256.Create())using(var s=File.OpenRead(path))return BitConverter.ToString(sha.ComputeHash(s)).Replace("-","");}
 static void Help(){Console.WriteLine("BF2 extractor, pinned to Frosty 1.0.5.2. No game access for help/selftest/dds-png.\nselftest [--runtime DIR] [--work DIR] [--out REPORT.json]\ninventory --game DIR --out DIR [--contains DeathStar02_01] [--bundle TEXT] [--type TEXT] [--all]\nexport --game DIR --out DIR [--name ASSET | --contains TEXT | --bundle TEXT] [--depth N] [--max-assets N] [--raw]\nraw --game DIR --out DIR --kind ebx|res|chunk --id NAME_OR_ID\nmesh --game DIR --out DIR --name ASSET [--lod 0] [--flip-v] [--allow-unbound]\ntexture --game DIR --out DIR --name ASSET [--png]\ndds-png --input FILE.dds --out FILE.png\nSelection defaults to names containing DeathStar02_01. --bundle alone selects all entries in matching bundles.\nMesh exports preserve geometry/UVs with placeholder materials. Skin/composite binding, material mapping, collision, and scene assembly remain pending.\nTexture exports produce DDS; --png also converts a single 2D texture through the historical native exporter.\nExport complete means requested depth finished; dependencyClosureComplete separately reports whether dependencies remain beyond that depth.\nAll game commands open install data read-only and write cache/output outside the installation.");}
}
