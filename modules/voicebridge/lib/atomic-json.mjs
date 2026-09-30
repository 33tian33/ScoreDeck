import { writeFile, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
export async function atomicJson(path, value) {
  const temp = `${path}.${randomUUID()}.tmp`;
  try { await writeFile(temp, JSON.stringify(value, null, 2)); await rename(temp, path); }
  finally { await rm(temp, {force:true}).catch(()=>{}); }
}
