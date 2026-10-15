/* Interactive tutorial for The Mafia of Hollow Creek.
 *
 * A scripted practice round that runs on the REAL game screens: it feeds the client the same
 * messages a server would (gameState, stageState, chatMsg, heat...) and puts a coach layer on top
 * (dimmed screen, a spotlight hole around the thing being explained, a card with the explanation).
 * Nothing is sent to the server - sendWS is swapped for a local handler while it runs - and
 * nothing counts toward scores, stats or the leaderboard.
 *
 * Entry points: Tutorial.start(onFinish)   Tutorial.stop()
 */
(function(){
  'use strict';
  var YOU = 'tut-you';
  var NAMES = [['tut-ada','Ada Whitlock'],['tut-bram','Bram Hollis'],['tut-cora','Cora Vance'],['tut-dex','Dex Marlowe'],['tut-edna','Edna Pruitt'],['tut-finn','Finn Calder'],['tut-gus','Gus Thorne']];
  var DONE_KEY = 'hc-tutorial-done';

  var T = { active:false, idx:0, steps:[], flags:{}, poll:null, tick:null, origSendWS:null, onFinish:null, onTimers:[], prevHome:null };
  var el = {};   // layer elements

  // ---------------------------------------------------------------- fake game state
  function later(fn, ms){ var t = setTimeout(function(){ if(T.active) fn(); }, ms); T.onTimers.push(t); return t; }
  function seat(id, name, i, o){
    o = o || {};
    var icons = (typeof GAME_ICON_CHOICES !== 'undefined' && GAME_ICON_CHOICES.length) ? GAME_ICON_CHOICES : [];
    return { id:id, name:name, alive:o.alive !== false, silencedToday:false, isPlaceholder:false, occ:null, color:'#5C6B47', avatarKey:null,
      gameIconKey: icons.length ? icons[(i * 3 + 1) % icons.length] : null, isHost:false, isOwner:false, muted:false,
      role:o.role, align:o.align };
  }
  function players(o){
    o = o || {};
    var me = seat(YOU, (typeof CURRENT_PROFILE !== 'undefined' && CURRENT_PROFILE && CURRENT_PROFILE.username) || 'You', 0, { role:'Detective', align:'town' });
    var list = [me];
    NAMES.forEach(function(n, i){
      var dead = o.dead && o.dead.indexOf(n[0]) !== -1;
      list.push(seat(n[0], n[1], i + 1, { alive:!dead, role: dead ? 'Civilian' : undefined, align: dead ? 'town' : undefined }));
    });
    return list;
  }
  function heatObj(level, score, extra){
    return Object.assign({ self:true, score:score, percent:Math.round(score * 100), others:6, level:level, accusedToday:[], accusedEarlier:0, votesLast:0, votesEarlier:0, nearMiss:false, defenders:0, supporters:0, rawScore:score, relative:1, hottest:false }, extra || {});
  }
  function mkView(o){
    return { night:o.night || 1, phase:o.phase, players:players(o), winner:null, gameOver:false, myRole:'Detective', myAlign:'town',
      mySpotlightTarget:null, detectiveLog:o.detLog || [], chatLog:o.chat || [], voteLog:[], voteHistory:[], accusationLog:[], history:[],
      cachedOvernightReport:o.report || '', cachedNearMissId:null, farmerRevengeName:null, farmerRevengePending:null,
      heat:o.heat || heatObj(0, 0), whisperLog:[], mayorTiebreakResolved:false };
  }
  function feed(msg){ if(typeof handleServerMessage === 'function') handleServerMessage(msg); }
  function feedView(view, secs){ feed({ type:'gameState', view:view, phaseEndsAt: Date.now() + (secs || 300) * 1000, ownerPowers:false }); }

  // ---------------------------------------------------------------- stages of the scripted round
  var chatNow = [];
  function say(pid, name, text){
    var e = { playerId:pid, name:name, text:text, ts:Date.now(), night:1, category:'chat' };
    chatNow.push(e);
    feed(Object.assign({ type:'chatMsg' }, e));
  }
  function enterNight(){
    chatNow = [];
    feedView(mkView({ phase:'night', night:1 }), 300);
  }
  function enterMorning(){
    var picked = T.flags.nightTarget || 'tut-dex';
    var p = NAMES.filter(function(n){ return n[0] === picked; })[0];
    var read = picked === 'tut-dex' ? 'guilty' : 'innocent';
    T.flags.read = read;
    feedView(mkView({ phase:'day-discuss', night:1, dead:['tut-gus'], detLog:[{ night:1, name:p ? p[1] : 'Dex Marlowe', read:read }],
      report:'Gus Thorne was found dead at dawn. The mafia struck in the night.' }), 300);
  }
  function enterVote(){
    feedView(mkView({ phase:'day-vote', night:1, dead:['tut-gus'], chat:chatNow, heat:T.flags.heat || heatObj(0, 0),
      detLog:[{ night:1, name:'Dex Marlowe', read:T.flags.read || 'guilty' }] }), 300);
  }
  function stageMsg(speakerId){
    feed({ type:'stageState', speakerId:speakerId, queue:[], turnDeadline:null, voteOffStageCount:0, voteOffStageThreshold:4,
      reactions:{ up:0, down:0, smile:0 }, you:{ votedOffStage:false, donated:false, reaction:null } });
  }

  // ---------------------------------------------------------------- local replacement for sendWS
  function onSend(obj){
    if(!obj || !T.active) return;
    switch(obj.type){
      case 'nightAction':
        T.flags.nightSent = true;
        T.flags.nightTarget = (obj.action && (obj.action.investigate || obj.action.protect || obj.action.kill)) || 'tut-dex';
        break;
      case 'joinQueue':
        T.flags.joined = true;
        stageMsg(YOU);
        break;
      case 'leaveStage': case 'leaveQueue':
        stageMsg(null);
        break;
      case 'dayChat':
        T.flags.chatted = true;
        say(YOU, (typeof CURRENT_PROFILE !== 'undefined' && CURRENT_PROFILE.username) || 'You', obj.text || '');
        later(function(){ say('tut-ada', 'Ada Whitlock', /dex/i.test(obj.text || '') ? 'Hm. Dex was awfully quiet last night, now that you say it.' : 'Interesting. Keep talking, I want to hear everyone.'); }, 1400);
        break;
      case 'dayVote':
        if(obj.targetId){ T.flags.voted = true; T.flags.voteTarget = obj.targetId; }
        // the server answers every vote with who has voted so far (check marks on the town cards)
        feed({ type:'dayVoteProgress', votedIds: obj.targetId ? [YOU] : [] });
        if(obj.targetId && !T.flags.othersVoted){
          T.flags.othersVoted = true;
          later(function(){ feed({ type:'dayVoteProgress', votedIds:[YOU, 'tut-ada'] }); }, 1500);
          later(function(){ feed({ type:'dayVoteProgress', votedIds:[YOU, 'tut-ada', 'tut-bram', 'tut-cora'] }); }, 3200);
        }
        break;
      default: break;
    }
  }

  // ---------------------------------------------------------------- the coach layer
  function build(){
    var root = document.createElement('div');
    root.id = 'tut-layer';
    root.innerHTML = '<div class="tut-block" data-b="t"></div><div class="tut-block" data-b="b"></div><div class="tut-block" data-b="l"></div><div class="tut-block" data-b="r"></div>'
      + '<div class="tut-ring"></div>'
      + '<div class="tut-card" role="dialog" aria-live="polite"><div class="tut-top"><span class="tut-count"></span><button type="button" class="tut-skip">Skip tutorial</button></div>'
      + '<div class="tut-bar"><i></i></div><h3 class="tut-title"></h3><div class="tut-text"></div><div class="tut-try"></div>'
      + '<div class="tut-nav"><button type="button" class="tut-back">Back</button><span class="tut-skipstep"></span><button type="button" class="tut-next">Next</button></div></div>';
    document.body.appendChild(root);
    el.root = root; el.card = root.querySelector('.tut-card'); el.ring = root.querySelector('.tut-ring');
    el.blocks = {}; Array.prototype.forEach.call(root.querySelectorAll('.tut-block'), function(b){ el.blocks[b.getAttribute('data-b')] = b; });
    el.count = root.querySelector('.tut-count'); el.bar = root.querySelector('.tut-bar i'); el.title = root.querySelector('.tut-title');
    el.text = root.querySelector('.tut-text'); el.try_ = root.querySelector('.tut-try'); el.back = root.querySelector('.tut-back');
    el.next = root.querySelector('.tut-next'); el.skipstep = root.querySelector('.tut-skipstep');
    root.querySelector('.tut-skip').addEventListener('click', function(){ confirmSkip(); });
    (function(){   // grab the top strip to move the card out of the way; it stays put for the rest of that step
      var top = root.querySelector('.tut-top'), drag = null;
      top.style.cursor = 'grab'; top.style.touchAction = 'none';
      top.addEventListener('pointerdown', function(e){ if(e.target.closest('button')) return; var r = el.card.getBoundingClientRect(); drag = { dx:e.clientX - r.left, dy:e.clientY - r.top }; top.setPointerCapture(e.pointerId); top.style.cursor = 'grabbing'; e.preventDefault(); });
      top.addEventListener('pointermove', function(e){ if(!drag) return; var p = clampXY(el.card, e.clientX - drag.dx, e.clientY - drag.dy); el.card.classList.remove('arrow-l', 'arrow-r', 'arrow-t', 'arrow-b'); el.card.style.left = p[0] + 'px'; el.card.style.top = p[1] + 'px'; var s = T.steps[T.idx]; if(s) s.userPos = p; });
      top.addEventListener('pointerup', function(){ drag = null; top.style.cursor = 'grab'; });
      top.addEventListener('pointercancel', function(){ drag = null; top.style.cursor = 'grab'; });
    })();
    el.next.addEventListener('click', function(){ if(!el.next.disabled) next(); });
    el.back.addEventListener('click', function(){ back(); });
    el.skipstep.addEventListener('click', function(e){ if(e.target.tagName === 'BUTTON') forceStep(); });
  }
  function visibleRect(sel){
    var out = null;
    String(sel).split('|').forEach(function(s){
      Array.prototype.forEach.call(document.querySelectorAll(s), function(n){
        var r = n.getBoundingClientRect();
        if(r.width < 2 || r.height < 2) return;
        var cs = getComputedStyle(n);
        if(cs.visibility === 'hidden' || cs.display === 'none') return;
        if(!out) out = { l:r.left, t:r.top, r:r.right, b:r.bottom };
        else { out.l = Math.min(out.l, r.left); out.t = Math.min(out.t, r.top); out.r = Math.max(out.r, r.right); out.b = Math.max(out.b, r.bottom); }
      });
    });
    return out;
  }
  function layout(){
    if(!T.active || !el.root) return;
    var s = T.steps[T.idx]; if(!s) return;
    var W = window.innerWidth, H = window.innerHeight, pad = s.pad == null ? 8 : s.pad;
    var r = s.target ? visibleRect(s.target) : null;
    var blocks = el.blocks;
    var dim = s.block !== false;
    if(r){
      var hl = Math.max(0, r.l - pad), ht = Math.max(0, r.t - pad), hr = Math.min(W, r.r + pad), hb = Math.min(H, r.b + pad);
      el.ring.style.cssText = 'display:block;left:' + hl + 'px;top:' + ht + 'px;width:' + (hr - hl) + 'px;height:' + (hb - ht) + 'px;';
      if(dim){
        set(blocks.t, 0, 0, W, ht); set(blocks.b, 0, hb, W, H - hb); set(blocks.l, 0, ht, hl, hb - ht); set(blocks.r, hr, ht, W - hr, hb - ht);
      } else hideBlocks();
      place(hl, ht, hr, hb, s.place);
    } else {
      el.ring.style.display = 'none';
      if(dim){ set(blocks.t, 0, 0, W, H); set(blocks.b, 0, 0, 0, 0); set(blocks.l, 0, 0, 0, 0); set(blocks.r, 0, 0, 0, 0); center(); }
      else { hideBlocks(); dock(); }   // a passive card must not cover the game's own popups: park it at the bottom
    }
    for(var k in blocks) blocks[k].classList.toggle('lit', dim);
  }
  function set(b, x, y, w, h){ b.style.cssText = 'display:' + (w > 0 && h > 0 ? 'block' : 'none') + ';left:' + x + 'px;top:' + y + 'px;width:' + w + 'px;height:' + h + 'px;'; }
  function hideBlocks(){ for(var k in el.blocks) el.blocks[k].style.display = 'none'; }
  // How much of the game's own clickable stuff would a card at (x, y) hide? (only things the player can actually reach right now)
  function coverCost(x, y, cw, ch, only){
    var cost = 0, nodes = document.querySelectorAll('button,input,textarea,select,a[href],[role=button]');
    for(var i = 0; i < nodes.length; i++){
      var n = nodes[i]; if(n.closest('#tut-layer')) continue;
      var r = n.getBoundingClientRect(); if(r.width < 4 || r.height < 4) continue;
      if(r.left >= x + cw || r.right <= x || r.top >= y + ch || r.bottom <= y) continue;
      if(only){ var cxm = (r.left + r.right) / 2, cym = (r.top + r.bottom) / 2; if(cxm < only.l || cxm > only.r || cym < only.t || cym > only.b) continue; }   // dimmed screen: only what is inside the spotlight can be pressed
      var cs = getComputedStyle(n); if(cs.visibility === 'hidden' || cs.display === 'none' || cs.pointerEvents === 'none') continue;
      var mx = Math.min(innerWidth - 1, Math.max(0, (r.left + r.right) / 2)), my = Math.min(innerHeight - 1, Math.max(0, (r.top + r.bottom) / 2));
      var top = document.elementFromPoint(mx, my); if(!top || !(top === n || n.contains(top) || top.contains(n))) continue;   // already hidden by something else
      cost += (n.closest('.role-card-overlay,#role-reveal-screen,#nightkill-screen,#phase-transition-screen') ? 40 : 6);
    }
    return cost;
  }
  function overlapArea(ax, ay, aw, ah, bx, by, bw, bh){ var w = Math.min(ax + aw, bx + bw) - Math.max(ax, bx), h = Math.min(ay + ah, by + bh) - Math.max(ay, by); return w > 0 && h > 0 ? w * h : 0; }
  function clampXY(c, x, y){ var W = window.innerWidth, H = window.innerHeight; return [Math.max(10, Math.min(W - c.offsetWidth - 10, x)), Math.max(10, Math.min(H - c.offsetHeight - 10, y))]; }
  // pick the best of: beside the target (with an arrow), or one of the screen's edges/corners - least overlap with the target, then with the game's buttons
  function bestSpot(cands, ring, useCover, only){
    var c = el.card, cw = c.offsetWidth, ch = c.offsetHeight, best = null;
    cands.forEach(function(k, idx){
      var p = clampXY(c, k.x, k.y);
      var cost = (ring ? overlapArea(p[0], p[1], cw, ch, ring.l, ring.t, ring.r - ring.l, ring.b - ring.t) * 3 : 0) + (useCover ? coverCost(p[0], p[1], cw, ch, only) * 400 : 0) + idx;
      if(!best || cost < best.cost) best = { cost:cost, x:p[0], y:p[1], arrow:k.arrow };
    });
    return best;
  }
  function edgeCands(){
    var W = window.innerWidth, H = window.innerHeight, c = el.card, cw = c.offsetWidth, ch = c.offsetHeight, g = 16;
    return [{ x:(W - cw) / 2, y:H - ch - 22 }, { x:(W - cw) / 2, y:g }, { x:g, y:H - ch - g }, { x:W - cw - g, y:H - ch - g }, { x:g, y:g }, { x:W - cw - g, y:g },
      { x:g, y:(H - ch) / 2 }, { x:W - cw - g, y:(H - ch) / 2 }];
  }
  function applySpot(s){
    var c = el.card; c.classList.remove('centered', 'arrow-l', 'arrow-r', 'arrow-t', 'arrow-b'); if(s.arrow) c.classList.add(s.arrow);
    c.style.left = s.x + 'px'; c.style.top = s.y + 'px';
  }
  function dock(){
    var s = T.steps[T.idx];
    if(s && s.userPos){ applySpot({ x:s.userPos[0], y:s.userPos[1] }); return; }
    applySpot(bestSpot(edgeCands(), null, true));      // a passive card must not cover the game's own popups and buttons
  }
  function center(){
    var c = el.card; c.classList.add('centered'); c.classList.remove('arrow-l', 'arrow-r', 'arrow-t', 'arrow-b');
    c.style.left = Math.max(12, (window.innerWidth - c.offsetWidth) / 2) + 'px';
    c.style.top = Math.max(12, (window.innerHeight - c.offsetHeight) / 2) + 'px';
  }
  function place(hl, ht, hr, hb, pref){
    var s = T.steps[T.idx];
    var c = el.card; c.classList.remove('centered', 'arrow-l', 'arrow-r', 'arrow-t', 'arrow-b');
    if(s && s.userPos){ applySpot({ x:s.userPos[0], y:s.userPos[1] }); return; }      // the player dragged it somewhere: leave it there
    var W = window.innerWidth, H = window.innerHeight, cw = c.offsetWidth, ch = c.offsetHeight, g = 18;
    var order = pref ? [pref, 'r', 'l', 'b', 't'] : ['r', 'l', 'b', 't'], seen = {}, cands = [];
    order.forEach(function(sd){
      if(seen[sd]) return; seen[sd] = 1;
      if(sd === 'r') cands.push({ x:hr + g, y:ht + (hb - ht) / 2 - ch / 2, arrow:'arrow-l' });
      else if(sd === 'l') cands.push({ x:hl - g - cw, y:ht + (hb - ht) / 2 - ch / 2, arrow:'arrow-r' });
      else if(sd === 'b') cands.push({ x:hl + (hr - hl) / 2 - cw / 2, y:hb + g, arrow:'arrow-t' });
      else cands.push({ x:hl + (hr - hl) / 2 - cw / 2, y:ht - g - ch, arrow:'arrow-b' });
    });
    var all = cands.concat(edgeCands());
    // a side only keeps its arrow if the card really fits there without being squeezed back over the target
    var ring = { l:hl, t:ht, r:hr, b:hb };
    var best = bestSpot(all, ring, true, (s && s.block === false) ? null : ring);
    if(best.arrow){ var okx = best.x >= 10 && best.x + cw <= W - 10 && best.y >= 10 && best.y + ch <= H - 10; var hit = overlapArea(best.x, best.y, cw, ch, hl, ht, hr - hl, hb - ht); if(!okx || hit) best.arrow = null; }
    applySpot(best);
  }

  // ---------------------------------------------------------------- stepping
  function go(i, dir){
    if(!T.active) return;
    var prev = T.steps[T.idx];
    if(prev && prev.exit) try{ prev.exit(); }catch(e){}
    clearInterval(T.poll); T.poll = null;
    // skip steps whose target isn't on screen (e.g. the stage when voice is off)
    while(T.steps[i] && T.steps[i].skipIf && T.steps[i].skipIf()) i += (dir === -1 ? -1 : 1);
    if(i >= T.steps.length){ finish(); return; }
    if(i < 0) i = 0;
    T.idx = i;
    var s = T.steps[i]; s.userPos = null;
    if(s.enter) try{ s.enter(); }catch(e){ console.warn('[tutorial] enter failed', e); }
    el.count.textContent = s.kind === 'intro' ? 'Welcome' : 'Step ' + (i + 1) + ' of ' + T.steps.length;
    el.bar.style.width = Math.round(i / (T.steps.length - 1) * 100) + '%';
    el.title.textContent = s.title;
    el.text.innerHTML = typeof s.text === 'function' ? s.text() : s.text;
    var gated = !!s.until;
    el.try_.style.display = s.hint ? 'block' : 'none';
    el.try_.innerHTML = s.hint ? '<span class="tut-hand">&#9757;</span> ' + s.hint : '';
    el.next.disabled = gated;
    el.next.textContent = s.nextLabel || (gated && !s.hint ? 'Waiting\u2026' : (i === T.steps.length - 1 ? 'Finish' : 'Next'));
    el.next.classList.toggle('pulse', !gated);
    el.back.style.visibility = s.noBack || !T.steps[i - 1] || T.steps[i - 1].noForward ? 'hidden' : 'visible';
    el.skipstep.innerHTML = gated && s.force ? '<button type="button">Skip this step</button>' : '';
    el.card.classList.remove('pop'); void el.card.offsetWidth; el.card.classList.add('pop');
    layout();
    setTimeout(layout, 60); setTimeout(layout, 350);
    if(gated){
      T.poll = setInterval(function(){
        var ok = false; try{ ok = s.until(); }catch(e){}
        if(ok){
          clearInterval(T.poll); T.poll = null;
          el.next.disabled = false; el.next.classList.add('pulse');
          el.try_.innerHTML = '<span class="tut-check">&#10003;</span> Nice, that\'s it.';
          el.skipstep.innerHTML = '';
          if(s.auto) setTimeout(function(){ if(T.active && T.steps[T.idx] === s) next(); }, s.auto);
          layout();
        }
      }, 180);
    }
  }
  function next(){ go(T.idx + 1, 1); }
  function back(){ go(T.idx - 1, -1); }
  function forceStep(){ var s = T.steps[T.idx]; if(s && s.force) try{ s.force(); }catch(e){} }
  function confirmSkip(){
    if(el.skipAsk) return;
    var ask = document.createElement('div'); ask.className = 'tut-ask'; el.skipAsk = ask;
    ask.innerHTML = '<p>Leave the tutorial? You can replay it any time from the home screen.</p><button type="button" class="tut-yes">Leave tutorial</button><button type="button" class="tut-no">Keep going</button>';
    el.card.appendChild(ask);
    ask.querySelector('.tut-no').addEventListener('click', function(){ ask.remove(); el.skipAsk = null; layout(); });
    ask.querySelector('.tut-yes').addEventListener('click', function(){ ask.remove(); el.skipAsk = null; exit(false); });
    layout();
  }

  // ---------------------------------------------------------------- the script
  var $ = function(id){ return document.getElementById(id); };
  var shown = function(id){ var n = $(id); return !!n && n.style.display !== 'none' && getComputedStyle(n).display !== 'none'; };
  function buildSteps(){
    var S = [];
    function add(o){ S.push(o); return o; }
    // ---- intro
    add({ q:1, kind:'intro', title:'Welcome to Hollow Creek', noBack:true,
      text:'A quiet town. A few of its people are secretly <b class="tut-red">the Mafia</b>. Everyone else is <b class="tut-green">the Town</b>, and nobody knows who is who.<br><br><b>Town wins</b> by voting out every mafia member.<br><b>Mafia wins</b> by killing until they equal the Town.<br><br>This 4-minute practice round walks you through a real game, one step at a time.' });
    add({ q:1, kind:'intro', title:'Every round has two halves',
      text:'<div class="tut-halves"><div><span class="tut-moon">&#9790;</span><b>Night</b><br>Everyone acts in secret. The mafia choose someone to kill. Special roles use their powers.</div><div><span class="tut-sun">&#9728;</span><b>Day</b><br>The town learns who died, talks it over, accuses, defends, and finally <b>votes someone out</b>.</div></div>Then night falls again, until one side wins.' });
    add({ kind:'intro', title:'You have a secret role',
      text:'At the start, every player is dealt a role that only they can see. Some are plain townsfolk. Others have powers: the <b>Detective</b> investigates, the <b>Doctor</b> protects, the <b>Godfather</b> silences.<br><br>In this practice round <b>you are the Detective</b>. Tap <i>Next</i> and night will fall.' , nextLabel:'Begin practice round' });
    // ---- night
    add({ q:1, title:'Night falls', block:false, noBack:true, noForward:true, place:'t',
      enter:function(){ enterNight(); },
      text:'Every game opens with this beat. Next, the town deals you your secret role.',
      until:function(){ return shown('role-reveal-screen'); }, auto:300 });
    add({ q:1, title:'Your secret role', target:'#role-reveal-card|#role-reveal-name|#role-reveal-flavor|#role-reveal-continue-btn', pad:14, place:'r', noBack:true, noForward:true,
      text:'You are <b>the Detective</b>. Each night you investigate one player and learn whether they look <b class="tut-red">guilty</b> or <b class="tut-green">innocent</b>.<br><br>Keep your role close: the mafia would love to kill a Detective.',
      hint:'Press <b>Begin the night</b>.', until:function(){ return shown('panel-night'); }, auto:400 });
    add({ title:'Your night action', target:'#night-action', place:'r', noBack:true, noForward:true,
      text:'This card is your power for the night. Only you can see it. Everyone with a night role is making a choice like this right now, and night ends once everybody has locked in (or the timer runs out).' });
    add({ q:1, title:'Choose a player', target:'#night-action .na-select', place:'r', noForward:true,
      text:'Every night action works the same way: pick a player, then confirm.',
      hint:'Click <b>Choose a player</b>.', until:function(){ return typeof nightUI !== 'undefined' && !!nightUI.picking; },
      force:function(){ var b = document.querySelector('#night-action .na-select'); if(b) b.click(); }, auto:500 });
    add({ q:1, title:'Who do you suspect?', target:'#night-action .na-person', pad:12, place:'b', noForward:true,
      enter:function(){ pulsePick(true); }, exit:function(){ pulsePick(false); },
      text:'Everyone in town is shown the same way. For this demo, <b>Dex Marlowe</b> has been acting strange. Pick him (or anyone you like).',
      hint:'Click a player\'s portrait.', until:function(){ return typeof nightUI !== 'undefined' && !nightUI.picking && nightUI.sel && !!nightUI.sel.inv; },
      force:function(){ var b = document.querySelector('#night-action .na-person[data-id="tut-dex"]') || document.querySelector('#night-action .na-person'); if(b) b.click(); }, auto:600 });
    add({ q:1, title:'Lock it in', target:'#night-action .na-confirm', place:'r', noForward:true,
      text:'The Confirm button turns red once you have chosen someone. You can still change your mind (click it again) until every action is confirmed.',
      hint:'Press the red <b>Confirm</b> button.', until:function(){ return !!T.flags.nightSent; },
      force:function(){ var b = document.querySelector('#night-action .na-confirm'); if(b) b.click(); } , auto:600 });
    add({ title:'Waiting for dawn', target:'#night-sleep-card', place:'r', noBack:true, noForward:true,
      text:'You are locked in. Your actions stay private. Once the whole town has acted, the night ends after a short pause so the change to morning is smooth.<br><br>While you wait you can open your <b>Notebook</b> or the <b>Case File</b> with the buttons below.' , nextLabel:'Skip to morning' });
    // ---- morning
    add({ q:1, title:'Dawn breaks', block:false, noBack:true, noForward:true, place:'t',
      enter:function(){ enterMorning(); },
      text:'First you see your private result, then the whole town finds out who died overnight. Click <b>Continue</b> on each screen.',
      until:function(){ return shown('panel-day'); }, auto:500 });
    add({ title:'The day timer', target:'#daylayout-timer-bar', place:'b', noBack:true,
      text:'Day has two parts: <b>Discussion</b> (talk, accuse, defend) and then <b>Voting</b>. This bar shows which part you are in and how much time is left.' });
    add({ title:'The Town Bulletin', target:'#daylayout-cabinet-full', pad:0, place:'l',
      text:'<b>Recent News</b> tells you what happened overnight. <b>Phase Instructions</b> remind you what to do now. The third note counts who is still alive. The meter below shows <b>your heat</b>, which we will cover in a moment.' });
    add({ title:'The Town', target:'#daylayout-roster-frame', pad:0, place:'r',
      text:'Every resident is a card. Eliminated players are tinted red and their <b>true role is revealed</b> to everyone. During the vote, a check mark appears on players who have already voted.' });
    add({ title:'Open a player\'s page', target:'#daylayout-roster-grid', place:'r', noForward:true,
      text:'Each player has a private page in your notebook.',
      hint:'Click <b>Dex Marlowe</b>\'s card.', until:function(){ return typeof notebookOpen !== 'undefined' && notebookOpen; },
      force:function(){ if(typeof openNotebookModalToPlayer === 'function') openNotebookModalToPlayer('tut-dex'); }, auto:500 });
    add({ title:'Your private dossier', target:'#notebook-dossier-view .notebook-dossier-left', place:'r', noForward:true,
      text:'This page is yours alone. The portrait, status, and below it, a quick verdict you can give each player: <b class="tut-green">Trusted</b>, <b>Unknown</b> or <b class="tut-red">Suspicious</b>.' });
    add({ title:'Mark your suspicion', target:'#notebook-dossier-view .notebook-judgment-row', place:'r', noForward:true,
      hint:'Mark Dex as <b>Suspicious</b>.', text:'Marks only help you keep track. Nobody else sees them, and the directory can filter by them later.',
      until:function(){ return typeof notebookMarks !== 'undefined' && notebookMarks['tut-dex'] === 'suspicious'; },
      force:function(){ if(typeof notebookMarks !== 'undefined'){ notebookMarks['tut-dex'] = 'suspicious'; if(typeof renderNotebookDossier === 'function') renderNotebookDossier('tut-dex'); } }, auto:700 });
    add({ title:'Four tabs of information', target:'#notebook-dtabs', place:'b', noForward:true,
      text:'<b>Private Notes</b>: write anything. <b>Vote History</b>: who they voted for each day. <b>Known Events</b>: everything public (and private to you) about them. <b>Saved Quotes</b>: what they have said in the main chat.<br><br>The <b>directory</b> (back arrow) lists everyone, and <i>Vote Lookup</i> shows who voted for whom.' });
    add({ title:'Close the notebook', target:'#notebook-close-btn', pad:10, place:'l', noForward:true,
      hint:'Click the <b>X</b>.', text:'You can open it any time from the bottom of the screen, or with the <b>N</b> key.',
      until:function(){ return typeof notebookOpen !== 'undefined' && !notebookOpen; },
      force:function(){ if(typeof closeNotebookModal === 'function') closeNotebookModal(); }, auto:300 });
    add({ title:'The Stage', target:'#daylayout-stage-header|#daylayout-stage-mute-btn|#daylayout-stage-request-btn', place:'l',
      skipIf:function(){ return !visibleRect('#daylayout-stage-request-btn'); },
      text:'When the host turns it on, <b>the Stage</b> is where players speak out loud, one at a time. Others queue up to take a turn.',
      hint:'Press <b>Request to Speak</b>.', until:function(){ return !!T.flags.joined; }, noForward:true,
      force:function(){ onSend({ type:'joinQueue' }); }, auto:600 });
    add({ title:'You have the stage', target:'#daylayout-stage-header|#daylayout-stage-mute-btn|#daylayout-stage-request-btn|#daylayout-stage-give-time-btn|#daylayout-stage-kick-btn', place:'l', noForward:true,
      skipIf:function(){ return !T.flags.joined; },
      enter:function(){ later(function(){ stageMsg(null); }, 9000); },
      text:'Your turn is timed when others are waiting. While <i>someone else</i> speaks you can give them <b>+5 seconds</b>, or fill the red <b>kick</b> button together with the room to remove a speaker who is hogging the floor. You can also leave the stage yourself.' });
    add({ q:1, title:'Town Talk', target:'#daylayout-chat-frame', pad:0, place:'r', noForward:true,
      text:'The main chat. Everyone sees it. Use it to <b>accuse</b> ("I accuse Dex"), <b>defend</b>, ask questions and trade information. The quick buttons under the chat give you starters.<br><br>Careful: accusations and your words are tracked and feed the Town Heat.',
      hint:'Type <i>I accuse Dex</i> and press <b>Send</b>.', until:function(){ return !!T.flags.chatted; },
      force:function(){ onSend({ type:'dayChat', text:'I accuse Dex' }); }, auto:1800 });
    add({ title:'Your Town Heat', target:'#daylayout-heat', pad:6, place:'t', noForward:true,
      enter:function(){
        T.flags.heat = heatObj(3, 0.42, { accusedToday:['Cora Vance', 'Finn Calder'], rawScore:0.42, hottest:true });
        say('tut-cora', 'Cora Vance', 'Funny how the Detective is so keen to point fingers.');
        later(function(){ say('tut-finn', 'Finn Calder', 'I agree with Cora. Something is off about you.'); }, 1200);
        later(function(){ feed({ type:'heat', heat:T.flags.heat }); }, 1500);
      },
      text:'Heat shows <b>how much suspicion is pointing at you</b>: accusations and votes against you raise it, defenders lower it, and it fades each day.<br><br>It is <b>relative</b>: if somebody else is running hotter than you, you are safer than the raw number suggests. Click the meter any time for the full breakdown.' });
    add({ title:'Your toolbox', target:'#bottom-nav', pad:6, place:'t', noForward:true,
      text:'<b>Case Files</b> recap everything that has happened, list who has <b>claimed</b> which role, and show every role in play. <b>Notebook</b> is your private dossier. <b>Match History</b> is a round-by-round log, and <b>Settings</b> has sound, accessibility and display options.' });
    // ---- vote
    add({ q:1, title:'Voting opens', target:'#daylayout-timer-bar', place:'b', noBack:true, noForward:true,
      enter:function(){ enterVote(); },
      text:'Discussion is over. Now everyone votes for who they think is mafia. The player with the most votes is <b>eliminated</b> and their role is revealed. If two players tie, lots are drawn between them.' });
    add({ q:1, title:'Cast your vote', target:'#day-quick-vote-btn|#daylayout-roster-grid|#daylayout-roster-nav', pad:6, place:'r', noBack:true, noForward:true,
      text:'Press <b>Vote for&hellip;</b> and then click a player, or open a player\'s notebook page and press <b>Vote for</b> there. You can change your vote until the timer ends. For this demo, vote for <b>Dex</b>.',
      hint:'Pick a player to vote for.', until:function(){ return !!T.flags.voted; },
      force:function(){ if(typeof selectVoteTarget === 'function') selectVoteTarget('tut-dex'); else onSend({ type:'dayVote', targetId:'tut-dex' }); }, auto:900 });
    add({ title:'Your ballot is in', target:'.voting-box-col|.vote-confirmed-card|.voting-your-vote', pad:10, place:'t', noBack:true, noForward:true,
      text:'Your ballot slips into the box. Votes stay secret until the reveal, and you can still change yours before time is up by picking someone else.' });
    add({ q:1, title:'The votes are counted', noBack:true, noForward:true, nextLabel:'See the result',
      text:function(){
        var dex = T.flags.voteTarget === 'tut-dex';
        return dex ? 'Everyone else voted too. <b>Dex Marlowe</b> has the most votes, so he is eliminated... and his role is revealed: <b class="tut-red">Mafia</b>!<br><br>The Detective was right.'
                   : 'Everyone else voted too. Two players tied for the most votes. In a real game a tie is settled by <b>drawing lots</b> between the tied players (a living Mayor\'s own pick breaks it instead).<br><br>(In this practice round, Dex really was the mafia.)'; } });
    add({ q:1, title:'The Town wins!', noBack:true, noForward:true, nextLabel:'Finish tutorial',
      text:'<div class="tut-finish"><b>What to remember</b><ul>'
        + '<li><b>Night</b>: use your power, then wait for dawn.</li>'
        + '<li><b>Day</b>: read the news, talk, accuse, defend. Use the <b>Notebook</b> to keep track.</li>'
        + '<li><b>Heat</b> is danger. Defend yourself before it gets high.</li>'
        + '<li><b>Vote</b> carefully: a wrong vote helps the mafia.</li></ul>'
        + 'Town wins by eliminating all mafia. Mafia wins when they equal the town. You also earn points for good plays, and dead players still get to watch the end.<br><br>Want more? <b>How to Play</b> on the home screen has the rules and every role, and the full practice tutorial (Notebook, Heat, the Stage) is in Settings.<br><br>You are ready. Good luck, detective.</div>' });
    return S;
  }
  function pulsePick(on){
    var iv = pulsePick._iv; if(iv){ clearInterval(iv); pulsePick._iv = null; }
    if(!on){ Array.prototype.forEach.call(document.querySelectorAll('.na-person.tut-pulse'), function(b){ b.classList.remove('tut-pulse'); }); return; }
    pulsePick._iv = setInterval(function(){ var b = document.querySelector('#night-action .na-person[data-id="tut-dex"]'); if(b) b.classList.add('tut-pulse'); }, 200);
  }

  // ---------------------------------------------------------------- lifecycle
  // The practice round runs on the real screens, so the real client state (who the Detective picked, notebook marks, the last view...) would
  // otherwise survive it and pre-fill the next run (the quick start was leaving its picks behind for the full tutorial). Wipe it before and after.
  function resetClientState(){
    try{ nightUI = { night:null, sel:{}, done:{}, picking:null, armed:null, submitting:false }; }catch(e){}
    try{ notebookMarks = {}; notebookNotes = {}; notebookPinned = []; notebookEvents = []; notebookHasUnseen = false; notebookOpen = false; }catch(e){}
    try{ notebookFilter = 'all'; notebookVoteInspectId = null; notebookOpenPlayerId = null; notebookDossierTab = 'notes'; notebookVoteRound = null; notebookVoteMode = 'for'; notebookPrevCardPos = {}; }catch(e){}
    try{ latestView = null; previousView = null; phaseEndsAt = null; deadNoticeDismissed = false; pendingReplyTo = null; activeWhisperTargetId = null; }catch(e){}
    try{ if(typeof renderLynchReveal === 'function') renderLynchReveal._key = null; }catch(e){}
    chatNow = [];
  }
  function start(onFinish, opts){
    if(T.active) return;
    if(typeof myRoomCode !== 'undefined' && myRoomCode){ if(typeof showComingSoonToast === 'function'){ /* reuse toast style */ } alert('Leave your current room before starting the tutorial.'); return; }
    resetClientState();
    T.active = true; T.idx = 0; T.flags = {}; T.onTimers = []; T.onFinish = onFinish || null; T.quick = !!(opts && opts.quick); T.steps = buildSteps().filter(function(st){ return !T.quick || st.q; });
    T.origSendWS = window.sendWS;
    window.sendWS = onSend;
    T.origBecome = window.onBecomeSpeaker; window.onBecomeSpeaker = function(){};   // never ask for the microphone during the practice round
    // a fresh local identity for the practice round
    window.myPlayerId = YOU; window.myRoomCode = null;
    if(typeof GAME_CONFIG !== 'undefined'){ T.prevVoice = GAME_CONFIG.voiceEnabled; GAME_CONFIG.voiceEnabled = true; }
    document.body.classList.add('tut-on');
    build();
    window.addEventListener('resize', layout);
    T.tick = setInterval(layout, 400);
    document.addEventListener('keydown', onKey, true);
    go(0, 1);
  }
  function onKey(e){ if(!T.active) return; if(e.key === 'Escape' && !el.skipAsk){ e.preventDefault(); e.stopPropagation(); confirmSkip(); } }
  function finish(){ exit(true); }
  function exit(completed){
    if(!T.active) return;
    T.active = false;
    clearInterval(T.poll); clearInterval(T.tick); pulsePick(false);
    T.onTimers.forEach(clearTimeout);
    window.removeEventListener('resize', layout);
    document.removeEventListener('keydown', onKey, true);
    window.sendWS = T.origSendWS;
    if(T.origBecome) window.onBecomeSpeaker = T.origBecome;
    if(typeof GAME_CONFIG !== 'undefined') GAME_CONFIG.voiceEnabled = !!T.prevVoice;
    if(el.root){ el.root.remove(); el.root = null; el.skipAsk = null; }
    document.body.classList.remove('tut-on');
    try{ localStorage.setItem(DONE_KEY, completed ? 'done' : 'seen'); }catch(e){}
    var tb = document.getElementById('tutorial-btn'); if(tb) tb.classList.remove('is-new');
    // close anything the practice round opened, then go back to a clean home screen
    ['notebook-modal', 'detective-reveal-modal', 'consigliere-reveal-modal', 'mortician-reveal-modal', 'role-reveal-screen', 'phase-transition-screen', 'nightkill-screen', 'case-log-modal'].forEach(function(id){ var n = document.getElementById(id); if(n) n.style.display = 'none'; });
    try{ if(typeof notebookOpen !== 'undefined') notebookOpen = false; }catch(e){}
    try{ if(typeof stopNightKillTimer === 'function') stopNightKillTimer(); }catch(e){}
    resetClientState();
    window.myPlayerId = null; window.myRoomCode = null;
    try{ if(typeof goToHome === 'function') goToHome(); else switchPanel('home'); }catch(e){ try{ switchPanel('home'); }catch(e2){} }
    var cb = T.onFinish; T.onFinish = null;
    if(typeof cb === 'function') cb(!!completed);
  }

  window.Tutorial = { start:start, stop:function(){ exit(false); }, isActive:function(){ return T.active; }, wasCompleted:function(){ try{ return localStorage.getItem(DONE_KEY) === 'done'; }catch(e){ return false; } }, hasSeen:function(){ try{ return !!localStorage.getItem(DONE_KEY); }catch(e){ return false; } } };
})();
