// Стенд world-kit: камера и свет как в игре (солнце по LOOK-3), look/curve/post если загрузились,
// пролёт ?at секунд шагом 1/60 со спавнером препятствий/энергонов как в main, ОДИН рендер → SHOT_READY.
import * as THREE from "three";
import { createWorldKit, PALETTES, PIECE_TYPES } from "../src/world/index.js";

const qp = new URLSearchParams(location.search);
const num = (k, d) => (qp.has(k) ? +qp.get(k) : d);
const Q = qp.get("q") || "med";
const AT = num("at", 6), SEED = num("seed", 7), LANE = num("lane", 1);
const ENTS = qp.get("ents") || "fly";
const CAMMODE = qp.get("cam") || "game";
const LIVE = qp.has("live");
const LANES = [-2.55, 0, 2.55];
const log = [];

let cfg = null;
try { cfg = (await import("../src/config.js")).cfg; } catch (e){ console.warn("dev: config.js не загрузился", e); }
// камера по CAM-1 библии (fov 60, y 3.8, z 6.4, lookAt(·, 1.0, −10)); ?cam=legacy — старый cfg.CAM
const CAM = qp.get("cam") === "legacy" && cfg && cfg.CAM ? Object.assign({ lookY: 1.35 }, cfg.CAM)
  : { fov: 60, y: 3.8, z: 6.4, near: 0.1, far: 400, lookY: 1.0, lookZ: -10 };
const PORTRAIT = innerWidth / innerHeight < 1;
if (PORTRAIT){ CAM.fov += 10; CAM.y = 4.2; }

// ---------- РЕНДЕР ----------
const usePost = qp.get("post") !== "0";
const renderer = new THREE.WebGLRenderer({ antialias: !usePost, preserveDrawingBuffer: true, powerPreference: "high-performance" });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.18;
renderer.shadowMap.enabled = Q !== "low";
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(CAM.fov, innerWidth / innerHeight, CAM.near, CAM.far);

// ---------- СВЕТ (LOOK-2/3: солнце слева-спереди 44°, hemi 0.3 при IBL, заполняющий со стороны камеры) ----------
const hemi = new THREE.HemisphereLight(0xcfe8ff, 0xfff0dc, 0.3);
const sun = new THREE.DirectionalLight(0xFFF1DC, 2.6);
const SUN_DIR = new THREE.Vector3(-0.62, 0.70, -0.25).normalize();
sun.castShadow = true;
sun.shadow.mapSize.set(Q === "high" ? 2048 : 1024, Q === "high" ? 2048 : 1024);
Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 26, bottom: -26, near: 1, far: 70 });
sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.03;
sun.target.position.set(0, 0, -14);
sun.position.copy(sun.target.position).addScaledVector(SUN_DIR, 30);
const fill = new THREE.DirectionalLight(0xBFD8FF, 0.45);
fill.position.set(0, 6, 12);
scene.add(hemi, sun, sun.target, fill);

// ---------- СОСТОЯНИЕ «ИГРЫ» ----------
const G = { mode: "play", dist: 0, speed: 12, x: LANES[LANE], lane: LANE, py: 0, swarmNear: 0, dz: 0 };
const ctx = { THREE, renderer, scene, camera, G, cfg, qp, quality: Q, look: { mats: null, curve: null, post: null },
  lights: { hemi, sun, fill }, entities: { obstacles: [], coins: [] } };

if (qp.get("curve") !== "0"){
  try { const { installCurve } = await import("../src/look/curve.js"); ctx.look.curve = installCurve(ctx); }
  catch (e){ console.warn("dev: curve.js не загрузился", e); }
}
if (qp.get("look") !== "0"){
  try { const { createLook } = await import("../src/look/materials.js"); ctx.look.mats = await createLook(ctx); }
  catch (e){ console.warn("dev: materials.js не загрузился", e); }
}
if (!ctx.look.mats) hemi.intensity = 1.05;

const kit = createWorldKit(ctx, {
  seed: SEED, reducedMotion: qp.has("rm"), autoPalette: !qp.has("palette"),
  onEvent: (name, p) => log.push(`${name}${p && p.type ? ":" + p.type : ""}@${Math.round(G.dist)}`),
});
if (qp.has("palette")) kit.setPalette(num("palette", 0), true);
if (qp.has("best")) kit.setBest(num("best", 0));       // ?best=N — флаг «РЕКОРД» на N м

if (usePost){
  try {
    const { createPost } = await import("../src/look/post.js");
    ctx.look.post = createPost(ctx);
    ctx.look.post.params.auto = false;
    if (ctx.look.post.ready) await ctx.look.post.ready;
  } catch (e){ console.warn("dev: post.js не загрузился", e); ctx.look.post = null; }
}

