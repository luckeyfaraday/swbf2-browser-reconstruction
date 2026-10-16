const fs=require('node:fs'),path=require('node:path');
const validator=require('../bf2-extract/validation/node_modules/gltf-validator');
const input=path.resolve(process.argv[2]),output=path.resolve(process.argv[3]);
const assetRoot=path.resolve(__dirname,'../../web/public/assets');
validator.validateBytes(new Uint8Array(fs.readFileSync(input)),{uri:path.basename(input),maxIssues:100,externalResourceFunction:async uri=>{
 const file=path.resolve(path.dirname(input),decodeURIComponent(uri));
 const relative=path.relative(assetRoot,file);
 if(relative.startsWith('..')||path.isAbsolute(relative))throw new Error('External resource leaves project assets');
 return new Uint8Array(fs.readFileSync(file));
}}).then(report=>{fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({input,validatorVersion:report.validatorVersion,errors:report.issues.numErrors,warnings:report.issues.numWarnings,infos:report.issues.numInfos,messages:report.issues.messages.filter(x=>x.severity<2)}));process.exitCode=report.issues.numErrors?1:0;}).catch(e=>{console.error(e);process.exitCode=1;});
