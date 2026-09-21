// Стенд VFX-кита: яркая снежная сцена (look/materials + curve + post, если загрузились), заглушка Ризи,
// эмиттер по ?emit=, симуляция шагом 1/60 до ?t= секунд после эмиссии → один рендер → SHOT_READY.
// ?emit=footL|footR|run|takeoff|land|dive|slide|lane|edgebump|pickup|magnet|nearmiss|hit|milestone|record|none (через запятую)
// ?t=  ?I=0..1  ?rm=1  ?q=  ?post=0  ?look=0  ?curve=0  ?cam=game|close|wide  ?snow=0  ?big=1  ?side=  ?hideui=1  ?live=1
// ?pause=сек — после эмиссии включить setPaused(true) и прокрутить ещё столько же реального времени
//              (кадр обязан совпасть с кадром без ?pause: кит на паузе не движется)
// cam=game — РАБОЧИЙ ракурс игры (CAM-1: fov 60+8·I, 0 / 3.8 / 6.4+0.7·I). Все решения о читаемости
// принимаются только по нему и по портрету 390×844; cam=close оставлен лишь для разбора формы частиц.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { createVFX, EMITTERS } from "../src/fx/vfx.js";

const qp = new URLSearchParams(location.search);
const num = (k, d) => (qp.has(k) && qp.get(k) !== "" ? +qp.get(k) : d);
const Q = ["low", "med", "high"].includes(qp.get("q")) ? qp.get("q") : "med";
const EMITS = (qp.get("emit") || "land").split(",").filter(Boolean);
const I = Math.min(1, Math.max(0, num("I", 0.2)));
const RM = qp.get("rm") === "1";
const CAM = qp.get("cam") || "game";

// сидированный рандом — кадры повторяемы
let seedA = 7;
Math.random = () => { seedA = (seedA * 16807) % 2147483647; return (seedA - 1) / 2147483646; };
const rnd = (a, b) => a + Math.random() * (b - a);

// ---------- РЕНДЕР ----------
const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xdaeeff, 34, 120);
{
  const c = document.createElement("canvas"); c.width = 16; c.height = 256;
  const g = c.getContext("2d"), gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, "#5fb8ff"); gr.addColorStop(0.42, "#a9dcff"); gr.addColorStop(0.72, "#daeeff"); gr.addColorStop(1, "#fff3e0");
  g.fillStyle = gr; g.fillRect(0, 0, 16, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; scene.background = t;
}

const speed = 12 + 18 * I;
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 400);
if (CAM === "close"){ camera.fov = 50; camera.position.set(0, 2.3, 4.2); camera.lookAt(0, 0.9, -2); }
else if (CAM === "wide"){ camera.position.set(0, 4.4, 8.4); camera.lookAt(0, 1.0, -10); }
else {
  // CAM-1 как в игре; в портрете (w < h) fov +10 и y 4.2 — ровно как main
  const portrait = innerWidth < innerHeight;
  camera.fov = 60 + 8 * I + (portrait ? 10 : 0);
  camera.position.set(0, portrait ? 4.2 : 3.8, 6.4 + 0.7 * I);
  camera.lookAt(0, 1.0, -10);
}
camera.updateProjectionMatrix();

const G = { mode: "play", x: 0, py: 0, speed, dist: 0, intensity: I };
const ctx = { THREE, renderer, scene, camera, G, qp, quality: Q, look: {} };

// ---------- look-модули (могут меняться под нами — импорт защищён) ----------
if (qp.get("curve") !== "0"){
  try { const m = await import("../src/look/curve.js"); ctx.look.curve = m.installCurve(ctx); }
  catch (e) { console.warn("[kit-vfx] curve недоступен:", e.message); }
}
let look = null;
if (qp.get("look") !== "0"){
  try { const m = await import("../src/look/materials.js"); look = await m.createLook(ctx); ctx.look.mats = look; }
  catch (e) { console.warn("[kit-vfx] materials недоступен:", e.message); look = null; }
}
const H = (look && look.hints) || { hemi: 1.0, sun: 2.4, fill: 0.45, exposure: 1.1 };
renderer.toneMappingExposure = H.exposure;

