/* Dual N-Back engine — a line-by-line port of Brain Workshop's rules
 * (brainworkshop.py, GPL-2.0). Pure functions, no DOM, so it can be tested.
 *
 * Source references (brainworkshop.py):
 *   generate_stimulus()      -> generateStimulus
 *   check_match()            -> checkMatch
 *   AnalysisLabel.update()   -> scoreSession
 *   update_all_labels/end    -> applyResult (advance / fallback / strikes)
 *   update(dt) tick loop     -> implemented in app.js, same tick numbers
 */
(function (root) {
  'use strict';

  const DEFAULTS = {
    advance: 80,            // THRESHOLD_ADVANCE (101 = never advance)
    fallback: 50,           // THRESHOLD_FALLBACK (0 = never fall back)
    fallbackSessions: 3,    // THRESHOLD_FALLBACK_SESSIONS
    ticks: 30,              // TICKS_DEFAULT (0.1 s ticks per trial)
    baseTrials: 20,         // NUM_TRIALS
    trialsFactor: 1,        // NUM_TRIALS_FACTOR
    trialsExponent: 2,      // NUM_TRIALS_EXPONENT
    startN: 2,              // BACK_DEFAULT
    chanceMatch: 0.125,     // CHANCE_OF_GUARANTEED_MATCH
    chanceInterference: 0.125, // DEFAULT_CHANCE_OF_INTERFERENCE
    feedback: true,         // SHOW_FEEDBACK
    music: true,            // USE_MUSIC
    applause: true,         // USE_APPLAUSE
    volume: 1.0,
    musicVolume: 1.0,
    keepAwake: true,
    dark: false,            // BLACK_BACKGROUND
    rolloverHour: 4,        // ROLLOVER_HOUR
    updatedAt: 0
  };

  const LETTERS = ['c', 'h', 'k', 'l', 'q', 'r', 's', 't']; // res/sounds/letters, audio 1..8

  // Brain Workshop position codes 1..8 (0 = centre) -> cell index 0..8, row-major from top-left.
  // From Visual.spawn(): x = (p+1)%3 - 1, y = (p//3+1)%3 - 1 (y up).
  const POS_TO_CELL = [4, 5, 3, 1, 2, 0, 7, 8, 6];

  function numTrials(n, s) {
    return s.baseTrials + s.trialsFactor * Math.pow(n, s.trialsExponent);
  }

  function randint(rng, a, b) { return a + Math.floor(rng() * (b - a + 1)); }

  function shuffle(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  /* generate_stimulus() for mode 2 (Dual: position1 + audio).
   * data: {position1:[...], audio:[...]} holding trials 1..trialNumber-1.
   * trialNumber: the current trial, 1-based (already incremented). */
  function generateStimulus(data, trialNumber, back, s, rng) {
    rng = rng || Math.random;
    // positions = random.sample(range(1,9), 4); position1 = positions[0]
    const stim = { position1: randint(rng, 1, 8), audio: randint(rng, 1, 8) };
    if (trialNumber > back) {
      for (const mod of ['position1', 'audio']) {
        let b = null;
        const r1 = rng(), r2 = rng();
        if (r1 < s.chanceMatch) {
          b = back;
        } else if (r2 < s.chanceInterference && back > 1) {
          b = back;
          let interference = [-1, 1, back];
          if (b < 3) interference = interference.slice(1);
          shuffle(interference, rng);
          for (const i of interference) { // "we'll just take the last one that works"
            const idx = trialNumber - (back + i) - 1;
            if (idx >= 0 && data[mod][idx] !== data[mod][trialNumber - back - 1]) b = back + i;
          }
          if (b === back) b = null;
        }
        if (b) stim[mod] = data[mod][trialNumber - b - 1];
      }
    }
    return stim;
  }

  /* check_match(): 'unknown' before N trials exist, else correct/incorrect,
   * or 'missed' when checkMissed and the stimulus matched. */
  function checkMatch(data, current, trialNumber, back, mod, checkMissed) {
    if (data.position1.length < back) return 'unknown';
    if (current[mod] === data[mod][trialNumber - back - 1]) return checkMissed ? 'missed' : 'correct';
    return 'incorrect';
  }

  function calcPercent(r, w) { return (r + w) ? Math.floor(r * 100 / (r + w)) : 0; }

  /* AnalysisLabel.update(), non-Jaeggi scoring:
   * right = hit; wrong = miss or false alarm (XOR). Correct rejections don't count.
   * Score = all rights / (all rights + all wrongs). */
  function scoreSession(data, back) {
    const res = {};
    let right = 0, wrong = 0;
    for (const mod of ['position1', 'audio']) {
      let r = 0, w = 0;
      for (let x = back; x < data[mod].length; x++) {
        const match = data[mod][x] === data[mod][x - back];
        const input = !!data[mod + '_input'][x];
        r += (match && input) ? 1 : 0;
        w += (match !== input) ? 1 : 0;
      }
      res[mod] = { right: r, wrong: w, percent: calcPercent(r, w) };
      right += r; wrong += w;
    }
    res.percent = calcPercent(right, wrong);
    return res;
  }

  /* Level change after a session (end-of-session block in update_all_labels). */
  function applyResult(state, percent, s) {
    const out = { advance: false, fallback: false };
    if (percent >= s.advance) {
      state.n += 1; state.progress = 0; out.advance = true;
    } else if (state.n > 1 && percent < s.fallback) {
      if (state.progress >= s.fallbackSessions - 1) {
        state.n -= 1; state.progress = 0; out.fallback = true;
      } else {
        state.progress += 1;
      }
    }
    return out;
  }

  function congrats(percent, s) {
    if (percent === 100) return 'Perfect score!';
    if (percent >= s.advance) return 'Awesome score!';
    if (percent >= Math.floor((s.advance + s.fallback) / 2)) return 'Great score!';
    if (percent >= s.fallback) return 'Not bad!';
    return "Keep trying. You're getting there!";
  }

  function musicCategory(percent, s) { // play_music()
    if (percent >= s.advance) return 'advance';
    if (percent >= Math.floor((s.advance + s.fallback) / 2)) return 'great';
    if (percent >= s.fallback) return 'good';
    return null;
  }

  /* Replays the merged history to get the current level and strike count.
   * Sessions are ordered by time; a 'set' event pins the level (and strikes).
   * Each session also carries the level it was played at, so a merge of two
   * devices' histories always resolves to the same answer. */
  function deriveState(sessions, events, s) {
    const all = [];
    for (const x of sessions) all.push({ t: x.t, k: 's', x });
    for (const e of events) all.push({ t: e.t, k: 'e', x: e });
    all.sort((a, b) => a.t - b.t || (a.k < b.k ? -1 : 1));
    const state = { n: s.startN, progress: 0 };
    for (const it of all) {
      if (it.k === 'e') {
        if (it.x.type === 'set') { state.n = it.x.n; state.progress = it.x.progress || 0; }
        continue;
      }
      const ses = it.x;
      if (ses.m) continue; // manual sessions never move the level
      if (ses.n !== state.n) { state.n = ses.n; state.progress = 0; }
      applyResult(state, ses.p, s);
    }
    if (state.n < 1) state.n = 1;
    return state;
  }

  function dayKey(t, rolloverHour) {
    const d = new Date(t - rolloverHour * 3600e3);
    const m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
  }

  /* Chart default style 'N+10/3+4/3': N + (pct - fallback) / (advance - fallback). */
  function chartScore(n, p, s) {
    const span = (s.advance - s.fallback) || 1;
    return n + (p - s.fallback) / span;
  }

  /* Parse a Brain Workshop stats.txt; returns Dual (mode 2) sessions. */
  function parseBrainWorkshopStats(text) {
    const out = [];
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      if (!line || '0123456789'.indexOf(line[0]) < 0) continue;
      const sep = line.indexOf('\t') >= 0 ? '\t' : ',';
      const f = line.split(sep);
      if (f.length < 11) continue;
      const mode = parseInt(f[3], 10);
      if (mode !== 2) continue;
      const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(f[0]);
      if (!m) continue;
      const t = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
      const ticks = parseInt(f[5], 10) || 30;
      const trials = parseInt(f[6], 10) || 0;
      out.push({
        id: 'bw-' + f[0].replace(/\D/g, '') + '-' + f[4] + '-' + f[2],
        t,
        n: parseInt(f[4], 10),
        p: parseInt(f[2], 10),
        pp: parseInt(f[9], 10) || 0,
        ap: parseInt(f[10], 10) || 0,
        ticks, trials,
        dur: f[25] ? Math.round(parseFloat(f[25])) : Math.round(ticks * 0.1 * trials),
        m: parseInt(f[7], 10) ? 1 : 0,
        src: 'bw'
      });
    }
    return out;
  }

  const api = {
    DEFAULTS, LETTERS, POS_TO_CELL, numTrials, generateStimulus, checkMatch,
    scoreSession, applyResult, congrats, musicCategory, deriveState, dayKey,
    chartScore, parseBrainWorkshopStats, calcPercent
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DNB = api;
})(this);
