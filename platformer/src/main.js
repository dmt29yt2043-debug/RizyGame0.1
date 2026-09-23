// РИЗИ · Кристальный путь — 2.5D-платформер. Бутстрап, фиксированный шаг 1/120, игровая логика
// (кристаллы, Гасители, факелы, сердечки, победа), камера, звук и «сок», фоторежим, window.PLAT.
// Физика — src/physics.js, уровень — src/level.js, проверка проходимости — src/check.js (+ tools/check.mjs).
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { PHYS, GAME, CAM, QUALITY } from "./config.js";
import { LEVEL, buildWorld, setMovers, enemyPos } from "./level.js";
import { createPlayer, stepPlayer, groundAt } from "./physics.js";
import { checkLevel, formatReport } from "./check.js";
import { createRizy } from "./rizy.js";
import { createSky, createBackdrop } from "./look/sky.js";
import { buildWalls, placeMovers } from "./look/walls.js";
import { createCrystals, createHeart } from "./look/crystals.js";
import { createEnemies, ENEMY_R } from "./look/enemies.js";
import { createTorches, createSigns, createBlobs } from "./look/props.js";
import { createFx } from "./look/fx.js";
import { createPost } from "./look/post.js";
import { createGhosts } from "./look/ghosts.js";
import { glowTexture, blobTexture, feltTexture, makeRng } from "./look/tex.js";
import { createAudio } from "./audio.js";
import { createInput } from "./input.js";
import { createHud, fmtTime } from "./hud.js";

window.PLAT_BOOT = true;                 // модуль загрузился (сторож в index.html)
const qp = new URLSearchParams(location.search);
const SHOT = qp.get("shot") === "1";
const QNAME = ["low", "med", "high"].includes(qp.get("q")) ? qp.get("q") : "med";
const QC = QUALITY[QNAME];
const DT = PHYS.dt;
const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
if (qp.get("hideui") === "1") document.body.classList.add("hideui");

// шрифт нужен табличкам в мире (рисуются в canvas) — ждём, но не дольше 1.5 с
try { await Promise.race([document.fonts.load('900 40px "RizyNunito"'), new Promise(r => setTimeout(r, 1500))]); } catch (e){}

// ---------- РЕНДЕР ----------
const renderer = new THREE.WebGLRenderer({ antialias: !QC.post, powerPreference: "high-performance", preserveDrawingBuffer: SHOT });
const DPR = Math.min(devicePixelRatio || 1, QC.dprMax);
renderer.setPixelRatio(DPR);
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;       // пастель как задумано; яркое сверх 1 уходит в bloom
renderer.info.autoReset = false;
renderer.shadowMap.enabled = !!QC.shadows;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
$("wrap").prepend(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(CAM.fov, innerWidth / innerHeight, 0.5, 1400);
scene.add(camera);

// ---------- СВЕТ ----------
const hemi = new THREE.HemisphereLight(0xfff2f2, 0xcdb7e6, 1.95);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff0dc, 1.75);
sun.position.set(7, 11, 9);
scene.add(sun, sun.target);
if (QC.shadows){
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  const sc = sun.shadow.camera; sc.left = -9; sc.right = 9; sc.top = 9; sc.bottom = -9; sc.near = 1; sc.far = 40;
  sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.02;
}
// окружение для бликов на кристаллах (только их материалам)
const pmrem = new THREE.PMREMGenerator(renderer);
const envTex = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
pmrem.dispose();

// ---------- МИР ----------
const world = buildWorld(LEVEL);
const glowTex = glowTexture(), blobTex = blobTexture(), feltTex = feltTexture(renderer);
const bloomOn = QC.post && QC.bloom > 0;

const sky = createSky(camera);
const backdrop = createBackdrop(LEVEL);
scene.add(backdrop.group);
const walls = buildWalls(LEVEL, renderer);
scene.add(walls.group);
if (QC.shadows) walls.group.traverse(o => { if (o.isMesh) o.receiveShadow = true; });

