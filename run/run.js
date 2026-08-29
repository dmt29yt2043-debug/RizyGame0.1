// РИЗИ RUN: Неоновая река — 3D-раннер в мире «Побега из Идеалити».
// Three.js, три полосы, прыжок/подкат, рой Гасителей за спиной.

import * as THREE from "./three.module.js";

// ---------- БАЗА ----------
const $ = id => document.getElementById(id);
const clamp = (v,a,b) => Math.max(a, Math.min(b, v));
const lerp = (a,b,t) => a + (b-a)*t;
const rnd = (a,b) => a + Math.random()*(b-a);
const pick = arr => arr[Math.floor(Math.random()*arr.length)];

const COL = {
  ink:0x070d36, blue:0x0536d4, lime:0xC0FF3F, pink:0xff7ec1, cyan:0x7ef0ff,
  skin:0x56b7e6, hair:0xcdf24b, jeans:0x1e63e0, dark:0x0a0e2e,
};

const renderer = new THREE.WebGLRenderer({ antialias:true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
$("wrap").prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0c2c);
scene.fog = new THREE.Fog(0x0a0c2c, 26, 125);

const camera = new THREE.PerspectiveCamera(62, innerWidth/innerHeight, 0.1, 300);
const CAM_BASE = { x:0, y:4.15, z:7.3 };
camera.position.set(CAM_BASE.x, CAM_BASE.y, CAM_BASE.z);
camera.lookAt(0, 1.5, -9);

addEventListener("resize", () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth/innerHeight;
  camera.updateProjectionMatrix();
});

// свет: холодная луна + тёплая подсветка + неоновые акценты
scene.add(new THREE.HemisphereLight(0x8899ff, 0x0a0c2c, 0.75));
const moon = new THREE.DirectionalLight(0xbfd4ff, 1.15);
moon.position.set(-6, 14, -4);
scene.add(moon);
const warm = new THREE.PointLight(0xffb46b, 0.55, 40);
warm.position.set(3, 6, 2);
scene.add(warm);