scene.add(new THREE.HemisphereLight(0xcfe8ff, 0xfff0dc, H.hemi));
const sun = new THREE.DirectionalLight(0xfff2da, H.sun);
sun.position.set(11, 17, 7); sun.target.position.set(0, 0, -12);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 12, bottom: -30, near: 1, far: 70 });
sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);
const fill = new THREE.DirectionalLight(0xbfd8ff, H.fill); fill.position.set(-9, 7, 4); scene.add(fill);

const std = (c, o) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.85 }, o || {}));
const M = {
  felt: (c) => look ? look.felt(c) : std(c),
  candy: (c, o) => look ? look.candy(c, o) : std(c, { roughness: 0.35 }),
  snow: (o) => look ? look.snow(o) : std(0xffffff, { roughness: 1 }),
  wood: (o) => look ? look.wood(o) : std(0xd9a066),
  glow: (c, i) => look ? look.glow(c, i) : std(c, { emissive: c, emissiveIntensity: i }),
};
function add(geo, mat, x, y, z, parent = scene, cast = true){
  const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); o.castShadow = cast; o.receiveShadow = true;
  parent.add(o); return o;
}

// ---------- СЦЕНА: настил, снежные валы, ёлки, фонари ----------
const groundG = new THREE.PlaneGeometry(160, 260, 8, 130); groundG.rotateX(-Math.PI / 2); groundG.translate(0, -0.04, -110);
add(groundG, M.snow({ repeat: [16, 26] }), 0, 0, 0, scene, false);
const roadG = new THREE.PlaneGeometry(7.8, 260, 1, 130); roadG.rotateX(-Math.PI / 2); roadG.translate(0, 0, -110);
add(roadG, M.wood({ repeat: [2.2, 70] }), 0, 0, 0, scene, false);
// бордюры — синий бренд
const curbG = new RoundedBoxGeometry(0.34, 0.28, 260, 2, 0.08); curbG.translate(0, 0.14, -110);
for (const s of [-1, 1]) add(curbG, M.candy(0x0536D4), s * 4.05, 0, 0, scene, false);
// снежные валы
const moundG = new THREE.SphereGeometry(1, 28, 16);
for (let i = 0; i < 30; i++){
  const s = i % 2 ? 1 : -1, z = 4 - i * 3.6 - rnd(0, 1.5);
  const m = add(moundG, M.snow(), s * rnd(5.4, 8.5), 0, z); m.scale.set(rnd(1.3, 2.4), rnd(0.5, 1.0), rnd(1.3, 2.2));
}
// войлочные ёлки
const coneG = new THREE.ConeGeometry(1, 1.6, 20);
for (let i = 0; i < 14; i++){
  const s = i % 2 ? -1 : 1, x = s * rnd(8.5, 13), z = -1 - i * 6.5 - rnd(0, 3), k = rnd(1, 1.6);
  add(new THREE.CylinderGeometry(0.18 * k, 0.22 * k, 0.8 * k, 10), M.felt(0xb9764a), x, 0.4 * k, z);
  for (let j = 0; j < 3; j++){
    const c = add(coneG, M.felt(i % 3 ? 0x7fd89a : 0x5fc48a), x, (1.2 + j * 0.85) * k, z); c.scale.setScalar(k * (1.35 - j * 0.3));
    const cap = add(coneG, M.snow(), x, (1.55 + j * 0.85) * k, z); cap.scale.set(k * (0.75 - j * 0.2), k * 0.45, k * (0.75 - j * 0.2));
  }
}
// фонари
for (let i = 0; i < 5; i++) for (const s of [-1, 1]){
  add(new THREE.CylinderGeometry(0.07, 0.09, 3, 10), M.felt(0x2A3C9A), s * 5.0, 1.5, -4 - i * 11);
  add(new THREE.SphereGeometry(0.26, 20, 14), M.glow(0xffc75e, 3), s * 5.0, 3.1, -4 - i * 11, scene, false);
}
// препятствия дальше по полосам
const boxG = new RoundedBoxGeometry(1.8, 0.9, 1.0, 4, 0.2);
[[2.55, -12, 0xff3b5c], [-2.55, -20, 0x0536D4], [0, -30, 0xff6fb0]].forEach(([x, z, c]) => add(boxG, M.candy(c), x, 0.45, z));
// энергоны впереди (кристаллы)
const crystalG = new THREE.OctahedronGeometry(0.28, 0);
const crystalM = M.glow(0xC0FF3F, 1.6);
for (let i = 0; i < 6; i++){ const c = add(crystalG, crystalM, 2.55, 1.0, -5 - i * 1.7); c.scale.set(0.8, 1.2, 0.8); c.rotation.y = i * 0.5; }

