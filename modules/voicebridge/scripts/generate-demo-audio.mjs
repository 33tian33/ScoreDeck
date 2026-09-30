import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const demo = JSON.parse(await readFile(join(projectRoot, "data/demo-channels.json"), "utf8"));
const sampleRate = 16000;

function createWav(channel, channelIndex) {
  const durationMs = Math.max(...channel.utterances.map((item) => item.endMs)) + 1000;
  const sampleCount = Math.ceil((durationMs / 1000) * sampleRate);
  const samples = new Float64Array(sampleCount);
  const speakerIds = [...new Set(channel.utterances.map((item) => item.speakerId))];
  const frequencies = new Map(speakerIds.map((id, index) => [id, 165 + channelIndex * 42 + index * 44]));

  for (const item of channel.utterances) {
    const start = Math.floor((item.startMs / 1000) * sampleRate);
    const end = Math.min(sampleCount, Math.floor((item.endMs / 1000) * sampleRate));
    const frequency = frequencies.get(item.speakerId) || 220;
    for (let i = start; i < end; i += 1) {
      const local = (i - start) / sampleRate;
      const length = (end - start) / sampleRate;
      const fade = Math.min(1, local / 0.035, (length - local) / 0.05);
      const syllable = 0.42 + 0.58 * Math.max(0, Math.sin(2 * Math.PI * 4.2 * local));
      const carrier =
        Math.sin(2 * Math.PI * frequency * local) * 0.7 +
        Math.sin(2 * Math.PI * frequency * 2.02 * local) * 0.2;
      samples[i] += carrier * syllable * fade * 0.17;
    }
  }

  const dataSize = sampleCount * 2;
  const wav = Buffer.alloc(44 + dataSize);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + dataSize, 4);
  wav.write("WAVE", 8);
  wav.write("fmt ", 12);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < sampleCount; i += 1) {
    wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2);
  }
  return { wav, durationMs };
}

for (const [index, channel] of demo.channels.entries()) {
  const { wav, durationMs } = createWav(channel, index);
  const filename = channel.audioUrl.slice(1);
  await writeFile(join(projectRoot, "public", filename), wav);
  console.log(`Generated public/${filename} (${durationMs} ms, ${sampleRate} Hz mono)`);
}