const torchGround = LEVEL.torches.map(t => groundAt(world, t.x));
const signGround = LEVEL.signs.map(s => groundAt(world, s.x));
const heartGround = groundAt(world, LEVEL.heart.x);
const crystals = createCrystals(LEVEL, { glowTex, env: envTex, halos: QC.halos, bloom: bloomOn });
scene.add(crystals.group);
const heart = createHeart(LEVEL, heartGround, { glowTex, env: envTex, bloom: bloomOn });
scene.add(heart.group);
const enemies = createEnemies(LEVEL, { feltTex, glowTex, bloom: bloomOn });
scene.add(enemies.group);
if (QC.shadows) enemies.group.traverse(o => { if (o.isMesh) o.castShadow = true; });
const torches = createTorches(LEVEL, torchGround, { glowTex, bloom: bloomOn });
scene.add(torches.group);
scene.add(createSigns(LEVEL, signGround, renderer));
const blobs = createBlobs(1 + LEVEL.enemies.length, blobTex);
scene.add(blobs.mesh);
const fx = createFx(QC.particles);
scene.add(fx.group);
const ghosts = createGhosts(4);
scene.add(ghosts.group);
let ghostT = 0, ghostPending = false;

// ---------- РИЗИ ----------
const rizy = createRizy({ quality: QNAME });
scene.add(rizy.root);
if (QC.shadows) rizy.root.traverse(o => { if (o.isMesh) o.castShadow = true; });

// ---------- ПОСТ ----------
const post = QC.post ? createPost(renderer, scene, camera, { bloom: QC.bloom, samples: 4 }) : null;

// ---------- СОСТОЯНИЕ ----------
const G = {
  mode: "title",            // title | play | over | win
  paused: false,
  time: 0,                  // время мира (враги, платформы, анимации); стоит на паузе
  playT: 0,                 // таймер забега
  hearts: GAME.hearts,
  crystals: 0,
  stars: LEVEL.stars.map(() => false),
  checkpoint: { x: LEVEL.start.x, y: LEVEL.start.y, idx: 0 },
  combo: 0, lastCrystalT: -9,
  dying: 0, won: false, winT: 0,
  hitstop: 0, shake: 0, flash: 0, flashCol: [1, 1, 1],
  fadeT: 0,
  section: -1,
  best: loadBest(),
  record: false,
};
let player = createPlayer(LEVEL.start.x, LEVEL.start.y);
const inp = { left: false, right: false, jump: false, jumpPressed: false, dashPressed: false };
const stepEv = [];
const frameEv = [];

function loadBest(){ try { return JSON.parse(localStorage.getItem(GAME.bestKey) || "null"); } catch (e){ return null; } }
function saveBest(b){ if (SHOT) return; try { localStorage.setItem(GAME.bestKey, JSON.stringify(b)); } catch (e){} }
const bestText = b => b ? `Лучшее: ${fmtTime(b.time)} · кристаллы ${b.crystals}/${LEVEL.crystals.length} · звёздные ${b.stars}/${LEVEL.stars.length}` : "";

// ---------- ЗВУК, HUD, ВВОД ----------
const audio = createAudio();
const hud = createHud({ root: $("wrap"), totalCrystals: LEVEL.crystals.length, totalStars: LEVEL.stars.length, hearts: GAME.hearts, onCommand });
hud.setVolume(audio.volume);
hud.setBest(bestText(G.best));
const input = createInput({ onAction, menuOpen: () => G.paused || G.mode !== "play" });
for (const [k, b] of Object.entries(hud.touchButtons)) input.bindTouchButton(b, k);
if (matchMedia && matchMedia("(pointer: coarse)").matches && !matchMedia("(pointer: fine)").matches) hud.touchMode(true);

function onCommand(cmd, arg){
  audio.unlock();
  if (cmd !== "volume") audio.play("click");
  if (cmd === "play") startGame();
  else if (cmd === "pause") { if (G.mode === "play") setPause(!G.paused); }
  else if (cmd === "resume") setPause(false);
  else if (cmd === "retry") { setPause(false); respawn(false); }
  else if (cmd === "restart") { setPause(false); restartLevel(); }
  else if (cmd === "continue") continueFromCheckpoint();
  else if (cmd === "again") restartLevel();
  else if (cmd === "volume") audio.setVolume(arg);
}

