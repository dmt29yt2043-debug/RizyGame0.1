// Стены и платформы уровня «Идеалити».
// Стена: сливочная штукатурка лица + карниз по верхнему краю — сливочная «подушка» со скруглённой
// кромкой → золотой валик (metalness 1, roughness 0.25) → хромовая чаша-выкружка (metalness 1,
// roughness 0.12). Колонны (башни/крепости) — те же сливки, нормали лица «веером» (читаются круглыми),
// золотые кольца-валики и капитель. Платформы «насквозь» и движущиеся — овальные «бокалы»: сливочная
// плита, золотой обод, хромовая чаша-нога с золотым навершием; у движущихся — фиолетовое свечение снизу.
// Материалы — PBR; отражения золота/хрома приходят через scene.environment (PMREM, см. sky.js/main.js).
// Draw calls: подушка/тело/золото/хром/декор стен (5; статичные платформы, направляющие лифтов и дальние
// колонны пропастей — в тех же батчах) + по 4 меша на движущуюся платформу (плита/золото/хром/свечение).
import * as THREE from "three";
import { PAL } from "../config.js";
import { Batch } from "./geo.js";
import { creamTexture, creamTopTexture, makeRng } from "./tex.js";

export const ZF = 1.0;      // лицевая плоскость стен
export const ZB = -1.15;    // задняя кромка верха
// Карниз стены (y — вниз от верха стены, z — от лицевой плоскости): подушка выступает до CAP.front,
// золотой валик — до CAP.gold, хромовая чаша заканчивается на CAP.bottom (ниже — штукатурка).
export const CAP = { front: 0.34, gold: 0.235, goldY: -0.36, bottom: -0.86 };
// платформы-«бокалы»: полуось по z (по x — половина ширины платформы) и высота чаши
export const DISC = { rz: 0.85, bowl: 0.78, bowlMover: 0.46 };

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const H = Math.PI / 2;
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _n = new THREE.Vector3(), _col = new THREE.Color();

// ---------- низкоуровневые помощники: треугольники с явными нормалями прямо в Batch ----------
function vtx(b, p, n, u, v, c){
  b.p.push(p.x, p.y, p.z); b.n.push(n.x, n.y, n.z); b.uv.push(u, v); b.c.push(c.r, c.g, c.b);
}
// обход треугольника сам разворачивается под среднюю нормаль вершин — лицевая сторона всегда наружу
function triN(b, P, N, UV, color){
  _col.set(color);
  _a.subVectors(P[1], P[0]); _b.subVectors(P[2], P[0]); _n.crossVectors(_a, _b);
  const d = (N[0].x + N[1].x + N[2].x) * _n.x + (N[0].y + N[1].y + N[2].y) * _n.y + (N[0].z + N[1].z + N[2].z) * _n.z;
  for (const i of d >= 0 ? [0, 1, 2] : [0, 2, 1]) vtx(b, P[i], N[i], UV[i][0], UV[i][1], _col);
}
function quadN(b, P, N, UV, color){
  triN(b, [P[0], P[1], P[2]], [N[0], N[1], N[2]], [UV[0], UV[1], UV[2]], color);
  triN(b, [P[0], P[2], P[3]], [N[0], N[2], N[3]], [UV[0], UV[2], UV[3]], color);
}

// дуга эллипса в плоскости профиля: o — вынос от базовой плоскости (или радиус тела вращения), y — вверх
function arc(co, cy, ro, ry, a0, a1, n){
  const out = [];
  for (let i = 0; i <= n; i++){
    const a = a0 + (a1 - a0) * i / n, c = Math.cos(a), s = Math.sin(a);
    const no = c / ro, ny = s / ry, l = Math.hypot(no, ny) || 1;
    out.push({ o: co + ro * c, y: cy + ry * s, no: no / l, ny: ny / l });
  }
  return out;
}
// гладкие нормали для произвольного профиля (обход — сверху вниз, наружу от оси/стены)
function smoothNormals(pts){
  for (let i = 0; i < pts.length; i++){
    const p = pts[Math.max(0, i - 1)], q = pts[Math.min(pts.length - 1, i + 1)];
    const to = q.o - p.o, ty = q.y - p.y, l = Math.hypot(to, ty) || 1;
    pts[i].no = -ty / l; pts[i].ny = to / l;
  }
  return pts;
}

