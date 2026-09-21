// Патчи: инструменты музыки и SFX, пре-рендер в моно Float32Array (числа — из feature-bible 2.8).
// Уровни из библии «запечены» как амплитуда основного слоя; дальше WebAudio только гейн/пан/rate.
import { TAU, midiHz, makeRng, sweep, env, Biquad, pinkGen, buf, mixInto, fadeEdges, soft } from "./dsp.js";

// ---------- ТЕОРИЯ ----------
// лестница энергонов: ре-мажорная пентатоника D5..D7 (11 ступеней) и ре-минорная для danger
export const LADDER_HZ     = [587.33, 659.26, 739.99, 880.00, 987.77, 1174.66, 1318.51, 1479.98, 1760.00, 1975.53, 2349.32];
export const LADDER_MIN_HZ = [587.33, 698.46, 783.99, 880.00, 1046.50, 1174.66, 1396.91, 1567.98, 1760.00, 2093.00, 2349.32];

// аккорды петли D–Bm–G–A (по 2 такта); m — минорный вариант (D→Dm, G→Gm), остальные без изменений
export const CHORDS = [
  { root: 38, pad: [57, 62, 66], padM: [57, 62, 65], arp: [74, 78, 81, 86, 90], arpM: [74, 77, 81, 86, 89] },   // D / Dm
  { root: 35, pad: [59, 62, 66], padM: [59, 62, 66], arp: [71, 74, 78, 83, 86], arpM: [71, 74, 78, 83, 86] },   // Bm
  { root: 43, pad: [59, 62, 67], padM: [58, 62, 67], arp: [71, 74, 79, 83, 86], arpM: [70, 74, 79, 82, 86] },   // G / Gm
  { root: 45, pad: [57, 61, 64], padM: [57, 61, 64], arp: [73, 76, 81, 85, 88], arpM: [73, 76, 81, 85, 88] },   // A
];
export const PENT    = [74, 76, 78, 81, 83, 86, 88, 90, 93];   // D-мажорная пентатоника для мотива
export const PENT_M  = [74, 77, 79, 81, 84, 86, 89, 91, 93];   // та же сетка ступеней в ре-миноре
export const TOMS    = [50, 45, 41, 38];

