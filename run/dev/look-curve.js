// Стенд «изогнутого мира» (LOOK-4) в кадре игровой камеры библии 2.2 (y 3.8, z 6.4, lookAt (0,1,−10), FOV 60):
// 300 м трассы (шаг 1 м), ряды InstancedMesh-кубов, столбы со Sprite-ореолами, Points (снег + маркеры по оси),
// препятствия, отбрасывающие тени на согнутую трассу, горы с curveSoft, задник с noCurve.
// ?bend=0|1  ?k=uKy  ?sway=-1..1  ?cam=game|shadow|side|top  ?extra=1 (все типы материалов)  ?live=1
// Кадр рисуется один раз → SHOT_READY. window.TEST: cull() — проверка отсечения, idem() — идемпотентность patch.
import * as THREE from "three";
import { installCurve } from "../src/look/curve.js";
import { installNeutralToneMapping } from "../src/look/tonemap.js";
import { LIGHTS } from "../src/look/materials.js";

const QP = new URLSearchParams(location.search);
const BEND = QP.get("bend") !== "0";
const SWAY = +(QP.get("sway") || 0);
const CAM = QP.get("cam") || "game";
const LIVE = QP.has("live");
let seed = 7;
const rnd = (a, b) => { seed = (seed * 16807) % 2147483647; return a + (seed / 2147483647) * (b - a); };

const W = innerWidth, H = innerHeight;
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(W, H);
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
installNeutralToneMapping(renderer, LIGHTS.exposure);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(LIGHTS.fog.color, LIGHTS.fog.near, LIGHTS.fog.far);
scene.background = new THREE.Color(LIGHTS.fog.color);

const camera = new THREE.PerspectiveCamera(60, W / H, 0.1, 400);

// изгиб: чанки уже пропатчены импортом; install связывает сцену и живые значения
const ctx = { THREE, renderer, scene, camera };
const K = QP.has("k") ? +QP.get("k") : undefined;
const curve = installCurve(ctx, BEND ? (K !== undefined ? { bendY: K } : {}) : { bendY: 0, swayX: 0 });
if (SWAY) curve.setSway(SWAY > 0 ? 0.25 : 0.75, Math.abs(SWAY));

// ---------- небо-купол LOOK-8 (без изгиба, без тумана, следует за камерой) ----------
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: { uTop: { value: new THREE.Color(LIGHTS.sky.top) }, uHor: { value: new THREE.Color(LIGHTS.sky.horizon) } },
  vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`,
  fragmentShader: `varying vec3 vDir; uniform vec3 uTop, uHor;
    void main(){ float y = vDir.y; vec3 c = y >= 0.0 ? mix(uHor, uTop, pow(clamp(y * 1.6 + 0.08, 0.0, 1.0), 0.6)) : uHor * 0.96;
      gl_FragColor = vec4(c, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(300, 32, 16), skyMat);
sky.renderOrder = -1; sky.frustumCulled = false; sky.userData.noCurve = true;
scene.add(sky);

const cams = {
  game:   () => { camera.fov = 60; camera.position.set(0, 3.8, 6.4); camera.lookAt(0, 1.0, -10); },
  // крупный план теней под согнутыми препятствиями на 34–46 м (провал 0.6–1.1 м): камера целится в согнутую точку
  shadow: () => { const T = curve.bendPoint(new THREE.Vector3(0, 0, -40)); camera.fov = 30; camera.position.set(T.x + 9, T.y + 7, T.z + 16); camera.lookAt(T.x, T.y, T.z); },
  side:   () => { camera.fov = 38; camera.position.set(70, 4, -45); camera.lookAt(0, -6, -50); },
  top:    () => { camera.fov = 50; camera.position.set(0, 60, -40); camera.lookAt(0, 0, -41); },
};
(cams[CAM] || cams.game)();
camera.updateProjectionMatrix();
sky.position.copy(camera.position);

// ---------- свет (числа LIGHTS = библия LOOK-2/3) ----------
const L = LIGHTS;
scene.add(new THREE.HemisphereLight(L.hemi.sky, L.hemi.ground, L.hemi.intensity + 0.35));   // +0.35: на стенде нет PMREM
const sun = new THREE.DirectionalLight(L.sun.color, L.sun.intensity);
sun.target.position.fromArray(L.sun.target);
sun.position.fromArray(L.sun.dir).multiplyScalar(L.sun.distance).add(sun.target.position);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: L.shadow.left, right: L.shadow.right, top: L.shadow.top, bottom: L.shadow.bottom, near: L.shadow.near, far: L.shadow.far });
sun.shadow.bias = L.shadow.bias; sun.shadow.normalBias = L.shadow.normalBias;
scene.add(sun, sun.target);
const fill = new THREE.DirectionalLight(L.fill.color, L.fill.intensity);
fill.position.fromArray(L.fill.dir).multiplyScalar(20);
scene.add(fill);

