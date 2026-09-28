// «Живой» фон и мелкие огоньки — один общий THREE.Points (1 draw call на ВСЁ, бюджет ≤150 тесный):
//   • летающие тарелки (хром/золото, с огоньками) — пересекают небо на разной глубине, день и ночь;
//   • день — лепестки и пыльца в воздухе; ночь — светлячки у лиан/цветов и редкие падающие звёзды;
//   • тёплые окна ночных стен (мерцают, некоторые чаще) и искры-акценты ориентиров (landmarks.js) —
//     тоже точки этой системы, не отдельные меши;
//   • редкий размытый передний слой у камеры (кусты/фонари/перила силуэтами, z ≈ +6…+9) — выключен на low.
// Всё — точечные спрайты с процедурной формой во фрагментном шейдере (как fx.js), без текстур и без
// лишних геометрий. Учитывает ?q=low (меньше саучеров/пыли, передний план выключен).
import * as THREE from "three";
import { CAM } from "../config.js";
import { makeRng } from "./tex.js";
import { ZF, CAP } from "./walls.js";
import { landmarkGlowSpots } from "./landmarks.js";
import { loadProgress } from "../save.js";

// пикселей на мировую единицу на расстоянии 1 от камеры (как в fx.js) — свой расчёт, без renderer/camera:
// FOV — константа (CAM.fov), высота вьюпорта — из window (в физических пикселях, ×DPR, как у канваса)
const TAN_HALF_FOV = Math.tan(THREE.MathUtils.degToRad(CAM.fov / 2));
function pixelScale(){
  const dpr = Math.min(devicePixelRatio || 1, 2);
  return (innerHeight * dpr) / (2 * TAN_HALF_FOV);
}

