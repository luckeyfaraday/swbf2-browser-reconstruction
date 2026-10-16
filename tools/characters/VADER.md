# Darth Vader (DarthVader_01) and lightsaber checkpoint

## Observations

- **VADER-GEO-001**: `web/public/assets/characters/vader.glb` merges `vader-body.glb` (`characters/hero/darthvader/darthvader_01/darthvader_01_mesh`, LOD1, 10 visible sections, 14,646 vertices / 18,642 triangles) and `vader-cape.glb` (`darthvader_01_cape_mesh`, LOD1, 702 / 1,054). Total 15,348 vertices / 19,696 triangles. LOD1 matches the trooper policy. Source Y-up metres; actor faces +Z in bind space (A-pose, height 1.844 m).
- **VADER-SKIN-001**: Rig is `Characters/Rigs/Humanoids/Walrus_HumanMale` (248 bones). Chain: SoldierBlueprint `Hero_Lightsaber_DarthVader` EBX dependency `Walrus_HumanMale_MasterSke` (typed decode fails in the historical SDK; raw EBX kept), whose `MasterSkeleton` is Walrus_HumanMale. The NPC `Actor_Lightsaber_DarthVader` uses the same master skeleton. `DarthVader_01` `BasePoseTransforms.Count` and `ClothAsset.RuntimeRigBoneCount` are both 248. The body adds two mesh procedural bones, PROC_0 (parent LeftShoulder) and PROC_1 (parent RightShoulder), giving 250 joints. The cape uses 248 joints, 18 weighted, with at most 2 influences. Rest matrices agree within 3e-6. No influence is discarded. The median vertex-to-bone distance is 0.166 m (stormtrooper 0.172 m). The cape bounding box equals `ClothEntityData.PartBoundingBoxes`.
- **VADER-MAT-001**: All 13 materials resolve through the unchanged trooper planner, using the exact split shader entry (CityHash64 of NameHash, variation 0 and LOD, plus GUID, LOD and section). These are 10 body, 1 cape, 1 hilt and 1 blade template. Vader's own `vur_darthvader_01_bpb/MeshVariationDb_Win32` independently names the same BaseColor/CS/Normal textures for all 11 body and cape materials (`mvdb-crosscheck.json`).
  - Mesh EBX vector parameters give emissive presets: belt and chest `EmissiveColor`/`EmissiveIntensity` (1e6–9e6), and `SS_Hero_Jedi_DarthVader_BlinkingLights` `Color`/`Amplitude` (9e6–9e7) with `Wavelength` 6/9/13.
  - The cape preset is `SS_CharactersPreset_WalrusNonMetallic_DoubleSided`.
- **VADER-VUR-001**: VUR `RigScale` is a `WriteFloatGameState` with value **1.1**. `VisualAntGameStates` writes an enumeration value of 5. The blueprint overrides the bind pose of bone 238 CameraBase (translation z 0.0603).
- **VADER-SABER-001**: The hilt `lightsaberdarthvader_meshp_mesh` (1,007 vertices / 998 triangles, LOD0 only) is drawn as a mesh particle by `em_lightsaber_darthvader_meshp_3p`, which is LocalSpace, has MaxCount 1, has no position processors and uses an identity emitter-entity transform.
  - Every saber effect in `PF_Lightsaber_FX_Vader` attaches through `AnimatableAttachData` `GameplayBones_WeaponBone` (enum 6, UseRotation). The skeleton's `GameplayBonesToSkeleton[6]` maps this to bone 184 **Wep_Root** (parent Spine2).
  - The `AttachOffset` property is unconnected, and the prefab and effect transforms are identity, so the hilt sits in Wep_Root space with a zero offset.
- **VADER-BLADE-001**: The blade is `FX_LightSaber_DarthVader_Red`, an EmitterGraph `EG_LightSaber_Generic` placed at hilt-space (0, 0.06, 0), whose emitter forward points along hilt +Y.
  - Disassembled spawn and simulate compute shaders store the forward axis multiplied by `effectParams[0]` (`EmitterParameter2`).
  - `PF_LightSaber_Controllable_Common` drives that parameter with `BladeLength`, a FloatInterpolator that moves between 0 and 1 (`BladeOnOff`). Ignition takes 0.2 s and retraction 0.3 s, both from FX_Vader interface values.
  - The HDR colour is `LightSaberColor1` = (1000, 104.062, 85.407). The `PbrTubeLight` has colour (1, 0.102, 0.0854), intensity 500 (luminous power), tube width 0.9 and attenuation radius 5. The LightEffect is centred at hilt y 0.575, with tube width 1.
  - The names of the other params were resolved by hash where possible; the rest stay as raw hashes in `vader.source.json`.

- **VADER-SABER-002** (corroboration): The separately decoded `vader-animations.glb` (BF2-VADER-ANIM-001) was used to check the attachment. With the hilt placed in animated Wep_Root space at zero offset, the mid-grip lands 0.057–0.067 m from RightHand in the idle, run-fwd and block-idle clips. The blade points down and forward in idle and upward in block-idle. Run `python tools/characters/vader-attach-check.py idle run-fwd block-idle`; output goes to `exports/characters/vader-saber/attach-check.json`.

## Inferences and limitations

