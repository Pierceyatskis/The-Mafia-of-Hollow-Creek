// Browser smoke test: boots the real server, then plays a real game in headless Chromium at a desktop
// size and a phone size against WebSocket bots. It fails on any uncaught page error and checks the
// screens a player must be able to reach (role reveal, night, day, vote, vote results).
// Needs Playwright with Chromium installed; if it isn't available the test is skipped, not failed.
//   node test-browser.js
const { spawn } = require('child_process');
const path = require('path');
const WebSocket = require('ws');

let chromium;
for (const p of ['playwright', '/opt/node22/lib/node_modules/playwright', path.join(__dirname, '../../node-tools/node_modules/playwright')]) {
  try { chromium = require(p).chromium; break; } catch (e) { /* try the next location */ }
}
if (!chromium) { console.log('SKIP - Playwright is not installed, browser smoke test not run.'); process.exit(0); }

const PORT = 18000 + Math.floor(Math.random() * 1000);
const URL = 'http://localhost:' + PORT + '/';
let failures = 0;
function check(cond, msg) { if (cond) console.log('ok - ' + msg); else { console.error('FAIL: ' + msg); failures++; } }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function startServer() {
  const env = Object.assign({}, process.env, {
    PORT: String(PORT), NIGHT_DURATION_MS: '60000', NIGHT_EARLY_RESOLVE_DELAY_MS: '300', DAY_VOTE_EARLY_RESOLVE_DELAY_MS: '300',
    DAY_DISCUSS_DURATION_MS: '9000', DAY_VOTE_DURATION_MS: '30000'
  });
  const child = spawn(process.execPath, ['server.js'], { cwd: __dirname, env, stdio: ['ignore', 'pipe', 'pipe'] });
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server did not start')), 8000);
    child.stdout.on('data', d => { if (/listening|running|port/i.test(String(d))) { clearTimeout(t); resolve(child); } });
    child.on('error', reject);
    setTimeout(() => { clearTimeout(t); resolve(child); }, 1500);
  });
}

function makeBot(code, name) {
  const ws = new WebSocket('ws://localhost:' + PORT);
  const bot = { ws, id: null, seen: {} };
  ws.on('open', () => ws.send(JSON.stringify({ type: 'join', name, roomCode: code })));
  ws.on('message', raw => {
    const m = JSON.parse(raw);
    if (m.type === 'joined') bot.id = m.playerId;
    if (m.type !== 'gameState') return;
    const v = m.view, key = v.phase + ':' + v.night;
    if (bot.seen[key]) return; bot.seen[key] = 1;
    const me = v.players.find(p => p.id === bot.id);
    if (!me || !me.alive) return;
    const others = v.players.filter(p => p.alive && p.id !== bot.id);
    const pick = () => others[Math.floor(Math.random() * others.length)];
    if (v.phase === 'night') setTimeout(() => { const x = pick().id; ws.send(JSON.stringify({ type: 'nightAction', action: { kill: x, investigate: x, protect: x, bounty: x, hideBehind: x, silence: pick().id } })); }, 400);
    if (v.phase === 'day-vote') setTimeout(() => ws.send(JSON.stringify({ type: 'dayVote', targetId: pick().id })), 600);
  });
  return bot;
}

