const {HUD_PORT:SD_HUD_PORT,GSI_PORT:SD_GSI_PORT,resolvePort:sdResolvePort}=require('./ports.cjs');
let grenadeTracker, handleTrackerRequest, cachePolicy;
var __create = Object.create;

function classifyBuy(players, side) {
  const team = players.filter(p => p.side === side);
  if (team.length !== 5 || team.some(p => !p.state || !Number.isFinite(p.state.equip_value) || !p.weapons)) return "unknown";
  const avg = team.reduce((n,p) => n + p.state.equip_value, 0) / 5;
  const armed = team.filter(p => p.state.armor > 0 && Object.values(p.weapons).some(w => /^(weapon_)?(ak47|m4a1|m4a1_silencer|aug|sg556|galilar|famas|awp|scar20|g3sg1)$/.test(w.name))).length;
  if (avg >= 4000 && armed >= 4) return "full";
  if (avg <= 1800 && armed <= 1) return "eco";
  return "half";
}
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/frame-cache.mjs
function sanitizeId(value) {
  const id = String(value || "unknown").trim().replace(/[^a-zA-Z0-9_.-]/g, "_");
  return id.slice(0, 100) || "unknown";
}
function roundIdFromFrame(frame, explicitRoundId) {
  return sanitizeId(
    explicitRoundId ?? frame?.state?.timeline?.round_id ?? frame?.state?.round_id ?? "unknown"
  );
}
var import_promises, import_node_fs, import_node_events, import_node_path, FrameCache;
var init_frame_cache = __esm({
  "src/frame-cache.mjs"() {
    import_promises = require("node:fs/promises");
    import_node_fs = require("node:fs");
    import_node_events = require("node:events");
    import_node_path = require("node:path");
    FrameCache = class {
      constructor({
        rootDir = (0, import_node_path.join)(process.cwd(), "temp"),
        matchId = "match",
        flushFrames = 15,
        fps = 30,
        wallClock = () => (/* @__PURE__ */ new Date()).toISOString()
      } = {}) {
        this.rootDir = rootDir;
        this.matchId = sanitizeId(matchId);
        this.flushFrames = flushFrames;
        this.fps = fps;
        this.wallClock = wallClock;
        this.matchDir = (0, import_node_path.join)(rootDir, `match_${this.matchId}`);
        this.roundsDir = (0, import_node_path.join)(this.matchDir, "rounds");
        this.framesDir = this.roundsDir;
        this.streams = /* @__PURE__ */ new Map();
        this.pending = /* @__PURE__ */ new Map();
        this.flushTasks = new Map();
        this.stats = /* @__PURE__ */ new Map();
        this.started = false;
      }
      async start() {
        if (this.started) return;
        await (0, import_promises.mkdir)(this.roundsDir, { recursive: true });
        try {
          const manifest = JSON.parse(await (0, import_promises.readFile)((0, import_node_path.join)(this.matchDir, "frames-manifest.json"), "utf8"));
          if (Array.isArray(manifest.rounds)) {
            for (const round of manifest.rounds) {
              if (round?.round_id) this.stats.set(sanitizeId(round.round_id), round);
            }
          }
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
        this.started = true;
        await this.#writeManifest();
      }
      append(frame, { roundId = null } = {}) {
        if (!this.started) throw new Error("FrameCache.start() must be called first");
        const id = roundIdFromFrame(frame, roundId);
        if (!this.pending.has(id)) this.pending.set(id, []);
        this.pending.get(id).push({
          frame_index: frame.frame_index,
          time_ns: frame.time_ns,
          time_ms: frame.time_ms,
          source_age_ms: frame.source_age_ms,
          stale: frame.stale,
          source_sequence: frame.source_sequence,
          state: frame.state,
          events: frame.events
        });
        const previous = this.stats.get(id);
        this.stats.set(id, {
          round_id: id,
          frames_written: (previous?.frames_written ?? 0) + 1,
          first_frame_index: previous?.first_frame_index ?? frame.frame_index,
          last_frame_index: frame.frame_index,
          first_time_ms: previous?.first_time_ms ?? frame.time_ms,
          last_time_ms: frame.time_ms
        });
        if (this.pending.get(id).length >= this.flushFrames) {
          void this.flushRound(id);
        }
      }
      async flushRound(roundId) {
        const id = sanitizeId(roundId);
        if (this.flushTasks.has(id)) return this.flushTasks.get(id);
        if (!this.pending.get(id)?.length) return;
        const task = (async () => {
          await (0, import_promises.mkdir)((0, import_node_path.join)(this.roundsDir, id), { recursive: true });
          const stream = this.#streamFor(id);
          while (this.pending.get(id)?.length) {
            const lines = this.pending.get(id);
            this.pending.set(id, []);
            const data = lines.map(line => JSON.stringify(line) + "\n").join("");
            if (!stream.write(data)) await (0, import_node_events.once)(stream, "drain");
          }
        })().finally(() => this.flushTasks.delete(id));
        this.flushTasks.set(id, task);
        return task;
      }
      async flush() {
        await Promise.all([...this.pending.keys()].map((roundId) => this.flushRound(roundId)));
      }
      async close() {
        if (!this.started) return;
        await this.flush();
        const streams = [...this.streams.values()];
        for (const stream of streams) stream.end();
        await Promise.all(streams.map((stream) => (0, import_node_events.once)(stream, "close")));
        await this.#writeManifest();
        this.streams.clear();
        this.started = false;
      }
      async readRound(roundId) {
        const id = sanitizeId(roundId);
        await this.flushRound(id);
        const paths = [
          (0, import_node_path.join)(this.roundsDir, id, "frames.ndjson"),
          // Read caches written by v0.1 without requiring a migration step.
          (0, import_node_path.join)(this.matchDir, "frames", `round_${id}.ndjson`)
        ];
        let text = null;
        for (const path2 of paths) {
          try {
            text = await (0, import_promises.readFile)(path2, "utf8");
            break;
          } catch (error) {
            if (error.code !== "ENOENT") throw error;
          }
        }
        if (text === null) return [];
        return text.trim() ? text.trim().split("\n").map((line) => JSON.parse(line)) : [];
      }
      async listRounds() {
        const roundIds = /* @__PURE__ */ new Set();
        try {
          const manifest = JSON.parse(await (0, import_promises.readFile)((0, import_node_path.join)(this.matchDir, "frames-manifest.json"), "utf8"));
          if (Array.isArray(manifest.rounds)) {
            for (const round of manifest.rounds) {
              if (round?.round_id) roundIds.add(round.round_id);
            }
          }
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
        try {
          const entries = await (0, import_promises.readdir)(this.roundsDir, { withFileTypes: true });
          for (const entry of entries) if (entry.isDirectory()) roundIds.add(entry.name);
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
        return [...roundIds].sort();
      }
      async loadRounds(roundIds = null) {
        const ids = roundIds ?? await this.listRounds();
        const rounds = [];
        for (const roundId of ids) rounds.push({ round_id: roundId, frames: await this.readRound(roundId) });
        return rounds;
      }
      #streamFor(roundId) {
        if (!this.streams.has(roundId)) {
          this.streams.set(
            roundId,
            (0, import_node_fs.createWriteStream)((0, import_node_path.join)(this.roundsDir, roundId, "frames.ndjson"), { flags: "a" })
          );
        }
        return this.streams.get(roundId);
      }
      async #writeManifest() {
        await (0, import_promises.writeFile)(
          (0, import_node_path.join)(this.matchDir, "frames-manifest.json"),
          `${JSON.stringify({
            match_id: this.matchId,
            updated_at: this.wallClock(),
            fps: this.fps,
            layout: "rounds/<round_id>/frames.ndjson",
            rounds: [...this.stats.values()]
          }, null, 2)}
`,
          "utf8"
        );
      }
    };
  }
});

// src/gsi-recorder.mjs
function sanitizeId2(value) {
  const id = String(value || "match").trim().replace(/[^a-zA-Z0-9_.-]/g, "_");
  return id.slice(0, 80) || "match";
}
function redactPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return payload;
  }
  const copy = { ...payload };
  if (copy.auth && typeof copy.auth === "object") {
    copy.auth = { ...copy.auth, token: "[redacted]" };
  }
  return copy;
}
function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * p;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}
async function readRequestBody(request, maxBytes) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maxBytes) {
      const error = new Error(`request body exceeds ${maxBytes} bytes`);
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}
function sendJson(response, statusCode, body) {
  const encoded = JSON.stringify(body);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(encoded),
    "cache-control": "no-store"
  });
  response.end(encoded);
}
var import_node_http, import_promises2, import_node_fs2, import_node_events2, import_node_path2, DEFAULT_MAX_BODY_BYTES, IntervalStats, GsiRecorder;
var init_gsi_recorder = __esm({
  "src/gsi-recorder.mjs"() {
    import_node_http = __toESM(require("node:http"), 1);
    import_promises2 = require("node:fs/promises");
    import_node_fs2 = require("node:fs");
    import_node_events2 = require("node:events");
    import_node_path2 = require("node:path");
    DEFAULT_MAX_BODY_BYTES = 2 * 1024 * 1024;
    IntervalStats = class {
      constructor(sampleLimit = 2e4) {
        this.sampleLimit = sampleLimit;
        this.samples = [];
        this.count = 0;
        this.sumMs = 0;
        this.minMs = null;
        this.maxMs = null;
      }
      add(intervalNs) {
        const intervalMs = Number(intervalNs) / 1e6;
        if (!Number.isFinite(intervalMs) || intervalMs < 0) return;
        this.count += 1;
        this.sumMs += intervalMs;
        this.minMs = this.minMs === null ? intervalMs : Math.min(this.minMs, intervalMs);
        this.maxMs = this.maxMs === null ? intervalMs : Math.max(this.maxMs, intervalMs);
        if (this.samples.length < this.sampleLimit) {
          this.samples.push(intervalMs);
        } else {
          const index = Math.floor(Math.random() * this.count);
          if (index < this.sampleLimit) this.samples[index] = intervalMs;
        }
      }
      summary() {
        return {
          count: this.count,
          min_ms: this.minMs,
          max_ms: this.maxMs,
          mean_ms: this.count ? this.sumMs / this.count : null,
          p50_ms: percentile(this.samples, 0.5),
          p95_ms: percentile(this.samples, 0.95),
          p99_ms: percentile(this.samples, 0.99)
        };
      }
    };
    GsiRecorder = class {
      constructor({
        tempDir = (0, import_node_path2.join)(process.cwd(), "temp"),
        matchId = `match-${(/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-")}`,
        token = process.env.GSI_TOKEN || "change-me",
        maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
        clock = () => process.hrtime.bigint(),
        wallClock = () => (/* @__PURE__ */ new Date()).toISOString(),
        onPacket = null
      } = {}) {
        this.tempDir = tempDir;
        this.matchId = sanitizeId2(matchId);
        this.token = token;
        this.maxBodyBytes = maxBodyBytes;
        this.clock = clock;
        this.wallClock = wallClock;
        this.onPacket = onPacket;
        this.startedNs = null;
        this.startedAt = null;
        this.lastReceivedNs = null;
        this.sequence = 0;
        this.packetCount = 0;
        this.authFailures = 0;
        this.invalidPayloads = 0;
        this.writeBackpressureEvents = 0;
        this.intervals = new IntervalStats();
        this.server = null;
        this.stream = null;
        this.address = null;
      }
      get matchDir() {
        return (0, import_node_path2.join)(this.tempDir, `match_${this.matchId}`);
      }
      async start({ host = "127.0.0.1", port = 31337 } = {}) {
        port=sdResolvePort(port,SD_GSI_PORT);
        if (this.server) throw new Error("GSI recorder is already running");
        await (0, import_promises2.mkdir)(this.matchDir, { recursive: true });
        this.stream = (0, import_node_fs2.createWriteStream)((0, import_node_path2.join)(this.matchDir, "raw.ndjson"), { flags: "a" });
        this.startedNs = this.clock();
        this.startedAt = this.wallClock();
        this.server = import_node_http.default.createServer((request, response) => {
          this.#handleRequest(request, response).catch((error) => {
            if (!response.headersSent) {
              sendJson(response, error.statusCode || 500, { ok: false, error: error.message });
            } else {
              response.destroy(error);
            }
          });
        });
        await new Promise((resolve2, reject) => {
          const onError = (error) => {
            this.server?.off("listening", onListening);
            reject(error);
          };
          const onListening = () => {
            this.server?.off("error", onError);
            resolve2();
          };
          this.server.once("error", onError);
          this.server.once("listening", onListening);
          this.server.listen(port, host);
        });
        this.address = this.server.address();
        await this.#writeDiagnostics();
        return this.address;
      }
      async #handleRequest(request, response) {
        if (request.method === "GET" && request.url === "/health") {
          sendJson(response, 200, { ok: true, ...this.diagnostics() });
          return;
        }
        if (request.method !== "POST" || !["/gsi", "/"].includes(request.url)) {
          sendJson(response, 404, { ok: false, error: "not found" });
          return;
        }
        const rawBody = await readRequestBody(request, this.maxBodyBytes);
        let payload;
        try {
          payload = JSON.parse(rawBody);
        } catch {
          this.invalidPayloads += 1;
          sendJson(response, 400, { ok: false, error: "invalid JSON" });
          return;
        }
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
          this.invalidPayloads += 1;
          sendJson(response, 400, { ok: false, error: "payload must be a JSON object" });
          return;
        }
        if (this.token && payload.auth?.token !== this.token) {
          this.authFailures += 1;
          sendJson(response, 401, { ok: false, error: "invalid GSI token" });
          return;
        }
        await cachePolicy?.ensure();
        const record = this.recordPayload(payload);
        sendJson(response, 200, {
          ok: true,
          sequence: record.sequence,
          received_ns: record.received_ns
        });
      }
      recordPayload(payload, receivedNs = this.clock(), receivedAt = this.wallClock()) {
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
          throw new TypeError("GSI payload must be a JSON object");
        }
        if (this.lastReceivedNs !== null) {
          this.intervals.add(receivedNs - this.lastReceivedNs);
        }
        this.lastReceivedNs = receivedNs;
        this.sequence += 1;
        this.packetCount += 1;
        const record = {
          sequence: this.sequence,
          received_ns: receivedNs.toString(),
          received_at: receivedAt,
          payload: redactPayload(payload)
        };
        if (this.stream) {
          const writable = this.stream.write(`${JSON.stringify(record)}
`);
          if (!writable) this.writeBackpressureEvents += 1;
        }
        if (this.onPacket) {
          queueMicrotask(() => {
            try {
              this.onPacket(record);
            } catch {
            }
          });
        }
        return record;
      }
      diagnostics() {
        return {
          match_id: this.matchId,
          match_dir: this.matchDir,
          started_at: this.startedAt,
          packet_count: this.packetCount,
          auth_failures: this.authFailures,
          invalid_payloads: this.invalidPayloads,
          write_backpressure_events: this.writeBackpressureEvents,
          interval: this.intervals.summary(),
          address: this.address
        };
      }
      async #writeDiagnostics() {
        await (0, import_promises2.writeFile)(
          (0, import_node_path2.join)(this.matchDir, "diagnostics.json"),
          `${JSON.stringify(this.diagnostics(), null, 2)}
`,
          "utf8"
        );
      }
      async stop() {
        if (!this.server && !this.stream) return;
        if (this.server) {
          await new Promise((resolve2, reject) => {
            this.server.close((error) => error ? reject(error) : resolve2());
          });
          this.server = null;
        }
        if (this.stream) {
          this.stream.end();
          await (0, import_node_events2.once)(this.stream, "close");
          this.stream = null;
        }
        await this.#writeDiagnostics();
      }
    };
  }
});

