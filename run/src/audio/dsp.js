// DSP-кирпичики для пре-рендера звуков в JS (синхронно, детерминированно, без WebAudio).
// Всё возвращает моно Float32Array; уровень «запекается» в буфер, в WebAudio остаются только gain/pan/rate.

export const TAU = Math.PI * 2;
export const midiHz = m => 440 * Math.pow(2, (m - 69) / 12);

// mulberry32 — свой генератор звука, чтобы офлайн-тесты совпадали бит в бит и не трогали ?seed игры
export function makeRng(seed){
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// экспоненциальный свип частоты f0→f1 за T секунд, дальше держим f1
export const sweep = (f0, f1, T, t) => t >= T ? f1 : f0 * Math.pow(f1 / f0, t / T);
// огибающая: линейная атака a, экспоненциальный спад до −40 дБ за d секунд
export const env = (t, a, d) => t < 0 ? 0 : t < a ? t / a : Math.exp(-4.6 * (t - a) / d);

// биквад RBJ (lp / hp / bp с пиком 0 дБ); set() можно звать хоть каждые 16 сэмплов
export class Biquad {
  constructor(type, sr){ this.type = type; this.sr = sr; this.b0 = 1; this.b1 = 0; this.b2 = 0; this.a1 = 0; this.a2 = 0;
    this.x1 = 0; this.x2 = 0; this.y1 = 0; this.y2 = 0; }
  set(f, q){
    const w = TAU * Math.min(Math.max(f, 10), this.sr * 0.45) / this.sr;
    const c = Math.cos(w), al = Math.sin(w) / (2 * q), a0 = 1 + al;
    let b0, b1, b2;
    if (this.type === "lp"){ b0 = (1 - c) / 2; b1 = 1 - c; b2 = b0; }
    else if (this.type === "hp"){ b0 = (1 + c) / 2; b1 = -(1 + c); b2 = b0; }
    else { b0 = al; b1 = 0; b2 = -al; }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = -2 * c / a0; this.a2 = (1 - al) / a0;
    return this;
  }
  run(x){
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

// розовый шум (Paul Kellet, экономичный вариант), нормирован примерно к ±1
export function pinkGen(rng){
  let b0 = 0, b1 = 0, b2 = 0;
  return () => {
    const w = rng() * 2 - 1;
    b0 = 0.99765 * b0 + w * 0.0990460;
    b1 = 0.96300 * b1 + w * 0.2965164;
    b2 = 0.57000 * b2 + w * 1.0526913;
    return (b0 + b1 + b2 + w * 0.1848) * 0.25;
  };
}

export const buf = (sr, sec) => new Float32Array(Math.max(1, Math.ceil(sr * sec)));

// микшируем src в dst со сдвигом off (сек) и усилением g
export function mixInto(dst, src, sr, off, g = 1){
  const o = Math.round(off * sr);
  for (let i = 0; i < src.length && o + i < dst.length; i++) if (o + i >= 0) dst[o + i] += src[i] * g;
  return dst;
}

// короткий фейд на хвосте (и по желанию на входе) — ни одного щелчка на границах буфера
export function fadeEdges(b, sr, outMs = 6, inMs = 0){
  const no = Math.min(b.length, Math.round(sr * outMs / 1000));
  for (let i = 0; i < no; i++) b[b.length - 1 - i] *= i / no;
  const ni = Math.min(b.length, Math.round(sr * inMs / 1000));
  for (let i = 0; i < ni; i++) b[i] *= i / ni;
  return b;
}

// мягкая сатурация (tanh с нормировкой) — «войлочная» плотность без жёсткого клипа
export function soft(b, drive){
  const k = 1 / Math.tanh(drive);
  for (let i = 0; i < b.length; i++) b[i] = Math.tanh(b[i] * drive) * k;
  return b;
}

export function peakOf(b){ let p = 0; for (let i = 0; i < b.length; i++){ const v = Math.abs(b[i]); if (v > p) p = v; } return p; }
export function scaleTo(b, peak){ const p = peakOf(b); if (p > 0) { const k = peak / p; for (let i = 0; i < b.length; i++) b[i] *= k; } return b; }