// ---------- ЗАГЛУШКА РИЗИ (спиной к камере) ----------
const rizy = new THREE.Group(); scene.add(rizy);
const skin = M.felt(0x5cc0ec), hair = M.felt(0xC0FF3F), sweater = M.felt(0x1a1d2e), jeans = M.felt(0x2f6ff0);
const pose = qp.get("pose") || (EMITS.includes("slide") ? "slide" : (EMITS.includes("land") || EMITS.includes("dive")) ? "squash" : "run");
for (const s of [-1, 1]){
  const leg = add(new THREE.CapsuleGeometry(0.13, 0.42, 6, 14), jeans, s * 0.14, 0.42, s * 0.08, rizy);
  leg.rotation.x = s * 0.35;
  add(new RoundedBoxGeometry(0.22, 0.14, 0.38, 2, 0.06), M.felt(0x111111), s * 0.14, 0.08, s * 0.16 - 0.02, rizy);
  add(new RoundedBoxGeometry(0.23, 0.04, 0.4, 2, 0.02), M.felt(0xffffff), s * 0.14, 0.02, s * 0.16 - 0.02, rizy);
  const arm = add(new THREE.CapsuleGeometry(0.09, 0.4, 6, 12), sweater, s * 0.36, 1.08, -s * 0.1, rizy);
  arm.rotation.x = -s * 0.5; arm.rotation.z = s * 0.2;
  add(new THREE.SphereGeometry(0.085, 14, 10), skin, s * 0.4, 0.84, -s * 0.2, rizy);
}
add(new THREE.CapsuleGeometry(0.28, 0.42, 8, 18), sweater, 0, 1.05, 0, rizy);
add(new THREE.SphereGeometry(0.3, 24, 16), skin, 0, 1.68, 0, rizy);
const bob = add(new THREE.SphereGeometry(0.34, 24, 16), hair, 0, 1.74, 0.03, rizy); bob.scale.set(1, 0.95, 1);
for (const s of [-1, 1]) add(new THREE.SphereGeometry(0.13, 16, 12), hair, s * 0.24, 2.02, 0.02, rizy);
const scarf = add(new THREE.TorusGeometry(0.24, 0.07, 10, 28), hair, 0, 1.4, 0, rizy); scarf.rotation.x = Math.PI / 2;
add(new RoundedBoxGeometry(0.5, 0.56, 0.24, 3, 0.09), M.felt(0x0536D4), 0, 1.08, 0.3, rizy);
if (pose === "slide"){ rizy.rotation.x = -0.95; rizy.position.set(0, 0.28, 0.2); }
if (pose === "squash"){ rizy.scale.set(1.12, 0.84, 1.12); }

// сцена-подсказка для near-miss: валик в соседней полосе рядом с Ризи
const SIDE = num("side", -1);
if (EMITS.includes("nearmiss")){
  const roll = add(new THREE.CylinderGeometry(0.42, 0.42, 1.9, 24), M.candy(0xff3b5c, { stripe: 0xffffff }), SIDE * 1.55, 0.44, 0.8);
  roll.rotation.z = Math.PI / 2;
}
// магнит: энергон на лету к груди
let flyer = null;
if (EMITS.includes("magnet")){ flyer = add(crystalG, crystalM, 1.15, 1.25, -4.6, scene, false); flyer.scale.set(0.8, 1.2, 0.8); }

