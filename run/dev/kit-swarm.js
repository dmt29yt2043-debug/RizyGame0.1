// Стенд кита роя Гасителей: игровая камера (CAM из библии), снежная трасса на look/materials + post,
// заглушка Ризи на центральной полосе, рой в заданном состоянии.
// ?danger=0|0.5|1  ?catch=1 [&ct=сек после поимки]  ?from=D&sw=сек (переход)  ?at=сек симуляции (по умолчанию 5)
// ?cam=game|old|title|side  ?q=low|med|high  ?post=0  ?dv=множитель виньетки опасности  ?count=N  ?rm=1  ?ts=timeScale
// ?hide=1 (без роя — для сравнения)  ?hideui=1  ?shot=1 (симуляция шагом 1/60, один рендер, SHOT_READY)
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { createSwarm } from "../src/actors/swarm/swarm.js";

const qp = new URLSearchParams(location.search);
const num = (k, d) => (qp.has(k) ? +qp.get(k) : d);
const Q = ["low", "med", "high"].includes(qp.get("q")) ? qp.get("q") : "med";
const CAMMODE = qp.get("cam") || "game";

// look-модули могут меняться под нами — импортируем осторожно
async function tryImport(p){ try { return await import(p); } catch (e){ console.warn("kit-swarm: нет " + p, e.message); return null; } }

// ---------- РЕНДЕР ----------
const renderer = new THREE.WebGLRenderer({ antialias: qp.get("post") === "0", powerPreference: "high-performance", preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xdaeeff, 34, 128);
{
  const c = document.createElement("canvas"); c.width = 16; c.height = 256;
  const g = c.getContext("2d"), gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, "#6fc3ff"); gr.addColorStop(0.42, "#a9dcff"); gr.addColorStop(0.72, "#daeeff"); gr.addColorStop(0.88, "#ffe9e4"); gr.addColorStop(1, "#fff3e0");
  g.fillStyle = gr; g.fillRect(0, 0, 16, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; scene.background = t;
}

// игровая камера: CAM из библии {fov 60, y 3.8, z 6.4, lookY 1.0, lookZ −10}; ?cam=old — текущий config.js
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 400);
function placeCamera(){
  if (CAMMODE === "old"){ camera.fov = 58; camera.position.set(0, 3.05, 5.45); camera.lookAt(0, 1.35, -8); }
  else if (CAMMODE === "title"){ camera.fov = 50; camera.position.set(1.7, 1.75, -5.2); camera.lookAt(0, 1.45, 0); }
  else if (CAMMODE === "side"){ camera.fov = 50; camera.position.set(12, 5, 2); camera.lookAt(0, 1.5, 2.5); }
  else if (CAMMODE === "close"){ camera.fov = 40; camera.position.set(0, 2.6, 4.2); camera.lookAt(0, 2.6, -1.5); }
  else { camera.position.set(0, 3.8, 6.4); camera.lookAt(0, 1.0, -10); }
  camera.updateProjectionMatrix();
}
placeCamera();

const matsMod = await tryImport("../src/look/materials.js");
const postMod = qp.get("post") === "0" ? null : await tryImport("../src/look/post.js");
let look = null;
if (matsMod && matsMod.createLook){
  try { look = await matsMod.createLook({ THREE, renderer, scene, quality: Q }); } catch (e){ console.warn("kit-swarm: createLook", e); }
}
const H = look && look.hints ? look.hints : { hemi: 1.0, sun: 2.4, fill: 0.5, exposure: 1.15 };
renderer.toneMappingExposure = H.exposure;

// ---------- СВЕТ ----------
scene.add(new THREE.HemisphereLight(0xcfe8ff, 0xfff0dc, H.hemi));
const sun = new THREE.DirectionalLight(0xfff2da, H.sun);
sun.position.set(11, 17, 7); sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 12, bottom: -34, near: 1, far: 62 });
sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.02;
sun.target.position.set(0, 0, -12);
scene.add(sun, sun.target);
const fill = new THREE.DirectionalLight(0xbfd8ff, H.fill); fill.position.set(-9, 7, 4); scene.add(fill);