// ---------- Ризи-заглушка (масштаб) ----------
const rizy = new THREE.Group();
{
  const m = c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.62, 6, 14), m(0x151827)); body.position.y = 0.85;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 18, 12), m(0x5cc0ec)); head.position.y = 1.62;
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.31, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), m(0xC0FF3F)); hair.position.y = 1.66;
  const bag = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.55, 0.25), m(0x2f6ff0)); bag.position.set(0, 1.0, 0.36);
  for (const o of [body, head, hair, bag]){ o.castShadow = true; rizy.add(o); }
  rizy.position.x = G.x;
  rizy.visible = qp.get("rizy") !== "0";
  scene.add(rizy);
}
if (ctx.look.curve) ctx.look.curve.patch(scene);

// ---------- КАМЕРА ----------
function placeCamera(){
  if (CAMMODE === "side"){ camera.position.set(15, 7, -4); camera.lookAt(0, 1, -24); }
  else if (CAMMODE === "high"){ camera.position.set(0, 16, 14); camera.lookAt(0, 0, -30); }
  else if (CAMMODE === "close"){ camera.position.set(3.4, 1.9, -4.5); camera.lookAt(-0.5, 1.0, -14); }
  else if (CAMMODE === "far"){ camera.position.set(0, CAM.y, CAM.z); camera.lookAt(0, 4.5, -60); }
  else { camera.position.set(G.x * 0.5, CAM.y, CAM.z); camera.lookAt(G.x * 0.6, CAM.lookY, CAM.lookZ); }
  camera.updateMatrixWorld();
}
placeCamera();

// ---------- СПАВНЕР (как main: препятствия на −118, энергоны на −112) ----------
let rs = (SEED * 9301 + 49297) >>> 0;
const R = () => { rs = (rs * 1664525 + 1013904223) >>> 0; return rs / 4294967296; };
const RN = (a, b) => a + R() * (b - a);
const PICK = a => a[Math.floor(R() * a.length)];
const obstacles = ctx.entities.obstacles, coins = ctx.entities.coins;
let nextO = -46, nextC = -28;
function addObstacle(kind, lanes, z, variant){
  const e = { kind, lanes, z, object3d: null, variant };
  e.object3d = kit.makeObstacle(e); obstacles.push(e); return e;
}
function spawnObstacle(z){
  const r = R();
  if (r < 0.36) addObstacle("jump", [Math.floor(RN(0, 3))], z);
  else if (r < 0.63) addObstacle("slide", PICK([[0], [1], [2], [0, 1], [1, 2], [0, 1, 2]]).slice(), z);
  else {
    const lanes = PICK([[0], [1], [2], [0, 1], [1, 2], [0, 2]]);
    const wallOk = kit.wallFreeAt(z);
    for (const l of lanes) addObstacle(wallOk ? "wall" : "jump", [l], z);
  }
}
function spawnCoins(z, lane, arc){
  const n = arc ? 5 : 7;
  for (let i = 0; i < n; i++){
    const e = { lane, x: LANES[lane], y: arc ? 0.9 + Math.sin(i / (n - 1) * Math.PI) * 1.15 : 0.95, z: z - i * 1.7, object3d: null };
    e.object3d = kit.makeCoin(e); coins.push(e);
  }
}
function stepEntities(dz){
  nextO += dz;
  if (nextO > -40){ spawnObstacle(-118 + RN(-6, 6)); nextO = -40 - RN(17, 31) - Math.max(0, 24 - G.speed); }
  nextC += dz;
  if (nextC > -30){ spawnCoins(-112 + RN(-8, 8), Math.floor(RN(0, 3)), R() < 0.32); nextC = -30 - RN(20, 36); }
  for (const list of [obstacles, coins]) for (let i = list.length - 1; i >= 0; i--){
    const e = list[i]; e.z += dz; e.object3d.position.z = e.z;
    if (e.z > 11){ kit.release(e.object3d); list.splice(i, 1); }
  }
}

// ---------- ПРОЛЁТ ----------
const DT = 1 / 60, N = Math.max(0, Math.round(AT * 60));
const speedAt = t => Math.min(30, 12 + t * 0.45);
let distFinal = 0; for (let i = 0; i < N; i++) distFinal += speedAt(i * DT) * DT;
if (qp.has("piece") && PIECE_TYPES.includes(qp.get("piece"))) kit.forcePiece(qp.get("piece"), distFinal + num("pz", 34));

let t = 0;
function step(dt){
  G.speed = speedAt(t); t += dt;
  G.dz = G.speed * dt; G.dist += G.dz;
  if (ENTS === "fly") stepEntities(G.dz);
  if (ctx.look.curve) ctx.look.curve.update(dt, G);
  kit.update(dt, dt, G);
  kit.applyLights(ctx.lights);
}
for (let i = 0; i < N; i++) step(DT);
if (ENTS === "rows"){
  // витрина: все виды препятствий и энергонов на читаемых дистанциях
  addObstacle("jump", [0], -13); addObstacle("slide", [1], -13); addObstacle("wall", [2], -13, 0);
  addObstacle("wall", [0], -27, 1); addObstacle("wall", [1], -27, 2); addObstacle("slide", [2], -27);
  addObstacle("slide", [0, 1, 2], -41);
  addObstacle("jump", [1], -55); addObstacle("wall", [0], -55, 2); addObstacle("wall", [2], -55, 1);
  for (let i = 0; i < 5; i++) coins.push({ object3d: kit.makeCoin({ x: LANES[0], y: 0.9 + Math.sin(i / 4 * Math.PI) * 1.15, z: -9.6 - i * 1.7 }) });
  for (let i = 0; i < 5; i++) coins.push({ object3d: kit.makeCoin({ x: LANES[1], y: 0.95, z: -2.5 - i * 1.7 }) });
  for (let i = 0; i < 6; i++) coins.push({ object3d: kit.makeCoin({ x: LANES[2], y: 0.95, z: -17 - i * 1.7 }) });
}
kit.update(0, 0, G);
kit.applyLights(ctx.lights);