// ---------- ТЕКСТУРЫ ИЗ CANVAS ----------
function canvasTex(w, h, draw){
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
// окна небоскрёбов
function windowsTex(base, lit){
  return canvasTex(128, 256, (g,w,h) => {
    g.fillStyle = base; g.fillRect(0,0,w,h);
    for (let y=8; y<h-8; y+=18)
      for (let x=8; x<w-8; x+=16){
        const on = Math.random() < 0.42;
        g.fillStyle = on ? pick(lit) : "rgba(255,255,255,.05)";
        g.fillRect(x, y, 9, 11);
      }
  });
}
// свитер с цветочками
const sweaterTex = canvasTex(128, 128, (g,w,h) => {
  g.fillStyle = "#101018"; g.fillRect(0,0,w,h);
  for (let i=0;i<14;i++){
    const x = rnd(8,120), y = rnd(8,120), r = rnd(4,6);
    g.fillStyle = Math.random()<.5 ? "#C0FF3F" : "#4a9df0";
    for (let p=0;p<5;p++){
      const a = p*Math.PI*2/5;
      g.beginPath(); g.arc(x+Math.cos(a)*r, y+Math.sin(a)*r, r*0.62, 0, 7); g.fill();
    }
    g.fillStyle = "#101018";
    g.beginPath(); g.arc(x, y, r*0.45, 0, 7); g.fill();
  }
});
// дорога: камень + пунктир полос + неоновая река по центру
const roadTex = canvasTex(256, 512, (g,w,h) => {
  g.fillStyle = "#12142e"; g.fillRect(0,0,w,h);
  for (let i=0;i<260;i++){
    g.fillStyle = `rgba(255,255,255,${rnd(.015,.05)})`;
    g.fillRect(rnd(0,w), rnd(0,h), rnd(2,7), rnd(2,5));
  }
  g.strokeStyle = "rgba(126,240,255,.5)"; g.lineWidth = 3; g.setLineDash([26,30]);
  for (const x of [w*0.335, w*0.665]){
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke();
  }
  g.setLineDash([]);
  const grd = g.createLinearGradient(w*0.42,0,w*0.58,0);
  grd.addColorStop(0,"rgba(5,54,212,0)"); grd.addColorStop(.5,"rgba(126,240,255,.30)"); grd.addColorStop(1,"rgba(5,54,212,0)");
  g.fillStyle = grd; g.fillRect(w*0.42, 0, w*0.16, h);
});
roadTex.wrapS = roadTex.wrapT = THREE.RepeatWrapping;
roadTex.repeat.set(1, 14);
// далёкий силуэт города
const skylineTex = canvasTex(1024, 256, (g,w,h) => {
  g.clearRect(0,0,w,h);
  let x = 0;
  while (x < w){
    const bw = rnd(30,80), bh = rnd(60,210);
    g.fillStyle = "#0d1030";
    g.fillRect(x, h-bh, bw, bh);
    g.fillStyle = pick(["rgba(255,126,193,.8)","rgba(126,240,255,.8)","rgba(192,255,63,.6)"]);
    if (Math.random()<.7) g.fillRect(x+rnd(4,bw-8), h-bh+rnd(4,20), rnd(3,7), rnd(12,40));
    for (let i=0;i<bw*bh/300;i++){
      g.fillStyle = `rgba(255,190,110,${rnd(.2,.7)})`;
      g.fillRect(x+rnd(2,bw-4), h-bh+rnd(4,bh-6), 2, 3);
    }
    x += bw + rnd(2,10);
  }
});

// ---------- РИЗИ (процедурная low-poly кукла) ----------
function buildRizy(){
  const M = {
    skin:  new THREE.MeshStandardMaterial({ color:COL.skin, roughness:.6 }),
    hair:  new THREE.MeshStandardMaterial({ color:COL.hair, roughness:.55 }),
    sweater:new THREE.MeshStandardMaterial({ map:sweaterTex, roughness:.8 }),
    jeans: new THREE.MeshStandardMaterial({ color:COL.jeans, roughness:.7 }),
    shoe:  new THREE.MeshStandardMaterial({ color:0x15151d, roughness:.5 }),
    sole:  new THREE.MeshStandardMaterial({ color:0xf2f2f2, roughness:.5 }),
    pack:  new THREE.MeshStandardMaterial({ color:0x2a7de0, roughness:.6 }),
  };
  const g = new THREE.Group();          // корень (позиция на земле)
  const body = new THREE.Group();       // корпус для наклона/приседа
  g.add(body);

  // ноги (пивот у бедра)
  function leg(side){
    const hip = new THREE.Group();
    hip.position.set(0.11*side, 0.86, 0);
    const thigh = new THREE.Mesh(new THREE.BoxGeometry(0.15,0.5,0.19), M.jeans);
    thigh.position.y = -0.25; hip.add(thigh);
    const shin = new THREE.Group(); shin.position.y = -0.48; hip.add(shin);
    const calf = new THREE.Mesh(new THREE.BoxGeometry(0.13,0.38,0.16), M.jeans);
    calf.position.y = -0.17; shin.add(calf);
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.16,0.1,0.3), M.shoe);
    shoe.position.set(0, -0.36, 0.05); shin.add(shoe);
    const sole = new THREE.Mesh(new THREE.BoxGeometry(0.17,0.04,0.31), M.sole);
    sole.position.set(0, -0.42, 0.05); shin.add(sole);
    return { hip, shin };
  }
  const L = leg(-1), R = leg(1);
  body.add(L.hip, R.hip);

  // торс
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52,0.6,0.3), M.sweater);
  torso.position.y = 1.16; body.add(torso);
  // рюкзак (виден со спины — камера сзади)
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.3,0.36,0.13), M.pack);
  pack.position.set(0, 1.2, 0.21); body.add(pack);

  // руки (пивот у плеча)
  function arm(side){
    const sh = new THREE.Group();
    sh.position.set(0.31*side, 1.4, 0);
    const up = new THREE.Mesh(new THREE.BoxGeometry(0.12,0.34,0.15), M.sweater);
    up.position.y = -0.16; sh.add(up);
    const lo = new THREE.Group(); lo.position.y = -0.33; sh.add(lo);
    const fore = new THREE.Mesh(new THREE.BoxGeometry(0.11,0.3,0.13), M.sweater);
    fore.position.y = -0.13; lo.add(fore);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.07,8,8), M.skin);
    hand.position.y = -0.3; lo.add(hand);
    lo.rotation.x = -0.7;   // согнутый локоть, беговая рука
    return sh;
  }
  const AL = arm(-1), AR = arm(1);
  body.add(AL, AR);

  // голова
  const headG = new THREE.Group(); headG.position.y = 1.64; body.add(headG);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.25,16,14), M.skin);
  headG.add(head);
  // каре: шапка волос + «стенки» каре по бокам и сзади до подбородка
  const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.265,16,14), M.hair);
  hairCap.position.set(0, 0.07, 0.02);
  hairCap.scale.set(1.0, 0.78, 1.0);
  headG.add(hairCap);
  const bobBack = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.34, 0.14), M.hair);
  bobBack.position.set(0, -0.05, 0.17); headG.add(bobBack);
  const bobL = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.34, 0.3), M.hair);
  bobL.position.set(-0.21, -0.05, 0.05);
  const bobR = bobL.clone(); bobR.position.x = 0.21;
  headG.add(bobL, bobR);
  const bangs = new THREE.Mesh(new THREE.BoxGeometry(0.4,0.1,0.1), M.hair);
  bangs.position.set(0, 0.15, -0.19); headG.add(bangs);
  const bunL = new THREE.Mesh(new THREE.SphereGeometry(0.075,10,10), M.hair);
  bunL.position.set(-0.13, 0.27, 0.03);
  const bunR = bunL.clone(); bunR.position.x = 0.13;
  headG.add(bunL, bunR);

  g.rotation.y = Math.PI;   // бежит от камеры (в -z)
  return { g, body, L, R, AL, AR, headG, bunL, bunR };
}
const rizy = buildRizy();
scene.add(rizy.g);

