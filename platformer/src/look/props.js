// Реквизит уровня: чекпоинты — лаймовые флажки на золотых древках (при активации разворачиваются
// и поднимаются по древку), таблички-подсказки в мире и контактные тени-пятна.
import * as THREE from "three";
import { PAL } from "../config.js";
import { Batch } from "./geo.js";
import { signTexture } from "./tex.js";

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler();

// ---------- ЧЕКПОИНТЫ: ФЛАЖКИ ----------
export function createTorches(level, grounds, { glowTex, bloom = true }){
  const group = new THREE.Group(); group.name = "checkpoints";
  const N = level.torches.length;
  const poleH = 1.7;

  // золотые древки + шарик-навершие + круглое основание — одна статичная геометрия на все чекпоинты
  const b = new Batch();
  level.torches.forEach((tc, i) => {
    const x = tc.x, y = grounds[i], z = -0.55;
    const pole = new THREE.CylinderGeometry(0.05, 0.062, poleH, 8);
    b.add(pole, new THREE.Matrix4().makeTranslation(x, y + poleH / 2, z), PAL.gold);
    pole.dispose();
    const ball = new THREE.SphereGeometry(0.09, 10, 8);
    b.add(ball, new THREE.Matrix4().makeTranslation(x, y + poleH + 0.07, z), PAL.gold);
    ball.dispose();
    const base = new THREE.CylinderGeometry(0.17, 0.21, 0.09, 10);
    b.add(base, new THREE.Matrix4().makeTranslation(x, y + 0.045, z), PAL.gold);
    base.dispose();
  });
  const poles = new THREE.Mesh(b.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.28, metalness: 1 }));
  group.add(poles);

  // полотнище — треугольный флаг с вырезом у края; инстансинг, каждое разворачивается по X (0 → 1)
  const sh = new THREE.Shape();
  sh.moveTo(0, 0); sh.lineTo(0.86, -0.16); sh.lineTo(0.78, -0.42); sh.lineTo(0, -0.5); sh.closePath();
  const flagGeo = new THREE.ShapeGeometry(sh, 3);
  const flagMat = new THREE.MeshStandardMaterial({
    // тёплый закатный свет уводит лайм в жёлтый — альбедо чуть зеленее, плюс собственное свечение лайма
    color: 0xb4e63a, roughness: 0.8, metalness: 0, side: THREE.DoubleSide,
    emissive: new THREE.Color(PAL.lime).multiplyScalar(bloom ? 0.3 : 0.18),
  });
  const flags = new THREE.InstancedMesh(flagGeo, flagMat, N);
  flags.frustumCulled = false;
  group.add(flags);

  const glow = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
    map: glowTex, color: PAL.lime, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.75, toneMapped: false,
  }), N);
  glow.frustumCulled = false; glow.renderOrder = 5;
  group.add(glow);

  const state = level.torches.map(t => ({ lit: !!t.lit, t: t.lit ? -10 : -1 }));
  return {
    group, state,
    reset(){ level.torches.forEach((t, i) => { state[i].lit = !!t.lit; state[i].t = t.lit ? -10 : -1; }); },
    update(t){
      for (let i = 0; i < N; i++){
        const tc = level.torches[i], s = state[i];
        const x = tc.x, y = grounds[i], z = -0.55;
        const k = s.lit ? Math.min(1, (t - s.t) / 0.45) : 0;
        const ease = k * k * (3 - 2 * k);                                  // сглаженное «разворачивание»
        const pop = s.lit ? 1 + 0.22 * Math.max(0, 1 - (t - s.t) / 0.5) : 1;
        const wave = s.lit ? 1 + 0.05 * Math.sin(t * 6 + i * 2) : 1;
        const fy = y + poleH * (0.28 + 0.58 * ease);                       // поднимается по древку
        _e.set(0, 0, 0.05 * Math.sin(t * 5 + i)); _q.setFromEuler(_e);
        _p.set(x, fy, z - 0.02); _s.set(Math.max(0.015, ease) * pop * wave, pop, 1);
        _m.compose(_p, _q, _s); flags.setMatrixAt(i, _m);
        _p.set(x + 0.12, fy - 0.06, z); const g = s.lit ? 1.25 * ease : 0.001; _s.set(g, g, 1); _q.identity();
        _m.compose(_p, _q, _s); glow.setMatrixAt(i, _m);
      }
      flags.instanceMatrix.needsUpdate = true; glow.instanceMatrix.needsUpdate = true;
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
  // альфу кадра не трогаем: канвас three всегда с альфа-каналом, и «1 − src» по альфе обнуляла её —
  // под пятном просвечивал фон страницы (белый прямоугольник под ногами на low)
  mat.blendSrcAlpha = THREE.ZeroFactor;
  mat.blendDstAlpha = THREE.OneFactor;
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
