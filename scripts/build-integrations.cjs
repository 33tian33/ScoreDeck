const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),bundle=path.join(root,'dist/assets/index-evagatfp.js'),marker='\n// SCOREDECK INTEGRATION PANEL\n';
const original=fs.readFileSync(path.join(root,'ui/main-runtime.js'),'utf8');
fs.writeFileSync(bundle,original+marker+fs.readFileSync(path.join(root,'dist/assets/integration-panel.js'),'utf8'));

require('./build-flow.cjs');

fs.copyFileSync(path.join(root,'server/scoredeck-rules.cjs'),path.join(root,'dist/assets/scoredeck-rules.js'));
