// world-kit: сет-пьесы (WORLD-3) — арка «ИДЕАЛИТИ», мост над замёрзшей рекой, ледяной тоннель, площадь с ёлкой.
// Каждая строится один раз (пул 1 на тип: шаг ≥ 250 м больше окна видимости 112 + 60 + 15 м) и слита по материалам:
// 3–4 draw call на пьесу. Сидированный планировщик: первая на 120 м, дальше старт-к-старту rnd(250, 400).
import * as THREE from "three";
import { GeoBuilder, M, makeRng, sweep } from "./util.js";
import * as PR from "./props.js";
import { L_NEAR, L_MID, L_FAR, L_LAMP } from "./decor.js";

const PI = Math.PI;
const { swapUV, tube, rbox, cyl, cone, sph, hemi, prism } = PR;
export const PIECE_TYPES = ["gate", "bridge", "tunnel", "village"];
const WEIGHTS = { gate: 0.35, bridge: 0.25, tunnel: 0.20, village: 0.20 };
const AO = [0, 0.8, 0.6];

function starShape(r1, r2){
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++){ const a = PI / 2 + i * PI / 5, r = i % 2 ? r2 : r1; if (i) s.lineTo(Math.cos(a) * r, Math.sin(a) * r); else s.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
  s.closePath(); return new THREE.ShapeGeometry(s);
}

function finish(group, list){
  for (const [b, mat, cast, ro] of list){
    if (!b.count) continue;
    const m = new THREE.Mesh(b.build(), mat);
    m.castShadow = !!cast; m.receiveShadow = true; if (ro) m.renderOrder = ro;
    group.add(m);
  }
  group.visible = false;
  return group;
}

// ---------- АРКА «ИДЕАЛИТИ»: 9.7 м высота, 11 м проём, 36 лампочек ----------
function buildGate(mats){
  const g = new THREE.Group(); g.name = "piece:gate";
  const c = new GeoBuilder(), f = new GeoBuilder(), gl = new GeoBuilder();
  const R = 6.0, H = 3.2, cz = -2, pink = 0xF0839B;
  for (const s of [-1, 1]){
    c.add(cyl(0.52, 0.56, H, 24, 8), pink, M(s * R, H / 2, cz), { stripe: { period: 0.7, len: H, turns: 1 } });
    c.add(rbox(1.8, 1.1, 1.8, 0.14, 3), 0xC9925F, M(s * R, 0.55, cz), { ao: AO });
    c.add(rbox(1.9, 0.16, 1.9, 0.07), 0xffffff, M(s * R, 1.12, cz));
    for (let i = 0; i < 8; i++) c.add(sph(0.09, 8, 6), [0xF5D0DC, 0xD6ECF7, 0xFFF4C8][i % 3], M(s * R + Math.cos(i * 0.785) * 0.93, 0.6, cz + Math.sin(i * 0.785) * 0.93));
    f.add(hemi(1.4, 14, 5), 0xffffff, M(s * R, -0.1, cz, 0, 0, 0, 1.5, 0.45, 1.4));
    for (let i = 0; i < 6; i++) gl.add(sph(0.1, 8, 6), 0xffffff, M(s * R, 1.5 + i * 0.36, cz + 0.58));
  }
  c.add(swapUV(new THREE.TorusGeometry(R, 0.52, 16, 64, PI)), pink, M(0, H, cz), { stripe: { period: 0.7, len: PI * R, turns: 1 } });
  f.add(new THREE.TorusGeometry(R, 0.42, 10, 36, PI * 0.56), 0xffffff, M(0, H + 0.24, cz, 0, 0, PI * 0.22, 1, 1, 1.05));
  for (let i = 0; i < 36; i++){
    const a = PI * (i + 0.5) / 36;
    gl.add(sph(0.12, 8, 6), 0xffffff, M(Math.cos(a) * R, H + Math.sin(a) * R, cz + 0.56));
  }
  // вывеска: синяя доска + цепочки + текст на отдельном материале
  f.add(rbox(6.9, 1.9, 0.22, 0.2, 3), 0x0536D4, M(0, 7.0, cz + 0.05));
  for (const x of [-2.6, 2.6]) c.add(cyl(0.035, 0.035, 0.8, 6), 0x3C4C9A, M(x, 8.3, cz + 0.05));
  gl.add(starShape(0.8, 0.34), 0xffffff, M(0, H + R + 1.0, cz + 0.1));
  gl.add(starShape(0.8, 0.34), 0xffffff, M(0, H + R + 1.0, cz + 0.08, 0, PI, 0));
  c.add(sph(0.3, 12, 10), 0xF3E6B0, M(0, H + R + 0.35, cz));
  finish(g, [[c, mats.candy, true], [f, mats.felt, true], [gl, mats.glowBulb, false]]);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(6.5, 1.62), mats.sign);
  sign.position.set(0, 7.0, cz + 0.17); sign.receiveShadow = true; g.add(sign);
  return { group: g, len: 4, type: "gate" };
}

