import path from 'node:path';
export function resolvePublic(root,requested,pathImpl=path){const full=pathImpl.resolve(root,requested),relative=pathImpl.relative(root,full);if(relative==='..'||relative.startsWith(`..${pathImpl.sep}`)||pathImpl.isAbsolute(relative))return null;return full;}
