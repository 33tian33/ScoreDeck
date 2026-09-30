const halftimeParams = new URLSearchParams(location.search);
const halftimeEmbed = halftimeParams.get('embed') === 'halftime';
const connection = document.querySelector("#connection");
const connectionText = document.querySelector("#connection-text");
const radarImage = document.querySelector("#radar-image");
const radarObjects = document.querySelector("#radar-objects");
const radarEmpty = document.querySelector("#radar-empty");
const trajectoryPaths = document.querySelector("#trajectory-paths");
const halfButtons = [...document.querySelectorAll(".half-button")];
const replayToggle = document.querySelector("#replay-toggle");
const replayPlay = document.querySelector("#replay-play");
const replayTime = document.querySelector("#replay-time");
const replayTimeLabel = document.querySelector("#replay-time-label");
const fadeDelayInput = document.querySelector("#fade-delay");
const SVG_NS = "http://www.w3.org/2000/svg";

const propLabels = {
  smoke: "烟雾",
  flashbang: "闪光",
  frag: "HE",
  firebomb: "燃烧弹",
  inferno: "火焰",
  decoy: "诱饵",
  bomb: "C4"
};

const propIcons = {
  smoke: "smoke.png",
  flashbang: "flash.png",
  frag: "frag.png",
  firebomb: "firebomb.png",
  inferno: "firebomb.png",
  decoy: "weapon_decoy.png",
  bomb: "bomb.png"
};

const FADE_DURATION_MS = 2000;

let selectedHalf = 1;
let selectedLayer = 'all';
const layerSelect = document.querySelector('#map-layer');
function layerVisible(layer) {
  if (!latestState?.map?.layers || latestState.map.layers.length < 2) return true;
  return selectedLayer === 'all' || layer === selectedLayer;
}
// Split at every floor transition, even in all-floor mode: the atlas uses
// different offsets per floor, so connecting them creates a false diagonal.
function floorSegments(points) {
  const segments = [];
  let current = null;
  let previousLayer = null;
  for (const point of points) {
    if (!layerVisible(point.layer)) { current = null; previousLayer = point.layer; continue; }
    if (!current || previousLayer !== point.layer) { current = []; segments.push(current); }
    current.push(point);
    previousLayer = point.layer;
  }
  return segments;
}
function renderFloorMap(map) {
  const dual = map.layers?.length > 1;
  layerSelect.disabled = !dual;
  document.querySelector('#layer-help').textContent = dual
    ? '1层为下层，2层为上层；队员、道具与回放同步筛选。'
    : '当前为单层地图，显示完整地图。';
  radarImage.style.clipPath = 'none';
  if (!dual || selectedLayer === 'all') return;
  // These clipping regions match the bundled, side-by-side floor atlases.
  if (map.assetMap === 'de_vertigo' || map.name === 'de_vertigo') {
    radarImage.style.clipPath = selectedLayer === 'low'
      ? 'inset(58% 0 0 0)' : 'inset(0 0 42% 0)';
  } else if (map.assetMap === 'de_nuke' || map.name === 'de_nuke') {
    radarImage.style.clipPath = selectedLayer === 'low'
      ? 'polygon(0 44%,29.3% 44%,29.3% 58.6%,41% 62.5%,41% 100%,0 100%)'
      : 'polygon(0 0,100% 0,100% 100%,41% 100%,41% 62.5%,29.3% 58.6%,29.3% 44%,0 44%)';
  }
}
layerSelect.addEventListener('change', () => {
  selectedLayer = layerSelect.value;
  if (latestState) { if (replayMode) renderReplay(); else renderLive(latestState); }
});
let events = null;
let latestState = null;
let replayMode = false;
let replayPlaying = false;
let replayOffsetMs = 0;
let replayAnimationFrame = null;
let replayLastWallMs = null;
let liveStateWallMs = 0;
let liveStateTimeMs = null;

function storedFadeDelay() {
  try {
    const stored = localStorage.getItem("radar-hud.fade-delay-seconds");
    if (stored === null) return 3;
    const value = Number(stored);
    return Number.isFinite(value) && value >= 0 ? Math.min(60, value) : 3;
  } catch {
    return 3;
  }
}

let fadeDelaySeconds = storedFadeDelay();
fadeDelayInput.value = String(fadeDelaySeconds);

function setConnection(live, message) {
  connection.classList.toggle("live", live);
  connection.classList.toggle("error", !live && message === "连接失败");
  connectionText.textContent = message;
}

function percent(value) {
  return `${(Math.max(-128, Math.min(1152, Number(value))) / 1024) * 100}%`;
}

function place(element, position) {
  element.style.left = percent(position[0]);
  element.style.top = percent(position[1]);
}

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatTime(milliseconds) {
  const value = finite(milliseconds);
  if (value === null) return "--:--.-";
  const seconds = Math.max(0, value) / 1000;
  const minutes = Math.floor(seconds / 60);
  const remainder = (seconds % 60).toFixed(1).padStart(4, "0");
  return `${String(minutes).padStart(2, "0")}:${remainder}`;
}