- The browser rig is not scaled. The RigScale of 1.1 most likely makes Vader about 2.03 m tall natively; apply it at the actor root if that is wanted.
- The saber attaches to Wep_Root with an identity transform. In bind pose Wep_Root sits at the model origin; only animation brings it to the hand. No hand offset is invented.
- The blade's metric length, width and geometry are not established. `meshp_lightsaber_planes_mesh` (145 vertices / 136 triangles) is a parametric template, expanded by the unrecovered `EG_LightSaber_Generic_GraphEmVSF`. It is kept as `exports/characters/vader-saber/vader-saber-blade.glb`, not as a renderable node. `vader-saber.glb` has empty `blade` and `blade_light` socket nodes carrying the source frames and parameters. The light tube (y 0.125–1.025) suggests a blade of about 1 m, but this is not verified.
- The following are not reproduced:
  - EA cloth simulation and GPU wrapping (the cape is linearly skinned).
  - The RenderBones expression graph (procedural shoulder bones stay at rest).
  - Blinking lights.
  - Absolute emissive HDR intensity: emissiveFactor is the source colour normalised to 1.
  - AOSL, weathering and detail maps, metallic data and native shaders.
- The material mapping is as partial as the troopers'.
- The actor is unanimated.

## Reproduction (workspace root; Git Bash; Python 3.11 = `%USERPROFILE%/AppData/Local/Programs/Python/Python311/python.exe`)

1. EBX graphs (read-only): `tools/bf2-extract/bf2-extract.exe export --game GAME --out exports/characters/vader-ebx/d1 --names exports/characters/vader-ebx-names.txt --depth 1 --max-assets 2000`.
   - Then the same with `vader-ebx-names-2.txt --depth 0` into `vader-ebx/d2`.
   - Then `raw --kind ebx --id Gameplay/Characters/Heroes/Specializations/Hero_Lightsaber_DarthVader` into `vader-ebx/raw-specialization`.
   - Then `raw --kind res --id 1813894995397697639` and `--id 12048296472027977935` into `vader-ebx/raw-emittergraph`.
   - Disassemble with `python tools/characters/vader-disasm.py X.res X.asm`.
2. Skinned meshes: `tools/characters/character-extract.exe --runtime tools/frosty-1.0.5.2 --work tools/bf2-extract/work --game GAME --out exports/characters/vader-converted --id vader-body --name characters/hero/darthvader/darthvader_01/darthvader_01_mesh --skeleton Characters/Rigs/Humanoids/Walrus_HumanMale --lod 1`.
   - Repeat for `vader-cape` with `darthvader_01_cape_mesh`.
   - Corroborate with `python tools/characters/vader-skeleton-fit.py exports/characters/vader-converted/vader-body.glb exports/characters/vader-converted/vader-body.skin.json exports/characters/vader-converted/vader-body.skeleton-fit.json`, and the same for the cape.
3. Bind: `node tools/characters/bind-skin.mjs exports/characters/vader-converted/vader-{body,cape}.glb exports/characters/vader-converted/vader-{body,cape}.skin.json exports/characters/vader-material-inputs/vader-{body,cape}.glb`.
4. Rigid saber meshes: `bf2-extract.exe mesh --name gameplay/equipment/heroes/lightsaberdarthvader/lightsaberdarthvader_meshp_mesh --lod 0`, and the same for `fx/meshes/weapon/meshp_lightsaber_planes_mesh`, into `exports/characters/vader-saber-mesh`.
   - Copy the results to `vader-material-inputs/vader-saber-{hilt,blade}.glb`.
   - `vader-material-inputs/mesh.manifest.json` lists the four inputs.
5. Metadata and shader blocks: `bf2-info.exe mesh-info --names exports/characters/vader-mesh-names.txt --out exports/characters/vader-mesh-info`, then `bf2-materials.exe shaderblocks --names exports/characters/vader-mesh-names.txt --out exports/characters/vader-shader-blocks`.
6. Materials, using the unchanged trooper tools: `python tools/materials/plan-materials.py --mesh-manifest exports/characters/vader-material-inputs/mesh.manifest.json --blocks exports/characters/vader-shader-blocks/shader-blocks.json --extra-graph exports/characters/vader-converted --extra-graph exports/characters/vader-ebx/d1 --source exports/characters/vader-material-inputs --mesh-info exports/characters/vader-mesh-info/mesh-info.json --out exports/characters/vader-materials/vader-material-plan.json`.
   - Then `bf2-extract.exe texture --names exports/characters/vader-materials/vader-material-plan.texture-names.txt --out exports/characters/vader-materials/source-textures --png`.
   - Then `python tools/materials/apply-materials.py --plan exports/characters/vader-materials/vader-material-plan.json --textures exports/characters/vader-materials/source-textures --source exports/characters/vader-material-inputs --target exports/characters/vader-materials/glb --filenames`. The target is kept out of `web/` so that the shared `material-conversion.json` is never overwritten.
   - Then `python tools/characters/vader-mvdb-crosscheck.py`.
7. `python tools/characters/vader-materials-post.py`: records constants and emissive/double-sided settings, writes `web/public/assets/characters/vader-{body,cape}.glb` and `vader-textures/`, and the saber parts to `exports/characters/vader-saber/`.
   - Copy `exports/characters/vader-material-inputs/vader-{body,cape}.glb.binding.json` next to them.
8. `node tools/characters/merge-character.mjs web/public/assets/characters/vader.glb web/public/assets/characters/vader-body.glb web/public/assets/characters/vader-cape.glb`.
9. `python tools/characters/vader-saber-evidence.py`, then `node tools/characters/vader-saber-assemble.mjs`.
10. `node tools/bf2-extract/validate-glb.cjs web/public/assets/characters/NAME.glb exports/characters/vader-validation/NAME.json web/public/assets` for vader, vader-body, vader-cape and vader-saber. All report 0 errors; the only warnings are generated tangents, as for the troopers.
11. `python tools/characters/vader-provenance.py` writes `web/public/assets/characters/vader.source.json`.
