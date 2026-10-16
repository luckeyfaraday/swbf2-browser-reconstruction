// Entire unchanged native punctual-shadow compute shader on CPU WARP.
// Controlled input textures/constant buffer; no game process or replacement shader.
using System;
using System.IO;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Collections.Generic;
using System.Web.Script.Serialization;
using SharpDX;
using SharpDX.Direct3D;
using SharpDX.Direct3D11;
using SharpDX.DXGI;
using Buffer=SharpDX.Direct3D11.Buffer;
class NativeShadowWarp {
 static string root;
 static int Main(string[] args) {
  root=Path.GetFullPath(args[0]);
  AppDomain.CurrentDomain.AssemblyResolve+=(s,e)=>{string p=Path.Combine(root,"tools/frosty-1.0.5.2/ThirdParty",new AssemblyName(e.Name).Name+".dll");return File.Exists(p)?Assembly.LoadFrom(p):null;};
  return Run();
 }
 static string Hash(byte[] data){using(var h=SHA256.Create())return BitConverter.ToString(h.ComputeHash(data)).Replace("-","").ToLowerInvariant();}
 static byte[] Bytes(float[] values){var b=new byte[values.Length*4];System.Buffer.BlockCopy(values,0,b,0,b.Length);return b;}
 static Texture2D Texture(SharpDX.Direct3D11.Device device,int width,int height,int channels,float[] values) {
  byte[] data=Bytes(values);IntPtr p=Marshal.AllocHGlobal(data.Length);
  try{Marshal.Copy(data,0,p,data.Length);return new Texture2D(device,new Texture2DDescription(){Width=width,Height=height,ArraySize=1,MipLevels=1,Format=channels==1?Format.R32_Float:Format.R32G32B32A32_Float,SampleDescription=new SampleDescription(1,0),Usage=ResourceUsage.Immutable,BindFlags=BindFlags.ShaderResource},new[]{new DataBox(p,width*channels*4,data.Length)});}
  finally{Marshal.FreeHGlobal(p);}
 }
 static Buffer Structured(SharpDX.Direct3D11.Device device,uint[] values,int stride){
  using(var data=new DataStream(values.Length*4,true,true)){data.WriteRange(values);data.Position=0;return new Buffer(device,data,new BufferDescription(){SizeInBytes=values.Length*4,StructureByteStride=stride,Usage=ResourceUsage.Immutable,BindFlags=BindFlags.ShaderResource,OptionFlags=ResourceOptionFlags.BufferStructured});}
 }
 static void Upload(DeviceContext c,Buffer b,float[] values){DataStream s;c.MapSubresource(b,MapMode.WriteDiscard,SharpDX.Direct3D11.MapFlags.None,out s);s.WriteRange(values);c.UnmapSubresource(b,0);s.Dispose();}
 static float[] Read(DeviceContext c,Texture2D texture,Texture2D staging){
  c.CopyResource(texture,staging);var m=c.MapSubresource(staging,0,MapMode.Read,SharpDX.Direct3D11.MapFlags.None);byte[] bytes=new byte[8*8*16];
  for(int y=0;y<8;y++)Marshal.Copy(IntPtr.Add(m.DataPointer,y*m.RowPitch),bytes,y*8*16,8*16);c.UnmapSubresource(staging,0);var v=new float[8*8*4];System.Buffer.BlockCopy(bytes,0,v,0,bytes.Length);return v;
 }
 [MethodImpl(MethodImplOptions.NoInlining)]static int Run(){
  string folder=Path.Combine(root,"exports/lighting/native-shadow-warp");Directory.CreateDirectory(folder);
  byte[] shader=File.ReadAllBytes(Path.Combine(root,"exports/lighting/direct-shaders/type3.dxbc"));
  if(Hash(shader)!="a61cab9738c12e1b993c32ff96dddc0f96c7942a6b4716aa4ef83e491c8c25b9")throw new Exception("Original shader identity mismatch");
  var records=new List<object>();var payload=new List<byte>();var patterns=new List<object>();
  using(var d=new SharpDX.Direct3D11.Device(DriverType.Warp,DeviceCreationFlags.None,FeatureLevel.Level_11_0))
  using(var cs=new ComputeShader(d,shader))
  using(var cb=new Buffer(d,new BufferDescription(){SizeInBytes=3844*16,Usage=ResourceUsage.Dynamic,BindFlags=BindFlags.ConstantBuffer,CpuAccessFlags=CpuAccessFlags.Write}))
  using(var sampler=new SamplerState(d,new SamplerStateDescription(){Filter=Filter.ComparisonMinMagLinearMipPoint,AddressU=TextureAddressMode.Clamp,AddressV=TextureAddressMode.Clamp,AddressW=TextureAddressMode.Clamp,ComparisonFunction=Comparison.Greater,MinimumLod=0,MaximumLod=16,MaximumAnisotropy=1})){
   var c=d.ImmediateContext;c.ComputeShader.Set(cs);c.ComputeShader.SetConstantBuffer(0,cb);c.ComputeShader.SetSampler(3,sampler);
   var keep=new List<IDisposable>();
   try{
    float[][] gb={new[]{.5f,.5f,.5f,0f},new[]{1f,1f,1f,0f},new[]{0f,.5f,0f,1f}};
    for(int k=0;k<3;k++){
     var values=new float[8*8*4];for(int i=0;i<64;i++)Array.Copy(gb[k],0,values,i*4,4);
     var t=Texture(d,8,8,4,values);var s=new ShaderResourceView(d,t);keep.Add(s);keep.Add(t);c.ComputeShader.SetShaderResource(k,s);
    }
    var depth=Texture(d,8,8,1,new float[64]);var dv=new ShaderResourceView(d,depth);keep.Add(dv);keep.Add(depth);c.ComputeShader.SetShaderResource(6,dv);
    uint[][] tables={new uint[]{0,1u<<16,0,0},new uint[]{0},new uint[]{0}};int[] slots={19,20,24};
    for(int i=0;i<3;i++){var b=Structured(d,tables[i],i==0?16:4);var s=new ShaderResourceView(d,b);keep.Add(s);keep.Add(b);c.ComputeShader.SetShaderResource(slots[i],s);}
    var desc=new Texture2DDescription(){Width=8,Height=8,ArraySize=1,MipLevels=1,Format=Format.R32G32B32A32_Float,SampleDescription=new SampleDescription(1,0),Usage=ResourceUsage.Default,BindFlags=BindFlags.UnorderedAccess};
    using(var output=new Texture2D(d,desc))using(var uav=new UnorderedAccessView(d,output)){
     c.ComputeShader.SetUnorderedAccessView(0,uav);desc.Usage=ResourceUsage.Staging;desc.BindFlags=BindFlags.None;desc.CpuAccessFlags=CpuAccessFlags.Read;
     using(var staging=new Texture2D(d,desc)){
      float[] values=new float[3844*4];values[0]=.3f;values[5]=.3f;values[11]=-2;values[15]=1;values[4*4+2]=1;
      values[5*4+2]=values[5*4+3]=1f/8;values[6*4]=values[6*4+1]=16;values[6*4+2]=values[6*4+3]=1f/16;values[8*4+2]=BitConverter.ToSingle(BitConverter.GetBytes(1u),0);
      values[26*4]=values[27*4+1]=values[28*4+2]=1;
      values[44*4+2]=1;values[44*4+3]=.001f;values[45*4]=1;values[45*4+1]=.7f;values[45*4+2]=.3f;values[45*4+3]=1;
      values[46*4+2]=1;values[46*4+3]=1;values[47*4+1]=1;values[47*4+3]=0;values[48*4]=1;values[48*4+3]=1;
      values[49*4+1]=1;values[61*4+1]=1;
      Upload(c,cb,values);c.Dispatch(1,1,1);float[] baseline=Read(c,output,staging);File.WriteAllBytes(Path.Combine(folder,"baseline.rgba32f.bin"),Bytes(baseline));
      if(!(baseline[0]>0))throw new Exception("Native direct-light baseline is not positive");
      for(int pattern=0;pattern<5;pattern++){
       var texels=new float[256];for(int y=0;y<16;y++)for(int x=0;x<16;x++){
        float value=pattern==0?0:pattern==1?1:pattern==2?((x+y)%2==0?.25f:.75f):pattern==3?((x*73+y*151+19)%257)/256f:x/15f;
        texels[y*16+x]=value;
       }
       patterns.Add(new {id=pattern,depth=texels});
       using(var t=Texture(d,16,16,1,texels))using(var srv=new ShaderResourceView(d,t)){
        c.ComputeShader.SetShaderResource(21,srv);
        foreach(float quality in new[]{0f,1f,1.75f,2f})foreach(float reference in new[]{-.125f,.25f,.5f,1f,1.25f})for(int projection=0;projection<4;projection++){
         float[] rows={2f,0,0,.013f,0,1.7f,0,-.027f,0,0,0,reference,0,0,0,1};
         if(projection==1){rows[12]=.1f;rows[13]=-.05f;}
         if(projection==2)rows[3]=2;
         if(projection==3)rows[7]=-2;
         Array.Copy(rows,0,values,50*4,16);float[] atlas={.125f,.0625f,.75f,.8125f};Array.Copy(atlas,0,values,54*4,4);
         values[60*4]=1;values[60*4+1]=quality;values[48*4+3]=projection==1?.7f:1;
         Upload(c,cb,values);c.Dispatch(1,1,1);var pixels=Read(c,output,staging);byte[] bytes=Bytes(pixels);
         records.Add(new {index=records.Count,pattern=pattern,quality=quality,reference=reference,projection=projection,rows=rows,atlas=atlas,dimmer=values[48*4+3],offset=payload.Count,bytes=bytes.Length});payload.AddRange(bytes);
        }
       }
      }
     }
    }
   }finally{foreach(var v in keep)v.Dispose();}
   byte[] result=payload.ToArray();File.WriteAllBytes(Path.Combine(folder,"native-cases.rgba32f.bin"),result);
   using(var dxgi=d.QueryInterface<SharpDX.DXGI.Device>())using(var adapter=dxgi.Adapter){
    var doc=new{evidenceId="BF2-NATIVE-SHADOW-WARP-001",backend="D3D11 CPU WARP",adapter=adapter.Description.Description,shader="Entire unchanged original type3 compute DXBC",shaderSha256=Hash(shader),width=8,height=8,atlasSize=16,sourceSampler=new{filter=148,comparison=5,address=3},patterns=patterns,cases=records,samples=records.Count*64,payloadSha256=Hash(result),limitations=new[]{"Controlled GBuffer, matrices, light and atlas inputs validate source consumer arithmetic; they are not a captured native frame.","Original game executable is never executed; this fixture loads only the retained shader bytecode.","Raster depth generation, bias and native atlas allocation order are outside this consumer fixture."}};
    File.WriteAllText(Path.Combine(folder,"execution.json"),new JavaScriptSerializer(){MaxJsonLength=int.MaxValue}.Serialize(doc));
   }
  }
  Console.WriteLine("Original native shadow CS: "+records.Count+" cases x 64 pixels, CPU WARP only.");return 0;
 }
}
