// Войлочные цветы-лианы «Идеалити»: пятилепестковые головки из приплюснутых сфер (синие / фиолетовые /
// лаймовые) с контрастными серединками-бусинами, листья, стебли-плети. Все точки посадки выводятся из
// реальных поверхностей уровня (константы профиля стен — из walls.js), поэтому ни один цветок не висит
// в воздухе сам по себе:
//   • лианы по лицу колонн (башни/крепости) — две плети у краёв, заворачивают за угол, гуще к капители;
//   • гроздья на кромке карниза стен + плети, свисающие по лицу стены;
//   • низкие «клумбы» у задней кромки широких ярусов (позади героини, не закрывают путь);
//   • гроздья на ободе платформ-«бокалов» (только статичных — на движущихся цветы уехали бы с места).
// Инстансинг: 4 draw call'а (головки, серединки, листья, стебли) на тысячи цветов.
import * as THREE from "three";
import { PAL } from "../config.js";
import { Batch } from "./geo.js";
import { makeRng } from "./tex.js";
import { ZF, CAP, DISC } from "./walls.js";

const ZAX = new THREE.Vector3(0, 0, 1);
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _qs = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const _c = new THREE.Color();
const PETALS = [PAL.blue, PAL.purple, PAL.lime];
const GOLD_BEAD = 0xf0c24a;
// контрастная серединка к цвету лепестков
const CENTERS = [[PAL.lime, GOLD_BEAD, PAL.lime], [PAL.lime, GOLD_BEAD, 0xffe07a], [PAL.blue, 0x5a33c9, PAL.blue]];
const LEAVES = [0x5f8a3c, 0x4c7a35, 0x7ea34a, 0x6b8f3a];

// головка: 5 лепестков веером в локальной плоскости XY (лицо — +Z), кончики чуть к зрителю (чашечка);
// вершинный цвет светлее к кончику — войлочный объём. Радиус головки ≈ 0.23 при масштабе 1.
// Лепесток — «линза» (сфера 8×2 с полюсами по ±Z): силуэт восьмиугольный, 16 треугольников — дёшево
// при тысячах цветов, а сглаженные нормали дают мягкий войлочный объём.
function lens(ws){ const g = new THREE.SphereGeometry(1, ws, 2); g.rotateX(Math.PI / 2); return g; }
function headGeometry(){
  const b = new Batch();
  const k = new THREE.Color();
  for (let i = 0; i < 5; i++){
    const g = lens(8);
    const M = new THREE.Matrix4().makeRotationZ(i / 5 * Math.PI * 2 + 0.3)
      .multiply(new THREE.Matrix4().makeRotationY(-0.32))
      .multiply(new THREE.Matrix4().makeTranslation(0.105, 0, 0))
      .multiply(new THREE.Matrix4().makeScale(0.125, 0.085, 0.032));
    b.add(g, M, v => k.setScalar(0.6 + 0.45 * Math.min(1, Math.hypot(v.x, v.y) / 0.23)));
    g.dispose();
  }
  return b.build();
}
// лист: вытянутая приплюснутая капля от точки крепления вдоль локального +Y, кончик загнут к зрителю
function leafGeometry(){
  const g = lens(6);
  g.scale(0.058, 0.17, 0.02);
  g.translate(0, 0.16, 0);
  g.rotateX(0.3);
  return g;
}