function onAction(a, down){
  if (down && a !== "blur") audio.unlock();
  if (a === "blur"){ if (G.mode === "play" && !G.paused && !SHOT) setPause(true); return; }
  if (a === "touchmode"){ hud.touchMode(true); return; }
  if (a === "pause"){ if (down && G.mode === "play") setPause(!G.paused); return; }
  if (G.mode === "title"){ if (down && (a === "enter" || a === "jump" || a === "click")) startGame(); return; }
  if (G.paused){
    if (!down) return;
    if (a === "up") hud.menuMove(-1);
    else if (a === "down") hud.menuMove(1);
    else if (a === "left" || a === "right") hud.menuSide(a === "left" ? -1 : 1);
    else if (a === "enter" || a === "jump") hud.activate();
    else if (a === "retry") onCommand("retry");
    return;
  }
  if (G.mode === "over"){ if (down && (a === "enter" || a === "jump" || a === "retry" || a === "click")) continueFromCheckpoint(); return; }
  if (G.mode === "win"){ if (down && G.winT < -0.6 && (a === "enter" || a === "jump" || a === "retry" || a === "click")) restartLevel(); return; }
  // игра: фронты нажатий (зажатое читается в шаге из input.isHeld)
  if (a === "jump" && down) inp.jumpPressed = true;
  if (a === "dash" && down) inp.dashPressed = true;
  if (a === "retry" && down && G.dying <= 0) respawn(false);   // пока героиня «падает без сил» — R не спасает
}

// ---------- ПЕРЕХОДЫ СОСТОЯНИЙ ----------
function startGame(){
  if (G.mode !== "title") return;
  G.mode = "play";
  hud.show(null);
  audio.play("start");
  audio.music(true);
  enterSection(0);
}
function setPause(on){
  if (G.mode !== "play" || G.paused === on) return;
  G.paused = on;
  hud.show(on ? "pause" : null);
  audio.duck(on);
  if (on) inp.jumpPressed = inp.dashPressed = false;
}
function resetPlayerAt(x, y){
  player = createPlayer(x, y);
  player.px = x; player.py = y;
  player.facing = 1;
  inp.jumpPressed = inp.dashPressed = false;
}
// на факел: penalty — после падения (неуязвимость и шторка)
function respawn(penalty){
  if (G.mode !== "play" || G.won) return;
  const c = G.checkpoint;
  resetPlayerAt(c.x + 0.7, c.y);
  if (penalty) player.invuln = PHYS.invuln;
  G.dying = 0;
  G.fadeT = GAME.respawnFade;
  cam.snap = true;
  fx.clear(); ghosts.clear();
  frameEv.length = 0;
}
function continueFromCheckpoint(){
  G.mode = "play"; G.hearts = GAME.hearts; G.dying = 0;
  hud.show(null);
  respawn(false);
  audio.music(true);
}
function restartLevel(){
  G.mode = "play"; G.paused = false; G.won = false; G.winT = 0; G.dying = 0;
  G.hearts = GAME.hearts; G.crystals = 0; G.stars = LEVEL.stars.map(() => false);
  G.playT = 0; G.combo = 0; G.lastCrystalT = -9; G.section = -1; G.record = false;
  G.checkpoint = { x: LEVEL.start.x, y: LEVEL.start.y, idx: 0 };
  crystals.reset(); enemies.reset(); torches.reset(); heart.reset();
  resetPlayerAt(LEVEL.start.x, LEVEL.start.y);
  G.fadeT = GAME.respawnFade; cam.snap = true;
  fx.clear(); ghosts.clear();
  hud.show(null);
  audio.music(true);
  enterSection(0);
}
function gameOver(){
  G.mode = "over";
  hud.show("over");
  audio.play("over");
  audio.music(false);
}
function enterSection(i){
  if (i <= G.section) return;
  G.section = i;
  if (!SHOT) hud.banner(`УЧАСТОК ${i + 1} ИЗ ${LEVEL.sections.length}`, LEVEL.sections[i].name);
}