// src/radar-config.mjs
function normalizeMapName(value) {
  const raw = String(value ?? "").trim().toLowerCase().replaceAll("\\", "/");
  const leaf = raw.split("/").at(-1)?.replace(/\.bsp$/i, "") || "";
  if (MAPS[leaf]) return leaf;
  if (MAP_ALIASES[leaf]) return MAP_ALIASES[leaf];
  return leaf || "unknown_map";
}
function canonicalUtilityType(value) {
  const type = String(value ?? "").toLowerCase();
  if (type.includes("smoke")) return "smoke";
  if (type.includes("flash")) return "flashbang";
  if (type.includes("hegrenade") || type === "he" || type.includes("frag")) return "frag";
  if (type.includes("molotov") || type.includes("incgrenade") || type.includes("firebomb")) {
    return "firebomb";
  }
  if (type.includes("inferno")) return "inferno";
  if (type.includes("decoy")) return "decoy";
  return type || "unknown";
}
function getMapConfig(mapName) {
  return MAPS[normalizeMapName(mapName)] || MAPS.de_mirage;
}
function getLayers(config) {
  return config.layers || [{ id: "single", ...config }];
}
function layerForZ(config, z = 0) {
  return getLayers(config).find((layer) => {
    if (layer.minZ !== void 0 && z < layer.minZ) return false;
    if (layer.maxZ !== void 0 && z >= layer.maxZ) return false;
    return true;
  }) || getLayers(config)[0];
}
function roundRadar(value) {
  return Math.round(value / 0.02) * 0.02;
}
function radarPosition(mapName, worldPosition) {
  const position = Array.isArray(worldPosition) ? worldPosition : [0, 0, 0];
  const layer = layerForZ(getMapConfig(mapName), Number(position[2]) || 0);
  return {
    position: [
      roundRadar(layer.origin.x + position[0] * layer.pxPerUX),
      roundRadar(layer.origin.y + position[1] * layer.pxPerUY)
    ],
    layer: layer.id
  };
}
var MAPS, MAP_ALIASES, GRENADE_ICONS, UTILITY_TYPES;
var init_radar_config = __esm({
  "src/radar-config.mjs"() {
    MAPS = {
      de_mirage: {
        image: "radar-0f6c4bb0.png",
        origin: { x: 645.7196725473384, y: 340.2921393569175 },
        pxPerUX: 0.20118507589946494,
        pxPerUY: -0.20138282875746794
      },
      de_cache: {
        image: "radar-9ed7aced.png",
        origin: { x: 361.7243823603619, y: 579.553558767951 },
        pxPerUX: 0.1830927328891829,
        pxPerUY: -0.17650705879909936
      },
      de_dust2: {
        image: "radar-d2e673ab.png",
        origin: { x: 563.1339320329055, y: 736.9535330430065 },
        pxPerUX: 0.2278315639654376,
        pxPerUY: -0.22776482548619972
      },
      de_inferno: {
        image: "radar-230b60d6.png",
        origin: { x: 426.51386123945593, y: 790.7266981544722 },
        pxPerUX: 0.2041685571162696,
        pxPerUY: -0.20465735943851654
      },
      de_train: {
        image: "radar-63202ed1.png",
        origin: { x: 557.7279495268139, y: 507.83243734804853 },
        pxPerUX: 0.22712933753943218,
        pxPerUY: -0.23013108811174968
      },
      de_overpass: {
        image: "radar-5ec70095.png",
        origin: { x: 927.3988878244819, y: 343.8221009185496 },
        pxPerUX: 0.1923720959212443,
        pxPerUY: -0.19427507725530338
      },
      de_nuke: {
        image: "radar-e7a6de7b.png",
        layers: [
          {
            id: "high",
            minZ: -495,
            origin: { x: 473.1284773048749, y: 190 },
            pxPerUX: 0.14376095926926907 * 1.25,
            pxPerUY: -0.14736670935219626 * 1.25
          },
          {
            id: "low",
            maxZ: -495,
            origin: { x: 100, y: 570 },
            pxPerUX: 0.1436068746398272 * 1.25,
            pxPerUY: -0.14533406508526941 * 1.25
          }
        ]
      },
      de_vertigo: {
        image: "radar-f15cebdb.png",
        layers: [
          {
            id: "high",
            minZ: 11700,
            origin: { x: 784.4793452283254, y: 255.42597837029027 },
            pxPerUX: 0.19856123172015677,
            pxPerUY: -0.19820052722907044
          },
          {
            id: "low",
            maxZ: 11700,
            origin: { x: 780.5145858437052, y: 695.4259783702903 },
            pxPerUX: 0.1989615567841087,
            pxPerUY: -0.19820052722907044
          }
        ]
      },
      de_ancient: {
        image: "radar-257c12c3.png",
        origin: { x: 583.2590342775677, y: 428.92222042149115 },
        pxPerUX: 0.1983512056034216,
        pxPerUY: -0.20108163914549304
      },
      de_anubis: {
        image: "radar-d6f7b7b1.png",
        origin: { x: 540, y: 640 },
        pxPerUX: 0.1983512056034216,
        pxPerUY: -0.20108163914549304
      }
    };
    MAP_ALIASES = {
      ancient: "de_ancient",
      anubis: "de_anubis",
      cache: "de_cache",
      dust2: "de_dust2",
      inferno: "de_inferno",
      mirage: "de_mirage",
      nuke: "de_nuke",
      overpass: "de_overpass",
      train: "de_train",
      vertigo: "de_vertigo"
    };
    GRENADE_ICONS = {
      bomb: "bomb.png",
      smoke: "smoke.png",
      flashbang: "flash.png",
      frag: "frag.png",
      firebomb: "firebomb.png",
      inferno: "firebomb.png",
      decoy: "weapon_decoy.png"
    };
    UTILITY_TYPES = /* @__PURE__ */ new Set([
      "smoke",
      "flashbang",
      "frag",
      "firebomb",
      "inferno",
      "decoy"
    ]);
  }
});

