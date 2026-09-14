// Ризи RUN v3 — VFX-кит (слот vfx). Самодостаточный модуль: адаптер src/plugins/vfx.js только зовёт API.
//
//   const vfx = createVFX(ctx);  ctx.scene.add(vfx.root);
//   vfx.emit("land", {x, y, z}, {impact: 1});   vfx.update(realDt);   vfx.dispose();
//
// Состав (draw calls при q=med): мягкие частицы 1 + светящиеся частицы 1 + снег 1 + линии скорости 1 (только
// при скорости > 20 / boost). Пустой пул прячется (visible=false) → в покое 1 вызов (снег).
// Частицы живут на realDt (бибилия 2.0): хит-стоп их не замораживает.
// Эмиттеры и числа — feature-bible VFX-1..VFX-4 (см. EMITTERS ниже). Все формы круглые/мягкие.
import * as THREE from "three";
import { createAtlas } from "./atlas.js";
import { createPool, TYPE, FLAG } from "./pool.js";
import { createSnow } from "./snow.js";
import { createSpeedLines } from "./speedlines.js";

const QUALITY = {
  low:  { soft: 384,  glow: 192, snow: 400,  lineSegs: 48, burst: 0.6 },
  med:  { soft: 768,  glow: 384, snow: 900,  lineSegs: 64, burst: 1.0 },
  high: { soft: 1024, glow: 512, snow: 1500, lineSegs: 64, burst: 1.0 },
};
const RM_MUL = 0.3;             // reduced motion: частиц −70%
const RM_SNOW = 0.5;            // окружающий снег при reduced motion — вдвое реже и без вытягивания

// порядковые id эмиттеров (для переносов дробных количеств между вызовами)
const ID = { footL: 0, footR: 1, step: 2, takeoff: 3, land: 4, dive: 5, slide: 6, lane: 7, edgebump: 8,
  pickup: 9, magnet: 10, nearmiss: 11, hit: 12, milestone: 13, record: 14 };
export const EMITTERS = Object.keys(ID);

const EMPTY = Object.freeze({});
const TAU = Math.PI * 2;
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
const damp = (a, b, l, dt) => a + (b - a) * (1 - Math.exp(-l * dt));

