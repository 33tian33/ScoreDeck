import dgram from "node:dgram";
import { EventEmitter } from "node:events";

export const AUDIO_MAGIC = Buffer.from("TSVB");
export const JSON_MAGIC = Buffer.from("TSVJ");
export const PROTOCOL_VERSION = 1;
export const AUDIO_PACKET_TYPE = 1;
export const AUDIO_HEADER_BYTES = 88;

function readCString(buffer) {
  const end = buffer.indexOf(0);
  return buffer.subarray(0, end === -1 ? buffer.length : end).toString("utf8");
}

export function parseBridgePacket(packet) {
  if (!Buffer.isBuffer(packet) || packet.length < 4) {
    throw new Error("packet_too_short");
  }

  if (packet.subarray(0, 4).equals(JSON_MAGIC)) {
    let message;
    try {
      message = JSON.parse(packet.subarray(4).toString("utf8"));
    } catch {
      throw new Error("invalid_json_control_packet");
    }
    if (!message || typeof message.type !== "string") {
      throw new Error("invalid_control_packet");
    }
    return { kind: "control", message };
  }

  if (!packet.subarray(0, 4).equals(AUDIO_MAGIC)) {
    throw new Error("bad_magic");
  }
  if (packet.length < AUDIO_HEADER_BYTES) {
    throw new Error("audio_header_too_short");
  }

  const version = packet.readUInt16LE(4);
  const type = packet.readUInt16LE(6);
  const headerBytes = packet.readUInt16LE(8);
  const sequence = packet.readBigUInt64LE(12);
  const connectionHandlerId = packet.readBigUInt64LE(20);
  const clientId = packet.readUInt16LE(28);
  const channels = packet.readUInt16LE(30);
  const sampleRate = packet.readUInt32LE(32);
  const sampleCount = packet.readUInt32LE(36);
  const ptsSamples = packet.readBigUInt64LE(40);
  const payloadBytes = packet.readUInt32LE(48);
  const flags = packet.readUInt32LE(52);
  const channelId = readCString(packet.subarray(56, 88));

  if (version !== PROTOCOL_VERSION) throw new Error("unsupported_version");
  if (type !== AUDIO_PACKET_TYPE) throw new Error("unsupported_packet_type");
  if (headerBytes !== AUDIO_HEADER_BYTES) throw new Error("invalid_header_size");
  if (!channelId || !/^[A-Za-z0-9_-]{1,31}$/.test(channelId)) throw new Error("invalid_channel_id");
  if (channels < 1 || channels > 8) throw new Error("invalid_channel_count");
  if (sampleRate < 8_000 || sampleRate > 192_000) throw new Error("invalid_sample_rate");
  if (sampleCount < 1 || sampleCount > 4_096) throw new Error("invalid_sample_count");
  if (sampleCount * channels > 4_096) throw new Error("pcm_frame_too_large");
  if (payloadBytes !== sampleCount * channels * 2) throw new Error("invalid_payload_size");
  if (packet.length !== headerBytes + payloadBytes) throw new Error("invalid_packet_length");

  return {
    kind: "audio",
    frame: {
      version,
      sequence,
      connectionHandlerId,
      clientId,
      channels,
      sampleRate,
      sampleCount,
      ptsSamples,
      flags,
      channelId,
      pcm: packet.subarray(headerBytes)
    }
  };
}

export class PcmBridge extends EventEmitter {
  constructor({ host = "127.0.0.1", port = 8790 } = {}) {
    super();
    this.host = host;
    this.port = port;
    this.socket = null;
    this.startedAt = null;
    this.lastPacketAt = null;
    this.packets = 0;
    this.audioPackets = 0;
    this.controlPackets = 0;
    this.invalidPackets = 0;
    this.bytes = 0;
    this.listening = false;
    this.error = null;
    this.bindings = new Map();
    this.speakers = new Map();
    this.tracks = new Map();
  }

