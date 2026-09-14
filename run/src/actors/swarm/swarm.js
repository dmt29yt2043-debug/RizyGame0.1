// Ризи RUN v3 — кит роя Гасителей (SWARM-1, SWARM-2).
// Ворсистые войлочные помпоны-дроны с одним раскалённым красным глазом и крылышками.
// Рой = стая (пружина к слоту + разделение + выравнивание скоростей + блуждание) вокруг якоря, привязанного к кадру:
//   danger 0  → якорь над/за камерой, 2–3 дрона видны высоко в верхних углах;
//   danger 1  → рой сползает в нижние углы и нижние ~20% кадра за спиной Ризи, не заходя на трассу впереди;
//   catch()   → сходятся на сферу r 0.8 вокруг Ризи за 450 мс (easeInCubic) — кадр слоу-мо проигрыша.
//
// ВЫЗОВЫ (≤ 6 draw calls на любом N): тело · оболочки меха (med/high) · крылья · глаз · ореол · пятно на снегу.
// Дополнительных вызовов в тенях нет (castShadow off — вместо тени мягкое пятно-декаль).
//
// API
//   const swarm = createSwarm(ctx, opts?)
//     ctx:  { camera, quality: "low"|"med"|"high", look?: { mats? }, reducedMotion? }
//     opts: { count?, trackHalfWidth? = 3.9, groundY? = 0, reducedMotion? }
//   scene.add(swarm.root)
//   swarm.update(realDt, simDt, s)   s = { mode, danger 0..1, playerX, playerY, playerZ? = 0, speedI 0..1 }
//   swarm.catch({x, y, z})           поимка (игровой проигрыш); идёт по simDt, но не медленнее 0.25×realDt
//   swarm.revive({x, y, z})          ударная волна: отбросить рой, вернуть в «далеко»
//   swarm.far() / swarm.reset()      «разочарованный» отход сейчас / мгновенно в исходное
//   swarm.setReducedMotion(bool), swarm.setQuality(q), swarm.stats(), swarm.dispose()
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

const COUNT = { low: 8, med: 14, high: 16 };
const LAYERS = { low: 0, med: 5, high: 7 };