// ---------- ИНСТРУМЕНТЫ МУЗЫКИ ----------
// kick: sine 150→45 Гц exp за 90 мс, спад 220 мс, щелчок шума 3 мс
function kick(sr, rng){
  const b = buf(sr, 0.34); let ph = 0;
  const hp = new Biquad("hp", sr).set(2500, 0.7);
  for (let i = 0; i < b.length; i++){
    const t = i / sr;
    ph += TAU * sweep(150, 45, 0.09, t) / sr;
    let v = Math.sin(ph) * env(t, 0.002, 0.22);
    if (t < 0.003) v += hp.run(rng() * 2 - 1) * 0.6 * (1 - t / 0.003);
    b[i] = v;
  }
  return fadeEdges(soft(b, 1.4), sr).map(v => v * 0.9);
}
// hat: highpass 8000 Гц, спад 35 мс; velocity запекается вариантом
function hat(sr, rng, vel){
  const b = buf(sr, 0.07), hp = new Biquad("hp", sr).set(8000, 0.8), hp2 = new Biquad("hp", sr).set(8000, 0.8);
  for (let i = 0; i < b.length; i++){ const t = i / sr; b[i] = hp2.run(hp.run(rng() * 2 - 1)) * env(t, 0.001, 0.035); }
  return fadeEdges(b, sr, 4).map(v => v * 0.18 * vel * 1.6);
}
// snare: bandpass 1800 Гц Q 0.7, 140 мс + triangle 190 Гц 60 мс
function snare(sr, rng){
  const b = buf(sr, 0.22), bp = new Biquad("bp", sr).set(1800, 0.7); let ph = 0;
  for (let i = 0; i < b.length; i++){
    const t = i / sr;
    ph += 190 / sr;
    const tri = 1 - 4 * Math.abs((ph % 1) - 0.5);
    b[i] = bp.run(rng() * 2 - 1) * 1.6 * env(t, 0.001, 0.14) + tri * 0.55 * env(t, 0.001, 0.06);
  }
  return fadeEdges(soft(b, 1.2), sr).map(v => v * 0.35);
}
// bass: пила + саб → lowpass 600 Гц, огибающая 5/200 мс
function bass(sr, rng, midi){
  const f = midiHz(midi), b = buf(sr, 0.3), lp = new Biquad("lp", sr).set(600, 0.9), lp2 = new Biquad("lp", sr).set(900, 0.6);
  let ph = 0;
  for (let i = 0; i < b.length; i++){
    const t = i / sr; ph = (ph + f / sr) % 1;
    const saw = ph * 2 - 1, sub = Math.sin(TAU * ph);
    b[i] = lp2.run(lp.run(saw * 0.7 + sub * 0.8)) * env(t, 0.005, 0.2);
  }
  return fadeEdges(soft(b, 1.6), sr).map(v => v * 0.22);
}
// pluck FM: ratio 3.5, индекс 300 Гц → 0 за 250 мс
function pluck(sr, rng, midi){
  const f = midiHz(midi), b = buf(sr, 0.42); let pc = 0, pm = 0;
  for (let i = 0; i < b.length; i++){
    const t = i / sr;
    pm += TAU * f * 3.5 / sr;
    const idx = t < 0.25 ? 300 * (1 - t / 0.25) * (1 - t / 0.25) : 0;
    pc += TAU * (f + idx * Math.sin(pm)) / sr;
    b[i] = Math.sin(pc) * env(t, 0.002, 0.3);
  }
  return fadeEdges(b, sr, 8).map(v => v * 0.10);
}
// lead: sine + 4-я гармоника, мягкое вибрато
function lead(sr, rng, midi){
  const f = midiHz(midi), b = buf(sr, 0.6); let p1 = 0, p4 = 0;
  for (let i = 0; i < b.length; i++){
    const t = i / sr, vib = 1 + 0.004 * Math.sin(TAU * 5.5 * t) * Math.min(1, t / 0.15);
    p1 += TAU * f * vib / sr; p4 += TAU * f * 4 * vib / sr;
    b[i] = (Math.sin(p1) + 0.22 * Math.sin(p4) * env(t, 0.004, 0.18)) * env(t, 0.012, 0.5);
  }
  return fadeEdges(b, sr, 10).map(v => v * 0.09);
}
// бубенцы: кластер неровных высоких синусов + шумовой «шорох», 8-е
function sleigh(sr, rng, vel){
  const b = buf(sr, 0.16), hp = new Biquad("hp", sr).set(6500, 0.7);
  const fr = [5230, 6120, 7380, 8410, 9650], ph = [0, 0, 0, 0, 0], off = fr.map(() => rng() * 0.012);
  for (let i = 0; i < b.length; i++){
    const t = i / sr;
    let v = hp.run(rng() * 2 - 1) * 0.5 * env(t, 0.002, 0.05);
    for (let k = 0; k < fr.length; k++){ ph[k] += TAU * fr[k] / sr; v += Math.sin(ph[k]) * 0.18 * env(t - off[k], 0.001, 0.09); }
    b[i] = v;
  }
  return fadeEdges(b, sr, 6).map(v => v * 0.12 * vel);
}
// том D-слоя: sine с падением высоты + мягкий шумовой удар
function tom(sr, rng, midi){
  const f = midiHz(midi), b = buf(sr, 0.3), lp = new Biquad("lp", sr).set(900, 0.7); let ph = 0;
  for (let i = 0; i < b.length; i++){
    const t = i / sr; ph += TAU * sweep(f * 1.6, f, 0.05, t) / sr;
    b[i] = Math.sin(ph) * env(t, 0.002, 0.24) + lp.run(rng() * 2 - 1) * 0.3 * env(t, 0.001, 0.03);
  }
  return fadeEdges(soft(b, 1.5), sr).map(v => v * 0.55);
}
// сбивка рубежа: шумовой подъём bandpass 700→7000 Гц на полтакта 110 BPM (подгоняется playbackRate)
function riser(sr, rng){
  const T = 60 / 110 * 2, b = buf(sr, T), bp = new Biquad("bp", sr), pink = pinkGen(rng);
  for (let i = 0; i < b.length; i++){
    const t = i / sr, x = t / T;
    if (i % 16 === 0) bp.set(sweep(700, 7000, T, t), 1.1);
    b[i] = bp.run(pink() * 2.2) * x * x * (x > 0.97 ? (1 - x) / 0.03 : 1);
  }
  return fadeEdges(b, sr).map(v => v * 0.22);
}
// маримба: sine f + 4f (быстрее гаснет) + ударный клик
function marimbaInto(dst, sr, rng, hz, off, g, dec = 0.5){
  const n = Math.ceil(sr * (dec * 1.4)), o = Math.round(off * sr); let p1 = 0, p4 = 0, p10 = 0;
  const lp = new Biquad("lp", sr).set(3000, 0.7);
  for (let i = 0; i < n && o + i < dst.length; i++){
    const t = i / sr; p1 += TAU * hz / sr; p4 += TAU * hz * 3.93 / sr; p10 += TAU * hz * 9.2 / sr;
    const v = Math.sin(p1) * env(t, 0.002, dec) + 0.35 * Math.sin(p4) * env(t, 0.001, dec * 0.18)
            + 0.08 * Math.sin(p10) * env(t, 0.0005, 0.02) + lp.run(rng() * 2 - 1) * 0.12 * env(t, 0.0005, 0.008);
    dst[o + i] += v * g;
  }
}
// колокольчик-блеск: f + негармоники, долгий хвост
function bellInto(dst, sr, hz, off, g, dec = 0.8){
  const n = Math.ceil(sr * dec * 1.4), o = Math.round(off * sr); let a = 0, b2 = 0, c = 0;
  for (let i = 0; i < n && o + i < dst.length; i++){
    const t = i / sr; a += TAU * hz / sr; b2 += TAU * hz * 2.76 / sr; c += TAU * hz * 5.4 / sr;
    dst[o + i] += (Math.sin(a) * env(t, 0.002, dec) + 0.3 * Math.sin(b2) * env(t, 0.001, dec * 0.4) + 0.1 * Math.sin(c) * env(t, 0.001, dec * 0.15)) * g;
  }
}
// шиммер: высокий шум 7 кГц
function shimmerInto(dst, sr, rng, off, dur, g){
  const n = Math.ceil(sr * dur), o = Math.round(off * sr), bp = new Biquad("bp", sr).set(7000, 1.5), hp = new Biquad("hp", sr).set(5000, 0.7);
  for (let i = 0; i < n && o + i < dst.length; i++){
    const t = i / sr, x = t / dur;
    dst[o + i] += hp.run(bp.run(rng() * 2 - 1)) * g * 2.2 * Math.sin(Math.PI * Math.min(1, x)) ;
  }
}

