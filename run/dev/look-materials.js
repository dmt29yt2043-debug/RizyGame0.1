// Стенд материалов: снежная студия со светом библии (LIGHTS), PBR Neutral и линейкой образцов из src/look/materials.js.
// ?q=low|med|high  ?cam=close|wood|snow|ice|candy|brand|wide  ?env=0 (без PMREM)  ?post=1 (через post.js)
// ?key=morning|noon|golden|blue  ?anim=1 (крутить, не для скриншотов)
// window.LOOK.brand() — ΔE76 бренда в освещённых точках; LOOK.ratio() — тень/свет в линейном HDR.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { createLook, LIGHTS, SKY_KEYS, sunDir } from "../src/look/materials.js";
import { installNeutralToneMapping } from "../src/look/tonemap.js";

const qp = new URLSearchParams(location.search);
const quality = ["low", "med", "high"].includes(qp.get("q")) ? qp.get("q") : "med";
const KEY = SKY_KEYS[qp.get("key")] ? qp.get("key") : "morning", K = SKY_KEYS[KEY];

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
installNeutralToneMapping(renderer, LIGHTS.exposure);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(46, innerWidth / innerHeight, 0.1, 300);

const t0 = performance.now();
const envOpts = {};
if (qp.has("envSky")) envOpts.envSky = +qp.get("envSky");
if (qp.has("envGround")) envOpts.envGround = +qp.get("envGround");
if (qp.has("envTint")) envOpts.envTint = +qp.get("envTint");
const look = await createLook({ THREE, renderer, scene, quality }, Object.assign({ key: KEY }, envOpts));
const tLook = performance.now() - t0;
if (qp.get("env") === "0") scene.environment = null;

// небо-купол ключа (фон — забота стенда) и туман цвета горизонта
{
  const sky = new THREE.Mesh(new THREE.SphereGeometry(150, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uTop: { value: new THREE.Color(K.top) }, uHor: { value: new THREE.Color(K.horizon) } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`,
    fragmentShader: `varying vec3 vDir; uniform vec3 uTop, uHor;
      void main(){ float y = vDir.y; vec3 c = y >= 0.0 ? mix(uHor, uTop, pow(clamp(y * 1.6 + 0.08, 0.0, 1.0), 0.6)) : uHor * 0.96;
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }));
  sky.renderOrder = -1; scene.add(sky);
}
scene.fog = new THREE.Fog(K.horizon, LIGHTS.fog.near, LIGHTS.fog.far);

// свет библии (для ключей сценария — цвет/сила/высота солнца и hemi из SKY_KEYS)
const Lg = LIGHTS;
scene.add(new THREE.HemisphereLight(Lg.hemi.sky, Lg.hemi.ground, +(qp.get("hemi") || K.hemi)));
const sun = new THREE.DirectionalLight(KEY === "morning" ? Lg.sun.color : K.sun, KEY === "morning" ? Lg.sun.intensity : K.sunI);
sun.position.fromArray(KEY === "morning" ? Lg.sun.dir : sunDir(K.elev)).multiplyScalar(30);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, near: 1, far: 70 });
sun.shadow.bias = Lg.shadow.bias; sun.shadow.normalBias = Lg.shadow.normalBias;
scene.add(sun, sun.target);
const fill = new THREE.DirectionalLight(Lg.fill.color, Lg.fill.intensity);
fill.position.fromArray(Lg.fill.dir).multiplyScalar(20);
scene.add(fill);

const add = (geo, mat, x, y, z, cast = true) => {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z);
  m.castShadow = cast; m.receiveShadow = true; scene.add(m); return m;
};

