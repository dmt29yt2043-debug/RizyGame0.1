// Стенд постобработки: сцена в масштабе игры со всем look-стеком (materials + curve + post), камера 2.2,
// свет, небо-купол и туман из LIGHTS (библия 2.1). Проверка LOOK-1/5/6/7.
// ?q=off|low|med|high  ?speed=0..1 (intensity)  ?danger=0..1  ?flash=мс после удара  ?boost=1  ?over=1  ?tunnel=1
// ?spike=0..0.3  ?t=сек (фаза пульса)  ?cam=close  ?bend=0  ?aa=0  ?view=ao  ?hideui=1  ?shot=1
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { installCurve } from "../src/look/curve.js";
import { installNeutralToneMapping } from "../src/look/tonemap.js";
import { createLook, LIGHTS } from "../src/look/materials.js";
import { createPost } from "../src/look/post.js";

const qp = new URLSearchParams(location.search);
const num = (k, d) => (qp.has(k) ? +qp.get(k) : d);
const Q = qp.get("q") || "med";
let seed = 7;
const rnd = (a = 0, b = 1) => { seed = (seed * 16807) % 2147483647; return a + (b - a) * (seed - 1) / 2147483646; };

// ---------- РЕНДЕР ----------
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance", preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
installNeutralToneMapping(renderer, LIGHTS.exposure);   // прямой рендер (q=off) — та же кривая, что в посте
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(LIGHTS.fog.color, LIGHTS.fog.near, LIGHTS.fog.far);
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 400);
if (qp.get("cam") === "close") { camera.fov = 45; camera.position.set(2.8, 1.7, 3.6); camera.lookAt(0, 0.9, -1.2); }
else { camera.position.set(0, 3.8, 6.4); camera.lookAt(0, 1.0, -10); }
camera.updateProjectionMatrix();

const G = { mode: "play", speed: 12, swarmNear: 0, dist: 0 };
const ctx = { THREE, renderer, scene, camera, quality: Q === "off" ? "med" : Q, qp, G, cfg: { swarmTime: 5.5 }, look: {} };
const curve = qp.get("bend") === "0" ? null : installCurve(ctx, {});
ctx.look.curve = curve;
const look = await createLook(ctx);
ctx.look.mats = look;

// ---------- НЕБО-КУПОЛ LOOK-8 (+ нарисованный диск солнца: азимут −30°, высота 12°) ----------
const discDir = new THREE.Vector3(-Math.sin(Math.PI / 6) * Math.cos(0.21), Math.sin(0.21), -Math.cos(Math.PI / 6) * Math.cos(0.21)).normalize();
const sky = new THREE.Mesh(new THREE.SphereGeometry(300, 32, 16), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: { uTop: { value: new THREE.Color(LIGHTS.sky.top) }, uHor: { value: new THREE.Color(LIGHTS.sky.horizon) }, uSun: { value: discDir } },
  vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`,
  fragmentShader: `varying vec3 vDir; uniform vec3 uTop, uHor, uSun;
    void main(){
      vec3 d = normalize(vDir); float y = d.y;
      vec3 c = y >= 0.0 ? mix(uHor, uTop, pow(clamp(y * 1.6 + 0.08, 0.0, 1.0), 0.6)) : uHor * 0.96;
      float s = dot(d, uSun);
      c += smoothstep(0.9990, 0.9996, s) * 8.0 + pow(max(s, 0.0), 64.0) * 0.6;
      gl_FragColor = vec4(c, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
}));
sky.renderOrder = -1; sky.frustumCulled = false; sky.userData.noCurve = true;
scene.add(sky);

// ---------- СВЕТ (LIGHTS) ----------
const L = LIGHTS;
scene.add(new THREE.HemisphereLight(L.hemi.sky, L.hemi.ground, L.hemi.intensity));
const sun = new THREE.DirectionalLight(L.sun.color, L.sun.intensity);
sun.target.position.fromArray(L.sun.target);
sun.position.fromArray(L.sun.dir).multiplyScalar(L.sun.distance).add(sun.target.position);
sun.castShadow = Q !== "low";
sun.shadow.mapSize.setScalar(Q === "high" ? L.shadow.mapSize.high : L.shadow.mapSize.med);
Object.assign(sun.shadow.camera, { left: L.shadow.left, right: L.shadow.right, top: L.shadow.top, bottom: L.shadow.bottom, near: L.shadow.near, far: L.shadow.far });
sun.shadow.bias = L.shadow.bias; sun.shadow.normalBias = L.shadow.normalBias;
scene.add(sun, sun.target);
const fill = new THREE.DirectionalLight(L.fill.color, L.fill.intensity);
fill.position.fromArray(L.fill.dir).multiplyScalar(20);
scene.add(fill);

