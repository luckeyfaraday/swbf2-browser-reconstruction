"""Decode only the selected installed EA XAS1 SoundWaveAsset segments to PCM WAV.

Codec reference: FrostyToolsuite SoundEditorPlugin/FrostySoundDataEditor.cs (XAS).
Checks EA block boundaries/counts and clamps before int16 conversion. Original
chunk, EBX association, hashes and per-variation offsets are preserved offline.
"""
import argparse,array,hashlib,json,pathlib,struct,sys,wave

def decode(data):
 if len(data)<12 or data[0]!=0x48 or int.from_bytes(data[1:4],'big')!=12:raise ValueError('Invalid EA audio header')
 codec=data[4];channels=(data[5]>>2)+1;rate=struct.unpack_from('>H',data,6)[0];count=int.from_bytes(data[8:12],'big')&0xffffff
 if codec!=0x14:raise ValueError(f'Unsupported codec {codec:02x}')
 result=[[] for _ in range(channels)];at=12;blocks=0
 c1=[0,240,460,392];c2=[0,0,-208,-220]
 while at+4<=len(data):
  kind=data[at];size=int.from_bytes(data[at+1:at+4],'big')
  if size<4 or at+size>len(data):raise ValueError('Audio block exceeds segment')
  if kind==0x45:at+=size;break
  if kind!=0x44 or size<8 or (size-8)%(76*channels):raise ValueError('Invalid XAS data block')
  declared=int.from_bytes(data[at+4:at+8],'big');pos=at+8;block=[[] for _ in range(channels)]
  for frame in range((size-8)//(76*channels)):
   for channel in range(channels):
    packed=data[pos:pos+76];pos+=76
    for sub in range(4):
     h=sub*4;predictor=packed[h]&15;shift=packed[h+2]&15
     if predictor>=4:raise ValueError('Invalid XAS predictor')
     signed=lambda x:x-65536 if x>=32768 else x
     samples=[signed((packed[h]&240)|(packed[h+1]<<8)),signed((packed[h+2]&240)|(packed[h+3]<<8))]
     for n in range(2,32):
      byte=packed[12+sub+(n//2*2)*2];nibble=byte>>4 if n%2==0 else byte&15
      if nibble>=8:nibble-=16
      value=(samples[-1]*c1[predictor]+samples[-2]*c2[predictor]+(nibble<<(20-shift))+128)>>8
      samples.append(max(-32768,min(32767,value)))
     block[channel].extend(samples)
  if declared>len(block[0]):raise ValueError('Declared samples exceed decoded block')
  for channel in range(channels):result[channel].extend(block[channel][:declared])
  at+=size;blocks+=1
 if any(len(c)<count for c in result):raise ValueError('Decoded audio shorter than header')
 pcm=array.array('h',(result[c][n] for n in range(count) for c in range(channels)))
 if sys.byteorder!='little':pcm.byteswap()
 return pcm.tobytes(),{'codec':'EA XAS1 (0x14)','channels':channels,'sampleRate':rate,'samplesPerChannel':count,'duration':count/rate,'blocks':blocks,'sourceSegmentBytes':len(data),'peak':max(abs(s) for s in pcm),'trailingPaddingBytes':len(data)-at}

if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('ebx',type=pathlib.Path);parser.add_argument('chunk',type=pathlib.Path);parser.add_argument('output',type=pathlib.Path);args=parser.parse_args();doc=json.loads(args.ebx.read_text());root=next(o for o in doc['asset']['objects'] if o['$type'].endswith('.SoundWaveAsset'));source=args.chunk.read_bytes();args.output.mkdir(parents=True,exist_ok=True);reports=[]
 if len(root['Chunks'])!=1 or root['Chunks'][0]['ChunkSize']!=len(source):raise ValueError('Source chunk association mismatch')
 for i,variation in enumerate(root['RuntimeVariations']):
  if variation['SegmentCount']!=1:raise ValueError('Only one-shot source variations are selected')
  index=variation['FirstSegmentIndex'];segment=root['Segments'][index];start=segment['SamplesOffset'];end=root['Segments'][index+1]['SamplesOffset'] if index+1<len(root['Segments']) else len(source)
  pcm,info=decode(source[start:end]);name=f'e11-close-{i+1:02d}.wav';out=args.output/name
  with wave.open(str(out),'wb')as w:w.setnchannels(info['channels']);w.setsampwidth(2);w.setframerate(info['sampleRate']);w.writeframes(pcm)
  if abs(info['duration']-segment['SegmentLength'])>0.000002:raise ValueError('Source duration disagrees with decoded samples')
  reports.append({'file':name,'sourceVariation':i,'sourceSegmentIndex':index,'sourceOffset':start,'sourceEnd':end,'sourceSegmentLength':segment['SegmentLength'],'sha256':hashlib.sha256(out.read_bytes()).hexdigest(),**info})
 report={'evidenceId':'AUDIO-E11-001','sourceAsset':doc['entry'],'sourceEbx':str(args.ebx),'chunkGuid':root['Chunks'][0]['ChunkId'],'sourceChunk':str(args.chunk),'chunkSha256':hashlib.sha256(source).hexdigest(),'selection':root['Selection'],'variationHistoryCount':root['VariationHistoryCount'],'variations':reports,'limitations':['Original source dry close-shot samples decoded. Full source master-blaster sound graph, reflections, shared noise/HiFi layers, distance crossfade and gain processing are not reconstructed.']};(args.output/'e11-close.source.json').write_text(json.dumps(report,indent=2));print(json.dumps({'count':len(reports),'bytes':sum((args.output/r['file']).stat().st_size for r in reports),'variations':reports},indent=2))
