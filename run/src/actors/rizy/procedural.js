// Процедурная премиальная Ризи: гладкие формы (Lathe/Sphere/Tube/RoundedBox), сшитые в 4 SkinnedMesh
// по материалу на одном скелете (войлок, свитер, волосы, лицо) + verlet-шарф.
// Жёсткие части весят на одну кость, рукава/штанины/торс — плавный бленд двух костей (гладкий сгиб).
// Сегментация зависит от качества (QF): high ≈ 50k, med ≤ 35k, low ≤ 15k треугольников.
// Итого 5 draw calls (+4 в теневом проходе; на low теней нет).
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { BONES, B } from "./anim.js";
import { sweaterTexture, hairBumpTexture } from "./textures.js";

// ---------- палитра (sRGB) ----------
export const COL = {
  skin: 0x4fb2f2, blush: 0x8790ff, hair: 0xD2F23E, hairIn: 0x9cbc22, tie: 0xff5fa2,
  jeans: 0x2a62f0, cuff: 0x4a84fa, sweater: 0x15161d, rib: 0x1d1f2a,
  shoe: 0x1b1c26, sole: 0xf3f2ec, pack: 0x2f6ff2, flap: 0x1f50d2, pocket: 0x4a8cff,
  scarf: 0xC0FF3F, eyeWhite: 0xf4f7ff, pupil: 0x0b0d1e, mouth: 0x3a0c24, shine: 0xffffff,
};

// множитель сегментации по качеству
const QF = { low: 0.4, med: 0.62, high: 1 };

// позиции суставов в позе привязки (м, ноги на y=0, лицо в −Z)
const REST = {
  hips: [0, 0.98, 0], spine: [0, 1.08, 0], chest: [0, 1.3, 0], neck: [0, 1.55, 0], head: [0, 1.64, 0],
  thighL: [-0.115, 0.93, 0], shinL: [-0.115, 0.52, 0], footL: [-0.115, 0.13, 0],
  thighR: [0.115, 0.93, 0], shinR: [0.115, 0.52, 0], footR: [0.115, 0.13, 0],
  armL: [-0.305, 1.465, 0.0], foreL: [-0.305, 1.18, 0.0], armR: [0.305, 1.465, 0.0], foreR: [0.305, 1.18, 0.0],
  pack: [0, 1.3, 0.22], bunL: [0, 0, 0], bunR: [0, 0, 0], eyeL: [0, 0, 0], eyeR: [0, 0, 0],
};
const PARENT = {
  hips: null, spine: "hips", chest: "spine", neck: "chest", head: "neck",
  thighL: "hips", shinL: "thighL", footL: "shinL", thighR: "hips", shinR: "thighR", footR: "shinR",
  armL: "chest", foreL: "armL", armR: "chest", foreR: "armR", pack: "chest",
  bunL: "head", bunR: "head", eyeL: "head", eyeR: "head",
};
const HC = new THREE.Vector3(0, 1.89, 0), HR = 0.3, HS = new THREE.Vector3(1.0, 0.95, 0.97);

const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// точка на поверхности головы по направлению d (голова — эллипсоид)
function headSurf(d, inset = 0){
  const n = d.clone().normalize();
  return V(HC.x + n.x * (HR * HS.x - inset), HC.y + n.y * (HR * HS.y - inset), HC.z + n.z * (HR * HS.z - inset));
}

