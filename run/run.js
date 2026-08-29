// РИЗИ RUN: Снежная Река — светлый мягкий раннер в стилистике RIZYLAND.
// Плотный «коридор» трассы, арки, слои реквизита, крупная камера.

import * as THREE from "./three.module.js";

// ---------- УТИЛИТЫ ----------
const $ = id => document.getElementById(id);
const clamp = (v,a,b) => Math.max(a, Math.min(b, v));
const lerp = (a,b,t) => a + (b-a)*t;
const rnd = (a,b) => a + Math.random()*(b-a);
const pick = arr => arr[Math.floor(Math.random()*arr.length)];

function canvasTex(w, h, draw, rep){
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (rep){ t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep[0], rep[1]); }
  t.anisotropy = 8;
  return t;
}

// ---------- РЕНДЕР ----------
const renderer = new THREE.WebGLRenderer({ antialias:true, powerPreference:"high-performance" });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.18;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
$("wrap").prepend(renderer.domElement);

const scene = new THREE.Scene();
const FOG_COL = 0xdaeeff;
scene.fog = new THREE.Fog(FOG_COL, 34, 128);
scene.background = canvasTex(64, 256, (g,w,h) => {
  const gr = g.createLinearGradient(0,0,0,h);
  gr.addColorStop(0.00, "#6fc3ff");
  gr.addColorStop(0.42, "#a9dcff");
  gr.addColorStop(0.72, "#daeeff");
  gr.addColorStop(0.88, "#ffe9e4");
  gr.addColorStop(1.00, "#fff3e0");
  g.fillStyle = gr; g.fillRect(0,0,w,h);
});

const camera = new THREE.PerspectiveCamera(58, innerWidth/innerHeight, 0.1, 400);
const CAM = { y:3.05, z:5.45 };
camera.position.set(0, CAM.y, CAM.z);
camera.lookAt(0, 1.35, -8);
addEventListener("resize", () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth/innerHeight;
  camera.updateProjectionMatrix();
});

// ---------- СВЕТ ----------
scene.add(new THREE.HemisphereLight(0xcfe8ff, 0xfff0dc, 1.05));
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

// мягкое сияние солнца
const glowTex = canvasTex(128,128,(g,w,h)=>{
  const gr = g.createRadialGradient(w/2,h/2,2,w/2,h/2,w/2);
  gr.addColorStop(0,"rgba(255,252,236,1)");
  gr.addColorStop(.28,"rgba(255,240,190,.8)");
  gr.addColorStop(1,"rgba(255,240,190,0)");
  g.fillStyle = gr; g.fillRect(0,0,w,h);
});
const sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map:glowTex, transparent:true, depthWrite:false, fog:false }));
sunGlow.position.set(30, 33, -140); sunGlow.scale.set(58,58,1);
scene.add(sunGlow);

// ---------- ПАЛИТРА ----------
const P = {
  skin:0x5cc0ec, hair:0xd2f550, jeans:0x2f6ff0, lime:0xC0FF3F,
  pink:0xffb3d5, pink2:0xff7eb6, red:0xff6b6b, blue:0x7ec3ff,
  mint:0x7fd89a, cream:0xfff4e2, peach:0xffd2a8, brown:0xb9764a, wood:0xd9a066,
};
const mat = (color, o) => new THREE.MeshStandardMaterial(Object.assign({ color, roughness:.88, metalness:0 }, o||{}));
function msh(geo, m, cast=true, recv=false){
  const x = new THREE.Mesh(geo, m); x.castShadow = cast; x.receiveShadow = recv; return x;
}

// ---------- ЗЕМЛЯ / ТРАССА ----------
const snowTex = canvasTex(256,256,(g,w,h)=>{
  g.fillStyle = "#ffffff"; g.fillRect(0,0,w,h);
  for (let i=0;i<500;i++){
    g.fillStyle = `rgba(186,214,255,${rnd(.05,.18)})`;
    g.beginPath(); g.arc(rnd(0,w), rnd(0,h), rnd(1,3.6), 0, 7); g.fill();
  }
},[24,64]);
const ground = msh(new THREE.PlaneGeometry(200,340), mat(0xffffff,{map:snowTex,roughness:1}), false, true);
ground.rotation.x = -Math.PI/2; ground.position.set(0,-0.03,-120);
scene.add(ground);

// брусчатка тропы: тёплые плиты + снежные намёты + светлая «река» по центру
const roadTex = canvasTex(512,1024,(g,w,h)=>{
  g.fillStyle = "#e8c49a"; g.fillRect(0,0,w,h);
  // поперечные доски настила
  const planks = 26, ph = h/planks;
  for (let i=0;i<planks;i++){
    const y = i*ph;
    g.fillStyle = pick(["#f0cfa4","#e6c096","#f5d7ad","#dfb98e"]);
    g.beginPath(); g.roundRect(6, y+4, w-12, ph-8, 9); g.fill();
    g.strokeStyle = "rgba(150,105,62,.35)"; g.lineWidth = 3; g.stroke();
    // прожилки дерева
    g.strokeStyle = "rgba(160,115,70,.16)"; g.lineWidth = 2;
    for (let k=0;k<3;k++){
      const yy = y + 8 + k*(ph-16)/3;
      g.beginPath(); g.moveTo(14, yy);
      g.bezierCurveTo(w*0.33, yy+rnd(-4,4), w*0.66, yy+rnd(-4,4), w-14, yy);
      g.stroke();
    }
  }
  // снежные намёты по краям
  for (let i=0;i<70;i++){
    const x = Math.random()<.5 ? rnd(0,w*0.2) : rnd(w*0.8,w);
    g.fillStyle = `rgba(255,255,255,${rnd(.4,.85)})`;
    g.beginPath(); g.ellipse(x, rnd(0,h), rnd(14,40), rnd(7,16), rnd(0,3), 0, 7); g.fill();
  }
  // светлая «река» по центру
  const gr = g.createLinearGradient(w*0.38,0,w*0.62,0);
  gr.addColorStop(0,"rgba(190,240,255,0)");
  gr.addColorStop(.5,"rgba(190,245,255,.4)");
  gr.addColorStop(1,"rgba(190,240,255,0)");
  g.fillStyle = gr; g.fillRect(w*0.38,0,w*0.24,h);
  // пуговки разметки полос
  for (const x of [w*0.335, w*0.665]){
    for (let y=20; y<h; y+=64){
      g.fillStyle = "rgba(255,255,255,.85)";
      g.beginPath(); g.arc(x, y, 8, 0, 7); g.fill();
      g.strokeStyle = "rgba(120,150,200,.5)"; g.lineWidth = 2.5; g.stroke();
    }
  }
},[1,18]);
const road = msh(new THREE.PlaneGeometry(9,300), mat(0xffffff,{map:roadTex,roughness:.92}), false, true);
road.rotation.x = -Math.PI/2; road.position.set(0,0,-120);
scene.add(road);

