// SPDX-License-Identifier: GPL-3.0-or-later
// Test-only host for the retained, UNMODIFIED AssetBankPlugin DCT source.
// This host supplies a minimal reader API and fields; the decoder implementation
// is linked directly from assetbank-reference/Ant/DCT and has its original GPL license.
using System;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Numerics;

namespace FrostySdk.IO {
    public enum Endian { Little, Big }
    public class NativeReader : BinaryReader {
        public NativeReader(Stream stream) : base(stream) { }
        public virtual long Position { get { return BaseStream.Position; } }
        public virtual long Length { get { return BaseStream.Length; } }
        public short ReadShort() { return ReadInt16(); }
        public ushort ReadUShort() { return ReadUInt16(); }
    }
}

namespace AssetBankPlugin.Ant {
    public class AnimationAsset { }
    public partial class DctAnimationAsset : AnimationAsset {
        public ushort NumVec3, NumQuats, NumFloatVec, NumKeys, QuantizeMultBlock;
        public byte QuantizeMultSubblock, CatchAllBitCount;
        public byte[] DofTableDescBytes, Data;
        public short[] DeltaBaseX, DeltaBaseY, DeltaBaseZ, DeltaBaseW;
        public ushort[] BitsPerSubblock;
    }
}

public class Program {
    public static void Main(string[] args) {
        JsonElement values = JsonDocument.Parse(File.ReadAllText(args[0])).RootElement.GetProperty("arrayValues");
        var decoder = new AssetBankPlugin.Ant.DctAnimationAsset();
        foreach(var field in decoder.GetType().GetFields()) {
            JsonElement value;
            if (!values.TryGetProperty(field.Name, out value)) continue;
            object converted;
            if (field.FieldType == typeof(ushort)) converted = value.GetUInt16();
            else if (field.FieldType == typeof(byte)) converted = value.GetByte();
            else if (field.FieldType == typeof(byte[])) converted = value.EnumerateArray().Select(x=>x.GetByte()).ToArray();
            else if (field.FieldType == typeof(short[])) converted = value.EnumerateArray().Select(x=>x.GetInt16()).ToArray();
            else if (field.FieldType == typeof(ushort[])) converted = value.EnumerateArray().Select(x=>x.GetUInt16()).ToArray();
            else continue;
            field.SetValue(decoder,converted);
        }
        var result = decoder.Decompress();
        using (var writer = new BinaryWriter(File.Create(args[1]))) {
            foreach(Vector4 row in result) { writer.Write(row.X); writer.Write(row.Y); writer.Write(row.Z); writer.Write(row.W); }
        }
        Console.WriteLine("Decoded " + result.Count + " source Vector4 samples to " + args[1]);
    }
}
