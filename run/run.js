// РИЗИ RUN: Снежная Река — светлый мягкий раннер в стилистике RIZYLAND.
// Солнечное утро, войлочный снежный мир, пастель, круглые формы, мягкие тени.

import * as THREE from "./three.module.js";

// ---------- БАЗА ----------
const $ = id => document.getElementById(id);
const clamp = (v,a,b) => Math.max(a, Math.min(b, v));
const lerp = (a,b,t) => a + (b-a)*t;
const rnd = (a,b) => a + Math.random()*(b-a);
const pick = arr => arr[Math.floor(Math.random()*arr.length)];

const renderer = new THREE.WebGLRenderer({ antialias:true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
$("wrap").prepend(renderer.domElement);

const scene = new THREE.Scene();

// небо: нежный градиент от голубого к кремово-розовому горизонту
function canvasTex(w, h, draw){
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
scene.background = canvasTex(64, 256, (g,w,h) => {
  const gr = g.createLinearGradient(0,0,0,h);
  gr.addColorStop(0, "#9fd6ff");
  gr.addColorStop(0.55, "#cfeaff");
  gr.addColorStop(0.8, "#ffeef0");
  gr.addColorStop(1, "#fff6ea");
  g.fillStyle = gr; g.fillRect(0,0,w,h);
});
scene.fog = new THREE.Fog(0xe6f2ff, 34, 150);

const camera = new THREE.PerspectiveCamera(60, innerWidth/innerHeight, 0.1, 400);
const CAM_BASE = { x:0, y:4.1, z:7.4 };
camera.position.set(CAM_BASE.x, CAM_BASE.y, CAM_BASE.z);
camera.lookAt(0, 1.5, -9);

addEventListener("resize", () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth/innerHeight;
  camera.updateProjectionMatrix();
});

// свет: яркое солнце + мягкое небо
scene.add(new THREE.HemisphereLight(0xbfe0ff, 0xfff3e0, 1.0));
const sun = new THREE.DirectionalLight(0xfff1d6, 2.2);
sun.position.set(9, 16, 6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -16; sun.shadow.camera.right = 16;
sun.shadow.camera.top = 10; sun.shadow.camera.bottom = -50;
sun.shadow.camera.near = 1; sun.shadow.camera.far = 60;
sun.shadow.bias = -0.0004;
scene.add(sun);
sun.target.position.set(0, 0, -14);
scene.add(sun.target);

// солнышко в небе + сияние
const sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({
  map: canvasTex(128,128,(g,w,h)=>{
    const gr = g.createRadialGradient(w/2,h/2,4,w/2,h/2,w/2);
    gr.addColorStop(0,"rgba(255,246,210,1)"); gr.addColorStop(.25,"rgba(255,236,170,.85)");
    gr.addColorStop(1,"rgba(255,236,170,0)");
    g.fillStyle = gr; g.fillRect(0,0,w,h);
  }), transparent:true, depthWrite:false }));
sunGlow.position.set(26, 30, -120);
sunGlow.scale.set(46, 46, 1);
scene.add(sunGlow);

// ---------- ПАЛИТРА ----------
const P = {
  snow: 0xffffff, snowShade: 0xe8f2ff,
  ink: 0x2a3160,
  skin: 0x56b7e6, hair: 0xcdf24b, jeans: 0x2a6cf0,
  mint: 0xa9e8c8, mint2: 0x8ed8b2, lime: 0xC0FF3F,
  pink: 0xffb3d5, pink2: 0xff8fbe, peach: 0xffd9b8, cream: 0xfff6e8,
  blue: 0x7ec3ff, brown: 0xc79a72,
};
function mat(color, opts){ return new THREE.MeshStandardMaterial(Object.assign({ color, roughness:.85, metalness:0 }, opts||{})); }
function softMesh(geo, m, cast, recv){
  const mesh = new THREE.Mesh(geo, m);
  mesh.castShadow = cast !== false;
  mesh.receiveShadow = !!recv;
  return mesh;
}

// ---------- ЗЕМЛЯ И ТРАССА ----------
// снежная равнина
const groundTex = canvasTex(256, 256, (g,w,h) => {
  g.fillStyle = "#ffffff"; g.fillRect(0,0,w,h);
  for (let i=0;i<420;i++){
    g.fillStyle = `rgba(190,215,255,${rnd(.05,.16)})`;
    g.beginPath(); g.arc(rnd(0,w), rnd(0,h), rnd(1,3.4), 0, 7); g.fill();
  }
});
groundTex.wrapS = groundTex.wrapT = THREE.RepeatWrapping;
groundTex.repeat.set(20, 60);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(160, 320), mat(P.snow, { map:groundTex, roughness:1 }));
ground.rotation.x = -Math.PI/2;
ground.position.set(0, -0.02, -110);
ground.receiveShadow = true;
scene.add(ground);

// утоптанная тропа: кремовый снег с голубыми точками полос и ручейком света
const roadTex = canvasTex(256, 512, (g,w,h) => {
  g.fillStyle = "#fdf1dc"; g.fillRect(0,0,w,h);
  for (let i=0;i<240;i++){
    g.fillStyle = `rgba(226,196,150,${rnd(.08,.2)})`;
    g.beginPath(); g.arc(rnd(0,w), rnd(0,h), rnd(1.4,4), 0, 7); g.fill();
  }
  // пунктирные полосы — «пуговки»
  g.fillStyle = "rgba(120,165,240,.5)";
  for (const x of [w*0.335, w*0.665])
    for (let y=12; y<h; y+=44){ g.beginPath(); g.arc(x, y, 5, 0, 7); g.fill(); }
  // ручеёк света по центру
  const grd = g.createLinearGradient(w*0.42,0,w*0.58,0);
  grd.addColorStop(0,"rgba(126,240,255,0)"); grd.addColorStop(.5,"rgba(126,240,255,.4)"); grd.addColorStop(1,"rgba(126,240,255,0)");
  g.fillStyle = grd; g.fillRect(w*0.42, 0, w*0.16, h);
});
roadTex.wrapS = roadTex.wrapT = THREE.RepeatWrapping;
roadTex.repeat.set(1, 14);
const road = new THREE.Mesh(new THREE.PlaneGeometry(8.4, 260), mat(0xffffff, { map:roadTex, roughness:.95 }));
road.rotation.x = -Math.PI/2;
road.position.set(0, 0, -105);
road.receiveShadow = true;
scene.add(road);

// мягкие карамельные бордюры-валики
const curbGeo = new THREE.CylinderGeometry(0.22, 0.22, 260, 12);
for (const [x, c] of [[-4.3, P.pink],[4.3, P.blue]]){
  const curb = softMesh(curbGeo, mat(c, { roughness:.7 }), true, true);
  curb.rotation.x = Math.PI/2;
  curb.position.set(x, 0.16, -105);
  scene.add(curb);
}

// ---------- ДЕКОР: ЁЛКИ, ДОМИКИ, ЛЕДЕНЦЫ, ОБЛАКА ----------
const sceneryPool = [];
function felterTree(){
  const g = new THREE.Group();
  const c1 = pick([0x7fd89a, 0x8fdf7f, 0x6fcf9f, 0x9fe86f]);
  const s1 = softMesh(new THREE.SphereGeometry(1.15, 12, 10), mat(c1)); s1.position.y = 1.0; s1.scale.y = .8;
  const s2 = softMesh(new THREE.SphereGeometry(0.85, 12, 10), mat(c1)); s2.position.y = 1.85; s2.scale.y = .8;
  const s3 = softMesh(new THREE.SphereGeometry(0.55, 12, 10), mat(c1)); s3.position.y = 2.5; s3.scale.y = .85;
  const cap = softMesh(new THREE.SphereGeometry(0.34, 10, 8), mat(0xffffff)); cap.position.y = 2.86; cap.scale.y = .6;
  const trunk = softMesh(new THREE.CylinderGeometry(0.16,0.2,0.5,8), mat(P.brown)); trunk.position.y = 0.22;
  g.add(trunk, s1, s2, s3, cap);
  const k = rnd(0.7, 1.5); g.scale.set(k,k,k);
  return g;
}
function candyHouse(){
  const g = new THREE.Group();
  const bodyC = pick([P.cream, P.peach, 0xdff0ff, 0xffe3ec]);
  const roofC = pick([P.pink2, 0xff8f8f, 0x8ed8b2, 0x7ec3ff]);
  const w = rnd(2.6,3.6), d = rnd(2.4,3.2), hh = rnd(1.8,2.6);
  const body = softMesh(new THREE.BoxGeometry(w, hh, d), mat(bodyC, { roughness:.9 }));
  body.position.y = hh/2;
  const roof = softMesh(new THREE.CylinderGeometry(d*0.52, d*0.52, w*1.06, 3, 1), mat(roofC));
  roof.rotation.z = Math.PI/2; roof.rotation.x = Math.PI;
  roof.position.y = hh + d*0.2; roof.scale.y = 1;
  const snowCap = softMesh(new THREE.SphereGeometry(d*0.5, 10, 6), mat(0xffffff));
  snowCap.position.y = hh + d*0.34; snowCap.scale.set(1.1, .35, 1.02);
  const win = new THREE.Mesh(new THREE.PlaneGeometry(0.5,0.6),
    new THREE.MeshStandardMaterial({ color:0xfff0b0, emissive:0xffc258, emissiveIntensity:.9 }));
  win.position.set(0, hh*0.55, d/2+0.01);
  const win2 = win.clone(); win2.position.x = -w*0.28; win.position.x = w*0.28;
  const door = new THREE.Mesh(new THREE.PlaneGeometry(0.55,0.9), mat(P.brown));
  door.position.set(0, 0.45, d/2+0.01);
  g.add(body, roof, snowCap, win, win2, door);
  return g;
}
function lollipop(){
  const g = new THREE.Group();
  const pole = softMesh(new THREE.CylinderGeometry(0.09,0.09,2.6,8), mat(0xffffff));
  pole.position.y = 1.3;
  const pop = softMesh(new THREE.SphereGeometry(0.42,12,10), mat(pick([P.pink2, P.lime, P.blue]), { roughness:.5 }));
  pop.position.y = 2.75;
  g.add(pole, pop);
  return g;
}
function snowman(){
  const g = new THREE.Group();
  const b1 = softMesh(new THREE.SphereGeometry(0.55,12,10), mat(0xffffff)); b1.position.y = 0.5;
  const b2 = softMesh(new THREE.SphereGeometry(0.38,12,10), mat(0xffffff)); b2.position.y = 1.25;
  const nose = softMesh(new THREE.ConeGeometry(0.07,0.3,8), mat(0xff9a55)); nose.rotation.x = Math.PI/2;
  nose.position.set(0, 1.28, 0.4);
  const hat = softMesh(new THREE.SphereGeometry(0.22,10,8), mat(P.pink2)); hat.position.y = 1.58; hat.scale.y = .6;
  g.add(b1,b2,nose,hat);
  return g;
}
for (let side=-1; side<=1; side+=2){
  for (let i=0;i<16;i++){
    const r = Math.random();
    const item = r < .5 ? felterTree() : r < .72 ? candyHouse() : r < .88 ? lollipop() : snowman();
    item.position.set(side*rnd(6.6,13), 0, -i*11 + rnd(-3,3));
    if (item.children[0].geometry instanceof THREE.BoxGeometry) item.rotation.y = side<0 ? .35 : -.35;
    scene.add(item); sceneryPool.push(item);
  }
}
// облака
const clouds = [];
for (let i=0;i<9;i++){
  const g = new THREE.Group();
  const cmat = mat(0xffffff, { roughness:1, fog:false });
  for (let p=0;p<4;p++){
    const s = new THREE.Mesh(new THREE.SphereGeometry(rnd(1.4,2.4),10,8), cmat);
    s.position.set(p*rnd(1.2,2)-3, rnd(-.3,.4), rnd(-.6,.6));
    s.scale.y = .55; g.add(s);
  }
  g.position.set(rnd(-45,45), rnd(14,26), -rnd(40,160));
  g.userData.v = rnd(.2,.6);
  scene.add(g); clouds.push(g);
}
// снежинки
const snowN = 400;
const snowGeo = new THREE.BufferGeometry();
const snowPos = new Float32Array(snowN*3);
for (let i=0;i<snowN;i++){
  snowPos[i*3] = rnd(-25,25); snowPos[i*3+1] = rnd(0,20); snowPos[i*3+2] = rnd(-80,12);
}
snowGeo.setAttribute("position", new THREE.BufferAttribute(snowPos, 3));
const snowPts = new THREE.Points(snowGeo, new THREE.PointsMaterial({ color:0xffffff, size:.16, transparent:true, opacity:.95 }));
scene.add(snowPts);

// ---------- РИЗИ (мягкая кукла из капсул) ----------
const sweaterTex = canvasTex(128, 128, (g,w,h) => {
  g.fillStyle = "#191926"; g.fillRect(0,0,w,h);
  for (let i=0;i<15;i++){
    const x = rnd(8,120), y = rnd(8,120), r = rnd(4.5,6.5);
    g.fillStyle = Math.random()<.5 ? "#C0FF3F" : "#5aa6f0";
    for (let p=0;p<5;p++){
      const a = p*Math.PI*2/5;
      g.beginPath(); g.arc(x+Math.cos(a)*r, y+Math.sin(a)*r, r*0.62, 0, 7); g.fill();
    }
    g.fillStyle = "#191926";
    g.beginPath(); g.arc(x, y, r*0.45, 0, 7); g.fill();
  }
});
function buildRizy(){
  const M = {
    skin: mat(P.skin, { roughness:.55 }),
    hair: mat(P.hair, { roughness:.5 }),
    sweater: mat(0xffffff, { map:sweaterTex, roughness:.85 }),
    jeans: mat(P.jeans, { roughness:.7 }),
    shoe: mat(0x23233a, { roughness:.5 }),
    pack: mat(0x4a90e8, { roughness:.6 }),
  };
  const g = new THREE.Group();
  const body = new THREE.Group();
  g.add(body);

  function leg(side){
    const hip = new THREE.Group();
    hip.position.set(0.115*side, 0.88, 0);
    const thigh = softMesh(new THREE.CapsuleGeometry(0.085, 0.32, 4, 8), M.jeans);
    thigh.position.y = -0.22; hip.add(thigh);
    const shin = new THREE.Group(); shin.position.y = -0.47; hip.add(shin);
    const calf = softMesh(new THREE.CapsuleGeometry(0.075, 0.24, 4, 8), M.jeans);
    calf.position.y = -0.15; shin.add(calf);
    const shoe = softMesh(new THREE.SphereGeometry(0.11, 10, 8), M.shoe);
    shoe.position.set(0, -0.36, 0.06); shoe.scale.set(1, .75, 1.5); shin.add(shoe);
    return { hip, shin };
  }
  const L = leg(-1), R = leg(1);
  body.add(L.hip, R.hip);

  const torso = softMesh(new THREE.CapsuleGeometry(0.26, 0.34, 6, 12), M.sweater);
  torso.position.y = 1.16; body.add(torso);
  const pack = softMesh(new THREE.CapsuleGeometry(0.15, 0.2, 4, 8), M.pack);
  pack.position.set(0, 1.2, 0.24); body.add(pack);

  function arm(side){
    const sh = new THREE.Group();
    sh.position.set(0.3*side, 1.38, 0);
    const up = softMesh(new THREE.CapsuleGeometry(0.065, 0.2, 4, 8), M.sweater);
    up.position.y = -0.14; sh.add(up);
    const lo = new THREE.Group(); lo.position.y = -0.3; sh.add(lo);
    const fore = softMesh(new THREE.CapsuleGeometry(0.058, 0.16, 4, 8), M.sweater);
    fore.position.y = -0.1; lo.add(fore);
    const hand = softMesh(new THREE.SphereGeometry(0.07,8,8), M.skin);
    hand.position.y = -0.24; lo.add(hand);
    lo.rotation.x = -0.7;
    return sh;
  }
  const AL = arm(-1), AR = arm(1);
  body.add(AL, AR);

  const headG = new THREE.Group(); headG.position.y = 1.66; body.add(headG);
  const head = softMesh(new THREE.SphereGeometry(0.25,16,14), M.skin);
  headG.add(head);
  const hairCap = softMesh(new THREE.SphereGeometry(0.265,16,14), M.hair);
  hairCap.position.set(0, 0.07, 0.02);
  hairCap.scale.set(1.0, 0.78, 1.0);
  headG.add(hairCap);
  const bobBack = softMesh(new THREE.CapsuleGeometry(0.2, 0.14, 4, 10), M.hair);
  bobBack.position.set(0, -0.04, 0.14); bobBack.scale.set(1.15, 1, 0.6);
  headG.add(bobBack);
  const bobL = softMesh(new THREE.CapsuleGeometry(0.07, 0.16, 4, 8), M.hair);
  bobL.position.set(-0.21, -0.03, 0.04);
  const bobR = bobL.clone(); bobR.position.x = 0.21;
  headG.add(bobL, bobR);
  const bangs = softMesh(new THREE.SphereGeometry(0.2, 12, 8), M.hair);
  bangs.position.set(0, 0.13, -0.14); bangs.scale.set(1.1, .5, .7);
  headG.add(bangs);
  const bunL = softMesh(new THREE.SphereGeometry(0.08,10,10), M.hair);
  bunL.position.set(-0.13, 0.27, 0.03);
  const bunR = bunL.clone(); bunR.position.x = 0.13;
  headG.add(bunL, bunR);

  g.rotation.y = Math.PI;
  return { g, body, L, R, AL, AR, headG, bunL, bunR };
}
const rizy = buildRizy();
scene.add(rizy.g);

// ---------- РОЙ ГАСИТЕЛЕЙ (тёмные помпоны с красным глазом) ----------
const swarm = new THREE.Group();
const kubits = [];
const kubitMat = mat(0x2b2b40, { roughness:.9 });
const kubitEye = new THREE.MeshStandardMaterial({ color:0x550000, emissive:0xff3344, emissiveIntensity:2.2 });
for (let i=0;i<13;i++){
  const k = new THREE.Group();
  const b = softMesh(new THREE.SphereGeometry(0.21, 10, 8), kubitMat, false);
  const e = new THREE.Mesh(new THREE.SphereGeometry(0.075,8,8), kubitEye);
  e.position.set(0, 0, -0.15);
  const wing1 = new THREE.Mesh(new THREE.SphereGeometry(0.08,6,6), kubitMat);
  wing1.position.set(-0.22, 0.12, 0); wing1.scale.set(1.4,.3,.8);
  const wing2 = wing1.clone(); wing2.position.x = 0.22;
  k.add(b, e, wing1, wing2);
  k.userData = { ox: rnd(-2.1,2.1), oy: rnd(1.2,3.0), oz: rnd(-0.7,0.7), ph: rnd(0,7), sp: rnd(2,4) };
  swarm.add(k); kubits.push(k);
}
scene.add(swarm);

// ---------- ПРЕПЯТСТВИЯ И ЭНЕРГОНЫ ----------
const LANES = [-2.55, 0, 2.55];
const obstacles = [];
const coins = [];

const rollMatA = mat(P.pink, { roughness:.75 });
const rollMatB = mat(0xffffff, { roughness:.75 });
const poleMat = mat(0xffffff, { roughness:.6 });
const poleStripe = mat(P.pink2, { roughness:.6 });
const scarfMat = mat(P.lime, { roughness:.8 });
const moundMat = mat(0xffffff, { roughness:1 });
const coinMat = new THREE.MeshStandardMaterial({ color:0xd1387f, emissive:0xff7ec1, emissiveIntensity:.9, roughness:.4 });
const coinGeo = new THREE.CylinderGeometry(0.28, 0.28, 0.12, 6);

// валик — перепрыгнуть
function mkRoll(lane){
  const g = new THREE.Group();
  for (let i=0;i<5;i++){
    const seg = softMesh(new THREE.CylinderGeometry(0.34,0.34,0.44,12), i%2 ? rollMatA : rollMatB);
    seg.rotation.z = Math.PI/2;
    seg.position.set(-0.88 + i*0.44, 0.36, 0);
    g.add(seg);
  }
  const capL = softMesh(new THREE.SphereGeometry(0.34,10,8), rollMatB); capL.position.set(-1.1, .36, 0);
  const capR = capL.clone(); capR.position.x = 1.1;
  g.add(capL, capR);
  g.position.x = LANES[lane];
  g.userData = { kind:"jump", lanes:[lane], zLen:0.8 };
  return g;
}
// гирлянда — подкат
function mkGarland(lanes){
  const g = new THREE.Group();
  const x1 = LANES[lanes[0]] - 1.3, x2 = LANES[lanes[lanes.length-1]] + 1.3;
  function pole(x){
    const pg = new THREE.Group();
    for (let i=0;i<6;i++){
      const seg = softMesh(new THREE.CylinderGeometry(0.1,0.1,0.45,8), i%2 ? poleMat : poleStripe);
      seg.position.y = 0.22 + i*0.45;
      pg.add(seg);
    }
    const top = softMesh(new THREE.SphereGeometry(0.16,8,8), poleStripe); top.position.y = 2.85;
    pg.add(top);
    pg.position.x = x;
    return pg;
  }
  g.add(pole(x1), pole(x2));
  // мягкий «шарф» между столбами — под ним подкат
  const scarf = softMesh(new THREE.BoxGeometry(x2-x1, 0.34, 0.1), scarfMat);
  scarf.position.y = 1.42;
  g.add(scarf);
  for (let i=0;i<7;i++){
    const t = i/6;
    const bulb = softMesh(new THREE.SphereGeometry(0.09,8,8),
      mat(pick([P.pink2, P.blue, P.lime, 0xffd166]), { roughness:.4 }));
    bulb.position.set(x1 + (x2-x1)*t, 1.2 - Math.sin(t*Math.PI)*0.12, 0);
    g.add(bulb);
  }
  g.userData = { kind:"slide", lanes:[...lanes], zLen:0.5 };
  return g;
}
// сугроб с ёлочкой — обежать
function mkMound(lane){
  const g = new THREE.Group();
  const mound = softMesh(new THREE.SphereGeometry(0.95, 14, 10), moundMat);
  mound.position.y = 0.35; mound.scale.set(1.05, .75, .9);
  const tree = felterTree();
  tree.scale.set(0.55, 0.55, 0.55);
  tree.position.y = 0.55;
  g.add(mound, tree);
  g.position.x = LANES[lane];
  g.userData = { kind:"wall", lanes:[lane], zLen:1.3 };
  return g;
}
function spawnObstacle(z){
  const r = Math.random();
  let g;
  if (r < 0.36) g = mkRoll(Math.floor(rnd(0,3)));
  else if (r < 0.62) g = mkGarland(pick([[0],[1],[2],[0,1],[1,2],[0,1,2]]));
  else {
    const lanes = pick([[0],[1],[2],[0,1],[1,2],[0,2]]);
    g = new THREE.Group();
    for (const l of lanes) g.add(mkMound(l));
    g.userData = { kind:"multi" };
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
    c.castShadow = true;
    c.rotation.x = Math.PI/2;
    const y = arc ? 0.85 + Math.sin(i/(n-1)*Math.PI)*1.1 : 0.9;
    c.position.set(LANES[lane], y, z - i*1.35);
    scene.add(c); coins.push(c);
  }
}

// ---------- СОСТОЯНИЕ ----------
const G = {
  mode:"title", dist:0, energons:0, best:0,
  lane:1, x:0, py:0, vy:0, sliding:0,
  speed:13, runPhase:0, grace:0, swarmNear:0, shake:0,
  nextObstacleZ:-46, nextCoinZ:-28,
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
  if (ev.code==="ArrowLeft"||ev.code==="KeyA"){ G.lane = clamp(G.lane-1,0,2); beep(320,.05,"square",.03); }
  if (ev.code==="ArrowRight"||ev.code==="KeyD"){ G.lane = clamp(G.lane+1,0,2); beep(320,.05,"square",.03); }
  if ((ev.code==="ArrowUp"||ev.code==="KeyW"||ev.code==="Space") && G.py<=0.01 && !G.sliding){
    G.vy = 9.4; beep(460,.12,"sine",.05,240);
  }
  if ((ev.code==="ArrowDown"||ev.code==="KeyS") && G.py<=0.01 && !G.sliding){
    G.sliding = 0.68; beep(210,.1,"sine",.04,-80);
  }
});