// ---------- ЛЕСТНИЦА ЭНЕРГОНОВ ----------
// голос: sine f (1) + 2f (0.35) + 3.01f (0.15), атака 1.5 мс, спад 0.22→0.14 с, тик шума 8 мс через HP 6 кГц
function ladderInto(dst, sr, rng, hz, step, off, g){
  const dec = 0.22 - 0.008 * Math.min(10, step), n = Math.ceil(sr * dec * 1.5), o = Math.round(off * sr);
  const hp = new Biquad("hp", sr).set(6000, 0.7), hp2 = new Biquad("hp", sr).set(6000, 0.7);
  let p1 = 0, p2 = 0, p3 = 0;
  for (let i = 0; i < n && o + i < dst.length; i++){
    const t = i / sr; p1 += TAU * hz / sr; p2 += TAU * hz * 2 / sr; p3 += TAU * hz * 3.01 / sr;
    let v = (Math.sin(p1) + 0.35 * Math.sin(p2) * env(t, 0.0015, dec * 0.6) + 0.15 * Math.sin(p3) * env(t, 0.0015, dec * 0.35)) * env(t, 0.0015, dec);
    if (t < 0.008) v += hp2.run(hp.run(rng() * 2 - 1)) * 0.55 * (1 - t / 0.008);
    dst[o + i] += v * g;
  }
  if (step >= 8) shimmerInto(dst, sr, rng, off, 0.06, g * 0.35);
}
function ladderNote(sr, rng, step, minor){
  const hz = (minor ? LADDER_MIN_HZ : LADDER_HZ)[step];
  const b = buf(sr, 0.36); ladderInto(b, sr, rng, hz, step, 0, 0.18);
  return fadeEdges(b, sr);
}
// флориш целой дуги: D6–F#6–A6–D7 через 45 мс, gain 0.14, спад 0.3 с
function arc(sr, rng, minor){
  const L = minor ? LADDER_MIN_HZ : LADDER_HZ, notes = [L[5], minor ? 1396.91 : 1479.98, L[8], L[10]];
  const b = buf(sr, 0.66);
  for (let k = 0; k < 4; k++){
    const n = Math.ceil(sr * 0.45), o = Math.round(k * 0.045 * sr); let p1 = 0, p2 = 0;
    for (let i = 0; i < n; i++){ const t = i / sr; p1 += TAU * notes[k] / sr; p2 += TAU * notes[k] * 2 / sr;
      b[o + i] += (Math.sin(p1) + 0.3 * Math.sin(p2) * env(t, 0.0015, 0.12)) * env(t, 0.0015, 0.3) * 0.14; }
  }
  shimmerInto(b, sr, rng, 0.1, 0.25, 0.05);
  return fadeEdges(b, sr);
}

