// Unchanged original material PS on CPU WARP; fixture VS and float textures.
using System;
using System.IO;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Web.Script.Serialization;
using SharpDX;
using SharpDX.Direct3D;
using SharpDX.Direct3D11;
using SharpDX.D3DCompiler;
using SharpDX.DXGI;
using Buffer=SharpDX.Direct3D11.Buffer;
class PropsNonmetalWarp {
 static string root;
 static int Main(string[] args){root=Path.GetFullPath(args[0]);AppDomain.CurrentDomain.AssemblyResolve+=(s,e)=>{string p=Path.Combine(root,"tools/frosty-1.0.5.2/ThirdParty",new AssemblyName(e.Name).Name+".dll");return File.Exists(p)?Assembly.LoadFrom(p):null;};return Run();}
 static string Hash(byte[] bytes){using(var h=SHA256.Create())return BitConverter.ToString(h.ComputeHash(bytes)).Replace("-","").ToLowerInvariant();}
 static byte[] Bytes(float[] values){var result=new byte[values.Length*4];System.Buffer.BlockCopy(values,0,result,0,result.Length);return result;}
 static Buffer Dynamic(SharpDX.Direct3D11.Device d,int size,BindFlags flags){return new Buffer(d,new BufferDescription(){SizeInBytes=size,Usage=ResourceUsage.Dynamic,BindFlags=flags,CpuAccessFlags=CpuAccessFlags.Write});}
 static void Upload(DeviceContext c,Buffer b,byte[] bytes){DataStream stream;c.MapSubresource(b,MapMode.WriteDiscard,SharpDX.Direct3D11.MapFlags.None,out stream);stream.Write(bytes,0,bytes.Length);c.UnmapSubresource(b,0);stream.Dispose();}
 static Texture2D Texture(SharpDX.Direct3D11.Device device,byte[] data){IntPtr pointer=Marshal.AllocHGlobal(data.Length);try{Marshal.Copy(data,0,pointer,data.Length);return new Texture2D(device,new Texture2DDescription(){Width=1,Height=1,ArraySize=1,MipLevels=1,Format=Format.R32G32B32A32_Float,SampleDescription=new SampleDescription(1,0),Usage=ResourceUsage.Immutable,BindFlags=BindFlags.ShaderResource},new[]{new DataBox(pointer,16,16)});}finally{Marshal.FreeHGlobal(pointer);}}
 [MethodImpl(MethodImplOptions.NoInlining)]static int Run(){
  string folder=Path.Combine(root,"exports/materials/propsnonmetal-shader");byte[] inputBytes=File.ReadAllBytes(Path.Combine(folder,"warp-input.bin")),pixel=File.ReadAllBytes(Path.Combine(folder,"1e3d99cec3.dxbc"));
  if(Hash(pixel)!="f7cb7662d3740b6c2146e655ffedcddcbd38e217df9eb0e8cf76924698f9bb97")throw new Exception("Original shader hash mismatch");
  string fixture="cbuffer F:register(b0){float4 p;float4 a;float4 b;float4 c;} struct O{float4 pos:SV_Position;float4 world:TEXCOORD0;float4 row0:TEXCOORD1;float4 row1:TEXCOORD2;float4 row2:TEXCOORD3;nointerpolation int probe:TEXCOORD4;};O main(uint id:SV_VertexID){O o;float2 uv=float2((id<<1)&2,id&2);o.pos=float4(uv*float2(2,-2)+float2(-1,1),0,1);o.world=p;o.row0=a;o.row1=b;o.row2=c;o.probe=0;return o;}";
  File.WriteAllText(Path.Combine(folder,"warp-fixture.hlsl"),fixture);
  using(var code=ShaderBytecode.Compile(fixture,"main","vs_5_0",ShaderFlags.OptimizationLevel3))
  using(var device=new SharpDX.Direct3D11.Device(DriverType.Warp,DeviceCreationFlags.None,FeatureLevel.Level_11_0))
  using(var vs=new VertexShader(device,code))using(var ps=new PixelShader(device,pixel))
  using(var sampler=new SamplerState(device,new SamplerStateDescription(){Filter=Filter.MinMagMipPoint,AddressU=TextureAddressMode.Wrap,AddressV=TextureAddressMode.Wrap,AddressW=TextureAddressMode.Wrap,MaximumLod=float.MaxValue}))
  using(var raster=new RasterizerState(device,new RasterizerStateDescription(){CullMode=CullMode.None,FillMode=FillMode.Solid,IsDepthClipEnabled=true}))
  using(var cb0=Dynamic(device,64,BindFlags.ConstantBuffer))using(var cb1=Dynamic(device,64,BindFlags.ConstantBuffer))using(var cb2=Dynamic(device,41*16,BindFlags.ConstantBuffer))
  using(var probes=Dynamic(device,9*16,BindFlags.ShaderResource))
  using(var probeView=new ShaderResourceView(device,probes,new ShaderResourceViewDescription(){Dimension=ShaderResourceViewDimension.Buffer,Format=Format.R32G32B32A32_Float,Buffer=new ShaderResourceViewDescription.BufferResource(){FirstElement=0,ElementCount=9}}))
  using(var input=new BinaryReader(new MemoryStream(inputBytes)))using(var output=new MemoryStream()){
   if(input.ReadUInt32()!=0x314f5650)throw new Exception("Wrong fixture header");int count=input.ReadInt32(),stride=input.ReadInt32();if(stride!=82)throw new Exception("Wrong fixture stride");
   var context=device.ImmediateContext;context.VertexShader.Set(vs);context.PixelShader.Set(ps);context.PixelShader.SetSampler(0,sampler);context.VertexShader.SetConstantBuffer(0,cb0);context.PixelShader.SetConstantBuffer(1,cb1);context.PixelShader.SetConstantBuffer(2,cb2);context.PixelShader.SetShaderResource(0,probeView);context.InputAssembler.PrimitiveTopology=PrimitiveTopology.TriangleList;context.Rasterizer.State=raster;context.Rasterizer.SetViewport(0,0,1,1,0,1);
   float[] globals=new float[41*4];globals[37*4]=7;globals[37*4+1]=3;globals[37*4+2]=2;globals[40*4]=1;Upload(context,cb2,Bytes(globals));
   var targetDesc=new Texture2DDescription(){Width=1,Height=1,ArraySize=1,MipLevels=1,Format=Format.R32G32B32A32_Float,SampleDescription=new SampleDescription(1,0),Usage=ResourceUsage.Default,BindFlags=BindFlags.RenderTarget};
   var targets=new Texture2D[4];var views=new RenderTargetView[4];
   try{for(int i=0;i<4;i++){targets[i]=new Texture2D(device,targetDesc);views[i]=new RenderTargetView(device,targets[i]);}context.OutputMerger.SetTargets(views);
    targetDesc.Usage=ResourceUsage.Staging;targetDesc.BindFlags=BindFlags.None;targetDesc.CpuAccessFlags=CpuAccessFlags.Read;
    using(var staging=new Texture2D(device,targetDesc))for(int sample=0;sample<count;sample++){
     float[] frame=new float[9],position=new float[3],uv=new float[2];for(int i=0;i<9;i++)frame[i]=input.ReadSingle();for(int i=0;i<3;i++)position[i]=input.ReadSingle();for(int i=0;i<2;i++)uv[i]=input.ReadSingle();
     Upload(context,cb0,Bytes(new[]{position[0],position[1],position[2],uv[0],frame[0],frame[1],frame[2],uv[1],frame[3],frame[4],frame[5],0,frame[6],frame[7],frame[8],0}));Upload(context,cb1,input.ReadBytes(64));
     var materialTextures=new Texture2D[4];var materialViews=new ShaderResourceView[4];
     try{for(int i=0;i<4;i++){materialTextures[i]=Texture(device,input.ReadBytes(16));materialViews[i]=new ShaderResourceView(device,materialTextures[i]);context.PixelShader.SetShaderResource(i+2,materialViews[i]);}Upload(context,probes,input.ReadBytes(9*16));context.Draw(3,0);
      for(int i=0;i<4;i++){context.CopyResource(targets[i],staging);var mapped=context.MapSubresource(staging,0,MapMode.Read,SharpDX.Direct3D11.MapFlags.None);byte[] bytes=new byte[16];Marshal.Copy(mapped.DataPointer,bytes,0,16);context.UnmapSubresource(staging,0);output.Write(bytes,0,16);}
     }finally{for(int i=0;i<4;i++){if(materialViews[i]!=null)materialViews[i].Dispose();if(materialTextures[i]!=null)materialTextures[i].Dispose();}}
    }
   }finally{for(int i=0;i<4;i++){if(views[i]!=null)views[i].Dispose();if(targets[i]!=null)targets[i].Dispose();}}
   if(input.BaseStream.Position!=input.BaseStream.Length)throw new Exception("Unconsumed input bytes");byte[] result=output.ToArray();File.WriteAllBytes(Path.Combine(folder,"warp-output.bin"),result);
   File.WriteAllText(Path.Combine(folder,"warp-execution.json"),new JavaScriptSerializer().Serialize(new{evidenceId="BF2-PROPSNONMETAL-PS-WARP-001",backend="D3D11 CPU WARP",pixelShader="1e3d99cec3",pixelShaderSha256=Hash(pixel),inputSha256=Hash(inputBytes),outputSha256=Hash(result),cases=count,outputScalars=count*16,fixtureVertexShaderSha256=Hash(code.Bytecode.Data),frameExposure=1,limitations=new[]{"Fixture VS supplies original PS inputs; native vertex execution is separate.","Constant float textures and point sampling isolate material/prelighting arithmetic; native resource filtering is not claimed. Fixture retains two unused detail textures and cb1 fields to reuse the82-float source-shaped test record; original PS only reads t2/t3 and CB2.","Frame exposure1 is an explicit fixture choice, not observed game state."}}));Console.WriteLine("Original PropsNonmetal PS WARP cases="+count+" scalars="+(count*16));
  }return 0;
 }
}
