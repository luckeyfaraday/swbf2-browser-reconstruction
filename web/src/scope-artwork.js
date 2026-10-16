// BF2-SCOPE-ARTWORK-001. Pure source-artwork adapter; no DOM or game-state edits.
const f = Math.fround;
const number = value => {
  if (!Number.isFinite(value)) throw new Error('Non-finite source scope value');
  return String(value);
};
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const rgb = c => [c.x, c.y, c.z];
const mul = (a, b) => a.map((v, i) => v * b[i]);
const area = corners => corners.reduce((s, c, i) => {
  const next = corners[(i + 1) % corners.length];
  return s + c.Position.x * next.Position.y - next.Position.x * c.Position.y;
}, 0);

/** Authored numbers unchanged. Arc semantics require explicit opt-in. */
export function scopePathData(path, {closed = true, allowInferredCircularArcs = false} = {}) {
  const points = path.Corners;
  if (!points.length) return '';
  const hasArcs = points.some(c => c.Radius !== 0);
  if (hasArcs && !allowInferredCircularArcs) throw new Error('Circular-arc interpretation requires explicit opt-in');
  const sweep = area(points) > 0 ? 1 : 0;
  const segment = c => c.Radius === 0
    ? `L ${number(c.Position.x)} ${number(c.Position.y)}`
    : `A ${number(Math.abs(c.Radius))} ${number(Math.abs(c.Radius))} 0 0 ${sweep} ${number(c.Position.x)} ${number(c.Position.y)}`;
  return `M ${number(points[0].Position.x)} ${number(points[0].Position.y)} `
    + points.slice(1).map(segment).join(' ') + (closed ? ` ${segment(points[0])} Z` : '');
}

export function scopePaletteRgb(document, index, row = 0) {
  const value = document.palette.rows[row]?.[index];
  if (!value) throw new Error(`Missing source scope palette ${row}/${index}`);
  return rgb(value);
}

/** Encoding is explicit: native UI color-space/compositor has not been executed. */
export function scopeCssColor(color, encoding) {
  if (!['linear-to-srgb', 'raw-srgb'].includes(encoding)) throw new Error('Choose an explicit source UI color encoding');
  const srgb = x => x <= .0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - .055;
  return `rgb(${color.map(x => number(255 * (encoding === 'linear-to-srgb' ? srgb(x) : x))).join(' ')})`;
}

function shapeSvg(shape, options, id) {
  const closed = shape.DrawStyle.value !== 0;
  const filled = shape.DrawStyle.value === 2;
  const path = scopePathData(shape.Path, {...options, closed}) + shape.InnerPaths.map(p => ' ' + scopePathData(p, {...options, closed:true})).join('');
  const corners = shape.Path.Corners;
  const baseColor = mul(options.color, rgb(shape.Color));
  const first = corners[0];
  const uniform = corners.every(c => c.Alpha === first.Alpha && JSON.stringify(c.Color) === JSON.stringify(first.Color));
  let defs = '', paint;
  if (uniform) paint = scopeCssColor(mul(baseColor, rgb(first.Color)), options.colorEncoding);
  else {
    // Only the authored open dual-zoom connector has nonuniform corner color.
    if (closed || corners.length !== 2) throw new Error('Unsupported native filled/closed vertex color interpolation');
    const end = corners[1];
    defs = `<defs><linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${first.Position.x}" y1="${first.Position.y}" x2="${end.Position.x}" y2="${end.Position.y}">`
      + corners.map((c,i) => `<stop offset="${i}" stop-color="${scopeCssColor(mul(baseColor, rgb(c.Color)), options.colorEncoding)}" stop-opacity="${c.Alpha}"/>`).join('')
      + '</linearGradient></defs>';
    paint = `url(#${id})`;
  }
  const opacity = shape.Alpha * (uniform ? first.Alpha : 1);
  const cap = ({0:'butt',1:'square',2:'round'})[shape.StartCapType.value];
  if (shape.StartCapType.value !== shape.EndCapType.value) throw new Error('Asymmetric native line caps are unsupported');
  return defs + `<path d="${path}" opacity="${number(opacity)}" fill="${filled ? paint : 'none'}" fill-rule="evenodd" stroke="${filled ? 'none' : paint}" stroke-width="${shape.LineWidth}" stroke-linejoin="miter" stroke-linecap="${cap}"/>`;
}

/** Standalone source asset; no screen alpha or layout is implied. */
export function sourceScopeAssetSvg(asset, {color = [1,1,1], colorEncoding, allowInferredCircularArcs = false, idPrefix = 'scope'} = {}) {
  const r = asset.layoutRect;
  const options = {color, colorEncoding, allowInferredCircularArcs};
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${r.x} ${r.y} ${r.z} ${r.w}" data-evidence="BF2-SCOPE-ARTWORK-001">`
    + asset.shapes.map((s,i) => shapeSvg(s, options, `${escape(idPrefix)}-${i}`)).join('') + '</svg>';
}