export function createFlowers(level, { density = 1 } = {}){
  const group = new THREE.Group(); group.name = "flowers";
  const rnd = makeRng(2024);
  const R = (a, b) => a + (b - a) * rnd();
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const F = [], L = [], stems = [];
  // лёгкий разброс нормали — цветы смотрят чуть в разные стороны, как живые
  const jit = (n, k) => { n.x += (rnd() - 0.5) * k; n.y += (rnd() - 0.5) * k; return n.normalize(); };
  const pick = () => { const r = rnd(); return r < 0.42 ? 0 : r < 0.78 ? 1 : 2; };
  const flower = (x, y, z, n, s) => F.push({ p: V(x, y, z), n: jit(n, 0.55), s, c: pick() });
  const leaf = (x, y, z, n, s, spin = rnd() * Math.PI * 2) => L.push({ p: V(x, y, z), n: jit(n, 0.5), s, spin });
  const dens = k => rnd() < k * density;

  const walls = level.solids.filter(s => s.kind === "wall");

  // ---------- 1. лианы по колоннам ----------
  for (const s of level.solids){
    if (s.kind !== "tower" && s.kind !== "keep") continue;
    const top = s.y1 + CAP.bottom - 0.02;                          // под хромовой чашей капители
    const bot = Math.max(s.y0 + 0.5, s.y1 - (s.kind === "tower" ? 17 : 12));
    for (const side of [-1, 1]){
      const edge = side < 0 ? s.x0 : s.x1, ph = rnd() * 6;
      // бок колонны открыт только выше соседнего яруса — ниже цветок «за углом» ушёл бы в стену соседа
      const nb = level.solids.find(o => o !== s && Math.abs((side < 0 ? o.x1 : o.x0) - edge) < 1e-3);
      const sideOpenY = nb ? nb.y1 + 0.35 : -Infinity;
      const xc = y => edge - side * (0.62 + 0.24 * Math.sin(y * 1.05 + ph));
      const pts = [];
      for (let y = top + 0.5; y >= bot - 0.2; y -= 0.45) pts.push(V(xc(y), y, ZF + 0.05));
      stems.push({ pts, r: 0.04 });
      const step = 0.19;
      for (let y = top; y >= bot; y -= step){
        const t = (top - y) / Math.max(1, top - bot);                // 0 у капители → 1 внизу
        const thin = t > 0.7 ? 1 - (t - 0.7) / 0.3 * 0.75 : 1;         // к концу плеть редеет
        const cx = xc(y);
        if (dens(0.9 * thin)){
          let x = cx + R(-0.55, 0.55), z = ZF + R(0.12, 0.2);
          const n = V(0, 0.12, 1);
          // у самого края — цветок заворачивает за угол колонны (неровный силуэт, как в референсе)
          if (side * (x - edge) > -0.08 && y > sideOpenY){ x = edge + side * R(0.02, 0.12); z = ZF - R(0.02, 0.45); n.set(side * 0.9, 0.1, 0.45); }
          flower(x, y + R(-0.07, 0.07), z, n, R(0.85, 1.3));
        }
        const nSmall = dens(thin) ? 2 : 1;
        for (let k = 0; k < nSmall; k++) flower(cx + R(-0.66, 0.66), y + R(-0.1, 0.1), ZF + R(0.07, 0.11), V(0, 0.1, 1), R(0.45, 0.72));
        for (let k = 0; k < 2; k++) if (dens(0.9)) leaf(cx + R(-0.6, 0.6), y + R(-0.1, 0.1), ZF + 0.05, V(0, 0, 1), R(0.9, 1.35));
      }
      // «шапка» у капители: цветы переваливают через карниз
      for (let k = 0; k < 9; k++) flower(xc(top) + R(-0.6, 0.6), s.y1 + R(-0.62, -0.08), ZF + CAP.front + R(0.02, 0.1), V(0, 0.45, 1), R(0.75, 1.2));
      for (let k = 0; k < 7; k++) leaf(xc(top) + R(-0.7, 0.7), s.y1 + R(-0.6, -0.1), ZF + CAP.front, V(0, 0.3, 1), R(0.9, 1.3));
    }
  }

  // ---------- 2. гроздья на кромке карниза + свисающие плети ----------
  const zr = ZF + CAP.front + 0.05;                                  // перед сливочной подушкой
  for (const s of walls){
    let x = s.x0 + R(0.5, 1.8);
    while (x < s.x1 - 0.8){
      const wc = R(0.7, 1.7), cx = Math.min(x + wc / 2, s.x1 - 0.45 - wc / 2);
      const nTop = Math.max(2, Math.round(wc * 5 * density));
      for (let k = 0; k < nTop; k++) flower(cx + R(-wc / 2, wc / 2), s.y1 + R(-0.26, 0.02), zr + R(0, 0.08), V(0, 0.5, 1), R(0.7, 1.15));
      for (let k = 0; k < nTop; k++) leaf(cx + R(-wc / 2 - 0.12, wc / 2 + 0.12), s.y1 + R(-0.24, -0.02), zr - 0.03, V(0, 0.35, 1), R(0.9, 1.3));
      const nTr = 1 + Math.floor(rnd() * 2.6 * Math.min(1, wc));
      for (let tr = 0; tr < nTr; tr++){
        const xt = cx + R(-wc / 2, wc / 2), len = rnd() < 0.28 ? R(1.6, 3.2) : R(0.45, 1.3), ph = rnd() * 6;
        const trail = d => V(xt + 0.08 * Math.sin(d * 3.5 + ph), s.y1 - 0.12 - d, zr - 0.03 - 0.22 * Math.min(1, d / 1.2));
        const pts = [];
        for (let d = 0; d <= len + 0.01; d += 0.2) pts.push(trail(d));
        stems.push({ pts, r: 0.022 });
        for (let d = 0.12; d <= len; d += 0.15){
          const k = d / len, p = trail(d);
          flower(p.x + R(-0.13, 0.13), p.y + R(-0.04, 0.04), p.z + R(0.01, 0.05), V(0, -0.1, 1), (1 - 0.4 * k) * R(0.6, 0.95));
          if (dens(0.85)) leaf(p.x + R(-0.08, 0.08), p.y, p.z - 0.02, V(0, 0, 1), R(0.8, 1.15), Math.PI + R(-1.1, 1.1));
        }
      }
      x += wc + R(1.8, 4.4) / density;
    }
  }

  // ---------- 3. клумбы у задней кромки широких ярусов ----------
  for (const s of walls){
    if (s.x1 - s.x0 < 4.5) continue;
    let x = s.x0 + R(1.2, 3);
    while (x < s.x1 - 1.3){
      const hw = R(0.7, 1.4), n = Math.round(hw * 10 * density);
      for (let k = 0; k < n; k++){
        const u = R(-1, 1), h = (1 - u * u) * R(0.15, 0.55);
        flower(x + u * hw, s.y1 + 0.06 + h, R(-1.05, -0.8), V(0, 0.55, 1), R(0.7, 1.15));
      }
      for (let k = 0; k < n * 1.3; k++){
        const u = R(-1.1, 1.1), h = Math.max(0, 1 - u * u) * R(0, 0.4);
        leaf(x + u * hw, s.y1 + 0.02 + h, R(-1.1, -0.85), V(0, 0.6, 1), R(1, 1.5), R(-1.2, 1.2));
      }
      x += hw * 2 + R(3.5, 7.5) / density;
    }
  }

  // ---------- 4. гроздья на ободе статичных платформ-«бокалов» ----------
  for (const o of level.oneways){
    const cx = (o.x0 + o.x1) / 2, rx = (o.x1 - o.x0) / 2;
    for (const th of [R(0.9, 1.25), R(1.9, 2.3)]){                       // передняя половина овала (z > 0)
      const ax = cx + Math.cos(th) * rx, az = Math.sin(th) * DISC.rz + 0.06;
      const n = V(Math.cos(th) / rx, 0.3, Math.sin(th) / DISC.rz).normalize();
      for (let k = 0; k < 4; k++) flower(ax + R(-0.25, 0.25), o.y + R(-0.24, 0), az + R(0, 0.06), n.clone(), R(0.7, 1.05));
      for (let k = 0; k < 4; k++) leaf(ax + R(-0.3, 0.3), o.y + R(-0.22, -0.02), az - 0.02, n.clone(), R(0.9, 1.2));
      const len = R(0.35, 0.9), pts = [];
      for (let d = 0; d <= len + 0.01; d += 0.15) pts.push(V(ax + 0.05 * Math.sin(d * 5), o.y - 0.1 - d, az - 0.03));
      stems.push({ pts, r: 0.02 });
      for (let d = 0.15; d <= len; d += 0.15) flower(ax + R(-0.08, 0.08), o.y - 0.1 - d, az, V(0, -0.1, 1), R(0.55, 0.8));
    }
  }

  // ---------- сборка инстансов ----------
  const N = F.length, NL = L.length;
  const headMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, vertexColors: true, roughness: 0.9, metalness: 0,
    sheen: 0.7, sheenRoughness: 0.5, sheenColor: new THREE.Color(0xe8e0ff), envMapIntensity: 0.45,
  });
  const heads = new THREE.InstancedMesh(headGeometry(), headMat, N);
  heads.name = "flower-heads";
  const centers = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 6, 3), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.32, metalness: 0.15 }), N);
  centers.name = "flower-centers";
  const leafMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0, sheen: 0.5, sheenRoughness: 0.6, sheenColor: new THREE.Color(0xc8f08a), envMapIntensity: 0.4, side: THREE.DoubleSide });
  const leaves = new THREE.InstancedMesh(leafGeometry(), leafMat, Math.max(1, NL));
  leaves.name = "flower-leaves";

  F.forEach((f, i) => {
    _q.setFromUnitVectors(ZAX, f.n); _qs.setFromAxisAngle(ZAX, rnd() * Math.PI * 2); _q.multiply(_qs);
    _s.setScalar(f.s); _m.compose(f.p, _q, _s); heads.setMatrixAt(i, _m);
    _c.set(PETALS[f.c]).offsetHSL(R(-0.015, 0.015), 0, R(-0.05, 0.04)); heads.setColorAt(i, _c);
    // серединка-бусина: чуть вперёд по нормали, контрастный цвет
    _p.copy(f.p).addScaledVector(f.n, 0.035 * f.s); _s.setScalar(0.078 * f.s);
    _m.compose(_p, _q, _s); centers.setMatrixAt(i, _m);
    const cc = CENTERS[f.c]; _c.set(cc[Math.floor(rnd() * cc.length)]); centers.setColorAt(i, _c);
  });
  L.forEach((l, i) => {
    _q.setFromUnitVectors(ZAX, l.n); _qs.setFromAxisAngle(ZAX, l.spin); _q.multiply(_qs);
    _s.setScalar(l.s); _m.compose(l.p, _q, _s); leaves.setMatrixAt(i, _m);
    _c.set(LEAVES[Math.floor(rnd() * LEAVES.length)]).offsetHSL(0, 0, R(-0.04, 0.04)); leaves.setColorAt(i, _c);
  });
  for (const m of [heads, centers, leaves]){
    m.frustumCulled = false;                       // один набор на весь уровень — отсекать нечего
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }

  // стебли-плети — трубки по сглаженным полилиниям, одним мешем
  const sb = new Batch();
  for (const st of stems){
    if (st.pts.length < 2) continue;
    const curve = new THREE.CatmullRomCurve3(st.pts);
    const g = new THREE.TubeGeometry(curve, Math.max(4, st.pts.length * 2), st.r, 4, false);
    sb.add(g, new THREE.Matrix4(), 0x55733a);
    g.dispose();
  }
  const stemMesh = new THREE.Mesh(sb.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0 }));
  stemMesh.name = "flower-stems"; stemMesh.matrixAutoUpdate = false; stemMesh.updateMatrix();

  group.add(stemMesh, leaves, heads, centers);
  return { group, count: N, leaves: NL };
}