export function createSwarm(ctx, opts = {}){
  const camera = ctx.camera;
  let quality = ctx.quality === "low" || ctx.quality === "high" ? ctx.quality : "med";
  const N = Math.max(1, Math.min(32, opts.count || COUNT[quality]));
  const L = LAYERS[quality];
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
  const gEye = new THREE.SphereGeometry(DIM.eyeR, 24, 16);
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
  const mFur = L ? inst(gFur, M.fur, N * L, "fur") : null;
  const mWing = inst(gWing, M.wing, N * 2, "wings");
  const mEye = inst(gEye, M.eye, N, "eye");
  const mGlow = inst(gQuad, M.glow, N, "glow", 3);
  const mDecal = inst(gDecal, M.decal, N, "decal", 2);
  // instanceColor создаём сразу (до первой компиляции шейдера и без аллокаций в цикле)
  const C = new THREE.Color();
  for (let i = 0; i < N; i++){ mEye.setColorAt(i, C.setRGB(5, 0.6, 0.5)); mGlow.setColorAt(i, C.setRGB(1, 0, 0)); mDecal.setColorAt(i, C.setRGB(0, 0, 0)); }
  for (const m of [mEye, mGlow, mDecal]) m.instanceColor.setUsage(THREE.DynamicDrawUsage);

  // ---------- ХОРЕОГРАФИЯ: слоты ----------
  // Ключевые кадры на дрона: 0 = далеко, 1 = середина, 2 = близко. Тип 0: (sx, sy) в NDC + глубина вида;
  // тип 1: локальное смещение от камеры (right, up, forward) — для «за камерой».
  const KF = new Float32Array(N * 3 * 4);
  const SIZE = new Float32Array(N), PH = new Float32Array(N), STAG = new Float32Array(N), LOOK = new Float32Array(N);
  const WPH = new Float32Array(N * 3), TITLE = new Float32Array(N * 3), BLINK = new Float32Array(N), SPH = new Float32Array(N * 3);
  {
    const r = rng(9173);
    const nFarVis = N >= 10 ? 3 : 2;
    const nPeek = N >= 10 ? 2 : 1, nFlank = N >= 12 ? 2 : 0, nReserve = N >= 14 ? 2 : 0;
    const nCorner = Math.max(0, N - nPeek - nFlank - nReserve);
    const kf = (i, k, a, b, c, type) => { const o = (i * 3 + k) * 4; KF[o] = a; KF[o + 1] = b; KF[o + 2] = c; KF[o + 3] = type; };
    for (let i = 0; i < N; i++){
      const side = i % 2 ? -1 : 1;
      // далеко
      if (i < nFarVis) kf(i, 0, side * r(0.7, 0.9), r(0.62, 0.86), r(7, 9.5), 0);
      else kf(i, 0, side * r(1.2, 4.2), r(2.4, 4.4), -r(0.8, 3.6), 1);
      // близко
      let role;
      if (i < nCorner) role = "corner";
      else if (i < nCorner + nPeek) role = "peek";
      else if (i < nCorner + nPeek + nFlank) role = "flank";
      else role = "reserve";
      if (role === "corner") kf(i, 2, side * r(0.7, 1.02), r(-0.6, -0.95), r(4.0, 5.6), 0);
      else if (role === "peek") kf(i, 2, side * r(0.3, 0.44), r(-0.92, -1.02), r(4.4, 5.2), 0);
      else if (role === "flank") kf(i, 2, side * r(1.02, 1.1), r(-0.3, -0.05), r(5.2, 6.4), 0);
      else kf(i, 2, side * r(1.25, 1.45), r(-0.6, -1.05), r(3.2, 4.4), 0);
      // середина: по краям кадра (путь не пересекает трассу)
      kf(i, 1, side * (role === "reserve" ? 1.35 : r(0.92, 1.1)), r(-0.2, 0.45), r(4.6, 7), 0);
      SIZE[i] = r(0.86, 1.08);
      PH[i] = r(0, TAU);
      STAG[i] = r(0, 1);
      LOOK[i] = r(0.3, 0.6);
      WPH[i * 3] = r(0.6, 1.1); WPH[i * 3 + 1] = r(0.5, 0.9); WPH[i * 3 + 2] = r(0, TAU);
      BLINK[i] = r(0, 5);
      // титул: облако позади Ризи
      const a = (i / N) * TAU + r(-0.3, 0.3);
      // широкая «дуга» над горизонтом: не ореол вокруг головы Ризи (масштабируется с titleDist в update)
      TITLE[i * 3] = Math.cos(a) * r(3.2, 7.5); TITLE[i * 3 + 1] = Math.sin(a) * r(1.0, 2.4) + r(0.6, 1.6); TITLE[i * 3 + 2] = r(-3, 3);
      // поимка: точки на сфере (Фибоначчи)
      const y = 1 - (i + 0.5) / N * 2, rr = Math.sqrt(1 - y * y), th = i * 2.39996;
      SPH[i * 3] = Math.cos(th) * rr; SPH[i * 3 + 1] = y; SPH[i * 3 + 2] = Math.sin(th) * rr;
    }
  }

  // ---------- СОСТОЯНИЕ ----------
  const P = new Float32Array(N * 3), V = new Float32Array(N * 3), T = new Float32Array(N * 3);
  const YAW = new Float32Array(N), PITCH = new Float32Array(N), BANK = new Float32Array(N);
  const FLAP = new Float32Array(N), POP = new Float32Array(N), CS = new Float32Array(N * 3);
  let tReal = 0, tSim = 0, inited = false;
  let presence = 0, presenceV = 0;                 // 0 далеко … 1 близко (пружина k 40, c 9)
  let retreat = null;                              // { from, to, t } — отступление 1.2 с easeInOutSine
  const retreatObj = { from: 0, to: 0, t: 0 };
  let peakDanger = 0, sulkT = -1;                  // «разочарование» на swarm:far
  let eyeLevel = 5;                                // базовая яркость глаз
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

  // целевая точка дрона i (мир) по присутствию t
  function slotTarget(i, t, tanV, tanH, out){
    let k0, k1, u;
    if (t < 0.5){ k0 = 0; k1 = 1; u = t / 0.5; } else { k0 = 1; k1 = 2; u = (t - 0.5) / 0.5; }
    let ax, ay, az, bx, by, bz;
    let o = (i * 3 + k0) * 4;
    if (KF[o + 3] === 0){ az = KF[o + 2]; ax = KF[o] * az * tanH; ay = KF[o + 1] * az * tanV; }
    else { ax = KF[o]; ay = KF[o + 1]; az = KF[o + 2]; }
    o = (i * 3 + k1) * 4;
    if (KF[o + 3] === 0){ bz = KF[o + 2]; bx = KF[o] * bz * tanH; by = KF[o + 1] * bz * tanV; }
    else { bx = KF[o]; by = KF[o + 1]; bz = KF[o + 2]; }
    const cx = lerp(ax, bx, u), cy = lerp(ay, by, u), cz = lerp(az, bz, u);
    out.copy(camS).addScaledVector(right, cx).addScaledVector(up, cy).addScaledVector(fwd, cz);
    return out;
  }

  function reset(){
    inited = false; catching = false; presence = 0; presenceV = 0; retreat = null; sulkT = -1; peakDanger = 0; eyeLevel = 5;
  }

  function catchPlayer(p){
    catching = true; catchT = 0;
    catchPos.set(p.x || 0, (p.y || 0) + 0.95, p.z || 0);
    for (let i = 0; i < N * 3; i++) CS[i] = P[i];
    POP.fill(0);
  }

  function revive(p){
    catching = false;
    const px = p ? p.x || 0 : catchPos.x, py = p ? (p.y || 0) + 0.95 : catchPos.y, pz = p ? p.z || 0 : catchPos.z;
    for (let i = 0; i < N; i++){
      const o = i * 3;
      let dx = P[o] - px, dy = P[o + 1] - py, dz = P[o + 2] - pz;
      const d = Math.hypot(dx, dy, dz) || 1;
      V[o] += dx / d * 11; V[o + 1] += dy / d * 11 + 3; V[o + 2] += dz / d * 11;
    }
    presence = 0; presenceV = 0; retreat = null; eyeLevel = 2; sulkT = -1; peakDanger = 0;
  }

  function far(){ if (sulkT < 0 && presence > 0.05) sulkT = 0; }

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
    const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5) / (camera.zoom || 1);
    const tanH = tanV * camera.aspect;

    // --- присутствие: подъём пружиной, отход — 1.2 с easeInOutSine, «разочарование» перед отходом ---
    const inPlay = mode === "play" || mode === "countdown" || mode === "over";
    const target = inPlay ? 1 - (1 - danger) * (1 - danger) : 0;
    if (danger > peakDanger) peakDanger = danger;
    if (peakDanger > 0.15 && danger < 0.002 && sulkT < 0 && presence > 0.05){ sulkT = 0; }
    if (sulkT >= 0){
      sulkT += simDt;
      if (sulkT > 1.9){ sulkT = -1; peakDanger = 0; }
    }
    const holdForSulk = sulkT >= 0 && sulkT < 0.4;
    if (target > presence + 0.001 && sulkT < 0){
      retreat = null;
      const a = 40 * (target - presence) - 9 * presenceV;
      presenceV += a * simDt; presence += presenceV * simDt;
    } else if (!holdForSulk && target < presence - 0.01){
      if (!retreat){ retreat = retreatObj; retreat.from = presence; retreat.t = 0; }
      retreat.to = target;
      retreat.t = Math.min(1, retreat.t + simDt / 1.2);
      presence = lerp(retreat.from, retreat.to, easeInOutSine(retreat.t));
      presenceV = 0;
      if (retreat.t >= 1) retreat = null;
    } else if (!holdForSulk){
      retreat = null;
      const a = 40 * (target - presence) - 9 * presenceV;
      presenceV += a * simDt; presence += presenceV * simDt;
    }
    // глаза: 5 обычно, → 2 за 500 мс при «разочаровании», затем обратно
    const eyeTarget = sulkT >= 0 ? 2 : 5;
    eyeLevel = sulkT >= 0 && sulkT < 0.5 ? lerp(eyeLevel, 2, clamp(simDt / Math.max(0.016, 0.5 - sulkT), 0, 1)) : damp(eyeLevel, eyeTarget, 1.6, realDt);
    const dipY = sulkT >= 0 ? -0.3 * (sulkT < 0.4 ? easeInOutSine(sulkT / 0.4) : 1 - easeInOutSine(clamp((sulkT - 0.4) / 1.0, 0, 1))) : 0;

    // --- поимка ---
    let catchU = 0, after = 0;
    if (catching){
      catchT += Math.max(simDt, realDt * 0.25);
      catchU = clamp(catchT / 0.45, 0, 1);
      after = Math.max(0, catchT - 0.45);
    }

    // --- титул: облако в 14 м позади Ризи (от камеры) ---
    vC.set(plX - camS.x, 0, plZ - camS.z);
    if (vC.lengthSq() < 1e-4) vC.set(0, 0, -1);
    vC.normalize();                                     // dir камера → Ризи
    const tDist = s.titleDist != null ? s.titleDist : 14;
    const tAx = plX + vC.x * tDist, tAy = plY + 2.6, tAz = plZ + vC.z * tDist;
    const tK = clamp(tDist / 14, 0.25, 1.5);             // облако ужимается, если якорь ближе (крупный план)

    const bobAmp = reduced ? 0.1 : 0.25, wanderAmp = reduced ? 0.12 : 0.32;
    const kS = 6, cS = 2 * 0.8 * Math.sqrt(kS);          // пружина к слоту k 6, ζ 0.8

    // первая инициализация: сразу на слоты
    if (!inited){
      for (let i = 0; i < N; i++){
        if (mode === "title"){ const o = i * 3; pv.set(tAx + (TITLE[o] * vC.z + TITLE[o + 2] * vC.x) * tK, tAy + TITLE[o + 1] * tK, tAz + (-TITLE[o] * vC.x + TITLE[o + 2] * vC.z) * tK); }
        else slotTarget(i, clamp(presence, 0, 1), tanV, tanH, pv);
        P[i * 3] = pv.x; P[i * 3 + 1] = pv.y; P[i * 3 + 2] = pv.z; V[i * 3] = V[i * 3 + 1] = V[i * 3 + 2] = 0;
      }
      inited = true;
    }

    // проекция трассы для охранника «не закрывать трассу»: линия ног и точка схода
    const toNdc = (x, y, z, out) => {
      const rx = x - camPos.x, ry = y - camPos.y, rz = z - camPos.z;
      const vz = Math.max(0.05, rx * fwd.x + ry * fwd.y + rz * fwd.z);
      out.set((rx * right.x + ry * right.y + rz * right.z) / (vz * tanH), (rx * up.x + ry * up.y + rz * up.z) / (vz * tanV), vz);
      return out;
    };
    toNdc(plX - TRACK_HALF, groundY, plZ, vA); const fL = vA.x, fY = vA.y;
    toNdc(plX + TRACK_HALF, groundY, plZ, vA); const fR = vA.x;
    toNdc(plX, groundY, plZ - 70, vA); const hX = vA.x, hY = vA.y;
    const guard = inPlay && !catching;

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
        T[o] = tAx + (TITLE[o] * vC.z + TITLE[o + 2] * vC.x) * tK;
        T[o + 1] = tAy + TITLE[o + 1] * tK;
        T[o + 2] = tAz + (-TITLE[o] * vC.x + TITLE[o + 2] * vC.z) * tK;
      } else {
        const pI = clamp(presence * 1.3 - STAG[i] * 0.3, 0, 1.08);
        slotTarget(i, Math.min(1, pI), tanV, tanH, pv);
        // лёгкий перелёт пружины присутствия уводит чуть глубже в угол
        if (pI > 1) pv.addScaledVector(up, -(pI - 1) * 0.6);
        const w = wanderAmp * (1 - 0.45 * pI);
        const wx = Math.sin(tSim * WPH[o] + ph) * w, wy = Math.sin(tSim * WPH[o + 1] * 1.3 + ph * 1.7) * w * 0.5;
        T[o] = pv.x + right.x * wx + up.x * wy;
        T[o + 1] = pv.y + right.y * wx + up.y * wy + dipY;
        T[o + 2] = pv.z + right.z * wx + up.z * wy;
      }
      // покачивание 0.25 м на 1.3 Гц со своей фазой
      const bob = Math.sin(tSim * TAU * 1.3 + ph) * bobAmp * (catching ? 0.2 : 1);
      T[o + 1] += bob;

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
              const exitL = vB.x + rx - Lx, exitR = Rx - (vB.x - rx), exitD = top - fY + 0.02;
              let mx = 0, my = 0;
              if (vB.y < fY && exitD < Math.min(exitL, exitR) * 1.5) my = -exitD;
              else if (exitL < exitR) mx = -exitL; else mx = exitR;
              const k = Math.min(1, 14 * dt);
              const wx = mx * vz * tanH * k, wy = my * vz * tanV * k;
              P[o] += right.x * wx + up.x * wy; P[o + 1] += right.y * wx + up.y * wy; P[o + 2] += right.z * wx + up.z * wy;
              // гасим скорость внутрь запретной зоны
              const vr = V[o] * right.x + V[o + 1] * right.y + V[o + 2] * right.z;
              if (mx !== 0 && vr * mx < 0){ V[o] -= right.x * vr; V[o + 1] -= right.y * vr; V[o + 2] -= right.z * vr; }
            }
          }
        }
      }
    }

    // ---------- МАТРИЦЫ И ПАРАМЕТРЫ ЭКЗЕМПЛЯРОВ ----------
    const pulseHz = 3, flick = !reduced;
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
      YAW[i] += wrapPi(yawT - YAW[i]) * kr;
      PITCH[i] += (clamp(pitchT, -1.1, 1.1) - PITCH[i]) * kr;
      const vr = V[o] * right.x + V[o + 1] * right.y + V[o + 2] * right.z;
      BANK[i] = damp(BANK[i], clamp(-vr * 0.15, -0.55, 0.55), 10, simDt);
      if (!inited || tSim < 0.02){ YAW[i] = yawT; PITCH[i] = pitchT; }
      e.set(PITCH[i], YAW[i] + (reduced ? 0 : Math.sin(tSim * 0.9 + ph) * 0.12), BANK[i]);
      q.setFromEuler(e);
      // дыхание-сплющивание в такт покачиванию; «поп» при поимке
      const br = reduced ? 0 : Math.sin(tSim * TAU * 1.3 + ph + 0.8) * 0.035;
      let pop = 1;
      if (catching){ const a = after; pop = a > 0 ? 0.8 * (1 + 0.22 * Math.exp(-7 * a) * Math.sin(a * 22)) : lerp(1, 0.8, catchU); }
      sc.set(size * pop * (1 - br * 0.5), size * pop * (1 + br), size * pop * (1 - br * 0.5));
      vA.set(px, py, pz);
      mB.compose(vA, q, sc);
      mBody.setMatrixAt(i, mB);
      if (mFur) for (let l = 0; l < L; l++) mFur.setMatrixAt(i * L + l, mB);

      // крылья: 9 Гц + скорость + погоня; левое зеркально
      FLAP[i] += simDt * TAU * (9 + 5 * speedI + 3 * presence + (catching ? 6 : 0)) * (reduced ? 0.6 : 1);
      const fl = 0.2 + 0.62 * Math.sin(FLAP[i] + ph);
      for (let sgn = 0; sgn < 2; sgn++){
        const side = sgn ? -1 : 1;
        eW.set(0, 0.45 * side, fl * side);
        qW.setFromEuler(eW);
        vB.set(DIM.wingPivot.x * side, DIM.wingPivot.y, DIM.wingPivot.z);
        sc.set(side, 1, 1);
        mT.compose(vB, qW, sc);
        mO.multiplyMatrices(mB, mT);
        mWing.setMatrixAt(i * 2 + sgn, mO);
      }

      // глаз
      mO.multiplyMatrices(mB, eyeLocal);
      mEye.setMatrixAt(i, mO);
      let I = eyeLevel;
      const near = catching ? 1 : clamp(presence * 1.3 - STAG[i] * 0.3, 0, 1);
      // в погоне пульс 4→7 на 3 Гц
      const pulse = 5.5 + (reduced ? 0.6 : 1.5) * Math.sin(tReal * TAU * pulseHz + ph);
      I = lerp(I, pulse * (eyeLevel / 5), near);
      if (catching) I = Math.max(I, 6.5 + (reduced ? 0 : 0.8 * Math.sin(tReal * TAU * 4 + ph)));
      if (mode === "title") I = 5 + (reduced ? 0.4 : 1.4) * Math.sin(tReal * TAU * 0.8 + ph);
      // мерцание 0.9–1.1 на 7 Гц
      if (flick) I *= 1 + 0.1 * (0.65 * Math.sin(tReal * TAU * 7 + ph * 3) + 0.35 * Math.sin(tReal * TAU * 11.3 + ph));
      // моргание раз в ~3–6 с (по simDt), веко: прищур в погоне, «попалась» — широко
      const bc = (tSim + BLINK[i]) % (3.2 + (i % 4) * 0.9);
      const blink = reduced ? 1 : (bc < 0.14 ? Math.abs(bc / 0.07 - 1) : 1);
      let open = lerp(0.74, 0.56, near);
      if (sulkT >= 0) open = 0.4;
      if (catching) open = lerp(0.6, 0.95, sstep(0, 0.3, after));
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

      // пятно на снегу: тень + красный отсвет, сильнее у низко летящих
      const h = py - groundY;
      const prox = 1 - sstep(0.7, 3.2, h);
      const ds = DIM.decal * size * (0.75 + 0.45 * (1 - prox));
      vA.set(px, groundY + 0.02, pz);
      sc.set(ds, 1, ds);
      q.identity();
      mT.compose(vA, q, sc);
      mDecal.setMatrixAt(i, mT);
      mDecal.setColorAt(i, C.setRGB(0.32 * prox, 0.25 * prox * clamp(I / 5, 0, 1.4), 0));
    }
    mBody.instanceMatrix.needsUpdate = true;
    if (mFur) mFur.instanceMatrix.needsUpdate = true;
    mWing.instanceMatrix.needsUpdate = true;
    mEye.instanceMatrix.needsUpdate = true; mEye.instanceColor.needsUpdate = true;
    mGlow.instanceMatrix.needsUpdate = true; mGlow.instanceColor.needsUpdate = true;
    mDecal.instanceMatrix.needsUpdate = true; mDecal.instanceColor.needsUpdate = true;
    M.U.uRimK.value = 0.5 + 0.15 * presence;
  }

  function setReducedMotion(v){ reduced = !!v; }
  function setQuality(q2){
    // меха нет на low: скрываем оболочки (перестраивать геометрию на лету не нужно)
    if (mFur) mFur.visible = q2 !== "low";
    quality = q2;
  }
  function stats(){
    let calls = 0;
    root.traverse(o => { if (o.isInstancedMesh && o.visible) calls++; });
    return { count: N, layers: L, drawCalls: calls, presence: +presence.toFixed(3), catching, eyeLevel: +eyeLevel.toFixed(2), sulk: sulkT >= 0 };
  }
  function dispose(){
    if (root.parent) root.parent.remove(root);
    for (const g of [gBody, gFur, gWing, gEye, gQuad, gDecal]) if (g) g.dispose();
    for (const m of [mBody, mFur, mWing, mEye, mGlow, mDecal]) if (m) m.dispose();
    M.dispose();
  }

  return {
    root, update, catch: catchPlayer, revive, far, reset, setReducedMotion, setQuality, stats, dispose,
    get count(){ return N; },
    get presence(){ return presence; },
    positions: P,
  };
}

export default createSwarm;