// снежные валы вдоль трассы (статичные длинные формы)
const bankGeo = new THREE.CapsuleGeometry(0.95, 300, 6, 14);
for (const x of [-5.5, 5.5]){
  const bank = msh(bankGeo, mat(0xffffff,{roughness:1}), true, true);
  bank.rotation.x = Math.PI/2;
  bank.position.set(x, 0.35, -120);
  bank.scale.set(1, 1, 0.72);
  scene.add(bank);
}
// карамельные бордюры у самой тропы
for (const [x,c] of [[-4.55,P.pink],[4.55,P.blue]]){
  const curb = msh(new THREE.CapsuleGeometry(0.2, 300, 4, 10), mat(c,{roughness:.7}), true, true);
  curb.rotation.x = Math.PI/2;
  curb.position.set(x, 0.17, -120);
  scene.add(curb);
}
// непрерывные поручни поверх валов
for (const x of [-5.5, 5.5]){
  const rail = msh(new THREE.CylinderGeometry(0.075,0.075,300,8), mat(P.wood,{roughness:.7}));
  rail.rotation.x = Math.PI/2;
  rail.position.set(x, 1.45, -120);
  scene.add(rail);
}

// ---------- РЕЦИКЛИРУЕМЫЕ ПОЛОСЫ РЕКВИЗИТА ----------
function strip(count, spacing, factory){
  const items = [];
  for (let i=0;i<count;i++){
    const o = factory(i);
    if (o){ o.position.z = -i*spacing; scene.add(o); items.push(o); }
  }
  return { items, span: count*spacing };
}
function advance(s, dz){
  for (const o of s.items){
    o.position.z += dz;
    if (o.position.z > 14) o.position.z -= s.span;
  }
}

// столбики ограды + фонарики
const postMat = mat(P.wood,{roughness:.75});
const capMat = mat(0xffffff,{roughness:1});
const bulbMats = [P.pink2,P.lime,P.blue,0xffd166].map(c =>
  new THREE.MeshStandardMaterial({ color:c, emissive:c, emissiveIntensity:.45, roughness:.4 }));
const posts = strip(26, 5, i => {
  const g = new THREE.Group();
  g.userData.noShadow = true;
  for (const x of [-5.5, 5.5]){
    const p = msh(new THREE.CylinderGeometry(0.13,0.15,1.5,8), postMat);
    p.position.set(x, 0.95, 0);
    const cap = msh(new THREE.SphereGeometry(0.19,10,8), capMat);
    cap.position.set(x, 1.72, 0); cap.scale.y = .7;
    g.add(p, cap);
    if (i % 2 === 0){
      const bulb = msh(new THREE.SphereGeometry(0.13,10,8), bulbMats[i % bulbMats.length]);
      bulb.position.set(x + (x<0?0.3:-0.3), 1.3, 0);
      g.add(bulb);
    }
  }
  return g;
});

// пушистые кусты сразу за оградой
const hedgeMats = [0x8fdf9f, 0x7fd0b0, 0xa8e88a].map(c => mat(c,{roughness:.95}));
const hedges = strip(30, 4.2, i => {
  const g = new THREE.Group();
  g.userData.noShadow = true;
  for (const side of [-1,1]){
    const b = new THREE.Group();
    const m = hedgeMats[(i+(side>0?1:0)) % hedgeMats.length];
    for (let k=0;k<2;k++){
      const r = rnd(0.85,1.25);
      const s = msh(new THREE.SphereGeometry(r,12,9), m);
      s.position.set(rnd(-0.6,0.6), r*0.62, rnd(-0.7,0.7));
      b.add(s);
      const snowcap = msh(new THREE.SphereGeometry(r*0.78,10,7), capMat);
      snowcap.position.set(s.position.x, s.position.y+r*0.42, s.position.z);
      snowcap.scale.set(1,.38,1);
      b.add(snowcap);
    }
    b.position.set(side*rnd(6.5,7.2), 0, rnd(-1.4,1.4));
    g.add(b);
  }
  return g;
});

