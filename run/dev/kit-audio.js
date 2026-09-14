// Стенд звукового кита: проверка «без ушей».
// Каждый тест — детерминированный сценарий в OfflineAudioContext через ПОЛНЫЙ граф кита (шины, компрессор, потолок).
// Итог в window.AUDIO_REPORT; спектрограмма (лог-частота) + огибающая на каждый тест.
import { createAudio, SOUND_NAMES } from "../src/audio/index.js";
import { LADDER_HZ } from "../src/audio/patches.js";

const qp = new URLSearchParams(location.search);
const SR = 48000, FPS = 60, DT = 1 / FPS;
const only = qp.get("only") ? qp.get("only").split(",") : null;
const $ = id => document.getElementById(id);

// ---------- сценарии ----------
// ev: [время, (a, t, st) => …, "метка"]; frame(a, t, st) — каждый кадр; musicOff — только SFX
const run = (a, I = 0, dist = 0) => { a.setIntensity(I); a.setDistance(dist); a.setMode("play"); };
const quiet = a => { a.setVolume("music", 0); a.setVolume("amb", 0); };
const ladderOnsets = [];
const TESTS = [
  { name: "music_title", label: "титул: 96 BPM, pad + pluck 8-ми, LP 2500", dur: 8, setup: a => a.setMode("title") },
  { name: "music_I0", label: "забег I=0, 0 м: L0 + L1 (бочка, хэт)", dur: 8, setup: a => run(a, 0, 0) },
  { name: "music_I1", label: "забег I=1, 600 м: все слои, 128 BPM", dur: 8, setup: a => run(a, 1, 600) },
  { name: "music_danger", label: "danger=1: минор (Dm/Gm), дрон + томы, сердце", dur: 8, setup: a => { run(a, 0.6, 300); a.setDanger(1); } },
  { name: "milestone", label: "рубеж на 1.0 с: сбивка → фанфара на сильной + слой L3", dur: 7,
    setup: a => run(a, 0.3, 200), ev: [[1.0, a => a.play("milestone"), "рубеж"]] },
  { name: "gameover", label: "удар-бум → tape-stop 0.7 с → маримба A4–F4–D4 → титульная петля", dur: 8,
    setup: a => run(a, 0.7, 600), ev: [[2.5, a => a.play("gameover"), "game over"]] },
  { name: "hit_duck", label: "3-слойный удар + приглушение музыки ×0.4 + LP 650 спотыкания", dur: 5,
    setup: a => run(a, 0.5, 300),
    frame: (a, t, st) => { a.setSwarmNear(st.sn = Math.max(0, (st.sn || 0) - DT)); },
    ev: [[2.0, (a, t, st) => { a.play("hit"); st.sn = 5.5; a.setSwarmNear(5.5); }, "удар"]] },
  { name: "ladder", label: "лестница: 13 подборов по 0.25 с (11 ступеней + держим верх), пауза, сброс", dur: 5.4, musicOff: true,
    ev: [...Array.from({ length: 13 }, (_, k) => [0.2 + 0.25 * k, (a, t) => { a.play("energon", { lane: k % 3 }); ladderOnsets.push(t); }]),
         [4.45, (a, t) => { a.play("energon", { lane: 1 }); ladderOnsets.push(t); }, "сброс"],
         [4.70, (a, t) => { a.play("energon", { lane: 1 }); ladderOnsets.push(t); }]] },
  { name: "arc", label: "целая дуга на скорости 30 (57 мс) + флориш D6–F#6–A6–D7", dur: 1.8, musicOff: true,
    ev: [...Array.from({ length: 11 }, (_, k) => [0.1 + 0.057 * k, a => a.play("energon", { lane: 1 })]), [0.72, a => a.play("arc"), "дуга"]] },
  { name: "lane", label: "вжух полосы: влево (пан +0.5→−0.5), вправо", dur: 1.2, musicOff: true,
    setup: a => run(a), ev: [[0.1, a => a.play("lane", { dir: -1 }), "←"], [0.65, a => a.play("lane", { dir: 1 }), "→"]] },
  { name: "jump", label: "войлочный прыжок: sine 220→520 + ткань", dur: 0.6, musicOff: true, ev: [[0.08, a => a.play("jump"), "прыжок"]] },
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
  { name: "record", label: "рекорд: арпеджио + колокольчики + шиммер", dur: 1.6, musicOff: true, ev: [[0.05, a => a.play("record"), "рекорд"]] },
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
  const a = createAudio({ quality: qp.get("q") || "med" }, { context: oc, clock: () => vt, seed: 7, haptics: false });
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
  const t0 = performance.now();
  const buf = await oc.startRendering();
  return { buf, marks, ms: performance.now() - t0, bankMs: a.debug.bankMs, maxVoices, maxMusic, dropped: a.debug.dropped };
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
  card.className = "card" + (st.peak > 0.98 || st.maxShortRmsDb < -60 ? " fail" : "");
  const W = 800, HS = 230, HW = 70, fmin = 40, fmax = 20000;
  card.innerHTML = `<h3>${T.name}<span>пик ${st.peakDb.toFixed(1)} дБ · RMS ${st.rmsDb.toFixed(1)} дБ</span></h3><p>${T.label}</p>`;
  const cv = document.createElement("canvas"); cv.width = W; cv.height = HS + HW + 4; card.appendChild(cv);
  const g = cv.getContext("2d"), img = g.createImageData(W, HS), m = mono(res.buf);
  const N = 2048, re = new Float64Array(N), im = new Float64Array(N), hann = new Float64Array(N);
  for (let i = 0; i < N; i++) hann[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1));
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
    detectedPitchesOfLadder: [], ladderOk: null, stressPeak: 0, bankMs: 0, renderMs: 0, maxSfxVoices: 0, maxMusicVoices: 0, tests: tests.length };
  const T0 = performance.now();
  for (const T of tests){
    $("busy").textContent = `рендер: ${T.name}…`;
    if (T.name === "ladder") ladderOnsets.length = 0;
    const res = await renderTest(T);
    const st = stats(res.buf);
    report.bankMs = Math.max(report.bankMs, res.bankMs);
    report.peakPerTest[T.name] = +st.peak.toFixed(4);
    report.rmsPerTest[T.name] = +st.rmsDb.toFixed(1);
    report.maxShortRmsPerTest[T.name] = +st.maxShortRmsDb.toFixed(1);
    report.maxSfxVoices = Math.max(report.maxSfxVoices, res.maxVoices); report.maxMusicVoices = Math.max(report.maxMusicVoices, res.maxMusic);
    if (st.peak > report.peak){ report.peak = +st.peak.toFixed(4); report.peakTest = T.name; }
    if (st.maxShortRmsDb < -60) report.silentTests.push(T.name);
    if (st.peak > 0.98) report.clippedTests.push(T.name);
    if (T.stress) report.stressPeak = Math.max(report.stressPeak, +st.peak.toFixed(4));
    if (T.name === "ladder"){
      const m = mono(res.buf);
      const expectSteps = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 10, 0, 1];
      report.detectedPitchesOfLadder = ladderOnsets.map((t, k) => {
        const hz = pitchAt(m, t), ex = LADDER_HZ[expectSteps[k]];
        return { k, step: expectSteps[k], expected: ex, note: NOTE(ex), detected: +hz.toFixed(1), cents: +(1200 * Math.log2(hz / ex)).toFixed(1) };
      });
      report.ladderOk = report.detectedPitchesOfLadder.length === 15 && report.detectedPitchesOfLadder.every(p => Math.abs(p.cents) <= 15);
    }
    drawCard(T, res, st);
    await new Promise(r => setTimeout(r, 0));
  }
  report.renderMs = Math.round(performance.now() - T0);
  report.ok = report.clippedTests.length === 0 && report.silentTests.length === 0 && report.ladderOk !== false && report.peak <= 0.98;
  window.AUDIO_REPORT = report;
  $("busy").remove();
  drawSummary(report);
  return report;
}

