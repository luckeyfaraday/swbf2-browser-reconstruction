// Unchanged native GaussianPyramidCs, Tex2d/Tex2dDouble and Tonemap bytecode on D3D11 WARP.
// Synthetic HDR input; fullscreen VS is synthetic. Evidence BF2-NATIVE-BLOOM-WARP-001.
using System;
using System.Collections.Generic;
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
class NativeBloomWarp {
 static string root=System.Environment.GetEnvironmentVariable("BF2_REPO_ROOT")??System.IO.Directory.GetCurrentDirectory(),folder=root+"/exports/lighting/native-bloom-warp";
 static int Main(string[] args){AppDomain.CurrentDomain.AssemblyResolve+=(s,e)=>{string p=root+"/tools/frosty-1.0.5.2/ThirdParty/"+new AssemblyName(e.Name).Name+".dll";return File.Exists(p)?Assembly.LoadFrom(p):null;};return Run();}
 static string Hash(byte[] b){using(var h=SHA256.Create())return BitConverter.ToString(h.ComputeHash(b)).Replace("-","").ToLowerInvariant();}
 static byte[] Bytes(float[] v){byte[] b=new byte[v.Length*4];System.Buffer.BlockCopy(v,0,b,0,b.Length);return b;}
 static byte[] Shader(string name,string sha){byte[] b=File.ReadAllBytes(root+"/exports/lighting/"+name+".dxbc");if(Hash(b)!=sha)throw new Exception(name+" identity mismatch");return b;}
 static Texture2D Tex(SharpDX.Direct3D11.Device d,int w,int h,Format f,BindFlags bind,byte[] bytes=null,int stride=16){
  var t=new Texture2D(d,new Texture2DDescription(){Width=w,Height=h,ArraySize=1,MipLevels=1,Format=f,SampleDescription=new SampleDescription(1,0),Usage=ResourceUsage.Default,BindFlags=bind});
  if(bytes!=null){var pin=GCHandle.Alloc(bytes,GCHandleType.Pinned);try{d.ImmediateContext.UpdateSubresource(new DataBox(pin.AddrOfPinnedObject(),w*stride,w*h*stride),t,0);}finally{pin.Free();}}return t;
 }
 static byte[] Capture(SharpDX.Direct3D11.Device d,Texture2D texture,int bytesPerPixel){
  var desc=texture.Description;desc.Usage=ResourceUsage.Staging;desc.BindFlags=BindFlags.None;desc.CpuAccessFlags=CpuAccessFlags.Read;
  using(var staging=new Texture2D(d,desc)){d.ImmediateContext.CopyResource(texture,staging);var box=d.ImmediateContext.MapSubresource(staging,0,MapMode.Read,SharpDX.Direct3D11.MapFlags.None);
   try{int row=desc.Width*bytesPerPixel;byte[] o=new byte[row*desc.Height];for(int y=0;y<desc.Height;y++)Marshal.Copy(box.DataPointer+y*box.RowPitch,o,y*row,row);return o;}finally{d.ImmediateContext.UnmapSubresource(staging,0);}}
 }
 [MethodImpl(MethodImplOptions.NoInlining)]static int Run(){
  Directory.CreateDirectory(folder);
  var evidence=(Dictionary<string,object>)new System.Web.Script.Serialization.JavaScriptSerializer(){MaxJsonLength=int.MaxValue}.DeserializeObject(File.ReadAllText(root+"/exports/lighting/native-bloom/evidence.json"));
  byte[] aligned=File.ReadAllBytes(root+"/exports/lighting/native-bloom-shaders/gaussian-pyramid-aligned.dxbc");
  byte[] unaligned=File.ReadAllBytes(root+"/exports/lighting/native-bloom-shaders/gaussian-pyramid-unaligned.dxbc"),robust=File.ReadAllBytes(root+"/exports/lighting/native-bloom-shaders/gaussian-pyramid-robust.dxbc");
  byte[] tex2d=File.ReadAllBytes(root+"/exports/lighting/native-bloom-shaders/tex2d.dxbc"),tex2dDouble=File.ReadAllBytes(root+"/exports/lighting/native-bloom-shaders/tex2d-double-1.dxbc");
  byte[] tone=Shader("native-postprocess-shaders/linear-hdr-grading-lut","81cd1d7fbae4491d7f0bbabb592bc933a302e79ba6dd278c2a9bc6340e3df268");
  byte[] encode=Shader("native-postprocess-shaders/linear-hdr-grading","51486201c72f942c6ce25b2d9c25dfe6b7da5aaea290856b53c444939df232ee");
  var manifest=(Dictionary<string,object>)new System.Web.Script.Serialization.JavaScriptSerializer().DeserializeObject(File.ReadAllText(root+"/exports/lighting/native-bloom-shaders/manifest.json"));
  var expected=new Dictionary<string,string>();foreach(Dictionary<string,object> row in (object[])manifest["stages"])expected[(string)row["file"]]=(string)row["sha256"];
  foreach(var pair in new[]{Tuple.Create("gaussian-pyramid-aligned",aligned),Tuple.Create("gaussian-pyramid-unaligned",unaligned),Tuple.Create("gaussian-pyramid-robust",robust),Tuple.Create("tex2d",tex2d),Tuple.Create("tex2d-double-1",tex2dDouble)})
   if(Hash(pair.Item2)!=expected[pair.Item1])throw new Exception(pair.Item1+" identity mismatch");
  byte[] packed=File.ReadAllBytes(root+"/exports/lighting/native-colorcube-warp-sdr/half.rgb10a2.bin");
  const int W=160,H=90;
  // Scene-like HDR: dim log-uniform background, a lit rectangle, hot emitters and a hard edge.
  float[] input=new float[W*H*4];uint seed=0x5eed1;
  for(int y=0;y<H;y++)for(int x=0;x<W;x++){int i=(y*W+x)*4;for(int c=0;c<3;c++){seed=unchecked(seed*1664525+1013904223);input[i+c]=(float)Math.Pow(10,-3+(seed/(double)uint.MaxValue)*3);}
   if(x>=100&&x<130&&y>=20&&y<60){input[i]+=4;input[i+1]+=5;input[i+2]+=6;}if(x<6){input[i]=input[i+1]=input[i+2]=50;}input[i+3]=1;}
  foreach(int[] hot in new[]{new[]{20,15,400},new[]{70,44,2000},new[]{140,80,900},new[]{0,0,300},new[]{159,89,600},new[]{80,45,150}}){int i=(hot[1]*W+hot[0])*4;input[i]=hot[2];input[i+1]=hot[2]*.8f;input[i+2]=hot[2]*.6f;}
  byte[] inputBytes=Bytes(input);File.WriteAllBytes(folder+"/input.rgba32f.bin",inputBytes);
  // 141569670 level layout and the evidence weight table (141561810 with CRT powf).
  var sizes=new List<int[]>();{int lw=W,lh=H;int largest=Math.Max(W>>1,H>>1),fromSize=0;for(int v=largest;v>0;v>>=1)fromSize++;int heightLimit=0;for(int v=H;v>1;v>>=1)heightLimit++;heightLimit-=1;int L=Math.Max(0,Math.Min(Math.Min(fromSize,heightLimit),15));for(int i=0;i<L;i++){lw=Math.Max(1,lw>>1);lh=Math.Max(1,lh>>1);sizes.Add(new[]{lw,lh});}}
  int levels=sizes.Count;
  var table=(Dictionary<string,object>)((Dictionary<string,object>)evidence["weightTables"])["0.5"];var weightRow=(object[])table[levels.ToString()];
  float[] weights=new float[levels];for(int i=0;i<levels;i++)weights[i]=Convert.ToSingle(weightRow[i]);
  string vertex="struct O{float4 p:SV_Position;float4 a:TEXCOORD0;float2 b:TEXCOORD1;};O main(uint id:SV_VertexID){O o;float2 uv=float2((id<<1)&2,id&2);o.p=float4(uv.x*2-1,1-uv.y*2,0,1);o.a=float4(uv,0,1);o.b=uv;return o;}";
  var rows=new List<object>();
  using(var device=new SharpDX.Direct3D11.Device(DriverType.Warp,DeviceCreationFlags.None,FeatureLevel.Level_11_0))
  using(var code=ShaderBytecode.Compile(vertex,"main","vs_5_0",ShaderFlags.OptimizationLevel3))
  using(var vs=new VertexShader(device,code))
  using(var csAligned=new ComputeShader(device,aligned))using(var csUnaligned=new ComputeShader(device,unaligned))using(var csRobust=new ComputeShader(device,robust))
  using(var psTex2d=new PixelShader(device,tex2d))using(var psDouble=new PixelShader(device,tex2dDouble))using(var psTone=new PixelShader(device,tone))using(var psEncode=new PixelShader(device,encode))
  using(var linear=new SamplerState(device,new SamplerStateDescription(){Filter=Filter.MinMagMipLinear,AddressU=TextureAddressMode.Clamp,AddressV=TextureAddressMode.Clamp,AddressW=TextureAddressMode.Clamp,MaximumLod=float.MaxValue}))
  using(var raster=new RasterizerState(device,new RasterizerStateDescription(){CullMode=CullMode.None,FillMode=FillMode.Solid,IsDepthClipEnabled=true})){
   var context=device.ImmediateContext;
   var mipsByMode=new Dictionary<string,List<Texture2D>>();
   foreach(string mode in new[]{"native","unaligned","robust"}){
    var mips=new List<Texture2D>{Tex(device,W,H,Format.R32G32B32A32_Float,BindFlags.ShaderResource|BindFlags.UnorderedAccess,inputBytes)};
    int sw=W,sh=H;
    for(int level=0;level<levels;level++){
     int dw=sizes[level][0],dh=sizes[level][1];bool isAligned=sw==dw*2&&sh==dh*2;
     var shader=mode=="robust"?csRobust:mode=="unaligned"||!isAligned?csUnaligned:csAligned;
     var dst=Tex(device,dw,dh,Format.R32G32B32A32_Float,BindFlags.ShaderResource|BindFlags.UnorderedAccess);
     byte[] cb=new byte[48];
     BitConverter.GetBytes(1f/sw).CopyTo(cb,8);BitConverter.GetBytes(1f/sh).CopyTo(cb,12);BitConverter.GetBytes((float)sw/dw).CopyTo(cb,16);BitConverter.GetBytes((float)sh/dh).CopyTo(cb,20);
     BitConverter.GetBytes((uint)dw).CopyTo(cb,24);BitConverter.GetBytes((uint)dh).CopyTo(cb,28);BitConverter.GetBytes(0u).CopyTo(cb,32);BitConverter.GetBytes((uint)sw).CopyTo(cb,36);BitConverter.GetBytes((uint)sh).CopyTo(cb,40);
     using(var buffer=Buffer.Create(device,BindFlags.ConstantBuffer,cb))using(var srv=new ShaderResourceView(device,mips[level]))using(var uav=new UnorderedAccessView(device,dst)){
      context.ComputeShader.Set(shader);context.ComputeShader.SetConstantBuffer(0,buffer);context.ComputeShader.SetShaderResource(0,srv);context.ComputeShader.SetSampler(0,linear);context.ComputeShader.SetUnorderedAccessView(0,uav);
      context.Dispatch((dw+7)/8,(dh+31)/32,1);
      context.ComputeShader.SetUnorderedAccessView(0,null);context.ComputeShader.SetShaderResource(0,null);
     }
     byte[] pixels=Capture(device,dst,16);string file=mode+"-mip"+(level+1)+".rgba32f.bin";File.WriteAllBytes(folder+"/"+file,pixels);
     rows.Add(new{kind="pyramid",mode=mode,level=level+1,width=dw,height=dh,shader=shader==csAligned?"aligned":shader==csRobust?"robust":"unaligned",output=file,sha256=Hash(pixels)});
     mips.Add(dst);sw=dw;sh=dh;
    }
    mipsByMode[mode]=mips;
   }
   // GaussianBloom upsample-accumulate on the native-selection pyramid, R11G11B10_FLOAT targets.
   context.VertexShader.Set(vs);context.InputAssembler.PrimitiveTopology=PrimitiveTopology.TriangleList;context.Rasterizer.State=raster;
   var native=mipsByMode["native"];Texture2D previous=null;var upsample=new Texture2D[levels];
   for(int level=levels-1;level>=0;level--){
    int lw=sizes[level][0],lh=sizes[level][1];var target=Tex(device,lw,lh,Format.R11G11B10_Float,BindFlags.ShaderResource|BindFlags.RenderTarget);
    float[] cbFloats=new float[20];cbFloats[12]=cbFloats[13]=cbFloats[14]=weights[level];cbFloats[15]=1;cbFloats[16]=cbFloats[17]=cbFloats[18]=cbFloats[19]=1;
    using(var buffer=Buffer.Create(device,BindFlags.ConstantBuffer,cbFloats))using(var rtv=new RenderTargetView(device,target))using(var pyramidView=new ShaderResourceView(device,native[level+1])){
     ShaderResourceView previousView=previous==null?null:new ShaderResourceView(device,previous);
     context.PixelShader.Set(previous==null?psTex2d:psDouble);context.PixelShader.SetConstantBuffer(0,buffer);context.PixelShader.SetShaderResources(0,pyramidView,previousView);context.PixelShader.SetSamplers(0,linear,linear);
     context.Rasterizer.SetViewport(0,0,lw,lh);context.OutputMerger.SetTargets(rtv);context.Draw(3,0);
     context.OutputMerger.SetTargets((RenderTargetView)null);context.PixelShader.SetShaderResources(0,new ShaderResourceView[]{null,null});if(previousView!=null)previousView.Dispose();
    }
    byte[] pixels=Capture(device,target,4);string file="upsample"+level+".r11g11b10.bin";File.WriteAllBytes(folder+"/"+file,pixels);
    rows.Add(new{kind="upsample",level=level,width=lw,height=lh,weight=weights[level],output=file,sha256=Hash(pixels)});
    upsample[level]=target;previous=target;
   }
   // Native Tonemap (colorGrading=1, bloomSoftClipping=0) with the bloom output: graded RGBA32F.
   using(var cube=new Texture3D(device,new Texture3DDescription(){Width=33,Height=33,Depth=33,MipLevels=1,Format=Format.R10G10B10A2_UNorm,Usage=ResourceUsage.Default,BindFlags=BindFlags.ShaderResource}))
   using(var cubeView=new ShaderResourceView(device,cube))using(var inputView=new ShaderResourceView(device,native[0]))using(var bloomView=new ShaderResourceView(device,upsample[0]))
   using(var graded=Tex(device,W,H,Format.R32G32B32A32_Float,BindFlags.ShaderResource|BindFlags.RenderTarget))using(var gradedRtv=new RenderTargetView(device,graded)){
    var pin=GCHandle.Alloc(packed,GCHandleType.Pinned);try{context.UpdateSubresource(new DataBox(pin.AddrOfPinnedObject(),33*4,33*33*4),cube,0);}finally{pin.Free();}
    float[] toneCB=new float[76];toneCB[24]=toneCB[25]=toneCB[26]=.6f;toneCB[27]=1;toneCB[32]=.075f;toneCB[33]=.11f;toneCB[34]=.115f;toneCB[58]=1;
    using(var tc=Buffer.Create(device,BindFlags.ConstantBuffer,toneCB)){
     context.PixelShader.Set(psTone);context.PixelShader.SetConstantBuffer(0,tc);context.PixelShader.SetShaderResources(0,inputView,cubeView,bloomView);context.PixelShader.SetSamplers(0,linear,linear,linear);
     context.Rasterizer.SetViewport(0,0,W,H);context.OutputMerger.SetTargets(gradedRtv);context.Draw(3,0);
     context.OutputMerger.SetTargets((RenderTargetView)null);context.PixelShader.SetShaderResources(0,new ShaderResourceView[]{null,null,null});
    }
    byte[] pixels=Capture(device,graded,16);File.WriteAllBytes(folder+"/tonemap-bloom.rgba32f.bin",pixels);
    rows.Add(new{kind="tonemap",colorScale=.6f,bloomScale=new[]{.075f,.11f,.115f},width=W,height=H,output="tonemap-bloom.rgba32f.bin",sha256=Hash(pixels)});
    // colorGrading=0 variant: PQ encoding of (main + bloomScale*bloom)*colorScale, no cube.
    using(var tc=Buffer.Create(device,BindFlags.ConstantBuffer,toneCB)){
     // colorGrading=0 binds tonemapBloomTexture at t1 (no cube).
     context.PixelShader.Set(psEncode);context.PixelShader.SetConstantBuffer(0,tc);context.PixelShader.SetShaderResources(0,inputView,bloomView,null);context.PixelShader.SetSamplers(0,linear,linear,linear);
     context.Rasterizer.SetViewport(0,0,W,H);context.OutputMerger.SetTargets(gradedRtv);context.Draw(3,0);
     context.OutputMerger.SetTargets((RenderTargetView)null);context.PixelShader.SetShaderResources(0,new ShaderResourceView[]{null,null,null});
    }
    byte[] pq=Capture(device,graded,16);File.WriteAllBytes(folder+"/tonemap-bloom-pq.rgba32f.bin",pq);
    rows.Add(new{kind="tonemap-pq",colorScale=.6f,bloomScale=new[]{.075f,.11f,.115f},width=W,height=H,output="tonemap-bloom-pq.rgba32f.bin",sha256=Hash(pq)});
   }
   foreach(var list in mipsByMode.Values)foreach(var t in list)t.Dispose();foreach(var t in upsample)t.Dispose();
  }
  var report=new{evidenceId="BF2-NATIVE-BLOOM-WARP-001",backend="D3D11 CPU WARP",width=W,height=H,levels=levels,weights=weights,inputSha256=Hash(inputBytes),cubeSha256=Hash(packed),
   cases=rows,limitations=new[]{"Synthetic input; unchanged native compute/pixel bytecode with a synthetic fullscreen vertex shader.","Pyramid levels stored RGBA32F; native scene-colour mip storage format is untraced."}};
  File.WriteAllText(folder+"/execution.json",new System.Web.Script.Serialization.JavaScriptSerializer().Serialize(report));
  Console.WriteLine("Native bloom: "+levels+" pyramid levels x3 modes, "+levels+" R11G11B10 upsample levels and Tonemap on WARP.");return 0;
 }
}
