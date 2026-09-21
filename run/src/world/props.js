// world-kit: библиотека геометрий — ближний/средний декор, фонарь, препятствия, энергон.
// Каждая функция возвращает слитые BufferGeometry (цвета вершин, «полосы» через uv.y = 1, запечённый AO у основания).
// Всё строится один раз при создании кита.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { GeoBuilder, M } from "./util.js";

const PI = Math.PI;
const cyl = (rt, rb, h, seg = 10, hs = 1, open = false) => new THREE.CylinderGeometry(rt, rb, h, seg, hs, open);
const cone = (r, h, seg = 12) => new THREE.ConeGeometry(r, h, seg);
const sph = (r, ws = 12, hs = 8) => new THREE.SphereGeometry(r, ws, hs);
const hemi = (r, ws = 12, hs = 6) => new THREE.SphereGeometry(r, ws, hs, 0, PI * 2, 0, PI / 2);
const rbox = (w, h, d, r = 0.06, s = 1) => new RoundedBoxGeometry(w, h, d, s, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3));
const tube = (pts, seg, r, rs = 8) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(p[0], p[1], p[2]))), seg, r, rs, false);
const V = (x, y, z) => [x, y, z];
// треугольная призма: основание w по x, вершина h по y, длина len по z (центр основания в начале координат)
export function prism(w, h, len){
  const s = new THREE.Shape(); s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(0, h); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: len, bevelEnabled: false }); g.translate(0, 0, -len / 2);
  return g;
}
export { swapUV, tube, rbox, cyl, cone, sph, hemi };
const AO = [0, 0.55, 0.62];                         // затемнение у основания: от y=0, высота 0.55 м, минимум 62%

// TubeGeometry: uv.x — вдоль трубы, uv.y — вокруг; наш «tube»-режим ждёт наоборот → меняем местами
function swapUV(g){ const a = g.attributes.uv.array; for (let i = 0; i < a.length; i += 2){ const t = a[i]; a[i] = a[i + 1]; a[i + 1] = t; } return g; }

// ---------- БЛИЖНИЙ СЛОЙ (высота ≤ 2.2 м, ≤ 800 треугольников) ----------
export function nearCane(){
  const b = new GeoBuilder();
  const t = swapUV(tube([V(0, 0, 0), V(0, 0.7, 0), V(0, 1.35, 0), V(0.12, 1.62, 0), V(0.36, 1.66, 0), V(0.5, 1.48, 0), V(0.5, 1.3, 0)], 28, 0.075, 8));
  b.add(t, 0xEFA3B4, null, { stripe: { period: 0.26, len: 2.2, turns: 1 } });
  b.add(hemi(0.22, 10, 4), 0xffffff, M(0, -0.02, 0, 0, 0, 0, 1, 0.45, 1));
  return b.build();
}
export function nearFence(){
  // пряничный забор, сегмент 3 м вдоль −z: столбик в начале + две перекладины + глазурь
  const b = new GeoBuilder(), br = 0xC9925F, ic = 0xFFF8F0;
  b.add(rbox(0.18, 1.05, 0.18, 0.05), br, M(0, 0.52, 0), { ao: AO });
  b.add(cone(0.14, 0.2, 8), ic, M(0, 1.14, 0));
  for (const y of [0.38, 0.78]){
    b.add(rbox(0.09, 0.13, 3.0, 0.03), br, M(0, y, -1.5));
    b.add(rbox(0.1, 0.035, 3.0, 0.015), ic, M(0, y + 0.08, -1.5));
  }
  // волнистая глазурь-зигзаг на верхней перекладине
  for (let i = 0; i < 6; i++) b.add(sph(0.05, 5, 3), ic, M(0, 0.7 - (i % 2) * 0.05, -0.25 - i * 0.5));
  return b.build();
}
export function nearLolliTree(){
  const b = new GeoBuilder();
  b.add(cyl(0.05, 0.05, 1.35, 8, 4), 0xF3EEF6, M(0, 0.675, 0), { stripe: { period: 0.3, len: 1.35, turns: 1 } });
  b.add(cyl(0.44, 0.44, 0.14, 22), 0x9FD6C1, M(0, 1.72, 0, PI / 2, 0, 0));
  b.add(new THREE.TorusGeometry(0.27, 0.05, 6, 22), 0xffffff, M(0, 1.72, 0.075));
  b.add(new THREE.TorusGeometry(0.12, 0.04, 6, 16), 0xF2B7C6, M(0, 1.72, 0.08));
  b.add(hemi(0.2, 10, 4), 0xffffff, M(0, 2.1, 0, 0, 0, 0, 1.4, 0.5, 0.5));
  return b.build();
}
export function nearHummock(){
  const g = new THREE.SphereGeometry(1, 16, 6, 0, PI * 2, 0, PI / 2);
  const b = new GeoBuilder();
  b.add(g, 0xffffff, M(0, -0.05, 0, 0, 0, 0, 1.15, 0.52, 0.95));
  b.add(g, 0xffffff, M(0.7, -0.05, -0.5, 0, 0, 0, 0.6, 0.36, 0.55));
  return b.build();
}
export function nearFir(){
  const b = new GeoBuilder(), gr = 0x8CC7A6;
  b.add(cyl(0.08, 0.1, 0.35, 6), 0xA7795A, M(0, 0.17, 0), { ao: AO });
  const T = [[0.72, 0.8, 0.62], [0.55, 0.72, 1.12], [0.38, 0.62, 1.55]];
  for (const [r, h, y] of T){
    b.add(cone(r, h, 12), gr, M(0, y, 0), { ao: AO, keepUV: true });
    b.add(cone(r * 0.62, h * 0.42, 12), 0xffffff, M(0, y + h * 0.24, 0), { keepUV: true });
  }
  return b.build();
}
export function nearSnowman(){
  const b = new GeoBuilder(), w = 0xF6F8FF;
  b.add(sph(0.4, 11, 6), w, M(0, 0.36, 0), { ao: AO, keepUV: true });
  b.add(sph(0.29, 10, 6), w, M(0, 0.93, 0), { keepUV: true });
  b.add(sph(0.21, 9, 5), w, M(0, 1.35, 0), { keepUV: true });
  b.add(cone(0.05, 0.26, 8), 0xF2A36B, M(0, 1.36, 0.3, PI / 2, 0, 0));
  b.add(cyl(0.15, 0.15, 0.2, 12), 0x4A5A9E, M(0, 1.62, 0));
  b.add(cyl(0.24, 0.24, 0.03, 14), 0x4A5A9E, M(0, 1.52, 0));
  b.add(new THREE.TorusGeometry(0.22, 0.06, 6, 14), 0xE58FA0, M(0, 1.14, 0, PI / 2, 0, 0));
  for (const x of [-0.07, 0.07]) b.add(sph(0.03, 6, 4), 0x2A2F55, M(x, 1.42, 0.18));
  for (const y of [0.85, 0.98]) b.add(sph(0.035, 6, 4), 0x2A2F55, M(0, y, 0.28));
  return b.build();
}

