/* Phone mode for The Mafia of Hollow Creek.
 *
 * The game board is one fixed 1920x1080 painting. On a desktop it is simply scaled to fit; on a phone that makes
 * everything a few pixels tall. Phone mode instead treats the painting like a set of rooms and points a "camera"
 * at one of them at a time (the Town cards, the Hall with stage + voting, the Town Talk chat, or the night card),
 * zoomed so it fills the screen. A thin top strip (phase, timer, role, menu) and a bottom tab bar move the camera
 * and open the notebook / case file. Nothing here changes game rules or what is sent to the server.
 *
 * Active when the device has a coarse pointer and its short side is <= 560px (or when the URL has ?phone=1).
 */
(function(){
  'use strict';
  var TOP = 40, BOT = 60;
  var P = { tab: null, lastKey: '', tabs: null };

  function active(){
    if(/[?&]phone=1/.test(location.search)) return true;
    var side = Math.min(window.innerWidth, window.innerHeight);
    var coarse = false;
    try{ coarse = window.matchMedia('(pointer: coarse)').matches || ('ontouchstart' in window); }catch(e){}
    return coarse && side <= 560;
  }

  // ------------------------------------------------------------------ cameras
  var REGIONS = {
    town: { x: 0,    y: 150, w: 632, h: 672 },
    hall: { x: 624,  y: 150, w: 684, h: 810 },
    chat: { x: 1290, y: 150, w: 630, h: 672 }
  };
  function nightRegion(){
    var f = document.getElementById('game-folder');
    var h = f ? Math.max(f.offsetHeight, f.scrollHeight) : 640;   // the card can overflow the folder's own max-height
    var r = { x: 620, y: 140, w: 680, h: Math.max(560, 10 + h + 40) };
    return r;
  }
  // On a phone the mafia get a "Family" tab at night (their pick board and private chat) instead of a side panel.
  function isFamilyNight(){
    if(typeof latestView === 'undefined' || !latestView || latestView.phase !== 'night') return false;
    var me = latestView.players.filter(function(p){ return p.id === myPlayerId; })[0];
    return !!me && me.alive && me.align === 'mafia' && me.role !== 'Hitman';
  }
  function inFamilyTab(){ var c = document.getElementById('design-canvas'); return !!c && c.classList.contains('bg-night') && P.nightTab === 'family' && isFamilyNight(); }
  function familyRegion(){
    var fam = document.getElementById('mafia-chat-section');
    return { x: 620, y: 150, w: 680, h: Math.max(520, (fam ? fam.offsetHeight : 600) + 40) };
  }
  function region(canvas){
    if(canvas.classList.contains('bg-night')){ if(inFamilyTab()) return familyRegion(); return nightRegion(); }
    if(canvas.classList.contains('bg-day')) return REGIONS[P.tab && REGIONS[P.tab] ? P.tab : 'hall'];
    return { x: 0, y: 0, w: 1920, h: 1080 };
  }
  function applyScale(canvas){
    var w = window.innerWidth, h = window.innerHeight;
    var inGame = canvas.classList.contains('game-mode');
    document.body.classList.toggle('phone', true);
    if(!inGame){ canvas.style.transform = 'none'; canvas.style.clipPath = ''; renderChrome(false); return; }
    if(!isFamilyNight()) P.nightTab = 'night';
    document.body.classList.toggle('fam-tab', inFamilyTab());
    var r = region(canvas);
    var availH = h - TOP - BOT;
    var s = Math.min(w / r.w, availH / r.h);
    var cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    // the canvas sits centred in the viewport; shift so the region's centre lands in the middle of the free area
    var tx = -s * (cx - 960);
    var ty = (TOP - BOT) / 2 - s * (cy - 540);
    canvas.style.transform = 'translate(' + tx.toFixed(1) + 'px,' + ty.toFixed(1) + 'px) scale(' + s.toFixed(4) + ')';
    canvas.style.clipPath = 'inset(' + Math.max(0, r.y) + 'px ' + Math.max(0, 1920 - r.x - r.w) + 'px ' + Math.max(0, 1080 - r.y - r.h) + 'px ' + Math.max(0, r.x) + 'px)';
    renderChrome(!canvas.classList.contains('bg-end'));
  }

  // ------------------------------------------------------------------ chrome (top strip + tab bar)
  function el(tag, cls, html){ var e = document.createElement(tag); if(cls) e.className = cls; if(html != null) e.innerHTML = html; return e; }
  function build(){
    if(P.top) return;
    P.top = el('div', '', '');
    P.top.id = 'phone-topbar';
    P.top.innerHTML = '<button type="button" id="phone-role" aria-label="Your role"><span id="phone-role-txt">Role</span></button>'
      + '<div id="phone-phase"><span id="phone-phase-a"></span><span id="phone-phase-t"></span></div>'
      + '<button type="button" id="phone-menu-btn" aria-label="Menu">&#9776;</button>';
    P.bar = el('div', '', '');
    P.bar.id = 'phone-tabbar';
    P.menu = el('div', '', '<button type="button" data-m="settings">Settings</button><button type="button" data-m="howto">How to play</button><button type="button" data-m="leave" class="danger">Leave game</button>');
    P.menu.id = 'phone-menu';
    document.body.appendChild(P.top); document.body.appendChild(P.bar); document.body.appendChild(P.menu);
    P.top.querySelector('#phone-role').addEventListener('click', function(){ var b = document.getElementById('role-badge'); if(b) b.click(); });
    P.top.querySelector('#phone-menu-btn').addEventListener('click', function(e){ e.stopPropagation(); P.menu.classList.toggle('open'); });
    document.addEventListener('click', function(){ P.menu.classList.remove('open'); });
    P.menu.addEventListener('click', function(e){
      var b = e.target.closest('button'); if(!b) return; P.menu.classList.remove('open');
      var m = b.getAttribute('data-m');
      if(m === 'settings' && typeof openSettingsModal === 'function') openSettingsModal();
      else if(m === 'leave'){ var h = document.getElementById('home-nav-btn'); if(h) h.click(); }
      else if(m === 'howto' && window.Tutorial === undefined){ /* nothing to open mid-game */ }
    });
    P.bar.addEventListener('click', function(e){
      var b = e.target.closest('button'); if(!b) return;
      var t = b.getAttribute('data-t');
      if(REGIONS[t]){ setTab(t); }
      else if(t === 'notebook'){ if(typeof SoundFX !== 'undefined') SoundFX.playCaseFileOpen(); if(typeof openNotebookModal === 'function') openNotebookModal(); }
      else if(t === 'files'){ if(typeof SoundFX !== 'undefined') SoundFX.playCaseFileOpen(); if(typeof caseLogActiveTab !== 'undefined') caseLogActiveTab = 'rounds'; if(typeof openCaseLogModal === 'function') openCaseLogModal(); }
      else if(t === 'night'){ P.nightTab = 'night'; if(typeof updateCanvasScale === 'function') updateCanvasScale(); }
      else if(t === 'family'){ P.nightTab = 'family'; P.famSeen = (latestView && latestView.mafiaChatLog) ? latestView.mafiaChatLog.length : 0; if(typeof updateCanvasScale === 'function') updateCanvasScale(); }
    });
  }
  var ICONS = {
    town: '<svg viewBox="0 0 24 24"><path d="M12 12a4 4 0 100-8 4 4 0 000 8zm-8 9c0-4 3.6-7 8-7s8 3 8 7z"/></svg>',
    hall: '<svg viewBox="0 0 24 24"><path d="M3 5h18v3H3zm1 4h16l-1 11H5zm4 2v7h2v-7zm6 0v7h2v-7z"/></svg>',
    chat: '<svg viewBox="0 0 24 24"><path d="M4 4h16a1 1 0 011 1v11a1 1 0 01-1 1h-9l-5 4v-4H4a1 1 0 01-1-1V5a1 1 0 011-1z"/></svg>',
    family: '<svg viewBox="0 0 24 24"><path d="M9 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zm7 1a3 3 0 100-6 3 3 0 000 6zM2 20c0-3.6 3.1-6 7-6s7 2.4 7 6zm14-5c3 0 6 1.7 6 5h-5c0-2-.5-3.6-1-5z"/></svg>',
    night: '<svg viewBox="0 0 24 24"><path d="M20 15.5A8.5 8.5 0 018.5 4 8.5 8.5 0 1020 15.5z"/></svg>',
    notebook: '<svg viewBox="0 0 24 24"><path d="M6 3h12a1 1 0 011 1v16a1 1 0 01-1 1H6zm-2 3h2v2H4zm0 5h2v2H4zm0 5h2v2H4z"/></svg>',
    files: '<svg viewBox="0 0 24 24"><path d="M3 5a1 1 0 011-1h5l2 2h9a1 1 0 011 1v12a1 1 0 01-1 1H4a1 1 0 01-1-1z"/></svg>'
  };
  function tabsFor(canvas){
    if(canvas.classList.contains('bg-night')) return isFamilyNight() ? [['night', 'Night'], ['family', 'Family'], ['notebook', 'Notebook'], ['files', 'Case File']] : [['night', 'Night'], ['notebook', 'Notebook'], ['files', 'Case File']];
    return [['town', 'Town'], ['hall', 'Stage'], ['chat', 'Chat'], ['notebook', 'Notebook'], ['files', 'Case File']];
  }
  function renderChrome(show){
    build();
    var on = !!show && !endgameOpen();
    P.top.style.display = P.bar.style.display = on ? 'flex' : 'none';
    document.body.classList.toggle('phone-chrome', on);
    if(!on) return;
    var canvas = document.getElementById('design-canvas');
    var tabs = tabsFor(canvas);
    var cur = canvas.classList.contains('bg-night') ? (inFamilyTab() ? 'family' : 'night') : (P.tab && REGIONS[P.tab] ? P.tab : 'hall');
    var key = tabs.map(function(t){ return t[0]; }).join() + '|' + cur;
    if(key !== P.lastKey){
      P.lastKey = key;
      P.bar.innerHTML = tabs.map(function(t){
        return '<button type="button" data-t="' + t[0] + '"' + (t[0] === cur ? ' class="on"' : '') + '><i>' + ICONS[t[0]] + '</i><span>' + t[1] + '</span><b class="dot"></b></button>';
      }).join('');
    }
    var famBtn = P.bar.querySelector('[data-t="family"] .dot');
    if(famBtn){ var n = (latestView && latestView.mafiaChatLog) ? latestView.mafiaChatLog.length : 0; famBtn.style.display = (cur !== 'family' && n > (P.famSeen || 0)) ? 'block' : 'none'; }
    var chatBtn = P.bar.querySelector('[data-t="chat"] .dot');
    if(chatBtn) chatBtn.style.display = (P.unreadChat && cur !== 'chat') ? 'block' : 'none';
    syncTop();
  }
  function endgameOpen(){ var e = document.getElementById('endgame-screen'); return !!e && e.style.display !== 'none' && getComputedStyle(e).display !== 'none'; }
  function txt(id){ var n = document.getElementById(id); return n ? (n.textContent || '').trim() : ''; }
  function syncTop(){
    if(!P.top) return;
    var a = [txt('daylayout-timer-day'), txt('daylayout-timer-phase')].filter(Boolean).join(' · ');
    var t = txt('daylayout-timer-time');
    var A = document.getElementById('phone-phase-a'), T = document.getElementById('phone-phase-t');
    if(A && A.textContent !== a) A.textContent = a;
    if(T){ T.textContent = t; T.classList.toggle('hot', !!document.querySelector('#daylayout-timer-time .timer-danger, #daylayout-timer-time.timer-danger')); }
    var role = txt('role-badge-name');
    var R = document.getElementById('phone-role-txt'); if(R) R.textContent = role ? role : 'Role';
  }
  function setTab(t){
    if(!REGIONS[t]) return;
    P.tab = t;
    if(t === 'chat') P.unreadChat = false;
    if(typeof updateCanvasScale === 'function') updateCanvasScale();
  }

  // ------------------------------------------------------------------ small behaviours
  function watchChat(){
    var log = document.getElementById('discussion');
    if(!log || log._phoneWatched) return; log._phoneWatched = true;
    new MutationObserver(function(){ if(P.tab !== 'chat'){ P.unreadChat = true; var d = P.bar && P.bar.querySelector('[data-t="chat"] .dot'); if(d) d.style.display = 'block'; } }).observe(log, { childList: true });
  }
  // arming "Vote for..." should take you to the cards you tap; a new day should start on the Hall
  function hooks(){
    var q = document.getElementById('day-quick-vote-btn');
    if(q && !q._phoneHook){ q._phoneHook = true; q.addEventListener('click', function(){ setTimeout(function(){ if(typeof quickVoteMode !== 'undefined' && quickVoteMode) setTab('town'); }, 50); }); }
  }
  var lastPhase = '';
  function tick(){
    if(!document.body.classList.contains('phone')) return;
    watchChat(); hooks(); syncTop();
    var key = (typeof latestView !== 'undefined' && latestView) ? latestView.phase + ':' + latestView.night : '';
    if(key !== lastPhase){ lastPhase = key; if(/^day-discuss|^day-vote/.test(key)) { P.tab = 'hall'; if(typeof updateCanvasScale === 'function') updateCanvasScale(); } }
    // the night card changes height as the picker opens/closes
    var canvas = document.getElementById('design-canvas');
    if(canvas && canvas.classList.contains('bg-night')){ var f = document.getElementById('game-folder'); var fam = document.getElementById('mafia-chat-section'); var hh = (f ? Math.max(f.offsetHeight, f.scrollHeight) : 0) + (inFamilyTab() && fam ? fam.offsetHeight + 1000 : 0); if(hh !== P.nightH){ P.nightH = hh; if(typeof updateCanvasScale === 'function') updateCanvasScale(); } }
  }
  setInterval(tick, 400);
  // keep the on-screen keyboard from zooming the page: iOS zooms any focused field under 16px
  document.addEventListener('focusin', function(e){ var t = e.target; if(document.body.classList.contains('phone') && t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) t.style.fontSize = '16px'; });
  window.addEventListener('orientationchange', function(){ setTimeout(function(){ if(typeof updateCanvasScale === 'function') updateCanvasScale(); }, 250); });


  // Every full-screen screen and popup lives INSIDE the scaled canvas in the markup. With a camera transform (and clip) on the
  // canvas they would be zoomed and cropped with it, so on a phone they are lifted out to <body> once, at startup.
  var LIFT = ['death-screen','silence-screen','nightkill-screen','victory-screen','role-reveal-screen','phase-transition-screen','case-log-modal','notebook-modal','settings-modal','ghost-chat-modal','role-card-modal','vote-reveal-modal','intro-modal','howto-tour-modal','detective-reveal-modal','consigliere-reveal-modal','mortician-reveal-modal','cult-convert-modal','final-guess-modal','player-action-modal','reason-picker-modal','endgame-screen','leave-confirm-modal','revenge-wait-modal'];
  function liftOverlays(){
    LIFT.forEach(function(id){ var n = document.getElementById(id); if(n && n.parentNode !== document.body) document.body.appendChild(n); });
  }

  window.PhoneMode = { active: active, applyScale: applyScale, setTab: setTab, tab: function(){ return P.tab; } };
  if(active()){ document.body.classList.add('phone'); liftOverlays(); }
})();
