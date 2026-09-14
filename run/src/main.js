// РИЗИ RUN: Снежная Река — бутстрап, цикл, ввод, геймплей, камера, загрузчик плагинов, фоторежим, window.RUN.
// Визуал/HUD/звук живут в плагинах (src/plugins/<slot>.js, фолбэк src/base/<slot>.js) и общаются через ctx.bus.
import * as THREE from "three";
import cfg from "./config.js";
import { createBus, scopeBus } from "./core/bus.js";
import * as U from "./core/util.js";

const qp = new URLSearchParams(location.search);
// ?seed=N: Math.random детерминирован (визуальный поток). Сразу, до любых объектов three.
const SEED = U.installSeed(qp);
const VER = new URL(import.meta.url).searchParams.get("v") || "";
const $ = id => document.getElementById(id);
const { clamp, lerp } = U;
const LANES = cfg.LANES;

// Геймплейный генератор отдельно от визуального: плагины сколько угодно зовут Math.random,
// а препятствия и энергоны от этого не меняются (sim без рендера = та же трасса).
let grand = SEED !== null ? U.makeRng(SEED ^ 0x5EED) : Math.random;
const grnd = (a,b) => a + grand()*(b-a);
const gpick = arr => arr[Math.floor(grand()*arr.length)];

// ---------- КАЧЕСТВО ----------
function pickQuality(){
  const q = qp.get("q");
  if (q === "low" || q === "med" || q === "high") return q;
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
    (typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches && !matchMedia("(pointer: fine)").matches);
  const cores = navigator.hardwareConcurrency || 8;
  return (mobile || cores <= 4) ? "low" : "med";
}
const SHOT = qp.has("shot");

// ---------- РЕНДЕР ----------
const renderer = new THREE.WebGLRenderer({ antialias:true, powerPreference:"high-performance", preserveDrawingBuffer: SHOT });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.18;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
$("wrap").prepend(renderer.domElement);

const scene = new THREE.Scene();          // фон и туман ставит плагин world

const CAM = cfg.CAM;
const camera = new THREE.PerspectiveCamera(CAM.fov, innerWidth/innerHeight, CAM.near, CAM.far);
camera.position.set(0, CAM.y, CAM.z);
camera.lookAt(0, 1.35, CAM.lookZ);

// ---------- СВЕТ ----------
const hemi = new THREE.HemisphereLight(0xcfe8ff, 0xfff0dc, 1.05);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff2da, 2.35);
sun.position.set(11, 17, 7);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -14; sun.shadow.camera.right = 14;
sun.shadow.camera.top = 12; sun.shadow.camera.bottom = -34;
sun.shadow.camera.near = 1; sun.shadow.camera.far = 62;
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);
sun.target.position.set(0, 0, -12);
const fill = new THREE.DirectionalLight(0xbfd8ff, 0.5);
fill.position.set(-9, 7, 4);
scene.add(fill);

// ---------- СОСТОЯНИЕ ----------
const G = {
  mode:"title", dist:0, energons:0, best:0,
  lane:1, x:0, py:0, vy:0, sliding:0,
  speed:cfg.speedStart, runPhase:0, grace:0, swarmNear:0, shake:0, land:0,
  combo:0, laneDir:0,
  dz:0,                                   // сколько метров мир проехал в этом шаге (0 вне забега)
  nextObstacleZ:cfg.obstacleFirstZ, nextCoinZ:cfg.coinFirstZ,
};
try { G.best = +localStorage.getItem(cfg.bestKey) || 0; } catch(e){}

const bus = createBus();
const ctx = {
  THREE, renderer, scene, camera,
  G, cfg, bus, qp,
  quality: pickQuality(),
  look: { mats:null, curve:null, post:null },
  entities: { obstacles: [], coins: [] },
  util: { rnd:U.rnd, pick:U.pick, clamp:U.clamp, lerp:U.lerp, damp:U.damp, canvasTex:U.canvasTex, makeRng:U.makeRng },
  $,
  time: { t:0, dt:0 },
  lights: { hemi, sun, fill },
  simulating: false,                      // true во время sim()/предпрогона фоторежима
};
const { obstacles, coins } = ctx.entities;