// крупный реквизит: ёлки, домики, леденцы, снеговики
function felterTree(){
  const g = new THREE.Group();
  const c1 = pick([0x63c98a, 0x77d97f, 0x59bf9a, 0x86e07a]);
  const m = mat(c1,{roughness:.95});
  const tiers = [[1.25,0.95],[0.95,1.85],[0.68,2.55],[0.42,3.1]];
  for (const [r,y] of tiers){
    const s = msh(new THREE.SphereGeometry(r,12,10), m);
    s.position.y = y; s.scale.y = .82; g.add(s);
    const cap = msh(new THREE.SphereGeometry(r*0.72,10,8), capMat);
    cap.position.y = y + r*0.42; cap.scale.set(1,.34,1);
    g.add(cap);
  }
  const trunk = msh(new THREE.CylinderGeometry(0.17,0.22,0.6,8), mat(P.brown));
  trunk.position.y = 0.28; g.add(trunk);
  const k = rnd(0.85,1.5); g.scale.set(k,k,k);
  return g;
}
function candyHouse(){
  const g = new THREE.Group();
  const bodyC = pick([P.cream, P.peach, 0xdff0ff, 0xffe3ec, 0xe8f7d8]);
  const roofC = pick([P.pink2, P.red, P.mint, 0x6fa8ff]);
  const w = rnd(3,4), d = rnd(2.8,3.6), hh = rnd(2,2.9);
  const body = msh(new THREE.BoxGeometry(w,hh,d), mat(bodyC,{roughness:.92}));
  body.position.y = hh/2;
  const roof = msh(new THREE.ConeGeometry(Math.max(w,d)*0.78, 1.5, 4), mat(roofC,{roughness:.85}));
  roof.position.y = hh + 0.72; roof.rotation.y = Math.PI/4;
  const rcap = msh(new THREE.ConeGeometry(Math.max(w,d)*0.62, 0.6, 4), capMat);
  rcap.position.y = hh + 1.14; rcap.rotation.y = Math.PI/4;
  const winMat = new THREE.MeshStandardMaterial({ color:0xfff3c4, emissive:0xffc75e, emissiveIntensity:1.1, roughness:.5 });
  g.add(body, roof, rcap);
  for (const dx of [-w*0.26, w*0.26]){
    const win = msh(new THREE.BoxGeometry(0.62,0.72,0.1), winMat);
    win.position.set(dx, hh*0.58, d/2+0.03); g.add(win);
    const frame = msh(new THREE.BoxGeometry(0.74,0.84,0.06), mat(0xffffff));
    frame.position.set(dx, hh*0.58, d/2+0.01); g.add(frame);
  }
  const door = msh(new THREE.BoxGeometry(0.66,1.05,0.1), mat(P.brown,{roughness:.8}));
  door.position.set(0, 0.52, d/2+0.03); g.add(door);
  // гирлянда по фасаду
  for (let i=0;i<6;i++){
    const b = msh(new THREE.SphereGeometry(0.1,8,8), bulbMats[i%bulbMats.length]);
    b.position.set(-w/2+0.35+i*(w-0.7)/5, hh - 0.12 - Math.sin(i/5*Math.PI)*0.18, d/2+0.06);
    g.add(b);
  }
  return g;
}
function lollipop(){
  const g = new THREE.Group();
  const pole = msh(new THREE.CylinderGeometry(0.1,0.1,3,8), mat(0xffffff,{roughness:.6}));
  pole.position.y = 1.5;
  const pop = msh(new THREE.SphereGeometry(0.5,14,12), mat(pick([P.pink2,P.lime,P.blue,0xffd166]),{roughness:.45}));
  pop.position.y = 3.1;
  const swirl = msh(new THREE.TorusGeometry(0.3,0.07,8,16), mat(0xffffff,{roughness:.5}));
  swirl.position.y = 3.1; swirl.position.z = 0.42;
  g.add(pole, pop, swirl);
  return g;
}
function snowman(){
  const g = new THREE.Group();
  const b1 = msh(new THREE.SphereGeometry(0.62,12,10), capMat); b1.position.y = 0.56;
  const b2 = msh(new THREE.SphereGeometry(0.44,12,10), capMat); b2.position.y = 1.36;
  const b3 = msh(new THREE.SphereGeometry(0.32,12,10), capMat); b3.position.y = 1.95;
  const nose = msh(new THREE.ConeGeometry(0.08,0.34,8), mat(0xff9a55));
  nose.rotation.x = Math.PI/2; nose.position.set(0,1.97,0.34);
  const hat = msh(new THREE.SphereGeometry(0.27,10,8), mat(P.pink2));
  hat.position.y = 2.2; hat.scale.y = .62;
  const scarf = msh(new THREE.TorusGeometry(0.3,0.09,8,14), mat(P.lime));
  scarf.position.y = 1.68; scarf.rotation.x = Math.PI/2;
  for (const [x,y] of [[-0.14,2.0],[0.14,2.0]]){
    const eye = msh(new THREE.SphereGeometry(0.05,8,8), mat(0x22243c));
    eye.position.set(x,y,0.29); g.add(eye);
  }
  g.add(b1,b2,b3,nose,hat,scarf);
  return g;
}
const props = strip(16, 7.5, i => {
  const g = new THREE.Group();
  g.userData.noShadow = true;
  for (const side of [-1,1]){
    const r = Math.random();
    const item = r < .46 ? felterTree() : r < .68 ? candyHouse() : r < .86 ? lollipop() : snowman();
    item.position.set(side*rnd(8.4,12.5), 0, rnd(-2.6,2.6));
    item.scale.multiplyScalar(1.18);
    item.rotation.y = side<0 ? rnd(0.2,0.6) : rnd(-0.6,-0.2);
    g.add(item);
  }
  // дальний слой — одна крупная ёлка через группу
  if (i % 2 === 0){
    const t = felterTree();
    t.position.set((i%4===0?-1:1)*rnd(16,22), 0, rnd(-4,4));
    t.scale.multiplyScalar(1.55);
    g.add(t);
  }
  return g;
});