// ---------- СРЕДНИЙ СЛОЙ (4–9 м, ≤ 2500 треугольников) ----------
export function midTreeA(){
  const b = new GeoBuilder(), gr = 0x7FBF98;
  b.add(cyl(0.22, 0.3, 1.0, 8), 0x9A6E52, M(0, 0.5, 0), { ao: AO });
  const T = [[2.1, 2.2, 1.7], [1.7, 2.0, 2.9], [1.3, 1.8, 4.0], [0.85, 1.5, 5.0]];
  for (const [r, h, y] of T){
    b.add(cone(r, h, 16), gr, M(0, y, 0), { ao: [0, 1.4, 0.6], keepUV: true });
    b.add(cone(r * 0.64, h * 0.4, 16), 0xffffff, M(0, y + h * 0.3, 0), { keepUV: true });
  }
  return b.build();
}
export function midTreeB(){
  const b = new GeoBuilder(), gr = 0x86BFB4;
  b.add(cyl(0.2, 0.26, 1.0, 8), 0x9A6E52, M(0, 0.5, 0), { ao: AO });
  const T = [[1.55, 1.6], [1.25, 2.75], [0.92, 3.75], [0.58, 4.55]];
  for (const [r, y] of T){
    b.add(sph(r, 16, 10), gr, M(0, y, 0, 0, 0, 0, 1, 0.72, 1), { ao: [0, 1.4, 0.6], keepUV: true });
    b.add(hemi(r * 0.78, 14, 5), 0xffffff, M(0, y + r * 0.34, 0, 0, 0, 0, 1, 0.42, 1), { keepUV: true });
  }
  b.add(sph(0.22, 10, 8), 0xF4E6B8, M(0, 5.0, 0));
  return b.build();
}
// пряничный домик: { body (войлок), win (свечение окон) }
function house(o){
  const b = new GeoBuilder(), g = new GeoBuilder();
  const { w, h, d, wall, roof } = o;
  b.add(rbox(w, h, d, 0.12, 2), wall, M(0, h / 2, 0), { ao: [0, 0.9, 0.62] });
  // крыша — треугольная призма (цилиндр с 3 гранями), глазурь по краю, толстый снег сверху
  const rh = h * 0.55;
  b.add(prism(w + 0.5, rh, d + 0.5), roof, M(0, h - 0.02, 0));
  b.add(prism(w + 0.42, rh * 0.92, d + 0.62), 0xffffff, M(0, h + rh * 0.14, 0));
  b.add(rbox(0.5, 1.0, 0.5, 0.06), 0xC08A66, M(w * 0.22, h + rh * 0.8, -d * 0.15));
  b.add(rbox(0.62, 0.18, 0.62, 0.06), 0xffffff, M(w * 0.22, h + rh * 0.8 + 0.55, -d * 0.15));
  // дверь, рамы, глазурь по фасаду
  b.add(rbox(0.8, 1.3, 0.12, 0.08), 0x9A6448, M(-w * 0.18, 0.65, d / 2 + 0.02));
  b.add(rbox(w + 0.1, 0.12, 0.14, 0.05), 0xffffff, M(0, h - 0.05, d / 2 + 0.03));
  const wins = o.wins || [[w * 0.24, h * 0.55]];
  for (const [x, y] of wins){
    b.add(rbox(0.86, 0.86, 0.1, 0.06), 0xffffff, M(x, y, d / 2 + 0.03));
    g.add(new THREE.PlaneGeometry(0.62, 0.62), 0xffffff, M(x, y, d / 2 + 0.09));
  }
  if (o.side) for (const z of [-d * 0.2, d * 0.22]){
    b.add(rbox(0.1, 0.8, 0.8, 0.05), 0xffffff, M(w / 2 + 0.03, h * 0.55, z));
    g.add(new THREE.PlaneGeometry(0.58, 0.58), 0xffffff, M(w / 2 + 0.09, h * 0.55, z, 0, PI / 2, 0));
  }
  return { body: b.build(), win: g.build() };
}
export const midHouseA = () => house({ w: 3.8, h: 2.6, d: 3.2, wall: 0xD9A882, roof: 0xE9A9BC, wins: [[0.95, 1.45]], side: true });
export const midHouseB = () => house({ w: 3.0, h: 3.6, d: 2.8, wall: 0xC7DCCB, roof: 0xB4A6DE, wins: [[-0.62, 2.55], [0.62, 2.55], [0.7, 1.2]], side: true });
export function midJellyHill(){
  const b = new GeoBuilder();
  b.add(new THREE.SphereGeometry(1, 24, 10, 0, PI * 2, 0, PI / 2), 0xEFB58C, M(0, -0.1, 0, 0, 0, 0, 3.6, 2.3, 3.0));
  b.add(new THREE.SphereGeometry(1, 18, 5, 0, PI * 2, 0, PI / 2 * 0.55), 0xffffff, M(0, 0.12, 0, 0, 0, 0, 3.5, 2.24, 2.9));
  for (let i = 0; i < 14; i++){
    const a = i * 2.4, r = 0.55 + (i % 4) * 0.12;
    const x = Math.cos(a) * r * 3.2, z = Math.sin(a) * r * 2.6, y = Math.sqrt(Math.max(0, 1 - r * r)) * 2.3 - 0.05;
    b.add(sph(0.09, 6, 4), [0xF5D0DC, 0xD6ECF7, 0xFFF4C8][i % 3], M(x, y, z));
  }
  return b.build();
}
export function midBigLolly(){
  const b = new GeoBuilder();
  b.add(cyl(0.12, 0.12, 3.6, 10, 6), 0xF3EEF6, M(0, 1.8, 0), { stripe: { period: 0.45, len: 3.6, turns: 1 } });
  b.add(cyl(1.15, 1.15, 0.3, 28), 0xC9B6EA, M(0, 4.55, 0, PI / 2, 0, 0));
  for (const [r, c] of [[0.85, 0xffffff], [0.55, 0xF2B7C6], [0.28, 0xffffff]]) b.add(new THREE.TorusGeometry(r, 0.1, 8, 28), c, M(0, 4.55, 0.16));
  b.add(hemi(0.5, 12, 4), 0xffffff, M(0, 5.6, 0, 0, 0, 0, 1.6, 0.45, 0.55));
  b.add(new THREE.TorusGeometry(0.22, 0.07, 6, 12), 0xE58FA0, M(-0.2, 3.3, 0.1, 0, 0, 0.6));
  b.add(new THREE.TorusGeometry(0.22, 0.07, 6, 12), 0xE58FA0, M(0.2, 3.3, 0.1, 0, 0, -0.6));
  return b.build();
}