addEventListener("resize", () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth/innerHeight;
  camera.updateProjectionMatrix();
  if (ctx.look.post) ctx.look.post.setSize(innerWidth, innerHeight);
  bus.emit("resize", { w:innerWidth, h:innerHeight });
});
document.addEventListener("visibilitychange", () => bus.emit("pause", document.hidden));

// ---------- СТАТИСТИКА (для sim и ботов) ----------
const stats = { hits:0, jumps:0, slides:0, laneChanges:0, passed:{ jump:0, slide:0, wall:0 } };
let nextMilestone = cfg.milestoneStep;
let entId = 0;

// ---------- ВВОД ----------
// Читаем и code, и key, и keyCode: в части окружений и раскладок code приходит пустым.
function keyOf(ev){
  const c = ev.code || "";
  const k = (ev.key || "").toLowerCase();
  const n = ev.keyCode || ev.which || 0;
  if (c === "Enter"  || k === "enter" || n === 13) return "ENTER";
  if (c === "Space"  || k === " " || k === "spacebar" || n === 32) return "SPACE";
  if (c === "Escape" || k === "escape" || n === 27) return "ESC";
  if (c === "ArrowLeft"  || c === "KeyA" || k === "arrowleft"  || k === "a" || k === "ф" || n === 37 || n === 65) return "LEFT";
  if (c === "ArrowRight" || c === "KeyD" || k === "arrowright" || k === "d" || k === "в" || n === 39 || n === 68) return "RIGHT";
  if (c === "ArrowUp"    || c === "KeyW" || k === "arrowup"    || k === "w" || k === "ц" || n === 38 || n === 87) return "UP";
  if (c === "ArrowDown"  || c === "KeyS" || k === "arrowdown"  || k === "s" || k === "ы" || n === 40 || n === 83) return "DOWN";
  return "";
}
function doAction(a){
  if (G.mode === "title"){ if (a==="ENTER"||a==="SPACE"||a==="UP") startRun(); return; }
  if (G.mode === "over"){
    if (a==="ENTER"||a==="SPACE"||a==="UP") startRun();
    else if (a==="ESC"){ G.mode = "title"; bus.emit("title"); }
    return;
  }
  if (G.mode !== "play") return;
  if (a === "LEFT" || a === "RIGHT"){
    const dir = a === "LEFT" ? -1 : 1, from = G.lane;
    G.lane = clamp(G.lane+dir, 0, 2);
    G.laneDir = dir;
    if (G.lane !== from) stats.laneChanges++;
    bus.emit("lane", { dir, from, to:G.lane });   // шлём и у края трассы — как «бип» в монолите
  }
  if ((a === "UP" || a === "SPACE") && G.py<=0.01 && !G.sliding){
    G.vy = cfg.jumpVy; stats.jumps++;
    bus.emit("jump");
  }
  if (a === "DOWN" && G.py<=0.01 && !G.sliding){
    G.sliding = cfg.slideTime; stats.slides++;
    bus.emit("slide");
  }
}
addEventListener("keydown", ev => {
  const a = keyOf(ev);
  if (a) ev.preventDefault();
  doAction(a);
});
// мышь/перо: клик по экрану запускает забег; в забеге — трети экрана: влево / прыжок / вправо.
// Касания обрабатывают свайпы ниже (иначе тап давал бы двойное действие).
addEventListener("pointerdown", ev => {
  if (ev.pointerType === "touch") return;
  if (G.mode !== "play"){ doAction("ENTER"); return; }
  const w = innerWidth;
  if (ev.clientX < w*0.28) doAction("LEFT");
  else if (ev.clientX > w*0.72) doAction("RIGHT");
  else doAction("UP");
});
// свайпы для тача
let touch = null;
addEventListener("touchstart", ev => {
  const t = ev.changedTouches[0];
  touch = { x:t.clientX, y:t.clientY, t:performance.now() };
}, { passive:true });
addEventListener("touchend", ev => {
  if (!touch) return;
  const t = ev.changedTouches[0];
  const dx = t.clientX - touch.x, dy = t.clientY - touch.y;
  const dt = performance.now() - touch.t;
  touch = null;
  if (dt > 700) return;
  if (Math.abs(dx) < 30 && Math.abs(dy) < 30){ doAction(G.mode==="play" ? "UP" : "ENTER"); return; }
  if (Math.abs(dx) > Math.abs(dy)) doAction(dx > 0 ? "RIGHT" : "LEFT");
  else doAction(dy > 0 ? "DOWN" : "UP");
}, { passive:true });
addEventListener("touchcancel", () => { touch = null; }, { passive:true });