// арки над трассой — крупные ориентиры
const signTex = canvasTex(512,128,(g,w,h)=>{
  g.fillStyle = "#fffdf7"; g.beginPath(); g.roundRect(6,6,w-12,h-12,26); g.fill();
  g.strokeStyle = "#0b1240"; g.lineWidth = 9; g.stroke();
  g.fillStyle = "#0536D4"; g.font = "900 62px 'Avenir Next', system-ui, sans-serif";
  g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText("ИДЕАЛИТИ", w/2, h/2+3);
});
const arches = strip(3, 46, () => {
  const g = new THREE.Group();
  const legMat = mat(0xffffff,{roughness:.6});
  const stripeMat = mat(P.red,{roughness:.6});
  for (const x of [-4.9, 4.9]){
    for (let i=0;i<8;i++){
      const seg = msh(new THREE.CylinderGeometry(0.19,0.19,0.55,10), i%2 ? stripeMat : legMat);
      seg.position.set(x, 0.3+i*0.55, 0);
      g.add(seg);
    }
  }
  const top = msh(new THREE.TorusGeometry(4.9, 0.2, 10, 28, Math.PI), legMat);
  top.position.y = 4.7;
  g.add(top);
  const sign = msh(new THREE.BoxGeometry(3.4,0.86,0.14), mat(0xffffff,{map:signTex,roughness:.6}));
  sign.position.set(0, 5.0, 0.02);
  g.add(sign);
  for (let i=0;i<13;i++){
    const a = Math.PI*(i/12);
    const b = msh(new THREE.SphereGeometry(0.15,10,8), bulbMats[i%bulbMats.length]);
    b.position.set(Math.cos(a)*4.9, 4.7+Math.sin(a)*4.9, 0.28);
    g.add(b);
  }
  return g;
});

// декор без теней: заметный прирост fps без потери картинки
for (const s of [posts, hedges, props]){
  for (const o of s.items){
    if (!o.userData.noShadow) continue;
    o.traverse(n => { if (n.isMesh) n.castShadow = false; });
  }
}

// дальние горы
const mountTex = canvasTex(1024,256,(g,w,h)=>{
  g.clearRect(0,0,w,h);
  for (let layer=0; layer<2; layer++){
    g.fillStyle = layer ? "rgba(186,214,250,.95)" : "rgba(206,229,255,.8)";
    g.beginPath(); g.moveTo(0,h);
    let x = 0;
    while (x < w){
      const pw = rnd(90,190), ph = rnd(70,180) - layer*22;
      g.lineTo(x+pw/2, h-ph); g.lineTo(x+pw, h);
      x += pw;
    }
    g.lineTo(w,h); g.closePath(); g.fill();
  }
  g.fillStyle = "rgba(255,255,255,.9)";
  for (let i=0;i<26;i++){
    const x = rnd(0,w), y = rnd(60,150);
    g.beginPath(); g.moveTo(x-14,y+18); g.lineTo(x,y); g.lineTo(x+14,y+18); g.closePath(); g.fill();
  }
});
const mountains = new THREE.Mesh(new THREE.PlaneGeometry(420,72),
  new THREE.MeshBasicMaterial({ map:mountTex, transparent:true, fog:false, depthWrite:false }));
mountains.position.set(0, 22, -175);
scene.add(mountains);

// облака
const clouds = [];
for (let i=0;i<11;i++){
  const g = new THREE.Group();
  const cm = new THREE.MeshBasicMaterial({ color:0xffffff, fog:false });
  for (let p=0;p<4;p++){
    const s = new THREE.Mesh(new THREE.SphereGeometry(rnd(1.6,2.8),10,8), cm);
    s.position.set(p*rnd(1.4,2.2)-3, rnd(-.4,.4), rnd(-.6,.6));
    s.scale.y = .5; g.add(s);
  }
  g.position.set(rnd(-60,60), rnd(15,30), -rnd(50,170));
  g.userData.v = rnd(.3,.9);
  scene.add(g); clouds.push(g);
}
// снежинки
const snowN = 500;
const snowGeo = new THREE.BufferGeometry();
const snowPos = new Float32Array(snowN*3);
for (let i=0;i<snowN;i++){
  snowPos[i*3] = rnd(-28,28); snowPos[i*3+1] = rnd(0,22); snowPos[i*3+2] = rnd(-90,12);
}
snowGeo.setAttribute("position", new THREE.BufferAttribute(snowPos,3));
const snowPts = new THREE.Points(snowGeo, new THREE.PointsMaterial({
  color:0xffffff, size:.19, transparent:true, opacity:.95, depthWrite:false }));
scene.add(snowPts);