// ---------- ЛЬДИНА на реке (слой декора): плоский 7-угольник + снежная шапка ----------
export function floe(){
  const b = new GeoBuilder();
  b.add(cyl(1, 0.94, 0.18, 7), 0xE2F4FF, M(0, 0.0, 0, 0, 0, 0, 1, 1, 0.7));
  b.add(hemi(0.62, 8, 3), 0xffffff, M(0.15, 0.08, -0.05, 0, 0, 0, 1, 0.28, 0.5));
  return b.build();
}

// ---------- ФОНАРЬ: { body (карамель), core (свечение), coreY } ----------
export function lamp(){
  const b = new GeoBuilder(), g = new GeoBuilder(), navy = 0x3C4C9A;
  b.add(rbox(0.38, 0.32, 0.38, 0.06), navy, M(0, 0.16, 0), { ao: AO });
  b.add(cyl(0.07, 0.09, 3.0, 10, 6), 0x9DB2E8, M(0, 1.8, 0), { stripe: { period: 0.3, len: 3.0, turns: 1 } });
  b.add(cyl(0.2, 0.14, 0.08, 10), navy, M(0, 3.32, 0));
  for (const [x, z] of [[-0.15, -0.15], [0.15, -0.15], [-0.15, 0.15], [0.15, 0.15]]) b.add(cyl(0.022, 0.022, 0.42, 5), navy, M(x, 3.57, z));
  b.add(cone(0.34, 0.3, 4), navy, M(0, 3.93, 0, 0, PI / 4, 0));
  b.add(cone(0.26, 0.14, 4), 0xffffff, M(0, 4.0, 0, 0, PI / 4, 0));
  b.add(sph(0.06, 8, 6), 0xF3E6B0, M(0, 4.12, 0));
  g.add(rbox(0.26, 0.36, 0.26, 0.05), 0xffffff, M(0, 3.57, 0));
  return { body: b.build(), core: g.build(), coreY: 3.57 };
}