export function buildProcedural(ctx, opts = {}){
  const q = ctx.quality === "low" ? "low" : ctx.quality === "high" ? "high" : "med";
  const LOW = q === "low", HIGH = q === "high";
  const look = ctx.look && (ctx.look.mats || ctx.look);
  const qf = QF[q];
  // число сегментов: n — «эталон high», mn — нижняя граница (круглый силуэт не должен граниться)
  const S = (n, mn = 6) => Math.max(mn, Math.round(n * qf));

  // ---------- скелет ----------
  const root = new THREE.Group(); root.name = "rizy";
  const yawG = new THREE.Group(); yawG.name = "rizy:lean"; root.add(yawG);
  const squashG = new THREE.Group(); squashG.name = "rizy:squash"; yawG.add(squashG);
  const baseScale = opts.scale || 0.93;
  squashG.scale.setScalar(baseScale);

  // пучки и глаза — вычисляемые позиции
  const bunDir = [V(-0.6, 0.78, 0.16).normalize(), V(0.6, 0.78, 0.16).normalize()];
  REST.bunL = HC.clone().addScaledVector(bunDir[0], 0.37).toArray();
  REST.bunR = HC.clone().addScaledVector(bunDir[1], 0.37).toArray();
  const eyeDir = [V(-0.34, -0.06, -0.94).normalize(), V(0.34, -0.06, -0.94).normalize()];
  const eyePos = eyeDir.map(d => headSurf(d, 0.022));
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
  const groups = { felt: [], sweater: [], hair: [], face: [] };
  const tmpC = new THREE.Color();
  // blend(y_local, x, z) → [boneA, boneB, wB]; m — матрица размещения после расчёта весов;
  // color — число или функция (i, pos) → число (градиент по вершинам)
  function part(list, geo, color, bone, m, blend){
    const pos = geo.attributes.position, n = pos.count;
    // RoundedBoxGeometry неиндексирован — mergeGeometries требует единообразия
    if (!geo.index){ const ix = new Uint32Array(n); for (let i = 0; i < n; i++) ix[i] = i; geo.setIndex(new THREE.BufferAttribute(ix, 1)); }
    const col = new Float32Array(n * 3), si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    if (typeof color !== "function") tmpC.set(color);
    for (let i = 0; i < n; i++){
      if (typeof color === "function") tmpC.set(color(i, pos));
      col[i * 3] = tmpC.r; col[i * 3 + 1] = tmpC.g; col[i * 3 + 2] = tmpC.b;
      if (blend){
        const r = blend(pos.getY(i), pos.getX(i), pos.getZ(i));
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
  const lathe = (pts, segs) => new THREE.LatheGeometry(pts.map(p => new THREE.Vector2(p[0], p[1])), segs);
  const sphere = (r, w, h, mw = 8, mh = 6) => new THREE.SphereGeometry(r, S(w, mw), S(h, mh));

  // ===== ГОЛОВА =====
  part(groups.felt, sphere(HR, 56, 40, 24, 16), COL.skin, "head", TRS(HC, null, HS));
  for (const s of [-1, 1]){
    // уши торчат из каре, как на мастер-листе
    part(groups.felt, sphere(0.072, 20, 14), COL.skin, "head", TRS(V(s * 0.333, HC.y - 0.05, 0.02), qE(0, 0, -s * 0.12), V(0.5, 0.92, 0.75)));
    // румянец: мягкий овал чуть над кожей
    const d = V(s * 0.55, -0.34, -0.76).normalize();
    part(groups.felt, sphere(0.045, 18, 12), COL.blush, "head", TRS(headSurf(d, 0.004), qFrom(V(0, 0, 1), d), V(1.0, 0.6, 0.12)));
  }
  part(groups.felt, sphere(0.021, 14, 10), COL.skin, "head", TRS(headSurf(V(0, -0.14, -1), -0.006), null, V(1.15, 0.85, 0.7)));

  // лицо: крупные глаза-«пуговки» с тонким белым ободком, два блика, улыбка
  for (let i = 0; i < 2; i++){
    const d = eyeDir[i], p = eyePos[i], bone = i ? "eyeR" : "eyeL", rq = qFrom(V(0, 0, 1), d);
    part(groups.face, sphere(0.082, 36, 26, 16, 10), COL.eyeWhite, bone, TRS(p, rq, V(0.84, 1.1, 0.4)));
    const pp = p.clone().addScaledVector(d, 0.01).add(V((i ? -1 : 1) * 0.005, -0.004, 0));
    part(groups.face, sphere(0.07, 32, 22, 14, 10), COL.pupil, bone, TRS(pp, rq, V(0.83, 1.07, 0.42)));
    const up = V(0, 1, 0).addScaledVector(d, -d.y).normalize(), side = new THREE.Vector3().crossVectors(up, d).normalize();
    const sgn = i ? 1 : -1;
    part(groups.face, sphere(0.02, 12, 8, 8, 6), COL.shine, bone, TRS(pp.clone().addScaledVector(d, 0.029).addScaledVector(up, 0.03).addScaledVector(side, sgn * 0.018), rq, V(1, 1, 0.5)));
    part(groups.face, sphere(0.0095, 8, 6, 6, 4), COL.shine, bone, TRS(pp.clone().addScaledVector(d, 0.027).addScaledVector(up, -0.026).addScaledVector(side, -sgn * 0.02), rq, V(1, 1, 0.5)));
  }
  {
    const pts = [];
    for (let k = 0; k <= 10; k++){
      const t = k / 5 - 1, x = 0.06 * t, y = HC.y - 0.118 + 0.024 * t * t;
      const ny = (y - HC.y) / (HR * HS.y), nx = x / (HR * HS.x);
      const z = -Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny)) * HR * HS.z - 0.002;
      pts.push(V(x, y, z));
    }
    const cur = new THREE.CatmullRomCurve3(pts);
    part(groups.face, new THREE.TubeGeometry(cur, S(24, 12), 0.0115, S(8, 5), false), COL.mouth, "head");
    for (const p of [pts[0], pts[10]]) part(groups.face, sphere(0.0115, 8, 6, 6, 4), COL.mouth, "head", TRS(p));
  }

  // ===== ВОЛОСЫ: каре-«колокол» со ступенчатой кромкой, прядями чёлки и открытой шеей =====
  part(groups.hair, hairShell(q), hairShade, "head");
  for (let i = 0; i < 2; i++){
    const d = bunDir[i], c = V(...REST[i ? "bunR" : "bunL"]), bone = i ? "bunR" : "bunL", rq = qFrom(V(0, 1, 0), d);
    const g = sphere(0.125, 40, 28, 16, 12);
    const uv = g.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setX(k, uv.getX(k) * 3);
    part(groups.hair, g, COL.hair, bone, TRS(c, rq, V(1, 0.92, 1)));
    part(groups.felt, new THREE.TorusGeometry(0.083, 0.024, S(12, 6), S(32, 14)), COL.tie, bone,
      TRS(c.clone().addScaledVector(d, -0.09), rq.clone().multiply(qE(Math.PI / 2, 0, 0))));
  }

  // ===== ШЕЯ, ШАРФ-ВОРОТНИК =====
  part(groups.felt, new THREE.CylinderGeometry(0.07, 0.08, 0.18, S(20, 10), 1, true), COL.skin, "neck", TRS(V(0, 1.62, 0)));
  // воротник шарфа в группе волос: bump «прядей» по u тора даёт вязаный рубчик
  {
    const g = new THREE.TorusGeometry(0.15, 0.058, S(16, 8), S(48, 20));
    const uv = g.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setX(k, uv.getX(k) * 3.2);
    part(groups.hair, g, COL.scarf, "chest", TRS(V(0, 1.582, 0.005), qE(Math.PI / 2 + 0.08, 0, 0), V(1.08, 1.0, 0.94)));
    const g2 = new THREE.TorusGeometry(0.128, 0.04, S(12, 6), S(40, 18));
    const uv2 = g2.attributes.uv; for (let k = 0; k < uv2.count; k++) uv2.setX(k, uv2.getX(k) * 2.6);
    part(groups.hair, g2, COL.scarf, "chest", TRS(V(0, 1.64, 0.012), qE(Math.PI / 2 - 0.1, 0, 0), V(1.08, 1.0, 0.94)));
    // узел за левым плечом — отсюда растут verlet-хвосты
    const k = sphere(0.072, 20, 14, 10, 8);
    const uv3 = k.attributes.uv; for (let j = 0; j < uv3.count; j++) uv3.setX(j, uv3.getX(j) * 1.5);
    part(groups.hair, k, COL.scarf, "chest", TRS(V(-0.115, 1.58, 0.135), qE(0.3, -0.5, Math.PI / 2), V(0.95, 1.2, 0.8)));
  }

  // ===== СВИТЕР =====
  const torsoBlend = y => ["hips", "chest", sstep(1.02, 1.3, y)];
  {
    const g = lathe([[0.001, 0.905], [0.2, 0.905], [0.222, 0.93], [0.222, 1.0], [0.214, 1.1], [0.222, 1.2], [0.24, 1.3],
      [0.252, 1.38], [0.248, 1.45], [0.225, 1.51], [0.17, 1.56], [0.1, 1.585], [0.085, 1.62], [0.08, 1.66]], S(56, 22));
    const uv = g.attributes.uv, pos = g.attributes.position;
    for (let k = 0; k < uv.count; k++) uv.setY(k, (pos.getY(k) - 0.9) / 0.72);
    part(groups.sweater, g, 0xffffff, null, TRS(V(0, 0, 0), null, V(1.12, 1, 0.84)), torsoBlend);
    // резинка по низу
    part(groups.felt, lathe([[0.226, 0.9], [0.236, 0.912], [0.238, 0.945], [0.228, 0.96]], S(56, 22)), COL.rib, null,
      TRS(V(0, 0, 0), null, V(1.12, 1, 0.84)), torsoBlend);
  }
  for (const s of [-1, 1]){
    const L = s < 0, a = L ? "armL" : "armR", f = L ? "foreL" : "foreR", r = REST[a];
    const g = lathe([[0.001, 0.088], [0.05, 0.078], [0.078, 0.05], [0.09, 0.0], [0.087, -0.08], [0.08, -0.2], [0.074, -0.285],
      [0.068, -0.38], [0.064, -0.47], [0.062, -0.5]], S(28, 12));
    const uv = g.attributes.uv, pos = g.attributes.position;
    for (let k = 0; k < uv.count; k++){ uv.setX(k, uv.getX(k) * 0.36 + (L ? 0.1 : 0.6)); uv.setY(k, (-pos.getY(k) + 0.1) / 0.72); }
    part(groups.sweater, g, 0xffffff, null, TRS(V(r[0], r[1], r[2])), y => [a, f, sstep(0.23, 0.34, -y)]);
    part(groups.felt, lathe([[0.061, -0.49], [0.07, -0.5], [0.071, -0.545], [0.062, -0.555]], S(24, 10)), COL.rib, f, TRS(V(r[0], r[1], r[2])));
    // кисть-варежка с большим пальцем
    part(groups.felt, sphere(0.068, 20, 14, 10, 8), COL.skin, f, TRS(V(r[0], r[1] - 0.605, r[2]), null, V(0.78, 1.05, 0.62)));
    part(groups.felt, sphere(0.028, 10, 8, 6, 4), COL.skin, f, TRS(V(r[0] - s * 0.045, r[1] - 0.585, r[2] - 0.03), null, V(1, 1.3, 1)));
  }

  // ===== ДЖИНСЫ =====
  part(groups.felt, lathe([[0.001, 0.8], [0.1, 0.806], [0.17, 0.84], [0.205, 0.9], [0.212, 0.98], [0.2, 1.05], [0.15, 1.085], [0.001, 1.095]], S(40, 16)),
    COL.jeans, "hips", TRS(V(0, 0, 0), null, V(1.12, 1, 0.86)));
  for (const s of [-1, 1]){
    const L = s < 0, th = L ? "thighL" : "thighR", sh = L ? "shinL" : "shinR", ft = L ? "footL" : "footR", r = REST[th];
    const leg = lathe([[0.001, 0.06], [0.07, 0.05], [0.112, 0.02], [0.12, -0.06], [0.114, -0.2], [0.104, -0.33], [0.097, -0.41],
      [0.092, -0.5], [0.092, -0.6], [0.095, -0.66], [0.096, -0.7]], S(32, 12));
    part(groups.felt, leg, COL.jeans, null, TRS(V(r[0], r[1], r[2])), y => [th, sh, sstep(0.34, 0.48, -y)]);
    // подворот
    part(groups.felt, lathe([[0.094, -0.6], [0.108, -0.607], [0.117, -0.63], [0.119, -0.67], [0.115, -0.705], [0.104, -0.722], [0.09, -0.726]], S(32, 12)),
      COL.cuff, sh, TRS(V(r[0], r[1], r[2])));
    part(groups.felt, new THREE.CylinderGeometry(0.056, 0.06, 0.1, S(14, 8), 1, true), COL.skin, sh, TRS(V(r[0], 0.235, 0)));
    // кеды: чёрный верх, высокий борт, белый мысок, подошва и шнурки
    const x = r[0];
    part(groups.felt, sphere(0.1, 28, 18, 12, 8), COL.shoe, ft, TRS(V(x, 0.098, -0.06), null, V(0.92, 0.66, 1.55)));
    part(groups.felt, new THREE.CylinderGeometry(0.072, 0.082, 0.14, S(20, 10)), COL.shoe, ft, TRS(V(x, 0.175, 0.0)));
    part(groups.felt, new THREE.TorusGeometry(0.071, 0.013, S(6, 4), S(20, 10)), COL.shoe, ft, TRS(V(x, 0.245, 0.0), qE(Math.PI / 2, 0, 0)));
    part(groups.felt, sphere(0.062, 20, 12, 10, 6), COL.sole, ft, TRS(V(x, 0.078, -0.19), null, V(1.3, 0.72, 1.0)));
    part(groups.felt, sphere(0.1, 28, 12, 12, 6), COL.sole, ft, TRS(V(x, 0.034, -0.06), null, V(1.0, 0.3, 1.66)));
    // шнурки видны только вблизи — на low не строим
    if (!LOW) for (let k = 0; k < 3; k++){
      part(groups.felt, new THREE.CapsuleGeometry(0.0085, 0.07, 2, S(8, 5)), COL.sole, ft,
        TRS(V(x, 0.13 + k * 0.032, -0.105 + k * 0.022), qE(-0.6, 0, Math.PI / 2)));
    }
  }

  // ===== РЮКЗАК =====
  {
    const rs = Math.max(1, Math.round(4 * qf));
    part(groups.felt, new RoundedBoxGeometry(0.4, 0.44, 0.19, rs, 0.08), COL.pack, "pack", TRS(V(0, 1.27, 0.305)));
    part(groups.felt, new RoundedBoxGeometry(0.415, 0.2, 0.215, rs, 0.085), COL.flap, "pack", TRS(V(0, 1.43, 0.312), qE(0.12, 0, 0)));
    part(groups.felt, new RoundedBoxGeometry(0.26, 0.15, 0.07, Math.max(1, rs - 1), 0.03), COL.pocket, "pack", TRS(V(0, 1.15, 0.405)));
    part(groups.felt, sphere(0.03, 12, 8, 8, 6), COL.scarf, "pack", TRS(V(0.1, 1.24, 0.445)));
    if (!LOW) part(groups.felt, new THREE.CapsuleGeometry(0.006, 0.05, 2, 6), COL.flap, "pack", TRS(V(0.1, 1.285, 0.44)));
    for (const s of [-1, 1]){
      // лямка: дуга от верха плеча назад к рюкзаку (спереди не протыкает грудь)
      const rq = new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), -Math.PI / 2).multiply(new THREE.Quaternion().setFromAxisAngle(V(0, 0, 1), Math.PI * 0.4));
      // дуга 0.5π со сдвигом назад: передний конец уходит в плечо, а не торчит «язычком» на груди
      part(groups.felt, new THREE.TorusGeometry(0.2, 0.024, S(8, 5), S(24, 10), Math.PI * 0.5), COL.flap, "chest",
        TRS(V(s * 0.17, 1.3, 0.08), rq, V(1, 1.0, 1.1)));
    }
  }

  // ---------- материалы ----------
  const sunU = { value: new THREE.Vector3(11, 17, 7).normalize() };
  const noise = look && look.tex && look.tex.noiseNormal ? look.tex.noiseNormal : null;
  const Mat = (p, sheenK) => {
    if (LOW) return new THREE.MeshStandardMaterial(p);
    return new THREE.MeshPhysicalMaterial(Object.assign(p, sheenK != null ? { sheen: 1, sheenRoughness: 0.55, sheenColor: new THREE.Color(sheenK, sheenK, sheenK * 1.05) } : {}));
  };
  const sweaterMap = sweaterTexture(q), hairBump = hairBumpTexture(q);
  const mats = {
    felt: Mat({ color: 0xffffff, vertexColors: true, roughness: 0.78, metalness: 0, normalMap: noise, normalScale: new THREE.Vector2(0.18, 0.18) }, 0.35),
    sweater: Mat({ color: 0xffffff, map: sweaterMap, vertexColors: true, roughness: 0.9, metalness: 0, normalMap: noise, normalScale: new THREE.Vector2(0.35, 0.35) }, 0.28),
    hair: Mat({ color: 0xffffff, vertexColors: true, roughness: 0.6, metalness: 0, bumpMap: hairBump, bumpScale: HIGH ? 1.6 : 1.3 }, 0.45),
    face: LOW ? new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.18 })
              : new THREE.MeshPhysicalMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.06 }),
  };
  for (const k in mats) mats[k].name = "rizy:" + k;

  const meshes = {};
  let tris = 0;
  for (const k of ["felt", "sweater", "hair", "face"]){
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

  // шарф: узел сбоку за левым плечом, оба хвоста уходят назад-влево. Со спины асимметричная лента
  // не прячется за рюкзаком и головой и читается на фоне трассы (симметричные хвосты сливались с волосами).
  // Коллайдеры — рюкзак, спина, голова.
  const anchors = [];
  for (const s of [-1, 1]){
    const o = new THREE.Object3D(); o.name = "rizy:scarfAnchor" + (s < 0 ? "L" : "R");
    o.position.set(-0.115 + s * 0.03, 1.585 - REST.chest[1], 0.17 + s * 0.012);
    byName.chest.add(o);
    anchors.push({ obj: o, dirObj: byName.chest, dir: [-0.55 + s * 0.12, -0.2, 1] });
  }
  const colliders = [
    { obj: byName.pack, up: -0.02 * baseScale, back: 0.1 * baseScale, r: 0.2 * baseScale },
    { obj: byName.chest, up: 0.02, back: 0.0, r: 0.2 * baseScale },
    { obj: byName.head, up: 0.24 * baseScale, back: 0.02, r: 0.33 * baseScale },
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
    sweaterMap.dispose(); hairBump.dispose();
    skeleton.dispose();
  }

  return {
    kind: "procedural", root, yawG, squashG, baseScale, bones, byName, skeleton, meshes, mats,
    rimTargets: { body: [mats.felt, mats.sweater], hair: [mats.hair], face: mats.face },
    sunU, anchors, colliders, applyPose, dispose,
    info: { tris, quality: q },
  };
}