/** Evaluate graph arithmetic from an already-interpolated native UI fraction.
 * Callers supply the original random sample, not a fabricated random clock.
 * Competing glow/alpha writers remain separate outputs until caller chooses.
 */
export function evaluateScopeArtworkControls(document, {
  fraction, outlineRandom, scannerRandom, dispersionAngle = 0,
  smoothedDispersionAngle = dispersionAngle, timelineFraction = fraction,
  externalBackgroundAlpha,
} = {}) {
  const c = document.controlEvidence;
  if (!(fraction >= 0 && fraction <= 1)) throw new Error('Scope fraction must be in [0,1]');
  const sample = (x, range, label) => {
    if (!(x >= range[0] && x <= range[1])) throw new Error(`${label} must be an original sample in ${range}`);
    return f(x);
  };
  const outline = sample(outlineRandom, c.outlineAlpha.randomRange, 'outlineRandom');
  const scanner = sample(scannerRandom, c.scannerAlpha.randomRange, 'scannerRandom');
  const t = Math.max(0, Math.min(1, f(timelineFraction)));
  const scale = f(1 + f(f(dispersionAngle) / 10));
  return {
    fraction: f(fraction), visible: f(fraction) > 0, scopeState: f(fraction) > f(.95),
    outlineAlpha: f(f(fraction) * outline), scannerAlpha: f(f(fraction) * scanner),
    backgroundAlpha: {timeline: f(t * f(.85)), external: externalBackgroundAlpha},
    outlineGlowWidth: {timeline: f(10 + f(-9 * t)), dispersion: f(1 + f(3 * f(smoothedDispersionAngle)))},
    targetContainerScale: [scale,scale,1],
    // Source TransformInterpolator output is supplied separately at render time.
    targetContainerPivot: [.5,.5,0],
  };
}

/** Source screen elements. Defaults stay at their source Alpha=0.
 * Native glow/radial repetition are not silently approximated. Return omissions.
 * Caller supplies the interpolated container scale and resolved property values.
 */
export function buildScopeArtworkSvg(document, {
  elementValues = {}, containerScale = [1,1], colorEncoding,
  allowInferredCircularArcs = false, paletteRow = 0,
  names = ['ScopeGlow','ScopeOutline','DualZoomIconOn','DualZoomIconOff'],
} = {}) {
  const groups = [], omitted = [];
  const width = document.layout.size[0], height = document.layout.size[1];
  for (const name of names) {
    const el = document.elements[name];
    if (!el) throw new Error(`Unknown source scope element ${name}`);
    const data = el.data, value = elementValues[name] ?? {};
    const alpha = value.alpha ?? data.Alpha;
    if (data.sourceType === 'RepeatShapeElementData') {
      omitted.push(`${name}: native radial repetition is retained as source data, not reproduced`);
      continue;
    }
    const glow = value.glowWidth ?? data.GlowWidth;
    if (alpha !== 0 && glow !== 0) omitted.push(`${name}: native GlowWidth=${glow} retained, glow shader not reproduced`);
    const color = value.color ?? scopePaletteRgb(document, value.paletteIndex ?? data.PaletteIndex, paletteRow);
    const asset = document.assets[el.assetId], r = asset.layoutRect;
    // Only these selected elements use source position/expansion or center anchors.
    const centerAnchored = data.Anchor.X === .5 && data.Anchor.Y === .5;
    const x = data.Position.X + data.Offset.X + (centerAnchored ? (width - data.Size.x)/2 : 0);
    const y = data.Position.Y + data.Offset.Y + (centerAnchored ? (height - data.Size.y)/2 : 0);
    const options = {color, colorEncoding, allowInferredCircularArcs};
    const paths = asset.shapes.map((s,i) => shapeSvg(s, options, `scope-${escape(name)}-${i}`)).join('');
    groups.push(`<g data-source-element="${escape(name)}" data-source-glow-width="${glow}" data-source-blend="${data.BlendMode.name}" opacity="${number(alpha)}" transform="translate(${x} ${y}) scale(${data.Size.x/r.z} ${data.Size.y/r.w})">${paths}</g>`);
  }
  omitted.push('Native additive blend, UI glow kernel, viewport expansion and final property-writer priority are not reproduced by this SVG adapter');
  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" data-evidence="${document.evidenceId}"><g transform="translate(${width/2} ${height/2}) scale(${number(containerScale[0])} ${number(containerScale[1])}) translate(${-width/2} ${-height/2})">${groups.join('')}</g></svg>`,
    omittedNativeFeatures: omitted,
    inferred: ['Incoming circular segment interpretation when enabled', 'Selected centered anchor mapping to SVG layout', `Palette encoding: ${colorEncoding}`],
  };
}
