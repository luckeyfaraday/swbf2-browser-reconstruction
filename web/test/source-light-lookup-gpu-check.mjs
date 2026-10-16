// Isolated arithmetic/render fixture. Original source bytes, same hardware
// sampler, separate textures versus losslessly packed channels. No game frame.
import {createServer} from 'vite';
import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const report = {kind: 'source-light-lookup-packed-gpu', errors: [], nativeGameCapture: false};
let server, browser;
try {
  server = await createServer({root, server: {host: '127.0.0.1', port: 7747, strictPort: true, watch: null, hmr: false}, logLevel: 'warn'});
  await server.listen();
  browser = await chromium.launch({headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--enable-webgl', '--ignore-gpu-blocklist']});
  const page = await browser.newPage();
  page.on('pageerror', e => report.errors.push(String(e)));
  page.on('console', m => {if (m.type() === 'error') report.errors.push(m.text());});
  await page.route('**/source-light-lookup-fixture', r => r.fulfill({contentType: 'text/html', body: '<!doctype html><html><body></body></html>'}));
  await page.goto('http://127.0.0.1:7747/source-light-lookup-fixture');
  report.result = await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const {createSourceDfgTexture, packSourceIesIntoDfg, SOURCE_DFG_GLSL} = await import('/src/source-dfg.js');
    const {loadSourceIes} = await import('/src/source-ies.js');
    const {createSourceDirectAdapter} = await import('/src/source-direct-adapter.js');
    const {createSourceLightChannels} = await import('/src/source-light-channels.js');
    const {sourcePunctualDistanceAttenuation, sourcePunctualAngleAttenuation, sourcePunctualBrdf, sourceIesUv, sourcePunctualConeParameters} = await import('/src/source-direct-light.js');
    const document = await fetch('/assets/source-dfg.json').then(r => r.json());
    const payload = await fetch(document.url).then(r => r.arrayBuffer());
    const original = createSourceDfgTexture(document, payload.slice(0));
    const packed = createSourceDfgTexture(document, payload.slice(0)), ies = await loadSourceIes();
    packSourceIesIntoDfg(packed, ies.texture);
    const renderer = new THREE.WebGLRenderer(); renderer.setSize(256, 128);
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace; renderer.toneMapping = THREE.NoToneMapping;
    const gl = renderer.getContext(), debug = gl.getExtension('WEBGL_debug_renderer_info');
    const hardware = {vendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
      renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      maxFragmentTextureUnits: gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS)};
    const samplerPrograms = () => renderer.info.programs.map(p => {
      const samplers = [];
      for (let i = 0; i < gl.getProgramParameter(p.program, gl.ACTIVE_UNIFORMS); i++) {
        const info = gl.getActiveUniform(p.program, i);
        if ([gl.SAMPLER_2D, gl.SAMPLER_CUBE, gl.SAMPLER_3D, gl.SAMPLER_2D_ARRAY, gl.INT_SAMPLER_2D, gl.UNSIGNED_INT_SAMPLER_2D].includes(info.type)) samplers.push({name: info.name, size: info.size});
      }
      return {linked: gl.getProgramParameter(p.program, gl.LINK_STATUS), samplers};
    });
    // The reference explicitly retains the PRE-PACKING DFG clamp convention,
    // rather than reusing the modified helper under test.
    const referenceGLSL = `uniform sampler2D referenceDfg, referenceIes;
      vec3 originalDFG(float nv,float r){r=clamp(r,0.0,1.0);return texture2D(referenceDfg,vec2(clamp(nv,0.0,1.0),r*r)).rgb;}`;
    const cases = [], kinds = [];
    const add = (kind, x, r, u, v) => {cases.push(x, r, u, v); kinds.push(kind);};
    for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) add('texel-center', (x + .5) / 128, Math.sqrt((y + .5) / 128), (x + .5) / 128, (y + .5) / 128);
    const bounds = [-10, -2, -1, -1e-7, 0, 1e-7, .5 / 128 - 1e-7, .5 / 128, .5 / 128 + 1e-7, .5,
      127.5 / 128 - 1e-7, 127.5 / 128, 127.5 / 128 + 1e-7, 1 - 1e-7, 1, 1 + 1e-7, 2, 10];
    for (const x of bounds) for (const y of bounds) add('boundary', x, y, x, y);
    let seed = 0x715eaba1;
    const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
    for (let i = 0; i < 4096; i++) add('random', random() * 3 - 1, random() * 3 - 1, random() * 12 - 6, random() * 3 - 1);
    const periodicPairs = [];
    for (let i = 0; i < 256; i++) {
      // Exact binary fractions make input rounding identical under whole wraps.
      const u = Math.floor(random() * 16384) / 16384, v = Math.floor(random() * 16384) / 16384;
      periodicPairs.push([kinds.length, kinds.length + 1]);
      add('periodicity', .37, .43, u, v); add('periodicity', .37, .43, u + 3, v);
    }
    const width = 256, height = Math.ceil(kinds.length / width), words = new Float32Array(width * height * 4); words.set(cases);
    const inputs = new THREE.DataTexture(words, width, height, THREE.RGBAFormat, THREE.FloatType);
    inputs.minFilter = inputs.magFilter = THREE.NearestFilter; inputs.generateMipmaps = false; inputs.needsUpdate = true;
    const target = new THREE.WebGLRenderTarget(width, height, {type: THREE.FloatType, format: THREE.RGBAFormat});
    const scene = new THREE.Scene(), camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, 10), geometry = new THREE.PlaneGeometry(2, 2);
    const make = combined => new THREE.ShaderMaterial({
      uniforms: {fixtureInputs: {value: inputs}, fixtureSize: {value: new THREE.Vector2(width, height)},
        ...(combined ? {bf2_sourceDFG: {value: packed}} : {referenceDfg: {value: original}, referenceIes: {value: ies.texture}})},
      vertexShader: 'void main(){gl_Position=vec4(position.xy,0.0,1.0);}',
      fragmentShader: `${combined ? SOURCE_DFG_GLSL : referenceGLSL}
        uniform sampler2D fixtureInputs;uniform vec2 fixtureSize;
        void main(){vec4 c=texture2D(fixtureInputs,gl_FragCoord.xy/fixtureSize);
          gl_FragColor=vec4(${combined ? 'bf2_sampleSourceDFG(c.x,c.y),texture2D(bf2_sourceDFG,c.zw).a' : 'originalDFG(c.x,c.y),texture2D(referenceIes,c.zw).r'});}`,
      depthTest: false, depthWrite: false, blending: THREE.NoBlending});
    const separateMaterial = make(false), packedMaterial = make(true), quad = new THREE.Mesh(geometry, separateMaterial); scene.add(quad);
    renderer.setRenderTarget(target); renderer.render(scene, camera);
    const separateValues = new Float32Array(width * height * 4), packedValues = new Float32Array(width * height * 4);
    renderer.readRenderTargetPixels(target, 0, 0, width, height, separateValues);
    quad.material = packedMaterial; renderer.render(scene, camera); renderer.readRenderTargetPixels(target, 0, 0, width, height, packedValues);
    const lookupPrograms = samplerPrograms();
    // Independent bilinear CPU reference. Report ideal filtering residuals as
    // well as same-GPU equivalence; hardware texture weights may be quantized.
    function bilinear(texture, u, v, channel, stride, repeatX) {
      u = repeatX ? u - Math.floor(u) : Math.max(0, Math.min(1, u)); v = Math.max(0, Math.min(1, v));
      const x = u * 128 - .5, y = v * 128 - .5, ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
      const at = (a, b) => THREE.DataUtils.fromHalfFloat(texture.image.data[(Math.max(0, Math.min(127, b)) * 128 + (repeatX ? (a % 128 + 128) % 128 : Math.max(0, Math.min(127, a)))) * stride + channel]);
      const a = at(ix, iy), b = at(ix + 1, iy), c = at(ix, iy + 1), d = at(ix + 1, iy + 1);
      return {value: (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy,
        filterWeightBound: (Math.max(Math.abs(a - b), Math.abs(c - d)) + Math.max(Math.abs(a - c), Math.abs(b - d))) / 256 + 2e-6};
    }
    const lookup = {cases: kinds.length, seed: '0x715eaba1', counts: {}, maxPackedVsSeparate: [0, 0, 0, 0], maxIdealCpuError: [0, 0, 0, 0],
      bitIdenticalScalars: 0, totalScalars: kinds.length * 4, mismatches: [], cpuOutOfFilterBounds: [], maxPeriodicityError: 0, texelCenterAlphaMaxError: 0, programs: lookupPrograms};
    for (let i = 0; i < kinds.length; i++) {
      lookup.counts[kinds[i]] = (lookup.counts[kinds[i]] ?? 0) + 1;
      const offset = i * 4, c = Array.from(words.subarray(offset, offset + 4));
      const roughness = Math.max(0, Math.min(1, c[1])), squared = Math.fround(roughness * roughness);
      for (let channel = 0; channel < 4; channel++) {
        const a = separateValues[offset + channel], b = packedValues[offset + channel], error = Math.abs(a - b);
        lookup.maxPackedVsSeparate[channel] = Math.max(lookup.maxPackedVsSeparate[channel], error);
        if (Object.is(a, b)) lookup.bitIdenticalScalars++;
        if ((!Number.isFinite(b) || error > 1e-6) && lookup.mismatches.length < 32) lookup.mismatches.push({i, kind: kinds[i], c, channel, separate: a, packed: b});
        const cpu = channel < 3 ? bilinear(original, c[0], squared, channel, 4, false) : bilinear(ies.texture, c[2], c[3], 0, 1, true);
        const residual = Math.abs(b - cpu.value); lookup.maxIdealCpuError[channel] = Math.max(lookup.maxIdealCpuError[channel], residual);
        if (residual > cpu.filterWeightBound && lookup.cpuOutOfFilterBounds.length < 32) lookup.cpuOutOfFilterBounds.push({i, kind: kinds[i], c, channel, packed: b, ...cpu, residual});
        if (kinds[i] === 'texel-center' && channel === 3) lookup.texelCenterAlphaMaxError = Math.max(lookup.texelCenterAlphaMaxError, residual);
      }
    }
    for (const [a, b] of periodicPairs) lookup.maxPeriodicityError = Math.max(lookup.maxPeriodicityError, Math.abs(packedValues[a * 4 + 3] - packedValues[b * 4 + 3]));
    // Validate the ACTUAL source helper's UV calculations separately from
    // unknown hardware interpolation precision. This test-only instrumentation
    // changes only its final texture fetch into an output of the computed UV.
    const fetchExpression = 'return texture2D(bf2_sourceDFG, uv).rgb;';
    if (!SOURCE_DFG_GLSL.includes(fetchExpression)) throw Error('DFG lookup instrumentation needs review after source helper changed');
    const coordinateMaterial = new THREE.ShaderMaterial({
      uniforms: {fixtureInputs: {value: inputs}, fixtureSize: {value: new THREE.Vector2(width, height)}},
      vertexShader: 'void main(){gl_Position=vec4(position.xy,0.0,1.0);}',
      fragmentShader: `${SOURCE_DFG_GLSL.replace(fetchExpression, 'return vec3(uv,0.0);')}
        uniform sampler2D fixtureInputs;uniform vec2 fixtureSize;
        void main(){vec4 c=texture2D(fixtureInputs,gl_FragCoord.xy/fixtureSize);gl_FragColor=vec4(bf2_sampleSourceDFG(c.x,c.y).xy,fract(c.z),clamp(c.w,0.0,1.0));}`,
      depthTest: false, depthWrite: false, blending: THREE.NoBlending});
    quad.material = coordinateMaterial; renderer.render(scene, camera);
    const coordinateValues = new Float32Array(width * height * 4); renderer.readRenderTargetPixels(target, 0, 0, width, height, coordinateValues);
    lookup.maxCoordinateError = [0, 0, 0, 0];
    for (let i = 0; i < kinds.length; i++) {
      const at = i * 4, r = Math.max(0, Math.min(1, words[at + 1]));
      const expected = [Math.max(.5 / 128, Math.min(127.5 / 128, words[at])),
        Math.max(.5 / 128, Math.min(127.5 / 128, Math.fround(r * r))),
        Math.fround(words[at + 2] - Math.floor(words[at + 2])), Math.max(0, Math.min(1, words[at + 3]))];
      expected.forEach((v, channel) => {lookup.maxCoordinateError[channel] = Math.max(lookup.maxCoordinateError[channel], Math.abs(v - coordinateValues[at + channel]));});
    }
    lookup.cpuReferencePolicy = 'Ideal CPU bilinear residuals are diagnostic only; hardware interpolation precision is not assumed. Coordinate calculations, texel centers, repeat periodicity and packed-versus-original GPU equality are asserted separately.';
    coordinateMaterial.dispose();
    separateMaterial.dispose(); packedMaterial.dispose(); geometry.dispose(); inputs.dispose(); target.dispose();

    // Same 432 independently expected punctual-light cases as native-direct-check,
    // now routing IES through source DFG alpha and inspecting active samplers.
    const directScene = new THREE.Scene(), directCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, 20);
    const base = [.3, .25, .2], color = [.5, .7, .9], position = [.4, .6, 3];
    const material = new THREE.MeshStandardMaterial({color: new THREE.Color(...base), roughness: .4, metalness: 0});
    material.userData.recoveredMaster1UVShader = {};
    // Exercise the existing-DFG-declaration path as the real source material does.
    material.onBeforeCompile = shader => {shader.fragmentShader = SOURCE_DFG_GLSL + shader.fragmentShader; shader.uniforms.bf2_sourceDFG = {value: packed};};
    const directGeometry = new THREE.PlaneGeometry(2, 2); directScene.add(new THREE.Mesh(directGeometry, material));
    const point = new THREE.PointLight(new THREE.Color(...color), 1); point.position.fromArray(position); directScene.add(point);
    const spot = new THREE.SpotLight(new THREE.Color(...color), 1); spot.position.fromArray(position); directScene.add(spot, spot.target);
    const direct = createSourceDirectAdapter({...ies, combinedDfgTexture: packed}, 1, 1);
    const channels = createSourceLightChannels(1, 1, {nativeDirect: direct}); channels.decorate(directScene);
    const pixelTarget = new THREE.WebGLRenderTarget(1, 1, {type: THREE.FloatType}); renderer.setRenderTarget(pixelTarget);
    const rows = [];
    for (const cameraPosition of [[0, 0, 5], [3, 2, 5], [-2, 3, 4]]) for (const type of ['point', 'spot']) for (const useIes of [false, true])
      for (const roughness of [.05, .4, .9]) for (const metalness of [0, .6, 1]) for (const flags of [[true, true], [true, false], [false, true], [false, false]]) {
        directCamera.position.fromArray(cameraPosition); directCamera.lookAt(0, 0, 0); directCamera.updateMatrixWorld();
        point.intensity = type === 'point' ? 1 : 0; spot.intensity = type === 'spot' ? 1 : 0;
        material.roughness = roughness; material.metalness = metalness;
        const angle = .4, forward = [Math.sin(angle), 0, Math.cos(angle)], left = [Math.cos(angle), 0, -Math.sin(angle)], up = [0, 1, 0];
        const cone = type === 'point' ? {scale: 1, offset: 2} : sourcePunctualConeParameters(20, 60);
        const record = {id: 'fixture', inverseRadiusSquared: .01, attenuationOffset: 1, cone, matrixLeft: left, matrixUp: up, matrixForward: forward, ies: useIes ? {} : null};
        channels.set(type, 0, {nativeDirect: record, affectDiffuse: flags[0], affectSpecular: flags[1]}); channels.set(type === 'point' ? 'spot' : 'point', 0, null);
        renderer.render(directScene, directCamera); const pixels = new Float32Array(4); renderer.readRenderTargetPixels(pixelTarget, 0, 0, 1, 1, pixels);
        const L = new THREE.Vector3(...position).normalize(), V = new THREE.Vector3(...cameraPosition).normalize(), H = L.clone().add(V).normalize(), N = new THREE.Vector3(0, 0, 1);
        const response = sourcePunctualBrdf({baseColor: base, metalness, roughness, dotNV: N.dot(V), dotNL: N.dot(L), dotNH: N.dot(H), dotLH: L.dot(H)});
        let attenuation = sourcePunctualDistanceAttenuation(position.reduce((s, v) => s + v * v, 0), .01, 1) * sourcePunctualAngleAttenuation(new THREE.Vector3(...forward).dot(L), cone.scale, cone.offset);
        if (useIes) {const uv = sourceIesUv([left, up, forward].map(axis => -new THREE.Vector3(...axis).dot(L))); attenuation *= bilinear(ies.texture, uv[0], uv[1], 0, 1, true).value;}
        const cpu = color.map((c, i) => c * attenuation * N.dot(L) * (response.diffuse[i] * (flags[0] ? 1 : 0) + response.specular[i] * (flags[1] ? 1 : 0)));
        rows.push({cameraPosition, type, useIes, roughness, metalness, flags, cpu, gpu: Array.from(pixels).slice(0, 3)});
      }
    const punctual = {rows, programs: samplerPrograms(), diagnostics: direct.snapshot()};
    const glError = gl.getError();
    pixelTarget.dispose(); material.dispose(); directGeometry.dispose(); original.dispose(); packed.dispose(); ies.dispose(); renderer.dispose();
    return {hardware, lookup, punctual, glError};
  });
  const {lookup, punctual} = report.result;
  assert.equal(report.result.glError, 0);
  assert.equal(lookup.counts['texel-center'], 16384);
  assert.equal(lookup.counts.random, 4096);
  assert.deepEqual(lookup.mismatches, [], 'packed lookup must equal same-hardware separate textures');
  assert.ok(lookup.maxCoordinateError.every(e => e <= 1e-7), 'actual DFG squared-roughness/clamp and IES coordinate domains');
  assert.equal(lookup.texelCenterAlphaMaxError, 0, 'every source IES texel exact');
  assert.equal(lookup.maxPeriodicityError, 0, 'IES Repeat-U remains periodic');
  assert.ok(lookup.programs.every(p => p.linked));
  assert.deepEqual(lookup.programs.map(p => p.samplers.length).sort(), [2, 3], 'one fixture sampler plus 1 packed or 2 original source samplers');
  assert.equal(punctual.rows.length, 432);
  report.punctualMaxError = 0;
  for (const row of punctual.rows) for (let i = 0; i < 3; i++) {
    const error = Math.abs(row.cpu[i] - row.gpu[i]); report.punctualMaxError = Math.max(report.punctualMaxError, error);
    assert.ok(Number.isFinite(row.gpu[i]) && error < .00003, `Packed punctual mismatch ${JSON.stringify(row)} channel ${i}`);
  }
  assert.ok(punctual.diagnostics.combinedLookup);
  assert.ok(punctual.programs.every(p => p.linked && p.samplers.filter(s => s.name.startsWith('bf2_source')).length === 1 && !p.samplers.some(s => s.name === 'bf2_sourceIes')));
  assert.deepEqual(report.errors, []); report.pass = true;
} catch (error) {
  report.pass = false; report.errors.push(String(error.stack ?? error)); process.exitCode = 1;
} finally {
  await browser?.close(); await server?.close();
  await fs.mkdir(path.join(root, 'test-results'), {recursive: true});
  await fs.writeFile(path.join(root, 'test-results/source-light-lookup-gpu-check.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({pass: report.pass, hardware: report.result?.hardware, cases: report.result?.lookup.cases,
    lookupMaxError: report.result?.lookup.maxPackedVsSeparate, cpuFilterMaxError: report.result?.lookup.maxIdealCpuError,
    punctualCases: report.result?.punctual.rows.length, punctualMaxError: report.punctualMaxError, errors: report.errors}, null, 2));
}
