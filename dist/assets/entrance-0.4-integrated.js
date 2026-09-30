(function () {
  "use strict";

  const isOutput = location.pathname.startsWith("/output");
  const isDedicated = location.pathname === "/output/entrance" || location.pathname === "/output/entrance/";
  const defaults = {
    showClutch: true, status: "idle", runId: 0, startAt: null, returnScene: "prematch", overrides: {},
    durations: {identity: 2.4, lineup: 2.6, clutch: 2.1, transition: 20 / 30},
  };
  let state = null;
  let saveTimer = null;
  let previewStarted = Date.now();
  let lastSceneKey = "";

  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"})[c]);
  const initials = (value) => esc(String(value || "?").slice(0, 4).toUpperCase());
  const entrance = () => ({...defaults, ...(state?.entrance || {}), durations: {...defaults.durations, ...(state?.entrance?.durations || {})}, overrides: state?.entrance?.overrides || {}});
  const currentMatch = () => window.ScoreDeckFlow?.enabled(state)?(window.ScoreDeckDisplay?.primary(state)||{}):(state?.matches?.find((m) => m.id === state.selectedMatchId) || state?.matches?.[0] || {});
  const teamById = (id) => state?.teams?.find((t) => t.id === id) || {id: id || "tbd", name: "TBD", shortName: "TBD", color: "#8b1028", players: []};

  function teamData(side) {
    const match = currentMatch();
    const base = teamById(side === 0 ? match.teamAId : match.teamBId);
    const over = entrance().overrides[base.id] || {};
    const basePlayers = Array.from({length: 7}, (_, i) => base.players?.[i] || {id: `Player ${i + 1}`, role: i < 5 ? "Player" : "Substitute", avatar: ""});
    const allPlayers = basePlayers.map((p, i) => ({
      id: over.players?.[i]?.id || p.id || `Player ${i + 1}`,
      role: over.players?.[i]?.role || p.role || "Player",
      avatar: over.players?.[i]?.avatar || p.avatar || "",
    }));
    const teamStarters = basePlayers.map((player, index) => ({player, index})).filter(({player, index}) => typeof player.starter === "boolean" ? player.starter : index < 5).map(({index}) => index);
    const configured = Array.isArray(over.starterIndexes) ? [...new Set(over.starterIndexes.map(Number).filter((i) => i >= 0 && i < 7))] : teamStarters;
    const starterIndexes = configured;
    const players = starterIndexes.map((i) => allPlayers[i]);
    const fallbackClutchRosterIndex = starterIndexes[Math.min(4, Math.max(0, Number(over.clutchIndex ?? 0)))] ?? starterIndexes[0] ?? 0;
    const clutchRosterIndex = starterIndexes.includes(Number(over.clutchRosterIndex)) ? Number(over.clutchRosterIndex) : fallbackClutchRosterIndex;
    const clutchPlayer = allPlayers[clutchRosterIndex] || players[0];
    return {
      id: base.id,
      name: over.name || base.name || "TBD",
      shortName: String(over.shortName || base.shortName || "TBD").toUpperCase().slice(0, 8),
      logoImage: over.logoImage || base.logoPrimary || base.logoSecondary || "",
      primaryColor: over.primaryColor || base.color || "#8b1028",
      secondaryColor: over.secondaryColor || "#241215",
      accentColor: over.accentColor || "#e0be78",
      sourceNote: over.sourceNote || "战绩出处：赛事组委会统计",
      rating: over.rating || String(base.players?.[clutchRosterIndex]?.rating || "1.00"),
      we: over.we || "0",
      starterIndexes, configuredStarterIndexes: configured, allPlayers, players, clutchRosterIndex, clutchPlayer,
    };
  }

  async function loadState() {
    const response = await fetch("/api/state", {cache: "no-store"});
    state = await response.json();
    state.entrance = entrance();
    return state;
  }

  async function saveNow(message) {
    if (!state) return;
    const desired=structuredClone(state), base=SDClient.state;
    const changes=SDClient.diff(base,desired);
    await SDClient.mutate(current=>SDClient.apply(current,changes));
    state=structuredClone(SDClient.state);
    const status=document.querySelector("#sd-entrance-status");
    if(status)status.textContent=message||"已同步";
  }

  function queueSave(message) {
    saveNow(message).catch(error=>{const status=document.querySelector("#sd-entrance-status");if(status)status.textContent=error.message||"保存失败";});
  }

  function avatarMarkup(src, name, className) {
    return src
      ? `<img class="${className || "sd-ent-avatar"}" src="${esc(src)}" alt="">`
      : `<div class="${className || "sd-ent-avatar"} sd-ent-avatar-fallback">${initials(name)}</div>`;
  }

  function badgeMarkup(team, inverse) {
    return `<div class="sd-ent-badge ${inverse ? "inverse" : ""}" style="--primary:${esc(team.primaryColor)};font-size:${team.shortName.length >= 4 ? 20 : 28}px">${team.logoImage ? `<img src="${esc(team.logoImage)}" alt="">` : initials(team.shortName)}</div>`;
  }

  function identityMarkup(team) {
    const rows = Array.from({length: 13}, () => `<span>${esc(team.shortName)}</span>`).join("");
    return `<section class="sd-ent-scene sd-ent-identity" style="--primary:${esc(team.primaryColor)};--secondary:${esc(team.secondaryColor)};--accent:${esc(team.accentColor)}">
      <div class="sd-ent-id-bg"></div><div class="sd-ent-id-white"><div class="sd-ent-wall">${rows}<b class="pass-one">${esc(team.shortName)}</b><b class="pass-two">${esc(team.shortName)}</b></div><div class="sd-ent-fullname">${esc(team.name)}</div></div>
      <div class="sd-ent-id-rail">${badgeMarkup(team)}<strong>${esc(team.shortName)}</strong></div><div class="sd-ent-small-badge">${badgeMarkup(team)}</div>
    </section>`;
  }

  function lineupMarkup(team) {
    const players = team.players.map((p, i) => `<article style="--delay:${i * .13}s"><i style="font-size:${team.shortName.length >= 4 ? 80 : 118}px">${esc(team.shortName)}</i>${avatarMarkup(p.avatar, p.id)}<strong>${esc(p.id)}</strong><span>${esc(p.role)}</span></article>`).join("");
    return `<section class="sd-ent-scene sd-ent-lineup" style="--primary:${esc(team.primaryColor)};--secondary:${esc(team.secondaryColor)};--accent:${esc(team.accentColor)}"><small>${esc(team.name)}</small><div class="sd-ent-five">${players}</div><aside>${badgeMarkup(team, true)}<b>Starting Five</b></aside></section>`;
  }

  function clutchMarkup(team) {
    const p = team.clutchPlayer || team.players[0];
    return `<section class="sd-ent-scene sd-ent-clutch" style="--primary:${esc(team.primaryColor)};--secondary:${esc(team.secondaryColor)};--accent:${esc(team.accentColor)}"><div class="sd-ent-outline">${esc(team.shortName)}<br>${esc(team.shortName)}<br>${esc(team.shortName)}</div><div class="sd-ent-clutch-person">${avatarMarkup(p.avatar, p.id, "sd-ent-clutch-avatar")}<strong>${esc(p.id)}</strong><span>${esc(p.role)}</span></div><div class="sd-ent-metrics"><small>${esc(team.sourceNote)}</small><h2>Clutch Player</h2><div><article><b>RATING</b><strong>${esc(team.rating)}</strong></article><article><b>WE</b><strong>${esc(team.we)}</strong></article></div><p>${esc(team.name)}</p></div><aside>${badgeMarkup(team, true)}<b>Clutch Player</b></aside></section>`;
  }

  function sceneMarkup(name, team) {
    return name === "lineup" ? lineupMarkup(team) : name === "clutch" ? clutchMarkup(team) : identityMarkup(team);
  }

  /*
   * v0.4 source timing, expressed as ratios of its 20-frame wipe Sequence:
   * identity 0-72, wipe-in 66-86, lineup 80-158,
   * wipe-out 150-170, clutch 162-225 (30fps).
   * Page durations remain configurable; the overlap ratios stay identical.
   */
  function teamTimeline(side, start, d) {
    const transition = d.transition;
    const identity = {side, page: "identity", key: `${side}-identity`, start, end: start + d.identity};
    const wipeIn = {side, key: `${side}-wipe-in`, direction: "in", start: identity.end - transition * .3};
    wipeIn.end = wipeIn.start + transition;
    const lineupStart = wipeIn.start + transition * .7;
    const lineup = {side, page: "lineup", key: `${side}-lineup`, start: lineupStart, end: lineupStart + d.lineup};
    if (entrance().showClutch === false) return {scenes: [identity, lineup], wipes: [wipeIn], clutchEnd: lineup.end};
    const wipeOut = {side, key: `${side}-wipe-out`, direction: "out", start: lineup.end - transition * .4};
    wipeOut.end = wipeOut.start + transition;
    const clutchStart = wipeOut.start + transition * .6;
    const clutch = {side, page: "clutch", key: `${side}-clutch`, start: clutchStart, end: clutchStart + d.clutch};
    return {scenes: [identity, lineup, clutch], wipes: [wipeIn, wipeOut], clutchEnd: clutch.end};
  }

  function timeline(elapsed) {
    const raw = entrance().durations;
    const d = {
      identity: Number(raw.identity),
      lineup: Number(raw.lineup),
      clutch: Number(raw.clutch),
      transition: Number(raw.transition),
    };
    const first = teamTimeline(0, 0, d);
    const handoff = {side: 1, key: "0-to-1", direction: "in", start: first.clutchEnd - d.transition * .4};
    handoff.end = handoff.start + d.transition;
    const second = teamTimeline(1, handoff.start + d.transition * .6, d);
    const finish = {side: 1, key: "1-to-prematch", direction: "in", start: second.clutchEnd - d.transition * .4};
    finish.end = finish.start + d.transition;
    const total = finish.end;
    if (isDedicated && entrance().status !== "running") elapsed %= total;
    if (elapsed >= total) return {done: true, total};
    const scenes = [...first.scenes, ...second.scenes];
    const wipes = [...first.wipes, handoff, ...second.wipes, finish];
    const scene = scenes.find((item) => elapsed >= item.start && elapsed < item.end) || null;
    const wipe = wipes.find((item) => elapsed >= item.start && elapsed < item.end) || null;
    return {scene, wipe, total, elapsed};
  }

  function wipeMarkup(wipe, team, elapsed) {
    const delay = Math.max(0, elapsed - wipe.start);
    return `<div class="sd-ent-wipe sd-ent-wipe-${wipe.direction}" style="--primary:${esc(team.primaryColor)};--secondary:${esc(team.secondaryColor)};--wipe-duration:${entrance().durations.transition}s;--wipe-delay:-${delay}s"><div class="sd-ent-wipe-panel"></div><b>${esc(team.shortName)}</b></div>`;
  }

  function outputTick() {
    if (!state) return;
    const running = entrance().status === "running" && entrance().startAt && state.liveScene === "entrance";
    const shouldShow = isDedicated || (location.pathname === "/output/live" && running);
    let stage = document.getElementById("sd-entrance-output");
    if (!shouldShow) { if (stage) stage.remove(); lastSceneKey = ""; return; }
    if (!stage) { stage = document.createElement("div"); stage.id = "sd-entrance-output"; document.body.appendChild(stage); }
    const started = running ? new Date(entrance().startAt).getTime() : previewStarted;
    const point = timeline(Math.max(0, ((running ? SDClient.now() : Date.now()) - started) / 1000));
    if (point.done) { if (!isDedicated) stage.remove(); return; }
    const activeSide = point.scene?.side ?? point.wipe?.side ?? 0;
    const team = teamData(activeSide);
    let canvas = stage.querySelector(".sd-ent-canvas");
    if (!canvas) {
      stage.innerHTML = `<div class="sd-ent-canvas"><div class="sd-ent-scene-layer"></div><div class="sd-ent-transition-layer"></div></div>`;
      canvas = stage.querySelector(".sd-ent-canvas");
    }
    const sceneLayer = canvas.querySelector(".sd-ent-scene-layer");
    const transitionLayer = canvas.querySelector(".sd-ent-transition-layer");
    const sceneKey = point.scene?.key || "blank";
    if (sceneLayer.dataset.sceneKey !== sceneKey) {
      sceneLayer.dataset.sceneKey = sceneKey;
      sceneLayer.innerHTML = point.scene ? sceneMarkup(point.scene.page, teamData(point.scene.side)) : "";
      lastSceneKey = sceneKey;
    }
    const wipeKey = point.wipe?.key || "none";
    if (transitionLayer.dataset.wipeKey !== wipeKey) {
      transitionLayer.dataset.wipeKey = wipeKey;
      transitionLayer.innerHTML = point.wipe ? wipeMarkup(point.wipe, teamData(point.wipe.side), point.elapsed) : "";
    }
    canvas.style.background = team.secondaryColor;
    if (canvas) canvas.style.transform = `translate(-50%,-50%) scale(${Math.min(innerWidth / 1920, innerHeight / 1080)})`;
  }

  function inputValue(over, field) { return esc(over?.[field] || ""); }
  function teamEditor(team, side) {
    const over = entrance().overrides[team.id] || {};
    const base = teamData(side);
    const selected = base.configuredStarterIndexes;
    const players = base.allPlayers.map((p, i) => `<div class="sd-ent-player-row ${selected.includes(i) ? "is-starter" : "is-sub"}"><b>${i+1}</b><strong>${esc(p.id)}</strong><span>${esc(p.role)}</span><span>${avatarMarkup(p.avatar,p.id, "sd-ent-managed-avatar")}</span><span></span><button type="button" class="sd-ent-starter-toggle" data-starter-team="${esc(team.id)}" data-starter-index="${i}" aria-pressed="${selected.includes(i)}">${selected.includes(i) ? "首发" : "替补"}</button></div>`).join("");
    return `<details class="panel sd-ent-team-card" open><summary><span>${side===0?"A":"B"}</span><strong>${esc(team.name)} / ${esc(team.shortName)}</strong></summary><p class="sd-ent-roster-help">队名、队标、头像、位置、出场颜色及 Clutch 数据请在「队伍管理」中编辑。</p><div class="sd-ent-roster-heading"><h3>7 人名单 · 5 首发＋2 替补</h3><span>已选 ${selected.length}/5</span></div><div class="sd-ent-player-editor">${players}</div></details>`;
  }

  function renderController() {
    const panel = document.getElementById("sd-entrance-controller");
    if (!panel || !state) return;
    const match = currentMatch(), a = teamById(match.teamAId), b = teamById(match.teamBId), d = entrance().durations;
    const aData = teamData(0), bData = teamData(1);
    const validStarters = aData.configuredStarterIndexes.length === 5 && bData.configuredStarterIndexes.length === 5;
    panel.innerHTML = `<div class="workspace sd-ent-workspace"><section class="panel sd-ent-hero"><div><p class="eyebrow">ENTRANCE ANIMATION · v0.4</p><h2>主赛双方入场动画</h2><p>自动读取当前主赛的两支队伍，按 A 队、B 队依次播出（可关闭第三部分 Clutch Player）；仅在导播手动开始后推送，结束自动回到赛事前瞻。每队须从完整 7 人名单中选定 5 名首发。</p></div><div class="sd-ent-hero-actions"><span id="sd-entrance-status">${entrance().status === "running" ? "正在播出" : validStarters ? "配置已同步 · 双方均为 5 名首发" : "首发未满 5 人，暂不能推送"}</span><button class="button secondary" id="sd-entrance-cancel">停止并回前瞻</button><button class="button primary" id="sd-entrance-start" ${!match.teamAId || !match.teamBId || !validStarters ? "disabled" : ""}>手动开始并推送</button></div></section><section class="panel sd-ent-timing"><div class="panel-heading"><div><p class="eyebrow">TIMING</p><h2>逐页停留时间</h2></div><code>/output/live</code></div><label class="sd-ent-clutch-toggle"><input type="checkbox" id="sd-entrance-show-clutch" ${entrance().showClutch !== false ? "checked" : ""}> 显示第三部分：Clutch Player（双方队伍）</label><p class="hint">关闭后跳过 Clutch Player，保留简称页与首发页；自动返回前瞻的时间同步缩短。</p><div class="form-grid four"><label>简称扫描页（秒）<input type="number" min="2.4" step="0.1" data-duration="identity" value="${d.identity}"></label><label>首发五人页（秒）<input type="number" min="1.4" step="0.1" data-duration="lineup" value="${d.lineup}"></label><label>Clutch Player 页（秒）<input type="number" min="1.4" step="0.1" data-duration="clutch" ${entrance().showClutch === false ? "disabled" : ""} value="${d.clutch}"></label><label>斜切转场（秒，0.4 原版为 0.667）<input type="number" min="0.2" step="0.001" data-duration="transition" value="${Number(d.transition.toFixed(3))}"></label></div></section><section class="panel preview-panel"><div class="panel-heading"><div><p class="eyebrow">OUTPUT PREVIEW · 16:9</p><h2>入场动画预览</h2></div><a class="text-link" href="/output/entrance" target="_blank">全屏打开 ↗</a></div><div class="preview-frame"><iframe src="/output/entrance?preview=1" title="入场动画预览"></iframe></div></section><div class="sd-ent-team-grid">${teamEditor(a,0)}${teamEditor(b,1)}</div></div>`;
    bindController(panel);
  }

  function updateOverride(teamId, field, value) {
    state.entrance = entrance();
    state.entrance.overrides[teamId] ||= {};
    state.entrance.overrides[teamId][field] = value;
  }

  function bindController(panel) {
    panel.querySelector("#sd-entrance-show-clutch").addEventListener("change", (event) => { state.entrance = entrance(); state.entrance.showClutch = event.target.checked; panel.querySelector('[data-duration="clutch"]').disabled = !event.target.checked; queueSave("Clutch Player 显示设置已同步"); });
    panel.querySelectorAll("input:not([type=number]):not([type=file]):not([type=checkbox])").forEach(input=>input.addEventListener("compositionend",()=>input.dispatchEvent(new Event("input",{bubbles:true}))));
    panel.querySelectorAll("[data-duration]").forEach((input) => input.addEventListener("change", () => { state.entrance = entrance(); state.entrance.durations[input.dataset.duration] = Number(input.value); queueSave("停留时间已同步"); }));
    panel.querySelectorAll("[data-team][data-field]").forEach((input) => input.addEventListener("input", (event) => { if(event.isComposing)return; updateOverride(input.dataset.team, input.dataset.field, input.value); queueSave("动画内容已同步"); }));
    panel.querySelectorAll("[data-team][data-player]").forEach((input) => input.addEventListener("input", (event) => { if(event.isComposing)return; const id=input.dataset.team, index=Number(input.dataset.player); state.entrance=entrance(); state.entrance.overrides[id] ||= {}; state.entrance.overrides[id].players ||= []; state.entrance.overrides[id].players[index] ||= {}; state.entrance.overrides[id].players[index][input.dataset.pfield]=input.value; queueSave("选手内容已同步"); }));
    panel.querySelectorAll("[data-starter-team]").forEach((button) => button.addEventListener("click", () => {
      const id = button.dataset.starterTeam, index = Number(button.dataset.starterIndex);
      state.entrance = entrance(); state.entrance.overrides[id] ||= {};
      const selected = Array.isArray(state.entrance.overrides[id].starterIndexes) ? [...state.entrance.overrides[id].starterIndexes] : teamData(id === currentMatch().teamAId ? 0 : 1).configuredStarterIndexes.slice();
      const position = selected.indexOf(index);
      if (position >= 0) selected.splice(position, 1);
      else if (selected.length < 5) selected.push(index);
      else { const status=document.querySelector("#sd-entrance-status"); if(status) status.textContent="请先取消一名首发，再选择替补"; return; }
      state.entrance.overrides[id].starterIndexes = selected;
      const clutch = Number(state.entrance.overrides[id].clutchRosterIndex);
      if (!selected.includes(clutch)) state.entrance.overrides[id].clutchRosterIndex = selected[0] ?? 0;
      queueSave(selected.length === 5 ? "首发名单已同步" : `当前已选 ${selected.length}/5，补满后方可推送`);
      renderController();
    }));
    panel.querySelectorAll("input[type=file][data-upload-team]").forEach((input) => input.addEventListener("change", () => { const file=input.files?.[0]; if(!file)return; const reader=new FileReader(); reader.onload=()=>{ if(input.dataset.uploadField) updateOverride(input.dataset.uploadTeam,input.dataset.uploadField,String(reader.result)); else { const id=input.dataset.uploadTeam,index=Number(input.dataset.uploadPlayer); state.entrance=entrance(); state.entrance.overrides[id] ||= {}; state.entrance.overrides[id].players ||= []; state.entrance.overrides[id].players[index] ||= {}; state.entrance.overrides[id].players[index].avatar=String(reader.result); } queueSave("图片已同步"); }; reader.readAsDataURL(file); }));
    panel.querySelectorAll("[data-reset-team]").forEach((button) => button.addEventListener("click", () => { delete state.entrance.overrides[button.dataset.resetTeam]; queueSave("动画覆盖已清除"); renderController(); }));
    panel.querySelector("#sd-entrance-start")?.addEventListener("click", async () => { const valid=teamData(0).configuredStarterIndexes.length===5&&teamData(1).configuredStarterIndexes.length===5; if(!valid){alert("双方都必须选满 5 名首发后才能推送");return;} clearTimeout(saveTimer); state.entrance=entrance(); state.entrance.status="running"; state.entrance.runId=Date.now(); state.entrance.startAt=new Date(SDClient.now()).toISOString(); state.liveScene="entrance"; await saveNow("入场动画正在播出"); renderController(); });
    panel.querySelector("#sd-entrance-cancel")?.addEventListener("click", async () => { clearTimeout(saveTimer); state.entrance=entrance(); state.entrance.status="idle"; state.entrance.startAt=null; state.liveScene="prematch"; await saveNow("已停止并返回赛事前瞻"); renderController(); });
  }

  function installController() {
    const panel = document.getElementById("sd-entrance-controller");
    if (!panel || (panel.dataset.sdEntranceMounted && panel.firstElementChild)) return;
    panel.dataset.sdEntranceMounted = "true";
    renderController();
  }

  async function boot() {
    SDClient.subscribe(next=>{
      if(!next)return;
      state=structuredClone(next);
      if(isOutput)outputTick();
      else if(document.getElementById("sd-entrance-controller") && !document.getElementById("sd-entrance-controller").contains(document.activeElement))renderController();
    });
    if(isOutput){
      const animate=()=>{if(isDedicated || (state?.liveScene==="entrance" && state?.entrance?.status==="running"))outputTick();requestAnimationFrame(animate);};
      animate();addEventListener("resize",outputTick);
    } else {installController();new MutationObserver(installController).observe(document.getElementById("root")||document.body,{childList:true,subtree:true});}
  }
  boot();
})();
