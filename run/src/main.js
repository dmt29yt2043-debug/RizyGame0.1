// РИЗИ RUN: Снежная Река — бутстрап, часы и сигналы, ввод, геймплей, камера, свет, look (IBL/изгиб/пост),
// загрузчик плагинов, фоторежим, боты, window.RUN.
// Визуал/HUD/звук живут в плагинах (src/plugins/<slot>.js, фолбэк src/base/<slot>.js) и общаются через ctx.bus.
// Контракт (поля G, события, сигнатуры) — ARCHITECTURE.md. Числа — feature bible 2026 (cfg).
import * as THREE from "three";
import cfg from "./config.js";
import { createBus, scopeBus } from "./core/bus.js";
import * as U from "./core/util.js";
import * as E from "./core/ease.js";
import { installInput } from "./core/input.js";
import { createCameraRig } from "./core/camera.js";
import { createDirector } from "./core/director.js";
import { createMissions } from "./core/missions.js";
import { createBots } from "./core/bots.js";

const qp = new URLSearchParams(location.search);
// ?seed=N: Math.random детерминирован (визуальный поток). Сразу, до любых объектов three.
const SEED = U.installSeed(qp);
const VER = new URL(import.meta.url).searchParams.get("v") || "";
const $ = id => document.getElementById(id);
const { clamp, lerp, damp } = U;
const LANES = cfg.LANES;

// Геймплейный генератор отдельно от визуального: плагины сколько угодно зовут Math.random,
// а препятствия и энергоны от этого не меняются (sim без рендера = та же трасса).
let grand = SEED !== null ? U.makeRng(SEED ^ 0x5EED) : Math.random;
const rngProxy = () => grand();

// ---------- ФЛАГИ И КАЧЕСТВО ----------
function pickQuality(){
  const q = qp.get("q");
  if (q === "low" || q === "med" || q === "high") return q;
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
    (typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches && !matchMedia("(pointer: fine)").matches);
  const cores = navigator.hardwareConcurrency || 8;
  return (mobile || cores <= 4) ? "low" : "med";
}
const SHOT = qp.has("shot");
const LOOK_ON = qp.get("look") !== "0";
const POST_ON = LOOK_ON && qp.get("nopost") !== "1";
const CURVE_ON = LOOK_ON && qp.get("nocurve") !== "1";
const QUALITY = pickQuality();
const QC = cfg.QUALITY[QUALITY];
const LIGHT = cfg.LIGHT;

// ---------- РЕНДЕР ----------
// при посте сглаживание делает SMAA/FXAA в цепочке — MSAA канваса не нужен
const renderer = new THREE.WebGLRenderer({ antialias: !POST_ON, powerPreference: "high-performance", preserveDrawingBuffer: SHOT });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, QC.dprMax));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = LOOK_ON ? LIGHT.exposure : LIGHT.legacy.exposure;
renderer.shadowMap.enabled = !!QC.shadows;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.domElement.style.touchAction = "none";
$("wrap").prepend(renderer.domElement);

const scene = new THREE.Scene();          // фон и туман ставит плагин world

const CAM = cfg.CAM;
const camera = new THREE.PerspectiveCamera(CAM.fov, innerWidth/innerHeight, CAM.near, CAM.far);
camera.position.set(0, CAM.y, CAM.z);
camera.lookAt(0, CAM.lookY, CAM.lookZ);
scene.add(camera);                        // чтобы дети камеры (например, частицы у объектива) рендерились

// ---------- СВЕТ (LOOK-2 / LOOK-3) ----------
const hemi = new THREE.HemisphereLight(LIGHT.hemi.sky, LIGHT.hemi.ground, LOOK_ON ? LIGHT.hemi.intensity : LIGHT.legacy.hemi);
scene.add(hemi);
const sun = new THREE.DirectionalLight(LIGHT.sun.color, LOOK_ON ? LIGHT.sun.intensity : LIGHT.legacy.sun);
const SUN_DIR = new THREE.Vector3().fromArray(LIGHT.sun.dir).normalize();
let shadowTexel = 0.05;                   // шаг снапа цели тени (пересчитывает fitShadowBox)
sun.castShadow = !!QC.shadows;
if (QC.shadows){
  sun.shadow.mapSize.set(QC.shadowMap, QC.shadowMap);
  sun.shadow.bias = LIGHT.sun.bias;
  sun.shadow.normalBias = LIGHT.sun.normalBias;
  fitShadowBox();
}
scene.add(sun, sun.target);
const FILL_DIR = new THREE.Vector3().fromArray(LIGHT.fill.dir).normalize();
const fill = new THREE.DirectionalLight(LIGHT.fill.color, LOOK_ON ? LIGHT.fill.intensity : LIGHT.legacy.fill);
scene.add(fill, fill.target);
// орто-бокс тени вписан в мир x −8..8, y 0..4, z −40..8 в пространстве света (цель тени — (G.x, 0, −12))
function fitShadowBox(){
  const B = LIGHT.sun.box, D = LIGHT.sun.dist, tz = LIGHT.sun.targetZ;
  const eye = SUN_DIR.clone().multiplyScalar(D);
  const m = new THREE.Matrix4().lookAt(eye, new THREE.Vector3(), new THREE.Vector3(0, 1, 0));
  const ax = new THREE.Vector3(), ay = new THREE.Vector3(), az = new THREE.Vector3();
  m.extractBasis(ax, ay, az);
  let l = Infinity, r = -Infinity, b = Infinity, t = -Infinity, n = Infinity, f = -Infinity;
  const p = new THREE.Vector3();
  for (const x of B.x) for (const y of B.y) for (const z of B.z){
    p.set(x, y, z - tz).sub(eye);
    const lx = p.dot(ax), ly = p.dot(ay), depth = -p.dot(az);
    l = Math.min(l, lx); r = Math.max(r, lx); b = Math.min(b, ly); t = Math.max(t, ly); n = Math.min(n, depth); f = Math.max(f, depth);
  }
  const sc = sun.shadow.camera;
  sc.left = l - 0.5; sc.right = r + 0.5; sc.bottom = b - 0.5; sc.top = t + 0.5;
  sc.near = Math.max(LIGHT.sun.near, n - 2); sc.far = Math.min(Math.max(LIGHT.sun.far, f + 2), 120);
  sc.updateProjectionMatrix();
  shadowTexel = (sc.right - sc.left) / QC.shadowMap;
}

// ---------- НАСТРОЙКИ ----------
const settings = { reducedMotion: null, calm: false, contrast: false, vibro: true };
try { Object.assign(settings, JSON.parse(localStorage.getItem(cfg.settingsKey) || "{}")); } catch(e){}
let mqReduced = null;
try { mqReduced = matchMedia("(prefers-reduced-motion: reduce)"); } catch(e){}
function reducedMotionNow(){
  if (qp.has("rm")) return qp.get("rm") === "1";
  if (typeof settings.reducedMotion === "boolean") return settings.reducedMotion;
  return !!(mqReduced && mqReduced.matches);
}

// ---------- СОСТОЯНИЕ ----------
const G = {
  mode:"title", paused:false, countdown:0,
  dist:0, energons:0, bonusEnergons:0, best:0,
  // полосы: lane мгновенно (честные коллизии), x — твин laneFrom → laneTo за laneDur (easeOutCubic)
  lane:1, laneDir:0, laneFrom:0, laneTo:0, laneT:1, laneDur:0.15, x:0, edgeX:0,
  // вертикаль
  py:0, vy:0, dive:false, sliding:0, slideDur:0.62, land:0,
  // скорость и время забега
  speed:cfg.speedStart, speedTarget:cfg.speedStart, runT:0, runPhase:0, introT:0, retry:false, dz:0,
  // удары и рой
  grace:0, blinkOn:true, swarmNear:0, revives:0, catchT:0, overT:0,
  // сигналы (2.0)
  intensity:0, danger:0, trauma:0, shake:0, timeScale:1, realDt:0, simDt:0, tunnel:0,
  // комбо и near-miss (GAME-8)
  combo:0, mult:1, comboIdleT:0,
  nearMiss:{ count:0, kind:"", t:-9, obstacle:null },
  mission:{ id:"", kind:"", text:"", goal:0, progress:0, done:false, index:0 },
  tutorial:{ active:false, step:0, phase:"", action:"" },
  reducedMotion:reducedMotionNow(), calm:!!settings.calm, inputKind:"keys",
};
try { G.best = +localStorage.getItem(cfg.bestKey) || 0; } catch(e){}
if (mqReduced && mqReduced.addEventListener) mqReduced.addEventListener("change", () => { G.reducedMotion = reducedMotionNow(); });

