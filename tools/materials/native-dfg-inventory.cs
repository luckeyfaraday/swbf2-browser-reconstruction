// Read-only pinned SDK inventory: shader-related RES and initfs records only.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
class NativeDfgInventory {
 static string root=System.Environment.GetEnvironmentVariable("BF2_REPO_ROOT")??System.IO.Directory.GetCurrentDirectory(), runtime=root+"/tools/frosty-1.0.5.2", work=root+"/tools/bf2-extract/work";
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode)]static extern IntPtr LoadLibrary(string path);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode)]static extern bool SetDllDirectory(string path);
 static string Hash(byte[] bytes){using(var hash=SHA256.Create())return BitConverter.ToString(hash.ComputeHash(bytes)).Replace("-","").ToLowerInvariant();}
 static int Main(){
  if(Hash(File.ReadAllBytes(runtime+"/FrostySdk.dll")).ToUpperInvariant()!=Historical.ExpectedSdkHash)throw new Exception("SDK hash mismatch");
  if(Hash(File.ReadAllBytes(work+"/Profiles/StarWarsIISDK.dll")).ToUpperInvariant()!=Historical.ExpectedGameSdkHash)throw new Exception("Schema hash mismatch");
  Directory.SetCurrentDirectory(work);SetDllDirectory(null);
  LoadLibrary(work+"/ThirdParty/libzstd.1.1.5.dll");
  AppDomain.CurrentDomain.AssemblyResolve+=(sender,e)=>{
   string name=new AssemblyName(e.Name).Name;
   if(name=="EbxClasses")return Assembly.LoadFrom(work+"/Profiles/StarWarsIISDK.dll");
   foreach(string prefix in new[]{runtime,work+"/ThirdParty"})if(File.Exists(prefix+"/"+name+".dll"))return Assembly.LoadFrom(prefix+"/"+name+".dll");
   return null;
  };
  return Run();
 }
 [MethodImpl(MethodImplOptions.NoInlining)]static int Run(){
  var h=new Historical();h.ProfileOnly();h.Open("C:/Games/Star Wars - Battlefront 2");
  var memory=h.Fs.GetType().GetFields(BindingFlags.Public|BindingFlags.NonPublic|BindingFlags.Instance).Single(f=>f.FieldType==typeof(Dictionary<string,byte[]>));
  var files=(Dictionary<string,byte[]>)memory.GetValue(h.Fs);
  var rows=files.Select(pair=>J.Obj("name",pair.Key,"bytes",pair.Value.Length,"sha256",Hash(pair.Value))).ToArray();
  var resources=h.Res().ToArray();
  var shaderResources=resources.Where(r=>r.Type.ToLowerInvariant().Contains("shaderdatabase")||r.Type.ToLowerInvariant().Contains("shaderprogram")||r.Name.ToLowerInvariant().Contains("preintegrat")||r.Name.ToLowerInvariant().Contains("shaderdb")).Select(r=>h.Entry(r)).ToArray();
  J.Save(root+"/exports/lighting/dfg-memoryfs-inventory.json",J.Obj("evidenceId","BF2-NATIVE-FG-FS-001","memoryFs",rows,"shaderResources",shaderResources,"resourceTypeCounts",resources.GroupBy(r=>r.Type).ToDictionary(g=>g.Key,g=>g.Count()),"limitation","Read-only metadata inventory; names do not establish shader binding."));
  foreach(var pair in files.Where(p=>p.Key.ToLowerInvariant().Contains("shader")))File.WriteAllBytes(root+"/exports/lighting/dfg-initfs-"+Path.GetFileName(pair.Key).Replace(':','_'),pair.Value);
  Console.WriteLine("initfs files="+rows.Length+" shader RES="+shaderResources.Length);
  return 0;
 }
}
