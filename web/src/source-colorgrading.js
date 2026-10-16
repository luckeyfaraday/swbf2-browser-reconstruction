// BF2-NATIVE-POSTPROCESS-001. Output-conversion-0 arithmetic witnesses.
// The active SDR conversion-1 path lives in source-colorgrading-renderer.js
// and samples a cube baked by the unchanged original compute shader.
const f=Math.fround;
export const NATIVE_GRADING_POLICY=Object.freeze({
  evidenceId:'BF2-NATIVE-POSTPROCESS-001',
  source:'Original ColorCubeInterpolateCS sourceTexture1/hdrGrading1/outputConversion0 and linear HDR Tonemap with grading.',
  coordinates:'Authored33-cubed texture uses (x,32-y,z) during construction; Tonemap samples encoded RGB*(32/33)+(.5/33).',
  limitations:'Pure arithmetic and explicit output-conversion-0 WARP fixtures. The active SDR conversion-1 baseline is independently documented in source-colorgrading-renderer.js; these helpers do not generate its shoulder-converted cube.',
});
const power=(value,exponent)=>f(2**f(f(Math.log2(value))*exponent));
export function nativePQEncode(value){
  const p=power(value,0.1593017578125);
  return power(f(f(p*18.8515625+0.8359375)/f(p*18.6875+1)),78.84375);
}
export function nativePQDecode(value){
  const p=power(value,0.012683313339948654);
  return power(f(Math.max(f(p-0.8359375),0)/f(18.8515625-p*18.6875)),6.277394771575928);
}
export function nativeHdrGradingCoordinates(linearRGB){
  return linearRGB.map(value=>f(nativePQEncode(f(value*f(.01)))*f(32/33)+f(.5/33)));
}

// Constants are the original400-byte ColorCubeConstants buffer, expressed as
// 100float32 words. This preserves native matrix rows and parameter positions.
export function evaluateNativeColorCubeTexel(rgb,constants){
  if(constants.length!==100)throw new Error('Expected original400-byte ColorCubeConstants');
  const curb=constants[23],brightness=constants[24];
  return rgb.map((_,channel)=>{
    const at=channel*4;
    const transformed=f(rgb[0]*constants[at]+rgb[1]*constants[at+1]+rgb[2]*constants[at+2]+constants[at+3]);
    let gamma=constants[20+channel];
    if(curb!==0)gamma=f(f(Math.min(transformed,curb)/curb)*f(1-gamma)+gamma);
    let value=power(Math.max(transformed,0),gamma);
    value=f(f(brightness-1)*constants[26]+value);
    value=power(Math.max(value,0),constants[25]);
    value=f(Math.min(f(constants[27]*brightness),1)*value);
    return nativePQEncode(f(nativePQDecode(value)*constants[28]));
  });
}

export function originalGradingVoxel(words,x,y,z){
  if(words.length!==33**3)throw new Error('Expected original33-cubed packed10-bit LUT');
  if(![x,y,z].every(value=>Number.isInteger(value)&&value>=0&&value<33))throw new Error('Original LUT coordinate outside33-cubed extent');
  const packed=words[(z*33+32-y)*33+x];
  return [0,10,20].map(shift=>f(((packed>>>shift)&1023)/1023));
}
