'use strict';
const HUD_PORT=23416,GSI_PORT=31337,RESERVED_PORT=23415;
function resolvePort(value,fallback){const port=Number(value===undefined||value===null||value===''?fallback:value);return port===RESERVED_PORT?fallback:port;}
module.exports={HUD_PORT,GSI_PORT,RESERVED_PORT,resolvePort};