// ---------- МОСТ над замёрзшей рекой, 60 м ----------
function buildBridge(mats){
  const g = new THREE.Group(); g.name = "piece:bridge";
  const L = 60, wood = 0xB47A52, dark = 0x7E563C, rr = makeRng(4242);
  const c = new GeoBuilder(), f = new GeoBuilder(), ic = new GeoBuilder(), gl = new GeoBuilder();
  for (const s of [-1, 1]){
    for (let z = 0; z >= -L; z -= 2){
      c.add(rbox(0.16, 1.2, 0.16, 0.04), wood, M(s * 5.3, 0.6, z));
      f.add(hemi(0.13, 8, 3), 0xffffff, M(s * 5.3, 1.2, z, 0, 0, 0, 1, 0.6, 1));
    }
    c.add(new THREE.BoxGeometry(0.14, 0.12, L, 1, 1, L), wood, M(s * 5.3, 1.12, -L / 2));
    c.add(new THREE.BoxGeometry(0.1, 0.1, L, 1, 1, L), wood, M(s * 5.3, 0.62, -L / 2));
    f.add(new THREE.BoxGeometry(0.22, 0.07, L, 1, 1, L), 0xffffff, M(s * 5.3, 1.21, -L / 2));
    c.add(new THREE.BoxGeometry(0.36, 0.7, L + 3, 1, 1, L), dark, M(s * 4.8, -0.33, -L / 2));
    for (let k = 0; k <= 4; k++){
      c.add(cyl(0.42, 0.5, 2.4, 12), dark, M(s * 4.4, -1.1, -k * 15));
      f.add(hemi(0.95, 12, 4), 0xffffff, M(s * 4.4, -1.0, -k * 15, 0, 0, 0, 1, 0.32, 1));
    }
    for (const zp of [0, -L]){
      c.add(rbox(0.56, 5.0, 0.56, 0.1, 2), wood, M(s * 5.75, 2.5, zp), { ao: AO });
      gl.add(rbox(0.26, 0.34, 0.26, 0.05), 0xffffff, M(s * 5.4, 3.3, zp));
      c.add(cone(0.24, 0.2, 4), 0x3C4C9A, M(s * 5.4, 3.58, zp, 0, PI / 4, 0));
    }
  }
  for (const zp of [0, -L]){
    c.add(rbox(12.6, 0.56, 0.72, 0.12, 2), wood, M(0, 5.1, zp));
    c.add(prism(1.9, 1.0, 13.2), 0xE58FA0, M(0, 5.36, zp, 0, PI / 2, 0));
    f.add(prism(1.75, 0.95, 13.4), 0xffffff, M(0, 5.5, zp, 0, PI / 2, 0));
    for (let i = 0; i < 9; i++) gl.add(sph(0.1, 8, 6), 0xffffff, M(-5 + i * 1.25, 4.75 - Math.sin(i / 8 * PI) * 0.25, zp + 0.4));
  }
  for (const zm of [-20, -40]){
    c.add(swapUV(new THREE.TorusGeometry(5.3, 0.16, 8, 40, PI)), wood, M(0, 1.2, zm));
    for (let i = 1; i < 12; i++){ const a = PI * i / 12; gl.add(sph(0.085, 8, 6), 0xffffff, M(Math.cos(a) * 5.3, 1.2 + Math.sin(a) * 5.3 - 0.2, zm + 0.1)); }
    f.add(new THREE.TorusGeometry(5.3, 0.13, 6, 20, PI * 0.5), 0xffffff, M(0, 1.33, zm, 0, 0, PI * 0.25));
  }
  // льдины и снежные островки на реке
  for (let i = 0; i < 46; i++){
    const s = i % 2 ? 1 : -1, x = s * (8.5 + Math.pow(rr(), 1.4) * 40), z = 1 - rr() * 62, r = 0.8 + rr() * 2.4;
    ic.add(cyl(r, r * 0.95, 0.16, 6), 0xE2F4FF, M(x, -0.97, z, 0, rr() * PI, 0, 1, 1, 0.55 + rr() * 0.5));
    if (rr() < 0.5) f.add(hemi(r * 0.55, 8, 3), 0xffffff, M(x + 0.2, -0.9, z - 0.1, 0, 0, 0, 1, 0.3, 0.8));
  }
  finish(g, [[c, mats.candy, true], [f, mats.felt, false], [ic, mats.ice, false], [gl, mats.glowBulb, false]]);
  return { group: g, len: L, type: "bridge" };
}