function add(geo, m, x, y, z, cast = true, recv = true) {
  const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = cast; o.receiveShadow = recv;
  scene.add(o); return o;
}

// ---------- ТРАССА (сегменты по 1 м: изгибу есть что гнуть) ----------
const ground = add(new THREE.PlaneGeometry(160, 220, 16, 220), look.snow({ repeat: [16, 22] }), 0, -0.02, -100, false, true);
ground.rotation.x = -Math.PI / 2;
const deck = add(new THREE.PlaneGeometry(8.2, 220, 1, 220), look.wood({ repeat: [1, 34] }), 0, 0.01, -100, false, true);
deck.rotation.x = -Math.PI / 2;
// синие бордюры бренда (#0536D4) и снежные валы
const curbG = new THREE.BoxGeometry(0.4, 0.34, 220, 1, 1, 220);
for (const s of [-1, 1]) add(curbG, look.candy(0x0536D4), s * 4.3, 0.17, -100);
const moundG = new THREE.SphereGeometry(1, 32, 18);
const moundM = look.snow({ repeat: 1.2 });
for (let i = 0; i < 30; i++) {
  const side = i % 2 ? 1 : -1, z = 4 - i * 3.6 - rnd(0, 1.5);
  const m = add(moundG, moundM, side * rnd(5.4, 8.5), 0, z);
  m.scale.set(rnd(1.2, 2.2), rnd(0.45, 0.9), rnd(1.2, 2.0));
}
// войлочные ёлки (декор ≤ 45% насыщенности)
const coneG = new THREE.ConeGeometry(1, 1.6, 24);
const trunkM = look.felt(0x9a6a4a), treeA = look.felt(0x6fae8a), treeB = look.felt(0x5f9e86), capM = look.snow({ sparkle: 0 });
for (let i = 0; i < 16; i++) {
  const side = i % 2 ? -1 : 1, x = side * rnd(9, 14), z = -2 - i * 6.5 - rnd(0, 3), s = rnd(1.1, 1.7);
  add(new THREE.CylinderGeometry(0.18 * s, 0.22 * s, 0.8 * s, 10), trunkM, x, 0.4 * s, z);
  const tm = i % 3 ? treeA : treeB;
  for (let k = 0; k < 3; k++) {
    const c = add(coneG, tm, x, (1.2 + k * 0.85) * s, z); c.scale.setScalar(s * (1.35 - k * 0.3));
    const cap = add(coneG, capM, x, (1.55 + k * 0.85) * s, z); cap.scale.set(s * (0.75 - k * 0.2), s * 0.42, s * (0.75 - k * 0.2));
  }
}
// фонари: лампочки 4 (светятся)
const lampM = look.glow(0xFFD58A, 4), poleM = look.felt(0x3a4a8a);
for (let i = 0; i < 7; i++) for (const s of [-1, 1]) {
  const z = -6 - i * 12 - (s > 0 ? 6 : 0);
  add(new THREE.CylinderGeometry(0.07, 0.09, 3.2, 12), poleM, s * 5.0, 1.6, z);
  add(new THREE.SphereGeometry(0.24, 20, 14), lampM, s * 5.0, 3.3, z, false, false);
}

// ---------- ИГРОВОЕ: препятствия (≥ 75% насыщенности, без лайма), энергоны, Гаситель ----------
const boxG = new RoundedBoxGeometry(1.9, 0.95, 1.0, 4, 0.16);
[[-2.55, -12, 0xFF3B5C], [2.55, -20, 0xFF7A1A], [0, -30, 0xFF3B5C], [-2.55, -42, 0x8A3BFF], [2.55, -52, 0xFF3B5C]]
  .forEach(([x, z, c]) => add(boxG, look.candy(c, { stripe: 0xffffff, stripes: 3, repeat: [2, 1] }), x, 0.48, z));
