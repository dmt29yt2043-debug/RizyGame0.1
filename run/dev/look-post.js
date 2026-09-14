// Стенд постобработки: яркая снежная сцена в масштабе игры (камера, свет, туман как в run.js).
// ?q=off|low|med|high  ?speed=  ?danger=  ?neutral=1 (грейд/bloom в ноль — для сверки цвета с post off)
// ?aa=0  ?view=ao (только AO)  ?cam=close  ?t=сек  ?bloom= ?vig= ?warm= ?sat=
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { createPost } from "../src/look/post.js";

const qp = new URLSearchParams(location.search);
const num = (k, d) => (qp.has(k) ? +qp.get(k) : d);
const Q = qp.get("q") || "med";

// сидированный рандом, чтобы кадры совпадали
let seed = 7;
const rnd = (a = 0, b = 1) => { seed = (seed * 16807) % 2147483647; return a + (b - a) * (seed - 1) / 2147483646; };

function canvasTex(w, h, draw, rep) {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (rep) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep[0], rep[1]); }
  t.anisotropy = 8;
  return t;
}

// ---------- РЕНДЕР ----------
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance", preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.18;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xdaeeff, 34, 128);
scene.background = canvasTex(64, 256, (g, w, h) => {
  const gr = g.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0.00, "#6fc3ff"); gr.addColorStop(0.42, "#a9dcff"); gr.addColorStop(0.72, "#daeeff");
  gr.addColorStop(0.88, "#ffe9e4"); gr.addColorStop(1.00, "#fff3e0");
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
});

const camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.1, 400);
if (qp.get("cam") === "close") { camera.position.set(2.6, 1.6, 3.2); camera.lookAt(0, 0.7, -1.5); }
else { camera.position.set(0, 3.05, 5.45); camera.lookAt(0, 1.35, -8); }

// ---------- СВЕТ (как в игре) ----------
scene.add(new THREE.HemisphereLight(0xcfe8ff, 0xfff0dc, 1.05));
const sun = new THREE.DirectionalLight(0xfff2da, 2.35);
sun.position.set(11, 17, 7);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 12, bottom: -34, near: 1, far: 62 });
sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.02;
sun.target.position.set(0, 0, -12);
scene.add(sun, sun.target);
const fill = new THREE.DirectionalLight(0xbfd8ff, 0.5);
fill.position.set(-9, 7, 4);
scene.add(fill);

// ---------- МАТЕРИАЛЫ ----------
const felt = (c) => new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.92, sheen: 1, sheenRoughness: 0.6,
  sheenColor: new THREE.Color(c).lerp(new THREE.Color(0xffffff), 0.5) });
const snowM = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
const glow = (c, i) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: i, roughness: 0.35 });
function add(geo, m, x, y, z, cast = true, recv = true) {
  const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = cast; o.receiveShadow = recv;
  scene.add(o); return o;
}

// ---------- ЗЕМЛЯ ----------
const snowTex = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = "#ffffff"; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 500; i++) {
    g.fillStyle = `rgba(186,214,255,${rnd(0.05, 0.18)})`;
    g.beginPath(); g.arc(rnd(0, w), rnd(0, h), rnd(1, 3.6), 0, 7); g.fill();
  }
}, [24, 64]);
// ?seg=N — разбить огромные плоскости (как для «изогнутого мира»); seg=1 — один квад, проверка NaN-страховки GTAO
const SEG = Math.max(1, num("seg", 1) | 0);
const ground = add(new THREE.PlaneGeometry(200, 340, 4, SEG), new THREE.MeshStandardMaterial({ color: 0xffffff, map: snowTex, roughness: 1 }), 0, -0.03, -120, false, true);
ground.rotation.x = -Math.PI / 2;
const road = add(new THREE.PlaneGeometry(7.6, 340, 1, SEG), new THREE.MeshStandardMaterial({ color: 0xe8c49a, roughness: 0.85 }), 0, 0, -120, false, true);
road.rotation.x = -Math.PI / 2;
// поперечные доски (много тонких краёв — проверка AA)
const plankG = new THREE.BoxGeometry(7.4, 0.04, 0.08);
const plankM = new THREE.MeshStandardMaterial({ color: 0xb98a5e, roughness: 0.9 });
for (let z = 4; z > -90; z -= 1.3) add(plankG, plankM, 0, 0.01, z, false, true);