// ---------- ЛЕДЯНОЙ ТОННЕЛЬ, 40 м, закрытый ----------
function buildTunnel(mats){
  const g = new THREE.Group(); g.name = "piece:tunnel";
  const L = 40, rxo = 6.9, ryo = 6.4, rxi = 6.3, ryi = 5.75, NA = 26;
  const f = new GeoBuilder(), ic = new GeoBuilder(), gl = new GeoBuilder(), rr = makeRng(777);
  const outer = [], inner = [];
  for (let i = 0; i <= NA; i++){ const a = i / NA * PI; outer.push([Math.cos(a) * rxo, Math.sin(a) * ryo]); }
  for (let i = NA; i >= 0; i--){ const a = i / NA * PI; inner.push([Math.cos(a) * rxi, Math.sin(a) * ryi]); }
  f.add(sweep(outer, 0.4, -L - 0.4, 1), 0xF2F6FF, null, { keepUV: true });
  f.add(sweep(inner, 0.4, -L - 0.4, 1), 0x4A5FB4, null, { keepUV: true, ao: [0, 2.2, 0.55] });
  const ring = new THREE.Shape();
  outer.forEach((p, i) => i ? ring.lineTo(p[0], p[1]) : ring.moveTo(p[0], p[1]));
  inner.forEach(p => ring.lineTo(p[0], p[1]));
  ring.closePath();
  const ringG = new THREE.ShapeGeometry(ring, 2);
  f.add(ringG, 0xE8F0FF, M(0, 0, 0.4));
  f.add(ringG, 0xE8F0FF, M(0, 0, -L - 0.4, 0, PI, 0));
  for (let z = -2; z > -L; z -= 5) f.add(hemi(1.7, 12, 4), 0xffffff, M((rr() - 0.5) * 3, ryo - 0.35, z, 0, rr() * PI, 0, 1.3, 0.42, 1.8));
  // портал из ледяных блоков + сосульки
  for (let i = 0; i <= 12; i++){
    const a = i / 12 * PI;
    ic.add(rbox(1.25, 1.1, 1.3, 0.2, 2), 0xCDEEFF, M(Math.cos(a) * (rxo + 0.15), Math.sin(a) * (ryo + 0.15), 0.15, 0, 0, a - PI / 2));
    if (i > 1 && i < 11) for (let k = 0; k < 2; k++)
      ic.add(cone(0.1, 0.5 + rr() * 0.5, 6), 0xE6F7FF, M(Math.cos(a + k * 0.12) * rxi * 0.98, Math.sin(a + k * 0.12) * ryi * 0.98 - 0.3, 0.3, PI, 0, 0));
  }
  for (let z = -4; z > -L; z -= 4){
    const pts = [];
    for (let i = 0; i <= 12; i++){ const a = i / 12 * PI; pts.push([Math.cos(a) * (rxi - 0.06), Math.sin(a) * (ryi - 0.06), 0]); }
    ic.add(tube(pts, 36, 0.15, 6), 0xBFE6FF, M(0, 0, z));
    for (let i = 2; i <= 10; i += 2){ const a = i / 12 * PI; gl.add(sph(0.09, 8, 6), 0xffffff, M(Math.cos(a) * (rxi - 0.25), Math.sin(a) * (ryi - 0.25), z + 0.18)); }
  }
  // тёплые световые полосы по своду
  for (const s of [-1, 1]){
    const a = PI / 2 + s * 0.62, px = Math.cos(a) * (rxi - 0.07), py = Math.sin(a) * (ryi - 0.07);
    gl.add(new THREE.BoxGeometry(0.24, 0.05, L, 1, 1, L), 0xFFE6B8, M(px, py, -L / 2, 0, 0, a - PI / 2));
  }
  finish(g, [[f, mats.felt, true], [ic, mats.ice, false], [gl, mats.glowBulb, false]]);
  return { group: g, len: L, type: "tunnel" };
}

