// Звуковой кит «Ризи RUN» (feature-bible 2.8, AUDIO-1…7): 100% процедурный WebAudio, без файлов.
//
//   import { createAudio } from "./audio/index.js";
//   const audio = createAudio(ctx /* {quality} */, opts? /* {context, clock, seed, haptics} */);
//   audio.prepare()                 — во время загрузки: банк звуков считается кусками по ~8 мс (без AudioContext)
//   audio.unlock()                  — на КАЖДОМ pointerdown/keydown (идемпотентно): создаёт/будит AudioContext
//   audio.update(realDt)            — раз в кадр (реальное время, не simDt: музыка не замирает на хит-стопе)
//   audio.startRun(leadSec) → сек до первой сильной доли забега (CAM-4 подгоняет пролёт ±150 мс под неё)
//   audio.setMode("title"|"play"|"over", {lead}?), setIntensity(I), setDanger(d), setDistance(m), setSwarmNear(sec)
//   audio.setRunner(runPhase, grounded, sliding), setSwarm(distance|null, x), setTunnel(b)
//   audio.play(name, opts?)         — имена в SOUND_NAMES; opts.delay (сек) откладывает звук по часам аудио
//   audio.setVolume(bus, v), setMuted(b), setPaused(b), setHaptics(b), dispose()
//   audio.clock                     — {bpm, beat, beatPhase, bar, barPhase, downbeat, nextDownbeat, toDownbeat, running}
//
// Граф: голос → шина [music 0.55 · sfx 0.9 · ui 0.6 · amb 0.35] → duck → master 0.8 → компрессор (−10 дБ, 12:1)
//       → мягкий потолок (WaveShaper, асимптота 0.98) → выход.  sfx не приглушается, music/amb/ui — да.
// Офлайн-тест: opts.context = OfflineAudioContext, opts.clock = () => виртуальное время; update() двигает планировщик.
import { makeRng } from "./dsp.js";
import { bankSteps, CHORDS, PENT, PENT_M, TOMS, reverbIR } from "./patches.js";

export const BUS_DEFAULTS = { master: 0.8, music: 0.55, sfx: 0.9, ui: 0.6, amb: 0.35 };
export const SOUND_NAMES = ["energon", "arc", "lane", "jump", "dive", "land", "slide", "edge", "nearmiss", "hit", "gameover",
  "milestone", "record", "mission", "tier", "tick", "count", "start", "uiHover", "uiClick", "relief", "chirp"];

// ---------- банк: сырые Float32Array по sampleRate (общие для всех контекстов) ----------
// Буферы можно играть в контексте с другой частотой (браузер ресемплирует), поэтому prepare() считает банк на 48 кГц
// заранее, а если устройство на 44.1 кГц — точная версия досчитывается в фоне и подменяется незаметно.
const BANK_SR = 48000;
const perfNow = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
const RAW = new Map();        // sr → { B, iter, done, ms }
const CONV = new Map();       // sr → банк AudioBuffer (AudioBuffer не привязан к контексту)
const IRS = new Map();        // sr:quality → AudioBuffer импульса реверба (ConvolverNode требует частоту контекста)
function rawEntry(sr){
  let e = RAW.get(sr);
  if (!e){ e = { B: {}, iter: null, done: false, ms: 0 }; e.iter = bankSteps(sr, e.B); RAW.set(sr, e); }
  return e;
}
function rawRun(e, budgetMs){
  const t0 = perfNow();
  while (!e.done){
    if (e.iter.next().done){ e.done = true; break; }
    if (perfNow() - t0 >= budgetMs) break;
  }
  e.ms += perfNow() - t0;
  return e.done;
}
function prepareRaw(sr, deferFirst){
  const e = rawEntry(sr);
  return new Promise(res => { const tick = () => { if (rawRun(e, 8)) res(e); else setTimeout(tick, 0); }; if (deferFirst) setTimeout(tick, 0); else tick(); });
}
function convert(ac, v, sr){
  if (v instanceof Float32Array){ const b = ac.createBuffer(1, v.length, sr); b.copyToChannel(v, 0); return b; }
  if (Array.isArray(v)) return v.map(x => convert(ac, x, sr));
  if (v && typeof v === "object"){ const o = {}; for (const k in v) o[k] = convert(ac, v[k], sr); return o; }
  return v;
}
function bankAB(ac, e){
  const sr = e.B.sr;
  let bank = CONV.get(sr);
  if (!bank){ bank = convert(ac, e.B, sr); bank.ms = e.ms; bank.sr = sr; CONV.set(sr, bank); }
  return bank;
}
function irFor(ac, quality){
  const key = ac.sampleRate + ":" + quality;
  let ir = IRS.get(key);
  if (!ir){
    const [L, R] = reverbIR(ac.sampleRate, quality === "low" ? 0.8 : quality === "high" ? 2.0 : 1.5);
    ir = ac.createBuffer(2, L.length, ac.sampleRate); ir.copyToChannel(L, 0); ir.copyToChannel(R, 1);
    IRS.set(key, ir);
  }
  return ir;
}

// удержать текущее значение параметра в момент t (cancelAndHold где есть, иначе грубый фолбэк)
function hold(p, t){
  if (p.cancelAndHoldAtTime) p.cancelAndHoldAtTime(t);
  else { const v = p.value; p.cancelScheduledValues(t); p.setValueAtTime(v, t); }
}
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const RHYTHMS = [   // 8-е доли мотива: 1 нота, 0 пауза
  [1, 0, 1, 0, 1, 1, 0, 0], [1, 0, 0, 1, 0, 0, 1, 0], [1, 1, 0, 1, 0, 1, 0, 0], [0, 0, 1, 0, 1, 0, 1, 1],
  [1, 0, 1, 1, 0, 0, 0, 0], [1, 0, 0, 0, 1, 0, 1, 0],
];
const MOVES = [-2, -1, -1, 1, 1, 2, 0];
const CHORD_TONES = [[0, 2, 3, 5, 7, 8], [0, 2, 4, 5, 7], [0, 4, 5], [1, 3, 6, 8]];   // индексы PENT, попадающие в аккорд
const ARP = [0, 1, 2, 3, 4, 3, 2, 1];
const HAT_VEL = [0, 2, 1, 2];   // индексы вариантов [1, .7, .4] → velocity [1, .4, .7, .4]
// музыка: 16 one-shot слотов + пэд (3 ноты) + дрон (1) = 20 голосов по библии; последние 3 слота только для
// «скелета» (бочка, малый, бас, мелодия), чтобы на плотных тактах пропадали хэты/щипки, а не сильная доля
const MUSIC_SLOTS = 16, HI_RESERVE = 3;