// ---------- РИЗИ ----------
const sweaterTex = canvasTex(128,128,(g,w,h)=>{
  g.fillStyle = "#1b1b2c"; g.fillRect(0,0,w,h);
  for (let i=0;i<16;i++){
    const x = rnd(8,120), y = rnd(8,120), r = rnd(4.5,6.5);
    g.fillStyle = Math.random()<.5 ? "#C0FF3F" : "#5aa6f0";
    for (let p=0;p<5;p++){
      const a = p*Math.PI*2/5;
      g.beginPath(); g.arc(x+Math.cos(a)*r, y+Math.sin(a)*r, r*0.62, 0, 7); g.fill();
    }
    g.fillStyle = "#1b1b2c";
    g.beginPath(); g.arc(x,y,r*0.45,0,7); g.fill();
  }
});
function buildRizy(){
  const M = {
    skin: mat(P.skin,{roughness:.55}),
    hair: mat(P.hair,{roughness:.5}),
    sweater: mat(0xffffff,{map:sweaterTex,roughness:.85}),
    jeans: mat(P.jeans,{roughness:.72}),
    shoe: mat(0x24243d,{roughness:.5}),
    sole: mat(0xffffff,{roughness:.5}),
    pack: mat(0x3f86ee,{roughness:.6}),
    scarf: mat(P.lime,{roughness:.85}),
  };
  const g = new THREE.Group();
  const body = new THREE.Group();
  g.add(body);

  function leg(side){
    const hip = new THREE.Group();
    hip.position.set(0.13*side, 0.9, 0);
    hip.add(msh(new THREE.CapsuleGeometry(0.095,0.32,5,10), M.jeans)).children.at(-1).position.y = -0.22;
    const shin = new THREE.Group(); shin.position.y = -0.48; hip.add(shin);
    const calf = msh(new THREE.CapsuleGeometry(0.082,0.26,5,10), M.jeans);
    calf.position.y = -0.16; shin.add(calf);
    const shoe = msh(new THREE.SphereGeometry(0.13,12,10), M.shoe);
    shoe.position.set(0,-0.38,0.05); shoe.scale.set(1,.72,1.5); shin.add(shoe);
    const sole = msh(new THREE.SphereGeometry(0.115,10,8), M.sole);
    sole.position.set(0,-0.44,0.05); sole.scale.set(1,.32,1.45); shin.add(sole);
    return { hip, shin };
  }
  const L = leg(-1), R = leg(1);
  body.add(L.hip, R.hip);

  const torso = msh(new THREE.CapsuleGeometry(0.29,0.36,7,14), M.sweater);
  torso.position.y = 1.2; body.add(torso);
  const hipBlock = msh(new THREE.CapsuleGeometry(0.26,0.1,6,12), M.jeans);
  hipBlock.position.y = 0.95; body.add(hipBlock);
  const pack = msh(new THREE.CapsuleGeometry(0.19,0.24,6,12), M.pack);
  pack.position.set(0,1.24,0.27); body.add(pack);
  const packFlap = msh(new THREE.SphereGeometry(0.19,10,8), mat(0x2c6bd0,{roughness:.6}));
  packFlap.position.set(0,1.42,0.28); packFlap.scale.set(1,.5,.8); body.add(packFlap);

  function arm(side){
    const sh = new THREE.Group();
    sh.position.set(0.34*side, 1.44, 0);
    sh.rotation.z = 0.16*side;
    const up = msh(new THREE.CapsuleGeometry(0.072,0.2,5,10), M.sweater);
    up.position.y = -0.14; sh.add(up);
    const lo = new THREE.Group(); lo.position.y = -0.3; sh.add(lo);
    const fore = msh(new THREE.CapsuleGeometry(0.064,0.17,5,10), M.sweater);
    fore.position.y = -0.1; lo.add(fore);
    const hand = msh(new THREE.SphereGeometry(0.082,10,8), M.skin);
    hand.position.y = -0.25; lo.add(hand);
    lo.rotation.x = -0.75;
    return sh;
  }
  const AL = arm(-1), AR = arm(1);
  body.add(AL, AR);

  // шарф: цепочка сегментов, тянется за спиной
  const scarfRoot = new THREE.Group();
  scarfRoot.position.set(0,1.52,0.08);
  body.add(scarfRoot);
  const collar = msh(new THREE.TorusGeometry(0.2,0.075,8,16), M.scarf);
  collar.rotation.x = Math.PI/2; scarfRoot.add(collar);
  const scarfSegs = [];
  let parent = scarfRoot;
  for (let i=0;i<5;i++){
    const seg = new THREE.Group();
    seg.position.set(0, i===0 ? -0.02 : 0, i===0 ? 0.12 : 0.22);
    const m = msh(new THREE.BoxGeometry(0.28,0.1,0.3), M.scarf);
    m.position.z = 0.13; seg.add(m);
    parent.add(seg); parent = seg;
    scarfSegs.push(seg);
  }

  const headG = new THREE.Group(); headG.position.y = 1.72; body.add(headG);
  headG.add(msh(new THREE.SphereGeometry(0.27,18,16), M.skin));
  const hairCap = msh(new THREE.SphereGeometry(0.285,18,16), M.hair);
  hairCap.position.set(0,0.07,0.02); hairCap.scale.set(1,.8,1);
  headG.add(hairCap);
  const bobBack = msh(new THREE.CapsuleGeometry(0.21,0.16,6,12), M.hair);
  bobBack.position.set(0,-0.05,0.13); bobBack.scale.set(1.2,1,.62);
  headG.add(bobBack);
  for (const x of [-0.225, 0.225]){
    const side = msh(new THREE.CapsuleGeometry(0.078,0.18,5,10), M.hair);
    side.position.set(x,-0.04,0.03); headG.add(side);
  }
  const bunL = msh(new THREE.SphereGeometry(0.135,12,10), M.hair);
  bunL.position.set(-0.2,0.29,0.02);
  const bunR = bunL.clone(); bunR.position.x = 0.2;
  headG.add(bunL, bunR);
  for (const b of [bunL,bunR]){
    const tie = msh(new THREE.TorusGeometry(0.075,0.028,8,12), mat(P.pink2,{roughness:.6}));
    tie.position.set(b.position.x*0.8, 0.2, 0.02); tie.rotation.y = Math.PI/2;
    headG.add(tie);
  }
  const bangs = msh(new THREE.SphereGeometry(0.22,14,10), M.hair);
  bangs.position.set(0,0.12,-0.15); bangs.scale.set(1.08,.52,.72);
  headG.add(bangs);

  return { g, body, L, R, AL, AR, headG, bunL, bunR, scarfSegs };
}
const rizy = buildRizy();
scene.add(rizy.g);

// снежная пыль из-под ног
const dustN = 60;
const dustGeo = new THREE.BufferGeometry();
const dustPos = new Float32Array(dustN*3);
const dustVel = [];
for (let i=0;i<dustN;i++){
  dustPos[i*3+1] = -99;
  dustVel.push({x:0,y:0,z:0,life:0});
}
dustGeo.setAttribute("position", new THREE.BufferAttribute(dustPos,3));
const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({
  color:0xffffff, size:.16, transparent:true, opacity:.9, depthWrite:false }));
scene.add(dust);
let dustIdx = 0;
function emitDust(x,y,z){
  const i = dustIdx = (dustIdx+1) % dustN;
  dustPos[i*3] = x + rnd(-0.12,0.12);
  dustPos[i*3+1] = y + 0.05;
  dustPos[i*3+2] = z + rnd(-0.1,0.1);
  dustVel[i] = { x:rnd(-.7,.7), y:rnd(1.1,2.4), z:rnd(1.5,3.5), life:0.5 };
}

