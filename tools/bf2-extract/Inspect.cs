using System;
using System.IO;
using System.Linq;
using System.Reflection;
class Inspect {
 static string root;
 static Assembly Resolve(object sender, ResolveEventArgs e) {
  string name = new AssemblyName(e.Name).Name;
  foreach (string dir in new string[] { root, Path.Combine(root,"ThirdParty"), Path.Combine(root,"Profiles") }) {
   string path = Path.Combine(dir,name+".dll");
   if(File.Exists(path)) return Assembly.LoadFrom(path);
  }
  return null;
 }
 static int Main(string[] args) {
  root=args[0]; AppDomain.CurrentDomain.AssemblyResolve += Resolve;
  foreach(string file in new string[]{"FrostySdk.dll","FrostyEditor.exe"}) {
   Console.WriteLine("ASSEMBLY "+file);
   Assembly a=Assembly.LoadFrom(Path.Combine(root,file)); Type[] ts;
   try { ts=a.GetTypes(); } catch(ReflectionTypeLoadException ex) { ts=ex.Types.Where(t=>t!=null).ToArray(); foreach(Exception x in ex.LoaderExceptions.Take(3)) Console.WriteLine(x.Message); }
   foreach(Type t in ts.Where(t=>t.Namespace=="FrostySdk.Resources" || t.Namespace=="FrostySdk.Managers" || t.Name=="wtvRocLWISqUiUpIhvx" || t.Name=="tFHXmSAcbRjWHorGItVAoUVlFjajERYvjRR" || t.GetProperty("SDKFilename")!=null || t.GetProperty("RootObject")!=null || t.GetProperty("CacheName")!=null || t.FullName=="FrostySdk.LWCloQUcGFYehuyBCojpvbrnTdQSHOWWYI" || t.Namespace=="FrostySdk.Interfaces" || t.Namespace=="FrostySdk.Attributes" || new string[]{"ProfilesLibrary","TypeLibrary","FileSystem","AssetManager","ResourceManager","EbxAssetEntry","ResAssetEntry","ChunkAssetEntry","BundleEntry","App","FBXExporter","TextureExporter","MeshSet","Texture","EbxAsset","PointerRef","EbxImportReference","AssetClassGuid","ILogger"}.Contains(t.Name))) {
    Console.WriteLine("TYPE "+t.FullName);
    foreach(ConstructorInfo c in t.GetConstructors()) Console.WriteLine(c);
    foreach(MemberInfo m in t.GetMembers(BindingFlags.Public|BindingFlags.Instance|BindingFlags.Static|BindingFlags.DeclaredOnly)) Console.WriteLine(m);
   }
  }
  return 0;
 }
}
