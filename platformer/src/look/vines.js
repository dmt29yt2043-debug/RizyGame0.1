// Лианы для лазания (уровень 2): густая цветочная лиана в том же языке, что декоративные цветы
// (src/look/flowers.js — войлочные головки, листья, стебли), но заметно толще и ярче обычных декоративных,
// с лёгким свечением серединок и редкими искорками, чтобы игрок сразу читал «за это можно схватиться».
// Гейм-зона хвата (level.vines) держит src/physics.js; этот модуль — только внешний вид, по тем же зонам.
import * as THREE from "three";
import { PAL } from "../config.js";
import { Batch } from "./geo.js";
import { makeRng } from "./tex.js";

const ZAX = new THREE.Vector3(0, 0, 1);
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _qs = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler();
const _c = new THREE.Color();
// палитра осознанно уходит от синего (кожа/джинсы Ризи — синие) — героиня не должна сливаться с лианой,
// пока лезет; акцент на лайм/бирюзу/фиолетовый вместо «героиньего» синего
const PETALS = [PAL.purple, 0x5fc9a8, PAL.lime];
const CENTERS = [0xeaffb0, 0x9ff0d8, 0xe0c8ff];
const LEAVES = [0x4c7a35, 0x3f6a55, 0x5f8a6a];

function lens(ws){ const g = new THREE.SphereGeometry(1, ws, 2); g.rotateX(Math.PI / 2); return g; }
function headGeometry(){
  const b = new Batch();
  const k = new THREE.Color();
  for (let i = 0; i < 5; i++){
    const g = lens(8);
    const M = new THREE.Matrix4().makeRotationZ(i / 5 * Math.PI * 2 + 0.3)
      .multiply(new THREE.Matrix4().makeRotationY(-0.32))
      .multiply(new THREE.Matrix4().makeTranslation(0.13, 0, 0))
      .multiply(new THREE.Matrix4().makeScale(0.155, 0.105, 0.04));
    b.add(g, M, v => k.setScalar(0.62 + 0.45 * Math.min(1, Math.hypot(v.x, v.y) / 0.28)));
    g.dispose();
  }
  return b.build();
}
function leafGeometry(){
  const g = lens(6);
  g.scale(0.07, 0.21, 0.024);
  g.translate(0, 0.2, 0);
  g.rotateX(0.3);
  return g;
}

