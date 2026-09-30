import { readFileSync } from 'node:fs';
import {join} from 'node:path';
const path=process.env.VB_DATA_DIR ? join(process.env.VB_DATA_DIR,'.env') : new URL('../.env',import.meta.url);
try { const text=readFileSync(path,'utf8');for(const line of text.split(/\r?\n/)){const m=line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);if(!m||process.env[m[1]]!==undefined)continue;let value=m[2];if((value.startsWith('"')&&value.endsWith('"'))||(value.startsWith("'")&&value.endsWith("'")))value=value.slice(1,-1);process.env[m[1]]=value;} }catch(e){if(e.code!=='ENOENT')throw e;}