// ---------- СУЩНОСТИ ----------
function removeEntity(list, i){
  const e = list[i];
  list.splice(i, 1);
  bus.emit("despawn", e);
}
function addObstacle(kind, lanes, z){
  const e = { id:++entId, kind, lanes, z, zLen:cfg.zLen[kind], object3d:null, passed:false, touched:false };
  obstacles.push(e);
  bus.emit("spawn:obstacle", e);
  if (e.object3d) e.object3d.position.z = e.z;
}
function spawnObstacle(z){
  const r = grand();
  if (r < 0.36) addObstacle("jump", [Math.floor(grnd(0,3))], z);
  else if (r < 0.63) addObstacle("slide", gpick([[0],[1],[2],[0,1],[1,2],[0,1,2]]).slice(), z);
  else {
    // стена на нескольких полосах — отдельные сущности с общим z
    const lanes = gpick([[0],[1],[2],[0,1],[1,2],[0,2]]);
    for (const l of lanes) addObstacle("wall", [l], z);
  }
}
function spawnCoins(z){
  const lane = Math.floor(grnd(0,3));
  const arc = grand() < cfg.coinArcChance;
  const n = arc ? cfg.coinArc : cfg.coinRow;
  for (let i=0;i<n;i++){
    const y = arc ? 0.9 + Math.sin(i/(n-1)*Math.PI)*1.15 : 0.95;
    const e = { id:++entId, lane, x:LANES[lane], y, z: z - i*cfg.coinStep, object3d:null };
    coins.push(e);
    bus.emit("spawn:coin", e);
  }
}

// ---------- ЗАБЕГ ----------
function startRun(){
  for (let i=obstacles.length-1;i>=0;i--) removeEntity(obstacles, i);
  for (let i=coins.length-1;i>=0;i--) removeEntity(coins, i);
  Object.assign(G, { mode:"play", dist:0, energons:0, lane:1, x:0, py:0, vy:0,
    sliding:0, speed:cfg.speedStart, runPhase:0, grace:0, swarmNear:0, shake:0, land:0,
    combo:0, laneDir:0, dz:0,
    nextObstacleZ:cfg.obstacleFirstZ, nextCoinZ:cfg.coinFirstZ });
  stats.hits = stats.jumps = stats.slides = stats.laneChanges = 0;
  stats.passed.jump = stats.passed.slide = stats.passed.wall = 0;
  nextMilestone = cfg.milestoneStep;
  bus.emit("start");
}
function gameOver(){
  G.mode = "over";
  const d = Math.floor(G.dist);
  const isBest = d > G.best;
  if (isBest){
    G.best = d;
    if (!ctx.simulating) try { localStorage.setItem(cfg.bestKey, String(d)); } catch(e){}
  }
  bus.emit("gameover", { dist:d, energons:G.energons, isBest });
}

