// Unchanged native Tonemap/MergeRenderPlanes PS; synthetic fullscreen VS only.
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
using SharpDX.D3DCompiler;
using Buffer=SharpDX.Direct3D11.Buffer;
class NativeColorGradingWarp {
 static string root=System.Environment.GetEnvironmentVariable("BF2_REPO_ROOT")??System.IO.Directory.GetCurrentDirectory(),folder; static bool renderPlane,vignette;
 static int Main(string[] args){renderPlane=Array.IndexOf(args,"--render-plane")>=0;vignette=Array.IndexOf(args,"--vignette")>=0;AppDomain.CurrentDomain.AssemblyResolve+=(s,e)=>{string p=root+"/tools/frosty-1.0.5.2/ThirdParty/"+new AssemblyName(e.Name).Name+".dll";return File.Exists(p)?Assembly.LoadFrom(p):null;};return Run();}
 static string Hash(byte[] b){using(var h=SHA256.Create())return BitConverter.ToString(h.ComputeHash(b)).Replace("-","").ToLowerInvariant();}
 static byte[] Bytes(float[] v){byte[] b=new byte[v.Length*4];System.Buffer.BlockCopy(v,0,b,0,b.Length);return b;}
 static byte[] Read(string name){return File.ReadAllBytes(root+"/exports/lighting/"+name);}
 static Texture2D Tex(SharpDX.Direct3D11.Device d,int w,int h,byte[] bytes,bool rgb10=false){
  var desc=new Texture2DDescription(){Width=w,Height=h,ArraySize=1,MipLevels=1,Format=rgb10?Format.R10G10B10A2_UNorm:Format.R32G32B32A32_Float,SampleDescription=new SampleDescription(1,0),Usage=ResourceUsage.Default,BindFlags=BindFlags.ShaderResource|BindFlags.RenderTarget};
  var t=new Texture2D(d,desc);if(bytes!=null){var pin=GCHandle.Alloc(bytes,GCHandleType.Pinned);try{d.ImmediateContext.UpdateSubresource(new DataBox(pin.AddrOfPinnedObject(),w*16,w*h*16),t,0);}finally{pin.Free();}}return t;
 }
 static Texture3D Cube(SharpDX.Direct3D11.Device d,byte[] bytes,bool packed){
  var desc=new Texture3DDescription(){Width=33,Height=33,Depth=33,MipLevels=1,Format=packed?Format.R10G10B10A2_UNorm:Format.R32G32B32A32_Float,Usage=ResourceUsage.Default,BindFlags=BindFlags.ShaderResource};
  var t=new Texture3D(d,desc);var pin=GCHandle.Alloc(bytes,GCHandleType.Pinned);int stride=packed?4:16;
  try{d.ImmediateContext.UpdateSubresource(new DataBox(pin.AddrOfPinnedObject(),33*stride,33*33*stride),t,0);}finally{pin.Free();}return t;
 }
 static byte[] Capture(SharpDX.Direct3D11.Device d,Texture2D texture){
  var desc=texture.Description;desc.Usage=ResourceUsage.Staging;desc.BindFlags=BindFlags.None;desc.CpuAccessFlags=CpuAccessFlags.Read;
  using(var stage=new Texture2D(d,desc)){d.ImmediateContext.CopyResource(texture,stage);var box=d.ImmediateContext.MapSubresource(stage,0,MapMode.Read,SharpDX.Direct3D11.MapFlags.None);int stride=desc.Format==Format.R10G10B10A2_UNorm?4:16;byte[] b=new byte[desc.Width*desc.Height*stride];try{for(int y=0;y<desc.Height;y++)Marshal.Copy(IntPtr.Add(box.DataPointer,y*box.RowPitch),b,y*desc.Width*stride,desc.Width*stride);}finally{d.ImmediateContext.UnmapSubresource(stage,0);}return b;}
 }
 [MethodImpl(MethodImplOptions.NoInlining)]static int Run(){
  folder=root+"/exports/lighting/native-colorgrading-warp"+(renderPlane?"-rgb10-plane":"")+(vignette?"-vignette":"");Directory.CreateDirectory(folder);
  byte[] tone=Read("native-postprocess-shaders/linear-hdr-grading-lut.dxbc"),merge=Read("native-postprocess-shaders/merge-hdr-sdr.dxbc"),encode=Read("native-postprocess-shaders/linear-hdr-grading.dxbc");
  if(Hash(tone)!="81cd1d7fbae4491d7f0bbabb592bc933a302e79ba6dd278c2a9bc6340e3df268"||Hash(encode)!="51486201c72f942c6ce25b2d9c25dfe6b7da5aaea290856b53c444939df232ee")throw new Exception("Tonemap PS identity mismatch");
  if(Hash(merge)!="745adca8b069143d62f1a97a8d9959cbae7d21a179338dc80c06e16843a74ce2")throw new Exception("Merge PS identity mismatch");
  byte[] packed=Read("native-colorcube-warp-sdr/half.rgb10a2.bin"),pq=Read("native-colorgrading/pq-to-linear.r16f.bin");
  float[] cube=new float[33*33*33*4];for(int i=0;i<cube.Length/4;i++){uint v=BitConverter.ToUInt32(packed,i*4);cube[i*4]=(v&1023)/1023f;cube[i*4+1]=((v>>10)&1023)/1023f;cube[i*4+2]=((v>>20)&1023)/1023f;cube[i*4+3]=(v>>30)/3f;}
  byte[] decoded=Bytes(cube);File.WriteAllBytes(folder+"/cube.rgba32f.bin",decoded);
  const int w=64,h=64;float[] colors=new float[w*h*4];uint seed=0x719032;
  float[] edges={0,1e-8f,1e-5f,.0001f,.001f,.0031308f,.01f,.1f,.18f,.5f,1,2,4,10,50,100,200,1000};
  for(int i=0;i<w*h;i++){for(int c=0;c<3;c++){seed=unchecked(seed*1664525+1013904223);colors[i*4+c]=i<edges.Length?edges[i]:(float)Math.Pow(10,-7+(seed/(double)uint.MaxValue)*10);}colors[i*4+3]=1;}
  File.WriteAllBytes(folder+"/input.rgba32f.bin",Bytes(colors));
  string vertex="struct O{float4 p:SV_Position;float4 a:TEXCOORD0;float2 b:TEXCOORD1;};O main(uint id:SV_VertexID){O o;float2 uv=float2((id<<1)&2,id&2);o.p=float4(uv.x*2-1,1-uv.y*2,0,1);o.a=float4(uv,0,1);o.b=uv;return o;}";
  var rows=new System.Collections.Generic.List<object>();
  using(var device=new SharpDX.Direct3D11.Device(DriverType.Warp,DeviceCreationFlags.None,FeatureLevel.Level_11_0))
  using(var code=ShaderBytecode.Compile(vertex,"main","vs_5_0",ShaderFlags.OptimizationLevel3))
  using(var vs=new VertexShader(device,code))
  using(var psTone=new PixelShader(device,tone))using(var psMerge=new PixelShader(device,merge))using(var psEncode=new PixelShader(device,encode))
  using(var linear=new SamplerState(device,new SamplerStateDescription(){Filter=Filter.MinMagMipLinear,AddressU=TextureAddressMode.Clamp,AddressV=TextureAddressMode.Clamp,AddressW=TextureAddressMode.Clamp,MaximumLod=float.MaxValue}))
  using(var point=new SamplerState(device,new SamplerStateDescription(){Filter=Filter.MinMagMipPoint,AddressU=TextureAddressMode.Clamp,AddressV=TextureAddressMode.Clamp,AddressW=TextureAddressMode.Clamp,MaximumLod=float.MaxValue}))
  using(var raster=new RasterizerState(device,new RasterizerStateDescription(){CullMode=CullMode.None,FillMode=FillMode.Solid,IsDepthClipEnabled=true}))
  using(var input=Tex(device,w,h,Bytes(colors)))using(var inputView=new ShaderResourceView(device,input))
  using(var black=Tex(device,1,1,new byte[16]))using(var blackView=new ShaderResourceView(device,black))
  using(var lookup=new Texture1D(device,new Texture1DDescription(){Width=1024,ArraySize=1,MipLevels=1,Format=Format.R16_Float,Usage=ResourceUsage.Default,BindFlags=BindFlags.ShaderResource}))
  using(var lookupView=new ShaderResourceView(device,lookup)){
   var context=device.ImmediateContext;var pin=GCHandle.Alloc(pq,GCHandleType.Pinned);try{context.UpdateSubresource(new DataBox(pin.AddrOfPinnedObject(),2048,2048),lookup,0);}finally{pin.Free();}
   context.VertexShader.Set(vs);context.InputAssembler.PrimitiveTopology=PrimitiveTopology.TriangleList;context.Rasterizer.State=raster;context.Rasterizer.SetViewport(0,0,w,h);
   float[] toneCB=new float[76];toneCB[24]=toneCB[25]=toneCB[26]=toneCB[27]=1;toneCB[58]=1;
   if(vignette){toneCB[56]=toneCB[57]=2;toneCB[63]=.46f;}
   float[] mergeCB=new float[40];mergeCB[8]=1;
   using(var tc=Buffer.Create(device,BindFlags.ConstantBuffer,toneCB))using(var mc=Buffer.Create(device,BindFlags.ConstantBuffer,mergeCB)){
    using(var encoded=Tex(device,w,h,null))using(var encodedRtv=new RenderTargetView(device,encoded)){
     context.PixelShader.Set(psEncode);context.PixelShader.SetConstantBuffer(0,tc);context.PixelShader.SetShaderResource(0,inputView);context.PixelShader.SetShaderResource(2,blackView);context.PixelShader.SetSamplers(0,linear,linear,linear);context.OutputMerger.SetTargets(encodedRtv);context.Draw(3,0);
     context.OutputMerger.SetTargets((RenderTargetView)null);context.PixelShader.SetShaderResources(0,new ShaderResourceView[]{null,null,null});File.WriteAllBytes(folder+"/encoded.rgba32f.bin",Capture(device,encoded));
    }
    foreach(bool usePacked in new[]{true,false}){
     using(var lut=Cube(device,usePacked?packed:decoded,usePacked))using(var lutView=new ShaderResourceView(device,lut))
     using(var graded=Tex(device,w,h,null,renderPlane))using(var gradedRtv=new RenderTargetView(device,graded))using(var gradedSrv=new ShaderResourceView(device,graded))
     using(var final=Tex(device,w,h,null))using(var finalRtv=new RenderTargetView(device,final)){
      context.PixelShader.Set(psTone);context.PixelShader.SetConstantBuffer(0,tc);context.PixelShader.SetShaderResources(0,inputView,lutView,blackView);context.PixelShader.SetSamplers(0,linear,linear,linear);context.OutputMerger.SetTargets(gradedRtv);context.Draw(3,0);
      context.OutputMerger.SetTargets((RenderTargetView)null);context.PixelShader.SetShaderResources(0,new ShaderResourceView[]{null,null,null});
      byte[] gradePixels=Capture(device,graded);
      context.PixelShader.Set(psMerge);context.PixelShader.SetConstantBuffer(0,mc);context.PixelShader.SetShaderResource(0,gradedSrv);context.PixelShader.SetShaderResource(2,lookupView);context.PixelShader.SetSamplers(0,point,linear);context.OutputMerger.SetTargets(finalRtv);context.Draw(3,0);
      context.OutputMerger.SetTargets((RenderTargetView)null);context.PixelShader.SetShaderResources(0,new ShaderResourceView[]{null,null,null});
      byte[] finalPixels=Capture(device,final);string tag=usePacked?"packed":"float";
      File.WriteAllBytes(folder+"/"+tag+(renderPlane?"-graded.rgb10a2.bin":"-graded.rgba32f.bin"),gradePixels);File.WriteAllBytes(folder+"/"+tag+"-final.rgba32f.bin",finalPixels);
      rows.Add(new{tag=tag,gradedSha256=Hash(gradePixels),finalSha256=Hash(finalPixels)});
     }
    }
   }
  }
  var report=new{evidenceId="BF2-NATIVE-COLORGRADING"+(renderPlane?"-RGB10-PLANE":"")+(vignette?"-VIGNETTE":"")+"-WARP-001",vignette=vignette,intermediateFormat=renderPlane?"R10G10B10A2_UNORM":"RGBA32F diagnostic",backend="D3D11 CPU WARP",width=w,height=h,tonemapShaderSha256=Hash(tone),mergeShaderSha256=Hash(merge),encodeShaderSha256=Hash(encode),encodedSha256=Hash(File.ReadAllBytes(folder+"/encoded.rgba32f.bin")),cubePackedSha256=Hash(packed),cubeFloatSha256=Hash(decoded),pqLookupSha256=Hash(pq),inputSha256=Hash(Bytes(colors)),results=rows,limitations=new[]{"Original pixel shaders and source-generated cube; synthetic fullscreen vertex fixture.",renderPlane?"RGB10A2 intermediate matches the recovered supported SDR main render-plane allocation.":"Float32 intermediate isolates equations and omits the separately recovered native RGB10A2 render-plane quantization.",vignette?"Zero bloom, original gamewide vignette (scale2, exponent1, opacity.46), exposure1; no captured native frame.":"Zero bloom, inactive vignette, exposure1 fixture; no captured native frame."}};
  File.WriteAllText(folder+"/execution.json",new System.Web.Script.Serialization.JavaScriptSerializer().Serialize(report));
  Console.WriteLine("Native grading: 4096 original Tonemap + Merge pixels for each packed/float cube fixture.");return 0;
 }
}