// ---------- ПРЕПЯТСТВИЯ ----------
// JUMP: леденцовая баррикада 0.9 м — диагональ #FF3B5C / белый с периодом 0.35 м, белые ножки, катафоты
export function obstJump(){
  const b = new GeoBuilder(), red = 0xFF3B5C, wh = 0xF4F6FA, ink = 0x070D36;
  b.add(rbox(2.3, 0.4, 0.26, 0.11, 3), red, M(0, 0.68, 0), { stripe: { kind: "diag", period: 0.35 } });
  b.add(rbox(2.0, 0.2, 0.2, 0.08, 2), red, M(0, 0.28, 0), { stripe: { kind: "diag", period: 0.35 } });
  for (const x of [-0.88, 0.88]){
    for (const s of [-1, 1]) b.add(rbox(0.11, 0.9, 0.11, 0.04), wh, M(x, 0.44, s * 0.14, s * 0.2, 0, 0));
    b.add(rbox(0.2, 0.06, 0.62, 0.025), ink, M(x, 0.03, 0));
    b.add(cyl(0.085, 0.085, 0.03, 16), 0xffffff, M(x * 1.13, 0.68, 0.14, PI / 2, 0, 0));
    b.add(cyl(0.05, 0.05, 0.035, 12), 0xFFB0BE, M(x * 1.13, 0.68, 0.145, PI / 2, 0, 0));
  }
  return b.build();
}
// SLIDE: сегмент на одну полосу (2.55 м) — { banner (войлок), bar (карамель + вымпелы), bulbs (свечение) } + pole
export function obstSlideSeg(){
  const W = 2.55;
  const ban = new GeoBuilder(), bar = new GeoBuilder(), bl = new GeoBuilder();
  ban.add(rbox(W, 0.88, 0.1, 0.04), 0x0536D4, M(0, 1.72, 0));
  ban.add(rbox(W + 0.02, 0.07, 0.13, 0.03), 0xffffff, M(0, 1.29, 0));
  ban.add(rbox(W + 0.02, 0.07, 0.13, 0.03), 0xffffff, M(0, 2.15, 0));
  // двойной шеврон вниз белым (= «ныряй под»)
  for (const y of [1.95, 1.64]) for (const s of [-1, 1])
    ban.add(rbox(0.46, 0.1, 0.03, 0.02), 0xffffff, M(s * 0.17, y, 0.06, 0, 0, s * 0.62));
  bar.add(cyl(0.06, 0.06, W, 10, 4), 0xFF3B5C, M(0, 2.44, 0, 0, 0, PI / 2), { stripe: { period: 0.3, len: W, turns: 1 } });
  const tri = new THREE.Shape(); tri.moveTo(-0.15, 0); tri.lineTo(0.15, 0); tri.lineTo(0, -0.24); tri.closePath();
  for (let i = 0; i < 5; i++) bar.add(new THREE.ShapeGeometry(tri), i % 2 ? 0xFF3B5C : 0xffffff, M(-1.0 + i * 0.5, 2.4, 0.07));
  for (let i = 0; i < 8; i++) bl.add(sph(0.055, 6, 4), 0xffffff, M(-1.12 + i * 0.32, 1.22, 0.07));
  return { banner: ban.build(), bar: bar.build(), bulbs: bl.build() };
}
export function obstSlidePole(){
  const b = new GeoBuilder();
  b.add(rbox(0.3, 0.14, 0.3, 0.05), 0x070D36, M(0, 0.07, 0));
  b.add(cyl(0.09, 0.09, 2.5, 12, 6), 0xFF3B5C, M(0, 1.35, 0), { stripe: { period: 0.34, len: 2.5, turns: 1 } });
  b.add(sph(0.15, 12, 10), 0xFF3B5C, M(0, 2.66, 0));
  return b.build();
}
// WALL (2.8 м): сани / пирамида подарков / пряничная тележка. Корпус #E0853A, акценты hazard red, отделка
// чернилами ≤ 15%. Ледяная глыба (#19B4F5) убрана: синий в языке препятствий = SLIDE, а стена должна читаться
// одним цветом «оранжевое = обегай».
const WALL_OR = 0xE0853A, HZ_RED = 0xFF3B5C, INK = 0x070D36;
export function obstSleigh(){
  const b = new GeoBuilder(), or = WALL_OR, wh = 0xffffff, ink = INK, red = HZ_RED;
  b.add(rbox(2.2, 1.15, 2.3, 0.2, 3), or, M(0, 0.9, 0.05));
  b.add(rbox(2.2, 1.3, 0.38, 0.16, 3), or, M(0, 1.9, -1.0));
  b.add(rbox(2.26, 0.12, 2.36, 0.05), wh, M(0, 1.45, 0.05));
  b.add(rbox(2.26, 0.1, 0.44, 0.04), wh, M(0, 2.52, -1.0));
  b.add(new THREE.TorusGeometry(0.42, 0.16, 10, 18, PI), or, M(0, 0.95, 1.2, 0, PI / 2, 0));
  for (const x of [-0.82, 0.82]){
    b.add(swapUV(tube([V(x, 0.12, -1.3), V(x, 0.1, 0.4), V(x, 0.2, 1.25), V(x, 0.55, 1.55), V(x, 0.85, 1.45)], 16, 0.07, 6)), ink);
    for (const z of [-0.8, 0.5]) b.add(cyl(0.05, 0.05, 0.3, 6), ink, M(x, 0.28, z));
  }
  // катафоты-«леденцы» на передке: белый диск + красная сердцевина
  for (const x of [-0.72, 0.72]){
    b.add(cyl(0.12, 0.12, 0.04, 16), wh, M(x, 1.0, 1.21, PI / 2, 0, 0));
    b.add(cyl(0.07, 0.07, 0.05, 12), red, M(x, 1.0, 1.225, PI / 2, 0, 0));
  }
  b.add(rbox(0.95, 0.8, 0.8, 0.08), red, M(-0.4, 1.9, -0.3, 0, 0.2, 0));
  b.add(rbox(0.16, 0.82, 0.84, 0.03), wh, M(-0.4, 1.9, -0.3, 0, 0.2, 0));
  b.add(rbox(0.7, 0.62, 0.7, 0.08), wh, M(0.5, 1.8, -0.2, 0, -0.3, 0));
  b.add(rbox(0.72, 0.64, 0.14, 0.03), red, M(0.5, 1.8, -0.2, 0, -0.3, 0));
  const g = b.build(); g.scale(1, 2.8 / 2.57, 1); g.computeBoundingSphere();
  return g;
}
export function obstGifts(){
  const b = new GeoBuilder(), or = WALL_OR, red = HZ_RED, wh = 0xffffff;
  const box = (w, h, d, y, ry, c) => {
    b.add(rbox(w, h, d, 0.1, 3), c, M(0, y, 0, 0, ry, 0));
    b.add(rbox(0.18, h + 0.02, d + 0.02, 0.03), wh, M(0, y, 0, 0, ry, 0));
    b.add(rbox(w + 0.02, h + 0.02, 0.18, 0.03), wh, M(0, y, 0, 0, ry, 0));
  };
  box(2.2, 1.2, 1.9, 0.6, 0, or);
  box(1.6, 0.9, 1.45, 1.65, 0.28, red);
  box(1.0, 0.6, 1.0, 2.4, -0.2, or);
  b.add(new THREE.TorusGeometry(0.2, 0.07, 8, 14), wh, M(-0.16, 2.8, 0, 0, 0.3, 0.7));
  b.add(new THREE.TorusGeometry(0.2, 0.07, 8, 14), wh, M(0.16, 2.8, 0, 0, 0.3, -0.7));
  b.add(rbox(2.3, 0.08, 2.0, 0.03), INK, M(0, 0.04, 0));
  return b.build();
}
// пряничная тележка: кузов с глазурью-волной, 4 колеса-леденца, груз из мятных дисков
export function obstCart(){
  const b = new GeoBuilder(), or = WALL_OR, wh = 0xffffff, red = HZ_RED;
  b.add(rbox(2.25, 1.25, 2.3, 0.16, 3), or, M(0, 1.05, 0), { ao: [0.4, 0.5, 0.75] });
  b.add(rbox(2.33, 0.14, 2.38, 0.06), wh, M(0, 1.7, 0));
  for (let i = 0; i < 7; i++) b.add(sph(0.12, 8, 6), wh, M(-0.99 + i * 0.33, 1.6, 1.17, 0, 0, 0, 1, 1.3, 0.6));
  b.add(rbox(1.6, 0.34, 0.1, 0.05), 0xF6C48C, M(0, 1.05, 1.16));
  for (const x of [-1.16, 1.16]) for (const z of [-0.7, 0.7]){
    b.add(cyl(0.4, 0.4, 0.16, 20), INK, M(x, 0.4, z, 0, 0, PI / 2));
    b.add(cyl(0.2, 0.2, 0.18, 14), wh, M(x, 0.4, z, 0, 0, PI / 2));
  }
  // груз: два больших мятных диска на ребре + конфета
  for (const [x, ry] of [[-0.48, 0.25], [0.5, -0.3]]){
    b.add(cyl(0.55, 0.55, 0.32, 24), red, M(x, 2.3, -0.1, PI / 2, ry, 0), { stripe: { kind: "diag", period: 0.5, ax: 1, ay: 0, az: 1 } });
    b.add(cyl(0.2, 0.2, 0.34, 14), wh, M(x, 2.3, -0.1, PI / 2, ry, 0));
  }
  return b.build();
}

