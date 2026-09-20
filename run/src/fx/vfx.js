// Ризи RUN v3 — VFX-кит (слот vfx). Самодостаточный модуль: адаптер src/plugins/vfx.js только зовёт API.
//
//   const vfx = createVFX(ctx);  ctx.scene.add(vfx.root);
//   vfx.emit("land", {x, y, z}, {impact: 1});   vfx.update(realDt);   vfx.dispose();
//
// Состав (draw calls при q=med): мягкие частицы 1 + светящиеся частицы 1 + снег 1 + линии скорости 1 (только
// при скорости > 20 / boost). Пустой пул прячется (visible=false) → в покое 1 вызов (снег).
// Частицы живут на realDt (библия 2.0): хит-стоп их НЕ замораживает. Пауза и отсчёт 3-2-1 — замораживают,
// но только через явный setPaused(true) от адаптера (main зовёт плагины каждый кадр, в том числе на паузе).
// Эмиттеры и числа — feature-bible VFX-1..VFX-4 (см. EMITTERS ниже). Все формы круглые/мягкие.
//
// ---------------------------------------------------------------------------------------------------------
// РЕЦЕПТ АДАПТЕРА src/plugins/vfx.js (ARCHITECTURE.md «События»; сигнатура плагина — update(realDt, ctx, simDt)):
//
//   const vfx = createVFX(ctx); ctx.scene.add(vfx.root);
//   const O = vfx.opts();                       // один переиспользуемый объект опций, без аллокаций в кадре
//   bus.on("land",     p => { O.reset(); O.impact = p.impact; O.dive = p.dive; vfx.emit("land", null, O); });
//   bus.on("jump",     () => vfx.emit("takeoff"));
//   bus.on("dive",     () => vfx.emit("dive"));
//   bus.on("lane",     p => { O.reset(); O.dir = p.dir; vfx.emit("lane", null, O); });
//   bus.on("edgebump", p => { O.reset(); O.dir = p.dir; vfx.emit("edgebump", null, O); });
//   bus.on("pickup",   c => { O.reset(); O.big = G.mult >= 3; vfx.emit("pickup", c.object3d ? c.object3d.position : c, O); });
//   bus.on("nearmiss", o => { O.reset(); O.side = sideOf(o); vfx.emit("nearmiss", null, O); });
//   bus.on("hit",      () => vfx.emit("hit", HITPOS));         // HITPOS = {x: G.x, y: 1.0, z: -0.35}, переиспользуется
//   bus.on("milestone",() => vfx.emit("milestone"));
//   bus.on("landmark", () => vfx.emit("milestone"));           // ворота-рубеж и сет-пьесы world — тот же салют
//   bus.on("record",   () => { vfx.emit("record"); vfx.celebrate("record"); });   // ПЕРЕСЕЧЕНИЕ рекорда В ЗАБЕГЕ
//   bus.on("mission:complete", () => vfx.celebrate("mission"));
//   bus.on("combo:tier", () => vfx.tierUp());
//   bus.on("boost",    b => vfx.setBoost(b));
//   bus.on("tunnel:enter", () => vfx.setSpeedLinesHidden(true));
//   bus.on("tunnel:exit",  () => vfx.setSpeedLinesHidden(false));
//   bus.on("pause",     b => vfx.setPaused(!!b));              // ОБЯЗАТЕЛЬНО: иначе конфетти летит над стоящим миром
//   bus.on("countdown", () => vfx.setPaused(true));            // G.paused = true на весь отсчёт 3-2-1
//   bus.on("resume",    () => vfx.setPaused(false));
//   bus.on("start",     () => { vfx.setPaused(false); vfx.clear(); });
//   bus.on("gameover",  () => vfx.setPaused(false));           // на результатах конфетти должно жить
//   bus.on("settings",  s => vfx.setReducedMotion(!!s.reducedMotion));
//   update(realDt, ctx){                                        // arg 0 — УЖЕ realDt (ARCHITECTURE.md § Контракт плагина)
//     vfx.setIntensity(G.intensity);
//     if (G.sliding > 0 && G.dz > 0){ O.reset(); O.dt = realDt; vfx.emit("slide", null, O); }
//     else if (G.py <= 0.01 && G.dz > 0) стопы по фазе G.runPhase → vfx.emit("footL"/"footR", ...);
//     vfx.update(realDt);                                       // конфетти шагает отсюда же (private rAF выключен)
//   }
// Про `record`: main.js шлёт его ОДИН раз в забеге при G.dist >= G.best (cfg.recordMin). Салют на `gameover`+isBest
// — это ДРУГОЙ момент; можно делать оба, но именно пересечение рекорда в забеге праздновать обязательно.
// ---------------------------------------------------------------------------------------------------------
import * as THREE from "three";
import { createAtlas } from "./atlas.js";
import { createPool, TYPE, FLAG } from "./pool.js";
import { createSnow } from "./snow.js";
import { createSpeedLines } from "./speedlines.js";
import { createConfetti } from "./confetti.js";

