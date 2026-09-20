// Ризи RUN v3 — кит роя Гасителей (SWARM-1, SWARM-2).
// Ворсистые войлочные помпоны-дроны с одним раскалённым красным глазом и крылышками.
// Рой = стая (пружина к слоту + разделение + выравнивание скоростей + блуждание) вокруг слотов, привязанных к кадру:
//   near = false → слоты за/над камерой, вне кадра (библия: «далеко, вне кадра»);
//   near = true  → рой держится в нижних углах и нижних ~20% кадра за спиной Ризи, не заходя на трассу впереди,
//                  и ДЕРЖИТСЯ там, пока near не погаснет (или не вызван far()); аналоговый danger — только накал
//                  (пульс глаз, прищур, rim, крылья), а не расстояние;
//   near true→false / far() → «разочарование»: провал −0.3 м за 400 мс, глаза → 2 за 500 мс, затем отход 1.2 с;
//   catch()      → сходятся на сферу r 0.8 вокруг Ризи за 450 мс (easeInCubic) — кадр слоу-мо проигрыша.
//
// ВЫЗОВЫ (6 на любом N и любом качестве): тело · оболочки меха · крылья · глаз · ореол · пятна на снегу.
// Теней в shadow map нет (castShadow off — вместо тени мягкое пятно-декаль).
//
// API
//   const swarm = createSwarm(ctx, opts?)
//     ctx:  { camera, quality: "low"|"med"|"high", look?: { mats? } | mats, reducedMotion? }
//     opts: { count?, layers?, trackHalfWidth? = 3.9, groundY? = 0, reducedMotion? }
//   scene.add(swarm.root)
//   swarm.update(realDt, simDt, s)   s = { mode, near: bool, danger 0..1, playerX, playerY, playerZ? = 0, speedI 0..1, titleDist? = 14 }
//   swarm.catch({x, y, z})           поимка (проигрыш); идёт по simDt, но не медленнее 0.25×realDt
//   swarm.release()                  отпустить пойманную Ризи (новый забег): рой улетает на слоты без телепорта
//   swarm.revive({x, y, z})          ударная волна: отбросить рой, вернуть в «далеко»
//   swarm.far() / swarm.reset()      «разочарованный» отход сейчас / мгновенно в исходное
//   swarm.setReducedMotion(bool), swarm.stats(), swarm.dispose()
import * as THREE from "three";
import { DIM, bodyGeometry, wingGeometry, createMaterials } from "./parts.js";

const TAU = Math.PI * 2;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, l, dt) => lerp(a, b, 1 - Math.exp(-l * dt));
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const easeInOutSine = t => -(Math.cos(Math.PI * t) - 1) / 2;
const easeInCubic = t => t * t * t;
const wrapPi = a => a - TAU * Math.floor((a + Math.PI) / TAU);

// сидированный ГПСЧ — хореография одинакова при каждом запуске
function rng(seed){
  let a = seed >>> 0;
  return (lo = 0, hi = 1) => {
    a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return lo + (hi - lo) * (((t ^ (t >>> 14)) >>> 0) / 4294967296);
  };
}

// SWARM-1: 7 дронов (на low 4). Ворс: библия даёт 6 слоёв на high; на med 5 и на low 3 —
// без ворса low читается как «сливы» (ревью), а 4 дрона × 3 слоя дёшевы даже на телефоне. Всё равно 1 вызов.
const COUNT = { low: 4, med: 7, high: 7 };
const LAYERS = { low: 3, med: 5, high: 6 };

// Ближние слоты по рангу на каждую сторону: [x NDC, y NDC, глубина вида м]. Нечётные i — левая сторона.
// Ранг 0 — «герой» в нижнем углу, 1 — «выглядывает» снизу у края трассы, 2 — выше по флангу, 3 — глубокий угол.
// Полоса под линией ног — это земля между камерой и Ризи: дрон на высоте ≥ 1 м помещается туда только близко
// к камере (глубина 3.5–5 м), поэтому «выглядывающие» крупные и срезаны нижним краем кадра (глаз всегда виден).
const NEAR = [
  [0.74, -0.58, 4.5],
  [0.30, -0.95, 3.6],
  [0.86, -0.14, 6.2],
  [0.93, -0.80, 4.0],
  [1.30, -0.30, 5.0],      // запас (N > 8): за краем кадра
];
// Портрет: трасса у линии ног шире кадра — только нижняя полоса, по 2 дрона на сторону, остальные в запасе
const NEAR_PORTRAIT = [
  [0.62, -0.95, 4.0],
  [0.14, -0.95, 4.8],
];

