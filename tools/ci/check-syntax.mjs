// Parses every tracked JavaScript module without running it (CI has no game data).
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const files=execFileSync('git',['ls-files','*.js','*.mjs','*.cjs'],{cwd:root,encoding:'utf8'}).split('\n').filter(Boolean);
let failed=0;
for(const file of files) {
  try{execFileSync(process.execPath,['--check',file],{cwd:root,stdio:'pipe'});}
  catch(error){failed++;console.error(`${file}\n${String(error.stderr||error.message).trim()}\n`);}
}
console.log(`${files.length-failed}/${files.length} JavaScript files parse`);
process.exitCode=failed?1:0;