// пул = soft + glow ≥ 512 (VFX-1); облачков-конфетти ≤ 600 живых (кольцевой буфер сам держит лимит)
// lineCols — плотность колонн тоннеля (единственный параметр VFX-3, который меняется качеством на лету);
// lineSegs — тесселяция цилиндра, печётся при создании
const QUALITY = {
  low:  { soft: 384, glow: 192, snow: 400,  lineSegs: 48, lineCols: 64,  burst: 0.6 },
  med:  { soft: 600, glow: 320, snow: 900,  lineSegs: 64, lineCols: 96,  burst: 1.0 },
  high: { soft: 600, glow: 400, snow: 1500, lineSegs: 64, lineCols: 128, burst: 1.0 },
};
const RM_MUL = 0.3;             // reduced motion: частиц −70%
const RM_SNOW = 0.5;            // окружающий снег при reduced motion — вдвое реже и без вытягивания

// порядковые id эмиттеров (для переносов дробных количеств между вызовами)
const ID = { footL: 0, footR: 1, step: 2, takeoff: 3, land: 4, dive: 5, slide: 6, lane: 7, edgebump: 8,
  pickup: 9, magnet: 10, nearmiss: 11, hit: 12, milestone: 13, record: 14 };
export const EMITTERS = Object.keys(ID);
// У СВОЕГО под-всплеска — свой слот переноса дроби. Иначе остаток от «16 клочков» съедала бы следующая
// строка того же эмиттера («12 звёзд»), и перенастройка одного числа тихо сдвигала бы соседнее
// (заметно при reduced motion, где 16×0.3 = 4.8).
const SUB = { hitStars: 15, hitFeet: 16, nmPuff: 17, msStars: 18, recR: 19, recL2: 20, recR2: 21 };
const CARRY_N = EMITTERS.length + 7;

const EMPTY = Object.freeze({});
const TAU = Math.PI * 2;
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
const damp = (a, b, l, dt) => a + (b - a) * (1 - Math.exp(-l * dt));