// энергоны: оболочка 1.2 (не светится), ядро 3.5
const shellG = new THREE.OctahedronGeometry(0.34, 0), coreG = new THREE.TorusGeometry(0.2, 0.05, 10, 24);
const shellM = look.glow(0xC0FF3F, 1.2, { roughness: 0.25 }), coreM = look.glow(0xC0FF3F, 3.5);
for (let i = 0; i < 7; i++) {
  const z = -6 - i * 1.7;
  const sh = add(shellG, shellM, 2.55, 1.0, z, true, false); sh.scale.set(0.8, 1.1, 0.8); sh.rotation.y = 0.6;
  add(coreG, coreM, 2.55, 1.0, z + 0.02, false, false);
}
// Гаситель: тёмный войлок с синим sheen, глаз 5
const kub = add(new THREE.SphereGeometry(0.7, 32, 24), look.felt(0x1B1B2C, { sheenColor: 0x3050ff }), -2.55, 1.3, -7.5);
add(new THREE.SphereGeometry(0.19, 20, 14), look.glow(0xFF2436, 5), -2.55, 1.36, -6.85, false, false);
kub.scale.set(1, 0.92, 1);

// «Ризи»-заглушка: небесно-голубая кожа, лаймовое каре, лаймовый шарф, синий рюкзак, чёрные кеды
const hero = o => Object.assign({ hero: true }, o);
add(new THREE.CapsuleGeometry(0.36, 0.62, 8, 24), look.felt(0x111522, hero()), 0, 0.82, 0);        // свитер
add(new THREE.SphereGeometry(0.33, 32, 20), look.felt(0x5CC0EC, hero()), 0, 1.62, 0);              // голова
add(new THREE.SphereGeometry(0.35, 32, 20), look.felt(0xC0FF3F, hero()), 0, 1.72, 0.05);            // каре
const scarf = add(new THREE.TorusGeometry(0.33, 0.1, 14, 40), look.felt(0xC0FF3F, hero()), 0, 1.28, 0);
scarf.rotation.x = Math.PI / 2;
add(new RoundedBoxGeometry(0.58, 0.64, 0.28, 3, 0.1), look.felt(0x0536D4, hero()), 0, 0.98, 0.4);  // рюкзак
for (const s of [-1, 1]) add(new RoundedBoxGeometry(0.24, 0.16, 0.42, 2, 0.06), look.felt(0x15151c, hero()), s * 0.18, 0.08, 0.04);

// снег в воздухе — мягкие точки
{
  const N = 1500, pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { pos[i * 3] = rnd(-20, 20); pos[i * 3 + 1] = rnd(0, 12); pos[i * 3 + 2] = rnd(-80, 6); }
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  scene.add(new THREE.Points(g, new THREE.PointsMaterial({ map: look.tex.softDot, size: 0.09, transparent: true, depthWrite: false, opacity: 0.9 })));
}
if (curve) curve.patch(scene);

// ---------- ПОСТ ----------
const post = Q === "off" ? null : createPost(ctx);
ctx.look.post = post;
if (post) {
  post.setSignals({
    intensity: num("speed", 0), danger: num("danger", 0), boost: qp.get("boost") === "1",
    over: qp.get("over") === "1", tunnel: qp.get("tunnel") === "1",
  });
  const VIEWS = { ao: "Denoise", ao_raw: "AO", normal: "Normal", depth: "Depth" };
  if (VIEWS[qp.get("view")] && post.passes.gtao) post.passes.gtao.output = GTAOPass.OUTPUT[VIEWS[qp.get("view")]];
}
const applyAA = () => { if (post && qp.get("aa") === "0") { post.passes.fxaa.enabled = false; if (post.passes.smaa) post.passes.smaa.enabled = false; } };
addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  if (post) post.setSize(innerWidth, innerHeight); else renderer.setSize(innerWidth, innerHeight);
});
function frame(dt) { if (post) post.render(dt); else renderer.render(scene, camera); }