  async start() {
    if (this.socket) return;
    const socket = dgram.createSocket("udp4");
    this.socket = socket;

    socket.on("message", (packet, remote) => {
      if (remote.address !== "127.0.0.1" && remote.address !== "::ffff:127.0.0.1") {
        this.invalidPackets += 1;
        return;
      }
      this.packets += 1;
      this.bytes += packet.length;
      this.lastPacketAt = Date.now();
      try {
        const parsed = parseBridgePacket(packet);
        if (parsed.kind === "control") {
          this.controlPackets += 1;
          this.#handleControl({...parsed.message, sourceId: `${remote.address}:${remote.port}`});
        } else {
          this.audioPackets += 1;
          this.#handleAudio({...parsed.frame, sourceId: `${remote.address}:${remote.port}`, captureSourceId: `${remote.address}:${remote.port}:${parsed.frame.flags}`});
        }
      } catch (error) {
        this.invalidPackets += 1;
        this.emit("invalid", error);
      }
    });

    socket.on("error", (error) => {
      this.error = error.message;
      this.emit("bridge-error", error);
    });

    await new Promise((resolve, reject) => {
      const onError = (error) => {
        socket.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        socket.off("error", onError);
        resolve();
      };
      socket.once("error", onError);
      socket.once("listening", onListening);
      socket.bind(this.port, this.host);
    });

    this.listening = true;
    this.port = socket.address().port;
    this.startedAt = Date.now();
    this.error = null;
    this.emit("status", this.status());
  }

  #handleControl(message) {
    if (message.type === "binding" && message.channelId && message.connectionHandlerId) {
      this.bindings.set(`${message.sourceId}:${message.connectionHandlerId}`, {
        sourceId: message.sourceId,
        channelId: String(message.channelId),
        connectionHandlerId: String(message.connectionHandlerId),
        active: message.active !== false,
        updatedAt: Date.now()
      });
    }
    if (message.type === "speaker" && message.connectionHandlerId && message.clientId != null) {
      const key = `${message.sourceId}:${message.connectionHandlerId}:${message.clientId}`;
      this.speakers.set(key, {
        connectionHandlerId: String(message.connectionHandlerId),
        clientId: String(message.clientId),
        channelId: String(message.channelId || ""),
        stableId: String(message.stableId || key),
        name: String(message.name || `TS ${message.clientId}`),
        updatedAt: Date.now()
      });
    }
    this.emit("control", message);
    this.emit("status", this.status());
  }

  #handleAudio(frame) {
    const trackId = `${frame.sourceId}:${frame.channelId}:${frame.connectionHandlerId}:${frame.clientId}`;
    const previous = this.tracks.get(trackId);
    const track = {
      trackId,
      channelId: frame.channelId,
      connectionHandlerId: frame.connectionHandlerId.toString(),
      clientId: String(frame.clientId),
      packets: (previous?.packets || 0) + 1,
      bytes: (previous?.bytes || 0) + frame.pcm.length,
      sampleRate: frame.sampleRate,
      channels: frame.channels,
      lastSequence: frame.sequence.toString(),
      lastPtsSamples: frame.ptsSamples.toString(),
      lastPacketAt: Date.now()
    };
    this.tracks.set(trackId, track);
    this.emit("audio", frame, this.speakers.get(`${frame.sourceId}:${track.connectionHandlerId}:${track.clientId}`) || null);
  }

  status() {
    return {
      endpoint: `${this.host}:${this.port}`,
      listening: this.listening,
      error: this.error,
      startedAt: this.startedAt,
      lastPacketAt: this.lastPacketAt,
      packets: this.packets,
      audioPackets: this.audioPackets,
      controlPackets: this.controlPackets,
      invalidPackets: this.invalidPackets,
      bytes: this.bytes,
      bindings: [...this.bindings.values()].map(b => ({...b, active: b.active && Date.now()-b.updatedAt<6000})),
      speakers: [...this.speakers.values()],
      tracks: [...this.tracks.values()]
    };
  }

  close() {
    if (!this.socket) return;
    this.socket.close();
    this.socket = null;
    this.listening = false;
  }
}
