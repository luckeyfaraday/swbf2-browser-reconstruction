"""Independent arithmetic comparison against unchanged native atlas PS on WARP."""
import hashlib
import json
import pathlib
import numpy as np

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / 'exports/lighting/static-atlas-sample'
C0 = 0.2820949852466583
C1 = 0.48860299587249756


def normalize(value):
    return value / np.linalg.norm(value, axis=-1, keepdims=True)


def evaluate(irradiance, directions, normal, view, smoothness):
    """Return native GBuffer3 before its frame exposure multiplier.

    The last parameter is the source smoothness written to GBuffer0.z, NOT
    Three perceptual roughness. Ordinary deferred shading subsequently uses
    (1 - smoothness)^2 for its DFG coordinate.
    """
    lengths = np.linalg.norm(directions * C1, axis=-1)
    unit = np.divide(directions, np.linalg.norm(directions, axis=-1, keepdims=True),
                     out=np.zeros_like(directions), where=np.linalg.norm(directions, axis=-1, keepdims=True) != 0)
    cosine = np.sum(unit * normal, axis=-1)
    t = (1 + cosine) * .5
    weights = C0 + 2 * lengths / (lengths + C0) * C0 * ((2 * t**3 - t**4) * 3.3333332538604736 - 1)
    average = directions.sum(axis=-2) * 0.3333333432674408
    dominant_length = np.linalg.norm(average, axis=-1)
    light = normalize(average)
    half_vector = normalize(light + view)
    nv = abs(np.sum(normal * view, axis=-1)) + 9.999999747378752e-6
    nl = np.clip(np.sum(normal * light, axis=-1), 0, 1)
    nh = np.clip(np.sum(normal * half_vector, axis=-1), 0, 1)
    lh = np.clip(np.sum(light * half_vector, axis=-1), 0, 1)
    alpha = np.maximum((1 - np.sqrt(smoothness) * dominant_length)**2, 0.0020000000949949026)
    alpha2 = alpha**2
    visibility = .5 / (nl * np.sqrt((1 - alpha2) * nv**2 + alpha2) + nv * np.sqrt((1 - alpha2) * nl**2 + alpha2))
    distribution = alpha2 / (((alpha2 - 1) * nh**2 + 1)**2)
    fresnel = .25 + .75 * (1 - lh)**5
    fade = np.maximum((.9375 - smoothness) * 1.0666667222976685, 0)
    fade = fade**2 * (3 - 2 * fade) * np.minimum(4 * nl, 1)
    specular = distribution * visibility * fresnel * fade
    return irradiance * (weights + specular[..., None]), weights, specular


def main():
    fields = ['StaticIrradianceTexture', 'StaticDirectionTexture', 'StaticDirectionTextureG', 'StaticDirectionTextureB', 'StaticSkyVisibilityTexture']
    textures = [np.fromfile(OUT / (field + '.rgba32f.bin'), dtype='<f4').astype(float).reshape(16, 16, 4) for field in fields]
    directions = np.stack([2 * value[..., :3] - 1 for value in textures[1:4]], axis=-2)
    execution = json.loads((OUT / 'native-execution.json').read_text())
    records = []
    for case in execution['cases']:
        x = case['normalTextureX'] * 2 - 1
        normal = np.array([x, np.sqrt(1 - x*x), 0])
        texture_w = case['roughnessTextureW']
        smoothness = np.clip((1 + .307 * (1.6 * texture_w - 1)) * .9 + (1.6 * texture_w) * .1, 0, 1)
        expected, weights, specular = evaluate(textures[0][..., :3], directions, normal, normalize(np.array([0., 2., 2.])), smoothness)
        native = np.fromfile(OUT / f"native-case{case['index']}-mrt3.rgba32f.bin", dtype='<f4').reshape(16, 16, 4)
        native2 = np.fromfile(OUT / f"native-case{case['index']}-mrt2.rgba32f.bin", dtype='<f4').reshape(16, 16, 4)
        error = np.abs(native[..., :3] - expected)
        relative = error / np.maximum(1, np.abs(expected))
        assert np.isfinite(native).all() and np.isfinite(expected).all()
        # Independent float64 arithmetic versus native float32 DXBC includes
        # cancellation near the directional lobe's dark side.
        assert np.max(relative) < 1e-4, (case, np.max(error), np.max(relative))
        assert np.array_equal(native2[..., 3], textures[4][..., 0])
        records.append({**case, 'sourceSmoothness': float(smoothness), 'normal': normal.tolist(),
                        'maximumAbsoluteError': float(error.max()), 'maximumRelativeError': float(relative.max()),
                        'nativePayloadSha256': hashlib.sha256(native.tobytes()).hexdigest(),
                        'exactSkyVisibilityChannel': True, 'maximumBakedSpecularWeight': float(specular.max())})
    report = {'evidenceId': 'BF2-NATIVE-STATIC-ATLAS-MATH-001', 'samples': len(records) * 256,
              'nativeExecution': 'native-execution.json', 'cases': records,
              'maximumRelativeError': max(x['maximumRelativeError'] for x in records),
              'limitations': ['Normalized world normals supplied by the floor producer are proven here; other material producers require their own normal evidence.',
                             'Native frame LightMapPreExposure is not established by fixture factors equal to one.',
                             'Atlas UV packing and database binding are independently established; this fixture isolates pixel arithmetic.']}
    (OUT / 'math-validation.json').write_text(json.dumps(report, indent=2))
    print(json.dumps({'samples': report['samples'], 'maximumRelativeError': report['maximumRelativeError']}))


if __name__ == '__main__':
    main()
