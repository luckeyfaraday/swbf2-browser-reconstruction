import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

const workspace=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const read=file=>JSON.parse(fs.readFileSync(path.join(workspace,file),'utf8'));
const evidence=read('tools/gameplay-recovery/round-rules-evidence.json');
const config=read('web/public/assets/round-rules.json');
const sources=new Map(config.provenance.sources.map(source=>[source.name,{source,document:read(source.file)}]));
const objects=name=>sources.get(name).document.asset.objects;
const pointer=(value,p)=>p.split('/').slice(1).reduce((v,key)=>v[key.replaceAll('~1','/').replaceAll('~0','~')],value);
const byId=(name,id)=>objects(name).find(o=>o.$id===id);
const hash=name=>{let h=5381;for(const c of name)h=((h*33)^c.charCodeAt(0))>>>0;return '0x'+h.toString(16).padStart(8,'0');};
const prefix='Levels/MP/DeathStar02_01/';

test('round-rule evidence resolves to unchanged installed documents and actual source pointers',()=>{
  assert.equal(evidence.runtimeObserved,undefined);
  assert.equal(config.runtimeObserved,false);
  assert.ok(evidence.observations.length>=80);
  for(const {source,document} of sources.values()){
    const actual=crypto.createHash('sha256').update(fs.readFileSync(path.join(workspace,source.file))).digest('hex');
    assert.equal(actual,source.jsonSha256,source.file);
    assert.equal(document.entry.guid,source.guid);
    assert.equal(document.entry.sha1,source.sha1);
  }
  for(const observation of evidence.observations){
    assert.equal(observation.runtimeObserved,false);
    assert.deepEqual(pointer(sources.get(observation.source.name).document,observation.jsonPointer),observation.value);
  }
  for(const [name,value] of Object.entries(evidence.hashNames))assert.equal(hash(name),value);
});

test('Command Sector North Blast selects the online prefab and excludes the Arcade branch',()=>{
  assert.equal(objects('UI/Data/GameModes/Levels/CommandSectorNorth')[0].LevelId,prefix+'DeathStar02_01');
  const level=prefix+'TeamDeathmatch';
  const selected=objects(level).filter(o=>o.$type.endsWith('SubWorldReferenceObjectData')).filter(o=>{
    if(!o.InclusionSettings)return false;
    const settings=byId(level,o.InclusionSettings.$ref);
    return settings.Settings.some(r=>byId(level,r.$ref).EnabledOptions.includes('Blast'));
  });
  assert.equal(selected.length,1);
  assert.equal(selected[0].BundleName,level+'_Online');
  const online=objects(level+'_Online');
  const ref=online.find(o=>o.Blueprint?.name===level+'_Online_Logic');
  assert.equal(ref.Blueprint.classGuid,objects(level+'_Online_Logic')[0].$id);
  const logic=objects(level+'_Online_Logic');
  assert.deepEqual(logic[0].PropertyConnections,[]);
  assert.equal(logic.find(o=>o.Blueprint?.name===config.selection.prefab).Excluded,false);
});

test('the bound team kill limits are 100, not each counter serialized default of 50',()=>{
  const name='Gameplay/GameModes/TeamDeathmatch/TeamDeathmatchStateManager';
  const all=objects(name),edges=all[0].PropertyConnections;
  for(const counter of all.filter(o=>o.$type.endsWith('KillCounterEntityData')&&!o.$type.endsWith('PlayerKillCounterEntityData'))){
    assert.equal(counter.MaxKillCount,50);
    const binding=edges.filter(e=>e.Target.$ref===counter.$id&&e.TargetField===hash('MaxKillCount'));
    assert.equal(binding.length,1);
    assert.equal(binding[0].SourceField,hash('Value'));
    const provider=byId(name,binding[0].Source.$ref);
    assert.equal(provider.DefaultValue,100);
    assert.equal(edges.some(e=>e.Target.$ref===provider.$id),false);
    const limitEdge=edges.find(e=>e.Source.$ref===counter.$id&&e.SourceField===hash('KillLimit'));
    const compare=byId(name,limitEdge.Target.$ref);
    assert.equal(compare.TriggerOnPropertyChange,true);
    assert.ok(all[0].EventConnections.some(e=>e.Source.$ref===compare.$id&&e.SourceEvent.Name===hash('A=B')));
  }
  const mp=objects(config.selection.prefab);
  const field=mp[34].Fields.find(f=>f.Name==='0xf79143d6');
  assert.equal(field.Value,'Int32 100');
  const targets=mp[0].PropertyConnections.filter(e=>e.Source.$ref===mp[34].$id&&e.SourceField===field.Name)
    .map(e=>e.TargetField).sort();
  assert.deepEqual(targets,['0x2ca2a67a','0xb9897879']);
  assert.deepEqual(config.runtimeOverrides,{scoreLimit:100});
});

test('event and spawn-wave delays cannot silently become a total respawn or round-duration rule',()=>{
  assert.deepEqual(config.unresolved.duration,{value:null,reconstructionFallback:600});
  assert.deepEqual(config.unresolved.respawnSeconds,{value:null,reconstructionFallback:3});
  assert.equal(Object.hasOwn(config.runtimeOverrides,'duration'),false);
  assert.equal(Object.hasOwn(config.runtimeOverrides,'respawnSeconds'),false);
  const spawn=objects('Gameplay/GameModes/Shared/SpawnManager_Shared_MP');
  assert.equal(spawn[33].PlayerKilledDelay,4);
  assert.equal(spawn[4].MaxWaitTime,10);
  assert.ok(spawn[0].PropertyConnections.some(e=>e.Target.$ref===spawn[4].$id&&e.TargetField===hash('MaxWaitTime')));
  assert.ok(spawn.some(o=>o.$type.endsWith('FastSpawnManagerEntityData')));
  assert.equal(config.installedDefaults.privateMatchNoInteractivityTimeout,600);
  assert.equal(config.installedDefaults.blastPlayerCount,16);
  assert.equal(config.installedDefaults.blastMinPlayersToStart,4);
});