// профиль карниза стены (o — от лицевой плоскости наружу, y — вниз от верха):
// подушка (скругление r 0.13) → золотой пояс «валик — плоская лента — валик» (0.20) → хромовая чаша
function capProfile(back){
  const gold = [...arc(0.20, -0.295, 0.035, 0.035, H, -H, 4), { o: 0.19, y: -0.335, no: 1, ny: 0 }, { o: 0.19, y: -0.385, no: 1, ny: 0 }, ...arc(0.20, -0.425, 0.035, 0.035, H, -H, 4)];
  return {
    cushion: [{ o: back, y: 0, no: 0, ny: 1 }, ...arc(CAP.front - 0.13, -0.13, 0.13, 0.13, H, -H, 7), { o: back, y: -0.26, no: 0, ny: -1 }],
    gold,
    chrome: arc(0, -0.46, 0.19, -CAP.bottom - 0.46, 0, -H, 7),
  };
}
// профиль кольца-валика колонны
const RING = arc(0, 0, 0.085, 0.1, H, -H, 6);

// Выдавить профиль вдоль направления A (длина len) от точки O; Out — «наружу» (o), вверх — +Y.
function extrude(b, pts, O, A, Out, len, color){
  let s = 0;
  const u0 = O.x * Math.abs(A.x) + O.z * Math.abs(A.z);
  for (let i = 0; i < pts.length - 1; i++){
    const p = pts[i], q = pts[i + 1];
    const d = Math.hypot(q.o - p.o, q.y - p.y); if (d < 1e-5) continue;
    const s1 = s + d;
    const P0 = O.clone().addScaledVector(Out, p.o).add(V(0, p.y, 0)), Q0 = O.clone().addScaledVector(Out, q.o).add(V(0, q.y, 0));
    const P1 = P0.clone().addScaledVector(A, len), Q1 = Q0.clone().addScaledVector(A, len);
    const np = Out.clone().multiplyScalar(p.no).add(V(0, p.ny, 0)), nq = Out.clone().multiplyScalar(q.no).add(V(0, q.ny, 0));
    quadN(b, [P0, P1, Q1, Q0], [np, np, nq, nq], [[u0 / 2, s / 2], [(u0 + len) / 2, s / 2], [(u0 + len) / 2, s1 / 2], [u0 / 2, s1 / 2]], color);
    s = s1;
  }
}
// торец выдавленного профиля (выпуклый многоугольник → веер); close — замкнуть по базовой плоскости (o = 0)
function capEnd(b, pts, O, Out, normal, color, close = true){
  const poly = pts.map(p => O.clone().addScaledVector(Out, p.o).add(V(0, p.y, 0)));
  if (close){
    poly.unshift(O.clone().add(V(0, pts[0].y, 0)));
    poly.push(O.clone().add(V(0, pts[pts.length - 1].y, 0)));
  }
  const uv = p => [(p.x + p.z) / 2, p.y / 2];
  for (let i = 1; i < poly.length - 1; i++) triN(b, [poly[0], poly[i], poly[i + 1]], [normal, normal, normal], [uv(poly[0]), uv(poly[i]), uv(poly[i + 1])], color);
}

