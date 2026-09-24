// Кристаллы: малые (инстансинг, один draw call + ореолы), звёздные (гранёные звёзды) и финальное
// Кристальное сердце на пьедестале. Светятся (emissive = цвет инстанса), вращаются, покачиваются;
// при сборе — «выстрел» вверх и схлопывание (частицы делает fx).
import * as THREE from "three";
import { PAL } from "../config.js";
import { Batch } from "./geo.js";

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler();
const COLORS = [PAL.crystalA, PAL.crystalB, PAL.crystalC];

// вытянутый гранёный октаэдр: 4 грани по кругу (верх длиннее низа) — восемь треугольных граней всего
function gemGeometry(r = 0.2, hTop = 0.4, hBot = 0.26, n = 4){
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

// ---------- КРИСТАЛЬНОЕ СЕРДЦЕ: гигантский кристалл над золотым пьедесталом-фонтаном ----------
// Как в референсе финального зала: гранёный вытянутый кристалл (8 граней, прозрачная лаванда) парит
// над хромовой чашей на золотой ножке, снизу в него бьёт фиолетовый луч; внутри светится розовое сердце.
// Пол вокруг — глянцевый «зеркальный» мрамор с золотыми инкрустациями и пятном отражённого света.
function heartShape(s = 1){
  const h = new THREE.Shape();
  h.moveTo(0, -0.95 * s);
  h.bezierCurveTo(-0.35 * s, -0.55 * s, -1.05 * s, -0.2 * s, -1.0 * s, 0.3 * s);
  h.bezierCurveTo(-0.95 * s, 0.85 * s, -0.25 * s, 1.0 * s, 0, 0.5 * s);
  h.bezierCurveTo(0.25 * s, 1.0 * s, 0.95 * s, 0.85 * s, 1.0 * s, 0.3 * s);
  h.bezierCurveTo(1.05 * s, -0.2 * s, 0.35 * s, -0.55 * s, 0, -0.95 * s);
  return h;
}
// гранёный кристалл: n граней, верхняя пирамида hTop, пояс-призма (±g), нижняя пирамида hBot
function bigGemGeometry(r, hTop, hBot, g, n = 8){
  const pos = [], ring = y => { const a = []; for (let i = 0; i < n; i++){ const t = (i + 0.5) / n * Math.PI * 2; a.push([Math.cos(t) * r, y, Math.sin(t) * r]); } return a; };
  const up = ring(g), dn = ring(-g), T = [0, hTop + g, 0], Bt = [0, -hBot - g, 0];
  for (let i = 0; i < n; i++){
    const j = (i + 1) % n;
    pos.push(...T, ...up[j], ...up[i]);
    pos.push(...up[i], ...up[j], ...dn[j], ...up[i], ...dn[j], ...dn[i]);
    pos.push(...Bt, ...dn[i], ...dn[j]);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}
// мраморный пол зала: сливки + золотые дуги-инкрустации вокруг пьедестала (cx — x пьедестала в долях)
function floorTexture(w, d, cxU){
  const PX = 64, c = document.createElement("canvas");
  c.width = Math.round(w * PX); c.height = Math.round(d * PX);
  const g = c.getContext("2d");
  const grd = g.createLinearGradient(0, 0, 0, c.height);
  grd.addColorStop(0, "#efe6f0"); grd.addColorStop(1, "#fbf5ec");
  g.fillStyle = grd; g.fillRect(0, 0, c.width, c.height);
  const cx = cxU * c.width, cy = c.height * 0.55;
  g.strokeStyle = "rgba(217,169,58,0.9)";
  for (const [r, lw] of [[1.9, 5], [2.15, 2], [3.6, 3], [5.6, 3], [5.8, 1.5]]){ g.lineWidth = lw; g.beginPath(); g.arc(cx, cy, r * PX, 0, Math.PI * 2); g.stroke(); }
  g.lineWidth = 2;
  for (let k = 0; k < 16; k++){ const a = k / 16 * Math.PI * 2; g.beginPath(); g.moveTo(cx + Math.cos(a) * 2.15 * PX, cy + Math.sin(a) * 2.15 * PX); g.lineTo(cx + Math.cos(a) * 3.6 * PX, cy + Math.sin(a) * 3.6 * PX); g.stroke(); }
  g.fillStyle = "rgba(217,169,58,0.9)"; g.fillRect(0, c.height - 6, c.width, 4);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

export function createHeart(level, groundY, { glowTex, env, bloom = true, gemColor = 0xbfa8ff, gemEmissive = PAL.purple, heartColor = 0xffb3e0, heartEmissive = 0xff5fb8 }){
  const group = new THREE.Group(); group.name = "crystal-heart";
  const x = level.heart.x, ped = level.heart.pedestal;
  group.position.set(x, groundY, 0);

  // пьедестал-фонтан: профили вращения снизу вверх (LatheGeometry — нормали наружу)
  const bTop = new Batch(), bGold = new Batch(), bChrome = new Batch();
  const lathe = (b, pts, c, seg = 28) => { const g = new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg); b.add(g, new THREE.Matrix4(), c); g.dispose(); };
  // (визуальный пьедестал выше, чем level.heart.pedestal — это только декор, касание считается по x)
  lathe(bTop, [[1.75, 0], [1.75, 0.16], [1.7, 0.22], [1.62, 0.24], [0.001, 0.24]], PAL.top);
  lathe(bGold, [[1.58, 0.24], [1.63, 0.28], [1.6, 0.33], [1.42, 0.35], [0.001, 0.35]], PAL.gold);
  lathe(bTop, [[1.32, 0.35], [1.32, 0.52], [1.27, 0.58], [1.17, 0.6], [0.001, 0.6]], PAL.top);
  lathe(bGold, [[0.7, 0.6], [0.68, 0.65], [0.46, 0.72], [0.34, 0.84], [0.29, 1.0], [0.33, 1.12], [0.48, 1.18], [0.5, 1.22], [0.34, 1.27], [0.001, 1.27]], PAL.gold);
  lathe(bChrome, [[0.001, 1.18], [0.24, 1.24], [0.62, 1.34], [1.0, 1.5], [1.3, 1.68], [1.38, 1.76]], PAL.chrome);
  lathe(bGold, [[1.33, 1.71], [1.44, 1.74], [1.46, 1.79], [1.39, 1.83], [1.27, 1.8]], PAL.gold);
  lathe(bChrome, [[1.27, 1.8], [0.9, 1.68], [0.35, 1.6], [0.001, 1.58]], PAL.chrome);        // внутренняя чаша
  const pedTopMesh = new THREE.Mesh(bTop.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0, envMapIntensity: 0.4 }));
  const pedGoldMesh = new THREE.Mesh(bGold.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.25, metalness: 1, envMapIntensity: 1.3 }));
  const pedChromeMesh = new THREE.Mesh(bChrome.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.1, metalness: 1, envMapIntensity: 1.25 }));
  group.add(pedTopMesh, pedGoldMesh, pedChromeMesh);

  // глянцевый пол зала на верху яруса (не шире самого яруса — ничего не торчит за лицо стены)
  const top = level.solids.find(s => x >= s.x0 && x <= s.x1 && Math.abs(s.y1 - groundY) < 0.01);
  const fx0 = (top ? top.x0 : x - 6) + 0.25 - x, fx1 = (top ? top.x1 : x + 6) - 0.2 - x;
  const fz0 = -1.1, fz1 = 1.2;
  const floorGeo = new THREE.PlaneGeometry(fx1 - fx0, fz1 - fz0); floorGeo.rotateX(-Math.PI / 2);
  const floor = new THREE.Mesh(floorGeo, new THREE.MeshStandardMaterial({
    map: floorTexture(fx1 - fx0, fz1 - fz0, -fx0 / (fx1 - fx0)), roughness: 0.12, metalness: 0.25, envMapIntensity: 0.9,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  }));
  floor.position.set((fx0 + fx1) / 2, 0.006, (fz0 + fz1) / 2);
  floor.receiveShadow = true;
  group.add(floor);
  // гигантский кристалл: прозрачная лаванда, грани, сильные отражения
  const cy0 = 3.35;
  const gem = new THREE.Mesh(bigGemGeometry(0.92, 1.75, 1.2, 0.18, 8), new THREE.MeshPhysicalMaterial({
    color: gemColor, emissive: new THREE.Color(gemEmissive), emissiveIntensity: bloom ? 0.26 : 0.22,
    roughness: 0.05, metalness: 0.15, clearcoat: 1, clearcoatRoughness: 0.04,
    transparent: true, opacity: 0.66, flatShading: true, envMap: env || null, envMapIntensity: 1.8,
  }));
  gem.position.y = cy0;
  gem.renderOrder = 6;
  group.add(gem);
  // сердце внутри кристалла — розовое (ночью — лунно-голубое), светится (виден сквозь грани)
  const hgeo = new THREE.ExtrudeGeometry(heartShape(0.42), { depth: 0.16, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.07, bevelSegments: 2, curveSegments: 8, steps: 1 });
  hgeo.center();
  const heart = new THREE.Mesh(hgeo, new THREE.MeshStandardMaterial({ color: heartColor, emissive: new THREE.Color(heartEmissive), emissiveIntensity: bloom ? 1.5 : 1.0, roughness: 0.3 }));
  heart.position.y = cy0 + 0.1;
  group.add(heart);

  // фиолетовый луч из чаши в кристалл и сквозь него: две скрещённые плоскости, градиент вершинных цветов
  const beamB = new Batch();
  {
    const y0 = 1.6, y1 = cy0 + 2.2, hw = 0.22;
    const bottom = new THREE.Color(0xc9a0ff).multiplyScalar(bloom ? 1.8 : 1.1), mid = new THREE.Color(PAL.purple).multiplyScalar(0.9), topC = new THREE.Color(0, 0, 0);
    for (const a of [0, Math.PI / 2]){
      const dx = Math.cos(a) * hw, dz = Math.sin(a) * hw;
      const ys = [y0, cy0, y1], cs = [bottom, mid, topC];
      for (let k = 0; k < 2; k++){
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.Float32BufferAttribute([-dx, ys[k], -dz, dx, ys[k], dz, dx, ys[k + 1], dz, -dx, ys[k], -dz, dx, ys[k + 1], dz, -dx, ys[k + 1], -dz], 3));
        g.computeVertexNormals();
        const cc = [cs[k], cs[k], cs[k + 1], cs[k], cs[k + 1], cs[k + 1]];
        let vi = 0;
        beamB.add(g, new THREE.Matrix4(), () => cc[vi++]);
        g.dispose();
      }
    }
  }
  const beam = new THREE.Mesh(beamB.build(), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide }));
  beam.renderOrder = 5;
  group.add(beam);

  // ореол за кристаллом, пятно отражённого света на полу и 5 медленных лучей — один инстансный меш
  // (аддитивно, общая мягкая текстура; «прозрачность» каждого — в цвете инстанса): 0 — ореол,
  // 1 — пятно на полу, 2..6 — лучи. Сдержанно: фон зала и так светлый, иначе пересвет в bloom.
  const glows = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
    map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
  }), 7);
  glows.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(7 * 3), 3);
  glows.frustumCulled = false; glows.renderOrder = 5;
  const HALO = new THREE.Color(0xc8a8ff).multiplyScalar(bloom ? 0.2 : 0.3);
  const RAY = new THREE.Color(0xf2e6ff).multiplyScalar(bloom ? 0.14 : 0.2);
  glows.setColorAt(1, new THREE.Color(0xd9b8ff).multiplyScalar(bloom ? 0.45 : 0.55));
  for (let i = 2; i < 7; i++) glows.setColorAt(i, RAY);
  _p.set(0, 0.02, 0.35); _e.set(-Math.PI / 2, 0, 0); _q.setFromEuler(_e); _s.set(5.2, 2.2, 1);
  _m.compose(_p, _q, _s); glows.setMatrixAt(1, _m);
  group.add(glows);
  const hc = new THREE.Color();
  // хоровод маленьких кристаллов
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
      const bob = Math.sin(t * 1.4) * 0.08 + (won ? 0.25 : 0);
      gem.position.y = cy0 + bob;
      gem.rotation.y = t * 0.35 + (won ? t * 1.5 : 0);
      const pulse = 1 + 0.05 * Math.sin(t * 3.2) + (won ? 0.1 * Math.max(0, Math.sin(t * 9)) : 0);
      heart.scale.setScalar(pulse);
      heart.rotation.y = Math.sin(t * 0.9) * 0.6 + (won ? t * 2.5 : 0);
      heart.position.y = cy0 + 0.1 + bob;
      const hk = (won ? 1.8 : 1) * (1 + 0.08 * Math.sin(t * 2.4)), hs = (won ? 1.4 : 1) * (1 + 0.06 * Math.sin(t * 2.4));
      _p.set(0, cy0 + bob, -1.0); _q.identity(); _s.set(5 * hs, 6.4 * hs, 1);
      _m.compose(_p, _q, _s); glows.setMatrixAt(0, _m);
      glows.setColorAt(0, hc.copy(HALO).multiplyScalar(hk));
      for (let i = 0; i < 5; i++){
        const a = t * 0.22 + i / 5 * Math.PI * 2;
        _p.set(0, cy0 + bob, -0.6); _e.set(0, 0, a); _q.setFromEuler(_e);
        const rl = 6 * (1 + 0.08 * Math.sin(t * 1.6 + i)) * (won ? 1.3 : 1);
        _s.set(rl, 0.3, 1);
        _m.compose(_p, _q, _s); glows.setMatrixAt(2 + i, _m);
      }
      glows.instanceMatrix.needsUpdate = true; glows.instanceColor.needsUpdate = true;
      for (let i = 0; i < 8; i++){
        const a = t * 0.9 + i / 8 * Math.PI * 2;
        _p.set(Math.cos(a) * 1.75, cy0 + bob + Math.sin(a * 2) * 0.35, Math.sin(a) * 1.0);
        _e.set(0, t * 3 + i, 0); _q.setFromEuler(_e); _s.setScalar(1);
        _m.compose(_p, _q, _s); orbit.setMatrixAt(i, _m);
      }
      orbit.instanceMatrix.needsUpdate = true;
    },
  };
}
