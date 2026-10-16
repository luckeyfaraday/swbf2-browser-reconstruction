// Standalone source frame helper vs unchanged original VS CPU-WARP outputs.
import {createServer} from 'vite';
import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),repository=path.dirname(root);
const report={kind:'source-tangent-frame-gpu-parity',nativeGameCapture:false,errors:[]};let server,browser;
try {
  const evidence=JSON.parse(await fs.readFile(path.join(repository,'exports/materials/native-tangent-witness/evidence.json')));
  const source=JSON.parse(await fs.readFile(path.join(repository,'exports/materials/native-tangent-witness/document.json')));
  const payload=await fs.readFile(path.join(repository,'exports/materials/native-tangent-witness/tangent-output.bin'));const vertices=[];
  for(const row of source.records){
    const normals=await fs.readFile(path.join(repository,'exports/materials/native-tangent-witness',row.fields.find(f=>f.usage==='Normal').floatFile));
    for(let i=0;i<row.vertexCount;i++)vertices.push(...[0,1,2].map(c=>normals.readFloatLE(i*16+c*4)),...[0,1,2,3].map(c=>payload.readFloatLE(row.tangentOffset+i*16+c*4)));
  }
  server=await createServer({root,server:{host:'127.0.0.1',port:7747,strictPort:true,watch:null,hmr:false},logLevel:'warn'});await server.listen();
  browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--enable-webgl','--ignore-gpu-blocklist']});
  const page=await browser.newPage();page.on('pageerror',e=>report.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
  await page.route('**/source-tangent-fixture',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html><body></body></html>'}));
  await page.goto('http://127.0.0.1:7747/source-tangent-fixture');
  const gpu=await page.evaluate(async({vertices,cases})=>{
    const {SOURCE_TANGENT_VERTEX_GLSL}=await import('/src/source-tangent-frame.js');
    const gl=document.createElement('canvas').getContext('webgl2');if(!gl)throw new Error('WebGL2 unavailable');
    const ext=gl.getExtension('WEBGL_debug_renderer_info');const hardware=ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);
    const compile=(type,text)=>{const shader=gl.createShader(type);gl.shaderSource(shader,text);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(shader));return shader;};
    const vs=compile(gl.VERTEX_SHADER,`#version 300 es
      precision highp float;
      layout(location=0) in vec3 sourceNormal;
      layout(location=1) in vec4 sourceTangent;
      uniform mat4 sourceMatrix;
      out vec3 T,B,N;
      ${SOURCE_TANGENT_VERTEX_GLSL}
      void main(){bf2_sourceVertexFrame(sourceNormal,sourceTangent,mat3(sourceMatrix),T,B,N);gl_Position=vec4(0,0,0,1);}`);
    const fs=compile(gl.FRAGMENT_SHADER,'#version 300 es\nprecision highp float;out vec4 color;void main(){color=vec4(1);}');
    const program=gl.createProgram();gl.attachShader(program,vs);gl.attachShader(program,fs);gl.transformFeedbackVaryings(program,['T','B','N'],gl.INTERLEAVED_ATTRIBS);gl.linkProgram(program);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program));gl.useProgram(program);
    const input=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,input);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(vertices),gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,3,gl.FLOAT,false,28,0);gl.enableVertexAttribArray(1);gl.vertexAttribPointer(1,4,gl.FLOAT,false,28,12);
    const count=vertices.length/7,feedback=gl.createTransformFeedback();gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK,feedback);
    const output=gl.createBuffer();gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER,output);gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER,count*9*4,gl.DYNAMIC_READ);gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,0,output);
    const matrix=gl.getUniformLocation(program,'sourceMatrix'),outputs=[];gl.enable(gl.RASTERIZER_DISCARD);
    for(const entry of cases){
      gl.uniformMatrix4fv(matrix,false,entry.matrix);gl.beginTransformFeedback(gl.POINTS);gl.drawArrays(gl.POINTS,0,count);gl.endTransformFeedback();
      const values=new Float32Array(count*9);gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER,0,values);outputs.push(Array.from(values));
    }
    gl.disable(gl.RASTERIZER_DISCARD);const error=gl.getError();gl.deleteBuffer(input);gl.deleteBuffer(output);gl.deleteTransformFeedback(feedback);gl.deleteProgram(program);gl.deleteShader(vs);gl.deleteShader(fs);
    return {hardware,vertices:count,cases:cases.length,outputs,error};
  },{vertices,cases:evidence.inputFixture.cases});
  const native=await fs.readFile(path.join(repository,'exports/materials/native-tangent-witness/3eba974d4e.warp.bin'));
  report.result={hardware:gpu.hardware,vertices:gpu.vertices,cases:gpu.cases,comparisons:0,maximumError:0,bitIdentical:0,mismatches:[],glError:gpu.error};
  for(let c=0;c<gpu.cases;c++)for(let i=0;i<gpu.vertices;i++)for(let column=0;column<3;column++)for(let axis=0;axis<3;axis++){
    const expected=native.readFloatLE((c*gpu.vertices+i)*64+16+axis*16+column*4),actual=gpu.outputs[c][i*9+column*3+axis];
    const error=Math.abs(actual-expected);report.result.comparisons++;report.result.maximumError=Math.max(error,report.result.maximumError);if(Object.is(actual,expected))report.result.bitIdentical++;
    if((!Number.isFinite(actual)||error>5e-7)&&report.result.mismatches.length<20)report.result.mismatches.push({case:c,vertex:i,column,axis,actual,expected,error});
  }
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.result.mismatches,[]);assert.equal(gpu.error,0);report.pass=true;
}catch(error){report.pass=false;report.failure=String(error.stack??error);process.exitCode=1;}
finally{await browser?.close();await server?.close();await fs.writeFile(path.join(root,'test-results/source-tangent-frame-gpu-check.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));}