// карниз стены вдоль x от xa до xb на высоте y1 (лицо — плоскость zf); endL/endR — нужны ли торцы
// tint — цвета [подушка, золото, хром] (дальний план приглушён в лавандовую дымку)
const CAP_COLORS = [0xffffff, PAL.gold, PAL.chrome];
function wallCap(B, xa, xb, y1, zf, zb, endL, endR, tint = CAP_COLORS){
  const pr = capProfile(zb - zf);
  const O = V(xa, y1, zf), A = V(1, 0, 0), Out = V(0, 0, 1), len = xb - xa;
  extrude(B.top, pr.cushion, O, A, Out, len, tint[0]);
  extrude(B.gold, pr.gold, O, A, Out, len, tint[1]);
  extrude(B.chrome, pr.chrome, O, A, Out, len, tint[2]);
  for (const [x, on, s] of [[xa, endL, -1], [xb, endR, 1]]){
    if (!on) continue;
    const Oe = V(x, y1, zf), nn = V(s, 0, 0);
    capEnd(B.top, pr.cushion, Oe, Out, nn, tint[0], false);
    capEnd(B.gold, pr.gold, Oe, Out, nn, tint[1]);
    capEnd(B.chrome, pr.chrome, Oe, Out, nn, tint[2]);
  }
}

// лицо стены: штукатурка; fan > 0 — нормали «веером» поперёк (колонна читается круглой).
// Вертикальный градиент вершинных цветов: мягкая тень под карнизом и уход в лавандовую дымку книзу.
function face(b, x0, x1, ya, yb, z, fan, tint = 0xffffff){
  const n = fan ? 10 : 1;
  const topY = yb, rows = [ya];
  for (const d of [7.5, 4, 1.6, 0.45]) if (topY - d > ya) rows.push(topY - d);
  rows.push(yb);
  const shade = y => {
    const under = Math.max(0, Math.min(1, (topY - y) / 0.45));                // 0 под самым карнизом
    const deep = Math.max(0, Math.min(1, (topY - y - 1.6) / 6));              // 0..1 вглубь, книзу
    const c = new THREE.Color(tint).multiplyScalar(0.8 + 0.2 * under);
    return c.lerp(new THREE.Color(0xd8c9e4), deep * 0.55);
  };
  for (let r = 0; r < rows.length - 1; r++){
    const y0 = rows[r], y1 = rows[r + 1];
    const c0 = shade(y0), c1 = shade(y1);
    for (let i = 0; i < n; i++){
      const u0 = i / n, u1 = (i + 1) / n, xa = x0 + (x1 - x0) * u0, xb = x0 + (x1 - x0) * u1;
      const na = V((2 * u0 - 1) * fan, 0, 1).normalize(), nb = V((2 * u1 - 1) * fan, 0, 1).normalize();
      const P = [V(xa, y0, z), V(xb, y0, z), V(xb, y1, z), V(xa, y1, z)];
      const UV = [[xa / 2, y0 / 2], [xb / 2, y0 / 2], [xb / 2, y1 / 2], [xa / 2, y1 / 2]];
      // два треугольника с цветами по рядам
      const cs = [c0, c0, c1, c1], N = [na, nb, nb, na];
      for (const tri of [[0, 1, 2], [0, 2, 3]]){
        _a.subVectors(P[tri[1]], P[tri[0]]); _b.subVectors(P[tri[2]], P[tri[0]]); _n.crossVectors(_a, _b);
        const order = _n.z >= 0 ? tri : [tri[0], tri[2], tri[1]];
        for (const k of order) vtx(b, P[k], N[k], UV[k][0], UV[k][1], cs[k]);
      }
    }
  }
}

