// Инструменты архитектурной геометрии (всё сливается в Batch — один draw call на материал):
//   • профиль [{o, y, no, ny, v}] — сечение карниза/обода: o — вынос наружу от базовой линии (или радиус
//     тела вращения), y — вверх от верха (обычно ≤ 0), (no, ny) — нормаль в плоскости сечения, v — текстура;
//   • sweep() — протянуть профиль по «кадрам» пути в плане (прямой фасад + скруглённые возвраты за угол);
//   • lathe() — тело вращения с эллипсом в плане (диски, колонны, башни), опционально каннелюры нормалями;
//   • archPanel(), spandrel() — арочное окно и стена над аркой (с вырезом полукруга);
//   • кэш прототипов (proto) — часто повторяемые детали (капители, шары, кольца) разворачиваются один раз.
import * as THREE from "three";
import { proto } from "./geo.js";

export const V = (x, y, z) => new THREE.Vector3(x, y, z);
export const HP = Math.PI / 2;
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _n = new THREE.Vector3(), _col = new THREE.Color();

// ---------- треугольники с явными нормалями: обход сам разворачивается под среднюю нормаль ----------
export function triN(b, P, N, UV, col){
  _a.subVectors(P[1], P[0]); _b.subVectors(P[2], P[0]); _n.crossVectors(_a, _b);
  const d = (N[0].x + N[1].x + N[2].x) * _n.x + (N[0].y + N[1].y + N[2].y) * _n.y + (N[0].z + N[1].z + N[2].z) * _n.z;
  for (const i of d >= 0 ? [0, 1, 2] : [0, 2, 1]) b.vert(P[i].x, P[i].y, P[i].z, N[i].x, N[i].y, N[i].z, UV[i][0], UV[i][1], col.r, col.g, col.b);
}
export function quadN(b, P, N, UV, col){
  triN(b, [P[0], P[1], P[2]], [N[0], N[1], N[2]], [UV[0], UV[1], UV[2]], col);
  triN(b, [P[0], P[2], P[3]], [N[0], N[2], N[3]], [UV[0], UV[2], UV[3]], col);
}
// плоский четырёхугольник с заданной нормалью (без переразворота — порядок a→b→c→d против часовой к n)
export function flatQuad(b, a, bb, c, d, n, uv, color){
  _col.set(color);
  const P = [a, bb, c, d], U = uv || [[0, 0], [1, 0], [1, 1], [0, 1]];
  quadN(b, P, [n, n, n, n], U, _col);
}

// ---------- профили ----------
// дуга эллипса: центр (co, cy), радиусы (ro, ry), углы a0→a1 (0 — наружу, +HP — вверх), n сегментов
export function arc(co, cy, ro, ry, a0, a1, n){
  const out = [];
  for (let i = 0; i <= n; i++){
    const a = a0 + (a1 - a0) * i / n, c = Math.cos(a), s = Math.sin(a);
    const no = c / ro, ny = s / ry, l = Math.hypot(no, ny) || 1;
    out.push({ o: co + ro * c, y: cy + ry * s, no: no / l, ny: ny / l });
  }
  return out;
}
// вогнутая дуга (выкружка): нормали смотрят к центру (видимая сторона — снаружи-снизу)
export function cove(co, cy, ro, ry, a0, a1, n){
  return arc(co, cy, ro, ry, a0, a1, n).map(p => ({ ...p, no: -p.no, ny: -p.ny }));
}
// гладкие нормали по соседям (обход сверху вниз, наружу)
export function smoothNormals(pts){
  for (let i = 0; i < pts.length; i++){
    const p = pts[Math.max(0, i - 1)], q = pts[Math.min(pts.length - 1, i + 1)];
    const to = q.o - p.o, ty = q.y - p.y, l = Math.hypot(to, ty) || 1;
    pts[i].no = -ty / l; pts[i].ny = to / l;
  }
  return pts;
}
// v по длине профиля: от v0 (первая точка) до v1 (последняя)
export function profileV(pts, v0, v1){
  let L = 0; const acc = [0];
  for (let i = 1; i < pts.length; i++){ L += Math.hypot(pts[i].o - pts[i - 1].o, pts[i].y - pts[i - 1].y); acc.push(L); }
  pts.forEach((p, i) => { p.v = v0 + (v1 - v0) * (L > 0 ? acc[i] / L : 0); });
  return pts;
}
// v по высоте: y → v (линейно между yA→vA и yB→vB)
export function profileVy(pts, yA, vA, yB, vB){
  pts.forEach(p => { p.v = vA + (vB - vA) * (p.y - yA) / (yB - yA || 1); });
  return pts;
}

