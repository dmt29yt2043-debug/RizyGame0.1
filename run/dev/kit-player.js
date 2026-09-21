// Стенд кита героини: сетка поз, сравнение моделей бок о бок или один кадр с постобработкой.
// ?kind=procedural|glb|auto  ?glb=../src/actors/rizy/testdata/rizy_wip.glb (свой файл)
// ?kinds=procedural,glb      — одна поза (?pose=…) для каждой модели в соседних колонках
// ?pose=grid|idle|front|run|game|jump|land|slide|stumble|celebrate|over|lean|dive|nearmiss|danger
// ?view=face|front|game|game0|back34|side|close|back  ?q=low|med|high  ?post=0  ?look=0  ?speedI=0.5  ?t=сек  ?anim=1 (живой цикл)
//   game  — камера из bible (fov 60, y 3.8, z 6.4, look (0, 1.0, −10)); game0 — нынешняя камера main.js
// ?scarf=1 — verlet-шарф (по умолчанию выключен, на мастер-листе его нет), ?pack=1 — рюкзак (процедурная)
import * as THREE from "three";
import { createRizy } from "../src/actors/rizy/index.js";

const qp = new URLSearchParams(location.search);
const Q = ["low", "med", "high"].includes(qp.get("q")) ? qp.get("q") : "med";
const KIND = qp.get("kind") || "procedural";
const KINDS = qp.get("kinds") ? qp.get("kinds").split(",") : null;
const POSE = qp.get("pose") || (KINDS ? "run" : "grid");
const GRID = POSE === "grid" || !!KINDS;
const ANIM = qp.get("anim") === "1";
const I = qp.has("speedI") ? +qp.get("speedI") : 0.5;
const W = innerWidth, H = innerHeight;
const info = document.getElementById("info");

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = Q !== "low";
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
{
  const c = document.createElement("canvas"); c.width = 16; c.height = 256;
  const g = c.getContext("2d"), gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, "#6fc3ff"); gr.addColorStop(0.42, "#a9dcff"); gr.addColorStop(0.72, "#daeeff"); gr.addColorStop(0.88, "#ffe9e4"); gr.addColorStop(1, "#fff3e0");
  g.fillStyle = gr; g.fillRect(0, 0, 16, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; scene.background = t;
}
scene.fog = new THREE.Fog(0xdaeeff, 34, 128);
const camera = new THREE.PerspectiveCamera(40, W / H, 0.05, 400);

let look = null;
if (qp.get("look") !== "0"){
  try {
    const m = await import("../src/look/materials.js");
    look = await m.createLook({ THREE, renderer, scene, quality: Q });
  } catch (e){ console.warn("kit-player: look недоступен —", e && e.message); }
}
const hints = (look && look.hints) || { hemi: 1.0, sun: 2.4, fill: 0.3, exposure: 1.05 };
renderer.toneMappingExposure = hints.exposure;
scene.add(new THREE.HemisphereLight(0xcfe8ff, 0xfff0dc, look ? hints.hemi : 1.0));
const sun = new THREE.DirectionalLight(0xfff2da, hints.sun);
const SPACING = 8;
const NCELL = 8;
sun.position.set(11, 17, 7);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const ext = GRID ? SPACING * NCELL * 0.5 + 4 : 10;
Object.assign(sun.shadow.camera, { left: -ext, right: ext, top: 12, bottom: -14, near: 1, far: 80 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);
const fill = new THREE.DirectionalLight(0xbfd8ff, hints.fill); fill.position.set(-9, 7, -6); scene.add(fill);

// земля: снег + дощатая дорожка + синие бордюры (для кадра «как в игре»)
const env = new THREE.Group(); scene.add(env);
{
  const snowM = look ? look.snow({ repeat: 14 }) : new THREE.MeshStandardMaterial({ color: 0xf2f6ff, roughness: 0.95 });
  const gnd = new THREE.Mesh(new THREE.PlaneGeometry(260, 260), snowM); gnd.rotation.x = -Math.PI / 2; gnd.position.y = -0.01; gnd.receiveShadow = true; env.add(gnd);
  const woodM = look ? look.wood({ repeat: [1, 10] }) : new THREE.MeshStandardMaterial({ color: 0xd9b48a, roughness: 0.8 });
  const w = GRID ? SPACING * NCELL + 8 : 8.4;
  const deck = new THREE.Mesh(new THREE.PlaneGeometry(w, 120), woodM); deck.rotation.x = -Math.PI / 2; deck.position.set(0, 0.0, -40); deck.receiveShadow = true; env.add(deck);
  if (!GRID){
    const curbM = look ? look.candy(0x0536D4) : new THREE.MeshStandardMaterial({ color: 0x0536D4, roughness: 0.4 });
    for (const s of [-1, 1]){ const c = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.28, 120), curbM); c.position.set(s * 4.3, 0.14, -40); c.castShadow = c.receiveShadow = true; env.add(c); }
  }
}

