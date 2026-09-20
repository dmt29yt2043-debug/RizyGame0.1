// Стенд звукового кита: проверка «без ушей».
// Каждый тест — детерминированный сценарий в OfflineAudioContext через ПОЛНЫЙ граф кита (шины, компрессор, потолок).
// Итог в window.AUDIO_REPORT (checks — по пункту на требование библии/чек-листа); спектрограмма + огибающая на тест.
import { createAudio, SOUND_NAMES } from "../src/audio/index.js";
import { LADDER_HZ } from "../src/audio/patches.js";

const qp = new URLSearchParams(location.search);
const SR = 48000, FPS = 60, DT = 1 / FPS;
const only = qp.get("only") ? qp.get("only").split(",") : null;
const $ = id => document.getElementById(id);

// перехват start() у буферных источников: какие буферы и когда реально поставлены (бочки, «бумы», джингл)
let STARTS = null, START_CTX = null;
const origStart = AudioBufferSourceNode.prototype.start;
AudioBufferSourceNode.prototype.start = function(when, ...r){
  if (STARTS && this.context === START_CTX) STARTS.push({ buf: this.buffer, t: when || 0 });
  return origStart.call(this, when, ...r);
};

// ---------- сценарии ----------
// ev: [время, (a, t, st) => …, "метка"]; frame(a, t, st) — каждый кадр ДО update; check(a, st, res) → {pass, …}
const run = (a, I = 0, dist = 0) => { a.setIntensity(I); a.setDistance(dist); a.setMode("play"); };
const ladderOnsets = [];
const startsOf = (res, buf, from = -1) => res.starts.filter(s => s.buf === buf && s.t >= from).map(s => +s.t.toFixed(4));
const TESTS = [
  { name: "music_title", label: "титул: 96 BPM, pad + pluck 8-ми, LP 2500", dur: 8, setup: a => a.setMode("title") },
  { name: "music_I0", label: "забег I=0, 0 м: L0 + L1 (бочка, хэт)", dur: 8, setup: a => run(a, 0, 0) },
  { name: "music_I1", label: "забег I=1, 600 м: все слои, 128 BPM", dur: 8, setup: a => run(a, 1, 600) },
  { name: "music_danger", label: "danger=1: минор (Dm/Gm), дрон + томы, сердце", dur: 8, setup: a => { run(a, 0.6, 300); a.setDanger(1); } },
  { name: "harmony_minor", label: "гармония без барабанов: титульная петля при danger=1 → Dm/Gm, щипки в миноре", dur: 8,
    setup: a => { a.setMode("title"); a.setDanger(1); } },
  { name: "milestone", label: "рубеж на 1.0 с (200 м, I .3 → L2): сбивка → фанфара на сильной → открывается L3", dur: 7,
    setup: a => run(a, 0.3, 200),
    ev: [[0.95, (a, t, st) => { st.before = a.debug.layers.slice(0, 4); }], [1.0, a => a.play("milestone"), "рубеж"]],
    check: (a, st, res) => {
      const after = a.debug.layers.slice(0, 4), fan = startsOf(res, a.bank.fanfare);
      return { pass: st.before[3] === 0 && after[3] === 1 && fan.length === 1, before: st.before, after, fanfareAt: fan };
    } },
  { name: "start_lead", label: "титул → startRun(1.1): первая сильная доля забега там, куда прилетит камера CAM-4", dur: 6,
    setup: a => a.setMode("title"),
    ev: [[3.0, (a, t, st) => { st.t0 = t; st.lead = a.startRun(1.1); st.at = t + st.lead; }, "старт (пролёт 1.1 с)"]],
    frame: (a, t, st) => {
      if (st.t0 !== undefined && st.toDown === undefined && t > st.t0) st.toDown = a.clock.toDownbeat;   // clock посчитан в update() кадра старта
      if (st.at && st.clockDown === undefined && a.clock.bpm >= 110 && a.clock.downbeat) st.clockDown = t;
    },
    check: (a, st, res) => {
      const kicks = startsOf(res, a.bank.kick, st.t0);
      const firstKick = kicks.length ? kicks[0] : -1;
      return { pass: Math.abs(st.lead - 1.1) <= 0.16 && Math.abs(firstKick - st.at) < 0.002 && Math.abs(st.toDown - st.lead) < 0.03
          && st.clockDown !== undefined && st.clockDown - st.at <= 2.5 * DT && st.clockDown >= st.at,
        lead: +st.lead.toFixed(3), downbeatAt: +st.at.toFixed(3), firstKick, clockToDownbeatAfterStart: +(+st.toDown).toFixed(3),
        clockDownbeatFlagAt: st.clockDown !== undefined ? +st.clockDown.toFixed(3) : null };
    } },
  { name: "gameover", label: "удар-бум → tape-stop 0.7 с → маримба A4–F4–D4 → титульная петля", dur: 8,
    setup: a => run(a, 0.7, 600), ev: [[2.5, a => a.play("gameover"), "game over"]] },
  { name: "hit_gameover_frame", label: "hit и gameover в ОДНОМ кадре (так шлёт main): один «бум», одно приглушение", dur: 3.5,
    setup: a => run(a, 0.5, 300), ev: [[1.0, a => { a.play("hit"); a.play("gameover"); }, "hit+gameover"]],
    check: (a, st, res) => {
      const booms = startsOf(res, a.bank.boom).length, jingles = startsOf(res, a.bank.goJingle);
      return { pass: booms === 1 && jingles.length === 1 && Math.abs(jingles[0] - 1.8) < 0.03 && a.state.mode === "over", booms, jingleAt: jingles };
    } },
  { name: "restart_after_death", label: "game over → через 1.2 с «Ещё раз» startRun(0.6): джингл обрывается, забег с бочкой на доле", dur: 7,
    setup: a => run(a, 0.7, 600),
    ev: [[1.0, a => a.play("gameover"), "game over"], [2.2, (a, t, st) => { st.t0 = t; st.lead = a.startRun(0.6); st.at = t + st.lead; }, "ещё раз"]],
    check: (a, st, res) => {
      const kicks = startsOf(res, a.bank.kick, st.t0);
      const L = res.buf.getChannelData(0), from = Math.round(SR * 4.0);
      let s = 0; for (let i = from; i < L.length; i++) s += L[i] * L[i];
      const rmsTail = 20 * Math.log10(Math.sqrt(s / (L.length - from)) + 1e-9);
      return { pass: kicks.length > 4 && Math.abs(kicks[0] - st.at) < 0.002 && a.debug.layers[1] === 1 && a.state.mode === "play" && rmsTail > -30,
        lead: +st.lead.toFixed(3), firstKick: kicks[0], layers: a.debug.layers.slice(0, 4), rmsTailDb: +rmsTail.toFixed(1) };
    } },
  { name: "hit_duck", label: "3-слойный удар + приглушение музыки ×0.4 + LP 650 спотыкания", dur: 5,
    setup: a => run(a, 0.5, 300),
    frame: (a, t, st) => { a.setSwarmNear(st.sn = Math.max(0, (st.sn || 0) - DT)); },
    ev: [[2.0, (a, t, st) => { a.play("hit"); st.sn = 5.5; a.setSwarmNear(5.5); }, "удар"]] },
  { name: "dense_low", label: "q=low, I=1, danger=1, 2 рубежа: скелет (бочка/малый/бас/мелодия) не теряет ни одной ноты", dur: 8, q: "low",
    setup: a => { run(a, 1, 800); a.setDanger(1); },
    ev: [[1.0, a => a.play("milestone"), "рубеж"], [4.0, a => a.play("milestone"), "рубеж"]],
    check: a => ({ pass: a.debug.droppedHi === 0, droppedHi: a.debug.droppedHi, droppedTotal: a.debug.dropped }) },
  { name: "ladder", label: "лестница: 13 подборов по 0.25 с (11 ступеней + держим верх), пауза, сброс", dur: 5.4, musicOff: true,
    ev: [...Array.from({ length: 13 }, (_, k) => [0.2 + 0.25 * k, (a, t) => { a.play("energon", { lane: k % 3 }); ladderOnsets.push(t); }]),
         [4.45, (a, t) => { a.play("energon", { lane: 1 }); ladderOnsets.push(t); }, "сброс"],
         [4.70, (a, t) => { a.play("energon", { lane: 1 }); ladderOnsets.push(t); }]] },
  { name: "arc", label: "целая дуга на скорости 30 (57 мс) + флориш D6–F#6–A6–D7", dur: 1.8, musicOff: true,
    ev: [...Array.from({ length: 11 }, (_, k) => [0.1 + 0.057 * k, a => a.play("energon", { lane: 1 })]), [0.72, a => a.play("arc"), "дуга"]] },
  { name: "lane", label: "вжух полосы: влево (пан +0.5→−0.5), вправо", dur: 1.2, musicOff: true,
    setup: a => run(a), ev: [[0.1, a => a.play("lane", { dir: -1 }), "←"], [0.65, a => a.play("lane", { dir: 1 }), "→"]] },
  { name: "jump", label: "войлочный прыжок: sine 220→520 + ткань", dur: 0.6, musicOff: true, ev: [[0.08, a => a.play("jump"), "прыжок"]] },
  { name: "slide_jump_dive", label: "подкат → UP через 0.2 с (шорох обрывается) → dive из воздуха", dur: 1.6, musicOff: true,
    ev: [[0.08, a => a.play("slide", { dur: 0.62 }), "подкат"], [0.28, a => a.play("jump"), "прыжок"], [0.9, a => a.play("dive"), "dive"]] },
  { name: "land", label: "приземление: мягкое (vy 4) и жёсткое (vy 16)", dur: 1.0, musicOff: true,
    ev: [[0.08, a => a.play("land", { impact: 4 }), "мягко"], [0.5, a => a.play("land", { impact: 16 }), "жёстко"]] },
  { name: "slide", label: "подкат: розовый шум BP 1200→500", dur: 1.0, musicOff: true, ev: [[0.08, a => a.play("slide", { dur: 0.62 }), "подкат"]] },
  { name: "edge", label: "удар о бортик", dur: 0.5, musicOff: true, ev: [[0.08, a => a.play("edge", { dir: 1 }), "бортик"]] },
  { name: "nearmiss", label: "near-miss: вжух +4 полутона", dur: 0.6, musicOff: true, ev: [[0.08, a => a.play("nearmiss", { dir: 1 }), "ловко"]] },
  { name: "steps_wind", label: "шаги по sin(runPhase) + ветер: I 0→1 за 5 с, прыжок 3.0–3.6 с", dur: 6, musicOff: true, keepAmb: true,
    setup: a => run(a),
    frame: (a, t, st) => {
      const I = Math.min(1, t / 5), speed = 12 + 18 * I;
      st.ph = (st.ph || 0) + DT * (7 + speed * 0.36);
      a.setIntensity(I);
      a.setRunner(st.ph, !(t > 3.0 && t < 3.6), false);
    } },
  { name: "swarm", label: "рой: 12 м → 3.5 м (пан −→+), danger 0→1, чириканье, сердце; отход 5.5 с + облегчение", dur: 8, musicOff: true, keepAmb: true,
    setup: a => run(a, 0.5, 300),
    frame: (a, t) => {
      const k = t < 5 ? Math.min(1, t / 4.5) : Math.max(0, 1 - (t - 5.5) / 1.2);
      a.setSwarm(12 - 8.5 * k, -6 + 12 * Math.min(1, t / 5));
      a.setDanger(k);
    },
    ev: [[6.6, a => a.play("relief"), "облегчение"]] },
  { name: "record", label: "рекорд: арпеджио + колокольчики + шиммер (play с delay 0.3)", dur: 1.9, musicOff: true, ev: [[0.05, a => a.play("record", { delay: 0.3 }), "рекорд +0.3"]] },
  { name: "mission", label: "миссия", dur: 1.1, musicOff: true, ev: [[0.05, a => a.play("mission"), "миссия"]] },
  { name: "tier", label: "tier-up 1..4", dur: 2.2, musicOff: true,
    ev: [1, 2, 3, 4].map(n => [0.05 + (n - 1) * 0.5, a => a.play("tier", { tier: n }), "×" + n]) },
  { name: "ticks", label: "тики докрутки: 24 тика по 50 мс, высота = ступень", dur: 1.6, musicOff: true,
    ev: Array.from({ length: 24 }, (_, k) => [0.05 + k * 0.05, a => a.play("tick", { i: Math.floor(k / 24 * 11) })]) },
  { name: "count_start", label: "отсчёт A5/B5/D6 → A6 и старт-подъём", dur: 3.0, musicOff: true,
    ev: [[0.05, a => a.play("count", { n: 3 }), "3"], [0.55, a => a.play("count", { n: 2 }), "2"], [1.05, a => a.play("count", { n: 1 }), "1"],
         [1.55, a => a.play("count", { n: 0 }), "!"], [2.3, a => a.play("start"), "старт"]] },
  { name: "ui", label: "UI: hover-тик и нажатие", dur: 0.8, musicOff: true,
    ev: [[0.05, a => a.play("uiHover"), "hover"], [0.3, a => a.play("uiClick"), "click"]] },
  { name: "stress_arc_hit", label: "СТРЕСС: I=1 + danger + рой 4 м + целая дуга + удар в тот же кадр + жёсткое приземление", dur: 3.5, stress: true,
    setup: a => { run(a, 1, 800); a.setDanger(1); a.setSwarm(4, 1); },
    frame: (a, t, st) => { st.ph = (st.ph || 0) + DT * 17.8; a.setRunner(st.ph, true, false); },
    ev: [...Array.from({ length: 11 }, (_, k) => [1.0 + 0.057 * k, a => a.play("energon", { lane: 1 })]),
         [1.57, a => { a.play("arc"); a.play("hit"); a.play("land", { impact: 18 }); a.play("nearmiss", { dir: -1 }); }, "дуга+удар"]] },
  { name: "stress_arc_hit_low", label: "СТРЕСС q=low: то же + рубеж, дуга совпадает с ударом и фанфарой", dur: 3.5, stress: true, q: "low",
    setup: a => { run(a, 1, 800); a.setDanger(1); a.setSwarm(4, 1); },
    ev: [[0.2, a => a.play("milestone")], ...Array.from({ length: 11 }, (_, k) => [1.0 + 0.057 * k, a => a.play("energon", { lane: 1 })]),
         [1.57, a => { a.play("arc"); a.play("hit"); a.play("land", { impact: 18 }); }, "дуга+удар"]] },
  { name: "stress_all", label: "СТРЕСС: все SFX разом поверх полной музыки, затем game over", dur: 4, stress: true,
    setup: a => { run(a, 1, 800); a.setDanger(1); a.setSwarm(3.5, 0); },
    ev: [[1.0, a => { for (const n of SOUND_NAMES) a.play(n, { lane: 2, dir: 1, impact: 18, tier: 4, n: 0, i: 10 }); }, "всё"],
         [1.02, a => { for (let i = 0; i < 11; i++) a.play("energon"); a.play("arc"); }], [2.2, a => a.play("gameover"), "game over"]] },
  { name: "ceiling_torture", label: "ПОТОЛОК: пила +10 дБ прямо в мастер поверх дуги и удара — выход обязан остаться ≤ 0.98", dur: 2.5, stress: true,
    setup: a => {
      run(a, 1, 800); a.setDanger(1);
      const c = a.context, o = c.createOscillator(), g = c.createGain();
      o.type = "sawtooth"; o.frequency.value = 110; g.gain.value = 0; o.connect(g); g.connect(a.nodes.fade);
      g.gain.setValueAtTime(0, 0.8); g.gain.linearRampToValueAtTime(3.2, 1.6); o.start(0);
    },
    ev: [...Array.from({ length: 11 }, (_, k) => [1.0 + 0.057 * k, a => a.play("energon", { lane: 1 })]),
         [1.57, a => { a.play("arc"); a.play("hit"); }, "дуга+удар+пила"]] },
];

