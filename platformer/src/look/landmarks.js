// Ориентиры-«открытки»: по одному крупному объекту среднего плана на участок уровня (столп «каждый
// участок — новая открытка», docs/plan.md) — фонтан, акведук, золотое колесо (день), оранжерея, телескоп,
// лунные ворота (ночь). Стоят за игровой плоскостью (z от −8.5 до −11), x — из середины участка уровня.
// В стиле стен: сливки/золото/хром — геометрия сливается в те же Batch'и, что buildWalls() (walls.js),
// поэтому НЕ добавляет новых draw call'ов. Светящиеся акценты (искры на кристалле фонтана, линза
// телескопа…) — не геометрия, а точки для общего «живого» слоя life.js (тоже без лишних draw call'ов):
// каждая функция-ориентир возвращает список точек-искр, при b=null геометрия не строится вовсе (life.js
// дёшево забирает только точки).
import * as THREE from "three";
import { PAL } from "../config.js";

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const H = Math.PI / 2;

// ---------- примитивы: добавляют геометрию прямо в Batch (b.top/b.gold/b.chrome — из walls.js) ----------
function cyl(b, x, y, z, rTop, rBot, h, color, seg = 14, rx = 0){
  const g = new THREE.CylinderGeometry(Math.max(0.001, rTop), Math.max(0.001, rBot), Math.max(0.001, h), seg);
  const m = new THREE.Matrix4().compose(V(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, 0, 0)), V(1, 1, 1));
  b.add(g, m, color); g.dispose();
}
function torus(b, x, y, z, r, tube, color, seg, rx, arc){
  const g = new THREE.TorusGeometry(Math.max(0.05, r), Math.max(0.008, tube), 8, seg, arc);
  const m = new THREE.Matrix4().compose(V(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, 0, 0)), V(1, 1, 1));
  b.add(g, m, color); g.dispose();
}
const ring = (b, x, y, z, r, tube, color, seg = 20, rx = H) => torus(b, x, y, z, r, tube, color, seg, rx, Math.PI * 2);
const arch = (b, x, y, z, r, tube, color, seg = 16, rx = 0) => torus(b, x, y, z, r, tube, color, seg, rx, Math.PI);
function ball(b, x, y, z, r, color, seg = 10){
  const g = new THREE.SphereGeometry(Math.max(0.02, r), seg, Math.max(4, Math.ceil(seg * 0.7)));
  b.add(g, new THREE.Matrix4().makeTranslation(x, y, z), color); g.dispose();
}
function box(b, x, y, z, sx, sy, sz, color){
  const g = new THREE.BoxGeometry(Math.max(0.02, sx), Math.max(0.02, sy), Math.max(0.02, sz));
  b.add(g, new THREE.Matrix4().makeTranslation(x, y, z), color); g.dispose();
}

// ближайшая опорная высота (верх стены рядом с x) — сажаем ориентир на «свою» глубину логично, не в пропасть
function groundNear(level, x){
  let best = null, bd = Infinity;
  for (const s of level.solids){
    const d = x < s.x0 ? s.x0 - x : x > s.x1 ? x - s.x1 : 0;
    if (d < bd){ bd = d; best = s; }
  }
  return best ? best.y1 : 0;
}

// ================= ДЕНЬ (L1) =================

// 1. «Разминка» — фонтан с колоннадой: широкая чаша на хромовой ножке, тонкая бирюзовая струя-искра,
// полукруг из 5 сливочных колонн позади
function fountainLandmark(b, x, gy){
  const Z = -9.4;
  if (b){
    cyl(b.top, x, gy + 0.55, Z, 2.15, 1.95, 0.5, 0xffffff, 20);
    ring(b.gold, x, gy + 0.82, Z, 2.12, 0.07, PAL.gold, 24);
    cyl(b.chrome, x, gy + 0.25, Z, 0.55, 0.85, 0.5, PAL.chrome, 16);
    cyl(b.top, x, gy + 0.06, Z, 0.9, 1.0, 0.14, 0xf3ead9, 16);
    cyl(b.top, x, gy + 1.5, Z, 0.4, 0.5, 1.4, 0xf3ead9, 14);
    ring(b.gold, x, gy + 2.15, Z, 0.42, 0.05, PAL.gold, 16);
    cyl(b.chrome, x, gy + 2.5, Z, 0.28, 0.36, 0.4, PAL.chrome, 14);
    cyl(b.chrome, x, gy + 2.9, Z, 0.05, 0.22, 0.6, 0x9fece0, 10);
    for (let i = 0; i < 5; i++){
      const t = (i / 4 - 0.5) * 2.1, cx = x + t * 1.65, cz = Z - 1.9 - Math.abs(t) * 0.35, h = 3.6 - Math.abs(t) * 0.5;
      cyl(b.top, cx, gy + h / 2, cz, 0.16, 0.19, h, 0xf6efe2, 10);
      ring(b.gold, cx, gy + h * 0.86, cz, 0.19, 0.035, PAL.gold, 12);
      ring(b.gold, cx, gy + 0.14, cz, 0.21, 0.04, PAL.gold, 12);
      ball(b.chrome, cx, gy + h + 0.1, cz, 0.14, PAL.chrome, 8);
    }
  }
  return [
    { x, y: gy + 3.55, z: Z + 0.35, color: 0xa8f2e2, size: 0.55 },
    { x: x - 1.05, y: gy + 0.85, z: Z + 0.2, color: PAL.gold, size: 0.16 },
    { x: x + 1.05, y: gy + 0.85, z: Z + 0.2, color: PAL.gold, size: 0.16 },
  ];
}

