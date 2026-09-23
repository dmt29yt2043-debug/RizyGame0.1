// Стены уровня: кремовый кирпич, лавандовый пояс со вставками, светлый карниз, плиты сверху.
// Все стены — 4 draw call'а (кирпич / пояс / верх / карниз), декор (зубцы, крыши, окна, кусты, кубики,
// флажки) — ещё один; платформы «насквозь снизу» — один; движущиеся — по мешу на штуку.
import * as THREE from "three";
import { PAL } from "../config.js";
import { Batch } from "./geo.js";
import { brickTexture, bandTexture, topTexture, makeRng } from "./tex.js";

export const ZF = 1.0;      // лицевая плоскость стен
export const ZB = -1.15;    // задняя кромка верха
const BAND = 1.0;           // высота пояса под карнизом
const CORN = 0.16;          // высота карниза
const OVER = 0.09;          // вынос карниза

const V = (x, y, z) => new THREE.Vector3(x, y, z);

export function buildWalls(level, renderer){
  const group = new THREE.Group(); group.name = "walls";
  const body = new Batch(), band = new Batch(), top = new Batch(), trim = new Batch(), deco = new Batch();
  const S = level.solids;
  const eps = 1e-3;
  const neighbor = (x, side) => S.find(o => side < 0 ? Math.abs(o.x1 - x) < eps : Math.abs(o.x0 - x) < eps);

  for (const s of S){
    const { x0, x1, y0, y1 } = s;
    const nL = neighbor(x0, -1), nR = neighbor(x1, 1);
    const ovL = nL && nL.y1 >= y1 ? 0 : OVER, ovR = nR && nR.y1 >= y1 ? 0 : OVER;
    const yb = y1 - BAND;
    // лицо: пояс + кирпич
    band.quad(V(x0, yb, ZF), V(x1, yb, ZF), V(x1, y1 - CORN, ZF), V(x0, y1 - CORN, ZF),
      [[x0 / 2, 0], [x1 / 2, 0], [x1 / 2, 1 - CORN / BAND], [x0 / 2, 1 - CORN / BAND]]);
    body.quad(V(x0, y0, ZF), V(x1, y0, ZF), V(x1, yb, ZF), V(x0, yb, ZF),
      [[x0 / 2, y0 / 2], [x1 / 2, y0 / 2], [x1 / 2, yb / 2], [x0 / 2, yb / 2]]);
    // бока (видны в перспективе); низ бока прячется за соседом
    for (const side of [-1, 1]){
      const x = side < 0 ? x0 : x1, n = side < 0 ? nL : nR;
      const from = n ? Math.max(y0, n.y1) : y0;
      if (from >= y1 - eps) continue;
      const za = side < 0 ? ZB : ZF, zb = side < 0 ? ZF : ZB;
      const bandFrom = Math.max(from, yb);
      if (bandFrom < y1 - CORN)
        band.quad(V(x, bandFrom, za), V(x, bandFrom, zb), V(x, y1 - CORN, zb), V(x, y1 - CORN, za),
          [[za / 2, (bandFrom - yb) / BAND], [zb / 2, (bandFrom - yb) / BAND], [zb / 2, 1 - CORN / BAND], [za / 2, 1 - CORN / BAND]]);
      if (from < yb)
        body.quad(V(x, from, za), V(x, from, zb), V(x, yb, zb), V(x, yb, za),
          [[za / 2, from / 2], [zb / 2, from / 2], [zb / 2, yb / 2], [za / 2, yb / 2]]);
    }
    // верх с выносом карниза
    const tx0 = x0 - ovL, tx1 = x1 + ovR, tz = ZF + OVER;
    top.quad(V(tx0, y1, tz), V(tx1, y1, tz), V(tx1, y1, ZB), V(tx0, y1, ZB),
      [[tx0 / 2, tz / 2], [tx1 / 2, tz / 2], [tx1 / 2, ZB / 2], [tx0 / 2, ZB / 2]]);
    // карниз: лицо, низ выноса, торцы
    trim.quad(V(tx0, y1 - CORN, tz), V(tx1, y1 - CORN, tz), V(tx1, y1, tz), V(tx0, y1, tz), null, PAL.trim);
    trim.quad(V(tx0, y1 - CORN, ZF), V(tx1, y1 - CORN, ZF), V(tx1, y1 - CORN, tz), V(tx0, y1 - CORN, tz), null, 0xe9d9d6);
    if (ovL > 0) trim.quad(V(tx0, y1 - CORN, ZB), V(tx0, y1 - CORN, tz), V(tx0, y1, tz), V(tx0, y1, ZB), null, 0xf3e6e2);
    if (ovR > 0) trim.quad(V(tx1, y1 - CORN, tz), V(tx1, y1 - CORN, ZB), V(tx1, y1, ZB), V(tx1, y1, tz), null, 0xf3e6e2);
    // золотая нить под карнизом (чуть выступает)
    trim.quad(V(x0, y1 - CORN - 0.05, ZF + 0.02), V(x1, y1 - CORN - 0.05, ZF + 0.02), V(x1, y1 - CORN, ZF + 0.02), V(x0, y1 - CORN, ZF + 0.02), null, PAL.gold);

    if (s.kind === "keep" || s.kind === "tower") decorKeep(deco, s);
  }
  decorTops(deco, level);
  backdropPits(level, body, band, top, trim, deco);

  const brick = brickTexture(renderer), bandT = bandTexture(renderer), topT = topTexture(renderer);
  const mk = (b, mat, name) => { const m = new THREE.Mesh(b.build(), mat); m.name = name; m.matrixAutoUpdate = false; m.updateMatrix(); group.add(m); return m; };
  // цвет вершин: белый у стен пути, лавандовый оттенок у дальних стен в пропастях (глубина без лишних draw call'ов)
  mk(body, new THREE.MeshLambertMaterial({ map: brick, vertexColors: true }), "wall-body");
  mk(band, new THREE.MeshLambertMaterial({ map: bandT, vertexColors: true }), "wall-band");
  mk(top, new THREE.MeshLambertMaterial({ map: topT, vertexColors: true }), "wall-top");
  mk(trim, new THREE.MeshLambertMaterial({ vertexColors: true }), "wall-trim");
  mk(deco, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), "wall-deco");

  // ---------- платформы «насквозь снизу» ----------
  const ow = new Batch();
  for (const o of level.oneways) slab(ow, o.x0, o.x1, o.y, false);
  mk(ow, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), "oneways");

  // ---------- движущиеся ----------
  const moverMeshes = [];
  const mvMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  for (const m of level.movers){
    const b = new Batch();
    slab(b, 0, m.x1 - m.x0, 0, true);
    const mesh = new THREE.Mesh(b.build(), mvMat);
    mesh.name = "mover-" + m.id;
    group.add(mesh);
    moverMeshes.push({ mesh, m });
  }
  return { group, moverMeshes };
}

