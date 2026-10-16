import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {evaluateBlasterBoltVertex} from '../src/blaster-bolt-vertex.js';
const root=new URL('../../',import.meta.url),read=p=>fs.readFileSync(new URL(p,root));
export function compareBlasterBoltVertexReference({nativeTrig=false}={}){
 const input=read('exports/rifle-trail/vertex-warp/input.bin'),output=read('exports/rifle-trail/vertex-warp/output.bin');
 const cases=input.readUInt32LE(4),vertices=input.readUInt32LE(8),stride=912+88+48+608,start=16+vertices*20;
 const channelMax=Array(36).fill(0),worst=[],differences=[],visibilityDifferences=[];let maxAbsolute=0,maxRelative=0,nonfinite=0,ordinary=0,flare=0,bodyMax=0,flareGeometryMax=0;
 let trig=Math;
 if(nativeTrig){
  const inputs=read('exports/rifle-trail/render-trig-warp/input.bin'),outputs=read('exports/rifle-trail/render-trig-warp/output.bin'),sines=new Map(),cosines=new Map();
  for(let i=0;i<inputs.length/8;i++)for(let j=0;j<2;j++){const angle=inputs.readFloatLE(i*8+j*4);sines.set(angle,outputs.readFloatLE(i*16+j*4));cosines.set(angle,outputs.readFloatLE(i*16+(j+2)*4));}
  const lookup=(m,x)=>{if(!m.has(x))throw new Error(`Trig fixture missing exact angle ${x}`);return m.get(x);};
  trig={sin:x=>lookup(sines,x),cos:x=>lookup(cosines,x)};
 }
 const floats=(b,n)=>Array.from({length:n},(_,i)=>b.readFloatLE(i*4));
 for(let c=0;c<cases;c++){
  const at=start+c*stride,emitters=input.subarray(at,at+912),particles=input.subarray(at+912,at+1000);
  const cb1=floats(input.subarray(at+1000,at+1048),12),cb2=floats(input.subarray(at+1048,at+1656),152),drawIndices=new Uint32Array([0]);
  for(let v=0;v<vertices;v++){
   const source=floats(input.subarray(16+v*20,16+v*20+20),5);
   const actual=evaluateBlasterBoltVertex({position:source.slice(0,3),uv:source.slice(3),cb1,cb2,emitters,particles,drawIndices,trig});
   const native=floats(output.subarray((c*vertices+v)*144,(c*vertices+v+1)*144),36);
   if(native[23]>0)flare++;else ordinary++;
   if(actual[5][3]!==native[23])visibilityDifferences.push({case:c,vertex:v,actual:actual[5][3],native:native[23],actualAmplitude:actual[7][2],nativeAmplitude:native[30]});
   for(let k=0;k<36;k++){
    const a=actual[k>>>2][k&3],b=native[k],error=Math.abs(a-b),relative=error/Math.max(1,Math.abs(b));
    if(!Number.isFinite(a)){nonfinite++;if(differences.length<100)differences.push({case:c,vertex:v,channel:k,actual:String(a),native:b});continue;}
    channelMax[k]=Math.max(channelMax[k],error);maxAbsolute=Math.max(maxAbsolute,error);maxRelative=Math.max(maxRelative,relative);
    if(source[1]>=-.98)bodyMax=Math.max(bodyMax,error);else if(k!==30&&actual[5][3]===native[23])flareGeometryMax=Math.max(flareGeometryMax,error);
    if(error>1e-4&&relative>1e-5){const row={case:c,vertex:v,channel:k,actual:a,native:b,error,relative};if(differences.length<100)differences.push(row);worst.push(row);}
   }
  }
 }
 worst.sort((a,b)=>b.error-a.error);
 return {evidenceId:'LOCAL-BLASTER-BOLT-VS-VALIDATION-001',nativeTrigProbe:nativeTrig,cases,vertices,outputs:cases*vertices,scalarComparisons:cases*vertices*36,maxAbsolute,maxRelative,bodyMax,flareGeometryMax,channelMax,nonfinite,ordinary,flare,visibilityDifferences,differences,worst:worst.slice(0,20),largeDifferences:worst.length};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const nativeTrig=process.argv.includes('--native-trig'),report=compareBlasterBoltVertexReference({nativeTrig});fs.writeFileSync(new URL(`exports/rifle-trail/render-shaders/render-material-vs-validation${nativeTrig?'-native-trig':''}.json`,root),JSON.stringify(report,null,2));
 console.log(JSON.stringify(report,null,2));
}