// ---------- РОЙ ГАСИТЕЛЕЙ ----------
const swarm = new THREE.Group();
const kubits = [];
const kubitMat = mat(0x33344f,{roughness:.85});
const kubitEye = new THREE.MeshStandardMaterial({ color:0x6b0018, emissive:0xff3a4e, emissiveIntensity:2.4, roughness:.4 });
for (let i=0;i<14;i++){
  const k = new THREE.Group();
  k.add(msh(new THREE.SphereGeometry(0.17,12,10), kubitMat, false));
  const e = new THREE.Mesh(new THREE.SphereGeometry(0.085,10,8), kubitEye);
  e.position.set(0,0,-0.12); k.add(e);
  for (const s of [-1,1]){
    const w = msh(new THREE.SphereGeometry(0.07,8,6), kubitMat, false);
    w.position.set(0.18*s, 0.09, 0); w.scale.set(1.5,.28,.85);
    k.add(w);
  }
  // рой держится ВЫШЕ головы и по краям — не перекрывает трассу
  k.userData = { ox:rnd(-3.4,3.4), oy:rnd(2.9,5.2), oz:rnd(-.8,.8), ph:rnd(0,7), sp:rnd(2,4) };
  swarm.add(k); kubits.push(k);
}
scene.add(swarm);

// ---------- ПРЕПЯТСТВИЯ И ЭНЕРГОНЫ ----------
const LANES = [-2.55, 0, 2.55];
const obstacles = [];
const coins = [];

const rollA = mat(P.pink,{roughness:.75}), rollB = mat(0xffffff,{roughness:.8});
const poleW = mat(0xffffff,{roughness:.6}), poleR = mat(P.red,{roughness:.6});
const scarfM = mat(P.lime,{roughness:.85});
const coinMat = new THREE.MeshStandardMaterial({ color:0xff5fae, emissive:0xff2f92, emissiveIntensity:.55, roughness:.3, metalness:.25 });
const coinGeo = new THREE.CylinderGeometry(0.3,0.3,0.12,8);
const coinHaloMat = new THREE.SpriteMaterial({ map:glowTex, color:0xffb3d5, transparent:true,
  opacity:.4, depthWrite:false, blending:THREE.AdditiveBlending });

function mkRoll(lane){
  const g = new THREE.Group();
  for (let i=0;i<5;i++){
    const seg = msh(new THREE.CylinderGeometry(0.36,0.36,0.46,14), i%2 ? rollA : rollB);
    seg.rotation.z = Math.PI/2; seg.position.set(-0.92+i*0.46, 0.38, 0);
    g.add(seg);
  }
  for (const x of [-1.15,1.15]){
    const cap = msh(new THREE.SphereGeometry(0.36,12,10), rollB);
    cap.position.set(x,0.38,0); g.add(cap);
  }
  const bow = msh(new THREE.TorusGeometry(0.16,0.06,8,14), scarfM);
  bow.position.set(0,0.74,0); g.add(bow);
  g.position.x = LANES[lane];
  g.userData = { kind:"jump", lanes:[lane], zLen:0.9 };
  return g;
}
function mkGarland(lanes){
  const g = new THREE.Group();
  const x1 = LANES[lanes[0]]-1.3, x2 = LANES[lanes[lanes.length-1]]+1.3;
  for (const x of [x1,x2]){
    for (let i=0;i<6;i++){
      const seg = msh(new THREE.CylinderGeometry(0.11,0.11,0.46,10), i%2 ? poleR : poleW);
      seg.position.set(x, 0.23+i*0.46, 0); g.add(seg);
    }
    const top = msh(new THREE.SphereGeometry(0.18,10,8), poleR);
    top.position.set(x,3.0,0); g.add(top);
  }
  const band = msh(new THREE.BoxGeometry(x2-x1,0.36,0.12), scarfM);
  band.position.y = 1.45; g.add(band);
  for (let i=0;i<8;i++){
    const t = i/7;
    const b = msh(new THREE.SphereGeometry(0.11,10,8), bulbMats[i%bulbMats.length]);
    b.position.set(x1+(x2-x1)*t, 1.2-Math.sin(t*Math.PI)*0.14, 0.02);
    g.add(b);
  }
  g.userData = { kind:"slide", lanes:[...lanes], zLen:0.55 };
  return g;
}
function mkMound(lane){
  const g = new THREE.Group();
  const mound = msh(new THREE.SphereGeometry(1.0,16,12), capMat);
  mound.position.y = 0.32; mound.scale.set(1.08,.78,.92);
  const t = felterTree(); t.scale.setScalar(0.5); t.position.y = 0.5;
  g.add(mound, t);
  g.position.x = LANES[lane];
  g.userData = { kind:"wall", lanes:[lane], zLen:1.4 };
  return g;
}
function spawnObstacle(z){
  const r = Math.random();
  let g;
  if (r < 0.36) g = mkRoll(Math.floor(rnd(0,3)));
  else if (r < 0.63) g = mkGarland(pick([[0],[1],[2],[0,1],[1,2],[0,1,2]]));
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
  const arc = Math.random() < 0.32;
  const n = arc ? 5 : 7;
  for (let i=0;i<n;i++){
    const holder = new THREE.Group();
    const c = msh(coinGeo, coinMat);
    c.rotation.x = Math.PI/2;
    holder.add(c);
    const halo = new THREE.Sprite(coinHaloMat.clone());
    halo.scale.set(1.1,1.1,1);
    holder.add(halo);
    const y = arc ? 0.9 + Math.sin(i/(n-1)*Math.PI)*1.15 : 0.95;
    holder.position.set(LANES[lane], y, z - i*1.4);
    holder.userData.coin = c;
    scene.add(holder); coins.push(holder);
  }
}