// ---------- ДВИЖЕНИЕ ----------
// вжух: белый шум → bandpass Q 1.2, 600→2400 Гц exp за 140 мс, атака 15, спад 120 мс, 0.14 (+ розовое «тело»)
function whoosh(sr, rng, semis){
  const k = Math.pow(2, semis / 12), b = buf(sr, 0.32), bp = new Biquad("bp", sr), lp = new Biquad("lp", sr), pink = pinkGen(rng);
  for (let i = 0; i < b.length; i++){
    const t = i / sr;
    if (i % 16 === 0){ const f = sweep(600 * k, 2400 * k, 0.14, t); bp.set(f, 1.2); lp.set(f * 0.5, 0.7); }
    const e = t < 0.015 ? t / 0.015 : Math.exp(-4.6 * (t - 0.015) / 0.12 * 0.75);
    b[i] = (bp.run(rng() * 2 - 1) * 2.4 + lp.run(pink()) * 0.9) * e;
  }
  return fadeEdges(b, sr, 20).map(v => v * 0.14);
}
// прыжок: sine 220→520 Гц exp за 110 мс 0.16 + ткань (шум LP 1200, 60 мс, 0.12)
function jump(sr, rng){
  const b = buf(sr, 0.22), lp = new Biquad("lp", sr).set(1200, 0.7), bp = new Biquad("bp", sr).set(900, 0.9); let ph = 0;
  for (let i = 0; i < b.length; i++){
    const t = i / sr; ph += TAU * sweep(220, 520, 0.11, t) / sr;
    const tone = (Math.sin(ph) + 0.18 * Math.sin(ph * 2)) * env(t, 0.004, 0.16);
    const cloth = bp.run(lp.run(rng() * 2 - 1)) * 3.2 * env(t, 0.006, 0.06);
    b[i] = tone * 0.16 + cloth * 0.12;
  }
  return fadeEdges(b, sr);
}
// приземление: sine 110→55 Гц за 90 мс + 3 зерна хруста (HP 1500, 25 мс, сдвиги 15–25 мс), 0.14
function land(sr, rng){
  const b = buf(sr, 0.2); let ph = 0;
  for (let i = 0; i < b.length; i++){ const t = i / sr; ph += TAU * sweep(110, 55, 0.09, t) / sr; b[i] = Math.sin(ph) * env(t, 0.003, 0.12); }
  let off = 0;
  for (let g = 0; g < 3; g++){
    off += 0.015 + rng() * 0.01;
    const hp = new Biquad("hp", sr).set(1500 + rng() * 1200, 0.9), n = Math.ceil(sr * 0.025), o = Math.round(off * sr);
    for (let i = 0; i < n && o + i < b.length; i++){ const t = i / sr; b[o + i] += hp.run(rng() * 2 - 1) * (0.9 - g * 0.2) * env(t, 0.001, 0.025) * (rng() > 0.35 ? 1 : 0.4); }
  }
  // первое зерно — сразу на касании
  const hp0 = new Biquad("hp", sr).set(1800, 0.9);
  for (let i = 0; i < sr * 0.02; i++){ const t = i / sr; b[i] += hp0.run(rng() * 2 - 1) * 0.8 * env(t, 0.001, 0.02); }
  return fadeEdges(soft(b, 1.3), sr).map(v => v * 0.14 * 1.3);
}
// подкат: розовый шум → bandpass Q 0.8, 1200→500 Гц на всю длительность (номинал 0.62 с), 0.16
function slide(sr, rng){
  const T = 0.62, b = buf(sr, T + 0.08), bp = new Biquad("bp", sr), pink = pinkGen(rng), hp = new Biquad("hp", sr).set(3000, 0.7);
  for (let i = 0; i < b.length; i++){
    const t = i / sr;
    if (i % 16 === 0) bp.set(sweep(1200, 500, T, t), 0.8);
    const e = Math.min(1, t / 0.03) * (t > T - 0.1 ? Math.max(0, (T + 0.06 - t) / 0.16) : 1);
    const grit = hp.run(rng() * 2 - 1) * (rng() > 0.985 ? 1.5 : 0.1);
    b[i] = (bp.run(pink() * 2.0) + grit * 0.4) * e * (0.85 + 0.15 * Math.sin(TAU * 9 * t));
  }
  return fadeEdges(b, sr, 15).map(v => v * 0.16);
}
// шаг: bandpass 1200 Гц Q 1.2, 45 мс, 0.06 (снежный «хрусть» с низким тупым телом)
function step(sr, rng){
  const b = buf(sr, 0.07), bp = new Biquad("bp", sr).set(1100 + rng() * 250, 1.2), lp = new Biquad("lp", sr).set(260, 0.7);
  for (let i = 0; i < b.length; i++){
    const t = i / sr, crunch = rng() > 0.6 ? 1 : 0.35;
    b[i] = bp.run(rng() * 2 - 1) * 2.4 * crunch * env(t, 0.002, 0.045) + lp.run(rng() * 2 - 1) * 2.0 * env(t, 0.002, 0.03);
  }
  return fadeEdges(b, sr, 5).map(v => v * 0.06 * 1.6);
}
// удар о бортик: sine 140→70 Гц 80 мс + шум lowpass, 0.12
function edge(sr, rng){
  const b = buf(sr, 0.16), lp = new Biquad("lp", sr).set(700, 0.8); let ph = 0;
  for (let i = 0; i < b.length; i++){
    const t = i / sr; ph += TAU * sweep(140, 70, 0.08, t) / sr;
    b[i] = Math.sin(ph) * env(t, 0.002, 0.1) + lp.run(rng() * 2 - 1) * 1.4 * env(t, 0.001, 0.04);
  }
  return fadeEdges(soft(b, 1.4), sr).map(v => v * 0.12);
}