// ---------- рендер одного теста ----------
async function renderTest(T){
  const oc = new OfflineAudioContext(2, Math.ceil(SR * T.dur), SR);
  let vt = 0;
  const a = createAudio({ quality: T.q || qp.get("q") || "med" }, { context: oc, clock: () => vt, seed: 7, haptics: false });
  STARTS = []; START_CTX = oc;
  await a.unlock();
  if (T.musicOff){ a.setVolume("music", 0); if (!T.keepAmb) a.setVolume("amb", 0); }
  if (T.setup) T.setup(a);
  const ev = (T.ev || []).slice().sort((x, y) => x[0] - y[0]);
  const marks = [], st = {};
  let e = 0, maxVoices = 0, maxMusic = 0;
  for (let f = 0; vt < T.dur; f++){
    while (e < ev.length && ev[e][0] <= vt + 1e-9){ ev[e][1](a, vt, st); if (ev[e][2]) marks.push([vt, ev[e][2]]); e++; }
    if (T.frame) T.frame(a, vt, st);
    a.update(DT);
    maxVoices = Math.max(maxVoices, a.debug.voices); maxMusic = Math.max(maxMusic, a.debug.musicVoices);
    vt = (f + 1) * DT;
  }
  const starts = STARTS; STARTS = null; START_CTX = null;
  const t0 = performance.now();
  const buf = await oc.startRendering();
  const res = { buf, marks, starts, ms: performance.now() - t0, bankMs: a.debug.bankMs, maxVoices, maxMusic, dropped: a.debug.dropped,
    layers: a.debug.layers.map(v => +(+v).toFixed(3)), minor: a.debug.minor, bank: a.bank };
  if (T.check) res.check = T.check(a, st, res);
  return res;
}