export function buildWalls(level, renderer){
  const group = new THREE.Group(); group.name = "walls";
  const B = { body: new Batch(), top: new Batch(), gold: new Batch(), chrome: new Batch(), deco: new Batch() };
  const S = level.solids;
  const eps = 1e-3;
  const neighbor = (x, side) => S.find(o => side < 0 ? Math.abs(o.x1 - x) < eps : Math.abs(o.x0 - x) < eps);
  const OV = 0.12;          // вынос карниза за торец, если сосед ниже

  for (const s of S){
    const { x0, x1, y0, y1 } = s;
    const col = s.kind === "keep" || s.kind === "tower";
    const nL = neighbor(x0, -1), nR = neighbor(x1, 1);
    const yFace = y1 + CAP.bottom;               // верх штукатурки лица (под хромовой чашей)

    face(B.body, x0, x1, y0, yFace, ZF, col ? 0.85 : 0);
    // бока (видны в перспективе в разрывах пути); низ бока прячется за соседом
    for (const side of [-1, 1]){
      const x = side < 0 ? x0 : x1, n = side < 0 ? nL : nR;
      const from = n ? Math.max(y0, n.y1) : y0;
      if (from >= y1 - 0.26 - eps) continue;
      const za = side < 0 ? ZB : ZF, zb = side < 0 ? ZF : ZB;
      B.body.quad(V(x, from, za), V(x, from, zb), V(x, y1 - 0.26, zb), V(x, y1 - 0.26, za),
        [[za / 2, from / 2], [zb / 2, from / 2], [zb / 2, (y1 - 0.26) / 2], [za / 2, (y1 - 0.26) / 2]], 0xe9dccb);
    }
    // карниз: подушка + золото + хром; торцы и вынос — там, где сосед ниже (или его нет)
    const lowL = !nL || nL.y1 < y1 - eps, lowR = !nR || nR.y1 < y1 - eps;
    const ovL = col ? 0.27 : (lowL ? OV : 0), ovR = col ? 0.27 : (lowR ? OV : 0);
    const endL = col || !nL || Math.abs(nL.y1 - y1) > eps, endR = col || !nR || Math.abs(nR.y1 - y1) > eps;
    wallCap(B, x0 - ovL, x1 + ovR, y1, ZF, ZB, endL, endR);
    if (col) columnDeco(B, s);
  }
  // статичные платформы «насквозь снизу» — прямо в общие батчи стен, без лишних draw call'ов
  for (const o of level.oneways) discPlatform(B.top, B.gold, B.chrome, (o.x0 + o.x1) / 2, o.y, o.x1 - o.x0, DISC.bowl);
  // направляющие штанги лифтов — тоже статичное золото
  for (const m of level.movers) if (m.ay) railGuides(B.gold, m);
  backdropPits(level, B);

  // envMapIntensity разный: матовым сливкам — лёгкий намёк на небо (иначе отражение выбеливает
  // штукатурку), золоту/хрому — полная сила (для них отражение и есть материал)
  const creamTex = creamTexture(renderer), topTex = creamTopTexture(renderer);
  const creamMat = new THREE.MeshStandardMaterial({ map: creamTex, vertexColors: true, roughness: 0.62, metalness: 0, envMapIntensity: 0.45 });
  const topMat = new THREE.MeshStandardMaterial({ map: topTex, vertexColors: true, roughness: 0.45, metalness: 0, envMapIntensity: 0.3 });
  const goldMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.25, metalness: 1, envMapIntensity: 1.3 });
  const chromeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.12, metalness: 1, envMapIntensity: 1.25 });
  const decoMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 0.4 });
  const mk = (b, mat, name) => { const m = new THREE.Mesh(b.build(), mat); m.name = name; m.matrixAutoUpdate = false; m.updateMatrix(); group.add(m); return m; };
  mk(B.body, creamMat, "wall-body");
  mk(B.top, topMat, "wall-top");
  mk(B.gold, goldMat, "wall-gold");
  mk(B.chrome, chromeMat, "wall-chrome");
  mk(B.deco, decoMat, "wall-deco");

  // ---------- движущиеся платформы: плита + золотой обод + хромовая чаша + фиолетовое свечение снизу ----------
  const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide });
  const moverMeshes = [];
  for (const m of level.movers){
    const g = new THREE.Group(); g.name = "mover-" + m.id;
    const w = m.x1 - m.x0;
    const tb = new Batch(), gb = new Batch(), cb = new Batch(), lb = new Batch();
    discPlatform(tb, gb, cb, w / 2, 0, w, DISC.bowlMover);
    moverGlow(lb, w / 2, w);
    const glow = new THREE.Mesh(lb.build(), glowMat); glow.renderOrder = 4;
    g.add(new THREE.Mesh(tb.build(), topMat), new THREE.Mesh(gb.build(), goldMat), new THREE.Mesh(cb.build(), chromeMat), glow);
    group.add(g);
    moverMeshes.push({ mesh: g, m, glow });
  }
  return { group, moverMeshes };
}

