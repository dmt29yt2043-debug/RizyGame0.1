// Кристаллы: малые (инстансинг, один draw call + ореолы), звёздные (гранёные звёзды) и финальное
// Кристальное сердце на пьедестале. Светятся (emissive = цвет инстанса), вращаются, покачиваются;
// при сборе — «выстрел» вверх и схлопывание (частицы делает fx).
import * as THREE from "three";
import { PAL } from "../config.js";
import { Batch } from "./geo.js";

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler();
const COLORS = [PAL.crystalA, PAL.crystalB, PAL.crystalC];

// вытянутая гранёная бипирамида: 6 граней по кругу, верх длиннее низа
function gemGeometry(r = 0.2, hTop = 0.4, hBot = 0.26, n = 6){
  const pos = [];
  const ring = [];
  for (let i = 0; i < n; i++){ const a = i / n * Math.PI * 2; ring.push([Math.cos(a) * r, 0, Math.sin(a) * r]); }
  const T = [0, hTop, 0], Bm = [0, -hBot, 0];
  for (let i = 0; i < n; i++){
    const a = ring[i], b = ring[(i + 1) % n];
    pos.push(...T, ...b, ...a);
    pos.push(...Bm, ...a, ...b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

// гранёная пятиконечная звезда (объёмная: центр выдвинут вперёд и назад)
function starGeometry(R = 0.55, r = 0.24, d = 0.2){
  const pos = [];
  const pts = [];
  for (let i = 0; i < 10; i++){
    const a = Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r : R;
    pts.push([Math.cos(a) * rr, Math.sin(a) * rr, 0]);
  }
  const F = [0, 0, d], Bk = [0, 0, -d];
  for (let i = 0; i < 10; i++){
    const a = pts[i], b = pts[(i + 1) % 10];
    pos.push(...F, ...a, ...b);
    pos.push(...Bk, ...b, ...a);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

// материал: цвет инстанса идёт и в альбедо, и в свечение
function glowMaterial(glow, env){
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.18, metalness: 0.05, flatShading: true, envMap: env || null, envMapIntensity: 0.9 });
  m.onBeforeCompile = sh => {
    sh.uniforms.uGlow = { value: glow };
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uGlow;")
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n#ifdef USE_INSTANCING_COLOR\n totalEmissiveRadiance += vColor.rgb * uGlow;\n#endif");
    m.userData.shader = sh;
  };
  return m;
}

// ореолы: инстансы плоского квадрата с мягким пятном, аддитивно
function haloMesh(count, tex, opacity){
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity, toneMapped: false });
  const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, count);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  return mesh;
}

