// Процедурные CanvasTexture: кремовый кирпич, лавандовый пояс со вставками, плиты верха,
// войлок Гасителей, мягкое свечение, пятно тени, табличка-подсказка.
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

// ---------- кирпич: 2×2 ед. мира на тайл, ряды по 0.5 ед., кирпич 1 ед. со сдвигом полкирпича ----------
export function brickTexture(renderer){
  const S = 128;                    // px на единицу
  const c = canvas(2 * S, 2 * S), g = c.getContext("2d");
  const rnd = makeRng(7);
  g.fillStyle = hex(PAL.mortar); g.fillRect(0, 0, c.width, c.height);
  const rowH = S * 0.5, bw = S * 1.0, m = 3;
  for (let r = 0; r < 4; r++){
    const off = (r % 2) * bw * 0.5;
    for (let i = -1; i < 3; i++){
      const x = i * bw + off, y = r * rowH;
      const k = rnd() * 0.35;
      g.fillStyle = mix(PAL.brick, 0xfff6ee, k * 0.6);
      if (rnd() < 0.18) g.fillStyle = mix(PAL.brick, PAL.mortar, 0.25 + rnd() * 0.15);
      rrect(g, x + m, y + m, bw - 2 * m, rowH - 2 * m, 4); g.fill();
      // мягкая фаска: светлый верх, тёплая тень снизу
      g.fillStyle = "rgba(255,255,255,0.35)"; g.fillRect(x + m + 3, y + m + 1, bw - 2 * m - 6, 3);
      g.fillStyle = "rgba(170,120,120,0.10)"; g.fillRect(x + m + 2, y + rowH - m - 4, bw - 2 * m - 4, 3);
    }
  }
  // лёгкое «зерно»
  const img = g.getImageData(0, 0, c.width, c.height), d = img.data;
  for (let i = 0; i < d.length; i += 4){ const n = (rnd() - 0.5) * 7; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  g.putImageData(img, 0, 0);
  return finish(c, renderer);
}

// ---------- пояс под карнизом: 2 ед. в ширину × 1 ед. в высоту, v = 1 наверху ----------
// сверху вниз: золотая нить, кремовая полоса, ряд лавандовых вставок, нить, полоска кирпича
export function bandTexture(renderer){
  const S = 256;
  const c = canvas(2 * S, S), g = c.getContext("2d");
  const rnd = makeRng(11);
  g.fillStyle = hex(PAL.band); g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = hex(PAL.gold); g.fillRect(0, 0, c.width, S * 0.055);
  g.fillStyle = "rgba(255,255,255,0.6)"; g.fillRect(0, S * 0.055, c.width, 3);
  // вставки: 4 на 2 ед.
  const iy = S * 0.2, ih = S * 0.34, iw = S * 0.26;
  for (let i = 0; i < 4; i++){
    const x = i * S * 0.5 + S * 0.25 - iw / 2;
    g.fillStyle = mix(PAL.inset, PAL.band, 0.55); rrect(g, x - 5, iy - 5, iw + 10, ih + 10, 6); g.fill();
    g.fillStyle = hex(PAL.inset); rrect(g, x, iy, iw, ih, 4); g.fill();
    g.fillStyle = mix(PAL.inset, 0xffffff, 0.22); g.fillRect(x + 4, iy + 4, iw - 8, 5);
    g.fillStyle = mix(PAL.inset, 0x3a2d6b, 0.35); g.fillRect(x + 4, iy + ih - 7, iw - 8, 4);
  }
  // нижняя нить и начало кирпича
  g.fillStyle = hex(PAL.gold); g.fillRect(0, S * 0.66, c.width, S * 0.03);
  g.fillStyle = hex(PAL.mortar); g.fillRect(0, S * 0.69, c.width, S * 0.31);
  const rowY = S * 0.69 + 3, rowH = S * 0.31 - 6, bw = S * 1.0;
  for (let i = 0; i < 3; i++){
    const x = i * bw - bw * 0.5;
    g.fillStyle = mix(PAL.brick, 0xfff6ee, rnd() * 0.25);
    rrect(g, x + 3, rowY, bw - 6, rowH, 5); g.fill();
    g.fillStyle = "rgba(255,255,255,0.35)"; g.fillRect(x + 6, rowY + 2, bw - 12, 3);
  }
  return finish(c, renderer);
}

// ---------- верх стены: светлые плиты 1×1 ед. ----------
export function topTexture(renderer){
  const S = 128;
  const c = canvas(2 * S, 2 * S), g = c.getContext("2d");
  const rnd = makeRng(3);
  g.fillStyle = mix(PAL.top, PAL.mortar, 0.45); g.fillRect(0, 0, c.width, c.height);
  for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++){
    g.fillStyle = mix(PAL.top, 0xffffff, rnd() * 0.3);
    rrect(g, i * S + 3, j * S + 3, S - 6, S - 6, 8); g.fill();
  }
  return finish(c, renderer);
}

// ---------- войлок: тёмные волокна для Гасителей ----------
export function feltTexture(renderer){
  const S = 256, c = canvas(S, S), g = c.getContext("2d");
  const rnd = makeRng(21);
  g.fillStyle = "#8a8098"; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 2600; i++){
    const x = rnd() * S, y = rnd() * S, a = rnd() * Math.PI, L = 4 + rnd() * 10;
    const v = 100 + rnd() * 120;
    g.strokeStyle = `rgba(${v},${v * 0.92},${v * 1.08},${0.25 + rnd() * 0.35})`;
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
