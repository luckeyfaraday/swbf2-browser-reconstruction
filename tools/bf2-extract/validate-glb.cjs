const fs = require('node:fs');
const path = require('node:path');
const validator = require('./validation/node_modules/gltf-validator');

const input = path.resolve(process.argv[2] || path.join(__dirname, 'selftest-triangle.glb'));
const output = path.resolve(process.argv[3] || path.join(__dirname, 'glb-validation.json'));
const assetRoot = fs.realpathSync(path.resolve(process.argv[4] || path.dirname(input)));
validator.validateBytes(new Uint8Array(fs.readFileSync(input)), {
  uri: path.basename(input),
  maxIssues: 100,
  externalResourceFunction: async uri => {
    const file = fs.realpathSync(path.resolve(path.dirname(input), decodeURIComponent(uri)));
    const relative = path.relative(assetRoot, file);
    if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('External resource leaves explicit asset root');
    return new Uint8Array(fs.readFileSync(file));
  }
}).then(report => {
  fs.mkdirSync(path.dirname(output), {recursive: true});
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({input, output, validatorVersion: report.validatorVersion, issues: report.issues}));
  process.exitCode = report.issues.numErrors ? 1 : 0;
}).catch(error => { console.error(error); process.exitCode = 1; });