// 2. «Гасители» — акведук: 3 сливочных арки-пролёта с золотой окантовкой на быках, дорожный настил сверху
function aqueductLandmark(b, x, gy){
  const R = 1.9, n = 3, span = 3.7, Z = -10.2;
  if (b){
    for (let i = 0; i < n; i++){
      const cx = x + (i - (n - 1) / 2) * span;
      box(b.top, cx - span / 2, gy + R * 0.5, Z, 0.45, R * 1.0, 1.25, 0xf3ead9);
      arch(b.top, cx, gy + R * 0.05, Z, R, 0.2, 0xf3ead9, 16, 0);
      arch(b.gold, cx, gy + R * 0.05, Z, R, 0.045, PAL.gold, 16, 0);
    }
    box(b.top, x + (n - 1) / 2 * span + span / 2, gy + R * 0.5, Z, 0.45, R * 1.0, 1.25, 0xf3ead9);
    const totalW = span * (n - 1) + span + 0.9;
    box(b.gold, x, gy + R * 2 + 0.14, Z, totalW, 0.22, 1.15, PAL.gold);
    box(b.top, x, gy + R * 2 - 0.08, Z, totalW, 0.3, 0.95, 0xf6efe2);
  }
  const glows = [];
  for (let i = 0; i < n; i++) glows.push({ x: x + (i - (n - 1) / 2) * span, y: gy + R * 2 + 0.22, z: Z + 0.65, color: PAL.gold, size: 0.15 });
  return glows;
}

// 3. «Рывок» — золотое солнце-колесо на хромовой мачте, 8 спиц, самоцветные искры на ободе
function wheelLandmark(b, x, gy){
  const R = 3.0, Z = -11.2, mountH = 1.6, cy = gy + mountH;
  const spokes = 8;
  if (b){
    cyl(b.chrome, x, gy + mountH / 2, Z, 0.3, 0.4, mountH, PAL.chrome, 12);
    ring(b.gold, x, cy, Z, R, 0.11, PAL.gold, 28, 0);
    ring(b.gold, x, cy, Z, R * 0.62, 0.07, PAL.gold, 22, 0);
    for (let i = 0; i < spokes; i++){
      const a = i / spokes * Math.PI * 2;
      const g = new THREE.CylinderGeometry(0.045, 0.045, R, 6); g.translate(0, R / 2, 0);
      const m = new THREE.Matrix4().makeTranslation(x, cy, Z).multiply(new THREE.Matrix4().makeRotationZ(a));
      b.gold.add(g, m, PAL.gold); g.dispose();
    }
    ball(b.chrome, x, cy, Z, 0.22, PAL.chrome, 10);
  }
  const glows = [];
  for (let i = 0; i < spokes; i++){
    const a = i / spokes * Math.PI * 2;
    glows.push({ x: x + Math.cos(a) * R, y: cy + Math.sin(a) * R, z: Z + 0.3, color: 0xfff0c0, size: 0.14 });
  }
  return glows;
}

// ================= НОЧЬ (L2) =================

// 4. «Обучение лазанию» — светящаяся оранжерея-купол: полусфера в золотых поясах на сливочном барабане
function domeLandmark(b, x, gy){
  const R = 2.6, Z = -9.2, baseH = 1.0, cy = gy + baseH;
  if (b){
    cyl(b.top, x, gy + baseH / 2, Z, R * 0.98, R, baseH, 0xe9f2ea, 22);
    ring(b.gold, x, cy, Z, R * 0.99, 0.07, PAL.gold, 24);
    const g = new THREE.SphereGeometry(R, 22, 12, 0, Math.PI * 2, 0, Math.PI * 0.55);
    b.top.add(g, new THREE.Matrix4().makeTranslation(x, cy, Z), 0xe3f5e8); g.dispose();
    for (let k = 1; k <= 3; k++){
      const h = R * (k / 4), rr = Math.sqrt(Math.max(0, R * R - h * h));
      ring(b.gold, x, cy + h, Z, rr, 0.04, PAL.gold, 20);
    }
    ball(b.gold, x, cy + R, Z, 0.16, PAL.gold, 8);
  }
  const glows = [];
  for (let i = 0; i < 9; i++){
    const a = (i / 9) * Math.PI * 2, h = R * (0.15 + 0.6 * ((i * 37) % 5) / 5);
    const rr = Math.sqrt(Math.max(0, R * R - h * h)) * 0.92;
    glows.push({ x: x + Math.cos(a) * rr, y: cy + h, z: Z + Math.sin(a) * rr * 0.35 + 0.55, color: 0xd7ffe0, size: 0.13 });
  }
  return glows;
}