// src/gsi-state.mjs
function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function clone(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}
function mergeGsiState(previous, patch) {
  const result = isPlainObject(previous) ? clone(previous) : {};
  if (!isPlainObject(patch)) return result;
  for (const [key, value] of Object.entries(patch)) {
    if (STATE_META_KEYS.has(key)) continue;
    if (value === null) {
      delete result[key];
    } else if (REPLACE_COLLECTION_KEYS.has(key) && isPlainObject(value)) {
      result[key] = clone(value);
    } else if (isPlainObject(value) && isPlainObject(result[key])) {
      result[key] = mergeGsiState(result[key], value);
    } else {
      result[key] = clone(value);
    }
  }
  return result;
}
function numberOrNull(value) {
  if (value === null || value === void 0 || value === "") return null;
  const number2 = Number(value);
  return Number.isFinite(number2) ? number2 : null;
}
function parseVector(value) {
  if (Array.isArray(value) && value.length >= 3) {
    const vector = value.slice(0, 3).map(numberOrNull);
    return vector.every((part) => part !== null) ? vector : null;
  }
  if (isPlainObject(value)) {
    const vector = [value.x ?? value.X, value.y ?? value.Y, value.z ?? value.Z].map(numberOrNull);
    return vector.every((part) => part !== null) ? vector : null;
  }
  if (typeof value === "string") {
    const parts = value.trim().split(/[\s,]+/).filter(Boolean).map(numberOrNull);
    return parts.length >= 3 && parts.slice(0, 3).every((part) => part !== null) ? parts.slice(0, 3) : null;
  }
  return null;
}
function asEntries(value) {
  if (Array.isArray(value)) return value.map((entry, index) => [String(index), entry]);
  if (isPlainObject(value)) return Object.entries(value);
  return [];
}
function normalizeSide(value) {
  return value === "CT" || value === "T" ? value : null;
}
function normalizePlayers(value) {
  return asEntries(value).map(([key, player]) => {
    const item = isPlainObject(player) ? player : {};
    const side = normalizeSide(item.team);
    return {
      entity_id: String(item.steamid ?? item.id ?? key),
      name: item.name ?? null,
      team: item.team ?? null,
      side,
      observer_slot: item.observer_slot ?? null,
      state: isPlainObject(item.state) ? clone(item.state) : null,
      position: parseVector(item.position ?? item.pos),
      forward: parseVector(item.forward ?? item.viewangles),
      weapons: item.weapons ?? null,
      raw: clone(item)
    };
  });
}
function flamePositions(grenade) {
  const raw = grenade?.flames ?? grenade?.raw?.flames;
  if (raw === undefined || raw === null) return null;
  return Object.values(raw).map(value => parseVector(value?.position ?? value)).filter(p => Array.isArray(p) && p.length >= 3 && p.every(Number.isFinite));
}
function utilityScale(mapName, worldPosition) {
  const layer = layerForZ(getMapConfig(mapName), worldPosition?.[2] || 0);
  return { x: Math.abs(layer.pxPerUX), y: Math.abs(layer.pxPerUY), layer: layer.id };
}
function normalizeGrenades(value, playerSides = /* @__PURE__ */ new Map()) {
  return asEntries(value).map(([key, grenade], index) => {
    const item = isPlainObject(grenade) ? grenade : {};
    const type = item.type ?? item.classname ?? item.weapon ?? null;
    const owner = item.owner ?? item.owner_id ?? item.steamid ?? null;
    const explicitId = item.id ?? item.entity_id ?? item.entityid ?? key;
    const entityId = String(explicitId || `${type ?? "grenade"}:${owner ?? "unknown"}:${index}`);
    const ownerId = owner === null || owner === void 0 ? null : String(owner);
    return {
      entity_id: entityId,
      type,
      owner: ownerId,
      side: ownerId ? playerSides.get(ownerId) ?? null : null,
      position: parseVector(item.position ?? item.pos) ?? flamePositions(item)?.[0] ?? null,
      flames: flamePositions(item),
      velocity: parseVector(item.velocity ?? item.vel),
      lifetime: numberOrNull(item.lifetime),
      effect_time: numberOrNull(item.effecttime ?? item.effect_time),
      state: item.state ?? null,
      raw: clone(item)
    };
  });
}
function diffGrenades(previous = [], current = []) {
  const before = new Map((Array.isArray(previous) ? previous : []).map((item) => [item.entity_id, item]));
  const after = new Map((Array.isArray(current) ? current : []).map((item) => [item.entity_id, item]));
  const events = [];
  for (const [entityId, grenade] of after) {
    if (!before.has(entityId)) {
      events.push({ type: "grenade_seen", entity_id: entityId, grenade_type: grenade.type, owner: grenade.owner });
      continue;
    }
    const old = before.get(entityId);
    if (old.effect_time === null && grenade.effect_time !== null) {
      events.push({
        type: "grenade_effect_time_reported",
        entity_id: entityId,
        effect_time: grenade.effect_time
      });
    }
    if (old.state !== grenade.state) {
      events.push({ type: "grenade_state_changed", entity_id: entityId, state: grenade.state });
    }
  }
  for (const [entityId, grenade] of before) {
    if (!after.has(entityId)) {
      events.push({ type: "grenade_disappeared", entity_id: entityId, grenade_type: grenade.type });
    }
  }
  return events;
}
function normalizeGsiState(state) {
  const map = isPlainObject(state.map) ? clone(state.map) : {};
  if (map.name !== void 0) map.name = normalizeMapName(map.name);
  const round = isPlainObject(state.round) ? clone(state.round) : {};
  const phaseCountdowns = isPlainObject(state.phase_countdowns) ? clone(state.phase_countdowns) : {};
  const grenadeSource = state.allgrenades ?? state.grenades ?? [];
  const players = normalizePlayers(state.allplayers);
  const playerSides = new Map(players.map((player) => [player.entity_id, player.side]));
  return {
    map,
    round,
    phase_countdowns: phaseCountdowns,
    player: isPlainObject(state.player) ? clone(state.player) : null,
    players,
    grenades: normalizeGrenades(grenadeSource, playerSides),
    bomb: isPlainObject(state.bomb) ? clone(state.bomb) : null,
    raw: clone(state)
  };
}
var STATE_META_KEYS, REPLACE_COLLECTION_KEYS, GsiStateMerger;
var init_gsi_state = __esm({
  "src/gsi-state.mjs"() {
    init_radar_config();
    STATE_META_KEYS = /* @__PURE__ */ new Set(["auth", "previously", "added", "removed"]);
    REPLACE_COLLECTION_KEYS = /* @__PURE__ */ new Set(["grenades", "allgrenades"]);
    GsiStateMerger = class {
      constructor() {
        this.state = {};
        this.revision = 0;
      }
      apply(payload, { sequence = null, receivedNs = null, receivedAt = null } = {}) {
        this.state = mergeGsiState(this.state, payload);
        this.revision += 1;
        return {
          revision: this.revision,
          sequence,
          received_ns: receivedNs,
          received_at: receivedAt,
          state: normalizeGsiState(this.state)
        };
      }
      snapshot() {
        return normalizeGsiState(this.state);
      }
    };
  }
});

// src/round-state.mjs
function clone2(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}
function finiteInteger(value) {
  const number2 = Number(value);
  return Number.isInteger(number2) && number2 >= 0 ? number2 : null;
}
function phaseFromState(state) {
  return String(
    state?.round?.phase ?? state?.map?.phase ?? state?.phase ?? "unknown"
  ).toLowerCase();
}
function roundNumberFromState(state) {
  return finiteInteger(
    state?.map?.round ?? state?.round?.number ?? state?.round?.round_number ?? state?.round_number
  );
}
var END_PHASES, LIVE_PHASES, RoundStateMachine;
var init_round_state = __esm({
  "src/round-state.mjs"() {
    END_PHASES = /* @__PURE__ */ new Set(["over", "gameover", "intermission"]);
    LIVE_PHASES = /* @__PURE__ */ new Set(["live"]);
    RoundStateMachine = class {
      constructor() {
        this.nextSyntheticNumber = 1;
        this.current = null;
        this.transitions = 0;
      }
      update({ timestampNs, state, sequence = null } = {}) {
        const timestamp = typeof timestampNs === "bigint" ? timestampNs : BigInt(timestampNs);
        const phase = phaseFromState(state);
        const explicitNumber = roundNumberFromState(state);
        const mapName = state?.map?.name ?? "unknown_map";
        const events = [];
        if (!this.current) {
          const number2 = explicitNumber ?? this.nextSyntheticNumber++;
          this.current = this.#createRound({ mapName, number: number2, timestamp, phase, sequence });
          events.push({ type: "round_started", round_id: this.current.round_id });
        } else if (mapName !== this.current.map_name || explicitNumber !== null && explicitNumber !== this.current.number || this.current.phase === "over" && !END_PHASES.has(phase)) {
          this.current.end_ns ??= timestamp;
          events.push({ type: "round_ended", round_id: this.current.round_id });
          const number2 = explicitNumber ?? this.nextSyntheticNumber++;
          this.current = this.#createRound({ mapName, number: number2, timestamp, phase, sequence });
          events.push({ type: "round_started", round_id: this.current.round_id });
        }
        if (phase !== this.current.phase) {
          const previousPhase = this.current.phase;
          this.current.phase = phase;
          this.current.phase_changes.push({ from: previousPhase, to: phase, timestamp_ns: timestamp.toString() });
          events.push({
            type: "phase_changed",
            round_id: this.current.round_id,
            from: previousPhase,
            to: phase
          });
        }
        if (LIVE_PHASES.has(phase) && this.current.live_start_ns === null) {
          this.current.live_start_ns = timestamp;
          events.push({ type: "live_started", round_id: this.current.round_id });
        }
        if (END_PHASES.has(phase) && this.current.end_ns === null) {
          this.current.end_ns = timestamp;
          events.push({ type: "round_ended", round_id: this.current.round_id });
        }
        const roundStartNs = this.current.start_ns;
        const liveStartNs = this.current.live_start_ns;
        return {
          round_id: this.current.round_id,
          number: this.current.number,
          map_name: this.current.map_name,
          phase,
          start_ns: roundStartNs.toString(),
          live_start_ns: liveStartNs === null ? null : liveStartNs.toString(),
          end_ns: this.current.end_ns === null ? null : this.current.end_ns.toString(),
          round_time_ms: Number(timestamp - roundStartNs) / 1e6,
          live_time_ms: liveStartNs === null ? null : Number(timestamp - liveStartNs) / 1e6,
          sequence,
          events,
          phase_changes: clone2(this.current.phase_changes)
        };
      }
      snapshot() {
        if (!this.current) return null;
        return {
          round_id: this.current.round_id,
          number: this.current.number,
          map_name: this.current.map_name,
          phase: this.current.phase,
          start_ns: this.current.start_ns.toString(),
          live_start_ns: this.current.live_start_ns?.toString() ?? null,
          end_ns: this.current.end_ns?.toString() ?? null,
          phase_changes: clone2(this.current.phase_changes)
        };
      }
      #createRound({ mapName, number: number2, timestamp, phase, sequence }) {
        return {
          round_id: `${mapName}:round_${String(number2).padStart(3, "0")}`,
          map_name: mapName,
          number: number2,
          phase,
          start_ns: timestamp,
          live_start_ns: LIVE_PHASES.has(phase) ? timestamp : null,
          end_ns: END_PHASES.has(phase) ? timestamp : null,
          phase_changes: [{ from: null, to: phase, timestamp_ns: timestamp.toString(), sequence }]
        };
      }
    };
  }
});