// ---------- путь в плане для карниза яруса ----------
// Фасад по x от xa до xb на плоскости zf; retL/retR — профиль заворачивает за угол и идёт назад до zb
// (скруглённый угол; вынос по x сжат в kx раз, чтобы карниз не нависал над соседним ярусом).
// Кадр: {x, z} — базовая точка, (ox, oz) — вектор выноса профиля, (nx, nz) — нормаль, u — вдоль пути.
export function tierFrames(xa, xb, zf, zb, retL, retR, { kxL = 0.4, kxR = 0.4, seg = 6, uScale = 1, oRef = 0.3 } = {}){
  const F = [];
  const push = (x, z, ox, oz, nx, nz) => F.push({ x, z, ox, oz, nx, nz, u: 0 });
  const corner = (x, aFrom, aTo, kx) => {
    for (let k = 1; k < seg; k++){
      const a = aFrom + (aTo - aFrom) * k / seg, c = Math.cos(a), s = Math.sin(a);
      const l = Math.hypot(c / kx, s) || 1;
      push(x, zf, kx * c, s, c / kx / l, s / l);
    }
  };
  if (retL){ push(xa, zb, -kxL, 0, -1, 0); push(xa, zf, -kxL, 0, -1, 0); corner(xa, Math.PI, HP, kxL); }
  push(xa, zf, 0, 1, 0, 1);
  push(xb, zf, 0, 1, 0, 1);
  if (retR){ corner(xb, HP, 0, kxR); push(xb, zf, kxR, 0, 1, 0); push(xb, zb, kxR, 0, 1, 0); }
  // u: длина пути на выносе oRef; на фронте u = x (абсолютно — стыки соседних ярусов совпадают)
  const iFront = F.findIndex(f => f.ox === 0 && f.oz === 1 && f.x === xa);
  const px = f => f.x + oRef * f.ox, pz = f => f.z + oRef * f.oz;
  F[iFront].u = xa / uScale; F[iFront + 1].u = xb / uScale;
  for (let i = iFront - 1; i >= 0; i--) F[i].u = F[i + 1].u - Math.hypot(px(F[i + 1]) - px(F[i]), pz(F[i + 1]) - pz(F[i])) / uScale;
  for (let i = iFront + 2; i < F.length; i++) F[i].u = F[i - 1].u + Math.hypot(px(F[i]) - px(F[i - 1]), pz(F[i]) - pz(F[i - 1])) / uScale;
  return F;
}

// протянуть профиль по кадрам пути (y0 — высота верха); color — число или (x, y, z) → число
export function sweep(b, prof, frames, y0, color){
  const fn = typeof color === "function";
  if (!fn) _col.set(color);
  const pos = (f, p) => V(f.x + p.o * f.ox, y0 + p.y, f.z + p.o * f.oz);
  const nrm = (f, p) => V(f.nx * p.no, p.ny, f.nz * p.no).normalize();
  for (let i = 0; i < frames.length - 1; i++){
    const f0 = frames[i], f1 = frames[i + 1];
    for (let j = 0; j < prof.length - 1; j++){
      const p = prof[j], q = prof[j + 1];
      if (Math.abs(p.o - q.o) + Math.abs(p.y - q.y) < 1e-6) continue;
      const P = [pos(f0, p), pos(f1, p), pos(f1, q), pos(f0, q)];
      if (fn) _col.set(color(P[0].x, P[0].y, P[0].z));
      quadN(b, P, [nrm(f0, p), nrm(f1, p), nrm(f1, q), nrm(f0, q)],
        [[f0.u, p.v ?? 0], [f1.u, p.v ?? 0], [f1.u, q.v ?? 0], [f0.u, q.v ?? 0]], _col);
    }
  }
}
// выпуклый многоугольник в плоскости XZ на высоте y (веер из центроида), нормаль вверх; uv(x, z) → [u, v]
export function fillXZ(b, pts, y, color, uv){
  _col.set(color);
  let cx = 0, cz = 0; for (const p of pts){ cx += p[0]; cz += p[1]; } cx /= pts.length; cz /= pts.length;
  const up = V(0, 1, 0), C = V(cx, y, cz);
  for (let i = 0; i < pts.length; i++){
    const p = pts[i], q = pts[(i + 1) % pts.length];
    const A = V(p[0], y, p[1]), B = V(q[0], y, q[1]);
    triN(b, [C, A, B], [up, up, up], [uv(cx, cz), uv(p[0], p[1]), uv(q[0], q[1])], _col);
  }
}