export function createVFX(ctx, options){
  const o0 = options || EMPTY;
  let Qname = ctx.quality === "low" || ctx.quality === "high" ? ctx.quality : "med";
  let Q = QUALITY[Qname];
  const G = ctx.G || null;
  const camera = ctx.camera;

  const root = new THREE.Group();
  root.name = "vfx";

  const atlas = createAtlas();
  const soft = createPool({ name: "soft", capacity: o0.softCapacity || Q.soft, atlas, renderOrder: 20 });
  const glow = createPool({ name: "glow", capacity: o0.glowCapacity || Q.glow, atlas, renderOrder: 21 });
  // буфер снега создаётся на максимум (high), качество режет instanceCount — setQuality без пересоздания
  const snow = createSnow({ count: QUALITY.high.snow, renderOrder: 19 });
  let confetti = null;                                    // DOM-конфетти создаётся лениво при первом celebrate()
  const lines = createSpeedLines({ segments: Q.lineSegs, columns: Q.lineCols });
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
  let manualTarget = false, paused = false, camValid = false;
  const carry = new Float32Array(CARRY_N);
  const target = soft.uniforms.uTarget.value;           // общий Vector3 для обоих пулов
  glow.uniforms.uTarget.value = target;
  const camPos = new THREE.Vector3(), camQuat = new THREE.Quaternion(), ONE = new THREE.Vector3(1, 1, 1);

  // Якорь «к камере»: точку подбора/удара сдвигаем на push метров ПО ЛУЧУ к камере и на lift вверх.
  // Игровая камера стоит за спиной (0 / 3.8 / 6.4, ARCHITECTURE.md CAM-1) — без сдвига взрыв рисуется
  // ВНУТРИ силуэта Ризи и читается как ободок на свитере, а не как всплеск. Вертикальную составляющую луча
  // берём с коэффициентом 0.3, чтобы эффект не сползал к высоте камеры. Без аллокаций: один общий вектор.
  const AN = new THREE.Vector3();
  function toCam(x, y, z, push, lift){
    AN.set(x, y + (lift || 0), z);
    const ax = camPos.x - AN.x, ay = camPos.y - AN.y, az = camPos.z - AN.z;
    const l = camValid ? Math.sqrt(ax * ax + ay * ay + az * az) : 0;
    if (l > 0.001){ const k = push / l; AN.x += ax * k; AN.y += ay * k * 0.3; AN.z += az * k; }
    else AN.z += push;                                  // камеры ещё нет (эмиссия до первого update) — просто к зрителю
    return AN;
  }

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
      P.drag = 2.2; P.life = 0.3 * rnd(0.9, 1.15); P.s0 = 0.2; P.s1 = 0.55; P.a = 0.95;
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
      P.drag = 3; P.life = 0.35 * rnd(0.9, 1.1); P.s0 = 0.25; P.s1 = 0.72; P.a = 0.95;
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
  // ПОДКАТ: 58/с (было 28 — при 0.42 с жизни в кадре жило ~3 частицы и «две лыжные волны» не собирались),
  // конус 35° вокруг оси, задранной на 34° назад-вверх, 0.30→1.05, 420 мс, 18% звёзд. opts.dt — длительность кадра
  const COS35 = Math.cos(35 * Math.PI / 180), AY = Math.sin(34 * Math.PI / 180), AZ = Math.cos(34 * Math.PI / 180);
  let slideSide = 1;                 // сквозное чередование сторон между кадрами (см. ниже)
  function eSlide(x, y, z, o, T0){
    const dt = o.dt != null ? o.dt : 1 / 60;
    const n = countOf(ID.slide, 58 * dt), sp = speedOf(o);
    for (let i = 0; i < n; i++){
      // направление в конусе вокруг оси (0, AY, AZ)
      const ct = 1 - Math.random() * (1 - COS35), stt = Math.sqrt(1 - ct * ct), ph = Math.random() * TAU;
      const px = Math.cos(ph) * stt, pq = Math.sin(ph) * stt;
      const ddx = px, ddy = AY * ct + AZ * pq, ddz = AZ * ct - AY * pq;
      const v = rnd(2.6, 4.6);
      if (Math.random() < 0.18){
        const P = star(x + rnd(-0.3, 0.3), y + 0.08, z + rnd(-0.05, 0.2), T0);
        P.type = Math.random() < 0.5 ? TYPE.STAR : TYPE.FLAKE;
        P.vx = ddx * v; P.vy = ddy * v; P.vz = ddz * v + sp * 0.15;
        P.drag = 3; P.life = 0.38 * rnd(0.8, 1.1); P.s0 = 0.2; P.s1 = 0.02; P.a = 1;
        setCol(P, C.ice, 1.7);
        glow.push();
      } else {
        // Два «буруна» по бокам ступней (как лыжи), а не один комок по центру: стороны разведены на
        // 0.26–0.44 м и дополнительно расходятся скоростью — с 6.4 м пара читается как пара.
        // Сторона чередуется СКВОЗНЫМ счётчиком, а не i % 2: подкат сыплет ~0.8 частицы за кадр,
        // поэтому i почти всегда 0 — прежний i % 2 отправлял ВСЕ буруны влево (отсюда «один смазок»).
        slideSide = -slideSide;
        const side = slideSide;
        const P = puff(x + side * rnd(0.26, 0.44), y + 0.05, z + rnd(-0.05, 0.2), T0);
        P.vx = ddx * v * 0.7 + side * 1.35; P.vy = ddy * v; P.vz = ddz * v + sp * 0.15;
        P.drag = 2.5; P.life = 0.42 * rnd(0.85, 1.1); P.s0 = 0.3; P.s1 = 1.05; P.a = 0.95;
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
      P.drag = 2.6; P.life = 0.3 * rnd(0.9, 1.15); P.s0 = 0.2; P.s1 = 0.62; P.a = 0.92;
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
  // ПОДБОР ЭНЕРГОНА (VFX-2, P0 — самая частая награда в игре). Числа выставлены по кадрам ИГРОВОЙ камеры
  // (fov 60+8·I, позиция 0 / 3.8 / 6.4) и портрета 390×844, а не по близкому «витринному» ракурсу:
  //   якорь          — toCam(push 1.1, lift 0.15): всплеск выходит ВПЕРЁД силуэта, а не рисуется сквозь свитер;
  //   вспышка ядра   — диск 0.4 → 1.5 м (big 2.2), 120 мс;
  //   кольцо         — 0.45 → 1.9 м (big 2.8) за 240 мс easeOutCubic: радиус 0.95 м против полуширины Ризи 0.45 м;
  //   вторая волна   — белый ореол 0.6 → 2.9 м (big 4.0) с задержкой 50 мс, alpha 0.35 — «двойной поп»;
  //   10 звёзд (big 16), 5–9 м/с, drag 3.5 — за 100 мс улетают на ~0.6 м, то есть уже вне силуэта.
  // opts.raw — не двигать якорь (для тестов и для эффектов, привязанных к точке мира).
  function ePickup(x, y, z, o, T0){
    if (!o.raw){ const A = toCam(x, y, z, 1.1, 0.15); x = A.x; y = A.y; z = A.z; }
    const big = !!o.big;
    const n = countOf(ID.pickup, big ? 16 : 10, true);
    for (let i = 0; i < n; i++){
      sphereDir();
      const v = rnd(5, 9) * (big ? 1.15 : 1);
      const P = star(x, y, z, T0);
      P.vx = dx * v; P.vy = dy * v * 0.8 + 0.9; P.vz = dz * v;
      P.drag = 3.5; P.life = 0.34 * rnd(0.9, 1.1); P.s0 = 0.42 * (big ? 1.25 : 1); P.s1 = 0; P.a = 1;
      if (i / Math.max(1, n) < 0.6) setCol(P, C.lime, 2.0); else setCol(P, C.white, 1.7);
      P.flags = FLAG.NO_GROUND;
      glow.push();
    }
    let P = glow.reset();
    P.x = x; P.y = y; P.z = z; P.birth = T0;
    P.type = TYPE.DISK; P.add = 1; P.flags = FLAG.EASE_OUT | FLAG.NO_GROUND;
    P.life = 0.12; P.s0 = 0.4; P.s1 = big ? 2.2 : 1.5; P.a = 0.75;
    setCol(P, C.flashLime, 2.0);
    glow.push();
    P = glow.reset();
    P.x = x; P.y = y; P.z = z; P.birth = T0;
    P.type = TYPE.RING; P.add = 1; P.flags = FLAG.EASE_OUT | FLAG.NO_GROUND;
    P.life = 0.24; P.s0 = 0.45; P.s1 = big ? 2.8 : 1.9; P.a = 0.9;
    setCol(P, C.lime, 1.55);
    glow.push();
    P = glow.reset();
    P.x = x; P.y = y; P.z = z; P.birth = T0 + 0.05;
    P.type = TYPE.RING; P.add = 0.8; P.flags = FLAG.EASE_OUT | FLAG.NO_GROUND;
    P.life = 0.3; P.s0 = 0.6; P.s1 = big ? 4.0 : 2.9; P.a = 0.35;
    setCol(P, C.white, 1.3);
    glow.push();
    return n + 3;
  }
  // МАГНИТНЫЙ ШЛЕЙФ энергона к груди Ризи (uTarget), easeInQuad, лесенкой по 18 мс.
  // Тоже перетюнен под игровую камеру: дуга уводится ЦЕЛИКОМ В ОДНУ СТОРОНУ от тела (знак дуги — в seed,
  // сам размах 2.2 м в шейдере pool.js), размеры вдвое больше прежних, жизнь длиннее — шлейф читается
  // как лента сбоку от силуэта, а не как пара пикселей на рюкзаке.
  // opts.side (−1|1) — с какой стороны обходить; по умолчанию сторона, с которой энергон подлетает.
  function eMagnet(x, y, z, o, T0){
    if (o.target){ target.set(o.target.x, o.target.y, o.target.z); manualTarget = true; }
    // сторона обхода: явная, иначе «наружу» от цели (энергон слева — дуга влево)
    const s = o.side != null && o.side !== 0 ? (o.side < 0 ? -1 : 1) : (x - target.x >= 0 ? 1 : -1);
    const seedOf = () => s > 0 ? rnd(0.78, 1.0) : rnd(0.0, 0.22);
    const n = countOf(ID.magnet, 11, true);
    for (let i = 0; i < n; i++){
      const P = star(x + rnd(-0.14, 0.14), y + rnd(-0.14, 0.14), z + rnd(-0.1, 0.1), T0 + i * 0.018);
      P.vx = rnd(-1.6, 1.6) + s * 1.4; P.vy = rnd(0.6, 2.2); P.vz = rnd(0.2, 1.4);
      P.drag = 4; P.grav = 0; P.life = rnd(0.34, 0.48); P.s0 = 0.46; P.s1 = 0.14; P.a = 1;
      // LATE_FADE: иначе частица гаснет ровно там, где easeInQuad наконец доносит её до груди, и лента
      // «обрывается» на полпути — видно только облако у энергона
      P.flags = FLAG.HOMING | FLAG.NO_GROUND | FLAG.LATE_FADE; P.seed = seedOf();
      setCol(P, i % 3 === 2 ? C.white : C.lime, 2.4);
      glow.push();
    }
    const m = reduced ? 2 : 6;
    for (let i = 0; i < m; i++){
      const P = glow.reset();
      P.x = x; P.y = y; P.z = z; P.birth = T0 + i * 0.026;
      P.type = TYPE.DISK; P.add = 0.85; P.flags = FLAG.HOMING | FLAG.NO_GROUND | FLAG.LATE_FADE;
      P.life = 0.34 + i * 0.035; P.s0 = 0.85 - i * 0.09; P.s1 = 0.16; P.a = 0.9; P.seed = seedOf();
      setCol(P, C.lime, 1.7);
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
    const m = countOf(SUB.nmPuff, 4);
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
    if (!o.raw){ const A = toCam(x, y, z, 0.8, 0); x = A.x; y = A.y; z = A.z; }   // к камере, как у подбора
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
    const m = countOf(SUB.hitStars, 12, true);
    for (let i = 0; i < m; i++){
      sphereDir();
      const v = rnd(3, 6);
      const S = star(x, y, z, T0);
      S.vx = dx * v; S.vy = dy * v + 0.5; S.vz = dz * v;
      S.drag = 5; S.life = 0.35 * rnd(0.85, 1.1); S.s0 = 0.3; S.s1 = 0; S.flags = FLAG.NO_GROUND;
      if (i % 2) setCol(S, C.pink, 2.0); else setCol(S, C.white, 1.8);
      glow.push();
    }
    const k = countOf(SUB.hitFeet, 6);
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
    const m = countOf(SUB.msStars, 10, true);
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
  // новый рекорд: две пушки из нижних углов, вторая волна по 50 через 350 мс.
  // cid — свой слот переноса дроби на каждую пушку и каждую волну (см. SUB)
  function cannon(side, x, z, cnt, T0, cid){
    const n = countOf(cid, cnt, true);
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
    let n = cannon(-1, x, z, 90, T0, ID.record) + cannon(1, x, z, 90, T0, SUB.recR);
    n += cannon(-1, x, z, 50, T0 + 0.35, SUB.recL2) + cannon(1, x, z, 50, T0 + 0.35, SUB.recR2);
    return n;
  }

  // ---------- API ----------
  // emit(name, pos?, opts?) → сколько частиц выпущено. pos: {x,y,z} (Vector3 подходит); без pos — ноги Ризи из G.
  // opts (все необязательны): delay (с), speed, side (−1|0|1), dir (−1|1), impact (0..1), big, dive, dt,
  //                           raw (не двигать якорь к камере), target {x,y,z}
  // ВНИМАНИЕ: объект opts читается как есть и НЕ копируется (ноль аллокаций в кадре) — поля «залипают»,
  // если переиспользовать один объект и не сбросить его. Используйте vfx.opts(): O.reset() перед каждым emit.
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

  // переиспользуемый контейнер опций для адаптера: O.reset() гасит ВСЕ поля, которые читает emit(),
  // поэтому забытый big/delay/dive с прошлого кадра невозможен. Аллокация одна — на создании адаптера.
  function makeOpts(){
    const O = {
      delay: 0, speed: null, side: null, dir: 0, impact: null, big: false, dive: false, dt: null,
      raw: false, target: null,
      reset(){
        O.delay = 0; O.speed = null; O.side = null; O.dir = 0; O.impact = null;
        O.big = false; O.dive = false; O.dt = null; O.raw = false; O.target = null;
        return O;
      },
    };
    return O;
  }

  function setIntensity(v){ I = clamp01(+v || 0); }
  let snowOff = false;
  function applySnow(){ snow.setCount(snowOff ? 0 : Math.round(Q.snow * (reduced ? RM_SNOW : 1))); }
  function setReducedMotion(b){
    reduced = !!b;
    applySnow();
    if (confetti) confetti.setReducedMotion(reduced);
  }
  // Смена качества на лету: плотность снега, множитель всплесков и плотность колонн тоннеля.
  // Ёмкость пулов и тесселяция цилиндра тоннеля остаются с создания (пересоздавать буферы на лету не будем).
  function setQuality(q){
    Qname = q === "low" || q === "high" ? q : "med"; Q = QUALITY[Qname];
    lines.setColumns(Q.lineCols);
    applySnow();
  }
  // ПАУЗА / ОТСЧЁТ 3-2-1: main зовёт update() плагинов каждый кадр, даже когда мир стоит (main.js: геймплей
  // под `!G.paused`, а плагины — без условия). Без этого вызова конфетти летело бы над замершей сценой,
  // а линии скорости продолжали бы нестись. Хит-стоп сюда НЕ относится: он замораживает simDt, а частицы
  // живут на realDt и должны продолжать лететь.
  function setPaused(b){
    const v = !!b;
    if (v === paused) return;
    paused = v;
    if (paused){                       // тоннель гасим мгновенно, а не через damp: мир уже стоит
      lineK = 0; boostK = 0;
      lines.uniforms.uIntensity.value = 0;
      lines.mesh.visible = false;
    }
  }
  function setSnowEnabled(b){ snowOff = !b; applySnow(); }
  // DOM-конфетти VFX-4: "mission" | "record" | объект/массив опций canvas-confetti.
  // По умолчанию конфетти шагает из vfx.update(realDt) — единственным владельцем порядка шага остаётся main
  // (ARCHITECTURE.md), и ctx.simulating/фоторежим его не обходят. options.confettiAuto: true — включить
  // собственный requestAnimationFrame (для отдельных страниц-стендов без игрового цикла).
  function celebrate(kind){
    if (typeof document === "undefined") return 0;
    if (!confetti) confetti = createConfetti({ reducedMotion: reduced, zIndex: o0.confettiZ, auto: !!o0.confettiAuto });
    if (kind === "mission") return confetti.mission();
    if (kind === "record") return confetti.record();
    return confetti.fire(kind);
  }
  // Куда летит магнитный шлейф. Без вызова цель = грудь Ризи из G — (G.x, G.py + 1.25, 0), сдвинутая
  // на 0.5 м по лучу к камере (toCam), чтобы шлейф заканчивался перед силуэтом. setTarget(null) — вернуть авто.
  function setTarget(x, y, z){
    if (x === null){ manualTarget = false; return; }
    target.set(x, y, z); manualTarget = true;
  }
  function setBoost(on){ boost = !!on; }
  function tierUp(){ tierT = 0.4; }
  function setSpeedLinesHidden(b){ hiddenLines = !!b; }   // тоннели

  function update(realDt){
    // на паузе/отсчёте время кита стоит: now не растёт → частицы, снег и конфетти замирают ровно в той позе,
    // в которой их застала пауза. Позицию камеры продолжаем читать (бокс снега не должен «отстать» от облёта).
    const dt = paused ? 0 : (realDt > 0 ? Math.min(realDt, 0.25) : 0);
    now += dt;
    soft.setTime(now); glow.setTime(now);
    const speed = G && G.speed > 0 ? G.speed : 12 + 18 * I;

    // грудь Ризи, сдвинутая к камере: со спины шлейф не прячется за телом (см. toCam)
    if (camera){ camera.getWorldPosition(camPos); camValid = true; }
    if (!manualTarget && G){
      const A = toCam(G.x || 0, (G.py || 0) + 1.25, 0, 0.5, 0);
      target.set(A.x, A.y, A.z);
    }

    // снег: камера, прокрутка мира (+z) по G.dist либо интегралом скорости
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

    // Линии скорости: 0 до 20 → 0.45 на 30 (библия 0.25 и прежние 0.32 на ярком снегу давали < 1% изменённых
    // пикселей — эффект «есть в коде, но не на экране»); boost +0.35 (вход 150 мс, выход 400 мс);
    // tier-up +0.12 на 400 мс. Покрытие на максимуме меряется стендом TEST.coverage().
    boostK = damp(boostK, boost ? 1 : 0, boost ? 20 : 7.5, dt);
    if (tierT > 0) tierT = Math.max(0, tierT - dt);
    const targetK = (reduced || hiddenLines || paused) ? 0
      : clamp01((speed - 20) / 10) * 0.45 + boostK * 0.35 + (tierT > 0 ? 0.12 : 0);
    lineK = damp(lineK, targetK, 10, dt);
    const lu = lines.uniforms;
    lu.uIntensity.value = lineK;
    lu.uTime.value = now;
    lu.uSpeedK.value = speed / 12;
    lines.mesh.visible = lineK > 0.004 && !!camera && !paused;
    if (lines.mesh.visible){
      camera.getWorldQuaternion(camQuat);
      lines.setPose(camPos, camQuat, ONE);     // matrixWorldNeedsUpdate ставит сам setPose
    }

    soft.flush(); glow.flush();
    soft.update(); glow.update();
    // DOM-конфетти шагает отсюда же — своего requestAnimationFrame у него по умолчанию нет
    if (confetti && dt > 0) confetti.step(dt);
  }

  function clear(){ soft.clear(); glow.clear(); soft.flush(); glow.flush(); carry.fill(0); if (confetti) confetti.clear(); }

  function stats(){
    return { live: soft.live() + glow.live(), soft: soft.live(), glow: glow.live(),
      capacity: soft.capacity + glow.capacity, snow: snow.mesh.visible ? snow.mesh.geometry.instanceCount : 0,
      lines: +lineK.toFixed(3), lineCols: lines.uniforms.uCols.value,
      visibleMeshes: root.children.filter(m => m.visible).length, quality: Qname, reduced, paused,
      confetti: confetti ? confetti.stats().live : 0 };
  }

  function dispose(){
    if (root.parent) root.parent.remove(root);
    soft.dispose(); glow.dispose(); snow.dispose(); lines.dispose(); atlas.dispose();
    if (confetti){ confetti.dispose(); confetti = null; }
  }

  setReducedMotion(reduced);

  return {
    root, emit, opts: makeOpts,
    setIntensity, setReducedMotion, setQuality, setSnowEnabled, setTarget, setBoost, setPaused, tierUp,
    setSpeedLinesHidden, celebrate, update, clear, stats, dispose,
    get confetti(){ return confetti; },
    get paused(){ return paused; },
    get time(){ return now; },
    // для тестов/тонкой настройки
    parts: { soft, glow, snow, lines, atlas },
  };
}