// ---------- дорога: 300 м, сегменты по 1 м ----------
const roadTex = (() => {
  const c = document.createElement("canvas"); c.width = 128; c.height = 128;
  const g = c.getContext("2d");
  g.fillStyle = "#eef3fb"; g.fillRect(0, 0, 128, 128);
  g.fillStyle = "#8fa6d8"; g.fillRect(40, 0, 3, 128); g.fillRect(85, 0, 3, 128);
  g.fillStyle = "#d4dcea"; g.fillRect(0, 0, 128, 6);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1, 75); t.anisotropy = 8;
  return t;
})();
const roadGeo = new THREE.PlaneGeometry(9, 300, 4, 300); roadGeo.rotateX(-Math.PI / 2); roadGeo.translate(0, 0, -140);
const road = new THREE.Mesh(roadGeo, new THREE.MeshStandardMaterial({ map: roadTex, roughness: .8 }));
road.receiveShadow = true; scene.add(road);
const bankGeo = new THREE.PlaneGeometry(90, 300, 12, 300); bankGeo.rotateX(-Math.PI / 2); bankGeo.translate(0, -0.02, -140);
const banks = new THREE.Mesh(bankGeo, new THREE.MeshLambertMaterial({ color: 0xf2f6ff }));
banks.receiveShadow = true; scene.add(banks);
// синие бордюры (полосы бренда) — лучше всего видно изгиб вбок
const curbGeo = new THREE.BoxGeometry(0.35, 0.3, 300, 1, 1, 300); curbGeo.translate(0, 0.15, -140);
const curbMat = new THREE.MeshStandardMaterial({ color: 0x0536D4, roughness: .45 });
for (const x of [-4.7, 4.7]){ const c = new THREE.Mesh(curbGeo, curbMat); c.position.x = x; c.castShadow = c.receiveShadow = true; scene.add(c); }

// ---------- ряды инстанс-кубов по обе стороны (декор) ----------
const N = 150;
const boxes = new THREE.InstancedMesh(new THREE.BoxGeometry(1.3, 1.6, 1.3), new THREE.MeshStandardMaterial({ roughness: .7 }), N);
const m4 = new THREE.Matrix4(), col = new THREE.Color();
for (let i = 0; i < N; i++){
  const side = i % 2 ? 1 : -1, z = 2 - Math.floor(i / 2) * 4;
  m4.makeTranslation(side * 6.4, 0.8, z);
  boxes.setMatrixAt(i, m4);
  boxes.setColorAt(i, col.setHSL((0.55 + i * 0.013) % 1, .35, .72));
}
boxes.castShadow = boxes.receiveShadow = true; scene.add(boxes);

// ---------- столбы со спрайтами на макушке ----------
const glow = (() => {
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const g = c.getContext("2d"), gr = g.createRadialGradient(32, 32, 1, 32, 32, 32);
  gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(.35, "rgba(255,200,120,.9)"); gr.addColorStop(1, "rgba(255,200,120,0)");
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
})();
const poleGeo = new THREE.CylinderGeometry(0.12, 0.16, 5, 10, 5); poleGeo.translate(0, 2.5, 0);
const poleMat = new THREE.MeshStandardMaterial({ color: 0x3a4a8a, roughness: .5 });
const spriteMat = new THREE.SpriteMaterial({ map: glow, transparent: true, depthWrite: false });
for (const z of [-8, -20, -32, -44, -56, -68, -80, -92, -110]){
  for (const x of [-5.4, 5.4]){
    const p = new THREE.Mesh(poleGeo, poleMat); p.position.set(x, 0, z); p.castShadow = true; scene.add(p);
    const s = new THREE.Sprite(spriteMat); s.position.set(x, 5.25, z); s.scale.set(1.1, 1.1, 1); scene.add(s);
  }
}

