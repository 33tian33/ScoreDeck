'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {connect} = require('./obs-client.cjs');
const defaults = {enabled: false, url: 'ws://127.0.0.1:4455', password: '', highlightScene: 'ScoreDeck 精选', liveScene: 'ScoreDeck 直播控制'};
function normalize(input) {
  const c = {...defaults, ...input};
  const u = new URL(c.url);
  if (!['ws:', 'wss:'].includes(u.protocol) || u.username || u.password) throw Error('OBS 地址须为 ws:// 或 wss://');
  c.enabled = c.enabled === true;
  for (const k of ['password', 'highlightScene', 'liveScene']) c[k] = String(c[k] || '').slice(0, 256);
  if (!c.highlightScene.trim() || !c.liveScene.trim() || c.highlightScene === c.liveScene) throw Error('精选场景与直播控制场景须填写，且不能相同');
  return Object.fromEntries(Object.keys(defaults).map(k => [k, c[k]]));
}
function createController({dir, getItems, hasReplay, getPlayback=()=>null, open = connect, now = Date.now}) {
  const file = path.join(dir, 'highlight-obs.json'), sessionFile = path.join(dir, 'highlight-obs-session.json');
  const read = (p, fallback) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } };
  let config = normalize(read(file, defaults)), run = read(sessionFile, null), error = '', connected = false;
  // Never resume stale video after a process restart; recover its owned OBS scene.
  if (run) run.status = 'returning';
  let queue = Promise.resolve();
  const serial = fn => { const p = queue.then(fn); queue = p.catch(() => {}); return p; };
  const write = (p, data) => { fs.writeFileSync(p + '.tmp', JSON.stringify(data, null, 2)); fs.renameSync(p + '.tmp', p); };
  const saveRun = () => write(sessionFile, run);
  const publicConfig = () => ({...config, password: undefined, hasPassword: !!config.password});
  async function transaction(c, fn) {
    let client;
    try { client = await open(c); const result = await fn(client); connected = true; error = ''; return result; }
    catch (e) { connected = false; error = e.message; throw e; }
    finally { client?.close(); }
  }
  async function finish() {
    if (!run) return;
    run.status = 'returning'; saveRun();
    if (run.returnScene) await transaction(run.config, async obs => {
      const current = await obs.call('GetCurrentProgramScene');
      if (current.currentProgramSceneName === run.config.highlightScene)
        await obs.call('SetCurrentProgramScene', {sceneName: run.mode === 'full' ? run.config.liveScene : run.returnScene});
    });
    run = null; saveRun();
  }
  return {
    meta() { return {config: publicConfig(), connected, error, run: run ? {id: run.id, mode: run.mode, status: run.status, items: run.items, startedAt: run.startedAt, ready: !!run.items?.length, returnScene: run.returnScene, reason: run.reason, playback: run.playback,
      waitMessage:run.status==='preparing'?(run.items?.length?`已找到 ${run.items.length} 段精选，等待 OBS 浏览器源就绪；源地址须带 ?obs=1，并取消“不可见时关闭源”`:`Replay ${run.mode==='full'?'全场':'半场'}精选当前为 0 段；请先生成片段并加入对应片单，再试播。空片单不会切换 OBS。`):''} : null}; },
    ownsScene() { return !!run; },
    configure(input) { return serial(async () => {
      if (run) throw Error('请先结束精选播出，再修改 OBS 设置');
      config = normalize({...config, ...input, password: input.password === '' || input.password === undefined ? config.password : input.password});
      if (input.clearPassword) config.password = '';
      write(file, config); connected=false;error='';return this.meta();
    }); },
    test() { return serial(() => transaction(config, async obs => {
      const s = await obs.call('GetSceneList');
      return {scenes: (s.scenes || []).map(s => s.sceneName), currentScene: s.currentProgramSceneName};
    })); },
    begin(id, mode) { return serial(async () => {
      if (run) await finish();
      if (!config.enabled) return;
      if (!hasReplay(mode)) throw Error('精选画面中至少需要一个 Replay 元素，才能自动判断播完');
      run = {id, mode, config: {...config}, playback: getPlayback(), status: 'preparing', items: [], createdAt: now(), startedAt: null, returnScene: '', owner: '', heartbeatAt: 0};
      error = ''; saveRun();return true;
    }); },
    end(id, reason) { return serial(async () => { if (run && (!id || run.id === id)) {run.reason = reason; await finish();} }); },
    tick(activeId) { return serial(async () => {
      if (!run) return null;
      if (run.id !== activeId || run.status === 'returning') { await finish(); return 'recovered'; }
      if (run.status === 'preparing') {
        if (now() - run.createdAt > 45000) { error = run.items.length?'已取消本次播出：45 秒内未收到 OBS 输出页就绪通知，请使用带 ?obs=1 的源地址，并取消“不可见时关闭源”及“场景变为活动状态时刷新浏览器”':'已取消本次播出：Replay 精选片单为空，请先生成片段并加入对应片单，再点击试播'; return 'prepare-timeout'; }
        if (!run.items.length) {
          try { run.items = (await getItems(run.mode)).filter(v => Number.isFinite(v.duration) && v.duration > 0).map(v => ({...v})); error='';saveRun(); }
          catch (e) { error = e.message; }
        }
      } else if (run.status === 'playing') {
        if (now() - run.heartbeatAt > 15000) { error = '精选输出页心跳中断，已请求返回'; return 'output-lost'; }
        const scene = await transaction(run.config, obs => obs.call('GetCurrentProgramScene'));
        if (scene.currentProgramSceneName !== run.config.highlightScene) return 'manual-scene';
      }
      return null;
    }); },
    signal({id, clientId, action}) { return serial(async () => {
      if (!run || run.id !== id || typeof clientId !== 'string' || !/^[a-zA-Z0-9-]{10,80}$/.test(clientId)) return {accepted: false};
      if (action === 'ready' && run.status === 'preparing' && run.items.length) {
        await transaction(run.config, async obs => {
          const scenes = await obs.call('GetSceneList');
          for (const name of [run.config.highlightScene, run.config.liveScene])
            if (!scenes.scenes?.some(s => s.sceneName === name)) throw Error('OBS 缺少场景：' + name);
          const current = await obs.call('GetCurrentProgramScene');
          if (current.currentProgramSceneName === run.config.highlightScene) throw Error('开始前请先切回游戏或直播控制场景');
          run.returnScene = current.currentProgramSceneName; run.owner = clientId;
          // Persist ownership before sending a command with a potentially lost acknowledgement.
          run.status = 'returning'; saveRun();
          await obs.call('SetCurrentProgramScene', {sceneName: run.config.highlightScene});
          run.status = 'playing'; run.startedAt = now(); run.heartbeatAt = now(); saveRun();
        });
        return {accepted: true, startedAt: run.startedAt};
      }
      if (run.status !== 'playing' || run.owner !== clientId) return {accepted: false};
      run.heartbeatAt = now();
      return {accepted: true, finish: action === 'ended' || action === 'error' ? action : null};
    }); }
  };
}
module.exports = {createController, normalize};
