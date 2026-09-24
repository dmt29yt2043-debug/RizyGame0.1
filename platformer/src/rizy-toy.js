// Ризи-игрушка: чистые гладкие формы, как у виниловой фигурки (стиль игрушечного рыцаря из референса).
// Узнаваемые черты канона: синяя кожа, лаймовое каре с двумя пучками, огромные глянцевые глаза, открытая улыбка,
// короткий чёрный свитер с цветами, широкие синие джинсы, чёрные кеды с белым мысом и лаймовыми шнурками.
// Скелет — вложенные группы (без SkinnedMesh): таз → ноги, торс → руки, шея → голова → пучки. Анимация процедурная.
// Контракт — см. src/rizy.js.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const PI = Math.PI, TAU = PI * 2;
const COL = {
  skin: 0x3a7cf2, skinIn: 0x2a5fd0, hair: 0xC2EA44, sweater: 0x17181f, rib: 0x22242e,
  jeans: 0x1f47e6, jeansHem: 0x3a63f0, shoe: 0x111218, sole: 0xf5f5f2, lace: 0xC6EE3A,
  eye: 0x05060c, white: 0xf7f9ff, brow: 0x14338f, mouth: 0x2a0b16, teeth: 0xfcfcf7, tongue: 0xf06b8a,
  blush: 0x8f7cf5, flowerA: 0xC6EE3A, flowerB: 0x2350ea,
};

// ---------- геометрия ----------
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const M4 = (p, q, s) => new THREE.Matrix4().compose(p || V3(0, 0, 0), q || new THREE.Quaternion(), s || V3(1, 1, 1));
const qE = (x, y, z) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z));
const qTo = dir => new THREE.Quaternion().setFromUnitVectors(V3(0, 0, 1), dir.clone().normalize());
function clean(g){
  if (g.index) g = g.toNonIndexed();
  for (const k of Object.keys(g.attributes)) if (k !== "position" && k !== "normal" && k !== "uv" && k !== "color") g.deleteAttribute(k);
  if (!g.attributes.uv) g.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  if (!g.attributes.normal) g.computeVertexNormals();
  return g;
}
// трубка переменной толщины со скруглёнными концами (пряди, брови, шнурки)
function taperTube(pts, r0, r1, radial = 10, seg = 24){
  const curve = new THREE.CatmullRomCurve3(pts);
  const fr = curve.computeFrenetFrames(seg, false);
  const P = [], N = [], U = [], I = [];
  for (let i = 0; i <= seg; i++){
    const t = i / seg, c = curve.getPointAt(t);
    const r = (r0 + (r1 - r0) * t) * (t > 0.88 ? Math.sqrt(Math.max(0, 1 - ((t - 0.88) / 0.12) ** 2)) : 1);
    for (let j = 0; j <= radial; j++){
      const a = j / radial * TAU, cs = Math.cos(a), sn = Math.sin(a);
      const n = fr.normals[i].clone().multiplyScalar(cs).addScaledVector(fr.binormals[i], sn);
      P.push(c.x + n.x * r, c.y + n.y * r, c.z + n.z * r); N.push(n.x, n.y, n.z); U.push(j / radial, t);
    }
  }
  for (let i = 0; i < seg; i++) for (let j = 0; j < radial; j++){
    const a = i * (radial + 1) + j, b = a + radial + 1;
    I.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(U, 2));
  g.setIndex(I);
  // круглая «пробка» в начале, чтобы корень пряди не светился дыркой
  const cap = new THREE.SphereGeometry(r0, radial, 6); cap.translate(pts[0].x, pts[0].y, pts[0].z);
  return mergeGeometries([clean(g), clean(cap)]);
}
const sph = (r, w = 24, h = 16) => new THREE.SphereGeometry(r, w, h);
const rbox = (w, h, d, r = 0.03, s = 3) => new RoundedBoxGeometry(w, h, d, s, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3));

// войлочный/пряжевый ворс: шум альбедо + зерно нормали по позиции вершины в бинд-позе (без UV — не съезжает
// при слиянии геометрии в один меш). Адаптировано из game/run/src/actors/rizy/fibre.js под этот файл.
function patchFibre(mat, o = {}){
  const freq = o.freq || 90, amp = o.amp != null ? o.amp : 0.1, nrm = o.nrm != null ? o.nrm : 0.1;
  const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey;
  mat.onBeforeCompile = function (sh, r){
    if (prev) prev.call(this, sh, r);
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vRzP;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvRzP = position;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>
varying vec3 vRzP;
float rzHash(vec3 p){ p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float rzNoise(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(rzHash(i), rzHash(i + vec3(1,0,0)), f.x), mix(rzHash(i + vec3(0,1,0)), rzHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(rzHash(i + vec3(0,0,1)), rzHash(i + vec3(1,0,1)), f.x), mix(rzHash(i + vec3(0,1,1)), rzHash(i + vec3(1,1,1)), f.x), f.y), f.z); }`)
      .replace("#include <color_fragment>", `#include <color_fragment>
{ vec3 q = vRzP * ${freq.toFixed(1)}; float f = 0.6 * rzNoise(q) + 0.4 * rzNoise(q * 2.9 + 7.3);
  diffuseColor.rgb *= 1.0 + ${amp.toFixed(3)} * (f - 0.5) * 2.0; }`)
      .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
{ vec3 q = vRzP * ${(freq * 1.7).toFixed(1)};
  normal = normalize(normal + ${nrm.toFixed(3)} * (vec3(rzNoise(q + 3.1), rzNoise(q + 41.7), rzNoise(q + 19.3)) - 0.5)); }`);
  };
  mat.customProgramCacheKey = function (){ return (prevKey ? prevKey.call(this) : "") + "|rizyFibre" + freq + "/" + amp + "/" + nrm; };
  mat.needsUpdate = true;
  return mat;
}