// ---------- РОЙ ГАСИТЕЛЕЙ ----------
const swarm = new THREE.Group();
const kubitEyeMat = new THREE.MeshStandardMaterial({ color:0x330000, emissive:0xff2233, emissiveIntensity:2.4 });
const kubitBodyMat = new THREE.MeshStandardMaterial({ color:0x0c0c14, roughness:.4, metalness:.3 });
const kubits = [];
for (let i=0;i<14;i++){
  const k = new THREE.Group();
  const b = new THREE.Mesh(new THREE.BoxGeometry(0.34,0.34,0.34), kubitBodyMat);
  const e = new THREE.Mesh(new THREE.SphereGeometry(0.08,8,8), kubitEyeMat);
  e.position.set(0, 0, -0.19);
  k.add(b, e);
  // рой ЛЕТИТ над дорогой — не ниже метра, кучно, как туча
  k.userData = { ox: rnd(-2.1,2.1), oy: rnd(1.1,2.9), oz: rnd(-0.7,0.7), ph: rnd(0,7), sp: rnd(2,4) };
  swarm.add(k); kubits.push(k);
}
scene.add(swarm);

// ---------- ДОРОГА И ГОРОД ----------
const road = new THREE.Mesh(
  new THREE.PlaneGeometry(8.2, 260),
  new THREE.MeshStandardMaterial({ map:roadTex, roughness:.9 })
);
road.rotation.x = -Math.PI/2;
road.position.z = -105;
scene.add(road);

// Неоновая река — светящийся поток по центру дороги
const riverMat = new THREE.MeshBasicMaterial({ color:0x7ef0ff, transparent:true, opacity:.32,
  blending:THREE.AdditiveBlending, depthWrite:false });
const river = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 260), riverMat);
river.rotation.x = -Math.PI/2;
river.position.set(0, 0.02, -105);
scene.add(river);
const river2 = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 260),
  new THREE.MeshBasicMaterial({ color:0xffffff, transparent:true, opacity:.25,
    blending:THREE.AdditiveBlending, depthWrite:false }));
river2.rotation.x = -Math.PI/2;
river2.position.set(0, 0.03, -105);
scene.add(river2);

// холодная подсветка Ризи, чтобы она читалась на тёмной дороге
const rim = new THREE.PointLight(0x9ef4ff, 0.9, 9);
rim.position.set(0, 3, 1.2);
scene.add(rim);

// светящиеся бордюры
const curbMatC = new THREE.MeshStandardMaterial({ color:0x061224, emissive:COL.cyan, emissiveIntensity:.9 });
const curbMatP = new THREE.MeshStandardMaterial({ color:0x120618, emissive:COL.pink, emissiveIntensity:.9 });
for (const [x, m] of [[-4.25, curbMatC],[4.25, curbMatP]]){
  const curb = new THREE.Mesh(new THREE.BoxGeometry(0.3,0.18,260), m);
  curb.position.set(x, 0.09, -105);
  scene.add(curb);
}

