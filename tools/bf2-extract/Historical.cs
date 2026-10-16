using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using FrostySdk;
using FrostySdk.Ebx;
using FS = FrostySdk.vlNwajwCHuNIDRXaUMJxGcKFjdVy;
using AM = FrostySdk.Managers.ITbvsICjMeDQPilWIPFIWOrSAGppmIDEyBBpyP;
using RM = FrostySdk.Managers.UgeJiKFxhAcmlYEsmheJCtSYKPRoSorwsR;
using PL = FrostySdk.dkkuelnHHIohnloXHrspInWRvnQb;
using TL = FrostySdk.tFHXmSAcbRjWHorGItVAoUVlFjajERYvjRR;
using EBX = FrostySdk.Managers.VmDbVirBuUgxTCCQioDVXY;
using RES = FrostySdk.Managers.bguSaaByrkipBbaTtCjOlNxRBIKOtimJaItbs;
using CHUNK = FrostySdk.Managers.UvgSpjQLogYnxcoLyxMidsobsS;
using BUNDLE = FrostySdk.Managers.JxBIyhrJHhnayXJQBsQnOrWkWQABIqjBYsjs;
using ASSET = FrostySdk.IO.CgcyOwpGwNeRivkiR;

// Exact official 1.0.5.2 methods, mapped using source analogues and assembly metadata.
// Do not silently use this adapter with another FrostySdk.dll.
class Historical {
 public FS Fs;
 public AM Assets;
 public RM Resources;
 public const string ExpectedSdkHash = "9A08B4176A394F409FEFECEB4833E2F9054AE52AD3FAB8358437D8276EB3D0E5";
 public const string ExpectedGameSdkHash = "F5A57713170D210132464CCFB4C182A80E89C263E8455DBB0746F572E3B5F047";
 public void ProfileOnly() {
  bool loaded=false;
  foreach(string key in new string[]{"StarWarsII","starwarsbattlefrontii","StarWarsBattlefrontII"})if(PL.WXxWbbNyYKdWsAJsBbcytNgeN(key)){loaded=true;break;}
  if(!loaded) throw new Exception("Star Wars Battlefront II profile missing");
  TL.HKSqFylpvoJUQoTOpdxPsySBWnG(true);
  Type compression=typeof(FS).Assembly.GetType("FrostySdk.OhvFClJgYKjtpgRFKQXbtonNKLtay",true);
  compression.GetMethod("XvmJlaJxbVtWdpOQmMiNC",BindingFlags.Static|BindingFlags.Public|BindingFlags.NonPublic).Invoke(null,null);
  if(compression.GetField("Decompress",BindingFlags.Static|BindingFlags.Public|BindingFlags.NonPublic).GetValue(null)==null)throw new Exception("Historical ZStd native binding failed before game access; current directory="+Directory.GetCurrentDirectory());
 }
 public object NewObject(string type) { return TL.NmuIesioWluKdOOeHpJkmvrSTOcvnICe(type); }
 public Type ObjectType(string type) { return TL.NcrnUuMLqavOPkko(type); }
 public Dictionary<string,object> ProfileInfo() {
  return J.Obj("name",PL.MxgvjNkIVjHQhFILtGeCPSKELyAWYyNp,"displayName",PL.DKeHvMcNbVvHKsuNShpuMLvbkabdBGm,"sdk",PL.LoWjQwMVhdGiSwpGEWp,"dataVersion",PL.bTJunuWsNRyOKpfJaKygTWanIJeBPhpQootbw,"ebxVersion",PL.SYWYRLjqaQRcOxtIRPCRfAFRiGs);
 }
 public void Open(string root) {
  // BF2_GAME_DIR overrides the install folder passed by any tool.
  root=System.Environment.GetEnvironmentVariable("BF2_GAME_DIR")??root;
  Fs=new FS(root);
  foreach(var source in PL.kRvVWVMECLQKCOTCrAAoTKmtAjTrWU) Fs.ajPNqXWUhRirMBFQEcwkOYMD(source.Path,source.SubDirs);
  Fs.TVvujuusOtfnMdUsDpJPuGGeTCnOFmwdo(null);
  Resources=new RM(Fs); Resources.yfPGuXtrEytxfeUOalaCbKFXKtoYgBylkj(new Log()); Resources.WkjnCwUSnrmOdQLieGWGChWRBYl();
  Assets=new AM(Fs,Resources); Assets.yfPGuXtrEytxfeUOalaCbKFXKtoYgBylkj(new Log());
  Assets.QlkpkhCaeVEgLeTpIRxjFevYaxIn(true,null);
 }
 public IEnumerable<EBX> Ebx() { return Assets.eUYVMmVdudFWuDYoSOidINXBrUoWqw("",false,false,true,""); }
 public IEnumerable<RES> Res() { return Assets.WXSJOGQALxIuPprneHwmxbnqFdjOEG(0,false,""); }
 public IEnumerable<CHUNK> Chunks() { return Assets.LJKjRLHSuxewMKkymDYYhbrxvvT(false); }
 public IEnumerable<BUNDLE> Bundles() { return Assets.eJuHvUdWcAmWoRJvESaL(FrostySdk.Managers.BundleType.None,false); }
 public BUNDLE Bundle(int index) { return Assets.ceKJKoMsbErpnYYbTCp(index); }
 public int BundleId(BUNDLE b) { return Assets.CmmmmGWxmJvyaHqtqQrqq(b); }
 public EBX Ebx(string name) { return Assets.CGtsBdotFTfUAIaxhRjLk(name); }
 public EBX Ebx(Guid id) { return Assets.QgaDyhqOppBrCyOCkfbFcbmDLEDxBGwXS(id); }
 public RES Res(string name) { return Assets.FyCaVJXCaabRmFuuGGcTtWXOrpnbFJVDoF(name); }
 public RES Res(ulong id) { return Assets.GjSoixIDQeMeNOgvUuQk(id); }
 public CHUNK Chunk(Guid id) { return Assets.TSHqrHjBhTAoPdyEqWrBnopBvCuld(id); }
 public ASSET Decode(EBX entry) { return Assets.GIuLkvfPaULOquXvObplHauhurqIaSd(entry); }
 public Stream Raw(EBX entry) { return Assets.TViBcbfVkmBORgkYVSVuKF(entry); }
 public Stream Raw(RES entry) { return Assets.FCohHmotlbjRWteDmptUOUpXQVxLACJqpa(entry); }
 public Stream Raw(CHUNK entry) { return Assets.SOdBRrYxwMHRjftWVqKjRsye(entry); }
 public object Mesh(RES entry) { using(Stream s=Raw(entry)) return new FrostySdk.Resources.KfpaShNjvicnKuxFGsstgYcOEjJ(s,Assets); }
 public object Texture(RES entry) { using(Stream s=Raw(entry)) return new FrostySdk.Resources.bTlQaWcfXUoBqbdoHINPIRnvaxumbUX(s,Assets); }
 public Guid[] KnownResourceChunks(RES entry) {
  if(entry.ResType==(uint)FrostySdk.Managers.ResourceType.MeshSet)return ((FrostySdk.Resources.KfpaShNjvicnKuxFGsstgYcOEjJ)Mesh(entry)).Lods.Select(l=>l.ChunkId).Where(g=>g!=Guid.Empty).Distinct().ToArray();
  if(entry.ResType==(uint)FrostySdk.Managers.ResourceType.Texture)using(var t=(FrostySdk.Resources.bTlQaWcfXUoBqbdoHINPIRnvaxumbUX)Texture(entry))return t.ChunkId==Guid.Empty?new Guid[0]:new Guid[]{t.ChunkId};
  return new Guid[0];
 }
 public object Entry(object e) {
  var baseEntry=(FrostySdk.Managers.VfDPGUvGrpKJRNhUTJpXeJKYEHjKV)e;
  var row=J.Obj("name",baseEntry.Name,"type",baseEntry.Type,"kind",baseEntry.AssetType,"sha1",baseEntry.Sha1.ToString(),"size",baseEntry.Size,"originalSize",baseEntry.OriginalSize,"bundles",baseEntry.Bundles.Select(id=>J.Obj("id",id,"name",Bundle(id).Name)).ToArray());
  if(e is EBX) { var x=(EBX)e; row["guid"]=x.Guid.ToString(); row["dependencies"]=x.DependentAssets.Select(v=>v.ToString()).ToArray(); }
  if(e is RES) { var x=(RES)e; row["rid"]=x.ResRid.ToString(); row["resourceType"]=x.ResType; row["resourceMetaHex"]=BitConverter.ToString(x.ResMeta??new byte[0]).Replace("-","").ToLowerInvariant(); }
  if(e is CHUNK) { var x=(CHUNK)e; row["guid"]=x.Id.ToString(); row["logicalOffset"]=x.LogicalOffset; row["logicalSize"]=x.LogicalSize; }
  return row;
 }
 class Log : FrostySdk.Interfaces.cxTfiOoYJEAFlAacpNqKIGewnCWuKogM {
  public void EGsFHRtAqsJElaUyFcAeEuSFTYD(string text,params object[] args) { Write("info",text,args); }
  public void iPBHeDDnClwUfCqbckUmfNq(string text,params object[] args) { Write("warning",text,args); }
  public void vUEOTVwWsBHWYxAi(string text,params object[] args) { Write("error",text,args); }
  static void Write(string level,string text,object[] args) { try { Console.Error.WriteLine("[frosty:"+level+"] "+string.Format(text,args)); } catch { Console.Error.WriteLine(text); } }
 }
}
