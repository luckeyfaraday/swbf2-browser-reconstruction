// Run unchanged installed particle DXBC on Microsoft's CPU WARP device.
// Inputs are controlled synthetic records, not a captured native frame.
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
using Buffer = SharpDX.Direct3D11.Buffer;
class RifleParticleWarp {
 static string root;
 static string Hash(byte[] b){using(var h=SHA256.Create())return BitConverter.ToString(h.ComputeHash(b)).Replace("-","").ToLowerInvariant();}
 static int Main(string[] args){
  root=Path.GetFullPath(args[0]);
  AppDomain.CurrentDomain.AssemblyResolve+=(s,e)=>{
   string p=Path.Combine(root,"tools/frosty-1.0.5.2/ThirdParty",new AssemblyName(e.Name).Name+".dll");
   return File.Exists(p)?Assembly.LoadFrom(p):null;
  };
  return Run();
 }
 static void Upload(DeviceContext c,Buffer b,byte[] bytes){
  DataStream stream;c.MapSubresource(b,MapMode.WriteDiscard,SharpDX.Direct3D11.MapFlags.None,out stream);
  stream.Write(bytes,0,bytes.Length);c.UnmapSubresource(b,0);stream.Dispose();
 }
 static byte[] Read(DeviceContext c,Buffer b,Buffer staging){
  c.CopyResource(b,staging);DataStream stream;
  c.MapSubresource(staging,MapMode.Read,SharpDX.Direct3D11.MapFlags.None,out stream);
  byte[] bytes=new byte[88];stream.Read(bytes,0,88);c.UnmapSubresource(staging,0);stream.Dispose();return bytes;
 }
 [MethodImpl(MethodImplOptions.NoInlining)]static int Run(){
  string directory=Path.Combine(root,"exports/rifle-trail/particle-warp");
  byte[] spawnBytes=File.ReadAllBytes(Path.Combine(root,"exports/rifle-trail/shaders/spawn.dxbc"));
  byte[] simBytes=File.ReadAllBytes(Path.Combine(root,"exports/rifle-trail/shaders/simulate.dxbc"));
  if(Hash(spawnBytes)!="3157d77810d440d184e7b91eb862d890daf6ec4484204698551ebc20b6ac3f27"||Hash(simBytes)!="6ac231cf62540832075917e949f625c79649fbd494b3c70f954c51d39e4bd5ed")throw new Exception("Original particle shader mismatch");
  byte[] inputBytes=File.ReadAllBytes(Path.Combine(directory,"input.bin"));
  using(var input=new BinaryReader(new MemoryStream(inputBytes)))
  using(var output=new MemoryStream())
  using(var device=new SharpDX.Direct3D11.Device(DriverType.Warp,DeviceCreationFlags.None,FeatureLevel.Level_11_0))
  using(var spawn=new ComputeShader(device,spawnBytes))
  using(var simulate=new ComputeShader(device,simBytes))
  using(var properties=new Buffer(device,new BufferDescription(){SizeInBytes=912,StructureByteStride=912,Usage=ResourceUsage.Dynamic,BindFlags=BindFlags.ShaderResource,CpuAccessFlags=CpuAccessFlags.Write,OptionFlags=ResourceOptionFlags.BufferStructured}))
  using(var propertyView=new ShaderResourceView(device,properties))
  using(var constants=new Buffer(device,new BufferDescription(){SizeInBytes=624,Usage=ResourceUsage.Dynamic,BindFlags=BindFlags.ConstantBuffer,CpuAccessFlags=CpuAccessFlags.Write}))
  using(var particles=new Buffer(device,new BufferDescription(){SizeInBytes=88,Usage=ResourceUsage.Default,BindFlags=BindFlags.UnorderedAccess|BindFlags.ShaderResource,OptionFlags=ResourceOptionFlags.BufferAllowRawViews}))
  using(var particleView=new UnorderedAccessView(device,particles,new UnorderedAccessViewDescription(){Dimension=UnorderedAccessViewDimension.Buffer,Format=Format.R32_Typeless,Buffer=new UnorderedAccessViewDescription.BufferResource(){ElementCount=22,FirstElement=0,Flags=UnorderedAccessViewBufferFlags.Raw}}))
  using(var staging=new Buffer(device,new BufferDescription(){SizeInBytes=88,Usage=ResourceUsage.Staging,CpuAccessFlags=CpuAccessFlags.Read}))
  using(var sampler=new SamplerState(device,new SamplerStateDescription(){Filter=Filter.MinMagMipLinear,AddressU=TextureAddressMode.Clamp,AddressV=TextureAddressMode.Clamp,AddressW=TextureAddressMode.Clamp,MaximumLod=float.MaxValue})){
   if(input.ReadUInt32()!=0x31505752)throw new Exception("Input format mismatch");
   int cases=input.ReadInt32(),steps=input.ReadInt32();input.ReadInt32();
   var c=device.ImmediateContext;c.ComputeShader.SetConstantBuffer(0,constants);c.ComputeShader.SetUnorderedAccessView(0,particleView);
   for(int i=0;i<cases;i++){
    float depth=input.ReadSingle();
    using(var depthData=new DataStream(16*4,true,true)){
     for(int pixel=0;pixel<16;pixel++)depthData.Write(depth);depthData.Position=0;
     using(var texture=new Texture2D(device,new Texture2DDescription(){Width=4,Height=4,MipLevels=1,ArraySize=1,Format=Format.R32_Float,SampleDescription=new SampleDescription(1,0),Usage=ResourceUsage.Immutable,BindFlags=BindFlags.ShaderResource},new DataRectangle(depthData.DataPointer,16)))
     using(var depthView=new ShaderResourceView(device,texture)){
      Upload(c,properties,input.ReadBytes(912));byte[] cb=new byte[624];Array.Copy(input.ReadBytes(128),cb,128);Upload(c,constants,cb);
      c.ComputeShader.Set(spawn);c.ComputeShader.SetShaderResource(4,propertyView);c.Dispatch(1,1,1);
      byte[] sample=Read(c,particles,staging);output.Write(sample,0,sample.Length);
      c.ComputeShader.Set(simulate);c.ComputeShader.SetShaderResource(4,depthView);c.ComputeShader.SetShaderResource(8,propertyView);c.ComputeShader.SetSampler(1,sampler);
      for(int step=0;step<steps;step++){
       Upload(c,properties,input.ReadBytes(912));Upload(c,constants,input.ReadBytes(624));c.Dispatch(1,1,1);
       sample=Read(c,particles,staging);output.Write(sample,0,sample.Length);
      }
      c.ComputeShader.SetShaderResource(4,null);c.ComputeShader.SetShaderResource(8,null);
     }
    }
   }
   if(input.BaseStream.Position!=input.BaseStream.Length)throw new Exception("Unconsumed input bytes");
   byte[] result=output.ToArray();File.WriteAllBytes(Path.Combine(directory,"output.bin"),result);
   var evidence=new {evidenceId="BF2-RIFLE-PARTICLE-WARP-001",backend="D3D11 WARP CPU",cases=cases,steps=steps,spawnSha256=Hash(spawnBytes),simulateSha256=Hash(simBytes),inputSha256=Hash(inputBytes),outputSha256=Hash(result),outputBytes=result.Length,limitations=new[]{"Controlled synthetic emitter records and uniform depth textures, not native game capture.","Unchanged original shader instructions; WARP floating point may differ from hardware."}};
   File.WriteAllText(Path.Combine(directory,"execution.json"),new System.Web.Script.Serialization.JavaScriptSerializer().Serialize(evidence));
   Console.WriteLine("Original particle WARP cases="+cases+" steps="+steps+" outputBytes="+result.Length);
  }
  return 0;
 }
}