const bus = createBus();

// ---------- ЖУРНАЛ СОБЫТИЙ (RUN.events) ----------
// кольцо без аллокаций на запись: имя, время, ссылка на payload (разворачивается только при чтении)
const LOG_N = 160;
const evLog = Array.from({ length: LOG_N }, () => ({ t:0, name:"", p:null }));
let evHead = 0, evCount = 0;
const rawEmit = bus.emit;
bus.emit = function(evt, payload){
  if (evt !== "frame"){
    const r = evLog[evHead]; r.t = ctxTime(); r.name = evt; r.p = payload;
    evHead = (evHead + 1) % LOG_N; if (evCount < LOG_N) evCount++;
  }
  rawEmit(evt, payload);
};
function ctxTime(){ return ctx ? Math.round(ctx.time.t * 1000) / 1000 : 0; }
function summarize(p){
  if (p === null || p === undefined || typeof p !== "object") return p;
  const o = {};
  for (const k in p){
    const v = p[k];
    if (v === null || typeof v === "number" || typeof v === "string" || typeof v === "boolean") o[k] = v;
    else if (Array.isArray(v) && v.length < 8 && v.every(x => typeof x === "number")) o[k] = v.slice();
    else if (v && typeof v === "object" && ("kind" in v || "id" in v)) o[k] = { id: v.id, kind: v.kind };
  }
  return o;
}
function readEvents(n = LOG_N){
  const out = [];
  const m = Math.min(n, evCount);
  for (let i = m; i >= 1; i--){
    const r = evLog[(evHead - i + LOG_N) % LOG_N];
    out.push({ t: r.t, name: r.name, payload: summarize(r.p) });
  }
  return out;
}

// ---------- ctx ----------
const ctx = {
  THREE, renderer, scene, camera,
  G, cfg, bus, qp,
  quality: QUALITY,
  look: { mats:null, curve:null, post:null, patch: o => o, enabled: LOOK_ON },
  entities: { obstacles: [], coins: [] },
  util: { rnd:U.rnd, pick:U.pick, clamp:U.clamp, lerp:U.lerp, damp:U.damp, canvasTex:U.canvasTex, makeRng:U.makeRng, ease:E },
  $,
  time: { t:0, dt:0, simT:0, simDt:0 },
  lights: { hemi, sun, fill, sunDir: SUN_DIR },
  settings,
  simulating: false,                      // true во время sim()/предпрогона фоторежима
  actions: null,                          // заполняется ниже: start, pause, resume, revive, skipTutorial, toTitle, setSetting
};
const { obstacles, coins } = ctx.entities;

// ---------- СТАТИСТИКА (для sim и ботов) ----------
const stats = { hits:0, jumps:0, slides:0, laneChanges:0, nearMisses:0, missions:0, passed:{ jump:0, slide:0, wall:0 }, hitLog:[] };
let nextMilestone = cfg.milestoneStep;
let entId = 0, recordDone = false;

// переиспользуемые payload-ы (подписчики не должны хранить ссылки на них)
const P_lane = { dir:0, from:0, to:0 };
const P_edge = { dir:0 };
const P_land = { impact:0, vy:0, dive:false };
const P_start = { retry:false, tutorial:false };
const P_landmark = { type:"gate", meters:0, s:0 };
const P_tut = { n:0, phase:"", action:"", text:"" };
const P_catch = { dist:0, obstacle:null };
const P_frame = { dt:0, realDt:0, simDt:0 };
const P_record = { best:0 };

// ---------- ЧАСЫ: timeScale = min(пауза, хит-стоп, слоу-мо поимки, micro-slow near-miss, туториал) ----------
const clock = { hitStopT:-1, nearT:-1, catchT:-1, tutScale:1, shotForce:false, freezeSim:false };
function computeTimeScale(realDt){
  let s = 1;
  if (clock.hitStopT >= 0){
    clock.hitStopT += realDt;
    const h = cfg.hitStop, r = cfg.hitStopRamp;
    if (clock.hitStopT < h) s = 0;
    else if (clock.hitStopT < h + r) s = Math.min(s, (clock.hitStopT - h) / r);
    else clock.hitStopT = -1;
  }
  if (clock.nearT >= 0){
    clock.nearT += realDt;
    const NM = cfg.nearMiss;
    if (clock.nearT < NM.slowHold) s = Math.min(s, NM.slowTo);
    else if (clock.nearT < NM.slowHold + NM.slowRamp) s = Math.min(s, lerp(NM.slowTo, 1, (clock.nearT - NM.slowHold) / NM.slowRamp));
    else clock.nearT = -1;
  }
  if (G.mode === "catch") s = Math.min(s, lerp(1, cfg.catchSlow.to, E.easeOutQuad(G.catchT / cfg.catchSlow.dur)));
  if (G.tutorial.active) s = Math.min(s, clock.tutScale);
  if (G.paused || G.mode === "countdown") s = 0;
  if (clock.shotForce) s = 1;
  if (clock.freezeSim) s = 0;
  G.timeScale = s;
  return s;
}

// ---------- ВВОД ----------
const input = installInput({
  onAction: (a, src) => { G.inputKind = input ? input.kind : "keys"; doAction(a, src); },
  isPlaying: () => G.mode === "play" && !G.paused,
});

const J = cfg.jump;
const V0 = 2 * J.h / J.th, G_UP = 2 * J.h / (J.th * J.th);
const buf = { jump:-1, slide:-1 };        // сек до протухания буфера ввода (realDt)
let groundT = 0, laneChangeT = -9, laneLeft = -1, slideStartT = -9, jumpedSinceGround = false;

function curI(){ return clamp((G.speed - 12) / 18, 0, 1); }
function grounded(){ return G.py <= 0 && G.vy <= 0; }

function doAction(a, src){
  if (a === "PAUSE" || (a === "ESC" && G.mode === "play")){
    if (G.mode === "play"){ if (G.paused) resume(); else pause(); }
    return;
  }
  if (G.mode === "title"){ if (a === "ENTER" || a === "UP") startRun(); return; }
  if (G.mode === "over"){
    if (G.overT < cfg.overLock && src !== "bot") return;       // защита от панических тапов
    if (a === "ENTER" || a === "UP") startRun({ retry:true });
    else if (a === "ESC") toTitle();
    return;
  }
  if (G.mode !== "play") return;
  if (G.paused){ if (a === "ENTER" || a === "UP") resume(); return; }
  const ctl = G.retry ? cfg.CAM_SWOOP.controlRetry : cfg.CAM_SWOOP.controlAt;
  if (G.introT < ctl && src !== "bot" && !ctx.simulating) return;

  if (a === "LEFT" || a === "RIGHT") changeLane(a === "LEFT" ? -1 : 1);
  else if (a === "UP"){
    if (G.sliding > 0) G.sliding = 0;            // прыжок отменяет подкат
    if (grounded() || (groundT < cfg.coyote && !jumpedSinceGround && G.vy <= 0)) jump();
    else buf.jump = cfg.inputBuffer;
  } else if (a === "DOWN"){
    if (!grounded()) dive();
    else slide();
  }
}