// качество читаем сами (URL ?q=, иначе сохранённое) — main.js этот модуль не знает и не должен: встраиваемся
// только через backdrop (см. sky.js), поэтому дублируем маленький кусочек логики выбора качества здесь.
function currentQuality(){
  try {
    const q = new URLSearchParams(location.search).get("q");
    if (q === "low" || q === "med" || q === "high") return q;
    const p = loadProgress(); if (p && p.quality) return p.quality;
  } catch (e){ /* SSR/без DOM — не должно случаться в браузере, но не роняем игру */ }
  return "med";
}

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
    gl_PointSize = aSize * uScale / max(0.05, -mv.z);   // защита от деления на ноль/отрицательного знаменателя
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
      a = smoothstep(1.0, 0.2, length(p));                                    // мягкий кружок: огонёк/лепесток/искра
    } else if (vShape < 1.5){
      // падающая звезда: горизонтальный штрих, ярче у головы (+x), гаснет к хвосту (-x)
      float body = smoothstep(1.0, 0.0, abs(p.y) * 7.0);
      float tail = clamp(smoothstep(-1.0, 0.7, p.x), 0.0, 1.0) * smoothstep(1.0, 0.3, p.x);
      a = body * tail;
    } else {
      // тарелка: приплюснутый корпус + купол сверху, с двумя огоньками по бокам
      vec2 q = vec2(p.x, p.y * 2.4);
      float body = smoothstep(1.0, 0.72, length(q));
      vec2 dq = vec2(p.x * 1.7, (p.y - 0.3) * 1.9);
      float dome = smoothstep(1.0, 0.55, length(dq));
      float shade = 1.0 - 0.3 * clamp(p.y * 0.7 + 0.35, 0.0, 1.0);
      a = clamp(max(body, dome * 0.95), 0.0, 1.0) * shade;
      float l1 = smoothstep(0.22, 0.0, length(p - vec2(0.55, -0.02)));
      float l2 = smoothstep(0.22, 0.0, length(p - vec2(-0.55, -0.02)));
      a = clamp(a + (l1 + l2) * 0.9, 0.0, 1.0);
    }
    if (a * vAlpha < 0.008) discard;
    gl_FragColor = vec4(vColor, a * vAlpha);
    #include <colorspace_fragment>
  }`;

// окна на лицах стен (ночь): точки-искры со своей случайной фазой мерцания; башни ("tower") пропускаем —
// узкое лицо колонны окнами не украшают в этом языке форм
function scatterWindows(level, rnd){
  const pts = [];
  for (const s of level.solids){
    if (s.kind === "tower") continue;
    const w = s.x1 - s.x0, yTop = s.y1 + CAP.bottom, h = yTop - s.y0;
    if (w < 2.6 || h < 2.1) continue;
    const cols = Math.max(1, Math.round(w / 1.15)), rows = Math.min(3, Math.max(1, Math.round((h - 1.3) / 1.35)));
    for (let r = 0; r < rows; r++){
      const y = yTop - 0.75 - r * 1.35;
      if (y < s.y0 + 0.6) continue;
      for (let c = 0; c < cols; c++){
        if (rnd() < 0.34) continue;                                            // не все окна светятся
        const x = s.x0 + (c + 0.5) * (w / cols) + (rnd() - 0.5) * 0.3;
        pts.push({ x, y, z: ZF + 0.05, phase: rnd() * 62.8, flick: rnd() < 0.3 });
      }
    }
  }
  return pts;
}
// передний слой (кусты/фонари/перила силуэтами) — редкие точки по нижнему краю и краям кадра, близко к
// камере (z ≈ +6…+9); никогда не в полосе, где стоит Ризи по высоте — только у самой земли соседних ярусов
function scatterForeground(level, rnd){
  const pts = [];
  const span = level.maxX - level.minX;
  const n = Math.max(2, Math.round(span / 23));
  for (let i = 0; i < n; i++){
    const x = level.minX + (i + 0.3 + rnd() * 0.5) * (span / n);
    let gy = 0, bd = Infinity;
    for (const s of level.solids){ const d = x < s.x0 ? s.x0 - x : x > s.x1 ? x - s.x1 : 0; if (d < bd){ bd = d; gy = s.y1; } }
    const kind = rnd();
    const h = kind < 0.5 ? 0.5 + rnd() * 0.3 : 0.9 + rnd() * 0.7;               // куст ниже, фонарь/перила выше
    // size — в мировых единицах; передний план совсем близко к камере (z≈+7), поэтому даже небольшой
    // мировой размер даёт крупное мягкое пятно на экране (см. pixelScale() — перспективный масштаб точек)
    pts.push({ x, y: gy + h, z: 6.4 + rnd() * 2.0, size: (kind < 0.5 ? 0.6 : 0.85) + rnd() * 0.35, dark: kind < 0.5 });
  }
  return pts;
}

export function createLife(level, { night = false } = {}){
  const Q = currentQuality();
  const group = new THREE.Group(); group.name = "life";
  const rnd = makeRng(night ? 9001 : 9002);

  const nSaucer = Q === "low" ? 2 : Q === "high" ? 5 : 4;
  const nAmbient = Q === "low" ? 9 : Q === "high" ? 26 : 18;
  const nShoot = night ? (Q === "low" ? 1 : Q === "high" ? 3 : 2) : 0;
  const fgOn = Q !== "low";

  const minX = level.minX, maxX = level.maxX, span = Math.max(1, maxX - minX);

  // саучеры: «дом» на своём участке уровня, дрейфуют туда-сюда широкой дугой — почти всегда где-то рядом
  const saucers = Array.from({ length: nSaucer }, (_, i) => ({
    hx: minX + (i + 0.5) / nSaucer * span,
    amp: 11 + 7 * ((i * 7) % 3), spd: 0.045 + 0.018 * (i % 3), ph: i * 1.9,
    z: -15 - ((i * 11) % 4) * 6.5, yOff: 6.6 + 1.4 * ((i * 5) % 4),
  }));
  // амбиент — лепестки/пыльца (день) или светлячки (ночь), крутятся у текущей позиции камеры по x
  const ambient = Array.from({ length: nAmbient }, (_, i) => ({
    lx: (rnd() - 0.5) * 26, ySeed: rnd(), spd: 0.3 + rnd() * 0.5, ph: rnd() * 6.28,
    bob: 0.4 + rnd() * 0.9, drift: (rnd() - 0.5) * 0.5,
  }));
  const shooters = Array.from({ length: nShoot }, (_, i) => ({ period: 6.5 + i * 3.3, dur: 0.55 + rnd() * 0.3, ph: rnd() * 20, lane: rnd() }));
  const winPts = night ? scatterWindows(level, makeRng(4004)) : [];
  const glowPts = landmarkGlowSpots(level, night);
  const fgPts = fgOn ? scatterForeground(level, makeRng(5005)) : [];

  const N = Math.max(1, saucers.length + ambient.length + shooters.length + winPts.length + glowPts.length + fgPts.length);
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(N * 3), col = new Float32Array(N * 3), size = new Float32Array(N), alpha = new Float32Array(N), shape = new Float32Array(N);
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute("aColor", new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute("aAlpha", new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute("aShape", new THREE.BufferAttribute(shape, 1).setUsage(THREE.DynamicDrawUsage));
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, uniforms: { uScale: { value: pixelScale() } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false; pts.renderOrder = 3; pts.name = "life-points";
  group.add(pts);

  const AMBIENT_DAY = [0xfff0f6, 0xffe3ef, 0xd8fff0];       // лепестки/пыльца
  const AMBIENT_NIGHT = [0xd7ffb0, 0xc9ffe0, 0xfff3b0];     // светлячки
  const _c = new THREE.Color();

  function update(t, camX, camY){
    mat.uniforms.uScale.value = pixelScale();     // на случай ресайза окна — дёшево, 2 обращения к window
    let i = 0;
    // саучеры
    for (const s of saucers){
      const x = s.hx + Math.sin(t * s.spd + s.ph) * s.amp;
      const y = (camY ?? 0) + s.yOff + Math.sin(t * 0.25 + s.ph) * 0.9;
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = s.z;
      _c.set(0xeef2fb);
      col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b;
      size[i] = 1.6; alpha[i] = 0.92; shape[i] = 2; i++;
    }
    // амбиент (лепестки/пыльца/светлячки) — крутятся вокруг текущей позиции камеры по x, мягкий дрейф/мерцание
    const cx = camX ?? 0, cy = camY ?? 1.5;
    for (const p of ambient){
      let lx = ((p.lx + t * p.drift + 13) % 26) - 13;                        // зациклено в полосе ±13 от камеры
      const x = cx + lx, y = cy + 0.5 + p.ySeed * 6.5 + Math.sin(t * p.spd + p.ph) * p.bob;
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = -1.5 - p.ySeed * 3;
      const pal = night ? AMBIENT_NIGHT : AMBIENT_DAY;
      _c.set(pal[i % pal.length]);
      col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b;
      const tw = night ? (0.5 + 0.5 * Math.max(0, Math.sin(t * 2.1 + p.ph * 3))) : 1;
      size[i] = night ? 0.22 + 0.09 * tw : 0.16; alpha[i] = (night ? 0.55 + 0.45 * tw : 0.7); shape[i] = 0; i++;
    }
    // падающие звёзды: большую часть времени спят (alpha 0), раз в period коротко пролетают
    for (const s of shooters){
      const ph = ((t + s.ph) % s.period);
      if (ph < s.dur){
        const k = ph / s.dur;
        const x0 = cx - 11 - s.lane * 6, x1 = cx + 11 + (1 - s.lane) * 6;
        pos[i * 3] = x0 + (x1 - x0) * k;
        pos[i * 3 + 1] = cy + 9 - s.lane * 2 - k * 3.2;
        pos[i * 3 + 2] = -6 - s.lane * 3;
        size[i] = 1.3; alpha[i] = Math.sin(Math.PI * Math.min(1, k * 1.4)) * 0.95; shape[i] = 1;
        _c.set(0xf3f6ff);
        col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b;
      } else { pos[i * 3 + 1] = -999; alpha[i] = 0; size[i] = 0; shape[i] = 1; }
      i++;
    }
    // окна (ночь) — статичные, тёплое мерцание у части из них
    for (const w of winPts){
      pos[i * 3] = w.x; pos[i * 3 + 1] = w.y; pos[i * 3 + 2] = w.z;
      const flick = w.flick ? (0.6 + 0.4 * Math.max(0, Math.sin(t * 3.1 + w.phase))) : (0.88 + 0.12 * Math.sin(t * 0.6 + w.phase));
      _c.set(0xffcf82).multiplyScalar(0.85 + 0.3 * flick);
      col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b;
      size[i] = 0.4; alpha[i] = 0.55 * flick + 0.15; shape[i] = 0; i++;
    }
    // искры-акценты ориентиров — мягкий пульс
    for (const g of glowPts){
      pos[i * 3] = g.x; pos[i * 3 + 1] = g.y; pos[i * 3 + 2] = g.z;
      const pulse = 0.75 + 0.25 * Math.sin(t * 1.6 + (g.x || 0));
      _c.set(g.color).multiplyScalar(1 + 0.4 * pulse);
      col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b;
      size[i] = (g.size || 0.2) * 1.3; alpha[i] = 0.8 * pulse + 0.2; shape[i] = 0; i++;
    }
    // передний план — редкие мягкие пятна-«боке» у камеры (аддитивный блендинг физически не может
    // затемнять — на светлом пастельном небе тёмное пятно тонет и не читается; вместо ложных «теней»
    // это мягкий расфокусированный блик, как боке на объективе — приглушённый, тёплый днём/холодный ночью)
    const fgCol = night ? 0xc9d4ff : 0xffe6c2;
    for (const f of fgPts){
      pos[i * 3] = f.x; pos[i * 3 + 1] = f.y; pos[i * 3 + 2] = f.z;
      _c.set(fgCol);
      col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b;
      size[i] = f.size; alpha[i] = 0.22; shape[i] = 0; i++;
    }
    geo.attributes.position.needsUpdate = true; geo.attributes.aColor.needsUpdate = true;
    geo.attributes.aSize.needsUpdate = true; geo.attributes.aAlpha.needsUpdate = true; geo.attributes.aShape.needsUpdate = true;
  }
  // первый кадр сразу — иначе один тик виден пустой каркас (важно для фоторежима, который рисует один кадр)
  update(0, (level.minX + level.maxX) / 2, 1.5);

  return {
    group, update,
    dispose(){ geo.dispose(); mat.dispose(); },
  };
}