// ---------- КОЛЛИЗИИ ----------
function checkCollisions(){
  for (let i=0;i<obstacles.length;i++){
    const o = obstacles[i];
    if (Math.abs(o.z) > (o.zLen/2 + cfg.hitPad)) continue;
    if (!o.lanes.includes(G.lane)) continue;
    if (o.kind === "jump" && G.py < cfg.jumpClear) return hit(o);
    if (o.kind === "slide" && !G.sliding && G.py < cfg.slideClear) return hit(o);
    if (o.kind === "wall") return hit(o);
  }
}
function hit(o){
  o.touched = true;
  if (G.grace > 0) return;
  G.grace = cfg.graceTime; G.shake = cfg.shakeTime;
  G.speed = Math.max(cfg.hitSpeedMin, G.speed*cfg.hitSpeedMul);
  G.combo = 0;
  stats.hits++;
  bus.emit("hit", o);
  if (G.swarmNear > 0) return gameOver();
  G.swarmNear = cfg.swarmTime;
  bus.emit("swarm:near");
}

// ---------- ШАГ ГЕЙМПЛЕЯ ----------
function updateGame(dt){
  const speedI = Math.floor(G.speed);
  G.speed = Math.min(cfg.speedMax, G.speed + dt*cfg.speedAccel);
  if (Math.floor(G.speed) > speedI) bus.emit("speedup", G.speed);
  const dz = G.speed * dt;
  G.dz = dz;
  G.dist += dz;
  if (G.dist >= nextMilestone){ bus.emit("milestone", nextMilestone); nextMilestone += cfg.milestoneStep; }
  G.runPhase += dt * (7 + G.speed*0.36);
  if (G.grace > 0) G.grace -= dt;
  if (G.swarmNear > 0){
    G.swarmNear -= dt;
    if (G.swarmNear <= 0) bus.emit("swarm:far");
  }

  G.x = lerp(G.x, LANES[G.lane], Math.min(1, dt*cfg.laneLerp));
  const wasAir = G.py > 0.01;
  G.vy -= cfg.gravity*dt;
  G.py = Math.max(0, G.py + G.vy*dt);
  if (G.py === 0){
    if (wasAir && G.vy < -2){ G.land = cfg.landSquash; bus.emit("land", { impact:-G.vy }); }
    G.vy = 0;
  }
  // в монолите sliding уходил в -0.016 (truthy) и блокировал прыжок/подкат до конца забега — зажимаем в 0
  if (G.sliding > 0) G.sliding = Math.max(0, G.sliding - dt);
  if (G.land > 0) G.land -= dt;

  // спавн
  G.nextObstacleZ += dz;
  if (G.nextObstacleZ > cfg.obstacleTrigger){
    spawnObstacle(cfg.obstacleSpawnZ + grnd(-6,6));
    G.nextObstacleZ = cfg.obstacleTrigger - grnd(17,31) - Math.max(0, 24-G.speed);
  }
  G.nextCoinZ += dz;
  if (G.nextCoinZ > cfg.coinTrigger){
    spawnCoins(cfg.coinSpawnZ + grnd(-8,8));
    G.nextCoinZ = cfg.coinTrigger - grnd(20,36);
  }

  for (let i=obstacles.length-1;i>=0;i--){
    const o = obstacles[i];
    o.z += dz;
    if (o.object3d) o.object3d.position.z = o.z;
    if (!o.passed && o.z > o.zLen/2 + cfg.hitPad){
      // препятствие позади: засчитываем, если не задело
      o.passed = true;
      if (!o.touched){
        stats.passed[o.kind]++;
        let close = false;
        for (let k=0;k<o.lanes.length;k++) if (Math.abs(o.lanes[k]-G.lane) <= 1) close = true;
        if (close) bus.emit("nearmiss", o);
      }
    }
    if (o.z > cfg.obstacleDespawnZ) removeEntity(obstacles, i);
  }
  const CP = cfg.coinPick;
  for (let i=coins.length-1;i>=0;i--){
    const c = coins[i];
    c.z += dz;
    if (c.object3d) c.object3d.position.z = c.z;
    if (Math.abs(c.z) < CP.z &&
        Math.abs(c.x - G.x) < CP.x &&
        Math.abs(c.y - (CP.yBase + G.py)) < CP.y){
      G.energons++; G.combo++;
      bus.emit("pickup", c);
      removeEntity(coins, i);
      continue;
    }
    if (c.z > cfg.coinDespawnZ) removeEntity(coins, i);
  }

  checkCollisions();
}