// ---------- сценарии ----------
const gUp = 2 * 1.9 / (0.3 * 0.3), v0 = 2 * 1.9 / 0.3;
const easeOutCubic = t => 1 - Math.pow(1 - t, 3);
function scenario(name, x0){
  const G = { mode: "play", runPhase: 0, speedI: I, laneX: x0, py: 0, vy: 0, sliding: 0, grace: 0, dive: false, celebrate: false, danger: 0 };
  let T = 2.0, jumpAt = -1, slideAt = -1, hitAt = -1, laneAt = -1, diveAt = -1, landedAt = -1, nearAt = -1, stopAfterLand = -1;
  let view = "back34";
  switch (name){
    case "idle": G.mode = "title"; T = 3.4; view = "face"; break;
    case "front": G.mode = "title"; T = 1.7; view = "front"; break;
    case "run": T = 2.0; view = "back34"; break;
    case "game": T = 2.0; view = "game"; break;
    case "jump": jumpAt = 1.5; T = 1.5 + (qp.has("jt") ? +qp.get("jt") : 0.2); view = "back34"; break;
    case "land": jumpAt = 1.0; T = 9; stopAfterLand = 0.05; view = "side"; break;
    case "slide": slideAt = 1.5; T = 1.5 + 0.25; view = "back34"; break;
    case "stumble": hitAt = 1.5; T = 1.5 + 0.08 + 0.13; view = "back34"; break;
    case "celebrate": G.mode = "over"; G.celebrate = true; T = 0.62 * 4 + 0.31; view = "front"; break;
    case "over": G.mode = "over"; T = 3.0; view = "front"; break;
    case "lean": laneAt = 1.5; T = 1.5 + 0.1; view = "back34"; break;
    case "dive": jumpAt = 1.2; diveAt = 1.2 + 0.32; T = 1.2 + 0.32 + 0.06; view = "side"; break;
    case "nearmiss": nearAt = 1.5; T = 1.5 + 0.17; view = "back34"; break;
    case "danger": G.danger = 1; T = 2.0 + 0.125 + 1.2 * 0; view = "back34"; break;
  }
  if (qp.has("t")) T = +qp.get("t");
  let t = 0, hitStop = 0;
  return {
    name, x0, view, get T(){ return T; },
    // шаг: возвращает simDt (хит-стоп 80 мс после удара)
    step(dt, rizy){
      const tPrev = t; t += dt;
      const cross = a => a >= 0 && tPrev < a && t >= a;
      let sdt = dt;
      if (hitStop > 0){ hitStop -= dt; sdt = 0; }
      const spd = 12 + 18 * G.speedI;
      if (G.mode === "play") G.runPhase += sdt * (7 + spd * 0.36);
      if (cross(jumpAt)){ G.vy = v0; G.py = 0.001; }
      if (cross(diveAt)){ G.vy = -24; G.dive = true; rizy.trigger("dive"); }
      if (G.py > 0 || G.vy > 0){
        const g = G.vy > 0 ? (Math.abs(G.vy) < 2 ? gUp * 0.5 : gUp) : (Math.abs(G.vy) < 2 ? gUp * 0.5 : gUp * 1.5);
        G.vy -= g * sdt; G.py += G.vy * sdt;
        if (G.py <= 0){ G.py = 0; G.vy = 0; landedAt = t; if (G.dive){ G.dive = false; G.sliding = 0.55; } }
      }
      if (cross(slideAt)) G.sliding = 0.62 + (0.48 - 0.62) * G.speedI;
      if (G.sliding > 0) G.sliding = Math.max(0, G.sliding - sdt);
      if (cross(hitAt)){ rizy.trigger("hit"); G.grace = 1.5; hitStop = 0.08; }
      if (G.grace > 0) G.grace -= sdt;
      if (cross(nearAt)) rizy.trigger("nearmiss", { dir: 1 });
      if (laneAt >= 0 && t >= laneAt){ const k = Math.min(1, (t - laneAt) / 0.13); G.laneX = x0 + 2.55 * easeOutCubic(k); }
      if (stopAfterLand >= 0 && landedAt >= 0 && t >= landedAt + stopAfterLand) T = t;
      const st = Object.assign({}, G);
      if (name === "stumble") st.grace = 0;   // кадр без мигания
      rizy.setState(st);
      rizy.update(dt, sdt);
      return t >= T;
    },
    reset(){ t = 0; G.laneX = x0; G.py = 0; G.vy = 0; G.sliding = 0; G.dive = false; landedAt = -1; if (name === "land") T = 9; },
  };
}

