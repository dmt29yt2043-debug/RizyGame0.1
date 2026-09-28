// Войлочные цветы «Идеалити» — крупные (с голову Ризи), пышными гроздьями и гирляндами, как в концепте:
// пятилепестковые головки (синие / фиолетовые / лаймовые) с контрастными серединками-бусинами, листья,
// стебли-плети. Все точки посадки — от реальной архитектуры (walls.js / layout.js), ни один цветок не висит
// в воздухе сам по себе:
//   • гирлянды-«фестоны» по переднему краю ярусов под золотым поясом: гроздь → провисающая плеть → гроздь,
//     с гроздей свисают каскады (над аркадой);
//   • низкие клумбы у задней кромки ярусов (за Ризи) и букеты в урнах (места — layout.js decorSpots);
//   • лианы по колоннам (keep/tower) снизу доверху, «шапка» у капители и каскад с диска;
//   • гроздья и каскады на ободе статичных дисков-платформ.
// Передний край яруса ближе к камере, чем Ризи: там цветы не поднимаются выше пола (иначе закрыли бы ноги).
// Инстансинг: 4 draw call'а (головки, серединки, листья, стебли) на все цветы уровня.
import * as THREE from "three";
import { PAL } from "../config.js";
import { Batch } from "./geo.js";
import { makeRng } from "./tex.js";
import { ZF, DISC, URN, URN_TOP } from "./walls.js";
import { blockLayout, decorSpots } from "./layout.js";

const ZAX = new THREE.Vector3(0, 0, 1);
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _qs = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const _c = new THREE.Color();
const PETALS = [PAL.blue, PAL.purple, PAL.lime];
const GOLD_BEAD = 0xf0c24a;
// контрастная серединка к цвету лепестков
const CENTERS = [[PAL.lime, GOLD_BEAD, PAL.lime], [PAL.lime, GOLD_BEAD, 0xffe07a], [PAL.blue, 0x5a33c9, PAL.blue]];
const LEAVES = [0x5f8a3c, 0x4c7a35, 0x7ea34a, 0x6b8f3a];

