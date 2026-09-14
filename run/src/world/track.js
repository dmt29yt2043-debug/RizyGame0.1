// world-kit: «жёлоб» трассы — поверхность 9.2 м, скруглённые бордюры в полоску, снежные валы, снежное поле,
// ледяные шипы-метки каждые 4 м. Полосы неподвижны вокруг игрока (z +12 … −112, шаг 1 м — для изгиба),
// а движение даёт прокрутка текстур/шейдеров по G.dist. Шипы — InstancedMesh со сдвигом dist mod 4.
import * as THREE from "three";
import { sweep } from "./util.js";

export const TRACK = { half: 4.6, z0: 12, z1: -112 };

// высота вала над землёй по |x| (декор ставится на склон)
export function bankHeight(ax){
  if (ax < 5.0) return 0;
  if (ax < 6.5) return 0.86 * Math.sin((ax - 5.0) / 1.5 * Math.PI / 2);
  if (ax < 9.6) return 0.86 * (1 - (ax - 6.5) / 3.1) ** 1.6;
  return 0;
}

function trackGeo(){
  const nx = 10, z0 = TRACK.z0, z1 = TRACK.z1, rows = z0 - z1 + 1;
  const P = [], N = [], UV = [], I = [];
  for (let r = 0; r < rows; r++){
    const z = z0 - r;
    for (let i = 0; i <= nx; i++){
      const u = i / nx, x = -TRACK.half + u * TRACK.half * 2;
      P.push(x, 0.02 * (1 - (x / TRACK.half) ** 2), z); N.push(0, 1, 0); UV.push(u, -z);
    }
  }
  for (let r = 0; r < rows - 1; r++) for (let i = 0; i < nx; i++){
    const a = r * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
    I.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(UV, 2));
  g.setIndex(I); g.computeBoundingSphere();
  return g;
}

function mirrorMerge(profile){
  // правый профиль + зеркальный левый (порядок точек разворачиваем — нормали остаются наружу)
  const R = sweep(profile, TRACK.z0, TRACK.z1, 1);
  const Lp = profile.slice().reverse().map(p => [-p[0], p[1]]);
  const Lg = sweep(Lp, TRACK.z0, TRACK.z1, 1);
  const g = new THREE.BufferGeometry();
  const cat = (a, b) => { const o = new Float32Array(a.length + b.length); o.set(a); o.set(b, a.length); return o; };
  g.setAttribute("position", new THREE.BufferAttribute(cat(R.attributes.position.array, Lg.attributes.position.array), 3));
  g.setAttribute("normal", new THREE.BufferAttribute(cat(R.attributes.normal.array, Lg.attributes.normal.array), 3));
  g.setAttribute("uv", new THREE.BufferAttribute(cat(R.attributes.uv.array, Lg.attributes.uv.array), 2));
  const n = R.attributes.position.count, ia = R.index.array, ib = Lg.index.array;
  const idx = new Uint32Array(ia.length + ib.length); idx.set(ia); for (let i = 0; i < ib.length; i++) idx[ia.length + i] = ib[i] + n;
  g.setIndex(new THREE.BufferAttribute(idx, 1)); g.computeBoundingSphere();
  R.dispose(); Lg.dispose();
  return g;
}

function curbGeo(){
  // бордюр 0.42 × 0.28 м, фаска 0.08: обход снаружи-снизу → вверх → по верху к трассе → вниз
  const x0 = 4.58, x1 = 5.0, h = 0.28, c = 0.08, prof = [];
  prof.push([x1 + 0.005, -0.03], [x1, h - c]);
  for (let i = 1; i <= 3; i++){ const a = i / 4 * Math.PI / 2; prof.push([x1 - c + Math.cos(a) * c, h - c + Math.sin(a) * c]); }
  prof.push([x1 - c, h], [x0 + c, h]);
  for (let i = 1; i <= 3; i++){ const a = Math.PI / 2 + i / 4 * Math.PI / 2; prof.push([x0 + c + Math.cos(a) * c, h - c + Math.sin(a) * c]); }
  prof.push([x0, h - c], [x0 - 0.005, -0.03]);
  return mirrorMerge(prof);
}

function bankGeo(){
  const prof = [];
  for (let x = 11.5; x >= 4.95; x -= 0.35) prof.push([x, x > 9.6 ? -0.04 : bankHeight(x)]);
  prof.push([4.95, 0.0], [4.9, -0.1]);
  return mirrorMerge(prof);
}

function groundGeo(){
  const xs = [-140, -80, -48, -30, -20, -14, -10.5, -8.5, -7, -6, -5.2, 0, 5.2, 6, 7, 8.5, 10.5, 14, 20, 30, 48, 80, 140];
  const z0 = TRACK.z0, z1 = TRACK.z1 - 14, step = 2, rows = Math.round((z0 - z1) / step) + 1;
  const P = [], N = [], UV = [], I = [];
  for (let r = 0; r < rows; r++){
    const z = z0 - r * step;
    for (const x of xs){ P.push(x, -0.03, z); N.push(0, 1, 0); UV.push(x, -z); }
  }
  const nx = xs.length;
  for (let r = 0; r < rows - 1; r++) for (let i = 0; i < nx - 1; i++){
    const a = r * nx + i, b = a + 1, c = a + nx, d = c + 1;
    I.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(UV, 2));
  g.setIndex(I); g.computeBoundingSphere();
  return g;
}

export function createTrack(mats){
  const group = new THREE.Group(); group.name = "world:track";
  const mk = (geo, mat, name, cast) => { const m = new THREE.Mesh(geo, mat); m.name = name; m.receiveShadow = true; m.castShadow = !!cast; group.add(m); return m; };
  const track = mk(trackGeo(), mats.track, "world:trackSurface");
  const curbs = mk(curbGeo(), mats.curb, "world:curbs");
  const banks = mk(bankGeo(), mats.bank, "world:banks");
  const ground = mk(groundGeo(), mats.ground, "world:ground");
  track.renderOrder = 1;

  // шипы-метки: на линиях между полосами, каждые 4 м
  const sg = new THREE.SphereGeometry(0.09, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2); sg.scale(1, 0.7, 1.35);
  const K0 = -3, K1 = 28, cnt = (K1 - K0 + 1) * 2;
  const studs = new THREE.InstancedMesh(sg, mats.stud, cnt);
  const m4 = new THREE.Matrix4();
  let i = 0;
  for (let k = K0; k <= K1; k++) for (const x of [-1.275, 1.275]){ m4.makeTranslation(x, 0.0, -k * 4); studs.setMatrixAt(i++, m4); }
  studs.frustumCulled = false; studs.receiveShadow = true; studs.name = "world:studs";
  group.add(studs);

  function update(dist){
    studs.position.z = dist % 4;
  }
  function dispose(){ for (const m of [track, curbs, banks, ground, studs]) m.geometry.dispose(); }
  return { group, track, curbs, banks, ground, studs, update, dispose };
}