// src/synchronizer-30fps.mjs
function clone3(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}
function asNs(value) {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isFinite(value)) return BigInt(Math.round(value));
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  throw new TypeError("timestamp must be an integer nanosecond value");
}
function clampNonNegative(value) {
  return value < 0n ? 0n : value;
}
var NS_PER_SECOND, FrameSynchronizer;
var init_synchronizer_30fps = __esm({
  "src/synchronizer-30fps.mjs"() {
    NS_PER_SECOND = 1000000000n;
    FrameSynchronizer = class {
      constructor({
        fps = 30,
        bufferFrames = 1,
        clock = () => process.hrtime.bigint(),
        onFrame = null
      } = {}) {
        if (!Number.isInteger(fps) || fps <= 0 || fps > 240) {
          throw new RangeError("fps must be an integer between 1 and 240");
        }
        if (!Number.isInteger(bufferFrames) || bufferFrames < 0) {
          throw new RangeError("bufferFrames must be a non-negative integer");
        }
        this.fps = fps;
        this.bufferFrames = bufferFrames;
        this.frameDurationNs = NS_PER_SECOND / BigInt(fps);
        this.clock = clock;
        this.onFrame = onFrame;
        this.originNs = null;
        this.nextFrameIndex = 0;
        this.samples = [];
        this.sampleCursor = 0;
        this.lastSample = null;
        this.running = false;
        this.timer = null;
      }
      setOrigin(timestampNs) {
        if (this.originNs !== null) return this.originNs;
        this.originNs = asNs(timestampNs);
        return this.originNs;
      }
      addSnapshot({ timestampNs, state, events = [], sequence = null, source = "gsi" }) {
        const timestamp = asNs(timestampNs);
        this.setOrigin(timestamp);
        const sample = {
          timestamp_ns: timestamp,
          state: clone3(state),
          events: clone3(Array.isArray(events) ? events : [events]),
          sequence,
          source
        };
        let index = this.samples.length;
        while (index > this.sampleCursor && this.samples[index - 1].timestamp_ns > timestamp) {
          index -= 1;
        }
        this.samples.splice(index, 0, sample);
        return sample;
      }
      frameTimeNs(frameIndex) {
        if (this.originNs === null) return null;
        return this.originNs + BigInt(frameIndex) * this.frameDurationNs;
      }
      framesThrough(nowNs, { ignoreBuffer = false } = {}) {
        if (this.originNs === null) return [];
        const now = asNs(nowNs);
        const delay = ignoreBuffer ? 0n : BigInt(this.bufferFrames) * this.frameDurationNs;
        const cutoff = now - delay;
        const available = cutoff < this.originNs ? -1 : Number((cutoff - this.originNs) / this.frameDurationNs);
        const frames = [];
        while (this.nextFrameIndex <= available) {
          const frameIndex = this.nextFrameIndex;
          const frameTime = this.frameTimeNs(frameIndex);
          const frameEvents = [];
          while (this.sampleCursor < this.samples.length && this.samples[this.sampleCursor].timestamp_ns <= frameTime) {
            this.lastSample = this.samples[this.sampleCursor];
            frameEvents.push(...this.lastSample.events);
            this.sampleCursor += 1;
          }
          const sourceAgeNs = this.lastSample ? clampNonNegative(frameTime - this.lastSample.timestamp_ns) : null;
          frames.push({
            frame_index: frameIndex,
            time_ns: frameTime.toString(),
            time_ms: Number(frameTime - this.originNs) / 1e6,
            state: this.lastSample ? clone3(this.lastSample.state) : null,
            events: clone3(frameEvents),
            source_age_ms: sourceAgeNs === null ? null : Number(sourceAgeNs) / 1e6,
            stale: sourceAgeNs === null || sourceAgeNs > this.frameDurationNs * 2n,
            source_sequence: this.lastSample?.sequence ?? null
          });
          this.nextFrameIndex += 1;
        }
        this.#pruneConsumedSamples();
        return frames;
      }
      flush() {
        if (!this.samples.length) return [];
        const lastTimestamp = this.samples[this.samples.length - 1].timestamp_ns;
        return this.framesThrough(lastTimestamp + BigInt(this.bufferFrames) * this.frameDurationNs, {
          ignoreBuffer: false
        });
      }
      #pruneConsumedSamples() {
        if (this.sampleCursor <= 64) return;
        const keepFrom = this.sampleCursor - 1;
        this.samples = this.samples.slice(keepFrom);
        this.sampleCursor -= keepFrom;
      }
      start() {
        if (this.running) return;
        this.running = true;
        this.setOrigin(this.clock());
        const schedule = () => {
          if (!this.running) return;
          const now = this.clock();
          const frames = this.framesThrough(now);
          for (const frame of frames) this.onFrame?.(frame);
          const nextDue = (this.frameTimeNs(this.nextFrameIndex) ?? now) + BigInt(this.bufferFrames) * this.frameDurationNs;
          const delayMs = Math.max(0, Math.min(1e3, Number(nextDue - now) / 1e6));
          this.timer = setTimeout(schedule, delayMs);
        };
        schedule();
      }
      stop() {
        this.running = false;
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
      }
    };
  }
});

// src/gsi-pipeline.mjs
var GsiPipeline;
var init_gsi_pipeline = __esm({
  "src/gsi-pipeline.mjs"() {
    init_gsi_recorder();
    init_gsi_state();
    init_round_state();
    init_synchronizer_30fps();
    GsiPipeline = class {
      constructor({
        recorder = {},
        fps = 30,
        bufferFrames = 1,
        clock = () => process.hrtime.bigint(),
        onFrame = null,
        frameCache = null
      } = {}) {
        this.clock = clock;
        this.onFrame = onFrame;
        this.frameCache = frameCache;
        this.merger = new GsiStateMerger();
        this.rounds = new RoundStateMachine();
        this.synchronizer = new FrameSynchronizer({
          fps,
          bufferFrames,
          clock,
          onFrame: (frame) => this.#emitFrame(frame)
        });
        this.lastSnapshot = null;
        this.frameCount = 0;
        this.latestFrame = null;
        this.recorder = new GsiRecorder({
          ...recorder,
          clock,
          onPacket: (record) => this.#handleRecord(record)
        });
      }
      async start(options) {
        await this.frameCache?.start();
        return this.recorder.start(options);
      }
      ingestRecord(record) {
        const merged = this.merger.apply(record.payload, {
          sequence: record.sequence,
          receivedNs: BigInt(record.received_ns),
          receivedAt: record.received_at
        });
        const timeline = this.rounds.update({
          timestampNs: BigInt(record.received_ns),
          state: merged.state,
          sequence: record.sequence
        });
        const state = {
          ...merged.state,
          timeline,
          received_at: merged.received_at,
          gsi_revision: merged.revision
        };
        const grenadeEvents = diffGrenades(this.lastSnapshot?.state?.grenades, merged.state.grenades);
        const events = [...timeline.events, ...grenadeEvents].map((event) => ({
          ...event,
          sequence: record.sequence
        }));
        this.lastSnapshot = { ...merged, state, timeline };
        // Never keep a disappeared grenade alive from a previous merged GSI packet.
        grenadeTracker?.ingest({...state,grenades:record.payload.allgrenades||record.payload.grenades?state.grenades:[]});
        this.synchronizer.addSnapshot({
          timestampNs: BigInt(record.received_ns),
          state,
          events,
          sequence: record.sequence
        });
        if (!this.synchronizer.running) this.synchronizer.start();
      }
      #handleRecord(record) {
        if (this.cachePaused) return;
        this.ingestRecord(record);
      }
      #emitFrame(frame) {
        if (this.cachePaused) return;
        this.frameCount += 1;
        this.latestFrame = frame;
        this.frameCache?.append(frame);
        try {
          this.onFrame?.(frame);
        } catch {
        }
      }
      diagnostics() {
        return {
          ...this.recorder.diagnostics(),
          normalized_revision: this.merger.revision,
          output_frame_count: this.frameCount,
          current_round: this.rounds.snapshot()
        };
      }
      async stop() {
        this.synchronizer.stop();
        for (const frame of this.synchronizer.flush()) this.#emitFrame(frame);
        await this.recorder.stop();
        await this.frameCache?.close();
      }
    };
  }
});

// src/trajectory.mjs
function clone4(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}
function numberOrNull2(value) {
  if (value === null || value === void 0 || value === "") return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}
