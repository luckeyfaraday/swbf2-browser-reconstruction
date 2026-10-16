// Decode bounded ORIGINAL BC6H/BC7 blocks on Microsoft's CPU WARP device.
// The copy shader is a diagnostic transport, not a native game shader.
using System;
using System.IO;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;
using SharpDX;
using SharpDX.Direct3D;
using SharpDX.Direct3D11;
using SharpDX.D3DCompiler;
using SharpDX.DXGI;
class NativeAtlasDecode {
 static string root,folder;
 static string Sha256(byte[] bytes) {using(var hash=SHA256.Create())return BitConverter.ToString(hash.ComputeHash(bytes)).Replace("-","").ToLowerInvariant();}
 static int Main(string[] args) {
  root=Path.GetFullPath(args[0]);
  folder=args.Length>1?Path.GetFullPath(args[1]):Path.Combine(root,"exports/lighting/static-atlas-sample");
  AppDomain.CurrentDomain.AssemblyResolve+=(s,e)=>{string p=Path.Combine(root,"tools/frosty-1.0.5.2/ThirdParty",new AssemblyName(e.Name).Name+".dll");return File.Exists(p)?Assembly.LoadFrom(p):null;};
  return Run();
 }
 [MethodImpl(MethodImplOptions.NoInlining)]static int Run() {
  var json=new JavaScriptSerializer();
  byte[] manifestBytes=File.ReadAllBytes(Path.Combine(folder,"manifest.json"));
  dynamic report=json.DeserializeObject(Encoding.UTF8.GetString(manifestBytes));
  var textures=new List<object>();
  var fields=new HashSet<string>();
  string source="Texture2D<float4> inputTexture:register(t0); RWTexture2D<float4> outputTexture:register(u0); [numthreads(8,8,1)] void main(uint3 p:SV_DispatchThreadID) { outputTexture[p.xy]=inputTexture.Load(int3(p.xy,0)); }";
  File.WriteAllText(Path.Combine(folder,"decode.hlsl"),source);
  using(var code=ShaderBytecode.Compile(source,"main","cs_5_0",ShaderFlags.OptimizationLevel3))
  using(var device=new SharpDX.Direct3D11.Device(DriverType.Warp,DeviceCreationFlags.None,FeatureLevel.Level_11_0))
  using(var shader=new ComputeShader(device,code)) {
   foreach(dynamic row in report["textures"]) {
    int width=row["cropSize"][0],height=row["cropSize"][1];
    int format=row["dxgiFormat"];
    string field=row["sourceField"],inputFile=row["cropFile"],outputFile=field+".rgba32f.bin";
    if(!fields.Add(field))throw new InvalidDataException("Duplicate atlas field: "+field);
    if(width<=0||height<=0||width%8!=0||height%8!=0)throw new InvalidDataException("Decode dispatch requires positive dimensions divisible by eight");
    if(format!=95&&format!=98)throw new InvalidDataException("Only selected BC6H/BC7 formats are supported");
    byte[] bytes=File.ReadAllBytes(Path.Combine(folder,inputFile));
    if(bytes.Length!=checked(width*height))throw new InvalidDataException("Compressed atlas byte length does not match dimensions");
    string inputSha256=Sha256(bytes);
    var rowValues=(IDictionary<string,object>)row;
    object expectedHash;
    if(!rowValues.TryGetValue("sha256",out expectedHash)&&!rowValues.TryGetValue("cropSha256",out expectedHash))throw new InvalidDataException("Missing compressed-input hash: "+field);
    if(inputSha256!=(string)expectedHash)throw new InvalidDataException("Compressed input differs from manifest: "+field);
    IntPtr pointer=Marshal.AllocHGlobal(bytes.Length);
    try {
     Marshal.Copy(bytes,0,pointer,bytes.Length);
     var inputDescription=new Texture2DDescription(){Width=width,Height=height,ArraySize=1,MipLevels=1,Format=(Format)format,SampleDescription=new SampleDescription(1,0),Usage=ResourceUsage.Immutable,BindFlags=BindFlags.ShaderResource};
     var outputDescription=new Texture2DDescription(){Width=width,Height=height,ArraySize=1,MipLevels=1,Format=Format.R32G32B32A32_Float,SampleDescription=new SampleDescription(1,0),Usage=ResourceUsage.Default,BindFlags=BindFlags.UnorderedAccess};
     using(var input=new Texture2D(device,inputDescription,new[]{new DataBox(pointer,(width/4)*16,bytes.Length)}))
     using(var view=new ShaderResourceView(device,input))
     using(var output=new Texture2D(device,outputDescription))
     using(var target=new UnorderedAccessView(device,output)) {
      var context=device.ImmediateContext;context.ComputeShader.Set(shader);context.ComputeShader.SetShaderResource(0,view);context.ComputeShader.SetUnorderedAccessView(0,target);context.Dispatch(width/8,height/8,1);
      outputDescription.Usage=ResourceUsage.Staging;outputDescription.BindFlags=BindFlags.None;outputDescription.CpuAccessFlags=CpuAccessFlags.Read;
      using(var staging=new Texture2D(device,outputDescription)) {
       context.CopyResource(output,staging);var mapped=context.MapSubresource(staging,0,MapMode.Read,SharpDX.Direct3D11.MapFlags.None);
       byte[] pixels=new byte[width*height*16];for(int y=0;y<height;y++)Marshal.Copy(IntPtr.Add(mapped.DataPointer,y*mapped.RowPitch),pixels,y*width*16,width*16);context.UnmapSubresource(staging,0);
       File.WriteAllBytes(Path.Combine(folder,outputFile),pixels);
       textures.Add(new {sourceField=field,inputFile=inputFile,inputSha256=inputSha256,inputByteLength=bytes.Length,
        width=width,height=height,dxgiFormat=format,outputFile=outputFile,outputSha256=Sha256(pixels),outputByteLength=pixels.Length});
      }
     }
    } finally {Marshal.FreeHGlobal(pointer);}
   }
   using(var dxgi=device.QueryInterface<SharpDX.DXGI.Device>())using(var adapter=dxgi.Adapter)
    File.WriteAllText(Path.Combine(folder,"decode-execution.json"),json.Serialize(new {schemaVersion=2,evidenceId="BF2-NATIVE-STATIC-ATLAS-DECODE-001",
     backend="D3D11 CPU WARP",adapter=adapter.Description.Description,manifestFile="manifest.json",manifestSha256=Sha256(manifestBytes),manifestByteLength=manifestBytes.Length,
     decoderSourceFile="tools/materials/native-static-atlas-decode.cs",decoderSourceSha256=Sha256(File.ReadAllBytes(Path.Combine(root,"tools/materials/native-static-atlas-decode.cs"))),
     decoderExecutableSha256=Sha256(File.ReadAllBytes(Assembly.GetExecutingAssembly().Location)),diagnosticShaderSha256=Sha256(Encoding.UTF8.GetBytes(source)),
     textures=textures,input="Original BC6H/BC7 blocks; each input is checked against this exact manifest",output="RGBA32F, no color conversion; each output payload is hashed",
     limitation="Compiled texture.Load diagnostic; exact decoded texels do not establish equivalent filtered sampling. Not native game execution or a native shader capture"}));
  }
  Console.WriteLine("Decoded "+textures.Count+" source atlas crops to float32 on CPU WARP with input/output hash provenance.");return 0;
 }
}
