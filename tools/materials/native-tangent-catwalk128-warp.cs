// Unchanged original wall VS on CPU WARP, stream output before rasterization.
using System;
using System.IO;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Security.Cryptography;
using System.Collections.Generic;
using SharpDX;
using SharpDX.Direct3D;
using SharpDX.Direct3D11;
using SharpDX.DXGI;
using Buffer=SharpDX.Direct3D11.Buffer;
class NativeArrayOneTangentWarp {
 static string root,outputDirectory;static int sourceStride=28;
 static string Hash(byte[] b){using(var h=SHA256.Create())return BitConverter.ToString(h.ComputeHash(b)).Replace("-","").ToLowerInvariant();}
 static int Main(string[] args){root=Path.GetFullPath(args[0]);outputDirectory=args.Length>1?Path.GetFullPath(args[1]):Path.Combine(root,"exports/materials/native-tangent-witness");if(args.Length>2)sourceStride=int.Parse(args[2]);if(sourceStride!=28)throw new Exception("Unproven source input layout");AppDomain.CurrentDomain.AssemblyResolve+=(s,e)=>{
  string p=Path.Combine(root,"tools/frosty-1.0.5.2/ThirdParty",new AssemblyName(e.Name).Name+".dll");return File.Exists(p)?Assembly.LoadFrom(p):null;};return Run();}
 static Buffer Dynamic(SharpDX.Direct3D11.Device d,int size,BindFlags flags){return new Buffer(d,new BufferDescription(){SizeInBytes=size,Usage=ResourceUsage.Dynamic,BindFlags=flags,CpuAccessFlags=CpuAccessFlags.Write});}
 static void Upload(DeviceContext c,Buffer b,byte[] bytes){DataStream stream;c.MapSubresource(b,MapMode.WriteDiscard,SharpDX.Direct3D11.MapFlags.None,out stream);stream.Write(bytes,0,bytes.Length);c.UnmapSubresource(b,0);stream.Dispose();}
 [MethodImpl(MethodImplOptions.NoInlining)]static int Run(){
  string directory=outputDirectory;byte[] inputBytes=File.ReadAllBytes(Path.Combine(directory,"vertex-input.bin"));var reports=new List<object>();
  using(var device=new SharpDX.Direct3D11.Device(DriverType.Warp,DeviceCreationFlags.None,FeatureLevel.Level_11_0))
  foreach(string item in new[]{"catwalk1/c36ce7f6e3/0"}){
   string[] parts=item.Split('/');bool atlas=parts[2]=="1";byte[] bytecode=File.ReadAllBytes(Path.Combine(root,"exports/materials/"+parts[0]+"-shader/"+parts[1]+".dxbc"));
   var elements=new StreamOutputElement[3];for(int i=0;i<3;i++)elements[i]=new StreamOutputElement(0,"TEXCOORD",(atlas?2:1)+i,0,4,0);
   var inputElements=new List<InputElement>{new InputElement("TEXCOORD",0,Format.R16G16B16A16_Float,0,0),new InputElement("TEXCOORD",1,Format.R16G16B16A16_Float,8,0),new InputElement("TEXCOORD",2,Format.R16G16B16A16_Float,16,0),new InputElement("TEXCOORD",3,Format.R16G16_Float,24,0)};
   if(sourceStride==36)inputElements.Add(new InputElement("TEXCOORD",4,Format.R16G16_Float,32,0));
   if(sourceStride==44){inputElements.Clear();inputElements.Add(new InputElement("TEXCOORD",0,Format.R32G32B32_Float,0,0));for(int i=1;i<5;i++)inputElements.Add(new InputElement("TEXCOORD",i,Format.R16G16B16A16_Float,12+(i-1)*8,0));}
   using(var input=new BinaryReader(new MemoryStream(inputBytes)))
   using(var output=new MemoryStream())
   using(var vs=new VertexShader(device,bytecode))
   using(var passthrough=new GeometryShader(device,bytecode,elements,new[]{48},-1))
   using(var layout=new InputLayout(device,bytecode,inputElements.ToArray())){
    if(input.ReadUInt32()!=0x3147544e)throw new Exception("Input format mismatch");int cases=input.ReadInt32(),count=input.ReadInt32(),stride=input.ReadInt32();if(stride!=sourceStride)throw new Exception("Source stride mismatch");int outputSize=count*48;
    using(var vertices=Dynamic(device,count*stride,BindFlags.VertexBuffer))
    using(var instances=Dynamic(device,12*16,BindFlags.ShaderResource))
    using(var instanceView=new ShaderResourceView(device,instances,new ShaderResourceViewDescription(){Dimension=ShaderResourceViewDimension.Buffer,Format=Format.R32G32B32A32_Float,Buffer=new ShaderResourceViewDescription.BufferResource(){FirstElement=0,ElementCount=12}}))
    using(var cb0=Dynamic(device,16,BindFlags.ConstantBuffer))
    using(var cb2=Dynamic(device,608,BindFlags.ConstantBuffer))
    using(var results=new Buffer(device,new BufferDescription(){SizeInBytes=outputSize,Usage=ResourceUsage.Default,BindFlags=BindFlags.StreamOutput}))
    using(var staging=new Buffer(device,new BufferDescription(){SizeInBytes=outputSize,Usage=ResourceUsage.Staging,CpuAccessFlags=CpuAccessFlags.Read})){
     var c=device.ImmediateContext;Upload(c,vertices,input.ReadBytes(count*stride));c.InputAssembler.InputLayout=layout;c.InputAssembler.PrimitiveTopology=PrimitiveTopology.PointList;c.InputAssembler.SetVertexBuffers(0,new VertexBufferBinding(vertices,stride,0));
     c.VertexShader.Set(vs);c.GeometryShader.Set(passthrough);c.VertexShader.SetShaderResource(0,instanceView);c.VertexShader.SetConstantBuffer(0,cb0);c.VertexShader.SetConstantBuffer(2,cb2);
     for(int i=0;i<cases;i++){
      Upload(c,instances,input.ReadBytes(192));Upload(c,cb0,input.ReadBytes(16));Upload(c,cb2,input.ReadBytes(608));
      c.StreamOutput.SetTargets(new[]{new StreamOutputBufferBinding(results,0)});c.DrawInstanced(count,1,0,0);c.StreamOutput.SetTargets(new StreamOutputBufferBinding[0]);
      c.CopyResource(results,staging);DataStream stream;c.MapSubresource(staging,MapMode.Read,SharpDX.Direct3D11.MapFlags.None,out stream);byte[] bytes=new byte[outputSize];stream.Read(bytes,0,bytes.Length);c.UnmapSubresource(staging,0);stream.Dispose();output.Write(bytes,0,bytes.Length);
     }
     if(input.BaseStream.Position!=input.BaseStream.Length)throw new Exception("Unconsumed input bytes");byte[] result=output.ToArray();File.WriteAllBytes(Path.Combine(directory,parts[1]+".warp.bin"),result);
     reports.Add(new{family=parts[0],shader=parts[1],atlas=atlas,cases=cases,vertices=count,outputStride=48,shaderSha256=Hash(bytecode),inputSha256=Hash(inputBytes),outputSha256=Hash(result),outputBytes=result.Length});
     Console.WriteLine("Original wall VS WARP "+parts[1]+" cases="+cases+" vertices="+count+" bytes="+result.Length);
    }
   }
  }
  var evidence=new{evidenceId="BF2-NATIVE-TANGENT-VS-WARP-001",backend="D3D11 WARP CPU stream output",reports=reports,limitations=new[]{"Unchanged installed vertex shaders; driver-generated stream-output passthrough, no shader recompilation.","Original source wall bytes with synthetic and source placement instance buffers, not a captured native frame.","The native vertex-buffer conversion factory is not executed; this witness already matches the original prepared input layout byte-for-byte."}};
  File.WriteAllText(Path.Combine(directory,"warp-execution.json"),new System.Web.Script.Serialization.JavaScriptSerializer().Serialize(evidence));return 0;
 }
}