// ---------- УДАР И GAME OVER ----------
// «бум»: sine 90→40 Гц за 180 мс, 0.5 + войлочная пыль
function boom(sr, rng){
  const b = buf(sr, 0.42), lp = new Biquad("lp", sr).set(320, 0.7); let ph = 0;
  for (let i = 0; i < b.length; i++){
    const t = i / sr; ph += TAU * sweep(90, 40, 0.18, t) / sr;
    b[i] = Math.sin(ph) * env(t, 0.003, 0.3) + lp.run(rng() * 2 - 1) * 1.1 * env(t, 0.002, 0.08);
  }
  return fadeEdges(soft(b, 1.5), sr).map(v => v * 0.5);
}
// «бонк»: triangle 700→350 Гц за 60 мс, спад 120 мс, 0.25
function bonk(sr, rng){
  const b = buf(sr, 0.2), lp = new Biquad("lp", sr).set(2600, 0.7); let ph = 0;
  for (let i = 0; i < b.length; i++){
    const t = i / sr; ph = (ph + sweep(700, 350, 0.06, t) / sr) % 1;
    b[i] = lp.run(1 - 4 * Math.abs(ph - 0.5)) * env(t, 0.001, 0.12);
  }
  return fadeEdges(b, sr).map(v => v * 0.25);
}
// диссонанс на шине музыки: пилы A4 440 + Bb4 466 Гц → lowpass 1800 Гц, 350 мс, 0.12
function diss(sr, rng){
  const b = buf(sr, 0.45), lp = new Biquad("lp", sr).set(1800, 0.7); let a = 0, c = 0;
  for (let i = 0; i < b.length; i++){
    const t = i / sr; a = (a + 440 / sr) % 1; c = (c + 466.16 / sr) % 1;
    b[i] = lp.run((a * 2 - 1) + (c * 2 - 1)) * 0.5 * env(t, 0.004, 0.35);
  }
  return fadeEdges(b, sr).map(v => v * 0.12);
}
// нисходящий джингл маримбы A4–F4–D4 через 120 мс, спад 0.5 с, 0.2
function goJingle(sr, rng){
  const b = buf(sr, 1.05);
  marimbaInto(b, sr, rng, 440.00, 0.00, 0.2); marimbaInto(b, sr, rng, 349.23, 0.12, 0.2); marimbaInto(b, sr, rng, 293.66, 0.24, 0.2, 0.6);
  return fadeEdges(b, sr);
}

