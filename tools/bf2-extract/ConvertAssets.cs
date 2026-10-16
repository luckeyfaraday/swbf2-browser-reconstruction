using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Runtime.InteropServices;
using FrostySdk.Ebx;
using FrostySdk.Resources;
using MESH = FrostySdk.Resources.KfpaShNjvicnKuxFGsstgYcOEjJ;
using TEX = FrostySdk.Resources.bTlQaWcfXUoBqbdoHINPIRnvaxumbUX;
using SECTION = FrostySdk.Resources.RBRDpPdREosVgsaJRWWw;
using ELEMENT = FrostySdk.Resources.AOaTTciiJyPcmvblkQTGfepHkbaMxinGHVDsG.ovjQjsCnoEgFXHrsYilmEDDLHYBfKcPO;
using EBX = FrostySdk.Managers.VmDbVirBuUgxTCCQioDVXY;

class GeometryPart {
 public string Name;
 public float[] Positions,Normals,Uv;
 public uint[] Indices;
 public int MaterialId;
}
static class ConvertAssets {
 [StructLayout(LayoutKind.Sequential)]struct Blob {public IntPtr Data;public long Size;}
 [DllImport("dxtex.dll",EntryPoint="ConvertDDSToImage")]static extern void NativeDdsToImage(byte[] data,long length,int format,ref Blob output);
 [DllImport("dxtex.dll",EntryPoint="ReleaseBlob")]static extern void ReleaseBlob(Blob blob);
 [DllImport("ole32.dll")]static extern int CoInitializeEx(IntPtr reserved,uint mode);
 [DllImport("ole32.dll")]static extern void CoUninitialize();
 public static void DdsToPng(string input,string output){
  byte[] data=File.ReadAllBytes(input);
  if(data.Length<148||BitConverter.ToUInt32(data,0)!=0x20534444||BitConverter.ToUInt32(data,84)!=0x30315844)throw new Exception("Expected DX10 DDS produced by texture command");
  if(BitConverter.ToUInt32(data,132)!=3||BitConverter.ToUInt32(data,136)!=0||BitConverter.ToUInt32(data,140)!=1)throw new Exception("PNG command currently supports one 2D image; cube/array/volume slices remain DDS");
  var blob=new Blob();int com=CoInitializeEx(IntPtr.Zero,0);
  try{NativeDdsToImage(data,data.LongLength,0,ref blob);if(blob.Data==IntPtr.Zero||blob.Size<24||blob.Size>int.MaxValue)throw new Exception("Native DDS conversion produced no PNG");byte[] png=new byte[(int)blob.Size];Marshal.Copy(blob.Data,png,0,png.Length);if(png[0]!=137||png[1]!=80||png[2]!=78||png[3]!=71)throw new Exception("Native DDS conversion returned invalid PNG");Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(output)));File.WriteAllBytes(output,png);}
  finally{if(blob.Data!=IntPtr.Zero)ReleaseBlob(blob);if(com>=0)CoUninitialize();}
 }
 public static object Mesh(Historical h,EBX entry,string output,int lodIndex,bool allowUnbound,bool flipV){
  object root=h.Decode(entry).RootObject;object rr=J.Get(root,"MeshSetResource");
  if(!(rr is ResourceRef))throw new Exception("Asset has no MeshSetResource");
  ulong rid=(ResourceRef)rr;var res=h.Res(rid);if(res==null)throw new Exception("Missing MeshSet RES "+rid);
  var mesh=(MESH)h.Mesh(res);
  if(mesh.Type!=MeshType.MeshType_Rigid&&mesh.Type!=MeshType.MeshType_Composite&&!allowUnbound)throw new Exception("Skinned mesh requires skeleton binding; use --allow-unbound only for inspection export.");
  if(lodIndex<0||lodIndex>=mesh.Lods.Count)throw new Exception("LOD does not exist");
  var lod=mesh.Lods[lodIndex];byte[] bytes;
  if(lod.ChunkId==Guid.Empty)bytes=lod.InlineData;else{var chunk=h.Chunk(lod.ChunkId);if(chunk==null)throw new Exception("Mesh chunk missing "+lod.ChunkId);using(var s=h.Raw(chunk))using(var m=new MemoryStream()){s.CopyTo(m);bytes=m.ToArray();}}
  var parts=new List<GeometryPart>();var notes=new List<string>();
  foreach(var sec in lod.Sections){
   if(string.IsNullOrEmpty(sec.Name)||sec.VertexCount==0||sec.PrimitiveCount==0)continue;
   if(sec.PrimitiveType.ToString()!="PrimitiveType_TriangleList")throw new Exception("Unsupported primitive topology "+sec.PrimitiveType);
   var part=new GeometryPart{Name=sec.Name,MaterialId=sec.MaterialId,Positions=Attribute(bytes,sec,VertexElementUsage.Pos,3)};
   if(part.Positions==null)throw new Exception("Missing position stream in "+sec.Name);
   part.Uv=Attribute(bytes,sec,VertexElementUsage.TexCoord0,2);
   if(flipV&&part.Uv!=null)for(int i=1;i<part.Uv.Length;i+=2)part.Uv[i]=1-part.Uv[i];
   part.Normals=Attribute(bytes,sec,VertexElementUsage.Normal,3);
   if(mesh.Type==MeshType.MeshType_Composite){
    var boneField=sec.GeometryDeclDesc[0].Elements.FirstOrDefault(e=>e.Usage==VertexElementUsage.BoneIndices);
    var boneIndices=Attribute(bytes,sec,VertexElementUsage.BoneIndices,4);
    if(boneIndices==null||lod.PartTransforms.Count==0)throw new Exception("Composite mesh lacks part transforms or vertex part indices");
    string format=boneField.Format.ToString();float unnormalize=format.EndsWith("N")?(format.Contains("Short")?65535f:255f):1f;
    for(int i=0;i<sec.VertexCount;i++){
     int partIndex=(int)Math.Round(boneIndices[i*4+3]*unnormalize);
     if(partIndex<0||partIndex>=lod.PartTransforms.Count)throw new Exception("Composite part index out of range: "+partIndex);
     var t=lod.PartTransforms[partIndex];int at=i*3;float x=part.Positions[at],y=part.Positions[at+1],z=part.Positions[at+2];
     part.Positions[at]=t.right.x*x+t.up.x*y+t.forward.x*z+t.trans.x;
     part.Positions[at+1]=t.right.y*x+t.up.y*y+t.forward.y*z+t.trans.y;
     part.Positions[at+2]=t.right.z*x+t.up.z*y+t.forward.z*z+t.trans.z;
     if(part.Normals!=null){
      float a=t.right.x,b=t.up.x,c=t.forward.x,d=t.right.y,e=t.up.y,f=t.forward.y,g=t.right.z,hv=t.up.z,k=t.forward.z;
      float det=a*(e*k-f*hv)-b*(d*k-f*g)+c*(d*hv-e*g);if(Math.Abs(det)<1e-12)throw new Exception("Singular composite part transform");
      float nx=part.Normals[at],ny=part.Normals[at+1],nz=part.Normals[at+2];
      x=((e*k-f*hv)*nx+(f*g-d*k)*ny+(d*hv-e*g)*nz)/det;
      y=((c*hv-b*k)*nx+(a*k-c*g)*ny+(b*g-a*hv)*nz)/det;
      z=((b*f-c*e)*nx+(c*d-a*f)*ny+(a*e-b*d)*nz)/det;
      float length=(float)Math.Sqrt(x*x+y*y+z*z);if(length>1e-12){x/=length;y/=length;z/=length;}
      part.Normals[at]=x;part.Normals[at+1]=y;part.Normals[at+2]=z;
     }
    }
    notes.Add(sec.Name+": composite rest-pose part transforms baked using direct source vertex part indices; destruction animation is not exported.");
   }
   int indexBytes=lod.IndexUnitSize/8;if(indexBytes!=2&&indexBytes!=4)throw new Exception("Unknown index width");
   part.Indices=new uint[checked((int)sec.PrimitiveCount*3)];
   long offset=lod.VertexBufferSize+(long)sec.StartIndex*indexBytes;
   if(offset<0||offset+part.Indices.Length*(long)indexBytes>bytes.Length)throw new Exception("Index buffer out of range");
   for(int i=0;i<part.Indices.Length;i++){int at=checked((int)(offset+i*indexBytes));uint n=indexBytes==2?BitConverter.ToUInt16(bytes,at):BitConverter.ToUInt32(bytes,at);if(n>=sec.VertexCount)throw new Exception("Index outside section vertex range");part.Indices[i]=n;}
   if(part.Normals==null){part.Normals=Normals(part.Positions,part.Indices);notes.Add(sec.Name+": normals reconstructed from triangles because direct normal stream is absent; packed tangent-space decoding remains pending.");}
   parts.Add(part);
  }
  if(parts.Count==0)throw new Exception("No renderable triangle sections");
  var meta=J.Obj("source",entry.Name,"guid",entry.Guid.ToString(),"resourceId",rid.ToString(),"chunkGuid",lod.ChunkId.ToString(),"meshType",mesh.Type.ToString(),"lod",lodIndex,"units","meters","coordinateConversion","none; source Y-up values preserved","textureMaterialsApplied",false,"bindingApplied",mesh.Type==MeshType.MeshType_Rigid||mesh.Type==MeshType.MeshType_Composite,"flipV",flipV,"limitations",notes,"partTransforms",lod.PartTransforms.Select(t=>new float[]{t.right.x,t.right.y,t.right.z,0,t.up.x,t.up.y,t.up.z,0,t.forward.x,t.forward.y,t.forward.z,0,t.trans.x,t.trans.y,t.trans.z,1}).ToArray());
  Glb(output,parts,meta);J.Save(Path.ChangeExtension(output,"source.json"),meta);return meta;
 }
 static float[] Attribute(byte[] data,SECTION s,VertexElementUsage usage,int components){
  var desc=s.GeometryDeclDesc[0];var selected=desc.Elements.Where(field=>field.Usage==usage).ToArray();if(selected.Length==0)return null;var e=selected[0];
  int stream=e.StreamIndex;if(stream>=desc.Streams.Length)throw new Exception("Invalid vertex stream");
  int stride=desc.Streams[stream].VertexStride;if(stride==0)throw new Exception("Empty vertex stream");
  // Frosty FBX traversal visits streams consecutively and fields in declaration order.
  // Use the same layout, summing preceding fields in this stream rather than assuming Offset semantics across profile versions.
  long start=s.VertexOffset;for(int i=0;i<stream;i++)start+=(long)desc.Streams[i].VertexStride*s.VertexCount;
  int local=0;foreach(var field in desc.Elements){if(field.StreamIndex!=stream||field.Usage==VertexElementUsage.Unknown)continue;if(field.Usage==usage)break;local+=field.Size;}
  if(local+e.Size>stride)throw new Exception("Vertex attribute extends beyond stride");
  var result=new float[checked((int)s.VertexCount*components)];
  for(int i=0;i<s.VertexCount;i++){
   long at=start+(long)i*stride+local;if(at<0||at+e.Size>data.Length)throw new Exception("Vertex buffer out of range");
   float[] v=Components(data,(int)at,e.Format);if(v.Length<components)throw new Exception("Insufficient attribute components: "+e.Format);
   for(int n=0;n<components;n++){if(float.IsNaN(v[n])||float.IsInfinity(v[n]))throw new Exception("Non-finite attribute");result[i*components+n]=v[n];}
  }
  return result;
 }
 public static float[] Components(byte[] b,int at,VertexElementFormat format){
  string name=format.ToString();int count=1;for(int n=4;n>=2;n--)if(name.Contains(n.ToString())){count=n;break;}
  var v=new float[count];
  if(name.StartsWith("Float")){for(int i=0;i<count;i++)v[i]=BitConverter.ToSingle(b,at+i*4);return v;}
  if(name.StartsWith("Half")){for(int i=0;i<count;i++)v[i]=Half(BitConverter.ToUInt16(b,at+i*2));return v;}
  if(name.StartsWith("UByte")){for(int i=0;i<count;i++)v[i]=b[at+i]/(name.EndsWith("N")?255f:1);return v;}
  if(name.StartsWith("Byte")){for(int i=0;i<count;i++)v[i]=Math.Max(name.EndsWith("N")?-1:sbyte.MinValue,(sbyte)b[at+i]/(name.EndsWith("N")?127f:1));return v;}
  if(name.StartsWith("UShort")){for(int i=0;i<count;i++)v[i]=BitConverter.ToUInt16(b,at+i*2)/(name.EndsWith("N")?65535f:1);return v;}
  if(name.StartsWith("Short")){for(int i=0;i<count;i++)v[i]=Math.Max(name.EndsWith("N")?-1:short.MinValue,BitConverter.ToInt16(b,at+i*2)/(name.EndsWith("N")?32767f:1));return v;}
  throw new Exception("Unsupported vertex format "+format);
 }
 public static float Half(ushort bits){int sign=(bits&0x8000)==0?1:-1,exp=(bits>>10)&31,m=bits&1023;if(exp==31)return m==0?sign*float.PositiveInfinity:float.NaN;return sign*(float)(exp==0?Math.Pow(2,-14)*(m/1024.0):Math.Pow(2,exp-15)*(1+m/1024.0));}
 static float[] Normals(float[] p,uint[] idx){var n=new float[p.Length];for(int i=0;i<idx.Length;i+=3){int a=(int)idx[i]*3,b=(int)idx[i+1]*3,c=(int)idx[i+2]*3;float x1=p[b]-p[a],y1=p[b+1]-p[a+1],z1=p[b+2]-p[a+2],x2=p[c]-p[a],y2=p[c+1]-p[a+1],z2=p[c+2]-p[a+2];float x=y1*z2-z1*y2,y=z1*x2-x1*z2,z=x1*y2-y1*x2;foreach(int v in new int[]{a,b,c}){n[v]+=x;n[v+1]+=y;n[v+2]+=z;}}
  for(int i=0;i<n.Length;i+=3){float len=(float)Math.Sqrt(n[i]*n[i]+n[i+1]*n[i+1]+n[i+2]*n[i+2]);if(len>1e-10){n[i]/=len;n[i+1]/=len;n[i+2]/=len;}else n[i+1]=1;}return n;
 }
 public static void Glb(string path,List<GeometryPart> parts,object extras){
  var views=new List<object>();var accessors=new List<object>();var primitives=new List<object>();var mats=new List<object>();
  using(var blob=new MemoryStream())using(var writer=new BinaryWriter(blob)){
   foreach(var p in parts){var attrs=J.Obj("POSITION",FloatAccessor(writer,views,accessors,p.Positions,3,true));
    if(p.Normals!=null)attrs["NORMAL"]=FloatAccessor(writer,views,accessors,p.Normals,3,false);
    if(p.Uv!=null)attrs["TEXCOORD_0"]=FloatAccessor(writer,views,accessors,p.Uv,2,false);
    int offset=(int)blob.Position;foreach(uint i in p.Indices)writer.Write(i);int vi=views.Count;views.Add(J.Obj("buffer",0,"byteOffset",offset,"byteLength",p.Indices.Length*4,"target",34963));int ai=accessors.Count;accessors.Add(J.Obj("bufferView",vi,"componentType",5125,"count",p.Indices.Length,"type","SCALAR"));
    int mi=mats.Count;mats.Add(J.Obj("name",p.Name,"pbrMetallicRoughness",J.Obj("baseColorFactor",new float[]{1,1,1,1},"metallicFactor",0,"roughnessFactor",1),"extras",J.Obj("sourceMaterialId",p.MaterialId,"placeholder",true)));
    primitives.Add(J.Obj("attributes",attrs,"indices",ai,"material",mi,"mode",4,"extras",J.Obj("sectionName",p.Name,"sourceMaterialId",p.MaterialId)));
   }
   var doc=J.Obj("asset",J.Obj("version","2.0","generator","BF2 historical asset extractor"),"scene",0,"scenes",new object[]{J.Obj("nodes",new int[]{0})},"nodes",new object[]{J.Obj("mesh",0)},"meshes",new object[]{J.Obj("primitives",primitives)},"materials",mats,"buffers",new object[]{J.Obj("byteLength",blob.Length)},"bufferViews",views,"accessors",accessors,"extras",extras);
   byte[] json=Encoding.UTF8.GetBytes(J.Encode(doc));int padded=(json.Length+3)&~3;Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(path)));
   using(var outWriter=new BinaryWriter(File.Create(path))){outWriter.Write(0x46546c67);outWriter.Write(2);outWriter.Write(checked(12+8+padded+8+(int)blob.Length));outWriter.Write(padded);outWriter.Write(0x4E4F534A);outWriter.Write(json);for(int i=json.Length;i<padded;i++)outWriter.Write((byte)32);outWriter.Write((int)blob.Length);outWriter.Write(0x004E4942);outWriter.Write(blob.ToArray());}
  }
 }
 static int FloatAccessor(BinaryWriter w,List<object> views,List<object> accessors,float[] data,int size,bool bounds){int offset=(int)w.BaseStream.Position;foreach(float v in data)w.Write(v);int view=views.Count;views.Add(J.Obj("buffer",0,"byteOffset",offset,"byteLength",data.Length*4,"target",34962));var a=J.Obj("bufferView",view,"componentType",5126,"count",data.Length/size,"type","VEC"+size);if(bounds){float[] min=Enumerable.Repeat(float.PositiveInfinity,size).ToArray(),max=Enumerable.Repeat(float.NegativeInfinity,size).ToArray();for(int i=0;i<data.Length;i++){min[i%size]=Math.Min(min[i%size],data[i]);max[i%size]=Math.Max(max[i%size],data[i]);}a["min"]=min;a["max"]=max;}int index=accessors.Count;accessors.Add(a);return index;}
 public static object Texture(Historical h,EBX entry,string output){
  var root=h.Decode(entry).RootObject;object rr=J.Get(root,"Resource");if(!(rr is ResourceRef))throw new Exception("Asset has no texture Resource");ulong rid=(ResourceRef)rr;var res=h.Res(rid);if(res==null)throw new Exception("Missing texture RES");
  using(var texture=(TEX)h.Texture(res)){Dds(output,texture);var meta=J.Obj("source",entry.Name,"guid",entry.Guid.ToString(),"resourceId",rid.ToString(),"chunkGuid",texture.ChunkId.ToString(),"width",texture.Width,"height",texture.Height,"depth",texture.Depth,"type",texture.Type.ToString(),"pixelFormat",texture.PixelFormat,"mipCount",texture.MipCount,"firstMip",texture.FirstMip);J.Save(Path.ChangeExtension(output,"source.json"),meta);return meta;}
 }
 static uint Dxgi(string f){switch(f){case "BC1A_SRGB":case "BC1_SRGB":return 72;case "BC1A_UNORM":case "BC1_UNORM":case "DXT1":case "NormalDXT1":return 71;case "BC2_SRGB":return 75;case "BC2_UNORM":case "DXT3":return 74;case "BC3_SRGB":case "BC3A_SRGB":return 78;case "BC3_UNORM":case "BC3A_UNORM":case "DXT5":return 77;case "BC4_UNORM":return 80;case "BC5_UNORM":case "NormalDXN":return 83;case "BC6U_FLOAT":return 95;case "BC7_SRGB":return 99;case "BC7":case "BC7_UNORM":return 98;case "R8_UNORM":case "L8":return 61;case "R16_UNORM":case "L16":return 56;case "R10G10B10A2_UNORM":return 24;case "R8G8B8A8_UNORM":case "ARGB8888":return 28;case "R8G8B8A8_SRGB":return 29;case "R16G16B16A16_FLOAT":return 10;case "R32G32B32A32_FLOAT":case "ARGB32F":return 2;case "R9G9B9E5F":case "R9G9B9E5_FLOAT":return 67;default:throw new Exception("Unsupported DDS format "+f);}}
 public static void Dds(string path,TEX t){
  string fmt=t.PixelFormat;if(fmt.StartsWith("BC")&&t.Flags.HasFlag(TextureFlags.SrgbGamma))fmt=fmt.Replace("UNORM","SRGB");uint dxgi=Dxgi(fmt);
  bool cube=t.Type==TextureType.TT_Cube,array=t.Type==TextureType.TT_2dArray,volume=t.Type==TextureType.TT_3d;
  if(t.Type!=TextureType.TT_2d&&!cube&&!array&&!volume)throw new Exception("Unsupported texture dimension "+t.Type);
  if(t.MipCount==0||t.Width==0||t.Height==0)throw new Exception("Invalid empty texture");
  bool compressed=dxgi>=70&&dxgi<=99;uint pitch=compressed?t.MipSizes[0]:(uint)(t.Width*(dxgi==2?16:dxgi==10?8:dxgi==61?1:dxgi==56?2:4));
  Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(path)));
  using(var w=new BinaryWriter(File.Create(path))){
   w.Write(0x20534444);w.Write(124);w.Write((uint)(0x1007|(compressed?0x80000:8)|(t.MipCount>1?0x20000:0)|(volume?0x800000:0)));w.Write((uint)t.Height);w.Write((uint)t.Width);w.Write(pitch);w.Write(volume?(uint)t.Depth:0u);w.Write((uint)t.MipCount);for(int i=0;i<11;i++)w.Write(0u);
   w.Write(32u);w.Write(4u);w.Write(0x30315844);for(int i=0;i<5;i++)w.Write(0u);w.Write((uint)(0x1000|(t.MipCount>1?0x400008:0)|(cube||volume?8:0)));w.Write(cube?0xFE00u:volume?0x200000u:0u);w.Write(0u);w.Write(0u);w.Write(0u);
   w.Write(dxgi);w.Write(volume?4u:3u);w.Write(cube?4u:0u);w.Write(array?(uint)t.Depth:1u);w.Write(0u);
   if(cube||array){int slices=cube?6:t.Depth;long[] offsets=new long[t.MipCount];for(int i=1;i<offsets.Length;i++)offsets[i]=offsets[i-1]+t.MipSizes[i-1]*(long)slices;for(int face=0;face<slices;face++)for(int mip=0;mip<t.MipCount;mip++){t.Data.Position=offsets[mip]+t.MipSizes[mip]*(long)face;byte[] b=new byte[t.MipSizes[mip]];ReadExactly(t.Data,b);w.Write(b);}}
   else{t.Data.Position=0;t.Data.CopyTo(w.BaseStream);}
  }
 }
 public static void TestDds(string path){
  using(var w=new BinaryWriter(File.Create(path))){w.Write(0x20534444);w.Write(124);w.Write(0x100F);w.Write(1);w.Write(1);w.Write(4);w.Write(0);w.Write(1);for(int i=0;i<11;i++)w.Write(0);w.Write(32);w.Write(4);w.Write(0x30315844);for(int i=0;i<5;i++)w.Write(0);w.Write(0x1000);for(int i=0;i<4;i++)w.Write(0);w.Write(28);w.Write(3);w.Write(0);w.Write(1);w.Write(0);w.Write(new byte[]{255,0,0,255});}
 }
 static void ReadExactly(Stream s,byte[] b){int pos=0;while(pos<b.Length){int n=s.Read(b,pos,b.Length-pos);if(n==0)throw new EndOfStreamException();pos+=n;}}
}