// ---------- ШАГ СИМУЛЯЦИИ ----------
function simStep(dt){
  if (G.paused) return;
  if (G.hitstop > 0){ G.hitstop -= dt; return; }
  G.time += dt;
  setMovers(world, G.time);
  const p = player;
  const playing = G.mode === "play" && !G.won && G.dying <= 0;
  if (G.mode === "play"){
    if (playing) G.playT += dt;
    inp.left = playing && input.isHeld("left");
    inp.right = playing && input.isHeld("right");
    inp.jump = playing && input.isHeld("jump");
    if (!playing){ inp.jumpPressed = inp.dashPressed = false; }
    stepEv.length = 0;
    stepPlayer(p, inp, dt, world, stepEv);
    for (const e of stepEv) onPlayerEvent(e);
    if (playing) interactions();
    else if (p.y < PHYS.killY) { p.y = PHYS.killY; p.vy = 0; }
    if (G.won){ G.winT -= dt; if (G.winT <= 0 && G.mode === "play") showWin(); }
    if (G.dying > 0){ G.dying -= dt; if (G.dying <= 0) gameOver(); }
  } else if (G.mode === "win"){
    G.winT -= dt;
    inp.left = inp.right = inp.jump = false;
    stepEv.length = 0; stepPlayer(p, inp, dt, world, stepEv);
  } else {
    // титул / «ещё раз»: героиня стоит
    inp.left = inp.right = inp.jump = false; inp.jumpPressed = inp.dashPressed = false;
    stepEv.length = 0; stepPlayer(p, inp, dt, world, stepEv);
  }
}

function onPlayerEvent(e){
  const p = player;
  frameEv.push(e);
  if (e === "jump"){ audio.play("jump"); fx.dust(p.x, p.y, 7, 0.8, -p.vx * 0.1); }
  else if (e === "djump"){ audio.play("djump"); fx.ring(p.x, p.y + 0.2); }
  else if (e === "dash"){ audio.play("dash"); fx.dashStart(p.x, p.y, p.dashDir); G.shake = Math.max(G.shake, 0.06); ghostPending = true; }
  else if (e === "land"){
    const fall = p.fallFrom - p.y;
    const hard = Math.min(1, Math.max(0, -(p.landVy || 0)) / 16);
    if (p.airT > 0.12 || fall > 0.4){ audio.play("land"); fx.dust(p.x, p.y, 6 + Math.round(hard * 8), 1 + hard); }
  }
}

function interactions(){
  const p = player;
  const hw = PHYS.w * 0.5;
  // кристаллы
  for (let i = 0; i < LEVEL.crystals.length; i++){
    const s = crystals.state[i]; if (s.got) continue;
    const c = LEVEL.crystals[i];
    if (Math.abs(c.x - p.x) < hw + 0.3 && c.y > p.y - 0.3 && c.y < p.y + PHYS.h + 0.3) collectCrystal(i);
  }
  for (let i = 0; i < LEVEL.stars.length; i++){
    const s = crystals.sstate[i]; if (s.got) continue;
    const c = LEVEL.stars[i];
    if (Math.abs(c.x - p.x) < hw + 0.55 && c.y > p.y - 0.55 && c.y < p.y + PHYS.h + 0.55) collectStar(i);
  }
  // Гасители
  for (let i = 0; i < LEVEL.enemies.length; i++){
    const st = enemies.state[i]; if (!st.alive) continue;
    const e = enemyPos(LEVEL.enemies[i], G.time);
    const r = ENEMY_R;
    if (Math.abs(e.x - p.x) < hw + r * 0.85 && e.y + r * 0.85 > p.y && e.y - r * 0.85 < p.y + PHYS.h){
      if (p.vy < 0 && p.py >= e.y - 0.05 && p.dashT <= 0) stomp(i, e);
      else if (p.invuln <= 0) hurt(e.x);
    }
  }
  // факелы
  for (let i = 0; i < LEVEL.torches.length; i++){
    const s = torches.state[i], t = LEVEL.torches[i];
    if (!s.lit && p.x >= t.x - 0.5 && Math.abs(p.y - torchGround[i]) < 3){
      s.lit = true; s.t = G.time;
      if (t.x > G.checkpoint.x) G.checkpoint = { x: t.x, y: torchGround[i], idx: i };
      audio.play("checkpoint");
      fx.fire(t.x, torchGround[i] + 1.7);
      if (!SHOT) hud.toast("Факел зажжён — здесь начнёшь снова");
    }
  }
  // участки
  for (let i = LEVEL.sections.length - 1; i > 0; i--) if (p.x >= LEVEL.sections[i].x0){ enterSection(i); break; }
  // Кристальное сердце
  if (Math.abs(p.x - LEVEL.heart.x) < 1.35 && p.y >= heartGround - 0.2 && p.y < heartGround + 3.5) win();
  // пропасть
  if (p.y < PHYS.killY) fall();
}

