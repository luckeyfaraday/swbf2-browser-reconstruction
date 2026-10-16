using System;
using System.IO;
using System.Reflection;
using System.Runtime.CompilerServices;
class BootstrapProbe {
 static string rt, sdk;
 static Assembly Resolve(object s, ResolveEventArgs e) {
  string name=new AssemblyName(e.Name).Name;
  if(name=="EbxClasses") return Assembly.LoadFrom(sdk);
  foreach(string sub in new string[]{"", "ThirdParty", "Plugins"}) {
   string p=Path.Combine(rt,sub,name+".dll"); if(File.Exists(p)) return Assembly.LoadFrom(p);
  }
  return null;
 }
 static int Main(string[] args) {
  rt=Path.GetFullPath(args[0]); sdk=Path.GetFullPath(args[1]);
  AppDomain.CurrentDomain.AssemblyResolve += Resolve;
  try { Run(); return 0; } catch(Exception e) { Console.WriteLine(e); return 1; }
 }
 [MethodImpl(MethodImplOptions.NoInlining)] static void Run() {
  FrostySdk.ProfilesLibrary.Initialize(new FrostySdk.Profile[0]);
  Console.WriteLine("Profile="+FrostySdk.ProfilesLibrary.Initialize("StarWarsII"));
  Directory.CreateDirectory("probe-work/Profiles");
  File.Copy(sdk,"probe-work/Profiles/"+FrostySdk.ProfilesLibrary.SDKFilename+".dll",true);
  Directory.SetCurrentDirectory("probe-work");
  FrostySdk.TypeLibrary.Initialize(true);
  Console.WriteLine("SDK="+FrostySdk.TypeLibrary.GetSdkVersion());
  foreach(string t in new string[]{"RigidMeshAsset","ReferenceObjectData","LinearTransform","Vec3","StaticModelGroupEntityData"}) {
   Type x=FrostySdk.TypeLibrary.GetType(t);
   Console.WriteLine(t+" "+(x==null?"MISSING":x.FullName));
   if(x!=null) Console.WriteLine("Instance "+FrostySdk.TypeLibrary.CreateObject(t).GetType());
  }
 }
}
