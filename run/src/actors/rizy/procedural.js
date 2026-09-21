// Процедурная Ризи по новым мастер-листам (Rizy Master 3d / Фактура / Emotions): войлочно-пряжевая кукла.
// Синий войлок (шейдерные волокна fibre.js + sheen), волосы из толстых прядей лаймовой пряжи — трубки по кривым
// поверх тёмной подложки-каре, два пучка из намотанной пряжи (сферическая спираль с видимыми витками),
// чёрный вязаный свитер с цветами-аппликациями из пряжи (лепестки и бусины — геометрия), широкие прямые джинсы
// (атлас деним со строчкой), чёрные кеды с белым мыском/подошвой и лаймовыми шнурками.
// 4 SkinnedMesh по материалу на одном скелете (войлок, ткань, пряжа, лицо) = 4 draw calls (+3 теневых; на low теней нет).
// Шарф и рюкзак — опции (opts.scarf в index.js, opts.backpack здесь), по умолчанию выключены: на эталоне их нет.
// Жёсткие части весят на одну кость, рукава/штанины/торс — плавный бленд двух костей; нижние концы прядей
// частично весят на кости пучков (bunL/bunR) — пружины пучков дают им лёгкую инерцию без новых костей.
// Сегментация по качеству (QF): high ≈ 72k, med ≈ 40k (≤ 45k), low ≈ 18k (≤ 20k) треугольников.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { BONES, B } from "./anim.js";
import { clothAtlas, hairBumpTexture, ATLAS } from "./textures.js";
import { patchFibre } from "./fibre.js";

// ---------- палитра (sRGB); кожа и джинсы — пипеткой с мастер-листа, с поправкой на ACES ----------
export const COL = {
  skin: 0x3f80f5, skinIn: 0x1d47b4, blush: 0x829fff,
  hair: 0xD0F04C, hairIn: 0x86a428, brow: 0x0f2d92,
  jeans: 0xffffff, jeansIn: 0x4a5c9a, cloth: 0xffffff,
  shoe: 0x121218, sole: 0xf4f3ee, lace: 0xC8F53A,
  petalLime: 0xD2F550, petalBlue: 0x2557ea, beadBlue: 0x1c48d0, beadLime: 0xCDF23E,
  eyeWhite: 0xf7f9ff, pupil: 0x07080f, mouth: 0x120810, teeth: 0xfcfcf7, tongue: 0xe2474f, shine: 0xffffff,
  pack: 0x2f6ff2, flap: 0x1f50d2, pocket: 0x4a8cff, scarf: 0xC0FF3F,
};

// множитель сегментации по качеству
const QF = { low: 0.4, med: 0.62, high: 0.85 };

// позиции суставов в позе привязки (м, ноги на y=0, лицо в −Z). Пропорции мастер-листа: длинные ноги,
// короткий свитер, большая круглая голова (с волосами ≈ 30 % роста — компромисс между эталоном и читаемостью в игре)
const REST = {
  hips: [0, 1.0, 0], spine: [0, 1.12, 0], chest: [0, 1.32, 0], neck: [0, 1.56, 0], head: [0, 1.64, 0],
  thighL: [-0.12, 0.97, 0], shinL: [-0.12, 0.55, 0], footL: [-0.12, 0.13, 0],
  thighR: [0.12, 0.97, 0], shinR: [0.12, 0.55, 0], footR: [0.12, 0.13, 0],
  armL: [-0.27, 1.47, 0.0], foreL: [-0.27, 1.17, 0.0], armR: [0.27, 1.47, 0.0], foreR: [0.27, 1.17, 0.0],
  pack: [0, 1.3, 0.22], bunL: [0, 0, 0], bunR: [0, 0, 0], eyeL: [0, 0, 0], eyeR: [0, 0, 0],
};
const PARENT = {
  hips: null, spine: "hips", chest: "spine", neck: "chest", head: "neck",
  thighL: "hips", shinL: "thighL", footL: "shinL", thighR: "hips", shinR: "thighR", footR: "shinR",
  armL: "chest", foreL: "armL", armR: "chest", foreR: "armR", pack: "chest",
  bunL: "head", bunR: "head", eyeL: "head", eyeR: "head",
};
// голова: центр, радиус, эллипсоид (чуть шире, чем выше)
const HC = new THREE.Vector3(0, 1.91, 0), HR = 0.29, HS = new THREE.Vector3(1.0, 0.94, 0.96);
// подложка каре и толщина пряди
const RS = 0.318, RY = 0.0235;

const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// точка на поверхности головы по направлению d (голова — эллипсоид), inset — вглубь
function headSurf(d, inset = 0){
  const n = d.clone().normalize();
  return V(HC.x + n.x * (HR * HS.x - inset), HC.y + n.y * (HR * HS.y - inset), HC.z + n.z * (HR * HS.z - inset));
}
// точка на лице при (x, y) с выносом out по нормали эллипсоида
function faceAt(x, y, out){
  const nx = x / (HR * HS.x), ny = (y - HC.y) / (HR * HS.y);
  const nz = -Math.sqrt(Math.max(0.02, 1 - nx * nx - ny * ny));
  const d = V(nx / HS.x, ny / HS.y, nz / HS.z).normalize();
  return V(x, y, HC.z + nz * HR * HS.z).addScaledVector(d, out);
}

