// Pure helpers for the recovered native method-1 MipAverage branch.
// See tools/materials/native-exposure-analysis.md for original producer/PS evidence.
export const NATIVE_METER_POLICY = Object.freeze({
  evidenceId: 'BF2-NATIVE-EXPOSURE-WARP-001',
  observed: 'Original fallback four-point and fast one-bilinear VS/PS paths, clamp addressing, format shader-sample capability dispatch, crop, fixed reduction dimensions, log-alpha and exp readback.',
  limitations: 'Native global defaults are a browser baseline policy, not a captured user configuration. Browser scheduling and initial snap are reconstructed; native readback ring and view spot-scale limit are not reproduced.',
});

export const NATIVE_METER_BASELINE = Object.freeze({
  method: 1, logarithmic: true, fast: true, spotOffset: Object.freeze([0,0]),
  lowerThreshold: 0, higherThreshold: 0, viewSpotScaleLimit: 1,
  policy: 'Native constructors and installed startup scripts; no captured user overrides. Fast enabled for sampleable RGBA16F, corresponding to native D3D11 shader-sample capability.',
});

export function nativeMeterSpotRectangle(width, height, scale, offset = [0, 0]) {
  scale = Math.max(Math.fround(.02), Math.min(1, scale));
  if (scale === 1) return [0, 0, 1, 1];
  const halfW = width * .5, halfH = height * .5, radius = Math.min(halfW, halfH) * scale;
  const marginX = halfW - radius, marginY = halfH - radius;
  const shiftX = Math.max(-marginX, Math.min(marginX, halfW * offset[0]));
  const shiftY = Math.max(-marginY, Math.min(marginY, halfH * offset[1]));
  return [(marginX + shiftX) / width, (marginY + shiftY) / height,
    (halfW + radius + shiftX) / width, (halfH + radius + shiftY) / height];
}

export function nativeMeterPassPlan(sourceWidth, logAverage) {
  const passes = [];
  let width = sourceWidth === 1 ? 1 : 512, height = sourceWidth === 1 ? 1 : 256;
  while (width !== 1) {
    width = Math.max(1, width >> 1); height = Math.max(1, height >> 1);
    passes.push({width, height, logarithmic: passes.length === 0 && logAverage});
  }
  passes.push({width: 1, height: 1, logarithmic: passes.length === 0 && logAverage});
  return passes;
}

export function nativeMeterFourSamples(samples, {logarithmic, scale, maxClamp}) {
  const rgba = Array.from({length: 4}, (_, c) => samples.reduce((v, t) => v + t[c], 0) * .25);
  return nativeMeterSample(rgba, {logarithmic, scale, maxClamp});
}

export function nativeMeterSample(rgba, {logarithmic, scale, maxClamp}) {
  if (!logarithmic) return rgba.map(v => v * scale);
  const rgb = rgba.slice(0, 3).map(v => Math.max(0, Math.min(maxClamp, v)));
  const weights = [.3, .59, .11].map(v => Math.fround(Math.fround(v) * scale));
  return [...rgb, Math.log(rgb.reduce((v, c, i) => v + c * weights[i], 0) + Math.fround(.00001))];
}

export function decodeNativeMeterPixel(rgba, logarithmic, method = 1, inverseExposure = 1) {
  if (method === 1 && logarithmic) return Math.exp(rgba[3]);
  const luminance = rgba[0] * Math.fround(.3) + rgba[1] * Math.fround(.59) + rgba[2] * Math.fround(.11);
  if (method === 1) return luminance;
  if (method === 2) return luminance * inverseExposure;
  throw new Error('Histogram/disabled metering does not use this pixel decoder');
}

export const NATIVE_METER_FRAGMENT_GLSL = `
uniform sampler2D source;
uniform vec2 inverseDestinationSize;
uniform vec4 meterRectangle;
uniform float meterScale;
uniform vec3 maxClampColor;
uniform bool logarithmic;
uniform bool fastPath;
varying vec2 screenUv;
void main() {
  vec2 uv = mix(meterRectangle.xy, meterRectangle.zw, screenUv);
  vec2 d = inverseDestinationSize * .5;
  vec4 value;
  if (fastPath) {
    value = texture2D(source, uv);
  } else {
    value = texture2D(source, uv + vec2(-d.x,-d.y));
    value += texture2D(source, uv + vec2(-d.x,d.y));
    value += texture2D(source, uv + vec2(d.x,d.y));
    value += texture2D(source, uv + vec2(d.x,-d.y));
    value *= .25;
  }
  if (logarithmic) {
    vec3 rgb = clamp(value.rgb, vec3(0.0), maxClampColor);
    gl_FragColor = vec4(rgb, log(dot(rgb, vec3(.30,.59,.11) * meterScale) + .00001));
  } else {
    gl_FragColor = value * meterScale;
  }
}`;
