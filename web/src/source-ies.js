import {DataTexture, RedFormat, HalfFloatType, LinearFilter, RepeatWrapping,
  ClampToEdgeWrapping, NoColorSpace} from 'three';

/** Original single-layer IES texels. Native t9 is a texture array; this map uses
 * one profile, so a 2D sampler preserves that selected slice's data. Loading
 * does not apply IESMultiplier or header scalars: source-direct-light-config.js
 * applies their recovered conversion to light color, never to these texels. */
export function createSourceIesTexture(document, buffer) {
  if(document.nativeFormat?.value!==30||document.width!==128||document.height!==128
    ||document.channels!==1||document.mipCount!==1||buffer.byteLength!==32768)
    throw new Error('Source IES requires the recovered 128x128 single-mip R16_FLOAT payload');
  // Decode little-endian explicitly rather than depending on host endianness.
  const input=new DataView(buffer), data=new Uint16Array(document.width*document.height);
  for(let i=0;i<data.length;i++)data[i]=input.getUint16(i*2,true);
  const texture=new DataTexture(data,document.width,document.height,RedFormat,HalfFloatType);
  texture.name='BF2 original T_Lamp_01 IES';
  texture.colorSpace=NoColorSpace;
  texture.minFilter=LinearFilter;texture.magFilter=LinearFilter;
  texture.wrapS=RepeatWrapping;texture.wrapT=ClampToEdgeWrapping;
  texture.generateMipmaps=false;texture.flipY=false;texture.unpackAlignment=1;
  texture.userData.source={evidenceId:document.evidenceId,sourceResourceId:document.sourceResourceId,
    payloadSha256:document.payloadSha256,samplerInference:'V clamp inferred; native sampler descriptor not recovered.'};
  texture.needsUpdate=true;
  return texture;
}

export async function loadSourceIes({manifestUrl='/assets/lighting/source-ies.json',fetchImpl=fetch}={}) {
  const response=await fetchImpl(manifestUrl);
  if(!response.ok)throw new Error(`Source IES manifest HTTP ${response.status}`);
  const document=await response.json(),payload=await fetchImpl(document.url);
  if(!payload.ok)throw new Error(`Source IES payload HTTP ${payload.status}`);
  const texture=createSourceIesTexture(document,await payload.arrayBuffer());
  return {texture,document,dispose:()=>texture.dispose()};
}
