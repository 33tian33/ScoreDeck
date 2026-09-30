import test from "node:test";
import assert from "node:assert/strict";
import dgram from "node:dgram";
import {
  AUDIO_HEADER_BYTES,
  PcmBridge,
  parseBridgePacket
} from "../lib/pcm-bridge.mjs";

function audioPacket(overrides = {}) {
  const pcm = overrides.pcm || Buffer.from([1, 0, 2, 0, 3, 0, 4, 0]);
  const packet = Buffer.alloc(AUDIO_HEADER_BYTES + pcm.length);
  packet.write("TSVB", 0, "ascii");
  packet.writeUInt16LE(overrides.version ?? 1, 4);
  packet.writeUInt16LE(1, 6);
  packet.writeUInt16LE(AUDIO_HEADER_BYTES, 8);
  packet.writeBigUInt64LE(19n, 12);
  packet.writeBigUInt64LE(17n, 20);
  packet.writeUInt16LE(42, 28);
  packet.writeUInt16LE(1, 30);
  packet.writeUInt32LE(48_000, 32);
  packet.writeUInt32LE(4, 36);
  packet.writeBigUInt64LE(9_600n, 40);
  packet.writeUInt32LE(pcm.length, 48);
  packet.writeUInt32LE(0, 52);
  packet.write("channel-alpha", 56, "utf8");
  pcm.copy(packet, AUDIO_HEADER_BYTES);
  return packet;
}

test("parses an API 26 plugin audio packet", () => {
  const parsed = parseBridgePacket(audioPacket());
  assert.equal(parsed.kind, "audio");
  assert.equal(parsed.frame.channelId, "channel-alpha");
  assert.equal(parsed.frame.connectionHandlerId, 17n);
  assert.equal(parsed.frame.clientId, 42);
  assert.equal(parsed.frame.sequence, 19n);
  assert.equal(parsed.frame.ptsSamples, 9_600n);
  assert.deepEqual([...parsed.frame.pcm], [1, 0, 2, 0, 3, 0, 4, 0]);
});

test("parses speaker metadata", () => {
  const payload = Buffer.from(JSON.stringify({
    type: "speaker",
    connectionHandlerId: "17",
    clientId: "42",
    stableId: "uid-value",
    name: "北风"
  }));
  const parsed = parseBridgePacket(Buffer.concat([Buffer.from("TSVJ"), payload]));
  assert.equal(parsed.kind, "control");
  assert.equal(parsed.message.name, "北风");
});

test("rejects malformed payload lengths", () => {
  const packet = audioPacket();
  packet.writeUInt32LE(2, 48);
  assert.throws(() => parseBridgePacket(packet), /invalid_payload_size/);
});

test("receives an audio frame over the localhost UDP bridge", async (t) => {
  const bridge = new PcmBridge({ port: 0 });
  await bridge.start();
  t.after(() => bridge.close());
  const sender = dgram.createSocket("udp4");
  t.after(() => sender.close());

  const received = new Promise((resolve) => bridge.once("audio", resolve));
  sender.send(audioPacket(), bridge.port, "127.0.0.1");
  const frame = await Promise.race([
    received,
    new Promise((_, reject) => setTimeout(() => reject(new Error("udp_timeout")), 1_000))
  ]);

  assert.equal(frame.channelId, "channel-alpha");
  assert.equal(bridge.status().audioPackets, 1);
  assert.equal(bridge.status().tracks.length, 1);
});