// ---------- анализ ----------
function stats(buf){
  const L = buf.getChannelData(0), R = buf.getChannelData(1), n = L.length;
  let peak = 0, sum = 0, over = 0;
  const win = Math.round(SR * 0.05); let wSum = 0, wMax = 0;
  for (let i = 0; i < n; i++){
    const l = Math.abs(L[i]), r = Math.abs(R[i]), m = l > r ? l : r;
    if (m > peak) peak = m;
    if (m > 0.98) over++;
    const s = (L[i] * L[i] + R[i] * R[i]) / 2; sum += s; wSum += s;
    if ((i + 1) % win === 0){ wMax = Math.max(wMax, wSum / win); wSum = 0; }
  }
  const db = x => x > 0 ? 20 * Math.log10(x) : -Infinity;
  return { peak, peakDb: db(peak), rmsDb: db(Math.sqrt(sum / n)), maxShortRmsDb: db(Math.sqrt(wMax)), over };
}

// БПФ на месте (радикс), размер степень двойки
function fft(re, im){
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++){
    let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit;
    if (i < j){ let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1){
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len){
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++){
        const ar = re[i + k + len / 2], ai = im[i + k + len / 2];
        const vr = ar * cr - ai * ci, vi = ar * ci + ai * cr;
        re[i + k + len / 2] = re[i + k] - vr; im[i + k + len / 2] = im[i + k] - vi;
        re[i + k] += vr; im[i + k] += vi;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}
function mono(buf){ const L = buf.getChannelData(0), R = buf.getChannelData(1), m = new Float32Array(L.length); for (let i = 0; i < m.length; i++) m[i] = (L[i] + R[i]) * 0.5; return m; }
const hannOf = N => { const h = new Float64Array(N); for (let i = 0; i < N; i++) h[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1)); return h; };