function validPosition(position) {
  return Array.isArray(position) && position.length >= 3 && position.slice(0, 3).every(Number.isFinite);
}
function distanceSquared(a, b) {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
}
function roundDetails(state) {
  const timeline = state?.timeline || {};
  const number2 = numberOrNull2(timeline.number ?? state?.map?.round ?? state?.round?.number);
  const mapName = normalizeMapName(timeline.map_name ?? state?.map?.name ?? "unknown_map");
  const roundId = String(timeline.round_id ?? `${mapName}:round_${String(number2 ?? 0).padStart(3, "0")}`);
  return { number: number2, mapName, roundId };
}
function sideForGrenade(grenade, playersById) {
  if (VALID_SIDES.has(grenade?.side)) return grenade.side;
  const owner = grenade?.owner === null || grenade?.owner === void 0 ? null : String(grenade.owner);
  const player = owner ? playersById.get(owner) : null;
  const side = player?.side ?? player?.team;
  return VALID_SIDES.has(side) ? side : null;
}
function halfForRound(roundNumber, halfRounds = 12) {
  const number2 = Number(roundNumber);
  if (!Number.isInteger(number2) || number2 < 0) return null;
  if (!Number.isInteger(halfRounds) || halfRounds < 1) throw new RangeError("halfRounds must be positive");
  return Math.floor(number2 / halfRounds) + 1;
}
function frameRoundStart(frame) {
  const live = frame.state?.timeline?.live_start_ns;
  if (live != null && frame.time_ns != null) return frame.time_ms - Number(BigInt(frame.time_ns) - BigInt(live)) / 1e6;
  const elapsed = frame.state?.timeline?.live_time_ms;
  return Number.isFinite(elapsed) ? frame.time_ms - elapsed - (frame.source_age_ms || 0) : null;
}
var VALID_SIDES, UtilityTrajectoryStore;
var init_trajectory = __esm({
  "src/trajectory.mjs"() {
    init_radar_config();
    VALID_SIDES = /* @__PURE__ */ new Set(["CT", "T"]);
    UtilityTrajectoryStore = class {
      constructor({ halfRounds = 12, minDistance = 0, keepEveryFrames = 30, maxPoints = 4096 } = {}) {
        if (!Number.isInteger(halfRounds) || halfRounds < 1) {
          throw new RangeError("halfRounds must be a positive integer");
        }
        if (!(minDistance >= 0) || !Number.isFinite(minDistance)) {
          throw new RangeError("minDistance must be a non-negative number");
        }
        if (!Number.isInteger(keepEveryFrames) || keepEveryFrames < 1) {
          throw new RangeError("keepEveryFrames must be a positive integer");
        }
        if (!Number.isInteger(maxPoints) || maxPoints < 2) {
          throw new RangeError("maxPoints must be at least 2");
        }
        this.halfRounds = halfRounds;
        this.minDistanceSquared = minDistance ** 2;
        this.keepEveryFrames = keepEveryFrames;
        this.maxPoints = maxPoints;
        this.trajectories = /* @__PURE__ */ new Map();
        this.roundBuys = new Map();
      }
      update(frame) {
        const state = frame?.state;
        if (!state) return;
        const { number: number2, mapName, roundId } = roundDetails(state);
        const phase = state.phase_countdowns?.phase ?? state.round?.phase;
        let buy = this.roundBuys.get(roundId);
        if (!buy) { buy = {CT:"unknown", T:"unknown", locked:false, seenFreeze:false}; this.roundBuys.set(roundId,buy); }
        if (!buy.locked) {
          if (phase === "freezetime") {
            buy.seenFreeze = true;
            for (const side of ["CT","T"]) buy[side] = classifyBuy(state.players || [],side);
          } else if (phase === "live") {
            if (buy.seenFreeze) for (const side of ["CT","T"]) {
              const value = classifyBuy(state.players || [],side);
              if (value !== "unknown") buy[side] = value;
            }
            buy.locked = true;
          }
        }
        const half = halfForRound(number2, this.halfRounds);
        if (half === null) return;
        const playersById = new Map(
          (Array.isArray(state.players) ? state.players : []).map((player) => [String(player.entity_id), player])
        );
        for (const grenade of Array.isArray(state.grenades) ? state.grenades : []) {
          const utilityType = canonicalUtilityType(grenade.type);
          if (!UTILITY_TYPES.has(utilityType) || !validPosition(grenade.position)) continue;
          const entityId = String(grenade.entity_id ?? grenade.id ?? "utility");
          const key = `${mapName}:${roundId}:${entityId}`;
          const side = sideForGrenade(grenade, playersById);
          let trajectory = this.trajectories.get(key);
          if (!trajectory) {
            trajectory = {
              id: key,
              entity_id: entityId,
              round_id: roundId,
              round_number: number2,
              half,
              map_name: mapName,
              type: utilityType,
              source_type: grenade.type ?? utilityType,
              owner: grenade.owner ?? null,
              side,
              economy: buy[side] || "unknown",
              round_started_time_ms: frameRoundStart(frame),
              detonation_time_ms: null,
              detonation_position: null,
              points: [],
              started_frame: frame.frame_index,
              started_time_ms: numberOrNull2(frame.time_ms),
              last_frame: frame.frame_index,
              last_time_ms: numberOrNull2(frame.time_ms),
              ended_frame: null,
              ended_time_ms: null,
              end_reason: null,
              last_state: null
            };
            this.trajectories.set(key, trajectory);
          } else if (!trajectory.side && side) {
            trajectory.side = side;
          }
          const position = grenade.position.slice(0, 3).map(Number);
          const flames = flamePositions(grenade);
          if (flames !== null) {
            trajectory.flame_frames ||= [];
            const previous = trajectory.flame_frames.at(-1);
            if (!previous || JSON.stringify(previous.positions) !== JSON.stringify(flames)) {
              trajectory.flame_frames.push({time_ms: frame.time_ms, positions: flames});
            }
          }
          if (trajectory.round_started_time_ms === null) trajectory.round_started_time_ms = frameRoundStart(frame);
          const detonated = utilityType === "inferno" || (utilityType === "smoke" && Number(grenade.effect_time) > 0) || grenade.state === "exploded";
          if (detonated && trajectory.detonation_time_ms === null) {
            trajectory.detonation_time_ms = frame.time_ms;
            trajectory.detonation_position = position.slice();
          }
          const lastPoint = trajectory.points.at(-1);
          const stateChanged = trajectory.last_state !== (grenade.state ?? null);
          const moved = !lastPoint || distanceSquared(lastPoint.world_position, position) > this.minDistanceSquared;
          const keepAlive = lastPoint && frame.frame_index - lastPoint.frame_index >= this.keepEveryFrames;
          if (moved || stateChanged || keepAlive) {
            trajectory.points.push({
              frame_index: frame.frame_index,
              time_ms: numberOrNull2(frame.time_ms),
              world_position: position,
              state: grenade.state ?? null
            });
            if (trajectory.points.length > this.maxPoints) {
              trajectory.points.splice(1, trajectory.points.length - this.maxPoints);
            }
          }
          trajectory.last_frame = frame.frame_index;
          trajectory.last_time_ms = numberOrNull2(frame.time_ms);
          trajectory.last_state = grenade.state ?? null;
          if (grenade.owner !== null && grenade.owner !== void 0) trajectory.owner = String(grenade.owner);
        }
        for (const event of Array.isArray(frame.events) ? frame.events : []) {
          if (event?.type !== "grenade_disappeared") continue;
          const key = `${mapName}:${roundId}:${String(event.entity_id)}`;
          const trajectory = this.trajectories.get(key);
          if (trajectory && trajectory.ended_frame === null) {
            trajectory.ended_frame = frame.frame_index;
            trajectory.ended_time_ms = numberOrNull2(frame.time_ms);
            trajectory.end_reason = "disappeared";
          }
        }
      }
      addFrames(frames) {
        for (const frame of Array.isArray(frames) ? frames : []) this.update(frame);
      }
      async loadCache(cache, roundIds = null) {
        if (!cache || typeof cache.readRound !== "function") {
          throw new TypeError("cache must expose readRound(roundId)");
        }
        const ids = roundIds ?? (typeof cache.listRounds === "function" ? await cache.listRounds() : []);
        let frameCount = 0;
        for (const roundId of ids) {
          const frames = await cache.readRound(roundId);
          this.addFrames(frames);
          frameCount += frames.length;
        }
        return frameCount;
      }
      snapshot({ half = null, mapName = null } = {}) {
        return [...this.trajectories.values()].filter((trajectory) => half === null || trajectory.half === Number(half)).filter((trajectory) => mapName === null || trajectory.map_name === mapName).filter((trajectory) => trajectory.points.length > 0).sort((a, b) => a.started_frame - b.started_frame).map((trajectory) => ({
          id: trajectory.id,
          entity_id: trajectory.entity_id,
          round_id: trajectory.round_id,
          round_number: trajectory.round_number,
          half: trajectory.half,
          map_name: trajectory.map_name,
          type: trajectory.type,
          source_type: trajectory.source_type,
          owner: trajectory.owner,
          side: trajectory.side,
          economy: trajectory.economy ?? "unknown",
          round_started_time_ms: trajectory.round_started_time_ms,
          detonation_time_ms: trajectory.detonation_time_ms,
          detonation_position: trajectory.detonation_position,
          flame_frames: clone4(trajectory.flame_frames || []),
          started_frame: trajectory.started_frame,
          started_time_ms: trajectory.started_time_ms,
          last_frame: trajectory.last_frame,
          last_time_ms: trajectory.last_time_ms,
          ended_frame: trajectory.ended_frame,
          ended_time_ms: trajectory.ended_time_ms,
          end_reason: trajectory.end_reason,
          points: clone4(trajectory.points)
        }));
      }
      summary({ half = null, mapName = null } = {}) {
        const paths = this.snapshot({ half, mapName });
        return {
          half: half === null ? null : Number(half),
          trajectories: paths.length,
          ct: paths.filter((path2) => path2.side === "CT").length,
          t: paths.filter((path2) => path2.side === "T").length,
          unknown: paths.filter((path2) => !VALID_SIDES.has(path2.side)).length
        };
      }
    };
  }
});