// ---------- МАТЕРИАЛЫ (look или простые фолбэки) ----------
const std = (c, o) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.9 }, o || {}));
const L = {
  felt: (c) => look ? look.felt(c) : std(c),
  candy: (c, o) => look ? look.candy(c, o) : std(c, { roughness: 0.35 }),
  snow: (o) => look ? look.snow(o) : std(0xffffff, { roughness: 1 }),
  wood: (o) => look ? look.wood(o) : std(0xe8c49a),
  ice: () => look ? look.ice() : std(0x7fd0ff, { roughness: 0.1 }),
  glow: (c, i) => look ? look.glow(c, i) : std(c, { emissive: c, emissiveIntensity: i }),
};
const trackMeshes = [];
function add(geo, m, x, y, z, cast = true, recv = true){
  const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = cast; o.receiveShadow = recv; scene.add(o); return o;
}
let seed = 11;
const rnd = (a = 0, b = 1) => { seed = (seed * 16807) % 2147483647; return a + (b - a) * (seed - 1) / 2147483646; };

// ---------- МИР ----------
const ground = add(new THREE.PlaneGeometry(220, 280), L.snow({ repeat: 26 }), 0, -0.02, -110, false, true);
ground.rotation.x = -Math.PI / 2;
const track = add(new THREE.PlaneGeometry(7.6, 220), L.wood({ repeat: [1.6, 60] }), 0, 0, -95, false, true);
track.rotation.x = -Math.PI / 2;
trackMeshes.push(track);
// снежные бороздки между полосами
for (const x of [-1.275, 1.275]){
  const s = add(new THREE.PlaneGeometry(0.12, 220), L.snow({ repeat: [0.1, 40], sparkle: 0.3 }), x, 0.01, -95, false, true);
  s.rotation.x = -Math.PI / 2;
}
// бордюры: фирменный синий леденец
const curbG = new RoundedBoxGeometry(0.55, 0.42, 220, 3, 0.12);
for (const sx of [-1, 1]) add(curbG, L.candy(0x0536D4, { stripe: 0xffffff, stripes: 2, repeat: [1, 80] }), sx * 4.08, 0.2, -95);
// сугробы-валы
const moundG = new THREE.SphereGeometry(1, 32, 16);
for (let i = 0; i < 30; i++){
  const side = i % 2 ? 1 : -1, z = 12 - i * 4.4 - rnd(0, 2);
  const m = add(moundG, L.snow({ repeat: 1.5 }), side * rnd(5.6, 8.5), -0.1, z);
  m.scale.set(rnd(1.4, 2.4), rnd(0.55, 1.05), rnd(1.6, 2.6));
}
// ёлки
const coneG = new THREE.ConeGeometry(1, 1.6, 18);
for (let i = 0; i < 18; i++){
  const side = i % 2 ? -1 : 1, x = side * rnd(9.5, 15), z = 8 - i * 7.5 - rnd(0, 3), s = rnd(1.1, 1.7);
  add(new THREE.CylinderGeometry(0.18 * s, 0.22 * s, 0.8 * s, 8), L.felt(0xb9764a), x, 0.4 * s, z);
  const tm = L.felt(i % 3 ? 0x7fd89a : 0x5fc48a);
  for (let k = 0; k < 3; k++){
    const c = add(coneG, tm, x, (1.2 + k * 0.85) * s, z); c.scale.setScalar(s * (1.35 - k * 0.3));
    const cap = add(coneG, L.snow({ repeat: 1 }), x, (1.55 + k * 0.85) * s, z); cap.scale.set(s * (0.75 - k * 0.2), s * 0.42, s * (0.75 - k * 0.2));
  }
}
// дальние горы
const mtM = std(0xbcd6f5, { roughness: 1 });
for (let i = 0; i < 9; i++){
  const m = add(new THREE.ConeGeometry(rnd(14, 26), rnd(18, 34), 7), mtM, -90 + i * 22 + rnd(-6, 6), 8, -150 - rnd(0, 30), false, false);
  m.rotation.y = rnd(0, 3);
}
// препятствия и энергоны (красный барьер нужен для проверки «глаз — самый горячий красный»)
add(new RoundedBoxGeometry(2.1, 0.9, 0.8, 4, 0.18), L.candy(0xFF3B5C, { stripe: 0xffffff, stripes: 3 }), -2.55, 0.45, -15);
add(new RoundedBoxGeometry(2.1, 1.9, 0.9, 4, 0.2), L.ice(), 2.55, 0.95, -27);
{
  const arch = add(new THREE.TorusGeometry(1.05, 0.16, 12, 32, Math.PI), L.candy(0xff7eb6, { stripe: 0xffffff, stripes: 4 }), 0, 0.9, -38);
  arch.scale.set(1.1, 1.0, 1);
}
const enG = new THREE.OctahedronGeometry(0.28, 0);
for (let i = 0; i < 6; i++){ const c = add(enG, L.glow(0xC0FF3F, 2.2), 2.55, 1.0, -6 - i * 1.7, true, false); c.rotation.set(0.3, i * 0.6, 0); }