// снег за обочиной
const snowGround = new THREE.Mesh(
  new THREE.PlaneGeometry(90, 260),
  new THREE.MeshStandardMaterial({ color:0x1a1f4a, roughness:1 })
);
snowGround.rotation.x = -Math.PI/2;
snowGround.position.set(0, -0.04, -105);
scene.add(snowGround);

// здания по бокам (пул, рециркуляция)
const buildings = [];
const winTexA = windowsTex("#0b0e28", ["rgba(255,190,110,.85)","rgba(126,240,255,.7)"]);
const winTexB = windowsTex("#0d0a24", ["rgba(255,126,193,.8)","rgba(255,190,110,.8)"]);
const signMats = [COL.pink, COL.cyan, COL.lime].map(c =>
  new THREE.MeshStandardMaterial({ color:0x111, emissive:c, emissiveIntensity:1.6, side:THREE.DoubleSide }));
for (let side=-1; side<=1; side+=2){
  for (let i=0;i<22;i++){
    const w = rnd(4,7), h = rnd(7,26), d = rnd(4,7);
    const b = new THREE.Mesh(
      new THREE.BoxGeometry(w,h,d),
      new THREE.MeshStandardMaterial({ map: Math.random()<.5?winTexA:winTexB, roughness:.9 })
    );
    b.position.set(side*rnd(7.6,11), h/2-0.1, -i*8.5 + rnd(-2,2));
    scene.add(b); buildings.push(b);
    if (Math.random() < .4){
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.5, rnd(2,4)), pick(signMats));
      sign.position.set(side*(Math.abs(b.position.x)-w/2-0.05), rnd(3,h*0.8), b.position.z);
      sign.rotation.y = side<0 ? Math.PI/2 : -Math.PI/2;
      scene.add(sign); sign.userData.follow = b; b.userData.sign = sign;
      sign.userData.dx = sign.position.x - b.position.x;
      sign.userData.dy = sign.position.y;
    }
  }
}
// фонари вдоль трека
const lamps = [];
const lampMat = new THREE.MeshStandardMaterial({ color:0x222533, roughness:.6 });
const lampGlow = new THREE.MeshStandardMaterial({ color:0x111, emissive:0xffc98a, emissiveIntensity:2 });
for (let i=0;i<14;i++){
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06,0.08,3.4,6), lampMat);
  pole.position.y = 1.7;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16,8,8), lampGlow);
  head.position.y = 3.4;
  g.add(pole, head);
  g.position.set((i%2 ? 4.9 : -4.9), 0, -i*14);
  scene.add(g); lamps.push(g);
}
// далёкий город
const skyline = new THREE.Mesh(
  new THREE.PlaneGeometry(240, 60),
  new THREE.MeshBasicMaterial({ map:skylineTex, transparent:true, fog:false })
);
skyline.position.set(0, 18, -190);
scene.add(skyline);
// снегопад
const snowGeo = new THREE.BufferGeometry();
const snowN = 700, snowPos = new Float32Array(snowN*3);
for (let i=0;i<snowN;i++){
  snowPos[i*3] = rnd(-30,30); snowPos[i*3+1] = rnd(0,25); snowPos[i*3+2] = rnd(-90,12);
}
snowGeo.setAttribute("position", new THREE.BufferAttribute(snowPos, 3));
const snow = new THREE.Points(snowGeo, new THREE.PointsMaterial({ color:0xdde6ff, size:.12, transparent:true, opacity:.8 }));
scene.add(snow);

// ---------- ПРЕПЯТСТВИЯ И ЭНЕРГОНЫ ----------
const LANES = [-2.55, 0, 2.55];
const obstacles = [];   // активные
const coins = [];

const barrierMat = new THREE.MeshStandardMaterial({ color:0x131735, emissive:COL.blue, emissiveIntensity:.55, roughness:.5 });
const pylonMat = new THREE.MeshStandardMaterial({ color:0x191d3d, roughness:.5, metalness:.4 });
const laserMat = new THREE.MeshStandardMaterial({ color:0x220008, emissive:0xff2255, emissiveIntensity:3 });
const capsuleMat = new THREE.MeshStandardMaterial({ color:0x0e1b3a, emissive:0x1f5cff, emissiveIntensity:.35, roughness:.35, transparent:true, opacity:.92 });
const coinMat = new THREE.MeshStandardMaterial({ color:0x5a0f33, emissive:COL.pink, emissiveIntensity:1.6 });
const coinGeo = new THREE.CylinderGeometry(0.26, 0.26, 0.1, 6);