// ---------- тело вращения по профилю [{o: радиус, y, no, ny}] с матрицей (неравномерный масштаб → овал) ----------
function revolve(b, prof, seg, M, color){
  const nm = new THREE.Matrix3().getNormalMatrix(M);
  const rings = prof.map(p => {
    const pts = [], nrm = [];
    for (let k = 0; k <= seg; k++){
      const a = k / seg * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      pts.push(V(p.o * c, p.y, p.o * s).applyMatrix4(M));
      nrm.push(V(p.no * c, p.ny, p.no * s).applyMatrix3(nm).normalize());
    }
    return { pts, nrm };
  });
  for (let i = 0; i < prof.length - 1; i++){
    if (Math.abs(prof[i].o - prof[i + 1].o) + Math.abs(prof[i].y - prof[i + 1].y) < 1e-6) continue;
    const A = rings[i], C = rings[i + 1];
    for (let k = 0; k < seg; k++){
      const u0 = k / seg, u1 = (k + 1) / seg;
      quadN(b, [A.pts[k], A.pts[k + 1], C.pts[k + 1], C.pts[k]], [A.nrm[k], A.nrm[k + 1], C.nrm[k + 1], C.nrm[k]],
        [[u0 * 3, prof[i].y], [u1 * 3, prof[i].y], [u1 * 3, prof[i + 1].y], [u0 * 3, prof[i + 1].y]], color);
    }
  }
}

// платформа-«бокал» (центр cx, верх y, ширина w): сливочная плита со скруглённой кромкой, золотой обод,
// хромовая чаша, сужающаяся к золотому навершию. В плане — овал: по x полуось w/2, по z — DISC.rz.
function discPlatform(top, gold, chrome, cx, y, w, bowlH){
  const R = DISC.rz;
  const M = new THREE.Matrix4().compose(V(cx, y, 0), new THREE.Quaternion(), V((w / 2) / R, 1, 1));
  const cushion = [{ o: 0, y: 0, no: 0, ny: 1 }, ...arc(R - 0.12, -0.12, 0.12, 0.12, H, -H, 7), { o: 0, y: -0.24, no: 0, ny: -1 }];
  const rim = arc(R - 0.16, -0.31, 0.08, 0.07, H, -H, 6);
  const r0 = R - 0.16, bowl = [];
  for (let i = 0; i <= 10; i++){ const t = i / 10; bowl.push({ o: r0 * Math.pow(1 - Math.pow(t, 1.8), 0.72), y: -0.38 - bowlH * t }); }
  smoothNormals(bowl);
  revolve(top, cushion, 28, M, 0xffffff);
  revolve(gold, rim, 28, M, PAL.gold);
  revolve(chrome, bowl, 20, M, PAL.chrome);
  // золотое навершие-капля под чашей
  const tip = new THREE.SphereGeometry(0.075, 10, 7);
  gold.add(tip, new THREE.Matrix4().makeTranslation(cx, y - 0.38 - bowlH - 0.02, 0), PAL.gold);
  tip.dispose();
}

