// Standalone consumer fixture; imports modules from the existing user server.
// The blank intercepted route never starts the game or alters the play server.
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const root = path.resolve(import.meta.dirname, '..');
const folder = path.resolve(root, '../exports/lighting/native-shadow-warp');
const report = { evidenceId: 'BF2-NATIVE-SHADOW-SAMPLING-GPU-001', nativeGameCapture: false, errors: [] };
let browser;
try {
  const execution = JSON.parse(await fs.readFile(path.join(folder, 'execution.json')));
  const baseline = await fs.readFile(path.join(folder, 'baseline.rgba32f.bin'));
  const native = await fs.readFile(path.join(folder, 'native-cases.rgba32f.bin'));
  assert.equal(createHash('sha256').update(native).digest('hex'), execution.payloadSha256);
  browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--enable-webgl', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage();
  page.on('pageerror', e => report.errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') report.errors.push(m.text()); });
  await page.route('**/native-shadow-consumer-fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' }));
  await page.goto('http://127.0.0.1:7737/native-shadow-consumer-fixture');
  report.result = await page.evaluate(async execution => {
    const T = await import('/node_modules/three/build/three.module.js');
    const { SOURCE_SHADOW_SAMPLING_GLSL } = await import('/src/source-shadow-sampling.js');
    const renderer = new T.WebGLRenderer(); renderer.setSize(16, 16); renderer.toneMapping = T.NoToneMapping;
    const gl = renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
    const hardware = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    const geometry = new T.PlaneGeometry(2, 2), camera = new T.Camera();
    const scene = new T.Scene(), mesh = new T.Mesh(geometry); mesh.frustumCulled = false; scene.add(mesh);
    const vertexShader = 'in vec3 position; void main(){gl_Position=vec4(position.xy,0.0,1.0);}';
    const raw = execution.patterns.map(p => {
      const texture = new T.DataTexture(new Float32Array(p.depth), 16, 16, T.RedFormat, T.FloatType);
      texture.minFilter = texture.magFilter = T.NearestFilter; texture.generateMipmaps = false;
      texture.flipY = false; texture.needsUpdate = true; return texture;
    });
    const depthTarget = new T.WebGLRenderTarget(16, 16, { depthBuffer: true });
    depthTarget.depthTexture = new T.DepthTexture(16, 16, T.FloatType);
    depthTarget.depthTexture.minFilter = depthTarget.depthTexture.magFilter = T.LinearFilter;
    depthTarget.depthTexture.compareFunction = T.GreaterCompare;
    const depthMaterial = new T.RawShaderMaterial({ glslVersion: T.GLSL3, vertexShader,
      fragmentShader: 'precision highp float; precision highp int; uniform sampler2D inputDepth; out vec4 result; void main(){gl_FragDepth=texelFetch(inputDepth,ivec2(gl_FragCoord.xy),0).r;result=vec4(0.0);}',
      uniforms: { inputDepth: { value: raw[0] } }, depthTest: true, depthWrite: true, depthFunc: T.AlwaysDepth, blending: T.NoBlending });
    const material = new T.RawShaderMaterial({ glslVersion: T.GLSL3, vertexShader, depthTest: false, depthWrite: false, blending: T.NoBlending,
      uniforms: { rawAtlas: { value: raw[0] }, compareAtlas: { value: depthTarget.depthTexture },
        rows: { value: Array.from({ length: 4 }, () => new T.Vector4()) }, atlas: { value: new T.Vector4() }, quality: { value: 1 }, dimmer: { value: 1 } },
      fragmentShader: `precision highp float; precision highp int; precision highp sampler2DShadow;
        ${SOURCE_SHADOW_SAMPLING_GLSL}
        uniform sampler2D rawAtlas; uniform sampler2DShadow compareAtlas; uniform vec4 rows[4],atlas;
        uniform float quality,dimmer; out vec4 result;
        void main(){
          vec3 position=vec3(0.3*(gl_FragCoord.x/4.0-1.0),0.3*(1.0-gl_FragCoord.y/4.0),-2.0);
          bool inside; vec3 p=bf2ProjectNativeSpotShadow(position,rows[0],rows[1],rows[2],rows[3],atlas,inside);
          float filtered=int(quality)==1 ? bf2NativeShadowQuality1(rawAtlas,p,16) : bf2NativeShadowSimple(compareAtlas,p);
          float direct=p.z<1.0 ? texture(compareAtlas,p) : 1.0;
          result=vec4(inside ? bf2NativeShadowDimmer(filtered,dimmer,1.0) : 1.0,
            inside ? 1.0+dimmer*(direct-1.0) : 1.0,p.z,inside?1.0:0.0);
        }` });
    const target = new T.WebGLRenderTarget(8, 8, { type: T.FloatType, depthBuffer: false });
    const outputs = [];
    let lastPattern = -1;
    for (const c of execution.cases) {
      if (c.pattern !== lastPattern) {
        depthMaterial.uniforms.inputDepth.value = raw[c.pattern]; mesh.material = depthMaterial;
        renderer.setRenderTarget(depthTarget); renderer.render(scene, camera); lastPattern = c.pattern;
      }
      mesh.material = material; material.uniforms.rawAtlas.value = raw[c.pattern];
      for (let i = 0; i < 4; i++) material.uniforms.rows.value[i].fromArray(c.rows, i * 4);
      material.uniforms.atlas.value.fromArray(c.atlas); material.uniforms.quality.value = c.quality;
      material.uniforms.dimmer.value = c.dimmer;
      renderer.setRenderTarget(target); renderer.render(scene, camera);
      const pixels = new Float32Array(8 * 8 * 4);
      await renderer.readRenderTargetPixelsAsync(target, 0, 0, 8, 8, pixels);
      outputs.push({ index: c.index, pixels: Array.from(pixels) });
    }
    const programs = renderer.info.programs.map(p => ({ linked: gl.getProgramParameter(p.program, gl.LINK_STATUS) }));
    const glError = gl.getError();
    target.dispose(); depthTarget.dispose(); depthTarget.depthTexture.dispose(); material.dispose(); depthMaterial.dispose(); geometry.dispose(); raw.forEach(t => t.dispose()); renderer.dispose();
    return { hardware, outputs, programs, glError };
  }, execution);
  report.quality1 = { samples: 0, maximumError: 0 };
  report.simple = { samples: 0, maximumWARPError: 0, helperVsDirectGPUError: 0 };
  for (const output of report.result.outputs) {
    const c = execution.cases[output.index], quality1 = Math.trunc(c.quality) === 1;
    for (let i = 0; i < 64; i++) {
      const expected = native.readFloatLE(c.offset + i * 16) / baseline.readFloatLE(i * 16);
      const actual = output.pixels[i * 4], delta = Math.abs(actual - expected);
      assert.ok(Number.isFinite(actual));
      if (quality1) { report.quality1.samples++; report.quality1.maximumError = Math.max(report.quality1.maximumError, delta); }
      else { report.simple.samples++; report.simple.maximumWARPError = Math.max(report.simple.maximumWARPError, delta);
        report.simple.helperVsDirectGPUError = Math.max(report.simple.helperVsDirectGPUError, Math.abs(actual - output.pixels[i * 4 + 1])); }
    }
  }
  assert.equal(report.quality1.samples, 12800); assert.equal(report.simple.samples, 12800);
  assert.ok(report.quality1.maximumError < 2e-6);
  assert.equal(report.simple.helperVsDirectGPUError, 0);
  assert.ok(report.simple.maximumWARPError < 2 / 256 + 2e-6);
  assert.equal(report.result.glError, 0); assert.ok(report.result.programs.every(p => p.linked)); assert.deepEqual(report.errors, []);
  report.policy = { quality1: 'Full original native CS arithmetic match within float rounding.', simple: 'Same comparison/filter as direct GPU sampler; WARP versus hardware fractional filtering differences are retained.', nativeFrameParity: false };
  delete report.result.outputs;
  report.pass = true;
} catch (e) { report.pass = false; report.errors.push(String(e.stack ?? e)); process.exitCode = 1; }
finally {
  await browser?.close();
  await fs.mkdir(path.join(root, 'test-results'), { recursive: true });
  await fs.writeFile(path.join(root, 'test-results/source-shadow-sampling-gpu-check.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ pass: report.pass, hardware: report.result?.hardware, quality1: report.quality1, simple: report.simple, errors: report.errors }, null, 2));
}