export function createVFX(ctx, options){
  const o0 = options || EMPTY;
  const Qname = ctx.quality === "low" || ctx.quality === "high" ? ctx.quality : "med";
  const Q = QUALITY[Qname];
  const G = ctx.G || null;
  const camera = ctx.camera;

  const root = new THREE.Group();
  root.name = "vfx";

  const atlas = createAtlas();
  const soft = createPool({ name: "soft", capacity: o0.softCapacity || Q.soft, atlas, renderOrder: 20 });
  const glow = createPool({ name: "glow", capacity: o0.glowCapacity || Q.glow, atlas, renderOrder: 21 });
  const snow = createSnow({ count: Q.snow, renderOrder: 19 });
  const lines = createSpeedLines({ segments: Q.lineSegs });
  root.add(snow.mesh, soft.mesh, glow.mesh, lines.mesh);

  // палитра (линейные цвета; ×k ниже — HDR для bloom по максимальному каналу, порог ≈ 1.15)
  const C = {
    snowTint: new THREE.Color(0xE6F0FF), snow: new THREE.Color(0xF2F6FF), white: new THREE.Color(0xFFFFFF),
    lime: new THREE.Color(0xC0FF3F), blue: new THREE.Color(0x0536D4), sky: new THREE.Color(0x8FD3FF),
    hazard: new THREE.Color(0xFF3B5C), pink: new THREE.Color(0xFF6FB0), blush: new THREE.Color(0xFFD6E0),
    ice: new THREE.Color(0xDDEBFF), flashLime: new THREE.Color(0xE9FFB8), flashHit: new THREE.Color(0xFFC2CF),
  };
  const CONF = [C.lime, C.blue, C.white, C.sky, C.lime, C.blue];

  // ---------- состояние ----------
  let now = 0, I = 0, reduced = !!o0.reducedMotion, hiddenLines = false;
  let boost = false, boostK = 0, tierT = 0, lineK = 0, stretchK = 0;
  let scroll = 0, lastDist = null;
  let manualTarget = false;
  const carry = new Float32Array(EMITTERS.length);
  const target = soft.uniforms.uTarget.value;           // общий Vector3 для обоих пулов
  glow.uniforms.uTarget.value = target;
  const camPos = new THREE.Vector3(), camQuat = new THREE.Quaternion(), ONE = new THREE.Vector3(1, 1, 1);

  // скорость мира для «пинка» частиц назад: opts.speed → G.speed → из I
  const speedOf = o => o.speed != null ? o.speed : (G && G.speed > 0 ? G.speed : 12 + 18 * I);
  // количество с учётом качества и reduced motion; дробь переносится на следующий вызов того же эмиттера
  function countOf(id, n, burst){
    const v = n * (reduced ? RM_MUL : 1) * (burst ? Q.burst : 1) + carry[id];
    const k = Math.floor(v);
    carry[id] = v - k;
    return k;
  }
  const setCol = (P, c, k) => { P.r = c.r * k; P.g = c.g * k; P.b = c.b * k; };
  // случайное направление на сфере → dx/dy/dz
  let dx = 0, dy = 0, dz = 0;
  function sphereDir(){
    const u = Math.random() * 2 - 1, a = Math.random() * TAU, s = Math.sqrt(1 - u * u);
    dx = s * Math.cos(a); dy = u; dz = s * Math.sin(a);
  }

  // ---------- базовые «кирпичики» ----------
  function puff(x, y, z, T0){
    const P = soft.reset();
    P.x = x; P.y = y; P.z = z; P.birth = T0;
    P.type = Math.random() < 0.5 ? TYPE.PUFF : TYPE.PUFF2;
    P.rot = Math.random() * TAU; P.spin = rnd(-2, 2);
    P.grav = -2; P.flags = FLAG.EASE_OUT; P.seed = Math.random();
    setCol(P, C.snowTint, 1);
    return P;
  }
  function star(x, y, z, T0){
    const P = glow.reset();
    P.x = x; P.y = y; P.z = z; P.birth = T0;
    P.type = TYPE.STAR; P.add = 1; P.grav = -4;
    P.rot = Math.random() * TAU; P.spin = rnd(-6, 6); P.seed = Math.random();
    return P;
  }

  // ---------- ЭМИТТЕРЫ ----------
  // шаг: 2 облачка 0.20→0.45, 300 мс, v(±0.6, 0.9, +speed·0.15)
  function eStep(id, x, y, z, side, o, T0){
    const n = countOf(id, 2), sp = speedOf(o);
    for (let i = 0; i < n; i++){
      const P = puff(x + side * 0.04 + rnd(-0.06, 0.06), y + 0.05, z + rnd(-0.06, 0.06), T0);
      P.vx = rnd(-0.6, 0.6) * 0.6 + side * 0.25; P.vy = 0.9 * rnd(0.8, 1.2); P.vz = sp * 0.15 * rnd(0.85, 1.15);
      P.drag = 2.2; P.life = 0.3 * rnd(0.9, 1.15); P.s0 = 0.2; P.s1 = 0.45; P.a = 0.85;
      soft.push();
    }
    return n;
  }
  // взлёт: 6 облачков 0.25→0.6, 350 мс
  function eTakeoff(x, y, z, o, T0){
    const n = countOf(ID.takeoff, 6), sp = speedOf(o);
    for (let i = 0; i < n; i++){
      const a = (i / Math.max(1, n)) * TAU + rnd(-0.3, 0.3), h = rnd(0.8, 1.4);
      const P = puff(x + Math.cos(a) * 0.12, y + 0.05, z + Math.sin(a) * 0.12, T0);
      P.vx = Math.cos(a) * h; P.vy = rnd(0.3, 0.8); P.vz = Math.sin(a) * h * 0.6 + sp * 0.15;
      P.drag = 3; P.life = 0.35 * rnd(0.9, 1.1); P.s0 = 0.25; P.s1 = 0.6; P.a = 0.85;
      soft.push();
    }
    return n;
  }
  // приземление: 12 радиально (гориз. 1.6–2.4, вверх 0.5–0.9, drag 3.5), 0.30→0.85, 450 мс, alpha 0.85, #E6F0FF
  // + плоское кольцо r 0.3→1.8 м, alpha 0.6→0, 300 мс. Нырок ×1.5. impact 0..1 масштабирует разлёт
  function eLand(id, x, y, z, o, T0, dive){
    const mul = dive ? 1.5 : 1;
    const imp = o.impact != null ? clamp01(o.impact) : 1;
    const sc = (0.7 + 0.3 * imp) * (dive ? 1.2 : 1);
    const n = countOf(id, 12 * mul), sp = speedOf(o);
    for (let i = 0; i < n; i++){
      const a = (i / Math.max(1, n)) * TAU + rnd(-0.18, 0.18), h = rnd(1.6, 2.4) * sc;
      const P = puff(x + Math.cos(a) * 0.18, y + 0.06, z + Math.sin(a) * 0.14, T0);
      P.vx = Math.cos(a) * h; P.vz = Math.sin(a) * h * 0.8 + sp * 0.08; P.vy = rnd(0.5, 0.9) * sc;
      P.drag = 3.5; P.life = 0.45 * rnd(0.9, 1.12); P.s0 = 0.3 * mul; P.s1 = 0.85 * Math.sqrt(mul) * sc; P.a = 0.85;
      soft.push();
    }
    if (!reduced || Math.random() < 0.5){
      const P = soft.reset();
      P.x = x; P.y = y + 0.03; P.z = z; P.birth = T0;
      P.type = TYPE.RING; P.flags = FLAG.FLAT | FLAG.EASE_OUT;
      P.life = 0.3; P.s0 = 0.6; P.s1 = 3.6 * sc; P.a = 0.6;
      setCol(P, C.snow, 1.05); P.add = 0.12;
      soft.push();
    }
    return n + 1;
  }
  // подкат: 28/с, конус 35° назад-вверх, 0.18→0.5, 380 мс, 20% звёзд. opts.dt — длительность кадра
  const COS35 = Math.cos(35 * Math.PI / 180), AY = Math.sin(24 * Math.PI / 180), AZ = Math.cos(24 * Math.PI / 180);
  function eSlide(x, y, z, o, T0){
    const dt = o.dt != null ? o.dt : 1 / 60;
    const n = countOf(ID.slide, 28 * dt), sp = speedOf(o);
    for (let i = 0; i < n; i++){
      // направление в конусе вокруг оси (0, AY, AZ)
      const ct = 1 - Math.random() * (1 - COS35), stt = Math.sqrt(1 - ct * ct), ph = Math.random() * TAU;
      const px = Math.cos(ph) * stt, pq = Math.sin(ph) * stt;
      const ddx = px, ddy = AY * ct + AZ * pq, ddz = AZ * ct - AY * pq;
      const v = rnd(2.2, 4.0);
      if (Math.random() < 0.2){
        const P = star(x + rnd(-0.25, 0.25), y + 0.08, z + rnd(-0.05, 0.2), T0);
        P.type = Math.random() < 0.5 ? TYPE.STAR : TYPE.FLAKE;
        P.vx = ddx * v; P.vy = ddy * v; P.vz = ddz * v + sp * 0.15;
        P.drag = 3; P.life = 0.38 * rnd(0.8, 1.1); P.s0 = 0.16; P.s1 = 0.02; P.a = 1;
        setCol(P, C.ice, 1.7);
        glow.push();
      } else {
        // два «буруна» по бокам ступней (как лыжи), а не один комок по центру
        const side = i % 2 ? 1 : -1;
        const P = puff(x + side * rnd(0.16, 0.3), y + 0.05, z + rnd(-0.05, 0.2), T0);
        P.vx = ddx * v + side * 0.5; P.vy = ddy * v; P.vz = ddz * v + sp * 0.15;
        P.drag = 2.5; P.life = 0.38 * rnd(0.85, 1.1); P.s0 = 0.2; P.s1 = 0.62; P.a = 0.92;
        soft.push();
      }
    }
    return n;
  }
  // смена полосы: 4 облачка от внешней ноги (dir — куда сдвиг: −1 влево, +1 вправо)
  function eLane(x, y, z, o, T0){
    const dir = o.dir || 1, n = countOf(ID.lane, 4), sp = speedOf(o);
    for (let i = 0; i < n; i++){
      const P = puff(x - dir * 0.22 + rnd(-0.05, 0.05), y + 0.05, z + rnd(-0.1, 0.1), T0);
      P.vx = -dir * rnd(0.6, 1.4); P.vy = rnd(0.4, 0.9); P.vz = sp * 0.15 * rnd(0.8, 1.2);
      P.drag = 2.6; P.life = 0.3 * rnd(0.9, 1.15); P.s0 = 0.2; P.s1 = 0.5; P.a = 0.8;
      soft.push();
    }
    return n;
  }
  // удар о бортик: 6 облачков + пара снежинок-бликов у стенки
  function eEdge(x, y, z, o, T0){
    const dir = o.dir || 1, n = countOf(ID.edgebump, 6), sp = speedOf(o);
    for (let i = 0; i < n; i++){
      const P = puff(x + dir * 0.38, y + rnd(0.1, 1.0), z + rnd(-0.15, 0.15), T0);
      P.vx = -dir * rnd(0.8, 1.8); P.vy = rnd(0.3, 1.2); P.vz = sp * 0.12;
      P.drag = 3.2; P.life = 0.34; P.s0 = 0.2; P.s1 = 0.55; P.a = 0.85;
      soft.push();
    }
    for (let i = 0; i < (reduced ? 0 : 2); i++){
      const P = star(x + dir * 0.4, y + rnd(0.3, 1.0), z, T0);
      P.type = TYPE.FLAKE; P.vx = -dir * rnd(1, 2); P.vy = rnd(0.5, 1.5); P.drag = 4;
      P.life = 0.3; P.s0 = 0.18; P.s1 = 0; setCol(P, C.ice, 1.6);
      glow.push();
    }
    return n;
  }
  // подбор энергона: 7 звёзд (60% лайм, 40% белые) 2.2–4.0 м/с, drag 5, 0.28→0, 320 мс;
  // кольцо-billboard 0.2→1.3 м за 220 мс easeOutCubic, 0.9→0; вспышка ядра. big (каждый 10-й): 12 звёзд, кольцо 1.8
  // якорь сдвинут к камере (+0.45 z, +0.2 y): со спины грудь Ризи закрыта телом; opts.raw — без сдвига
  function ePickup(x, y, z, o, T0){
    if (!o.raw){ y += 0.2; z += 0.45; }
    const big = !!o.big;
    const n = countOf(ID.pickup, big ? 12 : 7, true);
    for (let i = 0; i < n; i++){
      sphereDir();
      const v = rnd(2.2, 4.0) * (big ? 1.15 : 1);
      const P = star(x, y, z, T0);
      P.vx = dx * v; P.vy = dy * v * 0.8 + 0.6; P.vz = dz * v;
      P.drag = 5; P.life = 0.32 * rnd(0.9, 1.1); P.s0 = 0.28 * (big ? 1.2 : 1); P.s1 = 0; P.a = 1;
      if (i / Math.max(1, n) < 0.6) setCol(P, C.lime, 2.4); else setCol(P, C.white, 1.9);
      P.flags = FLAG.NO_GROUND;
      glow.push();
    }
    let P = glow.reset();
    P.x = x; P.y = y; P.z = z; P.birth = T0;
    P.type = TYPE.RING; P.add = 1; P.flags = FLAG.EASE_OUT | FLAG.NO_GROUND;
    P.life = 0.22; P.s0 = 0.2; P.s1 = big ? 1.8 : 1.3; P.a = 0.9;
    setCol(P, C.lime, 1.9);
    glow.push();
    P = glow.reset();
    P.x = x; P.y = y; P.z = z; P.birth = T0;
    P.type = TYPE.DISK; P.add = 1; P.flags = FLAG.EASE_OUT | FLAG.NO_GROUND;
    P.life = 0.1; P.s0 = 0.2; P.s1 = big ? 0.9 : 0.62; P.a = 0.55;
    setCol(P, C.flashLime, 2.0);
    glow.push();
    return n + 2;
  }
  // магнитный шлейф: искры и мягкие лаймовые капли от энергона к груди Ризи (uTarget), easeInQuad, лесенкой по 15 мс
  function eMagnet(x, y, z, o, T0){
    if (o.target){ target.set(o.target.x, o.target.y, o.target.z); manualTarget = true; }
    const n = countOf(ID.magnet, 6, true);
    for (let i = 0; i < n; i++){
      const P = star(x + rnd(-0.12, 0.12), y + rnd(-0.12, 0.12), z + rnd(-0.08, 0.08), T0 + i * 0.016);
      P.vx = rnd(-1.6, 1.6); P.vy = rnd(0.4, 1.8); P.vz = rnd(0.2, 1.2);
      P.drag = 4; P.grav = 0; P.life = rnd(0.18, 0.26); P.s0 = 0.24; P.s1 = 0.08; P.a = 1;
      P.flags = FLAG.HOMING | FLAG.NO_GROUND; setCol(P, i % 3 === 2 ? C.white : C.lime, 2.2);
      glow.push();
    }
    const m = reduced ? 1 : 4;
    for (let i = 0; i < m; i++){
      const P = glow.reset();
      P.x = x; P.y = y; P.z = z; P.birth = T0 + i * 0.022;
      P.type = TYPE.DISK; P.add = 0.85; P.flags = FLAG.HOMING | FLAG.NO_GROUND;
      P.life = 0.14 + i * 0.02; P.s0 = 0.38 - i * 0.05; P.s1 = 0.1; P.a = 0.55;
      setCol(P, C.lime, 1.6);
      glow.push();
    }
    return n + m;
  }
  // near-miss: «вжух» — светлые штрихи пролетают мимо со стороны препятствия + лёгкие облачка ветра
  function eNearMiss(x, y, z, o, T0){
    const side = o.side != null ? (o.side < 0 ? -1 : o.side > 0 ? 1 : 0) : 1;
    const n = countOf(ID.nearmiss, 10);
    for (let i = 0; i < n; i++){
      const sx = side === 0 ? (i % 2 ? 1 : -1) : side;
      const P = glow.reset();
      P.x = x + sx * rnd(0.45, 0.95); P.y = y + rnd(0.25, 1.9); P.z = z + rnd(-1.4, 0.2); P.birth = T0 + i * 0.012;
      P.vx = sx * rnd(0.3, 1.3); P.vy = rnd(-0.2, 0.5); P.vz = rnd(10, 16);
      P.drag = 2.2; P.type = TYPE.STREAK; P.stretch = rnd(9, 15);
      P.life = rnd(0.2, 0.3); P.s0 = 0.09; P.s1 = 0.04; P.a = 0.95; P.add = 0.45;
      P.flags = FLAG.NO_GROUND; setCol(P, C.ice, 1.35);
      glow.push();
    }
    const m = countOf(ID.nearmiss, 4);
    for (let i = 0; i < m; i++){
      const sx = side === 0 ? (i % 2 ? 1 : -1) : side;
      const P = puff(x + sx * rnd(0.4, 0.8), y + rnd(0.2, 1.2), z + rnd(-0.6, 0.2), T0);
      P.vx = sx * rnd(0.4, 1.0); P.vy = rnd(0, 0.4); P.vz = rnd(4, 7);
      P.drag = 3; P.life = 0.32; P.s0 = 0.15; P.s1 = 0.5; P.a = 0.45; P.grav = 0;
      soft.push();
    }
    return n + m;
  }
  // удар: розово-красный взрыв — вспышка, кольцо, войлочные клочки, звёзды, снег у ног
  function eHit(x, y, z, o, T0){
    if (!o.raw) z += 0.45;              // тот же сдвиг к камере, что у подбора
    let P = glow.reset();
    P.x = x; P.y = y; P.z = z + 0.1; P.birth = T0;
    P.type = TYPE.DISK; P.add = 0.6; P.flags = FLAG.EASE_OUT | FLAG.NO_GROUND;
    P.life = 0.14; P.s0 = 0.4; P.s1 = 1.9; P.a = 0.9; setCol(P, C.flashHit, 2.0);
    glow.push();
    P = soft.reset();
    P.x = x; P.y = y; P.z = z + 0.1; P.birth = T0;
    P.type = TYPE.RING; P.add = 0.2; P.flags = FLAG.EASE_OUT | FLAG.NO_GROUND;
    P.life = 0.32; P.s0 = 0.4; P.s1 = 2.8; P.a = 0.95; setCol(P, C.hazard, 1.25);
    soft.push();
    const n = countOf(ID.hit, 16, true);
    for (let i = 0; i < n; i++){
      sphereDir();
      const v = rnd(2.0, 4.5);
      const Q2 = puff(x + dx * 0.15, y + dy * 0.15, z + dz * 0.15, T0);
      Q2.vx = dx * v; Q2.vy = Math.abs(dy) * v * 0.8 + 0.8; Q2.vz = dz * v * 0.6 + 1.0;
      Q2.drag = 4; Q2.grav = -6; Q2.life = rnd(0.45, 0.62); Q2.s0 = 0.16; Q2.s1 = 0.42; Q2.a = 0.95;
      setCol(Q2, i % 3 === 0 ? C.hazard : i % 3 === 1 ? C.pink : C.blush, 1);
      soft.push();
    }
    const m = countOf(ID.hit, 12, true);
    for (let i = 0; i < m; i++){
      sphereDir();
      const v = rnd(3, 6);
      const S = star(x, y, z, T0);
      S.vx = dx * v; S.vy = dy * v + 0.5; S.vz = dz * v;
      S.drag = 5; S.life = 0.35 * rnd(0.85, 1.1); S.s0 = 0.3; S.s1 = 0; S.flags = FLAG.NO_GROUND;
      if (i % 2) setCol(S, C.pink, 2.0); else setCol(S, C.white, 1.8);
      glow.push();
    }
    const k = countOf(ID.hit, 6);
    for (let i = 0; i < k; i++){
      const a = (i / Math.max(1, k)) * TAU;
      const F = puff(x + Math.cos(a) * 0.2, 0.06, z + Math.sin(a) * 0.2, T0);
      F.vx = Math.cos(a) * rnd(1.2, 2.0); F.vy = rnd(0.4, 0.8); F.vz = Math.sin(a) * 1.2;
      F.drag = 3.5; F.life = 0.42; F.s0 = 0.25; F.s1 = 0.7; F.a = 0.8;
      soft.push();
    }
    return n + m + k + 2;
  }
  // конфетти-кусочек (войлочные прямоугольники со скруглением, кувыркаются)
  function confetto(x, y, z, T0, i){
    const P = soft.reset();
    P.x = x; P.y = y; P.z = z; P.birth = T0;
    P.type = TYPE.CONFETTI; P.flags = FLAG.FLUTTER | FLAG.LATE_FADE;
    P.rot = Math.random() * TAU; P.spin = rnd(-7, 7); P.seed = Math.random();
    P.s0 = P.s1 = rnd(0.17, 0.24); P.a = 1;
    setCol(P, CONF[i % CONF.length], 1);
    return P;
  }
  // рубеж: салют конфетти над Ризи + лаймовые блики + кольцо на земле
  function eMilestone(x, y, z, o, T0){
    const n = countOf(ID.milestone, 64, true);
    for (let i = 0; i < n; i++){
      const P = confetto(x + rnd(-0.4, 0.4), y + 1.9, z + rnd(-0.3, 0.3), T0, i);
      P.vx = rnd(-2.8, 2.8); P.vy = rnd(4.5, 7.8); P.vz = rnd(-1.2, 2.2);
      P.drag = 1.6; P.grav = -5.5; P.life = rnd(1.5, 2.1);
      soft.push();
    }
    const m = countOf(ID.milestone, 10, true);
    for (let i = 0; i < m; i++){
      sphereDir();
      const S = star(x + dx * 0.3, y + 1.9, z + dz * 0.3, T0);
      S.vx = dx * 3; S.vy = Math.abs(dy) * 4 + 1; S.vz = dz * 2; S.drag = 3; S.grav = -3;
      S.life = rnd(0.5, 0.8); S.s0 = 0.34; S.s1 = 0; setCol(S, i % 2 ? C.white : C.lime, 2.2); S.flags = FLAG.NO_GROUND;
      glow.push();
    }
    const R = glow.reset();
    R.x = x; R.y = 0.04; R.z = z; R.birth = T0;
    R.type = TYPE.RING; R.add = 0.7; R.flags = FLAG.FLAT | FLAG.EASE_OUT;
    R.life = 0.5; R.s0 = 0.6; R.s1 = 4.4; R.a = 0.8; setCol(R, C.lime, 1.4);
    glow.push();
    return n + m + 1;
  }
  // новый рекорд: две пушки из нижних углов, вторая волна по 50 через 350 мс
  function cannon(side, x, z, cnt, T0){
    const n = countOf(ID.record, cnt, true);
    const ox = x + side * 3.2, oy = 0.4, oz = z + 1.1;
    for (let i = 0; i < n; i++){
      const P = confetto(ox + rnd(-0.15, 0.15), oy + rnd(-0.1, 0.1), oz + rnd(-0.15, 0.15), T0 + rnd(0, 0.05), i);
      P.vx = -side * rnd(2.0, 4.6); P.vy = rnd(7, 11.5); P.vz = rnd(-3.6, -0.8);
      P.drag = 1.25; P.grav = -6.5; P.life = rnd(2.0, 2.8);
      if (i % 7 === 3) setCol(P, C.sky, 1);
      soft.push();
    }
    const m = reduced ? 1 : 6;
    for (let i = 0; i < m; i++){
      const S = star(ox, oy + 0.3, oz, T0);
      S.vx = -side * rnd(1, 3); S.vy = rnd(3, 6); S.vz = rnd(-2, 0); S.drag = 4; S.grav = -3;
      S.life = rnd(0.35, 0.55); S.s0 = 0.4; S.s1 = 0; setCol(S, i % 2 ? C.white : C.lime, 2.2); S.flags = FLAG.NO_GROUND;
      glow.push();
    }
    return n + m;
  }
  function eRecord(x, y, z, o, T0){
    let n = cannon(-1, x, z, 90, T0) + cannon(1, x, z, 90, T0);
    n += cannon(-1, x, z, 50, T0 + 0.35) + cannon(1, x, z, 50, T0 + 0.35);
    return n;
  }

  // ---------- API ----------
  // emit(name, pos?, opts?) → сколько частиц выпущено. pos: {x,y,z} (Vector3 подходит); без pos — ноги Ризи из G.
  // opts (все необязательны): delay (с), speed, side (−1|0|1), dir (−1|1), impact (0..1), big, dt, target {x,y,z}
  function emit(name, pos, opts){
    const o = opts || EMPTY;
    let x = 0, y = 0, z = 0;
    if (pos){ x = pos.x || 0; y = pos.y || 0; z = pos.z || 0; }
    else if (G){ x = G.x || 0; y = G.py || 0; z = 0; }
    const T0 = now + (o.delay || 0);
    switch (name){
      case "footL": return eStep(ID.footL, x, y, z, -1, o, T0);
      case "footR": return eStep(ID.footR, x, y, z, 1, o, T0);
      case "step": return eStep(ID.step, x, y, z, o.side || 0, o, T0);
      case "takeoff": return eTakeoff(x, y, z, o, T0);
      case "land": return eLand(ID.land, x, y, z, o, T0, !!o.dive);
      case "dive": return eLand(ID.dive, x, y, z, o, T0, true);
      case "slide": return eSlide(x, y, z, o, T0);
      case "lane": return eLane(x, y, z, o, T0);
      case "edgebump": return eEdge(x, y, z, o, T0);
      case "pickup": return ePickup(x, y, z, o, T0);
      case "magnet": return eMagnet(x, y, z, o, T0);
      case "nearmiss": return eNearMiss(x, y, z, o, T0);
      case "hit": return eHit(x, y, z, o, T0);
      case "milestone": return eMilestone(x, y, z, o, T0);
      case "record": return eRecord(x, y, z, o, T0);
    }
    return 0;
  }

  function setIntensity(v){ I = clamp01(+v || 0); }
  function setReducedMotion(b){
    reduced = !!b;
    snow.setCount(Math.round(snow.count * (reduced ? RM_SNOW : 1)));
  }
  // куда летит магнитный шлейф; без вызова цель = грудь Ризи из G (x, py + 1.3, +0.45); setTarget(null) — вернуть авто
  function setTarget(x, y, z){
    if (x === null){ manualTarget = false; return; }
    target.set(x, y, z); manualTarget = true;
  }
  function setBoost(on){ boost = !!on; }
  function tierUp(){ tierT = 0.4; }
  function setSpeedLinesHidden(b){ hiddenLines = !!b; }   // тоннели

  function update(realDt){
    const dt = realDt > 0 ? Math.min(realDt, 0.25) : 0;
    now += dt;
    soft.setTime(now); glow.setTime(now);
    const speed = G && G.speed > 0 ? G.speed : 12 + 18 * I;

    // грудь Ризи, чуть к камере (+0.45 z, +0.2 y): со спины шлейф не прячется за телом
    if (!manualTarget && G){ target.set(G.x || 0, (G.py || 0) + 1.3, 0.45); }

    // снег: камера, прокрутка мира (+z) по G.dist либо интегралом скорости
    if (camera){ camera.getWorldPosition(camPos); }
    const su = snow.uniforms;
    su.uTime.value = now;
    if (G && typeof G.dist === "number"){
      const dd = lastDist === null ? 0 : G.dist - lastDist;
      lastDist = G.dist;
      if (dd > 0 && dd < 60) scroll += dd;
    } else scroll += speed * dt;
    if (scroll > 6000) scroll -= 6000;         // кратно боксу 60 м — без скачка
    su.uScroll.value = scroll;
    su.uCam.value.copy(camPos);
    su.uSpeed.value = speed;
    stretchK = damp(stretchK, reduced ? 0 : clamp01((speed - 19) / 3), 6, dt);
    su.uStretch.value = stretchK;

    // линии скорости: 0 до 20 → 0.25 на 30; boost +0.3 (вход 150 мс, выход 400 мс); tier-up +0.1 на 400 мс
    boostK = damp(boostK, boost ? 1 : 0, boost ? 20 : 7.5, dt);
    if (tierT > 0) tierT = Math.max(0, tierT - dt);
    const targetK = (reduced || hiddenLines) ? 0 : clamp01((speed - 20) / 10) * 0.25 + boostK * 0.3 + (tierT > 0 ? 0.1 : 0);
    lineK = damp(lineK, targetK, 10, dt);
    const lu = lines.uniforms;
    lu.uIntensity.value = lineK;
    lu.uTime.value = now;
    lu.uSpeedK.value = speed / 12;
    lines.mesh.visible = lineK > 0.004 && !!camera;
    if (lines.mesh.visible){
      camera.getWorldQuaternion(camQuat);
      lines.mesh.matrix.compose(camPos, camQuat, ONE);
    }

    soft.flush(); glow.flush();
    soft.update(); glow.update();
  }

  function clear(){ soft.clear(); glow.clear(); soft.flush(); glow.flush(); carry.fill(0); }

  function stats(){
    return { live: soft.live() + glow.live(), soft: soft.live(), glow: glow.live(),
      capacity: soft.capacity + glow.capacity, snow: snow.mesh.visible ? snow.mesh.geometry.instanceCount : 0,
      lines: +lineK.toFixed(3), visibleMeshes: root.children.filter(m => m.visible).length, quality: Qname, reduced };
  }

  function dispose(){
    if (root.parent) root.parent.remove(root);
    soft.dispose(); glow.dispose(); snow.dispose(); lines.dispose(); atlas.dispose();
  }

  setReducedMotion(reduced);

  return {
    root, emit, setIntensity, setReducedMotion, setTarget, setBoost, tierUp, setSpeedLinesHidden,
    update, clear, stats, dispose,
    get time(){ return now; },
    // для тестов/тонкой настройки
    parts: { soft, glow, snow, lines, atlas },
  };
}