function replayMeta(state = latestState) {
  return state?.replay?.available ? state.replay : null;
}

function orderedPoints(trajectory) {
  const points = (Array.isArray(trajectory.points) ? trajectory.points : [])
    .filter((point) => Array.isArray(point.position) && point.position.length >= 2)
    .map((point, index) => ({ ...point, _index: index, _time: finite(point.time_ms) }));
  points.sort((a, b) => (a._time ?? Infinity) - (b._time ?? Infinity) || a._index - b._index);
  // Consecutive samples often have equal coordinates at 30 FPS. Removing them
  // keeps a real polyline and prevents SVG joins from forming visual blobs.
  return points.filter((point, index) => {
    if (!index) return true;
    const previous = points[index - 1];
    return point.layer !== previous.layer || point.position[0] !== previous.position[0] || point.position[1] !== previous.position[1];
  });
}

function roundStartMs(trajectory, starts = null) {
  const round = Number(trajectory.round_number);
  if (starts?.has(round)) return starts.get(round);
  return finite(trajectory.round_started_time_ms ?? trajectory.round_start_time_ms);
}

function pointsVisibleAt(trajectory, timeMs, { roundStarts = null, replay = false } = {}) {
  const points = orderedPoints(trajectory);
  if (timeMs === null || timeMs === undefined) return points;
  const start = roundStartMs(trajectory, roundStarts);
  const isReplay = replay || roundStarts !== null;
  if (isReplay && start === null) return [];
  return points.filter((point) => {
    const pointTime = point._time;
    const relativeTime = !isReplay || pointTime === null || start === null ? pointTime : pointTime - start;
    return relativeTime === null || relativeTime <= timeMs + 0.01;
  });
}

function replayRoundStarts(trajectories) {
  const starts = new Map();
  for (const trajectory of trajectories) {
    const round = Number(trajectory.round_number);
    if (!Number.isFinite(round)) continue;
    const declared = finite(trajectory.round_started_time_ms ?? trajectory.round_start_time_ms);
    const candidate = declared;
    if (candidate !== null && (!starts.has(round) || candidate < starts.get(round))) starts.set(round, candidate);
  }
  return starts;
}

function replayDurationMs(trajectories, roundStarts) {
  let duration = 0;
  for (const trajectory of trajectories) {
    const start = roundStartMs(trajectory, roundStarts);
    for (const point of orderedPoints(trajectory)) {
      if (point._time !== null && start !== null) duration = Math.max(duration, point._time - start);
    }
    for (const time of [trajectory.last_time_ms, trajectory.detonation_time_ms, ...(trajectory.flame_frames || []).map(frame => frame.time_ms)]) {
      const value = finite(time);
      if (value !== null && start !== null) duration = Math.max(duration, value - start);
    }
    const ended = finite(trajectory.ended_time_ms);
    if (ended !== null && start !== null) duration = Math.max(duration, ended - start);
  }
  return Math.max(0, duration);
}

function trajectoryEndedAt(trajectory, { replay = false, roundStarts = null } = {}) {
  const ended = finite(trajectory.ended_time_ms);
  if (!replay) return ended;
  const start = roundStartMs(trajectory, roundStarts);
  return ended === null || start === null ? ended : ended - start;
}

function trajectoryOpacity(trajectory, timeMs, { replay = false, currentRound = null, roundStarts = null } = {}) {
  const baseOpacity = trajectory.side === "CT" || trajectory.side === "T" ? 0.76 : 0.45;
  // The half overview keeps completed historical rounds visible. In live mode
  // only the current round fades, while replay mode applies the setting to all
  // rounds along the selected timeline.
  if (!replay && currentRound !== null && Number(trajectory.round_number) !== Number(currentRound)) {
    return baseOpacity;
  }
  const ended = trajectoryEndedAt(trajectory, { replay, roundStarts });
  if (ended === null || timeMs === null || timeMs <= ended) return baseOpacity;
  const elapsed = timeMs - ended;
  const delay = fadeDelaySeconds * 1000;
  if (elapsed <= delay) return baseOpacity;
  const fadeProgress = Math.min(1, (elapsed - delay) / FADE_DURATION_MS);
  return baseOpacity * (1 - fadeProgress);
}

