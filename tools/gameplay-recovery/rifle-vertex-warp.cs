// Original VS on CPU WARP, captured before rasterization with stream output.
using System;
using System.IO;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Security.Cryptography;
using SharpDX;
using SharpDX.Direct3D;
using SharpDX.Direct3D11;
using SharpDX.DXGI;
using Buffer=SharpDX.Direct3D11.Buffer;
class RifleVertexWarp {
 static string root;
 static string Hash(byte[] b){using(var h=SHA256.Create())return BitConverter.ToString(h.ComputeHash(b)).Replace("-","").ToLowerInvariant();}
 static int Main(string[] args){root=Path.GetFullPath(args[0]);AppDomain.CurrentDomain.AssemblyResolve+=(s,e)=>{
  string p=Path.Combine(root,"tools/frosty-1.0.5.2/ThirdParty",new AssemblyName(e.Name).Name+".dll");return File.Exists(p)?Assembly.LoadFrom(p):null;};return Run();}
 static Buffer Dynamic(SharpDX.Direct3D11.Device d,int size,BindFlags flags,ResourceOptionFlags options=ResourceOptionFlags.None,int stride=0){return new Buffer(d,new BufferDescription(){SizeInBytes=size,Usage=ResourceUsage.Dynamic,BindFlags=flags,CpuAccessFlags=CpuAccessFlags.Write,OptionFlags=options,StructureByteStride=stride});}
 static void Upload(DeviceContext c,Buffer b,byte[] bytes){DataStream stream;c.MapSubresource(b,MapMode.WriteDiscard,SharpDX.Direct3D11.MapFlags.None,out stream);stream.Write(bytes,0,bytes.Length);c.UnmapSubresource(b,0);stream.Dispose();}
 [MethodImpl(MethodImplOptions.NoInlining)]static int Run(){
  string directory=Path.Combine(root,"exports/rifle-trail/vertex-warp");
  byte[] inputBytes=File.ReadAllBytes(Path.Combine(directory,"input.bin"));
  byte[] bytecode=File.ReadAllBytes(Path.Combine(root,"exports/rifle-trail/render-shaders/f8781d702f.dxbc"));
  var elements=new StreamOutputElement[9];elements[0]=new StreamOutputElement(0,"SV_Position",0,0,4,0);
  for(int i=1;i<9;i++)elements[i]=new StreamOutputElement(0,"TEXCOORD",i-1,0,4,0);
  using(var input=new BinaryReader(new MemoryStream(inputBytes)))
  using(var output=new MemoryStream())
  using(var device=new SharpDX.Direct3D11.Device(DriverType.Warp,DeviceCreationFlags.None,FeatureLevel.Level_11_0))
  using(var vs=new VertexShader(device,bytecode))
  using(var passthrough=new GeometryShader(device,bytecode,elements,new[]{144},-1))
  using(var layout=new InputLayout(device,bytecode,new[]{new InputElement("TEXCOORD",0,Format.R32G32B32_Float,0,0),new InputElement("TEXCOORD",1,Format.R32G32B32A32_Float,0,0),new InputElement("TEXCOORD",2,Format.R32G32B32A32_Float,0,0),new InputElement("TEXCOORD",3,Format.R32G32_Float,12,0)})){
   if(input.ReadUInt32()!=0x31565752)throw new Exception("Input format mismatch");
   int cases=input.ReadInt32(),count=input.ReadInt32();input.ReadInt32();int outputSize=count*144;
   using(var vertices=Dynamic(device,count*20,BindFlags.VertexBuffer))
   using(var emitter=Dynamic(device,912,BindFlags.ShaderResource,ResourceOptionFlags.BufferStructured,912))
   using(var emitterView=new ShaderResourceView(device,emitter))
   using(var particles=Dynamic(device,88,BindFlags.ShaderResource,ResourceOptionFlags.BufferAllowRawViews))
   using(var particleView=new ShaderResourceView(device,particles,new ShaderResourceViewDescription(){Dimension=ShaderResourceViewDimension.ExtendedBuffer,Format=Format.R32_Typeless,BufferEx=new ShaderResourceViewDescription.ExtendedBufferResource(){FirstElement=0,ElementCount=22,Flags=ShaderResourceViewExtendedBufferFlags.Raw}}))
   using(var indices=Dynamic(device,4,BindFlags.ShaderResource,ResourceOptionFlags.BufferStructured,4))
   using(var indicesView=new ShaderResourceView(device,indices))
   using(var cb1=Dynamic(device,48,BindFlags.ConstantBuffer))
   using(var cb2=Dynamic(device,608,BindFlags.ConstantBuffer))
   using(var results=new Buffer(device,new BufferDescription(){SizeInBytes=outputSize,Usage=ResourceUsage.Default,BindFlags=BindFlags.StreamOutput}))
   using(var staging=new Buffer(device,new BufferDescription(){SizeInBytes=outputSize,Usage=ResourceUsage.Staging,CpuAccessFlags=CpuAccessFlags.Read})){
    var c=device.ImmediateContext;Upload(c,vertices,input.ReadBytes(count*20));Upload(c,indices,new byte[4]);
    c.InputAssembler.InputLayout=layout;c.InputAssembler.PrimitiveTopology=PrimitiveTopology.PointList;c.InputAssembler.SetVertexBuffers(0,new VertexBufferBinding(vertices,20,0));
    c.VertexShader.Set(vs);c.GeometryShader.Set(passthrough);c.VertexShader.SetShaderResource(26,emitterView);c.VertexShader.SetShaderResource(27,particleView);c.VertexShader.SetShaderResource(28,indicesView);
    c.VertexShader.SetConstantBuffer(1,cb1);c.VertexShader.SetConstantBuffer(2,cb2);
    for(int i=0;i<cases;i++){
     Upload(c,emitter,input.ReadBytes(912));Upload(c,particles,input.ReadBytes(88));Upload(c,cb1,input.ReadBytes(48));Upload(c,cb2,input.ReadBytes(608));
     c.StreamOutput.SetTargets(new[]{new StreamOutputBufferBinding(results,0)});c.DrawInstanced(count,1,0,0);c.StreamOutput.SetTargets(new StreamOutputBufferBinding[0]);
     c.CopyResource(results,staging);DataStream stream;c.MapSubresource(staging,MapMode.Read,SharpDX.Direct3D11.MapFlags.None,out stream);
     byte[] bytes=new byte[outputSize];stream.Read(bytes,0,bytes.Length);c.UnmapSubresource(staging,0);stream.Dispose();output.Write(bytes,0,bytes.Length);
    }
    if(input.BaseStream.Position!=input.BaseStream.Length)throw new Exception("Unconsumed input bytes");
    byte[] result=output.ToArray();File.WriteAllBytes(Path.Combine(directory,"output.bin"),result);
    var evidence=new {evidenceId="BF2-RIFLE-VERTEX-WARP-001",backend="D3D11 WARP CPU stream output",cases=cases,vertices=count,outputStride=144,shaderSha256=Hash(bytecode),inputSha256=Hash(inputBytes),outputSha256=Hash(result),outputBytes=result.Length,limitations=new[]{"Original installed vertex shader with driver-generated stream-output passthrough, no recompilation.","Synthetic camera/constant buffers; not a captured native frame."}};
    File.WriteAllText(Path.Combine(directory,"execution.json"),new System.Web.Script.Serialization.JavaScriptSerializer().Serialize(evidence));
    Console.WriteLine("Original rifle VS WARP cases="+cases+" vertices="+count+" bytes="+result.Length);
   }
  }
  return 0;
 }
}