// ---------- ЗАГЛУШКА РИЗИ ----------
const rizy = new THREE.Group();
{
  const P = (g, m, x, y, z) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; rizy.add(o); return o; };
  const skin = L.felt(0x5cc0ec), black = L.felt(0x1b1d2a), jeans = L.felt(0x2f6ff0), hair = L.felt(0xd2f550), lime = L.felt(0xC0FF3F);
  for (const s of [-1, 1]){
    P(new THREE.CapsuleGeometry(0.13, 0.5, 4, 12), jeans, s * 0.17, 0.42, 0);
    P(new RoundedBoxGeometry(0.24, 0.16, 0.4, 2, 0.06), black, s * 0.17, 0.08, 0.04);
    P(new THREE.CapsuleGeometry(0.09, 0.45, 4, 10), black, s * 0.43, 1.05, 0).rotation.z = s * 0.25;
  }
  P(new THREE.CapsuleGeometry(0.34, 0.45, 8, 16), black, 0, 1.0, 0);
  P(new THREE.TorusGeometry(0.26, 0.09, 10, 24), lime, 0, 1.42, 0).rotation.x = Math.PI / 2;
  P(new THREE.SphereGeometry(0.33, 24, 16), skin, 0, 1.78, 0);
  P(new THREE.SphereGeometry(0.36, 24, 16), hair, 0, 1.86, 0.04).scale.set(1, 0.9, 1);
  for (const s of [-1, 1]) P(new THREE.SphereGeometry(0.14, 16, 12), hair, s * 0.24, 2.18, 0.02);
  P(new RoundedBoxGeometry(0.56, 0.62, 0.26, 3, 0.1), jeans, 0, 1.05, 0.36);
}
scene.add(rizy);
if (CAMMODE === "title") rizy.rotation.y = Math.PI;

// ---------- РОЙ ----------
const swarm = createSwarm({ camera, quality: Q, look: { mats: look }, reducedMotion: qp.get("rm") === "1" },
  qp.has("count") ? { count: +qp.get("count") } : {});
scene.add(swarm.root);
if (qp.get("hide") === "1") swarm.root.visible = false;

// ---------- ПОСТ ----------
let post = null;
if (postMod && postMod.createPost){
  try {
    post = postMod.createPost({ THREE, renderer, scene, camera, quality: Q, qp, look: {} });
    if (post.ready) await post.ready;
  } catch (e){ console.warn("kit-swarm: createPost", e); post = null; }
}
function frame(dt){ if (post) post.render(dt); else renderer.render(scene, camera); }

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  if (post) post.setSize(innerWidth, innerHeight); else renderer.setSize(innerWidth, innerHeight);
});

// ---------- СОСТОЯНИЕ СТЕНДА ----------
const DANGER = num("danger", 0), FROM = qp.has("from") ? +qp.get("from") : null, SW = num("sw", 3);
const AT = num("at", 5), TS = num("ts", 1);
const CATCH = qp.get("catch") === "1", CT = num("ct", 1.2);
// cam=close — крупный план: титульное облако в 2 м перед камерой, заглушка Ризи скрыта
const S = { mode: CAMMODE === "title" || CAMMODE === "close" ? "title" : "play", danger: 0, playerX: 0, playerY: 0, playerZ: 0, speedI: num("speed", 0.4),
  titleDist: CAMMODE === "close" ? 1.5 : 14 };
if (CAMMODE === "close") rizy.visible = false;
let simTime = 0, caught = false;
function step(dt){
  const t = simTime;
  let d = DANGER;
  if (FROM != null && t < SW) d = FROM;
  if (CATCH) d = 1;
  S.danger = d;
  if (CATCH && !caught && t >= AT){ swarm.catch({ x: 0, y: 0, z: 0 }); caught = true; S.mode = "over"; }
  const sim = CATCH && caught ? dt * TS : dt;
  swarm.update(dt, sim, S);
  if (post) post.params.danger = d * num("dv", 0.5);
  simTime += dt;
}