export function buildProcedural(ctx, opts = {}){
  const q = ctx.quality === "low" ? "low" : ctx.quality === "high" ? "high" : "med";
  const LOW = q === "low", HIGH = q === "high";
  const look = ctx.look && (ctx.look.mats || ctx.look);
  const qf = QF[q];
  // число сегментов: n — «эталон high», mn — нижняя граница (круглый силуэт не должен граниться)
  const S = (n, mn = 6) => Math.max(mn, Math.round(n * qf));
  let sd = 7;
  const rnd = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; };

  // ---------- скелет ----------
  const root = new THREE.Group(); root.name = "rizy";
  const yawG = new THREE.Group(); yawG.name = "rizy:lean"; root.add(yawG);
  const squashG = new THREE.Group(); squashG.name = "rizy:squash"; yawG.add(squashG);
  const baseScale = opts.scale || 0.93;
  squashG.scale.setScalar(baseScale);

  // пучки и глаза — вычисляемые позиции
  const bunDir = [V(-0.64, 0.76, 0.12).normalize(), V(0.64, 0.76, 0.12).normalize()];
  const BUN_D = 0.405, RB = 0.125;
  REST.bunL = HC.clone().addScaledVector(bunDir[0], BUN_D).toArray();
  REST.bunR = HC.clone().addScaledVector(bunDir[1], BUN_D).toArray();
  const eyeDir = [V(-0.4, -0.12, -0.9).normalize(), V(0.4, -0.12, -0.9).normalize()];
  const eyePos = eyeDir.map(d => headSurf(d, 0.024));
  REST.eyeL = eyePos[0].toArray(); REST.eyeR = eyePos[1].toArray();

  const bones = [], byName = {};
  for (const n of BONES){
    const b = new THREE.Bone(); b.name = n; byName[n] = b; bones.push(b);
    const p = PARENT[n], r = REST[n];
    if (p){ const pr = REST[p]; b.position.set(r[0] - pr[0], r[1] - pr[1], r[2] - pr[2]); byName[p].add(b); }
    else { b.position.set(r[0], r[1], r[2]); squashG.add(b); }
    b.userData.rest = b.position.clone();
  }
  squashG.updateMatrixWorld(true);
  // привязка в собственном масштабе: скелет считаем без squash, иначе обратные матрицы унаследуют 0.93
  squashG.scale.setScalar(1); root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);

  // ---------- сборка частей ----------
  const groups = { felt: [], cloth: [], hair: [], face: [] };
  const tmpC = new THREE.Color();
  // color — число, функция (i, pos) → число или Float32Array RGB на вершину;
  // blend — функция (y, x, z) → [boneA, boneB, wB] по локальным координатам ДО матрицы m,
  //         либо готовый массив [boneA, boneB, wB] для всей детали
  function part(list, geo, color, bone, m, blend){
    const pos = geo.attributes.position, n = pos.count;
    // RoundedBoxGeometry неиндексирован — mergeGeometries требует единообразия
    if (!geo.index){ const ix = new Uint32Array(n); for (let i = 0; i < n; i++) ix[i] = i; geo.setIndex(new THREE.BufferAttribute(ix, 1)); }
    const col = new Float32Array(n * 3), si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    const cf = typeof color === "function", ca = color instanceof Float32Array;
    if (!cf && !ca) tmpC.set(color);
    const bl = Array.isArray(blend) ? blend : null;
    for (let i = 0; i < n; i++){
      if (ca){ col[i * 3] = color[i * 3]; col[i * 3 + 1] = color[i * 3 + 1]; col[i * 3 + 2] = color[i * 3 + 2]; }
      else {
        if (cf) tmpC.set(color(i, pos));
        col[i * 3] = tmpC.r; col[i * 3 + 1] = tmpC.g; col[i * 3 + 2] = tmpC.b;
      }
      if (blend){
        const r = bl || blend(pos.getY(i), pos.getX(i), pos.getZ(i));
        si[i * 4] = B[r[0]]; si[i * 4 + 1] = B[r[1]]; sw[i * 4] = 1 - r[2]; sw[i * 4 + 1] = r[2];
      } else { si[i * 4] = B[bone]; sw[i * 4] = 1; }
    }
    if (m) geo.applyMatrix4(m);
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geo.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(si, 4));
    geo.setAttribute("skinWeight", new THREE.Float32BufferAttribute(sw, 4));
    if (!geo.attributes.uv) geo.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
    for (const k of Object.keys(geo.attributes)) if (!["position", "normal", "uv", "color", "skinIndex", "skinWeight"].includes(k)) geo.deleteAttribute(k);
    list.push(geo);
    return geo;
  }
  const TRS = (p, rq, s) => new THREE.Matrix4().compose(p, rq || new THREE.Quaternion(), s || V(1, 1, 1));
  const qFrom = (a, b) => new THREE.Quaternion().setFromUnitVectors(a.clone().normalize(), b.clone().normalize());
  const qE = (x, y, z) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z));
  // профиль (r, y) идёт так, чтобы наружная сторона была справа по ходу: наружные поверхности — снизу вверх
  const lathe = (pts, segs) => new THREE.LatheGeometry(pts.map(p => new THREE.Vector2(p[0], p[1])), segs);
  const sphere = (r, w, h, mw = 8, mh = 6) => new THREE.SphereGeometry(r, S(w, mw), S(h, mh));
  const rs = Math.max(1, Math.round(3 * qf));
  // uv лате: u — вокруг (× ku), v — по высоте в область атласа [v0, v1] между yA и yB
  function latheUV(g, ku, v0, v1, yA, yB){
    const uv = g.attributes.uv, pos = g.attributes.position;
    for (let k = 0; k < uv.count; k++){ uv.setX(k, uv.getX(k) * ku); uv.setY(k, v0 + (pos.getY(k) - yA) / (yB - yA) * (v1 - v0)); }
  }
  // uv пряжи для трубок: u = доля окружности·a + длина·t (кручение), v = длина·l
  const UVY = { a: 0.25, t: 1.0, l: 6 };

  // ===== ГОЛОВА: круглый войлочный шар, румянец — градиент по вершинам на скулах =====
  {
    const g = sphere(HR, 64, 44, 26, 16);
    const cheek = [V(-0.62, -0.3, -0.72).normalize(), V(0.62, -0.3, -0.72).normalize()];
    const cS = new THREE.Color(COL.skin), cB = new THREE.Color(COL.blush), cT = new THREE.Color(), dv = new THREE.Vector3();
    part(groups.felt, g, (i, pos) => {
      dv.set(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize();
      const k = Math.max(sstep(0.9, 0.985, dv.dot(cheek[0])), sstep(0.9, 0.985, dv.dot(cheek[1])));
      return cT.copy(cS).lerp(cB, 0.6 * k).getHex();
    }, "head", TRS(HC, null, HS));
  }
  // уши-полукруги торчат в стороны на уровне глаз, внутри чуть темнее
  for (const s of [-1, 1]){
    const ex = s * 0.322, ey = HC.y - 0.035, rq = qE(0, 0, -s * 0.06);
    part(groups.felt, sphere(0.09, 22, 16, 10, 8), COL.skin, "head", TRS(V(ex, ey, -0.02), rq, V(0.62, 1.05, 0.9)));
    part(groups.felt, sphere(0.06, 16, 12, 8, 6), COL.skinIn, "head", TRS(V(ex + s * 0.014, ey - 0.006, -0.055), rq, V(0.42, 0.85, 0.68)));
  }
  // нос: маленький круглый шарик между глаз
  part(groups.felt, sphere(0.03, 16, 12, 8, 6), COL.skin, "head", TRS(headSurf(V(0, -0.24, -1), 0.012), null, V(1.05, 0.9, 0.8)));

  // ===== ЛИЦО: огромные глянцевые глаза с белком и веком, вышитые брови, открытая улыбка =====
  for (let i = 0; i < 2; i++){
    const d = eyeDir[i], p = eyePos[i], bone = i ? "eyeR" : "eyeL";
    // явный репер глаза: X — вбок, Y — вверх, Z — наружу по нормали лица
    const up = V(0, 1, 0).addScaledVector(d, -d.y).normalize(), side = new THREE.Vector3().crossVectors(up, d).normalize();
    const rq = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(side, up, d));
    part(groups.face, sphere(0.086, 36, 26, 16, 10), COL.eyeWhite, bone, TRS(p, rq, V(0.82, 1.06, 0.36)));
    const pp = p.clone().addScaledVector(d, 0.012).addScaledVector(up, -0.003);
    part(groups.face, sphere(0.073, 32, 22, 14, 10), COL.pupil, bone, TRS(pp, rq, V(0.8, 1.02, 0.42)));
    // тонкая тёмная линия верхнего века — дуга над глазом
    part(groups.face, new THREE.TorusGeometry(0.086, 0.004, S(6, 4), S(24, 12), Math.PI * 0.72), COL.pupil, bone,
      TRS(p.clone().addScaledVector(d, 0.02), rq.clone().multiply(qE(0, 0, Math.PI * 0.14)), V(0.82, 1.06, 1)));
    // блики: большой сверху-справа (для зрителя) у обоих глаз, маленький снизу-слева
    part(groups.face, sphere(0.021, 12, 8, 8, 6), COL.shine, bone, TRS(pp.clone().addScaledVector(d, 0.03).addScaledVector(up, 0.028).addScaledVector(side, 0.02), rq, V(1, 1.1, 0.5)));
    part(groups.face, sphere(0.0095, 8, 6, 6, 4), COL.shine, bone, TRS(pp.clone().addScaledVector(d, 0.028).addScaledVector(up, -0.027).addScaledVector(side, -0.02), rq, V(1, 1, 0.5)));
  }
  // брови: тонкие синие дуги-нитки над глазами, толще к середине
  for (const s of [-1, 1]){
    const pts = [];
    for (let k = 0; k <= 8; k++){
      const t = k / 8;
      // добрая дуга как на эталоне: пик ближе к внешнему краю, внешний конец чуть опущен (не «удивлённые» и не «сердитые»)
      pts.push(faceAt(s * (0.045 + 0.155 * t), HC.y + 0.094 + 0.024 * Math.sin(Math.PI * Math.pow(t, 0.8)) - 0.008 * t, 0.005));
    }
    part(groups.hair, tube(pts, t => 0.0055 * (0.6 + 0.4 * Math.sin(Math.PI * t)), S(7, 5), UVY), COL.brow, "head");
  }
  // рот: широкая улыбка — тёмное «окно» с белой полоской зубов сверху и красным язычком снизу
  {
    const dm = V(0, -0.56, -0.83).normalize(), pm = headSurf(dm, 0), rq = qFrom(V(0, 0, 1), dm);
    const up = V(0, 1, 0).addScaledVector(dm, -dm.y).normalize(), side = new THREE.Vector3().crossVectors(up, dm).normalize();
    const at = (u, v, f) => pm.clone().addScaledVector(side, u).addScaledVector(up, v).addScaledVector(dm, f);
    part(groups.face, sphere(0.1, 28, 18, 14, 9), COL.mouth, "head", TRS(at(0, -0.006, -0.02), rq, V(1.14, 0.6, 0.34)));
    // уголки улыбки приподняты
    for (const s of [-1, 1]) part(groups.face, sphere(0.03, 12, 8, 8, 6), COL.mouth, "head", TRS(at(s * 0.084, 0.016, -0.012), rq, V(1.0, 0.75, 0.4)));
    part(groups.face, new RoundedBoxGeometry(0.124, 0.028, 0.018, rs, 0.008), COL.teeth, "head", TRS(at(0, 0.018, 0.004), rq));
    part(groups.face, sphere(0.046, 16, 12, 8, 6), COL.tongue, "head", TRS(at(0, -0.032, -0.002), rq, V(1.0, 0.62, 0.5)));
  }

  // ===== ВОЛОСЫ ИЗ ПРЯЖИ =====
  // подложка-каре (тёмный лайм: между прядями читается глубина)
  part(groups.hair, hairCap(q), hairShade, "head");
  // репер макушки: пряди расходятся от «вихра» чуть позади темени
  const POLE = V(0, 1, 0.12).normalize();
  const FWD = V(0, 0, -1).addScaledVector(POLE, -POLE.dot(V(0, 0, -1))).normalize();
  const SIDE = new THREE.Vector3().crossVectors(FWD, POLE).normalize();
  const NS = { low: 30, med: 46, high: 56 }[q], NBANG = { low: 9, med: 10, high: 12 }[q];
  const YSIDES = { low: 4, med: 6, high: 7 }[q], DPHI = { low: 0.2, med: 0.14, high: 0.12 }[q], HANG = { low: 0.07, med: 0.05, high: 0.045 }[q];
  const HAIR_C = new THREE.Color(COL.hair), HAIR_IN = new THREE.Color(COL.hairIn);
  // нижние концы прядей частично на костях пучков — пружины пучков дают лёгкую инерцию
  const strandBlend = (y, x) => ["head", x < 0 ? "bunL" : "bunR", 0.4 * sstep(HC.y + 0.04, HC.y - 0.22, y)];
  // точки пряди: theta — азимут (0 — лицо, ±π — затылок), yEnd — высота кончика отн. HC.y (> 0 — чёлка),
  // phi0 — старт от макушки, layer — радиальный слой (верхние пряди лежат поверх нижних)
  function strandPts(theta, yEnd, phi0, layer, seed){
    const bang = yEnd > 0;
    const dirH = FWD.clone().multiplyScalar(Math.cos(theta)).addScaledVector(SIDE, Math.sin(theta));
    const lat = new THREE.Vector3().crossVectors(dirH, POLE).normalize();
    const sgn = Math.sign(theta) || 1, aT = Math.abs(theta);
    // боковые пряди (от чёлки до уха) уходят ЗА ухо и ложатся слоями: ухо торчит поверх каре, как на мастер-листе
    const nearEar = !bang && aT < 1.95, earU = nearEar ? (aT - 0.68) / (1.95 - 0.68) : 1;
    const Rr = RS + RY + layer + (nearEar ? 0.022 * (1 - earU) : 0);
    const pts = [], d = new THREE.Vector3(), p = new THREE.Vector3(), hz = new THREE.Vector3();
    let phi = phi0, hang = false, k = 0;
    for (let n = 0; n < 60; n++){
      if (!hang){
        let th = theta;
        // у уха пряди уходят назад — ухо торчит из-под каре, как на мастер-листе
        if (nearEar) th = theta + (sgn * (1.98 + 0.42 * earU) - theta) * sstep(1.05, 1.85, phi);
        // чёлка веером: крайние пряди расходятся к вискам
        if (bang) th = theta * (1 + 0.2 * sstep(0.3, 1.1, phi));
        dirH.copy(FWD).multiplyScalar(Math.cos(th)).addScaledVector(SIDE, Math.sin(th));
        d.copy(POLE).multiplyScalar(Math.cos(phi)).addScaledVector(dirH, Math.sin(phi));
        const lift = bang ? 0.014 * sstep(0.55, 1.05, phi) : 0;      // кончики чёлки отходят ото лба
        p.set(HC.x + d.x * (Rr + lift) * HS.x, HC.y + d.y * (Rr + lift) * HS.y, HC.z + d.z * (Rr + lift) * HS.z);
        p.addScaledVector(lat, 0.004 * Math.sin(phi * 4.5 + seed));
        pts.push(p.clone());
        if (bang && p.y - HC.y <= yEnd) break;
        if (!bang && d.y < -0.06){ hang = true; hz.set(dirH.x, 0, dirH.z).normalize(); }
        phi += DPHI;
      } else {
        // ниже экватора прядь свисает: лёгкий колокол наружу, волна, кончик подвёрнут внутрь
        p.y -= HANG;
        p.addScaledVector(hz, 0.0035 * HANG / 0.05);
        p.addScaledVector(lat, 0.004 * Math.sin(k * 1.3 + seed)); k++;
        if (p.y - HC.y <= yEnd){ p.addScaledVector(hz, -0.012); pts.push(p.clone()); break; }
        pts.push(p.clone());
      }
    }
    return pts;
  }
  // цвет пряди: у корня темнее (пряди наслаиваются у макушки), лёгкая индивидуальная вариация тона
  function strandColor(g, tint, rootDark){
    const t = g.attributes.position.userData.t, n = t.length, col = new Float32Array(n * 3), c = new THREE.Color();
    for (let i = 0; i < n; i++){
      const sh = Math.min(1, tint + rootDark * (1 - sstep(0.02, 0.32, t[i])));
      c.copy(HAIR_C).lerp(HAIR_IN, sh);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    return col;
  }
  const rTip = t => RY * (t > 0.85 ? 1 - 0.35 * (t - 0.85) / 0.15 : 1);
  // чёлка: 9–12 отдельных прядей разной длины над бровями
  {
    const ends = [0.17, 0.135, 0.19, 0.145, 0.165, 0.2, 0.15, 0.18, 0.14, 0.195, 0.16, 0.175];
    for (let k = 0; k < NBANG; k++){
      const th = ((k - (NBANG - 1) / 2) / ((NBANG - 1) / 2)) * 0.6 + (rnd() - 0.5) * 0.03;
      const pts = strandPts(th, ends[k % ends.length] + (rnd() - 0.5) * 0.015, 0.1 + (k % 2) * 0.22, (k % 2) * 0.01, rnd() * 6.3);
      const g = tube(pts, t => rTip(t) * 0.92, YSIDES, UVY);
      part(groups.hair, g, strandColor(g, 0.05 + 0.1 * rnd(), 0.22), "head");
    }
  }
  // бока и затылок: каре до подбородка, сзади чуть короче
  for (let k = 0; k < NS; k++){
    const u = (k + 0.5) / NS;
    const th = (0.68 + u * (Math.PI * 2 - 1.36) + Math.PI) % (Math.PI * 2) - Math.PI + (rnd() - 0.5) * 0.04;
    const a = Math.abs(th);
    const yEnd = (-0.25 * (1 - sstep(1.9, 2.5, a)) - 0.19 * sstep(1.9, 2.5, a)) + (rnd() - 0.5) * 0.03;
    const pts = strandPts(th, yEnd, 0.08 + (k % 2) * 0.32, (k % 2) * 0.012, rnd() * 6.3);
    const g = tube(pts, rTip, YSIDES, UVY);
    part(groups.hair, g, strandColor(g, 0.03 + 0.12 * rnd(), 0.35), null, null, strandBlend);
  }
  // пучки: намотанная пряжа — сферическая спираль поверх сплошного шарика, у основания виток-обмотка
  for (let i = 0; i < 2; i++){
    const c = V(...REST[i ? "bunR" : "bunL"]), A = bunDir[i], bone = i ? "bunR" : "bunL", rq = qFrom(V(0, 0, 1), A);
    const turns = { low: 5, med: 8, high: 9 }[q], per = { low: 14, med: 20, high: 24 }[q];
    const U = new THREE.Vector3().crossVectors(A, V(0, 0, 1)).normalize(), W = new THREE.Vector3().crossVectors(A, U);
    const pts = [], n = turns * per;
    for (let k = 0; k <= n; k++){
      const t = k / n, al = (0.1 + 0.82 * t) * Math.PI, be = Math.PI * 2 * turns * t + i * 1.7;
      const ca = Math.cos(al), sa = Math.sin(al);
      pts.push(c.clone().addScaledVector(A, RB * 0.86 * ca).addScaledVector(U, RB * sa * Math.cos(be)).addScaledVector(W, RB * sa * Math.sin(be)));
    }
    const g = tube(pts, RY, YSIDES, UVY);
    part(groups.hair, g, strandColor(g, 0.02, 0), bone);
    const f = sphere(RB - 0.012, 24, 16, 12, 8);
    part(groups.hair, f, hairShade0(0.45), bone, TRS(c, rq, V(1, 1, 0.86)));
    part(groups.hair, new THREE.TorusGeometry(RB * 0.58, RY * 1.05, S(10, 6), S(28, 14)), hairShade0(0.12), bone,
      TRS(c.clone().addScaledVector(A, -RB * 0.7), rq));
  }

  // ===== ШЕЯ =====
  part(groups.felt, new THREE.CylinderGeometry(0.075, 0.085, 0.16, S(20, 10), 1, true), COL.skin, "neck", TRS(V(0, 1.63, 0)));

  // ===== СВИТЕР: чёрная вязка, короткий и свободный, резинка по низу/манжетам/вороту =====
  const SX = 1.1, SZ = 0.82;
  const torsoBlend = y => ["hips", "chest", sstep(1.05, 1.32, y)];
  const TORSO = [[0.001, 1.06], [0.232, 1.06], [0.238, 1.16], [0.246, 1.3], [0.258, 1.42], [0.252, 1.47], [0.215, 1.51], [0.155, 1.545], [0.105, 1.565], [0.098, 1.585]];
  const torsoR = y => {
    for (let k = 1; k < TORSO.length; k++) if (y <= TORSO[k][1]){ const a = TORSO[k - 1], b = TORSO[k]; return a[0] + (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]); }
    return TORSO[TORSO.length - 1][0];
  };
  const KN = ATLAS.knit, RIB = ATLAS.rib, DN = ATLAS.denim;
  {
    const g = lathe(TORSO, S(56, 22));
    latheUV(g, 1, KN[0] + 0.02, KN[1] - 0.02, 1.06, 1.585);
    part(groups.cloth, g, COL.cloth, null, TRS(V(0, 0, 0), null, V(SX, 1, SZ)), torsoBlend);
    const hem = lathe([[0.2, 0.985], [0.226, 0.99], [0.23, 1.055], [0.234, 1.065]], S(56, 22));
    latheUV(hem, 1, RIB[0], RIB[1], 0.985, 1.065);
    part(groups.cloth, hem, COL.cloth, null, TRS(V(0, 0, 0), null, V(SX, 1, SZ)), torsoBlend);
    const col = lathe([[0.092, 1.575], [0.106, 1.58], [0.108, 1.635], [0.1, 1.648], [0.086, 1.643]], S(40, 16));
    latheUV(col, 0.45, RIB[0], RIB[1], 1.575, 1.648);
    part(groups.cloth, col, COL.cloth, "chest", TRS(V(0, 0, 0), null, V(1.06, 1, 0.94)));
  }
  for (const s of [-1, 1]){
    const L = s < 0, a = L ? "armL" : "armR", f = L ? "foreL" : "foreR", r = REST[a];
    const g = lathe([[0.056, -0.53], [0.064, -0.5], [0.07, -0.42], [0.074, -0.28], [0.078, -0.12], [0.08, -0.02], [0.074, 0.02], [0.052, 0.04], [0.001, 0.045]], S(28, 12));
    latheUV(g, 0.36, KN[1] - 0.02, KN[0] + 0.02, 0.045, -0.53);
    part(groups.cloth, g, COL.cloth, null, TRS(V(r[0], r[1], r[2])), y => [a, f, sstep(0.24, 0.36, -y)]);
    const cuff = lathe([[0.036, -0.6], [0.05, -0.6], [0.057, -0.59], [0.055, -0.535], [0.046, -0.53]], S(24, 10));
    latheUV(cuff, 0.35, RIB[0], RIB[1], -0.6, -0.53);
    part(groups.cloth, cuff, COL.cloth, f, TRS(V(r[0], r[1], r[2])));
    // кисть: войлочная ладошка с четырьмя пальцами и большим пальцем вперёд
    const hx = r[0], hy = r[1] - 0.63;
    part(groups.felt, sphere(0.047, 16, 12, 8, 6), COL.skin, f, TRS(V(hx, hy, 0), null, V(0.92, 1.05, 0.55)));
    if (!LOW){
      for (let k = 0; k < 4; k++){
        const len = 0.028 + (k === 1 || k === 2 ? 0.008 : 0);
        part(groups.felt, new THREE.CapsuleGeometry(0.0105, len, 2, S(8, 5)), COL.skin, f,
          TRS(V(hx + (k - 1.5) * 0.023, hy - 0.048 - len * 0.35, 0.002), qE(0, 0, (k - 1.5) * 0.09)));
      }
      part(groups.felt, new THREE.CapsuleGeometry(0.011, 0.028, 2, S(8, 5)), COL.skin, f, TRS(V(hx + s * 0.004, hy + 0.004, -0.036), qE(-0.95, 0, 0)));
    } else part(groups.felt, sphere(0.02, 8, 6, 6, 4), COL.skin, f, TRS(V(hx, hy - 0.04, -0.02), null, V(1, 1.3, 1)));
  }
  // цветы-аппликации из пряжи: 5 лепестков (лайм с синими бусинами / синий с лаймовыми)
  const KINDS = [{ petal: COL.petalLime, bead: COL.beadBlue }, { petal: COL.petalBlue, bead: COL.beadLime }];
  function flower(p, nrm, kind, bone, blend){
    const rq = qFrom(V(0, 0, 1), nrm), K = KINDS[kind];
    for (let k = 0; k < 5; k++){
      const a = k * Math.PI * 2 / 5 + 0.3;
      const off = V(Math.cos(a) * 0.037, Math.sin(a) * 0.037, 0.009).applyQuaternion(rq);
      part(groups.hair, sphere(0.034, 12, 8, 7, 5), K.petal, bone, TRS(p.clone().add(off), rq.clone().multiply(qE(0, 0, a)), V(1.0, 0.78, 0.42)), blend);
    }
    if (LOW) part(groups.face, sphere(0.015, 8, 6, 6, 4), K.bead, bone, TRS(p.clone().add(V(0, 0, 0.018).applyQuaternion(rq))), blend);
    else for (let k = 0; k < 7; k++){
      const a = k * Math.PI * 2 / 6, rr = k < 6 ? 0.0145 : 0;
      const off = V(Math.cos(a) * rr, Math.sin(a) * rr, 0.021).applyQuaternion(rq);
      part(groups.face, sphere(0.009, 8, 6, 6, 4), K.bead, bone, TRS(p.clone().add(off)), blend);
    }
  }
  // раскладка на торсе: (y, угол от лица, вид, минимальное качество)
  const FL = [
    [1.42, -0.5, 0, 0], [1.44, 0.2, 1, 0], [1.4, 0.82, 0, 0], [1.27, -0.22, 1, 0], [1.29, 0.5, 0, 0], [1.13, -0.62, 0, 0], [1.12, 0.08, 1, 1], [1.14, 0.78, 1, 0],
    [1.32, -1.35, 1, 2], [1.3, 1.4, 0, 2],
    [1.42, 2.55, 1, 0], [1.4, -2.5, 0, 0], [1.25, 3.0, 0, 0], [1.12, 2.45, 0, 1], [1.14, -2.8, 1, 1],
  ];
  const qi = { low: 0, med: 1, high: 2 }[q];
  for (const [y, ph, kind, mq] of FL){
    if (mq > qi) continue;
    const r = torsoR(y);
    const p = V(r * SX * Math.sin(ph), y, -r * SZ * Math.cos(ph)), n = V(Math.sin(ph) / SX, 0.05, -Math.cos(ph) / SZ).normalize();
    flower(p.addScaledVector(n, 0.01), n, kind, null, ["hips", "chest", sstep(1.05, 1.32, y)]);
  }
  // по два цветка на внешней стороне каждого рукава
  for (const s of [-1, 1]){
    const L = s < 0, r = REST[L ? "armL" : "armR"];
    const n = V(s, 0.05, -0.25).normalize();
    flower(V(r[0], r[1] - 0.14, 0).addScaledVector(n, 0.076), n, L ? 1 : 0, L ? "armL" : "armR");
    if (!LOW) flower(V(r[0], r[1] - 0.4, 0).addScaledVector(n, 0.072), n, L ? 0 : 1, L ? "foreL" : "foreR");
  }

  // ===== ДЖИНСЫ: ярко-синие, широкие прямые, деним со строчкой по подгибу =====
  {
    const g = lathe([[0.001, 0.86], [0.12, 0.865], [0.19, 0.9], [0.215, 0.95], [0.22, 1.02], [0.215, 1.09], [0.19, 1.11], [0.001, 1.115]], S(40, 16));
    latheUV(g, 1, DN[0] + 0.01, DN[0] + 0.12, 0.86, 1.115);
    part(groups.cloth, g, COL.jeans, "hips", TRS(V(0, 0, 0), null, V(1.1, 1, 0.84)));
  }
  for (const s of [-1, 1]){
    const L = s < 0, th = L ? "thighL" : "thighR", sh = L ? "shinL" : "shinR", ft = L ? "footL" : "footR", r = REST[th];
    // профиль: внутренняя кромка подгиба → низ → наружу вверх до бедра (нормали наружу)
    const leg = lathe([[0.098, -0.7], [0.1, -0.74], [0.118, -0.74], [0.117, -0.72], [0.113, -0.6], [0.109, -0.45], [0.107, -0.3], [0.106, -0.1], [0.1, 0.01], [0.06, 0.045], [0.001, 0.05]], S(32, 12));
    latheUV(leg, 1.2, DN[1] - 0.005, DN[0] + 0.02, -0.74, 0.05);
    const cIn = new THREE.Color(COL.jeansIn), cOut = new THREE.Color(COL.jeans);
    part(groups.cloth, leg, (i, pos) => (pos.getY(i) < -0.69 && Math.hypot(pos.getX(i), pos.getZ(i)) < 0.104 ? cIn : cOut).getHex(), null,
      TRS(V(r[0], r[1], r[2])), y => [th, sh, sstep(0.36, 0.48, -y)]);
    part(groups.felt, new THREE.CylinderGeometry(0.05, 0.054, 0.12, S(14, 8), 1, true), COL.skin, sh, TRS(V(r[0], 0.2, 0)));
    // кеды-конверсы: чёрный верх с высоким бортом, белый мысок, белая подошва с чёрной полоской, лаймовые шнурки
    const x = r[0];
    part(groups.felt, sphere(0.1, 28, 18, 12, 8), COL.shoe, ft, TRS(V(x, 0.1, -0.045), null, V(0.8, 0.62, 1.38)));
    part(groups.felt, new THREE.CylinderGeometry(0.066, 0.078, 0.1, S(20, 10)), COL.shoe, ft, TRS(V(x, 0.155, 0.005)));
    part(groups.felt, new THREE.TorusGeometry(0.066, 0.011, S(6, 4), S(20, 10)), COL.shoe, ft, TRS(V(x, 0.205, 0.005), qE(Math.PI / 2, 0, 0)));
    part(groups.felt, sphere(0.058, 20, 12, 10, 6), COL.sole, ft, TRS(V(x, 0.068, -0.17), null, V(1.2, 0.62, 1.0)));
    part(groups.felt, sphere(0.1, 28, 12, 12, 6), COL.sole, ft, TRS(V(x, 0.03, -0.045), null, V(0.9, 0.34, 1.48)));
    part(groups.felt, new THREE.TorusGeometry(0.1, 0.0045, S(6, 4), S(28, 12)), COL.shoe, ft, TRS(V(x, 0.048, -0.045), qE(Math.PI / 2, 0, 0), V(0.88, 1.44, 1)));
    if (!LOW) for (let k = 0; k < 4; k++){
      part(groups.felt, new THREE.CapsuleGeometry(0.0075, 0.072, 2, S(8, 5)), COL.lace, ft,
        TRS(V(x, 0.108 + k * 0.026, -0.112 + k * 0.02), qE(-0.55, 0, 0).multiply(qE(0, 0, Math.PI / 2 + (k % 2 ? 0.42 : -0.42)))));
    } else part(groups.felt, new THREE.CapsuleGeometry(0.009, 0.06, 2, 6), COL.lace, ft, TRS(V(x, 0.14, -0.09), qE(-0.55, 0, Math.PI / 2)));
  }

  // ===== РЮКЗАК (опция opts.backpack — на мастер-листе его нет) =====
  if (opts.backpack){
    const rb = Math.max(1, Math.round(4 * qf));
    part(groups.felt, new RoundedBoxGeometry(0.4, 0.44, 0.19, rb, 0.08), COL.pack, "pack", TRS(V(0, 1.27, 0.305)));
    part(groups.felt, new RoundedBoxGeometry(0.415, 0.2, 0.215, rb, 0.085), COL.flap, "pack", TRS(V(0, 1.43, 0.312), qE(0.12, 0, 0)));
    part(groups.felt, new RoundedBoxGeometry(0.26, 0.15, 0.07, Math.max(1, rb - 1), 0.03), COL.pocket, "pack", TRS(V(0, 1.15, 0.405)));
    part(groups.felt, sphere(0.03, 12, 8, 8, 6), COL.scarf, "pack", TRS(V(0.1, 1.24, 0.445)));
    for (const s of [-1, 1]){
      const rq = new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), -Math.PI / 2).multiply(new THREE.Quaternion().setFromAxisAngle(V(0, 0, 1), Math.PI * 0.4));
      part(groups.felt, new THREE.TorusGeometry(0.2, 0.024, S(8, 5), S(24, 10), Math.PI * 0.5), COL.flap, "chest", TRS(V(s * 0.17, 1.3, 0.08), rq, V(1, 1.0, 1.1)));
    }
  }

  // ---------- материалы ----------
  const sunU = { value: new THREE.Vector3(11, 17, 7).normalize() };
  const Mat = (p, sheenCol, sheenR) => {
    if (LOW) return new THREE.MeshStandardMaterial(p);
    return new THREE.MeshPhysicalMaterial(Object.assign(p, sheenCol != null ? { sheen: 1, sheenRoughness: sheenR, sheenColor: new THREE.Color(sheenCol) } : {}));
  };
  const atlas = clothAtlas(q), hairBump = hairBumpTexture(q);
  const mats = {
    // войлок: матовый, sheen светло-синим (ворс на скользящих углах), волокна из шейдера
    felt: Mat({ color: 0xffffff, vertexColors: true, roughness: 0.92, metalness: 0 }, 0x7fa8ff, 0.8),
    cloth: Mat({ color: 0xffffff, map: atlas, vertexColors: true, roughness: 0.95, metalness: 0 }, 0x3a3f55, 0.85),
    hair: Mat({ color: 0xffffff, vertexColors: true, roughness: 0.66, metalness: 0, bumpMap: hairBump, bumpScale: HIGH ? 1.5 : 1.2 }, 0xdcf090, 0.55),
    face: LOW ? new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.18 })
              : new THREE.MeshPhysicalMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.06 }),
  };
  if (!LOW){
    patchFibre(mats.felt, { freq: 95, amp: 0.11, nrm: 0.12 });
    patchFibre(mats.cloth, { freq: 120, amp: 0.07, nrm: 0.06 });
    patchFibre(mats.hair, { freq: 160, amp: 0.05, nrm: 0.03 });
  }
  for (const k in mats) mats[k].name = "rizy:" + k;

  const meshes = {};
  let tris = 0;
  for (const k of ["felt", "cloth", "hair", "face"]){
    const geo = mergeGeometries(groups[k], false);
    for (const g of groups[k]) g.dispose();
    geo.computeBoundingSphere(); geo.computeBoundingBox();
    tris += geo.index.count / 3;
    const m = new THREE.SkinnedMesh(geo, mats[k]);
    m.name = "rizy:" + k;
    // на low карт теней нет (bible: только blob-тени) — не держим лишние теневые проходы
    m.castShadow = k !== "face" && !LOW; m.receiveShadow = !LOW;
    m.frustumCulled = false;
    squashG.add(m);
    m.bind(skeleton, m.matrixWorld);
    meshes[k] = m;
  }
  squashG.scale.setScalar(baseScale);

  // якоря шарфа (лента строится в index.js только по opts.scarf): узел за левым плечом, хвосты назад-влево
  const anchors = [];
  for (const s of [-1, 1]){
    const o = new THREE.Object3D(); o.name = "rizy:scarfAnchor" + (s < 0 ? "L" : "R");
    o.position.set(-0.115 + s * 0.03, 1.585 - REST.chest[1], 0.17 + s * 0.012);
    byName.chest.add(o);
    anchors.push({ obj: o, dirObj: byName.chest, dir: [-0.55 + s * 0.12, -0.2, 1] });
  }
  const colliders = [
    { obj: byName.pack, up: -0.02 * baseScale, back: 0.1 * baseScale, r: (opts.backpack ? 0.2 : 0.12) * baseScale },
    { obj: byName.chest, up: 0.02, back: 0.0, r: 0.2 * baseScale },
    { obj: byName.head, up: 0.24 * baseScale, back: 0.02, r: 0.35 * baseScale },
  ];

  function applyPose(base, add, out){
    for (let i = 0; i < 18; i++){
      const o = i * 3;
      bones[i].rotation.set(base[o] + add[o], base[o + 1] + add[o + 1], base[o + 2] + add[o + 2]);
    }
    const h = byName.hips, hr = h.userData.rest;
    h.position.set(hr.x + base[54] + add[54], hr.y + base[55] + add[55], hr.z + base[56] + add[56]);
    const bl = byName.bunL, blr = bl.userData.rest, br = byName.bunR, brr = br.userData.rest;
    bl.position.set(blr.x - out.bunX, blr.y - out.bunY * 0.85, blr.z);
    br.position.set(brr.x - out.bunX * 0.8, brr.y - out.bunY, brr.z);
    const p = byName.pack, pr = p.userData.rest;
    p.position.set(pr.x - out.packX, pr.y - out.packY, pr.z);
    p.rotation.x += out.packRx; p.rotation.z += out.packRz;
    byName.eyeL.scale.set(1, out.eyeL, 1); byName.eyeR.scale.set(1, out.eyeR, 1);
  }

  function dispose(){
    for (const k in meshes){ meshes[k].geometry.dispose(); }
    for (const k in mats) mats[k].dispose();
    atlas.dispose(); hairBump.dispose();
    skeleton.dispose();
  }

  return {
    kind: "procedural", root, yawG, squashG, baseScale, bones, byName, skeleton, meshes, mats,
    rimTargets: { body: [mats.felt, mats.cloth], hair: [mats.hair], face: mats.face },
    sunU, anchors, colliders, applyPose, dispose,
    info: { tris, quality: q },
  };
}