function startRun(){
  $("title").style.display = "none";
  $("over").style.display = "none";
  $("alarm").style.display = "none";
  for (const o of obstacles) scene.remove(o);
  for (const c of coins) scene.remove(c);
  obstacles.length = 0; coins.length = 0;
  Object.assign(G, { mode:"play", dist:0, energons:0, lane:1, x:0, py:0, vy:0,
    sliding:0, speed:13, runPhase:0, grace:0, swarmNear:0, shake:0,
    nextObstacleZ:-46, nextCoinZ:-28 });
  beep(540,.15,"triangle",.06,280);
}

function gameOver(){
  G.mode = "over";
  beep(300,.3,"sawtooth",.07,-160);
  setTimeout(()=>beep(180,.5,"sawtooth",.06,-90), 220);
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
  $("alarm").style.display = "none";
}

// ---------- КОЛЛИЗИИ ----------
function checkCollisions(){
  for (const o of obstacles){
    const parts = o.userData.kind === "multi" ? o.children : [o];
    for (const p of parts){
      const u = p.userData; if (!u || !u.kind || u.kind==="multi") continue;
      const oz = o.position.z + (o.userData.kind==="multi" ? p.position.z : 0);
      if (Math.abs(oz) > (u.zLen/2 + 0.5)) continue;
      if (!u.lanes.includes(G.lane)) continue;
      if (u.kind === "jump" && G.py < 0.85) return hit();
      if (u.kind === "slide" && !G.sliding && G.py < 1.0) return hit();
      if (u.kind === "wall") return hit();
    }
  }
}
function hit(){
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
let perf = 0;
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

  G.x = lerp(G.x, LANES[G.lane], Math.min(1, dt*12));
  G.vy -= 24*dt;
  G.py = Math.max(0, G.py + G.vy*dt);
  if (G.py === 0) G.vy = 0;
  if (G.sliding > 0) G.sliding -= dt;

  roadTex.offset.y -= dz/18.5;
  groundTex.offset.y -= dz/5.3;

  for (const s of sceneryPool){
    s.position.z += dz;
    if (s.position.z > 14) s.position.z -= 176;
  }
  for (const c of clouds){
    c.position.x += c.userData.v * dt;
    if (c.position.x > 50) c.position.x = -50;
  }
  const sp = snowPts.geometry.attributes.position.array;
  for (let i=0;i<snowN;i++){
    sp[i*3+1] -= dt*rnd(1.0,1.8);
    sp[i*3+2] += dz*0.3;
    if (sp[i*3+1] < 0) sp[i*3+1] = rnd(14,20);
    if (sp[i*3+2] > 12) sp[i*3+2] -= 90;
  }
  snowPts.geometry.attributes.position.needsUpdate = true;

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

  for (let i=obstacles.length-1;i>=0;i--){
    const o = obstacles[i];
    o.position.z += dz;
    if (o.position.z > 10){ scene.remove(o); obstacles.splice(i,1); }
  }
  for (let i=coins.length-1;i>=0;i--){
    const c = coins[i];
    c.position.z += dz;
    c.rotation.z += dt*3;
    if (Math.abs(c.position.z) < 0.7 &&
        Math.abs(c.position.x - G.x) < 0.9 &&
        Math.abs(c.position.y - (0.9 + G.py)) < 1.0){
      G.energons++; beep(900,.07,"triangle",.05,150);
      scene.remove(c); coins.splice(i,1); continue;
    }
    if (c.position.z > 8){ scene.remove(c); coins.splice(i,1); }
  }

  checkCollisions();

  $("score").childNodes[0].textContent = Math.floor(G.dist) + " м";
  $("energons").textContent = "⬡ " + G.energons;
}