function createPropMarker(prop) {
  const marker = document.createElement("div");
  marker.className = [
    "radar-object",
    "radar-prop",
    `prop-${prop.type || "unknown"}`,
    prop.state || "",
    prop.visible === false ? "hidden-layer" : "",
    prop.side === "CT" ? "ct" : prop.side === "T" ? "t" : ""
  ].filter(Boolean).join(" ");
  place(marker, prop.position);

  const state = prop.state || "unknown";
  if (!document.body.classList.contains("clean-output")) marker.title = `${propLabels[prop.type] || prop.type} · ${state}`;
  const icon = propIcons[prop.type] || prop.icon;
  if (icon) {
    const image = document.createElement("span");
    image.className = "prop-icon";
    image.style.maskImage = `url("/grenades/${icon}")`;
    image.style.webkitMaskImage = `url("/grenades/${icon}")`;
    image.setAttribute("role", "img");
    image.setAttribute("aria-label", propLabels[prop.type] || prop.type);
    marker.append(image);
  }
  return marker;
}

function appendSvgTitle(element, text) {
  if (document.body.classList.contains("clean-output")) return;
  const title = document.createElementNS(SVG_NS, "title");
  title.textContent = text;
  element.append(title);
}

function createCircle(point, className, radius) {
  const circle = document.createElementNS(SVG_NS, "circle");
  circle.setAttribute("class", className);
  circle.setAttribute("cx", point.position[0]);
  circle.setAttribute("cy", point.position[1]);
  circle.setAttribute("r", radius);
  return circle;
}

function createRangePolygon(point, radius, sides, className, rotation = 0) {
  const polygon = document.createElementNS(SVG_NS, "polygon");
  const smoke = className.includes("smoke");
  // Stable lobes avoid random flicker as GSI updates arrive.
  const vertices = Array.from({ length: sides }, (_, index) => {
    const angle = rotation + (Math.PI * 2 * index) / sides;
    const spread = smoke
      ? 1 + .065 * Math.sin(angle * 5) + .045 * Math.cos(angle * 7)
      : .87 + .08 * Math.sin(angle * 3) + .05 * Math.cos(angle * 7);
    return `${point.position[0] + Math.cos(angle) * radius * spread},${point.position[1] + Math.sin(angle) * radius * spread}`;
  });
  polygon.setAttribute("class", className);
  polygon.setAttribute("points", vertices.join(" "));
  return polygon;
}

// World units, not radar pixels. Smoke is a nominal 2D footprint, not voxel data.
const UTILITY_GEOMETRY = { smokeRadius: 150, fireFallbackRadius: 150, incendiaryFallbackRadius: 110, flameCellRadius: 24 };
let fireIconsLayer = null;
function svgNode(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
}
function ellipsePath(x, y, rx, ry) {
  return `M ${x-rx} ${y} a ${rx} ${ry} 0 1 0 ${2*rx} 0 a ${rx} ${ry} 0 1 0 ${-2*rx} 0 Z`;
}
function rangeScale(trajectory) {
  const scale = trajectory.range_scale;
  return scale && Number.isFinite(scale.x) && Number.isFinite(scale.y) && scale.x > 0 && scale.y > 0 ? scale : null;
}
function flameSample(trajectory, timeMs, options) {
  const frames = trajectory.flame_frames || [];
  const start = options.replay ? roundStartMs(trajectory, options.roundStarts) : 0;
  const absolute = timeMs === null ? Infinity : timeMs + (start || 0);
  let sample = null;
  for (const frame of frames) {
    if (frame.time_ms > absolute) break;
    sample = frame.points;
  }
  return sample;
}
function appendFlameIcon(point, scale, side, layer) {
  const width = 40 * scale.x, height = 65 * scale.y;
  const glyph = svgNode('g', {class:`fire-glyph ${side}`, transform:`translate(${point[0]-width/2} ${point[1]-height*.82}) scale(${width/16} ${height/22})`});
  glyph.append(svgNode('path', {class:'flame-body', d:'M8 1 C10 6 5 8 9 11 C11 10 12 7 12 6 C17 12 16 17 13 20 C10 23 4 22 2 18 C0 14 3 11 4 9 C4 13 6 14 6 11 C5 7 6 4 8 1 Z'}));
  glyph.append(svgNode('path', {class:'flame-core', d:'M8 12 C9 15 12 16 10 19 C8 21 5 19 6 17 Z'}));
  layer.append(glyph);
}
function renderDetonationRange(trajectory, timeMs, options) {
  const type = trajectory.type;
  if (!['smoke','firebomb','inferno'].includes(type)) return;
  const allPoints = orderedPoints(trajectory);
  const end = trajectory.detonation_position || allPoints.at(-1)?.position;
  const scale = rangeScale(trajectory);
  const detonation = finite(trajectory.detonation_time_ms);
  if (!end || !scale || detonation === null) return;
  const start = options.replay ? roundStartMs(trajectory, options.roundStarts) : null;
  const activation = start !== null ? detonation - start : detonation;
  if (timeMs !== null && timeMs < activation) return;
  const opacity = trajectoryOpacity(trajectory, timeMs, options);
  if (opacity <= .01) return;
  const alpha = Math.min(1, opacity / .76);
  const side = trajectory.side === 'CT' ? 'ct' : trajectory.side === 'T' ? 't' : 'unknown';
  if (type === 'smoke') {
    if (!layerVisible(scale.layer)) return;
    const radius = UTILITY_GEOMETRY.smokeRadius;
    const area = svgNode('ellipse', {class:`utility-range smoke ${side}`,cx:end[0],cy:end[1],rx:radius*scale.x,ry:radius*scale.y,'data-radius-world':radius});
    area.style.opacity = alpha;
    trajectoryPaths.append(area);
    return;
  }
  let points = flameSample(trajectory, timeMs, options);
  const measured = points !== null;
  if (measured) points = points.filter(p => layerVisible(p.layer));
  if (measured && !points.length) return;
  const radius = /incgrenade|incendiary/.test(trajectory.source_type || '') ? UTILITY_GEOMETRY.incendiaryFallbackRadius : UTILITY_GEOMETRY.fireFallbackRadius;
  if (!measured) {
    if (!layerVisible(scale.layer)) return;
    points = [{position:end, scale}];
    for (let i=0;i<6;i++) {
      const a = i*Math.PI/3;
      points.push({position:[end[0]+Math.cos(a)*radius*.55*scale.x,end[1]+Math.sin(a)*radius*.55*scale.y],scale});
    }
  }
  const path = measured
    ? points.map(p => ellipsePath(...p.position,UTILITY_GEOMETRY.flameCellRadius*p.scale.x,UTILITY_GEOMETRY.flameCellRadius*p.scale.y)).join(' ')
    : ellipsePath(...end,radius*scale.x,radius*scale.y);
  const area = svgNode('path', {class:`utility-range fire ${side}`,d:path,'data-geometry':measured?'gsi-flames':'estimated'});
  area.style.opacity = alpha;
  trajectoryPaths.append(area);
  const glyphs = svgNode('g', {class:'fire-glyphs'}); glyphs.style.opacity = alpha;
  for (const point of points) appendFlameIcon(point.position,point.scale || scale,side,glyphs);
  (fireIconsLayer || trajectoryPaths).append(glyphs);
}

