import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const root=path.dirname(fileURLToPath(import.meta.url));
export const workspace=path.resolve(root,'../..');
export const pointer=parts=>'/'+parts.map(part=>String(part).replaceAll('~','~0').replaceAll('/','~1')).join('/');
export const at=(value,parts)=>parts.reduce((current,key)=>current?.[key],value);
export function hashField(text){let hash=5381;for(const character of text)hash=((hash*33)^character.charCodeAt(0))|0;return hash;}

export async function readExports(directories=['core','detail','state','e11-root','map']) {
  const documents=new Map();
  for(const directory of directories)for(const file of await fs.readdir(path.join(root,directory,'ebx'))) {
    if(!file.endsWith('.json'))continue;
    const fullPath=path.join(root,directory,'ebx',file),bytes=await fs.readFile(fullPath),document=JSON.parse(bytes.toString('utf8'));
    if(!document.entry?.guid||!document.asset?.objects)continue;
    if(document.asset.errors?.length)throw new Error(`Serialization errors in ${fullPath}`);
    documents.set(document.entry.name,{...document,source:{file:path.relative(workspace,fullPath).replaceAll('\\','/'),name:document.entry.name,guid:document.entry.guid,sha1:document.entry.sha1,jsonSha256:crypto.createHash('sha256').update(bytes).digest('hex')}});
  }
  return documents;
}

export function getDocument(documents,name) {
  const document=documents.get(name);
  if(!document)throw new Error(`Missing decoded asset: ${name}`);
  return document;
}
export function getObject(document,idOrType) {
  const matches=document.asset.objects.map((object,index)=>({object,index})).filter(({object})=>object.$id===idOrType||object.$type===`FrostySdk.Ebx.${idOrType}`);
  if(matches.length!==1)throw new Error(`${document.entry.name}: expected one ${idOrType}, found ${matches.length}`);
  return matches[0];
}
export function observation(document,idOrType,fields) {
  const {object,index}=getObject(document,idOrType),value=at(object,fields);
  if(value===undefined)throw new Error(`Missing ${document.entry.name}/${idOrType}/${fields.join('/')}`);
  return {source:document.source,objectId:object.$id,objectType:object.$type,jsonPointer:pointer(['asset','objects',index,...fields]),value,evidenceType:'decoded-installed-asset-field',runtimeObserved:false};
}
export function checkReference(from,idOrType,fields,to,targetId) {
  const evidence=observation(from,idOrType,fields),reference=evidence.value;
  if(reference.$external!==to.entry.guid||reference.classGuid!==targetId)throw new Error(`Reference does not resolve: ${evidence.jsonPointer}`);
  getObject(to,targetId);
  return evidence;
}
export async function writeJson(file,document) {
  await fs.mkdir(path.dirname(file),{recursive:true});
  await fs.writeFile(file,JSON.stringify(document,null,2)+'\n');
}