function drawSummary(r){
  const chip = (k, v, ok) => `<span class="chip"><i>${k}</i><b class="${ok === undefined ? "" : ok ? "ok" : "bad"}">${v}</b></span>`;
  $("chips").innerHTML = [
    chip("итог", r.ok ? "PASS" : "FAIL", r.ok),
    chip("пик по всем тестам", `${r.peak.toFixed(3)} (${r.peakTest})`, r.peak <= 0.98),
    chip("стресс «дуга + удар»", r.stressPeak.toFixed(3), r.stressPeak <= 0.98),
    chip("клиппинг", r.clippedTests.length ? r.clippedTests.join(", ") : "нет", !r.clippedTests.length),
    chip("тишина", r.silentTests.length ? r.silentTests.join(", ") : "нет", !r.silentTests.length),
    chip("лестница", r.ladderOk === null ? "—" : r.ladderOk ? "11 ступеней ✓" : "ошибка высоты", r.ladderOk !== false),
    chip("голоса SFX / музыка", `${r.maxSfxVoices} / ${r.maxMusicVoices}`, r.maxSfxVoices <= 24 && r.maxMusicVoices <= 20),
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
  let audio = null, raf = 0, I = 0, danger = 0, dist = 0, swarm = -1, ph = 0, last = 0;
  const ensure = async () => {
    if (!audio){ audio = createAudio({ quality: "med" }); window.LIVE_AUDIO = audio; }
    await audio.unlock();
    if (!raf){ last = performance.now(); const loop = now => { const dt = (now - last) / 1000; last = now; ph += dt * (7 + (12 + 18 * I) * 0.36);
      audio.setRunner(ph, true, false); audio.update(dt); raf = requestAnimationFrame(loop); }; raf = requestAnimationFrame(loop); }
    return audio;
  };
  const btn = (label, fn, hot) => { const b = document.createElement("button"); b.textContent = label; if (hot) b.className = "hot"; b.onclick = async () => fn(await ensure()); box.appendChild(b); };
  btn("▶ звук / титул", a => a.setMode("title"), true);
  btn("забег", a => a.setMode("play"), true);
  for (const n of SOUND_NAMES) btn(n, a => a.play(n, { lane: (Math.random() * 3) | 0, dir: Math.random() > 0.5 ? 1 : -1, impact: 14, tier: 2, n: 1, i: 5 }));
  btn("дуга ×11", a => { let k = 0; const id = setInterval(() => { a.play("energon", { lane: 1 }); if (++k === 11){ clearInterval(id); a.play("arc"); } }, 60); });
  const slider = (label, fn) => { const l = document.createElement("label"); l.textContent = label; const s = document.createElement("input"); s.type = "range"; s.min = 0; s.max = 1; s.step = 0.01; s.value = 0;
    s.oninput = async () => fn(await ensure(), +s.value); l.appendChild(s); box.appendChild(l); };
  box.appendChild(document.createElement("br"));
  slider("I", (a, v) => { I = v; a.setIntensity(v); });
  slider("danger", (a, v) => { danger = v; a.setDanger(v); });
  slider("дистанция ×1000", (a, v) => { dist = v * 1000; a.setDistance(dist); });
  slider("рой близко", (a, v) => { swarm = v; a.setSwarm(v > 0.01 ? 12 - 8.5 * v : null, (v - 0.5) * 8); });
  return ensure;
}

async function liveAuto(ensure){
  // реальный AudioContext в headless (autoplay разрешён флагом): звучит ли граф, возвращается ли после «переключения вкладки»
  const a = await ensure();
  const an = a.context.createAnalyser(); an.fftSize = 2048; a.nodes.out.connect(an);
  const tmp = new Float32Array(an.fftSize); let rmsMax = 0, samples = 0;
  const meter = () => { an.getFloatTimeDomainData(tmp); let s = 0; for (const v of tmp) s += v * v; rmsMax = Math.max(rmsMax, Math.sqrt(s / tmp.length)); samples++; };
  a.setIntensity(0.8); a.setDistance(600); a.setMode("play");
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 30; i++){ meter(); await sleep(50); if (i % 5 === 0) a.play("energon", { lane: 1 }); if (i === 10) a.play("lane", { dir: 1 }); if (i === 20) a.play("hit"); }
  const before = a.context.state;
  await a.context.suspend();
  const suspended = a.context.state;
  document.dispatchEvent(new Event("visibilitychange"));   // вкладка видима → кит сам делает resume + fade-in
  await sleep(400);
  const after = a.context.state;
  let rmsAfter = 0; for (let i = 0; i < 10; i++){ an.getFloatTimeDomainData(tmp); let s = 0; for (const v of tmp) s += v * v; rmsAfter = Math.max(rmsAfter, Math.sqrt(s / tmp.length)); await sleep(50); }
  const rmsNow = async () => { let m = 0; for (let i = 0; i < 6; i++){ an.getFloatTimeDomainData(tmp); let s = 0; for (const v of tmp) s += v * v; m = Math.max(m, Math.sqrt(s / tmp.length)); await sleep(50); } return +m.toFixed(4); };
  a.setMuted(true); await sleep(300); const rmsMuted = await rmsNow(); a.setMuted(false); await sleep(200);
  a.setPaused(true); await sleep(500); const rmsPaused = await rmsNow(); a.setPaused(false);
  // стоимость update(): 5000 вызовов подряд
  let tu = performance.now(); for (let i = 0; i < 5000; i++) a.update(1 / 60); const updateMicros = +((performance.now() - tu) / 5000 * 1000).toFixed(2);
  a.setMode("title"); a.play("gameover"); await sleep(100);
  let disposeError = null; try { a.dispose(); } catch (e){ disposeError = String(e); }
  window.LIVE_REPORT = { before, suspended, after, rmsMax: +rmsMax.toFixed(4), rmsAfterResume: +rmsAfter.toFixed(4), rmsMuted, rmsPaused, updateMicros, disposeError, samples,
    bpm: a.debug.bpm, layers: a.debug.layers.slice(), voices: a.debug.voices, musicVoices: a.debug.musicVoices, clock: { ...a.clock }, sampleRate: a.context.sampleRate };
  return window.LIVE_REPORT;
}

(async () => {
  try {
    let ensure = null;
    if (qp.has("live")) ensure = buildLive();
    if (qp.get("live") === "auto"){ const r = await liveAuto(ensure); $("sub").textContent = "live: " + JSON.stringify(r); }
    if (qp.get("offline") !== "0") await runAll();
    document.title = "SHOT_READY";
  } catch (e){
    console.error(e); document.title = "SHOT_READY"; $("sub").textContent = "ОШИБКА: " + e.message;
    throw e;
  }
})();