function renderTrajectories(trajectories, timeMs = null, options = {}) {
  trajectoryPaths.replaceChildren();
  fireIconsLayer = svgNode('g', {class:'fire-icons-layer'});
  for (const trajectory of trajectories) {
    if (!showTrajectory(trajectory)) continue;
    const points = pointsVisibleAt(trajectory, timeMs, options);
    if (!points.length) continue;

    const side = trajectory.side === "CT" ? "ct" : trajectory.side === "T" ? "t" : "unknown";
    const opacity = trajectoryOpacity(trajectory, timeMs, options);
    if (opacity <= 0.01) continue;
    renderDetonationRange(trajectory, timeMs, options);
    if (fadeDelaySeconds === 0) continue;
    for (const segment of floorSegments(points)) {
    const path = document.createElementNS(SVG_NS, "polyline");
    path.setAttribute("class", `trajectory-path ${side}`);
    path.setAttribute("fill", "none");
    path.setAttribute("points", segment.map((point) => `${point.position[0]},${point.position[1]}`).join(" "));
    path.style.opacity = String(opacity);
    path.dataset.round = trajectory.round_number ?? "";
    path.dataset.type = trajectory.type || "utility";
    appendSvgTitle(
      path,
      `${propLabels[trajectory.type] || trajectory.type} · ${side.toUpperCase()} · Round ${trajectory.round_number ?? "?"}`
    );
    trajectoryPaths.append(path);

    const start = createCircle(segment[0], `trajectory-point start ${side}`, 2);
    const end = createCircle(segment.at(-1), `trajectory-point end ${side}`, 1.8);
    start.style.opacity = String(Math.min(1, opacity / 0.76));
    end.style.opacity = String(Math.min(1, opacity / 0.76));
    appendSvgTitle(end, `${propLabels[trajectory.type] || trajectory.type} 落点`);
    trajectoryPaths.append(start, end);
    }
  }
  trajectoryPaths.append(fireIconsLayer);
}

function renderReplayObjects(trajectories, timeMs, roundStarts) {
  radarObjects.replaceChildren();
  for (const trajectory of trajectories) {
    if (!showTrajectory(trajectory)) continue;
    const points = pointsVisibleAt(trajectory, timeMs, { roundStarts });
    if (!points.length) continue;
    const options = { replay: true, roundStarts };
    const opacity = trajectoryOpacity(trajectory, timeMs, options);
    if (opacity <= 0.01) continue;
    if (['inferno','firebomb'].includes(trajectory.type) && trajectory.detonation_time_ms !== null && timeMs >= trajectory.detonation_time_ms - (roundStarts.get(Number(trajectory.round_number)) || 0)) continue;
    if (!layerVisible(points.at(-1).layer)) continue;
    const marker = createPropMarker({
      type: trajectory.type,
      icon: propIcons[trajectory.type],
      position: points.at(-1).position,
      side: trajectory.side,
      state: trajectoryEndedAt(trajectory, options) !== null && timeMs >= Number(trajectoryEndedAt(trajectory, options))
        ? "landed"
        : "inair"
    });
    marker.classList.add("replay-prop");
    marker.style.opacity = String(Math.min(1, opacity / 0.76));
    marker.title = `${propLabels[trajectory.type] || trajectory.type} · Round ${trajectory.round_number ?? "?"}`;
    radarObjects.append(marker);
  }
}

