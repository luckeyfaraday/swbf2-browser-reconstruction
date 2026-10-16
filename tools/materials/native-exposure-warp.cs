// Runs unchanged retained native metering VS/PS on CPU WARP, never the game.
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
class NativeExposureWarp {
 static string root;
 static int Main(string[] args) {
  root=Path.GetFullPath(args[0]);
  AppDomain.CurrentDomain.AssemblyResolve+=(s,e)=>{string p=Path.Combine(root,"tools/frosty-1.0.5.2/ThirdParty",new AssemblyName(e.Name).Name+".dll");return File.Exists(p)?Assembly.LoadFrom(p):null;};
  return Run();
 }
 static string Hash(byte[] data){using(var h=SHA256.Create())return BitConverter.ToString(h.ComputeHash(data)).Replace("-","").ToLowerInvariant();}
 static byte[] Bytes(float[] data){var b=new byte[data.Length*4];System.Buffer.BlockCopy(data,0,b,0,b.Length);return b;}
 static byte[] Shader(string name,string expected){var b=File.ReadAllBytes(Path.Combine(root,"exports/lighting/native-exposure-shaders",name+".dxbc"));if(Hash(b)!=expected)throw new Exception("Source hash: "+name);return b;}
 static object Graph(SharpDX.Direct3D11.Device device,Buffer cb,PixelShader log,PixelShader average,SamplerState sampler,bool fast,string folder) {
  var context=device.ImmediateContext;var passes=new List<object>();int sw=32,sh=16;
  byte[] input=File.ReadAllBytes(Path.Combine(folder,"case9-input.rgba32f.bin"));
  IntPtr p=Marshal.AllocHGlobal(input.Length);Marshal.Copy(input,0,p,input.Length);
  var desc=new Texture2DDescription(){Width=sw,Height=sh,ArraySize=1,MipLevels=1,Format=Format.R32G32B32A32_Float,SampleDescription=new SampleDescription(1,0),Usage=ResourceUsage.Immutable,BindFlags=BindFlags.ShaderResource};
  Texture2D source=new Texture2D(device,desc,new[]{new DataBox(p,sw*16,input.Length)});Marshal.FreeHGlobal(p);
  try {
   for(int index=0;index<10;index++) {
    int w=Math.Max(1,256>>index),h=Math.Max(1,128>>index);float[] rect=index==0?new[]{.25f,.125f,.75f,.875f}:new[]{0f,0f,1f,1f};
    float color=BitConverter.ToSingle(BitConverter.GetBytes(uint.MaxValue),0);
    float[] vertices={0,0,color,rect[0],rect[1],0,w,0,color,rect[2],rect[1],0,0,h,color,rect[0],rect[3],0,0,h,color,rect[0],rect[3],0,w,0,color,rect[2],rect[1],0,w,h,color,rect[2],rect[3],0};
    float[] constants=new float[76];constants[0]=1f/w;constants[1]=1f/h;for(int c=0;c<4;c++){constants[4+c]=1;constants[12+c]=1;}constants[52]=.3f;constants[53]=.59f;constants[54]=.11f;constants[72]=65504;constants[73]=65504;constants[74]=65504;
    DataStream stream;context.MapSubresource(cb,MapMode.WriteDiscard,SharpDX.Direct3D11.MapFlags.None,out stream);stream.WriteRange(constants);context.UnmapSubresource(cb,0);stream.Dispose();
    desc.Width=w;desc.Height=h;desc.Format=Format.R16G16B16A16_Float;desc.Usage=ResourceUsage.Default;desc.BindFlags=BindFlags.RenderTarget|BindFlags.ShaderResource;desc.CpuAccessFlags=CpuAccessFlags.None;
    var target=new Texture2D(device,desc);
    using(var vb=Buffer.Create(device,BindFlags.VertexBuffer,vertices))using(var view=new ShaderResourceView(device,source))using(var rtv=new RenderTargetView(device,target)) {
     context.InputAssembler.SetVertexBuffers(0,new VertexBufferBinding(vb,24,0));context.PixelShader.SetSampler(0,sampler);context.PixelShader.Set(index==0?log:average);context.PixelShader.SetShaderResource(0,view);context.OutputMerger.SetTargets(rtv);context.Rasterizer.SetViewport(0,0,w,h);context.Draw(6,0);
     desc.Usage=ResourceUsage.Staging;desc.BindFlags=BindFlags.None;desc.CpuAccessFlags=CpuAccessFlags.Read;
     using(var staging=new Texture2D(device,desc)) {
      context.CopyResource(target,staging);var mapped=context.MapSubresource(staging,0,MapMode.Read,SharpDX.Direct3D11.MapFlags.None);byte[] output=new byte[w*h*8];for(int y=0;y<h;y++)Marshal.Copy(IntPtr.Add(mapped.DataPointer,y*mapped.RowPitch),output,y*w*8,w*8);context.UnmapSubresource(staging,0);string file="graph-"+(fast?"fast":"fallback")+"-"+index+".rgba16f.bin";File.WriteAllBytes(Path.Combine(folder,file),output);passes.Add(new {index=index,width=w,height=h,rectangle=rect,file=file,sha256=Hash(output)});
     }
     context.OutputMerger.SetTargets((RenderTargetView)null);context.PixelShader.SetShaderResource(0,null);
    }
    source.Dispose();source=target;
   }
  } finally {source.Dispose();}
  return new {fast=fast,input="case9-input.rgba32f.bin",sourceWidth=sw,sourceHeight=sh,inputType="RGBA32F fixture input; every reduction destination RGBA16F",passes=passes};
 }
 [MethodImpl(MethodImplOptions.NoInlining)]static int Run() {
  string folder=Path.Combine(root,"exports/lighting/native-exposure-warp");Directory.CreateDirectory(folder);
  byte[] vertex=Shader("grayscale-log-vs","a5a41080c91c7c0b7063d0080648ff5950ae5b6fe7c520ed75ec76252e9309ca");
  byte[] log=Shader("grayscale-log","ff26ec5ab12c383f51da064fdab36996c9630f9d4e3e301dd592950782f47d36");
  byte[] average=Shader("average","077a2a14e5e9f26bf621d7bc9630807dd1746b68c944d9ac25d7e1569878502f");
  byte[] fastLog=Shader("grayscale-log-fast","5e6fb338d7f04a5f47d70eec08382e0e1b9c25c300b00b717bcc3f29603bce14");
  byte[] fastAverage=Shader("average-fast","d8c6bb18a3cb08188e0b7806a09fbdbbd1e576ddef640f25d0361a368af25761");
  var cases=new List<object>();
  using(var device=new SharpDX.Direct3D11.Device(DriverType.Warp,DeviceCreationFlags.None,FeatureLevel.Level_11_0))
  using(var vs=new VertexShader(device,vertex))
  using(var psLog=new PixelShader(device,log))
  using(var psAverage=new PixelShader(device,average))
  using(var psFastLog=new PixelShader(device,fastLog))
  using(var psFastAverage=new PixelShader(device,fastAverage))
  using(var layout=new InputLayout(device,vertex,new[]{new InputElement("TEXCOORD",0,Format.R32G32_Float,0,0),new InputElement("TEXCOORD",1,Format.R8G8B8A8_UNorm,8,0),new InputElement("TEXCOORD",2,Format.R32G32_Float,12,0)}))
  using(var sampler=new SamplerState(device,new SamplerStateDescription(){Filter=Filter.MinMagMipPoint,AddressU=TextureAddressMode.Clamp,AddressV=TextureAddressMode.Clamp,AddressW=TextureAddressMode.Clamp,MaximumLod=float.MaxValue}))
  using(var linearSampler=new SamplerState(device,new SamplerStateDescription(){Filter=Filter.MinMagMipLinear,AddressU=TextureAddressMode.Clamp,AddressV=TextureAddressMode.Clamp,AddressW=TextureAddressMode.Clamp,MaximumLod=float.MaxValue}))
  using(var raster=new RasterizerState(device,new RasterizerStateDescription(){CullMode=CullMode.None,FillMode=FillMode.Solid,IsDepthClipEnabled=true}))
  using(var cb=new Buffer(device,new BufferDescription(){SizeInBytes=19*16,Usage=ResourceUsage.Dynamic,BindFlags=BindFlags.ConstantBuffer,CpuAccessFlags=CpuAccessFlags.Write})) {
   var context=device.ImmediateContext;context.VertexShader.Set(vs);context.VertexShader.SetConstantBuffer(0,cb);context.PixelShader.SetConstantBuffer(0,cb);context.PixelShader.SetSampler(0,sampler);context.InputAssembler.PrimitiveTopology=PrimitiveTopology.TriangleList;context.InputAssembler.InputLayout=layout;context.Rasterizer.State=raster;
   for(int k=0;k<16;k++) {
    int variant=k%8;bool fast=k>=8,logarithmic=variant<4;int sw=32,sh=16,w=variant==7?1:(variant==6?4:8),h=variant==7?1:(variant==6?2:4);
    float scale=variant==2?.125f:(variant==5?.25f:1f);float[] rect=variant==1?new[]{.25f,.125f,.75f,.875f}:new[]{0f,0f,1f,1f};
    float[] input=new float[sw*sh*4];
    for(int y=0;y<sh;y++)for(int x=0;x<sw;x++) {
     int i=(y*sw+x)*4;
     input[i]=variant==0?125.375f:((x%7)-2)*73.25f;
     input[i+1]=variant==0?178.625f:(y+1)*(y+1)*9.125f;
     input[i+2]=variant==0?242.5f:((x+y)%5==0?80000f:3.5f*x+y);
     input[i+3]=(x-y)*.125f;
     if(variant==3){input[i]=-500;input[i+1]=100000;input[i+2]=0;}
    }
    File.WriteAllBytes(Path.Combine(folder,"case"+k+"-input.rgba32f.bin"),Bytes(input));
    byte[] bytes=Bytes(input);IntPtr p=Marshal.AllocHGlobal(bytes.Length);Marshal.Copy(bytes,0,p,bytes.Length);
    var inputDesc=new Texture2DDescription(){Width=sw,Height=sh,ArraySize=1,MipLevels=1,Format=Format.R32G32B32A32_Float,SampleDescription=new SampleDescription(1,0),Usage=ResourceUsage.Immutable,BindFlags=BindFlags.ShaderResource};
    using(var texture=new Texture2D(device,inputDesc,new[]{new DataBox(p,sw*16,bytes.Length)}))
    using(var view=new ShaderResourceView(device,texture)) {
     Marshal.FreeHGlobal(p);
     float packedColor=BitConverter.ToSingle(BitConverter.GetBytes(uint.MaxValue),0);
     float[] vertices={0,0,packedColor,rect[0],rect[1],0, w,0,packedColor,rect[2],rect[1],0, 0,h,packedColor,rect[0],rect[3],0, 0,h,packedColor,rect[0],rect[3],0, w,0,packedColor,rect[2],rect[1],0, w,h,packedColor,rect[2],rect[3],0};
     using(var vb=Buffer.Create(device,BindFlags.VertexBuffer,vertices)) {
      context.InputAssembler.SetVertexBuffers(0,new VertexBufferBinding(vb,24,0));
      float[] constants=new float[19*4];constants[0]=1f/w;constants[1]=1f/h;
      for(int c=0;c<4;c++)constants[4+c]=scale;
      for(int c=0;c<4;c++)constants[12+c]=scale;
      constants[13*4]=.3f*scale;constants[13*4+1]=.59f*scale;constants[13*4+2]=.11f*scale;
      constants[18*4]=65504;constants[18*4+1]=65504;constants[18*4+2]=65504;
      DataStream stream;context.MapSubresource(cb,MapMode.WriteDiscard,SharpDX.Direct3D11.MapFlags.None,out stream);stream.WriteRange(constants);context.UnmapSubresource(cb,0);stream.Dispose();
      var desc=new Texture2DDescription(){Width=w,Height=h,ArraySize=1,MipLevels=1,Format=Format.R32G32B32A32_Float,SampleDescription=new SampleDescription(1,0),Usage=ResourceUsage.Default,BindFlags=BindFlags.RenderTarget};
      using(var target=new Texture2D(device,desc))using(var rtv=new RenderTargetView(device,target)) {
       context.OutputMerger.SetTargets(rtv);context.Rasterizer.SetViewport(0,0,w,h,0,1);context.PixelShader.Set(fast?(logarithmic?psFastLog:psFastAverage):(logarithmic?psLog:psAverage));context.PixelShader.SetSampler(0,fast?linearSampler:sampler);context.PixelShader.SetShaderResource(0,view);context.Draw(6,0);
       desc.Usage=ResourceUsage.Staging;desc.BindFlags=BindFlags.None;desc.CpuAccessFlags=CpuAccessFlags.Read;
       using(var staging=new Texture2D(device,desc)) {
        context.CopyResource(target,staging);var mapped=context.MapSubresource(staging,0,MapMode.Read,SharpDX.Direct3D11.MapFlags.None);byte[] output=new byte[w*h*16];for(int y=0;y<h;y++)Marshal.Copy(IntPtr.Add(mapped.DataPointer,y*mapped.RowPitch),output,y*w*16,w*16);context.UnmapSubresource(staging,0);File.WriteAllBytes(Path.Combine(folder,"case"+k+"-native.rgba32f.bin"),output);
       }
       context.OutputMerger.SetTargets((RenderTargetView)null);context.PixelShader.SetShaderResource(0,null);
      }
     }
    }
    cases.Add(new {index=k,program=(logarithmic?"grayscale-log":"average")+(fast?"-fast":""),fast=fast,sourceWidth=sw,sourceHeight=sh,width=w,height=h,rectangle=rect,scale=scale,maxClamp=65504});
   }
   var graphs=new[]{Graph(device,cb,psLog,psAverage,sampler,false,folder),Graph(device,cb,psFastLog,psFastAverage,linearSampler,true,folder)};
   File.WriteAllText(Path.Combine(folder,"graphs.json"),new JavaScriptSerializer().Serialize(new {evidenceId="BF2-NATIVE-EXPOSURE-WARP-GRAPH-001",backend="D3D11 CPU WARP",halfFormatSupport=(uint)device.CheckFormatSupport(Format.R16G16B16A16_Float),graphs=graphs,limitations=new[]{"Controlled float32 input with explicit source half-float clamp; every subsequent intermediate is native RGBA16F.","Native asynchronous ring scheduling is not reproduced."}}));
  }
  File.WriteAllText(Path.Combine(folder,"manifest.json"),new JavaScriptSerializer().Serialize(new {evidenceId="BF2-NATIVE-EXPOSURE-WARP-001",backend="D3D11 CPU WARP",originalVS=Hash(vertex),originalLogPS=Hash(log),originalAveragePS=Hash(average),originalFastLogPS=Hash(fastLog),originalFastAveragePS=Hash(fastAverage),sampler="Source converter1415a41c0/1415affc0: fallback POINT, fast LINEAR, both CLAMP_UVW",cases=cases,limitations=new[]{"Float32 targets isolate native shader arithmetic; native graph uses half-float intermediate targets.","These individual pass fixtures do not reproduce graph quantization or scheduling.","No original executable launched."}}));
  Console.WriteLine("Original metering VS/PS: 16 CPU-WARP fixtures retained.");return 0;
 }
}