function mkBarrier(lane){
  const g = new THREE.Group();
  const bar = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.22, 0.22), barrierMat);
  bar.position.y = 0.95;
  const p1 = new THREE.Mesh(new THREE.BoxGeometry(0.16,1.0,0.16), pylonMat); p1.position.set(-1, .5, 0);
  const p2 = p1.clone(); p2.position.x = 1;
  const bar2 = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.12, 0.12), barrierMat);
  bar2.position.y = 0.55;
  g.add(bar, bar2, p1, p2);
  g.position.x = LANES[lane];
  g.userData = { kind:"jump", lanes:[lane], zLen:0.5 };
  return g;
}
function mkLaser(lanes){
  const g = new THREE.Group();
  const x1 = LANES[lanes[0]] - 1.3, x2 = LANES[lanes[lanes.length-1]] + 1.3;
  const p1 = new THREE.Mesh(new THREE.CylinderGeometry(0.09,0.12,2.6,6), pylonMat);
  p1.position.set(x1, 1.3, 0);
  const p2 = p1.clone(); p2.position.x = x2;
  const beam = new THREE.Mesh(new THREE.BoxGeometry(x2-x1, 0.07, 0.07), laserMat);
  beam.position.set((x1+x2)/2, 1.42, 0);
  g.add(p1, p2, beam);
  g.userData = { kind:"slide", lanes:[...lanes], zLen:0.4, beam };
  return g;
}
function mkCapsule(lane){
  const g = new THREE.Group();
  const cap = new THREE.Mesh(new THREE.CapsuleGeometry(0.62, 1.4, 6, 12), capsuleMat);
  cap.position.y = 1.35;
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.75,0.85,0.25,10), pylonMat);
  base.position.y = 0.12;
  g.add(cap, base);
  g.position.x = LANES[lane];
  g.userData = { kind:"wall", lanes:[lane], zLen:1.2 };
  return g;
}
function spawnObstacle(z){
  const r = Math.random();
  let g;
  if (r < 0.34) g = mkBarrier(Math.floor(rnd(0,3)));
  else if (r < 0.6){
    const set = pick([[0],[1],[2],[0,1],[1,2],[0,1,2]]);
    g = mkLaser(set);
  } else {
    // капсулы: 1 или 2 полосы, но хотя бы одна свободна
    const lanes = pick([[0],[1],[2],[0,1],[1,2],[0,2]]);
    g = new THREE.Group();
    for (const l of lanes) g.add(mkCapsule(l));
    g.userData = { kind:"multi", parts: lanes };
  }
  g.position.z = z;
  scene.add(g); obstacles.push(g);
}
function spawnCoins(z){
  const lane = Math.floor(rnd(0,3));
  const arc = Math.random() < 0.3;
  const n = arc ? 5 : 7;
  for (let i=0;i<n;i++){
    const c = new THREE.Mesh(coinGeo, coinMat);
    c.rotation.x = Math.PI/2;
    const y = arc ? 0.8 + Math.sin(i/(n-1)*Math.PI)*1.1 : 0.85;
    c.position.set(LANES[lane], y, z - i*1.35);
    scene.add(c); coins.push(c);
  }
}

// ---------- СОСТОЯНИЕ ----------
const G = {
  mode:"title", dist:0, energons:0, best:0,
  lane:1, x:0, py:0, vy:0, sliding:0, jumpHeld:false,
  speed:13, runPhase:0, grace:0, swarmNear:0, shake:0,
  nextObstacleZ:-40, nextCoinZ:-26,
};
try { G.best = +localStorage.getItem("rizyrun_best") || 0; } catch(e){}
$("best").textContent = G.best;

