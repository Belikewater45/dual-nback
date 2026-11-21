/* Dual N-Back app: UI, timing loop, storage, audio, sync scheduling. */
(function () {
  'use strict';
  const E = window.DNB;
  const VERSION = '1.0.3';
  const $ = (id) => document.getElementById(id);

  /* ---------------- storage ---------------- */
  const KEY = 'dnb.data', SYNC_KEY = 'dnb.sync';
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }

  function loadData() {
    let d = null;
    try { d = JSON.parse(lsGet(KEY) || 'null'); } catch (e) { d = null; }
    d = d || {};
    d.v = 1;
    d.sessions = Array.isArray(d.sessions) ? d.sessions : [];
    d.events = Array.isArray(d.events) ? d.events : [];
    d.settings = Object.assign({}, E.DEFAULTS, d.settings || {});
    return d;
  }
  let data = loadData();
  function S() { return data.settings; }
  function save() { lsSet(KEY, JSON.stringify(data)); }
  function loadSyncCfg() { try { return JSON.parse(lsGet(SYNC_KEY) || 'null') || {}; } catch (e) { return {}; } }
  let syncCfg = loadSyncCfg();
  function saveSyncCfg() { lsSet(SYNC_KEY, JSON.stringify(syncCfg)); }

  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  function state() { return E.deriveState(data.sessions, data.events, S()); }

  /* ---------------- audio ---------------- */
  let actx = null, master = null, musicGain = null, musicNode = null;
  const letterBuf = {}, letterEl = {};
  let audioNote = '';
  function decode(ab) { // promise + callback form, for older Android WebViews
    return new Promise((res, rej) => { const p = actx.decodeAudioData(ab, res, rej); if (p && p.then) p.then(res, rej); });
  }
  async function loadLetters() {
    const fails = [];
    for (const L of E.LETTERS) {
      if (!letterEl[L]) { const a = new Audio(L + '.wav'); a.preload = 'auto'; letterEl[L] = a; }
      if (letterBuf[L] || !actx) continue;
      try {
        const r = await fetch(L + '.wav');
        if (!r.ok) throw new Error('HTTP ' + r.status);
        letterBuf[L] = await decode(await r.arrayBuffer());
      } catch (e) { fails.push(L.toUpperCase() + ' (' + ((e && e.message) || 'decode failed') + ')'); }
    }
    audioNote = fails.length ? 'Could not load: ' + fails.join(', ') : '';
  }
  /* Call directly inside a tap/click handler: Android only lets audio start from a user gesture. */
  function initAudio() {
    try {
      if (!actx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        actx = new AC({ latencyHint: 'interactive' });
        master = actx.createGain(); master.connect(actx.destination);
        musicGain = actx.createGain(); musicGain.connect(actx.destination);
      }
      master.gain.value = S().volume;
      musicGain.gain.value = S().musicVolume;
      // unlock: play one silent sample synchronously within the gesture
      const sb = actx.createBuffer(1, 1, 22050), src = actx.createBufferSource();
      src.buffer = sb; src.connect(actx.destination); src.start(0);
    } catch (e) { audioNote = 'Web Audio unavailable: ' + ((e && e.message) || e); }
    // also unlock the HTML audio fallback elements within the gesture
    for (const L of E.LETTERS) {
      if (!letterEl[L]) { const a = new Audio(L + '.wav'); a.preload = 'auto'; letterEl[L] = a; }
    }
    const resumed = actx && actx.state !== 'running' ? actx.resume().catch(() => {}) : Promise.resolve();
    return Promise.all([resumed, loadLetters()]);
  }
  function audioReady() {
    const n = E.LETTERS.filter((L) => letterBuf[L]).length;
    if (actx && actx.state === 'running' && n === 8) return { ok: true, text: 'Sound ready (8 of 8 letters loaded).' };
    if (n === 8) return { ok: true, text: 'Sound ready (backup player; audio engine state: ' + (actx ? actx.state : 'none') + ').' };
    return { ok: false, text: 'Sound problem: ' + n + ' of 8 letters loaded. ' + audioNote };
  }
  function playLetter(i) {
    const L = E.LETTERS[i - 1], b = letterBuf[L];
    if (actx && actx.state === 'running' && b) {
      const src = actx.createBufferSource(); src.buffer = b; src.connect(master); src.start();
      return;
    }
    if (actx && actx.state === 'suspended') actx.resume().catch(() => {});
    const el = letterEl[L]; // fallback: plain HTML audio
    if (el) { try { el.volume = Math.max(0, Math.min(1, S().volume)); el.currentTime = 0; el.play().catch(() => {}); } catch (e) {} }
  }
  const MUSIC = {
    advance: ['advance_Concert', 'advance_Hot_Swing', 'advance_Victory'],
    great: ['great_Butterfly_Tea_-_Cavern_of_Time', 'great_Human_Beat', 'great_Lachaim'],
    good: ['good_Corncob', 'good_Emptiness', 'good_Sea_Song']
  };
  function stopMusic() { if (musicNode) { try { musicNode.stop(); } catch (e) {} musicNode = null; } }
  async function playFile(name) {
    if (!actx) return;
    try {
      const ab = await (await fetch(name + '.ogg')).arrayBuffer();
      const buf = await actx.decodeAudioData(ab);
      if (session.started) return;
      const src = actx.createBufferSource(); src.buffer = buf; src.connect(musicGain); src.start();
      return src;
    } catch (e) { return null; }
  }
  async function playMusic(percent, advanced) {
    stopMusic();
    if (advanced && S().applause) playFile('applause');
    if (!S().music) return;
    const cat = E.musicCategory(percent, S());
    if (!cat) return;
    const list = MUSIC[cat];
    const node = await playFile(list[Math.floor(Math.random() * list.length)]);
    if (node) musicNode = node;
  }

  /* ---------------- wake lock ---------------- */
  let wakeLock = null;
  async function lockScreen() {
    if (!S().keepAwake || !('wakeLock' in navigator)) return;
    try { wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { wakeLock = null; }
  }
  function unlockScreen() { if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; } }

  /* ---------------- session (Brain Workshop tick loop) ---------------- */
  const session = { started: false, paused: false };
  const cells = Array.from(document.querySelectorAll('#field .cell'));
  const btn = { position1: $('btnA'), audio: $('btnL') };
  let timer = null;

  function showScreen(id) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
    if (id === 'home') renderHome();
    if (id === 'stats') renderStats();
    if (id === 'settings') renderSettings();
  }

  async function startSession() {
    if (session.started) return;
    const audioP = initAudio(); // must start inside the tap
    await audioP;
    stopMusic();
    const st = state();
    const s = S();
    Object.assign(session, {
      started: true, paused: false,
      back: st.n, ticks: s.ticks, total: E.numTrials(st.n, s),
      tick: -9, // "give a 1-second delay before displaying first trial"
      trial: 0, showMissed: false, stim: null,
      data: { position1: [], audio: [], position1_input: [], audio_input: [] },
      inputs: { position1: false, audio: false },
      t0: performance.now(), processed: 0, startedAt: Date.now()
    });
    $('playTitle').textContent = 'Dual ' + st.n + '-Back';
    const ar = audioReady();
    $('soundWarn').textContent = ar.ok ? '' : ar.text;
    $('field').classList.remove('hidecross');
    hideSquare(); resetInput(); renderRemaining();
    $('pauseOverlay').hidden = true;
    showScreen('play');
    lockScreen();
    timer = setInterval(pump, 10);
  }

  function pump() {
    if (!session.started || session.paused) return;
    const now = performance.now();
    let due = Math.floor((now - session.t0) / 100);
    if (due - session.processed > 5) { // timer was throttled; don't fire a burst of trials
      session.t0 = now - session.processed * 100;
      due = session.processed + 1;
    }
    while (session.processed < due && session.started && !session.paused) {
      session.processed++;
      update();
    }
  }

  /* update(dt) from brainworkshop.py, one call per 0.1 s tick. */
  function update() {
    const T = session.ticks;
    session.tick += 1;
    if (session.tick === 1) {
      session.showMissed = false;
      if (session.trial > 0) saveInput();
      session.trial += 1;
      renderRemaining();
      if (session.trial > session.total) { endSession(false); return; }
      session.stim = E.generateStimulus(session.data, session.trial, session.back, S());
      showSquare(session.stim.position1);
      playLetter(session.stim.audio);
      resetInput();
    }
    if (session.tick === 6 || session.tick === T - 1) hideSquare();
    if (session.tick === T - 2) { // feedback for missed matches
      session.tick = 0;
      session.showMissed = true;
      updateLabels();
    }
    if (session.tick === T) session.tick = 0;
  }

  function saveInput() {
    const d = session.data;
    d.position1.push(session.stim.position1);
    d.audio.push(session.stim.audio);
    d.position1_input.push(session.inputs.position1);
    d.audio_input.push(session.inputs.audio);
  }
  function resetInput() {
    session.inputs = { position1: false, audio: false };
    updateLabels();
  }
  function showSquare(p) {
    hideSquare();
    $('field').classList.add('hidecross');
    cells[E.POS_TO_CELL[p]].classList.add('on');
  }
  function hideSquare() { cells.forEach((c) => c.classList.remove('on')); }
  function renderRemaining() {
    const left = Math.max(0, session.total - Math.max(0, session.trial));
    $('remaining').textContent = left + ' trial' + (left === 1 ? '' : 's') + ' remaining';
  }

  function updateLabels() {
    for (const mod of ['position1', 'audio']) {
      const b = btn[mod];
      b.classList.remove('correct', 'oops', 'incorrect');
      if (!session.started || !session.stim) continue;
      const fb = S().feedback;
      if (fb && session.inputs[mod]) {
        const r = E.checkMatch(session.data, session.stim, session.trial, session.back, mod, false);
        b.classList.add(r === 'correct' ? 'correct' : r === 'unknown' ? 'oops' : 'incorrect');
      } else if (fb && session.showMissed) {
        const r = E.checkMatch(session.data, session.stim, session.trial, session.back, mod, true);
        if (r === 'missed') b.classList.add('oops');
      }
      b.classList.toggle('pressed', !!session.inputs[mod]);
    }
  }

  function press(mod) {
    if (!session.started || session.paused || session.trial < 1 || session.trial > session.total) return;
    session.inputs[mod] = true;
    updateLabels();
  }

  let lastResult = null;
  function endSession(cancelled) {
    clearInterval(timer); timer = null;
    session.started = false; session.paused = false;
    hideSquare(); unlockScreen();
    $('field').classList.remove('hidecross');
    btn.position1.className = 'answer'; btn.audio.className = 'answer';
    if (cancelled) { lastResult = null; showScreen('home'); return; }

    const s = S();
    const before = state();
    const sc = E.scoreSession(session.data, session.back);
    const ses = {
      id: uid(), t: Date.now(), n: session.back, p: sc.percent,
      pp: sc.position1.percent, ap: sc.audio.percent,
      pr: sc.position1.right, pw: sc.position1.wrong, ar: sc.audio.right, aw: sc.audio.wrong,
      ticks: session.ticks, trials: session.total,
      dur: Math.round(session.ticks * 0.1 * session.total), m: 0, src: 'app'
    };
    data.sessions.push(ses); save();
    const st = { n: before.n, progress: before.progress };
    if (st.n !== session.back) { st.n = session.back; st.progress = 0; }
    const r = E.applyResult(st, sc.percent, s);
    lastResult = { sc, r, msg: E.congrats(sc.percent, s) };
    showScreen('home');
    playMusic(sc.percent, r.advance);
    requestSync(500);
  }

  function pauseSession() {
    if (!session.started || session.paused) return;
    session.paused = true; session.pausedAt = performance.now();
    hideSquare();
    $('pauseOverlay').hidden = false;
  }
  function resumeSession() {
    if (!session.started || !session.paused) return;
    initAudio();
    session.t0 += performance.now() - session.pausedAt;
    session.paused = false;
    $('pauseOverlay').hidden = true;
    lockScreen();
  }

  /* ---------------- home ---------------- */
  function todays() {
    const k = E.dayKey(Date.now(), S().rolloverHour);
    return data.sessions.filter((x) => E.dayKey(x.t, S().rolloverHour) === k);
  }
  function fmtMin(sec) { return (sec / 60).toFixed(1) + ' min'; }

  function renderHome() {
    const s = S(), st = state();
    document.body.classList.toggle('dark', !!s.dark);
    $('modeTitle').textContent = 'Dual ' + st.n + '-Back';
    const n = E.numTrials(st.n, s), today = todays();
    $('sessionInfo').textContent = 'Session #' + (today.length + 1) + ' · ' + n + ' trials · ' +
      (s.ticks / 10).toFixed(1) + ' s per trial · ' + fmtMin(s.ticks * 0.1 * n);
    const circ = $('circles'); circ.innerHTML = '';
    for (let i = 0; i < s.fallbackSessions - 1; i++) {
      const el = document.createElement('i'); if (i < st.progress) el.className = 'on'; circ.appendChild(el);
    }
    if (lastResult) {
      const a = lastResult.sc;
      $('analysis').innerHTML = 'Correct-Errors: &nbsp;A: ' + a.position1.right + '-' + a.position1.wrong +
        ' &nbsp; L: ' + a.audio.right + '-' + a.audio.wrong + ' &nbsp; <span class="sc">Score: ' + a.percent + '%</span>';
      let h = lastResult.msg;
      if (lastResult.r.advance) h += ' <span class="up">N-Back increased</span>';
      else if (lastResult.r.fallback) h += ' <span class="down">N-Back decreased</span>';
      $('congrats').innerHTML = h;
    } else { $('analysis').textContent = ''; $('congrats').textContent = ''; }
    const tsec = today.reduce((a, x) => a + (x.dur || 0), 0);
    $('todayLine').textContent = 'Today: ' + today.length + ' session' + (today.length === 1 ? '' : 's') + ', ' + fmtMin(tsec);
    const adv = s.advance > 100 ? 'never advance' : '≥' + s.advance + '% advances';
    const fb = s.fallback <= 0 ? 'never fall back' : '<' + s.fallback + '% ×' + s.fallbackSessions + ' falls back';
    $('rulesLine').textContent = adv + ' · ' + fb;
    const list = $('historyList'); list.innerHTML = '';
    const last = today.slice(-20);
    if (!last.length) { const li = document.createElement('li'); li.className = 'empty'; li.textContent = 'No sessions yet today.'; list.appendChild(li); }
    last.forEach((x, i) => {
      const li = document.createElement('li');
      li.className = x.m ? 'norm' : x.p >= s.advance ? 'adv' : x.p < s.fallback ? 'fb' : 'norm';
      const num = today.length - last.length + i + 1;
      li.innerHTML = '<span>' + (x.m ? 'M' : '#' + num) + '</span><span>D' + x.n + 'B</span><span>' + x.p + '%</span>';
      list.appendChild(li);
    });
    renderSyncBadge();
  }

  /* ---------------- stats ---------------- */
  let chartDays = 90, rowsShown = 100, chartPoints = [];
  function renderStats() {
    const s = S(), all = data.sessions;
    const tiles = $('tiles');
    const today = todays();
    const last50 = all.filter((x) => !x.m).slice(-50);
    const avg = (arr, k) => arr.length ? Math.round(arr.reduce((a, x) => a + (x[k] || 0), 0) / arr.length) : 0;
    const days = new Set(all.map((x) => E.dayKey(x.t, s.rolloverHour)));
    const best = all.reduce((m, x) => Math.max(m, x.n), 0);
    const totalSec = all.reduce((a, x) => a + (x.dur || 0), 0);
    const t = [
      ['Current level', 'D' + state().n + 'B'],
      ['Highest level played', best ? 'D' + best + 'B' : '–'],
      ['Sessions', all.length],
      ['Days trained', days.size],
      ['Total time', (totalSec / 3600).toFixed(1) + ' h'],
      ['Today', today.length + ' · ' + fmtMin(today.reduce((a, x) => a + (x.dur || 0), 0))],
      ['Position avg (last 50)', avg(last50, 'pp') + '%'],
      ['Audio avg (last 50)', avg(last50, 'ap') + '%']
    ];
    tiles.innerHTML = t.map(([k, v]) => '<div class="tile"><div class="v">' + v + '</div><div class="k">' + k + '</div></div>').join('');
    document.querySelectorAll('#rangeBtns button').forEach((b) => b.classList.toggle('on', +b.dataset.days === chartDays));
    drawChart();
    renderRows();
  }

  function renderRows() {
    const s = S();
    const rows = data.sessions.slice().reverse();
    const shown = rows.slice(0, rowsShown);
    $('sessionRows').innerHTML = shown.map((x) => {
      const d = new Date(x.t);
      const ds = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' }) + ' ' +
        d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
      const cls = x.m ? '' : x.p >= s.advance ? 'adv' : x.p < s.fallback ? 'fb' : '';
      return '<tr><td>' + ds + '</td><td>' + (x.m ? 'M ' : '') + 'D' + x.n + 'B</td><td class="' + cls + '">' + x.p +
        '%</td><td>' + (x.pp != null ? x.pp + '%' : '') + '</td><td>' + (x.ap != null ? x.ap + '%' : '') +
        '</td><td>' + ((x.ticks || 30) / 10).toFixed(1) + 's</td></tr>';
    }).join('') || '<tr><td colspan="6">No sessions yet.</td></tr>';
    $('btnMoreRows').hidden = rows.length <= rowsShown;
  }

  function cssVar(n) { return getComputedStyle(document.body).getPropertyValue(n).trim(); }

  function drawChart() {
    const s = S();
    const canvas = $('chart');
    const wrap = canvas.parentElement;
    const W = wrap.clientWidth, H = wrap.clientHeight;
    if (!W || !H) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr; canvas.height = H * dpr;
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);

    const byDay = new Map();
    for (const x of data.sessions) {
      if (x.m) continue;
      const k = E.dayKey(x.t, s.rolloverHour);
      if (!byDay.has(k)) byDay.set(k, []);
      byDay.get(k).push(E.chartScore(x.n, x.p, s));
    }
    let keys = Array.from(byDay.keys()).sort();
    if (chartDays) {
      const cutoff = E.dayKey(Date.now() - chartDays * 86400e3, s.rolloverHour);
      keys = keys.filter((k) => k > cutoff);
    }
    const pts = keys.map((k) => {
      const v = byDay.get(k);
      return { k, avg: v.reduce((a, b) => a + b, 0) / v.length, max: Math.max.apply(null, v), count: v.length };
    });
    const ink2 = cssVar('--ink-2'), grid = cssVar('--grid'), c1 = cssVar('--series-1'), c2 = cssVar('--series-2'), bg = cssVar('--bg') || '#fff';
    g.font = '12px system-ui, sans-serif';
    if (!pts.length) {
      g.fillStyle = ink2; g.textAlign = 'center';
      g.fillText('Your daily scores will appear here after your first session.', W / 2, H / 2);
      chartPoints = []; return;
    }
    let lo = Math.floor(Math.min.apply(null, pts.map((p) => p.avg)));
    let hi = Math.ceil(Math.max.apply(null, pts.map((p) => p.max)));
    lo = Math.max(0, lo); if (hi <= lo) hi = lo + 1;
    const L = 34, R = 12, T = 10, B = 26;
    const pw = W - L - R, ph = H - T - B;
    const xAt = (i) => L + (pts.length === 1 ? pw / 2 : (i * pw) / (pts.length - 1));
    const yAt = (v) => T + ph - ((v - lo) / (hi - lo)) * ph;

    g.strokeStyle = grid; g.lineWidth = 1; g.fillStyle = ink2; g.textAlign = 'right'; g.textBaseline = 'middle';
    const stepY = hi - lo > 8 ? 2 : 1;
    for (let v = lo; v <= hi; v += stepY) {
      const y = Math.round(yAt(v)) + 0.5;
      g.beginPath(); g.moveTo(L, y); g.lineTo(W - R, y); g.stroke();
      g.fillText(String(v), L - 8, y);
    }
    g.textAlign = 'center'; g.textBaseline = 'top';
    const nLabels = Math.min(pts.length, Math.max(2, Math.floor(pw / 80)));
    const shownIdx = new Set();
    for (let j = 0; j < nLabels; j++) shownIdx.add(Math.round((j * (pts.length - 1)) / Math.max(1, nLabels - 1)));
    shownIdx.forEach((i) => {
      const [y, m, d] = pts[i].k.split('-').map(Number);
      g.fillText(new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), xAt(i), H - B + 8);
    });

    function line(key, color) {
      g.strokeStyle = color; g.lineWidth = 2; g.lineJoin = 'round'; g.lineCap = 'round';
      g.beginPath();
      pts.forEach((p, i) => { const x = xAt(i), y = yAt(p[key]); i ? g.lineTo(x, y) : g.moveTo(x, y); });
      g.stroke();
      if (pts.length <= 40) pts.forEach((p, i) => {
        g.beginPath(); g.arc(xAt(i), yAt(p[key]), 4, 0, Math.PI * 2);
        g.fillStyle = color; g.fill(); g.lineWidth = 2; g.strokeStyle = bg; g.stroke();
      });
    }
    line('max', c2);
    line('avg', c1);
    chartPoints = pts.map((p, i) => ({ x: xAt(i), yA: yAt(p.avg), yM: yAt(p.max), p }));
    chartGeom = { L, R, T, B, W, H, c1, c2 };
  }
  let chartGeom = null;

  function chartHover(ev) {
    if (!chartPoints.length) return;
    const rect = $('chart').getBoundingClientRect();
    const x = ev.clientX - rect.left;
    let best = chartPoints[0];
    for (const c of chartPoints) if (Math.abs(c.x - x) < Math.abs(best.x - x)) best = c;
    drawChart();
    const g = $('chart').getContext('2d');
    g.strokeStyle = cssVar('--ink-3'); g.lineWidth = 1;
    g.beginPath(); g.moveTo(Math.round(best.x) + 0.5, chartGeom.T); g.lineTo(Math.round(best.x) + 0.5, chartGeom.H - chartGeom.B); g.stroke();
    const tip = $('chartTip');
    const [y, m, d] = best.p.k.split('-').map(Number);
    tip.innerHTML = '<b>' + new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) +
      '</b> · ' + best.p.count + ' session' + (best.p.count === 1 ? '' : 's') +
      '<br><span class="sw" style="background:' + chartGeom.c1 + '"></span>Average ' + best.p.avg.toFixed(2) +
      '<br><span class="sw" style="background:' + chartGeom.c2 + '"></span>Best ' + best.p.max.toFixed(2);
    tip.hidden = false;
    const tw = tip.offsetWidth;
    let left = best.x + 12; if (left + tw > chartGeom.W) left = best.x - tw - 12;
    tip.style.left = Math.max(0, left) + 'px'; tip.style.top = '4px';
  }
  function chartLeave() { $('chartTip').hidden = true; drawChart(); }

  /* ---------------- settings ---------------- */
  let freezeState = null; // level/strikes captured before thresholds change
  function setSetting(k, v) {
    const s = S();
    if (['advance', 'fallback', 'fallbackSessions'].includes(k) && !freezeState && data.sessions.length) freezeState = state();
    s[k] = v; s.updatedAt = Date.now(); save();
    if (k === 'volume' && master) master.gain.value = v;
    if (k === 'musicVolume' && musicGain) musicGain.gain.value = v;
    if (k === 'dark') document.body.classList.toggle('dark', !!v);
    requestSync(3000);
  }
  function commitFreeze() {
    if (!freezeState) return;
    // Thresholds apply from now on; past sessions keep the level they produced.
    data.events.push({ id: uid(), t: Date.now(), type: 'set', n: freezeState.n, progress: freezeState.progress, why: 'thresholds' });
    freezeState = null; save(); requestSync(1000);
  }
  function setLevel(n) {
    data.events.push({ id: uid(), t: Date.now(), type: 'set', n, progress: 0, why: 'manual' });
    save(); requestSync(2000);
  }

  function stepperRow(title, desc, get, set, opt) {
    const row = document.createElement('div'); row.className = 'row';
    row.innerHTML = '<div class="lab"><div class="t">' + title + '</div>' + (desc ? '<div class="d">' + desc + '</div>' : '') +
      '</div><div class="stepper"><button type="button" aria-label="Decrease">−</button><span class="val"></span><button type="button" aria-label="Increase">+</button></div>';
    const [dec, inc] = row.querySelectorAll('button');
    const val = row.querySelector('.val');
    const lim = () => ({ min: typeof opt.min === 'function' ? opt.min() : opt.min, max: typeof opt.max === 'function' ? opt.max() : opt.max });
    function paint() {
      const v = get(), l = lim();
      val.textContent = opt.fmt ? opt.fmt(v) : v;
      dec.disabled = v <= l.min + 1e-9; inc.disabled = v >= l.max - 1e-9;
    }
    function bump(dir) {
      const l = lim();
      let v = Math.round((get() + dir * opt.step) * 1000) / 1000;
      v = Math.min(l.max, Math.max(l.min, v));
      set(v); paintAll();
    }
    // press-and-hold repeats
    function hold(dir, b) {
      let t1 = null, t2 = null;
      const stop = () => { clearTimeout(t1); clearInterval(t2); };
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); bump(dir); t1 = setTimeout(() => { t2 = setInterval(() => bump(dir), 90); }, 450); });
      ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => b.addEventListener(ev, stop));
    }
    hold(-1, dec); hold(1, inc);
    row._paint = paint; paint();
    return row;
  }
  function switchRow(title, desc, key) {
    const row = document.createElement('div'); row.className = 'row';
    row.innerHTML = '<div class="lab"><div class="t">' + title + '</div>' + (desc ? '<div class="d">' + desc + '</div>' : '') +
      '</div><label class="switch"><input type="checkbox"><span></span></label>';
    const cb = row.querySelector('input'); cb.checked = !!S()[key];
    cb.addEventListener('change', () => setSetting(key, cb.checked));
    row._paint = () => { cb.checked = !!S()[key]; };
    return row;
  }
  function sliderRow(title, key) {
    const row = document.createElement('div'); row.className = 'row';
    row.innerHTML = '<div class="lab"><div class="t">' + title + '</div></div><input type="range" min="0" max="1" step="0.05">';
    const r = row.querySelector('input'); r.value = S()[key];
    r.addEventListener('input', () => setSetting(key, parseFloat(r.value)));
    row._paint = () => { r.value = S()[key]; };
    return row;
  }
  function soundTestRow() {
    const row = document.createElement('div'); row.className = 'row';
    row.innerHTML = '<div class="lab"><div class="t">Test sound</div><div class="d" id="soundDetail">Plays the letter C. If you hear nothing, raise the phone\'s media volume.</div></div>' +
      '<button class="secondary" type="button" id="btnSoundTest">Play</button>';
    row.querySelector('button').addEventListener('click', () => {
      initAudio().then(() => { playLetter(1); const d = $('soundDetail'); if (d) d.textContent = audioReady().text + ' If you hear nothing, raise the media volume.'; });
    });
    return row;
  }
  let paintables = [];
  function paintAll() { paintables.forEach((r) => r._paint && r._paint()); }
  function group(title, rows) {
    const g = document.createElement('div'); g.className = 'group';
    g.innerHTML = '<h3>' + title + '</h3>';
    rows.forEach((r) => { g.appendChild(r); paintables.push(r); });
    return g;
  }

  function renderSettings() {
    const body = $('settingsBody'); body.innerHTML = ''; paintables = [];
    const s = S;
    body.appendChild(group('Level progression', [
      stepperRow('Level-up threshold', 'Score at or above this moves you up one level. 101% = never advance.',
        () => s().advance, (v) => setSetting('advance', v),
        { min: () => Math.max(1, s().fallback + 1), max: 101, step: 1, fmt: (v) => v + '%' }),
      stepperRow('Level-down threshold', 'Scores below this count as a strike. 0% = never fall back.',
        () => s().fallback, (v) => setSetting('fallback', v),
        { min: 0, max: () => Math.min(100, s().advance - 1), step: 1, fmt: (v) => v + '%' }),
      stepperRow('Strikes to level down', 'Sessions below the level-down threshold, at the same level, before dropping a level.',
        () => s().fallbackSessions, (v) => setSetting('fallbackSessions', v),
        { min: 1, max: 10, step: 1 }),
      stepperRow('Current level', 'Set your N-back level directly. Strikes reset.',
        () => state().n, (v) => setLevel(v), { min: 1, max: 20, step: 1, fmt: (v) => v + '-back' })
    ]));
    body.appendChild(group('Session', [
      stepperRow('Trial time', 'Brain Workshop default 3.0 s.', () => s().ticks, (v) => setSetting('ticks', v),
        { min: 4, max: 50, step: 1, fmt: (v) => (v / 10).toFixed(1) + ' s' }),
      stepperRow('Base trials', 'Trials per session = base + N². Default 20.', () => s().baseTrials, (v) => setSetting('baseTrials', v),
        { min: 1, max: 100, step: 1 }),
      stepperRow('Guaranteed match chance', 'Extra matches added on top of the natural 1-in-8. Default 12.5%.',
        () => s().chanceMatch, (v) => setSetting('chanceMatch', v), { min: 0, max: 0.5, step: 0.025, fmt: (v) => (v * 100).toFixed(1) + '%' }),
      stepperRow('Interference chance', 'Near-miss lures (one early, one late, or N late). Default 12.5%.',
        () => s().chanceInterference, (v) => setSetting('chanceInterference', v), { min: 0, max: 0.5, step: 0.025, fmt: (v) => (v * 100).toFixed(1) + '%' })
    ]));
    body.appendChild(group('Feedback & sound', [
      switchRow('Show feedback', 'Buttons flash green (correct), red (wrong), blue (missed).', 'feedback'),
      soundTestRow(),
      sliderRow('Letter volume', 'volume'),
      switchRow('Music after sessions', null, 'music'),
      switchRow('Applause on level up', null, 'applause'),
      sliderRow('Music volume', 'musicVolume')
    ]));
    body.appendChild(group('Display', [
      switchRow('Black background', null, 'dark'),
      switchRow('Keep screen on during sessions', null, 'keepAwake')
    ]));
    const og = document.createElement('div'); og.className = 'group';
    og.innerHTML = '<h3>Offline</h3><div class="row"><div class="lab"><div class="t">Offline status</div><div class="d" id="offlineDetail"></div></div>' +
      '<button class="secondary" type="button" id="btnOfflineCheck">Check</button></div>';
    body.appendChild(og);
    setTimeout(() => { paintOffline(); $('btnOfflineCheck').onclick = checkOffline; });
    body.appendChild(syncGroup());
    const about = document.createElement('div'); about.className = 'group';
    about.innerHTML = '<h3>About</h3><div class="row"><div class="lab"><div class="t">Dual N-Back ' + VERSION + '</div>' +
      '<div class="d">Game rules, letter sounds, square and music are from Brain Workshop (GPL-2.0). Keys A and L also work with a keyboard; Space starts, Esc stops.</div></div></div>';
    body.appendChild(about);
  }

  /* ---------------- sync ---------------- */
  let syncing = false, syncTimer = null, syncErr = null;
  function syncGroup() {
    const g = document.createElement('div'); g.className = 'group';
    g.innerHTML = '<h3>Sync between devices</h3>';
    const row = document.createElement('div'); row.className = 'row tokenrow';
    const connected = !!syncCfg.token;
    row.innerHTML = connected
      ? '<div class="lab"><div class="t">Connected to GitHub</div><div class="d" id="syncDetail"></div></div>' +
        '<div class="btnrow"><button class="secondary" type="button" id="btnSyncNow">Sync now</button>' +
        '<button class="secondary" type="button" id="btnDisconnect">Disconnect this device</button></div>'
      : '<div class="lab"><div class="t">GitHub token</div><div class="d">Paste a GitHub token with the <b>gist</b> permission. Use the same token on your phone and tablet; history merges automatically whenever you have signal.</div></div>' +
        '<input type="password" id="tokenIn" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="ghp_… or github_pat_…">' +
        '<div class="btnrow"><button class="primary" style="font-size:16px;padding:10px 22px;min-height:44px;margin:0" type="button" id="btnConnect">Connect</button></div>' +
        '<div class="d" id="syncDetail"></div>';
    g.appendChild(row);
    setTimeout(() => {
      const d = $('syncDetail'); if (d) d.textContent = syncStatusText();
      if ($('btnConnect')) $('btnConnect').onclick = () => {
        const v = $('tokenIn').value.trim();
        if (!v) return;
        syncCfg = { token: v }; saveSyncCfg(); syncErr = null;
        $('syncDetail').textContent = 'Connecting…';
        doSync().then(() => {
          if (!syncCfg.gistId) { // first connection failed: don't keep a bad token
            const err = syncErr || 'Could not reach GitHub. Connect needs signal.';
            syncCfg = {}; saveSyncCfg(); syncErr = null; connectMsg = 'Not connected: ' + err;
            renderSettings(); renderSyncBadge();
          } else renderSettings();
        });
      };
      if ($('btnSyncNow')) $('btnSyncNow').onclick = () => { doSync().then(() => { const d2 = $('syncDetail'); if (d2) d2.textContent = syncStatusText(); }); };
      if ($('btnDisconnect')) $('btnDisconnect').onclick = () => { syncCfg = {}; saveSyncCfg(); syncErr = null; renderSettings(); renderSyncBadge(); };
    });
    return g;
  }
  function ago(t) {
    const s = Math.round((Date.now() - t) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.round(s / 60) + ' min ago';
    if (s < 86400) return Math.round(s / 3600) + ' h ago';
    return Math.round(s / 86400) + ' d ago';
  }
  let connectMsg = null;
  function syncStatusText() {
    if (!syncCfg.token) { const m = connectMsg; connectMsg = null; return m || 'Not connected. History is saved on this device only.'; }
    if (syncing) return 'Syncing…';
    if (syncErr) return 'Last sync failed: ' + syncErr;
    if (!navigator.onLine) return 'Offline. Will sync when you have signal.' + (syncCfg.last ? ' Last synced ' + ago(syncCfg.last) + '.' : '');
    return syncCfg.last ? 'Last synced ' + ago(syncCfg.last) + '.' : 'Not synced yet.';
  }
  function renderSyncBadge() {
    const b = $('syncBadge');
    b.classList.remove('ok', 'err');
    if (!syncCfg.token) { b.textContent = 'Sync off'; return; }
    if (syncing) { b.textContent = 'Syncing…'; return; }
    if (syncErr) { b.textContent = 'Sync error'; b.classList.add('err'); return; }
    if (!navigator.onLine) { b.textContent = 'Offline'; return; }
    b.textContent = syncCfg.last ? 'Synced ' + ago(syncCfg.last) : 'Not synced';
    if (syncCfg.last) b.classList.add('ok');
  }
  function requestSync(delay) {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(doSync, delay || 0);
  }
  async function doSync() {
    if (!syncCfg.token || syncing) return;
    if (session.started) { requestSync(5000); return; }
    if (!navigator.onLine) { renderSyncBadge(); return; }
    syncing = true; renderSyncBadge();
    try {
      const local = { v: 1, sessions: data.sessions, events: data.events, settings: data.settings };
      const res = await window.DNBSync.sync(syncCfg, local);
      if (session.started) { syncing = false; requestSync(5000); return; }
      data.sessions = res.data.sessions; data.events = res.data.events;
      data.settings = Object.assign({}, E.DEFAULTS, res.data.settings || {});
      save();
      syncCfg.gistId = res.gistId; syncCfg.last = Date.now(); saveSyncCfg();
      syncErr = null;
    } catch (e) {
      syncErr = (e && e.message) ? e.message : 'network error';
    }
    syncing = false;
    const active = document.querySelector('.screen.active');
    if (active && active.id === 'home') renderHome();
    else if (active && active.id === 'stats') renderStats();
    renderSyncBadge();
  }

  /* ---------------- import / export ---------------- */
  function exportData() {
    const blob = new Blob([JSON.stringify({ v: 1, app: 'dual-nback', exported: new Date().toISOString(), sessions: data.sessions, events: data.events, settings: data.settings }, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'dual-nback-backup-' + E.dayKey(Date.now(), 0) + '.json';
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  async function importFile(file) {
    const text = await file.text();
    let incoming = null;
    try {
      const j = JSON.parse(text);
      if (j && Array.isArray(j.sessions)) incoming = { sessions: j.sessions, events: j.events || [], settings: j.settings };
    } catch (e) { /* not JSON */ }
    if (!incoming) {
      const bw = E.parseBrainWorkshopStats(text);
      if (!bw.length) { $('importMsg').textContent = 'No Dual N-Back sessions found in that file.'; return; }
      incoming = { sessions: bw, events: [] };
    }
    const before = data.sessions.length;
    const merged = window.DNBSync.merge({ sessions: data.sessions, events: data.events, settings: data.settings },
      { sessions: incoming.sessions, events: incoming.events, settings: incoming.settings || { updatedAt: 0 } });
    data.sessions = merged.sessions; data.events = merged.events;
    data.settings = Object.assign({}, E.DEFAULTS, merged.settings);
    save();
    const added = data.sessions.length - before;
    $('importMsg').textContent = 'Imported ' + added + ' new session' + (added === 1 ? '' : 's') +
      (incoming.sessions.length - added ? ' (' + (incoming.sessions.length - added) + ' already here)' : '') + '.';
    renderStats(); requestSync(500);
  }

  /* ---------------- wiring ---------------- */
  for (const mod of ['position1', 'audio']) {
    btn[mod].addEventListener('pointerdown', (e) => { e.preventDefault(); press(mod); });
    btn[mod].addEventListener('contextmenu', (e) => e.preventDefault());
  }
  $('btnStart').addEventListener('click', startSession);
  $('btnStop').addEventListener('click', pauseSession);
  $('btnResume').addEventListener('click', resumeSession);
  $('btnQuit').addEventListener('click', () => endSession(true));
  $('btnStats').addEventListener('click', () => showScreen('stats'));
  $('btnSettings').addEventListener('click', () => showScreen('settings'));
  $('syncBadge').addEventListener('click', () => { if (syncCfg.token) doSync(); else showScreen('settings'); });
  document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => {
    if (document.querySelector('.screen.active').id === 'settings') commitFreeze();
    showScreen(b.dataset.go);
  }));
  document.querySelectorAll('#rangeBtns button').forEach((b) => b.addEventListener('click', () => { chartDays = +b.dataset.days; renderStats(); }));
  $('btnMoreRows').addEventListener('click', () => { rowsShown += 200; renderRows(); });
  $('btnExport').addEventListener('click', exportData);
  $('fileImport').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) importFile(f); e.target.value = ''; });
  const cv = $('chart');
  cv.addEventListener('pointermove', chartHover);
  cv.addEventListener('pointerdown', chartHover);
  cv.addEventListener('pointerleave', chartLeave);

  document.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    const k = e.key.toLowerCase();
    if (session.started) {
      if (k === 'a') press('position1');
      else if (k === 'l') press('audio');
      else if (k === 'escape') { if (session.paused) endSession(true); else pauseSession(); }
      else if (k === 'p' || k === ' ') { if (session.paused) resumeSession(); else if (k === 'p') pauseSession(); }
      return;
    }
    const active = document.querySelector('.screen.active').id;
    if (active === 'home' && (k === ' ' || k === 'enter')) { e.preventDefault(); startSession(); }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pauseSession();
    else { if (!session.started) { renderSyncBadge(); requestSync(300); } else if (session.paused) lockScreen(); }
  });
  window.addEventListener('online', () => requestSync(500));
  window.addEventListener('offline', renderSyncBadge);
  window.addEventListener('resize', () => { if (document.querySelector('.screen.active').id === 'stats') drawChart(); });
  setInterval(() => { if (!session.started) renderSyncBadge(); }, 30000);

  /* ---------------- offline readiness ---------------- */
  let offline = { state: 'checking', text: 'Checking…' };
  function setOffline(state, text) { offline = { state, text }; paintOffline(); }
  function paintOffline() {
    const h = $('offlineLine');
    if (h) { h.textContent = offline.state === 'ready' ? '' : offline.text; h.className = 'offline-line ' + offline.state; }
    const d = $('offlineDetail'); if (d) d.textContent = offline.text;
  }
  function checkOffline() {
    if (!('serviceWorker' in navigator)) return setOffline('bad', 'Offline mode is not supported in this browser. Use Chrome.');
    if (location.protocol !== 'https:' && location.hostname !== 'localhost') return setOffline('bad', 'Offline mode needs the https:// GitHub Pages address.');
    const c = navigator.serviceWorker.controller;
    if (!c) return setOffline('wait', 'Not ready for offline yet. Keep the app open with signal for a minute, then close and reopen it.');
    c.postMessage('status');
  }
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.addEventListener('message', (e) => {
      const m = e.data || {};
      if (m.type !== 'status') return;
      if (m.coreMissing.length) setOffline('wait', 'Not ready for offline: ' + m.coreMissing.length + ' required file(s) not saved yet (' + m.coreMissing.slice(0, 3).join(', ') + '). Reopen the app with signal.');
      else setOffline('ready', 'Ready for offline use (v' + m.version + ', ' + (m.total - m.missing.length) + ' of ' + m.total + ' files saved' + (m.missing.length ? '; some music missing' : '') + ').');
    });
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      // a new version took over: reload once so this screen runs it, unless mid-session
      if (reloaded) return;
      if (session.started) { setTimeout(checkOffline, 500); return; }
      if (hadController) { reloaded = true; location.reload(); } else setTimeout(checkOffline, 500);
    });
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js').then((reg) => {
      reg.update().catch(() => {});
      navigator.serviceWorker.ready.then(() => setTimeout(checkOffline, 300));
    }).catch((err) => setOffline('bad', 'Offline setup failed: ' + (err && err.message || err)));
    setTimeout(checkOffline, 200);
  } else setOffline('bad', 'Offline mode is not available here.');

  window.__dnb = { audioReady, session, data: () => data, state, update, setSetting, E }; // for testing
  showScreen('home');
  requestSync(800);
})();