export function createAudio(ctx = {}, opts = {}){
  const quality = ctx.quality || "med";
  const rng = makeRng(opts.seed || 20260914);
  const externalCtx = opts.context || null;
  const clockFn = opts.clock || null;

  let ac = externalCtx, B = null, built = false, disposed = false, timer = 0;
  const now = () => clockFn ? clockFn() : (ac ? ac.currentTime : 0);

  // ---------- состояние, которое можно задавать до unlock ----------
  const S = { mode: "title", I: 0, danger: 0, dist: 0, swarmNear: 0, swarmX: 0, tunnel: false,
    paused: false, muted: false, haptics: opts.haptics !== false, air: false, sliding: false, lastSin: 0, stepAlt: 1 };
  const vol = { master: 1, music: 1, sfx: 1, ui: 1, amb: 1 };
  const clock = { bpm: 120, beat: 0, beatPhase: 0, bar: 0, barPhase: 0, downbeat: false, nextDownbeat: -1, toDownbeat: 0, running: false };
  const debug = { voices: 0, musicVoices: 0, dropped: 0, droppedHi: 0, bankMs: 0, bankSr: 0, ctxMs: 0, buildMs: 0, layers: [1, 0, 0, 0, 0], minor: false,
    bpm: 96, state: "locked", session: "n/a", boostLvl: 0 };

  // ---------- узлы ----------
  const N = {};
  let sfxPool, uiPool, ambPool, ladderPool, pools = [];
  const mSrc = new Array(MUSIC_SLOTS).fill(null), mEnd = new Float64Array(MUSIC_SLOTS);
  const padOsc = [null, null], padGain = [null, null];   // [текущий, предыдущий] аккорды пэда
  let drone = null, swarm = null;

  function G(v = 1){ const g = ac.createGain(); g.gain.value = v; return g; }
  function makePool(n, dest){
    const P = { n, g: [], p: [], src: new Array(n).fill(null), end: new Float64Array(n), lvl: new Float32Array(n) };
    for (let i = 0; i < n; i++){
      const g = G(0), p = ac.createStereoPanner ? ac.createStereoPanner() : null;
      if (p){ g.connect(p); p.connect(dest); } else g.connect(dest);
      P.g.push(g); P.p.push(p);
    }
    return P;
  }

  // банк для этого контекста: готовый на родной частоте → готовый на 48 кГц (+ фоновая досборка) → синхронно
  function pickBank(){
    const sr = ac.sampleRate;
    const native = RAW.get(sr), pre = RAW.get(BANK_SR);
    if (native && native.done) return bankAB(ac, native);
    if (pre && pre.done && !externalCtx){
      if (quality !== "low") prepareRaw(sr, true).then(e => { if (!disposed && built){ B = bankAB(ac, e); debug.bankSr = sr; } });
      return bankAB(ac, pre);
    }
    const e = native || rawEntry(sr); rawRun(e, Infinity);   // prepare() не звали или не успел — добиваем в жесте
    return bankAB(ac, e);
  }

  function build(){
    B = pickBank(); debug.bankMs = B.ms; debug.bankSr = B.sr;
    // мастер-цепь
    N.fade = G(0); N.master = G(BUS_DEFAULTS.master);
    N.comp = ac.createDynamicsCompressor();
    const c = N.comp; c.threshold.value = -10; c.knee.value = 6; c.ratio.value = 12; c.attack.value = 0.003; c.release.value = 0.15;
    N.trim = G(0.78);       // компенсация автоматического make-up gain компрессора
    N.pre = G(0.5);         // WaveShaper работает на [−1,1] → вход ×0.5, кривая считает f(2u)
    N.shaper = ac.createWaveShaper();
    const curve = new Float32Array(4097);
    for (let i = 0; i < curve.length; i++){
      const x = (i / 2048 - 1) * 2, a = Math.abs(x);
      curve[i] = Math.sign(x) * (a < 0.8 ? a : 0.8 + 0.18 * Math.tanh((a - 0.8) / 0.18));
    }
    N.shaper.curve = curve; N.shaper.oversample = "none";
    N.fade.connect(N.master); N.master.connect(N.comp); N.comp.connect(N.trim); N.trim.connect(N.pre); N.pre.connect(N.shaper);
    N.shaper.connect(ac.destination);
    N.out = N.shaper;

    // шины
    N.sfx = G(BUS_DEFAULTS.sfx); N.sfx.connect(N.fade);
    N.uiVol = G(BUS_DEFAULTS.ui); N.uiDuck = G(1); N.uiDuck.connect(N.uiVol); N.uiVol.connect(N.fade); N.ui = N.uiDuck;
    N.ambVol = G(BUS_DEFAULTS.amb); N.ambDuck = G(1); N.ambDuck.connect(N.ambVol); N.ambVol.connect(N.fade); N.amb = N.ambDuck;
    N.musicVol = G(BUS_DEFAULTS.music); N.musicVol.connect(N.fade);
    N.musicDuck = G(1); N.musicDuck.connect(N.musicVol);
    N.musicMode = G(1); N.musicMode.connect(N.musicDuck);
    N.musicLP = ac.createBiquadFilter(); N.musicLP.type = "lowpass"; N.musicLP.frequency.value = 2500; N.musicLP.Q.value = 0.5;
    N.musicLP.connect(N.musicMode);
    N.musicIn = G(1); N.musicIn.connect(N.musicLP);
    N.sting = G(1); N.sting.connect(N.musicVol);     // диссонанс удара: мимо duck и LP
    N.ducks = [N.musicDuck.gain, N.ambDuck.gain, N.uiDuck.gain];

    // реверб: посыл музыки (после LP), sfx и ui; возврат в fade (до лимитера)
    N.conv = ac.createConvolver(); N.conv.normalize = true;
    if (externalCtx) N.conv.buffer = irFor(ac, quality);
    else setTimeout(() => { if (!disposed) try { N.conv.buffer = irFor(ac, quality); } catch (e){} }, 30);   // не в жесте
    N.verb = G(quality === "low" ? 0.28 : 0.4); N.conv.connect(N.verb); N.verb.connect(N.fade);
    N.mSend = G(0.35); N.musicMode.connect(N.mSend); N.mSend.connect(N.conv);
    N.sSend = G(0.12); N.sfx.connect(N.sSend); N.sSend.connect(N.conv);
    N.uSend = G(0.25); N.uiVol.connect(N.uSend); N.uSend.connect(N.conv);

    // тоннель: эхо 90 мс, feedback 0.25 на sfx
    N.echo = ac.createDelay(0.5); N.echo.delayTime.value = 0.09;
    N.echoFb = G(0.25); N.echoWet = G(0);
    N.sfx.connect(N.echo); N.echo.connect(N.echoFb); N.echoFb.connect(N.echo); N.echo.connect(N.echoWet); N.echoWet.connect(N.fade);

    // музыкальные слои
    const pan = (v, dest) => { if (!ac.createStereoPanner) return dest; const p = ac.createStereoPanner(); p.pan.value = v; p.connect(dest); return p; };
    N.L = [G(1), G(0), G(0), G(0), G(0)];     // L0 pad+pluck · L1 kick+hat · L2 bass+snare · L3 lead+бубенцы · D
    for (let k = 0; k < 5; k++) N.L[k].connect(N.musicIn);
    N.padSide = G(1); N.padLP = ac.createBiquadFilter(); N.padLP.type = "lowpass"; N.padLP.frequency.value = 1400; N.padLP.Q.value = 0.6;
    N.padMerge = ac.createChannelMerger(2); N.padMerge.connect(N.padLP); N.padLP.connect(N.padSide); N.padSide.connect(N.L[0]);
    N.pluckL = pan(-0.35, N.L[0]); N.pluckR = pan(0.35, N.L[0]);
    N.kick = N.L[1]; N.hat = pan(0.22, N.L[1]);
    N.bass = N.L[2]; N.snare = pan(-0.06, N.L[2]);
    N.lead = pan(0.12, N.L[3]); N.sleigh = pan(-0.3, N.L[3]);
    N.toms = pan(0.15, N.L[4]);
    N.fill = G(0.4); N.fill.connect(N.musicIn);

    // голосовые пулы: 24 SFX-голоса (14 sfx + 4 ui + 6 amb) + 4 голоса лестницы
    sfxPool = makePool(14, N.sfx); uiPool = makePool(4, N.ui); ambPool = makePool(6, N.amb); ladderPool = makePool(4, N.sfx);
    pools = [sfxPool, uiPool, ambPool, ladderPool];
    N.heart = G(1); N.heart.connect(N.sfx);

    // ветер: зацикленный розовый шум → lowpass → gain → amb
    N.windSrc = ac.createBufferSource(); N.windSrc.buffer = B.pinkLoop; N.windSrc.loop = true;
    N.windLP = ac.createBiquadFilter(); N.windLP.type = "lowpass"; N.windLP.frequency.value = 400; N.windLP.Q.value = 0.4;
    N.wind = G(0);
    N.windSrc.connect(N.windLP); N.windLP.connect(N.wind); N.wind.connect(N.amb);
    N.windSrc.start(now());

    const t = now();
    N.fade.gain.setValueAtTime(0, t); N.fade.gain.setTargetAtTime(S.muted ? 0 : 1, t, 0.1);
    built = true;
    applyVolumes();
    M.nextT = t + 0.06;
    genMotif();
    if (S.mode === "play") startRun(0);   // setMode("play") пришёл до unlock
  }

  // ---------- голоса SFX ----------
  const cool = Object.create(null);
  function cents(c){ return Math.pow(2, c / 1200); }
  // возвращает индекс слота (для отмены: джингл game over, шорох подката)
  function voice(P, buffer, t, gain, pan, rate, panTo, panDur){
    let k = -1, best = Infinity;
    for (let i = 0; i < P.n; i++){
      if (P.end[i] <= t){ k = i; break; }
      const score = P.lvl[i] * (P.end[i] - t);
      if (score < best){ best = score; k = i; }
    }
    let t0 = t;
    const g = P.g[k].gain, old = P.src[k];
    if (old && P.end[k] > t){          // крадём самый тихий/старый голос: быстрый фейд, без щелчка
      hold(g, t); g.setTargetAtTime(0, t, 0.003);
      try { old.stop(t + 0.02); } catch (e){}
      t0 = t + 0.02; debug.dropped++;
    } else g.cancelScheduledValues(t);
    g.setValueAtTime(gain, t0);
    const p = P.p[k];
    if (p){
      p.pan.cancelScheduledValues(t);
      p.pan.setValueAtTime(clamp(pan, -1, 1), t0);
      if (panDur) p.pan.linearRampToValueAtTime(clamp(panTo, -1, 1), t0 + panDur);
    }
    const src = ac.createBufferSource();
    src.buffer = buffer; if (rate !== 1) src.playbackRate.value = rate;
    src.connect(P.g[k]);
    const dur = buffer.duration / rate;
    src.start(t0); src.stop(t0 + dur + 0.01);
    P.src[k] = src; P.end[k] = t0 + dur; P.lvl[k] = gain;
    return k;
  }
  // мягко заглушить конкретный голос, если он всё ещё тот самый (слот могли украсть)
  function cutVoice(P, k, src, t, tau = 0.02){
    if (k < 0 || !src || P.src[k] !== src || P.end[k] <= t) return;
    const g = P.g[k].gain; hold(g, t); g.setTargetAtTime(0, t, tau);
    try { src.stop(t + tau * 6); } catch (e){}
    P.end[k] = t + tau * 6; P.lvl[k] = 0;
  }
  const vary = (dB = 1.5) => Math.pow(10, (rng() * 2 - 1) * dB / 20);
  const varyRate = (c = 40) => cents((rng() * 2 - 1) * c);
  // хаптика: только если есть API (на iOS Safari нет) и страница уже получала жест — иначе Chrome ругается в консоль
  function vibrate(pat){
    if (!S.haptics || externalCtx || typeof navigator === "undefined" || !navigator.vibrate) return;
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
    try { navigator.vibrate(pat); } catch (e){}
  }

  // ---------- музыка ----------
  const M = { nextT: 0, s16: 0, bar: 0, loopBar: 0, bpm: 96, style: "title", halted: false, resumeAt: 0, tape: false,
    on: [1, 0, 0, 0], pend: [1, 0, 0, 0], tail: [0, 0, 0, 0], boostLvl: 0, minor: false, padIdx: -1,
    fillReq: false, fillActive: false, motif: new Int8Array(64), motifRep: 0, restart: false,
    gridAt: 0, gridStyle: "title",      // отложенный перезапуск сетки (первая сильная доля забега / возврат в титул)
    aT: new Float64Array(4), aBar: new Float64Array(4), aBpm: new Float64Array(4), aHead: 0, lastBarSeen: -1 };
  M.aT.fill(-1);

  function genMotif(){
    const m = M.motif; let idx = 5;
    const A0 = RHYTHMS[(rng() * 6) | 0], A1 = RHYTHMS[(rng() * 6) | 0];
    for (let bar = 0; bar < 8; bar++){
      const r = bar < 2 || (bar >= 4 && bar < 6) ? (bar % 2 ? A1 : A0) : RHYTHMS[(rng() * 6) | 0];
      const tones = CHORD_TONES[(bar >> 1) % 4];
      for (let e = 0; e < 8; e++){
        const j = bar * 8 + e;
        if (!r[e]){ m[j] = -1; continue; }
        idx = clamp(idx + MOVES[(rng() * 7) | 0], 0, 8);
        if (e === 0 || e === 4){   // сильные доли — в аккорд
          let bi = tones[0], bd = 99;
          for (let q = 0; q < tones.length; q++){ const d = Math.abs(tones[q] - idx); if (d < bd){ bd = d; bi = tones[q]; } }
          idx = bi;
        }
        m[j] = idx;
      }
    }
    m[63] = -1; m[60] = 5;   // фраза закрывается на D6
  }

  // hi = «скелет» (бочка/малый/бас/мелодия): может занять резерв; остальное пропускается первым
  function mNote(buffer, t, dest, rate, hi){
    let k = -1, free = 0;
    for (let i = 0; i < MUSIC_SLOTS; i++) if (mEnd[i] <= t){ if (k < 0) k = i; free++; }
    if (k < 0 || (!hi && free <= HI_RESERVE)){ debug.dropped++; if (hi) debug.droppedHi++; return; }
    const src = ac.createBufferSource(); src.buffer = buffer;
    if (rate !== 1) src.playbackRate.value = rate;
    src.connect(dest); const dur = buffer.duration / rate;
    src.start(t); src.stop(t + dur + 0.01);
    mSrc[k] = src; mEnd[k] = t + dur;
  }

  function padTrigger(t, notes){
    // старый аккорд уходит в release 1.2 с
    if (padGain[1]){ const o1 = padOsc[1]; for (let i = 0; i < o1.length; i++) try { o1[i].stop(t + 0.05); } catch (e){} }
    padOsc[1] = padOsc[0]; padGain[1] = padGain[0];
    if (padGain[1]){
      for (let i = 0; i < 2; i++){ const g = padGain[1][i].gain; hold(g, t); g.setTargetAtTime(0, t, 0.4); }
      const o1 = padOsc[1]; for (let i = 0; i < o1.length; i++) try { o1[i].stop(t + 1.6); } catch (e){}
    }
    const gl = G(0), gr = G(0); gl.connect(N.padMerge, 0, 0); gr.connect(N.padMerge, 0, 1);
    const oscs = [];
    for (let n = 0; n < notes.length; n++){
      const f = 440 * Math.pow(2, (notes[n] - 69) / 12);
      for (let side = 0; side < 2; side++){
        const o = ac.createOscillator(); o.type = "sawtooth"; o.frequency.value = f; o.detune.value = side ? 7 : -7;
        o.connect(side ? gr : gl); o.start(t); oscs.push(o);
      }
    }
    gl.gain.setValueAtTime(0, t); gl.gain.setTargetAtTime(0.08, t, 0.2);   // атака 0.6 с ≈ 3τ; 0.08 на сторону
    gr.gain.setValueAtTime(0, t); gr.gain.setTargetAtTime(0.08, t, 0.2);
    padOsc[0] = oscs; padGain[0] = [gl, gr];
  }
  function padRelease(t){
    for (let k = 0; k < 2; k++){
      if (!padGain[k]) continue;
      for (let i = 0; i < 2; i++){ const g = padGain[k][i].gain; hold(g, t); g.setTargetAtTime(0, t, 0.4); }
      const o = padOsc[k]; for (let i = 0; i < o.length; i++) try { o[i].stop(t + 1.8); } catch (e){}
    }
    padOsc[0] = padOsc[1] = null; padGain[0] = padGain[1] = null; M.padIdx = -1;
  }

  function droneOn(t){
    if (drone) return;
    const lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 320; lp.Q.value = 0.8;
    const g = G(0.55); lp.connect(g); g.connect(N.L[4]);
    const o1 = ac.createOscillator(), o2 = ac.createOscillator(), o3 = ac.createOscillator();
    o1.type = o2.type = "sawtooth"; o1.frequency.value = 73.42; o2.frequency.value = 73.42; o2.detune.value = 9;
    o3.type = "sine"; o3.frequency.value = 36.71;
    o1.connect(lp); o2.connect(lp); o3.connect(g);
    o1.start(t); o2.start(t); o3.start(t);
    drone = { o: [o1, o2, o3], g, lp, idle: 0 };
  }
  function droneOff(t){ if (!drone) return; for (let i = 0; i < 3; i++) try { drone.o[i].stop(t + 0.05); } catch (e){} drone = null; }

  // уровень плотности: 1 = L1, 2 = +L2, 3 = +L3; рубеж поднимает его на ступень раньше дистанции/скорости
  function baseLvl(){ return 1 + (S.dist >= 150 || S.I > 0.15 ? 1 : 0) + (S.dist >= 500 || S.I > 0.5 ? 1 : 0); }
  // слой решается на 4-й доле (pend), наплывает к сильной доле, фиксируется на тактовой черте (on);
  // выключенный слой доигрывает ещё такт (tail), пока гейн уходит с tau 0.4
  function pendLayers(){
    const lvl = M.style === "run" && !M.halted ? Math.max(baseLvl(), M.boostLvl) : 0;
    M.pend[1] = lvl >= 1 ? 1 : 0; M.pend[2] = lvl >= 2 ? 1 : 0; M.pend[3] = lvl >= 3 ? 1 : 0;
  }
  const layerLive = k => M.on[k] || M.tail[k] > 0;

  function onBar(t){
    // якорь такта для clock (кольцевой буфер из 4)
    M.aHead = (M.aHead + 1) & 3; M.aT[M.aHead] = t; M.aBar[M.aHead] = M.bar; M.aBpm[M.aHead] = M.bpm;
    if (M.halted && !M.tape && t >= M.resumeAt) resumeMusic(t);
    // минор переключается только на тактовой черте (гистерезис)
    const wantMinor = M.minor ? S.danger > 0.25 : S.danger > 0.45;
    const minorChanged = wantMinor !== M.minor; M.minor = wantMinor; debug.minor = wantMinor;
    if (M.restart){
      pendLayers();
      for (let k = 1; k < 4; k++){
        const g = N.L[k].gain; hold(g, t);
        if (k === 1 && M.pend[1]) g.setValueAtTime(1, t);   // старт забега: бочка сразу на сильной доле
        else if (M.pend[k]) g.setTargetAtTime(1, t, 0.3);
        else g.setTargetAtTime(0, t, 0.3);
      }
    }
    for (let k = 1; k < 4; k++){
      if (M.tail[k] > 0) M.tail[k]--;
      if (M.pend[k] !== M.on[k] || M.restart){
        if (!M.pend[k] && M.on[k]){ const g = N.L[k].gain; hold(g, t); g.setTargetAtTime(0, t, 0.4); M.tail[k] = 1; }
        M.on[k] = M.pend[k];
      }
      debug.layers[k] = M.on[k];
    }
    M.restart = false;
    // пэд: новый аккорд каждые 2 такта или при смене лада
    const ci = (M.loopBar >> 1) % 4;
    if (!M.halted && (ci !== M.padIdx || minorChanged || !padGain[0])){
      const c = CHORDS[ci]; padTrigger(t, M.minor ? c.padM : c.pad); M.padIdx = ci;
    }
    if (M.loopBar === 0 && M.bar > 0){ if (++M.motifRep >= 2){ M.motifRep = 0; genMotif(); } }
  }

  function step16(t, s){
    if (M.halted) return;
    const run = M.style === "run";
    const c = CHORDS[(M.loopBar >> 1) % 4];
    const arp = M.minor ? c.arpM : c.arp;
    // L0 pluck: 16-е вверх-вниз (титул — 8-е)
    if (run || (s & 1) === 0) mNote(B.pluck[arp[ARP[(run ? s : s >> 1) % 8]]], t, (s & 2) ? N.pluckR : N.pluckL, 1, false);
    // 4-я доля: решаем слои следующего такта и начинаем наплыв входящих
    if (s === 12){
      pendLayers();
      for (let k = 1; k < 4; k++) if (M.pend[k] && !M.on[k]){ const g = N.L[k].gain; hold(g, t); g.setTargetAtTime(1, t, 0.3); }
    }
    const kickNow = run && (s & 3) === 0;
    if (layerLive(1)){
      if (kickNow){
        mNote(B.kick, t, N.kick, 1, true);
        const p = N.padSide.gain; p.setTargetAtTime(0.55, t, 0.008); p.setTargetAtTime(1, t + 0.04, 0.12);   // сайдчейн пэда
      }
      mNote(B.hat[HAT_VEL[s & 3]], t, N.hat, 1, false);
    }
    if (layerLive(2)){
      if ((s === 4 || s === 12) && !(M.fillActive && s === 12)) mNote(B.snare, t, N.snare, 1, true);
      if ((s & 1) === 0) mNote(B.bass[(s & 3) === 2 ? c.root + 12 : c.root], t, N.bass, 1, true);
    }
    if (layerLive(3)){
      if ((s & 1) === 0){
        const idx = M.motif[M.loopBar * 8 + (s >> 1)];
        if (idx >= 0) mNote(B.lead[(M.minor ? PENT_M : PENT)[idx]], t, N.lead, 1, true);
        mNote(B.sleigh[(s & 3) === 2 ? 0 : 1], t, N.sleigh, 1, false);
      }
    }
    if (run && S.danger > 0.02 && s >= 12) mNote(B.tom[TOMS[s - 12]], t, N.toms, 1, false);
    // сбивка рубежа: 2-я половина такта — дробь малого + шумовой подъём; на следующей сильной — фанфара и +1 слой
    if (run && s === 8 && M.fillReq){
      M.fillReq = false; M.fillActive = true;
      M.boostLvl = Math.min(3, Math.max(baseLvl(), M.boostLvl) + 1); debug.boostLvl = M.boostLvl;
      mNote(B.riser, t, N.fill, M.bpm / 110, true);
    }
    if (M.fillActive && s >= 8){
      N.fill.gain.setValueAtTime(0.35 + 0.65 * (s - 8) / 7, t);
      mNote(B.snare, t, N.fill, 1 + (s - 8) * 0.012, true);
    }
  }

  // перезапуск сетки ровно в M.gridAt: такт с нуля, D-аккорд, забег — бочка на сильной доле
  function beginGrid(){
    const style = M.gridStyle;
    if (M.s16 !== 0) M.bar++;            // прерванный такт считается закрытым → clock.downbeat сработает
    M.s16 = 0; M.loopBar = 0; M.style = style; M.restart = true; M.fillReq = M.fillActive = false;
    if (style === "run"){ M.bpm = 110 + 18 * S.I; M.boostLvl = 0; debug.boostLvl = 0; }
    for (let k = 1; k < 4; k++) M.on[k] = M.pend[k] = M.tail[k] = 0;
    M.padIdx = -1; M.gridAt = 0;
  }
  function schedule(until){
    if (!built) return;
    const t0 = now();
    if (M.nextT < t0 - 0.2){ M.nextT = t0 + 0.02; }   // вкладка спала — не догоняем пропущенные ноты
    if (M.gridAt > 0 && M.gridAt < t0) M.gridAt = t0 + 0.01;
    while (M.nextT < until){
      if (M.gridAt > 0 && M.nextT >= M.gridAt - 1e-6){ M.nextT = M.gridAt; beginGrid(); }
      const t = M.nextT, s = M.s16;
      if (s === 0){
        if (M.fillActive){   // сильная доля после сбивки
          M.fillActive = false;
          voice(sfxPool, B.fanfare, t, 1, 0, 1);
        }
        const tgt = M.style === "run" ? 110 + 18 * S.I : 96;
        if (M.bpm !== tgt) M.bpm = M.restart ? tgt : clamp(tgt, M.bpm - 4, M.bpm + 4);
        onBar(t);
      }
      step16(t, s);
      const nx = M.nextT + 15 / M.bpm;   // 16-я = 60/bpm/4
      M.nextT = M.gridAt > 0 && nx > M.gridAt ? M.gridAt : nx;
      if (++M.s16 === 16){ M.s16 = 0; M.bar++; M.loopBar = (M.loopBar + 1) & 7; }
    }
  }

  // время перезапуска: lead ≤ 0 → ближайшая четверть; иначе 8-я текущей сетки, ближайшая к now+lead (промах ≤ ±0.16 с)
  function pickGridAt(lead){
    const t = now(), q16 = 15 / M.bpm;
    if (lead <= 0){
      let tt = M.nextT + ((4 - (M.s16 % 4)) % 4) * q16;
      if (tt < t + 0.03) tt += 4 * q16;
      return tt;
    }
    let tt = M.nextT + (M.s16 & 1) * q16;
    const target = t + lead;
    if (target > tt) tt += Math.round((target - tt) / (2 * q16)) * 2 * q16;
    return tt;
  }

  let introUntil = 0;
  // старт забега: сетка переходит в run на выбранной доле, фильтр 2500→16000 за последние 0.4 с до неё
  function startRun(lead){
    S.mode = "play";
    lead = +lead > 0 ? Math.min(+lead, 4) : 0;
    if (!built) return lead;
    const t = now();
    M.tape = false; M.halted = false; M.resumeAt = 0;
    cutVoice(sfxPool, goSlot, goSrc, t); goSrc = null;
    const g = N.musicMode.gain; hold(g, t); g.setTargetAtTime(1, t, 0.05); modeGainCur = 1;
    ladderStep = -1; genMotif(); M.motifRep = 0; M.fillReq = M.fillActive = false;
    const at = pickGridAt(lead);
    M.gridAt = at; M.gridStyle = "run"; introUntil = at;
    const f = N.musicLP.frequency, openAt = at - 0.4;
    hold(f, t);
    if (openAt - t > 0.1){ f.setTargetAtTime(2500, t, 0.06); f.setValueAtTime(2500, openAt); }
    f.exponentialRampToValueAtTime(16000, Math.max(at, t + 0.05));
    lpCur = 16000;
    return at - t;
  }

  function tapeStop(t){
    M.halted = true; M.tape = true; M.resumeAt = t + 2.0; M.gridAt = 0; introUntil = 0;
    for (let i = 0; i < MUSIC_SLOTS; i++){
      const s = mSrc[i]; if (!s || mEnd[i] <= t) continue;
      if (s.detune){ hold(s.detune, t); s.detune.linearRampToValueAtTime(-1200, t + 0.7); }
      else { hold(s.playbackRate, t); s.playbackRate.linearRampToValueAtTime(0.5, t + 0.7); }
    }
    for (let k = 0; k < 2; k++) if (padOsc[k]){ const o = padOsc[k]; for (let i = 0; i < o.length; i++){ hold(o[i].detune, t); o[i].detune.linearRampToValueAtTime(o[i].detune.value - 1200, t + 0.7); } }
    if (drone) for (let i = 0; i < 3; i++){ hold(drone.o[i].detune, t); drone.o[i].detune.linearRampToValueAtTime(-1200, t + 0.7); }
    const f = N.musicLP.frequency; hold(f, t); f.exponentialRampToValueAtTime(250, t + 0.7);
    const g = N.musicMode.gain; hold(g, t); g.setTargetAtTime(0, t + 0.45, 0.08);
    padRelease(t + 0.7); droneOff(t + 1.0);
    for (let k = 1; k < 5; k++){ const lg = N.L[k].gain; hold(lg, t + 0.8); lg.setValueAtTime(0, t + 0.8); if (k < 4) M.on[k] = M.pend[k] = M.tail[k] = 0; }
    dCur = 0; M.fillReq = M.fillActive = false;
    tapeEndAt = t + 1.3;
  }
  let tapeEndAt = 0;
  function resumeMusic(t){
    M.halted = false; M.style = "title"; M.restart = true; M.padIdx = -1;
    const f = N.musicLP.frequency; hold(f, t); f.setValueAtTime(lpTarget(), t); lpCur = lpTarget();
    const g = N.musicMode.gain; hold(g, t); g.setValueAtTime(0, t); modeGainCur = modeGain(); g.setTargetAtTime(modeGainCur, t, 0.5);
  }

  // ---------- параметры по кадру ----------
  let lpCur = 2500, modeGainCur = 1, windG = -1, windF = -1, echoCur = 0, dCur = -1;
  let nextHeart = 0, nextChirp = 0, coinsPending = 0, coinLane = 1, ladderStep = -1, lastCoinT = -9, lastLadderT = -9, lastTick = -9;
  let swD = -1, swPrevD = -1, swIdle = 0, lastHitT = -9;
  let goSlot = -1, goSrc = null, slideSlot = -1, slideSrc = null;
  let vBeat = 0, vBar = -1;   // запасные часы 120 BPM (фолбэк LOOK-6 «2.0 Гц»), пока звук не разблокирован
  // −6 дБ только поверх экранов game over / паузы; титул без барабанов и так на ~8 дБ тише забега
  function modeGain(){ return S.paused || S.mode === "over" ? 0.5 : 1; }
  function lpTarget(){
    let f = S.paused || S.mode === "over" ? 1200 : S.mode === "title" ? 2500 : 16000;
    if (S.mode === "play" && S.swarmNear > 0){ const k = 1 - clamp(S.swarmNear / 5.5, 0, 1); f = Math.min(f, 650 + 15350 * k * k); }
    return f;
  }
  // фильтр и уровень музыки к цели режима; зовётся из update и сразу из setPaused/setMode (кадры могут стоять)
  function mix(t){
    if (M.tape) return;
    if (t >= introUntil){
      const lt = lpTarget();
      if (Math.abs(lt - lpCur) > lpCur * 0.02){
        const f = N.musicLP.frequency; hold(f, t); f.setTargetAtTime(lt, t, lt < lpCur ? 0.03 : 0.12); lpCur = lt;
      }
    }
    const mg = modeGain();
    if (mg !== modeGainCur && !M.halted){ const g = N.musicMode.gain; hold(g, t); g.setTargetAtTime(mg, t, 0.2); modeGainCur = mg; }
  }
  function applyVolumes(){
    if (!built) return;
    const t = now();
    N.master.gain.setTargetAtTime(BUS_DEFAULTS.master * vol.master, t, 0.03);
    N.musicVol.gain.setTargetAtTime(BUS_DEFAULTS.music * vol.music, t, 0.03);
    N.sfx.gain.setTargetAtTime(BUS_DEFAULTS.sfx * vol.sfx, t, 0.03);
    N.uiVol.gain.setTargetAtTime(BUS_DEFAULTS.ui * vol.ui, t, 0.03);
    N.ambVol.gain.setTargetAtTime(BUS_DEFAULTS.amb * vol.amb, t, 0.03);
  }

  function swarmBuild(t){
    const o = [], lfo = [];
    const mix = G(1), lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 350; lp.Q.value = 1.2;
    const am = G(0.825), amL = ac.createOscillator(), amD = G(0.175);
    amL.frequency.value = 26; amL.connect(amD); amD.connect(am.gain);
    const g = G(0), p = ac.createStereoPanner ? ac.createStereoPanner() : null;
    [[118, 0.3, 0.41], [121.5, 0.3, 0.63], [176, 0.15, 0.33]].forEach(([f, lv, rate]) => {
      const osc = ac.createOscillator(); osc.type = "sawtooth"; osc.frequency.value = f;
      const og = G(lv); osc.connect(og); og.connect(mix);
      const l = ac.createOscillator(); l.frequency.value = rate; const lg = G(f * 0.0035); l.connect(lg); lg.connect(osc.frequency);   // ±6 центов
      osc.start(t); l.start(t); o.push(osc); lfo.push(l);
    });
    mix.connect(lp); lp.connect(am); am.connect(g);
    if (p){ g.connect(p); p.connect(N.amb); } else g.connect(N.amb);
    amL.start(t);
    swarm = { o, lfo, amL, lp, g, p, gCur: 0, fCur: 350, pCur: 0, dop: 0 };
  }
  function swarmKill(t){
    if (!swarm) return;
    for (let i = 0; i < 3; i++){ try { swarm.o[i].stop(t + 0.1); } catch (e){} try { swarm.lfo[i].stop(t + 0.1); } catch (e){} }
    try { swarm.amL.stop(t + 0.1); } catch (e){}
    swarm = null;
  }

  function virtualClock(dt){
    vBeat += dt * 2;
    const bar = Math.floor(vBeat / 4), inBar = vBeat - bar * 4;
    clock.bpm = 120; clock.beat = vBeat; clock.beatPhase = vBeat - Math.floor(vBeat); clock.bar = bar; clock.barPhase = inBar / 4;
    clock.downbeat = bar !== vBar; vBar = bar; clock.nextDownbeat = -1; clock.toDownbeat = (4 - inBar) / 2; clock.running = false;
  }

  function update(realDt){
    if (disposed) return;
    const dt = realDt > 0 ? Math.min(realDt, 0.1) : 1 / 60;
    if (!built || (!externalCtx && ac.state !== "running")){ virtualClock(dt); if (built) debug.state = ac.state; return; }
    const t = now();
    schedule(t + 0.12);

    // монеты кадра → один голос лестницы
    if (coinsPending){
      if (t - lastCoinT > 0.45) ladderStep = -1;
      ladderStep = Math.min(10, ladderStep + 1);
      const t0 = Math.max(t, lastLadderT + 0.022);
      voice(ladderPool, (M.minor ? B.ladderMin : B.ladder)[ladderStep], t0, 1, (coinLane - 1) * 0.25, cents((rng() * 2 - 1) * 8));
      lastCoinT = t; lastLadderT = t0; coinsPending = 0;
    }

    const playing = S.mode === "play" && !S.paused && !M.tape;
    // lowpass и уровень музыки (титул / game over / пауза / спотыкание); во время пролёта CAM-4 фильтр ведёт startRun
    if (!M.tape) mix(t);
    else if (t >= tapeEndAt){ M.tape = false; modeGainCur = -1; lpCur = -1; }

    // D-слой 0.25·danger
    const dT = playing ? 0.25 * S.danger : 0;
    if (Math.abs(dT - dCur) > 0.005){
      if (dT > 0.005) droneOn(t);
      const g = N.L[4].gain; hold(g, t); g.setTargetAtTime(dT, t, 0.3); dCur = dT; debug.layers[4] = dT;
    }
    if (drone){ drone.idle = dT < 0.005 ? drone.idle + dt : 0; if (drone.idle > 2) droneOff(t); }

    // ветер: lowpass 400+1700·I, gain (0.04+0.08·I)·(в воздухе 0.6), tau 0.3; тоннель — LP ×0.5
    const wg = playing ? (0.04 + 0.08 * S.I) * (S.air ? 0.6 : 1) : 0;
    const wf = (400 + 1700 * S.I) * (S.tunnel ? 0.5 : 1);
    if (Math.abs(wg - windG) > 0.002){ N.wind.gain.setTargetAtTime(wg, t, 0.3); windG = wg; }
    if (Math.abs(wf - windF) > windF * 0.02){ N.windLP.frequency.setTargetAtTime(wf, t, 0.3); windF = wf; }
    const ew = S.tunnel && quality !== "low" ? 0.5 : 0;
    if (ew !== echoCur){ N.echoWet.gain.setTargetAtTime(ew, t, 0.08); echoCur = ew; }

    // сердце: период 700 мс, gain 0.14·danger
    if (playing && S.danger > 0.03){
      if (nextHeart < t) nextHeart = t + 0.02;
      while (nextHeart < t + 0.1){
        const src = ac.createBufferSource(); src.buffer = B.heart;
        const g = G(S.danger); src.connect(g); g.connect(N.heart);
        src.start(nextHeart); src.stop(nextHeart + B.heart.duration + 0.01);
        nextHeart += 0.7;
      }
    }

    // рой
    const active = swD >= 0 && playing;
    const prox = active ? 1 - clamp((swD - 3.5) / 8.5, 0, 1) : 0;
    if (active && !swarm) swarmBuild(t);
    if (swarm){
      const gT = active ? 0.02 + 0.16 * prox * prox : 0;
      const fT = 350 + 3200 * prox;
      const pT = clamp(S.swarmX / 6, -0.6, 0.6);
      const vel = swPrevD >= 0 && swD >= 0 ? (swD - swPrevD) / dt : 0;
      const dopT = vel < -0.3 ? 30 : vel > 0.3 ? -20 : 0;
      if (Math.abs(gT - swarm.gCur) > 0.002){ swarm.g.gain.setTargetAtTime(gT, t, 0.03); swarm.gCur = gT; }
      if (Math.abs(fT - swarm.fCur) > swarm.fCur * 0.02){ swarm.lp.frequency.setTargetAtTime(fT, t, 0.03); swarm.fCur = fT; }
      if (swarm.p && Math.abs(pT - swarm.pCur) > 0.01){ swarm.p.pan.setTargetAtTime(pT, t, 0.03); swarm.pCur = pT; }
      if (dopT !== swarm.dop){ for (let i = 0; i < 3; i++) swarm.o[i].detune.setTargetAtTime(dopT, t, 0.15); swarm.dop = dopT; }
      swIdle = gT === 0 ? swIdle + dt : 0;
      if (swIdle > 1.5){ swarmKill(t); swIdle = 0; }
      if (swarm && prox > 0.5 && t >= nextChirp){
        voice(ambPool, B.chirp, t, vary(2), rng() * 1.2 - 0.6, varyRate(80));
        nextChirp = t + 0.6 + rng() * 0.8;
      }
    }
    swPrevD = swD;

    // часы для камеры/виньетки: без аллокаций
    let a = -1, at = -1, fut = Infinity;
    for (let i = 0; i < 4; i++){
      const x = M.aT[i];
      if (x < 0) continue;
      if (x <= t){ if (x > at){ at = x; a = i; } }
      else if (x < fut) fut = x;
    }
    if (a >= 0){
      const bpm = M.aBpm[a], beats = Math.min(3.9999, (t - at) * bpm / 60);
      clock.bpm = bpm; clock.bar = M.aBar[a]; clock.beat = clock.bar * 4 + beats;
      clock.beatPhase = beats - Math.floor(beats); clock.barPhase = beats / 4;
      clock.downbeat = M.lastBarSeen !== clock.bar; M.lastBarSeen = clock.bar;
    }
    // ближайшая черта: ждём перезапуск сетки (первая доля забега для CAM-4) → уже поставленный такт → прогноз по темпу
    let nd = M.gridAt > 0 ? M.gridAt : fut;
    if (nd === Infinity) nd = M.s16 === 0 ? M.nextT : M.nextT + (16 - M.s16) * 15 / M.bpm;
    clock.nextDownbeat = nd; clock.toDownbeat = nd - t; clock.running = true;

    let v = 0; for (let i = 0; i < MUSIC_SLOTS; i++) if (mEnd[i] > t) v++;
    debug.musicVoices = v + (padGain[0] ? 3 : 0) + (drone ? 1 : 0);
    let sv = 0; for (let j = 0; j < pools.length; j++){ const P = pools[j]; for (let i = 0; i < P.n; i++) if (P.end[i] > t) sv++; }
    debug.voices = sv; debug.bpm = M.bpm; debug.state = ac.state || "offline";
  }

  // ---------- play ----------
  function play(name, o){
    if (!built || disposed) return false;
    const tn = now();
    if (name !== "energon" && name !== "tick"){
      if (cool[name] !== undefined && tn - cool[name] < 0.03) return false;   // cooldown одного id 30 мс
      cool[name] = tn;
    }
    const t = o && o.delay > 0 ? tn + Math.min(+o.delay, 4) : tn;
    const pan = o && o.pan !== undefined ? o.pan : 0;
    switch (name){
      case "energon": coinsPending++; coinLane = o && o.lane !== undefined ? o.lane : 1; return true;
      case "arc": voice(sfxPool, M.minor ? B.arcMin : B.arc, Math.max(t, lastLadderT + 0.045), 1, 0, 1); return true;
      case "lane": {
        const d = o && o.dir ? o.dir : 1;
        voice(sfxPool, B.whoosh, t, vary(), -0.5 * d, varyRate(), 0.5 * d, 0.14); vibrate(8); return true;
      }
      case "nearmiss": {
        const d = o && o.dir ? o.dir : (pan >= 0 ? 1 : -1);
        voice(sfxPool, B.nearmiss, t, vary() * 1.6, -0.6 * d, varyRate(20), 0.6 * d, 0.14); return true;
      }
      case "jump":
        cutVoice(sfxPool, slideSlot, slideSrc, t, 0.03); slideSrc = null;   // UP в подкате — шорох обрывается
        voice(sfxPool, B.jump, t, vary(), pan, varyRate()); return true;
      case "dive": voice(sfxPool, B.dive, t, vary(), pan, varyRate(25)); return true;
      case "land": {
        const imp = o && o.impact !== undefined ? o.impact : 8;
        voice(sfxPool, B.land, t, (0.4 + 0.6 * clamp((imp - 2) / 12, 0, 1)) * vary(), pan, varyRate());
        if (imp > 10) vibrate(15);
        return true;
      }
      case "slide": {
        const dur = o && o.dur ? o.dur : 0.62;
        slideSlot = voice(sfxPool, B.slide, t, vary(), pan, clamp(0.62 / dur, 0.8, 1.4)); slideSrc = sfxPool.src[slideSlot];
        return true;
      }
      case "edge": voice(sfxPool, B.edge, t, vary(), (o && o.dir ? o.dir : 0) * 0.5, varyRate()); return true;
      case "hit": hitSting(t, false); return true;
      case "gameover": hitSting(t, true); return true;
      case "milestone": if (S.mode === "play") M.fillReq = true; else voice(uiPool, B.fanfare, t, 1, 0, 1); vibrate([20, 40, 20]); return true;
      case "record": voice(uiPool, B.record, t, 1, 0, 1); return true;
      case "mission": voice(uiPool, B.mission, t, 1, 0, 1); return true;
      case "tier": voice(uiPool, B.tier[clamp((o && o.tier ? o.tier : 1) - 1, 0, 3)], t, 1, 0, 1); return true;
      case "tick": {
        if (tn - lastTick < 0.045) return false; lastTick = tn;
        voice(uiPool, B.tick[clamp(o && o.i !== undefined ? o.i | 0 : 0, 0, 10)], t, 1, 0, 1); return true;
      }
      case "count": voice(uiPool, B.count[clamp(o && o.n !== undefined ? o.n | 0 : 0, 0, 3)], t, 1, 0, 1); return true;
      case "start": voice(uiPool, B.start, t, 1, 0, 1); return true;
      case "uiHover": voice(uiPool, B.uiHover, t, vary(1), 0, varyRate(30)); return true;
      case "uiClick": voice(uiPool, B.uiClick, t, vary(1), 0, varyRate(30)); return true;
      case "relief": voice(sfxPool, B.relief, t, 1, 0, 1); return true;
      case "chirp": voice(ambPool, B.chirp, t, 1, pan, varyRate(80)); return true;
    }
    return false;
  }

  function duck(t){
    for (let i = 0; i < 3; i++){ const g = N.ducks[i]; hold(g, t); g.setTargetAtTime(0.4, t, 0.05); g.setTargetAtTime(1, t + 0.25, 0.25); }
  }
  function hitSting(t, over){
    // main шлёт hit и сразу gameover в одном кадре — второй «бум» и второе приглушение не нужны
    const dup = over && t - lastHitT < 0.12;
    if (!dup){
      voice(sfxPool, B.boom, t, 1, 0, varyRate(15));
      voice(sfxPool, B.bonk, t, vary(1), 0, varyRate(25));
      duck(t);
    }
    cutVoice(sfxPool, slideSlot, slideSrc, t, 0.04); slideSrc = null;
    if (!over){
      lastHitT = t;
      const s = ac.createBufferSource(); s.buffer = B.diss; s.connect(N.sting); s.start(t); s.stop(t + B.diss.duration + 0.01);
      if (t >= introUntil){ const f = N.musicLP.frequency; hold(f, t); f.setTargetAtTime(650, t, 0.03); lpCur = 650; }
      vibrate([30, 40, 60]);
    } else {
      S.mode = "over"; tapeStop(t);
      goSlot = voice(sfxPool, B.goJingle, t + 0.8, 1, 0, 1); goSrc = sfxPool.src[goSlot];
      coinsPending = 0; ladderStep = -1;
      vibrate([60, 60, 120]);
    }
  }

  // ---------- жизненный цикл ----------
  const quietly = p => { if (p && p.catch) p.catch(() => {}); };
  function onVisibility(){
    if (!ac || externalCtx || disposed) return;
    if (document.hidden){ try { quietly(ac.suspend()); } catch (e){} }
    else resumeWithFade();
  }
  function onPageHide(){ if (ac && !externalCtx && !disposed) try { quietly(ac.suspend()); } catch (e){} }
  function resumeWithFade(){
    if (!ac || disposed || !built) return Promise.resolve();
    const p = ac.state !== "running" && ac.resume ? ac.resume() : Promise.resolve();
    return p.then(() => {
      if (disposed) return;
      const t = ac.currentTime, g = N.fade.gain;
      hold(g, t); g.setValueAtTime(0, t); g.setTargetAtTime(S.muted ? 0 : 1, t, 0.1);   // fade-in 300 мс ≈ 3τ
    }).catch(() => {});
  }

  function prepare(){
    if (externalCtx || disposed) return Promise.resolve(false);
    return prepareRaw(BANK_SR).then(() => true);
  }

  function unlock(){
    if (disposed) return Promise.resolve(false);
    if (built){
      if (!externalCtx && ac.state !== "running" && !(typeof document !== "undefined" && document.hidden)) return resumeWithFade().then(() => true);
      return Promise.resolve(true);
    }
    if (!ac){
      const AC = typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext);
      if (!AC) return Promise.resolve(false);
      // iOS 17+: «ambient» — уважать беззвучный режим и не рвать чужой подкаст; ставить ДО создания контекста
      try { if (navigator.audioSession) navigator.audioSession.type = "ambient"; } catch (e){}
      const tc = perfNow();
      try { ac = new AC({ latencyHint: "interactive" }); } catch (e){ try { ac = new AC(); } catch (e2){ return Promise.resolve(false); } }
      debug.ctxMs = +(perfNow() - tc).toFixed(1);
    }
    try { debug.session = typeof navigator !== "undefined" && navigator.audioSession ? navigator.audioSession.type : "n/a"; } catch (e){}
    const tb = perfNow();
    build();
    debug.buildMs = +(perfNow() - tb).toFixed(1);   // синхронная цена жеста без создания контекста
    if (externalCtx) return Promise.resolve(true);
    // iOS: тихий буфер внутри жеста «пробивает» разблокировку
    try { const s = ac.createBufferSource(); s.buffer = ac.createBuffer(1, 1, ac.sampleRate); s.connect(ac.destination); s.start(0); } catch (e){}
    timer = setInterval(() => { if (ac.state === "running") schedule(ac.currentTime + 0.12); }, 25);
    document.addEventListener("visibilitychange", onVisibility);
    addEventListener("pagehide", onPageHide);
    addEventListener("pageshow", onVisibility);
    return (ac.resume ? ac.resume() : Promise.resolve()).then(() => true, () => false);
  }

  function setMode(m, o){
    if (m === "play") return startRun(o && o.lead);
    if (m === S.mode) return 0;
    S.mode = m;
    if (!built) return 0;
    const t = now();
    if (m === "title"){
      if (M.halted){ M.tape = false; resumeMusic(t); }
      else if (M.style === "run" || M.gridAt > 0){ M.gridAt = pickGridAt(0); M.gridStyle = "title"; }
      introUntil = 0; lpCur = -1;
    } else if (m === "over"){
      // без play("gameover") (например, выход в меню): забег гаснет в титульную петлю на ближайшей доле
      if (!M.tape && !M.halted){ M.gridAt = pickGridAt(0); M.gridStyle = "title"; }
      introUntil = 0; lpCur = -1;
    }
    mix(t);
    return 0;
  }

  function dispose(){
    if (disposed) return; disposed = true;
    if (timer) clearInterval(timer);
    if (!externalCtx && typeof document !== "undefined"){
      document.removeEventListener("visibilitychange", onVisibility);
      removeEventListener("pagehide", onPageHide); removeEventListener("pageshow", onVisibility);
    }
    if (built){
      const t = now();
      try { N.fade.gain.setTargetAtTime(0, t, 0.03); } catch (e){}
      swarmKill(t); droneOff(t); padRelease(t);
      try { N.windSrc.stop(t + 0.15); } catch (e){}
    }
    if (ac && !externalCtx) setTimeout(() => { try { quietly(ac.close()); } catch (e){} }, 200);
  }

  return {
    clock, debug, get context(){ return ac; }, get nodes(){ return N; }, get bank(){ return B; },
    prepare, unlock, update, play, setMode, startRun, dispose,
    setIntensity(I){ S.I = clamp(+I || 0, 0, 1); },
    setDanger(d){ S.danger = clamp(+d || 0, 0, 1); },
    setDistance(m){ S.dist = +m || 0; },
    setSwarmNear(sec){ S.swarmNear = Math.max(0, +sec || 0); },
    setSwarm(distance, x){ swD = distance === null || distance === undefined || !(distance >= 0) ? -1 : +distance; S.swarmX = +x || 0; },
    setRunner(runPhase, grounded, sliding){
      S.air = !grounded; S.sliding = !!sliding;
      const sv = Math.sin(runPhase);
      if (built && grounded && !sliding && S.mode === "play" && !S.paused && (sv >= 0) !== (S.lastSin >= 0)){
        S.stepAlt = -S.stepAlt;
        const i = (rng() * 4) | 0;
        voice(sfxPool, B.step[i], now(), vary(1.5), 0.12 * S.stepAlt, 1 + (rng() * 2 - 1) * 0.08);
      }
      S.lastSin = sv;
    },
    setTunnel(b){ S.tunnel = !!b; },
    setVolume(bus, v){ if (bus in vol){ vol[bus] = clamp(+v || 0, 0, 1); applyVolumes(); } },
    getVolume(bus){ return vol[bus]; },
    setMuted(b){ S.muted = !!b; if (built){ const g = N.fade.gain, t = now(); hold(g, t); g.setTargetAtTime(S.muted ? 0 : 1, t, 0.05); } },
    setPaused(b){ S.paused = !!b; if (built && !disposed) mix(now()); },
    setHaptics(b){ S.haptics = !!b; },
    get state(){ return S; },
  };
}
