// Bounded shader witness: unchanged original compute DXBC on CPU D3D11 WARP.
// Explicit fixture parameters, not a captured native frame or selected settings.
using System;
using System.IO;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using SharpDX;
using SharpDX.Direct3D;
using SharpDX.Direct3D11;
using SharpDX.DXGI;
class NativeColorCubeWarp {
 static string root=System.Environment.GetEnvironmentVariable("BF2_REPO_ROOT")??System.IO.Directory.GetCurrentDirectory();
 static string Hash(byte[] b){using(var h=SHA256.Create())return BitConverter.ToString(h.ComputeHash(b)).Replace("-","").ToLowerInvariant();}
 static int Main(string[] args){
  AppDomain.CurrentDomain.AssemblyResolve+=(sender,e)=>{string f=root+"/tools/frosty-1.0.5.2/ThirdParty/"+new AssemblyName(e.Name).Name+".dll";return File.Exists(f)?Assembly.LoadFrom(f):null;};
  return Run(Array.IndexOf(args,"--sdr")>=0);
 }
 [MethodImpl(MethodImplOptions.NoInlining)]static int Run(bool sdr){
  string output=root+"/exports/lighting/native-colorcube-warp"+(sdr?"-sdr":"");Directory.CreateDirectory(output);
  byte[] original=File.ReadAllBytes(root+"/exports/lighting/native-postprocess-shaders/"+(sdr?"cube-hdr-one-convert1":"cube-hdr-one-none")+".dxbc");
  string expected=sdr?"286967855442cb65da0732eb0b8df995f54f041e41258090e39c04a70e36f918":"560746ebfb0bfa9e12fe29d40195b640792c833615f72705bf379edc901a5d63";
  if(Hash(original)!=expected)throw new Exception("Native CS identity mismatch");
  string[] sources=Directory.GetFiles(root+"/exports/lighting/indoor-color-grading","f7f7ed97-693f-c8c5-8af1-050bdae520df*",SearchOption.AllDirectories);
  byte[] pixels=null;
  foreach(string source in sources){var bytes=File.ReadAllBytes(source);if(bytes.Length==143748&&Hash(bytes)=="ef8c87b2bc53aa040088c3b65fdd6baef2e488ec72e3072602fcc98b2281d19b")pixels=bytes;}
  if(pixels==null)throw new Exception("Original indoor cube identity mismatch");
  using(var device=new SharpDX.Direct3D11.Device(DriverType.Warp,DeviceCreationFlags.None,FeatureLevel.Level_11_0))
  using(var cs=new ComputeShader(device,original)){
   var desc=new Texture3DDescription(){Width=33,Height=33,Depth=33,MipLevels=1,Format=Format.R10G10B10A2_UNorm,Usage=ResourceUsage.Default,BindFlags=BindFlags.ShaderResource};
   using(var input=new Texture3D(device,desc))using(var srv=new ShaderResourceView(device,input)){
    var context=device.ImmediateContext;var handle=GCHandle.Alloc(pixels,GCHandleType.Pinned);
    try{context.UpdateSubresource(new DataBox(handle.AddrOfPinnedObject(),33*4,33*33*4),input,0);}finally{handle.Free();}
    desc.BindFlags=BindFlags.UnorderedAccess;
    using(var destination=new Texture3D(device,desc))using(var uav=new UnorderedAccessView(device,destination)){
     desc.Usage=ResourceUsage.Staging;desc.BindFlags=BindFlags.None;desc.CpuAccessFlags=CpuAccessFlags.Read;
     using(var staging=new Texture3D(device,desc)){
      var results=new System.Collections.Generic.List<object>();
      foreach(float exposure in sdr?new float[]{0.5f}:new float[]{0.5f,1f,2f}){
       float[] constants=new float[100];constants[0]=constants[5]=constants[10]=constants[15]=1;
       constants[16]=1f/33;constants[17]=33;constants[18]=1089;constants[19]=33f/32;
       constants[20]=constants[21]=constants[22]=1; // Native default LUT gamma, curb zero.
       constants[24]=constants[25]=constants[27]=1;constants[26]=.05f; // Neutral native brightness baseline.
       constants[28]=exposure;constants[29]=1;
       using(var buffer=SharpDX.Direct3D11.Buffer.Create(device,BindFlags.ConstantBuffer,constants)){
        context.ComputeShader.Set(cs);context.ComputeShader.SetShaderResource(0,srv);
        context.ComputeShader.SetConstantBuffer(0,buffer);context.ComputeShader.SetUnorderedAccessView(0,uav);
        context.Dispatch(1,11,33);context.ComputeShader.SetUnorderedAccessView(0,null);
        context.CopyResource(destination,staging);
        var mapped=context.MapSubresource(staging,0,MapMode.Read,SharpDX.Direct3D11.MapFlags.None);
        byte[] result=new byte[33*33*33*4];
        try{for(int z=0;z<33;z++)for(int y=0;y<33;y++)Marshal.Copy(IntPtr.Add(mapped.DataPointer,z*mapped.SlicePitch+y*mapped.RowPitch),result,(z*33+y)*33*4,33*4);}
        finally{context.UnmapSubresource(staging,0);}
        string tag=exposure==.5f?"half":exposure==1f?"neutral":"double";
        File.WriteAllBytes(output+"/"+tag+".rgb10a2.bin",result);
        byte[] cb=new byte[400];System.Buffer.BlockCopy(constants,0,cb,0,400);File.WriteAllBytes(output+"/"+tag+".cb.bin",cb);
        results.Add(new{tag=tag,postGradeExposure=exposure,payloadBytes=result.Length,sha256=Hash(result),constantSha256=Hash(cb)});
       }
      }
      var report=new{evidenceId=sdr?"BF2-NATIVE-COLORCUBE-WARP-SDR-001":"BF2-NATIVE-COLORCUBE-WARP-001",backend="D3D11 WARP software rasterizer",shaderSha256=Hash(original),sourceCubeSha256=Hash(pixels),outputConversion=sdr?1:0,dimensions=new[]{33,33,33},format="R10G10B10A2_UNORM",dispatch=new[]{1,11,33},results=results,limitations=new[]{"Original CS and authored source cube with explicit neutral matrix/gamma/brightness fixtures and varied postGradeExposure.","RGB10A2 matches the separately recovered supported native quality-1 allocation. SDR conversion1 uses the static native-default baseline; per-view bulk-copy linkage and runtime overrides are not captured.","No native game execution or runtime pass capture."}};
      File.WriteAllText(output+"/execution.json",new System.Web.Script.Serialization.JavaScriptSerializer().Serialize(report));
      Console.WriteLine("Original color cube CS: "+results.Count+" fixtures, "+(33*33*33*results.Count)+" voxels, original packed input, CPU WARP.");
     }
    }
   }
  }
  return 0;
 }
}