function changeLane(dir){
  const to = G.lane + dir;
  if (to < 0 || to > 2){
    // edge bump: отскок от стены без штрафа
    edge.t = 0; edge.dir = dir;
    addTrauma(cfg.TRAUMA.edge);
    P_edge.dir = dir; bus.emit("edgebump", P_edge);
    return;
  }
  laneLeft = G.lane; laneChangeT = G.runT;
  const from = G.lane;
  G.lane = to; G.laneDir = dir;
  edge.t = -1; G.edgeX = 0;
  G.laneFrom = G.x; G.laneTo = LANES[to]; G.laneT = 0;
  G.laneDur = lerp(cfg.laneDur[0], cfg.laneDur[1], curI()) / 1000;
  stats.laneChanges++;
  if (missions.track("lane")) comboAdd(cfg.combo.mission);
  tutorialInput("lane");
  P_lane.dir = dir; P_lane.from = from; P_lane.to = to;
  bus.emit("lane", P_lane);
}
function jump(){
  G.vy = V0; G.dive = false; G.sliding = 0;
  jumpedSinceGround = true; buf.jump = -1;
  stats.jumps++;
  tutorialInput("jump");
  bus.emit("jump");
}
function slide(){
  G.slideDur = lerp(cfg.slideTime[0], cfg.slideTime[1], curI());
  G.sliding = G.slideDur; slideStartT = G.runT; buf.slide = -1;
  stats.slides++;
  tutorialInput("slide");
  bus.emit("slide");
}
function dive(){
  if (G.dive) return;
  G.dive = true;
  G.vy = Math.min(G.vy, J.diveVy);
  tutorialInput("slide");
  bus.emit("dive");
}
const edge = { t:-1, dir:0 };

// ---------- СУЩНОСТИ ----------
function removeEntity(list, i){
  const e = list[i];
  for (let j = i; j < list.length - 1; j++) list[j] = list[j + 1];
  list.length--;
  bus.emit("despawn", e);
}
function addObstacle(kind, lanes, z, s, row, tier){
  const e = { id:++entId, kind, lanes, z, s, row, tier, zLen:cfg.zLen[kind], object3d:null,
    passed:false, touched:false, entered:false, inLane:false, minPy:9, near:"", fatal:false };
  obstacles.push(e);
  bus.emit("spawn:obstacle", e);
  if (e.object3d) e.object3d.position.z = e.z;
}
function addCoin(lane, x, y, z, s, arc, arcN){
  const e = { id:++entId, lane, x: Number.isNaN(x) ? LANES[lane] : x, y, z, s, arc, arcN, object3d:null };
  coins.push(e);
  bus.emit("spawn:coin", e);
  if (e.object3d) e.object3d.position.z = e.z;
}

const director = createDirector({ cfg, G, rng: rngProxy, addObstacle, addCoin });
const missions = createMissions({ cfg, G, bus, persist: () => !ctx.simulating && !SHOT });

// ---------- ТРАВМА / КОМБО ----------
function addTrauma(v){ G.trauma = Math.min(1, G.trauma + v); }
const arcTrack = { id:0, n:0 };
function comboAdd(pts){
  G.combo += pts; G.comboIdleT = 0;
  updateTier();
}
function updateTier(){
  const T = cfg.combo.tiers;
  let m = 1;
  for (let i = 0; i < T.length; i++) if (G.combo >= T[i]) m = i + 2;
  if (m !== G.mult){
    const up = m > G.mult;
    G.mult = m;
    if (up){ rig.kick("big"); postSpike(0.25, 400); }
    bus.emit("combo:tier", m);
  }
}

// ---------- ЗАБЕГ ----------
function tutorialWanted(){
  if (SHOT || ctx.simulating) return false;
  const t = qp.get("tut");
  if (t === "0") return false;
  if (t === "1") return true;
  try { return !localStorage.getItem(cfg.tutorial.key); } catch(e){ return false; }
}
function resetRunState(){
  for (let i = obstacles.length - 1; i >= 0; i--) removeEntity(obstacles, i);
  for (let i = coins.length - 1; i >= 0; i--) removeEntity(coins, i);
  Object.assign(G, { paused:false, countdown:0, dist:0, energons:0, bonusEnergons:0,
    lane:1, laneDir:0, laneFrom:0, laneTo:0, laneT:1, x:0, edgeX:0,
    py:0, vy:0, dive:false, sliding:0, land:0,
    speed:0, speedTarget:cfg.speedStart, runT:0, runPhase:0, introT:0, dz:0,
    grace:0, blinkOn:true, swarmNear:0, revives:0, catchT:0, overT:0,
    combo:0, mult:1, comboIdleT:0, tunnel:0 });
  G.nearMiss.count = 0; G.nearMiss.kind = ""; G.nearMiss.t = -9; G.nearMiss.obstacle = null;
  buf.jump = buf.slide = -1; groundT = 0; laneChangeT = -9; laneLeft = -1; slideStartT = -9; jumpedSinceGround = false;
  edge.t = -1; hitSlow.t = -1; arcTrack.id = 0; arcTrack.n = 0;
  clock.hitStopT = clock.nearT = -1; clock.tutScale = 1;
  stats.hits = stats.jumps = stats.slides = stats.laneChanges = stats.nearMisses = stats.missions = 0;
  stats.passed.jump = stats.passed.slide = stats.passed.wall = 0; stats.hitLog.length = 0;
  nextMilestone = cfg.milestoneStep; recordDone = false;
  postMood.over = 0;
}
function startRun(opts){
  const retry = !!(opts && opts.retry);
  const tut = opts && "tutorial" in opts ? !!opts.tutorial : tutorialWanted();
  resetRunState();
  G.mode = "play"; G.retry = retry;
  director.reset({ tutorial: tut });
  tutorialBegin(tut);
  missions.reset();
  rig.startSwoop(retry);
  if (G.reducedMotion && !ctx.simulating) crossfade();
  P_start.retry = retry; P_start.tutorial = tut;
  bus.emit("start", P_start);
}
function toTitle(){
  G.mode = "title"; G.paused = false;
  rig.toTitle();
  postMood.over = 0;
  document.body.classList.remove("paused");
  bus.emit("title");
}
function pause(){
  if (G.mode !== "play" || G.paused) return;
  G.paused = true;
  document.body.classList.add("paused");
  setText("cd", "");
  bus.emit("pause", true);
}
function resume(){
  if (!G.paused) return;
  G.mode = "countdown"; G.countdown = 3;
  countdownShown = 3;
  setText("cd", "3");
  bus.emit("countdown", 3);
}
let countdownShown = 0;
function updateCountdown(realDt){
  G.countdown -= realDt;
  const n = Math.ceil(G.countdown);
  if (n !== countdownShown && n > 0){ countdownShown = n; setText("cd", String(n)); bus.emit("countdown", n); }
  if (G.countdown <= 0){
    G.countdown = 0; G.mode = "play"; G.paused = false;
    document.body.classList.remove("paused");
    bus.emit("resume");
    bus.emit("pause", false);
  }
}