// основной тон ноты лестницы: Ханн 4096 → zero-pad 32768 → пик 450..2600 Гц → параболическая интерполяция
function pitchAt(m, t){
  const W = 4096, P = 32768, o = Math.round((t + 0.012) * SR);
  const re = new Float64Array(P), im = new Float64Array(P);
  for (let i = 0; i < W; i++) re[i] = (m[o + i] || 0) * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (W - 1)));
  fft(re, im);
  const b0 = Math.floor(450 * P / SR), b1 = Math.ceil(2600 * P / SR);
  let bi = b0, bm = 0;
  const mag = i => Math.hypot(re[i], im[i]);
  for (let i = b0; i <= b1; i++){ const v = mag(i); if (v > bm){ bm = v; bi = i; } }
  const a = Math.log(mag(bi - 1) + 1e-12), b = Math.log(bm + 1e-12), c = Math.log(mag(bi + 1) + 1e-12);
  const d = 0.5 * (a - c) / (a - 2 * b + c);
  return (bi + d) * SR / P;
}

// энергия F (минорная терция Dm) против F# (мажорная) по октавам 3..6, окна 8192 с шагом 4096, полосы ±20 центов
function thirdsEnergy(m){
  const N = 8192, h = hannOf(N), re = new Float64Array(N), im = new Float64Array(N);
  const F = [174.61, 349.23, 698.46, 1396.91], Fs = [185.0, 369.99, 739.99, 1479.98];
  let eF = 0, eFs = 0;
  const band = hz => [Math.floor(hz * Math.pow(2, -20 / 1200) * N / SR), Math.ceil(hz * Math.pow(2, 20 / 1200) * N / SR)];
  for (let o = 0; o + N <= m.length; o += 4096){
    for (let i = 0; i < N; i++){ re[i] = m[o + i] * h[i]; im[i] = 0; }
    fft(re, im);
    for (let k = 0; k < 4; k++){
      const [a0, a1] = band(F[k]), [b0, b1] = band(Fs[k]);
      for (let i = a0; i <= a1; i++) eF += re[i] * re[i] + im[i] * im[i];
      for (let i = b0; i <= b1; i++) eFs += re[i] * re[i] + im[i] * im[i];
    }
  }
  return { F: eF, Fs: eFs, ratioF_over_Fs: +(eF / (eFs + 1e-12)).toFixed(3) };
}