// ---------- препятствия на дороге (яркие, отбрасывают тень) ----------
const obst = [
  [0xff5c7a, -2.55, -14], [0x7ec3ff, 2.55, -26], [0xffb020, 0, -38], [0xff5c7a, -2.55, -44],
  [0x8a5cff, 2.55, -52], [0xff7eb6, 0, -64], [0xffb020, -2.55, -80], [0x7ec3ff, 2.55, -100],
];
for (const [c, x, z] of obst){
  const b = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.1, 1.2), new THREE.MeshStandardMaterial({ color: c, roughness: .45 }));
  b.position.set(x, 0.55, z); b.castShadow = b.receiveShadow = true; scene.add(b);
  // «гирлянда»: высокая арка — длинная тень хорошо видна на согнутой трассе
  if (z === -44){
    const arch = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.16, 10, 32, Math.PI), new THREE.MeshStandardMaterial({ color: 0xff3b5c, roughness: .4 }));
    arch.position.set(2.2, 0, z - 4); arch.castShadow = true; scene.add(arch);
  }
}

// ---------- Points: снег и маркеры по оси дороги (маркеры обязаны лежать на согнутой дороге) ----------
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
scene.add(new THREE.Points(snowGeo, new THREE.PointsMaterial({ color: 0xffffff, size: .22, map: dot, transparent: true, depthWrite: false })));
const mk = [];
for (let z = 0; z > -140; z -= 1.5) mk.push(0, 0.12, z);
const mkGeo = new THREE.BufferGeometry(); mkGeo.setAttribute("position", new THREE.Float32BufferAttribute(mk, 3));
scene.add(new THREE.Points(mkGeo, new THREE.PointsMaterial({ color: 0xff0080, size: .3, map: dot, transparent: true, depthWrite: false })));

// ---------- дальние горы: мягкий изгиб (curveSoft) ----------
const mtnMat = new THREE.MeshLambertMaterial({ color: 0xcfdcf5 });
for (let i = 0; i < 9; i++){
  const m = new THREE.Mesh(new THREE.ConeGeometry(rnd(14, 24), rnd(16, 30), 7), mtnMat);
  m.position.set(-90 + i * 22 + rnd(-6, 6), 6, -150 - rnd(0, 25)); m.userData.curveSoft = true; scene.add(m);
}

// ---------- задник без изгиба (проверка userData.noCurve) ----------
const back = new THREE.Mesh(new THREE.PlaneGeometry(420, 10), new THREE.MeshBasicMaterial({ color: 0xbfd2f0, fog: false }));
back.position.set(0, 5, -215); back.userData.noCurve = true; scene.add(back);

// ---------- ?extra=1: остальные типы материалов, точечная тень, свой ShaderMaterial ----------
if (QP.has("extra")){
  const pl = new THREE.PointLight(0xffaa66, 60, 30); pl.position.set(0, 4, -20); pl.castShadow = true;
  pl.shadow.mapSize.set(256, 256); scene.add(pl);
  const ball = new THREE.SphereGeometry(0.7, 20, 12);
  const mats = [
    new THREE.MeshPhongMaterial({ color: 0xffd166 }), new THREE.MeshToonMaterial({ color: 0x06d6a0 }),
    new THREE.MeshMatcapMaterial({ color: 0xef476f }), new THREE.MeshNormalMaterial(),
    new THREE.MeshStandardMaterial({ color: 0x118ab2, flatShading: true }),
    new THREE.MeshPhysicalMaterial({ color: 0xC0FF3F, sheen: 1, clearcoat: 1 }),
  ];
  mats.forEach((m, i) => {
    const s = new THREE.Mesh(ball, m); s.position.set(-3 + i * 1.2, 0.7, -18 - i * 5);
    s.castShadow = s.receiveShadow = true; scene.add(s);
  });
  const shadowCatcher = new THREE.Mesh(new THREE.PlaneGeometry(4, 20, 2, 20).rotateX(-Math.PI / 2), new THREE.ShadowMaterial({ opacity: .3 }));
  shadowCatcher.position.set(0, 0.03, -30); shadowCatcher.receiveShadow = true; scene.add(shadowCatcher);
  const lineGeo = new THREE.BufferGeometry().setFromPoints(Array.from({ length: 120 }, (_, i) => new THREE.Vector3(-4.4, 0.35, -i)));
  const line = new THREE.Line(lineGeo, new THREE.LineDashedMaterial({ color: 0x0536d4, dashSize: .5, gapSize: .3 }));
  line.computeLineDistances(); scene.add(line);
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
  const nc = new THREE.Mesh(new THREE.BoxGeometry(1, 3, 1), new THREE.MeshStandardMaterial({ color: 0x333333 }));
  nc.position.set(-2.5, 1.5, -42); nc.castShadow = true; nc.userData.noCurve = true; scene.add(nc);
}

