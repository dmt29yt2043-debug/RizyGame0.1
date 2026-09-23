// Гасители из книги: тёмные войлочные помпоны с одним светящимся красным глазом и крылышками-пропеллером.
// Все враги — 5 инстансных мешей (тело, пух, глаз, блик, пропеллер) = 5 draw call'ов на всех.
// При «гашении» — сплющивание и исчезновение; клочки войлока и искры делает fx.
import * as THREE from "three";
import { PAL } from "../config.js";
import { makeRng } from "./tex.js";

export const ENEMY_R = 0.46;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler();

// помпон: икосфера с «войлочным» шумом по вершинам
function pompomGeometry(r, seed){
  const g = new THREE.IcosahedronGeometry(r, 3);
  const rnd = makeRng(seed);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  // одинаковые позиции → одинаковый шум (без трещин)
  const cache = new Map();
  for (let i = 0; i < pos.count; i++){
    v.fromBufferAttribute(pos, i);
    const key = `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
    let k = cache.get(key);
    if (k === undefined){ k = 1 + (rnd() - 0.5) * 0.2; cache.set(key, k); }
    v.multiplyScalar(k);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

// пропеллер: ножка + две лопасти (одна геометрия)
function propGeometry(){
  const parts = [];
  const stem = new THREE.CylinderGeometry(0.035, 0.05, 0.22, 6); stem.translate(0, 0.11, 0); parts.push(stem);
  const hub = new THREE.SphereGeometry(0.06, 8, 6); hub.translate(0, 0.23, 0); parts.push(hub);
  for (const s of [-1, 1]){
    const b = new THREE.SphereGeometry(0.1, 10, 6); b.scale(3.0, 0.26, 1.1); b.rotateY(s > 0 ? 0.12 : -0.12); b.translate(s * 0.27, 0.24, 0); parts.push(b);
  }
  const pos = [], nor = [];
  for (const p of parts){
    const q = p.index ? p.toNonIndexed() : p;
    pos.push(...q.attributes.position.array); nor.push(...q.attributes.normal.array);
    p.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  return g;
}

export function createEnemies(level, { feltTex, glowTex, bloom = true }){
  const group = new THREE.Group(); group.name = "gasiteli";
  const N = level.enemies.length;
  const inst = (geo, mat, n = N) => { const m = new THREE.InstancedMesh(geo, mat, n); m.frustumCulled = false; group.add(m); return m; };

  const bodyMat = new THREE.MeshStandardMaterial({ color: PAL.gasBody, roughness: 1, metalness: 0, map: feltTex, bumpMap: feltTex, bumpScale: 3 });
  const body = inst(pompomGeometry(ENEMY_R, 3), bodyMat);
  // «пух» — чуть больший полупрозрачный слой, даёт мягкий войлочный контур
  const fuzzMat = new THREE.MeshStandardMaterial({ color: 0x7a6ca3, roughness: 1, transparent: true, opacity: 0.4, depthWrite: false, map: feltTex });
  const fuzz = inst(pompomGeometry(ENEMY_R * 1.1, 9), fuzzMat);
  // глаз: белок-ободок тёмный, радужка красная светится
  const eyeMat = new THREE.MeshStandardMaterial({ color: PAL.gasEye, emissive: new THREE.Color(PAL.gasEye), emissiveIntensity: bloom ? 2.6 : 1.4, roughness: 0.3 });
  const eye = inst(new THREE.SphereGeometry(0.17, 16, 12), eyeMat);
  const hiMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  const hi = inst(new THREE.SphereGeometry(0.045, 8, 6), hiMat);
  const propMat = new THREE.MeshStandardMaterial({ color: 0x9a8cc4, roughness: 0.7 });
  const prop = inst(propGeometry(), propMat);
  // красный отсвет глаза
  const glow = inst(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: glowTex, color: 0xff3048, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.4, toneMapped: false }));
  glow.renderOrder = 5;

  const state = level.enemies.map(() => ({ alive: true, deadT: -1, x: 0, y: 0, dir: 1, face: 1 }));

  function set(mesh, i, x, y, z, rx, ry, rz, sx, sy, sz){
    _p.set(x, y, z); _e.set(rx, ry, rz); _q.setFromEuler(_e); _s.set(sx, sy, sz);
    _m.compose(_p, _q, _s); mesh.setMatrixAt(i, _m);
  }
  function hide(i){ _m.makeScale(0, 0, 0); for (const m of [body, fuzz, eye, hi, prop, glow]) m.setMatrixAt(i, _m); }

  return {
    group, state,
    reset(){ for (const s of state){ s.alive = true; s.deadT = -1; } },
    // positions: [{x,y,dir}] из логики; t — время мира
    update(t, positions){
      for (let i = 0; i < N; i++){
        const s = state[i], P = positions[i];
        s.face += ((P.dir) - s.face) * 0.12;
        let sx = 1, sy = 1, y = P.y, x = P.x;
        if (!s.alive){
          const k = (t - s.deadT) / 0.32;
          if (k >= 1){ hide(i); continue; }
          sx = 1 + 0.9 * k; sy = Math.max(0.05, 1 - 0.95 * k); y = P.y - ENEMY_R * (1 - sy);
          x = s.x; y = s.y - ENEMY_R * (1 - sy);
        } else { s.x = P.x; s.y = P.y; }
        const wob = Math.sin(t * 7 + i) * 0.05;
        const turn = s.face * 0.5;                     // глаз смотрит в сторону полёта, но всегда к камере
        const tilt = -s.face * 0.12 + wob;
        set(body, i, x, y, 0, 0, t * 0.3 + i, tilt, sx, sy * (1 + wob * 0.6), sx);
        set(fuzz, i, x, y, 0, 0.3, -t * 0.2 + i, tilt, sx, sy * (1 + wob * 0.6), sx);
        const ex = x + Math.sin(turn) * ENEMY_R * 0.8 * sx, ez = Math.cos(turn) * ENEMY_R * 0.78;
        const ey = y + 0.05 * sy;
        set(eye, i, ex, ey, ez, 0, 0, 0, sx, sy, 1);
        set(hi, i, ex + 0.05 * s.face + 0.02, ey + 0.07 * sy, ez + 0.14, 0, 0, 0, sx, sy, 1);
        set(glow, i, ex, ey, ez + 0.02, 0, 0, 0, 0.85 * sx, 0.85 * sy, 1);
        set(prop, i, x, y + ENEMY_R * 0.88 * sy, 0, 0, t * (s.alive ? 26 : 4) + i, tilt, sx, sy, sx);
      }
      for (const m of [body, fuzz, eye, hi, prop, glow]) m.instanceMatrix.needsUpdate = true;
    },
  };
}
