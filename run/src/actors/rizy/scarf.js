// PLAYER-4: verlet-шарф. Два хвоста = две цепочки узлов в МИРОВЫХ координатах (инерция смены полосы и прыжка
// получается сама), фиксированный шаг 60 Гц, 3 итерации ограничений, мягкая «форма» у узла,
// сферы-коллайдеры (рюкзак, спина, голова). Лента — гладкая Catmull-Rom поверх узлов, сечение «плоский овал»,
// нормали аналитические каждый кадр. Один BufferGeometry на оба хвоста = 1 draw call.
// Без меша (opts.material == null) модуль отдаёт только узлы — так GLB-адаптер крутит кости шарфа.
import * as THREE from "three";

const STEP = 1 / 60;

export function createScarf(opts){
  const anchors = opts.anchors;                 // [{ obj, dirObj, dir:[x,y,z] }] — якорь и направление «от узла» в осях dirObj
  const T = anchors.length;
  const N = opts.nodes || 8;                    // узлов на хвост (включая якорь)
  const seg = opts.seg || 0.075;
  const colliders = opts.colliders || [];       // [{ obj, up, back, r }] — сфера у мировой позиции obj + (0, up, back)
  const rings = opts.rings || 15;               // колец ленты на хвост (≥ 12 сегментов)
  const sides = opts.sides || 10;
  const width = opts.width || 0.13, thick = opts.thick || 0.03;
  const rootObj = opts.root;

  const P = [], Q = [], R = [];                 // текущие, прошлые, интерполированные для рендера
  for (let t = 0; t < T; t++){ P.push(new Float32Array(N * 3)); Q.push(new Float32Array(N * 3)); R.push(new Float32Array(N * 3)); }
  const cc = new Float32Array(colliders.length * 4);
  const wind = { x: 0, y: 0, z: 0, flutter: 0, lift: 0, splay: 0 };
  let acc = 0, time = 0, inited = false;

  // ---------- меш ----------
  let mesh = null, posA = null, nrmA = null;
  const perTail = rings * sides + 1;
  if (opts.material){
    const g = new THREE.BufferGeometry();
    posA = new Float32Array(T * perTail * 3); nrmA = new Float32Array(T * perTail * 3);
    const col = new Float32Array(T * perTail * 3), idx = [];
    // лента под солнцем лежит почти плашмя: чуть темнее бренд-лайма, иначе ACES выбеливает её в бледно-жёлтый
    const cA = new THREE.Color(opts.color != null ? opts.color : 0xA6E62A), cB = new THREE.Color(opts.stripe != null ? opts.stripe : 0x2f6df0);
    for (let t = 0; t < T; t++){
      const o = t * perTail;
      for (let j = 0; j < rings; j++){
        const u = j / (rings - 1);
        // две тонкие полоски у конца — вязаный шарф, а не пластиковая лента
        const st = (u > 0.74 && u < 0.79) || (u > 0.85 && u < 0.89);
        const cc2 = st ? cB : cA;
        for (let s = 0; s < sides; s++){ const v = (o + j * sides + s) * 3; col[v] = cc2.r; col[v + 1] = cc2.g; col[v + 2] = cc2.b; }
        if (j < rings - 1) for (let s = 0; s < sides; s++){
          const a = o + j * sides + s, b = o + j * sides + (s + 1) % sides, c = a + sides, d = b + sides;
          idx.push(a, b, c, b, d, c);          // обход наружу: (c−a)×(b−a) даёт −S, поэтому a,b,c
        }
      }
      const tip = o + rings * sides, last = o + (rings - 1) * sides;
      col[tip * 3] = cA.r; col[tip * 3 + 1] = cA.g; col[tip * 3 + 2] = cA.b;
      for (let s = 0; s < sides; s++) idx.push(last + s, last + (s + 1) % sides, tip);
    }
    g.setAttribute("position", new THREE.BufferAttribute(posA, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("normal", new THREE.BufferAttribute(nrmA, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.setIndex(idx);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.2, 0.5), 3);
    mesh = new THREE.Mesh(g, opts.material);
    mesh.name = "rizy:scarf";
    mesh.frustumCulled = false;
    mesh.castShadow = opts.castShadow !== false;
  }

  // ---------- временные (без аллокаций в кадре) ----------
  const A = new Float32Array(3), D = new Float32Array(3);
  const inv = new THREE.Matrix4();
  const ring = new Float32Array(rings * 3), tan = new Float32Array(rings * 3);
  const CS = new Float32Array(sides * 2);
  for (let s = 0; s < sides; s++){
    const a = s / sides * Math.PI * 2, c = Math.cos(a), si = Math.sin(a);
    // суперэллипс: плоская лента со скруглёнными краями
    CS[s * 2] = Math.sign(c) * Math.pow(Math.abs(c), 0.55);
    CS[s * 2 + 1] = Math.sign(si) * Math.pow(Math.abs(si), 0.55);
  }

  function anchorOf(t){
    const a = anchors[t], e = a.obj.matrixWorld.elements, m = (a.dirObj || a.obj).matrixWorld.elements;
    A[0] = e[12]; A[1] = e[13]; A[2] = e[14];
    const dx = a.dir[0], dy = a.dir[1], dz = a.dir[2];
    let x = m[0] * dx + m[4] * dy + m[8] * dz, y = m[1] * dx + m[5] * dy + m[9] * dz, z = m[2] * dx + m[6] * dy + m[10] * dz;
    const l = Math.hypot(x, y, z) || 1;
    D[0] = x / l; D[1] = y / l; D[2] = z / l;
  }

  function reset(){
    for (let t = 0; t < T; t++){
      anchorOf(t);
      const p = P[t], q = Q[t];
      for (let i = 0; i < N; i++){
        // стартовая форма: от узла по направлению, дальше свисает вниз
        const k = Math.min(i, 2), rest = i - k;
        p[i * 3] = A[0] + D[0] * seg * k;
        p[i * 3 + 1] = A[1] + D[1] * seg * k - seg * rest;
        p[i * 3 + 2] = A[2] + D[2] * seg * k + seg * rest * 0.2;
        q[i * 3] = p[i * 3]; q[i * 3 + 1] = p[i * 3 + 1]; q[i * 3 + 2] = p[i * 3 + 2];
      }
    }
    acc = 0; inited = true;
  }

  function step(dt){
    time += dt;
    for (let c = 0; c < colliders.length; c++){
      const C = colliders[c], e = C.obj.matrixWorld.elements;
      cc[c * 4] = e[12]; cc[c * 4 + 1] = e[13] + C.up; cc[c * 4 + 2] = e[14] + (C.back || 0); cc[c * 4 + 3] = C.r;
    }
    const drag = 0.92, dt2 = dt * dt;
    for (let t = 0; t < T; t++){
      anchorOf(t);
      const p = P[t], q = Q[t], side = t === 0 ? -1 : 1;
      p[0] = A[0]; p[1] = A[1]; p[2] = A[2]; q[0] = A[0]; q[1] = A[1]; q[2] = A[2];
      for (let i = 1; i < N; i++){
        const o = i * 3, u = i / (N - 1);
        const vx = (p[o] - q[o]) * drag, vy = (p[o + 1] - q[o + 1]) * drag, vz = (p[o + 2] - q[o + 2]) * drag;
        q[o] = p[o]; q[o + 1] = p[o + 1]; q[o + 2] = p[o + 2];
        // ветер: встречный поток + «флаг»: бегущая волна по длине, хвосты чуть расходятся
        const fl = wind.flutter * u;
        // splay — хвосты расходятся «ласточкой», чтобы со спины оба читались по бокам рюкзака
        const ax = wind.x + side * (wind.splay || 0) * u + Math.sin(time * 11.0 - i * 0.9 + t * 1.7) * 3.2 * fl;
        // хвосты разведены и по высоте: со спины две ленты, а не одна полоса
        const ay = -9.8 + wind.y + wind.lift * u - side * (wind.splay || 0) * 0.9 * u + Math.sin(time * 8.3 - i * 1.1 + t) * 2.6 * fl;
        const az = wind.z * (0.55 + 0.45 * u) + Math.sin(time * 5.1 - i * 0.7 + t * 2.3) * 1.5 * fl;
        p[o] += vx + ax * dt2; p[o + 1] += vy + ay * dt2; p[o + 2] += vz + az * dt2;
      }
      for (let it = 0; it < 3; it++){
        // мягкая форма у корня: узел 1 и 2 тянутся по направлению якоря (шарф не проваливается в спину)
        for (let i = 1; i <= 2 && i < N; i++){
          const o = i * 3, s = i === 1 ? 0.45 : 0.12;
          p[o] += (A[0] + D[0] * seg * i - p[o]) * s;
          p[o + 1] += (A[1] + D[1] * seg * i - p[o + 1]) * s;
          p[o + 2] += (A[2] + D[2] * seg * i - p[o + 2]) * s;
        }
        for (let i = 1; i < N; i++){
          const o = i * 3, b = o - 3;
          const dx = p[o] - p[b], dy = p[o + 1] - p[b + 1], dz = p[o + 2] - p[b + 2];
          const l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6, diff = (l - seg) / l;
          if (i === 1){ p[o] -= dx * diff; p[o + 1] -= dy * diff; p[o + 2] -= dz * diff; }
          else {
            const h = diff * 0.5;
            p[o] -= dx * h; p[o + 1] -= dy * h; p[o + 2] -= dz * h;
            p[b] += dx * h; p[b + 1] += dy * h; p[b + 2] += dz * h;
          }
        }
        // изгиб: соседи через один не ближе 1.7·seg — лента без изломов
        for (let i = 2; i < N; i++){
          const o = i * 3, b = o - 6;
          const dx = p[o] - p[b], dy = p[o + 1] - p[b + 1], dz = p[o + 2] - p[b + 2];
          const l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6, min = seg * 1.7;
          if (l < min){
            const h = (l - min) / l * 0.25;
            p[o] -= dx * h; p[o + 1] -= dy * h; p[o + 2] -= dz * h;
            if (i - 2 > 0){ p[b] += dx * h; p[b + 1] += dy * h; p[b + 2] += dz * h; }
          }
        }
        for (let c = 0; c < colliders.length; c++){
          const cx = cc[c * 4], cy = cc[c * 4 + 1], cz = cc[c * 4 + 2], r = cc[c * 4 + 3] + thick;
          for (let i = 2; i < N; i++){
            const o = i * 3, dx = p[o] - cx, dy = p[o + 1] - cy, dz = p[o + 2] - cz;
            const l2 = dx * dx + dy * dy + dz * dz;
            if (l2 < r * r){ const l = Math.sqrt(l2) || 1e-6, k = (r - l) / l; p[o] += dx * k; p[o + 1] += dy * k; p[o + 2] += dz * k; }
          }
        }
      }
    }
  }

  // Catmull-Rom по узлам хвоста t → кольца ленты
  function curve(t){
    const r = R[t];
    for (let j = 0; j < rings; j++){
      const u = j / (rings - 1) * (N - 1);
      let i = Math.floor(u); if (i > N - 2) i = N - 2;
      const f = u - i, f2 = f * f, f3 = f2 * f;
      const i0 = Math.max(0, i - 1) * 3, i1 = i * 3, i2 = (i + 1) * 3, i3 = Math.min(N - 1, i + 2) * 3;
      for (let c = 0; c < 3; c++){
        const p0 = r[i0 + c], p1 = r[i1 + c], p2 = r[i2 + c], p3 = r[i3 + c];
        ring[j * 3 + c] = 0.5 * ((2 * p1) + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f2 + (-p0 + 3 * p1 - 3 * p2 + p3) * f3);
      }
    }
    for (let j = 0; j < rings; j++){
      const a = Math.max(0, j - 1) * 3, b = Math.min(rings - 1, j + 1) * 3;
      let x = ring[b] - ring[a], y = ring[b + 1] - ring[a + 1], z = ring[b + 2] - ring[a + 2];
      const l = Math.hypot(x, y, z) || 1;
      tan[j * 3] = x / l; tan[j * 3 + 1] = y / l; tan[j * 3 + 2] = z / l;
    }
  }

  function writeMesh(){
    inv.copy(rootObj.matrixWorld).invert();
    const ie = inv.elements, re = rootObj.matrixWorld.elements;
    // «поперёк ленты» = ось X персонажа в мире
    let sx0 = re[0], sy0 = re[1], sz0 = re[2];
    const sl = Math.hypot(sx0, sy0, sz0) || 1; sx0 /= sl; sy0 /= sl; sz0 /= sl;
    for (let t = 0; t < T; t++){
      curve(t);
      const o = t * perTail;
      for (let j = 0; j < rings; j++){
        const u = j / (rings - 1);
        const tx = tan[j * 3], ty = tan[j * 3 + 1], tz = tan[j * 3 + 2];
        // S ⟂ T, затем N = T × S; лёгкое закручивание от ветра по длине
        const d = sx0 * tx + sy0 * ty + sz0 * tz;
        let sx = sx0 - tx * d, sy = sy0 - ty * d, sz = sz0 - tz * d;
        const l = Math.hypot(sx, sy, sz) || 1; sx /= l; sy /= l; sz /= l;
        let nx = ty * sz - tz * sy, ny = tz * sx - tx * sz, nz = tx * sy - ty * sx;
        const tw = (0.12 + wind.flutter * 0.3) * u * Math.sin(time * 6.0 - j * 0.45 + t * 2.0);
        const ct = Math.cos(tw), st = Math.sin(tw);
        const Sx = sx * ct + nx * st, Sy = sy * ct + ny * st, Sz = sz * ct + nz * st;
        const Nx = nx * ct - sx * st, Ny = ny * ct - sy * st, Nz = nz * ct - sz * st;
        const w = width * 0.5 * (0.78 + 0.3 * u), h = thick * 0.5 * (j === rings - 1 ? 0.7 : 1);
        const cx = ring[j * 3], cy = ring[j * 3 + 1], cz = ring[j * 3 + 2];
        for (let s = 0; s < sides; s++){
          const a = CS[s * 2], b = CS[s * 2 + 1];
          const wx = cx + Sx * a * w + Nx * b * h, wy = cy + Sy * a * w + Ny * b * h, wz = cz + Sz * a * w + Nz * b * h;
          const v = (o + j * sides + s) * 3;
          posA[v] = ie[0] * wx + ie[4] * wy + ie[8] * wz + ie[12];
          posA[v + 1] = ie[1] * wx + ie[5] * wy + ie[9] * wz + ie[13];
          posA[v + 2] = ie[2] * wx + ie[6] * wy + ie[10] * wz + ie[14];
          let mx = Sx * a * h + Nx * b * w, my = Sy * a * h + Ny * b * w, mz = Sz * a * h + Nz * b * w;
          const ml = Math.hypot(mx, my, mz) || 1; mx /= ml; my /= ml; mz /= ml;
          nrmA[v] = ie[0] * mx + ie[4] * my + ie[8] * mz;
          nrmA[v + 1] = ie[1] * mx + ie[5] * my + ie[9] * mz;
          nrmA[v + 2] = ie[2] * mx + ie[6] * my + ie[10] * mz;
        }
      }
      // скруглённый торец
      const j = rings - 1, v = (o + rings * sides) * 3;
      const wx = ring[j * 3] + tan[j * 3] * thick * 0.4, wy = ring[j * 3 + 1] + tan[j * 3 + 1] * thick * 0.4, wz = ring[j * 3 + 2] + tan[j * 3 + 2] * thick * 0.4;
      posA[v] = ie[0] * wx + ie[4] * wy + ie[8] * wz + ie[12];
      posA[v + 1] = ie[1] * wx + ie[5] * wy + ie[9] * wz + ie[13];
      posA[v + 2] = ie[2] * wx + ie[6] * wy + ie[10] * wz + ie[14];
      nrmA[v] = ie[0] * tan[j * 3] + ie[4] * tan[j * 3 + 1] + ie[8] * tan[j * 3 + 2];
      nrmA[v + 1] = ie[1] * tan[j * 3] + ie[5] * tan[j * 3 + 1] + ie[9] * tan[j * 3 + 2];
      nrmA[v + 2] = ie[2] * tan[j * 3] + ie[6] * tan[j * 3 + 1] + ie[10] * tan[j * 3 + 2];
    }
    mesh.geometry.attributes.position.needsUpdate = true;
    mesh.geometry.attributes.normal.needsUpdate = true;
  }

  // dt — realDt (шарф догоняет во время хит-стопа, как пружины PLAYER-5)
  function update(dt){
    if (!inited || dt > 0.25) reset();
    acc += Math.min(dt, 0.1);
    let n = 0;
    while (acc >= STEP && n < 4){ step(STEP); acc -= STEP; n++; }
    if (n === 4) acc = 0;
    const al = acc / STEP;
    for (let t = 0; t < T; t++){
      const p = P[t], q = Q[t], r = R[t];
      for (let i = 0; i < N * 3; i++) r[i] = q[i] + (p[i] - q[i]) * al;
      anchorOf(t); r[0] = A[0]; r[1] = A[1]; r[2] = A[2];
    }
    if (mesh) writeMesh();
  }

  function dispose(){ if (mesh){ mesh.geometry.dispose(); if (mesh.parent) mesh.parent.remove(mesh); } }

  return { mesh, wind, update, reset, nodes: R, N, dispose };
}