// ---------- ИЗМЕРЕНИЯ ----------
function measure(){
  const info = renderer.info;
  info.autoReset = false;
  const count = () => { info.reset(); renderer.render(scene, camera); return { calls: info.render.calls, tris: info.render.triangles }; };
  const all = count();
  kit.root.visible = false; const base = count(); kit.root.visible = true;
  const se = renderer.shadowMap.enabled; renderer.shadowMap.enabled = false; renderer.shadowMap.needsUpdate = true;
  const noShadow = count(); renderer.shadowMap.enabled = se; renderer.shadowMap.needsUpdate = true;
  info.autoReset = true;
  return { total: all.calls, base: base.calls, world: all.calls - base.calls, worldNoShadowPass: noShadow.calls - (base.calls - 0), tris: all.tris };
}
// разбивка: имя×экземпляры (* — отбрасывает тень) и треугольники на экземпляр
function breakdown(){
  const out = [];
  kit.root.traverseVisible(o => {
    if (!o.isMesh) return;
    const g = o.geometry, tri = Math.round((g.index ? g.index.count : g.attributes.position.count) / 3);
    out.push(`${o.name || o.parent.name || g.type}${o.isInstancedMesh ? "×" + o.count : ""}${o.castShadow ? "*" : ""}:${tri}`);
  });
  return out;
}
const stats = measure();
const ps = kit.state.palette;

function render(dt){ if (ctx.look.post) ctx.look.post.render(dt); else renderer.render(scene, camera); }
render(DT);

const hud = document.getElementById("hud");
hud.textContent = `world kit · q=${Q} at=${AT}s dist=${G.dist.toFixed(0)}m speed=${G.speed.toFixed(1)} · palette ${PALETTES[ps.index].name}` +
  `${qp.has("piece") ? " · piece " + qp.get("piece") : ""}\n` +
  `draw calls: world ${stats.world} / total ${stats.total} · tris ${stats.tris} · look ${ctx.look.mats ? "on" : "off"} curve ${ctx.look.curve ? "on" : "off"} post ${ctx.look.post ? "on" : "off"}`;
if (qp.get("hud") === "0") hud.hidden = true;

// пиксель финального кадра (sRGB 0..255), x/y — доли ширины/высоты от левого верхнего угла
function px(fx, fy){
  const gl = renderer.getContext(), c = renderer.domElement, out = new Uint8Array(4);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.readPixels(Math.floor(fx * (c.width - 1)), Math.floor((1 - fy) * (c.height - 1)), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
  return [out[0], out[1], out[2]];
}
// нагрузочный прогон кита без рендера: мс на update и прирост кучи (грубая проверка «ноль аллокаций»)
function bench(n = 3000){
  const dt = 1 / 60, g = { dist: G.dist, speed: 24 };
  for (let i = 0; i < 120; i++){ g.dist += g.speed * dt; kit.update(dt, dt, g); }   // прогрев JIT
  const mem = () => (performance.memory ? performance.memory.usedJSHeapSize : 0);
  const m0 = mem(), t0 = performance.now();
  for (let i = 0; i < n; i++){ g.dist += g.speed * dt; kit.update(dt, dt, g); }
  const ms = (performance.now() - t0) / n, m1 = mem();
  return { frames: n, msPerUpdate: +ms.toFixed(4), heapDeltaKB: Math.round((m1 - m0) / 1024), dist: Math.round(g.dist) };
}
window.DEV = {
  kit, renderer, scene, camera, G, log, stats, breakdown, measure, px, bench,
  info: () => JSON.stringify({ stats, dist: +G.dist.toFixed(1), palette: ps.index, events: log.slice(-12),
    obstacles: kit.debug.ents.liveObstacles.length, coins: kit.debug.ents.liveCoins.length, decor: kit.debug.decor.count(),
    landmarks: kit.landmarks.map(p => `${p.type}@${Math.round(p.s0)}`), breakdown: breakdown() }),
};

if (LIVE){
  let last = performance.now();
  renderer.setAnimationLoop(now => { const dt = Math.min(0.05, (now - last) / 1000); last = now; step(dt); render(dt); });
} else {
  requestAnimationFrame(() => { window.RUN = window.DEV; document.title = "SHOT_READY"; });
}