function collectCrystal(i){
  const c = LEVEL.crystals[i], s = crystals.state[i];
  s.got = true; s.t = G.time;
  G.crystals++;
  G.combo = (G.time - G.lastCrystalT < GAME.comboWindow) ? G.combo + 1 : 0;
  G.lastCrystalT = G.time;
  audio.play("crystal", G.combo);
  fx.burst(c.x, c.y, [0x3fe6d4, 0x5cb6ff, 0xff86cf][c.c % 3], 12);
  frameEv.push("collect");
}
function collectStar(i){
  const c = LEVEL.stars[i], s = crystals.sstate[i];
  s.got = true; s.t = G.time;
  G.stars[i] = true;
  audio.play("star");
  fx.burst(c.x, c.y, 0xd8ff4a, 26, true);
  fx.ring(c.x, c.y, 0xf4ffc4, 18);
  if (!SHOT) hud.toast(`Звёздный кристалл! ${G.stars.filter(Boolean).length} из ${LEVEL.stars.length}`);
  frameEv.push("collect");
  G.shake = Math.max(G.shake, 0.12);
}
function stomp(i, e){
  const p = player, st = enemies.state[i];
  st.alive = false; st.deadT = G.time; st.x = e.x; st.y = e.y;
  p.vy = inp.jump ? PHYS.stompVHeld : PHYS.stompV;
  p.jumping = true; p.canDouble = true; p.airDash = true; p.grounded = false; p.ground = null;
  p.y = Math.max(p.y, e.y + ENEMY_R * 0.2);
  audio.play("stomp");
  fx.felt(e.x, e.y);
  frameEv.push("jump");
  G.hitstop = 0.045; G.shake = Math.max(G.shake, 0.16);
}
function hurt(fromX){
  const p = player;
  G.hearts = Math.max(0, G.hearts - 1);
  p.invuln = PHYS.invuln; p.lock = PHYS.hurtLock;
  const dir = Math.sign(p.x - fromX) || -p.facing;
  p.vx = dir * PHYS.hurtKnockX; p.vy = PHYS.hurtKnockY; p.dashT = 0; p.grounded = false; p.ground = null; p.jumping = false;
  audio.play("hurt");
  fx.hurt(p.x, p.y + 0.9);
  frameEv.push("hurt");
  G.shake = 0.38; G.flash = 0.35; G.flashCol = [1, 0.35, 0.45];
  G.hitstop = 0.06;
  if (G.hearts <= 0){ G.dying = GAME.overDelay; audio.music(false); }
}
function fall(){
  G.hearts = Math.max(0, G.hearts - 1);
  audio.play("fall");
  frameEv.push("hurt");
  if (G.hearts <= 0){ gameOver(); G.fadeT = GAME.respawnFade; return; }
  respawn(true);
}
function win(){
  if (G.won) return;
  G.won = true; G.winT = GAME.winDelay;
  heart.win();
  audio.play("win");
  audio.music(false);
  fx.confetti(LEVEL.heart.x, heartGround + LEVEL.heart.pedestal + 1.2);
  frameEv.push("win");
  G.flash = 0.5; G.flashCol = [1, 0.95, 1];
  // лучший результат
  const stars = G.stars.filter(Boolean).length;
  const b = G.best;
  const better = !b || G.playT < b.time;
  G.record = better && !SHOT;
  const nb = { time: better ? G.playT : b.time, crystals: Math.max(G.crystals, b ? b.crystals : 0), stars: Math.max(stars, b ? b.stars : 0) };
  G.best = nb; saveBest(nb);
  hud.setBest(bestText(nb));
}
function showWin(){
  G.mode = "win"; G.winT = 0;
  hud.win({ crystals: G.crystals, total: LEVEL.crystals.length, stars: G.stars, time: G.playT, best: bestText(G.best), record: G.record });
  hud.show("win");
}

