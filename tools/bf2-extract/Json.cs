using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Web.Script.Serialization;
using FrostySdk.Ebx;
using ASSET = FrostySdk.IO.CgcyOwpGwNeRivkiR;

static class J {
 public static Dictionary<string,object> Obj(params object[] a) { var d=new Dictionary<string,object>(); for(int i=0;i<a.Length;i+=2)d[(string)a[i]]=a[i+1]; return d; }
 public static string Encode(object x) { return new JavaScriptSerializer {MaxJsonLength=int.MaxValue,RecursionLimit=256}.Serialize(x); }
 public static void Save(string path,object x) { Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(path))); File.WriteAllText(path,Encode(x),new System.Text.UTF8Encoding(false)); }
 public static object Get(object x,string key) { if(x==null)return null; var t=x.GetType(); var p=t.GetProperty(key); if(p!=null)return p.GetValue(x,null); var f=t.GetField(key); return f==null?null:f.GetValue(x); }
}
class RefEquality : IEqualityComparer<object> { public new bool Equals(object a,object b){return ReferenceEquals(a,b);} public int GetHashCode(object a){return RuntimeHelpers.GetHashCode(a);} }
class EbxJson {
 Dictionary<object,string> ids=new Dictionary<object,string>(new RefEquality());
 HashSet<object> active=new HashSet<object>(new RefEquality());
 public HashSet<Guid> ExternalGuids=new HashSet<Guid>();
 public HashSet<ulong> ResourceIds=new HashSet<ulong>();
 public HashSet<Guid> ChunkCandidates=new HashSet<Guid>();
 public List<object> Errors=new List<object>();
 readonly Func<Guid,string> lookup;
 public EbxJson(Func<Guid,string> lookupName) {lookup=lookupName;}
 public object Asset(ASSET asset) {
  return Document(asset.FileGuid,asset.RootInstanceGuid,asset.Objects,asset.Dependencies);
 }
 public object Document(Guid fileGuid,Guid rootInstanceGuid,IEnumerable<object> objects,IEnumerable<Guid> dependencies) {
  var all=objects.ToList();
  for(int i=0;i<all.Count;i++)ids[all[i]]=Identity(all[i],i);
  var nodes=new List<object>();
  foreach(var x in all)nodes.Add(Node(x));
  return J.Obj("fileGuid",fileGuid.ToString(),"root",ids[all[0]],"rootInstanceGuid",rootInstanceGuid.ToString(),"dependencies",dependencies.Select(g=>g.ToString()).ToArray(),"objects",nodes,"errors",Errors);
 }
 string Identity(object x,int i) {
  var m=x.GetType().GetMethod("GetInstanceGuid");
  if(m!=null) { var g=(AssetClassGuid)m.Invoke(x,null); if(g.IsExported)return g.ExportedGuid.ToString(); return "internal:"+g.InternalId; }
  return "object:"+i;
 }
 object Node(object x) { var d=(Dictionary<string,object>)Properties(x,0); d["$id"]=ids[x]; return d; }
 public object Value(object x,int depth) {
  if(x==null)return null;
  if(depth>96){Errors.Add("depth limit for "+x.GetType());return J.Obj("$error","depth-limit");}
  Type t=x.GetType();
  if(x is string || x is bool || x is char)return x;
  if(x is ulong || x is long)return J.Obj("$type",t.Name,"value",Convert.ToString(x,CultureInfo.InvariantCulture));
  if(x is Guid){Guid g=(Guid)x;if(g!=Guid.Empty)ChunkCandidates.Add(g);return g.ToString();}
  if(x is float || x is double){double v=Convert.ToDouble(x);return double.IsNaN(v)||double.IsInfinity(v)?J.Obj("$type",t.Name,"value",v.ToString(CultureInfo.InvariantCulture)):x;}
  if(t.IsPrimitive || x is decimal)return x;
  if(t.IsEnum)return J.Obj("$enum",t.FullName,"name",x.ToString(),"value",Convert.ToInt64(x));
  if(x is PointerRef) {
   var p=(PointerRef)x;
   if(p.Type==FrostySdk.IO.PointerRefType.Null)return null;
   if(p.Type==FrostySdk.IO.PointerRefType.Internal) {
    string id; if(p.Internal!=null && ids.TryGetValue(p.Internal,out id))return J.Obj("$ref",id);
    Errors.Add("Internal pointer target missing from asset.Objects"); return J.Obj("$error","unlisted-internal-pointer","value",Value(p.Internal,depth+1));
   }
   Guid file=p.External.FileGuid; ExternalGuids.Add(file);
   return J.Obj("$external",file.ToString(),"classGuid",p.External.ClassGuid.ToString(),"name",lookup==null?null:lookup(file));
  }
  if(x is ResourceRef) { ulong rid=(ResourceRef)x;ResourceIds.Add(rid);return J.Obj("$resource",rid.ToString()); }
  if(t.FullName=="FrostySdk.Ebx.CString" || t.FullName=="FrostySdk.Ebx.FileRef" || t.FullName=="FrostySdk.Sha1")return x.ToString();
  string reference; if(ids.TryGetValue(x,out reference))return J.Obj("$ref",reference);
  if(x is byte[])return J.Obj("$bytes",Convert.ToBase64String((byte[])x));
  if(x is IEnumerable) { var list=new List<object>();foreach(object v in (IEnumerable)x)list.Add(Value(v,depth+1));return list; }
  if(!t.IsValueType && !active.Add(x)){Errors.Add("Cycle outside EBX object table: "+t);return J.Obj("$error","cycle");}
  try {return Properties(x,depth+1);} finally {if(!t.IsValueType)active.Remove(x);}
 }
 object Properties(object x,int depth) {
  Type t=x.GetType(); var d=J.Obj("$type",t.FullName);
  foreach(var p in t.GetProperties(BindingFlags.Instance|BindingFlags.Public).Where(p=>p.CanRead&&p.GetIndexParameters().Length==0).OrderBy(p=>p.Name)) {
   try {d[p.Name]=Value(p.GetValue(x,null),depth+1);}catch(Exception e){var error=J.Obj("type",t.FullName,"property",p.Name,"message",e.GetBaseException().Message);Errors.Add(error);d[p.Name]=J.Obj("$error",e.GetBaseException().Message);}
  }
  foreach(var f in t.GetFields(BindingFlags.Instance|BindingFlags.Public).OrderBy(f=>f.Name)) {if(!d.ContainsKey(f.Name))d[f.Name]=Value(f.GetValue(x),depth+1);}
  return d;
 }
}