function renderChrome(state, { phase = null, roundNumber = null, frameLabel = null } = {}) {
  const map = state.map || {};
  const names = {full:"FULL BUY",half:"HALF BUY",eco:"ECO"};
  const selected = [...document.querySelectorAll("[data-buy]:checked")].map(b => b.dataset.buy);
  const kinds = [...new Set(selected.map(k => k.split("-")[1]))];
  const sides = [...new Set(selected.map(k => k.split("-")[0]))];
  document.querySelector("#buy-caption").textContent = `${kinds.length === 3 ? "ALL BUY TYPES" : kinds.map(k => names[k]).join(" / ") || "NO BUY TYPES"} · HALF ${selectedHalf}`;
  document.querySelector("#map-caption").textContent = `${(map.name || "MAP").replace(/^de_/, "").toUpperCase()} · ${sides.join(" + ") || "—"} UTILITY`;

  const summary = state.trajectorySummary || {};
  const trajectories = Array.isArray(state.trajectories) ? state.trajectories : [];

  const fromCache = state.source === "cache";
  setConnection(Boolean(state.connected), fromCache ? "缓存回放" : state.connected ? "GSI 已连接" : "等待 GSI");
  document.querySelector("#map-name").textContent = map.name || "unknown";
  renderFloorMap(map);
  document.querySelector('#layer-name').textContent = map.layers?.length > 1
    ? ({all:'全部层', low:'1层（下层）', high:'2层（上层）'})[selectedLayer] : '单层地图';
  document.querySelector("#map-phase").textContent = String(phase || state.phase || map.phase || "WAITING").toUpperCase();
  document.querySelector("#round-info").textContent =
    `ROUND ${roundNumber ?? state.roundNumber ?? "--"} · HALF ${state.trajectoryHalf ?? selectedHalf}`;
  document.querySelector("#frame-info").textContent =
    frameLabel || `${state.fps || 30} FPS · FRAME ${state.frameIndex ?? "--"}`;
  document.querySelector("#trajectory-count").textContent = summary.trajectories ?? trajectories.length;

  if (map.imageUrl) radarImage.src = map.imageUrl;
  radarEmpty.classList.toggle("hidden", state.connected || fromCache || trajectories.length > 0);
  halfButtons.forEach((button) => button.classList.toggle("active", Number(button.dataset.half) === selectedHalf));
}

function renderLive(state) {
  const trajectories = Array.isArray(state.trajectories) ? state.trajectories : [];
  const props = Array.isArray(state.props) ? state.props : [];
  const baseTime = finite(state.timeMs);
  const wallElapsed = liveStateWallMs ? Math.max(0, performance.now() - liveStateWallMs) : 0;
  const displayTimeMs = baseTime === null ? null : baseTime + wallElapsed;

  renderChrome(state);
  radarObjects.replaceChildren();
  for (const prop of props) {
    if (!layerVisible(prop.layer)) continue;
    if (prop.type === 'inferno' || (prop.type === 'firebomb' && prop.state !== 'inair')) continue;
    const track = trajectories.find(t => Number(t.round_number) === Number(state.roundNumber) && String(t.entity_id) === String(prop.id));
    if (Array.isArray(prop.position) && (prop.id === "bomb" || showTrajectory(track || {side:prop.side,economy:"unknown"}))) radarObjects.append(createPropMarker({...prop, visible: true}));
  }
  if (document.querySelector('#show-players').checked && Number(state.sourceAgeMs || 0) < 3000 && state.connected && selectedHalf === (Math.floor(Number(state.roundNumber) / 12) + 1)) {
    for (const player of state.players || []) {
      if (!layerVisible(player.layer) || !Array.isArray(player.position)) continue;
      const dot = document.createElement('span');
      dot.className = 'player-dot ' + player.side.toLowerCase();
      place(dot, player.position); radarObjects.append(dot);
    }
  }
  renderTrajectories(trajectories, displayTimeMs, { currentRound: finite(state.roundNumber) });
}

