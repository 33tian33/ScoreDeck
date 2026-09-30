import { readFile } from 'node:fs/promises';
export const RATE = 48000;
export function wav(pcm, rate = RATE) {
  const h = Buffer.alloc(44); h.write('RIFF'); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}
export function mono48(frame) {
  const n = Math.round(frame.sampleCount * RATE / frame.sampleRate), out = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    const pos = i * frame.sampleRate / RATE, a = Math.min(frame.sampleCount - 1, Math.floor(pos)), b = Math.min(frame.sampleCount - 1, a + 1);
    let value = 0; for (let c = 0; c < frame.channels; c++) value += (frame.pcm.readInt16LE((a * frame.channels + c) * 2) * (1 - (pos-a)) + frame.pcm.readInt16LE((b * frame.channels + c) * 2) * (pos-a)) / frame.channels;
    out.writeInt16LE(Math.round(value), i * 2);
  }
  return out;
}
export async function readMonoWav(path) {
  const b = await readFile(path); if (b.toString('ascii',0,4) !== 'RIFF') throw new Error('invalid_wav');
  let rate, channels, bits, pcm;
  for (let i=12;i+8<=b.length;) { const size=b.readUInt32LE(i+4), type=b.toString('ascii',i,i+4);
    if(type==='fmt ') { if(b.readUInt16LE(i+8)!==1) throw new Error('only_pcm_wav'); channels=b.readUInt16LE(i+10); rate=b.readUInt32LE(i+12); bits=b.readUInt16LE(i+22); }
    if(type==='data') pcm=b.subarray(i+8,i+8+size); i+=8+size+(size%2);
  }
  if(bits!==16 || !pcm || !channels || !rate) throw new Error('invalid_pcm_wav');
  return mono48({pcm,channels,sampleRate:rate,sampleCount:pcm.length/2/channels});
}