// ---------- уровень детализации (q=low — меньше сегментов у тел вращения и арок) ----------
let DETAIL = 1;
export function setDetail(k){ DETAIL = k; }
const segK = n => n > 2 ? Math.max(6, Math.round(n * DETAIL)) : n;

// ---------- тело вращения с эллипсом в плане ----------
// точки: (cx + o·sx·cos a, y0 + y, cz + o·sz·sin a); a0..a1 — дуга (перед — HP); flute — {n, amp}:
// каннелюры нормалями на строках профиля с p.flute; uLen — длина вдоль окружности на u = 1 (0 — u = a/2π)
export function lathe(b, prof, { cx = 0, cz = 0, y0 = 0, sx = 1, sz = 1, seg = 24, a0 = 0, a1 = Math.PI * 2, color = 0xffffff, flute = null, uLen = 0, oRef = null } = {}){
  seg = segK(seg);
  // каннелюр больше, чем сегментов на них хватает, — не качаем нормали (иначе рябь-алиасинг)
  if (flute && seg < flute.n * (a1 - a0) / (Math.PI * 2) * 1.2) flute = null;
  const fn = typeof color === "function";
  if (!fn) _col.set(color);
  const ang = [];
  for (let k = 0; k <= seg; k++) ang.push(a0 + (a1 - a0) * k / seg);
  // u по длине дуги (на радиусе oRef или среднем радиусе профиля)
  const oR = oRef ?? prof.reduce((s, p) => s + p.o, 0) / prof.length;
  const us = [0];
  for (let k = 1; k <= seg; k++){
    const a = ang[k - 1], c = ang[k];
    us.push(us[k - 1] + Math.hypot(oR * sx * (Math.cos(c) - Math.cos(a)), oR * sz * (Math.sin(c) - Math.sin(a))));
  }
  const uOf = k => uLen > 0 ? us[k] / uLen : (ang[k] - a0) / (Math.PI * 2);
  const rings = prof.map(p => ang.map((a, k) => {
    const c = Math.cos(a), s = Math.sin(a);
    const P = V(cx + p.o * sx * c, y0 + p.y, cz + p.o * sz * s);
    const N = V(p.no * c / sx, p.ny, p.no * s / sz);
    if (flute && p.flute){
      // касательная к эллипсу; вдоль неё качаем нормаль — желобки читаются бликами
      const t = V(-s * sx, 0, c * sz).normalize();
      N.normalize().addScaledVector(t, flute.amp * Math.sin(a * flute.n));
    }
    return { P, N: N.normalize() };
  }));
  for (let i = 0; i < prof.length - 1; i++){
    const p = prof[i], q = prof[i + 1];
    if (Math.abs(p.o - q.o) + Math.abs(p.y - q.y) < 1e-6) continue;
    for (let k = 0; k < seg; k++){
      const A = rings[i], C = rings[i + 1];
      if (fn) _col.set(color(A[k].P.x, A[k].P.y, A[k].P.z));
      quadN(b, [A[k].P, A[k + 1].P, C[k + 1].P, C[k].P], [A[k].N, A[k + 1].N, C[k + 1].N, C[k].N],
        [[uOf(k), p.v ?? 0], [uOf(k + 1), p.v ?? 0], [uOf(k + 1), q.v ?? 0], [uOf(k), q.v ?? 0]], _col);
    }
  }
}
// диск-крышка (эллипс) на высоте y: нормаль up (+1) или down (−1)
export function ellipseCap(b, cx, cz, y, rx, rz, seg, dir, color, uv, a0 = 0, a1 = Math.PI * 2){
  _col.set(color);
  const n = V(0, dir, 0), C = V(cx, y, cz);
  for (let k = 0; k < seg; k++){
    const a = a0 + (a1 - a0) * k / seg, c = a0 + (a1 - a0) * (k + 1) / seg;
    const A = V(cx + rx * Math.cos(a), y, cz + rz * Math.sin(a)), B = V(cx + rx * Math.cos(c), y, cz + rz * Math.sin(c));
    triN(b, [C, A, B], [n, n, n], [uv(C.x, C.z), uv(A.x, A.z), uv(B.x, B.z)], _col);
  }
}