// ---------- УДАР / ПОИМКА / GAME OVER ----------
const hitSlow = { t:-1, from:0, to:0 };
function hit(o){
  o.touched = true;
  if (G.grace > 0) return;
  G.grace = cfg.graceTime;
  clock.hitStopT = 0;
  addTrauma(cfg.TRAUMA.hit);
  rig.kick("hit");
  postFlash(cfg.BRAND.danger, 450);
  hitSlow.t = 0; hitSlow.from = G.speed; hitSlow.to = Math.max(cfg.hitSpeedMin, G.speed * cfg.hitSpeedMul);
  if (G.mult > 1 || G.combo > 0){ G.combo = 0; updateTier(); }
  director.onHit();
  const tut = G.tutorial.active;                // в обучении проиграть нельзя: удар без «страйка»
  o.fatal = !tut && G.swarmNear > 0;
  if (!tut){
    stats.hits++;
    stats.hitLog.push({ t: Math.round(G.runT * 100) / 100, dist: Math.round(G.dist), kind: o.kind, lanes: o.lanes.slice(), tier: o.tier, lane: G.lane, py: Math.round(G.py * 100) / 100, sliding: G.sliding > 0 });
  }
  bus.emit("hit", o);
  if (o.fatal) return startCatch(o);
  if (!tut){ G.swarmNear = cfg.swarmTime; bus.emit("swarm:near"); }
}
let finalDist = 0;
function startCatch(o){
  G.mode = "catch"; G.catchT = 0;
  finalDist = Math.floor(G.dist);
  addTrauma(cfg.TRAUMA.catch);
  // облёт в сторону свободной полосы
  let freeDir = G.lane === 0 ? 1 : G.lane === 2 ? -1 : 1;
  if (G.lane === 1){
    let l0 = false, l2 = false;
    for (let i = 0; i < obstacles.length; i++){ const q = obstacles[i]; if (Math.abs(q.s - o.s) < 2){ if (q.lanes.includes(0)) l0 = true; if (q.lanes.includes(2)) l2 = true; } }
    freeDir = l2 && !l0 ? -1 : 1;
  }
  rig.startCatch(freeDir);
  P_catch.dist = finalDist; P_catch.obstacle = o;
  bus.emit("catch", P_catch);
}
function gameOver(){
  G.mode = "over"; G.overT = 0;
  const d = finalDist;
  const isBest = d > G.best;
  if (isBest){
    G.best = d;
    if (!ctx.simulating && !SHOT) try { localStorage.setItem(cfg.bestKey, String(d)); } catch(e){}
  }
  const price = cfg.revivePrice[Math.min(G.revives, cfg.revivePrice.length - 1)];
  bus.emit("gameover", { dist:d, energons:G.energons, bonus:G.bonusEnergons, best:G.best, isBest,
    revive:{ price, can: G.revives < 2 && G.energons >= price } });
}
// GAME-6: спасение за энергоны (зовёт HUD через ctx.actions.revive)
function revive(){
  if (G.mode !== "over" || G.revives >= 2) return false;
  const price = cfg.revivePrice[Math.min(G.revives, cfg.revivePrice.length - 1)];
  if (G.energons < price) return false;
  G.energons -= price; G.revives++;
  G.swarmNear = 0; bus.emit("swarm:far");
  G.grace = 3.0;
  G.speed = Math.max(cfg.hitSpeedMin, G.speed * 0.85);
  // ударная волна: всё ближе 30 м убираем
  for (let i = obstacles.length - 1; i >= 0; i--) if (obstacles[i].z > -30) removeEntity(obstacles, i);
  director.onHit();
  G.mode = "countdown"; G.paused = true; G.countdown = 3; countdownShown = 3;
  postMood.over = 0;
  rig.startSwoop(true);
  bus.emit("revive");
  bus.emit("countdown", 3);
  return true;
}

// ---------- ШАГ ГЕЙМПЛЕЯ ----------
function updateGame(simDt, realDt){
  G.introT += realDt;
  G.runT += simDt;
  const tut = G.tutorial.active;

  // скорость: разгон на старте → удар (×0.6 за 200 мс) → догоняем цель +4 u/s²
  const calmK = G.calm ? cfg.calmSpeedMul : 1;
  const target = (tut ? cfg.tutorial.speed : director.targetSpeed(G.runT)) * calmK;
  G.speedTarget = target;
  const spPrev = Math.floor(G.speed);
  if (G.runT < cfg.speedIntro && !(G.revives > 0)) G.speed = target * E.easeOutQuad(G.runT / cfg.speedIntro);
  else if (hitSlow.t >= 0){
    hitSlow.t += simDt;
    G.speed = lerp(hitSlow.from, hitSlow.to, E.easeOutQuad(hitSlow.t / cfg.hitSpeedDur));
    if (hitSlow.t >= cfg.hitSpeedDur) hitSlow.t = -1;
  } else {
    const a = cfg.speedAccel * simDt;
    G.speed = G.speed < target ? Math.min(target, G.speed + a) : Math.max(target, G.speed - a);
  }
  if (Math.floor(G.speed) > spPrev && G.runT > cfg.speedIntro) bus.emit("speedup", G.speed);

  const dz = G.speed * simDt;
  G.dz = dz;
  G.dist += dz;
  if (G.dist >= nextMilestone) milestone(nextMilestone);
  if (!recordDone && G.best > cfg.recordMin && G.dist >= G.best){ recordDone = true; P_record.best = G.best; bus.emit("record", P_record); }
  G.runPhase += simDt * (7 + G.speed * 0.36);
  if (G.grace > 0) G.grace = Math.max(0, G.grace - simDt);
  if (G.swarmNear > 0){
    G.swarmNear -= simDt;
    if (G.swarmNear <= 0){ G.swarmNear = 0; bus.emit("swarm:far"); }
  }
  // мигание неуязвимости: 10 Гц 1.2 с, затем 5 Гц 0.4 с, 70% кадра видно
  if (G.grace > 0 && G.grace <= cfg.graceTime){
    const el = cfg.graceTime - G.grace;
    const hz = el < 1.2 ? 10 : 5;
    G.blinkOn = ((el * hz) % 1) < 0.7;
  } else G.blinkOn = true;

  // полоса: твин + edge bump
  if (G.laneT < 1) G.laneT = Math.min(1, G.laneT + simDt / G.laneDur);
  let ex = 0;
  if (edge.t >= 0){
    edge.t += simDt;
    const EB = cfg.edgeBump;
    if (edge.t < EB.out) ex = E.easeOutQuad(edge.t / EB.out);
    else if (edge.t < EB.out + EB.back) ex = 1 - E.easeOutBack((edge.t - EB.out) / EB.back);
    else edge.t = -1;
    ex *= edge.dir * EB.dx;
  }
  G.edgeX = ex;
  G.x = lerp(G.laneFrom, G.laneTo, E.easeOutCubic(G.laneT)) + ex;

  // вертикаль: Pittman — взлёт gUp, зависание у апекса, тяжёлое падение, нырок
  if (buf.jump >= 0) buf.jump -= realDt;
  if (G.py > 0 || G.vy > 0){
    let g = G_UP;
    if (G.dive) g = G_UP * J.fallMul;
    else if (Math.abs(G.vy) < J.hangVy) g *= J.hangMul;
    else if (G.vy < 0) g *= J.fallMul;
    const vy0 = G.vy;
    G.vy -= g * simDt;
    G.py += (vy0 + G.vy) * 0.5 * simDt;       // трапеция: точная высота при постоянной g (Эйлер недобирал ~0.1 м)
    groundT = 0;
    if (G.py <= 0){
      const vy = G.vy, wasDive = G.dive;
      G.py = 0; G.vy = 0; G.dive = false; jumpedSinceGround = false;
      if (vy < -2){
        G.land = cfg.landSquash;
        P_land.vy = vy; P_land.impact = clamp(-vy / 24, 0, 1); P_land.dive = wasDive;
        if (P_land.impact > 0.6) rig.kick("land");
        if (vy < -10) addTrauma(cfg.TRAUMA.hardLand);
        bus.emit("land", P_land);
      }
      if (wasDive){ addTrauma(cfg.TRAUMA.dive); slide(); }
      if (buf.jump >= 0) jump();                 // буфер 130 мс: прыжок сразу после приземления
    }
  } else {
    groundT += simDt;
  }
  if (G.sliding > 0) G.sliding = Math.max(0, G.sliding - simDt);
  if (G.land > 0) G.land = Math.max(0, G.land - simDt);

  // комбо утекает после 3 с без событий
  G.comboIdleT += simDt;
  if (G.combo > 0 && G.comboIdleT > cfg.combo.leakAfter){ G.combo = Math.max(0, G.combo - cfg.combo.leak * simDt); updateTier(); }

  if (tut) tutorialUpdate(realDt);
  director.update();
  moveEntities(true);
  missions.update();
  checkCollisions();
}

function milestone(m){
  nextMilestone = m + cfg.milestoneStep;
  rig.kick("big");
  postSpike(0.25, 400);
  director.requestBreather();
  bus.emit("milestone", m);
  P_landmark.type = "gate"; P_landmark.meters = m; P_landmark.s = m;
  bus.emit("landmark", P_landmark);
}