export function createCrystals(level, { glowTex, env, halos = 0.6, bloom = true }){
  const group = new THREE.Group(); group.name = "crystals";
  const N = level.crystals.length;
  const gem = new THREE.InstancedMesh(gemGeometry(), glowMaterial(bloom ? 1.6 : 0.9, env), N);
  gem.name = "gems";
  gem.frustumCulled = false;
  const col = new THREE.Color();
  level.crystals.forEach((c, i) => { col.set(COLORS[c.c % 3]); gem.setColorAt(i, col); });
  group.add(gem);
  const halo = haloMesh(N + 3, glowTex, halos);
  level.crystals.forEach((c, i) => { col.set(COLORS[c.c % 3]); halo.setColorAt(i, col); });
  group.add(halo);

  // звёздные
  const NS = level.stars.length;
  const star = new THREE.InstancedMesh(starGeometry(), glowMaterial(bloom ? 1.25 : 0.8, env), NS);
  star.name = "stars";
  star.frustumCulled = false;
  for (let i = 0; i < NS; i++){ col.set(PAL.star); star.setColorAt(i, col); halo.setColorAt(N + i, col.clone().multiplyScalar(1.2)); }
  group.add(star);
  // лучи вокруг звёздных: крестик из двух вытянутых ореолов
  const rays = haloMesh(NS * 2, glowTex, halos * 0.9);
  for (let i = 0; i < NS * 2; i++){ col.set(0xf4ffc4); rays.setColorAt(i, col); }
  group.add(rays);

  const state = level.crystals.map(() => ({ got: false, t: -1 }));
  const sstate = level.stars.map(() => ({ got: false, t: -1 }));

  function place(mesh, i, x, y, z, rotY, sc, sy = sc, rotZ = 0){
    _p.set(x, y, z); _e.set(0, rotY, rotZ); _q.setFromEuler(_e); _s.set(sc, sy, sc);
    _m.compose(_p, _q, _s); mesh.setMatrixAt(i, _m);
  }
  function placeHalo(i, x, y, z, sx, sy = sx, rot = 0){
    _p.set(x, y, z); _e.set(0, 0, rot); _q.setFromEuler(_e); _s.set(sx, sy, 1);
    _m.compose(_p, _q, _s); halo.setMatrixAt(i, _m);
  }

  return {
    group, state, sstate,
    reset(){ for (const s of state){ s.got = false; s.t = -1; } for (const s of sstate){ s.got = false; s.t = -1; } },
    // t — время мира (для фазы), now — оно же, для анимации сбора
    update(t){
      for (let i = 0; i < N; i++){
        const c = level.crystals[i], s = state[i];
        const bob = Math.sin(t * 2.6 + c.x * 0.7) * 0.09;
        let sc = 1, lift = 0;
        if (s.got){
          const k = (t - s.t) / 0.22;
          if (k >= 1){ place(gem, i, 0, -999, 0, 0, 0); placeHalo(i, 0, -999, 0, 0); continue; }
          sc = 1 + 0.6 * k - 1.6 * k * k; lift = k * 0.7; sc = Math.max(0, sc);
        }
        const rot = t * 2.2 + c.x;
        place(gem, i, c.x, c.y + bob + lift, 0, rot, sc * 1.0, sc * 1.05);
        placeHalo(i, c.x, c.y + bob + lift, -0.05, 1.25 * sc * (1 + 0.08 * Math.sin(t * 5 + i)));
      }
      for (let i = 0; i < NS; i++){
        const c = level.stars[i], s = sstate[i];
        const bob = Math.sin(t * 2 + i) * 0.14;
        let sc = 1;
        if (s.got){
          const k = (t - s.t) / 0.35;
          if (k >= 1){ place(star, i, 0, -999, 0, 0, 0); placeHalo(N + i, 0, -999, 0, 0);
            for (const j of [0, 1]){ _m.makeScale(0, 0, 0); rays.setMatrixAt(i * 2 + j, _m); } continue; }
          sc = 1 + 0.9 * k - 1.9 * k * k; sc = Math.max(0, sc);
        }
        place(star, i, c.x, c.y + bob, 0, Math.sin(t * 1.7 + i) * 0.7, sc * 1.05, sc * 1.05, Math.sin(t * 1.1 + i) * 0.15);
        placeHalo(N + i, c.x, c.y + bob, -0.1, 2.6 * sc);
        for (const j of [0, 1]){
          _p.set(c.x, c.y + bob, -0.08); _e.set(0, 0, t * 0.5 + j * Math.PI / 2); _q.setFromEuler(_e);
          _s.set(3.4 * sc * (1 + 0.1 * Math.sin(t * 3 + j)), 0.32 * sc, 1);
          _m.compose(_p, _q, _s); rays.setMatrixAt(i * 2 + j, _m);
        }
      }
      gem.instanceMatrix.needsUpdate = true; halo.instanceMatrix.needsUpdate = true;
      star.instanceMatrix.needsUpdate = true; rays.instanceMatrix.needsUpdate = true;
    },
  };
}

// ---------- КРИСТАЛЬНОЕ СЕРДЦЕ НА ПЬЕДЕСТАЛЕ ----------
function heartShape(s = 1){
  const h = new THREE.Shape();
  h.moveTo(0, -0.95 * s);
  h.bezierCurveTo(-0.35 * s, -0.55 * s, -1.05 * s, -0.2 * s, -1.0 * s, 0.3 * s);
  h.bezierCurveTo(-0.95 * s, 0.85 * s, -0.25 * s, 1.0 * s, 0, 0.5 * s);
  h.bezierCurveTo(0.25 * s, 1.0 * s, 0.95 * s, 0.85 * s, 1.0 * s, 0.3 * s);
  h.bezierCurveTo(1.05 * s, -0.2 * s, 0.35 * s, -0.55 * s, 0, -0.95 * s);
  return h;
}