// ---------- ЗВУК ----------
let AC = null;
function beep(f, dur, type="triangle", gain=0.06, slide=0){
  try {
    AC = AC || new (window.AudioContext||window.webkitAudioContext)();
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = type; o.frequency.value = f;
    if (slide) o.frequency.linearRampToValueAtTime(f+slide, AC.currentTime+dur);
    g.gain.value = gain; g.gain.exponentialRampToValueAtTime(0.0001, AC.currentTime+dur);
    o.connect(g); g.connect(AC.destination);
    o.start(); o.stop(AC.currentTime+dur);
  } catch(e){}
}

// ---------- ВВОД ----------
addEventListener("keydown", ev => {
  if (["ArrowUp","ArrowDown","ArrowLeft","ArrowRight","Space"].includes(ev.code)) ev.preventDefault();
  if (G.mode === "title" && (ev.code==="Enter"||ev.code==="Space")) return startRun();
  if (G.mode === "over"){
    if (ev.code === "Enter") return startRun();
    if (ev.code === "Escape"){ $("over").style.display="none"; $("title").style.display="flex"; G.mode="title"; return; }
  }
  if (G.mode !== "play") return;
  if (ev.code==="ArrowLeft"||ev.code==="KeyA"){ G.lane = clamp(G.lane-1,0,2); beep(300,.05,"square",.03); }
  if (ev.code==="ArrowRight"||ev.code==="KeyD"){ G.lane = clamp(G.lane+1,0,2); beep(300,.05,"square",.03); }
  if ((ev.code==="ArrowUp"||ev.code==="KeyW"||ev.code==="Space") && G.py<=0.01 && !G.sliding){
    G.vy = 9.4; beep(430,.12,"sine",.05,220);
  }
  if ((ev.code==="ArrowDown"||ev.code==="KeyS") && G.py<=0.01 && !G.sliding){
    G.sliding = 0.68; beep(200,.1,"sine",.04,-80);
  }
});

function startRun(){
  $("title").style.display = "none";
  $("over").style.display = "none";
  for (const o of obstacles) scene.remove(o);
  for (const c of coins) scene.remove(c);
  obstacles.length = 0; coins.length = 0;
  Object.assign(G, { mode:"play", dist:0, energons:0, lane:1, x:0, py:0, vy:0,
    sliding:0, speed:13, runPhase:0, grace:0, swarmNear:0, shake:0,
    nextObstacleZ:-46, nextCoinZ:-28 });
  beep(520,.15,"triangle",.06,260);
}

function gameOver(){
  G.mode = "over";
  beep(300,.3,"sawtooth",.08,-160);
  setTimeout(()=>beep(180,.5,"sawtooth",.07,-90), 220);
  const d = Math.floor(G.dist);
  $("finalDist").textContent = d;
  $("finalEn").textContent = G.energons;
  const isBest = d > G.best;
  if (isBest){
    G.best = d;
    try { localStorage.setItem("rizyrun_best", String(d)); } catch(e){}
    $("best").textContent = d;
  }
  $("newBest").style.display = isBest ? "block" : "none";
  $("quip").textContent = pick([
    "«Статистика занесена в журнал миссии», — вздыхает Куби.",
    "«Рекомендация: в следующий раз — быстрее», — говорит Куби. Спасибо, Куби.",
    "«Мой хвост видел этот подкат. Уважение», — передаёт Му-Хрю.",
    "Мисс Фантастика мурлычет. Энергия сердца восстановлена.",
  ]);
  $("over").style.display = "flex";
}

// ---------- КОЛЛИЗИИ ----------
function checkCollisions(){
  for (const o of obstacles){
    const parts = o.userData.kind === "multi" ? o.children : [o];
    for (const p of parts){
      const u = p.userData; if (!u || !u.kind || u.kind==="multi") continue;
      const oz = (o.userData.kind==="multi" ? o.position.z : p.position.z);
      if (Math.abs(oz) > (u.zLen/2 + 0.5)) continue;
      if (!u.lanes.includes(G.lane)) continue;
      if (u.kind === "jump" && G.py < 0.85) return hit(p);
      if (u.kind === "slide" && !G.sliding && G.py < 1.0) return hit(p);
      if (u.kind === "wall") return hit(p);
    }
  }
}
function hit(p){
  if (G.grace > 0) return;
  G.grace = 1.6; G.shake = 0.7;
  G.speed = Math.max(12, G.speed*0.55);
  beep(120,.25,"sawtooth",.09);
  if (G.swarmNear > 0) return gameOver();
  G.swarmNear = 5.5;
  $("alarm").style.display = "block";
}

