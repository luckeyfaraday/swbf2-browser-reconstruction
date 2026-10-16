// Read only already-decoded local EBX JSON, preserving exact field provenance.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const args=process.argv.slice(2),inputs=[];
let match='Damage|Health|Heat|RateOfFire|InitialSpeed|TimeToLive|Speed|Gravity|Jump|Tickets|ScoreLimit|TimeLimit|Respawn',out=null;
for(let i=0;i<args.length;i++) {
  if(args[i]==='--match')match=args[++i];
  else if(args[i]==='--out')out=args[++i];
  else inputs.push(args[i]);
}
if(!inputs.length)throw new Error('Usage: node scan-ebx.mjs EBX_FILE_OR_DIRECTORY... [--match REGEX] [--out REPORT.json]');
const pattern=new RegExp(match,'i'),sources=[],observations=[];
const pointer=parts=>'/'+parts.map(part=>String(part).replaceAll('~','~0').replaceAll('/','~1')).join('/');
async function inspect(file) {
  const bytes=await fs.readFile(file),document=JSON.parse(bytes.toString('utf8'));
  if(!document.asset?.objects||!document.entry?.guid)return;
  const source={file:path.resolve(file),name:document.entry.name,type:document.entry.type,guid:document.entry.guid,sha1:document.entry.sha1,jsonSha256:crypto.createHash('sha256').update(bytes).digest('hex'),serializationErrors:document.asset.errors??[]};
  const index=sources.push(source)-1;
  function visit(value,parts,objectId,objectType) {
    if(value&&typeof value==='object') {
      for(const [key,child] of Object.entries(value)) {
        if(key.startsWith('__')||key.startsWith('$'))continue;
        visit(child,[...parts,key],objectId,value.$type??objectType);
      }
    } else if(pattern.test(parts.join('.')))observations.push({source:index,objectId,objectType,jsonPointer:pointer(parts),value,evidenceType:'decoded-installed-asset-field',runtimeObserved:false});
  }
  document.asset.objects.forEach((object,i)=>visit(object,['asset','objects',i],object.$id,object.$type));
}
for(const input of inputs) {
  const stat=await fs.stat(input);
  if(stat.isDirectory())for(const name of (await fs.readdir(input)).filter(name=>name.endsWith('.json')).sort())await inspect(path.join(input,name));
  else await inspect(input);
}
const report={createdAtUtc:new Date().toISOString(),scope:'Decoded installed EBX fields only; field meaning, active overrides and runtime application require separate analysis.',filter:match,sources,observations};
const text=JSON.stringify(report,null,2)+'\n';
if(out){await fs.mkdir(path.dirname(path.resolve(out)),{recursive:true});await fs.writeFile(out,text);console.log(JSON.stringify({file:path.resolve(out),sources:sources.length,observations:observations.length}));}
else process.stdout.write(text);