// ---------- КАМЕРА ----------
function updateCamera(dt){
  const perf = ctx.time.t;
  if (G.shake > 0) G.shake -= dt;
  const shx = G.shake>0 ? (Math.random()-0.5)*0.3*G.shake : 0;
  const shy = G.shake>0 ? (Math.random()-0.5)*0.24*G.shake : 0;
  const speedPull = G.mode==="play" ? (G.speed-13)/19*0.5 : 0;
  camera.position.x = lerp(camera.position.x, G.x*0.42+shx, Math.min(1,dt*5.5));
  camera.position.y = CAM.y + Math.sin(perf*1.3)*0.05 + shy + G.py*0.22;
  camera.position.z = CAM.z + speedPull;
  camera.lookAt(G.x*0.55, 1.45 + G.py*0.35, CAM.lookZ);
  sun.position.set(camera.position.x+11, 17, 7);
  sun.target.position.set(camera.position.x, 0, -12);
}

// ---------- ПЛАГИНЫ ----------
const SLOTS = ["world", "player", "vfx", "swarm", "hud", "audio"];   // порядок установки = порядок update
const plugins = {};                       // slot → { slot, kind, api, pctx, scope, roots, errors, swapping }
const BREAK = qp.get("breakplugin");

function withTimeout(p, ms, label){
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(label + ": install не завершился за " + ms + " мс")), ms);
    Promise.resolve(p).then(v => { clearTimeout(t); res(v); }, e => { clearTimeout(t); rej(e); });
  });
}
function teardown(rec){
  try { rec.api && rec.api.dispose && rec.api.dispose(); } catch(e){ console.error(`[plugins] ${rec.slot}: dispose упал`, e); }
  rec.scope.offAll();
  // всё, что плагин добавил в сцену при установке, убираем даже если dispose сломан
  for (const o of rec.roots) if (o.parent) o.parent.remove(o);
}
async function installModule(slot, mod, kind){
  const def = mod && mod.default;
  if (!def || typeof def.install !== "function") throw new Error(`${kind}/${slot}.js: нет default.install`);
  const scope = scopeBus(bus);
  const pctx = Object.create(ctx);        // чтение ctx живое через прототип; своя шина с учётом подписок
  pctx.bus = scope;
  const before = new Set(scene.children);
  const rec = { slot, kind, api:null, pctx, scope, roots:[], errors:0, swapping:false };
  try {
    rec.api = (await withTimeout(def.install(pctx), 10000, `${kind}/${slot}`)) || {};
    if (kind === "live" && BREAK === slot) throw new Error(`breakplugin=${slot}: принудительная ошибка установки`);
  } catch(e){
    rec.roots = scene.children.filter(o => !before.has(o));
    teardown(rec);
    throw e;
  }
  rec.roots = scene.children.filter(o => !before.has(o));
  plugins[slot] = rec;
  return rec;
}
function importSlot(dir, slot){
  return import(`./${dir}/${slot}.js${VER ? "?v=" + VER : ""}`);
}
async function installBase(slot, baseImport){
  try {
    const mod = await (baseImport || importSlot("base", slot));
    return await installModule(slot, mod, "base");
  } catch(e){
    console.error(`[plugins] ${slot}: base/${slot}.js тоже не установился — слот пуст`, e);
    plugins[slot] = null;
    return null;
  }
}
// визуал сущностей пересоздаётся новым world-плагином
function respawnEntities(rec){
  if (!rec || rec.slot !== "world") return;
  for (const e of obstacles){ if (e.object3d && e.object3d.parent) e.object3d.parent.remove(e.object3d); e.object3d = null; rec.scope.emitLocal("spawn:obstacle", e); }
  for (const e of coins){ if (e.object3d && e.object3d.parent) e.object3d.parent.remove(e.object3d); e.object3d = null; rec.scope.emitLocal("spawn:coin", e); }
}
async function swapToBase(rec){
  rec.swapping = true;
  teardown(rec);
  plugins[rec.slot] = null;
  if (rec.kind === "base"){ console.error(`[plugins] ${rec.slot}: base-плагин падает в update — слот отключён`); return; }
  console.error(`[plugins] ${rec.slot}: 3 ошибки update подряд → замена на base/${rec.slot}.js`);
  const nrec = await installBase(rec.slot);
  respawnEntities(nrec);
}
async function loadPlugins(){
  // импортируем параллельно, устанавливаем строго по очереди (детерминированный порядок объектов)
  const live = SLOTS.map(s => importSlot("plugins", s).then(m => ({ m }), e => ({ e })));
  const base = SLOTS.map(s => importSlot("base", s));
  base.forEach(p => p.catch(() => {}));   // ошибка base всплывёт только если он понадобится
  for (let i=0;i<SLOTS.length;i++){
    const slot = SLOTS[i];
    const r = await live[i];
    try {
      if (r.e) throw r.e;
      await installModule(slot, r.m, "live");
    } catch(e){
      console.error(`[plugins] ${slot}: живой plugins/${slot}.js не установился (${e && e.message}) → фолбэк на base/${slot}.js`, e);
      await installBase(slot, base[i]);
    }
  }
}
function updatePlugins(dt){
  for (let i=0;i<SLOTS.length;i++){
    const rec = plugins[SLOTS[i]];
    if (!rec || rec.swapping || !rec.api.update) continue;
    try { rec.api.update(dt, rec.pctx); rec.errors = 0; }
    catch(e){
      rec.errors++;
      console.error(`[plugins] ${rec.slot}: ошибка update (${rec.errors} подряд)`, e);
      if (rec.errors >= 3) swapToBase(rec);
    }
  }
}

