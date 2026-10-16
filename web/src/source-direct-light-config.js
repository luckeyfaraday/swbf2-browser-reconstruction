// Native EBX -> dynamic state -> renderer record recovery. No renderer hooks.
export const SOURCE_DIRECT_CONFIG_POLICY = Object.freeze({
  evidenceId: 'BF2-NATIVE-DIRECT-PRODUCER-002',
  scope: 'Exported initial sphere/spot fields, native punctual classification and pre-view radiometric color.',
  limitations: [
    'No native frame was captured. Entity activation and later connections are not simulated.',
    'Property-override-capable descriptors are excluded by default; allowing them explicitly uses exported fallback values.',
    'Per-view screen/distance fades, native selection/order, global specular enable and shadow quality are not reconstructed.',
    'Finite-area, hemisphere-only, nonzero exposure-compensation and shadow-enabled lights remain on the caller fallback.',
    'IES texels and color conversion are exact source data; native sampler V addressing remains inferred by source-ies.js.',
  ],
});

const f = Math.fround;
const mul = (a, b) => f(f(a) * f(b));
const PI = f(Math.PI);
const EPS = f(.001);
const TYPE = /Pbr(Sphere|Spot)LightEntityData$/;
const unitValue = p => p.LightUnit?.value;
const shapeName = p => TYPE.exec(p.$type ?? '')?.[1]?.toLowerCase();
const finite = values => values.every(Number.isFinite);

/** Matches the existing adapter's identity, including repeated blueprint instances. */
export function sourceDirectLightId(source) {
  return `${source.fileGuid}/${source.classGuid}/${source.route}`;
}

/** Native 0x140f8ce10 is evaluated BEFORE the IES path forces unit=Luminance.
 * A zero radius with Luminance is an area emitter, clamped to radius .01. */
export function sourceDirectEmitter(properties) {
  const shape = shapeName(properties);
  if (!shape) return null;
  const sourceRadius = f(shape === 'sphere' ? properties.SphereRadius : properties.DiscRadius);
  const unit = unitValue(properties);
  if (!Number.isFinite(sourceRadius) || ![0, 1].includes(unit)) return null;
  const punctual = sourceRadius === 0 && unit !== 1;
  const radius = punctual ? sourceRadius : Math.max(sourceRadius, f(.01));
  const area = punctual ? (shape === 'sphere' ? 4 : 1)
    : mul(mul(radius, shape === 'sphere' ? f(4 * Math.PI) : PI), radius);
  return {shape, sourceRadius, radius, punctual, sourceUnit: unit, area};
}

/** CPU producer clamps full source angles before the BaseLightInfo cosine ramp.
 * Inner uses the ORIGINAL outer angle, not its separately clamped value. */
export function sourceDirectCone(innerDegrees, outerDegrees) {
  const inner = Math.min(f(innerDegrees), f(f(outerDegrees) - EPS));
  const outer = Math.min(179, Math.max(1, f(outerDegrees)));
  const cosine = angle => f(Math.cos(mul(mul(mul(angle, .5), PI), f(1 / 180))));
  const cosOuter = cosine(outer);
  const scale = f(1 / Math.max(f(cosine(inner) - cosOuter), EPS));
  return {innerDegrees: inner, outerDegrees: outer, scale, offset: -mul(cosOuter, scale)};
}

/** Returns the source runtime record RGB BEFORE view fade/exposure compensation.
 * iesHeader is validated separately against the source resource association. */
export function sourceDirectRadiometry(properties, emitter, iesHeader = null, intensityMultiplier = 1) {
  let scalar = mul(properties.Intensity, intensityMultiplier);
  let effectiveUnit = emitter.sourceUnit;
  if (iesHeader) {
    scalar = properties.UseIESProfileAsMask
      ? f(mul(scalar, iesHeader.offset4) / f(iesHeader.offset8))
      : mul(iesHeader.offset4, properties.IESMultiplier);
    effectiveUnit = 1;
  }
  if (effectiveUnit !== 1) scalar = f(scalar / mul(emitter.area, PI));
  const color = [properties.Color.x, properties.Color.y, properties.Color.z]
    .map(value => mul(mul(value, scalar), properties.Dimmer));
  return {color, scalar, effectiveUnit};
}

/** Produces a descriptor only for a recovered subset. The caller keeps all
 * rejected source descriptors on its explicit approximation path. Source matrix
 * columns are copied unchanged; convert position AND all three axes together. */
