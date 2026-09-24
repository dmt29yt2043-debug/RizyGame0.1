// Частицы и «сок»: пыль при прыжке/приземлении, искры двойного прыжка, шлейф рывка,
// вспышки кристаллов, клочки войлока Гасителей, искры факела, конфетти победы.
// Два THREE.Points (обычное смешивание для пыли и войлока, аддитивное для искр) = 2 draw call'а,
// плюс лента шлейфа рывка. Свой ГСЧ — фоторежим детерминирован.
import * as THREE from "three";
import { makeRng } from "./tex.js";

const VERT = /* glsl */`
  attribute float aSize;
  attribute float aAlpha;
  attribute float aShape;
  attribute vec3 aColor;
  varying float vAlpha;
  varying float vShape;
  varying vec3 vColor;
  uniform float uScale;
  void main(){
    vAlpha = aAlpha; vShape = aShape; vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale / -mv.z;
    gl_Position = projectionMatrix * mv;
  }`;
const FRAG = /* glsl */`
  varying float vAlpha;
  varying float vShape;
  varying vec3 vColor;
  void main(){
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float a;
    if (vShape < 0.5){
      a = smoothstep(1.0, 0.35, length(p));                        // мягкий кружок
    } else if (vShape < 1.5){
      // четырёхлучевая искра
      float r = length(p);
      float cross = max(1.0 - abs(p.x) * 7.0, 0.0) * (1.0 - abs(p.y)) + max(1.0 - abs(p.y) * 7.0, 0.0) * (1.0 - abs(p.x));
      a = clamp(cross + smoothstep(0.45, 0.0, r), 0.0, 1.0);
    } else if (vShape < 2.5){
      // ромбик-осколок
      a = smoothstep(1.0, 0.8, abs(p.x) + abs(p.y));
    } else {
      // горизонтальный штрих скорости
      a = smoothstep(1.0, 0.0, abs(p.y) * 9.0) * smoothstep(1.0, 0.2, abs(p.x));
    }
    if (a * vAlpha < 0.01) discard;
    gl_FragColor = vec4(vColor, a * vAlpha);
    #include <colorspace_fragment>
  }`;