const NM = cfg.nearMiss;
function moveEntities(live){
  for (let i = obstacles.length - 1; i >= 0; i--){
    const o = obstacles[i];
    o.z = G.dist - o.s;
    if (o.object3d) o.object3d.position.z = o.z;
    if (!live) { if (o.z > cfg.obstacleDespawnZ) removeEntity(obstacles, i); continue; }
    const pad = o.zLen / 2 + cfg.hitPad;
    const inZone = Math.abs(o.z) <= pad;
    if (inZone){
      const mine = o.lanes.includes(G.lane);
      if (!o.entered){
        o.entered = true;
        // (a) полоса покинута < 280 мс назад; (c) подкат начат < 150 мс назад
        if (!mine && laneLeft >= 0 && o.lanes.includes(laneLeft) && G.runT - laneChangeT < NM.laneWindow) o.near = "lane";
        if (mine && o.kind === "slide" && G.sliding > 0 && G.runT - slideStartT < NM.slideWindow) o.near = "slide";
      }
      if (mine){ o.inLane = true; if (G.py < o.minPy) o.minPy = G.py; }
    }
    if (!o.passed && o.z > pad){
      o.passed = true;
      if (!o.touched){
        stats.passed[o.kind]++;
        if (o.inLane){
          if (o.kind === "jump"){ if (o.minPy - cfg.jumpClear < NM.jumpMargin) o.near = o.near || "jump"; if (missions.track("jump")) comboAdd(cfg.combo.mission); }
          if (o.kind === "slide"){ if (missions.track("slide")) comboAdd(cfg.combo.mission); }
        }
        if (o.near && G.runT - G.nearMiss.t >= NM.cooldown) nearMiss(o, o.near);
      }
    }
    if (o.z > cfg.obstacleDespawnZ) removeEntity(obstacles, i);
  }
  const CP = cfg.coinPick;
  for (let i = coins.length - 1; i >= 0; i--){
    const c = coins[i];
    c.z = G.dist - c.s;
    if (c.object3d) c.object3d.position.z = c.z;
    if (live && Math.abs(c.z) < CP.z && Math.abs(c.x - G.x) < CP.x && Math.abs(c.y - (CP.yBase + G.py)) < CP.y){
      pickup(c, i);
      continue;
    }
    if (c.z > cfg.coinDespawnZ) removeEntity(coins, i);
  }
}

function pickup(c, i){
  G.energons++;
  G.bonusEnergons += G.mult - 1;
  let pts = cfg.combo.coin;
  if (c.arc){
    if (arcTrack.id !== c.arc){ arcTrack.id = c.arc; arcTrack.n = 0; }
    if (++arcTrack.n === c.arcN) pts += cfg.combo.arc;   // целая дуга
  }
  comboAdd(pts);
  missions.track("coin");
  postSpike(0.12, 400, true);
  bus.emit("pickup", c);
  if (i >= 0) removeEntity(coins, i);
}

function nearMiss(o, kind){
  const N = G.nearMiss;
  N.count++; N.kind = kind; N.t = G.runT; N.obstacle = o;
  o.near = kind;
  stats.nearMisses++;
  comboAdd(cfg.combo.near);
  addTrauma(cfg.TRAUMA.near);
  rig.kick("near");
  if (!G.reducedMotion) clock.nearT = 0;
  missions.track("near");
  bus.emit("nearmiss", o);
}

// ---------- КОЛЛИЗИИ ----------
function checkCollisions(){
  for (let i = 0; i < obstacles.length; i++){
    const o = obstacles[i];
    if (Math.abs(o.z) > (o.zLen/2 + cfg.hitPad)) continue;
    if (!o.lanes.includes(G.lane)) continue;
    if (o.kind === "jump" && G.py < cfg.jumpClear) return hit(o);
    if (o.kind === "slide" && !(G.sliding > 0) && G.py < cfg.slideTop) return hit(o);
    if (o.kind === "wall") return hit(o);
  }
}

// поимка: мир ещё едет в слоу-мо, без коллизий и подборов
function updateCatch(simDt, realDt){
  G.catchT += realDt;
  G.speed = damp(G.speed, 0, 1.5, simDt);
  G.dz = G.speed * simDt;
  G.dist += G.dz;
  G.runPhase += simDt * (7 + G.speed * 0.36);
  if (G.py > 0 || G.vy > 0){ G.vy -= G_UP * J.fallMul * simDt; G.py = Math.max(0, G.py + G.vy * simDt); if (G.py === 0) G.vy = 0; }
  moveEntities(false);
  if (G.catchT >= cfg.catchTime) gameOver();
}

// ---------- ТУТОРИАЛ (GAME-7) ----------
const TUT_TEXT = {
  touch: { lane: "Свайп вбок — сменить дорожку", jump: "Свайп вверх — прыжок", slide: "Свайп вниз — подкат" },
  keys:  { lane: "← → / A D — сменить дорожку", jump: "↑ / W / Пробел — прыжок", slide: "↓ / S — подкат" },
};
const tutS = { idx:0, phase:"", rampFrom:1, rampTo:1, rampT:1, rampDur:0.2, msgT:0, done:false, satisfied:false };
function tutEmit(n, phase, action, text){
  const T = G.tutorial;
  T.step = n; T.phase = phase; T.action = action;
  P_tut.n = n; P_tut.phase = phase; P_tut.action = action; P_tut.text = text || "";
  bus.emit("tutorial:step", P_tut);
  if (!hudHandles("tutorial")) tutDom(text, phase);
}
function tutorialBegin(on){
  G.tutorial.active = on;
  tutS.idx = 0; tutS.phase = ""; tutS.rampFrom = tutS.rampTo = 1; tutS.rampT = 1; tutS.done = false; tutS.satisfied = false;
  clock.tutScale = 1;
  document.body.classList.toggle("tut", on && !hudHandles("tutorial"));
  if (on){
    const st = director.state.tutorial.steps[0];
    tutEmit(st.n, "show", st.action, "");
  } else tutDom("", "");
}
function tutRamp(to, dur){ tutS.rampFrom = clock.tutScale; tutS.rampTo = to; tutS.rampT = 0; tutS.rampDur = dur; }
function tutorialInput(kind){
  if (!G.tutorial.active) return;
  const st = director.state.tutorial && director.state.tutorial.steps[tutS.idx];
  if (st && st.action === kind && !tutS.satisfied) tutS.satisfied = true;
}
function tutorialUpdate(realDt){
  const TT = cfg.tutorial;
  if (tutS.rampT < 1){
    tutS.rampT = Math.min(1, tutS.rampT + realDt / tutS.rampDur);
    clock.tutScale = lerp(tutS.rampFrom, tutS.rampTo, E.easeOutCubic(tutS.rampT));
  }
  if (tutS.msgT > 0){ tutS.msgT -= realDt; if (tutS.msgT <= 0 && tutS.phase === "success") tutDom("", ""); }
  const plan = director.state.tutorial;
  if (!plan) return;
  const st = plan.steps[tutS.idx];
  if (!st){
    if (G.dist >= plan.endS) finishTutorial(false);
    return;
  }
  const kindText = (G.inputKind === "touch" ? TUT_TEXT.touch : TUT_TEXT.keys)[st.action] || "";
  if (st.action === "free"){
    if (tutS.phase !== "free"){ tutS.phase = "free"; tutEmit(st.n, "free", "", ""); }
    tutS.idx++;
    return;
  }
  const pad = cfg.zLen[st.kind] / 2 + cfg.hitPad;
  const tth = (st.s - G.dist - pad) / Math.max(1, G.speed);
  // «верно» проверяем по состоянию, а не только по нажатию: вернулся в центр — снова подсказка
  let ok = tutS.satisfied;
  if (st.action === "lane") ok = G.lane !== 1;
  else if (st.action === "jump") ok = ok && (G.py > 0 || G.vy > 0);
  else if (st.action === "slide") ok = ok && (G.sliding > 0 || G.dive);
  if (!ok){
    if (tth <= TT.holdAt){
      if (tutS.phase !== "hold"){ tutS.phase = "hold"; tutRamp(0, 0.06); tutEmit(st.n, "hold", st.action, kindText); }
    } else if (tth <= TT.slowAt && tutS.phase !== "prompt" && tutS.phase !== "hold"){
      tutS.phase = "prompt"; tutRamp(TT.slowTo, TT.slowIn); tutEmit(st.n, "prompt", st.action, kindText);
    }
  } else if (tutS.phase !== "success" && tth > -pad){
    // и после подсказки, и «сделал заранее» — одинаковая похвала без подсказки
    tutS.phase = "success"; tutS.msgT = 0.8;
    tutRamp(1, TT.back);
    tutEmit(st.n, "success", st.action, "Отлично!");
  }
  // ряд пройден → следующий шаг
  if (G.dist - st.s > pad + 0.5){
    if (clock.tutScale < 1 && tutS.rampTo < 1) tutRamp(1, TT.back);
    tutS.idx++; tutS.phase = ""; tutS.satisfied = false;
    const nx = plan.steps[tutS.idx];
    if (nx) tutEmit(nx.n, "show", nx.action, "");
  }
}
function finishTutorial(skipped){
  if (!G.tutorial.active) return;
  G.tutorial.active = false;
  clock.tutScale = 1;
  try { localStorage.setItem(cfg.tutorial.key, "1"); } catch(e){}
  tutEmit(skipped ? 0 : 5, skipped ? "skip" : "done", "", skipped ? "" : "Разминка пройдена — дальше по-настоящему!");
  tutS.msgT = 2.0;
  setTimeout(() => { if (!G.tutorial.active){ tutDom("", ""); document.body.classList.remove("tut"); } }, skipped ? 0 : 2000);
}
function tutDom(text, phase){
  const el = $("tutText");
  if (!el) return;
  el.textContent = text || "";
  const box = $("tut");
  if (box){ box.dataset.phase = phase || ""; box.classList.toggle("show", !!text); }
}
function hudHandles(k){ const r = plugins.hud; return !!(r && r.api && r.api.handles && r.api.handles[k]); }