// ---------- VFX ----------
// конфетти шагает из vfx.update(realDt) (как в игре) — свой rAF киту не нужен ни здесь, ни в плагине
const vfx = createVFX(ctx);
scene.add(vfx.root);
vfx.setIntensity(I);
vfx.setReducedMotion(RM);
if (qp.get("boost") === "1") vfx.setBoost(true);       // потолок линий скорости (VFX-3)
if (qp.get("snow") === "0") vfx.setSnowEnabled(false);
if (ctx.look.curve) ctx.look.curve.patch(scene);

// ---------- ПОСТ ----------
let post = null;
if (qp.get("post") !== "0"){
  try {
    const m = await import("../src/look/post.js");
    post = m.createPost(ctx); ctx.look.post = post;
    if (post.ready) await post.ready;
    post.params.speedBlur = 0;
  } catch (e) { console.warn("[kit-vfx] post недоступен:", e.message); post = null; }
}

// ---------- СЦЕНАРИИ: что эмитить на каждом шаге (lt — время от эмиссии, может быть < 0 для «разгона») ----------
const DEF_T = { footL: 0.12, footR: 0.12, run: 0.05, takeoff: 0.12, land: 0.12, dive: 0.14, slide: 0.05, lane: 0.1,
  edgebump: 0.12, pickup: 0.1, magnet: 0.17, nearmiss: 0.12, hit: 0.08, milestone: 0.6, record: 0.75, none: 0 };
const T = num("t", Math.max(...EMITS.map(e => DEF_T[e] ?? 0.12)));
const PRE = EMITS.some(e => e === "run" || e === "slide") ? 0.7 : 0;
const opts = { big: qp.get("big") === "1", side: SIDE, dir: num("dir", 1), impact: num("impact", 1) };
const chest = { x: 0, y: 1.15, z: -0.1 };
// как авто-цель кита: грудь (0, 1.25, 0), сдвинутая на 0.5 м по лучу к камере (toCam)
const magnetTarget = { x: 0, y: 1.30, z: 0.47 };
const COIN0 = new THREE.Vector3(1.15, 1.25, -4.6);   // откуда летит энергон: реальная дистанция притяжения (~5 м)
const step = 1 / 60;
let emitted = 0, runPhase = 0;

function scenario(name, lt, prevLt){
  const crossed = prevLt < 0 && lt >= 0;
  switch (name){
    case "run": {
      // бег: шаг каждые 0.17 с, ноги попеременно
      const ph = Math.floor((lt + PRE) / 0.17);
      if (ph !== runPhase && lt + PRE > 0){ runPhase = ph; emitted += vfx.emit(ph % 2 ? "footL" : "footR", { x: ph % 2 ? -0.14 : 0.14, y: 0, z: 0.05 }); }
      return;
    }
    case "slide":
      if (lt + PRE >= 0) emitted += vfx.emit("slide", { x: 0, y: 0, z: 0.25 }, { dt: step });
      return;
    case "footL": if (crossed) emitted += vfx.emit("footL", { x: -0.14, y: 0, z: 0.05 }); return;
    case "footR": if (crossed) emitted += vfx.emit("footR", { x: 0.14, y: 0, z: 0.05 }); return;
    case "pickup": if (crossed) emitted += vfx.emit("pickup", chest, opts); return;
    case "magnet": if (crossed) emitted += vfx.emit("magnet", COIN0, { target: magnetTarget, side: 1 }); return;
    case "hit": if (crossed) emitted += vfx.emit("hit", { x: 0, y: 1.0, z: -0.35 }, opts); return;
    case "nearmiss": if (crossed) emitted += vfx.emit("nearmiss", { x: 0, y: 0, z: 0 }, opts); return;
    case "milestone": case "record": if (crossed) emitted += vfx.emit(name, { x: 0, y: 0, z: 0 }, opts); return;
    case "none": return;
    default: if (crossed) emitted += vfx.emit(name, { x: 0, y: 0, z: 0 }, opts);
  }
}