// ---------- СОСТОЯНИЕ ----------
const G = {
  mode:"title", dist:0, energons:0, best:0,
  lane:1, x:0, py:0, vy:0, sliding:0,
  speed:13, runPhase:0, grace:0, swarmNear:0, shake:0, land:0,
  nextObstacleZ:-46, nextCoinZ:-28,
};
try { G.best = +localStorage.getItem("rizyrun_best") || 0; } catch(e){}
$("best").textContent = G.best;
const scoreN = $("score").querySelector(".n");
const enN = $("energons").querySelector(".n");

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
  if (ev.code==="ArrowLeft"||ev.code==="KeyA"){ G.lane = clamp(G.lane-1,0,2); beep(330,.05,"square",.03); }
  if (ev.code==="ArrowRight"||ev.code==="KeyD"){ G.lane = clamp(G.lane+1,0,2); beep(330,.05,"square",.03); }
  if ((ev.code==="ArrowUp"||ev.code==="KeyW"||ev.code==="Space") && G.py<=0.01 && !G.sliding){
    G.vy = 9.6; beep(470,.12,"sine",.05,250);
  }
  if ((ev.code==="ArrowDown"||ev.code==="KeyS") && G.py<=0.01 && !G.sliding){
    G.sliding = 0.7; beep(215,.1,"sine",.04,-80);
  }
});

function startRun(){
  $("title").style.display = "none";
  $("over").style.display = "none";
  $("swarm").style.display = "none";
  for (const o of obstacles) scene.remove(o);
  for (const c of coins) scene.remove(c);
  obstacles.length = 0; coins.length = 0;
  Object.assign(G, { mode:"play", dist:0, energons:0, lane:1, x:0, py:0, vy:0,
    sliding:0, speed:13, runPhase:0, grace:0, swarmNear:0, shake:0, land:0,
    nextObstacleZ:-46, nextCoinZ:-28 });
  beep(560,.15,"triangle",.06,290);
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
  $("swarm").style.display = "none";
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
      if (u.kind === "jump" && G.py < 0.9) return hit();
      if (u.kind === "slide" && !G.sliding && G.py < 1.0) return hit();
      if (u.kind === "wall") return hit();
    }
  }
}
function hit(){
  if (G.grace > 0) return;
  G.grace = 1.6; G.shake = 0.75;
  G.speed = Math.max(12, G.speed*0.55);
  beep(120,.25,"sawtooth",.09);
  if (G.swarmNear > 0) return gameOver();
  G.swarmNear = 5.5;
  $("swarm").style.display = "block";
}

// ---------- ЦИКЛ ----------
let lastT = performance.now(), perf = 0;
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
  G.speed = Math.min(32, G.speed + dt*0.3);
  const dz = G.speed * dt;
  G.dist += dz;
  G.runPhase += dt * (7 + G.speed*0.36);
  if (G.grace > 0) G.grace -= dt;
  if (G.swarmNear > 0){
    G.swarmNear -= dt;
    $("swarmFill").style.width = clamp(G.swarmNear/5.5,0,1)*100 + "%";
    if (G.swarmNear <= 0) $("swarm").style.display = "none";
  }

  G.x = lerp(G.x, LANES[G.lane], Math.min(1, dt*13));
  const wasAir = G.py > 0.01;
  G.vy -= 25*dt;
  G.py = Math.max(0, G.py + G.vy*dt);
  if (G.py === 0){
    if (wasAir && G.vy < -2){ G.land = 0.22; for (let i=0;i<6;i++) emitDust(G.x, 0, 0); beep(150,.08,"sine",.04); }
    G.vy = 0;
  }
  if (G.sliding > 0){ G.sliding -= dt; if (Math.random()<0.5) emitDust(G.x,0,0.2); }
  if (G.land > 0) G.land -= dt;

  // мир едет
  roadTex.offset.y -= dz/18.75;
  snowTex.offset.y -= dz/5.3;
  advance(posts, dz); advance(hedges, dz); advance(props, dz); advance(arches, dz);
  for (const c of clouds){
    c.position.x += c.userData.v*dt;
    if (c.position.x > 66) c.position.x = -66;
  }
  const sp = snowPts.geometry.attributes.position.array;
  for (let i=0;i<snowN;i++){
    sp[i*3+1] -= dt*rnd(1.0,1.9);
    sp[i*3+2] += dz*0.28;
    if (sp[i*3+1] < 0) sp[i*3+1] = rnd(16,22);
    if (sp[i*3+2] > 12) sp[i*3+2] -= 100;
  }
  snowPts.geometry.attributes.position.needsUpdate = true;

  // пыль из-под ног
  if (G.py <= 0.01 && !G.sliding && Math.random() < 0.55) emitDust(G.x, 0, 0.1);

  // спавн
  G.nextObstacleZ += dz;
  if (G.nextObstacleZ > -40){
    spawnObstacle(-118 + rnd(-6,6));
    G.nextObstacleZ = -40 - rnd(17,31) - Math.max(0, 24-G.speed);
  }
  G.nextCoinZ += dz;
  if (G.nextCoinZ > -30){
    spawnCoins(-112 + rnd(-8,8));
    G.nextCoinZ = -30 - rnd(20,36);
  }

  for (let i=obstacles.length-1;i>=0;i--){
    const o = obstacles[i];
    o.position.z += dz;
    if (o.position.z > 11){ scene.remove(o); obstacles.splice(i,1); }
  }
  for (let i=coins.length-1;i>=0;i--){
    const h = coins[i];
    h.position.z += dz;
    h.userData.coin.rotation.z += dt*4;
    if (Math.abs(h.position.z) < 0.75 &&
        Math.abs(h.position.x - G.x) < 0.95 &&
        Math.abs(h.position.y - (0.95 + G.py)) < 1.05){
      G.energons++; beep(900+Math.min(600,G.energons*8),.07,"triangle",.05,150);
      enN.textContent = G.energons;
      const pill = $("energons"); pill.classList.add("bump");
      setTimeout(()=>pill.classList.remove("bump"), 120);
      scene.remove(h); coins.splice(i,1); continue;
    }
    if (h.position.z > 9){ scene.remove(h); coins.splice(i,1); }
  }

  checkCollisions();
  scoreN.textContent = Math.floor(G.dist);
}

