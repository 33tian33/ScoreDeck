const groups = "ABCDEFGHIJKL".split("");

function createPlayers(shortName, custom) {
  const fallbacks = ["nova", "vex", "orbit", "clutch", "zero", "reserve", "bench"];
  return fallbacks.map((name, index) => ({
    id: custom?.[index] || `${shortName.toLowerCase()}_${name}`,
    steamId: "",
    rating: Number((1.18 - index * 0.035).toFixed(2)),
    role: ["Rifler", "AWPer", "IGL", "Entry", "Support", "Substitute", "Substitute"][index],
    avatar: "",
    starter: index < 5,
  }));
}

const defaultThemeElements = {
  panel: { fill: "#262626", border: "#454545", opacity: 0.94, transparent: false },
  standings: { fill: "#222222", border: "#414141", opacity: 0.94, transparent: false },
  matchup: { fill: "#262626", border: "#454545", opacity: 0.94, transparent: false },
  schedule: { fill: "#242424", border: "#414141", opacity: 0.94, transparent: false },
};

function createDefaultState() {
  const teams = [{
    id: "team-01",
    name: "Test",
    shortName: "TEST",
    color: "#668dc3",
    logoPrimary: "",
    logoSecondary: "",
    players: createPlayers("TEST"),
  }];

  const matches = [];

  return {
    customPanels: require("./custom-panels.cjs").normalize(),
    stages: [],
    flowLifecycle: { status: "draft" },
    selectedStageId: "",
    flowOutputPage: 0,
    halftime: require("./halftime.cjs").normalize(),
    schemaVersion: 19,
    revision: 1,
    tournament: {
      name: "TestTournament",
      edition: "",
      formatId: "flow",
      groupTieBreak: "round-diff",
      format: "自定义赛事流程",
      location: "",
    },
    theme: {
      visualRevision: 1,
      accent: "#ececec",
      surface: "#262626",
      background: "#181818",
      backgroundTransparent: false,
      fontScale: 1.14,
      elements: Object.fromEntries(Object.entries(defaultThemeElements).map(([key, value]) => [key, { ...value }])),
    },
    backgroundVideo: {
      enabled: false,
      source: "",
      opacity: 0.48,
      fit: "cover",
    },
    outputCycle: {
      enabled: false,
      nodes: [
        { id: "cycle-prematch", label: "赛前对阵", scene: "prematch", stageId: "", flowMatchId: "", flowPage: 0, durationSeconds: 12, transitionSeconds: 1.2, enabled: true },
        { id: "cycle-standings", label: "小组积分", scene: "standings", stageId: "", flowMatchId: "", flowPage: 0, durationSeconds: 10, transitionSeconds: 1.2, enabled: true },
        { id: "cycle-schedule", label: "未来赛程", scene: "schedule", stageId: "", flowMatchId: "", flowPage: 0, durationSeconds: 10, transitionSeconds: 1.2, enabled: true },
      ],
    },
    countdown: {
      title: "MATCH STARTS IN",
      subtitle: "TestTournament",
      endText: "LIVE NOW",
      durationSeconds: 600,
      remainingSeconds: 600,
      status: "idle",
      endAt: null,
    },
    entrance: {
      status: "idle",
      runId: 0,
      startAt: null,
      returnScene: "prematch",
      durations: { identity: 2.4, lineup: 2.6, clutch: 2.1, transition: 20 / 30 },
      overrides: {},
    },
    liveScene: "prematch",
    selectedGroup: "",
    selectedMatchId: "",
    focus: {
      groups: { mode: "single", selected: [] },
      knockout: { mode: "area", areaSize: "quadrant", area: "", stage: "" },
    },
    teams,
    matches,
    mvp: {
      teamId: "",
      playerId: "",
      title: "MATCH MVP",
      statline: "",
      note: "",
      style: "1",
      rating: "",
      we: "",
    },
  };
}

function normalizeShortName(value, fallback) {
  return String(value || fallback || "TBD").trim().toUpperCase().slice(0, 8) || "TBD";
}

function normalizeHex(value, fallback) {
  const normalized = String(value || "").trim();
  return /^#[0-9a-f]{6}$/i.test(normalized) ? normalized : fallback;
}

