// Separate compiled arithmetic probe, NOT the original installed shader.
using System;
using System.IO;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Security.Cryptography;
using SharpDX;
using SharpDX.Direct3D;
using SharpDX.Direct3D11;
using SharpDX.D3DCompiler;
using SharpDX.DXGI;
using Buffer=SharpDX.Direct3D11.Buffer;
class BlasterBoltTrigWarp {
 static string root;
 static string Hash(byte[] b){using(var h=SHA256.Create())return BitConverter.ToString(h.ComputeHash(b)).Replace("-","").ToLowerInvariant();}
 static int Main(string[] args){root=Path.GetFullPath(args[0]);AppDomain.CurrentDomain.AssemblyResolve+=(s,e)=>{string p=Path.Combine(root,"tools/frosty-1.0.5.2/ThirdParty",new AssemblyName(e.Name).Name+".dll");return File.Exists(p)?Assembly.LoadFrom(p):null;};return Run();}
 [MethodImpl(MethodImplOptions.NoInlining)]static int Run(){
  string directory=Path.Combine(root,"exports/rifle-trail/render-trig-warp");
  string source="float4 main(float2 angles:TEXCOORD0):SV_Position { float2 s,c; sincos(angles,s,c); return float4(s,c); }";
  byte[] input=File.ReadAllBytes(Path.Combine(directory,"input.bin"));int count=input.Length/8;
  using(var compiled=ShaderBytecode.Compile(source,"main","vs_5_0",ShaderFlags.OptimizationLevel3)){
   byte[] code=compiled.Bytecode.Data;File.WriteAllBytes(Path.Combine(directory,"probe.dxbc"),code);File.WriteAllText(Path.Combine(directory,"probe.hlsl"),source);
   using(var device=new SharpDX.Direct3D11.Device(DriverType.Warp,DeviceCreationFlags.None,FeatureLevel.Level_11_0))
   using(var vs=new VertexShader(device,code))
   using(var gs=new GeometryShader(device,code,new[]{new StreamOutputElement(0,"SV_Position",0,0,4,0)},new[]{16},-1))
   using(var layout=new InputLayout(device,code,new[]{new InputElement("TEXCOORD",0,Format.R32G32_Float,0,0)}))
   using(var vertices=new Buffer(device,new BufferDescription(){SizeInBytes=input.Length,Usage=ResourceUsage.Dynamic,BindFlags=BindFlags.VertexBuffer,CpuAccessFlags=CpuAccessFlags.Write}))
   using(var results=new Buffer(device,new BufferDescription(){SizeInBytes=count*16,Usage=ResourceUsage.Default,BindFlags=BindFlags.StreamOutput}))
   using(var staging=new Buffer(device,new BufferDescription(){SizeInBytes=count*16,Usage=ResourceUsage.Staging,CpuAccessFlags=CpuAccessFlags.Read})){
    var c=device.ImmediateContext;DataStream stream;c.MapSubresource(vertices,MapMode.WriteDiscard,SharpDX.Direct3D11.MapFlags.None,out stream);stream.Write(input,0,input.Length);c.UnmapSubresource(vertices,0);stream.Dispose();
    c.InputAssembler.InputLayout=layout;c.InputAssembler.PrimitiveTopology=PrimitiveTopology.PointList;c.InputAssembler.SetVertexBuffers(0,new VertexBufferBinding(vertices,8,0));c.VertexShader.Set(vs);c.GeometryShader.Set(gs);
    c.StreamOutput.SetTargets(new[]{new StreamOutputBufferBinding(results,0)});c.Draw(count,0);c.StreamOutput.SetTargets(new StreamOutputBufferBinding[0]);c.CopyResource(results,staging);
    c.MapSubresource(staging,MapMode.Read,SharpDX.Direct3D11.MapFlags.None,out stream);byte[] output=new byte[count*16];stream.Read(output,0,output.Length);c.UnmapSubresource(staging,0);stream.Dispose();File.WriteAllBytes(Path.Combine(directory,"output.bin"),output);
    var report=new {evidenceId="LOCAL-BLASTER-BOLT-TRIG-WARP-001",backend="D3D11 WARP CPU stream output",source="Separately compiled sincos arithmetic probe, not unchanged original shader",cases=count,shaderSha256=Hash(code),inputSha256=Hash(input),outputSha256=Hash(output),limitation="Used only to isolate native WARP trigonometric approximation in independent original-shader comparison; no lookup replacement in browser shader."};
    File.WriteAllText(Path.Combine(directory,"execution.json"),new System.Web.Script.Serialization.JavaScriptSerializer().Serialize(report));Console.WriteLine("Bolt trig WARP cases="+count);
   }
  }
  return 0;
 }
}
