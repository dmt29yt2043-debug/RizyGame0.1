// Ориентиры-«открытки»: по одному крупному объекту среднего плана на участок уровня (столп «каждый
// участок — новая открытка», docs/plan.md) — фонтан, акведук, золотое колесо (день), оранжерея, телескоп,
// лунные ворота (ночь). Стоят за игровой плоскостью (z от −8.5 до −15.5), x — из середины участка уровня
// (SECTION_OFFSET — поправка для конкретного ориентира, если середина участка занята геймплеем, см. ниже).
// В стиле стен: сливки/золото/хром — геометрия сливается в те же Batch'и, что buildWalls() (walls.js),
// поэтому НЕ добавляет новых draw call'ов. Светящиеся акценты (искры на кристалле фонтана, окна-арки на
// стволе телескопа…) — не геометрия, а точки для общего «живого» слоя life.js (тоже без лишних draw
// call'ов): каждая функция-ориентир возвращает список точек-искр, при b=null геометрия не строится вовсе
// (life.js дёшево забирает только точки). buildLandmarks() (геометрия) и landmarkGlowSpots() (искры для
// life.js) обязаны считать одинаковый x для секции — иначе искры разъедутся с геометрией; общий расчёт —
// в sectionX().
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

// 5. «Лианы и Гасители» — башня-обсерватория: сужающийся ствол в тоне ночных стен (сливки в лунном
// свете — см. walls.js NIGHT_TOP) с золотыми поясами и тёплыми окнами-арками (точки, life.js
// scatterWindows их не видит — ствол уже, отдельные искры-«окна» ниже), купол-обсерватория в золотых
// рёбрах, латунный (золотой, не голый хром) телескоп на маленькой поворотной опоре, нацеленный в небо.
// Раньше был голым серым конусом без окон; теперь — глубже в Z (дальний план, слегка в ночную дымку —
// см. scene.fog в main.js, тут просто холоднее/темнее тон) и стволу задан x со сдвигом от середины
// участка (SECTION_OFFSET), чтобы не торчать посреди кадра ровно там, где игрок лазает по лианам.
const TOWER_TRUNK = 0xd2d7e8;
// topY − gy держим заметно меньше видимой по вертикали зоны камеры на этом участке (ground здесь и так
// высоко, ≈16.6 — см. sectionX/NIGHT_OFFSET), иначе купол с телескопом упираются в верхний край кадра
function telescopeLandmark(b, x, gy){
  const Z = -15.5, topY = gy + 7.0, tubeLen = 1.3, ang = 0.6;
  const tipY = topY + tubeLen * Math.cos(ang), tipZ = Z + tubeLen * Math.sin(ang);
  const domeR = 0.36;
  if (b){
    const seg = 4;
    for (let i = 0; i < seg; i++){
      const y0 = gy + (topY - gy) * i / seg, y1 = gy + (topY - gy) * (i + 1) / seg;
      const r0 = 0.74 - 0.42 * i / seg, r1 = 0.74 - 0.42 * (i + 1) / seg;
      cyl(b.top, x, (y0 + y1) / 2, Z, r1, r0, y1 - y0, TOWER_TRUNK, 14);
      ring(b.gold, x, y1, Z, r1 + 0.02, 0.045, PAL.gold, 16);
    }
    // купол-обсерватория: светлее и холоднее ствола (иначе сливается с ним) — золотые рёбра-меридианы
    const dome = new THREE.SphereGeometry(domeR, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.58);
    b.top.add(dome, new THREE.Matrix4().makeTranslation(x, topY, Z), 0xeef1fb); dome.dispose();
    for (let k = 1; k <= 2; k++){
      const h = domeR * 0.62 * (k / 2), rr = Math.sqrt(Math.max(0, domeR * domeR - h * h));
      ring(b.gold, x, topY + h, Z, rr, 0.02, PAL.gold, 14);
    }
    // латунный (золотой) телескоп на поворотной опоре: хромовый шарнир-вилка → золотая труба → объектив
    ball(b.chrome, x, topY + 0.04, Z, 0.1, PAL.chrome, 8);
    const tg = new THREE.CylinderGeometry(0.13, 0.17, tubeLen, 12); tg.translate(0, tubeLen / 2, 0);
    const tm = new THREE.Matrix4().makeTranslation(x, topY, Z).multiply(new THREE.Matrix4().makeRotationX(ang));
    b.gold.add(tg, tm, PAL.gold); tg.dispose();
    ring(b.gold, x, tipY, tipZ, 0.17, 0.026, PAL.gold, 12, ang - H);                        // объектив
    const eyeY = topY + Math.cos(ang) * 0.3, eyeZ = Z + Math.sin(ang) * 0.3;
    ring(b.chrome, x, eyeY, eyeZ, 0.155, 0.02, PAL.chrome, 10, ang - H);                    // окуляр
  }
  // окна-арки по стволу (пары огоньков на трёх уровнях) + блик на объективе/куполе — z СТРОГО перед
  // поверхностью ствола/купола (полный радиус на этой высоте + запас), иначе точку прячет собственная
  // сплошная геометрия ствола (Points рисуются с depthTest, глушатся непрозрачным мешем позади себя).
  // Запас — не косметика: near/far камеры (0.5/1400, см. main.js) дают грубый буфер глубины на игровых
  // дистанциях — точка иногда проигрывает z-тест и пропадает целиком (проверено на глаз на окнах стен,
  // см. life.js scatterWindows); 0.3 того же порядка, что у остальных искр-акцентов этого файла — не пропадают.
  const spots = [];
  for (let k = 0; k < 3; k++){
    const h = (k + 0.6) / 3.4 * (topY - gy), trueR = 0.74 - 0.42 * h / (topY - gy);
    for (const side of [-1, 1]) spots.push({ x: x + side * trueR * 0.55, y: gy + h, z: Z + trueR + 0.3, color: 0xffc98a, size: 0.15 });
  }
  spots.push({ x, y: tipY, z: tipZ + 0.3, color: 0xcfe0ff, size: 0.22 });
  spots.push({ x, y: topY + domeR * 0.3, z: Z + domeR + 0.3, color: 0xe6ecff, size: 0.13 });
  return spots;
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
// поправка по x от середины участка — только там, где середина занята геймплеем. Участок 2 ночи
// («Лианы и Гасители», x 80…148, середина x=114) — это ровно пилон-опора лианы v5 (pil5, x≈113.9) с
// патрулирующим Гасителем рядом: телескоп там торчал посреди кадра прямо на маршруте лазания (см. задачу
// полировки). Сдвигаем к x=98 — это открытая стена g7, без пилонов/лиан/патрулей под ней.
const NIGHT_OFFSET = [0, -16, 0];

// x середины участка с поправкой (если есть) — ОБЩИЙ для buildLandmarks и landmarkGlowSpots расчёт: геометрия
// и искры-акценты обязаны совпадать по x, иначе искры «отклеятся» от объекта.
function sectionX(sec, i, night){
  return (sec.x0 + sec.x1) / 2 + (night ? (NIGHT_OFFSET[i] || 0) : 0);
}

// строит геометрию ориентиров прямо в Batch'и стен (B.top/B.gold/B.chrome — см. walls.js buildWalls);
// x — середина каждого участка уровня (level.sections), см. sectionX(). Возвращает точки-искры (как
// landmarkGlowSpots).
export function buildLandmarks(level, night, B){
  const fns = night ? NIGHT_FNS : DAY_FNS;
  const spots = [];
  (level.sections || []).forEach((sec, i) => {
    const fn = fns[i]; if (!fn) return;
    const x = sectionX(sec, i, night), gy = groundNear(level, x);
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
    const x = sectionX(sec, i, night), gy = groundNear(level, x);
    const s = fn(null, x, gy);
    if (s) spots.push(...s);
  });
  return spots;
}