// «простой писк»: одна стационарная частота (≤ 1 пика в 20 дБ от максимума, без свипа, не шум) с плоской огибающей
function beepScan(bank){
  const pick = { whoosh: bank.whoosh, nearmiss: bank.nearmiss, jump: bank.jump, dive: bank.dive, land: bank.land, slide: bank.slide,
    step: bank.step[0], edge: bank.edge, boom: bank.boom, bonk: bank.bonk, goJingle: bank.goJingle, heart: bank.heart, chirp: bank.chirp,
    relief: bank.relief, uiHover: bank.uiHover, uiClick: bank.uiClick, start: bank.start, tier: bank.tier[0], mission: bank.mission,
    record: bank.record, fanfare: bank.fanfare, tick: bank.tick[5], count: bank.count[0], ladder0: bank.ladder[0], ladder10: bank.ladder[10],
    arc: bank.arc, diss: bank.diss };
  const out = {}, beeps = [];
  for (const name in pick){
    const x = pick[name].getChannelData(0), sr = pick[name].sampleRate, N = 2048, h = hannOf(N);
    let peak = 0; for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
    // огибающая по 5 мс: доля времени выше половины пика
    const w = Math.round(sr * 0.005); let above = 0, frames = 0;
    for (let o = 0; o + w <= x.length; o += w){ let mx = 0; for (let i = o; i < o + w; i++) mx = Math.max(mx, Math.abs(x[i])); if (mx > 0.02 * peak){ frames++; if (mx > 0.5 * peak) above++; } }
    const sustain = frames ? above / frames : 0;
    // спектр двух окон: начало и середина (свип = сдвиг доминанты > 3%)
    const spec = off => {
      const re = new Float64Array(N), im = new Float64Array(N);
      for (let i = 0; i < N; i++){ re[i] = (x[off + i] || 0) * h[i]; }
      fft(re, im); const mag = new Float64Array(N / 2); for (let i = 1; i < N / 2; i++) mag[i] = Math.hypot(re[i], im[i]); return mag;
    };
    const s0 = spec(0), s1 = spec(Math.max(0, Math.min(x.length - N, Math.floor(x.length / 3))));
    let mx = 0, bi = 0; for (let i = 2; i < N / 2; i++) if (s0[i] > mx){ mx = s0[i]; bi = i; }
    let mx1 = 0, bi1 = 0; for (let i = 2; i < N / 2; i++) if (s1[i] > mx1){ mx1 = s1[i]; bi1 = i; }
    let peaks = 0; for (let i = 3; i < N / 2 - 1; i++) if (s0[i] > mx * 0.1 && s0[i] >= s0[i - 1] && s0[i] >= s0[i + 1] && Math.abs(i - bi) > 4) peaks++;
    let lg = 0, ar = 0, cnt = 0; for (let i = 2; i < N / 2; i++){ const v = s0[i] * s0[i] + 1e-20; lg += Math.log(v); ar += v; cnt++; }
    const flatness = Math.exp(lg / cnt) / (ar / cnt);
    const sweep = bi1 > 0 && Math.abs(bi1 - bi) / bi > 0.03;
    const plain = peaks === 0 && !sweep && flatness < 0.01 && sustain > 0.6;
    out[name] = { extraPeaks: peaks, sweep, flatness: +flatness.toExponential(2), sustain: +sustain.toFixed(2), dominantHz: Math.round(bi * sr / N) };
    if (plain) beeps.push(name);
  }
  return { perSound: out, plainBeeps: beeps };
}