// головка: 5 лепестков веером в локальной плоскости XY (лицо — +Z), кончики чуть к зрителю (чашечка);
// вершинный цвет светлее к кончику — войлочный объём. Радиус головки ≈ 0.25 при масштабе 1.
function lens(ws, hs = 2){ const g = new THREE.SphereGeometry(1, ws, hs); g.rotateX(Math.PI / 2); return g; }
// лепесток-«подушечка»: веер из центра (выпуклый, нормаль к зрителю) к краю-эллипсу (нормали наклонены
// наружу на ~50°) — мягкая войлочная светотень без граней, как у сферы с резким экватором; спинка — такой же
// веер назад. 10 точек края → 20 треугольников на лепесток.
function petalGeometry(){
  const n = 10, pos = [], nor = [], uv = [];
  const rim = [];
  for (let k = 0; k < n; k++){ const a = k / n * Math.PI * 2; rim.push([Math.cos(a), Math.sin(a)]); }
  for (const side of [1, -1]){
    for (let k = 0; k < n; k++){
      const [ax, ay] = rim[k], [bx, by] = rim[(k + 1) % n];
      const tri = side > 0 ? [[0, 0, 0.9], [ax, ay, 0], [bx, by, 0]] : [[0, 0, -0.5], [bx, by, 0], [ax, ay, 0]];
      for (const [x, y, z] of tri){
        pos.push(x, y, z);
        const c = (x === 0 && y === 0) ? [0, 0, side] : [x * 0.78, y * 0.78, 0.62 * side];
        const l = Math.hypot(c[0], c[1], c[2]); nor.push(c[0] / l, c[1] / l, c[2] / l);
        uv.push(x * 0.5 + 0.5, y * 0.5 + 0.5);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  return g;
}
function headGeometry(){
  const b = new Batch();
  const k = new THREE.Color();
  for (let i = 0; i < 5; i++){
    const g = petalGeometry();
    const M = new THREE.Matrix4().makeRotationZ(i / 5 * Math.PI * 2 + 0.3)
      .multiply(new THREE.Matrix4().makeRotationY(-0.36))
      .multiply(new THREE.Matrix4().makeTranslation(0.118, 0, 0))
      .multiply(new THREE.Matrix4().makeScale(0.135, 0.098, 0.036));
    b.add(g, M, v => k.setScalar(0.42 + 0.52 * Math.min(1, Math.hypot(v.x, v.y) / 0.25)));
    g.dispose();
  }
  return b.build();
}
// лист: вытянутая приплюснутая капля от точки крепления вдоль локального +Y, кончик загнут к зрителю
function leafGeometry(){
  const g = lens(6);
  g.scale(0.07, 0.2, 0.022);
  g.translate(0, 0.19, 0);
  g.rotateX(0.3);
  return g;
}

export function createFlowers(level, { density = 1, biolum = false } = {}){
  const group = new THREE.Group(); group.name = "flowers";
  const rnd = makeRng(2024);
  const R = (a, b) => a + (b - a) * rnd();
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const F = [], L = [], stems = [];
  const jit = (n, k) => { n.x += (rnd() - 0.5) * k; n.y += (rnd() - 0.5) * k; return n.normalize(); };
  const pick = () => { const r = rnd(); return r < 0.42 ? 0 : r < 0.78 ? 1 : 2; };
  const flower = (x, y, z, n, s, c = pick()) => F.push({ p: V(x, y, z), n: jit(n, 0.5), s, c });
  const leaf = (x, y, z, n, s, spin = rnd() * Math.PI * 2) => L.push({ p: V(x, y, z), n: jit(n, 0.5), s, spin });
  const dens = k => rnd() < k * density;
  // крупность: «герои» — с голову Ризи, средние, мелочь-заполнитель
  const big = () => R(1.25, 1.65), mid = () => R(0.85, 1.15), small = () => R(0.55, 0.78);
  const busy = [];                                   // таблички/флажки — у них не сажаем (читаемость)
  for (const sg of level.signs) busy.push([sg.x - 1.2, sg.x + 1.2]);
  for (const t of level.torches) busy.push([t.x - 0.6, t.x + 0.6]);
  const isBusy = x => busy.some(([a, b]) => x > a && x < b);

  const info = blockLayout(level);
  const vines = level.vines || [];

  // гроздь: плотная «подушка» из головок и листьев вокруг точки (x, y, z), нормаль n; r — радиус грозди
  const cluster = (x, y, z, n, r, count, yMax = Infinity) => {
    for (let k = 0; k < count; k++){
      const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * r;
      const fx = x + Math.cos(a) * d, fy = Math.min(yMax, y + Math.sin(a) * d * 0.75);
      const s = k < count * 0.45 ? big() : k < count * 0.85 ? mid() : small();
      flower(fx, fy, z + R(-0.04, 0.08), n.clone(), s);
    }
    for (let k = 0; k < Math.round(count * 1.1); k++){
      const a = rnd() * Math.PI * 2, d = r * R(0.6, 1.25);
      leaf(x + Math.cos(a) * d, Math.min(yMax, y + Math.sin(a) * d * 0.7), z - 0.05, n.clone(), R(1.1, 1.6), a - Math.PI / 2 + R(-0.4, 0.4));
    }
  };
  // каскад: плеть вниз от (x, y) длиной len; цветы мельчают к концу
  const cascade = (x, y, z, len, sway = 0.1) => {
    const ph = rnd() * 6, pts = [];
    const at = d => V(x + sway * Math.sin(d * 2.6 + ph), y - d, z - 0.12 * Math.min(1, d / 1.5));
    for (let d = 0; d <= len + 0.01; d += 0.22) pts.push(at(d));
    stems.push({ pts, r: 0.024 });
    for (let d = 0.1; d <= len; d += 0.17){
      const k = d / len, p = at(d);
      flower(p.x + R(-0.12, 0.12), p.y + R(-0.04, 0.04), p.z + R(0.0, 0.06), V(0, -0.15, 1), (1 - 0.45 * k) * R(0.8, 1.2));
      if (dens(0.9)) leaf(p.x + R(-0.12, 0.12), p.y, p.z - 0.03, V(0, 0, 1), R(0.9, 1.3), Math.PI + R(-1.2, 1.2));
    }
  };

  // ---------- 1. ярусы: фестоны под золотым поясом + каскады ----------
  const zG = ZF + 0.46;                            // перед золотым поясом
  for (const it of info){
    const s = it.s;
    if (it.col) continue;
    const w = s.x1 - s.x0, y1 = s.y1;
    const yTopOK = y1 + 0.1;                       // выше пола спереди не растём (ноги Ризи)
    // узлы гирлянды (грозди) через 2.8–4.2 ед.
    const nodes = [];
    let x = s.x0 + R(0.6, 1.3);
    while (x < s.x1 - 0.5){ if (!isBusy(x)) nodes.push(x); x += R(2.8, 4.2) / density; }
    for (let i = 0; i < nodes.length; i++){
      const nx = nodes[i];
      cluster(nx, y1 - 0.32, zG, V(0, 0.2, 1), 0.36, Math.round(8 * density), yTopOK);
      if (rnd() < 0.8) cascade(nx + R(-0.25, 0.25), y1 - 0.55, zG, rnd() < 0.35 ? R(1.6, 2.6) : R(0.7, 1.4));
      // фестон к следующему узлу — провисает под поясом
      if (i < nodes.length - 1 && nodes[i + 1] - nx < 5){
        const a = nx + 0.3, b = nodes[i + 1] - 0.3, sag = R(0.45, 0.7), pts = [];
        for (let t = 0; t <= 1.001; t += 0.1) pts.push(V(a + (b - a) * t, y1 - 0.45 - sag * 4 * t * (1 - t), zG - 0.02));
        stems.push({ pts, r: 0.03 });
        for (let t = 0.08; t < 0.95; t += 0.09){
          const px = a + (b - a) * t, py = y1 - 0.45 - sag * 4 * t * (1 - t);
          flower(px + R(-0.06, 0.06), py + R(-0.08, 0.06), zG + R(0.0, 0.06), V(0, 0.05, 1), rnd() < 0.4 ? mid() : small() * 1.15);
          if (dens(0.8)) leaf(px, py + R(-0.1, 0.05), zG - 0.04, V(0, 0, 1), R(0.9, 1.3), R(-2.2, 2.2));
        }
      }
    }
    // клумбы у задней кромки (за Ризи), кроме мест реквизита
    if (w > 4.5){
      let bx = s.x0 + R(0.8, 2.2);
      while (bx < s.x1 - 0.8){
        const hw = R(0.5, 0.95), n = Math.round(hw * 11 * density);
        for (let k = 0; k < n; k++){
          const u = R(-1, 1), h = (1 - u * u) * R(0.12, 0.5);
          flower(bx + u * hw, y1 + 0.08 + h, R(-1.1, -0.82), V(0, 0.5, 1), k < n * 0.4 ? big() * 0.9 : mid());
        }
        for (let k = 0; k < n * 1.2; k++){
          const u = R(-1.1, 1.1), h = Math.max(0, 1 - u * u) * R(0, 0.35);
          leaf(bx + u * hw, y1 + 0.03 + h, R(-1.12, -0.86), V(0, 0.6, 1), R(1.1, 1.6), R(-1.2, 1.2));
        }
        bx += hw * 2 + R(3.5, 6.5) / density;
      }
    }
  }

  // ---------- 2. букеты в урнах ----------
  for (const d of decorSpots(level)){
    if (d.kind !== "urn") continue;
    const top = d.y + URN_TOP(d.big), r = d.big ? 0.36 : 0.3;
    const n = Math.round((d.big ? 14 : 10) * density);
    for (let k = 0; k < n; k++){
      const a = rnd() * Math.PI * 2, rr = Math.sqrt(rnd()) * r;
      const h = (1 - rr / r) * R(0.18, 0.34);
      const nrm = V(Math.cos(a) * rr / r * 0.8, 0.9, 0.55 + Math.sin(a) * 0.3);
      flower(d.x + Math.cos(a) * rr, top + 0.04 + h, URN.z + Math.sin(a) * rr * 0.7 + 0.05, nrm, k < n * 0.5 ? mid() * 1.15 : mid() * 0.9);
    }
    for (let k = 0; k < n; k++){
      const a = rnd() * Math.PI * 2;
      leaf(d.x + Math.cos(a) * r * 0.9, top + R(-0.02, 0.12), URN.z + Math.sin(a) * r * 0.6, V(Math.cos(a) * 0.6, 0.7, 0.5), R(1.1, 1.5), a - Math.PI / 2);
    }
    // пара свисающих через край
    for (const sgn of [-1, 1]) if (rnd() < 0.7){
      const px = d.x + sgn * r * 0.95;
      flower(px, top - R(0.08, 0.2), URN.z + 0.18, V(sgn * 0.5, -0.1, 1), mid());
    }
  }

  // ---------- 3. колонны: лиана снизу доверху + «шапка» у капители ----------
  for (const it of info){
    const s = it.s;
    if (!it.col) continue;
    const cx = (s.x0 + s.x1) / 2, rx = (s.x1 - s.x0) / 2, y1 = s.y1;
    const rz = s.kind === "tower" ? Math.min(2.1, rx * 0.84) : (rx <= 1 ? rx : Math.min(1.45, rx * 0.5));
    // у колонн-опор лиан (уровень 2) декоративную лиану держим на левой стороне: правая — игровая лиана
    const hasClimb = vines.some(v => Math.abs(v.x0 - s.x1) < 0.05 || Math.abs(v.x1 - s.x0) < 0.05);
    const top = y1 - (s.kind === "tower" ? 1.3 : 1.3), bot = Math.max(it.cut + 0.4, y1 - 16);
    const surf = (x) => { const u = Math.max(-1, Math.min(1, (x - cx) / rx)); return rz * Math.sqrt(Math.max(0, 1 - u * u)); };
    // цветы не выходят за силуэт колонны: у края они оказались бы перед Ризи, стоящей рядом с колонной
    const lim = Math.max(0.2, rx - 0.38), clampX = x => Math.max(cx - lim, Math.min(cx + lim, x));
    const nOf = x => V((x - cx) / (rx * rx), 0, surf(x) / (rz * rz) || 1).normalize();
    // у опор игровых лиан декоративной лианы нет — иначе не читается, за что можно схватиться (только букет у капители)
    const nV = hasClimb ? 0 : s.kind === "tower" ? 1 : (rx > 1.5 ? 2 : 1);
    for (let vI = 0; vI < nV; vI++){
      const ph = rnd() * 6, amp = rx * (hasClimb ? 0.28 : 0.42);
      const base = hasClimb ? cx - rx * 0.32 : (nV === 2 ? cx + (vI ? 0.45 : -0.45) * rx : (s.kind === "tower" ? (s.x0 < 0 ? cx + rx * 0.35 : cx - rx * 0.35) : cx));
      const xc = y => base + amp * Math.sin(y * 0.8 + ph);
      const pts = [];
      for (let y = top + 0.4; y >= bot - 0.2; y -= 0.45){ const x = clampX(xc(y)); pts.push(V(x, y, surf(x) + 0.04)); }
      stems.push({ pts, r: 0.045 });
      for (let y = top; y >= bot; y -= 0.15){
        const t = (top - y) / Math.max(1, top - bot);
        const thin = t > 0.75 ? 1 - (t - 0.75) / 0.25 * 0.7 : 1;
        const x0 = xc(y);
        if (dens(0.97 * thin)){
          const x = clampX(x0 + R(-0.48, 0.48));
          flower(x, y + R(-0.07, 0.07), surf(x) + R(0.1, 0.2), nOf(x).add(V(0, 0.1, 0)), rnd() < 0.5 ? big() : mid());
        }
        if (dens(thin)){ const x = clampX(x0 + R(-0.6, 0.6)); flower(x, y + R(-0.1, 0.1), surf(x) + R(0.05, 0.1), nOf(x), rnd() < 0.5 ? mid() : small()); }
        if (dens(0.6 * thin)){ const x = clampX(x0 + R(-0.5, 0.5)); flower(x, y + R(-0.1, 0.1), surf(x) + R(0.16, 0.26), nOf(x), mid()); }
        for (let k = 0; k < 2; k++) if (dens(0.9)){ const x = clampX(x0 + R(-0.55, 0.55)); leaf(x, y + R(-0.1, 0.1), surf(x) + 0.04, nOf(x), R(1.1, 1.6)); }
      }
    }
    // шапка у капители и каскад с диска (колонны; у башен — у верхнего карниза)
    const capY = s.kind === "tower" ? y1 - 0.3 : y1 - 0.45;
    const nCap = s.kind === "tower" ? 2 : (hasClimb ? 1 : 2);
    for (let k = 0; k < nCap; k++){
      const x = hasClimb ? cx - rx * 0.4 : cx + (k ? 0.5 : -0.5) * rx * 0.8;
      const z = surf(x) + (s.kind === "keep" ? 0.42 : 0.35);
      cluster(x, capY, z, V(0, 0.3, 1), 0.34, Math.round(7 * density), y1 + 0.05);
      if (rnd() < 0.85) cascade(x + R(-0.2, 0.2), capY - 0.25, z, R(0.9, 2.2), 0.08);
    }
  }

  // ---------- 4. диски-платформы: гроздья на ободе и каскады ----------
  for (const o of level.oneways){
    const cx = (o.x0 + o.x1) / 2, rx = (o.x1 - o.x0) / 2 + 0.1;
    for (const th of [R(0.95, 1.2), R(1.95, 2.2)]){                      // передняя половина обода
      const ax = cx + Math.cos(th) * rx, az = Math.sin(th) * DISC.rz + 0.12;
      const n = V(Math.cos(th) / rx, 0.35, Math.sin(th) / DISC.rz).normalize();
      cluster(ax, o.y - 0.3, az, n, 0.26, Math.round(5 * density), o.y + 0.08);
      if (rnd() < 0.8) cascade(ax + R(-0.1, 0.1), o.y - 0.45, az - 0.05, R(0.5, 1.1), 0.06);
    }
  }

  // ---------- сборка инстансов ----------
  const N = F.length, NL = L.length;
  const headMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, vertexColors: true, roughness: 0.88, metalness: 0,
    sheen: 0.55, sheenRoughness: 0.5, sheenColor: new THREE.Color(0xd8d0ff), envMapIntensity: 0.45,
  });
  const heads = new THREE.InstancedMesh(headGeometry(), headMat, Math.max(1, N));
  heads.name = "flower-heads";
  const centerMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.32, metalness: 0.15 });
  // ночной уровень: цветы «биолюминесцентные» — серединки светятся собственным цветом (вершинный цвет × uGlow)
  if (biolum){
    centerMat.onBeforeCompile = sh => {
      sh.uniforms.uGlow = { value: 1.25 };
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform float uGlow;")
        .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n#ifdef USE_INSTANCING_COLOR\n totalEmissiveRadiance += vColor.rgb * uGlow;\n#endif");
    };
  }
  const centers = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 7, 4), centerMat, Math.max(1, N));
  centers.name = "flower-centers";
  const leafMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0, sheen: 0.5, sheenRoughness: 0.6, sheenColor: new THREE.Color(0xc8f08a), envMapIntensity: 0.4, side: THREE.DoubleSide });
  const leaves = new THREE.InstancedMesh(leafGeometry(), leafMat, Math.max(1, NL));
  leaves.name = "flower-leaves";

  F.forEach((f, i) => {
    _q.setFromUnitVectors(ZAX, f.n); _qs.setFromAxisAngle(ZAX, rnd() * Math.PI * 2); _q.multiply(_qs);
    _s.setScalar(f.s); _m.compose(f.p, _q, _s); heads.setMatrixAt(i, _m);
    _c.set(PETALS[f.c]).offsetHSL(R(-0.015, 0.015), R(-0.03, 0.03), R(-0.06, 0.05)); heads.setColorAt(i, _c);
    _p.copy(f.p).addScaledVector(f.n, 0.04 * f.s); _s.set(0.085 * f.s, 0.085 * f.s, 0.06 * f.s);
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
  if (!N){ _m.makeScale(0, 0, 0); heads.setMatrixAt(0, _m); centers.setMatrixAt(0, _m); }
  if (!NL){ _m.makeScale(0, 0, 0); leaves.setMatrixAt(0, _m); }

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