// цвет волос по вершине: изнанка каре и глубина под кромкой темнее (не нужен AO, читается «объём»)
const HAIR_C = new THREE.Color(COL.hair), HAIR_IN = new THREE.Color(COL.hairIn), HAIR_T = new THREE.Color();
function hairShade(i, pos){
  const sh = pos.userData && pos.userData.shade;
  const k = sh ? sh[i] : 0;
  return HAIR_T.copy(HAIR_C).lerp(HAIR_IN, k).getHex();
}

// Оболочка волос «каре-колокол». Профиль (r, y) заметается вокруг оси головы; длина зависит от угла θ
// (0 — лицо, ±π — затылок):
//   • чёлка: 7 отдельных прядей со скруглёнными кончиками и зазорами между ними, у каждой свой выпуклый объём;
//   • ступенька у виска → боковые пряди до линии подбородка (самые длинные);
//   • вторая ступенька за ухом → сзади короче, под кромкой видна шея;
//   • ниже экватора головы оболочка расходится колоколом, кромка подвёрнута внутрь (толщина пряди).
// Угол распределён неравномерно: спереди вершин гуще (там пряди чёлки).
function hairShell(q){
  const NU = { low: 48, med: 88, high: 128 }[q], NV = { low: 11, med: 17, high: 26 }[q];
  const NR = { low: 3, med: 5, high: 7 }[q], NI = 2;
  const Rh = 0.335, TH = 0.026, C = HC;
  const FRONT = 0.9, KB = 7, KBACK = 6, FLARE = 0.05, DROP = 0.22;
  const rows = NV + NR + NI;
  const nVert = (NU + 1) * rows;
  const pos = new Float32Array(nVert * 3), uv = new Float32Array(nVert * 2), shade = new Float32Array(nVert);

  // кончики прядей: f — фаза внутри пряди (0..1), 1 в середине пряди, 0 в зазоре
  const tipOf = (x) => { const f = x - Math.floor(x); return Math.pow(Math.sin(Math.PI * f), 0.5); };
  // Возвращает y кромки (отн. центра головы) и «вес пряди» для выпуклости
  const hemY = new Float32Array(1), hemTip = new Float32Array(1);
  function hem(th){
    const a = Math.abs(th);
    const tb = tipOf(th / (2 * FRONT) * KB + KB / 2);
    // зазоры между прядями высокие (0.105), кончики прядей опускаются к 0.048 — чёлка из отдельных «клыков»
    const bang = 0.105 - 0.012 * (a / FRONT) * (a / FRONT) - 0.057 * tb;
    const ts = tipOf((a - 1.15) / 0.45);
    const side = -0.215 + 0.018 * (1 - ts);
    const tbk = tipOf((th > 0 ? Math.PI - th : -Math.PI - th) / (2 * (Math.PI - 2.3)) * KBACK + KBACK / 2);
    const back = -0.14 + 0.022 * (1 - tbk);
    const w1 = sstep(FRONT - 0.04, FRONT + 0.22, a), w2 = sstep(2.0, 2.28, a);
    hemY[0] = (bang * (1 - w1) + side * w1) * (1 - w2) + back * w2;
    hemTip[0] = (tb * (1 - w1) + ts * w1 * 0.6) * (1 - w2) + tbk * w2 * 0.8;
  }

  for (let i = 0; i <= NU; i++){
    const s = (i / NU) * 2 - 1;
    const th = Math.PI * s * (0.5 + 0.5 * s * s);
    const sx = Math.sin(th), sz = -Math.cos(th);
    hem(th);
    const yh = hemY[0], tip = hemTip[0];
    const phiEnd = yh >= 0 ? Math.acos(Math.min(1, yh / Rh)) : Math.PI / 2;
    const arc = Rh * phiEnd, drop = Math.max(0, -yh), L = arc + drop;
    const emit = (j, r, y, v, sh) => {
      const o = i * rows + j;
      pos[o * 3] = C.x + r * sx * 1.03; pos[o * 3 + 1] = C.y + y; pos[o * 3 + 2] = C.z + r * sz;
      uv[o * 2] = (th / (2 * Math.PI) + 0.5) * 9; uv[o * 2 + 1] = v;
      shade[o] = sh;
    };
    let hr = 0, hy = 0, nr = 0, ny = 0, tr = 0, ty = 0;
    for (let j = 0; j < NV; j++){
      const jt = j / (NV - 1);
      const d = L * Math.pow(jt, 0.85);
      let r, y;
      if (d <= arc){
        const ph = d / Rh; r = Rh * Math.sin(ph); y = Rh * Math.cos(ph);
        nr = Math.sin(ph); ny = Math.cos(ph); tr = Math.cos(ph); ty = -Math.sin(ph);
      } else {
        // колокол: радиус растёт с глубиной ниже экватора, наклон касательной соответствует
        const dd = d - arc, k = dd / DROP, kk = Math.pow(k, 1.6);
        r = Rh + FLARE * kk; y = -dd;
        const dr = FLARE * 1.6 * Math.pow(Math.max(k, 1e-4), 0.6) / DROP;
        tr = dr; ty = -1; nr = 1; ny = dr;
      }
      // пряди у кромки выпуклые (отдельные «клыки»), чёлка отходит ото лба
      const wk = jt * jt * jt;
      r += 0.011 * tip * wk;
      if (yh > 0) r += 0.012 * wk;
      emit(j, r, y, d / 0.9, 0);
      hr = r; hy = y;
    }
    const nl = Math.hypot(nr, ny), tl = Math.hypot(tr, ty);
    nr /= nl; ny /= nl; tr /= tl; ty /= tl;
    const cr = hr - nr * TH, cy = hy - ny * TH;
    for (let k = 1; k <= NR; k++){
      const a = (k / NR) * Math.PI;
      emit(NV - 1 + k, cr + TH * (nr * Math.cos(a) + tr * Math.sin(a)), cy + TH * (ny * Math.cos(a) + ty * Math.sin(a)), (L + TH * a) / 0.9, 0.35 * k / NR);
    }
    for (let k = 1; k <= NI; k++){
      const sI = k * 0.07;
      emit(NV + NR - 1 + k, cr - nr * TH - tr * sI, cy - ny * TH - ty * sI, (L + TH * 3.2 + sI) / 0.9, 0.7);
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