// ---------- РОЙ ----------
// сердце: sine 55 Гц 80 мс «тук-тук», второй через 180 мс на 70% (+ 110 Гц и глухой клик, чтобы слышно на телефоне)
function heart(sr, rng){
  const b = buf(sr, 0.36);
  for (const [off, g] of [[0, 1], [0.18, 0.7]]){
    const n = Math.ceil(sr * 0.12), o = Math.round(off * sr), lp = new Biquad("lp", sr).set(180, 0.7); let ph = 0;
    for (let i = 0; i < n; i++){
      const t = i / sr; ph += TAU * sweep(62, 52, 0.08, t) / sr;
      b[o + i] += (Math.sin(ph) + 0.35 * Math.sin(ph * 2) + lp.run(rng() * 2 - 1) * 1.6 * env(t, 0.001, 0.015)) * env(t, 0.004, 0.08) * g;
    }
  }
  return fadeEdges(soft(b, 1.3), sr).map(v => v * 0.14);
}
// чириканье Гасителя: square 1400→900 Гц за 50 мс, 0.04 — сглажено LP, чтобы не было «писка»
function chirp(sr, rng){
  const b = buf(sr, 0.08), lp = new Biquad("lp", sr).set(3200, 0.9), lp2 = new Biquad("lp", sr).set(4200, 0.7); let ph = 0;
  for (let i = 0; i < b.length; i++){
    const t = i / sr; ph = (ph + sweep(1400, 900, 0.05, t) / sr) % 1;
    b[i] = lp2.run(lp.run(ph < 0.5 ? 1 : -1)) * env(t, 0.003, 0.05);
  }
  return fadeEdges(b, sr).map(v => v * 0.04);
}
// облегчение: E5 → B5 через 70 мс (колокольчики)
function relief(sr, rng){
  const b = buf(sr, 0.8); bellInto(b, sr, 659.26, 0, 0.1, 0.45); bellInto(b, sr, 987.77, 0.07, 0.11, 0.55);
  return fadeEdges(b, sr);
}

// ---------- UI ----------
// hover-тик: sine 1800 Гц 25 мс, 0.05 — плюс стеклянная негармоника 3.9f и щелчок 2 мс, чтобы не «пищало»
function uiHover(sr, rng){
  const b = buf(sr, 0.04), hp = new Biquad("hp", sr).set(5000, 0.7); let ph = 0, p2 = 0;
  for (let i = 0; i < b.length; i++){
    const t = i / sr; ph += TAU * 1800 / sr; p2 += TAU * 1800 * 3.9 / sr;
    b[i] = (Math.sin(ph) * env(t, 0.0015, 0.025) + 0.25 * Math.sin(p2) * env(t, 0.001, 0.008)
          + (t < 0.002 ? hp.run(rng() * 2 - 1) * 0.5 * (1 - t / 0.002) : 0)) * 0.05;
  }
  return fadeEdges(b, sr);
}
function uiClick(sr, rng){
  const b = buf(sr, 0.07), hp = new Biquad("hp", sr).set(3000, 0.7); let ph = 0;
  for (let i = 0; i < b.length; i++){
    const t = i / sr; ph += TAU * sweep(900, 600, 0.04, t) / sr;
    b[i] = (Math.sin(ph) * env(t, 0.002, 0.045) + (t < 0.005 ? hp.run(rng() * 2 - 1) * 0.6 * (1 - t / 0.005) : 0)) * 0.18;
  }
  return fadeEdges(b, sr);
}
// арпеджио голосом лестницы
function ladderArp(sr, rng, hzs, gap, g, tail = 0.3, shimmer = 0){
  const b = buf(sr, gap * hzs.length + tail + 0.2);
  hzs.forEach((hz, k) => ladderInto(b, sr, rng, hz, 3, k * gap, g));
  if (shimmer) shimmerInto(b, sr, rng, gap, gap * hzs.length + 0.15, shimmer);
  return fadeEdges(b, sr);
}
const H = { D5: 587.33, E5: 659.26, Fs5: 739.99, A5: 880, B5: 987.77, D6: 1174.66, Fs6: 1479.98, A6: 1760, D7: 2349.32 };
const startRise = (sr, rng) => ladderArp(sr, rng, [H.D5, H.E5, H.A5, H.D6], 0.06, 0.16);
function tier(sr, rng, n){
  const s = Math.min(6, n * 2); return ladderArp(sr, rng, [LADDER_HZ[s], LADDER_HZ[s + 2], LADDER_HZ[s + 4]], 0.07, 0.15, 0.3, 0.03);
}
function mission(sr, rng){
  const b = ladderArp(sr, rng, [H.A5, H.D6, H.Fs6, H.A6], 0.06, 0.13, 0.4, 0.05);
  bellInto(b, sr, H.D7, 0.24, 0.05, 0.6); return fadeEdges(b, sr);
}
function record(sr, rng){
  const b = ladderArp(sr, rng, [H.D5, H.Fs5, H.A5, H.D6, H.Fs6, H.A6, H.D7], 0.07, 0.12, 0.6, 0.06);
  bellInto(b, sr, H.D6, 0.49, 0.07, 1.0); bellInto(b, sr, H.A6, 0.52, 0.05, 0.9); return fadeEdges(b, sr);
}
// фанфара рубежа: «страм» колокольчиков D5 A5 D6 F#6 на сильную долю + шиммер
function fanfare(sr, rng){
  const b = buf(sr, 1.3);
  [H.D5, H.A5, H.D6, H.Fs6].forEach((hz, k) => { bellInto(b, sr, hz, k * 0.022, 0.055, 0.9); ladderInto(b, sr, rng, hz, 3, k * 0.022, 0.05); });
  shimmerInto(b, sr, rng, 0.02, 0.4, 0.05);
  return fadeEdges(b, sr);
}
// тик докрутки: короткая ступень лестницы
function tick(sr, rng, s){ const b = buf(sr, 0.12); ladderInto(b, sr, rng, LADDER_HZ[s], 10, 0, 0.07); return fadeEdges(b, sr); }
// отсчёт A5/B5/D6 → A6
function count(sr, rng, n){
  const hz = [H.A6, H.D6, H.B5, H.A5][n] || H.A5, b = buf(sr, n === 0 ? 0.7 : 0.3);
  ladderInto(b, sr, rng, hz, n === 0 ? 0 : 6, 0, 0.14); if (n === 0) bellInto(b, sr, hz, 0, 0.05, 0.5);
  return fadeEdges(b, sr);
}