// src/radar-state.mjs
function number(value, fallback = null) {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
}
function validPosition2(position) {
  return Array.isArray(position) && position.length >= 3 && position.slice(0, 3).every(Number.isFinite);
}
function sideFromPlayer(players, id) {
  if (id === null || id === void 0) return null;
  const player = players.find((item) => String(item.entity_id) === String(id));
  return player?.side ?? player?.team ?? null;
}
function activeLayerForState(state, mapName) {
  const map = getMapConfig(mapName);
  if (!map.layers) return "single";
  const observedId = state?.player?.steamid ?? state?.player?.entity_id;
  const players = Array.isArray(state?.players) ? state.players : [];
  const observed = players.find((player) => String(player.entity_id) === String(observedId)) || players[0];
  const position = observed?.position;
  return layerForZ(map, validPosition2(position) ? position[2] : 0).id;
}
function propState(type, grenade) {
  const lifetime = number(grenade?.lifetime, 0);
  const effectTime = number(grenade?.effect_time, 0);
  if (type === "inferno") return "landed";
  if (type === "smoke") return effectTime === 0 ? "inair" : effectTime >= 16.5 ? "exploded" : "landed";
  if (type === "frag" && lifetime >= 1.6) return "exploded";
  if (type === "flashbang" && lifetime >= 1.45) return "exploded";
  return "inair";
}
function normalizedProp(grenade, mapName, activeLayer, players) {
  if (!validPosition2(grenade?.position)) return null;
  const type = canonicalUtilityType(grenade.type);
  if (!GRENADE_ICONS[type]) return null;
  const mapped = radarPosition(mapName, grenade.position);
  const side = grenade.side || sideFromPlayer(players, grenade.owner);
  return {
    id: String(grenade.entity_id ?? "utility"),
    type,
    icon: GRENADE_ICONS[type],
    state: propState(type, grenade),
    side,
    owner: grenade.owner ?? null,
    position: mapped.position,
    worldPosition: grenade.position.slice(0, 3),
    range_scale: utilityScale(mapName, grenade.position),
    flames: flamePositions(grenade)?.map(position => ({...radarPosition(mapName, position), scale: utilityScale(mapName, position)})) ?? null,
    layer: mapped.layer,
    visible: activeLayer ? mapped.layer === activeLayer : true,
    lifetime: grenade.lifetime,
    effecttime: grenade.effect_time
  };
}
function normalizedBomb(bomb, mapName, activeLayer, players) {
  const worldPosition = parseVector(bomb?.position);
  if (!validPosition2(worldPosition)) return null;
  const mapped = radarPosition(mapName, worldPosition);
  const carrier = bomb.player ?? bomb.player_id ?? null;
  return {
    id: "bomb",
    type: "bomb",
    icon: GRENADE_ICONS.bomb,
    state: bomb.state ?? "unknown",
    side: sideFromPlayer(players, carrier),
    owner: carrier,
    player: carrier,
    position: mapped.position,
    worldPosition,
    layer: mapped.layer,
    visible: activeLayer ? mapped.layer === activeLayer : true,
    countdown: number(bomb.countdown)
  };
}
function mappedTrajectories(trajectories, mapName) {
  return trajectories.map((trajectory) => ({
    id: trajectory.id,
    entity_id: trajectory.entity_id,
    round_id: trajectory.round_id,
    round_number: trajectory.round_number,
    half: trajectory.half,
    map_name: trajectory.map_name,
    type: trajectory.type,
    source_type: trajectory.source_type,
    owner: trajectory.owner,
    side: trajectory.side,
    economy: trajectory.economy ?? "unknown",
    round_started_time_ms: trajectory.round_started_time_ms,
    detonation_time_ms: trajectory.detonation_time_ms,
    detonation_position: trajectory.detonation_position ? radarPosition(mapName, trajectory.detonation_position).position : null,
    range_scale: utilityScale(mapName, trajectory.detonation_position || trajectory.points.at(-1)?.world_position),
    flame_frames: (trajectory.flame_frames || []).map(frame => ({ time_ms: frame.time_ms, points: frame.positions.map(position => ({...radarPosition(mapName, position), scale: utilityScale(mapName, position)})) })),
    started_frame: trajectory.started_frame,
    started_time_ms: trajectory.started_time_ms,
    last_frame: trajectory.last_frame,
    last_time_ms: trajectory.last_time_ms,
    ended_frame: trajectory.ended_frame,
    ended_time_ms: trajectory.ended_time_ms,
    end_reason: trajectory.end_reason,
    points: trajectory.points.map((point) => {
      const mapped = radarPosition(mapName, point.world_position);
      return {
        frame_index: point.frame_index,
        time_ms: point.time_ms,
        position: mapped.position,
        worldPosition: point.world_position,
        layer: mapped.layer,
        state: point.state
      };
    })
  }));
}
function replaySummary(trajectories, currentTimeMs = null) {
  const startTimes = [];
  const endTimes = [];
  const rounds = /* @__PURE__ */ new Set();
  for (const trajectory of trajectories) {
    if (Number.isFinite(trajectory.round_number)) rounds.add(trajectory.round_number);
    const firstPoint = trajectory.points[0];
    const lastPoint = trajectory.points.at(-1);
    const started = Number(trajectory.started_time_ms ?? firstPoint?.time_ms);
    const ended = Number(trajectory.ended_time_ms ?? trajectory.last_time_ms ?? lastPoint?.time_ms);
    if (Number.isFinite(started)) startTimes.push(started);
    if (Number.isFinite(ended)) endTimes.push(ended);
  }
  const startTimeMs = startTimes.length ? Math.min(...startTimes) : null;
  const endTimeMs = endTimes.length ? Math.max(...endTimes) : null;
  return {
    available: startTimeMs !== null && endTimeMs !== null && endTimeMs >= startTimeMs,
    startTimeMs,
    endTimeMs,
    durationMs: startTimeMs === null || endTimeMs === null ? 0 : endTimeMs - startTimeMs,
    currentTimeMs: Number.isFinite(Number(currentTimeMs)) ? Number(currentTimeMs) : null,
    rounds: [...rounds].sort((a, b) => a - b)
  };
}
function emptyHudState({ half = 1, fps = 30 } = {}) {
  const mapName = "de_mirage";
  return {
    connected: false,
    source: "waiting",
    fps,
    frameIndex: null,
    receivedAt: null,
    phase: null,
    roundNumber: null,
    gameTime: null,
    phaseEndsIn: null,
    map: {
      name: mapName,
      assetMap: mapName,
      imageUrl: `/assets/${getMapConfig(mapName).image}`,
      phase: "waiting",
      round: null,
      activeLayer: "single",
      layers: getLayers(getMapConfig(mapName)).map((layer) => ({ id: layer.id, minZ: layer.minZ, maxZ: layer.maxZ }))
    },
    players: [],
    props: [],
    trajectoryHalf: Number(half) || 1,
    trajectories: [],
    replay: replaySummary([]),
    trajectorySummary: { half: Number(half) || 1, trajectories: 0, ct: 0, t: 0, unknown: 0 }
  };
}
function hudStateFromFrame(frame, trajectoryStore, { half = null, fps = 30, source = "gsi", connected = true } = {}) {
  const state = frame?.state || {};
  const mapName = normalizeMapName(state.map?.name || "de_mirage");
  const mapConfig = getMapConfig(mapName);
  const players = Array.isArray(state.players) ? state.players : [];
  const activeLayer = activeLayerForState(state, mapName);
  const currentRound = number(state.timeline?.number ?? state.map?.round ?? state.round?.number);
  const currentHalf = halfForRound(currentRound, trajectoryStore?.halfRounds ?? 12) ?? 1;
  const selectedHalf = half === null ? currentHalf : Number(half);
  const phase = String(
    state.phase_countdowns?.phase ?? state.round?.phase ?? state.map?.phase ?? "unknown"
  );
  const props = [];
  for (const grenade of Array.isArray(state.grenades) ? state.grenades : []) {
    const prop = normalizedProp(grenade, mapName, activeLayer, players);
    if (prop) props.push(prop);
  }
  const bomb = normalizedBomb(state.bomb, mapName, activeLayer, players);
  if (bomb) props.push(bomb);
  const trajectories = trajectoryStore ? trajectoryStore.snapshot({ half: selectedHalf, mapName }) : [];
  const mapped = mappedTrajectories(trajectories, mapName);
  const layers = getLayers(mapConfig).map((layer) => ({
    id: layer.id,
    minZ: layer.minZ,
    maxZ: layer.maxZ
  }));
  return {
    connected,
    source,
    fps,
    frameIndex: frame.frame_index,
    receivedAt: state.received_at ?? null,
    timeMs: frame.time_ms,
    sourceAgeMs: frame.source_age_ms,
    stale: Boolean(frame.stale),
    phase,
    roundNumber: currentRound,
    gameTime: number(state.phase_countdowns?.phase_ends_in),
    phaseEndsIn: number(state.phase_countdowns?.phase_ends_in),
    map: {
      name: mapName,
      assetMap: MAPS[mapName] ? mapName : "de_mirage",
      imageUrl: `/assets/${mapConfig.image}`,
      phase: state.map?.phase ?? phase,
      round: number(state.map?.round ?? currentRound),
      activeLayer,
      layers,
      teamCT: state.map?.team_ct ?? null,
      teamT: state.map?.team_t ?? null
    },
    players: players.filter(p => validPosition2(p.position) && ["CT", "T"].includes(p.side) && Number(p.state?.health) > 0).map(p => {
      const mapped = radarPosition(mapName, p.position);
      return { id: p.entity_id, side: p.side, position: mapped.position, layer: mapped.layer, visible: mapped.layer === activeLayer };
    }),
    props,
    trajectoryHalf: selectedHalf,
    trajectories: mapped,
    replay: replaySummary(mapped, frame.time_ms),
    trajectorySummary: trajectoryStore?.summary({ half: selectedHalf, mapName }) ?? {
      half: selectedHalf,
      trajectories: mapped.length,
      ct: mapped.filter((path2) => path2.side === "CT").length,
      t: mapped.filter((path2) => path2.side === "T").length,
      unknown: mapped.filter((path2) => path2.side !== "CT" && path2.side !== "T").length
    }
  };
}
var init_radar_state = __esm({
  "src/radar-state.mjs"() {
    init_gsi_state();
    init_radar_config();
    init_trajectory();
  }
});