// ---------- ПЛОЩАДЬ С ГИГАНТСКОЙ ЁЛКОЙ (25 м на x −14) ----------
function buildVillage(mats){
  const g = new THREE.Group(); g.name = "piece:village";
  const L = 50, tx = -14, tz = -25, rr = makeRng(2024);
  const f = new GeoBuilder(), c = new GeoBuilder(), gl = new GeoBuilder(), win = new GeoBuilder();
  f.add(cyl(0.9, 1.25, 3.2, 12), 0x9A6E52, M(tx, 1.6, tz), { ao: AO });
  for (let k = 0; k < 7; k++){
    const r = 6.2 - k * 0.8, h = 5.0 - k * 0.3, y = 3.2 + k * 2.95;
    f.add(cone(r, h, 28), 0x6FAF8E, M(tx, y, tz), { keepUV: true, ao: [0, 4, 0.7] });
    f.add(cone(r * 0.6, h * 0.36, 28), 0xffffff, M(tx, y + h * 0.3, tz), { keepUV: true });
  }
  f.add(cyl(7.5, 7.7, 0.14, 44), 0xE7DCCF, M(tx, 0.02, tz));
  f.add(new THREE.TorusGeometry(7.6, 0.16, 6, 44), 0xffffff, M(tx, 0.1, tz, PI / 2, 0, 0));
  for (let i = 0; i < 46; i++){
    const t = rr() * 0.9, ang = rr() * PI * 2, y = 2.6 + t * 20, rad = (6.3 - 5.4 * t) * 0.9;
    c.add(sph(0.42 - 0.2 * t, 12, 8), [0xF28DA6, 0x8DB6F2, 0xF2D48D, 0xffffff][i % 4], M(tx + Math.cos(ang) * rad, y, tz + Math.sin(ang) * rad));
  }
  for (let i = 0; i < 80; i++){
    const t = i / 80, ang = t * PI * 9, y = 2.9 + t * 20, rad = 6.5 - 5.5 * t;
    gl.add(sph(0.13, 8, 6), 0xffffff, M(tx + Math.cos(ang) * rad, y, tz + Math.sin(ang) * rad));
  }
  gl.add(starShape(1.5, 0.62), 0xffffff, M(tx, 25.4, tz + 0.08));
  gl.add(starShape(1.5, 0.62), 0xffffff, M(tx, 25.4, tz - 0.08, 0, PI, 0));
  // домики вокруг площади (геометрии среднего слоя, с готовыми цветами)
  const HA = PR.midHouseA(), HB = PR.midHouseB();
  for (const [H, x, z, ry, s] of [[HA, 12.5, -8, -1.05, 1.1], [HB, 16, -30, -1.25, 1.2], [HA, -25, -6, 0.9, 1.15], [HB, -26, -44, 1.1, 1.2], [HA, 11.5, -46, -0.8, 1]]){
    f.add(H.body, null, M(x, 0, z, 0, ry, 0, s), { keepColor: true });
    win.add(H.win, null, M(x, 0, z, 0, ry, 0, s), { keepColor: true });
  }
  const sm = PR.nearSnowman();
  f.add(sm, null, M(-8.6, 0.25, -12, 0, 0.5, 0, 1.5), { keepColor: true });
  f.add(sm, null, M(-20, 0, -36, 0, 0.9, 0, 1.8), { keepColor: true });
  const cane = PR.nearCane();
  c.add(cane, null, M(-7.6, 0.2, -38, 0, 0.2, 0, 2.6), { keepColor: true });
  // гирлянды над трассой: высокие столбы и провисающие нити лампочек
  for (const z of [-6, -44]){
    for (const s of [-1, 1]){
      c.add(cyl(0.12, 0.14, 6.6, 12, 6), 0xF3EEF6, M(s * 6.4, 3.3, z), { stripe: { period: 0.45, len: 6.6, turns: 1 } });
      c.add(sph(0.26, 12, 8), 0xE58FA0, M(s * 6.4, 6.7, z));
    }
    for (let i = 0; i <= 24; i++){
      const x = -6.2 + i * 12.4 / 24, y = 6.3 - 1.0 * (1 - (x / 6.2) ** 2);
      gl.add(sph(0.1, 8, 6), 0xffffff, M(x, y, z));
    }
  }
  for (const G of [HA.body, HA.win, HB.body, HB.win, sm, cane]) G.dispose();
  finish(g, [[f, mats.felt, true], [c, mats.candy, false], [gl, mats.glowBulb, false], [win, mats.glowWin, false]]);
  return { group: g, len: L, type: "village" };
}