// ---------- КАМЕРА ----------
const cam = { x: LEVEL.start.x + 2, y: LEVEL.start.y, ty: LEVEL.start.y, lead: CAM.lead * 0.6, snap: true };
function updateCamera(dt, px, py){
  const p = player;
  const moving = Math.abs(p.vx) > 0.6;
  cam.lead = damp(cam.lead, p.facing * CAM.lead * (moving ? 1 : 0.55), CAM.leadRate, dt);
  const half = CAM.dist * Math.tan(THREE.MathUtils.degToRad(CAM.fov / 2)) * camera.aspect;
  // на титуле кадр смещён: героиня слева, карточка справа
  const titleShift = G.mode === "title" && innerWidth >= 900 ? half * 0.42 : 0;
  const tx = clamp(px + cam.lead + titleShift, LEVEL.minX + half - 4.5, LEVEL.maxX - half + 4.5);
  if (p.grounded) cam.ty = py;
  else {
    if (py > cam.ty + CAM.deadUp) cam.ty = py - CAM.deadUp;
    if (py < cam.ty - CAM.deadDown) cam.ty = py + CAM.deadDown;
  }
  cam.ty = Math.max(cam.ty, -2);
  if (cam.snap){ cam.x = tx; cam.y = cam.ty; cam.snap = false; }
  else { cam.x = damp(cam.x, tx, CAM.followX, dt); cam.y = damp(cam.y, cam.ty, CAM.followY, dt); }
  G.shake = Math.max(0, G.shake - dt * 1.6);
  const s = G.shake * G.shake * 2.2;
  const sx = s * Math.sin(G.time * 71), sy = s * Math.sin(G.time * 59 + 1.3);
  camera.position.set(cam.x + sx, cam.y + CAM.height + sy, CAM.dist);
  camera.lookAt(cam.x + sx * 0.5, cam.y + CAM.lookUp + sy * 0.5, 0);
  // свет и тень следуют за кадром
  sun.target.position.set(cam.x, cam.y, 0);
  sun.position.set(cam.x + 7, cam.y + 11, 9);
}