// ---------- ТЕСТЫ ----------
const grab = () => {
  const c = document.createElement("canvas"); c.width = renderer.domElement.width; c.height = renderer.domElement.height;
  const g = c.getContext("2d"); g.drawImage(renderer.domElement, 0, 0); return { d: g.getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height };
};
function lab(r8, g8, b8) {
  const f = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const r = f(r8), g = f(g8), b = f(b8);
  const X = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047, Y = 0.2126 * r + 0.7152 * g + 0.0722 * b, Z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const t = v => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116);
  return [116 * t(Y) - 16, 500 * (t(X) - t(Y)), 200 * (t(Y) - t(Z))];
}
const dE = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const _p = new THREE.Vector3();
window.TEST = {
  post, renderer, scene, camera, look, curve,
  info: () => JSON.stringify({ q: Q, calls: renderer.info.render.calls, tris: renderer.info.render.triangles, programs: renderer.info.programs.length,
    passes: post ? post.composer.passes.filter(x => x.enabled).map(x => x.constructor.name + (x === post.passes.grade ? "(Final)" : "") + (x === post.passes.fxaa ? "(FXAA)" : "")) : ["direct"],
    state: post ? post.state : null, dpr: renderer.getPixelRatio() }),
  // линейный HDR до поста: max-канал солнечной трассы у Ризи и снега, сколько бесцветных пикселей выше порога
  hdr() {
    const w = 320, h = 180, rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.FloatType });
    renderer.setRenderTarget(rt); renderer.render(scene, camera); renderer.setRenderTarget(null);
    const px = new Float32Array(w * h * 4); renderer.readRenderTargetPixels(rt, 0, 0, w, h, px); rt.dispose();
    const all = [], deckA = [], snowA = []; let over = 0, overWhite = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, r = px[i], g = px[i + 1], b = px[i + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      all.push(mx);
      if (mx > 1.2) { over++; if ((mx - mn) / mx < 0.15) overWhite++; }
      const u = x / w, v = y / h;   // v = 0 внизу кадра
      if (v > 0.08 && v < 0.2 && Math.abs(u - 0.5) > 0.12 && Math.abs(u - 0.5) < 0.22) deckA.push(mx);
      if (v > 0.05 && v < 0.25 && (u < 0.08 || u > 0.92)) snowA.push(mx);
    }
    const pc = (a, f) => { a.sort((p, q) => p - q); return a.length ? +a[Math.floor((a.length - 1) * f)].toFixed(3) : null; };
    return JSON.stringify({ p50: pc(all, 0.5), p99: pc(all, 0.99), deckP90: pc(deckA, 0.9), snowP50: pc(snowA, 0.5), snowP90: pc(snowA, 0.9), over12: over, over12white: overWhite, total: all.length });
  },
  // бренд: цвет на экране в освещённых точках шарфа (лайм) и бордюра (синий), ΔE76 к эталону
  brand() {
    const { d, w, h } = grab();
    const at = (x, y, z) => { _p.set(x, y, z); if (curve) curve.bendPoint(_p); _p.project(camera);
      const px = Math.round((_p.x * 0.5 + 0.5) * w), py = Math.round((0.5 - _p.y * 0.5) * h), i = (py * w + px) * 4; return [d[i], d[i + 1], d[i + 2]]; };
    const LIME = lab(0xC0, 0xFF, 0x3F), BLUE = lab(0x05, 0x36, 0xD4);
    const scarfPx = at(-0.3, 1.36, 0.1), curbPx = at(-4.3, 0.34, -3), curbSide = at(4.1, 0.2, -3), shell = at(2.49, 1.12, -5.9);
    return JSON.stringify({ shell, dEshell: +dE(lab(...shell), LIME).toFixed(1),
      scarf: scarfPx, dEscarf: +dE(lab(...scarfPx), LIME).toFixed(1), curbTop: curbPx, dEcurbTop: +dE(lab(...curbPx), BLUE).toFixed(1),
      curbSide, dEcurbSide: +dE(lab(...curbSide), BLUE).toFixed(1) });
  },
};

(async () => {
  if (post) { await post.ready; applyAA(); }
  const t = num("t", 0.0);
  if (post && qp.has("spike")) post.bloomSpike(num("spike", 0), 400);
  if (post && qp.has("flash")) { post.hit(); frame(Math.max(0.001, num("flash", 60) / 1000) + t); }
  else frame(t || 1 / 60);
  const info = document.getElementById("info");
  info.textContent = `q=${Q} speed=${num("speed", 0)} danger=${num("danger", 0)}` + (qp.has("flash") ? ` flash+${num("flash", 60)}ms` : "") +
    (qp.get("boost") === "1" ? " boost" : "") + (qp.get("over") === "1" ? " over" : "") + (qp.get("tunnel") === "1" ? " tunnel" : "") + ` calls=${renderer.info.render.calls}`;
  if (qp.get("hideui") === "1") info.hidden = true;
  if (qp.has("shot")) { document.title = "SHOT_READY"; return; }
  let last = performance.now();
  const loop = (now) => { const dt = Math.min(0.05, (now - last) / 1000); last = now; G.dist += 20 * dt; if (curve) curve.update(dt, G); frame(dt); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
})();