// src/hud-server.mjs
function parseHalf(value, fallback = 1) {
  const result = Number(value);
  return Number.isInteger(result) && result >= 1 ? result : fallback;
}
function contentType(filePath) {
  return {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".ttf": "font/ttf",
    ".svg": "image/svg+xml"
  }[(0, import_node_path3.extname)(filePath).toLowerCase()] || "application/octet-stream";
}
function sendJson2(response, statusCode, value) {
  const body = JSON.stringify(value);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store"
  });
  response.end(body);
}
function sendFile(response, filePath) {
  response.writeHead(200, {
    "content-type": contentType(filePath),
    "cache-control": "no-cache"
  });
  (0, import_node_fs3.createReadStream)(filePath).on("error", () => response.destroy()).pipe(response);
}
async function serveFile(response, filePath) {
  try {
    await (0, import_promises3.readFile)(filePath);
    sendFile(response, filePath);
  } catch (error) {
    if (error.code === "ENOENT") {
      sendJson2(response, 404, { ok: false, error: "not found" });
      return;
    }
    response.destroy(error);
  }
}
function serveAsset(response, directory, requestPath) {
  const name = (0, import_node_path3.basename)(requestPath);
  if (!name || name !== requestPath.split("/").pop()) {
    sendJson2(response, 400, { ok: false, error: "invalid asset path" });
    return;
  }
  void serveFile(response, (0, import_node_path3.join)(directory, name));
}
function restoredFrameForHalf(trajectoryStore, half) {
  const trajectories = trajectoryStore?.snapshot?.({ half }) ?? [];
  if (!trajectories.length) return null;
  const latest = trajectories.reduce((result, trajectory) => {
    const candidate = Number(trajectory.last_time_ms ?? trajectory.ended_time_ms ?? trajectory.points.at(-1)?.time_ms);
    return Number.isFinite(candidate) && candidate > result.timeMs ? { timeMs: candidate, trajectory } : result;
  }, { timeMs: 0, trajectory: trajectories[0] });
  const roundNumber = Number(latest.trajectory.round_number);
  const mapName = latest.trajectory.map_name || "de_mirage";
  return {
    frame_index: Number(latest.trajectory.last_frame ?? 0),
    time_ms: latest.timeMs,
    source_age_ms: null,
    stale: true,
    state: {
      map: { name: mapName, phase: "replay", round: Number.isInteger(roundNumber) ? roundNumber : null },
      round: { phase: "replay" },
      phase_countdowns: { phase: "replay" },
      player: null,
      players: [],
      grenades: [],
      bomb: null,
      timeline: {
        round_id: latest.trajectory.round_id,
        number: Number.isInteger(roundNumber) ? roundNumber : null,
        map_name: mapName
      }
    },
    events: []
  };
}
var import_node_http2, import_promises3, import_node_fs3, import_node_url, import_node_path3, import_meta, PUBLIC_DIR, HudServer;
var init_hud_server = __esm({
  "src/hud-server.mjs"() {
    import_node_http2 = __toESM(require("node:http"), 1);
    import_promises3 = require("node:fs/promises");
    import_node_fs3 = require("node:fs");
    import_node_url = require("node:url");
    import_node_path3 = require("node:path");
    init_radar_state();
    init_radar_config();
    import_meta = {};
    PUBLIC_DIR = process.env.RADAR_HUD_PUBLIC_DIR ? (0, import_node_path3.resolve)(process.env.RADAR_HUD_PUBLIC_DIR) : (0, import_node_url.fileURLToPath)(new URL("../public/", import_meta.url));
    HudServer = class {
      constructor({
        host = "127.0.0.1",
        port = 23416,
        trajectoryStore,
        frameCache = null,
        fps = 30,
        matchId = null
      } = {}) {
        this.host = host;
        this.port = sdResolvePort(port,SD_HUD_PORT);
        this.trajectoryStore = trajectoryStore;
        this.frameCache = frameCache;
        this.fps = fps;
        this.matchId = matchId;
        this.latestFrame = null;
        this.displaySettings = { revision:0, layer: "all", showPlayers: false, texts: {}, buys: {}, half: 1, fade: 3, replay: false, playing: false, offset: 0 };
        this.displaySettingsFile = process.env.GSI_TEMP_DIR ? require('node:path').join(process.env.GSI_TEMP_DIR,'display-settings.json') : null;
        if(this.displaySettingsFile)try{this.displaySettings={...this.displaySettings,...JSON.parse(require('node:fs').readFileSync(this.displaySettingsFile,'utf8'))};}catch{}

        this.clients = /* @__PURE__ */ new Set();
        this.server = null;
        this.address = null;
      }
      updateFrame(frame) {
        this.latestFrame = frame;
        this.broadcast();
      }
      stateForHalf(half) {
        if (!this.latestFrame) {
          const restored = restoredFrameForHalf(this.trajectoryStore, half);
          return restored ? hudStateFromFrame(restored, this.trajectoryStore, {
            half,
            fps: this.fps,
            source: "cache",
            connected: false
          }) : emptyHudState({ half, fps: this.fps });
        }
        return hudStateFromFrame(this.latestFrame, this.trajectoryStore, { half, fps: this.fps });
      }
      async start() {
        if (this.server) throw new Error("HUD server is already running");
        this.server = import_node_http2.default.createServer((request, response) => {
          this.#handleRequest(request, response).catch((error) => {
            if (!response.headersSent) sendJson2(response, 500, { ok: false, error: error.message });
            else response.destroy(error);
          });
        });
        await new Promise((resolve2, reject) => {
          const onError = (error) => {
            this.server?.off("listening", onListening);
            reject(error);
          };
          const onListening = () => {
            this.server?.off("error", onError);
            resolve2();
          };
          this.server.once("error", onError);
          this.server.once("listening", onListening);
          this.server.listen(this.port, this.host);
        });
        this.address = this.server.address();
        return this.address;
      }
      async #handleRequest(request, response) {
        const requestUrl = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
        const pathname = requestUrl.pathname;
        if (pathname === '/api/cache/clear') {
          if (request.method !== 'POST') { sendJson2(response, 405, {error:'method'}); return; }
          if ((request.headers.origin && request.headers.origin !== requestUrl.origin) || request.headers['x-radar-cache'] !== 'clear') {
            sendJson2(response, 403, {error:'origin'}); return;
          }
          const result = await cachePolicy.ensure(true);
          sendJson2(response, 200, result); return;
        }
        if (pathname.startsWith('/api/') || pathname === '/events') await cachePolicy?.ensure();
        if(handleTrackerRequest && await handleTrackerRequest(request,response,requestUrl))return;
        if (request.method === "GET" && (pathname === "/" || pathname === "/output")) {
          await serveFile(response, (0, import_node_path3.join)(PUBLIC_DIR, "index.html"));
          return;
        }
        if (request.method === "GET" && pathname === "/app.js") {
          await serveFile(response, (0, import_node_path3.join)(PUBLIC_DIR, "app.js"));
          return;
        }
        if (request.method === "GET" && pathname === "/style.css") {
          await serveFile(response, (0, import_node_path3.join)(PUBLIC_DIR, "style.css"));
          return;
        }
        if (request.method === "GET" && pathname.startsWith("/assets/")) {
          serveAsset(response, (0, import_node_path3.join)(PUBLIC_DIR, "assets"), pathname.slice("/assets/".length));
          return;
        }
        if (request.method === "GET" && pathname.startsWith("/grenades/")) {
          serveAsset(response, (0, import_node_path3.join)(PUBLIC_DIR, "grenades"), pathname.slice("/grenades/".length));
          return;
        }
        if (pathname === "/api/display") {
          if (request.method === "GET") { sendJson2(response, 200, this.displaySettings); return; }
          if (request.method === "POST") {
            if (request.headers.origin && request.headers.origin !== requestUrl.origin) { sendJson2(response, 403, {error:"origin"}); return; }
            let body = "";
            for await (const chunk of request) { body += chunk; if (body.length > 16384) { sendJson2(response, 413, {error:"too large"}); return; } }
            let value; try { value = JSON.parse(body); } catch { sendJson2(response, 400, {error:"invalid JSON"}); return; }
            if (!value || typeof value !== "object" || Array.isArray(value)) { sendJson2(response, 400, {error:"invalid settings"}); return; }
            if(Array.isArray(value.changes)){
              if(value.changes.length>100){sendJson2(response,400,{error:'too many changes'});return;}
              const draft=structuredClone(this.displaySettings);
              for(const c of value.changes){
                if(!Array.isArray(c.path)||c.path.length<1||c.path.length>2||c.path.some(k=>typeof k!=='string'||['__proto__','prototype','constructor'].includes(k))||!['showPlayers','replay','playing','texts','buys','layer','half','fade','offset'].includes(c.path[0])||(c.path.length===2&&!['texts','buys'].includes(c.path[0]))){sendJson2(response,400,{error:'invalid path'});return;}
                const current=c.path.reduce((o,k)=>o?.[k],this.displaySettings);
                if(c.missingBefore?current!==undefined:JSON.stringify(current)!==JSON.stringify(c.before)){sendJson2(response,409,{error:'另一控制页已修改该设置，请重试',current:this.displaySettings});return;}
                if(c.path.length===1)draft[c.path[0]]=c.after;else{draft[c.path[0]]={...draft[c.path[0]],[c.path[1]]:c.after};}
              }
              value=draft;
            }
            for (const key of ["showPlayers", "replay", "playing"]) if (typeof value[key] === "boolean") this.displaySettings[key] = value[key];
            for (const key of ["texts", "buys"]) if (value[key] && typeof value[key] === "object") this.displaySettings[key] = Object.fromEntries(Object.entries(value[key]).filter(([k,v]) => /^[a-zA-Z0-9-]+$/.test(k) && typeof v === "boolean"));
            if (["all", "low", "high"].includes(value.layer)) this.displaySettings.layer = value.layer;
            if ([1,2].includes(value.half)) this.displaySettings.half = value.half;
            if (Number.isFinite(value.fade)) this.displaySettings.fade = Math.max(0, Math.min(60, value.fade));
            if (Number.isFinite(value.offset)) this.displaySettings.offset = Math.max(0, value.offset);
            this.displaySettings.revision=(this.displaySettings.revision||0)+1;
            this.displaySettings.updatedAt = Date.now();
            if(this.displaySettingsFile){const fs=require('node:fs');fs.mkdirSync(require('node:path').dirname(this.displaySettingsFile),{recursive:true});fs.writeFileSync(this.displaySettingsFile+'.tmp',JSON.stringify(this.displaySettings));fs.renameSync(this.displaySettingsFile+'.tmp',this.displaySettingsFile);}

            this.broadcast();
            sendJson2(response, 200, this.displaySettings); return;
          }
          sendJson2(response, 405, {error:"method"}); return;
        }
        if (request.method === "GET" && pathname === "/api/phase") {
          const f = this.latestFrame, s = f?.state, m = s?.map;
          sendJson2(response, 200, { connected: Boolean(s), sourceAgeMs: f?.source_age_ms ?? null,
            phase: s?.phase_countdowns?.phase ?? s?.round?.phase ?? m?.phase ?? "waiting",
            map: { name: m?.name ?? "", phase: m?.phase ?? "waiting", round: m?.round ?? null,
              teamCT: m?.team_ct ?? null, teamT: m?.team_t ?? null }, allplayers: s?.raw?.allplayers ?? {}, receivedAt: s?.received_at ?? null });
          return;
        }
        if (request.method === "GET" && pathname === "/api/state") {
          sendJson2(response, 200, this.stateForHalf(parseHalf(requestUrl.searchParams.get("half"))));
          return;
        }
        if (request.method === "GET" && pathname === "/api/trajectories") {
          const half = parseHalf(requestUrl.searchParams.get("half"));
          const state = this.stateForHalf(half);
          sendJson2(response, 200, {
            half,
            trajectories: state.trajectories,
            summary: state.trajectorySummary
          });
          return;
        }
        if (request.method === "GET" && pathname === "/api/maps") {
          sendJson2(response, 200, Object.entries(MAPS).map(([name, map]) => ({
            name,
            imageUrl: `/assets/${map.image}`,
            layers: getLayers(map).map((layer) => ({ id: layer.id, minZ: layer.minZ, maxZ: layer.maxZ }))
          })));
          return;
        }
        if (request.method === "GET" && pathname === "/api/rounds") {
          sendJson2(response, 200, {
            matchId: this.matchId,
            rounds: await this.frameCache?.listRounds() ?? []
          });
          return;
        }
        if (request.method === "GET" && pathname === "/health") {
          sendJson2(response, 200, {
            ok: true,
            gsi: Boolean(this.latestFrame),
            memory: process.memoryUsage(),
            matchId: this.matchId,
            frameIndex: this.latestFrame?.frame_index ?? null,
            trajectories: this.trajectoryStore?.summary() ?? null
          });
          return;
        }
        if (request.method === "GET" && pathname === "/events") {
          const client = {
            response,
            half: parseHalf(requestUrl.searchParams.get("half"))
          };
          response.writeHead(200, {
            "content-type": "text/event-stream; charset=utf-8",
            "cache-control": "no-cache, no-transform",
            connection: "keep-alive",
            "access-control-allow-origin": "*"
          });
          response.write(": connected\n\n");
          this.clients.add(client);
          this.writeState(client);
          request.on("close", () => this.clients.delete(client));
          return;
        }
        sendJson2(response, 404, { ok: false, error: "not found" });
      }
      writeState(client, shared = null) {
        if (client.blocked) { client.dirty = true; return; }
        if (client.response.destroyed) { this.clients.delete(client); return; }
        try {
          let data = shared?.get(client.half);
          if (!data) {
            data = `event: state\ndata: ${JSON.stringify({ ...this.stateForHalf(client.half), displaySettings: this.displaySettings })}\n\n`;
            shared?.set(client.half, data);
          }
          if (!client.response.write(data)) {
            client.blocked = true;
            client.response.once('drain', () => {
              client.blocked = false;
              if (client.dirty && this.clients.has(client)) {
                client.dirty = false;
                this.writeState(client);
              }
            });
          }
        } catch {
          this.clients.delete(client);
        }
      }
      broadcast() {
        const shared = new Map();
        for (const client of this.clients) this.writeState(client, shared);
      }
      async stop() {
        for (const client of this.clients) client.response.end();
        this.clients.clear();
        if (!this.server) return;
        await new Promise((resolve2, reject) => {
          this.server.close((error) => error ? reject(error) : resolve2());
        });
        this.server = null;
      }
    };
  }
});