export function createHeart(level, groundY, { glowTex, env, bloom = true }){
  const group = new THREE.Group(); group.name = "crystal-heart";
  const x = level.heart.x, ped = level.heart.pedestal;
  group.position.set(x, groundY, 0);

  // пьедестал: ступени, колонна, чаша (один меш, цвета вершин)
  const b = new Batch();
  const cyl = (r0, r1, h, y, c, seg = 10) => { const g = new THREE.CylinderGeometry(r1, r0, h, seg); b.add(g, new THREE.Matrix4().makeTranslation(0, y + h / 2, 0), c); g.dispose(); };
  cyl(1.35, 1.25, 0.22, 0, 0xd9c8ef);
  cyl(1.1, 1.0, 0.18, 0.22, PAL.trim);
  cyl(0.55, 0.45, ped - 0.62, 0.4, 0xb9a6dc);
  cyl(0.62, 0.62, 0.08, 0.5, PAL.gold);
  cyl(0.62, 0.62, 0.08, ped - 0.3, PAL.gold);
  cyl(0.5, 0.95, 0.22, ped - 0.22, PAL.trim, 12);
  const pedMesh = new THREE.Mesh(b.build(), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  group.add(pedMesh);

  // сердце: выдавленная фигура с грубой фаской → грани
  const geo = new THREE.ExtrudeGeometry(heartShape(0.95), { depth: 0.4, bevelEnabled: true, bevelThickness: 0.26, bevelSize: 0.2, bevelSegments: 1, curveSegments: 5, steps: 1 });
  geo.center();
  const mat = new THREE.MeshStandardMaterial({ color: 0xff8fcf, emissive: new THREE.Color(0xff3fa3), emissiveIntensity: bloom ? 0.32 : 0.28, roughness: 0.14, metalness: 0.12, flatShading: true, envMap: env || null, envMapIntensity: 1.1 });
  const heart = new THREE.Mesh(geo, mat);
  heart.position.y = ped + 1.25;
  group.add(heart);
  // внутреннее ядро — бирюзовый кристалл, просвечивает спереди
  const core = new THREE.Mesh(gemGeometry(0.2, 0.36, 0.28), new THREE.MeshStandardMaterial({ color: 0xbffcf3, emissive: new THREE.Color(PAL.crystalA), emissiveIntensity: bloom ? 1.4 : 1.0, flatShading: true }));
  core.position.set(0, ped + 1.25, 0.05);
  group.add(core);
  // ореол
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: glowTex, color: 0xff7cc8, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: bloom ? 0.28 : 0.4, toneMapped: false }));
  halo.position.set(0, ped + 1.25, -0.7); halo.scale.set(5, 5, 1);
  group.add(halo);
  // кольца-орбиты из маленьких кристаллов
  const orbit = new THREE.InstancedMesh(gemGeometry(0.09, 0.2, 0.14), glowMaterial(bloom ? 1.6 : 0.9, env), 8);
  const col = new THREE.Color();
  for (let i = 0; i < 8; i++){ col.set(COLORS[i % 3]); orbit.setColorAt(i, col); }
  orbit.frustumCulled = false;
  group.add(orbit);

  let won = 0;
  return {
    group, heart,
    win(){ won = 1; },
    reset(){ won = 0; },
    update(t){
      const pulse = 1 + 0.04 * Math.sin(t * 3.2) + (won ? 0.08 * Math.max(0, Math.sin(t * 9)) : 0);
      heart.rotation.y = Math.sin(t * 0.9) * 0.55 + (won ? t * 2.5 : 0);
      heart.position.y = ped + 1.25 + Math.sin(t * 1.7) * 0.1 + (won ? 0.3 : 0);
      heart.scale.setScalar(pulse);
      core.rotation.y = -t * 2;
      core.position.set(Math.sin(heart.rotation.y) * 0.5, heart.position.y + 0.05, Math.cos(heart.rotation.y) * 0.5);
      halo.position.y = heart.position.y;
      halo.scale.setScalar(5 * (1 + 0.06 * Math.sin(t * 2.4)) * (won ? 1.4 : 1));
      for (let i = 0; i < 8; i++){
        const a = t * 0.9 + i / 8 * Math.PI * 2;
        _p.set(Math.cos(a) * 1.55, heart.position.y + Math.sin(a * 2) * 0.25, Math.sin(a) * 0.9);
        _e.set(0, t * 3 + i, 0); _q.setFromEuler(_e); _s.setScalar(1);
        _m.compose(_p, _q, _s); orbit.setMatrixAt(i, _m);
      }
      orbit.instanceMatrix.needsUpdate = true;
    },
  };
}