function normalizeThemeElement(input, fallback) {
  const opacity = Number(input?.opacity);
  return {
    fill: normalizeHex(input?.fill, fallback.fill),
    border: normalizeHex(input?.border, fallback.border),
    opacity: Number.isFinite(opacity) ? Math.min(1, Math.max(0.15, opacity)) : fallback.opacity,
    transparent: input?.transparent === true,
  };
}

function normalizePlayerMapStat(input, index) {
  return {
    playerId: String(input?.playerId || ""),
    steamId: input?.steamId || "", adr: Number.isFinite(input?.adr)?input.adr:null,
    starter: typeof input?.starter === "boolean" ? input.starter : index < 5,
      kills: input?.kills==null||input.kills===''?null:Number.isFinite(Number(input.kills))?Number(input.kills):null,
      deaths: input?.deaths==null||input.deaths===''?null:Number.isFinite(Number(input.deaths))?Number(input.deaths):null,
      assists: input?.assists==null||input.assists===''?null:Number.isFinite(Number(input.assists))?Number(input.assists):null,
    rating: input?.rating===null||input?.rating===undefined||input?.rating==='' ? null : Number.isFinite(Number(input.rating)) ? Number(input.rating) : null,
  };
}

function normalizeSeriesScore(value) {
  const text = String(value ?? "").trim().toUpperCase();
  if (["WW", "FF", "W", "F"].includes(text)) return text;
  return /^\d+$/.test(text) ? Number(text) : 0;
}

function normalizeMapDetails(match) {
  return Array.from({ length: 5 }, (_, index) => {
    const score = match.mapScores?.[index] || { map: `MAP ${index + 1}`, a: null, b: null };
    const detail = match.mapDetails?.[index] || {};
    return {
      ...detail, map: String(detail.map || score.map || `MAP ${index + 1}`),
      a: detail.a ?? score.a ?? null,
      b: detail.b ?? score.b ?? null,
      teamA: Array.isArray(detail.teamA) ? detail.teamA.slice(0, 7).map(normalizePlayerMapStat) : [],
      teamB: Array.isArray(detail.teamB) ? detail.teamB.slice(0, 7).map(normalizePlayerMapStat) : [],
    };
  });
}