// ---------- КАМЕРА ----------
const rig = createCameraRig({ THREE, camera, cfg, G, getCurve: () => ctx.look.curve });
bus.on("boost", on => rig.kick("boost", on ? true : false));
bus.on("tunnel:enter", () => { G.tunnel = 1; rig.kick("tunIn", true); });
bus.on("tunnel:exit", () => { G.tunnel = 0; rig.kick("tunIn", false); rig.kick("tunOut"); });

function updateLights(){
  const S = LIGHT.sun;
  // цель тени следует за Ризи, снап к текселю карты теней — без мерцания краёв
  const tx = Math.round(G.x / shadowTexel) * shadowTexel;
  sun.target.position.set(tx, 0, S.targetZ);
  sun.position.set(tx + SUN_DIR.x * S.dist, SUN_DIR.y * S.dist, S.targetZ + SUN_DIR.z * S.dist);
  const F = LIGHT.fill;
  fill.target.position.set(G.x, 1, -6);
  fill.position.set(G.x + FILL_DIR.x * F.dist, 1 + FILL_DIR.y * F.dist, -6 + FILL_DIR.z * F.dist);
}

// ---------- СИГНАЛЫ (2.0) ----------
function updateSignals(realDt){
  const active = G.mode === "play" || G.mode === "catch" || G.mode === "countdown";
  const I = active ? curI() : 0;
  G.intensity = damp(G.intensity, I, 2, realDt);                       // tau 0.5 с
  const dT = clamp(G.swarmNear / cfg.swarmTime, 0, 1);
  G.danger = damp(G.danger, dT, dT > G.danger ? 10 : 1 / 0.6, realDt); // атака 0.1 с, спад 0.6 с
  G.trauma = Math.max(0, G.trauma - cfg.TRAUMA.decay * realDt);
  G.shake = G.reducedMotion ? 0 : G.trauma * G.trauma;
  if (G.mode === "over") G.overT += realDt;
}

// ---------- LOOK: окружение, изгиб, пост ----------
const postBase = { bloom:0, saturation:1, vignette:0 };
const postMood = { over:0, spike:0, spikeT:0, pickSum:0, flash:0, flashT:0 };
const postSig = { intensity:0, danger:0, reducedMotion:false, over:false };
const flashTimes = [-9, -9, -9];
function flashAllowed(){
  // полноэкранные вспышки не чаще 3 в секунду (HUD-8)
  const now = ctx.time.t;
  let oldest = 0;
  for (let i = 1; i < 3; i++) if (flashTimes[i] < flashTimes[oldest]) oldest = i;
  if (now - flashTimes[oldest] < 1) return false;
  flashTimes[oldest] = now;
  return true;
}
function postFlash(color, ms){
  const post = ctx.look.post;
  if (!post || !flashAllowed()) return;
  if (typeof post.hit === "function" && color === cfg.BRAND.danger){ try { post.hit(); } catch(e){ console.error("[look] post.hit", e); } }
  else if (typeof post.flash === "function"){ try { post.flash(color, ms); } catch(e){ console.error("[look] post.flash", e); } }
  else { postMood.flash = 1; postMood.flashT = ms / 1000; }
}
function postSpike(amount, ms, isPickup){
  const post = ctx.look.post;
  if (!post) return;
  // сумма всплесков от подборов не больше +0.3
  if (isPickup){ if (postMood.pickSum + amount > 0.3) return; postMood.pickSum += amount; }
  if (typeof post.bloomSpike === "function"){ try { post.bloomSpike(amount, ms); } catch(e){ console.error("[look] post.bloomSpike", e); } }
  else postMood.spike = Math.min(0.5, postMood.spike + amount);
}
function drivePost(realDt){
  const post = ctx.look.post;
  postMood.pickSum = Math.max(0, postMood.pickSum - realDt * 0.75);
  if (!post) return;
  const RM = G.reducedMotion;
  postMood.over = damp(postMood.over, G.mode === "over" || G.mode === "catch" ? 1 : 0, 6, realDt);
  const P = post.params;
  if (typeof post.setSignals === "function"){
    postSig.intensity = G.intensity; postSig.danger = G.danger;
    postSig.reducedMotion = RM; postSig.over = G.mode === "over" || G.mode === "catch";
    try { post.setSignals(postSig); } catch(e){ console.error("[look] post.setSignals", e); }
  } else if (P){
    // старый API: авто-режим поста выключаем и ведём параметры сами
    P.auto = false;
    const play = G.mode === "play";
    P.speedBlur = RM || !play ? 0 : clamp((G.speed - 20) / 10, 0, 1) * 0.75;
    postMood.flashT = Math.max(0, postMood.flashT - realDt);
    const fk = postMood.flashT > 0 ? E.easeOutQuad(postMood.flashT / 0.45) : 0;
    P.danger = clamp(G.danger + 0.45 * fk, 0, 1);
  }
  if (P){
    if (typeof post.bloomSpike !== "function"){
      postMood.spike = damp(postMood.spike, 0, 1 / 0.15, realDt);
      P.bloom = postBase.bloom + postMood.spike;
    }
    if (typeof post.setSignals !== "function"){   // новый пост сам ведёт настроение game over по сигналу over
      // game over: насыщенность → 0.35, виньетка → 0.5
      P.saturation = lerp(postBase.saturation, 0.35, postMood.over);
      P.vignette = lerp(postBase.vignette, Math.max(postBase.vignette, 0.5), postMood.over);
    }
  }
}

// Изгиб включается, только если world-плагин умеет изогнутый мир (api.curveReady или api.handles.curve):
// legacy-трасса — длинные несегментированные плоскости, под изгибом она целиком «уезжает» вбок из-под Ризи.
// ?curve=1 / ?curve=0 — принудительно. Пересчитывается после замены плагина.
function gateCurve(){
  const c = ctx.look.curve;
  if (!c) return;
  const w = plugins.world;
  const ready = !!(w && w.api && (w.api.curveReady || (w.api.handles && w.api.handles.curve)));
  const force = qp.get("curve");
  c.enabled = force === "1" ? true : force === "0" ? false : ready;
}
function lookPatch(o){
  const c = ctx.look.curve;
  if (c && o){ try { c.patch(o); } catch(e){ console.error("[look] curve.patch", e); } }
  return o;
}
ctx.look.patch = lookPatch;

