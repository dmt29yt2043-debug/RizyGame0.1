// Процедурные CanvasTexture: сливочная штукатурка-мрамор стен/колонн (широкие флейты, прожилки, зерно),
// тёплая светлая столешница платформ, войлок Гасителей, мягкое свечение, пятно тени, табличка-подсказка.
// Всё рисуется один раз при старте; цвета — из PAL (sRGB), текстуры помечены SRGBColorSpace.
import * as THREE from "three";
import { PAL } from "../config.js";

export function makeRng(seed){
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hex = c => "#" + c.toString(16).padStart(6, "0");
// смешать два цвета (sRGB, 0..1) → css
function mix(a, b, k){
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return `rgb(${Math.round(ar + (br - ar) * k)},${Math.round(ag + (bg - ag) * k)},${Math.round(ab + (bb - ab) * k)})`;
}
// то же, но с альфой — для градиентных стопов
function mixA(a, b, k, alpha){
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return `rgba(${Math.round(ar + (br - ar) * k)},${Math.round(ag + (bg - ag) * k)},${Math.round(ab + (bb - ab) * k)},${alpha})`;
}
function canvas(w, h){ const c = document.createElement("canvas"); c.width = w; c.height = h; return c; }
function finish(c, renderer, repeat = true){
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat){ t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = renderer ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 1;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}
function rrect(g, x, y, w, h, r){
  g.beginPath();
  g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y); g.closePath();
}

// ---------- сливочная штукатурка-мрамор: 2×2 ед. на тайл — широкие мягкие флейты, прожилки, зерно ----------
// (узкие частые флейты читались как гофрокартон — здесь их 4 на тайл, контраст низкий)
export function creamTexture(renderer){
  const S = 128;                    // px на единицу
  const c = canvas(2 * S, 2 * S), g = c.getContext("2d");
  const rnd = makeRng(7);
  g.fillStyle = hex(PAL.cream); g.fillRect(0, 0, c.width, c.height);
  // широкие вертикальные флейты: светлый блик по краю желобка, мягкая тень в глубине
  const nFl = 4, fw = c.width / nFl;
  for (let i = 0; i < nFl; i++){
    const x = i * fw + fw / 2;
    const grd = g.createLinearGradient(x - fw / 2, 0, x + fw / 2, 0);
    grd.addColorStop(0, "rgba(255,255,255,0)");
    grd.addColorStop(0.12, mixA(PAL.cream, 0xffffff, 0.6, 0.55));
    grd.addColorStop(0.3, mixA(PAL.cream, 0x8a7258, 0.10, 0.35));
    grd.addColorStop(0.5, mixA(PAL.cream, 0x8a7258, 0.16, 0.4));
    grd.addColorStop(0.72, mixA(PAL.cream, 0xffffff, 0.3, 0.3));
    grd.addColorStop(0.9, "rgba(255,255,255,0)");
    g.fillStyle = grd; g.fillRect(x - fw / 2, 0, fw, c.height);
  }
  // мраморные прожилки — редкие, очень бледные
  g.lineCap = "round";
  for (let k = 0; k < 5; k++){
    let x = rnd() * c.width, y = rnd() * c.height;
    g.strokeStyle = `rgba(190,160,140,${0.08 + rnd() * 0.08})`; g.lineWidth = 0.8 + rnd() * 1.4;
    g.beginPath(); g.moveTo(x, y);
    for (let j = 0; j < 6; j++){ x += (rnd() - 0.3) * 60; y += (rnd() - 0.5) * 50; g.lineTo(x, y); }
    g.stroke();
  }
  // шов раз в 2 ед. (тонкая тень + блик)
  g.fillStyle = "rgba(150,125,95,0.10)"; g.fillRect(0, 0, c.width, 2);
  g.fillStyle = "rgba(255,255,255,0.35)"; g.fillRect(0, 2, c.width, 1);
  // лёгкое «зерно» штукатурки
  const img = g.getImageData(0, 0, c.width, c.height), d = img.data;
  for (let i = 0; i < d.length; i += 4){ const n = (rnd() - 0.5) * 5; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  g.putImageData(img, 0, 0);
  return finish(c, renderer);
}

// ---------- столешница платформы: светлая гладкая плита со слабыми круговыми швами ----------
export function creamTopTexture(renderer){
  const S = 128;
  const c = canvas(2 * S, 2 * S), g = c.getContext("2d");
  const rnd = makeRng(3);
  // чуть теплее самих сливок: верх освещён лавандовым небом и без этого уходит в розовый
  const warm = 0xf7ead6;
  g.fillStyle = hex(warm); g.fillRect(0, 0, c.width, c.height);
  for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++){
    g.fillStyle = mix(warm, 0xfff8ee, 0.25 + rnd() * 0.3);
    rrect(g, i * S + 4, j * S + 4, S - 8, S - 8, 10); g.fill();
  }
  const img = g.getImageData(0, 0, c.width, c.height), d = img.data;
  for (let i = 0; i < d.length; i += 4){ const n = (rnd() - 0.5) * 5; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  g.putImageData(img, 0, 0);
  return finish(c, renderer);
}

// ---------- войлок: тёмно-фиолетовые волокна для Гасителей ----------
export function feltTexture(renderer){
  const S = 256, c = canvas(S, S), g = c.getContext("2d");
  const rnd = makeRng(21);
  g.fillStyle = "#453a68"; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 2600; i++){
    const x = rnd() * S, y = rnd() * S, a = rnd() * Math.PI, L = 4 + rnd() * 10;
    const v = 70 + rnd() * 110;
    g.strokeStyle = `rgba(${v * 0.92},${v * 0.8},${v * 1.18},${0.25 + rnd() * 0.35})`;
    g.lineWidth = 0.8 + rnd();
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * L, y + Math.sin(a) * L); g.stroke();
  }
  return finish(c, renderer);
}