// ---------- УСКОРИТЕЛИ (POWER): четыре фигурки ≈ 0.8 м, центр в начале координат ----------
// цвета вершин; инстансный цвет остаётся белым (оттенок бонуса несут ореол и кольцо)
const PW_BLUE = 0x0536D4, PW_SKY = 0x7FD4FF, PW_LIME = 0xC0FF3F, PW_PINK = 0xFF7EB6, PW_WH = 0xffffff, PW_INK = 0x070D36;
// магнит: синяя подкова открытием вниз + белые полюса
export function powerMagnet(){
  const b = new GeoBuilder();
  b.add(new THREE.TorusGeometry(0.3, 0.12, 8, 18, PI), PW_BLUE, M(0, 0.06, 0));
  for (const x of [-0.3, 0.3]) b.add(rbox(0.25, 0.26, 0.25, 0.05), PW_WH, M(x, -0.1, 0));
  return b.build();
}
// щит: небесно-голубая пластина с белым полем и голубым ядром
export function powerShield(){
  const b = new GeoBuilder();
  b.add(rbox(0.66, 0.78, 0.18, 0.18, 3), PW_SKY, M(0, 0, 0));
  b.add(rbox(0.44, 0.54, 0.22, 0.12, 2), PW_WH, M(0, 0.02, 0));
  b.add(rbox(0.24, 0.32, 0.25, 0.08, 2), PW_SKY, M(0, 0.04, 0));
  return b.build();
}
// ускоритель: лаймовая ракета — белый нос, чернильные плавники, оранжевое пламя
export function powerBoost(){
  const b = new GeoBuilder();
  b.add(cyl(0.16, 0.2, 0.5, 12), PW_LIME, M(0, -0.02, 0));
  b.add(cone(0.2, 0.32, 12), PW_WH, M(0, 0.38, 0));
  b.add(cyl(0.21, 0.21, 0.06, 12), PW_WH, M(0, -0.28, 0));
  for (let i = 0; i < 3; i++){ const a = i * PI * 2 / 3; b.add(rbox(0.07, 0.26, 0.2, 0.03), PW_INK, M(Math.sin(a) * 0.22, -0.24, Math.cos(a) * 0.22, 0, a, 0)); }
  b.add(cone(0.13, 0.22, 10), 0xFFB347, M(0, -0.42, 0, PI, 0, 0));
  return b.build();
}
// ×2: розовая таблетка с белыми «×» и «2» из брусков
export function powerX2(){
  const b = new GeoBuilder();
  b.add(cyl(0.44, 0.44, 0.16, 24), PW_PINK, M(0, 0, 0, PI / 2, 0, 0));
  for (const s of [-1, 1]) b.add(rbox(0.3, 0.08, 0.06, 0.03), PW_WH, M(-0.17, 0, 0.09, 0, 0, s * PI / 4));
  b.add(rbox(0.22, 0.08, 0.06, 0.03), PW_WH, M(0.19, 0.16, 0.09));
  b.add(rbox(0.36, 0.08, 0.06, 0.03), PW_WH, M(0.19, 0, 0.09, 0, 0, PI / 4));
  b.add(rbox(0.22, 0.08, 0.06, 0.03), PW_WH, M(0.19, -0.16, 0.09));
  return b.build();
}
// светящееся кольцо вокруг ускорителя (наклонено, крутится вместе с фигуркой)
export function powerRing(){
  const b = new GeoBuilder();
  b.add(new THREE.TorusGeometry(0.62, 0.035, 6, 28), PW_WH, M(0, 0, 0, 1.15, 0, 0));
  return b.build();
}

