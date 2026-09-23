// Стенд Ризи-игрушки: ?sheet=turn (фас/3-4/профиль/спина) | poses (игровые позы, вид сбоку) | face (крупно) [&q=low|med|high]
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { createRizyToy } from "../src/rizy-toy.js";
import { installNeutralToneMapping } from "../../run/src/look/tonemap.js";

const qp = new URLSearchParams(location.search);
const sheet = qp.get("sheet") || "turn", q = qp.get("q") || "med";
const W = innerWidth, H = innerHeight;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(1); renderer.setSize(W, H);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
installNeutralToneMapping(renderer, 1.0);
renderer.setScissorTest(true);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const bg = document.createElement("canvas"); bg.width = 4; bg.height = 256;
{ const g = bg.getContext("2d"), grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, "#c9b3e6"); grd.addColorStop(0.55, "#f2c6d8"); grd.addColorStop(1, "#ffe1cf"); g.fillStyle = grd; g.fillRect(0, 0, 4, 256); }
const bgt = new THREE.CanvasTexture(bg); bgt.colorSpace = THREE.SRGBColorSpace; scene.background = bgt;
const pm = new THREE.PMREMGenerator(renderer);
scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;
scene.add(new THREE.HemisphereLight(0xfbe6ff, 0xf6d8c4, 1.1));
const key = new THREE.DirectionalLight(0xfff1e0, 2.4); key.position.set(-2.5, 4, 3.5); key.castShadow = true;
key.shadow.mapSize.set(1024, 1024); key.shadow.camera.left = key.shadow.camera.bottom = -2; key.shadow.camera.right = key.shadow.camera.top = 2; key.shadow.bias = -0.0005; key.shadow.normalBias = 0.02;
scene.add(key);
const rim = new THREE.DirectionalLight(0xd9e4ff, 1.2); rim.position.set(3, 2.5, -3); scene.add(rim);
const ground = new THREE.Mesh(new THREE.CircleGeometry(1.4, 48), new THREE.MeshStandardMaterial({ color: 0xf6ead9, roughness: 0.9 }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;

function place(list){                                  // по персонажу на вьюпорт, каждый со своей сценой-клоном света
  return list.map(o => {
    const r = createRizyToy({ quality: q });
    const sc = scene.clone(false); sc.background = scene.background; sc.environment = scene.environment; sc.environmentIntensity = 0.55;
    for (const c of scene.children) sc.add(c.clone());
    sc.add(ground.clone());
    sc.add(r.root);
    let t = 0; const dt = 1 / 60;
    for (const [dur, s] of o.seq || [[0.5, { grounded: true, speed: 0, facing: 1 }]]){
      const n = Math.max(1, Math.round(dur / dt));
      for (let i = 0; i < n; i++){ r.update(dt, Object.assign({}, s, { event: i === 0 ? s.event : null })); t += dt; }
    }
    if (o.yaw != null) r.root.rotation.y = o.yaw;
    if (o.y) r.root.position.y = o.y;
    return { sc, r, o };
  });
}

let views, cols, rows;
const G = (vy, extra) => Object.assign({ grounded: false, vy, speed: 0.6, facing: 1 }, extra);
if (sheet === "poses"){
  views = place([
    { label: "стоит", seq: [[1.2, { grounded: true, speed: 0, facing: 1 }]] },
    { label: "бег 1", seq: [[0.6, { grounded: true, speed: 1, facing: 1 }]] },
    { label: "бег 2", seq: [[0.66, { grounded: true, speed: 1, facing: 1 }]] },
    { label: "прыжок", y: 0.3, seq: [[0.02, G(8, { event: "jump" })], [0.12, G(6)]] },
    { label: "сальто", y: 0.4, seq: [[0.2, G(3)], [0.02, G(7, { event: "djump" })], [0.16, G(4)]] },
    { label: "падение", y: 0.3, seq: [[0.3, G(-6)]] },
    { label: "рывок", y: 0.2, seq: [[0.02, G(0, { event: "dash", dashing: true })], [0.1, G(0, { dashing: true })]] },
    { label: "приземл.", seq: [[0.3, G(-8)], [0.02, { grounded: true, speed: 0.3, facing: 1, event: "land" }], [0.05, { grounded: true, speed: 0.3, facing: 1 }]] },
  ]);
  cols = 4; rows = 2;
} else if (sheet === "face"){
  views = place([{ yaw: 0, face: true }, { yaw: 0.55, face: true }]);
  cols = 2; rows = 1;
} else {
  views = place([{ yaw: 0 }, { yaw: 0.6 }, { yaw: Math.PI / 2 }, { yaw: Math.PI }]);
  cols = 4; rows = 1;
}

const cam = new THREE.PerspectiveCamera(30, 1, 0.05, 50);
const vw = Math.floor(W / cols), vh = Math.floor(H / rows);
views.forEach((v, i) => {
  const cx = i % cols, cy = rows - 1 - Math.floor(i / cols);
  renderer.setViewport(cx * vw, cy * vh, vw, vh); renderer.setScissor(cx * vw, cy * vh, vw, vh);
  cam.aspect = vw / vh;
  if (v.o.face){ cam.fov = 22; cam.position.set(0, 1.18, 1.7); cam.lookAt(0, 1.14, 0); }
  else if (sheet === "poses"){ cam.fov = 30; cam.position.set(0, 1.4, 5.2); cam.lookAt(0, 0.85, 0); }
  else { cam.fov = 30; cam.position.set(0, 1.0, 4.2); cam.lookAt(0, 0.78, 0); }
  cam.updateProjectionMatrix();
  renderer.render(v.sc, cam);
});
const info = renderer.info.render;
let tris = 0, calls = 0; views[0].r.root.traverse(o => { if (o.isMesh){ calls++; tris += o.geometry.attributes.position.count / 3; } });
console.log(`rizy-toy q=${q}: мешей ${calls}, треугольников ${Math.round(tris)}`);
document.title = "SHOT_READY";
