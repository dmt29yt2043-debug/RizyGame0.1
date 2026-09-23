// Реквизит уровня: факелы-чекпоинты (как в референсе: лавандовый шест, золотая чаша-трезубец, пламя),
// таблички-подсказки в мире и контактные тени-пятна.
import * as THREE from "three";
import { PAL } from "../config.js";
import { Batch } from "./geo.js";
import { signTexture } from "./tex.js";

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler();

// ---------- ФАКЕЛЫ ----------
export function createTorches(level, grounds, { glowTex, bloom = true }){
  const group = new THREE.Group(); group.name = "torches";
  const N = level.torches.length;
  // стойка: шест + золотые кольца + чаша с тремя зубцами (одна геометрия на все факелы)
  const b = new Batch();
  level.torches.forEach((tc, i) => {
    const x = tc.x, y = grounds[i], z = -0.55;
    const cyl = (r0, r1, h, yy, c, seg = 8) => { const g = new THREE.CylinderGeometry(r1, r0, h, seg); b.add(g, new THREE.Matrix4().makeTranslation(x, y + yy + h / 2, z), c); g.dispose(); };
    cyl(0.2, 0.16, 0.12, 0, 0x9c89c9);
    cyl(0.07, 0.06, 1.35, 0.1, PAL.lav);
    cyl(0.1, 0.1, 0.06, 0.55, PAL.gold);
    cyl(0.1, 0.1, 0.06, 1.2, PAL.gold);
    cyl(0.1, 0.24, 0.16, 1.42, PAL.gold, 10);
    for (const a of [-0.5, 0, 0.5]){
      const g = new THREE.BoxGeometry(0.05, 0.3, 0.05);
      b.add(g, new THREE.Matrix4().compose(new THREE.Vector3(x + Math.sin(a) * 0.24, y + 1.68, z + (a === 0 ? -0.18 : 0.06)),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(a === 0 ? -0.35 : 0.2, 0, -a * 0.9)), new THREE.Vector3(1, 1, 1)), PAL.gold);
      g.dispose();
    }
  });
  const stands = new THREE.Mesh(b.build(), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  group.add(stands);

  // пламя: капля (внешняя тёплая + внутренняя белая), инстансы
  const drop = new THREE.SphereGeometry(0.2, 12, 10);
  drop.translate(0, 0.2, 0);
  const pos = drop.attributes.position;
  for (let i = 0; i < pos.count; i++){
    const y = pos.getY(i), k = Math.max(0, (y - 0.15) / 0.25);
    pos.setX(i, pos.getX(i) * (1 - 0.75 * k)); pos.setZ(i, pos.getZ(i) * (1 - 0.75 * k)); pos.setY(i, y + k * 0.28);
  }
  drop.computeVertexNormals();
  const outer = new THREE.InstancedMesh(drop, new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffc24a).multiplyScalar(bloom ? 1.8 : 1.1), toneMapped: false }), N);
  const inner = new THREE.InstancedMesh(drop, new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff6c8).multiplyScalar(bloom ? 2.2 : 1.2), toneMapped: false }), N);
  const glow = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: glowTex, color: 0xffd27a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.8, toneMapped: false }), N);
  for (const m of [outer, inner, glow]){ m.frustumCulled = false; group.add(m); }
  glow.renderOrder = 5;

  const state = level.torches.map(t => ({ lit: !!t.lit, t: t.lit ? -10 : -1 }));
  return {
    group, state,
    reset(){ level.torches.forEach((t, i) => { state[i].lit = !!t.lit; state[i].t = t.lit ? -10 : -1; }); },
    update(t){
      for (let i = 0; i < N; i++){
        const tc = level.torches[i], s = state[i];
        const x = tc.x, y = grounds[i] + 1.6, z = -0.55;
        let k = s.lit ? Math.min(1, (t - s.t) / 0.35) : 0;
        // вспышка при зажигании
        const pop = s.lit ? 1 + 0.6 * Math.max(0, 1 - (t - s.t) / 0.5) : 1;
        const fl = 1 + 0.12 * Math.sin(t * 17 + i * 3) + 0.08 * Math.sin(t * 29 + i);
        const sc = s.lit ? (0.25 + 0.75 * k) * pop : 0.35;
        _e.set(0, 0, 0.08 * Math.sin(t * 9 + i)); _q.setFromEuler(_e);
        _p.set(x, y, z); _s.set(sc * (s.lit ? 1 : 0.5), sc * fl * (s.lit ? 1.15 : 0.35), sc * (s.lit ? 1 : 0.5));
        _m.compose(_p, _q, _s); outer.setMatrixAt(i, _m);
        _s.multiplyScalar(0.55); _p.y += 0.02; _m.compose(_p, _q, _s); inner.setMatrixAt(i, _m);
        _p.set(x, y + 0.28, z - 0.05); _q.identity();
        const g = s.lit ? 2.6 * sc * (0.95 + 0.05 * fl) : 0.6; _s.set(g, g, 1);
        _m.compose(_p, _q, _s); glow.setMatrixAt(i, _m);
      }
      outer.instanceMatrix.needsUpdate = inner.instanceMatrix.needsUpdate = glow.instanceMatrix.needsUpdate = true;
    },
  };
}

// ---------- ТАБЛИЧКИ ----------
export function createSigns(level, grounds, renderer){
  const group = new THREE.Group(); group.name = "signs";
  level.signs.forEach((sg, i) => {
    const { texture, aspect } = signTexture(sg.lines, renderer);
    const h = 1.45, w = h * aspect;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: texture, transparent: true, alphaTest: 0.02, toneMapped: false }));
    mesh.position.set(sg.x, grounds[i] + h / 2 - 0.02, -0.8);
    group.add(mesh);
  });
  return group;
}

// ---------- КОНТАКТНЫЕ ТЕНИ ----------
// Плоские пятна на верхах платформ; размер и прозрачность — по высоте над опорой.
export function createBlobs(count, tex){
  const mat = new THREE.MeshBasicMaterial({ map: tex, color: 0xffffff, transparent: true, depthWrite: false, opacity: 1, toneMapped: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  // прозрачность — через цвет инстанса (умножается на карту), смешивание «умножением» мягче обычного
  mat.blending = THREE.CustomBlending;
  mat.blendEquation = THREE.AddEquation;
  mat.blendSrc = THREE.ZeroFactor;
  mat.blendDst = THREE.OneMinusSrcColorFactor;
  const geo = new THREE.PlaneGeometry(1, 1); geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  const col = new THREE.Color();
  return {
    mesh,
    // i, x, groundY, heightAbove, radius, strength 0..1
    set(i, x, gy, h, r, k = 1){
      if (!Number.isFinite(gy) || h > 7){ _m.makeScale(0, 0, 0); mesh.setMatrixAt(i, _m); return; }
      const f = Math.max(0, 1 - h / 7);
      const sc = r * (0.55 + 0.45 * f) * 2;
      // камера смотрит почти вдоль пола — пятно делаем глубже по z, чтобы оно читалось
      _p.set(x, gy + 0.012, 0.05); _q.identity(); _s.set(sc, 1, sc * 1.05);
      _m.compose(_p, _q, _s); mesh.setMatrixAt(i, _m);
      // цвет = доля «затемнения» (blendDst = 1 − src): тёплая лавандовая тень
      const a = 0.62 * f * k;
      col.setRGB(a * 0.62, a * 0.74, a * 0.5); mesh.setColorAt(i, col);
    },
    hide(i){ _m.makeScale(0, 0, 0); mesh.setMatrixAt(i, _m); },
    commit(){ mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true; },
  };
}
