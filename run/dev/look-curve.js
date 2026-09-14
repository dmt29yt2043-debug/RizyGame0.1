// Стенд «изогнутого мира»: 300 м прямой трассы, ряды инстанс-кубов, столбы со спрайтами,
// снег (Points) и точки-маркеры по оси дороги, тени от солнца. Кадр рисуется один раз → SHOT_READY.
import * as THREE from "three";
import { installCurve } from "../src/look/curve.js";

const QP = new URLSearchParams(location.search);
const BEND = QP.get("bend") !== "0";
const SWAY = +(QP.get("sway") || 0);           // -1..1: знак и вес покачивания
const CAM = QP.get("cam") || "game";
const LIVE = QP.has("live");
let seed = 7;
const rnd = (a, b) => { seed = (seed * 16807) % 2147483647; return a + (seed / 2147483647) * (b - a); };

const W = innerWidth, H = innerHeight;
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(W, H);
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.18;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xdaeeff, 34, 128);
scene.background = new THREE.Color(0xa9dcff);

// камера как в игре + крупный план зоны изгиба + вид сбоку
const camera = new THREE.PerspectiveCamera(58, W / H, 0.1, 400);

// изгиб ставится ДО первой компиляции шейдеров
const ctx = { THREE, renderer, scene, camera };
const K = QP.has("k") ? +QP.get("k") : undefined;
const curve = installCurve(ctx, BEND ? (K !== undefined ? { bendY: K } : {}) : { bendY: 0, swayX: 0 });
if (SWAY) curve.setSway(SWAY > 0 ? 0.25 : 0.75, Math.abs(SWAY));

if (CAM === "zoom"){
  // крупный план, нацеленный на СОГНУТУЮ точку: с изгибом и без в кадре одно и то же содержимое
  const T = curve.bendPoint(new THREE.Vector3(0, 0, -36));
  camera.fov = 26; camera.position.set(T.x + 7.5, T.y + 6.4, T.z + 20); camera.lookAt(T);
}
else if (CAM === "side"){ camera.fov = 40; camera.position.set(60, 6, -40); camera.lookAt(0, -6, -45); }
else { camera.position.set(0, 3.05, 5.45); camera.lookAt(0, 1.35, -8); }
camera.updateProjectionMatrix();

// ---------- свет ----------
scene.add(new THREE.HemisphereLight(0xcfe8ff, 0xfff0dc, 1.05));
const sun = new THREE.DirectionalLight(0xfff2da, 2.35);
sun.position.set(11, 17, 7);
sun.target.position.set(0, 0, -12);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 14, bottom: -40, near: 1, far: 80 });
sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);

// ---------- дорога: 300 м, сегменты по 1 м ----------
const roadTex = (() => {
  const c = document.createElement("canvas"); c.width = 128; c.height = 128;
  const g = c.getContext("2d");
  g.fillStyle = "#e9eef6"; g.fillRect(0, 0, 128, 128);
  g.fillStyle = "#9fb3d6"; g.fillRect(40, 0, 3, 128); g.fillRect(85, 0, 3, 128);
  g.fillStyle = "#d4dcea"; g.fillRect(0, 0, 128, 6);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1, 75); t.anisotropy = 8;
  return t;
})();
const roadGeo = new THREE.PlaneGeometry(9, 300, 4, 300); roadGeo.rotateX(-Math.PI / 2); roadGeo.translate(0, 0, -140);
const road = new THREE.Mesh(roadGeo, new THREE.MeshStandardMaterial({ map: roadTex, roughness: .9 }));
road.receiveShadow = true; scene.add(road);
const bankGeo = new THREE.PlaneGeometry(80, 300, 8, 300); bankGeo.rotateX(-Math.PI / 2); bankGeo.translate(0, -0.02, -140);
const banks = new THREE.Mesh(bankGeo, new THREE.MeshLambertMaterial({ color: 0xf6fbff }));
banks.receiveShadow = true; scene.add(banks);