function idle(dt){
  perf += dt;
  rizy.g.position.x = G.x;
  rizy.g.position.y = G.py;
  rizy.g.rotation.z = lerp(rizy.g.rotation.z, (LANES[G.lane]-G.x)*0.16, Math.min(1,dt*8));

  const t = G.runPhase, s = Math.sin(t), c = Math.cos(t);
  const running = G.mode === "play";
  const air = G.py > 0.02, slide = G.sliding > 0;
  const squash = G.land > 0 ? 1 - G.land*0.5 : 1;
  rizy.body.scale.set(1/Math.max(.8,squash), squash, 1/Math.max(.8,squash));

  if (slide){
    rizy.body.rotation.x = lerp(rizy.body.rotation.x, -1.2, Math.min(1,dt*15));
    rizy.body.position.y = lerp(rizy.body.position.y, -0.55, Math.min(1,dt*15));
    rizy.L.hip.rotation.x = lerp(rizy.L.hip.rotation.x, 1.25, dt*13);
    rizy.R.hip.rotation.x = lerp(rizy.R.hip.rotation.x, 1.4, dt*13);
    rizy.AL.rotation.x = -2.5; rizy.AR.rotation.x = -2.5;
  } else if (air){
    rizy.body.rotation.x = lerp(rizy.body.rotation.x, -0.3, dt*11);
    rizy.body.position.y = lerp(rizy.body.position.y, 0, dt*13);
    rizy.L.hip.rotation.x = lerp(rizy.L.hip.rotation.x, -1.05, dt*11);
    rizy.R.hip.rotation.x = lerp(rizy.R.hip.rotation.x, 0.55, dt*11);
    rizy.L.shin.rotation.x = 1.35; rizy.R.shin.rotation.x = 0.6;
    rizy.AL.rotation.x = -1.7; rizy.AR.rotation.x = 0.5;
  } else if (running){
    rizy.body.rotation.x = -0.19 + s*0.025;
    rizy.body.position.y = Math.abs(c)*0.075;
    rizy.L.hip.rotation.x = s*1.15;
    rizy.R.hip.rotation.x = -s*1.15;
    rizy.L.shin.rotation.x = Math.max(0,-s)*1.5 + 0.12;
    rizy.R.shin.rotation.x = Math.max(0, s)*1.5 + 0.12;
    rizy.AL.rotation.x = -s*1.0 - 0.12;
    rizy.AR.rotation.x = s*1.0 - 0.12;
    rizy.headG.rotation.x = s*0.05;
    rizy.bunL.position.y = 0.29 + Math.abs(s)*0.025;
    rizy.bunR.position.y = 0.29 + Math.abs(c)*0.025;
  } else {
    rizy.body.rotation.x = Math.sin(perf*1.6)*0.03;
    rizy.body.position.y = Math.sin(perf*2)*0.02;
    rizy.L.hip.rotation.x = rizy.R.hip.rotation.x = 0;
    rizy.L.shin.rotation.x = rizy.R.shin.rotation.x = 0.05;
    rizy.AL.rotation.x = rizy.AR.rotation.x = 0;
  }
  // шарф развевается тем сильнее, чем быстрее бег
  const wind = running ? clamp(G.speed/26,0,1) : 0.25;
  rizy.scarfSegs.forEach((seg,i) => {
    const target = 0.10 + wind*0.34 + Math.sin(perf*7 - i*0.7)*0.20*wind;
    seg.rotation.x = lerp(seg.rotation.x, target, Math.min(1,dt*9));
    seg.rotation.y = Math.sin(perf*5 - i*0.9)*0.055*wind;
  });

  // снежная пыль
  for (let i=0;i<dustN;i++){
    const v = dustVel[i];
    if (v.life <= 0) continue;
    v.life -= dt;
    dustPos[i*3]   += v.x*dt;
    dustPos[i*3+1] += v.y*dt;
    dustPos[i*3+2] += v.z*dt;
    v.y -= 5*dt;
    if (v.life <= 0) dustPos[i*3+1] = -99;
  }
  dust.geometry.attributes.position.needsUpdate = true;

  // рой
  const nearK = G.swarmNear > 0 ? 1 : 0;
  const baseZ = G.mode==="play" ? lerp(9.5, 4.6, nearK) : 7.0;
  swarm.position.z = lerp(swarm.position.z, baseZ, Math.min(1,dt*2.2));
  swarm.position.y = 0.4;
  for (const k of kubits){
    const u = k.userData;
    k.position.set(
      u.ox + Math.sin(perf*u.sp+u.ph)*0.5,
      u.oy + Math.sin(perf*u.sp*1.3+u.ph)*0.35,
      u.oz + Math.cos(perf*u.sp*0.7+u.ph)*0.5
    );
    k.rotation.y = Math.sin(perf*u.sp+u.ph)*0.6;
    k.rotation.z = Math.cos(perf*u.sp*1.1+u.ph)*0.25;
  }

  // камера
  if (G.shake > 0) G.shake -= dt;
  const shx = G.shake>0 ? (Math.random()-0.5)*0.3*G.shake : 0;
  const shy = G.shake>0 ? (Math.random()-0.5)*0.24*G.shake : 0;
  const speedPull = G.mode==="play" ? (G.speed-13)/19*0.5 : 0;
  camera.position.x = lerp(camera.position.x, G.x*0.42+shx, Math.min(1,dt*5.5));
  camera.position.y = CAM.y + Math.sin(perf*1.3)*0.05 + shy + G.py*0.22;
  camera.position.z = CAM.z + speedPull;
  camera.lookAt(G.x*0.55, 1.45 + G.py*0.35, -8);
  sun.position.set(camera.position.x+11, 17, 7);
  sun.target.position.set(camera.position.x, 0, -12);
}

function render(){ renderer.render(scene, camera); }
requestAnimationFrame(tickRAF);

window.RUN = { G, update, idle, render, obstacles, coins, startRun, gameOver, rizy, camera, swarm, renderer, scene };