function renderReplay(timeOffsetMs = replayOffsetMs) {
  if (!latestState) return;
  const meta = replayMeta(latestState);
  if (!meta) { radarObjects.replaceChildren(); trajectoryPaths.replaceChildren(); return; }
  const trajectories = Array.isArray(latestState.trajectories) ? latestState.trajectories : [];
  const roundStarts = replayRoundStarts(trajectories);
  const duration = replayDurationMs(trajectories, roundStarts);
  replayOffsetMs = Math.max(0, Math.min(duration, Number(timeOffsetMs) || 0));
  const visibleRounds = [...roundStarts.keys()].sort((a, b) => a - b);

  renderChrome(latestState, {
    phase: "replay",
    roundNumber: visibleRounds.length ? `${visibleRounds[0]}-${visibleRounds.at(-1)} SYNC` : "--",
    frameLabel: `${latestState.fps || 30} FPS · SYNC REPLAY ${formatTime(replayOffsetMs)}`
  });
  renderReplayObjects(trajectories, replayOffsetMs, roundStarts);
  renderTrajectories(trajectories, replayOffsetMs, { replay: true, roundStarts });
}

function updateReplayControls() {
  const meta = replayMeta();
  const available = Boolean(meta);
  replayToggle.disabled = !available;
  replayPlay.disabled = !available;
  replayTime.disabled = !available || !replayMode;
  replayTime.min = "0";
  const trajectories = Array.isArray(latestState?.trajectories) ? latestState.trajectories : [];
  const roundStarts = replayRoundStarts(trajectories);
  const duration = replayDurationMs(trajectories, roundStarts);
  const rounds = [...roundStarts.keys()].sort((a, b) => a - b);
  const roundLabel = rounds.length ? `${rounds[0]}-${rounds.at(-1)}` : "--";
  replayTime.max = String(duration);
  replayTime.value = String(Math.max(0, Math.min(duration, replayOffsetMs)));
  replayTimeLabel.textContent = meta
    ? `${formatTime(replayOffsetMs)} / ${formatTime(duration)} · R${roundLabel} SYNC`
    : "无回放数据";
  replayToggle.textContent = replayMode ? "退出回放" : "进入回放";
  replayPlay.textContent = replayPlaying ? "❚❚ 暂停" : "▶ 播放";
}

function render(state) {
  if (state.displaySettings) applyDisplaySettings(state.displaySettings);
  latestState = state;
  liveStateWallMs = performance.now();
  liveStateTimeMs = finite(state.timeMs);
  updateReplayControls();
  if (replayMode) renderReplay(replayOffsetMs);
  else renderLive(state);
}

async function loadState() {
  const response = await fetch(`/api/state?half=${selectedHalf}`, { cache: "no-store" });
  if (!response.ok) throw new Error("state request failed");
  render(await response.json());
}

function connectEvents() {
  events?.close();
  events = new EventSource(`/events?half=${selectedHalf}`);
  events.addEventListener("state", (event) => {
    try {
      render(JSON.parse(event.data));
    } catch {
      setConnection(false, "数据解析失败");
    }
  });
  events.onopen = () => {
    if (!connection.classList.contains("live")) setConnection(true, "HUD 通道已打开");
  };
  events.onerror = () => setConnection(false, "连接失败");
}

function startReplayClock() {
  if (replayAnimationFrame !== null) cancelAnimationFrame(replayAnimationFrame);
  replayLastWallMs = performance.now();
  const tick = (now) => {
    if (!replayPlaying) {
      replayAnimationFrame = null;
      return;
    }
    const elapsed = Math.max(0, now - replayLastWallMs);
    replayLastWallMs = now;
    const trajectories = Array.isArray(latestState?.trajectories) ? latestState.trajectories : [];
    const duration = replayDurationMs(trajectories, replayRoundStarts(trajectories));
    replayOffsetMs = Math.min(duration, replayOffsetMs + elapsed);
    renderReplay(replayOffsetMs);
    updateReplayControls();
    if (replayOffsetMs >= duration) {
      replayPlaying = false;
      saveDisplaySettings();
      updateReplayControls();
      replayAnimationFrame = null;
      return;
    }
    replayAnimationFrame = requestAnimationFrame(tick);
  };
  replayAnimationFrame = requestAnimationFrame(tick);
}

function stopReplayClock() {
  replayPlaying = false;
  replayLastWallMs = null;
  if (replayAnimationFrame !== null) cancelAnimationFrame(replayAnimationFrame);
  replayAnimationFrame = null;
}

replayToggle.addEventListener("click", () => {
  if (!replayMeta()) return;
  stopReplayClock();
  replayMode = !replayMode;
  replayOffsetMs = 0;
  if (replayMode) renderReplay(0);
  else if (latestState) renderLive(latestState);
  updateReplayControls();
});

replayPlay.addEventListener("click", () => {
  if (!replayMeta()) return;
  if (!replayMode) {
    replayMode = true;
    replayOffsetMs = 0;
  }
  if (replayPlaying) stopReplayClock();
  else {
    const trajectories = Array.isArray(latestState?.trajectories) ? latestState.trajectories : [];
    const duration = replayDurationMs(trajectories, replayRoundStarts(trajectories));
    if (replayOffsetMs >= duration) replayOffsetMs = 0;
    replayPlaying = true;
    startReplayClock();
  }
  if (replayMode) renderReplay(replayOffsetMs);
  updateReplayControls();
});