function importLook(name){ return import(`./look/${name}.js${VER ? "?v=" + VER : ""}`); }
function withTimeout(p, ms, label){
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(label + ": не завершился за " + ms + " мс")), ms);
    Promise.resolve(p).then(v => { clearTimeout(t); res(v); }, e => { clearTimeout(t); rej(e); });
  });
}
// изгиб ставится ДО первой компиляции шейдеров (глобальный патч чанков), материалы — до плагинов
async function initLookEarly(){
  if (!LOOK_ON) return;
  const [mCurve, mMats, mTone] = await Promise.all([
    CURVE_ON ? importLook("curve").catch(e => { console.error("[look] curve.js не загрузился", e); return null; }) : null,
    importLook("materials").catch(e => { console.error("[look] materials.js не загрузился", e); return null; }),
    importLook("tonemap").catch(e => { console.error("[look] tonemap.js не загрузился", e); return null; }),
  ]);
  // PBR Neutral (LOOK-1): чанк CustomToneMapping подменён до первой компиляции; с постом кривая та же в финальном проходе
  if (mTone && typeof mTone.installNeutralToneMapping === "function"){
    try { mTone.installNeutralToneMapping(renderer, LIGHT.exposure); } catch(e){ console.error("[look] tonemap", e); }
  }
  if (mCurve && typeof mCurve.installCurve === "function"){
    try { ctx.look.curve = mCurve.installCurve(ctx); } catch(e){ console.error("[look] installCurve", e); ctx.look.curve = null; }
  }
  if (mMats && typeof mMats.createLook === "function"){
    try {
      const mats = await withTimeout(mMats.createLook(ctx), 45000, "createLook");
      ctx.look.mats = mats;
      if (mats && mats.env) scene.environment = mats.env;
    } catch(e){ console.error("[look] createLook", e); ctx.look.mats = null; }
  }
}
async function initLookLate(){
  if (ctx.look.curve){ lookPatch(scene); gateCurve(); }
  if (!POST_ON) return;
  try {
    const mPost = await importLook("post");
    const post = mPost.createPost(ctx);
    ctx.look.post = post;
    if (post && post.params){ postBase.bloom = post.params.bloom; postBase.saturation = post.params.saturation; postBase.vignette = post.params.vignette; }
    // пост может сам решать тонмаппинг/экспозицию (PBR Neutral в своём проходе)
    if (post && post.toneMapping !== undefined) renderer.toneMapping = post.toneMapping;
    if (post && typeof post.exposure === "number") renderer.toneMappingExposure = post.exposure;
    if (post && post.setSize) post.setSize(innerWidth, innerHeight);
  } catch(e){ console.error("[look] post.js", e); ctx.look.post = null; }
}

addEventListener("resize", () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth/innerHeight;
  camera.updateProjectionMatrix();
  if (ctx.look.post && ctx.look.post.setSize) ctx.look.post.setSize(innerWidth, innerHeight);
  else renderer.setPixelRatio(Math.min(devicePixelRatio, dprCap));
  bus.emit("resize", { w:innerWidth, h:innerHeight });
});
document.addEventListener("visibilitychange", () => {
  if (SHOT || ctx.simulating) return;
  if (document.hidden && G.mode === "play" && !G.paused) pause();
  else bus.emit("pause", document.hidden || G.paused);
});