// ---------- ряды инстанс-кубов по обе стороны ----------
const N = 150;
const boxes = new THREE.InstancedMesh(new THREE.BoxGeometry(1.3, 1.6, 1.3), new THREE.MeshStandardMaterial({ roughness: .7 }), N);
const m4 = new THREE.Matrix4(), col = new THREE.Color();
for (let i = 0; i < N; i++){
  const side = i % 2 ? 1 : -1, z = 2 - Math.floor(i / 2) * 4;
  m4.makeTranslation(side * 6, 0.8, z);
  boxes.setMatrixAt(i, m4);
  boxes.setColorAt(i, col.setHSL((i * 0.037) % 1, .55, .62));
}
boxes.castShadow = boxes.receiveShadow = true; scene.add(boxes);

// ---------- столбы со спрайтами на макушке ----------
const glow = (() => {
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const g = c.getContext("2d"), gr = g.createRadialGradient(32, 32, 1, 32, 32, 32);
  gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(.35, "rgba(255,120,200,.9)"); gr.addColorStop(1, "rgba(255,120,200,0)");
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
})();
const poleGeo = new THREE.CylinderGeometry(0.16, 0.2, 8, 10, 8); poleGeo.translate(0, 4, 0);
const poleMat = new THREE.MeshPhysicalMaterial({ color: 0x0536d4, roughness: .35, clearcoat: 1 });
const spriteMat = new THREE.SpriteMaterial({ map: glow, transparent: true, depthWrite: false });
for (const z of [-8, -22, -34, -46, -62, -84, -110]){
  for (const x of [-3.6, 3.6]){
    const p = new THREE.Mesh(poleGeo, poleMat); p.position.set(x, 0, z); p.castShadow = true; scene.add(p);
    const s = new THREE.Sprite(spriteMat); s.position.set(x, 8.25, z); s.scale.set(1.3, 1.3, 1); scene.add(s);
  }
}

// ---------- препятствия на дороге разными материалами ----------
const obst = [
  [new THREE.MeshStandardMaterial({ color: 0xff7eb6, roughness: .5 }), -1.8, -14],
  [new THREE.MeshLambertMaterial({ color: 0xC0FF3F }), 1.8, -26],
  [new THREE.MeshBasicMaterial({ color: 0xffb020 }), 0, -38],
  [new THREE.MeshPhysicalMaterial({ color: 0x7ec3ff, roughness: .2, clearcoat: 1, sheen: 1 }), -1.8, -50],
  [new THREE.MeshStandardMaterial({ color: 0xff5c7a, roughness: .5 }), 1.8, -62],
  [new THREE.MeshStandardMaterial({ color: 0x8a5cff, roughness: .5 }), 0, -74],
];
for (const [mat, x, z] of obst){
  const b = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.2, 1.6), mat);
  b.position.set(x, 0.6, z); b.castShadow = b.receiveShadow = true; scene.add(b);
}

// ---------- Points: снег и маркеры по оси дороги (должны лежать на согнутой дороге) ----------
const dot = (() => {
  const c = document.createElement("canvas"); c.width = c.height = 32;
  const g = c.getContext("2d"), gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
})();
const snowN = 2500, sp = new Float32Array(snowN * 3);
for (let i = 0; i < snowN; i++){ sp[i*3] = rnd(-25, 25); sp[i*3+1] = rnd(0, 16); sp[i*3+2] = rnd(-160, 10); }
const snowGeo = new THREE.BufferGeometry(); snowGeo.setAttribute("position", new THREE.BufferAttribute(sp, 3));
scene.add(new THREE.Points(snowGeo, new THREE.PointsMaterial({ color: 0xffffff, size: .28, map: dot, transparent: true, depthWrite: false })));
const mk = [];
for (let z = 0; z > -140; z -= 1.5) mk.push(0, 0.15, z);
const mkGeo = new THREE.BufferGeometry(); mkGeo.setAttribute("position", new THREE.Float32BufferAttribute(mk, 3));
scene.add(new THREE.Points(mkGeo, new THREE.PointsMaterial({ color: 0xff0080, size: .35, map: dot, transparent: true, depthWrite: false })));