// плита: верх кремовый, лицо лавандовое (у движущихся — мятное), снизу кристальный «киль»
function slab(b, x0, x1, y, moving){
  const T = 0.38, z0 = -0.9, z1 = 0.9;
  const face = moving ? PAL.mint : PAL.lav;
  b.box(x0, y - T, z0, x1, y, z1, { py: PAL.top, pz: face, nz: face, px: 0xd8cbe8, nx: 0xd8cbe8, ny: 0x9c89c9 });
  // светлая кромка
  b.box(x0 - 0.04, y - 0.09, z1, x1 + 0.04, y, z1 + 0.05, { all: PAL.trim, ny: 0xe9d9d6 }, "pzpypxnxny");
  // киль
  const w = x1 - x0, cx = (x0 + x1) / 2;
  const keel = new THREE.ConeGeometry(Math.min(0.8, w * 0.3), moving ? 0.55 : 0.9, 4, 1);
  const M = new THREE.Matrix4().compose(V(cx, y - T - (moving ? 0.27 : 0.45), 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI, Math.PI / 4, 0)), V(1.6, 1, 1));
  b.add(keel, M, moving ? 0x7fdcc0 : 0xa894d6);
  keel.dispose();
  if (moving){
    // два «пропеллерных» кружка по краям
    const disc = new THREE.CylinderGeometry(0.28, 0.28, 0.08, 10);
    for (const x of [x0 + 0.45, x1 - 0.45]) b.add(disc, new THREE.Matrix4().makeTranslation(x, y - T - 0.06, 0), 0xc0ff3f);
    disc.dispose();
  }
}