// ---------- ИМПУЛЬС РЕВЕРБА ----------
// стерео шум с экспоненциальным спадом и затемнением хвоста (снежный зал, не собор)
export function reverbIR(sr, sec, seed = 11){
  const rng = makeRng(seed), n = Math.ceil(sr * sec), L = new Float32Array(n), R = new Float32Array(n);
  for (const ch of [L, R]){
    let lpState = 0;
    for (let i = 0; i < n; i++){
      const t = i / sr, pre = t < 0.012 ? 0 : 1;
      const k = Math.exp(-TAU * (7000 * Math.exp(-t * 2.4) + 400) / sr);   // затемнение со временем
      lpState = lpState * k + (rng() * 2 - 1) * (1 - k);
      ch[i] = lpState * Math.exp(-6.9 * t / sec) * pre * 1.6;
    }
    // ранние отражения
    for (const [ms, g] of [[17, 0.5], [29, 0.35], [43, 0.28], [61, 0.2]]){ const j = Math.round(sr * ms / 1000) + (ch === R ? 3 : 0); if (j < n) ch[j] += g * (rng() > 0.5 ? 1 : -1); }
  }
  return [L, R];
}

// удар в подкат из воздуха (dive): вжух сверху вниз 2400→500 Гц за 120 мс + мягкий войлочный «тук» 120→60 Гц
function dive(sr, rng){
  const b = buf(sr, 0.3), bp = new Biquad("bp", sr), pink = pinkGen(rng); let ph = 0;
  for (let i = 0; i < b.length; i++){
    const t = i / sr;
    if (i % 16 === 0) bp.set(sweep(2400, 500, 0.12, t), 1.1);
    const air = bp.run(rng() * 2 - 1) * 2.2 * (t < 0.012 ? t / 0.012 : Math.exp(-4.6 * (t - 0.012) / 0.14));
    const td = t - 0.1; ph += td > 0 ? TAU * sweep(120, 60, 0.08, td) / sr : 0;
    b[i] = air * 0.13 + (td > 0 ? Math.sin(ph) * env(td, 0.003, 0.12) * 0.16 + pink() * 0.5 * env(td, 0.001, 0.03) * 0.1 : 0);
  }
  return fadeEdges(b, sr, 12);
}

// ---------- УСКОРИТЕЛИ ----------
// подбор: быстрое восходящее арпеджио лестницы D5→F#6 (50 мс) + колокольчик A6; вид бонуса меняет playbackRate
function powerup(sr, rng){
  const b = ladderArp(sr, rng, [H.D5, H.Fs5, H.A5, H.D6, H.Fs6], 0.05, 0.15, 0.5, 0.06);
  bellInto(b, sr, H.A6, 0.25, 0.06, 0.8);
  return fadeEdges(b, sr);
}
// окончание: два нисходящих тона маримбы A5 → D5
function powerdown(sr, rng){
  const b = buf(sr, 0.75);
  marimbaInto(b, sr, rng, H.A5, 0, 0.16); marimbaInto(b, sr, rng, H.D5, 0.14, 0.16, 0.55);
  return fadeEdges(b, sr);
}
// щит принял удар: стеклянный «хлоп» (шум HP 2.5 кГц 60 мс) + два колокольчика D6 / B6
function shieldPop(sr, rng){
  const b = buf(sr, 0.6), hp = new Biquad("hp", sr).set(2500, 0.8), hp2 = new Biquad("hp", sr).set(2500, 0.8);
  for (let i = 0; i < b.length; i++){ const t = i / sr; b[i] = hp2.run(hp.run(rng() * 2 - 1)) * 1.4 * env(t, 0.001, 0.06); }
  bellInto(b, sr, H.D6, 0.0, 0.08, 0.4); bellInto(b, sr, 1975.53, 0.03, 0.05, 0.35);
  return fadeEdges(b, sr).map(v => v * 0.4);   // пик ≈ 0.65 — под потолком лимитера
}