// ---------- ПЛАНИРОВЩИК ----------
export function createPieces(mats, o){
  const rng = makeRng(((o.seed >>> 0) || 1) * 7 + 99);
  const emit = o.emit || (() => {});
  const group = new THREE.Group(); group.name = "world:pieces";
  const built = {};
  const builders = { gate: buildGate, bridge: buildBridge, tunnel: buildTunnel, village: buildVillage };
  for (const t of PIECE_TYPES){ built[t] = builders[t](mats); group.add(built[t].group); }

  const FIRST = o.firstAt ?? 120, AHEAD = 145, BEHIND = 15;
  const pool = [], plan = [];
  for (let i = 0; i < 6; i++) pool.push({ type: "gate", s0: 0, len: 0, shown: false, revealed: false, entered: false, exited: false,
    payload: { type: "gate", s0: 0, s1: 0, z: 0 } });
  let lastType = "", nextStart = FIRST;

  function pickType(){
    let t = "gate";
    for (let a = 0; a < 2; a++){
      let u = rng();
      for (const k of PIECE_TYPES){ u -= WEIGHTS[k]; if (u <= 0){ t = k; break; } }
      if (t !== lastType) break;
    }
    lastType = t; return t;
  }
  function add(type, s0){
    const p = pool.pop(); if (!p) return null;
    p.type = type; p.s0 = s0; p.len = built[type].len;
    p.shown = p.revealed = p.entered = p.exited = false;
    p.payload.type = type; p.payload.s0 = s0; p.payload.s1 = s0 + p.len;
    plan.push(p); return p;
  }
  function ensure(){
    while (plan.length < 3){
      const prev = plan.length ? plan[plan.length - 1] : null;
      const s0 = prev ? prev.s0 + Math.max(prev.len + 150, 250 + rng() * 150) : nextStart;
      add(pickType(), s0);
    }
  }
  function drop(i){
    const p = plan[i]; built[p.type].group.visible = false;
    plan.splice(i, 1); pool.push(p);
  }
  function reset(dist){
    while (plan.length) drop(plan.length - 1);
    nextStart = dist + FIRST; lastType = "";
    ensure();
  }
  // принудительно поставить пьесу (дев-страница, туториал, тесты): план очищается, она становится следующей
  function force(type, s0){
    while (plan.length) drop(plan.length - 1);
    lastType = type; add(type, s0); ensure();
  }

  const state = { tunnel: false, calm: false, bridge: null };
  let lastDist = -1e9;
  function update(dist){
    if (dist < lastDist - 1) reset(dist);
    lastDist = dist;
    ensure();
    state.tunnel = false; state.calm = false; state.bridge = null;
    for (let i = plan.length - 1; i >= 0; i--){
      const p = plan[i], b = built[p.type], ahead = p.s0 - dist, z = dist - p.s0;
      if (p.s0 + p.len - dist < -BEHIND){
        if (p.shown){ emit("landmark:gone", p.payload); }
        drop(i); continue;
      }
      p.payload.z = z;
      if (ahead < AHEAD){
        if (!p.shown){ p.shown = true; b.group.visible = true; emit("landmark:spawn", p.payload); }
        b.group.position.z = z;
        if (!p.revealed && ahead < 70){ p.revealed = true; emit("landmark", p.payload); }
        if (!p.entered && dist >= p.s0){ p.entered = true; emit("landmark:pass", p.payload); if (p.type === "tunnel") emit("tunnel:enter", p.payload); }
        if (!p.exited && dist >= p.s0 + p.len){ p.exited = true; if (p.type === "tunnel") emit("tunnel:exit", p.payload); }
        if (p.type === "tunnel" && dist >= p.s0 && dist < p.s0 + p.len) state.tunnel = true;
        if ((p.type === "tunnel" || p.type === "bridge") && dist > p.s0 - 25 && dist < p.s0 + p.len + 5) state.calm = true;
        if (p.type === "bridge") state.bridge = p;
      }
    }
  }

  // блокировка декора: (s — дистанция трассы, layer, side −1/1)
  function blocked(s, layer, side){
    for (let i = 0; i < plan.length; i++){
      const p = plan[i], a = p.s0, e = p.s0 + p.len;
      switch (p.type){
        case "gate":
          if ((layer === L_NEAR || layer === L_LAMP) && s > a - 6 && s < e + 6) return true;
          if (layer === L_MID && s > a - 3 && s < e + 3) return true;
          break;
        case "bridge":
          if (layer !== L_FAR && s > a - 7 && s < e + 7) return true;
          break;
        case "tunnel":
          if (layer !== L_FAR && s > a - 5 && s < e + 5) return true;
          break;
        case "village":
          if (layer === L_MID && s > a - 10 && s < e + 10) return true;
          if (layer === L_NEAR && side < 0 && s > a - 4 && s < e + 2) return true;
          if (layer === L_LAMP && s > a - 8 && s < a + 2) return true;
          break;
      }
    }
    return false;
  }
  // геймплей: за 10 м до тоннеля и внутри стен нет; через центр арки идёт линия энергонов
  function wallFree(s){
    for (let i = 0; i < plan.length; i++){ const p = plan[i]; if (p.type === "tunnel" && s > p.s0 - 10 && s < p.s0 + p.len) return false; }
    return true;
  }
  function nearPiece(s, margin){
    for (let i = 0; i < plan.length; i++){ const p = plan[i]; if (s > p.s0 - margin && s < p.s0 + p.len + margin) return true; }
    return false;
  }
  function dispose(){ group.traverse(n => { if (n.isMesh) n.geometry.dispose(); }); }
  return { group, plan, built, state, update, reset, force, blocked, wallFree, nearPiece, dispose };
}