// ---------- мягкое радиальное свечение (белое; цвет — у материала/инстанса) ----------
export function glowTexture(){
  const S = 128, c = canvas(S, S), g = c.getContext("2d");
  const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, "rgba(255,255,255,1)");
  gr.addColorStop(0.22, "rgba(255,255,255,0.55)");
  gr.addColorStop(0.55, "rgba(255,255,255,0.14)");
  gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------- пятно контактной тени: белое пятно на чёрном (для смешивания «умножением») ----------
export function blobTexture(){
  const S = 128, c = canvas(S, S), g = c.getContext("2d");
  g.fillStyle = "#000"; g.fillRect(0, 0, S, S);
  const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, "#fff");
  gr.addColorStop(0.5, "#d6d6d6");
  gr.addColorStop(0.8, "#5a5a5a");
  gr.addColorStop(1, "#000");
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  return new THREE.CanvasTexture(c);
}

// ---------- табличка-подсказка: белая плашка с тёмно-синей обводкой, на двух ножках ----------
// возвращает { texture, aspect } — плоскость делаем с этим соотношением сторон
export function signTexture(lines, renderer){
  const W = 640, H = 330, c = canvas(W, H), g = c.getContext("2d");
  const ink = hex(PAL.ink);
  // ножки
  g.fillStyle = "#b8a6d8"; g.strokeStyle = ink; g.lineWidth = 7;
  for (const x of [W * 0.3, W * 0.7]){ g.fillRect(x - 12, H * 0.55, 24, H * 0.45); g.strokeRect(x - 12, H * 0.55, 24, H * 0.45 + 10); }
  // тень плашки
  g.fillStyle = ink; rrect(g, 14, 22, W - 28, H * 0.66, 30); g.fill();
  // плашка
  g.fillStyle = "#ffffff"; g.strokeStyle = ink; g.lineWidth = 9;
  rrect(g, 14, 10, W - 28, H * 0.66, 30); g.fill(); g.stroke();
  // лаймовая подводка снизу
  g.fillStyle = hex(PAL.lime); g.fillRect(40, 10 + H * 0.66 - 22, W - 80, 10);
  g.textAlign = "center"; g.textBaseline = "middle";
  const font = '"RizyNunito","Nunito","Arial Rounded MT Bold",system-ui,sans-serif';
  const fit = (txt, size) => { g.font = `900 ${size}px ${font}`; while (g.measureText(txt).width > W - 90 && size > 20){ size -= 2; g.font = `900 ${size}px ${font}`; } return size; };
  const y0 = 10 + H * 0.66 / 2;
  if (lines.length === 1){ fit(lines[0], 70); g.fillStyle = ink; g.fillText(lines[0], W / 2, y0); }
  else {
    fit(lines[0], 46); g.fillStyle = hex(PAL.blue); g.fillText(lines[0], W / 2, y0 - 34);
    fit(lines[1], 60); g.fillStyle = ink; g.fillText(lines[1], W / 2, y0 + 30);
  }
  const t = finish(c, renderer, false);
  return { texture: t, aspect: W / H };
}
