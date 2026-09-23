// Небо и фон: градиент персик → розовый → лаванда, большой бледный диск солнца с ореолом,
// плоские облака, силуэты Идеалити в три слоя по глубине (кубические дома, башни, купола-биосферы,
// флажки, окошки) и холмы. Слои — настоящие объекты на своих z: параллакс даёт перспективная камера.
// Каждый слой — один меш (MeshBasic, цвета вершин), всего ~8 draw call'ов.
import * as THREE from "three";
import { PAL, CAM } from "../config.js";
import { Batch } from "./geo.js";
import { makeRng } from "./tex.js";

const TAN = Math.tan(THREE.MathUtils.degToRad(CAM.fov / 2));
const CAM_Y_REF = 2 + CAM.height;                    // типичная высота камеры
const PITCH = (CAM.height - CAM.lookUp) / CAM.dist;  // tan наклона вниз
// высота точки слоя на расстоянии D, которая при типичной камере видна на экранной высоте ndc (−1 низ … 1 верх)
const Yndc = (ndc, D) => CAM_Y_REF + D * (ndc * TAN - PITCH);

// ---------- НЕБО: плоскость у камеры ----------
const SKY_VERT = /* glsl */`
  varying vec2 vP;
  uniform float uHalf;
  void main(){
    vec2 sc = vec2(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz));   // масштаб плоскости
    vP = position.xy * sc / uHalf;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;
const SKY_FRAG = /* glsl */`
  varying vec2 vP;
  uniform vec3 uTop, uMid, uLow, uSun, uHalo;
  uniform vec2 uSunPos;
  uniform float uSunR;
  float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  void main(){
    float y = vP.y;
    vec3 c = mix(uLow, uMid, smoothstep(-0.55, 0.25, y));
    c = mix(c, uTop, smoothstep(0.15, 1.05, y));
    // солнце: мягкий ореол, светлое кольцо и диск
    float d = length(vP - uSunPos);
    float halo = exp(-max(d - uSunR, 0.0) / (uSunR * 0.55));
    c = mix(c, uHalo, halo * 0.55);
    float ring = smoothstep(uSunR * 1.16, uSunR * 1.0, d);
    c = mix(c, mix(uHalo, uSun, 0.55), ring * 0.8);
    float disc = smoothstep(uSunR + 0.004, uSunR - 0.004, d);
    c = mix(c, uSun * 1.06, disc);
    c += (hash(gl_FragCoord.xy) - 0.5) / 255.0;            // дизеринг против полос
    gl_FragColor = vec4(c, 1.0);
    #include <colorspace_fragment>
  }`;

export function createSky(camera){
  const col = h => new THREE.Color(h);
  const DIST = 900;
  const half = DIST * TAN;
  const mat = new THREE.ShaderMaterial({
    vertexShader: SKY_VERT, fragmentShader: SKY_FRAG,
    uniforms: {
      uTop: { value: col(PAL.skyTop) }, uMid: { value: col(PAL.skyMid) }, uLow: { value: col(PAL.skyLow) },
      uSun: { value: col(PAL.sun) }, uHalo: { value: col(PAL.sunHalo) },
      uSunPos: { value: new THREE.Vector2(0.88, -0.1) }, uSunR: { value: 0.44 }, uHalf: { value: half },
    },
    depthWrite: false, depthTest: false, fog: false,
  });
  const geo = new THREE.PlaneGeometry(1, 1);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = "sky";
  mesh.renderOrder = -100;
  mesh.frustumCulled = false;
  mesh.position.set(0, 0, -DIST);
  camera.add(mesh);
  const fit = aspect => {
    mesh.scale.set(half * 2 * aspect * 1.15, half * 2 * 1.15, 1);
    // солнце держим в правой трети при любом соотношении сторон
    mat.uniforms.uSunPos.value.set(Math.min(0.88 * aspect / 1.78, aspect - 0.55), -0.1);
  };
  fit(camera.aspect);
  return { mesh, fit };
}

// ---------- ОБЛАКА ----------
function cloudShape(w, h, rnd){
  // плоское «чечевичное» облако: плоское дно, 2–3 мягких горба сверху
  const s = new THREE.Shape();
  const n = 28, bumps = 2 + ((rnd() * 2) | 0), ph = rnd() * 6;
  s.moveTo(-w / 2, 0);
  for (let i = 0; i <= n; i++){
    const t = i / n, x = -w / 2 + w * t;
    const env = Math.pow(Math.sin(Math.PI * t), 0.7);
    const bump = 0.65 + 0.35 * Math.sin(t * Math.PI * bumps * 2 + ph);
    s.lineTo(x, h * env * bump);
  }
  s.lineTo(w / 2, 0);
  s.lineTo(-w / 2, 0);
  return s;
}

// ---------- ГОРОД ИДЕАЛИТИ ----------
// Размеры задаём в «видимых» единицах (как если бы стояло в плоскости игры; экран ≈ 13.8 ед. в высоту,
// земля — на 3/4 вниз), потом масштабируем на f = D / dist. Стиль: far — мелкая плотная линия крыш,
// mid — башни с конусами и флажками, кубы и купола-биосферы, near — редкие высокие башни.
function cityLayer(opts){
  const { D, x0, x1, baseNdc, color, roof, win, lit, seed, style = "mid" } = opts;
  const rnd = makeRng(seed);
  const b = new Batch();
  const f = D / CAM.dist;
  const z = CAM.dist - D;                 // камера на z = dist
  const yb = Yndc(baseNdc, D);
  const deep = yb - 40 * f;               // низ силуэтов — далеко за кадром
  const zw = z + 0.25 * f;                // окна и детали — чуть ближе к камере
  const R = (a, b2) => a + (b2 - a) * rnd();
  const V = (x, y, zz) => new THREE.Vector3(x, y, zz);
  const rect = (x, y, w, h, c, zz = z) => b.quad(V(x, y, zz), V(x + w, y, zz), V(x + w, y + h, zz), V(x, y + h, zz), null, c);
  const tri = (xa, ya, xb, yb2, xc, yc, c, zz = z) => {
    const s = new THREE.Shape(); s.moveTo(xa, ya); s.lineTo(xb, yb2); s.lineTo(xc, yc); s.closePath();
    const g = new THREE.ShapeGeometry(s); b.add(g, new THREE.Matrix4().makeTranslation(0, 0, zz), c); g.dispose();
  };
  const halfDisc = (cx, cy, r, c, zz = z) => { const g = new THREE.CircleGeometry(r, 32, 0, Math.PI); b.add(g, new THREE.Matrix4().makeTranslation(cx, cy, zz), c); g.dispose(); };
  const flagOn = (x, y, h) => {
    rect(x - 0.03 * f, y, 0.06 * f, h * f, roof, zw);
    tri(x + 0.03 * f, y + h * f, x + 0.62 * f, y + (h - 0.14) * f, x + 0.03 * f, y + (h - 0.3) * f, [0xf6b9d3, 0xb4c2ff, 0xdcff8f, 0xfff0c2][(rnd() * 4) | 0], zw);
  };
  // окна-щели как в референсе: узкие вертикальные прямоугольники
  const slitsF = (x, y, w, h, n, rows) => {
    const sw = 0.13 * f, sh = 0.3 * f;
    for (let j = 0; j < rows; j++) for (let i = 0; i < n; i++){
      if (rnd() < 0.2) continue;
      const cx = x + w * (i + 0.5) / n, cy = y + h - (j + 0.7) * h / (rows + 0.4);
      rect(cx - sw / 2, cy - sh / 2, sw, sh, (lit && rnd() < 0.18) ? lit : win, zw);
    }
  };
  const gridF = (x, y, w, h, cols, rows) => {
    const s2 = 0.2 * f, gx = w / cols, gy = h / rows;
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++){
      if (rnd() < 0.3) continue;
      rect(x + gx * (i + 0.5) - s2 / 2, y + gy * (j + 0.5) - s2 / 2, s2, s2, (lit && rnd() < 0.15) ? lit : win, zw);
    }
  };
  // ---- постройки ----
  const tower = (x, hMul = 1) => {
    const w = R(0.75, 1.15) * f, h = R(1.9, 3.1) * hMul * f;
    rect(x, deep, w, yb - deep + h, color);
    // зубцы
    const n = 3;
    for (let i = 0; i < n; i++) rect(x + (i * 2) * w / (2 * n - 1), yb + h, w / (2 * n - 1), 0.14 * f, color);
    slitsF(x + w * 0.15, yb + h * 0.25, w * 0.7, h * 0.65, 1, 2);
    if (rnd() < 0.72){
      const rh = R(0.9, 1.4) * f;
      tri(x - 0.12 * f, yb + h, x + w + 0.12 * f, yb + h, x + w / 2, yb + h + rh, roof);
      if (rnd() < 0.8) flagOn(x + w / 2, yb + h + rh - 0.05 * f, 0.55);
    } else {
      halfDisc(x + w / 2, yb + h, w * 0.5, roof);
      rect(x + w / 2 - 0.03 * f, yb + h + w * 0.45, 0.06 * f, 0.45 * f, roof);
    }
    return w;
  };
  const house = (x, hMul = 1) => {
    const w = R(1.2, 2.3) * f, h = R(0.8, 1.7) * hMul * f;
    rect(x, deep, w, yb - deep + h, color);
    gridF(x + 0.1 * f, yb + 0.15 * f, w - 0.2 * f, h - 0.3 * f, Math.max(2, Math.round(w / f / 0.5)), Math.max(1, Math.round(h / f / 0.55)));
    if (rnd() < 0.55){ const c2 = R(0.45, 0.8) * f; rect(x + R(0.15, 0.55) * (w - c2), yb + h, c2, c2, roof); }
    return w;
  };
  const biodome = (x) => {
    const r = R(1.1, 1.8) * f, hb = R(0.15, 0.4) * f, w = r * 2;
    rect(x, deep, w, yb - deep + hb, color);
    halfDisc(x + r, yb + hb, r, color);
    // сетка биокупола как у глобуса: меридианы — полуэллипсы, параллели — горизонтальные хорды
    const th = 0.05 * f;
    for (const k of [0.38, 0.75]){
      const g = new THREE.RingGeometry(r * 0.97 - th / 2, r * 0.97 + th / 2, 28, 1, 0, Math.PI);
      b.add(g, new THREE.Matrix4().compose(V(x + r, yb + hb, zw), new THREE.Quaternion(), V(k, 1, 1)), win); g.dispose();
    }
    rect(x + r - th / 2, yb + hb, th, r * 0.97, win, zw);
    for (const s of [0.33, 0.66]){
      const hw = r * Math.cos(Math.asin(s)) * 0.97;
      rect(x + r - hw, yb + hb + r * s - th / 2, hw * 2, th, win, zw);
    }
    rect(x + r - 0.03 * f, yb + hb + r, 0.06 * f, 0.4 * f, roof, zw);
    return w;
  };
  const ziggurat = (x) => {
    const w = R(1.8, 2.8) * f;
    rect(x, deep, w, yb - deep, color);
    let yy = yb, ww = w, xx = x;
    for (let k = 0; k < 3; k++){
      const h = R(0.35, 0.6) * f;
      rect(xx, yy, ww, h, k % 2 ? roof : color);
      yy += h; xx += ww * 0.18; ww *= 0.64;
    }
    return w;
  };
  const cubes = (x) => {
    let w = 0;
    const n = 2 + ((rnd() * 2) | 0);
    for (let k = 0; k < n; k++){
      const a = R(0.6, 1.1) * f, h = R(0.5, 1.4) * f;
      rect(x + w, deep, a, yb - deep + h, k % 2 ? roof : color);
      w += a;
    }
    return w;
  };

  let x = x0 + R(0, 3) * f;
  while (x < x1){
    const t = rnd();
    let w;
    if (style === "near"){
      w = tower(x, 1.45);
      x += w + R(22, 36) * f;
      continue;
    }
    if (style === "far"){
      if (t < 0.28) w = tower(x, 0.75); else if (t < 0.4) w = biodome(x) ; else if (t < 0.75) w = house(x, 0.8); else w = cubes(x);
      x += w + R(0.0, 0.5) * f;
      continue;
    }
    if (t < 0.12) w = biodome(x);
    else if (t < 0.42) w = tower(x);
    else if (t < 0.68) w = house(x);
    else if (t < 0.82) w = ziggurat(x);
    else w = cubes(x);
    x += w + R(0.2, 2.2) * f;
  }
  const mesh = new THREE.Mesh(b.build(), new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }));
  mesh.matrixAutoUpdate = false;
  return mesh;
}

// холмы: мягкая линия из синусов, заливка вниз далеко за кадр
function hills(opts){
  const { D, x0, x1, ndc, amp, color, seed, bottom = -3 } = opts;
  const rnd = makeRng(seed);
  const f = D / CAM.dist, z = CAM.dist - D;
  const yb = Yndc(ndc, D);
  const deep = Yndc(bottom, D);
  const s = new THREE.Shape();
  const n = 220;
  const p1 = rnd() * 6, p2 = rnd() * 6, p3 = rnd() * 6;
  const w1 = 0.021 / f, w2 = 0.053 / f, w3 = 0.11 / f;
  s.moveTo(x0, deep);
  for (let i = 0; i <= n; i++){
    const x = x0 + (x1 - x0) * i / n;
    const y = yb + amp * f * (0.55 * Math.sin(x * w1 + p1) + 0.3 * Math.sin(x * w2 + p2) + 0.15 * Math.sin(x * w3 + p3));
    s.lineTo(x, y);
  }
  s.lineTo(x1, deep); s.closePath();
  const b = new Batch();
  const g = new THREE.ShapeGeometry(s, 1);
  b.add(g, new THREE.Matrix4().makeTranslation(0, 0, z), color); g.dispose();
  const mesh = new THREE.Mesh(b.build(), new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }));
  mesh.matrixAutoUpdate = false;
  return mesh;
}

export function createBackdrop(level, aspectMax = 2.4){
  const group = new THREE.Group(); group.name = "backdrop";
  // запас по x: видимая полуширина на глубине D плюс весь ход камеры
  const span = D => ({ x0: level.minX - D * TAN * aspectMax - 10, x1: level.maxX + D * TAN * aspectMax + 10 });

  // облака
  {
    const D = 300, f = D / CAM.dist, z = CAM.dist - D, rnd = makeRng(5);
    const { x0, x1 } = span(D);
    const b = new Batch();
    // цвет неба на экранной высоте ndc (как в шейдере) → облако чуть светлее и розовее
    const cLow = new THREE.Color(PAL.skyLow), cMid = new THREE.Color(PAL.skyMid), cTop = new THREE.Color(PAL.skyTop), cW = new THREE.Color(0xfff2f4);
    const ss = (a, b2, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b2 - a))); return t * t * (3 - 2 * t); };
    const skyAt = y => cLow.clone().lerp(cMid, ss(-0.55, 0.25, y)).lerp(cTop, ss(0.15, 1.05, y));
    let lastNdc = 0.5;
    for (let x = x0; x < x1; x += R(rnd, 7, 16) * f){
      let ndc = R(rnd, 0.28, 0.92);
      if (Math.abs(ndc - lastNdc) < 0.18) ndc = ndc > 0.6 ? ndc - 0.3 : ndc + 0.3;   // соседи — на разной высоте
      lastNdc = ndc;
      const w = R(rnd, 2.6, 6.5) * f, h = R(rnd, 0.22, 0.42) * f;
      const g = new THREE.ShapeGeometry(cloudShape(w, h, rnd), 1);
      const c = skyAt(ndc - 0.2 * TAN).lerp(cW, R(rnd, 0.22, 0.34));
      b.add(g, new THREE.Matrix4().makeTranslation(x, Yndc(ndc, D), z), c.getHex());
      g.dispose();
    }
    const m = new THREE.Mesh(b.build(), new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }));
    m.name = "clouds";
    group.add(m);
    group.userData.clouds = m;
  }
  // дальний город: мелкая светлая линия крыш
  let s = span(190);
  group.add(Object.assign(cityLayer({ D: 190, ...s, baseNdc: -0.24, color: PAL.cityFar, roof: 0xd4b3d2, win: PAL.winFar, lit: null, seed: 31, style: "far" }), { name: "city-far" }));
  s = span(140);
  group.add(Object.assign(hills({ D: 140, ...s, ndc: -0.29, amp: 0.55, color: PAL.hillFar, seed: 41 }), { name: "hills-far" }));
  // средний город: башни с флажками, кубы, купола-биосферы
  s = span(100);
  group.add(Object.assign(cityLayer({ D: 100, ...s, baseNdc: -0.36, color: PAL.cityMid, roof: 0xbc9fd0, win: PAL.winMid, lit: PAL.winLit, seed: 53, style: "mid" }), { name: "city-mid" }));
  s = span(66);
  group.add(Object.assign(hills({ D: 66, ...s, ndc: -0.45, amp: 0.8, color: PAL.hillNear, seed: 61 }), { name: "hills-near" }));
  // ближние башни — редкие
  s = span(44);
  group.add(Object.assign(cityLayer({ D: 44, ...s, baseNdc: -0.72, color: PAL.cityNear, roof: 0x9d8acb, win: PAL.winNear, lit: PAL.winLit, seed: 71, style: "near" }), { name: "city-near" }));
  // низ за пропастями: светлая дымка-холмы
  s = span(34);
  group.add(Object.assign(hills({ D: 34, ...s, ndc: -0.74, amp: 0.7, color: 0xd9c1e0, seed: 83, bottom: -4 }), { name: "hills-low" }));
  return {
    group,
    update(t){ const c = group.userData.clouds; if (c) c.position.x = (t * 0.6) % 400; },
  };
}
function R(rnd, a, b){ return a + (b - a) * rnd(); }