// ---------- ЦИКЛ ----------
const framePayload = { dt:0 };
// один шаг симуляции: геймплей → плагины → камера. Рендер отдельно.
function step(dt){
  ctx.time.dt = dt;
  ctx.time.t += dt;
  G.dz = 0;
  if (G.mode === "play") updateGame(dt);
  if (ctx.look.curve) ctx.look.curve.update(dt, G);
  updatePlugins(dt);
  updateCamera(dt);
  framePayload.dt = dt;
  bus.emit("frame", framePayload);
}
function render(){
  if (ctx.look.post) ctx.look.post.render(ctx.time.dt);
  else renderer.render(scene, camera);
}

let lastT = performance.now(), looping = false, frozen = false;
// шаг не больше 1/60 (длинный кадр режется на подшаги), провал больше 0.35 с не догоняем
function frame(now){
  if (!looping || frozen) return;
  let elapsed = Math.min(0.35, (now-lastT)/1000);
  lastT = now;
  while (elapsed > 1e-6){
    const dt = Math.min(1/60, elapsed);
    step(dt);
    elapsed -= dt;
  }
  render();
}
function tickRAF(now){ frame(now); if (!frozen) requestAnimationFrame(tickRAF); }
// фоновые вкладки/headless могут не давать rAF — подстраховка таймером
setInterval(() => { const now = performance.now(); if (looping && !frozen && now-lastT > 60) frame(now); }, 50);