// ---------- БАНК ----------
// Генератор по шагам: prepare() в index.js крутит его кусками по ~8 мс между кадрами загрузки,
// unlock() в жесте только добивает остаток. Порядок вызовов rng фиксирован → буферы бит в бит те же.
const midiSet = (arrs) => { const s = new Set(); for (const a of arrs) for (const m of a) s.add(m); return [...s]; };
export function* bankSteps(sr, B){
  const r = makeRng(1234567);
  B.sr = sr;
  B.kick = kick(sr, r); B.hat = [1, 0.7, 0.4].map(v => hat(sr, r, v)); B.snare = snare(sr, r); yield;
  B.bass = {}; for (const c of CHORDS){ B.bass[c.root] = bass(sr, r, c.root); B.bass[c.root + 12] = bass(sr, r, c.root + 12); } yield;
  B.pluck = {}; for (const m of midiSet(CHORDS.flatMap(c => [c.arp, c.arpM]))) B.pluck[m] = pluck(sr, r, m); yield;
  B.lead = {}; for (const m of midiSet([PENT, PENT_M])) B.lead[m] = lead(sr, r, m); yield;
  B.sleigh = [1, 0.5].map(v => sleigh(sr, r, v));
  B.tom = {}; for (const m of TOMS) B.tom[m] = tom(sr, r, m); yield;
  B.riser = riser(sr, r); yield;
  B.ladder = LADDER_HZ.map((_, s) => ladderNote(sr, r, s, false)); yield;
  B.ladderMin = LADDER_HZ.map((_, s) => ladderNote(sr, r, s, true)); yield;
  B.arc = arc(sr, r, false); B.arcMin = arc(sr, r, true); yield;
  B.whoosh = whoosh(sr, r, 0); B.nearmiss = whoosh(sr, r, 4); yield;
  B.jump = jump(sr, r); B.land = land(sr, r); B.slide = slide(sr, r); yield;
  B.step = [0, 1, 2, 3].map(() => step(sr, r));
  B.edge = edge(sr, r); yield;
  B.boom = boom(sr, r); B.bonk = bonk(sr, r); B.diss = diss(sr, r); yield;
  B.goJingle = goJingle(sr, r); yield;
  B.heart = heart(sr, r); B.chirp = chirp(sr, r); B.relief = relief(sr, r); yield;
  B.uiHover = uiHover(sr, r); B.uiClick = uiClick(sr, r); B.start = startRise(sr, r);
  B.tier = [1, 2, 3, 4].map(n => tier(sr, r, n)); yield;
  B.mission = mission(sr, r); B.record = record(sr, r); yield;
  B.fanfare = fanfare(sr, r); yield;
  B.tick = LADDER_HZ.map((_, s) => tick(sr, r, s));
  B.count = [0, 1, 2, 3].map(n => count(sr, r, n)); yield;
  B.dive = dive(sr, r);
  // ускорители — в конце, чтобы порядок rng прежних буферов не сдвинулся (бит в бит те же)
  B.powerup = powerup(sr, r); B.powerdown = powerdown(sr, r); B.shieldPop = shieldPop(sr, r); yield;
  // зацикленный розовый шум ветра 2 с, шов петли — кроссфейд 50 мс
  const pr = pinkGen(makeRng(99)), pn = new Float32Array(sr * 2);
  for (let i = 0; i < pn.length; i++) pn[i] = pr();
  const x = Math.round(sr * 0.05);
  for (let i = 0; i < x; i++){ const k = i / x; pn[pn.length - x + i] = pn[pn.length - x + i] * (1 - k) + pn[i] * k; }
  B.pinkLoop = pn.subarray(0, pn.length - x);
}
// синхронная сборка целиком (офлайн-тесты и фолбэк, если prepare() не звали)
export function buildBank(sr){
  const T0 = (typeof performance !== "undefined" ? performance.now() : 0);
  const B = {};
  for (const _ of bankSteps(sr, B)){}
  B.ms = (typeof performance !== "undefined" ? performance.now() : 0) - T0;
  return B;
}