// ---------- ЦИКЛ ----------
let lastT = performance.now();
function step(now){
  let elapsed = Math.min(0.35, (now-lastT)/1000);
  lastT = now;
  while (elapsed > 0){
    const dt = Math.min(1/60, elapsed);
    if (G.mode === "play") update(dt);
    idle(dt);
    elapsed -= dt;
  }
  render();
}
function tickRAF(now){ step(now); requestAnimationFrame(tickRAF); }
setInterval(() => { const now = performance.now(); if (now-lastT > 60) step(now); }, 50);

function update(dt){
  G.speed = Math.min(31, G.speed + dt*0.28);
  const dz = G.speed * dt;
  G.dist += dz;
  G.runPhase += dt * (7 + G.speed*0.35);
  if (G.grace > 0) G.grace -= dt;
  if (G.swarmNear > 0){
    G.swarmNear -= dt;
    if (G.swarmNear <= 0) $("alarm").style.display = "none";
  }

  // полоса и вертикаль
  G.x = lerp(G.x, LANES[G.lane], Math.min(1, dt*12));
  G.vy -= 24*dt;
  G.py = Math.max(0, G.py + G.vy*dt);
  if (G.py === 0) G.vy = 0;
  if (G.sliding > 0) G.sliding -= dt;

  // движение мира
  roadTex.offset.y -= dz/18.5;
  for (const b of buildings){
    b.position.z += dz;
    if (b.position.z > 14){
      b.position.z -= 190;
      const h = rnd(7,26);
      b.scale.y = h / b.geometry.parameters.height;
      b.position.y = (b.geometry.parameters.height*b.scale.y)/2 - 0.1;
    }
    if (b.userData.sign){
      b.userData.sign.position.z = b.position.z;
    }
  }
  for (const l of lamps){
    l.position.z += dz;
    if (l.position.z > 12) l.position.z -= 14*14;
  }
  // снегопад
  const sp = snow.geometry.attributes.position.array;
  for (let i=0;i<snowN;i++){
    sp[i*3+1] -= dt*rnd(1.2,2.2);
    sp[i*3+2] += dz*0.35;
    if (sp[i*3+1] < 0){ sp[i*3+1] = rnd(18,25); }
    if (sp[i*3+2] > 12){ sp[i*3+2] -= 100; }
  }
  snow.geometry.attributes.position.needsUpdate = true;

  // спавн
  G.nextObstacleZ += dz;
  if (G.nextObstacleZ > -40){
    spawnObstacle(-115 + rnd(-6,6));
    G.nextObstacleZ = -40 - rnd(16, 30) - Math.max(0, 24-G.speed);
  }
  G.nextCoinZ += dz;
  if (G.nextCoinZ > -30){
    spawnCoins(-110 + rnd(-8,8));
    G.nextCoinZ = -30 - rnd(20, 36);
  }

  // движение препятствий/монет
  for (let i=obstacles.length-1;i>=0;i--){
    const o = obstacles[i];
    o.position.z += dz;
    if (o.userData.beam) o.userData.beam.material.emissiveIntensity = 2.2 + Math.sin(perf*14)*1.2;
    if (o.position.z > 10){ scene.remove(o); obstacles.splice(i,1); }
  }
  for (let i=coins.length-1;i>=0;i--){
    const c = coins[i];
    c.position.z += dz;
    c.rotation.z += dt*3;
    if (Math.abs(c.position.z) < 0.7 &&
        Math.abs(c.position.x - G.x) < 0.9 &&
        Math.abs(c.position.y - (0.85 + G.py)) < 1.0){
      G.energons++; beep(880,.07,"triangle",.05,140);
      scene.remove(c); coins.splice(i,1); continue;
    }
    if (c.position.z > 8){ scene.remove(c); coins.splice(i,1); }
  }

  checkCollisions();

  // HUD
  $("score").childNodes[0].textContent = Math.floor(G.dist) + " м";
  $("energons").textContent = "⬡ " + G.energons;
}