// снежная земля и сугробы
const ground = add(new THREE.PlaneGeometry(120, 120), look.snow({ repeat: 14 }), 0, 0, 0, false);
ground.rotation.x = -Math.PI / 2;
const mound = add(new THREE.SphereGeometry(1.6, 64, 32), look.snow({ repeat: 1.5 }), -3.2, -0.2, -2.6);
mound.scale.set(1.35, 0.62, 1);
const mound2 = add(new THREE.SphereGeometry(1.0, 48, 24), look.snow({ repeat: 1.5 }), -0.9, -0.15, -3.2);
mound2.scale.set(1.2, 0.7, 1);

// войлочные шары: лайм бренда, небесно-голубая кожа, розовый, тёмный Гаситель + помпон
const felts = [[0xC0FF3F, -4.6], [0x5CC0EC, -3.3], [0xFF7EB6, -2.0], [0x1B1B2C, -0.7]];
const feltBalls = felts.map(([c, x]) => add(new THREE.SphereGeometry(0.55, 64, 40), look.felt(c, { hero: c === 0xC0FF3F || c === 0x5CC0EC }), x, 0.55, 0.9));
add(new THREE.SphereGeometry(0.28, 48, 32), look.felt(0xffffff), -0.7, 1.35, 0.9);

// леденец: палочка + спираль + ободок
{
  const x = 0.9, y = 1.55, z = 0.5;
  add(new THREE.CylinderGeometry(0.05, 0.05, 1.6, 16), look.candy(0xffffff), x, 0.8, z);
  const discMats = [look.candy(0xff5fae), look.candy(0xff5fae, { stripe: 0xffffff, pattern: "swirl", stripes: 4 }),
                    look.candy(0xff5fae, { stripe: 0xffffff, pattern: "swirl", stripes: 4 })];
  const disc = add(new THREE.CylinderGeometry(0.62, 0.62, 0.2, 64), discMats, x, y, z);
  disc.rotation.x = Math.PI / 2;
  add(new THREE.TorusGeometry(0.62, 0.1, 20, 64), look.candy(0xff5fae), x, y, z);
}
// карамельная арка (трость)
{
  class Arc extends THREE.Curve {
    getPoint(t, out = new THREE.Vector3()){ const a = Math.PI * t; return out.set(Math.cos(a) * 1.1, Math.sin(a) * 1.5, 0); }
  }
  add(new THREE.TubeGeometry(new Arc(), 96, 0.12, 20), look.candy(0xFF3B5C, { stripe: 0xffffff, stripes: 2, repeat: [10, 1] }), 2.6, 0, -2.4);
}
add(new THREE.BoxGeometry(3.2, 0.14, 1.8), look.wood({ repeat: [1, 1] }), 2.9, 0.07, 0.6);
add(new RoundedBoxGeometry(1.1, 1.1, 1.1, 5, 0.12), look.ice(), 5.3, 0.55, -0.6);
add(new THREE.CylinderGeometry(0.06, 0.08, 1.4, 20), look.metal(0xdfe4ee), 4.6, 0.7, 1.3);
add(new THREE.SphereGeometry(0.22, 40, 24), look.glow(0xFFD58A, 4), 4.6, 1.55, 1.3, false);           // лампочка 4
add(new THREE.SphereGeometry(0.3, 40, 24), look.metal(0xffb84a, { roughness: 0.22 }), 3.6, 0.44, 1.5);
// энергон: оболочка 1.2 + ядро 3.5
add(new THREE.OctahedronGeometry(0.3, 0), look.glow(0xC0FF3F, 1.2, { roughness: 0.25 }), 1.9, 0.45, 2.0, true).scale.set(0.8, 1.1, 0.8);
add(new THREE.TorusGeometry(0.17, 0.045, 10, 24), look.glow(0xC0FF3F, 3.5), 1.9, 0.45, 2.02, false);