export function sourcePunctualLightConfig(source, iesDocument = null, {allowPropertyOverrides = false} = {}) {
  const p = source.properties ?? {}, id = sourceDirectLightId(source);
  const reject = reason => ({id, supported: false, reason});
  const emitter = sourceDirectEmitter(p);
  if (!emitter) return reject('unsupported-shape-or-unit');
  if (!emitter.punctual) return reject('finite-area-emitter');
  if (p.Enabled !== true) return reject('disabled-or-unresolved-activation');
  if (p.OnlyHempishere === true) return reject('hemisphere-only-emitter');
  if (p.CastShadows?.value !== 5 && p.CastShadowsEnable !== false) return reject('shadow-quality-unresolved');
  if (p.ExposureCompensation !== 0) return reject('exposure-compensation-unresolved');
  if (!Number.isInteger(p.Flags)) return reject('missing-property-override-flags');
  const propertyOverrideMask = (p.Flags >>> 27) & 3;
  if (!allowPropertyOverrides && propertyOverrideMask) return reject('property-overrides-unresolved');
  const m = source.matrix;
  if (!Array.isArray(m) || m.length !== 16 || !finite(m)) return reject('invalid-transform');
  if (!p.Color || !finite([p.Color.x, p.Color.y, p.Color.z, p.Intensity, p.Dimmer,
    p.AttenuationRadius, p.AttenuationOffset]) || !(p.AttenuationRadius > 0)) return reject('invalid-photometric-fields');
  // Dynamic constructors set IntensityMultiplier=1 and IsEnabled=true. Native
  // gathering tests the RGB SUM (the executable coefficients are all 1), not
  // a perceptual luminance, before the IES conversion can replace Intensity.
  const signal = mul(mul(f(f(p.Color.x) + f(p.Color.y) + f(p.Color.z)), p.Intensity), p.Dimmer);
  if (!(signal >= f(.00001))) return reject('native-intensity-gate');
  if (p.AffectDiffuse === false && p.AffectSpecular === false) return reject('no-direct-contribution');
  let ies = null;
  if (p.IESProfile) {
    const ref = p.IESProfile, header = iesDocument?.sourceHeaderScalars;
    if (ref.$external !== iesDocument?.sourceAsset?.guid
      || ref.classGuid !== iesDocument?.sourceClassGuid
      || !header || !finite([header.offset4, header.offset8, p.IESMultiplier]) || !(header.offset8 > 0)) {
      return reject('ies-resource-not-associated');
    }
    ies = {resourceId: iesDocument.sourceResourceId, payloadSha256: iesDocument.payloadSha256,
      url: iesDocument.url, header, multiplier: p.IESMultiplier, asMask: !!p.UseIESProfileAsMask};
  }
  const cone = emitter.shape === 'spot' ? sourceDirectCone(p.InnerAngle, p.OuterAngle)
    : {innerDegrees: null, outerDegrees: null, scale: 1, offset: 2};
  if (!finite([cone.scale, cone.offset])) return reject('invalid-cone');
  const radiometry = sourceDirectRadiometry(p, emitter, ies?.header);
  return {
    id, supported: true, type: emitter.shape === 'spot' ? 'spot' : 'point',
    source: {asset: source.asset, fileGuid: source.fileGuid, classGuid: source.classGuid, route: source.route},
    position: m.slice(12, 15),
    matrixLeft: m.slice(0, 3), matrixUp: m.slice(4, 7), matrixForward: m.slice(8, 11),
    color: radiometry.color, intensity: 1, // RGB already contains all intensity/Dimmer/IES-header factors.
    range: f(p.AttenuationRadius), inverseRadiusSquared: f(1 / mul(p.AttenuationRadius, p.AttenuationRadius)),
    attenuationOffset: f(p.AttenuationOffset), cone, ies, emitter,
    affectDiffuse: p.AffectDiffuse !== false, affectSpecular: p.AffectSpecular !== false,
    propertyOverrideMask, intensityMultiplier: 1,
    viewFadeSource: {cullScreenArea: p.CullScreenArea, fadeScreenArea: p.FadeScreenArea,
      cullDistance: p.CullDistance, fadeDistance: p.FadeDistance},
    evidenceId: SOURCE_DIRECT_CONFIG_POLICY.evidenceId,
  };
}

export function prepareSourcePunctualLights(document, iesDocument, options) {
  const lights = [], excluded = [];
  for (const source of document.lights ?? []) {
    const record = sourcePunctualLightConfig(source, iesDocument, options);
    (record.supported ? lights : excluded).push(record);
  }
  return {lights, excluded, policy: SOURCE_DIRECT_CONFIG_POLICY};
}
