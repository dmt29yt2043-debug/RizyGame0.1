// Стенд материалов: снежная студия с солнцем и линейкой образцов из src/look/materials.js.
// ?q=low|med|high  ?cam=close|wide  ?env=0 (без PMREM для сравнения)  ?anim=1 (крутить, не для скриншотов)  ?post=1 (попробовать post.js)
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { createLook } from "../src/look/materials.js";

const qp = new URLSearchParams(location.search);
const quality = ["low", "med", "high"].includes(qp.get("q")) ? qp.get("q") : "med";

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(46, innerWidth / innerHeight, 0.1, 300);

const t0 = performance.now();
const look = await createLook({ THREE, renderer, scene, quality });
const tLook = performance.now() - t0;
if (qp.get("env") === "0") scene.environment = null;
const H = look.hints;
renderer.toneMappingExposure = H.exposure;

// небо как в игре (фон — забота стенда, модуль его не трогает)
{
  const c = document.createElement("canvas"); c.width = 16; c.height = 256;
  const g = c.getContext("2d"), gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, "#6fc3ff"); gr.addColorStop(0.45, "#a9dcff"); gr.addColorStop(0.75, "#daeeff"); gr.addColorStop(1, "#fff0e4");
  g.fillStyle = gr; g.fillRect(0, 0, 16, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  scene.background = t;
}
scene.fog = new THREE.Fog(0xdaeeff, 30, 90);

// свет
scene.add(new THREE.HemisphereLight(0xcfe8ff, 0xfff0dc, +(qp.get("hemi") || H.hemi)));
const sun = new THREE.DirectionalLight(0xfff2da, H.sun);
sun.position.set(11, 17, 7);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 10, bottom: -10, near: 1, far: 60 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02; sun.shadow.radius = 4;
scene.add(sun, sun.target);
const fill = new THREE.DirectionalLight(0xbfd8ff, H.fill);
fill.position.set(-9, 7, 4);
scene.add(fill);

const add = (geo, mat, x, y, z, cast = true) => {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z);
  m.castShadow = cast; m.receiveShadow = true; scene.add(m); return m;
};

// снежная земля
const ground = add(new THREE.PlaneGeometry(120, 120), look.snow({ repeat: 14 }), 0, 0, 0, false);
ground.rotation.x = -Math.PI / 2;

// сугробы
const mound = add(new THREE.SphereGeometry(1.6, 64, 32), look.snow({ repeat: 1.5 }), -3.2, -0.2, -2.6);
mound.scale.set(1.35, 0.62, 1);
const mound2 = add(new THREE.SphereGeometry(1.0, 48, 24), look.snow({ repeat: 1.5 }), -0.9, -0.15, -3.2);
mound2.scale.set(1.2, 0.7, 1);

// войлочные шары — фирменные цвета + помпон
const felts = [[0xC0FF3F, -4.6], [0x5CC0EC, -3.3], [0xFF7EB6, -2.0], [0x1B1B2C, -0.7]];
for (const [c, x] of felts) add(new THREE.SphereGeometry(0.55, 64, 40), look.felt(c), x, 0.55, 0.9);
add(new THREE.SphereGeometry(0.28, 48, 32), look.felt(0xffffff), -0.7, 1.35, 0.9);

// леденец: палочка + спираль + ободок
{
  const x = 0.9, y = 1.55, z = 0.5;
  add(new THREE.CylinderGeometry(0.05, 0.05, 1.6, 16), look.candy(0xffffff), x, 0.8, z);
  const discMats = [look.candy(0xff5fae), look.candy(0xff5fae, { stripe: 0xffffff, pattern: "swirl", stripes: 4 }),
                    look.candy(0xff5fae, { stripe: 0xffffff, pattern: "swirl", stripes: 4 })];
  const disc = add(new THREE.CylinderGeometry(0.62, 0.62, 0.2, 64), discMats, x, y, z);
  disc.rotation.x = Math.PI / 2;
  const rim = add(new THREE.TorusGeometry(0.62, 0.1, 20, 64), look.candy(0xff5fae), x, y, z);
}
// карамельная арка (трость)
{
  class Arc extends THREE.Curve {
    getPoint(t, out = new THREE.Vector3()){ const a = Math.PI * t; return out.set(Math.cos(a) * 1.1, Math.sin(a) * 1.5, 0); }
  }
  add(new THREE.TubeGeometry(new Arc(), 96, 0.12, 20), look.candy(0xff4d6d, { stripe: 0xffffff, stripes: 2, repeat: [10, 1] }), 2.6, 0, -2.4);
}