let perf = 0;
function idle(dt){
  perf += dt;
  // Ризи: позиция и анимация
  rizy.g.position.x = G.x;
  rizy.g.position.y = G.py;
  const t = G.runPhase;
  const running = G.mode === "play";
  const air = G.py > 0.02;
  const slide = G.sliding > 0;
  const s = Math.sin(t), c = Math.cos(t);
  if (slide){
    rizy.body.rotation.x = lerp(rizy.body.rotation.x, -1.15, Math.min(1,dt*14));
    rizy.body.position.y = lerp(rizy.body.position.y, -0.52, Math.min(1,dt*14));
    rizy.L.hip.rotation.x = lerp(rizy.L.hip.rotation.x, 1.2, dt*12);
    rizy.R.hip.rotation.x = lerp(rizy.R.hip.rotation.x, 1.35, dt*12);
    rizy.AL.rotation.x = -2.4; rizy.AR.rotation.x = -2.4;
  } else if (air){
    rizy.body.rotation.x = lerp(rizy.body.rotation.x, -0.32, dt*10);
    rizy.body.position.y = lerp(rizy.body.position.y, 0, dt*12);
    rizy.L.hip.rotation.x = lerp(rizy.L.hip.rotation.x, -1.0, dt*10);
    rizy.R.hip.rotation.x = lerp(rizy.R.hip.rotation.x, 0.5, dt*10);
    rizy.L.shin.rotation.x = 1.3; rizy.R.shin.rotation.x = 0.6;
    rizy.AL.rotation.x = -1.6; rizy.AR.rotation.x = 0.4;
  } else if (running){
    rizy.body.rotation.x = -0.16 + s*0.02;
    rizy.body.position.y = Math.abs(c)*0.07;
    rizy.L.hip.rotation.x = s*1.05;
    rizy.R.hip.rotation.x = -s*1.05;
    rizy.L.shin.rotation.x = Math.max(0, -s)*1.4 + 0.15;
    rizy.R.shin.rotation.x = Math.max(0, s)*1.4 + 0.15;
    rizy.AL.rotation.x = -s*0.95 - 0.1;
    rizy.AR.rotation.x = s*0.95 - 0.1;
    rizy.headG.rotation.x = s*0.04;
    rizy.bunL.position.y = 0.24 + Math.abs(s)*0.02;
    rizy.bunR.position.y = 0.24 + Math.abs(c)*0.02;
  } else {
    // титул: лёгкое дыхание
    rizy.body.rotation.x = Math.sin(perf*1.6)*0.03;
    rizy.body.position.y = Math.sin(perf*2)*0.02;
    rizy.L.hip.rotation.x = rizy.R.hip.rotation.x = 0;
    rizy.L.shin.rotation.x = rizy.R.shin.rotation.x = 0.05;
    rizy.AL.rotation.x = rizy.AR.rotation.x = 0;
  }

  // рой: дистанция зависит от «близости»
  const nearK = G.swarmNear > 0 ? 1 : 0;
  const baseZ = G.mode==="play" ? lerp(7.2, 3.4, nearK) : 5.2;
  swarm.position.z = lerp(swarm.position.z, baseZ, Math.min(1, dt*2.2));
  swarm.position.y = 0.4;
  riverMat.opacity = 0.26 + Math.sin(perf*3)*0.08;
  rim.position.x = G.x;
  for (const k of kubits){
    const u = k.userData;
    k.position.set(
      u.ox + Math.sin(perf*u.sp + u.ph)*0.5,
      u.oy + Math.sin(perf*u.sp*1.3 + u.ph)*0.35,
      u.oz + Math.cos(perf*u.sp*0.7 + u.ph)*0.5
    );
    k.rotation.y = Math.sin(perf*u.sp + u.ph)*0.6;
  }

  // камера: чуть за полосой, тряска при ударе
  if (G.shake > 0) G.shake -= dt;
  const shx = G.shake>0 ? (Math.random()-0.5)*0.25*G.shake : 0;
  const shy = G.shake>0 ? (Math.random()-0.5)*0.2*G.shake : 0;
  camera.position.x = lerp(camera.position.x, G.x*0.45 + shx, Math.min(1,dt*5));
  camera.position.y = CAM_BASE.y + Math.sin(perf*1.2)*0.06 + shy + G.py*0.25;
  camera.lookAt(G.x*0.6, 1.35 + G.py*0.4, -9);
}

function render(){ renderer.render(scene, camera); }
requestAnimationFrame(tickRAF);

// отладочный хук (используется автотестами)
window.RUN = { G, update, idle, render, obstacles, coins, startRun, gameOver, rizy, camera, swarm };