// ---------- ТЕСТЫ ----------
const TEST = {
  swarm, renderer, scene, camera, post, S,
  // вызовы: всей сцены напрямую, роя (разница с/без), по мешам
  info(){
    const r = () => { renderer.render(scene, camera); return renderer.info.render.calls; };
    const vis = swarm.root.visible;
    swarm.root.visible = true; const withS = r();
    swarm.root.visible = false; const without = r();
    swarm.root.visible = vis;
    const tris = (() => { swarm.root.visible = true; const s2 = new THREE.Scene(); const par = swarm.root.parent; s2.add(swarm.root); renderer.render(s2, camera); const o = { calls: renderer.info.render.calls, tris: renderer.info.render.triangles }; par.add(swarm.root); swarm.root.visible = vis; return o; })();
    frame(0);
    return JSON.stringify({ q: Q, sceneCalls: withS, swarmCalls: withS - without, swarmOnly: tris, stats: swarm.stats() });
  },
  // доля пикселей «трассы впереди» (выше линии ног Ризи), закрытых роем; силуэт роя без учёта дырок меха (консервативно)
  coverage(){
    const w = 480, h = Math.round(480 / camera.aspect);
    const rt = new THREE.WebGLRenderTarget(w, h);
    const white = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });
    const grab = (sc) => { renderer.setRenderTarget(rt); renderer.setClearColor(0x000000, 1); renderer.clear(); renderer.render(sc, camera); renderer.setRenderTarget(null); const px = new Uint8Array(w * h * 4); renderer.readRenderTargetPixels(rt, 0, 0, w, h, px); return px; };
    const s1 = new THREE.Scene(); s1.overrideMaterial = white;
    const tm = new THREE.Mesh(track.geometry); tm.position.copy(track.position); tm.rotation.copy(track.rotation); s1.add(tm);
    const A = grab(s1);
    const s2 = new THREE.Scene(); s2.overrideMaterial = white;
    const par = swarm.root.parent; s2.add(swarm.root);
    const hid = swarm.root.children.filter(m => /glow|decal/.test(m.name));
    hid.forEach(m => m.visible = false);
    const B = grab(s2);
    hid.forEach(m => m.visible = true); par.add(swarm.root);
    renderer.setClearColor(0x000000, 0);
    // линия ног: проекция (0,0,0); в буфере строки снизу вверх
    const feet = new THREE.Vector3(0, 0, 0).project(camera);
    const feetRow = Math.round((feet.y * 0.5 + 0.5) * h);
    let tr = 0, cov = 0, swarmPx = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
      const i = (y * w + x) * 4;
      if (B[i] > 10) swarmPx++;
      if (y < feetRow || A[i] < 10) continue;
      tr++; if (B[i] > 10) cov++;
    }
    rt.dispose(); white.dispose(); frame(0);
    return JSON.stringify({ trackAheadPx: tr, coveredPx: cov, coveredFrac: +(cov / Math.max(1, tr)).toFixed(4), swarmFrameFrac: +(swarmPx / (w * h)).toFixed(4), feetRowFromTop: +(1 - feetRow / h).toFixed(3) });
  },
  // линейный HDR до тонмаппинга: самый горячий «красный» пиксель (r ≫ g,b) с глазами и без
  hotRed(){
    const w = 480, h = Math.round(480 / camera.aspect);
    const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.FloatType });
    const measure = () => {
      renderer.setRenderTarget(rt); renderer.render(scene, camera); renderer.setRenderTarget(null);
      const px = new Float32Array(w * h * 4); renderer.readRenderTargetPixels(rt, 0, 0, w, h, px);
      let mx = 0;
      for (let i = 0; i < px.length; i += 4){ const r = px[i], o = Math.max(px[i + 1], px[i + 2]); if (r > o * 2.5 && r > mx) mx = r; }
      return +mx.toFixed(3);
    };
    const withEyes = measure();
    const eyes = swarm.root.children.filter(m => /eye|glow/.test(m.name));
    eyes.forEach(m => m.visible = false);
    const other = measure();
    eyes.forEach(m => m.visible = true);
    rt.dispose(); frame(0);
    return JSON.stringify({ hottestRedWithEyes: withEyes, hottestRedWithoutEyes: other });
  },
};
window.TEST = TEST;

const info = document.getElementById("info");
const label = () => `swarm q=${Q} danger=${S.danger} mode=${S.mode} t=${simTime.toFixed(2)} ` + JSON.stringify(swarm.stats());
if (qp.get("hideui") === "1") info.hidden = true;

if (qp.has("shot")){
  const total = CATCH ? AT + CT : AT;
  const n = Math.round(total * 60);
  for (let i = 0; i < n; i++) step(1 / 60);
  frame(1 / 60);
  info.textContent = label();
  document.title = "SHOT_READY";
} else {
  let last = performance.now();
  const loop = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    step(dt); frame(dt); info.textContent = label();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