function migrateStateRaw(input) {
  const defaults = createDefaultState();
  if (!input || typeof input !== "object") return defaults;
  if (input.theme?.visualRevision !== 1) {
    input = { ...input, theme: { ...input.theme, visualRevision: 1 } };
    const legacy = {"#c8aa67": "#ececec", "#15120d": "#262626", "#080706": "#181818", "#8f7645": "#454545", "#110f0b": "#222222", "#79633a": "#414141", "#17130d": "#262626", "#8a7041": "#454545", "#12100c": "#242424", "#79643d": "#414141"};
    for (const key of ['accent','surface','background']) {
      const value=input.theme[key]; if (legacy[value]) input.theme[key]=legacy[value];
    }
    input.theme.elements = Object.fromEntries(Object.entries(input.theme.elements || {}).map(([key,value]) => [key, {
      ...value, fill:legacy[value.fill]||value.fill, border:legacy[value.border]||value.border
    }]));
  }
  const previousSchemaVersion = Number(input.schemaVersion || 1);
  const existingMatches = Array.isArray(input.matches) && input.matches.length ? input.matches : defaults.matches;
  const knockout = existingMatches.some((match) => match.bracketRound)
    ? []
    : defaults.matches.filter((match) => match.bracketRound);
  return {
    ...defaults,
    ...input,
    customPanels: require("./custom-panels.cjs").normalize(input.customPanels),
    halftime: require("./halftime.cjs").normalize(input.halftime),
    sponsors: {enabled: input.sponsors?.enabled !== false, slots: Array.from({length:4},(_,i)=>({logoImage:typeof input.sponsors?.slots?.[i]?.logoImage==='string'?input.sponsors.slots[i].logoImage:'',fit:input.sponsors?.slots?.[i]?.fit==='fill'?'fill':'cover'}))},
    schemaVersion: 19,
    revision: Math.max(1, Number(input.revision) || defaults.revision),
    tournament: {
      ...defaults.tournament,
      ...input.tournament,
      groupTieBreak: input.tournament?.groupTieBreak === "head-to-head" ? "head-to-head" : "round-diff",
      formatId: ["flow", "world-cup-48", "double-elim-8", "single-elim-16", "single-elim-8", "swiss-16"].includes(input.tournament?.formatId)
        ? input.tournament.formatId
        : defaults.tournament.formatId,
      format: ["flow", "world-cup-48", "double-elim-8", "single-elim-16", "single-elim-8", "swiss-16"].includes(input.tournament?.formatId)
        ? ({ "flow": "自定义赛事流程", "world-cup-48": "世界杯48队模式", "double-elim-8": "8队双败", "single-elim-16": "16队单败", "single-elim-8": "8队单败", "swiss-16": "16队瑞士轮" })[input.tournament.formatId]
        : defaults.tournament.format,
    },
    theme: {
      ...defaults.theme,
      ...input.theme,
      backgroundTransparent: input.theme?.backgroundTransparent === true,
      fontScale: Math.min(1.35, Math.max(1, Number(input.theme?.fontScale) || defaults.theme.fontScale)),
      elements: Object.fromEntries(Object.entries(defaults.theme.elements).map(([key, fallback]) => [key, normalizeThemeElement(input.theme?.elements?.[key], fallback)])),
    },
    backgroundVideo: {
      ...defaults.backgroundVideo,
      ...input.backgroundVideo,
      opacity: Math.min(1, Math.max(0.1, Number(input.backgroundVideo?.opacity) || defaults.backgroundVideo.opacity)),
      fit: input.backgroundVideo?.fit === "contain" ? "contain" : "cover",
    },
    outputCycle: {
      ...defaults.outputCycle,
      ...input.outputCycle,
      nodes: (Array.isArray(input.outputCycle?.nodes) ? input.outputCycle.nodes : defaults.outputCycle.nodes).map((node, index) => ({
        id: String(node.id || `cycle-${index + 1}`),
        label: String(node.label || `页面 ${index + 1}`),
        scene: ["focus", "standings", "thirdPlace", "prematch", "bracket", "knockoutFocus", "postmatch", "schedule", "mapStats", "mapBP", "custom1", "custom2"].includes(node.scene) ? node.scene : "prematch",
        group: groups.includes(String(node.group || "").toUpperCase()) ? String(node.group).toUpperCase() : String(input.selectedGroup || ""),
        stageId: typeof node.stageId === "string" ? node.stageId : "",
        flowMatchId: typeof node.flowMatchId === "string" ? node.flowMatchId : "",
        flowPage: Math.max(0, Math.min(99, Number(node.flowPage) || 0)),
        knockoutArea: node.knockoutArea === "lower" ? "lower" : "upper",
        durationSeconds: Math.min(3600, Math.max(1, Number(node.durationSeconds) || 10)),
        transitionSeconds: Math.min(10, Math.max(0, Number(node.transitionSeconds) || 0)),
        enabled: node.enabled !== false,
      })),
    },
    countdown: {
      ...defaults.countdown,
      ...input.countdown,
      durationSeconds: Math.max(1, Number(input.countdown?.durationSeconds) || defaults.countdown.durationSeconds),
      remainingSeconds: Number.isFinite(Number(input.countdown?.remainingSeconds)) ? Math.max(0, Number(input.countdown.remainingSeconds)) : defaults.countdown.remainingSeconds,
      status: ["idle", "running", "paused"].includes(input.countdown?.status) ? input.countdown.status : "idle",
      endAt: input.countdown?.endAt || null,
      endText: String(input.countdown?.endText || defaults.countdown.endText),
    },
    entrance: {
      ...defaults.entrance,
      ...input.entrance,
      showClutch: input.entrance?.showClutch !== false,
      status: input.entrance?.status === "running" ? "running" : "idle",
      runId: Number(input.entrance?.runId) || 0,
      startAt: input.entrance?.startAt || null,
      returnScene: "prematch",
      durations: {
        identity: Math.max(2.4, Number(input.entrance?.durations?.identity) || defaults.entrance.durations.identity),
        lineup: Math.max(1.4, Number(input.entrance?.durations?.lineup) || defaults.entrance.durations.lineup),
        clutch: Math.max(1.4, Number(input.entrance?.durations?.clutch) || defaults.entrance.durations.clutch),
        transition: Math.max(0.2, Number(input.entrance?.durations?.transition) || defaults.entrance.durations.transition),
      },
      overrides: input.entrance?.overrides && typeof input.entrance.overrides === "object" ? input.entrance.overrides : {},
    },
    focus: {
      groups: { ...defaults.focus.groups, ...input.focus?.groups },
      knockout: { ...defaults.focus.knockout, ...input.focus?.knockout, stage: input.focus?.knockout?.stage || defaults.focus.knockout.stage },
    },
    mvp: {
      ...defaults.mvp,
      ...input.mvp,
      style: String(input.mvp?.style || defaults.mvp.style) === "2" ? "2" : "1",
      rating:
        input.mvp?.rating === "" || input.mvp?.rating === null || input.mvp?.rating === undefined
          ? ""
          : Number.isFinite(Number(input.mvp.rating))
            ? Math.max(0, Number(input.mvp.rating))
            : "",
      we: String(input.mvp?.we || "").slice(0, 24),
    },
    teams: (Array.isArray(input.teams) ? input.teams : defaults.teams).map((team, teamIndex) => {
      const players = Array.from({ length: 7 }, (_, index) => ({
        ...(defaults.teams[teamIndex]?.players[index] || defaults.teams[0].players[index]),
        ...(team.players?.[index] || {}),
        steamId: typeof team.players?.[index]?.steamId === "string" ? team.players[index].steamId.normalize("NFKC").trim() : "",
        avatar: String(team.players?.[index]?.avatar || ""),
        starter: typeof team.players?.[index]?.starter === "boolean" ? team.players[index].starter : index < 5,
      }));
      if (players.filter((player) => player.starter).length > 5) {
        let remaining = 5;
        players.forEach((player) => { player.starter = player.starter && remaining-- > 0; });
      }
      return {
        ...team,
        shortName: normalizeShortName(team.shortName, team.name),
        players,
      };
    }),
    matches: existingMatches.map((match, index) => ({
      ...match,
      scoreA: normalizeSeriesScore(match.scoreA),
      scoreB: normalizeSeriesScore(match.scoreB),
      status: !match.teamAId || !match.teamBId
        ? "tbd"
        : previousSchemaVersion < 3 && match.bracketRound && match.status === "upcoming"
        ? "tbd"
        : ["tbd", "upcoming", "live", "completed"].includes(match.status)
          ? match.status
          : match.bracketRound ? "tbd" : "upcoming",
      bestOf: (match.bracketRound ? [1, 3, 5] : [1, 2, 3, 5]).includes(Number(match.bestOf)) ? Number(match.bestOf) : 3,
      scheduleOrder: Number.isFinite(Number(match.scheduleOrder)) ? Number(match.scheduleOrder) : index + 1,
      mapScores: Array.from({ length: 5 }, (_, index) => match.mapScores?.[index] || { map: `MAP ${index + 1}`, a: null, b: null }),
      mapDetails: normalizeMapDetails(match),
      mvp: match.mvp && typeof match.mvp.playerId === "string" && typeof match.mvp.teamId === "string"
        ? { teamId: match.mvp.teamId, playerId: match.mvp.playerId }
        : undefined,
      sourceA: match.sourceA && typeof match.sourceA.matchId === "string" && ["winner", "loser"].includes(match.sourceA.result) ? { matchId: match.sourceA.matchId, result: match.sourceA.result } : undefined,
      sourceB: match.sourceB && typeof match.sourceB.matchId === "string" && ["winner", "loser"].includes(match.sourceB.result) ? { matchId: match.sourceB.matchId, result: match.sourceB.result } : undefined,
      generatedByFormat: ["world-cup-48", "double-elim-8", "single-elim-16", "single-elim-8", "swiss-16"].includes(match.generatedByFormat) ? match.generatedByFormat : undefined,
    })).concat(knockout),
  };
}

const rules = require("./scoredeck-rules.cjs");
function migrateState(input) {
  const state=migrateStateRaw(input);
  rules.migrateTeamProfiles(state);
  state.matches.forEach(match=>rules.normalizeMatch(match));
  if (state.tournament.formatId === "flow") {
    state.stages = Array.isArray(input?.stages) ? structuredClone(input.stages) : [];
    const flow=require("./tournament-flow.cjs");
    flow.normalize(state);flow.reconcile(state);flow.refreshLifecycle(state);
  }
  return state;
}
module.exports = { createDefaultState, migrateState };