// арочное окно в произвольной плоскости: O — середина низа, R — единичный вектор «вправо», N — нормаль
export function archPanelF(b, O, Rv, Nv, w, h, color, seg = 10){
  _col.set(color);
  const Up = V(0, 1, 0), r = w / 2, yS = h - r;
  const at = (x, y) => O.clone().addScaledVector(Rv, x).addScaledVector(Up, y);
  const uv = (x, y) => [(x + r) / w, y / h];
  const pts = [[-r, 0], [r, 0], [r, yS]];
  for (let k = 1; k < seg; k++){ const a = k / seg * Math.PI; pts.push([r * Math.cos(a), yS + r * Math.sin(a)]); }
  pts.push([-r, yS]);
  const C = [0, h * 0.45];
  for (let i = 0; i < pts.length; i++){
    const p = pts[i], q = pts[(i + 1) % pts.length];
    triN(b, [at(C[0], C[1]), at(p[0], p[1]), at(q[0], q[1])], [Nv, Nv, Nv], [uv(C[0], C[1]), uv(p[0], p[1]), uv(q[0], q[1])], _col);
  }
}

// ---------- арки и окна (в плоскости XY на глубине z, лицом к +z) ----------
// арочное окно: прямоугольник w × (h − w/2) + полукруг сверху; uv нормированы на всё окно (0..1)
export function archPanel(b, cx, yb, w, h, z, color, seg = 12){
  _col.set(color);
  const r = w / 2, yS = yb + h - r, n = V(0, 0, 1);
  const uv = (x, y) => [(x - (cx - r)) / w, (y - yb) / h];
  const pts = [[cx - r, yb], [cx + r, yb], [cx + r, yS]];
  for (let k = 1; k < seg; k++){ const a = k / seg * Math.PI; pts.push([cx + r * Math.cos(a), yS + r * Math.sin(a)]); }
  pts.push([cx - r, yS]);
  const C = [cx, yb + h * 0.45];
  for (let i = 0; i < pts.length; i++){
    const p = pts[i], q = pts[(i + 1) % pts.length];
    triN(b, [V(C[0], C[1], z), V(p[0], p[1], z), V(q[0], q[1], z)], [n, n, n], [uv(C[0], C[1]), uv(p[0], p[1]), uv(q[0], q[1])], _col);
  }
}
// стена над аркой пролёта: прямоугольник [xl, xr] × [ys, yt] без полукруга радиуса R с центром (xc, ys)
export function spandrel(b, xl, xr, ys, yt, xc, R, z, color, uv, seg = 12){
  const sh = new THREE.Shape();
  sh.moveTo(xl, ys); sh.lineTo(xc - R, ys);
  for (let k = 1; k <= seg; k++){ const a = Math.PI - k / seg * Math.PI; sh.lineTo(xc + R * Math.cos(a), ys + R * Math.sin(a)); }
  sh.lineTo(xr, ys); sh.lineTo(xr, yt); sh.lineTo(xl, yt); sh.closePath();
  const g = new THREE.ShapeGeometry(sh, 1);
  const pos = g.attributes.position, uvA = g.attributes.uv;
  for (let i = 0; i < pos.count; i++){ const t = uv(pos.getX(i), pos.getY(i)); uvA.setXY(i, t[0], t[1]); }
  b.add(g, new THREE.Matrix4().makeTranslation(0, 0, z), color);
  g.dispose();
}
// полукольцевой профиль вдоль арки: prof [{r, z, nr, nz, v}] — r — от радиуса R наружу, z — вперёд;
// дуга от 0 до π (правая пята → замок → левая пята)
export function archSweep(b, cx, cy, z0, R, prof, seg, color, uLen = 1){
  seg = segK(seg);
  _col.set(color);
  const pts = (t, p) => V(cx + (R + p.r) * Math.cos(t), cy + (R + p.r) * Math.sin(t), z0 + p.z);
  const nrm = (t, p) => V(p.nr * Math.cos(t), p.nr * Math.sin(t), p.nz).normalize();
  for (let k = 0; k < seg; k++){
    const t0 = k / seg * Math.PI, t1 = (k + 1) / seg * Math.PI;
    const u0 = t0 * R / uLen, u1 = t1 * R / uLen;
    for (let j = 0; j < prof.length - 1; j++){
      const p = prof[j], q = prof[j + 1];
      quadN(b, [pts(t0, p), pts(t1, p), pts(t1, q), pts(t0, q)], [nrm(t0, p), nrm(t1, p), nrm(t1, q), nrm(t0, q)],
        [[u0, p.v ?? 0], [u1, p.v ?? 0], [u1, q.v ?? 0], [u0, q.v ?? 0]], _col);
    }
  }
}