// 5. «Лианы и Гасители» — башня-телескоп: сужающийся ствол в золотых поясах, купол, наклонная труба-объектив
function telescopeLandmark(b, x, gy){
  const Z = -11.4, topY = gy + 9.5, tubeLen = 1.8, ang = 0.65;
  const tipY = topY + tubeLen * Math.cos(ang), tipZ = Z + tubeLen * Math.sin(ang);
  if (b){
    const seg = 5;
    for (let i = 0; i < seg; i++){
      const y0 = gy + (topY - gy) * i / seg, y1 = gy + (topY - gy) * (i + 1) / seg;
      const r0 = 0.75 - 0.45 * i / seg, r1 = 0.75 - 0.45 * (i + 1) / seg;
      cyl(b.top, x, (y0 + y1) / 2, Z, r1, r0, y1 - y0, 0xefe6d6, 14);
      ring(b.gold, x, y1, Z, r1 + 0.02, 0.045, PAL.gold, 16);
    }
    const dome = new THREE.SphereGeometry(0.42, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.6);
    b.chrome.add(dome, new THREE.Matrix4().makeTranslation(x, topY, Z), PAL.chrome); dome.dispose();
    const tg = new THREE.CylinderGeometry(0.15, 0.19, tubeLen, 12); tg.translate(0, tubeLen / 2, 0);
    const tm = new THREE.Matrix4().makeTranslation(x, topY, Z).multiply(new THREE.Matrix4().makeRotationX(ang));
    b.chrome.add(tg, tm, PAL.chrome); tg.dispose();
    ring(b.gold, x, tipY, tipZ, 0.19, 0.028, PAL.gold, 12, ang - H);
  }
  return [
    { x, y: tipY, z: tipZ + 0.08, color: 0xcfe0ff, size: 0.24 },
    { x, y: topY + 0.5, z: Z + 0.25, color: 0xe6ecff, size: 0.14 },
  ];
}

// 6. «Комбинации» — лунные ворота: хромово-золотое кольцо-арка на двух сливочных пилонах
function gateLandmark(b, x, gy){
  const R = 2.3, Z = -8.6, cy = gy + R + 0.3;
  if (b){
    box(b.top, x - R - 0.3, gy + (R + 0.3) / 2, Z, 0.55, R + 0.3, 1.3, 0xe9ecf5);
    box(b.top, x + R + 0.3, gy + (R + 0.3) / 2, Z, 0.55, R + 0.3, 1.3, 0xe9ecf5);
    ring(b.chrome, x, cy, Z, R, 0.28, 0xdfe6f2, 26, 0);
    ring(b.gold, x, cy, Z, R + 0.03, 0.06, PAL.gold, 26, 0);
    ring(b.gold, x, cy, Z, R - 0.28, 0.05, PAL.gold, 22, 0);
    ball(b.gold, x, cy + R, Z, 0.17, PAL.gold, 8);
  }
  return [
    { x, y: cy + R, z: Z + 0.35, color: 0xdfe8ff, size: 0.3 },
    { x: x - R * 0.7, y: cy + R * 0.7, z: Z + 0.3, color: 0xcfe0ff, size: 0.16 },
    { x: x + R * 0.7, y: cy + R * 0.7, z: Z + 0.3, color: 0xcfe0ff, size: 0.16 },
  ];
}

const DAY_FNS = [fountainLandmark, aqueductLandmark, wheelLandmark];
const NIGHT_FNS = [domeLandmark, telescopeLandmark, gateLandmark];

// строит геометрию ориентиров прямо в Batch'и стен (B.top/B.gold/B.chrome — см. walls.js buildWalls);
// x — середина каждого участка уровня (level.sections). Возвращает точки-искры (как landmarkGlowSpots).
export function buildLandmarks(level, night, B){
  const fns = night ? NIGHT_FNS : DAY_FNS;
  const spots = [];
  (level.sections || []).forEach((sec, i) => {
    const fn = fns[i]; if (!fn) return;
    const x = (sec.x0 + sec.x1) / 2, gy = groundNear(level, x);
    const s = fn(B, x, gy);
    if (s) spots.push(...s);
  });
  return spots;
}

// только точки-искры, без геометрии (используется life.js — не тянет за собой Batch/three-геометрию стен)
export function landmarkGlowSpots(level, night){
  const fns = night ? NIGHT_FNS : DAY_FNS;
  const spots = [];
  (level.sections || []).forEach((sec, i) => {
    const fn = fns[i]; if (!fn) return;
    const x = (sec.x0 + sec.x1) / 2, gy = groundNear(level, x);
    const s = fn(null, x, gy);
    if (s) spots.push(...s);
  });
  return spots;
}