export function createSwarm(ctx, opts = {}){
  const camera = ctx.camera;
  const quality = ctx.quality === "low" || ctx.quality === "high" ? ctx.quality : "med";
  const N = Math.max(1, Math.min(32, opts.count || COUNT[quality]));
  const L = Math.max(0, Math.min(8, opts.layers != null ? opts.layers : LAYERS[quality]));
  const TRACK_HALF = opts.trackHalfWidth != null ? opts.trackHalfWidth : 3.9;
  let reduced = !!(opts.reducedMotion != null ? opts.reducedMotion : ctx.reducedMotion);
  const look = ctx.look && ctx.look.mats ? ctx.look.mats : (ctx.look && ctx.look.tex ? ctx.look : null);

  const M = createMaterials({ quality, look });
  M.U.uLayers.value = Math.max(1, L);

  // ---------- МЕШИ ----------
  const root = new THREE.Group();
  root.name = "swarm";
  const gBody = bodyGeometry(quality === "low" ? 3 : 4);
  const gFur = L ? bodyGeometry(3) : null;
  const gWing = wingGeometry();
  const gEye = new THREE.SphereGeometry(DIM.eyeR, quality === "low" ? 16 : 24, quality === "low" ? 12 : 16);
  const gQuad = new THREE.PlaneGeometry(1, 1);
  const gDecal = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

  const inst = (geo, mat, count, name, order) => {
    const m = new THREE.InstancedMesh(geo, mat, count);
    m.name = "swarm:" + name;
    m.frustumCulled = false;                 // экземпляры летают далеко от сферы геометрии
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.castShadow = false; m.receiveShadow = false;
    if (order) m.renderOrder = order;
    root.add(m);
    return m;
  };
  const mBody = inst(gBody, M.body, N, "body");
  const mFur = L ? inst(gFur, M.fur, N * L, "fur", 1) : null;
  const mWing = inst(gWing, M.wing, N * 2, "wings");
  const mEye = inst(gEye, M.eye, N, "eye");
  const mGlow = inst(gQuad, M.glow, N, "glow", 3);
  const mDecal = inst(gDecal, M.decal, N * 2, "decal", 2);   // [0..N) тени под дронами, [N..2N) красные пятна
  // instanceColor создаём сразу (до первой компиляции шейдера и без аллокаций в цикле)
  const C = new THREE.Color();
  for (let i = 0; i < N; i++){ mEye.setColorAt(i, C.setRGB(5, 0.6, 0.5)); mGlow.setColorAt(i, C.setRGB(1, 0, 0)); }
  for (let i = 0; i < N * 2; i++) mDecal.setColorAt(i, C.setRGB(0, 0, 0));
  // мех: instanceColor.r = номер дрона (узор ворса привязан к дрону, а не к слоту сортировки)
  if (mFur) for (let i = 0; i < N * L; i++) mFur.setColorAt(i, C.setRGB((Math.floor(i / L) + 0.5) / 64, 0, 0));
  for (const m of [mEye, mGlow, mDecal, mFur]) if (m) m.instanceColor.setUsage(THREE.DynamicDrawUsage);

  // ---------- ХОРЕОГРАФИЯ: слоты ----------
  // Ключевые кадры на дрона: 0 = далеко, 1 = подлёт, 2 = близко. Тип: 0 — (sx, sy) в NDC + глубина вида;
  // 1 — локальное смещение от камеры (right, up, forward), «за камерой»; 2 — как 0, но силуэт ≥ 65% в кадре.
  const KF = new Float32Array(N * 3 * 4);
  const SIZE = new Float32Array(N), PH = new Float32Array(N), STAG = new Float32Array(N), LOOK = new Float32Array(N);
  const WPH = new Float32Array(N * 3), TITLE = new Float32Array(N * 3), BLINK = new Float32Array(N), SPH = new Float32Array(N * 3);
  const RANK = new Uint8Array(N);
  {
    const r = rng(9173);
    const kf = (i, k, a, b, c, type) => { const o = (i * 3 + k) * 4; KF[o] = a; KF[o + 1] = b; KF[o + 2] = c; KF[o + 3] = type; };
    for (let i = 0; i < N; i++){
      const side = i % 2 ? -1 : 1, rank = Math.min(NEAR.length - 1, i >> 1);
      const S = NEAR[rank];
      RANK[i] = rank;
      // далеко: над и за камерой, вне кадра
      kf(i, 0, side * r(1.4, 3.8), r(2.6, 4.2), -r(1.0, 3.2), 1);
      // близко
      kf(i, 2, side * (S[0] + r(-0.04, 0.04)), S[1] + r(-0.04, 0.04), S[2] + r(-0.2, 0.2), S[0] > 1.05 ? 0 : 2);
      // подлёт: по краям кадра сверху (путь не пересекает трассу)
      kf(i, 1, side * r(1.0, 1.12), r(0.05, 0.5), r(5.0, 7.0), 0);
      SIZE[i] = r(0.9, 1.06);
      PH[i] = r(0, TAU);
      STAG[i] = r(0, 1);
      LOOK[i] = r(0.3, 0.6);
      WPH[i * 3] = r(0.6, 1.1); WPH[i * 3 + 1] = r(0.5, 0.9); WPH[i * 3 + 2] = r(0, TAU);
      BLINK[i] = r(0, 5);
      // титул: «корона» над и позади Ризи — дроны по бокам и выше, середина пустая (не ореол вокруг головы)
      const k = (i + 0.5) / N;
      TITLE[i * 3] = side * r(1.9, 3.2) * (0.7 + k);                 // вбок от оси камера→Ризи
      TITLE[i * 3 + 1] = r(1.4, 3.4) + (1 - Math.abs(k - 0.5) * 2) * 0.6;
      TITLE[i * 3 + 2] = r(-2.5, 2.5);                                 // вдоль оси
      // поимка: точки на сфере (Фибоначчи)
      const y = 1 - (i + 0.5) / N * 2, rr = Math.sqrt(1 - y * y), th = i * 2.39996;
      SPH[i * 3] = Math.cos(th) * rr; SPH[i * 3 + 1] = y; SPH[i * 3 + 2] = Math.sin(th) * rr;
    }
  }

  // ---------- СОСТОЯНИЕ ----------
  const P = new Float32Array(N * 3), V = new Float32Array(N * 3), T = new Float32Array(N * 3);
  const YAW = new Float32Array(N), PITCH = new Float32Array(N), BANK = new Float32Array(N);
  const FLAP = new Float32Array(N), CS = new Float32Array(N * 3);
  const ORDER = new Int32Array(N), DIST = new Float32Array(N), MAT = new Float32Array(N * 16);
  for (let i = 0; i < N; i++) ORDER[i] = i;
  let tReal = 0, tSim = 0, inited = false;
  let presence = 0, presenceV = 0;                 // 0 далеко … 1 близко (подъём: пружина k 40, c 9)
  let retreatOn = false, retreatFrom = 0, retreatT = 0;  // отступление 1.2 с easeInOutSine
  let prevNear = false, farLatch = false, sulkT = -1;     // «разочарование» на swarm:far
  let eyeLevel = 5, heat = 0;                      // базовая яркость глаз; heat = сглаженный danger
  let catching = false, catchT = 0;
  const catchPos = new THREE.Vector3();
  let mode = "play";

  // ---------- ВРЕМЕННЫЕ (без аллокаций в update) ----------
  const camPos = new THREE.Vector3(), camS = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3(), fwd = new THREE.Vector3();
  const vA = new THREE.Vector3(), vB = new THREE.Vector3(), vC = new THREE.Vector3();
  const q = new THREE.Quaternion(), qW = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, "YXZ"), eW = new THREE.Euler();
  const mB = new THREE.Matrix4(), mT = new THREE.Matrix4(), mO = new THREE.Matrix4();
  const sc = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), pv = new THREE.Vector3();
  const eyeLocal = new THREE.Matrix4().compose(
    DIM.eyeDir.clone().multiplyScalar(DIM.R * 0.8), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), DIM.eyeDir), one);
  let tanV = 0.577, tanH = 1.0, portraitK = 0;
  let trkL = -0.55, trkR = 0.55, trkY = -0.66, hX = 0, hY = 0.2;   // трасса в NDC: края и строка у ног, точка схода
  const R_EFF = DIM.R * 1.15;                      // радиус силуэта с ворсом и крыльями

  function camFrame(realDt, snap){
    camera.updateMatrixWorld();
    const me = camera.matrixWorld.elements;
    right.set(me[0], me[1], me[2]).normalize();
    up.set(me[4], me[5], me[6]).normalize();
    fwd.set(-me[8], -me[9], -me[10]).normalize();
    camPos.set(me[12], me[13], me[14]);
    // сглаженная позиция камеры: тряска не «приклеивает» рой к экрану
    if (snap) camS.copy(camPos);
    else { const k = 1 - Math.exp(-12 * realDt); camS.lerp(camPos, k); }
  }

  // проекция точки мира в (x NDC, y NDC, глубина) текущей камеры
  function toNdc(x, y, z, out){
    const rx = x - camPos.x, ry = y - camPos.y, rz = z - camPos.z;
    const vz = Math.max(0.05, rx * fwd.x + ry * fwd.y + rz * fwd.z);
    out.set((rx * right.x + ry * right.y + rz * right.z) / (vz * tanH), (rx * up.x + ry * up.y + rz * up.z) / (vz * tanV), vz);
    return out;
  }

  // ключевой кадр → локальные (right, up, forward) в vB
  function kfLocal(i, k, size){
    const o = (i * 3 + k) * 4, type = KF[o + 3];
    if (type === 1){ vB.set(KF[o], KF[o + 1], KF[o + 2]); return; }
    let z = KF[o + 2], sx = KF[o], sy = KF[o + 1], clampIt = type === 2;
    if (clampIt && portraitK > 0){
      // портрет/квадрат: ранги 0–1 — в нижнюю полосу (NEAR_PORTRAIT), ранги 2+ — в запас за боковой край
      const side = sx < 0 ? -1 : 1, r = RANK[i];
      if (r >= 2){ sx = lerp(sx, side * 1.45, portraitK); clampIt = portraitK < 0.5; }
      else {
        const PS = NEAR_PORTRAIT[r];
        sx = lerp(sx, side * PS[0], portraitK); sy = lerp(sy, PS[1], portraitK); z = lerp(z, PS[2], portraitK);
      }
    }
    if (clampIt){
      const ry = R_EFF * size / (z * tanV), rx = R_EFF * size / (z * tanH);
      // ≥ 65% силуэта в кадре: центр не дальше 0.3 R от края
      sx = clamp(sx, -(1 - 0.3 * rx), 1 - 0.3 * rx);
      sy = clamp(sy, -(1 - 0.3 * ry), 1 - 0.3 * ry);
      // над трассой у линии ног — только ниже линии ног (правило «трасса впереди свободна» сильнее правила 65%)
      if (Math.abs(sx) - rx < Math.max(-trkL, trkR) + 0.03) sy = Math.min(sy, trkY - ry - 0.01);
    }
    vB.set(sx * z * tanH, sy * z * tanV, z);
  }

  // целевая точка дрона i (мир) по присутствию t
  function slotTarget(i, t, out){
    let k0, k1, u;
    if (t < 0.5){ k0 = 0; k1 = 1; u = t / 0.5; } else { k0 = 1; k1 = 2; u = (t - 0.5) / 0.5; }
    kfLocal(i, k0, SIZE[i]); const ax = vB.x, ay = vB.y, az = vB.z;
    kfLocal(i, k1, SIZE[i]);
    const cx = lerp(ax, vB.x, u), cy = lerp(ay, vB.y, u), cz = lerp(az, vB.z, u);
    out.copy(camS).addScaledVector(right, cx).addScaledVector(up, cy).addScaledVector(fwd, cz);
    return out;
  }

  function reset(){
    inited = false; catching = false; presence = 0; presenceV = 0; retreatOn = false;
    sulkT = -1; farLatch = false; prevNear = false; eyeLevel = 5; heat = 0;
  }

  function catchPlayer(p){
    catching = true; catchT = 0;
    catchPos.set(p && p.x || 0, (p && p.y || 0) + 0.95, p && p.z || 0);
    for (let i = 0; i < N * 3; i++) CS[i] = P[i];
  }

  function release(){
    if (!catching) return;
    catching = false; presence = 0; presenceV = 0; retreatOn = false; sulkT = -1; farLatch = false; prevNear = false;
  }

  function revive(p){
    catching = false;
    const px = p ? p.x || 0 : catchPos.x, py = p ? (p.y || 0) + 0.95 : catchPos.y, pz = p ? p.z || 0 : catchPos.z;
    for (let i = 0; i < N; i++){
      const o = i * 3;
      const dx = P[o] - px, dy = P[o + 1] - py, dz = P[o + 2] - pz;
      const d = Math.hypot(dx, dy, dz) || 1;
      V[o] += dx / d * 11; V[o + 1] += dy / d * 11 + 3; V[o + 2] += dz / d * 11;
    }
    presence = 0; presenceV = 0; retreatOn = false; eyeLevel = 2; sulkT = -1;
    farLatch = true;                                // держим «далеко», пока near не погаснет и не загорится заново
  }

  function far(){
    farLatch = true;
    if (sulkT < 0 && presence > 0.05 && !catching) sulkT = 0;
  }

  // ---------- UPDATE ----------
  function update(realDt, simDt, s){
    realDt = clamp(realDt || 0, 0, 0.1);
    simDt = clamp(simDt == null ? realDt : simDt, 0, 0.1);
    s = s || {};
    mode = s.mode || "play";
    const danger = clamp(s.danger || 0, 0, 1);
    const speedI = clamp(s.speedI || 0, 0, 1);
    const plX = s.playerX || 0, plY = s.playerY || 0, plZ = s.playerZ || 0;
    const groundY = s.groundY != null ? s.groundY : (opts.groundY || 0);
    tReal += realDt; tSim += simDt;

    camFrame(realDt, !inited);
    tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5) / (camera.zoom || 1);
    tanH = tanV * camera.aspect;
    portraitK = clamp((1.25 - camera.aspect) / 0.5, 0, 1);
    // проекция трассы (для слотов и охранника): края у ног Ризи и точка схода в 70 м
    toNdc(plX - TRACK_HALF, groundY, plZ, vA); trkL = vA.x; trkY = vA.y;
    toNdc(plX + TRACK_HALF, groundY, plZ, vA); trkR = vA.x;
    toNdc(plX, groundY, plZ - 70, vA); hX = vA.x; hY = vA.y;

    // --- near: дискретное «рой рядом»; фолбэк для старых вызовов — danger > 0 ---
    const inPlay = mode === "play" || mode === "countdown" || mode === "over";
    let near = s.near != null ? !!s.near : danger > 0.001;
    if (!inPlay) near = false;
    if (near && !prevNear) farLatch = false;          // новый удар — новая погоня
    if (!near && prevNear) far();                     // рой отстал: «разочарование», даже если адаптер не позвал far()
    if (!near) farLatch = false;
    prevNear = near;
    heat = damp(heat, near ? danger : 0, danger > heat ? 10 : 1.7, realDt);   // атака tau 0.1 с, спад tau 0.6 с

    // --- присутствие: подъём пружиной, «разочарование» 0.4 с на месте, затем отход 1.2 с easeInOutSine ---
    const target = near && !farLatch ? 1 : 0;
    if (sulkT >= 0){
      sulkT += simDt;
      if (sulkT > 2.2) sulkT = -1;
    }
    const holdForSulk = sulkT >= 0 && sulkT < 0.4;
    if (target === 1){
      sulkT = -1; retreatOn = false;
      const a = 40 * (1 - presence) - 9 * presenceV;
      presenceV += a * simDt; presence += presenceV * simDt;
    } else if (!holdForSulk && presence > 0){
      if (!retreatOn){ retreatOn = true; retreatFrom = presence; retreatT = 0; }
      retreatT = Math.min(1, retreatT + simDt / 1.2);
      presence = retreatFrom * (1 - easeInOutSine(retreatT));
      presenceV = 0;
      if (retreatT >= 1){ presence = 0; retreatOn = false; }
    }
    // глаза: 5 обычно, → 2 за 500 мс при «разочаровании» (по simDt), затем обратно к 5 по realDt
    if (sulkT >= 0 && sulkT <= 0.5) eyeLevel = lerp(eyeLevel, 2, clamp(simDt / Math.max(0.016, 0.5 - sulkT + simDt), 0, 1));
    else if (sulkT < 0) eyeLevel = damp(eyeLevel, 5, 1.6, realDt);
    const dipY = sulkT >= 0 ? -0.3 * (sulkT < 0.4 ? easeInOutSine(sulkT / 0.4) : 1 - easeInOutSine(clamp((sulkT - 0.4) / 1.2, 0, 1))) : 0;

    // --- поимка ---
    let catchU = 0, after = 0;
    if (catching){
      catchT += Math.max(simDt, realDt * 0.25);
      catchU = clamp(catchT / 0.45, 0, 1);
      after = Math.max(0, catchT - 0.45);
    }

    // --- титул: «корона» в titleDist позади Ризи (по оси камера → Ризи) ---
    vC.set(plX - camS.x, 0, plZ - camS.z);
    if (vC.lengthSq() < 1e-4) vC.set(0, 0, -1);
    vC.normalize();
    const tDist = s.titleDist != null ? s.titleDist : 14;
    const tK = clamp(tDist / 14, 0.25, 1.5);
    const tAx = plX + vC.x * tDist, tAy = plY + 1.2 * tK, tAz = plZ + vC.z * tDist;

    const bobAmp = reduced ? 0.1 : 0.25, wanderAmp = reduced ? 0.12 : 0.3;
    const kS = 6, cS = 2 * 0.8 * Math.sqrt(kS);          // пружина к слоту k 6, ζ 0.8

    // первая инициализация: сразу на слоты
    if (!inited){
      for (let i = 0; i < N; i++){
        const o = i * 3;
        if (mode === "title") pv.set(tAx + (TITLE[o] * -vC.z + TITLE[o + 2] * vC.x) * tK, tAy + TITLE[o + 1] * tK, tAz + (TITLE[o] * vC.x + TITLE[o + 2] * vC.z) * tK);
        else slotTarget(i, presence, pv);
        P[o] = pv.x; P[o + 1] = pv.y; P[o + 2] = pv.z; V[o] = V[o + 1] = V[o + 2] = 0;
      }
    }

    const fL = trkL, fR = trkR, fY = trkY;
    const guard = inPlay && !catching;
    const aspect = camera.aspect;

    const dt = simDt;
    for (let i = 0; i < N; i++){
      const o = i * 3, ph = PH[i];
      // --- цель ---
      if (catching){
        const bounce = reduced ? 0 : Math.exp(-6 * after) * Math.sin(after * 16) * 0.14;
        const rad = 0.8 * (1 + bounce);
        const wob = reduced ? 0 : 0.05;
        T[o] = catchPos.x + SPH[o] * rad + Math.sin(tSim * 3 + ph) * wob;
        T[o + 1] = catchPos.y + SPH[o + 1] * rad + Math.cos(tSim * 2.6 + ph) * wob;
        T[o + 2] = catchPos.z + SPH[o + 2] * rad;
      } else if (mode === "title"){
        T[o] = tAx + (TITLE[o] * -vC.z + TITLE[o + 2] * vC.x) * tK;
        T[o + 1] = tAy + TITLE[o + 1] * tK;
        T[o + 2] = tAz + (TITLE[o] * vC.x + TITLE[o + 2] * vC.z) * tK;
      } else {
        const pI = clamp(presence * 1.3 - STAG[i] * 0.3, 0, 1.08);
        slotTarget(i, Math.min(1, pI), pv);
        // лёгкий перелёт пружины присутствия уводит чуть глубже в угол
        if (pI > 1) pv.addScaledVector(up, -(pI - 1) * 0.6);
        const w = wanderAmp * (1 - 0.5 * Math.min(1, pI));
        const wx = Math.sin(tSim * WPH[o] + ph) * w, wy = Math.sin(tSim * WPH[o + 1] * 1.3 + ph * 1.7) * w * 0.5;
        T[o] = pv.x + right.x * wx + up.x * wy;
        T[o + 1] = pv.y + right.y * wx + up.y * wy + dipY;
        T[o + 2] = pv.z + right.z * wx + up.z * wy;
      }
      // покачивание 0.25 м на 1.3 Гц со своей фазой
      T[o + 1] += Math.sin(tSim * TAU * 1.3 + ph) * bobAmp * (catching ? 0.2 : 1);

      if (!inited){ P[o] = T[o]; P[o + 1] = T[o + 1]; P[o + 2] = T[o + 2]; }

      if (catching && catchU < 1){
        // кинематика: ровно 450 мс easeInCubic
        const k = easeInCubic(catchU);
        const nx = lerp(CS[o], T[o], k), ny = lerp(CS[o + 1], T[o + 1], k), nz = lerp(CS[o + 2], T[o + 2], k);
        if (dt > 0){ V[o] = (nx - P[o]) / dt; V[o + 1] = (ny - P[o + 1]) / dt; V[o + 2] = (nz - P[o + 2]) / dt; }
        P[o] = nx; P[o + 1] = ny; P[o + 2] = nz;
        continue;
      }
      if (dt <= 0) continue;
      // --- силы: пружина + разделение + выравнивание ---
      const kk = catching ? 60 : kS, cc = catching ? 2 * Math.sqrt(60) : cS;
      let ax = kk * (T[o] - P[o]) - cc * V[o];
      let ay = kk * (T[o + 1] - P[o + 1]) - cc * V[o + 1];
      let az = kk * (T[o + 2] - P[o + 2]) - cc * V[o + 2];
      let avx = 0, avy = 0, avz = 0, nn = 0;
      const sep = catching ? 0.55 : 1.0;
      for (let j = 0; j < N; j++){
        if (j === i) continue;
        const p = j * 3;
        const dx = P[o] - P[p], dy = P[o + 1] - P[p + 1], dz = P[o + 2] - P[p + 2];
        const d2 = dx * dx + dy * dy + dz * dz;
        const minD = sep * (SIZE[i] + SIZE[j]) * 0.5 * 1.05;
        if (d2 < minD * minD && d2 > 1e-8){
          const d = Math.sqrt(d2), f = (minD - d) / d * 28;
          ax += dx * f; ay += dy * f; az += dz * f;
        }
        if (d2 < 4){ avx += V[p]; avy += V[p + 1]; avz += V[p + 2]; nn++; }
      }
      if (nn){ const ka = 0.8; ax += (avx / nn - V[o]) * ka; ay += (avy / nn - V[o + 1]) * ka; az += (avz / nn - V[o + 2]) * ka; }
      // пузырь камеры: не влетать в объектив
      const cx = P[o] - camPos.x, cy = P[o + 1] - camPos.y, cz = P[o + 2] - camPos.z;
      const cd2 = cx * cx + cy * cy + cz * cz;
      if (cd2 < 2.4 * 2.4){ const cd = Math.sqrt(cd2) || 1, f = (2.4 - cd) / cd * 30; ax += cx * f; ay += cy * f; az += cz * f; }
      V[o] += ax * dt; V[o + 1] += ay * dt; V[o + 2] += az * dt;
      P[o] += V[o] * dt; P[o + 1] += V[o + 1] * dt; P[o + 2] += V[o + 2] * dt;
      if (P[o + 1] < groundY + 0.5){ P[o + 1] = groundY + 0.5; if (V[o + 1] < 0) V[o + 1] = 0; }

      // --- охранник трассы: круг дрона в NDC не заходит в трапецию «трасса впереди» (выше линии ног) ---
      if (guard){
        toNdc(P[o], P[o + 1], P[o + 2], vB);
        const vz = vB.z;
        if (vz > 0.6){
          const rr = DIM.R * SIZE[i] * 1.12, ry = rr / (vz * tanV), rx = rr / (vz * tanH);
          const top = vB.y + ry;
          if (top > fY && vB.y - ry < hY){
            const row = Math.max(fY, vB.y - ry * 0.6);
            const tt = clamp((row - fY) / (hY - fY || 1), 0, 1);
            const Lx = lerp(fL, hX, tt) - 0.02, Rx = lerp(fR, hX, tt) + 0.02;
            if (vB.x + rx > Lx && vB.x - rx < Rx){
              // три выхода: влево, вправо, вниз под линию ног. Цена = сдвиг в пикселях + штраф за уход из кадра
              const exitL = vB.x + rx - Lx, exitR = Rx - (vB.x - rx), exitD = top - fY + 0.02;
              const costL = exitL * aspect + (vB.x - exitL < -(1 - 0.3 * rx) ? 3 : 0);
              const costR = exitR * aspect + (vB.x + exitR > 1 - 0.3 * rx ? 3 : 0);
              const costD = exitD * 1.15 + (vB.y - exitD < -(1 - 0.3 * ry) ? 3 : 0);
              let mx = 0, my = 0;
              if (costD <= costL && costD <= costR) my = -exitD;
              else if (costL < costR) mx = -exitL; else mx = exitR;
              const k = Math.min(1, 14 * dt);
              const wx = mx * vz * tanH * k, wy = my * vz * tanV * k;
              P[o] += right.x * wx + up.x * wy; P[o + 1] += right.y * wx + up.y * wy; P[o + 2] += right.z * wx + up.z * wy;
              // гасим скорость внутрь запретной зоны
              if (mx !== 0){
                const vr = V[o] * right.x + V[o + 1] * right.y + V[o + 2] * right.z;
                if (vr * mx < 0){ V[o] -= right.x * vr; V[o + 1] -= right.y * vr; V[o + 2] -= right.z * vr; }
              } else {
                const vu = V[o] * up.x + V[o + 1] * up.y + V[o + 2] * up.z;
                if (vu > 0){ V[o] -= up.x * vu; V[o + 1] -= up.y * vu; V[o + 2] -= up.z * vu; }
              }
            }
          }
        }
      }
    }
    inited = true;

    // ---------- МАТРИЦЫ И ПАРАМЕТРЫ ЭКЗЕМПЛЯРОВ ----------
    const hot = catching ? 1 : heat;
    for (let i = 0; i < N; i++){
      const o = i * 3, ph = PH[i], size = SIZE[i];
      const px = P[o], py = P[o + 1], pz = P[o + 2];
      // взгляд: смесь «на Ризи» и «в камеру»; при поимке — на Ризи в полёте, потом в камеру («попалась!»)
      let lm = LOOK[i];
      if (mode === "title") lm = 1;
      if (catching) lm = sstep(0.05, 0.35, after);
      const hx = plX, hy = plY + 1.3, hz = plZ;
      const lx = lerp(hx, camPos.x, lm) - px, ly = lerp(hy, camPos.y, lm) - py, lz = lerp(hz, camPos.z, lm) - pz;
      const yawT = Math.atan2(lx, lz), pitchT = Math.atan2(-ly, Math.hypot(lx, lz));
      const kr = 1 - Math.exp(-(catching ? 14 : 7) * simDt);
      if (tSim < 0.02 || simDt === 0 && tSim === 0){ YAW[i] = yawT; PITCH[i] = pitchT; }
      YAW[i] += wrapPi(yawT - YAW[i]) * kr;
      PITCH[i] += (clamp(pitchT, -1.1, 1.1) - PITCH[i]) * kr;
      // крен rotation.z = −vx·0.15 (vx — скорость вдоль «вправо» камеры)
      const vr = V[o] * right.x + V[o + 1] * right.y + V[o + 2] * right.z;
      BANK[i] = damp(BANK[i], clamp(-vr * 0.15, -0.55, 0.55), 10, simDt);
      e.set(PITCH[i], YAW[i] + (reduced ? 0 : Math.sin(tSim * 0.9 + ph) * 0.12), BANK[i]);
      q.setFromEuler(e);
      // дыхание-сплющивание в такт покачиванию; «поп» при поимке
      const br = reduced ? 0 : Math.sin(tSim * TAU * 1.3 + ph + 0.8) * 0.035;
      let pop = 1;
      if (catching){ const a = after; pop = a > 0 ? 0.8 * (1 + (reduced ? 0 : 0.22 * Math.exp(-7 * a) * Math.sin(a * 22))) : lerp(1, 0.8, catchU); }
      sc.set(size * pop * (1 - br * 0.5), size * pop * (1 + br), size * pop * (1 - br * 0.5));
      vA.set(px, py, pz);
      mB.compose(vA, q, sc);
      mBody.setMatrixAt(i, mB);
      if (mFur){ mB.toArray(MAT, i * 16); DIST[i] = (px - camPos.x) ** 2 + (py - camPos.y) ** 2 + (pz - camPos.z) ** 2; }

      // крылья: ~5.5–8 Гц (выше 8 Гц при 60 fps взмах превращается в стробоскоп); левое зеркально
      FLAP[i] += simDt * TAU * Math.min(8, 5.5 + 1.2 * speedI + 0.8 * presence + (catching ? 0.8 : 0)) * (reduced ? 0.7 : 1);
      const fs = Math.sin(FLAP[i] + ph);
      const fl = 0.2 + 0.62 * fs;
      // «смаз» на пиках скорости взмаха: крыло чуть короче и шире
      const blur = reduced ? 0 : 0.12 * (1 - Math.abs(fs));
      for (let sgn = 0; sgn < 2; sgn++){
        const side = sgn ? -1 : 1;
        eW.set(0, 0.45 * side, fl * side);
        qW.setFromEuler(eW);
        vB.set(DIM.wingPivot.x * side, DIM.wingPivot.y, DIM.wingPivot.z);
        sc.set(side * (1 - blur), 1, 1 + blur * 1.5);
        mT.compose(vB, qW, sc);
        mO.multiplyMatrices(mB, mT);
        mWing.setMatrixAt(i * 2 + sgn, mO);
      }

      // глаз
      mO.multiplyMatrices(mB, eyeLocal);
      mEye.setMatrixAt(i, mO);
      const nearI = catching ? 1 : clamp(presence * 1.3 - STAG[i] * 0.3, 0, 1);
      let I = eyeLevel;
      // в погоне пульс 4→7 на 3 Гц (размах растёт с накалом danger)
      const pulse = 5.5 + (reduced ? 0.5 : 1.5) * (0.4 + 0.6 * hot) * Math.sin(tReal * TAU * 3 + ph);
      I = lerp(I, pulse * (eyeLevel / 5), nearI);
      if (catching) I = Math.min(5.5, Math.max(I, 5 + (reduced ? 0 : 0.5 * Math.sin(tReal * TAU * 4 + ph))));
      if (mode === "title") I = 5 + (reduced ? 0.3 : 1.2) * Math.sin(tReal * TAU * 0.8 + ph);
      // мерцание 0.9–1.1 на ~7 Гц (не при reduced motion)
      if (!reduced) I *= 1 + 0.1 * (0.65 * Math.sin(tReal * TAU * 7 + ph * 3) + 0.35 * Math.sin(tReal * TAU * 11.3 + ph));
      // моргание раз в ~3–6 с (по simDt; моргание не вестибулярный триггер — остаётся и при reduced motion)
      const bc = (tSim + BLINK[i]) % (3.2 + (i % 4) * 0.9);
      const blink = bc < 0.14 ? Math.abs(bc / 0.07 - 1) : 1;
      // веко: прищур растёт с накалом, «разочарование» — щель, «попалась» — широко
      let open = lerp(0.76, lerp(0.66, 0.6, hot), nearI);
      if (sulkT >= 0) open = 0.38;
      if (catching) open = lerp(0.6, 0.92, sstep(0, 0.3, after));
      open *= blink;
      // зрачок косит в сторону Ризи
      vB.set(hx - px, 0, hz - pz);
      const lookSide = clamp((vB.x * right.x + vB.z * right.z) * 0.25, -0.5, 0.5);
      mEye.setColorAt(i, C.setRGB(I, open, 0.5 + lookSide));

      // ореол: у глаз, смотрящих в камеру, ярче
      mO.decompose(vA, qW, sc);
      vB.copy(DIM.eyeDir).applyQuaternion(q);
      vC.set(camPos.x - vA.x, camPos.y - vA.y, camPos.z - vA.z).normalize();
      const facing = 0.3 + 0.7 * sstep(-0.2, 0.7, vB.dot(vC));
      const gs = DIM.glow * size * pop * (0.9 + 0.1 * I / 5);
      sc.set(gs, gs, gs);
      mT.compose(vA, q, sc);
      mGlow.setMatrixAt(i, mT);
      mGlow.setColorAt(i, C.setRGB(I * 0.3 * facing * open, 0, 0));

      // пятно на снегу 1: мягкая тень прямо под дроном
      const h = py - groundY;
      const prox = 1 - sstep(0.7, 3.4, h);
      let ds = DIM.decal * size * (0.7 + 0.4 * (1 - prox));
      q.identity();
      vA.set(px, groundY + 0.02, pz); sc.set(ds, 1, ds);
      mT.compose(vA, q, sc);
      mDecal.setMatrixAt(i, mT);
      mDecal.setColorAt(i, C.setRGB(0.32 * prox, 0, 0));
      // пятно 2: «ложный красный свет» — туда, куда смотрит глаз (к Ризи), чтобы пятно попадало в кадр
      vB.set(hx - px, 0, hz - pz);
      const hd = Math.hypot(vB.x, vB.z) || 1, reach = Math.min(hd * 0.6, 2.6);
      const redK = 0.25 * (1 - sstep(1.2, 4.2, h)) * Math.max(nearI, mode === "title" ? 0.4 : 0) * clamp(I / 5, 0, 1.2);
      ds = DIM.decal * size;
      vA.set(px + vB.x / hd * reach, groundY + 0.025, pz + vB.z / hd * reach); sc.set(ds, 1, ds);
      mT.compose(vA, q, sc);
      mDecal.setMatrixAt(N + i, mT);
      mDecal.setColorAt(N + i, C.setRGB(0, redK, 0));
    }

    // мех: полупрозрачные оболочки рисуем от дальнего дрона к ближнему (сортировка вставками, N ≤ 32)
    if (mFur){
      for (let a = 1; a < N; a++){
        const id = ORDER[a], d = DIST[id];
        let b = a - 1;
        while (b >= 0 && DIST[ORDER[b]] < d){ ORDER[b + 1] = ORDER[b]; b--; }
        ORDER[b + 1] = id;
      }
      const fa = mFur.instanceMatrix.array, fc = mFur.instanceColor.array;
      for (let slot = 0; slot < N; slot++){
        const id = ORDER[slot], src = id * 16, idc = (id + 0.5) / 64;
        for (let l = 0; l < L; l++){
          const dst = (slot * L + l) * 16;
          for (let k = 0; k < 16; k++) fa[dst + k] = MAT[src + k];
          fc[(slot * L + l) * 3] = idc;
        }
      }
      mFur.instanceMatrix.needsUpdate = true; mFur.instanceColor.needsUpdate = true;
    }
    mBody.instanceMatrix.needsUpdate = true;
    mWing.instanceMatrix.needsUpdate = true;
    mEye.instanceMatrix.needsUpdate = true; mEye.instanceColor.needsUpdate = true;
    mGlow.instanceMatrix.needsUpdate = true; mGlow.instanceColor.needsUpdate = true;
    mDecal.instanceMatrix.needsUpdate = true; mDecal.instanceColor.needsUpdate = true;
    // rim #5A6BFF ×0.5 (+0.15 в погоне)
    M.U.uRimK.value = 0.5 + 0.15 * Math.max(presence > 1 ? 1 : presence, 0) * (0.5 + 0.5 * hot);
  }

  function setReducedMotion(v){ reduced = !!v; }
  function stats(){
    let calls = 0;
    root.traverse(o => { if (o.isInstancedMesh && o.visible) calls++; });
    return { quality, count: N, layers: L, drawCalls: calls, presence: +presence.toFixed(3), catching,
      eyeLevel: +eyeLevel.toFixed(2), sulk: sulkT >= 0, near: prevNear, farLatch, heat: +heat.toFixed(3) };
  }
  function dispose(){
    if (root.parent) root.parent.remove(root);
    for (const g of [gBody, gFur, gWing, gEye, gQuad, gDecal]) if (g) g.dispose();
    for (const m of [mBody, mFur, mWing, mEye, mGlow, mDecal]) if (m) m.dispose();
    M.dispose();
  }

  return {
    root, update, catch: catchPlayer, release, revive, far, reset, setReducedMotion, stats, dispose,
    get count(){ return N; },
    get quality(){ return quality; },
    get presence(){ return presence; },
    positions: P,
  };
}

export default createSwarm;