// полоса досок
{
  const deck = add(new THREE.BoxGeometry(3.2, 0.14, 1.8), look.wood({ repeat: [1, 1] }), 2.9, 0.07, 0.6);
  deck.receiveShadow = true;
}
// ледяной блок
add(new RoundedBoxGeometry(1.1, 1.1, 1.1, 5, 0.12), look.ice(), 5.3, 0.55, -0.6);
// металлический столбик + светящийся шар
add(new THREE.CylinderGeometry(0.06, 0.08, 1.4, 20), look.metal(0xdfe4ee), 4.6, 0.7, 1.3);
add(new THREE.SphereGeometry(0.22, 40, 24), look.glow(0xff5fae, 3), 4.6, 1.55, 1.3, false);
add(new THREE.SphereGeometry(0.3, 40, 24), look.metal(0xffb84a, { roughness: 0.22 }), 3.6, 0.44, 1.5);
add(new THREE.SphereGeometry(0.16, 32, 16), look.glow(0xC0FF3F, 2.6), 1.9, 0.3, 1.9, false);

// ореол вокруг светящегося шара + блики-звёздочки
{
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: look.tex.softDot, color: 0xff8cc6, transparent: true,
    opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
  halo.position.set(4.6, 1.55, 1.3); halo.scale.set(1.1, 1.1, 1); scene.add(halo);
  const star = new THREE.SpriteMaterial({ map: look.tex.sparkle, color: 0xffffff, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending });
  for (const [x, y, z, s] of [[5.65, 1.05, -0.05, 0.5], [-2.7, 0.8, -1.9, 0.35], [1.2, 1.95, 0.6, 0.4]]){
    const sp = new THREE.Sprite(star); sp.position.set(x, y, z); sp.scale.set(s, s, 1); scene.add(sp);
  }
}

// падающий снег: мягкие круглые точки
const N = 900, pos = new Float32Array(N * 3);
{
  let a = 99;
  const r = () => { a = (a * 16807) % 2147483647; return a / 2147483647; };
  for (let i = 0; i < N; i++){ pos[i * 3] = (r() - 0.5) * 22; pos[i * 3 + 1] = r() * 7; pos[i * 3 + 2] = (r() - 0.5) * 16 - 2; }
}
const flakesGeo = new THREE.BufferGeometry();
flakesGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
const flakes = new THREE.Points(flakesGeo, new THREE.PointsMaterial({ map: look.tex.softDot, size: 0.09, sizeAttenuation: true,
  transparent: true, depthWrite: false, color: 0xffffff, opacity: 0.95 }));
scene.add(flakes);

// камера
const cam = qp.get("cam");
if (cam === "close"){ camera.position.set(-2.2, 1.6, 4.2); camera.lookAt(-2.2, 0.6, 0.4); }
else if (cam === "wood"){ camera.position.set(2.9, 1.6, 2.6); camera.lookAt(3.1, 0.2, 0.2); }
else if (cam === "snow"){ camera.position.set(-3.6, 1.3, 2.4); camera.lookAt(-2.4, 0.2, -2.2); }
else if (cam === "ice"){ camera.position.set(6.9, 1.5, 1.9); camera.lookAt(5.1, 0.6, -0.6); }
else if (cam === "candy"){ camera.position.set(1.9, 1.9, 2.6); camera.lookAt(1.2, 1.2, -0.4); }
else if (cam === "wide"){ camera.position.set(0, 5, 14); camera.lookAt(0, 0.6, -1); }
else { camera.position.set(0.3, 3.1, 8.6); camera.lookAt(0.3, 0.75, -0.2); }

// постобработка (необязательно; модуль post.js может ещё не существовать)
let post = null;
if (qp.get("post") === "1"){
  try {
    const { createPost } = await import("../src/look/post.js");
    post = createPost({ THREE, renderer, scene, camera, quality, qp, G: { speed: 0, swarmNear: 0 } });
  } catch (e){ console.warn("post.js недоступен:", e.message); }
}

addEventListener("resize", () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  if (post) post.setSize(innerWidth, innerHeight);
});

const draw = dt => post ? post.render(dt) : renderer.render(scene, camera);
draw(1 / 60);
const info = renderer.info;
window.LOOK = { look, renderer, scene, camera, tLook,
  stats: () => ({ look: look.stats(), programs: info.programs.length, calls: info.render.calls, tLook: Math.round(tLook) }) };
document.getElementById("info").textContent =
  `q=${quality}  createLook ${Math.round(tLook)} ms  programs ${info.programs.length}  calls ${info.render.calls}`;
document.title = "SHOT_READY";

if (qp.get("anim") === "1"){
  let last = performance.now();
  renderer.setAnimationLoop(() => {
    const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000); last = now;
    const a = now * 0.00012, R = 8.6;
    camera.position.set(Math.sin(a) * R, 3.1, Math.cos(a) * R); camera.lookAt(0.3, 0.75, -0.2);
    for (let i = 1; i < N * 3; i += 3){ pos[i] -= dt * 0.6; if (pos[i] < 0) pos[i] += 7; }
    flakesGeo.attributes.position.needsUpdate = true;
    draw(dt);
  });
}