// цвет пряжи по вершине: k — доля тёмного (изнанка, глубина между прядями)
const HAIR_C = new THREE.Color(COL.hair), HAIR_IN = new THREE.Color(COL.hairIn), HAIR_T = new THREE.Color();
function hairShade(i, pos){
  const sh = pos.userData && pos.userData.shade;
  return HAIR_T.copy(HAIR_C).lerp(HAIR_IN, sh ? sh[i] : 0).getHex();
}
function hairShade0(k){ return HAIR_T.copy(HAIR_C).lerp(HAIR_IN, k).getHex(); }

// Трубка вдоль ломаной pts: кольца с параллельным переносом репера, скруглённые торцы (кольцо + полюс),
// радиус — число или функция r(t). uv: u = доля окружности·a + длина·t (кручение), v = длина·l.
// В position.userData.t — параметр 0..1 по длине на каждую вершину (для окраски).
function tube(pts, radius, sides, uvk){
  const n = pts.length, rf = typeof radius === "function" ? radius : () => radius;
  const tn = [], nn = [], bn = [];
  for (let i = 0; i < n; i++){ const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)]; tn.push(b.clone().sub(a).normalize()); }
  const nr = new THREE.Vector3(0, 0, 1);
  if (Math.abs(nr.dot(tn[0])) > 0.9) nr.set(1, 0, 0);
  nr.addScaledVector(tn[0], -nr.dot(tn[0])).normalize();
  for (let i = 0; i < n; i++){
    if (i){ nr.addScaledVector(tn[i], -nr.dot(tn[i])); if (nr.lengthSq() < 1e-6) nr.set(1, 0, 0).addScaledVector(tn[i], -tn[i].x); nr.normalize(); }
    nn.push(nr.clone()); bn.push(new THREE.Vector3().crossVectors(tn[i], nr));
  }
  const len = [0]; for (let i = 1; i < n; i++) len.push(len[i - 1] + pts[i].distanceTo(pts[i - 1]));
  const Lt = len[n - 1] || 1;
  const R = n + 2, nv = R * sides + 2;
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), tt = new Float32Array(nv);
  const P = new THREE.Vector3(), Q = new THREE.Vector3(), C = new THREE.Vector3();
  let w = 0;
  const ring = (c, t, nrm, bin, r, u, capN) => {
    for (let k = 0; k < sides; k++){
      const a = k / sides * Math.PI * 2;
      Q.copy(nrm).multiplyScalar(Math.cos(a)).addScaledVector(bin, Math.sin(a));
      P.copy(c).addScaledVector(Q, r);
      pos[w * 3] = P.x; pos[w * 3 + 1] = P.y; pos[w * 3 + 2] = P.z;
      if (capN) Q.addScaledVector(t, capN).normalize();
      nor[w * 3] = Q.x; nor[w * 3 + 1] = Q.y; nor[w * 3 + 2] = Q.z;
      uv[w * 2] = (k / sides) * uvk.a + u * uvk.t; uv[w * 2 + 1] = u * uvk.l;
      tt[w] = Math.min(1, Math.max(0, u / Lt));
      w++;
    }
  };
  const r0 = rf(0), r1 = rf(1);
  C.copy(pts[0]).addScaledVector(tn[0], -r0 * 0.5);
  ring(C, tn[0], nn[0], bn[0], r0 * 0.62, -r0 * 0.5, -0.8);
  for (let i = 0; i < n; i++) ring(pts[i], tn[i], nn[i], bn[i], rf(len[i] / Lt), len[i], 0);
  C.copy(pts[n - 1]).addScaledVector(tn[n - 1], r1 * 0.5);
  ring(C, tn[n - 1], nn[n - 1], bn[n - 1], r1 * 0.62, Lt + r1 * 0.5, 0.8);
  const p0 = w;
  P.copy(pts[0]).addScaledVector(tn[0], -r0 * 0.9);
  pos[w * 3] = P.x; pos[w * 3 + 1] = P.y; pos[w * 3 + 2] = P.z; nor[w * 3] = -tn[0].x; nor[w * 3 + 1] = -tn[0].y; nor[w * 3 + 2] = -tn[0].z; tt[w] = 0; w++;
  const p1 = w;
  P.copy(pts[n - 1]).addScaledVector(tn[n - 1], r1 * 0.9);
  pos[w * 3] = P.x; pos[w * 3 + 1] = P.y; pos[w * 3 + 2] = P.z; nor[w * 3] = tn[n - 1].x; nor[w * 3 + 1] = tn[n - 1].y; nor[w * 3 + 2] = tn[n - 1].z; tt[w] = 1; w++;
  const idx = new Uint32Array((R - 1) * sides * 6 + sides * 6);
  let o = 0;
  for (let j = 0; j < R - 1; j++) for (let k = 0; k < sides; k++){
    const a = j * sides + k, b = j * sides + (k + 1) % sides, c = a + sides, d = b + sides;
    idx[o++] = a; idx[o++] = b; idx[o++] = c; idx[o++] = b; idx[o++] = d; idx[o++] = c;
  }
  const last = (R - 1) * sides;
  for (let k = 0; k < sides; k++){
    idx[o++] = p0; idx[o++] = (k + 1) % sides; idx[o++] = k;
    idx[o++] = p1; idx[o++] = last + k; idx[o++] = last + (k + 1) % sides;
  }
  const g = new THREE.BufferGeometry();
  const pa = new THREE.BufferAttribute(pos, 3); pa.userData = { t: tt };
  g.setAttribute("position", pa);
  g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