async function playOne(browser, label, ctxOpts, phone) {
  const errors = [];
  const ctx = await browser.newContext(ctxOpts);
  const pg = await ctx.newPage();
  await pg.addInitScript(() => { try { localStorage.setItem('hc-seen-intro-v1', '1'); } catch (e) {} });
  pg.on('pageerror', e => errors.push(e.message));
  await pg.goto(URL); await pg.waitForTimeout(1200);
  await pg.evaluate(() => new Promise(res => { connectMultiplayer(); const t = setInterval(() => { try { sendWS({ type: 'create', name: 'Tester', isPublic: false }); clearInterval(t); } catch (e) {} }, 200); const h = setInterval(() => { if (typeof myRoomCode !== 'undefined' && myRoomCode) { clearInterval(h); res(); } }, 200); }));
  const code = await pg.evaluate(() => myRoomCode);
  check(!!code, label + ': created a room (' + code + ')');
  const bots = ['Ada', 'Bram', 'Cora', 'Dex', 'Edna'].map(n => makeBot(code, n));
  await sleep(1200);
  await pg.evaluate(() => sendWS({ type: 'start', playerCount: 6, mafiaCount: 1, roles: { Godfather: false, DoubleAgent: false, Detective: true, Doctor: false, Miller: false, BountyHunter: false, CrazyGranny: false, Coward: false, Farmer: false, NavySeal: false } }));

  const reached = {};
  for (let i = 0; i < 160 && !(reached.night && reached.day && reached.vote && reached.results); i++) {
    await pg.waitForTimeout(500);
    const st = await pg.evaluate(() => {
      const shown = id => { const e = document.getElementById(id); return !!e && getComputedStyle(e).display !== 'none'; };
      return { ph: latestView && latestView.phase, reveal: shown('role-reveal-screen'), det: shown('detective-reveal-modal'), nk: shown('nightkill-screen'),
        na: !!document.querySelector('#night-action .na-select'), sleep: !!document.querySelector('#night-sleep-card'),
        phoneBody: document.body.classList.contains('phone'), tabbar: !!document.getElementById('phone-tabbar'),
        overflowX: document.documentElement.scrollWidth > window.innerWidth + 2, over: latestView && latestView.gameOver };
    });
    if (st.reveal) { reached.reveal = true; await pg.click('#role-reveal-continue-btn', { force: true, timeout: 1500 }).catch(() => {}); continue; }
    if (st.det) { await pg.click('#detective-reveal-continue-btn', { force: true, timeout: 1500 }).catch(() => {}); continue; }
    if (st.nk) { await pg.click('#nightkill-continue-btn', { force: true, timeout: 1500 }).catch(() => {}); continue; }
    if (st.ph === 'night' && (st.na || st.sleep)) {
      reached.night = true;
      if (st.na) {
        await pg.click('#night-action .na-select', { force: true, timeout: 1500 }).catch(() => {});
        await pg.waitForTimeout(300);
        const people = await pg.$$('#night-action .na-person');
        if (people.length) { await people[0].click({ force: true }).catch(() => {}); await pg.waitForTimeout(200); await pg.click('#night-action .na-confirm', { force: true, timeout: 1500 }).catch(() => {}); }
      }
    }
    if (st.ph === 'day-discuss') {
      reached.day = true;
      if (phone) { check(st.phoneBody && st.tabbar, label + ': phone mode is on with its tab bar during the day'); check(!st.overflowX, label + ': the page does not scroll sideways'); phone = false; }
    }
    if (st.ph === 'day-vote') reached.vote = true;
    if (st.ph === 'day-reveal' || st.over) reached.results = true;
  }
  check(reached.reveal, label + ': saw the role reveal'); check(reached.night, label + ': reached the night screen');
  check(reached.day, label + ': reached the day'); check(reached.vote, label + ': reached the vote'); check(reached.results, label + ': vote results appeared');
  check(errors.length === 0, label + ': no uncaught page errors' + (errors.length ? ' - ' + errors[0] : ''));
  await ctx.close(); bots.forEach(b => b.ws.close());
}

(async () => {
  const server = await startServer();
  let browser;
  try {
    browser = await chromium.launch();
    await playOne(browser, 'desktop 1920x1080', { viewport: { width: 1920, height: 1080 } }, false);
    await playOne(browser, 'phone 390x844', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, true);
  } catch (e) { console.error('TEST CRASHED:', e); failures++; }
  finally { if (browser) await browser.close(); server.kill(); }
  console.log('\n' + (failures === 0 ? 'All browser smoke checks passed.' : failures + ' CHECK(S) FAILED.'));
  process.exit(failures === 0 ? 0 : 1);
})();