// ---------- рисование ----------
const LUT = (() => {   // чернила → синий → лайм → снег
  const stops = [[0, [5, 8, 30]], [0.35, [5, 54, 212]], [0.62, [40, 170, 200]], [0.82, [192, 255, 63]], [1, [248, 255, 235]]];
  const lut = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++){
    const x = i / 255; let k = 0; while (k < stops.length - 2 && x > stops[k + 1][0]) k++;
    const [xa, ca] = stops[k], [xb, cb] = stops[k + 1], u = (x - xa) / (xb - xa);
    for (let c = 0; c < 3; c++) lut[i * 3 + c] = ca[c] + (cb[c] - ca[c]) * u;
  }
  return lut;
})();
const NOTE = hz => { const m = Math.round(69 + 12 * Math.log2(hz / 440)); return ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"][m % 12] + (Math.floor(m / 12) - 1); };

function drawCard(T, res, st){
  const card = document.createElement("div");
  const failed = st.peak > 0.98 || st.maxShortRmsDb < -60 || (res.check && !res.check.pass);
  card.className = "card" + (failed ? " fail" : "");
  const W = 800, HS = 230, HW = 70, fmin = 40, fmax = 20000;
  const chk = res.check ? ` · <b class="${res.check.pass ? "ok" : "bad"}">${res.check.pass ? "✓" : "✗"}</b>` : "";
  card.innerHTML = `<h3>${T.name}${T.q ? " (q=" + T.q + ")" : ""}<span>пик ${st.peakDb.toFixed(1)} дБ · RMS ${st.rmsDb.toFixed(1)} дБ${chk}</span></h3><p>${T.label}</p>`;
  const cv = document.createElement("canvas"); cv.width = W; cv.height = HS + HW + 4; card.appendChild(cv);
  const g = cv.getContext("2d"), img = g.createImageData(W, HS), m = mono(res.buf);
  const N = 2048, re = new Float64Array(N), im = new Float64Array(N), hann = hannOf(N);
  const rowBin = new Float64Array(HS);
  for (let y = 0; y < HS; y++) rowBin[y] = fmin * Math.pow(fmax / fmin, 1 - y / (HS - 1)) * N / SR;
  const hop = (m.length - N) / (W - 1), col = new Float64Array(N / 2);
  for (let x = 0; x < W; x++){
    const o = Math.floor(x * hop);
    for (let i = 0; i < N; i++){ re[i] = (m[o + i] || 0) * hann[i]; im[i] = 0; }
    fft(re, im);
    for (let i = 0; i < N / 2; i++) col[i] = Math.hypot(re[i], im[i]) / (N / 4);
    for (let y = 0; y < HS; y++){
      const b = rowBin[y], nb = y < HS - 1 ? rowBin[y + 1] : b;
      let v = 0; for (let i = Math.floor(nb); i <= Math.ceil(b) && i < N / 2; i++) v = Math.max(v, col[i]);   // максимум по полосе строки
      const db = 20 * Math.log10(v + 1e-9), u = Math.max(0, Math.min(1, (db + 90) / 90));
      const li = (u * 255) | 0, p = (y * W + x) * 4;
      img.data[p] = LUT[li * 3]; img.data[p + 1] = LUT[li * 3 + 1]; img.data[p + 2] = LUT[li * 3 + 2]; img.data[p + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  // сетка частот
  g.font = "18px ui-monospace, Menlo, monospace"; g.textBaseline = "middle";
  for (const f of [100, 1000, 10000]){
    const y = (1 - Math.log(f / fmin) / Math.log(fmax / fmin)) * (HS - 1);
    g.fillStyle = "rgba(242,246,255,.25)"; g.fillRect(0, y, W, 1);
    g.fillStyle = "rgba(242,246,255,.7)"; g.fillText(f >= 1000 ? f / 1000 + "k" : f, 6, y - 10);
  }
  // огибающая: min/max по колонке, линия потолка 0.98
  const y0 = HS + 4 + HW / 2;
  g.fillStyle = "#050a2a"; g.fillRect(0, HS + 4, W, HW);
  g.fillStyle = "rgba(255,59,92,.55)"; g.fillRect(0, y0 - 0.98 * HW / 2, W, 1); g.fillRect(0, y0 + 0.98 * HW / 2, W, 1);
  const L = res.buf.getChannelData(0), R = res.buf.getChannelData(1), step = L.length / W;
  for (let x = 0; x < W; x++){
    let mn = 0, mx = 0;
    for (let i = Math.floor(x * step); i < Math.floor((x + 1) * step); i++){ const v = L[i], w = R[i]; if (v < mn) mn = v; if (v > mx) mx = v; if (w < mn) mn = w; if (w > mx) mx = w; }
    g.fillStyle = Math.max(mx, -mn) > 0.98 ? "#FF3B5C" : "#C0FF3F";
    g.fillRect(x, y0 - mx * HW / 2, 1, Math.max(1, (mx - mn) * HW / 2));
  }
  // метки событий
  g.font = "bold 18px ui-sans-serif, system-ui, sans-serif"; g.textBaseline = "top";
  for (const [t, lbl] of res.marks){
    const x = t / T.dur * W;
    g.fillStyle = "rgba(192,255,63,.9)"; g.fillRect(x, 0, 2, HS);
    g.fillStyle = "rgba(7,13,54,.75)"; const tw = g.measureText(lbl).width; g.fillRect(x + 3, 4, tw + 8, 24);
    g.fillStyle = "#C0FF3F"; g.fillText(lbl, x + 7, 7);
  }
  g.fillStyle = "rgba(242,246,255,.6)"; g.font = "16px ui-monospace, Menlo, monospace"; g.textBaseline = "bottom";
  g.fillText(`${T.dur} с · голосов SFX ≤ ${res.maxVoices} · музыка ≤ ${res.maxMusic}`, W - 330, HS - 6);
  $("grid").appendChild(card);
}

// ---------- прогон ----------
async function runAll(){
  const tests = only ? TESTS.filter(t => only.includes(t.name)) : TESTS;
  const report = { sampleRate: SR, peak: 0, peakTest: "", peakPerTest: {}, rmsPerTest: {}, maxShortRmsPerTest: {}, silentTests: [], clippedTests: [],
    layersByTest: {}, minorByTest: {}, checkDetails: {}, checks: {}, detectedPitchesOfLadder: [], ladderOk: null, stressPeak: 0, bankMs: 0, renderMs: 0,
    maxSfxVoices: 0, maxMusicVoices: 0, tests: tests.length };
  const T0 = performance.now();
  let bankForScan = null; const monoOf = {};
  for (const T of tests){
    $("busy").textContent = `рендер: ${T.name}…`;
    if (T.name === "ladder") ladderOnsets.length = 0;
    const res = await renderTest(T);
    const st = stats(res.buf);
    bankForScan = bankForScan || res.bank;
    report.bankMs = Math.max(report.bankMs, res.bankMs);
    report.peakPerTest[T.name] = +st.peak.toFixed(4);
    report.rmsPerTest[T.name] = +st.rmsDb.toFixed(1);
    report.maxShortRmsPerTest[T.name] = +st.maxShortRmsDb.toFixed(1);
    report.layersByTest[T.name] = res.layers; report.minorByTest[T.name] = res.minor;
    report.maxSfxVoices = Math.max(report.maxSfxVoices, res.maxVoices); report.maxMusicVoices = Math.max(report.maxMusicVoices, res.maxMusic);
    if (st.peak > report.peak){ report.peak = +st.peak.toFixed(4); report.peakTest = T.name; }
    if (st.maxShortRmsDb < -60) report.silentTests.push(T.name);
    if (st.peak > 0.98) report.clippedTests.push(T.name);
    if (T.stress) report.stressPeak = Math.max(report.stressPeak, +st.peak.toFixed(4));
    if (res.check){ report.checkDetails[T.name] = res.check; report.checks[T.name] = res.check.pass; }
    if (T.name === "music_danger" || T.name === "music_I1" || T.name === "music_title" || T.name === "harmony_minor") monoOf[T.name] = thirdsEnergy(mono(res.buf));
    if (T.name === "ladder"){
      const m = mono(res.buf);
      const expectSteps = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 10, 0, 1];
      report.detectedPitchesOfLadder = ladderOnsets.map((t, k) => {
        const hz = pitchAt(m, t), ex = LADDER_HZ[expectSteps[k]];
        return { k, step: expectSteps[k], expected: ex, note: NOTE(ex), detected: +hz.toFixed(1), cents: +(1200 * Math.log2(hz / ex)).toFixed(1) };
      });
      report.ladderOk = report.detectedPitchesOfLadder.length === 15 && report.detectedPitchesOfLadder.every(p => Math.abs(p.cents) <= 15);
      report.checks.ladder = report.ladderOk;
    }
    drawCard(T, res, st);
    await new Promise(r => setTimeout(r, 0));
  }
  // сводные проверки по требованиям библии 2.8 и чек-листу «Звук»
  const LB = report.layersByTest, eq = (a, b) => a && b.every((v, i) => a[i] === v);
  if (LB.music_title && LB.music_I0 && LB.music_I1){
    report.checks.layersByIntensity = eq(LB.music_title, [1, 0, 0, 0]) && eq(LB.music_I0, [1, 1, 0, 0]) && eq(LB.music_I1, [1, 1, 1, 1]);
  }
  // минор: энергия F против F# в гармонии без барабанов (титул major vs danger), плюс флаги слоя D в забеге
  if (monoOf.harmony_minor && monoOf.music_title && LB.music_danger){
    report.minorEvidence = { titleMajor: monoOf.music_title, titleDanger: monoOf.harmony_minor, runDanger: monoOf.music_danger, runMajorI1: monoOf.music_I1 };
    report.checks.dangerMinor = report.minorByTest.music_danger === true && report.minorByTest.harmony_minor === true && LB.music_danger[4] > 0.2
      && monoOf.harmony_minor.ratioF_over_Fs > 1 && monoOf.harmony_minor.ratioF_over_Fs > 4 * monoOf.music_title.ratioF_over_Fs
      && (!monoOf.music_I1 || monoOf.music_danger.ratioF_over_Fs > 2 * monoOf.music_I1.ratioF_over_Fs);
  }
  if (bankForScan){ report.beeps = beepScan(bankForScan); report.checks.noPlainBeeps = report.beeps.plainBeeps.length === 0; }
  report.checks.noClipping = report.clippedTests.length === 0 && report.peak <= 0.98;
  report.checks.noSilence = report.silentTests.length === 0;
  report.checks.voiceLimits = report.maxSfxVoices <= 28 && report.maxMusicVoices <= 20;
  report.renderMs = Math.round(performance.now() - T0);
  report.failedChecks = Object.keys(report.checks).filter(k => !report.checks[k]);
  report.ok = report.failedChecks.length === 0;
  window.AUDIO_REPORT = report;
  $("busy").remove();
  drawSummary(report);
  return report;
}

function drawSummary(r){
  const chip = (k, v, ok) => `<span class="chip"><i>${k}</i><b class="${ok === undefined ? "" : ok ? "ok" : "bad"}">${v}</b></span>`;
  $("chips").innerHTML = [
    chip("итог", r.ok ? "PASS" : "FAIL: " + r.failedChecks.join(", "), r.ok),
    chip("пик по всем тестам", `${r.peak.toFixed(3)} (${r.peakTest})`, r.peak <= 0.98),
    chip("стресс «дуга + удар»", r.stressPeak.toFixed(3), r.stressPeak <= 0.98),
    chip("клиппинг", r.clippedTests.length ? r.clippedTests.join(", ") : "нет", !r.clippedTests.length),
    chip("тишина", r.silentTests.length ? r.silentTests.join(", ") : "нет", !r.silentTests.length),
    chip("лестница", r.ladderOk === null ? "—" : r.ladderOk ? "11 ступеней ✓" : "ошибка высоты", r.ladderOk !== false),
    chip("писки", r.beeps ? (r.beeps.plainBeeps.length ? r.beeps.plainBeeps.join(", ") : "нет") : "—", r.beeps ? !r.beeps.plainBeeps.length : undefined),
    chip("минор в опасности", r.minorEvidence ? `F/F# ${r.minorEvidence.titleDanger.ratioF_over_Fs} vs ${r.minorEvidence.titleMajor.ratioF_over_Fs}` : "—", r.checks.dangerMinor),
    chip("голоса SFX / музыка", `${r.maxSfxVoices} / ${r.maxMusicVoices}`, r.checks.voiceLimits),
    chip("пре-рендер банка", `${r.bankMs.toFixed(0)} мс`),
    chip("тестов", `${r.tests} за ${(r.renderMs / 1000).toFixed(1)} с`),
  ].join("");
  if (r.detectedPitchesOfLadder.length){
    const P = r.detectedPitchesOfLadder;
    $("ladder").hidden = false;
    $("ladder").innerHTML = `<table><tr><th>подбор</th>${P.map(p => `<td>${p.k + 1}</td>`).join("")}</tr>
      <tr><th>ступень</th>${P.map(p => `<td>${p.step}</td>`).join("")}</tr>
      <tr><th>нота</th>${P.map(p => `<td><b>${p.note}</b></td>`).join("")}</tr>
      <tr><th>ждём, Гц</th>${P.map(p => `<td>${p.expected.toFixed(0)}</td>`).join("")}</tr>
      <tr><th>нашли, Гц</th>${P.map(p => `<td>${p.detected.toFixed(1)}</td>`).join("")}</tr>
      <tr><th>центы</th>${P.map(p => `<td class="${Math.abs(p.cents) <= 15 ? "ok" : "bad"}">${p.cents > 0 ? "+" : ""}${p.cents}</td>`).join("")}</tr></table>`;
  }
}

// ---------- живой режим: кнопки для ушей и headless-проверка реального контекста ----------
function buildLive(){
  const box = $("live"); box.classList.add("on");
  let audio = null, raf = 0, I = 0, ph = 0, last = 0;
  const create = () => { if (!audio){ audio = createAudio({ quality: "med" }); window.LIVE_AUDIO = audio; } return audio; };
  const ensure = async () => {
    create();
    await audio.unlock();
    if (!raf){ last = performance.now(); const loop = now => { const dt = (now - last) / 1000; last = now; ph += dt * (7 + (12 + 18 * I) * 0.36);
      audio.setRunner(ph, true, false); audio.update(dt); raf = requestAnimationFrame(loop); }; raf = requestAnimationFrame(loop); }
    return audio;
  };
  const btn = (label, fn, hot) => { const b = document.createElement("button"); b.textContent = label; if (hot) b.className = "hot"; b.onclick = async () => fn(await ensure()); box.appendChild(b); };
  btn("▶ звук / титул", a => a.setMode("title"), true);
  btn("забег (пролёт 1.1 с)", a => a.startRun(1.1), true);
  for (const n of SOUND_NAMES) btn(n, a => a.play(n, { lane: (Math.random() * 3) | 0, dir: Math.random() > 0.5 ? 1 : -1, impact: 14, tier: 2, n: 1, i: 5 }));
  btn("дуга ×11", a => { let k = 0; const id = setInterval(() => { a.play("energon", { lane: 1 }); if (++k === 11){ clearInterval(id); a.play("arc"); } }, 60); });
  const slider = (label, fn) => { const l = document.createElement("label"); l.textContent = label; const s = document.createElement("input"); s.type = "range"; s.min = 0; s.max = 1; s.step = 0.01; s.value = 0;
    s.oninput = async () => fn(await ensure(), +s.value); l.appendChild(s); box.appendChild(l); };
  box.appendChild(document.createElement("br"));
  slider("I", (a, v) => { I = v; a.setIntensity(v); });
  slider("danger", (a, v) => a.setDanger(v));
  slider("дистанция ×1000", (a, v) => a.setDistance(v * 1000));
  slider("рой близко", (a, v) => a.setSwarm(v > 0.01 ? 12 - 8.5 * v : null, (v - 0.5) * 8));
  return { ensure, create };
}

async function liveAuto(L){
  // реальный AudioContext в headless (autoplay разрешён флагом): звучит ли граф, возвращается ли после вкладки/pagehide,
  // ставится ли iOS audioSession «ambient» ДО создания контекста, сколько стоит unlock() после prepare()
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let typeAtCreate = null;
  try { Object.defineProperty(navigator, "audioSession", { value: { type: "auto" }, configurable: true }); } catch (e){}
  const OrigAC = window.AudioContext;
  window.AudioContext = function(o){ typeAtCreate = navigator.audioSession ? navigator.audioSession.type : null; return new OrigAC(o); };
  let fakeHidden = false;
  Object.defineProperty(document, "hidden", { get: () => fakeHidden, configurable: true });

  const pre = L.create();
  let tp = performance.now(); await pre.prepare(); const prepareMs = +(performance.now() - tp).toFixed(1);
  tp = performance.now(); const a = await L.ensure(); const unlockMs = +(performance.now() - tp).toFixed(1);
  window.AudioContext = OrigAC;
  const an = a.context.createAnalyser(); an.fftSize = 2048; a.nodes.out.connect(an);
  const tmp = new Float32Array(an.fftSize);
  const rmsNow = async (n = 6) => { let m = 0; for (let i = 0; i < n; i++){ an.getFloatTimeDomainData(tmp); let s = 0; for (let j = 0; j < tmp.length; j++) s += tmp[j] * tmp[j]; m = Math.max(m, Math.sqrt(s / tmp.length)); await sleep(50); } return +m.toFixed(4); };
  a.setIntensity(0.8); a.setDistance(600);
  const lead = +a.startRun(1.1).toFixed(3);
  let rmsMax = 0;
  for (let i = 0; i < 30; i++){ rmsMax = Math.max(rmsMax, await rmsNow(1)); if (i % 5 === 0) a.play("energon", { lane: 1 }); if (i === 10) a.play("lane", { dir: 1 }); if (i === 20) a.play("hit"); }
  const clockLive = { ...a.clock };
  const before = a.context.state;
  // вкладка скрыта → кит сам делает suspend; видима → resume + fade-in 300 мс
  fakeHidden = true; document.dispatchEvent(new Event("visibilitychange")); await sleep(400);
  const hiddenState = a.context.state;
  fakeHidden = false; document.dispatchEvent(new Event("visibilitychange")); await sleep(500);
  const afterVisible = a.context.state, rmsAfterResume = await rmsNow(8);
  // pagehide / pageshow (iOS, bfcache)
  dispatchEvent(new Event("pagehide")); await sleep(400);
  const pagehideState = a.context.state;
  dispatchEvent(new Event("pageshow")); await sleep(500);
  const pageshowState = a.context.state, rmsAfterPageshow = await rmsNow(8);
  // внешний suspend (система/iOS interrupted): следующий жест unlock() возвращает звук
  await a.context.suspend(); const extSuspended = a.context.state;
  await a.unlock(); await sleep(400); const afterGestureUnlock = a.context.state;
  a.setMuted(true); await sleep(300); const rmsMuted = await rmsNow(); a.setMuted(false); await sleep(200);
  a.setPaused(true); await sleep(500); const rmsPaused = await rmsNow(); a.setPaused(false);
  // стоимость update(): 5000 вызовов подряд
  let tu = performance.now(); for (let i = 0; i < 5000; i++) a.update(1 / 60); const updateMicros = +((performance.now() - tu) / 5000 * 1000).toFixed(2);
  a.play("gameover"); await sleep(100);
  let disposeError = null; try { a.dispose(); } catch (e){ disposeError = String(e); }
  delete document.hidden;
  const R = { prepareMs, unlockMs, ctxMs: a.debug.ctxMs, buildMs: a.debug.buildMs, sessionTypeAtContextCreate: typeAtCreate, sessionDebug: a.debug.session, lead, before, rmsMax: +rmsMax.toFixed(4),
    hiddenState, afterVisible, rmsAfterResume, pagehideState, pageshowState, rmsAfterPageshow, extSuspended, afterGestureUnlock,
    rmsMuted, rmsPaused, updateMicros, disposeError, bankSr: a.debug.bankSr, sampleRate: a.context.sampleRate, clock: clockLive, voices: a.debug.voices };
  R.checks = {
    iosAmbientBeforeContext: typeAtCreate === "ambient",
    audible: R.rmsMax > 0.05,
    hiddenSuspends: hiddenState === "suspended",
    tabResume: afterVisible === "running" && rmsAfterResume > 0.02,
    pagehideSuspends: pagehideState === "suspended",
    pageshowResume: pageshowState === "running" && rmsAfterPageshow > 0.02,
    gestureResumesInterrupted: extSuspended === "suspended" && afterGestureUnlock === "running",
    mute: rmsMuted < 0.005,
    pauseMuffles: rmsPaused < rmsMax * 0.8,
    liveClock: clockLive.running === true && clockLive.toDownbeat >= 0 && clockLive.toDownbeat < 2.3,
    disposeClean: disposeError === null,
  };
  R.ok = Object.values(R.checks).every(Boolean);
  window.LIVE_REPORT = R;
  return R;
}

(async () => {
  try {
    let L = null;
    if (qp.has("live")) L = buildLive();
    if (qp.get("live") === "auto"){ const r = await liveAuto(L); $("sub").textContent = "live: " + JSON.stringify(r); }
    if (qp.get("offline") !== "0") await runAll();
    document.title = "SHOT_READY";
  } catch (e){
    console.error(e); document.title = "SHOT_READY"; $("sub").textContent = "ОШИБКА: " + e.message;
    throw e;
  }
})();