// Подложка каре под прядями: профиль (r, y) заметается вокруг оси головы; кромка — над бровями спереди
// (чёлка свисает ниже), до подбородка по бокам, чуть короче сзади; ниже экватора лёгкий колокол,
// кромка подвёрнута внутрь (толщина). Спереди вершин гуще. Цвет — тёмный лайм (между прядями читается глубина).
function hairCap(q){
  const NU = { low: 40, med: 64, high: 96 }[q], NV = { low: 9, med: 12, high: 18 }[q];
  const NR = { low: 2, med: 4, high: 6 }[q], NI = 1;
  const Rh = RS, TH = 0.02, C = HC, FLARE = 0.045, DROP = 0.26;
  const rows = NV + NR + NI, nVert = (NU + 1) * rows;
  const pos = new Float32Array(nVert * 3), uv = new Float32Array(nVert * 2), shade = new Float32Array(nVert);
  const hem = th => {
    const a = Math.abs(th);
    const front = 0.2 - 0.03 * sstep(0.3, 0.62, a), side = -0.235, back = -0.19;
    const w1 = sstep(0.55, 0.95, a), w2 = sstep(1.9, 2.45, a);
    return (front * (1 - w1) + side * w1) * (1 - w2) + back * w2;
  };
  for (let i = 0; i <= NU; i++){
    const s = (i / NU) * 2 - 1;
    const th = Math.PI * s * (0.5 + 0.5 * s * s);
    const sx = Math.sin(th), sz = -Math.cos(th);
    const yh = hem(th);
    const phiEnd = yh >= 0 ? Math.acos(Math.min(1, yh / Rh)) : Math.PI / 2;
    const arc = Rh * phiEnd, drop = Math.max(0, -yh), L = arc + drop;
    const emit = (j, r, y, v, sh) => {
      const o = i * rows + j;
      pos[o * 3] = C.x + r * sx * HS.x * 1.02; pos[o * 3 + 1] = C.y + y * 0.96; pos[o * 3 + 2] = C.z + r * sz * HS.z;
      uv[o * 2] = (th / (2 * Math.PI) + 0.5) * 9; uv[o * 2 + 1] = v;
      shade[o] = sh;
    };
    let hr = 0, hy = 0, nr = 0, ny = 0, tr = 0, ty = 0;
    for (let j = 0; j < NV; j++){
      const jt = j / (NV - 1), d = L * Math.pow(jt, 0.85);
      let r, y;
      if (d <= arc){
        const ph = d / Rh; r = Rh * Math.sin(ph); y = Rh * Math.cos(ph);
        nr = Math.sin(ph); ny = Math.cos(ph); tr = Math.cos(ph); ty = -Math.sin(ph);
      } else {
        const dd = d - arc, k = dd / DROP, kk = Math.pow(k, 1.6);
        r = Rh + FLARE * kk; y = -dd;
        const dr = FLARE * 1.6 * Math.pow(Math.max(k, 1e-4), 0.6) / DROP;
        tr = dr; ty = -1; nr = 1; ny = dr;
      }
      emit(j, r, y, d / 0.9, 0.5);
      hr = r; hy = y;
    }
    const nl = Math.hypot(nr, ny), tl = Math.hypot(tr, ty);
    nr /= nl; ny /= nl; tr /= tl; ty /= tl;
    const cr = hr - nr * TH, cy = hy - ny * TH;
    for (let k = 1; k <= NR; k++){
      const a = (k / NR) * Math.PI;
      emit(NV - 1 + k, cr + TH * (nr * Math.cos(a) + tr * Math.sin(a)), cy + TH * (ny * Math.cos(a) + ty * Math.sin(a)), (L + TH * a) / 0.9, 0.5 + 0.25 * k / NR);
    }
    for (let k = 1; k <= NI; k++){
      const sI = k * 0.07;
      emit(NV + NR - 1 + k, cr - nr * TH - tr * sI, cy - ny * TH - ty * sI, (L + TH * 3.2 + sI) / 0.9, 0.8);
    }
  }
  const idx = new Uint32Array(NU * (rows - 1) * 6);
  let w = 0;
  for (let i = 0; i < NU; i++){
    for (let j = 0; j < rows - 1; j++){
      const a = i * rows + j, b = (i + 1) * rows + j, c = a + 1, d = b + 1;
      idx[w++] = a; idx[w++] = b; idx[w++] = c; idx[w++] = b; idx[w++] = d; idx[w++] = c;
    }
  }
  const g = new THREE.BufferGeometry();
  const pa = new THREE.BufferAttribute(pos, 3);
  pa.userData = { shade };
  g.setAttribute("position", pa);
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  // шов сзади и полюс: усредняем нормали
  const n = g.attributes.normal;
  for (let j = 0; j < rows; j++){
    const a = j, b = NU * rows + j;
    const x = n.getX(a) + n.getX(b), y = n.getY(a) + n.getY(b), z = n.getZ(a) + n.getZ(b), l = Math.hypot(x, y, z) || 1;
    n.setXYZ(a, x / l, y / l, z / l); n.setXYZ(b, x / l, y / l, z / l);
  }
  for (let i = 0; i <= NU; i++) n.setXYZ(i * rows, 0, 1, 0);
  // проверка ориентации: нормаль макушки наружу (иначе переворачиваем порядок)
  const probe = rows * Math.round(NU / 2) + Math.round(NV / 2);
  const px = pos[probe * 3] - C.x, py = pos[probe * 3 + 1] - C.y, pz = pos[probe * 3 + 2] - C.z;
  if (n.getX(probe) * px + n.getY(probe) * py + n.getZ(probe) * pz < 0){
    const ix = g.index.array;
    for (let k = 0; k < ix.length; k += 3){ const t = ix[k + 1]; ix[k + 1] = ix[k + 2]; ix[k + 2] = t; }
    for (let k = 0; k < n.count; k++) n.setXYZ(k, -n.getX(k), -n.getY(k), -n.getZ(k));
  }
  return g;
}