function place(cam, view, x0, aspect, py = 0){
  cam.aspect = aspect;
  const V = qp.get("view") || view, fy = py * 0.85;
  if (V === "face"){ cam.fov = 26; cam.position.set(x0 + 0.5, 1.95, -2.5); cam.lookAt(x0, 1.74, 0); }
  else if (V === "front"){ cam.fov = 30; cam.position.set(x0 + 1.1, 1.45 + fy, -4.9); cam.lookAt(x0, 1.05 + fy, 0); }
  else if (V === "game"){ cam.fov = 60; cam.position.set(x0, 3.8, 6.4); cam.lookAt(x0, 1.0, -10); }
  else if (V === "game0"){ cam.fov = 58; cam.position.set(x0, 3.05, 5.45); cam.lookAt(x0, 1.45, -8); }
  // «close» — игровой ракурс со спины, но ближе: проверка ленты шарфа и затылка
  else if (V === "close"){ cam.fov = 30; cam.position.set(x0 + 0.4, 3.2, 4.6); cam.lookAt(x0, 1.35, 0); }
  else if (V === "side"){ cam.fov = 32; cam.position.set(x0 - 5.0, 1.3 + fy, -0.9); cam.lookAt(x0, 1.0 + fy, -0.2); }
  else if (V === "back"){ cam.fov = 30; cam.position.set(x0 + 0.3, 1.9, 4.6); cam.lookAt(x0, 1.55, 0); }
  else { cam.fov = 36; cam.position.set(x0 + 2.0, 2.15 + fy, 4.1); cam.lookAt(x0, 1.0 + fy, 0); }
  cam.updateProjectionMatrix(); cam.updateMatrixWorld();
}

const names = KINDS ? KINDS.map(() => POSE) : GRID ? ["idle", "front", "game", "run", "jump", "slide", "stumble", "celebrate"] : [POSE];
const ctx = { THREE, renderer, scene, camera, quality: Q, look: { mats: look }, qp };
const url = qp.get("glb") ? new URL(qp.get("glb"), location.href).href : undefined;
const actors = [];
for (let i = 0; i < names.length; i++){
  const x0 = GRID ? (i - (names.length - 1) / 2) * SPACING : 0;
  const kind = KINDS ? KINDS[i] : KIND;
  const prefer = kind === "glb" ? "glb" : kind === "auto" ? "auto" : "procedural";
  const rizy = await createRizy(ctx, { prefer, url, scarf: qp.get("scarf") === "1", backpack: qp.get("pack") === "1" });
  scene.add(rizy.root);
  actors.push({ rizy, sc: scenario(names[i], x0) });
}
window.KIT = { THREE, renderer, scene, camera, actors, look };

// ---------- симуляция до кадра ----------
const DT = 1 / 60;
const tBuild = performance.now();
for (const a of actors){
  place(camera, a.sc.view, a.sc.x0, W / H);
  for (let f = 0; f < 60 * 12; f++){
    camera.updateMatrixWorld();
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    if (a.sc.step(DT, a.rizy)) break;
  }
}
const simMs = performance.now() - tBuild;