replayTime.addEventListener("input", () => {
  if (!replayMeta()) return;
  replayMode = true;
  stopReplayClock();
  replayOffsetMs = Number(replayTime.value) || 0;
  renderReplay(replayOffsetMs);
  updateReplayControls();
});

fadeDelayInput.addEventListener("input", () => {
  const value = Math.max(0, Math.min(60, Number(fadeDelayInput.value) || 0));
  fadeDelaySeconds = value;
  fadeDelayInput.value = String(value);
  try {
    localStorage.setItem("radar-hud.fade-delay-seconds", String(value));
  } catch {
    // Settings still apply for this page even when storage is unavailable.
  }
  if (replayMode) renderReplay(replayOffsetMs);
  else if (latestState) renderLive(latestState);
});

for (const button of halfButtons) {
  button.addEventListener("click", async () => {
    const nextHalf = Number(button.dataset.half);
    if (!Number.isInteger(nextHalf) || nextHalf === selectedHalf) return;
    selectedHalf = nextHalf;
    stopReplayClock();
    replayOffsetMs = 0;
    halfButtons.forEach((item) => item.classList.toggle("active", item === button));
    try {
      await loadState();
      connectEvents();
    } catch {
      setConnection(false, "连接失败");
    }
  });
}

setInterval(() => {
  if (!replayMode && latestState) renderLive(latestState);
}, 100);



function showTrajectory(t) {
  const key = `${t.side}-${t.economy || "unknown"}`;
  const box = document.querySelector(`[data-buy="${key}"]`);
  return box ? box.checked : document.querySelector("#show-unknown").checked;
}
for (const box of document.querySelectorAll(".buy-filter input")) {
  try { const saved = localStorage.getItem("radar-buy-" + box.id); if (saved !== null) box.checked = saved === "true"; } catch {}
  box.addEventListener("change", () => {
    try { localStorage.setItem("radar-buy-" + box.id, String(box.checked)); } catch {}
    if (replayMode) renderReplay(replayOffsetMs); else if (latestState) renderLive(latestState);
  });
}


