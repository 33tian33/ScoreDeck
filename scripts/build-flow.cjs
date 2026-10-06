const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),p=path.join(root,'dist/assets/index-evagatfp.js'),marker='\n// SCOREDECK TOURNAMENT FLOW\n';
fs.writeFileSync(p,fs.readFileSync(p,'utf8').split(marker)[0]+marker+['text-field.js','tournament-flow.js','flow-display.js','match-data.js','result-export.js','custom-panels.js'].map(name=>fs.existsSync(path.join(root,'ui',name))?fs.readFileSync(path.join(root,'ui',name),'utf8'):'').join('\n'));
fs.copyFileSync(path.join(root,'server/tournament-flow.cjs'),path.join(root,'dist/assets/tournament-flow.js'));

fs.copyFileSync(path.join(root,'server/flow-display.cjs'),path.join(root,'dist/assets/flow-display.js'));

fs.copyFileSync(path.join(root,'server/custom-panels.cjs'),path.join(root,'dist/assets/custom-panels.js'));