// ряд бренда: лаймовый леденец-куб, синий леденец-куб (бордюр), синий войлок (рюкзак), лаймовый войлок (шарф)
const brandRow = [
  ["lime candy", look.candy(0xC0FF3F), 0xC0FF3F, -2.9], ["blue candy", look.candy(0x0536D4), 0x0536D4, -1.7],
  ["blue felt", look.felt(0x0536D4, { hero: true }), 0x0536D4, -0.5], ["lime felt", look.felt(0xC0FF3F, { hero: true }), 0xC0FF3F, 0.7],
];
const brandMeshes = brandRow.map(([n, m, hex, x]) => { const o = add(new RoundedBoxGeometry(0.7, 0.7, 0.7, 4, 0.08), m, x, 0.35, 3.0); o.userData.brand = { n, hex }; return o; });

// блики-звёздочки и падающий снег: мягкие круглые точки
{
  const star = new THREE.SpriteMaterial({ map: look.tex.sparkle, color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  for (const [x, y, z, s] of [[5.65, 1.05, -0.05, 0.5], [-2.7, 0.8, -1.9, 0.35], [1.2, 1.95, 0.6, 0.4]]){
    const sp = new THREE.Sprite(star); sp.position.set(x, y, z); sp.scale.set(s, s, 1); scene.add(sp);
  }
}
const N = 900, pos = new Float32Array(N * 3);
{
  let a = 99;
  const r = () => { a = (a * 16807) % 2147483647; return a / 2147483647; };
  for (let i = 0; i < N; i++){ pos[i * 3] = (r() - 0.5) * 22; pos[i * 3 + 1] = r() * 7; pos[i * 3 + 2] = (r() - 0.5) * 16 - 2; }
}
const flakesGeo = new THREE.BufferGeometry();
flakesGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
scene.add(new THREE.Points(flakesGeo, new THREE.PointsMaterial({ map: look.tex.softDot, size: 0.07, sizeAttenuation: true,
  transparent: true, depthWrite: false, color: 0xffffff, opacity: 0.9 })));

// камера
const cam = qp.get("cam");
if (cam === "close"){ camera.position.set(-2.2, 1.6, 4.2); camera.lookAt(-2.2, 0.6, 0.4); }
else if (cam === "wood"){ camera.position.set(2.9, 1.6, 2.6); camera.lookAt(3.1, 0.2, 0.2); }
else if (cam === "snow"){ camera.position.set(-3.6, 1.3, 2.4); camera.lookAt(-2.4, 0.2, -2.2); }
else if (cam === "ice"){ camera.position.set(6.9, 1.5, 1.9); camera.lookAt(5.1, 0.6, -0.6); }
else if (cam === "candy"){ camera.position.set(1.9, 1.9, 2.6); camera.lookAt(1.2, 1.2, -0.4); }
else if (cam === "brand"){ camera.position.set(-1.1, 3.2, 5.6); camera.lookAt(-1.1, 0.35, 3.0); }
else if (cam === "wide"){ camera.position.set(0, 5, 14); camera.lookAt(0, 0.6, -1); }
else { camera.position.set(0.3, 3.3, 9.6); camera.lookAt(0.3, 0.75, 0.2); }

// постобработка (необязательно)
let post = null;
if (qp.get("post") === "1"){
  const { createPost } = await import("../src/look/post.js");
  post = createPost({ THREE, renderer, scene, camera, quality, qp });
  await post.ready;
}

addEventListener("resize", () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  if (post) post.setSize(innerWidth, innerHeight);
});

const draw = dt => post ? post.render(dt) : renderer.render(scene, camera);
draw(1 / 60);
const info = renderer.info;

// ---------- тесты цвета ----------
function lab(r8, g8, b8) {
  const f = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const r = f(r8), g = f(g8), b = f(b8);
  const X = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047, Y = 0.2126 * r + 0.7152 * g + 0.0722 * b, Z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const t = v => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116);
  return [116 * t(Y) - 16, 500 * (t(X) - t(Y)), 200 * (t(Y) - t(Z))];
}
const _p = new THREE.Vector3();
const hexArr = h => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
window.LOOK = { look, renderer, scene, camera, tLook,
  stats: () => ({ look: look.stats(), programs: info.programs.length, calls: info.render.calls, tLook: Math.round(tLook) }),
  // ΔE76 в точке передней грани кубов бренда (грань к камере, освещена солнцем и заполняющим)
  brand(){
    const c = document.createElement("canvas"), w = renderer.domElement.width, h = renderer.domElement.height;
    c.width = w; c.height = h; const g = c.getContext("2d"); g.drawImage(renderer.domElement, 0, 0);
    const out = {};
    for (const m of brandMeshes){
      // верхняя грань (к солнцу) и передняя (к камере): 3×3 пикселя
      const res = {};
      for (const [face, off] of [["top", [0, 0.351, 0.05]], ["front", [-0.12, 0.05, 0.351]]]){
        _p.set(m.position.x + off[0], m.position.y + off[1], m.position.z + off[2]).project(camera);
        const px = Math.round((_p.x * 0.5 + 0.5) * w), py = Math.round((0.5 - _p.y * 0.5) * h);
        const d = g.getImageData(px - 1, py - 1, 3, 3).data; let r = 0, gg = 0, b = 0;
        for (let i = 0; i < 36; i += 4){ r += d[i]; gg += d[i + 1]; b += d[i + 2]; }
        const pxc = [Math.round(r / 9), Math.round(gg / 9), Math.round(b / 9)];
        const L1 = lab(...pxc), L2 = lab(...hexArr(m.userData.brand.hex));
        res[face] = { rgb: pxc, dE: +Math.hypot(L1[0] - L2[0], L1[1] - L2[1], L1[2] - L2[2]).toFixed(1) };
      }
      out[m.userData.brand.n] = res;
    }
    return JSON.stringify(out);
  },
  // линейный HDR (до тонмаппинга): освещённая и теневая сторона белого войлочного помпона и земли
  ratio(){
    const w = renderer.domElement.width, h = renderer.domElement.height;
    const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.FloatType });
    renderer.setRenderTarget(rt); renderer.render(scene, camera); renderer.setRenderTarget(null);
    const read = (x, y, z) => { _p.set(x, y, z).project(camera);
      const px = Math.round((_p.x * 0.5 + 0.5) * w), py = Math.round((_p.y * 0.5 + 0.5) * h), a = new Float32Array(4);
      renderer.readRenderTargetPixels(rt, px, py, 1, 1, a); return [+a[0].toFixed(3), +a[1].toFixed(3), +a[2].toFixed(3)]; };
    const lum = a => 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
    const d = new THREE.Vector3().fromArray(LIGHTS.sun.dir);
    // точки на сфере-помпоне: к солнцу (видимая часть) и противоположная сторона (правая, к камере)
    const pc = new THREE.Vector3(-0.7, 1.35, 0.9), r = 0.28;
    const litN = new THREE.Vector3(d.x, d.y, 0.45).normalize(), shN = new THREE.Vector3(0.75, -0.1, 0.65).normalize();
    const lit = read(pc.x + litN.x * r, pc.y + litN.y * r, pc.z + litN.z * r), sh = read(pc.x + shN.x * r, pc.y + shN.y * r, pc.z + shN.z * r);
    const gLit = read(-2.5, 0, 4.5), gShadow = read(-2.2, 0, 3.0);
    rt.dispose();
    return JSON.stringify({ feltLit: lit, feltShadow: sh, feltRatio: +(lum(sh) / lum(lit)).toFixed(2),
      snowLit: gLit, snowInShadow: gShadow, snowRatio: +(lum(gShadow) / lum(gLit)).toFixed(2) });
  },
};
document.getElementById("info").textContent =
  `q=${quality} key=${KEY} createLook ${Math.round(tLook)} ms  programs ${info.programs.length}  calls ${info.render.calls}` + (post ? " post" : "");
if (qp.get("hideui") === "1") document.getElementById("info").hidden = true;
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