const cleanOutput = document.body.classList.contains('clean-output');
const textGroups = {
  title: ['标题', '.stage-kicker'],
  caption: ['地图与购买分类', '.broadcast-caption'],
  map: ['地图名与楼层', '.map-info'],
  count: ['轨迹数量', '.prop-count'],
  connection: ['连接状态', '.connection'],
  phase: ['游戏阶段', '#map-phase'],
  round: ['回合与半场', '#round-info'],
  frame: ['帧信息 / 回放时间', '#frame-info'],
  legend: ['道具图例', '.radar-legend'],
  waiting: ['等待提示', '#radar-empty'],
  footer: ['底部说明', '.app-shell > footer']
};
for (const [key, [label, selector]] of Object.entries(textGroups)) {
  const item = document.createElement('label');
  const box = document.createElement('input'); box.type = 'checkbox'; box.dataset.text = key;
  item.append(box, document.createTextNode(label)); document.querySelector('#text-options').append(item);
}
let applyingSettings = false;
let settingsReady = false;
let pendingSave = Promise.resolve();
let lastDisplaySnapshot=null, latestDisplaySettings=null, displayQueue=[];
function readDisplaySettings() {
  return { layer: selectedLayer, showPlayers: document.querySelector('#show-players').checked,
    texts: Object.fromEntries([...document.querySelectorAll('[data-text]')].map(x => [x.dataset.text, x.checked])),
    buys: Object.fromEntries([...document.querySelectorAll('.buy-filter input')].map(x => [x.id, x.checked])),
    half: selectedHalf, fade: fadeDelaySeconds, replay: replayMode, playing: replayPlaying, offset: replayOffsetMs };
}
function applyDisplaySettings(settings) {
  if(halftimeEmbed||!settings)return;
  if(latestDisplaySettings&&Number(settings.revision)<Number(latestDisplaySettings.revision))return;
  latestDisplaySettings=structuredClone(settings);
  settings=structuredClone(settings);
  if(!cleanOutput)for(const job of displayQueue)for(const c of job.changes){if(c.path.length===1)settings[c.path[0]]=c.after;else settings[c.path[0]]={...settings[c.path[0]],[c.path[1]]:c.after};}
  applyingSettings = true;
  selectedLayer = ['all','low','high'].includes(settings.layer) ? settings.layer : 'all';
  layerSelect.value = selectedLayer;
  document.body.classList.toggle("broadcast-background", settings.texts?.background === true);
  document.body.classList.toggle("has-caption", settings.texts?.caption === true);
  document.body.classList.toggle("has-title", settings.texts?.title === true);
  document.querySelector('#show-players').checked = settings.showPlayers;
  for(const box of document.querySelectorAll('[data-text]'))box.checked=settings.texts?.[box.dataset.text]===true;
  for (const [key, [,selector]] of Object.entries(textGroups)) {
    document.querySelectorAll(selector).forEach(el => el.classList.toggle('text-enabled', settings.texts?.[key] === true));
  }
  for (const box of document.querySelectorAll('.buy-filter input')) box.checked = settings.buys?.[box.id] !== false;
  fadeDelaySeconds = settings.fade;fadeDelayInput.value=String(settings.fade);
  replayMode = settings.replay;
  replayOffsetMs = settings.offset + (settings.playing ? Math.max(0, Date.now() - (settings.updatedAt || Date.now())) : 0);
  if (settings.playing && !replayPlaying) { replayPlaying = true; startReplayClock(); }
  if (!settings.playing && replayPlaying) stopReplayClock();
  if (selectedHalf !== settings.half) { selectedHalf = settings.half; loadState().catch(()=>{}); connectEvents(); }
  lastDisplaySnapshot=readDisplaySettings();
  applyingSettings = false;
}
function saveDisplaySettings() {
  if(cleanOutput||applyingSettings||!settingsReady||!lastDisplaySnapshot)return;
  const current=readDisplaySettings(),changes=[],expected=structuredClone(latestDisplaySettings||{});
  for(const job of displayQueue)for(const c of job.changes){if(c.path.length===1)expected[c.path[0]]=c.after;else expected[c.path[0]]={...expected[c.path[0]],[c.path[1]]:c.after};}
  for(const key of Object.keys(current)){
    if(['texts','buys'].includes(key)){for(const sub of new Set([...Object.keys(lastDisplaySnapshot[key]||{}),...Object.keys(current[key]||{})]))if(current[key]?.[sub]!==lastDisplaySnapshot[key]?.[sub])changes.push({path:[key,sub],before:expected?.[key]?.[sub]??null,missingBefore:expected?.[key]?.[sub]===undefined,after:current[key][sub]});}
    else if(current[key]!==lastDisplaySnapshot[key])changes.push({path:[key],before:expected[key]??null,missingBefore:expected[key]===undefined,after:current[key]});
  }
  if(!changes.length)return;
  const job={changes};displayQueue.push(job);lastDisplaySnapshot=structuredClone(current);
  pendingSave=pendingSave.catch(()=>{}).then(async()=>{
    if(job.cancelled)return;
    const response=await fetch('/api/display',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({changes})});
    const result=await response.json();
    if(!response.ok){for(const queued of displayQueue)queued.cancelled=true;displayQueue=[];if(result.current)applyDisplaySettings(result.current);throw Error(result.error||'同步失败');}
    displayQueue=displayQueue.filter(x=>x!==job);applyDisplaySettings(result);
    document.querySelector('#settings-status').textContent='已同步至所有控制页与 OBS';
  }).catch(error=>{for(const queued of displayQueue)queued.cancelled=true;displayQueue=[];if(latestDisplaySettings)applyDisplaySettings(latestDisplaySettings);document.querySelector('#settings-status').textContent=error.message||'同步失败，请重新操作';});
}
document.addEventListener('change', saveDisplaySettings);
document.addEventListener('input', e => {if (e.target === replayTime || e.target === fadeDelayInput) saveDisplaySettings();});
document.addEventListener('click', e => {if(e.target.closest('.half-button, .replay-button')) setTimeout(saveDisplaySettings, 0);});
setInterval(() => { if (replayPlaying) saveDisplaySettings(); }, 100);
async function initializeDisplay() {
  try {
    const response = await fetch('/api/display'); if (!response.ok) throw new Error('settings');
    const settings = await response.json();
    applyDisplaySettings(settings);settingsReady=true;
    await loadState(); connectEvents();
  } catch {setConnection(false, '连接失败'); setTimeout(initializeDisplay, 2000);}
}
if (halftimeEmbed) {
  selectedHalf=halftimeParams.get('half')==='2'?2:1;
  selectedLayer=['low','high'].includes(halftimeParams.get('layer'))?halftimeParams.get('layer'):'all';
  fadeDelaySeconds=Math.max(0,Math.min(60,Number(halftimeParams.get('fade'))||0));
  document.querySelector('#show-players').checked=halftimeParams.get('players')!=='0';
  document.body.classList.add('halftime-embed');replayMode=true;
  addEventListener('message',event=>{
    if(event.source!==parent||event.origin!==halftimeParams.get('parent')||event.data?.type!=='scoredeck-halftime-clock')return;
    const time=Number(event.data.elapsedMs);if(!Number.isFinite(time)||time<0)return;
    const trajectories=latestState?.trajectories||[],duration=replayDurationMs(trajectories,replayRoundStarts(trajectories));
    replayOffsetMs=event.data.loop&&duration>0?time%duration:Math.min(time,duration);
    if(latestState)renderReplay(replayOffsetMs);
  });
  const boot=()=>loadState().then(connectEvents).catch(()=>setTimeout(boot,2000));boot();
} else initializeDisplay();