// снежные намёты
const moundG = new THREE.SphereGeometry(1, 32, 18);
for (let i = 0; i < 26; i++) {
  const side = i % 2 ? 1 : -1, z = 3 - i * 4.2 - rnd(0, 2);
  const m = add(moundG, snowM, side * rnd(5.2, 9), 0, z);
  m.scale.set(rnd(1.4, 2.6), rnd(0.5, 1.1), rnd(1.3, 2.4));
}

// войлочные ёлки со снежными шапками
const coneG = new THREE.ConeGeometry(1, 1.6, 20);
const trunkM = felt(0xb9764a);
for (let i = 0; i < 14; i++) {
  const side = i % 2 ? -1 : 1, x = side * rnd(8.5, 13), z = -2 - i * 7 - rnd(0, 3), s = rnd(1, 1.6);
  add(new THREE.CylinderGeometry(0.18 * s, 0.22 * s, 0.8 * s, 10), trunkM, x, 0.4 * s, z);
  const tm = felt(i % 3 ? 0x7fd89a : 0x5fc48a);
  for (let k = 0; k < 3; k++) {
    const c = add(coneG, tm, x, (1.2 + k * 0.85) * s, z);
    c.scale.setScalar(s * (1.35 - k * 0.3));
    const cap = add(coneG, snowM, x, (1.55 + k * 0.85) * s, z);
    cap.scale.set(s * (0.75 - k * 0.2), s * 0.45, s * (0.75 - k * 0.2));
  }
}

// пастельные войлочные ящики-препятствия
const boxG = new RoundedBoxGeometry(1.8, 0.9, 1.1, 4, 0.18);
[[-2.55, -9, 0xffb3d5], [2.55, -15, 0x7ec3ff], [0, -24, 0xffd2a8], [-2.55, -34, 0x7fd89a], [2.55, -44, 0xfff4e2]]
  .forEach(([x, z, c]) => add(boxG, felt(c), x, 0.45, z));

// «Ризи»-заглушка на центральной полосе: контактная тень для GTAO
const body = add(new THREE.CapsuleGeometry(0.42, 0.7, 8, 20), felt(0x5cc0ec), 0, 0.85, 0);
add(new THREE.SphereGeometry(0.34, 24, 16), felt(0x5cc0ec), 0, 1.72, 0);
add(new THREE.SphereGeometry(0.3, 24, 16), felt(0xd2f550), 0, 1.86, -0.06);
const scarf = add(new THREE.TorusGeometry(0.36, 0.1, 12, 32), felt(0xC0FF3F), 0, 1.36, 0);
scarf.rotation.x = Math.PI / 2;
add(new RoundedBoxGeometry(0.62, 0.7, 0.3, 3, 0.1), felt(0x2f6ff0), 0, 1.0, 0.42);   // рюкзак
add(new RoundedBoxGeometry(0.26, 0.16, 0.44, 2, 0.06), felt(0x111111), -0.2, 0.08, 0.05);
add(new RoundedBoxGeometry(0.26, 0.16, 0.44, 2, 0.06), felt(0x111111), 0.2, 0.08, 0.05);

// забор из тонких столбиков (лесенка без AA)
const postG = new THREE.CylinderGeometry(0.05, 0.05, 1.3, 8);
const railG = new THREE.BoxGeometry(0.05, 0.05, 2.2);
const fenceM = felt(0xfff4e2);
for (let i = 0; i < 16; i++) {
  for (const s of [-1, 1]) {
    add(postG, fenceM, s * 4.3, 0.65, 2 - i * 2.2);
    add(railG, fenceM, s * 4.3, 1.0, 0.9 - i * 2.2);
    add(railG, fenceM, s * 4.3, 0.55, 0.9 - i * 2.2);
  }
}

