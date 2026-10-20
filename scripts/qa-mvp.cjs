const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const {chromium} = require('playwright');
const {createBroadcastServer} = require('../server/broadcast-server.cjs');
const {createTestState} = require('../tests/fixtures/state.cjs');
const F = require('../server/tournament-flow.cjs');
const free = () => new Promise(resolve => {
  const server = net.createServer().listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    server.close(() => resolve(port));
  });
});
(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scoredeck-mvp-'));
  process.env.SCOREDECK_RADAR_PORT = String(await free());
  process.env.SCOREDECK_GSI_PORT = String(await free());
  const app = createBroadcastServer({dataDir, initialPort: await free(), initialCountdownPort: await free()});
  let browser;
  try {
    const meta = await app.listen();
    browser = await chromium.launch({executablePath: process.env.CHROME_EXECUTABLE, headless: true});
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => { errors.push(error.message); console.error(error.stack); });
    await page.goto(meta.localUrl);
    await page.waitForFunction(() => window.SDClient?.state);
    const state = createTestState(2);
    state.teams.forEach(team => {
      team.players = [];
      team.webSync = {mode: 'snapshot'};
    });
    const stage = F.addStage(state, 'playoff', {teamCount: 2});
    stage.slots.forEach((slot, i) => slot.teamId = state.teams[i].id);
    F.reconcile(state);
    F.activate(state);
    await page.evaluate(state => SDClient.replace(state), state);
    await page.locator('.sidebar nav').getByRole('button', {name: '赛后与 MVP', exact: true}).click();
    await page.locator('.mvp-form').waitFor({timeout: 10000});
    assert.equal(await page.locator('.mvp-identity .player-avatar').textContent(), '—');
    const output = await browser.newPage();
    output.on('pageerror', error => errors.push(error.message));
    await output.goto(meta.localUrl + '/output/live');
    await page.getByRole('button', {name: '推送赛后画面', exact: true}).click();
    await output.locator('.postmatch-scene').waitFor();
    assert.equal(await output.locator('.mvp-copy h2').textContent(), '待定');
    await page.evaluate(() => SDClient.mutate(s => { s.mvp.style = '2'; return s; }));
    await output.locator('.mvp-style-two').waitFor();
    assert.equal(await output.locator('.mvp2-player-id').textContent(), '待定');
    // A later roster sync must restore the real player without reloading.
    const populated = createTestState(2).teams;
    await page.evaluate(teams => SDClient.mutate(s => {
      s.teams.forEach((team, i) => { team.players = teams[i].players; });
      return s;
    }), populated);
    await output.waitForFunction(() => document.querySelector('.mvp2-player-id')?.textContent.startsWith('player_'));
    await page.locator('.sidebar nav').getByRole('button', {name: '队伍管理', exact: true}).click();
    await page.locator('.sidebar nav').getByRole('button', {name: '赛后与 MVP', exact: true}).click();
    await page.locator('.mvp-form').waitFor();
    assert.deepEqual(errors, []);
    console.log('PASS: empty roster MVP navigation, both output styles, roster recovery and repeated navigation; zero page errors');
  } finally {
    await browser?.close();
    await app.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