// ---------- задник без изгиба (проверка userData.noCurve) ----------
const back = new THREE.Mesh(new THREE.PlaneGeometry(420, 60), new THREE.MeshBasicMaterial({ color: 0x9cc6ea, fog: false }));
back.position.set(0, 18, -190); back.userData.noCurve = true; scene.add(back);

// ---------- ?extra=1: остальные типы материалов, точечная тень, свой ShaderMaterial ----------
if (QP.has("extra")){
  const pl = new THREE.PointLight(0xffaa66, 60, 30); pl.position.set(0, 4, -20); pl.castShadow = true;
  pl.shadow.mapSize.set(256, 256); scene.add(pl);
  const ball = new THREE.SphereGeometry(0.7, 20, 12);
  const mats = [
    new THREE.MeshPhongMaterial({ color: 0xffd166 }), new THREE.MeshToonMaterial({ color: 0x06d6a0 }),
    new THREE.MeshMatcapMaterial({ color: 0xef476f }), new THREE.MeshNormalMaterial(),
    new THREE.MeshStandardMaterial({ color: 0x118ab2, flatShading: true }),
    new THREE.MeshStandardMaterial({ color: 0xffffff, map: glow, alphaTest: .5, transparent: false }),
  ];
  mats.forEach((m, i) => {
    const s = new THREE.Mesh(ball, m); s.position.set(-3 + i * 1.2, 0.7, -18 - i * 5);
    s.castShadow = s.receiveShadow = true; scene.add(s);
  });
  const shadowCatcher = new THREE.Mesh(new THREE.PlaneGeometry(4, 20, 2, 20).rotateX(-Math.PI / 2), new THREE.ShadowMaterial({ opacity: .3 }));
  shadowCatcher.position.set(0, 0.03, -30); shadowCatcher.receiveShadow = true; scene.add(shadowCatcher);
  const lineGeo = new THREE.BufferGeometry().setFromPoints(Array.from({ length: 120 }, (_, i) => new THREE.Vector3(-4.4, 0.05, -i)));
  const line = new THREE.Line(lineGeo, new THREE.LineDashedMaterial({ color: 0x0536d4, dashSize: .5, gapSize: .3 }));
  line.computeLineDistances(); scene.add(line);
  // свой шейдер через чанки curve
  const sm = new THREE.ShaderMaterial({
    uniforms: {},
    vertexShader: `#include <curve_pars_vertex>
      void main(){ vec4 w = modelMatrix * vec4(position, 1.0);
        #ifdef CURVE_ON
        w.xyz = curveBend(w.xyz);
        #endif
        gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `void main(){ gl_FragColor = vec4(1.0, 0.4, 0.0, 1.0); }`,
  });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.12, 8, 32), sm); ring.position.set(3, 1.3, -30); scene.add(ring);
  // исключённый объект с тенью
  const nc = new THREE.Mesh(new THREE.BoxGeometry(1, 3, 1), new THREE.MeshStandardMaterial({ color: 0x333333 }));
  nc.position.set(-2.5, 1.5, -42); nc.castShadow = true; nc.userData.noCurve = true; scene.add(nc);
}

curve.patch(scene);
curve.patch(scene); // идемпотентность

const hud = document.getElementById("hud");
function frame(){
  renderer.render(scene, camera);
  const i = renderer.info.render;
  hud.textContent = `bend=${BEND ? 1 : 0} sway=${SWAY} cam=${CAM} bendX=${curve.uniforms.bendX.value.toFixed(5)} ` +
    `bendY=${curve.uniforms.bendY.value} calls=${i.calls} tris=${i.triangles}`;
}
window.DEV = { renderer, scene, camera, curve };
if (LIVE){
  const G = { mode: "play", dist: 0, speed: 20 };
  let last = performance.now();
  renderer.setAnimationLoop(t => {
    const dt = Math.min(.05, (t - last) / 1000); last = t;
    G.dist += G.speed * dt; curve.update(dt, G); frame();
  });
} else {
  frame();
  requestAnimationFrame(() => { document.title = "SHOT_READY"; });
}