// ---------- ВИЗУАЛ КАДРА ----------
const EV_PRI = ["win", "hurt", "dash", "djump", "jump", "land", "collect"];
const enemyPosBuf = LEVEL.enemies.map(() => ({ x: 0, y: 0, dir: 1 }));
const vrnd = makeRng(99);                 // свой ГСЧ для «декоративных» искр — фоторежим повторяем
function updateVisuals(dt, alpha){
  const p = player;
  const px = p.px + (p.x - p.px) * alpha, py = p.py + (p.y - p.py) * alpha;
  rizy.root.position.set(px, py, 0);
  const blink = p.invuln > 0 && G.mode === "play" && Math.floor(p.invuln * 14) % 2 === 0;
  rizy.root.visible = !blink;
  let ev = null;
  for (const k of EV_PRI) if (frameEv.includes(k)){ ev = k; break; }
  frameEv.length = 0;
  rizy.update(dt, { speed: Math.min(1, Math.abs(p.vx) / PHYS.maxRun), vy: p.vy, grounded: p.grounded, facing: p.facing, dashing: p.dashT > 0, event: ev, time: G.time });

  placeMovers(walls.moverMeshes, world, alpha);
  crystals.update(G.time);
  heart.update(G.time);
  torches.update(G.time);
  for (let i = 0; i < LEVEL.enemies.length; i++){ const e = enemyPos(LEVEL.enemies[i], G.time); enemyPosBuf[i].x = e.x; enemyPosBuf[i].y = e.y; enemyPosBuf[i].dir = e.dir; }
  enemies.update(G.time, enemyPosBuf);
  backdrop.update(G.time);

  // тени-пятна
  if (!QC.shadows && rizy.root.visible !== false){
    const gy = groundAt(world, px, py + 0.01);
    blobs.set(0, px, gy, py - gy, 0.6);
  } else blobs.hide(0);
  for (let i = 0; i < LEVEL.enemies.length; i++){
    const st = enemies.state[i];
    if (!st.alive && G.time - st.deadT > 0.3){ blobs.hide(1 + i); continue; }
    const e = enemyPosBuf[i];
    const gy = groundAt(world, e.x, e.y - ENEMY_R);
    blobs.set(1 + i, e.x, gy, e.y - ENEMY_R - gy, 0.5, 0.8);
  }
  blobs.commit();

  // шлейф рывка: силуэты (поза запекается после обновления модели в кадре рывка) и искорки
  if (ghostPending){ ghostPending = false; ghosts.start(rizy.root); ghostT = 0; }
  if (dt > 0 && p.dashT > 0){
    ghostT -= dt;
    if (ghostT <= 0){ ghosts.spawn(rizy.root, 0x7fc8ff); ghostT = 0.045; }
  }
  ghosts.update(dt);
  if (dt > 0){
    if (p.dashT > 0) fx.dashTrail(px, py, p.dashDir);
    if (vrnd() < dt * 6){
      for (let i = 0; i < LEVEL.torches.length; i++) if (torches.state[i].lit && Math.abs(LEVEL.torches[i].x - px) < 16) fx.ember(LEVEL.torches[i].x, torchGround[i] + 2.0);
    }
    if (vrnd() < dt * 5){
      for (let i = 0; i < LEVEL.stars.length; i++) if (!crystals.sstate[i].got && Math.abs(LEVEL.stars[i].x - px) < 16) fx.sparkle(LEVEL.stars[i].x, LEVEL.stars[i].y, 0xeaff9a);
    }
  }
  fx.update(dt, camera, renderer.domElement.height);
  updateCamera(dt, px, py);

  // вспышка и шторка
  G.flash = Math.max(0, G.flash - dt * 1.8);
  if (G.fadeT > 0){ G.fadeT -= dt; }
  hud.fade(G.fadeT > 0 ? Math.min(1, G.fadeT / GAME.respawnFade) * 0.9 : 0);
  if (post) post.flash(G.flashCol[0], G.flashCol[1], G.flashCol[2], G.flash * 0.35);
  hud.set({ crystals: G.crystals, stars: G.stars, hearts: G.hearts, time: G.playT });
}

function draw(){
  renderer.info.reset();
  if (post) post.render(1 / 60);
  else renderer.render(scene, camera);
}

// ---------- ЦИКЛ ----------
let last = performance.now(), acc = 0, looping = false;
function tick(now){
  if (!looping) return;
  requestAnimationFrame(tick);
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000)); last = now;
  if (!G.paused){
    acc += dt;
    let n = 0;
    while (acc >= DT && n < 14){ simStep(DT); acc -= DT; n++; }
    if (n >= 14) acc = 0;
  }
  updateVisuals(G.paused ? 0 : dt, G.paused ? 1 : acc / DT);
  hud.update(dt);
  audio.tick(dt);
  draw();
}

function onResize(){
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  sky.fit(camera.aspect);
  if (post) post.setSize(w, h, DPR);
  if (!looping && !SHOT) draw();
}
addEventListener("resize", onResize);
onResize();