// зубцы, окна-бойницы, крыши и флажки на башнях
function decorKeep(d, s){
  const { x0, x1, y1 } = s;
  const w = x1 - x0;
  const n = Math.max(2, Math.round(w / 1.15));
  const step = w / n;
  for (let i = 0; i < n; i++){
    const cx = x0 + step * (i + 0.5);
    d.box(cx - 0.3, y1, ZB, cx + 0.3, y1 + 0.6, ZB + 0.55, { py: PAL.trim, pz: PAL.band, px: 0xe9d7da, nx: 0xe9d7da, nz: PAL.band }, "pypzpxnx");
  }
  // окна-щели на лице
  const rows = s.kind === "tower" ? [y1 - 3, y1 - 6.5, y1 - 10] : [y1 - 2.4];
  for (const wy of rows){
    const cols = s.kind === "tower" ? [x0 + w * 0.3, x0 + w * 0.7] : [x0 + w * 0.5];
    for (const wx of cols){
      if (wy < -1) continue;
      d.quad(V(wx - 0.22, wy, ZF + 0.01), V(wx + 0.22, wy, ZF + 0.01), V(wx + 0.22, wy + 0.9, ZF + 0.01), V(wx - 0.22, wy + 0.9, ZF + 0.01), null, PAL.lavDeep);
      const arch = new THREE.CircleGeometry(0.22, 8, 0, Math.PI);
      d.add(arch, new THREE.Matrix4().makeTranslation(wx, wy + 0.9, ZF + 0.01), PAL.lavDeep);
      arch.dispose();
    }
  }
  if (s.kind === "tower"){
    // пирамидальная крыша и флажок
    const cx = (x0 + x1) / 2, cz = (ZF + ZB) / 2;
    const roof = new THREE.ConeGeometry(Math.max(w, ZF - ZB) * 0.78, 5, 4, 1);
    d.add(roof, new THREE.Matrix4().compose(V(cx, y1 + 0.6 + 2.5, cz), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 4, 0)), V(1, 1, 0.75)),
      (v, n) => n.x > 0.1 ? 0x8f7cc0 : (n.z > 0 ? 0xa18fd0 : 0x9483c6));
    roof.dispose();
    flag(d, cx, y1 + 0.6 + 5, 1.6, 0);
  }
}
function flag(d, x, y, h, colorIdx){
  const pole = new THREE.CylinderGeometry(0.045, 0.045, h, 5);
  d.add(pole, new THREE.Matrix4().makeTranslation(x, y + h / 2, -0.4), 0xf2e6f0);
  pole.dispose();
  const sh = new THREE.Shape();
  sh.moveTo(0, 0); sh.lineTo(1.0, -0.22); sh.lineTo(0, -0.5); sh.closePath();
  const g = new THREE.ShapeGeometry(sh);
  d.add(g, new THREE.Matrix4().makeTranslation(x + 0.04, y + h - 0.05, -0.4), [0xf0a6c8, 0x9fb4ff, 0xc0ff3f][colorIdx % 3]);
  g.dispose();
}

// кусты-помпоны и кубики Идеалити у задней кромки стен
function decorTops(d, level){
  const rnd = makeRng(99);
  const bush = new THREE.IcosahedronGeometry(1, 1);
  const cube = new THREE.BoxGeometry(1, 1, 1);
  const cols = [0xbfead8, 0xd9c6f1, 0xf5c7dd, 0xcfe0ff];
  for (const s of level.solids){
    if (s.kind === "tower") continue;
    const w = s.x1 - s.x0;
    for (let x = s.x0 + 0.8; x < s.x1 - 0.6; x += 2.2 + rnd() * 2.6){
      const r = rnd();
      if (s.kind === "keep") break;
      if (r < 0.45){
        const rad = 0.26 + rnd() * 0.18;
        d.add(bush, new THREE.Matrix4().compose(V(x, s.y1 + rad * 0.7, ZB + 0.32), new THREE.Quaternion(), V(rad * 1.25, rad, rad)), cols[(rnd() * 4) | 0]);
      } else if (r < 0.7 && w > 5){
        // стопка кубиков Идеалити
        const a = 0.42 + rnd() * 0.2;
        d.add(cube, new THREE.Matrix4().compose(V(x, s.y1 + a / 2, ZB + 0.3), new THREE.Quaternion(), V(a, a, a)), cols[(rnd() * 4) | 0]);
        if (rnd() < 0.6){ const b = a * 0.6; d.add(cube, new THREE.Matrix4().compose(V(x + 0.06, s.y1 + a + b / 2, ZB + 0.3), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0.5, 0)), V(b, b, b)), cols[(rnd() * 4) | 0]); }
      }
    }
  }
  // флажки на крепостях
  let k = 0;
  for (const s of level.solids) if (s.kind === "keep"){ flag(d, s.x0 + 0.6, s.y1 + 0.6, 1.4, k++); flag(d, s.x1 - 0.6, s.y1 + 0.6, 1.4, k++); }
  bush.dispose(); cube.dispose();
}