// эмиссивы: энергоны, фонари, лаймовый шар, Гаситель с красным глазом
const coinG = new THREE.TorusGeometry(0.32, 0.11, 14, 32);
const coinM = glow(0xff2f92, 2.6);
for (let i = 0; i < 6; i++) { const c = add(coinG, coinM, 2.55, 1.0, -5 - i * 1.6, true, false); c.rotation.y = 0.5; }
const lampM = glow(0xffc75e, 3.2);
for (let i = 0; i < 5; i++) {
  for (const s of [-1, 1]) {
    add(new THREE.CylinderGeometry(0.07, 0.09, 3, 10), felt(0x3a4a8a), s * 5.2, 1.5, -3 - i * 11);
    add(new THREE.SphereGeometry(0.28, 20, 14), lampM, s * 5.2, 3.15, -3 - i * 11, false, false);
  }
}
add(new THREE.SphereGeometry(0.45, 24, 16), glow(0xC0FF3F, 2.4), -2.55, 1.2, -18, false, false);
const kub = add(new THREE.SphereGeometry(0.7, 28, 20), felt(0x2a2440), -2.55, 1.0, -6.5);
add(new THREE.SphereGeometry(0.2, 20, 14), glow(0xff3a4e, 4.0), -2.55, 1.05, -5.85, false, false);
kub.scale.set(1, 0.92, 1);

// солнечное сияние (спрайт, как в игре)
const glowTex = canvasTex(128, 128, (g, w, h) => {
  const gr = g.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
  gr.addColorStop(0, "rgba(255,252,236,1)"); gr.addColorStop(0.28, "rgba(255,240,190,.8)"); gr.addColorStop(1, "rgba(255,240,190,0)");
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
});
const sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, fog: false }));
sunGlow.position.set(30, 33, -140); sunGlow.scale.set(58, 58, 1);
scene.add(sunGlow);

// ---------- ПОСТ ----------
const ctx = { THREE, renderer, scene, camera, quality: Q === "off" ? "med" : Q, qp, look: {} };
const post = Q === "off" ? null : createPost(ctx);
if (post) {
  const p = post.params;
  p.speedBlur = num("speed", 0);
  p.danger = num("danger", 0);
  if (qp.has("bloom")) p.bloom = +qp.get("bloom");
  if (qp.has("vig")) p.vignette = +qp.get("vig");
  if (qp.has("warm")) p.warmth = +qp.get("warm");
  if (qp.has("sat")) p.saturation = +qp.get("sat");
  if (qp.get("neutral") === "1") Object.assign(p, { bloom: 0, vignette: 0, saturation: 1, warmth: 0, contrast: 1, grain: 0 });
  // отладка GTAO: ao (после денойза) | ao_raw | normal | depth
  const VIEWS = { ao: "Denoise", ao_raw: "AO", normal: "Normal", depth: "Depth" };
  if (VIEWS[qp.get("view")] && post.passes.gtao) post.passes.gtao.output = GTAOPass.OUTPUT[VIEWS[qp.get("view")]];
}
const applyAA = () => { if (post && qp.get("aa") === "0") { post.passes.fxaa.enabled = false; if (post.passes.smaa) post.passes.smaa.enabled = false; } };

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  if (post) post.setSize(innerWidth, innerHeight); else renderer.setSize(innerWidth, innerHeight);
});

function frame(dt) {
  if (post) post.render(dt); else renderer.render(scene, camera);
}