// src/cli.mjs
function createCachePolicy({tempDir, frameCache, pipeline, trajectoryStore, hud, ...options}) {
  const {CachePolicy} = require('./cache-policy.cjs');
  let resume = false;
  return new CachePolicy({rootDir:tempDir, activeDir:frameCache.matchDir, ...options,
    async beforeRemove() {
      resume = frameCache.started;
      pipeline.cachePaused = true;
      pipeline.synchronizer.stop();
      const stream = pipeline.recorder.stream;
      pipeline.recorder.stream = null;
      if (stream) {
        const closed = require('node:events').once(stream, 'close');
        stream.end();
        await closed;
      }
      await frameCache.close();
      frameCache.pending.clear(); frameCache.stats.clear();
      trajectoryStore.trajectories.clear(); trajectoryStore.roundBuys.clear();
      pipeline.merger = new GsiStateMerger();
      pipeline.rounds = new RoundStateMachine();
      pipeline.lastSnapshot = null; pipeline.latestFrame = null;
      const sync = pipeline.synchronizer;
      sync.samples = []; sync.sampleCursor = 0; sync.lastSample = null;
      sync.originNs = null; sync.nextFrameIndex = 0;
      if (grenadeTracker) {
        grenadeTracker.stop('缓存已清除', false);
        grenadeTracker.records.clear(); grenadeTracker.state = null;
        grenadeTracker.lastAt = null; grenadeTracker.context = null;
        grenadeTracker.lastTarget = null; grenadeTracker.lastCamera = null;
        grenadeTracker.cameraSelection = null; grenadeTracker.returnSelection = null; grenadeTracker.pendingReturn = null;
      }
      hud.latestFrame = null;
      Object.assign(hud.displaySettings, {replay:false, playing:false, offset:0,
        revision:(hud.displaySettings.revision || 0) + 1, updatedAt:Date.now()});
      if (hud.displaySettingsFile) {
        const fs = require('node:fs');
        fs.writeFileSync(hud.displaySettingsFile+'.tmp', JSON.stringify(hud.displaySettings));
        fs.renameSync(hud.displaySettingsFile+'.tmp', hud.displaySettingsFile);
      }
      hud.broadcast();
    },
    async afterRemove() {
      if (resume) {
        await frameCache.start();
        pipeline.recorder.stream = require('node:fs').createWriteStream(require('node:path').join(frameCache.matchDir, 'raw.ndjson'), {flags:'a'});
      }
      pipeline.cachePaused = false;
    }
  });
}
var cli_exports = {};
function readArg(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}
async function main() {
  const tempDir = readArg("--temp-dir", process.env.GSI_TEMP_DIR || "./temp");
  const {GrenadeTracker,trackerRoutes}=require('./grenade-tracker.cjs');
  grenadeTracker=new GrenadeTracker({configPath:require('node:path').join(tempDir,'tracker-settings.json')});
  handleTrackerRequest=trackerRoutes(grenadeTracker);
  const matchId = readArg(
    "--match-id",
    process.env.GSI_MATCH_ID || `match-${(/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-")}`
  );
  const token = readArg("--token", process.env.GSI_TOKEN || "change-me");
  const fps = Number(readArg("--fps", process.env.GSI_FPS || "30"));
  const halfRounds = Number(readArg("--half-rounds", process.env.GSI_HALF_ROUNDS || "12"));
  const frameCache = new FrameCache({ rootDir: tempDir, matchId, fps });
  const trajectoryStore = new UtilityTrajectoryStore({ halfRounds });
  const hud = new HudServer({
    host: readArg("--hud-host", process.env.HUD_HOST || "127.0.0.1"),
    port: sdResolvePort(readArg("--hud-port", process.env.HUD_PORT),SD_HUD_PORT),
    trajectoryStore,
    frameCache,
    fps,
    matchId
  });
  const pipeline = new GsiPipeline({
    recorder: { tempDir, matchId, token },
    fps,
    bufferFrames: 1,
    frameCache,
    onFrame: (frame) => {
      trajectoryStore.update(frame);
      hud.updateFrame(frame);
    }
  });
  const host = readArg("--host", process.env.GSI_HOST || "127.0.0.1");
  const port = sdResolvePort(readArg("--port", process.env.GSI_PORT),SD_GSI_PORT);
  if (!Number.isInteger(fps) || fps <= 0 || fps > 240) {
    throw new Error(`invalid fps: ${fps}`);
  }
  if (!Number.isInteger(halfRounds) || halfRounds < 1) {
    throw new Error(`invalid half-rounds: ${halfRounds}`);
  }
  if (!Number.isInteger(port) || port < 0 || port > 65535 || !Number.isInteger(hud.port) || hud.port < 0 || hud.port > 65535) {
    throw new Error(`invalid port: GSI=${port}, HUD=${hud.port}`);
  }
  cachePolicy = createCachePolicy({tempDir, frameCache, pipeline, trajectoryStore, hud});
  await cachePolicy.ensure();
  await frameCache.start();
  const restoredFrameCount = await trajectoryStore.loadCache(frameCache);
  const address = await pipeline.start({ host, port });
  const hudAddress = await hud.start();
  console.log(`Radar HUD GSI receiver listening on http://${address.address}:${address.port}/gsi`);
  console.log(`Radar HUD viewer listening on http://${hudAddress.address}:${hudAddress.port}/`);
  process.send?.({type:"ready",hudPort:hudAddress.port,gsiPort:address.port});
  console.log(`Raw packets: ${pipeline.recorder.matchDir}/raw.ndjson`);
  console.log(`30 FPS frames: ${frameCache.roundsDir}/<round-id>/frames.ndjson`);
  if (restoredFrameCount > 0) console.log(`Restored cached frames: ${restoredFrameCount}`);
  console.log("Press Ctrl+C to stop and write diagnostics.");
  let stopping = false;
  async function stop(signal) {
    if (stopping) return;
    stopping = true;
    grenadeTracker?.dispose();
    console.log(`
Received ${signal}; stopping recorder...`);
    try {
      await cachePolicy.close();
      await pipeline.stop();
      console.log(JSON.stringify(pipeline.diagnostics(), null, 2));
    } finally {
      await hud.stop();
    }
  }
  process.on("message", message => { if(message?.type === "stop") stop("ScoreDeck").finally(()=>process.exit(0)); });
  process.once("disconnect", () => stop("parent disconnected").finally(()=>process.exit(0)));
  process.once("SIGINT", () => void stop("SIGINT"));
  process.once("SIGTERM", () => void stop("SIGTERM"));
}
var init_cli = __esm({
  "src/cli.mjs"() {
    init_frame_cache();
    init_gsi_pipeline();
    init_hud_server();
    init_trajectory();
    main().catch((error) => {
      console.error(error?.stack || error);
      process.exit(1);
    });
  }
});

// installer/sea-entry.cjs
var path = require("node:path");
var { dirname } = require("node:path");
var { existsSync } = require("node:fs");
var { spawn } = require("node:child_process");
var executableDir = __dirname;
var bundledPublicDir = path.join(executableDir, "public");
var installedPublicDir = path.resolve(executableDir, "..", "public");
process.env.RADAR_HUD_PUBLIC_DIR ||= existsSync(bundledPublicDir) ? bundledPublicDir : installedPublicDir;
process.env.GSI_TEMP_DIR ||= path.join(executableDir, "temp");
(async () => {
  await Promise.resolve().then(() => (init_cli(), cli_exports));
  if (process.env.RADAR_HUD_OPEN_BROWSER !== "0" && process.platform === "win32") {
    await new Promise((resolve2) => setTimeout(resolve2, 900));
    const hudUrl = `http://${process.env.HUD_HOST || "127.0.0.1"}:${sdResolvePort(readArg("--hud-port",process.env.HUD_PORT),SD_HUD_PORT)}/`;
    spawn("cmd.exe", ["/c", "start", "", hudUrl], {
      detached: true,
      stdio: "ignore",
      windowsHide: true
    }).unref();
  }
})().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
