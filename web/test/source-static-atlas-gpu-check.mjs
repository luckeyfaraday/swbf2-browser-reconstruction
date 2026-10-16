// Browser GLSL versus retained unchanged original DXBC execution on CPU WARP.
// Exact texel centers isolate shader arithmetic; this is not a native game frame.
import {createServer} from 'vite';
import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.resolve(root, '../exports/lighting/static-atlas-sample');
const report = {evidenceId: 'BF2-STATIC-ATLAS-BROWSER-GPU-001', nativeGameCapture: false,
  kind: 'original-static-atlas-shader-arithmetic-fixture', errors: []};
let browser, server;
const read = name => fs.readFile(path.join(source, name));
async function floats(name) {
  const buffer = await read(name);
  return Array.from({length: buffer.length / 4}, (_, i) => buffer.readFloatLE(i * 4));
}
try {
  const execution = JSON.parse(await read('native-execution.json'));
  const expected = JSON.parse(await read('math-validation.json'));
  const shader = await fs.readFile(path.resolve(root, '../exports/materials/floor-shader/f789fdaafa.dxbc'));
  assert.equal(createHash('sha256').update(shader).digest('hex'), execution.pixelSha256);
  const names = ['StaticIrradianceTexture', 'StaticDirectionTexture', 'StaticDirectionTextureG',
    'StaticDirectionTextureB', 'StaticSkyVisibilityTexture'];
  const textureValues = await Promise.all(names.map(name => floats(`${name}.rgba32f.bin`)));
  server = await createServer({root, server: {host: '127.0.0.1', port: 7748, strictPort: true, watch: null, hmr: false}, logLevel: 'warn'});
  await server.listen();
  browser = await chromium.launch({headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    args: ['--enable-webgl', '--ignore-gpu-blocklist']});
  const page = await browser.newPage();
  page.on('pageerror', error => report.errors.push(String(error)));
  page.on('console', message => {if (message.type() === 'error') report.errors.push(message.text());});
  await page.route('**/source-static-atlas-fixture', route => route.fulfill({contentType: 'text/html', body: '<!doctype html><html><body></body></html>'}));
  await page.goto('http://127.0.0.1:7748/source-static-atlas-fixture');
  report.result = await page.evaluate(async ({textureValues, cases, exposure}) => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const {SOURCE_STATIC_ATLAS_GLSL} = await import('/src/source-static-atlas.js');
    const renderer = new THREE.WebGLRenderer(); renderer.setSize(16, 16);
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace; renderer.toneMapping = THREE.NoToneMapping;
    const gl = renderer.getContext(), debug = gl.getExtension('WEBGL_debug_renderer_info');
    const hardware = {vendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
      renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)};
    const textures = textureValues.map(values => {
      const texture = new THREE.DataTexture(new Float32Array(values), 16, 16, THREE.RGBAFormat, THREE.FloatType);
      texture.minFilter = texture.magFilter = THREE.NearestFilter; texture.generateMipmaps = false;
      texture.flipY = false; texture.colorSpace = THREE.NoColorSpace; texture.needsUpdate = true;
      return texture;
    });
    const material = new THREE.ShaderMaterial({
      uniforms: {sourceIrradiance: {value: textures[0]}, sourceR: {value: textures[1]}, sourceG: {value: textures[2]},
        sourceB: {value: textures[3]}, sourceSky: {value: textures[4]}, sourceNormal: {value: new THREE.Vector3()},
        sourceView: {value: new THREE.Vector3(0, 2, 2).normalize()}, sourceSmoothness: {value: 0}, sourcePreExposure: {value: exposure}},
      vertexShader: 'void main(){gl_Position=vec4(position.xy,0.0,1.0);}',
      fragmentShader: `${SOURCE_STATIC_ATLAS_GLSL}
        uniform sampler2D sourceIrradiance, sourceR, sourceG, sourceB, sourceSky;
        uniform vec3 sourceNormal, sourceView; uniform float sourceSmoothness, sourcePreExposure;
        void main(){
          vec2 uv=gl_FragCoord.xy/16.0;
          vec3 r=texture2D(sourceR,uv).rgb*2.0-1.0,g=texture2D(sourceG,uv).rgb*2.0-1.0,b=texture2D(sourceB,uv).rgb*2.0-1.0;
          gl_FragColor=vec4(bf2_staticAtlasPrelighting(texture2D(sourceIrradiance,uv).rgb,r,g,b,
            sourceNormal,sourceView,sourceSmoothness,sourcePreExposure),texture2D(sourceSky,uv).r);
        }`, depthTest: false, depthWrite: false, blending: THREE.NoBlending});
    const target = new THREE.WebGLRenderTarget(16, 16, {type: THREE.FloatType, format: THREE.RGBAFormat});
    const scene = new THREE.Scene(), geometry = new THREE.PlaneGeometry(2, 2);
    scene.add(new THREE.Mesh(geometry, material));
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, 10), outputs = [];
    renderer.setRenderTarget(target);
    for (const fixture of cases) {
      const x = fixture.normalTextureX * 2 - 1, w = fixture.roughnessTextureW;
      material.uniforms.sourceNormal.value.set(x, Math.sqrt(1 - x * x), 0);
      material.uniforms.sourceSmoothness.value = Math.max(0, Math.min(1, (1 + .307 * (1.6 * w - 1)) * .9 + 1.6 * w * .1));
      renderer.render(scene, camera);
      const pixels = new Float32Array(16 * 16 * 4);
      renderer.readRenderTargetPixels(target, 0, 0, 16, 16, pixels);
      outputs.push({index: fixture.index, pixels: Array.from(pixels)});
    }
    const programs = renderer.info.programs.map(program => ({linked: gl.getProgramParameter(program.program, gl.LINK_STATUS)}));
    const glError = gl.getError();
    target.dispose(); material.dispose(); geometry.dispose(); textures.forEach(texture => texture.dispose()); renderer.dispose();
    return {hardware, outputs, programs, glError};
  }, {textureValues, cases: execution.cases, exposure: execution.exposureMultipliers.cb2_41_y});
  report.nativeExecution = execution;
  report.cases = []; report.maximumAbsoluteError = 0; report.maximumNormalizedError = 0; report.samples = 0;
  for (const output of report.result.outputs) {
    const nativeBytes = await read(`native-case${output.index}-mrt3.rgba32f.bin`);
    assert.equal(createHash('sha256').update(nativeBytes).digest('hex'), expected.cases[output.index].nativePayloadSha256);
    const native = await floats(`native-case${output.index}-mrt3.rgba32f.bin`);
    const native2 = await floats(`native-case${output.index}-mrt2.rgba32f.bin`);
    const row = {index: output.index, maximumAbsoluteError: 0, maximumNormalizedError: 0, skyExactScalars: 0};
    for (let pixel = 0; pixel < 256; pixel++) {
      for (let channel = 0; channel < 3; channel++) {
        const i = pixel * 4 + channel, value = output.pixels[i], absolute = Math.abs(value - native[i]);
        const normalized = absolute / Math.max(1, Math.abs(native[i]));
        row.maximumAbsoluteError = Math.max(row.maximumAbsoluteError, absolute);
        row.maximumNormalizedError = Math.max(row.maximumNormalizedError, normalized);
        assert.ok(Number.isFinite(value) && normalized < 1e-4, `case ${output.index} pixel ${pixel} channel ${channel}: ${value} versus native ${native[i]}`);
      }
      assert.equal(output.pixels[pixel * 4 + 3], native2[pixel * 4 + 3]);
      row.skyExactScalars++; report.samples++;
    }
    report.maximumAbsoluteError = Math.max(report.maximumAbsoluteError, row.maximumAbsoluteError);
    report.maximumNormalizedError = Math.max(report.maximumNormalizedError, row.maximumNormalizedError);
    report.cases.push(row);
  }
  assert.equal(report.samples, 2304); assert.equal(report.result.glError, 0);
  assert.ok(report.result.programs.every(program => program.linked)); assert.deepEqual(report.errors, []);
  report.pass = true;
} catch (error) {
  report.pass = false; report.errors.push(String(error.stack ?? error)); process.exitCode = 1;
} finally {
  await browser?.close(); await server?.close();
  await fs.mkdir(path.join(root, 'test-results'), {recursive: true});
  await fs.writeFile(path.join(root, 'test-results/source-static-atlas-gpu-check.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({pass: report.pass, hardware: report.result?.hardware, samples: report.samples,
    maximumAbsoluteError: report.maximumAbsoluteError, maximumNormalizedError: report.maximumNormalizedError, errors: report.errors}, null, 2));
}