// фиолетовое свечение движущейся платформы: светящийся ободок под золотом + мягкий «луч» вниз
// (аддитивно, вершинные цвета: чёрный = прозрачно)
function moverGlow(b, cx, w){
  const R = DISC.rz, sx = (w / 2) / R;
  const M = new THREE.Matrix4().compose(V(cx, 0, 0), new THREE.Quaternion(), V(sx, 1, 1));
  const purple = new THREE.Color(PAL.purple), hot = new THREE.Color(0xc9a8ff);
  revolve(b, arc(R - 0.2, -0.41, 0.05, 0.035, H, -H, 4), 28, M, hot.clone().multiplyScalar(3.0));
  // луч: две скрещенные вертикальные плоскости с градиентом от ободка вниз
  const top = -0.36, bot = -2.1, hw = w * 0.36;
  for (const a of [0, Math.PI / 2]){
    const dx = Math.cos(a) * hw, dz = Math.sin(a) * (a ? R * 0.8 : hw);
    const P = [V(cx - dx, top, -dz), V(cx + dx, top, dz), V(cx + dx, bot, dz), V(cx - dx, bot, -dz)];
    const c0 = purple.clone().multiplyScalar(1.3), c1 = new THREE.Color(0, 0, 0);
    const n = V(0, 0, 1);
    for (const tri of [[0, 1, 2], [0, 2, 3]]) for (const k of tri) vtx(b, P[k], n, 0, 0, k < 2 ? c0 : c1);
  }
  // мягкий овальный ореол под чашей (веер: центр яркий, край чёрный)
  const cy = -0.46, rr = R * 1.25, seg = 24, cc = purple.clone().multiplyScalar(0.95), ce = new THREE.Color(0, 0, 0);
  for (let k = 0; k < seg; k++){
    const a0 = k / seg * Math.PI * 2, a1 = (k + 1) / seg * Math.PI * 2;
    const p0 = V(cx, cy, 0), p1 = V(cx + Math.cos(a0) * rr * sx, cy, Math.sin(a0) * rr), p2 = V(cx + Math.cos(a1) * rr * sx, cy, Math.sin(a1) * rr);
    const n = V(0, 1, 0);
    vtx(b, p0, n, 0, 0, cc); vtx(b, p2, n, 0, 0, ce); vtx(b, p1, n, 0, 0, ce);
  }
}

// золотая рама шахты лифта: две штанги из-под кадра до верха хода, хомуты, перекладина с шарами наверху
function railGuides(b, m){
  const w = m.x1 - m.x0, top = m.y + m.ay + 1.5, bot = -9, z = -0.62;
  const xs = [m.x0 - 0.25, m.x1 + 0.25];
  const rail = new THREE.CylinderGeometry(0.05, 0.05, top - bot, 8);
  const ball = new THREE.SphereGeometry(0.1, 10, 8);
  const clamp = new THREE.CylinderGeometry(0.085, 0.085, 0.07, 10);
  for (const x of xs){
    b.add(rail, new THREE.Matrix4().makeTranslation(x, (top + bot) / 2, z), PAL.gold);
    b.add(ball, new THREE.Matrix4().makeTranslation(x, top + 0.06, z), PAL.gold);
    for (let y = bot + 0.8; y < top - 0.4; y += 1.35) b.add(clamp, new THREE.Matrix4().makeTranslation(x, y, z), PAL.gold);
  }
  const bar = new THREE.CylinderGeometry(0.04, 0.04, xs[1] - xs[0], 8); bar.rotateZ(Math.PI / 2);
  b.add(bar, new THREE.Matrix4().makeTranslation((xs[0] + xs[1]) / 2, top - 0.12, z), PAL.gold);
  for (const g of [rail, ball, clamp, bar]) g.dispose();
}

