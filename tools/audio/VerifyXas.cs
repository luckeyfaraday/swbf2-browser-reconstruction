using System;using System.IO;using System.Collections.Generic;
    public static class XAS
    {
        public static short[] Decode(byte[] soundBuffer)
        {
            using (NativeReader reader = new NativeReader(new MemoryStream(soundBuffer)))
            {
                ushort blockType = reader.ReadUShort();
                ushort blockSize = reader.ReadUShort(Endian.Big);
                byte compressionType = reader.ReadByte();

                int channelCount = (reader.ReadByte() >> 2) + 1;
                ushort sampleRate = reader.ReadUShort(Endian.Big);
                int totalSampleCount = reader.ReadInt(Endian.Big) & 0x00ffffff;

                List<short>[] channels = new List<short>[channelCount];
                for (int i = 0; i < channelCount; i++)
                    channels[i] = new List<short>();

                while (reader.Position <= reader.Length)
                {
                    blockType = reader.ReadUShort();
                    blockSize = reader.ReadUShort(Endian.Big);

                    if (blockType == 0x45)
                        break;

                    uint samples = reader.ReadUInt(Endian.Big);

                    byte[] buffer = null;
                    short[] blockBuffer = new short[32];
                    int[] consts1 = new int[4] { 0, 240, 460, 392 };
                    int[] consts2 = new int[4] { 0, 0, -208, -220 };

                    for (int i = 0; i < (blockSize / 76 / channelCount); i++)
                    {
                        for (int j = 0; j < channelCount; j++)
                        {
                            buffer = reader.ReadBytes(76);

                            for (int k = 0; k < 4; k++)
                            {
                                blockBuffer[0] = (short)(buffer[k * 4 + 0] & 0xF0 | buffer[k * 4 + 1] << 8);
                                blockBuffer[1] = (short)(buffer[k * 4 + 2] & 0xF0 | buffer[k * 4 + 3] << 8);

                                int index4 = (int)buffer[k * 4] & 0x0F;
                                int num10 = (int)buffer[k * 4 + 2] & 0x0F;
                                int index5 = 2;

                                while (index5 < 32)
                                {
                                    int num11 = ((int)buffer[12 + k + index5 * 2] & 240) >> 4;
                                    if (num11 > 7)
                                        num11 -= 16;

                                    int num12 = blockBuffer[index5 - 1] * consts1[index4] + blockBuffer[index5 - 2] * consts2[index4];

                                    blockBuffer[index5] = (short)(num12 + (num11 << 20 - num10) + 128 >> 8);
                                    if (blockBuffer[index5] > (int)short.MaxValue)
                                        blockBuffer[index5] = (int)short.MaxValue;
                                    else if (blockBuffer[index5] < (int)short.MinValue)
                                        blockBuffer[index5] = (int)short.MinValue;

                                    int num13 = (int)buffer[12 + k + index5 * 2] & 15;
                                    if (num13 > 7)
                                        num13 -= 16;

                                    int num14 = blockBuffer[index5] * consts1[index4] + blockBuffer[index5 - 1] * consts2[index4];

                                    blockBuffer[index5 + 1] = (short)(num14 + (num13 << 20 - num10) + 128 >> 8);
                                    if (blockBuffer[index5 + 1] > (int)short.MaxValue)
                                        blockBuffer[index5 + 1] = (int)short.MaxValue;
                                    else if (blockBuffer[index5 + 1] < (int)short.MinValue)
                                        blockBuffer[index5 + 1] = (int)short.MinValue;

                                    index5 += 2;
                                }

                                channels[j].AddRange(blockBuffer);
                            }

                            uint sampleSize = (samples < 128) ? samples : 128;
                            samples -= sampleSize;
                        }
                    }
                }

                short[] outBuffer = new short[channels[0].Count * channelCount];
                for (int i = 0; i < channels[0].Count; i++)
                {
                    for (int j = 0; j < channelCount; j++)
                    {
                        outBuffer[(i * channelCount) + j] = channels[j][i];
                    }
                }

                return outBuffer;
            }
        }
    }


class VerifyXas { static void Main(string[] args) { var x=XAS.Decode(File.ReadAllBytes(args[0])); using(var w=new BinaryWriter(File.Create(args[1])))foreach(short a in x)w.Write(a); } }
enum Endian { Little, Big }
class NativeReader: IDisposable { BinaryReader r;public NativeReader(Stream s){r=new BinaryReader(s);}public long Position{get{return r.BaseStream.Position;}}public long Length{get{return r.BaseStream.Length;}}public byte ReadByte(){return r.ReadByte();}public byte[]ReadBytes(int n){return r.ReadBytes(n);}public ushort ReadUShort(Endian e=Endian.Little){var b=r.ReadBytes(2);return e==Endian.Big?(ushort)(b[0]*256+b[1]):(ushort)(b[1]*256+b[0]);}public uint ReadUInt(Endian e=Endian.Little){var b=r.ReadBytes(4);if(e==Endian.Big)Array.Reverse(b);return BitConverter.ToUInt32(b,0);}public int ReadInt(Endian e=Endian.Little){return (int)ReadUInt(e);}public void Dispose(){r.Dispose();}}
