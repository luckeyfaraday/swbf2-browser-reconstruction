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
class BlasterBoltBlocks {
 static string root=System.Environment.GetEnvironmentVariable("BF2_REPO_ROOT")??System.IO.Directory.GetCurrentDirectory(),runtime=root+"/tools/frosty-1.0.5.2",work=root+"/tools/bf2-extract/work",output=root+"/exports/materials/blaster-bolt-unused";
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
  var h=new Historical();h.ProfileOnly();h.Open("C:/Games/Star Wars - Battlefront 2");
  return ShaderBlocks.Dump(h,root+"/exports/rifle-trail/render-material-names.txt",root+"/exports/rifle-trail/render-material-blocks");
 }
}