// ---------- ПЛОТНЫЙ МИР: второй ближний ряд (x 7.7–9.6), крупный средний план, холмы, гирлянды ----------
const SNOW = 0xffffff;
// куст: три шара мятной зелени со снежными шапками
export function nearBush(){
  const b = new GeoBuilder(), gr = 0x9CD3B4;
  for (const [x, z, r] of [[0, 0, 0.42], [0.36, 0.18, 0.3], [-0.3, 0.22, 0.27]]){
    b.add(sph(r, 10, 7), gr, M(x, r * 0.85, z), { ao: AO, keepUV: true });
    b.add(hemi(r * 0.82, 10, 4), SNOW, M(x, r * 1.12, z, 0, 0, 0, 1, 0.5, 1), { keepUV: true });
  }
  return b.build();
}
// стопка подарков: три коробка с лентами и бантом
export function nearGifts(){
  const b = new GeoBuilder();
  const box = (x, y, z, w, h, d, ry, c, rib) => {
    b.add(rbox(w, h, d, 0.05, 2), c, M(x, y, z, 0, ry, 0), { ao: AO });
    b.add(rbox(0.09, h + 0.02, d + 0.02, 0.02), rib, M(x, y, z, 0, ry, 0));
    b.add(rbox(w + 0.02, h + 0.02, 0.09, 0.02), rib, M(x, y, z, 0, ry, 0));
  };
  box(0, 0.3, 0, 0.8, 0.6, 0.7, 0.1, 0xF2B7C6, SNOW);
  box(0.05, 0.82, 0.02, 0.5, 0.44, 0.48, -0.35, 0x9DB2E8, 0xFFF4C8);
  box(0.55, 0.2, 0.25, 0.42, 0.4, 0.4, 0.5, 0xC0FF3F, 0x0536D4);
  b.add(new THREE.TorusGeometry(0.1, 0.035, 6, 10), SNOW, M(-0.07, 1.1, 0.02, 0, 0.3, 0.7));
  b.add(new THREE.TorusGeometry(0.1, 0.035, 6, 10), SNOW, M(0.17, 1.1, 0.02, 0, 0.3, -0.7));
  return b.build();
}
// кристаллы льда (родня энергонов): четыре призмы разной высоты на снежной подушке
export function nearCrystals(){
  const b = new GeoBuilder();
  for (const [x, z, h, r, tilt] of [[0, 0, 1.3, 0.22, 0], [0.32, 0.12, 0.8, 0.16, 0.35], [-0.3, 0.1, 0.95, 0.17, -0.3], [0.1, -0.32, 0.6, 0.13, 0.2]]){
    b.add(cone(r, h, 6), 0xA9E4FF, M(x, h / 2 - 0.05, z, tilt, x * 2, -tilt * 0.6), { ao: [0, h * 0.7, 0.55], keepUV: true });
    b.add(cyl(r, r * 0.85, 0.12, 6), 0x6FBDF2, M(x, 0.02, z, 0, x * 2, 0));
  }
  b.add(hemi(0.55, 10, 4), SNOW, M(0, -0.06, 0, 0, 0, 0, 1.2, 0.35, 1));
  return b.build();
}
// указатель: полосатый столб, две дощечки и снег на верхней
export function nearSign(){
  const b = new GeoBuilder();
  b.add(cyl(0.05, 0.06, 1.7, 8, 4), 0xF3EEF6, M(0, 0.85, 0), { stripe: { period: 0.28, len: 1.7, turns: 1 } });
  b.add(rbox(0.9, 0.34, 0.08, 0.06, 2), 0xFFD166, M(0.2, 1.45, 0, 0, 0, 0.08));
  b.add(rbox(0.7, 0.3, 0.08, 0.05, 2), 0xE58FA0, M(-0.15, 1.05, 0, 0, 0, -0.1));
  b.add(sph(0.07, 8, 6), 0x0536D4, M(0.2, 1.45, 0.05));
  b.add(hemi(0.14, 8, 4), SNOW, M(0.2, 1.62, 0, 0, 0, 0, 3.2, 0.5, 0.6));
  return b.build();
}
// валун со снежной шапкой
export function nearRock(){
  const b = new GeoBuilder();
  b.add(new THREE.DodecahedronGeometry(0.55, 0), 0xB9C6E6, M(0, 0.35, 0, 0.3, 0.5, 0.1, 1, 0.75, 0.9), { ao: AO });
  b.add(hemi(0.5, 10, 4), SNOW, M(0.02, 0.62, 0, 0, 0, 0, 1.05, 0.4, 0.95));
  return b.build();
}
// гриб-пастила: розовая шляпка с белыми точками
export function nearMushroom(){
  const b = new GeoBuilder();
  b.add(cyl(0.16, 0.2, 0.7, 10), 0xFFF4E6, M(0, 0.35, 0), { ao: AO });
  b.add(hemi(0.55, 14, 6), 0xF48FB1, M(0, 0.66, 0, 0, 0, 0, 1, 0.75, 1), { keepUV: true });
  for (let i = 0; i < 6; i++){
    const a = i * 1.05 + 0.3, r = 0.28 + (i % 2) * 0.14;
    b.add(sph(0.07, 6, 4), SNOW, M(Math.cos(a) * r, 0.66 + 0.75 * Math.sqrt(Math.max(0, 0.3025 - r * r)), Math.sin(a) * r));
  }
  b.add(hemi(0.2, 8, 4), SNOW, M(0, 1.05, 0, 0, 0, 0, 1.3, 0.35, 1));
  return b.build();
}
// санки, брошенные на сугробе
export function nearSled(){
  const s = new GeoBuilder(), or = 0xE0853A, wd = 0xC9925F;
  for (const x of [-0.3, 0.3]){
    s.add(rbox(0.06, 0.1, 1.5, 0.02), or, M(x, 0.05, 0));
    for (const z of [-0.45, 0.45]) s.add(rbox(0.05, 0.22, 0.05, 0.01), or, M(x, 0.2, z));
  }
  for (let i = 0; i < 5; i++) s.add(rbox(0.8, 0.05, 0.2, 0.02), wd, M(0, 0.33, -0.55 + i * 0.28));
  s.add(rbox(0.7, 0.05, 0.05, 0.01), 0xFF3B5C, M(0, 0.35, 0.72));
  const b = new GeoBuilder();
  b.add(hemi(0.85, 10, 4), SNOW, M(0.2, -0.05, -0.3, 0, 0, 0, 1, 0.5, 0.9));
  b.add(s.build(), null, M(0, 0.15, 0.25, -0.55, 0.3, 0), { keepColor: true });
  return b.build();
}
// рощица: пять ёлок разного роста одной деталью
export function midGrove(){
  const b = new GeoBuilder(), gr = [0x7FBF98, 0x86BFB4, 0x8CC7A6];
  [[0, 0, 1.0], [1.9, -0.8, 0.8], [-1.7, 0.6, 0.7], [0.9, 1.9, 0.55], [-1.1, -1.8, 0.6]].forEach(([x, z, k], i) => {
    b.add(cyl(0.18 * k, 0.24 * k, 0.9 * k, 7), 0x9A6E52, M(x, 0.45 * k, z), { ao: AO });
    for (const [r, h, y] of [[1.6, 1.9, 1.3], [1.25, 1.7, 2.3], [0.85, 1.4, 3.2]]){
      b.add(cone(r * k, h * k, 12), gr[i % 3], M(x, y * k, z), { ao: [0, 1.2, 0.62], keepUV: true });
      b.add(cone(r * k * 0.64, h * k * 0.4, 12), SNOW, M(x, (y + h * 0.3) * k, z), { keepUV: true });
    }
  });
  return b.build();
}
// мельница: войлочный корпус, сиреневая крыша, четыре лопасти; { body, win }
export function midWindmill(){
  const b = new GeoBuilder(), g = new GeoBuilder();
  b.add(cyl(1.3, 1.7, 4.2, 12), 0xE9D6C3, M(0, 2.1, 0), { ao: [0, 1.4, 0.62] });
  b.add(cone(1.7, 1.6, 12), 0xB4A6DE, M(0, 5.0, 0));
  b.add(cone(1.6, 0.7, 12), SNOW, M(0, 5.55, 0));
  b.add(rbox(0.7, 1.1, 0.12, 0.06), 0x9A6448, M(0, 0.55, 1.68));
  b.add(rbox(0.7, 0.7, 0.1, 0.05), SNOW, M(0.55, 2.6, 1.5));
  g.add(new THREE.PlaneGeometry(0.5, 0.5), SNOW, M(0.55, 2.6, 1.57));
  b.add(cyl(0.12, 0.12, 0.8, 8), 0x3C4C9A, M(0, 4.3, 1.9, PI / 2, 0, 0));
  for (let i = 0; i < 4; i++){
    const a = i * PI / 2 + 0.35;
    b.add(rbox(0.12, 3.0, 0.08, 0.03), 0xC9925F, M(Math.sin(a) * 1.5, 4.3 + Math.cos(a) * 1.5, 2.3, 0, 0, -a));
    b.add(rbox(0.55, 2.2, 0.04, 0.02), 0xF2B7C6, M(Math.sin(a) * 1.75 + Math.cos(a) * 0.3, 4.3 + Math.cos(a) * 1.75 - Math.sin(a) * 0.3, 2.3, 0, 0, -a));
  }
  return { body: b.build(), win: g.build() };
}
// карамельная башня-маяк: спиральный ствол, галерея, красный конус, светящийся фонарь; { body, win }
export function midTower(){
  const b = new GeoBuilder(), g = new GeoBuilder();
  b.add(cyl(1.0, 1.25, 5.5, 14, 8), 0xE58FA0, M(0, 2.75, 0), { stripe: { period: 0.9, len: 5.5, turns: 0.5 }, ao: [0, 1.5, 0.62] });
  b.add(cyl(1.35, 1.35, 0.3, 14), 0x3C4C9A, M(0, 5.65, 0));
  b.add(cyl(0.9, 0.9, 1.0, 12), 0xFFF4C8, M(0, 6.3, 0));
  g.add(cyl(0.93, 0.93, 0.6, 12, 1, true), SNOW, M(0, 6.3, 0));
  b.add(cone(1.25, 1.3, 14), 0xFF3B5C, M(0, 7.45, 0));
  b.add(cone(1.15, 0.55, 14), SNOW, M(0, 7.95, 0));
  b.add(sph(0.16, 8, 6), 0xFFD166, M(0, 8.2, 0));
  return { body: b.build(), win: g.build() };
}
// холм с ёлочками (слой между средним планом и задниками), два варианта
export function farHill(v){
  const b = new GeoBuilder();
  const rx = v ? 9 : 12, rz = v ? 7 : 9, h = v ? 3.2 : 2.6;
  b.add(new THREE.SphereGeometry(1, 20, 8, 0, PI * 2, 0, PI / 2), 0xF7FAFF, M(0, -0.3, 0, 0, 0, 0, rx, h, rz), { keepUV: true });
  const T = v ? [[0, 0], [3.5, 1.5], [-3, -2], [-5, 2.5], [5.5, -2.2], [1.5, -3.5], [-1.5, 3.2]]
              : [[2, 0], [-4, 1], [6, -3], [-7, -2], [0, 4], [4, 4], [-2, -4.5], [8, 2]];
  T.forEach(([x, z], i) => {
    const y = -0.3 + h * Math.sqrt(Math.max(0, 1 - (x / rx) ** 2 - (z / rz) ** 2)), k = 0.7 + (i % 5) * 0.1;
    b.add(cone(0.9 * k, 2.2 * k, 8), [0x8CC7A6, 0x7FBF98][i % 2], M(x, y + 1.0 * k, z), { keepUV: true });
    b.add(cone(0.55 * k, 1.5 * k, 8), [0x8CC7A6, 0x7FBF98][i % 2], M(x, y + 2.0 * k, z), { keepUV: true });
    b.add(cone(0.35 * k, 0.7 * k, 8), SNOW, M(x, y + 2.6 * k, z), { keepUV: true });
  });
  return b.build();
}
// гирлянда-растяжка над трассой: два полосатых столба на валах и нить с флажками (низ нити 4.6 м — выше камеры и прыжка)
export function bunting(){
  const b = new GeoBuilder(), X = 5.45, H = 5.3;
  for (const s of [-1, 1]){
    b.add(rbox(0.36, 0.3, 0.36, 0.06), 0x3C4C9A, M(s * X, 0.15, 0), { ao: AO });
    b.add(cyl(0.06, 0.08, H, 8, 6), 0xE58FA0, M(s * X, H / 2, 0), { stripe: { period: 0.32, len: H, turns: 1 } });
    b.add(sph(0.14, 8, 6), 0xFFD166, M(s * X, H + 0.08, 0));
  }
  const pts = []; for (let i = 0; i <= 12; i++){ const t = i / 12; pts.push(V(-X + t * 2 * X, H - 0.65 * Math.sin(t * PI) - 0.05, 0)); }
  b.add(swapUV(tube(pts, 24, 0.025, 5)), 0x3C4C9A);
  const tri = new THREE.Shape(); tri.moveTo(-0.16, 0); tri.lineTo(0.16, 0); tri.lineTo(0, -0.34); tri.closePath();
  const tg = new THREE.ShapeGeometry(tri), cols = [0xFF3B5C, SNOW, 0xC0FF3F, 0x0536D4, 0xF2B7C6, 0xFFD166];
  for (let i = 0; i < 20; i++){
    const t = (i + 0.5) / 20;
    b.add(tg, cols[i % 6], M(-X + t * 2 * X, H - 0.65 * Math.sin(t * PI) - 0.08, 0, 0, 0, (t - 0.5) * 0.5));
  }
  return b.build();
}