// колонна (башня/крепость): золотые кольца-валики по лицу и бокам + пояс под капителью + флажок
function columnDeco(B, s){
  const { x0, x1, y1, y0 } = s;
  const ringAt = y => {
    extrude(B.gold, RING, V(x0 - 0.02, y, ZF), V(1, 0, 0), V(0, 0, 1), x1 - x0 + 0.04, PAL.gold);
    extrude(B.gold, RING, V(x1, y, ZF + 0.02), V(0, 0, -1), V(1, 0, 0), ZF - ZB + 0.02, PAL.gold);
    extrude(B.gold, RING, V(x0, y, ZB), V(0, 0, 1), V(-1, 0, 0), ZF - ZB + 0.02, PAL.gold);
  };
  ringAt(y1 + CAP.bottom - 0.35);                                   // шейка капители
  for (let y = y1 - 3.4; y > Math.max(y0 + 1, y1 - 14); y -= 3.2) ringAt(y);
  // хромовая выкружка карниза и на боках колонны (видна в перспективе)
  const pr = capProfile(0);
  for (const [x, side] of [[x1, 1], [x0, -1]]){
    const O = side > 0 ? V(x, y1, ZF) : V(x, y1, ZB), A = V(0, 0, side > 0 ? -1 : 1);
    extrude(B.chrome, pr.chrome, O, A, V(side, 0, 0), ZF - ZB, PAL.chrome);
    extrude(B.gold, pr.gold, O, A, V(side, 0, 0), ZF - ZB, PAL.gold);
  }
  pennant(B.deco, B.gold, (x0 + x1) / 2, y1 + 0.02, 1.7, Math.abs(Math.round(x0)));
}
// вымпел на золотом древке (синий/фиолетовый — лайм оставлен наградам и чекпоинтам)
function pennant(d, gold, x, y, h, idx){
  const pole = new THREE.CylinderGeometry(0.045, 0.055, h, 8);
  gold.add(pole, new THREE.Matrix4().makeTranslation(x, y + h / 2, -0.4), PAL.gold);
  pole.dispose();
  const ball = new THREE.SphereGeometry(0.085, 10, 8);
  gold.add(ball, new THREE.Matrix4().makeTranslation(x, y + h + 0.06, -0.4), PAL.gold);
  ball.dispose();
  const sh = new THREE.Shape();
  sh.moveTo(0, 0); sh.quadraticCurveTo(0.55, -0.05, 1.05, -0.24); sh.quadraticCurveTo(0.55, -0.34, 0, -0.52); sh.closePath();
  const g = new THREE.ShapeGeometry(sh, 6);
  d.add(g, new THREE.Matrix4().makeTranslation(x + 0.04, y + h - 0.06, -0.4), idx % 2 ? PAL.purple : PAL.blue);
  g.dispose();
}

// Дальний план пропастей: кремовая колонна с карнизом позади провала — держит ощущение глубины там,
// где нет твёрдых стен (сама сцена дальше закрыта слоями задника, см. sky.js).
function backdropPits(level, B){
  const main = level.solids.filter(s => s.kind !== "tower").sort((a, b) => a.x0 - b.x0);
  const rnd = makeRng(404);
  for (let i = 1; i < main.length; i++){
    const a = main[i - 1], b = main[i];
    const gap = b.x0 - a.x1;
    if (gap <= 3.2) continue;
    const cx = (a.x1 + b.x0) / 2 + (rnd() - 0.5) * gap * 0.25, hw = 0.9;
    const ty = Math.max(a.y1, b.y1) + 1.4 + rnd() * 1.4;
    const zf = -8.2, zb = -10.4, tint = 0xdccfe6;
    face(B.body, cx - hw, cx + hw, -14, ty + CAP.bottom, zf, 0.85, tint);
    for (const [x, za, zb2] of [[cx - hw, zb, zf], [cx + hw, zf, zb]])
      B.body.quad(V(x, -14, za), V(x, -14, zb2), V(x, ty - 0.26, zb2), V(x, ty - 0.26, za), [[0, 0], [1, 0], [1, ty / 2], [0, ty / 2]], 0xd9c8dc);
    wallCap(B, cx - hw - 0.15, cx + hw + 0.15, ty, zf, zb, true, true, [0xe4d9ee, 0xbfa582, 0xc9c8e0]);
    pennant(B.deco, B.gold, cx, ty + 0.02, 1.2, i);
  }
}

// движущиеся платформы: сдвиг мешей по позициям из физики (с интерполяцией)
export function placeMovers(moverMeshes, world, alpha){
  for (let i = 0; i < moverMeshes.length; i++){
    const pl = world.movers[i], mm = moverMeshes[i];
    mm.mesh.position.set(pl.x0 - pl.dx * (1 - alpha), pl.y - pl.dy * (1 - alpha), 0);
  }
}