// ---------- кэш прототипов ----------
const _protos = new Map();
export function P(key, make){
  let p = _protos.get(key);
  if (!p){ p = proto(make()); _protos.set(key, p); }
  return p;
}
const _M = new THREE.Matrix4(), _Q = new THREE.Quaternion(), _S = new THREE.Vector3(), _T = new THREE.Vector3(), _E = new THREE.Euler();
export function mat(x, y, z, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0){
  _E.set(rx, ry, rz); _Q.setFromEuler(_E); _T.set(x, y, z); _S.set(sx, sy, sz);
  return _M.compose(_T, _Q, _S);
}
// частые детали
export const protoSphere = () => P("sphere", () => new THREE.SphereGeometry(1, 10, 7));
export const protoSphereLo = () => P("sphereLo", () => new THREE.SphereGeometry(1, 6, 4));   // мелочь: заклёпки, шарики
export const protoBox = () => P("box", () => new THREE.BoxGeometry(1, 1, 1));
export const protoCyl = (seg = 12) => P("cyl" + seg, () => new THREE.CylinderGeometry(1, 1, 1, seg, 1, false));
export const protoTorus = (tube, seg = 16, arcA = Math.PI * 2) => P(`torus${tube}|${seg}|${arcA.toFixed(3)}`, () => new THREE.TorusGeometry(1, tube, 6, seg, arcA));
// капитель-колокол (золото): от шейки r 1 вверх расширяется до 1.55, высота 1 (масштабируется)
export const protoBell = () => P("bell", () => {
  const pts = [];
  for (let i = 0; i <= 6; i++){ const t = i / 6; pts.push(new THREE.Vector2(1 + 0.55 * Math.pow(t, 1.8), t)); }
  pts.push(new THREE.Vector2(1.6, 1.0)); pts.push(new THREE.Vector2(1.6, 1.08));
  return new THREE.LatheGeometry(pts, 16);
});
// ваза-балясина (мрамор): высота 1, радиус ≈ 0.5 (масштабируется)
export const protoBaluster = () => P("baluster", () => {
  const r = [[0.34, 0], [0.34, 0.08], [0.22, 0.12], [0.2, 0.2], [0.42, 0.42], [0.46, 0.5], [0.36, 0.62], [0.17, 0.74], [0.15, 0.84], [0.28, 0.9], [0.3, 1.0]];
  return new THREE.LatheGeometry(r.map(([a, b]) => new THREE.Vector2(a, b)), 10);
});
// урна-вазон (мрамор): высота 1
export const protoUrn = () => P("urn", () => {
  const r = [[0.001, 0], [0.3, 0], [0.3, 0.08], [0.18, 0.14], [0.16, 0.24], [0.38, 0.42], [0.5, 0.62], [0.48, 0.8], [0.4, 0.9], [0.46, 0.96], [0.46, 1.0], [0.001, 1.0]];
  return new THREE.LatheGeometry(r.map(([a, b]) => new THREE.Vector2(a, b)), 16);
});
// фонарь: стеклянная «капля»-колба (свечение) высотой 1
export const protoLampGlass = () => P("lampglass", () => {
  const r = [[0.001, 0], [0.28, 0.08], [0.42, 0.35], [0.44, 0.6], [0.34, 0.85], [0.18, 1.0], [0.001, 1.0]];
  return new THREE.LatheGeometry(r.map(([a, b]) => new THREE.Vector2(a, b)), 12);
});
