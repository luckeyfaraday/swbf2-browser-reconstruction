import {createServer} from 'vite';
import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const nativeTrig=process.env.BF2_NATIVE_TRIG==='1';
let browser,server;
const report={kind:'original-blaster-vertex-gpu',nativeTrig,errors:[]};
try {
 server=await createServer({root,server:{host:'127.0.0.1',port:7747,strictPort:true,watch:null,hmr:false},logLevel:'warn'});await server.listen();
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--enable-webgl','--ignore-gpu-blocklist']});
 const page=await browser.newPage();page.on('pageerror',e=>report.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
 await page.route('**/bolt-vertex-fixture',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html><body></body></html>'}));
 for(const name of ['input','output'])await page.route(`**/bolt-${name}.bin`,async r=>r.fulfill({contentType:'application/octet-stream',body:await fs.readFile(path.join(root,`../exports/rifle-trail/vertex-warp/${name}.bin`))}));
 for(const name of ['input','output'])await page.route(`**/trig-${name}.bin`,async r=>r.fulfill({contentType:'application/octet-stream',body:await fs.readFile(path.join(root,`../exports/rifle-trail/render-trig-warp/${name}.bin`))}));
 await page.goto('http://127.0.0.1:7747/bolt-vertex-fixture');
 report.comparison=await page.evaluate(async(nativeTrig)=>{
   const {BLASTER_BOLT_VERTEX_GLSL}=await import('/src/blaster-bolt-vertex.js');
   const [input,output]=await Promise.all(['input','output'].map(async n=>(await fetch(`/bolt-${n}.bin`)).arrayBuffer()));
   const header=new Uint32Array(input,0,4),count=header[1],vertices=header[2],reference=new Float32Array(output);
   const trig=nativeTrig?await Promise.all(['input','output'].map(async n=>new Float32Array(await (await fetch(`/trig-${n}.bin`)).arrayBuffer()))):null;
   const gl=document.createElement('canvas').getContext('webgl2');if(!gl)throw new Error('WebGL2 unavailable');
   const compile=(type,source)=>{const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s));return s;};
   const hooks=`uniform highp usampler2D emitterTexture;uniform highp usampler2D particleTexture;
     uint emitterWord(uint element,uint word){if(element!=0u||word>=228u)return 0u;return texelFetch(emitterTexture,ivec2(int(word/4u),0),0)[word%4u];}
     uint particleWord(uint word){if(word>=22u)return 0u;return texelFetch(particleTexture,ivec2(int(word/4u),0),0)[word%4u];}
     uvec4 bf2BoltEmitter(uint element,uint offset){uint w=offset/4u;return uvec4(emitterWord(element,w),emitterWord(element,w+1u),emitterWord(element,w+2u),emitterWord(element,w+3u));}
     uvec4 bf2BoltParticle(uint offset){uint w=offset/4u;return uvec4(particleWord(w),particleWord(w+1u),particleWord(w+2u),particleWord(w+3u));}
     uvec4 bf2BoltDrawIndex(uint element,uint offset){return uvec4(0u);}`;
   const names=['clip','v1','v2','v3','v4','v5','v6','v7','v8'];
   const trigFunctions=`uniform vec3 probeAngles;uniform vec3 probeSine;uniform vec3 probeCosine;
     float bf2ProbeSin(float angle){for(int i=0;i<3;i++)if(floatBitsToUint(angle)==floatBitsToUint(probeAngles[i]))return probeSine[i];return uintBitsToFloat(0x7fc00000u);}
     float bf2ProbeCos(float angle){for(int i=0;i<3;i++)if(floatBitsToUint(angle)==floatBitsToUint(probeAngles[i]))return probeCosine[i];return uintBitsToFloat(0x7fc00000u);}`;
   const evaluatedGlsl=nativeTrig?BLASTER_BOLT_VERTEX_GLSL.replace(/\bsin\(/g,'bf2ProbeSin(').replace(/\bcos\(/g,'bf2ProbeCos('):BLASTER_BOLT_VERTEX_GLSL;
   const source=`#version 300 es
     precision highp float;precision highp int;
     layout(location=0) in vec3 sourcePosition;layout(location=1) in vec2 sourceUv;
     uniform vec4 cb1[3];uniform vec4 cb2[38];
     ${names.map(n=>`out vec4 result_${n};`).join('\n')}
     ${nativeTrig?trigFunctions:''}\n${evaluatedGlsl}\n${hooks}
     void main(){BlasterBoltVertex result=evaluateBlasterBoltVertex(sourcePosition,sourceUv,0u,cb1,cb2);
       ${names.map(n=>`result_${n}=result.${n};`).join('\n')}gl_Position=result.clip;}`;
   const program=gl.createProgram();gl.attachShader(program,compile(gl.VERTEX_SHADER,source));
   gl.attachShader(program,compile(gl.FRAGMENT_SHADER,'#version 300 es\nprecision highp float;out vec4 color;void main(){color=vec4(0.0);}'));
   gl.transformFeedbackVaryings(program,names.map(n=>`result_${n}`),gl.INTERLEAVED_ATTRIBS);gl.linkProgram(program);
   if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program));gl.useProgram(program);
   const vao=gl.createVertexArray();gl.bindVertexArray(vao);
   const vertexBuffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,vertexBuffer);gl.bufferData(gl.ARRAY_BUFFER,new Uint8Array(input,16,vertices*20),gl.STATIC_DRAW);
   gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,3,gl.FLOAT,false,20,0);gl.enableVertexAttribArray(1);gl.vertexAttribPointer(1,2,gl.FLOAT,false,20,12);
   const texture=(unit,width,name)=>{const t=gl.createTexture();gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,t);gl.texStorage2D(gl.TEXTURE_2D,1,gl.RGBA32UI,width,1);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.uniform1i(gl.getUniformLocation(program,name),unit);return t;};
   const emitters=texture(0,57,'emitterTexture'),particles=texture(1,6,'particleTexture');
   const feedback=gl.createTransformFeedback();gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK,feedback);
   const resultBuffer=gl.createBuffer();gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER,resultBuffer);gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER,vertices*144,gl.DYNAMIC_READ);gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,0,resultBuffer);
   const result=new Float32Array(vertices*36),particleWords=new Uint32Array(24),maxError=Array(36).fill(0),differences=[],counts=Array(36).fill(0),branchDifferences=[];
   let offset=16+vertices*20,activeFlareCases=0;
   for(let c=0;c<count;c++) {
     if(trig){const a=trig[0],b=trig[1];gl.uniform3fv(gl.getUniformLocation(program,'probeAngles'),[a[c*4],a[c*4+1],a[c*4+2]]);gl.uniform3fv(gl.getUniformLocation(program,'probeSine'),[b[c*8],b[c*8+1],b[c*8+4]]);gl.uniform3fv(gl.getUniformLocation(program,'probeCosine'),[b[c*8+2],b[c*8+3],b[c*8+6]]);}
     gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,emitters);gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,57,1,gl.RGBA_INTEGER,gl.UNSIGNED_INT,new Uint32Array(input,offset,228));offset+=912;
     particleWords.set(new Uint32Array(input,offset,22));offset+=88;gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,particles);gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,6,1,gl.RGBA_INTEGER,gl.UNSIGNED_INT,particleWords);
     gl.uniform4fv(gl.getUniformLocation(program,'cb1[0]'),new Float32Array(input,offset,12));offset+=48;
     gl.uniform4fv(gl.getUniformLocation(program,'cb2[0]'),new Float32Array(input,offset,152));offset+=608;
     gl.enable(gl.RASTERIZER_DISCARD);gl.beginTransformFeedback(gl.POINTS);gl.drawArrays(gl.POINTS,0,vertices);gl.endTransformFeedback();gl.disable(gl.RASTERIZER_DISCARD);
     gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER,0,result);
     if(reference[(c*vertices+359)*36+23]>0)activeFlareCases++;
     for(let v=0;v<vertices;v++)for(let channel=0;channel<36;channel++) {
       const got=result[v*36+channel],want=reference[(c*vertices+v)*36+channel],error=Math.abs(got-want);maxError[channel]=Math.max(maxError[channel],error);
       if(!Number.isFinite(got)||error>Math.max(.00003,Math.abs(want)*.000002)) {
         counts[channel]++;if(differences.length<40)differences.push({case:c,vertex:v,channel,got,want,error});
       }
       if(channel===23&&got!==want)branchDifferences.push({case:c,vertex:v,got,want});
     }
   }
   const debug=gl.getExtension('WEBGL_debug_renderer_info');
   return {cases:count,vertices,samples:count*vertices,activeFlareCases,maxError,differenceCounts:counts,differences,branchDifferences,glError:gl.getError(),renderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):null};
 },nativeTrig);
 assert.equal(report.comparison.glError,0);assert.deepEqual(report.errors,[]);assert.deepEqual(report.comparison.branchDifferences,[]);
 for(let channel=0;channel<36;channel++)if(nativeTrig||channel!==30)assert.equal(report.comparison.differenceCounts[channel],0,`Vertex channel${channel} differs from original WARP`);
 report.verdict=nativeTrig?'all-channels-pass-with-original-WARP-trigonometry':'geometry-and-routing-pass-with-retained-hardware-trigonometry-amplitude-differences';
 report.pass=true;
}catch(error){report.pass=false;report.errors.push(String(error.stack??error));process.exitCode=1;}
finally{await browser?.close();await server?.close();await fs.mkdir(path.join(root,'test-results'),{recursive:true});await fs.writeFile(path.join(root,`test-results/blaster-vertex-gpu-check${nativeTrig?'-native-trig':''}.json`),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,comparison:report.comparison?{...report.comparison,differences:report.comparison.differences.slice(0,5),branchDifferences:report.comparison.branchDifferences.slice(0,5)}:null},null,2));}