function idle(dt){
  perf += dt;
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
  } else {
    rizy.body.rotation.x = Math.sin(perf*1.6)*0.03;
    rizy.body.position.y = Math.sin(perf*2)*0.02;
    rizy.L.hip.rotation.x = rizy.R.hip.rotation.x = 0;
    rizy.L.shin.rotation.x = rizy.R.shin.rotation.x = 0.05;
    rizy.AL.rotation.x = rizy.AR.rotation.x = 0;
  }

  const nearK = G.swarmNear > 0 ? 1 : 0;
  const baseZ = G.mode==="play" ? lerp(7.4, 3.4, nearK) : 5.4;
  swarm.position.z = lerp(swarm.position.z, baseZ, Math.min(1, dt*2.2));
  swarm.position.y = 0.4;
  for (const k of kubits){
    const u = k.userData;
    k.position.set(
      u.ox + Math.sin(perf*u.sp + u.ph)*0.5,
      u.oy + Math.sin(perf*u.sp*1.3 + u.ph)*0.35,
      u.oz + Math.cos(perf*u.sp*0.7 + u.ph)*0.5
    );
    k.rotation.y = Math.sin(perf*u.sp + u.ph)*0.6;
  }

  if (G.shake > 0) G.shake -= dt;
  const shx = G.shake>0 ? (Math.random()-0.5)*0.25*G.shake : 0;
  const shy = G.shake>0 ? (Math.random()-0.5)*0.2*G.shake : 0;
  camera.position.x = lerp(camera.position.x, G.x*0.45 + shx, Math.min(1,dt*5));
  camera.position.y = CAM_BASE.y + Math.sin(perf*1.2)*0.05 + shy + G.py*0.25;
  camera.lookAt(G.x*0.6, 1.4 + G.py*0.4, -9);
}

function render(){ renderer.render(scene, camera); }
requestAnimationFrame(tickRAF);

// отладочный хук (используется автотестами)
window.RUN = { G, update, idle, render, obstacles, coins, startRun, gameOver, rizy, camera, swarm };
