using System;
using System.Linq;
using Mono.Cecil;
class CecilInspect {
 static void Main(string[] a) {
  using(var asm=AssemblyDefinition.ReadAssembly(a[0])) {
   if(a.Length>1){foreach(var t in asm.MainModule.Types.Where(t=>t.FullName==a[1]))foreach(var m in t.Methods.Where(m=>a.Length<3||m.Name==a[2])){Console.WriteLine(m);if(m.HasBody)foreach(var i in m.Body.Instructions)Console.WriteLine(i);}return;}
   foreach(var t in asm.MainModule.Types) {
    if(t.Methods.Any(m=>m.HasBody && m.Body.Instructions.Any(i=>i.Operand is string && (((string)i.Operand).Contains("Profiles.bin") || ((string)i.Operand)=="Profiles/")))) {
     Console.WriteLine("BOOTSTRAP_TYPE "+t.FullName);
     foreach(var m in t.Methods.Where(m=>m.IsPublic)) Console.WriteLine(m);
     foreach(var p in t.Properties) Console.WriteLine(p);
     foreach(var f in t.Fields.Where(f=>f.IsPublic)) Console.WriteLine(f);
    }
   }
   foreach(var t in asm.MainModule.GetTypeReferences().Where(t=>t.Scope.Name=="FrostySdk")) Console.WriteLine("REF "+t.FullName);
   foreach(var t in asm.MainModule.Types.Where(t=>new string[]{"RigidMeshAsset","ReferenceObjectData","Vec3","LinearTransform"}.Contains(t.Name))) {
    Console.WriteLine("TYPE "+t.FullName);
    foreach(var ca in t.CustomAttributes) Console.WriteLine("ATTR "+ca.AttributeType+" "+string.Join(",",ca.ConstructorArguments.Select(x=>x.Value)));
    foreach(var p in t.Properties.Take(3)) {
     Console.WriteLine("PROPERTY "+p);
     foreach(var ca in p.CustomAttributes) Console.WriteLine("ATTR "+ca.AttributeType+" "+string.Join(",",ca.ConstructorArguments.Select(x=>x.Value)));
    }
   }
  }
 }
}
