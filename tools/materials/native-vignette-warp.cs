// Unchanged original linear Tonemap PS isolates native vignette and color scale.
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
class NativeVignetteWarp {
 static string root=System.Environment.GetEnvironmentVariable("BF2_REPO_ROOT")??System.IO.Directory.GetCurrentDirectory(),folder=root+"/exports/lighting/native-vignette-warp";
 static int Main(){AppDomain.CurrentDomain.AssemblyResolve+=(s,e)=>{string p=root+"/tools/frosty-1.0.5.2/ThirdParty/"+new AssemblyName(e.Name).Name+".dll";return File.Exists(p)?Assembly.LoadFrom(p):null;};return Run();}
 static string Hash(byte[] b){using(var h=SHA256.Create())return BitConverter.ToString(h.ComputeHash(b)).Replace("-","").ToLowerInvariant();}
 static byte[] Bytes(float[] v){byte[] b=new byte[v.Length*4];System.Buffer.BlockCopy(v,0,b,0,b.Length);return b;}
 static Texture2D Tex(SharpDX.Direct3D11.Device d,int w,int h,byte[] bytes){
  var t=new Texture2D(d,new Texture2DDescription(){Width=w,Height=h,ArraySize=1,MipLevels=1,Format=Format.R32G32B32A32_Float,SampleDescription=new SampleDescription(1,0),Usage=ResourceUsage.Default,BindFlags=BindFlags.ShaderResource|BindFlags.RenderTarget});
  if(bytes!=null){var p=GCHandle.Alloc(bytes,GCHandleType.Pinned);try{d.ImmediateContext.UpdateSubresource(new DataBox(p.AddrOfPinnedObject(),w*16,w*h*16),t,0);}finally{p.Free();}}return t;
 }
 static byte[] Capture(SharpDX.Direct3D11.Device d,Texture2D texture){
  var desc=texture.Description;desc.Usage=ResourceUsage.Staging;desc.BindFlags=BindFlags.None;desc.CpuAccessFlags=CpuAccessFlags.Read;
  using(var stage=new Texture2D(d,desc)){d.ImmediateContext.CopyResource(texture,stage);var box=d.ImmediateContext.MapSubresource(stage,0,MapMode.Read,SharpDX.Direct3D11.MapFlags.None);byte[] b=new byte[desc.Width*desc.Height*16];try{for(int y=0;y<desc.Height;y++)Marshal.Copy(IntPtr.Add(box.DataPointer,y*box.RowPitch),b,y*desc.Width*16,desc.Width*16);}finally{d.ImmediateContext.UnmapSubresource(stage,0);}return b;}
 }
 [MethodImpl(MethodImplOptions.NoInlining)] static int Run(){
  Directory.CreateDirectory(folder);
  byte[] shader=File.ReadAllBytes(root+"/exports/lighting/native-exposure-shaders/linear-baseline.dxbc");
  if(Hash(shader)!="b2fa39fcd1a70f7a0a45820ad72bb28fc267d0d8efc57549016d7971a7ac84e0")throw new Exception("Original Tonemap shader identity mismatch");
  const int w=32,h=24;float[] input=new float[w*h*4];uint seed=0x7ac31;
  for(int i=0;i<w*h;i++){for(int c=0;c<3;c++){seed=unchecked(seed*1664525+1013904223);input[4*i+c]=(float)Math.Pow(10,-5+seed/(double)uint.MaxValue*6);}input[4*i+3]=1;}
  byte[] inputBytes=Bytes(input);File.WriteAllBytes(folder+"/input.rgba32f.bin",inputBytes);
  // scaleXY, authored exponent, RGB color, opacity, then colorScale RGB.
  float[][] cases={new float[]{2,2,1,0,0,0,0,1,1,1},new float[]{2,2,1,0,0,0,.46f,1,1,1},
   new float[]{3,1.3f,.4f,.1f,.2f,.3f,.8f,.3f,.7f,1.2f},new float[]{.6f,4,2.4f,.2f,.02f,.8f,1,2,.1f,.5f},
   new float[]{4,4,1,0,0,0,1,1,1,1},new float[]{2,2,3,.05f,.2f,.3f,-.4f,.5f,.5f,.5f},
   new float[]{1,1,2,.8f,.1f,.05f,2,1.1f,.8f,.2f},new float[]{0,0,.25f,.1f,.2f,.3f,.46f,1,1,1}};
  var rows=new System.Collections.Generic.List<object>();
  string vertex="struct O{float4 p:SV_Position;float4 a:TEXCOORD0;float2 b:TEXCOORD1;};O main(uint id:SV_VertexID){O o;float2 uv=float2((id<<1)&2,id&2);o.p=float4(uv.x*2-1,1-uv.y*2,0,1);o.a=float4(uv,0,1);o.b=uv;return o;}";
  using(var device=new SharpDX.Direct3D11.Device(DriverType.Warp,DeviceCreationFlags.None,FeatureLevel.Level_11_0))
  using(var code=ShaderBytecode.Compile(vertex,"main","vs_5_0",ShaderFlags.OptimizationLevel3))using(var vs=new VertexShader(device,code))using(var ps=new PixelShader(device,shader))
  using(var sampler=new SamplerState(device,new SamplerStateDescription(){Filter=Filter.MinMagMipPoint,AddressU=TextureAddressMode.Clamp,AddressV=TextureAddressMode.Clamp,AddressW=TextureAddressMode.Clamp,MaximumLod=float.MaxValue}))
  using(var raster=new RasterizerState(device,new RasterizerStateDescription(){CullMode=CullMode.None,FillMode=FillMode.Solid,IsDepthClipEnabled=true}))
  using(var source=Tex(device,w,h,inputBytes))using(var sourceView=new ShaderResourceView(device,source))
  using(var black=Tex(device,1,1,new byte[16]))using(var blackView=new ShaderResourceView(device,black))
  using(var output=Tex(device,w,h,null))using(var rtv=new RenderTargetView(device,output)){
   var c=device.ImmediateContext;c.VertexShader.Set(vs);c.PixelShader.Set(ps);c.InputAssembler.PrimitiveTopology=PrimitiveTopology.TriangleList;c.Rasterizer.State=raster;c.Rasterizer.SetViewport(0,0,w,h);c.PixelShader.SetSamplers(0,sampler,sampler);c.PixelShader.SetShaderResources(0,sourceView,blackView);
   for(int i=0;i<cases.Length;i++){
    float[] p=cases[i],constants=new float[76];constants[24]=p[7];constants[25]=p[8];constants[26]=p[9];constants[27]=1;constants[56]=p[0];constants[57]=p[1];constants[58]=1/p[2];constants[60]=p[3];constants[61]=p[4];constants[62]=p[5];constants[63]=p[6];
    using(var cb=Buffer.Create(device,BindFlags.ConstantBuffer,constants)){c.PixelShader.SetConstantBuffer(0,cb);c.OutputMerger.SetTargets(rtv);c.Draw(3,0);c.OutputMerger.SetTargets((RenderTargetView)null);}
    byte[] bytes=Capture(device,output);string name="case-"+i+".rgba32f.bin";File.WriteAllBytes(folder+"/"+name,bytes);File.WriteAllBytes(folder+"/case-"+i+".cb.bin",Bytes(constants));
    rows.Add(new{index=i,scale=new[]{p[0],p[1]},exponent=p[2],color=new[]{p[3],p[4],p[5]},opacity=p[6],colorScale=new[]{p[7],p[8],p[9]},output=name,sha256=Hash(bytes),constantSha256=Hash(Bytes(constants))});
   }
  }
  var report=new{evidenceId="BF2-NATIVE-VIGNETTE-WARP-001",backend="D3D11 CPU WARP",width=w,height=h,shaderSha256=Hash(shader),inputSha256=Hash(inputBytes),cases=rows,limitations=new[]{"Unchanged original non-HDR Tonemap isolates vignette before sRGB; selected HDR shader uses the identical vignette instruction prefix before PQ.","Zero bloom; synthetic fullscreen geometry and deterministic radiance. Not a captured native frame."}};
  File.WriteAllText(folder+"/execution.json",new System.Web.Script.Serialization.JavaScriptSerializer().Serialize(report));Console.WriteLine("Native vignette: 8 cases, 6144 pixels, unchanged original Tonemap PS.");return 0;
 }
}