// разгон снега (аналитический — просто сдвигаем время), потом шаги
vfx.update(8);
let lt = -PRE - step;
const total = PRE + T;
for (let s = 0, n = Math.round((total + step) / step); s < n; s++){
  const prev = lt; lt = prev + step;
  for (const e of EMITS) scenario(e, lt, prev);
  G.dist += speed * step;
  vfx.update(step);
}
// ?pause=сек: включаем паузу и крутим ещё столько же реального времени. Кадр обязан совпасть с кадром
// без ?pause — это и есть доказательство, что setPaused замораживает частицы, снег и тоннель.
const PAUSE = num("pause", 0);
if (PAUSE > 0){
  vfx.setPaused(true);
  for (let s = 0, n = Math.round(PAUSE / step); s < n; s++) vfx.update(step);
}
// энергон летит к груди по той же easeInQuad, что и шлейф в шейдере (k², жизнь шлейфа ≈ 0.42 с)
if (flyer){
  const k = Math.min(1, T / 0.42);
  flyer.position.lerpVectors(COIN0, new THREE.Vector3(chest.x, chest.y, chest.z), k * k);
}

function render(dt){ if (post) post.render(dt); else renderer.render(scene, camera); }

// ---------- ТЕСТЫ ----------
const TEST = {
  vfx, renderer, scene, camera,
  // вызовы отрисовки сцены с VFX и без (без поста — чистая разница)
  calls(){
    const auto = renderer.info.autoReset; renderer.info.autoReset = true;
    renderer.render(scene, camera); const withFx = renderer.info.render.calls;
    vfx.root.visible = false; renderer.render(scene, camera); const noFx = renderer.info.render.calls;
    vfx.root.visible = true; renderer.info.autoReset = auto;
    render(0);
    return JSON.stringify({ withFx, noFx, vfxCalls: withFx - noFx, stats: vfx.stats() });
  },
  // VFX-3: сколько пикселей реально меняет тоннель. Снимаем кадр с мешем линий и без него (пост выключаем —
  // меряем сам эффект, а не bloom) и считаем долю изменённых пикселей и среднюю разницу. speed/boost задаются
  // снаружи: TEST.coverage(true) — с boost (потолок), TEST.coverage(false) — обычный максимум скорости.
  coverage(withBoost){
    const lines = vfx.parts.lines;
    G.speed = 30; vfx.setIntensity(1); vfx.setBoost(!!withBoost);
    vfx.setSnowEnabled(false);
    for (let i = 0; i < 90; i++) vfx.update(1 / 60);
    const gl = renderer.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    const A = new Uint8Array(w * h * 4), B = new Uint8Array(w * h * 4);
    lines.mesh.visible = true;
    renderer.render(scene, camera); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, A);
    lines.mesh.visible = false;
    renderer.render(scene, camera); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, B);
    let changed = 0, sum = 0, mx = 0;
    for (let i = 0; i < w * h; i++){
      const d = Math.abs(A[i * 4] - B[i * 4]) + Math.abs(A[i * 4 + 1] - B[i * 4 + 1]) + Math.abs(A[i * 4 + 2] - B[i * 4 + 2]);
      sum += d; if (d > mx) mx = d;
      if (d > 6) changed++;
    }
    vfx.setSnowEnabled(qp.get("snow") !== "0");
    return JSON.stringify({ lineK: vfx.stats().lines, boost: !!withBoost, w, h,
      meanDiff: +(sum / (w * h)).toFixed(2), maxDiff: mx, pctPixelsChanged: +(changed / (w * h) * 100).toFixed(2) });
  },
  // VFX-пауза: после setPaused(true) кадр НЕ должен меняться сколько бы ни крутили update(realDt).
  // Первый кадр снимаем уже на паузе (сам переход гасит линии скорости — это и есть задумка), дальше
  // прокручиваем sec секунд реального времени и сравниваем пиксель в пиксель. pixelsDiffer обязан быть 0.
  // Отдельно проверяем, что вне паузы кадр как раз МЕНЯЕТСЯ (иначе тест ничего не доказывает).
  pause(sec){
    const gl = renderer.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    const A = new Uint8Array(w * h * 4), B = new Uint8Array(w * h * 4);
    const n = Math.round((sec || 1) / step);
    vfx.setPaused(true);
    vfx.update(step);
    renderer.render(scene, camera); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, A);
    const s0 = vfx.stats(), t0 = vfx.time;
    for (let i = 0; i < n; i++) vfx.update(step);
    renderer.render(scene, camera); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, B);
    const s1 = vfx.stats(), t1 = vfx.time;
    let diff = 0;
    for (let i = 0; i < w * h * 4; i++) if (A[i] !== B[i]) diff++;
    // контроль: снять паузу и прокрутить столько же — кадр обязан отличаться
    vfx.setPaused(false);
    for (let i = 0; i < n; i++){ G.dist += speed * step; vfx.update(step); }
    renderer.render(scene, camera); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, B);
    let diffRun = 0;
    for (let i = 0; i < w * h * 4; i++) if (A[i] !== B[i]) diffRun++;
    return JSON.stringify({ pixelsDifferWhilePaused: diff, pixelsDifferWhenRunning: diffRun,
      vfxTimeHeld: +(t1 - t0).toFixed(5), liveBefore: s0.live, liveAfter: s1.live,
      linesWhilePaused: s1.lines, confettiBefore: s0.confetti, confettiAfter: s1.confetti, paused: s0.paused });
  },
  // проверка «без аллокаций»: 600 кадров эмиссии/апдейта, дельта кучи (Chrome)
  alloc(){
    const h0 = performance.memory ? performance.memory.usedJSHeapSize : 0;
    const p = { x: 0, y: 0, z: 0 }, O = vfx.opts();     // тот же переиспользуемый объект, что и в адаптере
    for (let i = 0; i < 600; i++){
      O.reset(); O.dt = 1 / 60; vfx.emit("slide", p, O);
      if (i % 10 === 0){ O.reset(); vfx.emit("footL", p, O); }
      if (i % 60 === 0){ O.reset(); O.big = i % 120 === 0; vfx.emit("pickup", p, O); }
      vfx.update(1 / 60);
    }
    const h1 = performance.memory ? performance.memory.usedJSHeapSize : 0;
    return JSON.stringify({ heapDeltaKB: Math.round((h1 - h0) / 1024) });
  },
};
window.TEST = TEST;

// DOM-конфетти (VFX-4): ?confetti=mission|record&ct=сек — шаги вручную, кадр детерминирован
if (qp.get("confetti")){
  vfx.celebrate(qp.get("confetti"));
  const cf = vfx.confetti;
  if (cf){ const ct = num("ct", 0.6); for (let tt = 0; tt < ct; tt += step) cf.step(step); }
}
render(step);
const info = document.getElementById("info");
info.textContent = `vfx: ${EMITS.join("+")}  t=${T}s  I=${I} (speed ${speed.toFixed(0)})  q=${Q}${RM ? "  reduced" : ""}  emitted=${emitted}  post=${post ? "on" : "off"}`;
if (qp.get("hideui") === "1") info.hidden = true;
if (!EMITTERS.length) console.error("EMITTERS пуст");

if (qp.has("live")){
  let last = performance.now(), acc = 0;
  const loop = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000); last = now; acc += dt;
    if (acc > 1.2){ acc = 0; for (const e of EMITS) scenario(e, 0, -1); }
    for (const e of EMITS) if (e === "slide" || e === "run") scenario(e, acc, acc - dt);
    G.dist += speed * dt; vfx.update(dt); render(dt); requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
} else {
  document.title = "SHOT_READY";
}