// воздушный шар вдали: полосатая оболочка, юбка, стропы и корзинка (центр — низ корзинки)
export function balloon(){
  const b = new GeoBuilder();
  b.add(sph(1.6, 16, 12), 0xFF7EB6, M(0, 4.3, 0, 0, 0, 0, 1, 1.15, 1), { stripe: { period: 0.5, len: 1, turns: 8 }, keepUV: false });
  b.add(cone(0.9, 1.2, 12), 0xFF7EB6, M(0, 2.3, 0, PI, 0, 0));
  b.add(cyl(0.34, 0.3, 0.22, 10), 0x3C4C9A, M(0, 1.75, 0));
  for (const [x, z] of [[-0.42, -0.42], [0.42, -0.42], [-0.42, 0.42], [0.42, 0.42]]) b.add(cyl(0.02, 0.02, 1.5, 4), 0x3C4C9A, M(x * 0.8, 1.0, z * 0.8, x * 0.3, 0, -z * 0.3));
  b.add(rbox(0.9, 0.6, 0.9, 0.1, 2), 0xC9925F, M(0, 0.3, 0));
  b.add(rbox(0.96, 0.1, 0.96, 0.04), 0xFFF4C8, M(0, 0.62, 0));
  return b.build();
}

// ---------- ЭНЕРГОН: оболочка и ядро (масштаб 0.8 × 1.15 × 0.45 зашит в геометрию) ----------
export function coinShell(){ const g = new THREE.IcosahedronGeometry(0.34, 1); g.scale(0.8, 1.15, 0.45); return g; }
// ядро чуть толще оболочки по z: светящиеся грани проступают в центре лицевой и тыльной сторон, с ребра не видно
export function coinCore(){ const g = new THREE.IcosahedronGeometry(0.2, 0); g.scale(0.72, 1.05, 0.95); return g; }
export function quad(){ return new THREE.PlaneGeometry(1, 1); }
export function groundQuad(w, d){ const g = new THREE.PlaneGeometry(w, d); g.rotateX(-PI / 2); return g; }