function makeSystem(n, additive){
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n), alpha = new Float32Array(n), shape = new Float32Array(n);
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute("aColor", new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute("aAlpha", new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute("aShape", new THREE.BufferAttribute(shape, 1).setUsage(THREE.DynamicDrawUsage));
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG,
    uniforms: { uScale: { value: 400 } },
    transparent: true, depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = additive ? 8 : 7;
  const P = [];
  for (let i = 0; i < n; i++) P.push({ life: 0, max: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, g: 0, drag: 0, s0: 1, s1: 0, r: 1, gg: 1, b: 1, shape: 0, a0: 1 });
  return { pts, geo, P, n, next: 0 };
}

export function createFx(maxParticles = 420){
  const group = new THREE.Group(); group.name = "fx";
  const soft = makeSystem(Math.round(maxParticles * 0.45), false);
  const glow = makeSystem(Math.round(maxParticles * 0.55), true);
  group.add(soft.pts, glow.pts);
  let rnd = makeRng(1234);
  const col = new THREE.Color();

  // лента рывка: полупрозрачная полоса за спиной, яркая у героини
  const ribbonMat = new THREE.ShaderMaterial({
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `varying vec2 vUv; uniform float uA; uniform vec3 uC;
      void main(){ float a = pow(clamp(vUv.x, 0.0, 1.0), 1.6) * smoothstep(0.0, 0.35, vUv.y) * smoothstep(1.0, 0.65, vUv.y) * uA;
        gl_FragColor = vec4(uC, a);
        #include <colorspace_fragment>
      }`,
    uniforms: { uA: { value: 0 }, uC: { value: new THREE.Color(0x9fd8ff) } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const ribbon = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), ribbonMat);
  ribbon.frustumCulled = false; ribbon.visible = false; ribbon.renderOrder = 6;
  group.add(ribbon);
  const dash = { on: false, x0: 0, y: 0, dir: 1, t: 0, x: 0 };

  function emit(sys, o){
    const p = sys.P[sys.next]; sys.next = (sys.next + 1) % sys.n;
    p.life = p.max = o.life ?? 0.6;
    p.x = o.x; p.y = o.y; p.z = o.z ?? 0.3;
    p.vx = o.vx ?? 0; p.vy = o.vy ?? 0; p.vz = o.vz ?? 0;
    p.g = o.g ?? 0; p.drag = o.drag ?? 2;
    p.s0 = o.s0 ?? 0.3; p.s1 = o.s1 ?? 0;
    col.set(o.color ?? 0xffffff); if (o.bright) col.multiplyScalar(o.bright);
    p.r = col.r; p.gg = col.g; p.b = col.b;
    p.shape = o.shape ?? 0; p.a0 = o.a ?? 1;
  }
  const R = (a, b) => a + (b - a) * rnd();

  const api = {
    group,
    seed(s){ rnd = makeRng(s); },
    clear(){ for (const s of [soft, glow]) for (const p of s.P) p.life = 0; dash.on = false; ribbon.visible = false; },
    // ---------- эффекты ----------
    dust(x, y, n = 8, spread = 1, dir = 0){
      for (let i = 0; i < n; i++){
        const a = R(-1, 1);
        emit(soft, { x: x + a * 0.35, y: y + 0.05, z: R(-0.3, 0.5), vx: a * 2.4 * spread + dir * R(0.5, 1.8), vy: R(0.4, 1.6), vz: R(-0.5, 0.5),
          g: -1.2, drag: 3.5, life: R(0.35, 0.6), s0: R(0.25, 0.42), s1: 0.55, color: 0xfff3ea, a: 0.9 });
      }
    },
    ring(x, y, color = 0xbfe9ff, n = 14){
      for (let i = 0; i < n; i++){
        const a = i / n * Math.PI * 2;
        emit(glow, { x, y, z: 0.2, vx: Math.cos(a) * 3.2, vy: Math.sin(a) * 1.4 - 0.6, vz: Math.sin(a) * 1.2, drag: 5, life: R(0.3, 0.45), s0: R(0.18, 0.28), s1: 0, color, bright: 1.3, shape: 1 });
      }
    },
    dashStart(x, y, dir){
      dash.on = true; dash.x0 = x; dash.x = x; dash.y = y; dash.dir = dir; dash.t = 0.28;
      for (let i = 0; i < 10; i++) emit(glow, { x: x - dir * R(0, 0.4), y: y + R(0.2, 1.3), z: R(-0.2, 0.4), vx: -dir * R(2, 6), vy: R(-0.4, 0.4), drag: 4, life: R(0.25, 0.4), s0: R(0.15, 0.3), color: 0xc9ecff, bright: 1.2, shape: 1 });
    },
    dashTrail(x, y, dir){
      dash.x = x; dash.y = y; dash.dir = dir;
      emit(glow, { x: x - dir * 0.3, y: y + R(0.25, 1.25), z: R(-0.25, 0.35), vx: -dir * R(1, 3), vy: R(-0.3, 0.3), drag: 3, life: R(0.18, 0.32), s0: R(0.12, 0.24), color: [0x9fd8ff, 0xffffff, 0xc0ff3f][(rnd() * 3) | 0], bright: 1.2, shape: rnd() < 0.5 ? 1 : 2 });
      // штрихи скорости
      for (let i = 0; i < 2; i++) emit(glow, { x: x - dir * R(0.4, 1.4), y: y + R(0.1, 1.4), z: R(-0.4, 0.5), vx: dir * R(2, 5), drag: 6, life: R(0.14, 0.24), s0: R(0.9, 1.5), s1: 0.3, color: 0xdff3ff, bright: 1.1, a: 0.8, shape: 3 });
    },
    burst(x, y, color, n = 16, big = false){
      for (let i = 0; i < n; i++){
        const a = rnd() * Math.PI * 2, sp = R(2, big ? 7 : 5);
        emit(glow, { x, y, z: R(-0.2, 0.4), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp + 1.2, vz: R(-1, 1), g: -5, drag: 2.5, life: R(0.35, big ? 0.9 : 0.6), s0: R(0.14, big ? 0.36 : 0.26), s1: 0, color, bright: 1.4, shape: rnd() < 0.55 ? 2 : 1 });
      }
      emit(glow, { x, y, z: 0.3, life: 0.18, s0: big ? 2.6 : 1.5, s1: big ? 3.4 : 2.1, color, bright: 1.1, a: 0.8, drag: 0 });
    },
    felt(x, y){
      for (let i = 0; i < 12; i++){
        const a = rnd() * Math.PI * 2, sp = R(1.5, 4);
        emit(soft, { x, y, z: R(-0.3, 0.4), vx: Math.cos(a) * sp, vy: Math.abs(Math.sin(a)) * sp + 1, g: -9, drag: 1.5, life: R(0.5, 0.9), s0: R(0.18, 0.3), s1: 0.1, color: [0x3a3152, 0x5a4d7c, 0x2c2540][(rnd() * 3) | 0], a: 1, shape: 0 });
      }
      for (let i = 0; i < 8; i++) emit(glow, { x, y, vx: R(-3, 3), vy: R(1, 4), g: -6, drag: 2, life: R(0.3, 0.5), s0: R(0.12, 0.2), color: 0xff4d5e, bright: 1.3, shape: 1 });
    },
    hurt(x, y){
      for (let i = 0; i < 10; i++){ const a = rnd() * Math.PI * 2; emit(glow, { x, y, vx: Math.cos(a) * 4, vy: Math.sin(a) * 4 + 1, g: -6, drag: 2, life: R(0.3, 0.55), s0: R(0.18, 0.3), color: 0xffe066, bright: 1.3, shape: 1 }); }
    },
    fire(x, y){
      for (let i = 0; i < 18; i++) emit(glow, { x: x + R(-0.15, 0.15), y: y + R(0, 0.2), z: -0.5, vx: R(-1.2, 1.2), vy: R(1.5, 4.5), g: -1, drag: 1.6, life: R(0.4, 0.9), s0: R(0.12, 0.26), color: [0xffc24a, 0xfff1b0, 0xff8a3d][(rnd() * 3) | 0], bright: 1.5, shape: rnd() < 0.5 ? 1 : 0 });
    },
    ember(x, y){ emit(glow, { x: x + R(-0.08, 0.08), y, z: -0.5, vx: R(-0.3, 0.3), vy: R(0.6, 1.4), drag: 1, life: R(0.4, 0.8), s0: R(0.06, 0.12), color: 0xffcc66, bright: 1.4, shape: 0 }); },
    confetti(x, y){
      const cs = [0xff86cf, 0x5cb6ff, 0x3fe6d4, 0xc0ff3f, 0xfff1b0, 0xb9a6dc];
      for (let i = 0; i < 70; i++){
        const a = R(0.2, Math.PI - 0.2), sp = R(4, 10);
        emit(i % 2 ? soft : glow, { x, y, z: R(-0.5, 0.8), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: R(-2, 2), g: -7, drag: 1.2, life: R(1.0, 1.8), s0: R(0.18, 0.34), s1: 0.1, color: cs[i % cs.length], bright: i % 2 ? 1 : 1.2, shape: 2 });
      }
    },
    sparkle(x, y, color){ emit(glow, { x: x + R(-0.25, 0.25), y: y + R(-0.3, 0.3), z: 0.2, vy: R(0.2, 0.7), drag: 1, life: R(0.3, 0.6), s0: R(0.1, 0.2), color, bright: 1.3, shape: 1 }); },

    update(dt, camera, viewportH){
      const scale = viewportH / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
      for (const s of [soft, glow]){
        s.pts.material.uniforms.uScale.value = scale;
        const pos = s.geo.attributes.position.array, c = s.geo.attributes.aColor.array, sz = s.geo.attributes.aSize.array, al = s.geo.attributes.aAlpha.array, sh = s.geo.attributes.aShape.array;
        for (let i = 0; i < s.n; i++){
          const p = s.P[i];
          if (p.life > 0){
            p.life -= dt;
            const k = Math.exp(-p.drag * dt);
            p.vx *= k; p.vy = p.vy * k + p.g * dt; p.vz *= k;
            p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
          }
          const u = p.life > 0 ? 1 - p.life / p.max : 1;
          pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
          c[i * 3] = p.r; c[i * 3 + 1] = p.gg; c[i * 3 + 2] = p.b;
          sz[i] = p.life > 0 ? p.s0 + (p.s1 - p.s0) * u : 0;
          al[i] = p.life > 0 ? p.a0 * (u < 0.15 ? u / 0.15 : 1 - Math.pow((u - 0.15) / 0.85, 1.5)) : 0;
          sh[i] = p.shape;
        }
        for (const k of ["position", "aColor", "aSize", "aAlpha", "aShape"]) s.geo.attributes[k].needsUpdate = true;
      }
      // лента рывка
      if (dash.on){
        dash.t -= dt;
        if (dash.t <= 0){ dash.on = false; ribbon.visible = false; }
        else {
          const len = Math.max(0.2, Math.abs(dash.x - dash.x0));
          ribbon.visible = true;
          ribbon.position.set((dash.x + dash.x0) / 2 - dash.dir * 0.1, dash.y + 0.72, 0.25);
          ribbon.scale.set(len * dash.dir, 1.25, 1);
          ribbonMat.uniforms.uA.value = Math.min(1, dash.t / 0.12) * 1.0;
          if (dash.t < 0.14) dash.x0 += (dash.x - dash.x0) * Math.min(1, dt * 14);
        }
      }
    },
  };
  return api;
}