// level.vines: [{id,x0,x1,y0,y1,side}] — та же зона, что использует физика хвата.
export function createClimbVines(level, { glowTex, bloom = true, biolum = true } = {}){
  const group = new THREE.Group(); group.name = "climb-vines";
  const vines = level.vines || [];
  if (!vines.length) return { group, dispose(){} };

  const rnd = makeRng(4242);
  const R = (a, b) => a + (b - a) * rnd();
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const F = [], L = [], stems = [];
  const jit = (n, k) => { n.x += (rnd() - 0.5) * k; n.y += (rnd() - 0.5) * k; return n.normalize(); };
  const pick = () => { const r = rnd(); return r < 0.4 ? 0 : r < 0.75 ? 1 : 2; };
  const flower = (x, y, z, n, s) => F.push({ p: V(x, y, z), n: jit(n, 0.4), s, c: pick() });
  const leaf = (x, y, z, n, s, spin = rnd() * Math.PI * 2) => L.push({ p: V(x, y, z), n: jit(n, 0.4), s, spin });

  // важно: Ризи рендерится в плоскости z=0 (см. main.js). Пока героиня лезет, она стоит ровно на x = cx
  // всю дорогу — если густо посадить цветы перед ней (z > 0), она пропадёт под ними на весь подъём.
  // Поэтому основная масса лианы — за спиной (z < 0, «на стене»), и только редкие цветы выступают вперёд
  // по бокам (offset от cx), огибая силуэт, как у декоративных лиан, но не закрывая героиню.
  const BACK = -0.24, FRONT = 0.1;
  for (const v of vines){
    const cx = (v.x0 + v.x1) / 2, side = v.side || 1;
    // толстый плетёный «канат» стеблей вдоль всей зоны, за спиной героини (несколько прядей — толще декоративных)
    for (const off of [-0.16, 0, 0.16]){
      const pts = [];
      const ph = rnd() * 6;
      for (let y = v.y1 + 0.4; y >= v.y0 - 0.3; y -= 0.4) pts.push(V(cx + off + 0.05 * Math.sin(y * 1.3 + ph), y, BACK + 0.05 * Math.sin(y * 0.8)));
      stems.push({ pts, r: 0.05 });
    }
    // головки и листья погуще, чем у декоративных лиан, по всей высоте зоны — основная масса за спиной;
    // прямо по центру (где корпус героини) чуть реже и дальше — силуэт читается на фоне лианы, а не в ней
    const step = 0.18;
    for (let y = v.y1 + 0.3; y >= v.y0 - 0.2; y -= step){
      const core = 0.24;                                    // полоса вдоль cx — держим прорежённой
      let x = cx + R(-0.36, 0.36), z = BACK + R(-0.14, 0.02);
      if (Math.abs(x - cx) < core) z -= 0.16;                // в самой полосе — ещё дальше
      flower(x, y + R(-0.05, 0.05), z, V(side * 0.5, 0.1, 1), R(1.0, 1.4));
      if (rnd() < 0.8){
        let x2 = cx + R(-0.36, 0.36);
        flower(x2, y + R(-0.08, 0.08), (Math.abs(x2 - cx) < core ? BACK - 0.16 : BACK - 0.06), V(-side * 0.3, 0.1, 1), R(0.6, 0.9));
      }
      for (let k = 0; k < 2; k++) if (rnd() < 0.85) leaf(cx + R(-0.34, 0.34), y + R(-0.1, 0.1), z + 0.03, V(0, 0, 1), R(1.0, 1.5));
      // редкие цветы огибают силуэт спереди, но далеко по бокам (героиня в лазании — руки в стороны,
      // держим отступ с запасом) и совсем не в её полосе, чтобы не закрывать позу
      if (rnd() < 0.3) flower(cx + (rnd() < 0.5 ? -1 : 1) * R(0.62, 0.85), y + R(-0.1, 0.1), FRONT + R(-0.03, 0.05), V(0, 0.1, 1), R(0.6, 0.95));
    }
  }

  const N = F.length, NL = L.length;
  const headMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, vertexColors: true, roughness: 0.85, metalness: 0,
    sheen: 0.85, sheenRoughness: 0.4, sheenColor: new THREE.Color(0xdff0ff), envMapIntensity: 0.5,
  });
  const heads = new THREE.InstancedMesh(headGeometry(), headMat, Math.max(1, N));
  heads.name = "vine-heads";
  const centerMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.28, metalness: 0.1 });
  const glowBase = bloom ? 1.7 : 1.1;
  if (biolum){
    centerMat.onBeforeCompile = sh => {
      sh.uniforms.uGlow = { value: glowBase };
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform float uGlow;")
        .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n#ifdef USE_INSTANCING_COLOR\n totalEmissiveRadiance += vColor.rgb * uGlow;\n#endif");
      centerMat.userData.shader = sh;                    // для мерцания в update() — без лишнего draw call'а
    };
  }
  const centers = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 6, 3), centerMat, Math.max(1, N));
  centers.name = "vine-centers";
  const leafMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0, sheen: 0.5, sheenRoughness: 0.55, sheenColor: new THREE.Color(0xa8e0c8), envMapIntensity: 0.4, side: THREE.DoubleSide });
  const leaves = new THREE.InstancedMesh(leafGeometry(), leafMat, Math.max(1, NL));
  leaves.name = "vine-leaves";

  F.forEach((f, i) => {
    _q.setFromUnitVectors(ZAX, f.n); _qs.setFromAxisAngle(ZAX, rnd() * Math.PI * 2); _q.multiply(_qs);
    _s.setScalar(f.s); _m.compose(f.p, _q, _s); heads.setMatrixAt(i, _m);
    _c.set(PETALS[f.c]).offsetHSL(R(-0.01, 0.01), 0, R(-0.03, 0.05)); heads.setColorAt(i, _c);
    _p.copy(f.p).addScaledVector(f.n, 0.04 * f.s); _s.setScalar(0.09 * f.s);
    _m.compose(_p, _q, _s); centers.setMatrixAt(i, _m);
    _c.set(CENTERS[f.c]); centers.setColorAt(i, _c);
  });
  L.forEach((l, i) => {
    _q.setFromUnitVectors(ZAX, l.n); _qs.setFromAxisAngle(ZAX, l.spin); _q.multiply(_qs);
    _s.setScalar(l.s); _m.compose(l.p, _q, _s); leaves.setMatrixAt(i, _m);
    _c.set(LEAVES[Math.floor(rnd() * LEAVES.length)]).offsetHSL(0, 0, R(-0.04, 0.04)); leaves.setColorAt(i, _c);
  });
  for (const m of [heads, centers, leaves]){
    m.frustumCulled = false;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }

  const sb = new Batch();
  for (const st of stems){
    if (st.pts.length < 2) continue;
    const curve = new THREE.CatmullRomCurve3(st.pts);
    const g = new THREE.TubeGeometry(curve, Math.max(4, st.pts.length * 2), st.r, 5, false);
    sb.add(g, new THREE.Matrix4(), 0x3f6a4a);
    g.dispose();
  }
  const stemMesh = new THREE.Mesh(sb.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0 }));
  stemMesh.name = "vine-stems"; stemMesh.matrixAutoUpdate = false; stemMesh.updateMatrix();

  group.add(stemMesh, leaves, heads, centers);

  return {
    group, count: N,
    // «искорки» — не отдельный InstancedMesh (на бюджете draw calls ≤150 на med он был лишним), а мерцание
    // самого biolum-свечения серединок цветов: один uniform на общий материал, без новых draw call'ов
    update(t){
      const sh = centerMat.userData.shader;
      if (sh) sh.uniforms.uGlow.value = glowBase * (0.82 + 0.18 * Math.sin(t * 2.6)) + 0.15 * Math.max(0, Math.sin(t * 5.3));
    },
    dispose(){
      group.traverse(o => {
        if (!o.isMesh) return;
        o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats){ if (m.map && m.map !== glowTex) m.map.dispose(); m.dispose(); }
      });
    },
  };
}
