// Full original BC6H/BC7 textures versus losslessly packed RGBA32F chart array.
import {createServer} from 'vite';
import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const report = {kind: 'original-static-atlas-packing-gpu', nativeGameCapture: false, errors: []};
let server, browser;
try {
  const document = JSON.parse(await fs.readFile(path.join(root, 'public/assets/lighting/static-atlas-floor.json'), 'utf8'));
  const sourceTextures = new Map();
  for (const row of document.textures) {
    const bytes = await fs.readFile(path.resolve(root, '../exports/lighting/static-atlas-chunks', row.chunkGuid + '.chunk'));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), row.sourceChunkSha256);
    sourceTextures.set(row.sourceField, bytes);
  }
  const bounds = new Map();
  for (const row of document.uv.records) {
    const old = bounds.get(row.assetId) ?? [[Infinity, Infinity], [-Infinity, -Infinity]];
    for (let axis = 0; axis < 2; axis++) {
      old[0][axis] = Math.min(old[0][axis], row.uvBounds[0][axis]);
      old[1][axis] = Math.max(old[1][axis], row.uvBounds[1][axis]);
    }
    bounds.set(row.assetId, old);
  }
  const instances = new Map(document.instances.map(row => [row.instanceIndex, row]));
  const inputs = [], labels = [];
  let seed = 0x4a71a5;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  for (const chart of document.charts) {
    const instance = instances.get(chart.instances[0]), [low, high] = bounds.get(instance.assetId);
    const samples = [[0, 0], [1, 0], [0, 1], [1, 1], [.5, .5]];
    for (let i = 0; i < 12; i++) samples.push([random(), random()]);
    for (const [x, y] of samples) {
      const u = low[0] + x * (high[0] - low[0]), v = low[1] + y * (high[1] - low[1]);
      const [sx, , , sy, ox, oy] = instance.values;
      inputs.push(Math.fround(u * sx + ox), Math.fround(v * sy + oy),
        chart.packedOrigin[0] - chart.sourceCrop[0], chart.packedOrigin[1] - chart.sourceCrop[1]);
      labels.push({chart: chart.index, uv: [u, v]});
    }
  }
  server = await createServer({root, server: {host: '127.0.0.1', port: 7748, strictPort: true, watch: null, hmr: false}, logLevel: 'warn'});
  await server.listen();
  browser = await chromium.launch({headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    args: ['--enable-webgl', '--ignore-gpu-blocklist']});
  const page = await browser.newPage();
  page.on('pageerror', error => report.errors.push(String(error)));
  page.on('console', message => {if (message.type() === 'error') report.errors.push(message.text());});
  await page.route('**/static-atlas-packing-fixture', route => route.fulfill({contentType: 'text/html', body: '<!doctype html><html><body></body></html>'}));
  await page.route('**/source-native-atlas/*', route => {
    const name = route.request().url().split('/').at(-1), bytes = sourceTextures.get(name);
    if (!bytes) return route.abort();
    return route.fulfill({contentType: 'application/octet-stream', body: bytes});
  });
  await page.goto('http://127.0.0.1:7748/static-atlas-packing-fixture');
  report.result = await page.evaluate(async ({document, inputs, count}) => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const renderer = new THREE.WebGLRenderer(); renderer.setSize(256, 64);
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace; renderer.toneMapping = THREE.NoToneMapping;
    const gl = renderer.getContext(), debug = gl.getExtension('WEBGL_debug_renderer_info');
    if (!gl.getExtension('EXT_texture_compression_bptc')) throw new Error('Original BC6H/BC7 GPU comparison requires BPTC');
    const hardware = {renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)};
    const originals = [];
    for (const row of document.textures) {
      const bytes = new Uint8Array(await fetch('/source-native-atlas/' + row.sourceField).then(response => response.arrayBuffer()));
      const texture = new THREE.CompressedTexture([{data: bytes, width: 5232, height: 4908}], 5232, 4908,
        row.format === 'BC6U_FLOAT' ? THREE.RGB_BPTC_UNSIGNED_Format : THREE.RGBA_BPTC_Format);
      texture.minFilter = texture.magFilter = THREE.LinearFilter; texture.generateMipmaps = false;
      texture.colorSpace = THREE.NoColorSpace; texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping; texture.needsUpdate = true;
      originals.push(texture);
    }
    const [w, h] = document.packedDimensions;
    const packed = new THREE.DataArrayTexture(new Float32Array(await fetch(document.url).then(response => response.arrayBuffer())), w, h, 4);
    packed.type = THREE.FloatType; packed.format = THREE.RGBAFormat; packed.minFilter = packed.magFilter = THREE.LinearFilter;
    packed.generateMipmaps = false; packed.colorSpace = THREE.NoColorSpace; packed.needsUpdate = true;
    // A second candidate preserves original dimensions, compressed formats,
    // filtering, and UV arithmetic; only the four BC7 maps become array layers.
    const arrayBytes = new Uint8Array(4 * 5232 * 4908);
    for (let i = 0; i < 4; i++) arrayBytes.set(originals[i + 1].mipmaps[0].data, i * 5232 * 4908);
    const nativeArray = new THREE.CompressedArrayTexture([{data: arrayBytes, width: 5232, height: 4908}], 5232, 4908, 4, THREE.RGBA_BPTC_Format);
    nativeArray.minFilter = nativeArray.magFilter = THREE.LinearFilter; nativeArray.generateMipmaps = false;
    nativeArray.colorSpace = THREE.NoColorSpace; nativeArray.needsUpdate = true;
    const width = 256, height = Math.ceil(count / width), words = new Float32Array(width * height * 4); words.set(inputs);
    const data = new THREE.DataTexture(words, width, height, THREE.RGBAFormat, THREE.FloatType); data.needsUpdate = true;
    const uniforms = {sourceTexture: {value: null}, skyTexture: {value: originals[4]}, packedTexture: {value: packed},
      sampleInputs: {value: data}, inputSize: {value: new THREE.Vector2(width, height)}, packedSize: {value: new THREE.Vector2(w, h)},
      nativeArray: {value: nativeArray}, useNativeArray: {value: false}, layer: {value: 0}, usePacked: {value: false}, useTexelFetch: {value: false}};
    const material = new THREE.ShaderMaterial({uniforms, depthTest: false, depthWrite: false, blending: THREE.NoBlending,
      vertexShader: 'void main(){gl_Position=vec4(position.xy,0.0,1.0);}',
      fragmentShader: `precision highp sampler2DArray;
        uniform sampler2D sourceTexture,skyTexture,sampleInputs;uniform sampler2DArray packedTexture,nativeArray;
        uniform vec2 inputSize,packedSize;uniform int layer;uniform bool usePacked,useTexelFetch,useNativeArray;
        void main(){vec4 c=texture2D(sampleInputs,gl_FragCoord.xy/inputSize);vec4 value;
          ivec2 nativeTexel=ivec2(floor(c.xy*vec2(5232.0,4908.0)));
          if(usePacked&&useNativeArray){
            vec4 arrayValue=useTexelFetch?texelFetch(nativeArray,ivec3(nativeTexel,layer==0?3:layer-1),0):texture(nativeArray,vec3(c.xy,float(layer==0?3:layer-1)));
            value=layer==0?vec4((useTexelFetch?texelFetch(sourceTexture,nativeTexel,0):texture2D(sourceTexture,c.xy)).rgb,arrayValue.r):vec4(arrayValue.rgb,0.0);
          }else if(usePacked){value=useTexelFetch?texelFetch(packedTexture,ivec3(nativeTexel+ivec2(c.zw),layer),0):texture(packedTexture,vec3((c.xy*vec2(5232.0,4908.0)+c.zw)/packedSize,float(layer)));}
          else{value=useTexelFetch?texelFetch(sourceTexture,nativeTexel,0):texture2D(sourceTexture,c.xy);
            value.a=layer==0?(useTexelFetch?texelFetch(skyTexture,nativeTexel,0).r:texture2D(skyTexture,c.xy).r):0.0;}
          gl_FragColor=value;
        }`});
    const target = new THREE.WebGLRenderTarget(width, height, {type: THREE.FloatType});
    const scene = new THREE.Scene(), geometry = new THREE.PlaneGeometry(2, 2); scene.add(new THREE.Mesh(geometry, material));
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, 10), rows = [];
    renderer.setRenderTarget(target);
    for (const nativeArrayMode of [false, true]) for (const exactTexel of [true, false]) for (let layer = 0; layer < 4; layer++) {
      uniforms.useNativeArray.value = nativeArrayMode;
      uniforms.sourceTexture.value = originals[layer]; uniforms.layer.value = layer; uniforms.useTexelFetch.value = exactTexel;
      const results = [];
      for (const combined of [false, true]) {
        uniforms.usePacked.value = combined; renderer.render(scene, camera);
        const output = new Float32Array(width * height * 4); renderer.readRenderTargetPixels(target, 0, 0, width, height, output); results.push(output);
      }
      let maxAbsolute = 0, maxNormalized = 0, exactScalars = 0, worst = null, nonfinite = 0;
      for (let i = 0; i < count * 4; i++) {
        const original = results[0][i], packed = results[1][i], absolute = Math.abs(original - packed);
        const normalized = absolute / Math.max(1, Math.abs(original));
        if (!Number.isFinite(original) || !Number.isFinite(packed)) nonfinite++;
        if (original === packed) exactScalars++;
        if (normalized > maxNormalized) {maxNormalized = normalized; worst = {sample: Math.floor(i / 4), channel: i % 4, original, packed};}
        maxAbsolute = Math.max(maxAbsolute, absolute);
      }
      rows.push({nativeArrayMode, exactTexel, layer, count, maxAbsolute, maxNormalized, exactScalars, nonfinite, worst});
    }
    const programs = renderer.info.programs.map(program => ({linked: gl.getProgramParameter(program.program, gl.LINK_STATUS)})), glError = gl.getError();
    material.dispose(); target.dispose(); geometry.dispose(); data.dispose(); packed.dispose(); nativeArray.dispose(); originals.forEach(texture => texture.dispose()); renderer.dispose();
    return {hardware, rows, programs, glError};
  }, {document, inputs, count: labels.length});
  for (const row of report.result.rows) if (row.worst) row.worst.input = labels[row.worst.sample];
  assert.equal(report.result.glError, 0); assert.ok(report.result.programs.every(program => program.linked));
  assert.ok(report.result.rows.every(row => row.nonfinite === 0));
  assert.ok(report.result.rows.filter(row => row.exactTexel).every(row => row.maxAbsolute === 0), 'original GPU decode must match every sampled packed float32 lane');
  assert.ok(report.result.rows.filter(row => row.nativeArrayMode).every(row => row.maxAbsolute === 0), 'original compressed array must preserve all filtered and exact samples');
  report.selectedLayout = 'Original-size BC6H irradiance plus original-size BC7 four-layer array; all native UVs and sampler filtering unchanged.';
  report.rejectedLayout = 'Cropped RGBA32F array preserves decoded words but changes hardware filtering. Large HDR boundary residuals prohibit activation.';
  assert.deepEqual(report.errors, []); report.pass = true;
} catch (error) {
  report.pass = false; report.errors.push(String(error.stack ?? error)); process.exitCode = 1;
} finally {
  await browser?.close(); await server?.close();
  await fs.mkdir(path.join(root, 'test-results'), {recursive: true});
  await fs.writeFile(path.join(root, 'test-results/source-static-atlas-packing-gpu-check.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
