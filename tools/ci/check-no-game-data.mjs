// Fails if a tracked file looks like game data or a derived asset. The repository
// must contain only original code and docs; everything extracted from an install
// stays local (see .gitignore and CONTRIBUTING.md).
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const files=execFileSync('git',['ls-files'],{cwd:root,encoding:'utf8'}).split('\n').filter(Boolean);
const rules=[
  [/\.(glb|gltf|bin|res|chunk|dds|dxbc|cso|wav|ogg|mp3|png|jpe?g|tga|exr|hdr|ktx2?)$/i,'binary or media asset'],
  [/(^|\/)ebx\//,'exported EBX'],
  [/\.ndjson$/,'archive inventory'],
  [/-evidence\.json$|observations\.json$|(^|\/)export\.manifest\.json$/,'generated evidence or export manifest'],
  [/^(exports|evidence)\//,'pipeline output'],
  [/^web\/public\/assets\/(?!heroes\.json$)/,'runtime asset generated from an install'],
  [/^web\/src\/blaster-bolt-vertex\.js$|blaster-bolt-vertex-equations\.glsl$/,'translation of original shader bytecode'],
];
const problems=[];
for(const file of files) {
  for(const [pattern,reason] of rules)if(pattern.test(file))problems.push(`${file}: ${reason}`);
  const full=path.join(root,file);
  if(fs.existsSync(full)&&fs.statSync(full).size>512*1024)problems.push(`${file}: larger than 512 KB`);
}
// Raw shader disassembly (a few quoted instructions are allowed in notes).
const disassembly=/^\s*\/\/\s*(dcl_|mad|mul|add|iadd|mov|movc|dp[234]|rsq|sample[a-z_]*|ld[a-z_]*|ftou|ushr|ishl|uge|ult)(_sat)?(\([^)]*\))?\s+[ro][0-9]+\.[xyzw]/m;
for(const file of files.filter(f=>/\.(js|mjs|glsl|md|txt|py)$/.test(f))) {
  const text=fs.readFileSync(path.join(root,file),'utf8');
  const count=text.split('\n').filter(line=>disassembly.test(line)).length;
  if(count>8)problems.push(`${file}: ${count} lines of shader disassembly`);
}
if(problems.length){console.error(problems.join('\n'));process.exitCode=1;}
else console.log(`${files.length} tracked files contain no game data patterns`);