// Дальний план пропастей: башня с конусной крышей позади провала (как башня с синей крышей в референсе).
// Те же текстуры, лавандовый оттенок цветом вершин.
function backdropPits(level, body, band, top, trim, deco){
  const main = level.solids.filter(s => s.kind !== "tower").sort((a, b) => a.x0 - b.x0);
  const rnd = makeRng(404);
  const wallBox = (x0, x1, y0, y1, zf, zb, tint, withBand = true) => {
    const yb = withBand ? y1 - BAND : y1;
    if (withBand) band.quad(V(x0, yb, zf), V(x1, yb, zf), V(x1, y1 - CORN, zf), V(x0, y1 - CORN, zf),
      [[x0 / 2, 0], [x1 / 2, 0], [x1 / 2, 1 - CORN / BAND], [x0 / 2, 1 - CORN / BAND]], tint);
    body.quad(V(x0, y0, zf), V(x1, y0, zf), V(x1, yb, zf), V(x0, yb, zf),
      [[x0 / 2, y0 / 2], [x1 / 2, y0 / 2], [x1 / 2, yb / 2], [x0 / 2, yb / 2]], tint);
    for (const [x, za, zb2] of [[x0, zb, zf], [x1, zf, zb]])
      body.quad(V(x, y0, za), V(x, y0, zb2), V(x, y1, zb2), V(x, y1, za), [[za / 2, y0 / 2], [zb2 / 2, y0 / 2], [zb2 / 2, y1 / 2], [za / 2, y1 / 2]], tint);
    top.quad(V(x0, y1, zf + 0.06), V(x1, y1, zf + 0.06), V(x1, y1, zb), V(x0, y1, zb), [[x0 / 2, zf / 2], [x1 / 2, zf / 2], [x1 / 2, zb / 2], [x0 / 2, zb / 2]], tint);
    trim.quad(V(x0, y1 - CORN, zf + 0.06), V(x1, y1 - CORN, zf + 0.06), V(x1, y1, zf + 0.06), V(x0, y1, zf + 0.06), null, tint);
  };
  for (let i = 1; i < main.length; i++){
    const a = main[i - 1], b = main[i];
    const gap = b.x0 - a.x1;
    // башня в провале (стену-ров не ставим: она читается как «пол» в пропасти)
    if (gap > 3.2){
      const cx = (a.x1 + b.x0) / 2 + (rnd() - 0.5) * gap * 0.25, hw = 1.15;
      const ty = Math.max(a.y1, b.y1) + 1.6 + rnd() * 1.5;
      const zf = -8.2, zb = -10.4;
      wallBox(cx - hw, cx + hw, -14, ty, zf, zb, 0xcdbde6, false);
      // зубцы и крыша
      const roof = new THREE.ConeGeometry(hw * 1.55, 2.6 + rnd() * 0.8, 4, 1);
      deco.add(roof, new THREE.Matrix4().compose(V(cx, ty + 1.45, (zf + zb) / 2), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 4, 0)), V(1, 1, 0.9)),
        (v, n) => n.x > 0.1 ? 0x8573bd : 0x9785c8);
      roof.dispose();
      // окна-щели
      for (const wy2 of [ty - 1.6, ty - 3.4]){
        deco.quad(V(cx - 0.17, wy2, zf + 0.01), V(cx + 0.17, wy2, zf + 0.01), V(cx + 0.17, wy2 + 0.7, zf + 0.01), V(cx - 0.17, wy2 + 0.7, zf + 0.01), null, 0xf6eefa);
      }
      flag(deco, cx, ty + 2.6, 1.3, i);
    }
  }
}

// движущиеся платформы: сдвиг мешей по позициям из физики (с интерполяцией)
export function placeMovers(moverMeshes, world, alpha){
  for (let i = 0; i < moverMeshes.length; i++){
    const pl = world.movers[i], mm = moverMeshes[i];
    mm.mesh.position.set(pl.x0 - pl.dx * (1 - alpha), pl.y - pl.dy * (1 - alpha), 0);
  }
}
