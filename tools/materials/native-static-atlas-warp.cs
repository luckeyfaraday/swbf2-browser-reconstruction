// Original retained RGB-direction atlas PS, driven by a separate fixture VS.
// CPU WARP only. The installed game is never launched.
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
using SharpDX.D3DCompiler;
using SharpDX.DXGI;
using Buffer=SharpDX.Direct3D11.Buffer;
class NativeAtlasWarp {
 static string root;
 static int Main(string[] args) {
  root=Path.GetFullPath(args[0]);
  AppDomain.CurrentDomain.AssemblyResolve+=(s,e)=>{string p=Path.Combine(root,"tools/frosty-1.0.5.2/ThirdParty",new AssemblyName(e.Name).Name+".dll");return File.Exists(p)?Assembly.LoadFrom(p):null;};
  return Run();
 }
 static string Hash(byte[] data){using(var h=SHA256.Create())return BitConverter.ToString(h.ComputeHash(data)).Replace("-","").ToLowerInvariant();}
 static Texture2D Texture(SharpDX.Direct3D11.Device device,int width,int height,byte[] data) {
  IntPtr pointer=Marshal.AllocHGlobal(data.Length);
  try {Marshal.Copy(data,0,pointer,data.Length);return new Texture2D(device,new Texture2DDescription(){Width=width,Height=height,ArraySize=1,MipLevels=1,Format=Format.R32G32B32A32_Float,SampleDescription=new SampleDescription(1,0),Usage=ResourceUsage.Immutable,BindFlags=BindFlags.ShaderResource},new[]{new DataBox(pointer,width*16,data.Length)});}
  finally{Marshal.FreeHGlobal(pointer);}
 }
 static byte[] Bytes(float[] values){var result=new byte[values.Length*4];System.Buffer.BlockCopy(values,0,result,0,result.Length);return result;}
 [MethodImpl(MethodImplOptions.NoInlining)]static int Run() {
  string folder=Path.Combine(root,"exports/lighting/static-atlas-sample");
  byte[] pixel=File.ReadAllBytes(Path.Combine(root,"exports/materials/floor-shader/f789fdaafa.dxbc"));
  if(Hash(pixel)!="f7ff1387f56e121bd57abccb6871b2295793935e2cb46d72e4397cca35dac3bf")throw new Exception("Native PS hash mismatch");
  string source="struct O { float4 pos:SV_Position; float4 transform:TEXCOORD0; float4 world:TEXCOORD1; float4 translationUv:TEXCOORD2; }; O main(uint id:SV_VertexID) { O o; float2 uv=float2((id<<1)&2,id&2); o.pos=float4(uv*float2(2,-2)+float2(-1,1),0,1); o.transform=float4(1,0,0,1); o.world=0; o.translationUv=float4(0,0,uv); return o; }";
  File.WriteAllText(Path.Combine(folder,"fixture-vertex.hlsl"),source);
  var cases=new List<object>();
  using(var code=ShaderBytecode.Compile(source,"main","vs_5_0",ShaderFlags.OptimizationLevel3))
  using(var device=new SharpDX.Direct3D11.Device(DriverType.Warp,DeviceCreationFlags.None,FeatureLevel.Level_11_0))
  using(var vs=new VertexShader(device,code))
  using(var ps=new PixelShader(device,pixel))
  using(var sampler=new SamplerState(device,new SamplerStateDescription(){Filter=Filter.MinMagMipPoint,AddressU=TextureAddressMode.Clamp,AddressV=TextureAddressMode.Clamp,AddressW=TextureAddressMode.Clamp,MaximumLod=float.MaxValue}))
  using(var raster=new RasterizerState(device,new RasterizerStateDescription(){CullMode=CullMode.None,FillMode=FillMode.Solid,IsDepthClipEnabled=true}))
  using(var cb=new Buffer(device,new BufferDescription(){SizeInBytes=42*16,Usage=ResourceUsage.Dynamic,BindFlags=BindFlags.ConstantBuffer,CpuAccessFlags=CpuAccessFlags.Write})) {
   var context=device.ImmediateContext;context.VertexShader.Set(vs);context.PixelShader.Set(ps);context.PixelShader.SetSampler(0,sampler);context.PixelShader.SetSampler(1,sampler);context.PixelShader.SetConstantBuffer(2,cb);context.InputAssembler.PrimitiveTopology=PrimitiveTopology.TriangleList;context.Rasterizer.State=raster;context.Rasterizer.SetViewport(0,0,16,16,0,1);
   float[] constants=new float[42*4];constants[37*4+1]=2;constants[37*4+2]=2;constants[40*4]=1;constants[41*4+1]=1;
   DataStream stream;context.MapSubresource(cb,MapMode.WriteDiscard,SharpDX.Direct3D11.MapFlags.None,out stream);stream.WriteRange(constants);context.UnmapSubresource(cb,0);stream.Dispose();
   var keep=new List<IDisposable>();
   try {
    string[] fields={"StaticIrradianceTexture","StaticDirectionTexture","StaticDirectionTextureG","StaticDirectionTextureB","StaticSkyVisibilityTexture"};
    for(int i=0;i<5;i++){var texture=Texture(device,16,16,File.ReadAllBytes(Path.Combine(folder,fields[i]+".rgba32f.bin")));var view=new ShaderResourceView(device,texture);keep.Add(view);keep.Add(texture);context.PixelShader.SetShaderResource(i+2,view);}
    var description=new Texture2DDescription(){Width=16,Height=16,ArraySize=1,MipLevels=1,Format=Format.R32G32B32A32_Float,SampleDescription=new SampleDescription(1,0),Usage=ResourceUsage.Default,BindFlags=BindFlags.RenderTarget};
    var textures=new Texture2D[4];var views=new RenderTargetView[4];
    for(int i=0;i<4;i++){textures[i]=new Texture2D(device,description);views[i]=new RenderTargetView(device,textures[i]);keep.Add(views[i]);keep.Add(textures[i]);}
    context.OutputMerger.SetTargets(views);
    int caseId=0;
    foreach(float roughnessInput in new[]{.1f,.5f,.9f})foreach(float normalX in new[]{.2f,.5f,.8f}) {
     var materialKeep=new List<IDisposable>();
     try {
      float[][] values={new[]{.5f,.5f,.5f,roughnessInput},new[]{.5f,0f,.5f,0f},new[]{normalX,.5f,.5f,1f},new[]{.5f,.5f,.5f,1f}};
      for(int i=0;i<4;i++){var t=Texture(device,1,1,Bytes(values[i]));var v=new ShaderResourceView(device,t);materialKeep.Add(v);materialKeep.Add(t);context.PixelShader.SetShaderResource(i+7,v);}
      context.Draw(3,0);
      description.Usage=ResourceUsage.Staging;description.BindFlags=BindFlags.None;description.CpuAccessFlags=CpuAccessFlags.Read;
      for(int i=2;i<4;i++)using(var staging=new Texture2D(device,description)) {
       context.CopyResource(textures[i],staging);var mapped=context.MapSubresource(staging,0,MapMode.Read,SharpDX.Direct3D11.MapFlags.None);byte[] data=new byte[16*16*16];for(int y=0;y<16;y++)Marshal.Copy(IntPtr.Add(mapped.DataPointer,y*mapped.RowPitch),data,y*16*16,16*16);context.UnmapSubresource(staging,0);File.WriteAllBytes(Path.Combine(folder,"native-case"+caseId+"-mrt"+i+".rgba32f.bin"),data);
      }
      cases.Add(new {index=caseId++,roughnessTextureW=roughnessInput,normalTextureX=normalX});
     }finally{foreach(var item in materialKeep)item.Dispose();}
    }
   }finally{foreach(var item in keep)item.Dispose();}
  }
  File.WriteAllText(Path.Combine(folder,"native-execution.json"),new JavaScriptSerializer().Serialize(new {evidenceId="BF2-NATIVE-STATIC-ATLAS-PS-WARP-001",backend="D3D11 CPU WARP",pixelShader="Unchanged original f789fdaafa DXBC",pixelSha256=Hash(pixel),fixtureVertexShader="Separately compiled input fixture; not native vertex execution",cases=cases,samples=9*16*16,exposureMultipliers=new {cb2_40_x=1,cb2_41_y=1},limitations=new[]{"Fixture exposure factors are one to validate shader arithmetic; this does not establish native frame exposure state.","Point samples at exact pixel centers isolate lighting arithmetic from filtering."}}));
  Console.WriteLine("Executed original atlas PS: 9 cases x 256 original chart samples on CPU WARP.");return 0;
 }
}