// ---------- рендер ----------
function drawCallsOfCharacter(a0){
  // только один персонаж (со своими тенями): прячем окружение
  env.visible = false;
  for (const a of actors) a.rizy.root.visible = a === a0;
  place(camera, a0.sc.view, a0.sc.x0, W / H);
  const bg = scene.background; scene.background = null;
  renderer.info.autoReset = false; renderer.info.reset();
  renderer.setRenderTarget(null);
  renderer.render(scene, camera);
  const calls = renderer.info.render.calls, tris = renderer.info.render.triangles;
  renderer.info.autoReset = true; scene.background = bg;
  env.visible = true;
  for (const a of actors) a.rizy.root.visible = true;
  return { calls, tris };
}
const charInfo = actors.map(drawCallsOfCharacter);

let post = null;
if (!GRID && qp.get("post") !== "0"){
  try {
    const m = await import("../src/look/post.js");
    post = m.createPost({ THREE, renderer, scene, camera, quality: Q });
    if (post.ready) await Promise.race([post.ready, new Promise(r => setTimeout(r, 4000))]);
    post.setSize(W, H);
  } catch (e){ console.warn("kit-player: post недоступен —", e && e.message); post = null; }
}

const COLS = KINDS ? KINDS.length : 4;
function frame(){
  if (GRID){
    const cols = COLS, rows = Math.ceil(actors.length / cols), cw = Math.floor(W / cols), ch = Math.floor(H / rows);
    renderer.setScissorTest(true);
    actors.forEach((a, i) => {
      const cx = (i % cols) * cw, cy = H - ch - Math.floor(i / cols) * ch;
      for (const b of actors) b.rizy.root.visible = b === a;
      renderer.setViewport(cx, cy, cw, ch); renderer.setScissor(cx, cy, cw, ch);
      place(camera, a.sc.view, a.sc.x0, cw / ch, a.rizy.anim.S.py);
      renderer.render(scene, camera);
    });
    renderer.setScissorTest(false);
    for (const b of actors) b.rizy.root.visible = true;
  } else {
    place(camera, actors[0].sc.view, actors[0].sc.x0, W / H, actors[0].rizy.anim.S.py);
    if (post) post.render(DT); else renderer.render(scene, camera);
  }
}
frame();

if (GRID){
  const cols = COLS, cw = W / cols, ch = H / Math.ceil(actors.length / cols);
  actors.forEach((a, i) => {
    const d = document.createElement("div"); d.className = "lbl";
    const st = a.rizy.stats();
    d.textContent = a.sc.name + " · " + a.rizy.kind + (KINDS ? ` · ${st.tris} tris · ${st.callsWithShadows} calls` : "");
    d.style.left = ((i % cols) * cw + 8) + "px"; d.style.top = (Math.floor(i / cols) * ch + 8) + "px";
    document.body.appendChild(d);
  });
}

// замер CPU кадра кита (update без рендера): среднее по 600 кадрам бега
function cpuPerFrame(a){
  const n = 600, t0 = performance.now();
  for (let i = 0; i < n; i++) a.sc.step(DT, a.rizy);
  return +((performance.now() - t0) / n).toFixed(4);
}
const r0 = actors[0].rizy;
window.KIT.stats = {
  kind: r0.kind, glbError: r0.glbError, charCalls: charInfo[0].calls, charTris: charInfo[0].tris,
  geo: actors.map(a => a.rizy.stats()),
  state: r0.state, simMs: Math.round(simMs), info: r0.rig.info || null,
};
window.KIT.cpu = () => actors.map(cpuPerFrame);
const s0 = window.KIT.stats.geo[0];
info.textContent = `kind=${r0.kind} q=${Q} персонаж: ${s0.tris} tris, ${s0.calls} draw calls (${s0.callsWithShadows} с тенями); рендер-проход с тенями ${charInfo[0].calls}/${charInfo[0].tris}` + (r0.glbError ? ` · glb: ${r0.glbError}` : "");

if (ANIM){
  let last = performance.now();
  const loop = () => {
    const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000); last = now;
    for (const a of actors){ if (a.sc.step(dt, a.rizy)) a.sc.reset(); }
    frame();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
} else {
  document.title = "SHOT_READY";
}
