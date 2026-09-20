// world-kit: утилиты — ГПСЧ, сглаживание, сборщик слитой геометрии с цветами вершин и «полосами»,
// заметание профиля вдоль z, инстансная «часть» (InstancedMesh с перезаписью списка), патч шейдеров.
import * as THREE from "three";

export function makeRng(seed){
  let a = (seed >>> 0) || 1;
  const r = () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  r.range = (lo, hi) => lo + r() * (hi - lo);
  r.int = n => Math.floor(r() * n);
  return r;
}
export const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
export const damp = (a, b, l, dt) => a + (b - a) * (1 - Math.exp(-l * dt));
export const smooth01 = x => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };

// матрица из позиции / поворота (рад, порядок XYZ) / масштаба — только на этапе сборки
const _e = new THREE.Euler(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
export function M(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx){
  _e.set(rx, ry, rz); _q.setFromEuler(_e);
  return new THREE.Matrix4().compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
}

// ---------- СБОРЩИК ----------
// Всё сливается в одну неиндексированную геометрию: position / normal / uv / color.
// uv.y = 1 означает «полосатая карамель»: шейдер кита чередует цвет вершины и белый по fract(uv.x).
// opts: { ao: [yBase, height, min] — затемнение у основания (запечённый AO), stripe: {...} }
//   stripe.kind "tube": uv.x = uv0.y·len/period + uv0.x·turns   (цилиндры, трубы, торы)
//   stripe.kind "diag": uv.x = (px + py)/period в локальных координатах детали (доски, бруски)
export class GeoBuilder {
  constructor(){ this.list = []; }
  add(geo, color, m, o){
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (!g.attributes.normal) g.computeVertexNormals();
    const n = g.attributes.position.count;
    const pos0 = g.attributes.position.array.slice(0);
    if (m) g.applyMatrix4(m);
    const pos = g.attributes.position.array;
    const uv0 = g.attributes.uv ? g.attributes.uv.array : null;
    const uv = new Float32Array(n * 2);
    const col = new Float32Array(n * 3);
    const c = new THREE.Color(color == null ? 0xffffff : color);
    const st = o && o.stripe, ao = o && o.ao;
    // keepColor: геометрия уже собрана сборщиком (готовые цвета и uv-флаги полос) — переносим как есть
    const srcC = o && o.keepColor && g.attributes.color ? g.attributes.color.array : null;
    for (let i = 0; i < n; i++){
      let k = 1;
      if (ao){ const t = clamp((pos[i * 3 + 1] - ao[0]) / ao[1], 0, 1); k = ao[2] + (1 - ao[2]) * t * t * (3 - 2 * t); }
      if (srcC){
        col[i * 3] = srcC[i * 3] * k; col[i * 3 + 1] = srcC[i * 3 + 1] * k; col[i * 3 + 2] = srcC[i * 3 + 2] * k;
        if (uv0){ uv[i * 2] = uv0[i * 2]; uv[i * 2 + 1] = uv0[i * 2 + 1]; }
        continue;
      }
      col[i * 3] = c.r * k; col[i * 3 + 1] = c.g * k; col[i * 3 + 2] = c.b * k;
      if (st){
        if (st.kind === "diag") uv[i * 2] = (pos0[i * 3] * (st.ax ?? 1) + pos0[i * 3 + 1] * (st.ay ?? 1) + pos0[i * 3 + 2] * (st.az ?? 0)) / st.period;
        else uv[i * 2] = (uv0 ? uv0[i * 2 + 1] : 0) * (st.len || 1) / st.period + (uv0 ? uv0[i * 2] : 0) * (st.turns ?? 1);
        uv[i * 2 + 1] = 1;
      } else if (uv0 && o && o.keepUV){ uv[i * 2] = uv0[i * 2]; uv[i * 2 + 1] = uv0[i * 2 + 1] * 0.49; }
    }
    this.list.push({ p: pos, n: g.attributes.normal.array, uv, col, count: n });
    g.dispose();
    return this;
  }
  get count(){ let s = 0; for (const x of this.list) s += x.count; return s; }
  build(){
    const N = this.count;
    const P = new Float32Array(N * 3), Nn = new Float32Array(N * 3), U = new Float32Array(N * 2), C = new Float32Array(N * 3);
    let o = 0;
    for (const x of this.list){ P.set(x.p, o * 3); Nn.set(x.n, o * 3); U.set(x.uv, o * 2); C.set(x.col, o * 3); o += x.count; }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(P, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(Nn, 3));
    g.setAttribute("uv", new THREE.BufferAttribute(U, 2));
    g.setAttribute("color", new THREE.BufferAttribute(C, 3));
    g.computeBoundingSphere(); g.computeBoundingBox();
    this.list.length = 0;
    return g;
  }
}

// заметание 2D-профиля [[x,y],…] вдоль z от z0 до z1 (z1 < z0) шагом step; нормали из профиля (гладкие)
// uv: u = длина дуги профиля (м), v = −z (м)
export function sweep(profile, z0, z1, step){
  const np = profile.length, rows = Math.max(1, Math.round((z0 - z1) / step)) + 1;
  const P = new Float32Array(np * rows * 3), N = new Float32Array(np * rows * 3), U = new Float32Array(np * rows * 2);
  const nx = new Float32Array(np), ny = new Float32Array(np), arc = new Float32Array(np);
  for (let i = 0; i < np; i++){
    const a = profile[Math.max(0, i - 1)], b = profile[Math.min(np - 1, i + 1)];
    let tx = b[0] - a[0], ty = b[1] - a[1]; const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
    nx[i] = ty; ny[i] = -tx;                          // профиль задаётся так, что «наружу» — справа от обхода
    if (i) arc[i] = arc[i - 1] + Math.hypot(profile[i][0] - profile[i - 1][0], profile[i][1] - profile[i - 1][1]);
  }
  for (let r = 0; r < rows; r++){
    const z = z0 + (z1 - z0) * r / (rows - 1);
    for (let i = 0; i < np; i++){
      const k = r * np + i;
      P[k * 3] = profile[i][0]; P[k * 3 + 1] = profile[i][1]; P[k * 3 + 2] = z;
      N[k * 3] = nx[i]; N[k * 3 + 1] = ny[i]; N[k * 3 + 2] = 0;
      U[k * 2] = arc[i]; U[k * 2 + 1] = -z;
    }
  }
  const idx = [];
  for (let r = 0; r < rows - 1; r++) for (let i = 0; i < np - 1; i++){
    const a = r * np + i, b = a + 1, c = a + np, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(P, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(N, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(U, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

// ---------- ИНСТАНСНАЯ ЧАСТЬ ----------
// Каждый кадр (или при изменении) список экземпляров переписывается с нуля: begin → push… → end.
// Без аллокаций: пишем прямо в Float32Array матриц и цветов.
export class Part {
  constructor(geo, mat, cap, o){
    const m = new THREE.InstancedMesh(geo, mat, cap);
    m.count = 0; m.frustumCulled = false; m.visible = false;
    m.castShadow = !!(o && o.cast); m.receiveShadow = !(o && o.receive === false);
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
    if (o && o.renderOrder) m.renderOrder = o.renderOrder;
    if (o && o.name) m.name = o.name;
    this.mesh = m; this.cap = cap; this.n = 0;
    this.mA = m.instanceMatrix.array; this.cA = m.instanceColor.array;
  }
  begin(){ this.n = 0; }
  // поворот вокруг Y (cos/sin уже умножены на масштаб XZ), масштаб Y отдельно; tint — множитель цвета
  push(x, y, z, cs, sn, sy, tint){
    if (this.n >= this.cap) return -1;
    const i = this.n++, e = this.mA, o = i * 16;
    e[o] = cs;  e[o + 1] = 0;  e[o + 2] = -sn; e[o + 3] = 0;
    e[o + 4] = 0; e[o + 5] = sy; e[o + 6] = 0; e[o + 7] = 0;
    e[o + 8] = sn; e[o + 9] = 0; e[o + 10] = cs; e[o + 11] = 0;
    e[o + 12] = x; e[o + 13] = y; e[o + 14] = z; e[o + 15] = 1;
    const c = this.cA, k = i * 3;
    c[k] = c[k + 1] = c[k + 2] = tint;
    return i;
  }
  // полная матрица «вращение Y · масштаб (sx, sy, sz)» + сдвиг
  pushS(x, y, z, cs, sn, sx, sy, sz, r, g, b){
    if (this.n >= this.cap) return -1;
    const i = this.n++, e = this.mA, o = i * 16;
    e[o] = cs * sx; e[o + 1] = 0; e[o + 2] = -sn * sx; e[o + 3] = 0;
    e[o + 4] = 0; e[o + 5] = sy; e[o + 6] = 0; e[o + 7] = 0;
    e[o + 8] = sn * sz; e[o + 9] = 0; e[o + 10] = cs * sz; e[o + 11] = 0;
    e[o + 12] = x; e[o + 13] = y; e[o + 14] = z; e[o + 15] = 1;
    const c = this.cA, k = i * 3;
    c[k] = r; c[k + 1] = g; c[k + 2] = b;
    return i;
  }
  end(){
    const m = this.mesh;
    m.count = this.n; m.visible = this.n > 0;
    m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true;
  }
}

// ---------- ПАТЧ ШЕЙДЕРОВ ----------
// Вставки в стандартные шейдеры (Standard/Physical/Basic). Мировая позиция до изгиба — varying vKitW.
// o: { key, uniforms, vPars, vBody (после begin_vertex, есть kitW), fPars, fColor (после color_fragment),
//      fRough (после roughnessmap_fragment), fEmis (после emissivemap_fragment; для Basic — перед outgoing) }
export function patch(mat, o){
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = function(sh, r){
    if (prev) prev.call(this, sh, r);
    Object.assign(sh.uniforms, o.uniforms || {});
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vKitW;\nvarying vec3 vKitL;\n" + (o.vPars || ""))
      .replace("#include <begin_vertex>", `#include <begin_vertex>
        vKitL = position;
        vec4 kitW = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          kitW = instanceMatrix * kitW;
        #endif
        kitW = modelMatrix * kitW;
        ${o.vBody || ""}
        vKitW = kitW.xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vKitW;\nvarying vec3 vKitL;\n" + (o.fPars || ""));
    if (o.fColor) sh.fragmentShader = sh.fragmentShader.replace("#include <color_fragment>", "#include <color_fragment>\n" + o.fColor);
    if (o.fRough) sh.fragmentShader = sh.fragmentShader.replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\n" + o.fRough);
    if (o.fEmis){
      if (sh.fragmentShader.includes("#include <emissivemap_fragment>"))
        sh.fragmentShader = sh.fragmentShader.replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n" + o.fEmis);
    }
  };
  const key = o.key + "|" + (mat.customProgramCacheKey ? mat.customProgramCacheKey() : "");
  mat.customProgramCacheKey = () => key;
  mat.needsUpdate = true;
  return mat;
}

// мягкая точка на canvas (если look не загрузился)
export function softDotTex(){
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const g = c.getContext("2d"), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.45, "rgba(255,255,255,.55)"); gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// ---------- ШРИФТ ВЫВЕСОК ----------
// Nunito 900 из assets/fonts (тот же, что у HUD). Вывески рисуются сразу системным шрифтом и
// перерисовываются, когда шрифт загрузился. Промис кэшируется, ошибок не бросает.
let fontP = null;
export function loadKitFont(){
  if (fontP) return fontP;
  fontP = (async () => {
    try {
      if (typeof FontFace !== "function" || !document.fonts) return false;
      const base = new URL("../../assets/fonts/", import.meta.url);
      const faces = [
        ["nunito-cyrillic.woff2", "U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116"],
        ["nunito-latin.woff2", "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215"],
      ];
      await Promise.all(faces.map(([f, range]) => {
        const ff = new FontFace("KitNunito", `url(${new URL(f, base)}) format("woff2")`, { weight: "200 1000", unicodeRange: range });
        document.fonts.add(ff);
        return ff.load();
      }));
      return true;
    } catch (e){ return false; }
  })();
  return fontP;
}
export const SIGN_FONT = "'KitNunito', Nunito, 'Arial Rounded MT Bold', 'Avenir Next', system-ui, sans-serif";