// ---------- ПЛАГИНЫ ----------
const SLOTS = ["world", "player", "vfx", "swarm", "hud", "audio"];   // порядок установки = порядок update
const plugins = {};                       // slot → { slot, kind, api, pctx, scope, roots, errors, swapping }
const BREAK = qp.get("breakplugin");

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
    rec.api = (await withTimeout(def.install(pctx), 20000, `${kind}/${slot} install`)) || {};
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
  for (const e of obstacles){ if (e.object3d && e.object3d.parent) e.object3d.parent.remove(e.object3d); e.object3d = null; rec.scope.emitLocal("spawn:obstacle", e); lookPatch(e.object3d); }
  for (const e of coins){ if (e.object3d && e.object3d.parent) e.object3d.parent.remove(e.object3d); e.object3d = null; rec.scope.emitLocal("spawn:coin", e); lookPatch(e.object3d); }
}
async function swapToBase(rec){
  rec.swapping = true;
  teardown(rec);
  plugins[rec.slot] = null;
  if (rec.kind === "base"){ console.error(`[plugins] ${rec.slot}: base-плагин падает в update — слот отключён`); return; }
  console.error(`[plugins] ${rec.slot}: 3 ошибки update подряд → замена на base/${rec.slot}.js`);
  const nrec = await installBase(rec.slot);
  respawnEntities(nrec);
  lookPatch(scene);
  gateCurve();
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
// update(realDt, ctx, simDt): base-плагины со старой сигнатурой update(dt, ctx) получают realDt первым
function updatePlugins(realDt, simDt){
  for (let i=0;i<SLOTS.length;i++){
    const rec = plugins[SLOTS[i]];
    if (!rec || rec.swapping || !rec.api.update) continue;
    try { rec.api.update(realDt, rec.pctx, simDt); rec.errors = 0; }
    catch(e){
      rec.errors++;
      console.error(`[plugins] ${rec.slot}: ошибка update (${rec.errors} подряд)`, e);
      if (rec.errors >= 3) swapToBase(rec);
    }
  }
}
// мигание неуязвимости для плагинов, которые его сами не делают (base: rizy.g.visible)
function applyBlink(){
  const r = plugins.player;
  const g = r && r.api && r.api.rizy && r.api.rizy.g;
  if (g && !(r.api.handles && r.api.handles.blink)) g.visible = G.blinkOn;
}

// ---------- ЦИКЛ ----------
// один шаг: часы → геймплей (simDt) → сигналы → изгиб → плагины → камера → свет → пост. Рендер отдельно.
function step(realDt){
  const simDt = realDt * computeTimeScale(realDt);
  G.realDt = realDt; G.simDt = simDt;
  ctx.time.dt = realDt; ctx.time.t += realDt;
  ctx.time.simDt = simDt; ctx.time.simT += simDt;
  G.dz = 0;
  if (buf.slide >= 0) buf.slide -= realDt;
  if (G.mode === "play" && !G.paused) updateGame(simDt, realDt);
  else if (G.mode === "catch") updateCatch(simDt, realDt);
  else if (G.mode === "countdown") updateCountdown(realDt);
  updateSignals(realDt);
  if (ctx.look.curve) ctx.look.curve.update(realDt, G);
  updatePlugins(realDt, simDt);
  applyBlink();
  rig.update(realDt, ctx.time.t);
  updateLights();
  drivePost(realDt);
  P_frame.dt = realDt; P_frame.realDt = realDt; P_frame.simDt = simDt;
  bus.emit("frame", P_frame);
}
let postBroken = false;
// renderer.info копится за весь кадр (тени + сцена + проходы поста), иначе с постом видно только последний проход
renderer.info.autoReset = false;
const frameInfo = { calls:0, triangles:0, points:0, lines:0 };
function render(){
  renderer.info.reset();
  const post = ctx.look.post;
  let done = false;
  if (post && !postBroken){
    try { post.render(ctx.time.dt); done = true; }
    catch(e){ postBroken = true; console.error("[look] post.render упал — рендер без поста", e); }
  }
  if (!done) renderer.render(scene, camera);
  const r = renderer.info.render;
  frameInfo.calls = r.calls; frameInfo.triangles = r.triangles; frameInfo.points = r.points; frameInfo.lines = r.lines;
}

// адаптивное разрешение (LOOK-7): кадр > 20 мс дольше 2 с → dpr 1.25; возврат после 5 с под 14 мс
let dprCap = QC.dprMax, slowT = 0, fastT = 0;
function adaptDpr(ms, realDt){
  if (SHOT || ctx.look.post) return;          // у поста своё адаптивное разрешение (params.adaptiveDpr)
  if (ms > 20){ slowT += realDt; fastT = 0; } else if (ms < 14){ fastT += realDt; slowT = 0; } else { slowT = Math.max(0, slowT - realDt); }
  let want = dprCap;
  if (slowT > 2 && dprCap > 1.25) want = 1.25;
  if (fastT > 5 && dprCap < QC.dprMax) want = QC.dprMax;
  if (want === dprCap) return;
  dprCap = want; slowT = fastT = 0;
  renderer.setPixelRatio(Math.min(devicePixelRatio, want));
}

let lastT = performance.now(), looping = false, frozen = false, sweepT = 0;
// шаг не больше 1/60 (длинный кадр режется на подшаги), провал больше 0.35 с не догоняем
function frame(now){
  if (!looping || frozen) return;
  const ms = now - lastT;
  let elapsed = Math.min(0.35, ms/1000);
  lastT = now;
  adaptDpr(ms, elapsed);
  while (elapsed > 1e-6){
    const dt = Math.min(1/60, elapsed);
    step(dt);
    elapsed -= dt;
  }
  // страховка изгиба: объекты, добавленные в сцену мимо spawn-событий (patch идемпотентен, без аллокаций для известных)
  sweepT += ms;
  if (sweepT > 2000){ sweepT = 0; lookPatch(scene); }
  render();
}
function tickRAF(now){ frame(now); if (!frozen) requestAnimationFrame(tickRAF); }
// фоновые вкладки/headless могут не давать rAF — подстраховка таймером
setInterval(() => { const now = performance.now(); if (looping && !frozen && now-lastT > 60) frame(now); }, 50);

function crossfade(){
  const f = $("fade");
  if (!f) return;
  f.style.transition = "none"; f.style.opacity = "1";
  void f.offsetWidth;
  f.style.transition = `opacity ${cfg.CAM_SWOOP.fade}s ease-out`; f.style.opacity = "0";
}
function setText(id, s){ const el = $(id); if (el) el.textContent = s; }

// ---------- БОТЫ И sim ----------
const bots = createBots({ cfg, G, entities: ctx.entities, doAction, makeRng: U.makeRng });
// синхронный прогон забега шагом 1/60 без рендера; opts.seed — геймплейный сид (без перезагрузки страницы)
function sim(seconds = 30, bot = "idle", opts = {}){
  const sd = opts.seed !== undefined ? (opts.seed >>> 0) : SEED;
  if (sd !== null) grand = U.makeRng(sd ^ 0x5EED);   // тот же сид → та же трасса при каждом sim
  const act = bots.make(bot, sd);
  const wasSim = ctx.simulating;
  ctx.simulating = true;
  clock.shotForce = false; clock.freezeSim = false;
  startRun({ tutorial:false });
  const n = Math.round(seconds*60);
  let i = 0;
  for (; i<n && (G.mode === "play" || G.mode === "catch"); i++){ if (G.mode === "play") act(); step(1/60); }
  ctx.simulating = wasSim;
  lastT = performance.now();
  return {
    seed: sd, bot, seconds: Math.round(i / 60 * 10) / 10,
    dist: Math.round(G.dist*10)/10, speed: Math.round(G.speed*10)/10, energons: G.energons, bonus: G.bonusEnergons,
    hits: stats.hits, gameover: G.mode === "over" || G.mode === "catch",
    jumps: stats.jumps, slides: stats.slides, laneChanges: stats.laneChanges, nearMisses: stats.nearMisses,
    mult: G.mult, patterns: director.state.patterns,
    passed: { jump: stats.passed.jump, slide: stats.passed.slide, wall: stats.passed.wall },
    hitLog: stats.hitLog.slice(0, 10),
  };
}
function fairness(seeds = [1,2,3,4,5,6,7,8,9,10], seconds = 300){
  return seeds.map(s => { const r = sim(seconds, "perfect", { seed:s }); return { seed:s, hits:r.hits, dist:r.dist, seconds:r.seconds, energons:r.energons, hitLog:r.hitLog }; });
}

ctx.actions = {
  start: o => startRun(o), pause, resume, revive, toTitle,
  skipTutorial: () => finishTutorial(true),
  setSetting(k, v){
    settings[k] = v;
    try { localStorage.setItem(cfg.settingsKey, JSON.stringify(settings)); } catch(e){}
    G.reducedMotion = reducedMotionNow(); G.calm = !!settings.calm;
    bus.emit("settings", settings);
  },
};

window.RUN = { ctx, G, renderer, scene, camera, startRun, step, render, sim, fairness, plugins, doAction, stats, frameInfo,
  director, rig, actions: ctx.actions, get events(){ return readEvents(); }, readEvents };
if (qp.get("hideui") === "1") document.body.classList.add("hideui");
{ const skip = $("tutSkip"); if (skip) skip.addEventListener("click", ev => { ev.stopPropagation(); finishTutorial(true); }); }

// ---------- ЗАПУСК ----------
const ready = (async () => {
  await initLookEarly();
  await loadPlugins();
  // подписка ПОСЛЕ плагинов: плагин уже создал ent.object3d → гнём его
  bus.on("spawn:obstacle", e => lookPatch(e.object3d));
  bus.on("spawn:coin", e => lookPatch(e.object3d));
  await initLookLate();
  bus.emit("title");
  if (SHOT) return runShot();
  lastT = performance.now();
  looping = true;
  requestAnimationFrame(tickRAF);
})();
window.RUN.ready = ready;

// ?shot=1&at=N — автостарт, симуляция N секунд шагом 1/60 без смертей, заморозка, ОДИН рендер.
// &fx=hit|pickup|milestone|danger|nearmiss (через запятую) — событие перед кадром; &t=мс — сколько realDt
// прожить после события при timeScale 0 (тряска/вспышка/FOV-кик идут, мир стоит).
function runShot(){
  const at = qp.has("at") ? +qp.get("at") : 4;
  const lane = qp.has("lane") ? clamp(+qp.get("lane"), 0, 2) : null;
  const fx = (qp.get("fx") || "").split(",").filter(Boolean);
  const tms = qp.has("t") ? Math.max(0, +qp.get("t")) : 0;
  ctx.simulating = true;
  clock.shotForce = true;
  const n = Math.max(1, Math.round(at*60));
  if (qp.get("cam") === "title"){
    for (let i=0;i<n;i++) step(1/60);          // титульный экран: облёт заморожен в момент t = at
  } else {
    startRun({ tutorial:false });
    for (let i=0;i<n;i++){
      if (lane !== null && G.lane !== lane){ G.lane = lane; G.laneFrom = G.laneTo = G.x = LANES[lane]; G.laneT = 1; }
      G.grace = 99;                             // в фоторежиме не умираем
      step(1/60);
    }
    // grace остаётся 99 и в добивочных шагах (иначе ложный удар о ряд в зоне); fx=hit сам его сбрасывает
    if (qp.get("pose") === "jump"){ G.py = 1.2; G.vy = 0; }
    if (qp.get("pose") === "slide"){ G.sliding = 0.5; G.slideDur = 0.62; }
    for (const f of fx) stageFx(f);
  }
  clock.shotForce = false;
  clock.freezeSim = true;
  // живём только realDt: хит-стоп/тряска/кики/пост; мир и физика стоят
  const steps = Math.max(1, Math.round(tms / (1000/60)));
  const dt = tms > 0 ? tms / 1000 / steps : 1/60;
  for (let i=0;i<steps;i++) step(dt);
  render();
  frozen = true;
  clock.freezeSim = false;                    // кадр заморожен флагом frozen; RUN.sim после снимка должен идти
  ctx.simulating = false;
  document.title = "SHOT_READY";
}
function nearestAhead(list){
  let best = null;
  for (let i = 0; i < list.length; i++){ const e = list[i]; if (e.z < 0.5 && (!best || e.z > best.z)) best = e; }
  return best;
}
function stageFx(f){
  if (f === "hit"){
    const o = nearestAhead(obstacles) || { id:0, kind:"wall", lanes:[G.lane], z:-1, s:G.dist + 1, zLen:1.4, object3d:null, tier:1 };
    G.grace = 0; G.swarmNear = 0;
    hit(o);
    G.danger = Math.max(G.danger, 0.35);
  } else if (f === "pickup"){
    const c = nearestAhead(coins);
    if (c) pickup(c, coins.indexOf(c));
    else pickup({ id:0, lane:G.lane, x:G.x, y:0.95, z:0, s:G.dist, arc:0, arcN:0, object3d:null }, -1);
  } else if (f === "milestone"){
    milestone(Math.max(cfg.milestoneStep, Math.floor(G.dist / cfg.milestoneStep) * cfg.milestoneStep));
  } else if (f === "danger"){
    G.swarmNear = cfg.swarmTime; G.danger = 1;
    bus.emit("swarm:near");
  } else if (f === "nearmiss"){
    const o = nearestAhead(obstacles) || { id:0, kind:"wall", lanes:[(G.lane + 1) % 3], z:0, s:G.dist, zLen:1.4, object3d:null, tier:1 };
    G.nearMiss.t = -9;
    nearMiss(o, "lane");
  }
}