// ---------- БОТЫ ДЛЯ sim ----------
const botCost = [0,0,0];
function botPerfect(){
  const sp = Math.max(1, G.speed);
  // ближайшая ещё не пройденная группа препятствий (в пределах 45 м)
  let zNear = -Infinity;
  for (const o of obstacles){
    if (o.z > o.zLen/2 + cfg.hitPad || o.z < -45) continue;
    if (o.z > zNear) zNear = o.z;
  }
  botCost[0] = botCost[1] = botCost[2] = 0;
  for (let l=0;l<3;l++) botCost[l] = Math.abs(l - G.lane);
  if (zNear > -Infinity){
    for (const o of obstacles){
      if (Math.abs(o.z - zNear) > 3) continue;
      for (const l of o.lanes) botCost[l] += o.kind === "wall" ? 1000 : 1.5;
    }
  }
  // энергоны впереди тянут в свою полосу
  for (const c of coins) if (c.z > -20 && c.z < 0.5) botCost[c.lane] -= 0.4;
  let target = G.lane;
  for (let l=0;l<3;l++) if (botCost[l] < botCost[target] - 1e-6) target = l;
  if (target < G.lane) doAction("LEFT");
  else if (target > G.lane) doAction("RIGHT");
  // действие в текущей полосе: прыжок/подкат как можно позже, но с запасом на подъём
  if (zNear === -Infinity) return;
  for (const o of obstacles){
    if (Math.abs(o.z - zNear) > 3 || !o.lanes.includes(G.lane)) continue;
    const t1 = (-o.z - (o.zLen/2 + cfg.hitPad)) / sp;      // сек до входа в зону удара
    if (o.kind === "jump" && t1 < 0.24 && t1 > -0.05) doAction("UP");
    if (o.kind === "slide" && t1 < 0.16 && t1 > -0.2) doAction("DOWN");
  }
}
const BOT_ACTS = ["LEFT", "RIGHT", "UP", "DOWN"];
function makeBot(kind){
  if (kind === "perfect") return botPerfect;
  if (kind === "random"){
    const r = U.makeRng(((SEED ?? 1) * 7919 + 13) >>> 0);
    return () => { if (r() < 0.03) doAction(BOT_ACTS[Math.floor(r()*4)]); };
  }
  return () => {};
}
// синхронный прогон забега шагом 1/60 без рендера
function sim(seconds = 30, bot = "idle"){
  if (SEED !== null) grand = U.makeRng(SEED ^ 0x5EED);   // тот же сид → та же трасса при каждом sim
  const act = makeBot(bot);
  const wasSim = ctx.simulating;
  ctx.simulating = true;
  startRun();
  const n = Math.round(seconds*60);
  for (let i=0;i<n && G.mode === "play";i++){ act(); step(1/60); }
  ctx.simulating = wasSim;
  lastT = performance.now();
  return {
    dist: Math.round(G.dist*10)/10, energons: G.energons, hits: stats.hits, gameover: G.mode === "over",
    jumps: stats.jumps, slides: stats.slides, laneChanges: stats.laneChanges,
    passed: { jump: stats.passed.jump, slide: stats.passed.slide, wall: stats.passed.wall },
  };
}

window.RUN = { ctx, G, renderer, scene, camera, startRun, step, render, sim, plugins, doAction, stats };
if (qp.get("hideui") === "1") document.body.classList.add("hideui");

// ---------- ЗАПУСК ----------
const ready = loadPlugins().then(() => {
  bus.emit("title");
  if (SHOT) return runShot();
  lastT = performance.now();
  looping = true;
  requestAnimationFrame(tickRAF);
});
window.RUN.ready = ready;

// ?shot=1&at=N — автостарт, симуляция N секунд шагом 1/60 без смертей, заморозка, ОДИН рендер
function runShot(){
  const at = qp.has("at") ? +qp.get("at") : 4;
  const lane = qp.has("lane") ? clamp(+qp.get("lane"), 0, 2) : null;
  ctx.simulating = true;
  const n = Math.max(1, Math.round(at*60));
  if (qp.get("cam") === "title"){
    for (let i=0;i<n;i++) step(1/60);          // титульный экран: только «живой» idle
  } else {
    startRun();
    for (let i=0;i<n;i++){
      if (lane !== null) G.lane = lane;
      G.grace = 99;                             // в фоторежиме не умираем
      step(1/60);
    }
    if (qp.get("pose") === "jump"){ G.py = 1.2; G.vy = 0; }
    if (qp.get("pose") === "slide"){ G.sliding = 0.5; }
    // добивочный кадр без геймплея, чтобы поза применилась
    ctx.time.t += 1/60; ctx.time.dt = 1/60; G.dz = 0;
    updatePlugins(1/60); updateCamera(1/60);
  }
  render();
  frozen = true;
  ctx.simulating = false;
  document.title = "SHOT_READY";
}