// ---------- ФОТОРЕЖИМ ----------
// ?shot=1&at=СЕК[&x=ПОЗИЦИЯ][&script=R0-2,J0.4-0.8,D0.6][&title=1][&pause=1][&q=..][&hideui=1]
// script: L/R — бег влево/вправо, J — прыжок (зажат), D — рывок; «a-b» — удержание с a по b с, «a» — короткое нажатие.
function parseScript(s){
  const out = [];
  for (const part of (s || "").split(",").map(x => x.trim()).filter(Boolean)){
    const m = /^([LRJDU])\s*([\d.]+)(?:-([\d.]+))?$/i.exec(part);
    if (!m) continue;
    const t0 = +m[2], t1 = m[3] !== undefined ? +m[3] : t0 + 0.06;
    out.push({ a: { L: "left", R: "right", J: "jump", D: "dash", U: "up" }[m[1].toUpperCase()], t0, t1, on: false });
  }
  return out;
}
function teleport(x){
  const gy = groundAt(world, x);
  const y = Number.isFinite(gy) ? gy : 0;
  resetPlayerAt(x, y);
  // факелы позади считаются зажжёнными, участки — пройденными
  for (let i = 0; i < LEVEL.torches.length; i++) if (LEVEL.torches[i].x < x){ torches.state[i].lit = true; torches.state[i].t = G.time - 5; G.checkpoint = { x: LEVEL.torches[i].x, y: torchGround[i], idx: i }; }
  for (let i = 0; i < LEVEL.sections.length; i++) if (x >= LEVEL.sections[i].x0) G.section = i;
  cam.snap = true;
}
// прогнать sec секунд: физика 1/120, визуал 1/60, сценарий ввода
function simulate(sec, script){
  const steps = Math.round(sec / DT);
  for (let i = 0; i < steps; i++){
    const t = i * DT;
    for (const s of script){
      const on = t >= s.t0 && t < s.t1;
      if (on !== s.on){ s.on = on; input.press(s.a, on, "script:" + s.a); }
    }
    simStep(DT);
    if (i % 2 === 1) updateVisuals(DT * 2, 1);
  }
  for (const s of script) if (s.on){ s.on = false; input.press(s.a, false, "script:" + s.a); }
  updateVisuals(0, 1);
}

async function runShot(){
  fx.seed(7);
  const at = qp.has("at") ? +qp.get("at") : 0;
  if (qp.get("title") === "1"){
    hud.show("title");
    simulate(at, []);
    draw();
    document.title = "SHOT_READY";
    return;
  }
  hud.show(null);
  G.mode = "play";
  G.section = 0;
  if (qp.has("x")) teleport(+qp.get("x"));
  simulate(at, parseScript(qp.get("script")));
  if (qp.get("pause") === "1") setPause(true);
  if (G.mode === "play" && G.won && qp.get("winscreen") === "1"){ simulate(GAME.winDelay + 0.1, []); }
  draw();
  document.title = "SHOT_READY";
}

// ---------- ОТЛАДКА: window.PLAT ----------
window.PLAT = {
  G, level: LEVEL, world, quality: QNAME,
  get player(){ return player; },
  enemies: enemies.state, crystals: crystals.state, torches: torches.state,
  step(sec = DT){ simulate(sec, []); },
  sim(sec, script){ simulate(sec, parseScript(script)); return { x: player.x, y: player.y, mode: G.mode, hearts: G.hearts, crystals: G.crystals }; },
  render(){ draw(); return renderer.info.render.calls; },
  reset: () => restartLevel(),
  start: () => startGame(),
  pause: on => setPause(on === undefined ? !G.paused : !!on),
  press: (action, down = true) => input.press(action, down, "api"),
  teleport,
  check(){ const r = checkLevel(LEVEL); return formatReport(r); },
  // draw calls: сцена отдельно и весь кадр с постом
  drawCalls(){
    renderer.info.reset(); renderer.render(scene, camera);
    const sceneCalls = renderer.info.render.calls, tris = renderer.info.render.triangles;
    draw();
    return { scene: sceneCalls, frame: renderer.info.render.calls, triangles: tris, quality: QNAME, post: !!post };
  },
  renderer, scene, camera, audio, hud,
};

// ---------- СТАРТ ----------
hud.show("title");
cam.snap = true;
updateVisuals(0, 1);
if (SHOT) await runShot();
else {
  document.title = "Ризи · Кристальный путь";
  looping = true;
  last = performance.now();
  requestAnimationFrame(tick);
}