// ---------- ТЕСТЫ (window.TEST) ----------
const TEST = {
  post, renderer, scene, camera,
  info: () => JSON.stringify({ q: Q, calls: renderer.info.render.calls, passes: post ? post.composer.passes.filter(x => x.enabled).map(x => x.constructor.name + (x.material && x.material.fragmentShader && x.material.fragmentShader.includes("FXAA") ? "(FXAA)" : "") + (x === post.passes.grade ? "(Grade)" : "")) : ["direct"] }),
  // среднее расхождение (0..255) между post off и нейтральным пост-кадром
  async diff() {
    const w = renderer.domElement.width, h = renderer.domElement.height;
    const grab = () => { const c = document.createElement("canvas"); c.width = w; c.height = h; const g = c.getContext("2d"); g.drawImage(renderer.domElement, 0, 0); return g.getImageData(0, 0, w, h).data; };
    renderer.render(scene, camera); const A = grab();
    const pp = post.params, keep = Object.assign({}, pp);
    Object.assign(pp, { bloom: 0, vignette: 0, saturation: 1, warmth: 0, contrast: 1, grain: 0, speedBlur: 0, danger: 0 });
    const fx = post.passes.fxaa.enabled, sm = post.passes.smaa && post.passes.smaa.enabled, ao = post.passes.gtao && post.passes.gtao.enabled;
    post.passes.fxaa.enabled = false; if (post.passes.smaa) post.passes.smaa.enabled = false; if (post.passes.gtao) post.passes.gtao.enabled = false;
    post.render(0); const B = grab();
    Object.assign(pp, keep); post.passes.fxaa.enabled = fx; if (post.passes.smaa) post.passes.smaa.enabled = sm; if (post.passes.gtao) post.passes.gtao.enabled = ao;
    let s = 0, sd = 0, mx = 0;
    for (let i = 0; i < A.length; i += 4) for (let k = 0; k < 3; k++) { const d = B[i + k] - A[i + k]; s += Math.abs(d); sd += d; mx = Math.max(mx, Math.abs(d)); }
    const n = A.length / 4 * 3;
    return JSON.stringify({ meanAbs: +(s / n).toFixed(3), meanSigned: +(sd / n).toFixed(3), maxAbs: mx });
  },
  // линейный HDR: максимум канала по «снегу» и по эмиссивам (что пройдёт порог bloom)
  hdr() {
    const w = 320, h = 180, rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.FloatType });
    renderer.setRenderTarget(rt); renderer.render(scene, camera); renderer.setRenderTarget(null);
    const px = new Float32Array(w * h * 4); renderer.readRenderTargetPixels(rt, 0, 0, w, h, px); rt.dispose();
    const arr = []; let over = 0, overWhite = 0;
    for (let i = 0; i < px.length; i += 4) {
      const r = px[i], g = px[i + 1], b = px[i + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      arr.push(mx); if (mx > 1.15) { over++; if ((mx - mn) / mx < 0.1) overWhite++; }
    }
    arr.sort((a, b) => a - b);
    const pc = f => +arr[Math.floor(arr.length * f)].toFixed(3);
    return JSON.stringify({ p50: pc(0.5), p90: pc(0.9), p99: pc(0.99), p999: pc(0.999), max: +arr[arr.length - 1].toFixed(2), over115: over, over115white: overWhite, total: arr.length });
  },
};
window.TEST = TEST;

(async () => {
  if (post) { await post.ready; applyAA(); }
  const t = num("t", 0.231);          // пик пульса опасности
  frame(t);
  document.getElementById("info").textContent = `q=${Q} speed=${num("speed", 0)} danger=${num("danger", 0)}` + (qp.get("neutral") === "1" ? " neutral" : "") + (qp.get("aa") === "0" ? " aa=0" : "");
  if (qp.get("hideui") === "1") document.getElementById("info").hidden = true;
  if (qp.has("shot")) { document.title = "SHOT_READY"; return; }
  let last = performance.now();
  const loop = (now) => { const dt = Math.min(0.05, (now - last) / 1000); last = now; frame(dt); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
})();
