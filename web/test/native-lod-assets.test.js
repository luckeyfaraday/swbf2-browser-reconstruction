import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';

const root = new URL('../../', import.meta.url);
const read = path => fs.readFileSync(new URL(path, root));
const json = path => JSON.parse(read(path));
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const doc = json('web/public/assets/source-lods.json');
const native = new Map(json('exports/materials/mesh-info/mesh-info.json').results.map(row => [row.guid,row]));
const blocks = new Map(json('exports/materials/final-map-blocks.json').blocks.map(row => [row.source.rid,row]));

function glb(bytes) {
  assert.equal(bytes.readUInt32LE(0),0x46546c67);
  assert.equal(bytes.readUInt32LE(4),2);
  assert.equal(bytes.readUInt32LE(8),bytes.length);
  const length=bytes.readUInt32LE(12);
  return {json:JSON.parse(bytes.subarray(20,20+length)),binary:bytes.subarray(28+length)};
}

test('86 render alternatives retain original native LOD identities, counts and attribute streams', () => {
  assert.equal(doc.assets.length,48);
  assert.equal(doc.assets.reduce((n,a)=>n+a.lods.length,0),86);
  const first=json('exports/lod-recovery/render-lods-first24.json');
  for(const original of first.assets)assert.deepEqual(doc.assets.find(asset=>asset.assetId===original.assetId),original,'expansion preserves the first native batch byte identities and bindings');
  for (const asset of doc.assets) {
    const source=native.get(asset.assetId);
    assert.equal(asset.sourceResourceId,source.resourceId);
    assert.equal(asset.sourceResourceSha1,source.resource.sha1);
    assert.equal(asset.sourceEbxSha1,source.entry.sha1);
    for (const lod of asset.lods) {
      const bytes=read(`web/public${lod.url}`),parsed=glb(bytes),j=parsed.json;
      assert.equal(sha(bytes),lod.sha256);
      assert.deepEqual(bytes,read(lod.sourcePath));
      assert.equal(j.extras.guid,asset.assetId);
      assert.equal(j.extras.lod,lod.level);
      assert.equal(j.extras.chunkGuid,lod.chunkGuid);
      assert.equal(j.extras.bindingApplied,true);
      assert.equal(j.extras.flipV,false);
      assert.ok(j.nodes.every(node=>!node.matrix&&!node.translation&&!node.rotation&&!node.scale));
      const original=source.lods.find(row=>row.index===lod.level);
      assert.equal(original.chunkGuid,lod.chunkGuid);
      const sections=original.sections.filter(row=>row.exportedByStaticConverter);
      assert.equal(lod.triangles,sections.reduce((sum,row)=>sum+row.primitiveCount,0));
      const primitives=j.meshes.flatMap(mesh=>mesh.primitives);
      assert.equal(primitives.length,sections.length);
      for (const [index,primitive] of primitives.entries()) {
        const section=sections[index],position=j.accessors[primitive.attributes.POSITION];
        assert.equal(position.count,section.vertexCount);
        assert.equal(j.accessors[primitive.attributes.NORMAL].count,section.vertexCount);
        assert.equal(j.accessors[primitive.attributes.TEXCOORD_0].count,section.vertexCount);
        assert.equal(j.accessors[primitive.indices].count,section.primitiveCount*3);
        assert.equal(j.materials[primitive.material].extras.sourceMaterialId,section.materialId);
        assert.equal(primitive.extras.sectionName,section.name);
        assert.equal(lod.sections[index].sourceSectionIndex,section.index);
        for (const attribute of ['POSITION','NORMAL','TEXCOORD_0']) {
          const accessor=j.accessors[primitive.attributes[attribute]],view=j.bufferViews[accessor.bufferView];
          assert.equal(accessor.componentType,5126);
          const at=(view.byteOffset??0)+(accessor.byteOffset??0),components=attribute==='TEXCOORD_0'?2:3;
          for(let n=0;n<accessor.count*components;n++)assert.ok(Number.isFinite(parsed.binary.readFloatLE(at+n*4)));
        }
      }
    }
  }
});

test('every lower LOD primitive shares the identical source material block with its mapped LOD0 section', () => {
  for(const asset of doc.assets)for(const lod of asset.lods)for(const section of lod.sections) {
    const entry=blocks.get(section.sourceEntry),baseEntry=blocks.get(section.lod0SourceEntry);
    assert.equal(entry.sha256,section.sourceEntrySha256);
    const currentSection=blocks.get(entry.children[section.sourceSectionIndex]);
    const baseSection=blocks.get(baseEntry.children[section.lod0SectionIndex]);
    assert.equal(currentSection.children[1],section.sharedParameterRoot);
    assert.equal(baseSection.children[1],section.sharedParameterRoot);
    const currentGeometry=blocks.get(currentSection.children[0]),baseGeometry=blocks.get(baseSection.children[0]);
    assert.equal(currentGeometry.lod,lod.level);
    assert.equal(baseGeometry.lod,0);
    assert.equal(currentGeometry.meshGuid,baseGeometry.meshGuid);
    assert.equal(section.sourceMaterialId,section.lod0MaterialId);
    assert.equal(section.materialParametersEqualLod0,true);
  }
});

test('native distance group and per-mesh scale values remain separate and unmodified', () => {
  const audit=new Map(json('exports/lod-recovery/audit.json').assets.map(row=>[row.assetId,row]));
  let nonunit=0;
  for(const asset of doc.assets) {
    const group=asset.sourceLodGroup,bytes=read(group.sourcePath),source=JSON.parse(bytes);
    assert.equal(sha(bytes),group.sourceJsonSha256);
    assert.equal(source.entry.sha1,group.sourceEbxSha1);
    const original=source.asset.objects.find(row=>row.$id===source.asset.root);
    assert.equal(group.autoLod,original.AutoLod);
    assert.deepEqual(group.distances,[1,2,3,4,5,6].map(n=>original[`Lod${n}Distance`]));
    assert.equal(asset.lodScale,audit.get(asset.assetId).sourceLodScale);
    if(asset.lodScale!==1)nonunit++;
  }
  assert.equal(nonunit,10);
  const noCulling=doc.assets.find(a=>a.sourceLodGroup.name==='LodGroups/NoCullingLodGroup');
  assert.equal(noCulling.sourceLodGroup.distances[0],500);
  assert.match(doc.thresholdInterpretation.unresolved,/LodScale arithmetic/);
});

test('original LOD0 assets and composite transforms remain unchanged for collision and source probes', () => {
  const scene=json('web/public/assets/map.scene.json');
  for(const asset of doc.assets) {
    const baseline=scene.assets.find(row=>row.id===asset.assetId);
    const bytes=read(`web/public/assets/${baseline.url}`);
    assert.equal(sha(bytes),asset.lod0BrowserGlbSha256);
    const original=glb(bytes).json;
    assert.equal(original.extras.lod,0);
    assert.equal(asset.lod0Triangles,baseline.localBounds.triangles);
    for(const lod of asset.lods) {
      assert.equal(lod.compositePartTransformsEqualLod0,true);
      assert.deepEqual(lod.sourceCompositePartTransforms,original.extras.partTransforms??[]);
      assert.equal(lod.identityNodeTransform,true);
    }
  }
  assert.match(doc.integration.collision,/LOD0.*immutable/);
  assert.match(doc.integration.probes,/original per-instance probe assignments/);
});