curve.patch(scene);
const progAfter1 = () => renderer.info.programs.length;

const hud = document.getElementById("hud");
function frame(){
  sky.position.copy(camera.position);
  renderer.render(scene, camera);
  const i = renderer.info.render;
  hud.textContent = `bend=${BEND ? 1 : 0} k=${curve.uniforms.bendY.value} sway=${curve.sway.toFixed(2)} cam=${CAM} ` +
    `bendX=${curve.uniforms.bendX.value.toFixed(5)} calls=${i.calls} tris=${i.triangles} progs=${renderer.info.programs.length}`;
  if (QP.get("hideui") === "1") hud.hidden = true;
}

// ---------- тесты ----------
const _v = new THREE.Vector3(), _fr = new THREE.Frustum(), _pm = new THREE.Matrix4();
window.TEST = {
  // отсечение: для каждого Mesh/Points с прокси сравнить «видим по прокси» с «видим хоть одной согнутой вершиной»
  cull(){
    const GPU = curve.uniforms.curveParams.value, LIVEv = [curve.uniforms.bendX.value, curve.uniforms.bendY.value, curve.uniforms.start.value, curve.uniforms.originZ.value];
    camera.updateMatrixWorld(); _pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); _fr.setFromProjectionMatrix(_pm);
    let checked = 0, falseCull = 0, trueVisible = 0, proxyVisible = 0; const bad = [];
    GPU.set(LIVEv);
    scene.traverse(o => {
      if (!(o.isMesh || o.isPoints) || o.isInstancedMesh || o === sky || o.userData.noCurve) return;
      checked++;
      const soft = o.userData.curveSoft;
      const pos = o.geometry.attributes.position; let vis = false;
      for (let i = 0; i < pos.count && !vis; i++){
        _v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
        curve.bendPoint(_v, soft);
        _v.applyMatrix4(_pm);
        if (Math.abs(_v.x) <= 1 && Math.abs(_v.y) <= 1 && _v.z >= -1 && _v.z <= 1) vis = true;
      }
      const pv = _fr.intersectsObject(o);
      if (vis) trueVisible++; if (pv) proxyVisible++;
      if (vis && !pv){ falseCull++; bad.push(o.position.toArray().map(v => +v.toFixed(1))); }
    });
    GPU.fill(0);
    return JSON.stringify({ checked, trueVisible, proxyVisible, falseCull, bad: bad.slice(0, 5) });
  },
  // идемпотентность: повторный patch не меняет программы и не пересобирает материалы
  idem(){
    const p0 = renderer.info.programs.length, v0 = road.material.version;
    curve.patch(scene); curve.patch(scene); curve.patch([road, boxes]);
    renderer.render(scene, camera);
    const again = installCurve(ctx, {}) === curve;
    return JSON.stringify({ programsBefore: p0, programsAfter: renderer.info.programs.length, materialVersionSame: road.material.version === v0, sameApi: again,
      instancedCulled: boxes.frustumCulled, spriteCulled: scene.children.find(o => o.isSprite).frustumCulled });
  },
  // CPU-проверка чисел библии: провал на 60 м и на спавне −118, горизонт
  numbers(){
    const k = curve.uniforms.bendY.value, h = 3.8, a = 12.4;
    return JSON.stringify({ k, drop60: +curve.dropAt(-60).toFixed(2), drop118: +curve.dropAt(-118).toFixed(2), horizon: +(-a + Math.sqrt(a * a + h / k) + 6).toFixed(1) });
  },
  // покачивание по дистанции: профиль sway на 0..720 м при скорости 30
  swayProfile(){
    const G = { mode: "play", dist: 0, speed: 30 }, out = [];
    const c2 = installCurve({ scene: new THREE.Scene() }, {});
    for (let t = 0; t <= 26; t += 1 / 30){ G.dist = t * 30; c2.update(1 / 30, G); if (Math.abs((t * 30) % 30) < 1) out.push([Math.round(t * 30), +c2.sway.toFixed(2)]); }
    return JSON.stringify(out);
  },
};
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