// точка на голове: az — вокруг оси Y (0 = вперёд, +Z), el — вверх; r — радиус
const HEAD_R = 0.3;
function onHead(az, el, r = HEAD_R){ return V3(Math.sin(az) * Math.cos(el) * r, Math.sin(el) * r, Math.cos(az) * Math.cos(el) * r); }

// ---------- текстуры (процедурные canvas, строятся один раз на экземпляр; 96–256 px, RepeatWrapping) ----------
// детерминированный ГПСЧ (как в game/run/src/actors/rizy/textures.js) — картинка одинакова между кадрами теста
function rng(seed){
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function cvs(w, h){ const c = document.createElement("canvas"); c.width = w; c.height = h; return c; }
function toTex(c, srgb){ const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return t; }

// вязка свитера под bump: петли «галочкой» + шахматный сдвиг через ряд (резинка/платочная фактура + «шахматка петель»)
function knitTex(){
  const W = 256, H = 128, c = cvs(W, H), g = c.getContext("2d");
  g.fillStyle = "#141420"; g.fillRect(0, 0, W, H);
  const cw = W / 10, ch = H / 7;
  for (let row = 0, y = 0; y < H; y += ch, row++){
    const off = (row % 2) * cw * 0.5;
    for (let x = -cw; x < W + cw; x += cw){
      const cx = x + off;
      for (const s of [-1, 1]){
        g.fillStyle = s < 0 ? "rgba(255,255,255,0.17)" : "rgba(0,0,0,0.4)";
        g.beginPath(); g.ellipse(cx + cw * (0.5 + 0.24 * s), y + ch * 0.5, cw * 0.27, ch * 0.56, -0.6 * s, 0, TAU); g.fill();
      }
    }
    g.fillStyle = "rgba(0,0,0,0.22)"; g.fillRect(0, y, W, 1.4);
  }
  return toTex(c, false);
}
// резинка манжет/ворота/низа свитера — чёткие вертикальные рубчики
function ribTex(){
  const W = 128, H = 48, c = cvs(W, H), g = c.getContext("2d");
  g.fillStyle = "#0e0d13"; g.fillRect(0, 0, W, H);
  const p = W / 8;
  for (let x = 0; x < W; x += p){
    g.fillStyle = "rgba(255,255,255,0.24)"; g.fillRect(x + p * 0.08, 0, p * 0.36, H);
    g.fillStyle = "rgba(0,0,0,0.48)"; g.fillRect(x + p * 0.58, 0, p * 0.32, H);
  }
  return toTex(c, false);
}
// деним джинсов: базовый синий цвет запечён прямо в текстуру (материал белый — иначе умножение на тёмный
// COL.jeans гасит светлую строчку). Диагональная саржа + мелкий крап + светлый шов по фиксированному U.
function denimTex(){
  const W = 256, H = 256, c = cvs(W, H), g = c.getContext("2d"), R = rng(31);
  g.fillStyle = "#" + new THREE.Color(COL.jeans).getHexString(); g.fillRect(0, 0, W, H);
  g.save(); g.lineWidth = 1.6;
  for (let d0 = -H - 5; d0 < W + 5; d0 += 4.2){
    g.strokeStyle = "rgba(255,255,255,0.16)"; g.beginPath(); g.moveTo(d0, 0); g.lineTo(d0 + H, H); g.stroke();
    g.strokeStyle = "rgba(0,0,20,0.28)"; g.beginPath(); g.moveTo(d0 + 2.1, 0); g.lineTo(d0 + 2.1 + H, H); g.stroke();
  }
  for (let i = 0; i < 3200; i++){
    g.fillStyle = R() < 0.5 ? "rgba(255,255,255,0.14)" : "rgba(0,0,25,0.2)";
    g.fillRect(R() * W, R() * H, 2, 1.2);
  }
  g.restore();
  const sx = W * 0.06;                                    // светлая двойная строчка — как настрочный шов
  g.strokeStyle = "#fff4d2"; g.lineWidth = 2.4; g.setLineDash([5, 4]);
  g.beginPath(); g.moveTo(sx, 0); g.lineTo(sx, H); g.stroke();
  g.strokeStyle = "rgba(255,244,210,0.65)"; g.lineWidth = 1.4; g.lineDashOffset = 2;
  g.beginPath(); g.moveTo(sx + 5, 0); g.lineTo(sx + 5, H); g.stroke();
  g.setLineDash([]);
  return toTex(c, true);
}
// светлая пунктирная строчка по кольцу подгиба джинсов (торус-хем на щиколотке)
function stitchTex(){
  const W = 128, H = 16, c = cvs(W, H), g = c.getContext("2d");
  g.fillStyle = "#3a63f0"; g.fillRect(0, 0, W, H);
  g.strokeStyle = "rgba(255,241,205,0.9)"; g.lineWidth = 3; g.setLineDash([7, 6]);
  g.beginPath(); g.moveTo(0, H / 2); g.lineTo(W, H / 2); g.stroke();
  return toTex(c, true);
}
// тканевый верх кед — базовый цвет запечён в текстуру (та же причина, что и у денима); мелкое плетение
function shoeFabricTex(){
  const W = 128, H = 128, c = cvs(W, H), g = c.getContext("2d");
  g.fillStyle = "#" + new THREE.Color(COL.shoe).getHexString(); g.fillRect(0, 0, W, H);
  const p = 6;
  for (let y = 0; y < H; y += p) for (let x = 0; x < W; x += p){
    const woven = ((x / p + y / p) % 2) === 0;
    g.fillStyle = woven ? "rgba(255,255,255,0.16)" : "rgba(0,0,0,0.4)";
    g.fillRect(x, y, p, p);
  }
  return toTex(c, true);
}
// витки пряжи: 2–3 нити скручены по спирали вдоль uv.y (длина трубки прядей/шнурков) — bump
function yarnTwistTex(){
  const W = 96, H = 96, c = cvs(W, H), g = c.getContext("2d"), img = g.createImageData(W, H), d = img.data, N = 3;
  for (let y = 0; y < H; y++){
    const v = y / H;
    for (let x = 0; x < W; x++){
      const u = x / W;
      const tw = (u + v * 1.6) * N, f = tw - Math.floor(tw);       // сдвиг по v — иллюзия косой скрутки нитей
      const s = Math.pow(Math.sin(PI * f), 0.7);
      const val = Math.max(0, Math.min(255, 55 + 190 * s));
      const o = (y * W + x) * 4; d[o] = d[o + 1] = d[o + 2] = val; d[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return toTex(c, false);
}

export function createRizyToy(opts = {}){
  const Q = opts.quality === "low" ? 0 : opts.quality === "high" ? 2 : 1;
  const S = (lo, med, hi) => [lo, med, hi][Q];
  const LOW = Q === 0;

  // ---------- материалы ----------
  const knit = knitTex(); knit.repeat.set(13, 4);
  const rib = ribTex(); rib.repeat.set(10, 1);
  const denim = denimTex(); denim.repeat.set(1, 3);
  const stitch = stitchTex(); stitch.repeat.set(22, 1);
  const shoeFab = shoeFabricTex(); shoeFab.repeat.set(3, 2);
  const yarnHair = yarnTwistTex(); yarnHair.repeat.set(1, 6);
  const yarnLace = yarnHair.clone(); yarnLace.repeat.set(1, 3); yarnLace.needsUpdate = true;
  const mats = {
    // войлок кожи: матовый (без клиркоута), sheen светло-голубой даёт ворсистый ободок по силуэту на просвет
    skin: new THREE.MeshPhysicalMaterial({ color: COL.skin, roughness: 0.88, sheen: 0.55, sheenRoughness: 0.55, sheenColor: new THREE.Color(0xbfe0ff) }),
    skinIn: new THREE.MeshStandardMaterial({ color: COL.skinIn, roughness: 0.6 }),
    // пряжа волос: sheen лаймовый + витки нитей (2–3 скрученные пряди) по длине трубки — bump
    hair: new THREE.MeshPhysicalMaterial({ color: COL.hair, roughness: 0.5, sheen: 0.5, sheenRoughness: 0.4, sheenColor: new THREE.Color(0xf4ffc0), side: THREE.DoubleSide, bumpMap: yarnHair, bumpScale: 0.55 }),
    sweater: new THREE.MeshPhysicalMaterial({ color: COL.sweater, roughness: 0.85, sheen: 0.6, sheenRoughness: 0.5, sheenColor: new THREE.Color(0x5a6280), bumpMap: knit, bumpScale: 1.1 }),
    rib: new THREE.MeshPhysicalMaterial({ color: COL.rib, roughness: 0.9, sheen: 0.5, sheenColor: new THREE.Color(0x505670), bumpMap: rib, bumpScale: 0.8 }),
    // джинсы: саржа + строчка по шву запечены в map (цвет — белый материал, иначе умножение гасит светлую нить)
    jeans: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.75, map: denim, bumpMap: denim, bumpScale: 0.3 }),
    jeansHem: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.75, map: stitch }),
    shoe: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.62, map: shoeFab, bumpMap: shoeFab, bumpScale: 0.35 }),
    sole: new THREE.MeshPhysicalMaterial({ color: COL.sole, roughness: 0.3, clearcoat: 0.4, clearcoatRoughness: 0.25 }),
    lace: new THREE.MeshStandardMaterial({ color: COL.lace, roughness: 0.55, bumpMap: yarnLace, bumpScale: 0.35 }),
    // пуговицы глаз: глянец, без ворса
    eye: new THREE.MeshPhysicalMaterial({ color: COL.eye, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.04 }),
    white: new THREE.MeshStandardMaterial({ color: COL.white, roughness: 0.42 }),
    shine: new THREE.MeshBasicMaterial({ color: 0xffffff }),
    brow: new THREE.MeshStandardMaterial({ color: COL.brow, roughness: 0.7 }),
    mouth: new THREE.MeshStandardMaterial({ color: COL.mouth, roughness: 0.6 }),
    teeth: new THREE.MeshStandardMaterial({ color: COL.teeth, roughness: 0.3 }),
    tongue: new THREE.MeshStandardMaterial({ color: COL.tongue, roughness: 0.5 }),
    blush: new THREE.MeshBasicMaterial({ color: COL.blush, transparent: true, opacity: 0.22, depthWrite: false }),
    // войлочные лепестки — матовые с ворсом
    flowerA: new THREE.MeshStandardMaterial({ color: COL.flowerA, roughness: 0.82 }),
    flowerB: new THREE.MeshStandardMaterial({ color: COL.flowerB, roughness: 0.82 }),
    // бусины-серединки цветов — глянцевые; один материал на оба оттенка через вершинный цвет (экономит draw call)
    bead: new THREE.MeshPhysicalMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.14, clearcoat: 1, clearcoatRoughness: 0.08 }),
  };
  if (!LOW){
    patchFibre(mats.skin, { freq: 110, amp: 0.06, nrm: 0.17 });
    patchFibre(mats.hair, { freq: 150, amp: 0.05, nrm: 0.08 });
    patchFibre(mats.sweater, { freq: 170, amp: 0.03, nrm: 0.06 });
    patchFibre(mats.rib, { freq: 170, amp: 0.03, nrm: 0.07 });
    patchFibre(mats.flowerA, { freq: 140, amp: 0.06, nrm: 0.14 });
    patchFibre(mats.flowerB, { freq: 140, amp: 0.06, nrm: 0.14 });
  }
  const hurtMats = [mats.skin, mats.hair, mats.sweater, mats.jeans];

  // ---------- скелет из групп ----------
  const root = new THREE.Group(); root.name = "rizy";
  const squash = new THREE.Group(); root.add(squash);             // сплющивание/растяжение от ступней
  const flip = new THREE.Group(); flip.position.y = 0.74; squash.add(flip);   // сальто вокруг центра масс
  const body = new THREE.Group(); body.position.y = -0.74; flip.add(body);
  const hips = new THREE.Group(); hips.position.y = 0.5; body.add(hips);
  const legs = [-1, 1].map(s => { const g = new THREE.Group(); g.position.set(s * 0.1, -0.02, 0); hips.add(g); return g; });
  const torso = new THREE.Group(); hips.add(torso);
  const arms = [-1, 1].map(s => { const g = new THREE.Group(); g.position.set(s * 0.215, 0.3, 0); torso.add(g); return g; });
  const neck = new THREE.Group(); neck.position.y = 0.37; torso.add(neck);
  const head = new THREE.Group(); head.position.y = 0.26; head.scale.set(1.05, 0.98, 1); neck.add(head);
  const eyes = [-1, 1].map(s => { const g = new THREE.Group(); head.add(g); return g; });
  const buns = [-1, 1].map(s => { const g = new THREE.Group(); g.position.set(s * 0.2, 0.31, -0.04); head.add(g); return g; });

  // накопитель: детали сливаются по (группа, материал) — мало draw calls
  const acc = new Map();
  // color — опционально: THREE.Color на вершину (нужен только mats.bead — один материал даёт оба оттенка бусин)
  function add(group, mat, geo, m, color){
    geo = clean(geo); if (m) geo.applyMatrix4(m);
    if (color){
      const n = geo.attributes.position.count, arr = new Float32Array(n * 3);
      for (let i = 0; i < n; i++){ arr[i * 3] = color.r; arr[i * 3 + 1] = color.g; arr[i * 3 + 2] = color.b; }
      geo.setAttribute("color", new THREE.Float32BufferAttribute(arr, 3));
    }
    const key = group.uuid + "|" + mat.uuid;
    if (!acc.has(key)) acc.set(key, { group, mat, list: [] });
    acc.get(key).list.push(geo);
  }

  // ===== НОГИ: широкие джинсы + кеды =====
  for (const [i, s] of [-1, 1].entries()){
    const L = legs[i];
    const leg = new THREE.CylinderGeometry(0.088, 0.118, 0.36, S(12, 20, 28), 1, true);
    add(L, mats.jeans, leg, M4(V3(0, -0.18, 0)));
    add(L, mats.jeansHem, new THREE.TorusGeometry(0.116, 0.014, 6, S(12, 20, 28)), M4(V3(0, -0.345, 0), qE(PI / 2, 0, 0)));
    add(L, mats.jeans, new THREE.CircleGeometry(0.118, S(12, 20, 28)), M4(V3(0, -0.36, 0), qE(PI / 2, 0, 0)));
    // кед: подошва, верх, белый мыс, шнурки
    const f = V3(0, -0.41, 0.03);
    add(L, mats.sole, rbox(0.17, 0.05, 0.28, 0.022), M4(f.clone().add(V3(0, -0.025, 0.01))));
    add(L, mats.shoe, rbox(0.155, 0.11, 0.24, 0.05), M4(f.clone().add(V3(0, 0.035, -0.005))));
    add(L, mats.sole, new THREE.SphereGeometry(0.078, 16, 10, 0, TAU, 0, PI / 2), M4(f.clone().add(V3(0, 0.0, 0.1)), qE(PI / 2 * 0.0, 0, 0), V3(1, 0.62, 0.7)));
    add(L, mats.sole, rbox(0.172, 0.018, 0.286, 0.008), M4(f.clone().add(V3(0, 0.006, 0.01))));
    for (let k = 0; k < 3; k++) add(L, mats.lace, rbox(0.1, 0.014, 0.022, 0.006), M4(f.clone().add(V3(0, 0.094 - k * 0.006, 0.02 + k * 0.045)), qE(-0.25, 0, 0)));
  }
  add(hips, mats.jeans, rbox(0.38, 0.14, 0.27, 0.06), M4(V3(0, 0.02, 0)));

  // ===== ТОРС: короткий свитер (лейз с приплюснутой глубиной), резинка, горло, цветы =====
  {
    const prof = [[0.222, -0.02], [0.236, 0.03], [0.232, 0.1], [0.222, 0.18], [0.216, 0.24], [0.2, 0.29], [0.158, 0.33], [0.1, 0.355]]
      .map(([x, y]) => new THREE.Vector2(x, y));
    const lat = new THREE.LatheGeometry(prof, S(20, 32, 44));
    add(torso, mats.sweater, lat, M4(null, null, V3(1, 1, 0.74)));
    add(torso, mats.rib, new THREE.TorusGeometry(0.228, 0.032, 8, S(20, 32, 44)), M4(V3(0, 0.0, 0), qE(PI / 2, 0, 0), V3(1, 0.74, 1)));
    add(torso, mats.rib, new THREE.CylinderGeometry(0.105, 0.112, 0.08, S(14, 22, 30), 1, true), M4(V3(0, 0.385, 0), null, V3(1, 1, 0.9)));
    add(torso, mats.rib, new THREE.TorusGeometry(0.106, 0.018, 6, S(14, 22, 30)), M4(V3(0, 0.425, 0), qE(PI / 2, 0, 0), V3(1, 0.9, 1)));
    // шея
    add(neck, mats.skin, new THREE.CylinderGeometry(0.075, 0.08, 0.12, 14), M4(V3(0, 0.06, 0)));
    // цветы: 5 пухлых лепестков + серединка контрастного цвета; ставим на поверхность лейза
    const surf = (az, y) => {
      let r = prof[0].x; for (let k = 1; k < prof.length; k++) if (y <= prof[k].y){ const a = prof[k - 1], b = prof[k]; r = a.x + (b.x - a.x) * (y - a.y) / (b.y - a.y); break; }
      const p = V3(Math.sin(az) * r, y, Math.cos(az) * r * 0.74);
      const n = V3(Math.sin(az) / r, 0, Math.cos(az) / (r * 0.74 * 0.74)).normalize();
      return { p, n };
    };
    const flower = (group, az, y, size, petal, beadColor, tilt, surfFn) => {
      const { p, n } = surfFn(az, y);
      const q = qTo(n).multiply(qE(0, 0, tilt));
      for (let k = 0; k < 5; k++){
        const a = k / 5 * TAU + tilt;
        const lp = V3(Math.cos(a) * size * 0.52, Math.sin(a) * size * 0.52, 0).applyQuaternion(q);
        add(group, petal, sph(size * 0.5, 10, 8), M4(p.clone().add(lp).addScaledVector(n, 0.004), q.clone().multiply(qE(0, 0, a)), V3(1, 0.62, 0.34)));
      }
      // бусина-серединка: глянцевый mats.bead на всех цветках, оттенок — через вершинный цвет
      add(group, mats.bead, sph(size * 0.3, 10, 8), M4(p.clone().addScaledVector(n, 0.012), q, V3(1, 1, 0.55)), beadColor);
    };
    const beadLime = new THREE.Color(COL.flowerA), beadBlue = new THREE.Color(COL.flowerB);
    const F = [[-0.42, 0.21, 0.058, 0], [0.38, 0.23, 0.052, 1], [0.05, 0.1, 0.06, 1], [-0.62, 0.07, 0.05, 0], [0.7, 0.09, 0.055, 0],
               [PI - 0.3, 0.2, 0.055, 1], [PI + 0.35, 0.1, 0.058, 0], [PI + 0.05, 0.26, 0.05, 0]];
    F.forEach(([az, y, sz, c], i) => flower(torso, az, y, sz, c ? mats.flowerB : mats.flowerA, c ? beadLime : beadBlue, i * 0.7, surf));

    // ===== РУКИ: рукав-капсула, манжета, синяя кисть =====
    for (const [i, s] of [-1, 1].entries()){
      const A = arms[i];
      add(A, mats.sweater, new THREE.CapsuleGeometry(0.068, 0.2, 6, S(10, 16, 20)), M4(V3(0, -0.13, 0)));
      add(A, mats.rib, new THREE.CylinderGeometry(0.07, 0.07, 0.05, S(10, 16, 20)), M4(V3(0, -0.265, 0)));
      add(A, mats.skin, sph(0.056, 16, 12), M4(V3(0, -0.325, 0.005), null, V3(0.9, 1.1, 0.8)));
      add(A, mats.skin, sph(0.024, 10, 8), M4(V3(-s * 0.04, -0.305, 0.03)));
      flower(A, s * PI / 2, -0.12, 0.045, i ? mats.flowerA : mats.flowerB, i ? beadBlue : beadLime, 0.4,
        (az, y) => ({ p: V3(Math.sin(az) * 0.068, y, Math.cos(az) * 0.068), n: V3(Math.sin(az), 0, Math.cos(az)) }));
    }
  }

  // ===== ГОЛОВА =====
  add(head, mats.skin, sph(HEAD_R, S(24, 40, 56), S(18, 30, 40)));
  // уши — торчат из-под каре на уровне глаз
  for (const s of [-1, 1]){
    const d = onHead(s * 1.28, -0.12, 1).normalize();
    const q = qTo(d);
    add(head, mats.skin, sph(0.064, 16, 12), M4(d.clone().multiplyScalar(0.318), q, V3(0.95, 1.1, 0.5)));
  }
  // глаза: белок, большой чёрный зрачок-радужка, два блика, линия века и ресничка
  for (const [i, s] of [-1, 1].entries()){
    const E = eyes[i];
    const d = onHead(s * 0.36, -0.05, 1).normalize(), p = d.clone().multiplyScalar(HEAD_R - 0.004);
    E.position.copy(p);
    const q = qTo(d), up = V3(0, 1, 0).applyQuaternion(q), side = V3(1, 0, 0).applyQuaternion(q);
    add(E, mats.white, sph(0.088, 28, 20), M4(null, q, V3(0.84, 1.06, 0.34)));
    add(E, mats.eye, sph(0.076, 28, 20), M4(d.clone().multiplyScalar(0.012).addScaledVector(up, -0.006), q, V3(0.82, 1.02, 0.42)));
    add(E, mats.shine, sph(0.022, 12, 8), M4(d.clone().multiplyScalar(0.043).addScaledVector(up, 0.03).addScaledVector(side, 0.022), q, V3(1, 1.1, 0.5)));
    add(E, mats.shine, sph(0.01, 8, 6), M4(d.clone().multiplyScalar(0.04).addScaledVector(up, -0.03).addScaledVector(side, -0.022), q, V3(1, 1, 0.5)));
    add(E, mats.eye, new THREE.TorusGeometry(0.089, 0.0045, 6, 24, PI * 0.78), M4(d.clone().multiplyScalar(0.022), q.clone().multiply(qE(0, 0, PI * 0.11)), V3(0.84, 1.06, 1)));
    // ресничка во внешнем уголке
    const lp = d.clone().multiplyScalar(0.02).addScaledVector(up, 0.07).addScaledVector(side, s * 0.066);
    add(E, mats.eye, taperTube([lp, lp.clone().addScaledVector(up, 0.018).addScaledVector(side, s * 0.022)], 0.006, 0.003, 6, 6));
    // брови — тонкие синие дуги
    const bp = [];
    for (let k = 0; k <= 6; k++){ const t = k / 6; bp.push(onHead(s * (0.2 + 0.26 * t), 0.24 + 0.05 * Math.sin(PI * Math.pow(t, 0.8)) - 0.02 * t, HEAD_R + 0.004)); }
    add(head, mats.brow, taperTube(bp, 0.0075, 0.005, 6, 16));
  }
  // нос
  add(head, mats.skin, sph(0.032, 14, 10), M4(onHead(0, -0.2, HEAD_R + 0.008), null, V3(1.1, 0.9, 0.9)));
  // рот: широкая открытая улыбка — тёмная «чаша» с плоским верхом, зубки сверху, язычок снизу
  {
    const d = onHead(0, -0.52, 1).normalize(), q = qTo(d);
    const up = V3(0, 1, 0).applyQuaternion(q);
    const at = (u, v, f) => d.clone().multiplyScalar(HEAD_R + f).addScaledVector(up, v).add(V3(u, 0, 0));
    add(head, mats.mouth, new THREE.SphereGeometry(0.1, 28, 12, 0, TAU, PI / 2, PI / 2), M4(at(0, 0.03, -0.006), q, V3(1.05, 0.62, 0.3)));
    add(head, mats.teeth, rbox(0.13, 0.026, 0.02, 0.008), M4(at(0, 0.018, 0.006), q));
    add(head, mats.tongue, sph(0.045, 16, 12), M4(at(0, -0.018, 0.0), q, V3(1.05, 0.55, 0.45)));
  }

  // ===== ВОЛОСЫ: гладкое каре-«шлем», чёлка прядями, боковые пряди, пучки =====
  {
    const hairR = 0.34;
    // макушка — полный купол до линии роста волос
    add(head, mats.hair, new THREE.SphereGeometry(hairR, S(24, 40, 56), S(8, 12, 16), 0, TAU, 0, 1.0), M4(V3(0, 0.012, 0)));
    // бока и затылок: каре с расширением к низу, спереди — вырез под лицо
    const gap = 1.22;
    // «обнять» лицо: у края выреза радиус ×0.9, к затылку — полный
    const hug = v => { const a = Math.abs(Math.atan2(v.x, v.z)); const k = Math.min(1, Math.max(0, (a - gap) / 0.7)); const f = 0.9 + 0.1 * k * k * (3 - 2 * k); v.x *= f; v.z *= f; return v; };
    const prof = [[0.285, 0.2], [0.322, 0.12], [0.342, 0.02], [0.346, -0.08], [0.341, -0.16], [0.325, -0.215], [0.295, -0.24]].map(([x, y]) => new THREE.Vector2(x, y));
    {
      const lg = new THREE.LatheGeometry(prof, S(24, 40, 56), gap, TAU - gap * 2), pa = lg.attributes.position, v = V3(0, 0, 0);
      for (let i = 0; i < pa.count; i++){ hug(v.fromBufferAttribute(pa, i)); pa.setXYZ(i, v.x, v.y, v.z); }
      lg.computeVertexNormals();
      add(head, mats.hair, lg);
    }
    // скруглённый край снизу — «толщина» каре
    // скруглённый край: валик по вырезу слева → по низу затылка → по вырезу справа (одна трубка)
    const last = prof[prof.length - 1], edge = [];
    for (let k = 1; k < prof.length; k++) edge.push(V3(Math.sin(gap) * prof[k].x, prof[k].y, Math.cos(gap) * prof[k].x));
    for (let k = 1; k < 24; k++){ const a = gap + (TAU - gap * 2) * k / 24; edge.push(V3(Math.sin(a) * last.x, last.y, Math.cos(a) * last.x)); }
    for (let k = prof.length - 1; k >= 1; k--) edge.push(V3(Math.sin(-gap) * prof[k].x, prof[k].y, Math.cos(-gap) * prof[k].x));
    add(head, mats.hair, taperTube(edge.map(hug), 0.024, 0.024, 8, S(60, 90, 120)));
    // пряди каре: пухлые валики от макушки до кромки по бокам и затылку
    const profR = y => { for (let k = 1; k < prof.length; k++) if (y >= prof[k].y){ const a = prof[k - 1], b = prof[k]; return a.x + (b.x - a.x) * (y - a.y) / (b.y - a.y); } return prof[prof.length - 1].x; };
    const nL = S(12, 16, 20);
    for (let k = 0; k < nL; k++){
      const a = gap - 0.06 + (TAU - 2 * gap + 0.12) * k / (nL - 1);
      const pts = [onHead(a, 1.12, hairR - 0.005)];
      for (const y of [0.17, 0.08, -0.03, -0.13, -0.2]){ const r = profR(y) + 0.014; pts.push(hug(V3(Math.sin(a) * r, y, Math.cos(a) * r))); }
      pts.push(hug(V3(Math.sin(a) * (last.x - 0.005), last.y - 0.012, Math.cos(a) * (last.x - 0.005))));
      add(head, mats.hair, taperTube(pts, 0.05, 0.05, 10, 26));
    }
    // чёлка: 5 пухлых прядей над бровями, кончики чуть наружу
    const N = 5;
    for (let k = 0; k < N; k++){
      const u = (k - (N - 1) / 2) / ((N - 1) / 2);             // −1..1
      const az = u * 0.7, elEnd = [0.46, 0.4, 0.43, 0.39, 0.46][k];
      const pts = [onHead(az * 0.5, 1.1, hairR - 0.01), onHead(az * 0.8, 0.8, hairR + 0.006), onHead(az * 0.96, 0.6, hairR + 0.01), onHead(az * 1.04, elEnd, hairR + 0.02)];
      add(head, mats.hair, taperTube(pts, 0.078, 0.058, 12, 20));
    }
    // пучки: шар + два витка-валика + обмотка у основания
    for (const [i, s] of [-1, 1].entries()){
      const B = buns[i];
      add(B, mats.hair, sph(0.132, S(16, 24, 32), S(12, 18, 24)), M4(V3(0, 0.06, 0)));
      const sp = [];
      for (let k = 0; k <= 40; k++){
        const t = k / 40, a = s * t * TAU * 2.1, el = 0.15 + t * 1.3, r = 0.134;
        sp.push(V3(Math.sin(a) * Math.cos(el) * r, 0.06 + Math.sin(el) * r, Math.cos(a) * Math.cos(el) * r));
      }
      add(B, mats.hair, taperTube(sp, 0.017, 0.01, 8, S(40, 64, 90)));
    }
  }

  // ---------- сборка мешей ----------
  const meshes = [];
  for (const { group, mat, list } of acc.values()){
    const g = list.length > 1 ? mergeGeometries(list) : list[0];
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat);
    m.castShadow = mat !== mats.shine && mat !== mats.blush; m.receiveShadow = false;
    if (mat === mats.blush) m.renderOrder = 2;
    group.add(m); meshes.push(m);
  }

  // ---------- анимация ----------
  const st = {
    t: 0, phase: 0, yaw: 0.95, run: 0, air: 0, dash: 0, hurt: 0, win: 0, collect: 0,
    sq: 0, sqV: 0,                      // пружина сплющивания: 0 — покой, <0 — сплющена, >0 — вытянута
    bun: [0, 0], bunV: [0, 0], vyPrev: 0,
    flipT: -1, blinkT: 2.2, blink: 0,
  };
  const lerp = (a, b, k) => a + (b - a) * k;
  const damp = (a, b, l, dt) => a + (b - a) * (1 - Math.exp(-l * dt));
  const smooth = x => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };

  function update(dt, s = {}){
    dt = Math.min(dt, 0.05);
    st.t += dt;
    const grounded = s.grounded !== false, speed = Math.max(0, Math.min(1, s.speed || 0)), vy = s.vy || 0;
    const ev = s.event;
    if (ev === "jump"){ st.sqV += 5.5; }
    if (ev === "djump"){ st.flipT = 0; st.sqV += 3; }
    if (ev === "land"){ st.sqV -= 4 + Math.min(6, Math.max(0, -st.vyPrev) * 0.45); }
    if (ev === "dash"){ st.dash = 1; }
    if (ev === "hurt"){ st.hurt = 1; st.sqV -= 3; }
    if (ev === "collect"){ st.collect = 1; }
    if (ev === "win"){ st.win = 1; }
    st.vyPrev = vy;

    // веса поз
    st.run = damp(st.run, grounded ? speed : 0, 14, dt);
    st.air = damp(st.air, grounded ? 0 : 1, 18, dt);
    st.dash = s.dashing ? 1 : damp(st.dash, 0, 10, dt);
    st.hurt = Math.max(0, st.hurt - dt * 1.6);
    st.collect = Math.max(0, st.collect - dt * 4);

    // пружина сплющивания
    st.sqV += (-260 * st.sq - 16 * st.sqV) * dt; st.sq += st.sqV * dt;
    const sq = Math.max(-0.35, Math.min(0.35, st.sq)) + (st.air > 0.5 ? Math.max(-0.1, Math.min(0.12, vy * 0.012)) : 0);
    const stretchZ = st.dash * 0.22;
    squash.scale.set(1 - sq * 0.5 - stretchZ * 0.2, 1 + sq - stretchZ * 0.25, 1 - sq * 0.5 + stretchZ);

    // поворот к направлению бега: 3/4 к камере; при развороте проходит через фас
    const face = s.facing || 1;
    const target = st.win > 0 ? 0 : face * 0.95;
    st.yaw = damp(st.yaw, target, 12, dt);
    root.rotation.y = st.yaw + (st.win > 0 ? Math.sin(st.t * 5) * 0.25 : 0);

    // цикл шага
    if (grounded && speed > 0.02) st.phase += dt * (7 + 7 * speed);
    const ph = st.phase, run = st.run, air = st.air, idle = (1 - run) * (1 - air);
    const sw = Math.sin(ph), bob = Math.abs(Math.cos(ph));

    // корпус
    hips.position.y = 0.5 + bob * 0.045 * run + Math.sin(st.t * 2.2) * 0.006 * idle;
    hips.rotation.y = sw * 0.12 * run;
    torso.rotation.x = 0.16 * run + 0.5 * st.dash - 0.25 * st.hurt + air * (vy > 0 ? -0.05 : 0.08);
    torso.rotation.y = -sw * 0.18 * run;
    torso.scale.set(1, 1 + Math.sin(st.t * 2.2) * 0.012 * idle, 1);

    // ноги: мах вперёд — отрицательный угол
    const legAirUp = [-0.9, 0.35], legAirDown = [-0.25, 0.3];
    for (let i = 0; i < 2; i++){
      const sgn = i ? -1 : 1;
      let rx = -sw * sgn * 0.85 * run;
      rx = lerp(rx, vy > 0 ? legAirUp[i] : legAirDown[i], air);
      rx = lerp(rx, 0.7, st.dash * 0.8);
      legs[i].rotation.x = rx;
      legs[i].rotation.z = (i ? 1 : -1) * (0.03 + air * 0.08);
    }
    // руки — противофаза ногам; в прыжке вверх, в падении в стороны, в рывке назад
    for (let i = 0; i < 2; i++){
      const sgn = i ? -1 : 1, side = i ? 1 : -1;
      let rx = sw * sgn * 0.8 * run + Math.sin(st.t * 2.2 + i) * 0.03 * idle;
      let rz = side * (0.18 + 0.1 * run);
      rx = lerp(rx, vy > 0 ? -2.3 + i * 0.3 : -0.4, air);
      rz = lerp(rz, side * (vy > 0 ? 0.35 : 1.1 + Math.sin(st.t * 18 + i * 2) * 0.12), air);
      rx = lerp(rx, 1.3, st.dash);
      rz = lerp(rz, side * 0.3, st.dash);
      if (st.win > 0){ rx = lerp(rx, -2.8, st.win); rz = lerp(rz, side * (0.5 + Math.sin(st.t * 10 + i * PI) * 0.2), st.win); }
      arms[i].rotation.set(rx, 0, rz);
    }
    // голова: лёгкий наклон и противовес, моргание
    neck.rotation.x = -0.1 * run - 0.25 * st.dash + 0.06 * Math.sin(st.t * 1.3) * idle - 0.15 * st.collect;
    neck.rotation.z = Math.sin(st.t * 0.9) * 0.05 * idle + st.hurt * 0.2 * Math.sin(st.t * 30);
    neck.rotation.y = sw * 0.1 * run;
    st.blinkT -= dt;
    if (st.blinkT <= 0){ st.blink = 0.14; st.blinkT = 2.4 + ((st.t * 7.3) % 1) * 2.2; }
    st.blink = Math.max(0, st.blink - dt);
    const eyeY = st.hurt > 0.4 ? 0.25 : st.blink > 0 ? 0.12 : 1;
    for (const e of eyes) e.scale.y = damp(e.scale.y, eyeY, 40, dt);

    // пучки — пружинки от вертикального ускорения
    const acc = (grounded ? -bob * 0.6 * run : vy * 0.02) + sq * 2;
    for (let i = 0; i < 2; i++){
      st.bunV[i] += (-180 * st.bun[i] - 9 * st.bunV[i] - acc * 30) * dt; st.bun[i] += st.bunV[i] * dt;
      const b = Math.max(-0.25, Math.min(0.25, st.bun[i]));
      buns[i].rotation.set(b * 0.6, 0, (i ? -1 : 1) * b * 0.8);
      buns[i].scale.setScalar(1 + b * 0.15);
    }

    // сальто на втором прыжке — вперёд, 0.42 с
    if (st.flipT >= 0){
      st.flipT += dt;
      const k = Math.min(1, st.flipT / 0.42), e = 1 - Math.pow(1 - k, 3);
      flip.rotation.x = e * TAU;
      if (k >= 1){ st.flipT = -1; flip.rotation.x = 0; }
    }
    // победа — прыжки на месте
    if (st.win > 0) body.position.y = -0.74 + Math.abs(Math.sin(st.t * 6)) * 0.18;

    // вспышка урона
    const fl = st.hurt > 0 && Math.sin(st.t * 40) > 0 ? st.hurt : 0;
    for (const m of hurtMats){ m.emissive.setRGB(fl * 0.9, fl * 0.15, fl * 0.2); }
    // «пружинка» при сборе кристалла
    const pop = 1 + Math.sin(st.collect * PI) * 0.06;
    body.scale.setScalar(pop);
  }

  function dispose(){
    for (const m of meshes) m.geometry.dispose();
    for (const m of Object.values(mats)) m.dispose();
    for (const t of [knit, rib, denim, stitch, shoeFab, yarnHair, yarnLace]) t.dispose();
  }

  update(0, { grounded: true, speed: 0, facing: 1 });
  return { root, height: 1.5, update, dispose, parts: { squash, flip, body, hips, torso, legs, arms, neck, head, eyes, buns }, meshes };
}
