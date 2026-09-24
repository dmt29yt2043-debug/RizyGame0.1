// Небо и задники «Идеалити»: готовые нарисованные слои assets/bg/*.png на разной глубине.
//   • sky-city — самый дальний, «приклеен» к камере (ребёнок камеры, cover по экрану);
//   • city-mid-a/b/c — средний план на глубине 70: шесть тайлов по кругу a→b→c с зеркалами, соседние
//     тайлы перекрываются и растворяются друг в друге мягкой альфой по краям (шов не виден), низ тоже
//     растворён; по x слой идёт за камерой на 30% (параллакс), по y — на 85% (город держится у горизонта,
//     сколько бы героиня ни забиралась вверх);
//   • clouds — облака на глубине 45: одна широкая плоскость, текстура повторяется с зеркалированием
//     (MirroredRepeat — швов нет по построению) и медленно дрейфует; 50% по x, 70% по y;
//   • hall — непрозрачный задник финального зала (глубина 26, неподвижен), левый край мягко растворён.
// Плюс окружение для PBR-отражений золота и хрома (createEnvironment → PMREM).
// Draw calls: sky 1 + видимые тайлы города (обычно 2–3) + облака 1 + зал 1 (только у финиша).
import * as THREE from "three";
import { PAL, CAM } from "../config.js";
import { makeRng } from "./tex.js";

const TAN = Math.tan(THREE.MathUtils.degToRad(CAM.fov / 2));
// TextureLoader резолвит обычную строку относительно URL страницы, а не модуля — берём абсолютный
// URL от этого файла (game/platformer/src/look/sky.js → ../../assets/bg/ = game/platformer/assets/bg/)
const BG = new URL("../../assets/bg/", import.meta.url).href;
const loader = new THREE.TextureLoader();

// загрузка PNG асинхронна: копим промисы, чтобы main.js мог дождаться готовности перед первым
// кадром (особенно важно для фоторежима — он рисует один кадр сразу, не дожидаясь сети/диска)
const _pending = [];
export function bgReady(){ return Promise.all(_pending); }

// dir — подпапка уровня относительно assets/bg/ ("" — уровень 1, "l2/" — уровень 2); onResult(ok) — если
// картинки ещё нет (уровень 2 генерируется параллельно с этой работой), вызывающий делает плавный фолбэк.
function loadBg(name, dir = "", onResult){
  let done;
  _pending.push(new Promise(res => { done = res; }));
  const t = loader.load(BG + dir + name,
    () => { done(); onResult && onResult(true); },
    undefined,
    err => { console.warn("[sky] не загрузилась", dir + name, err); done(); onResult && onResult(false); });
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

// ---------- процедурный фолбэк ночного неба: градиент + звёзды + луна (пока нет sky-night.png) ----------
function nightSkyFallback(){
  const W = 1024, H = 640, c = document.createElement("canvas"); c.width = W; c.height = H;
  const g = c.getContext("2d");
  const grd = g.createLinearGradient(0, 0, 0, H);
  grd.addColorStop(0, "#0c0f2e"); grd.addColorStop(0.55, "#241a3f"); grd.addColorStop(0.82, "#3a2a52"); grd.addColorStop(1, "#4a3860");
  g.fillStyle = grd; g.fillRect(0, 0, W, H);
  const rnd = makeRng(2026);
  for (let i = 0; i < 420; i++){
    const x = rnd() * W, y = rnd() * H * 0.72, r = rnd() * 1.3 + 0.2, a = 0.25 + rnd() * 0.65;
    g.fillStyle = `rgba(255,255,255,${a.toFixed(2)})`;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  // луна
  const mx = W * 0.74, my = H * 0.22, mr = 46;
  const mg = g.createRadialGradient(mx, my, 0, mx, my, mr * 2.6);
  mg.addColorStop(0, "rgba(226,232,255,0.55)"); mg.addColorStop(1, "rgba(226,232,255,0)");
  g.fillStyle = mg; g.beginPath(); g.arc(mx, my, mr * 2.6, 0, Math.PI * 2); g.fill();
  g.fillStyle = "#eef2ff"; g.beginPath(); g.arc(mx, my, mr, 0, Math.PI * 2); g.fill();
  g.fillStyle = "rgba(180,190,225,0.35)";
  for (const [dx, dy, r] of [[-12, -8, 9], [10, 6, 6], [-4, 14, 5]]){ g.beginPath(); g.arc(mx + dx, my + dy, r, 0, Math.PI * 2); g.fill(); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
// «cover»-размер плоскости (мировые ед.) на глубине depth (перед камерой), аспект картинки imgAspect,
// чтобы при аспекте экрана aspect края текстуры никогда не были видны (margin — запас)
function coverSize(depth, aspect, imgAspect, margin = 1.15){
  const hFrustum = depth * TAN * 2, wFrustum = hFrustum * aspect;
  const h = Math.max(hFrustum, wFrustum / imgAspect) * margin;
  return { w: h * imgAspect, h };
}

// ---------- НЕБО: sky-city.png (или ночью sky-night.png) — ребёнок камеры, самая дальняя,
// движение ~0 (в духе «5% от камеры»). dir — подпапка уровня; night — ночная гамма + фолбэк, пока
// нет картинки (see nightSkyFallback выше). ----------
export function createSky(camera, { dir = "", night = false } = {}){
  const name = night ? "sky-night.png" : "sky-city.png";
  const fallback = night ? nightSkyFallback() : null;
  const mat = new THREE.MeshBasicMaterial({ map: fallback, fog: false, depthWrite: false, depthTest: false });
  const tex = loadBg(name, dir, ok => {
    if (ok){ mat.map = tex; mat.needsUpdate = true; if (fallback) fallback.dispose(); }
    // !ok: картинки ещё нет — остаёмся на процедурном фолбэке (день без фолбэка — как раньше, просто пусто)
  });
  if (!night) mat.map = tex;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  mesh.name = "sky"; mesh.renderOrder = -100; mesh.frustumCulled = false;
  const DIST = 300, IMG_ASPECT = 1536 / 1024;
  mesh.position.set(0, 0, -DIST);
  camera.add(mesh);
  const fit = aspect => {
    const { w, h } = coverSize(DIST, aspect, IMG_ASPECT, 1.2);
    mesh.scale.set(w, h, 1);
  };
  fit(camera.aspect);
  return {
    mesh, fit, texture: tex,
    dispose(){ camera.remove(mesh); mesh.geometry.dispose(); mat.dispose(); if (fallback && mat.map !== fallback) fallback.dispose(); },
  };
}

// ---------- ОКРУЖЕНИЕ ДЛЯ ОТРАЖЕНИЙ: закатная панорама → PMREM ----------
// Золото и хром отражают scene.environment: офскрин-сфера, один раз прогнанная через PMREMGenerator.
// Верхняя полусфера — та же sky-city.png (зенит — розовые облака и купол, у горизонта — золотой город и
// солнце), нижняя — сгущается от тёплого горизонта к тёмной сливе. Именно тёмный низ делает металл
// металлом: золотой валик и хромовая чаша получают контраст «светлый блик — тёмный рефлекс», а не
// заливаются ровным оранжевым. Нет картинки — вместо неё процедурный закатный градиент (ночью — холодный,
// лунно-фиолетовый: см. pal.night в вызове из main.js).
export function createEnvironment(renderer, panorama, { night = false } = {}){
  const hasPano = !!(panorama && panorama.image && panorama.image.width);
  const scene = new THREE.Scene();
  const geo = new THREE.SphereGeometry(1, 48, 24);
  // ночной процедурный фолбэк: лунно-голубой зенит → сливовый горизонт, холодный «блик» вместо солнечного
  const NP = night ? {
    low: 0x2a2050, mid: 0x362a5c, top: 0x171331, sun: 0xcfe0ff, ground: 0x0e0a20, horizon: 0x3a2c55,
    glint: 0xbcd4ff,
  } : {
    low: PAL.skyLow, mid: PAL.skyMid, top: PAL.skyTop, sun: PAL.sun, ground: 0x5d5878, horizon: 0xf6d2b8,
    glint: 0xfff0d8,
  };
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, fog: false, depthWrite: false,
    uniforms: {
      uPano: { value: hasPano ? panorama : null }, uHas: { value: hasPano ? 1 : 0 },
      uLow: { value: new THREE.Color(NP.low) }, uMid: { value: new THREE.Color(NP.mid) }, uTop: { value: new THREE.Color(NP.top) },
      uSun: { value: new THREE.Color(NP.sun) }, uSunDir: { value: new THREE.Vector3(night ? -0.5 : 0.6, 0.3, 0.5).normalize() },
      uGround: { value: new THREE.Color(NP.ground) }, uHorizon: { value: new THREE.Color(NP.horizon) },
      uGlint: { value: new THREE.Vector3(night ? -0.16 : 0.16, 0.36, 0.92).normalize() }, uGlintC: { value: new THREE.Color(NP.glint).multiplyScalar(night ? 3 : 7) },
    },
    vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      varying vec3 vP;
      uniform sampler2D uPano; uniform float uHas;
      uniform vec3 uLow, uMid, uTop, uSun, uSunDir, uGround, uHorizon, uGlint, uGlintC;
      void main(){
        vec3 d = normalize(vP);
        vec3 sky;
        if (uHas > 0.5){
          // картинка на верхнюю полусферу: зенит — верх кадра, горизонт — линия города (v ≈ 0.66)
          float u = atan(d.x, -d.z) / 6.2831853 + 0.5;
          float el = asin(clamp(d.y, 0.0, 1.0)) / 1.5707963;
          vec2 uv = vec2(u, 1.0 - 0.66 * (1.0 - el));
          sky = texture2D(uPano, uv).rgb;
        } else {
          sky = mix(uLow, uMid, smoothstep(0.0, 0.25, d.y));
          sky = mix(sky, uTop, smoothstep(0.2, 0.9, d.y));
          sky += uSun * pow(max(dot(d, uSunDir), 0.0), 9.0) * 1.2;
        }
        // низ: от тёплого горизонта к тёмной сливе
        vec3 ground = mix(uHorizon, uGround, smoothstep(0.1, 0.65, -d.y));   // полоса у горизонта светлая — хром серебрится
        vec3 c = d.y >= 0.0 ? sky : ground;
        c = mix(c, mix(sky, uHorizon, 0.5), (1.0 - smoothstep(0.0, 0.04, abs(d.y))) * 0.5);   // мягкий шов горизонта
        // HDR-блик закатного «окна» сверху-сзади камеры: его ловят золотые валики и хромовые чаши лицом
        // к зрителю — яркая кромка выше порога bloom (светящиеся золотые края, как в референсе)
        c += uGlintC * pow(max(dot(d, uGlint), 0.0), 90.0);
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  scene.add(new THREE.Mesh(geo, mat));
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(scene, 0.02).texture;
  pmrem.dispose();
  geo.dispose(); mat.dispose();
  return tex;
}

// ---------- ЗАДНИКИ ----------
// материал слоя: карта + мягкое затухание альфы к краям плоскости (по «сырым» uv, не по uv карты —
// у облаков карта повторяется и дрейфует): fx — доля ширины с каждого бока, fb/ft — снизу/сверху
function fadeMaterial(map, { fx = 0, fb = 0, ft = 0, opacity = 1, solid = 0 } = {}){
  const mat = new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, fog: false, opacity });
  mat.onBeforeCompile = sh => {
    sh.uniforms.uFade = { value: new THREE.Vector3(fx, fb, ft) };
    sh.uniforms.uSolid = { value: solid };
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vFadeUv;")
      .replace("#include <uv_vertex>", "#include <uv_vertex>\nvFadeUv = uv;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec3 uFade;\nuniform float uSolid;\nvarying vec2 vFadeUv;")
      .replace("#include <map_fragment>", `#include <map_fragment>
        // uSolid > 0: полупрозрачные края вырезки (стеклянные башни) делаем плотнее — меньше «призраков»
        if (uSolid > 0.0) diffuseColor.a = mix(diffuseColor.a, smoothstep(0.02, 0.55, diffuseColor.a), uSolid);
        float fadeK = 1.0;
        if (uFade.x > 0.0) fadeK *= smoothstep(0.0, uFade.x, vFadeUv.x) * smoothstep(0.0, uFade.x, 1.0 - vFadeUv.x);
        if (uFade.y > 0.0) fadeK *= smoothstep(0.0, uFade.y, vFadeUv.y);
        if (uFade.z > 0.0) fadeK *= smoothstep(0.0, uFade.z, 1.0 - vFadeUv.y);
        diffuseColor.a *= fadeK;`);
  };
  mat.customProgramCacheKey = () => "bg-fade";
  return mat;
}

// видимая полувысота кадра на расстоянии D от камеры и y центра кадра там же (камера смотрит чуть вниз)
const halfH = D => D * TAN;
const centerY = (camY, D) => camY + CAM.height - D * (CAM.height - CAM.lookUp) / CAM.dist;

// dir — подпапка уровня ("" | "l2/"); night — ночные имена файлов (city-night-*, clouds-night, finale-night);
// декоративные слои (город/облака), которых ещё нет на диске, просто прячутся (без «дыр»/белых прямоугольников)
// до появления файла — перезагрузка уровня подхватит их сама (см. main.js: level switch пересобирает backdrop).
export function createBackdrop(level, { dir = "", night = false } = {}){
  const group = new THREE.Group(); group.name = "backdrop";
  const IMG_ASPECT = 1536 / 1024;
  const levelMid = (level.minX + level.maxX) / 2;
  const REF_Y = 1.5;                         // типичная высота камеры (по ней раскладываем слои)
  const layers = [];
  const disposers = [];

  // ---- город: 6 тайлов a/b/c с зеркалами, перекрытие = ширина растворения краёв ----
  {
    const D = 70, P = 0.3, PY = 0.85, FX = 0.17;
    const hh = halfH(D), h = 34, w = h * IMG_ASPECT;
    const yBot = centerY(REF_Y, D) - 0.86 * hh;                         // низ облачного подножия — под кадром
    const names = night ? ["city-night-a.png", "city-night-b.png", "city-night-c.png"] : ["city-mid-a.png", "city-mid-b.png", "city-mid-c.png"];
    const texs = names.map((n, i) => loadBg(n, dir, ok => { if (!ok) mats[i].opacity = 0; }));
    const mats = texs.map(t => fadeMaterial(t, { fx: FX, fb: 0.12, solid: 1 }));
    disposers.push(() => { for (const t of texs) t.dispose(); for (const m of mats) m.dispose(); });
    // ход камеры по x → какой диапазон локальных x слоя вообще виден (с запасом на 21:9)
    const camMin = level.minX - 2, camMax = level.maxX + 2, halfW = hh * 2.4;
    const lo = camMin - halfW - (camMin - levelMid) * P, hi = camMax + halfW - (camMax - levelMid) * P;
    const step = w * (1 - FX);
    const n = Math.ceil((hi - lo - w) / step) + 1;
    const order = [0, 1, 2, 0, 2, 1, 0, 1, 2];
    const mid = new THREE.Group(); mid.name = "city-mid";
    for (let i = 0; i < n; i++){
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mats[order[i % order.length]]);
      mesh.position.set(lo + w / 2 + i * step, yBot + h / 2, CAM.dist - D);
      if (i % 2 === 1) mesh.scale.x = -1;                                // каждый второй — зеркально
      mesh.renderOrder = -50;
      mid.add(mesh);
    }
    group.add(mid);
    layers.push({ g: mid, P, PY });
  }

  // ---- облака: одна широкая плоскость, MirroredRepeat по x, медленный дрейф ----
  let cloudsTex;
  {
    const D = 45, P = 0.5, PY = 0.7;
    const hh = halfH(D), h = hh * 2.05, w = h * IMG_ASPECT;
    const yBot = centerY(REF_Y, D) - 1.02 * hh;
    const camMin = level.minX - 2, camMax = level.maxX + 2, halfW = hh * 2.4;
    const lo = camMin - halfW - (camMin - levelMid) * P, hi = camMax + halfW - (camMax - levelMid) * P;
    const reps = Math.ceil((hi - lo) / w);
    const cloudsMat = fadeMaterial(null, { fb: 0.1, fx: 0.02, opacity: 0.88 });
    cloudsTex = loadBg(night ? "clouds-night.png" : "clouds.png", dir, ok => {
      if (!ok){ cloudsMat.opacity = 0; return; }
      cloudsTex.wrapS = THREE.MirroredRepeatWrapping; cloudsTex.wrapT = THREE.ClampToEdgeWrapping;
      cloudsTex.repeat.set(reps, 1);
      cloudsMat.map = cloudsTex; cloudsMat.needsUpdate = true;
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w * reps, h), cloudsMat);
    mesh.position.set((lo + hi) / 2, yBot + h / 2, CAM.dist - D);
    mesh.renderOrder = -40;
    const g = new THREE.Group(); g.name = "clouds"; g.add(mesh);
    group.add(g);
    layers.push({ g, P, PY });
    disposers.push(() => { cloudsTex.dispose(); cloudsMat.dispose(); });
  }

  // ---- зал у финиша: непрозрачный, неподвижный; левый край (≈4 ед.) мягко растворяется в город.
  // Ночью — finale-night.png (интерьер лунной обсерватории); нет файла — процедурный ночной градиент. ----
  {
    const D = 26, w = 46, h = w / IMG_ASPECT;
    const fallback = night ? nightSkyFallback() : null;
    const mat = new THREE.MeshBasicMaterial({ map: fallback, transparent: true, depthWrite: false, fog: false });
    mat.onBeforeCompile = sh => {
      sh.fragmentShader = sh.fragmentShader.replace("#include <map_fragment>", `#include <map_fragment>
        diffuseColor.a *= smoothstep(0.0, 0.09, vMapUv.x) * smoothstep(0.0, 0.06, 1.0 - vMapUv.y);`);
    };
    mat.customProgramCacheKey = () => "bg-hall";
    const hallTex = loadBg(night ? "finale-night.png" : "hall.png", dir, ok => {
      if (ok){ mat.map = hallTex; mat.needsUpdate = true; if (fallback) fallback.dispose(); }
    });
    if (!night) mat.map = hallTex;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    mesh.position.set(level.heart.x - 3, centerY(3, D) + 1.2, CAM.dist - D);
    mesh.renderOrder = -30;
    mesh.name = "hall";
    group.add(mesh);
    disposers.push(() => { hallTex.dispose(); mat.dispose(); if (fallback && mat.map !== fallback) fallback.dispose(); });
  }

  return {
    group,
    // t — время мира (абсолютное, стоит на паузе), camX/camY — текущая точка кадра (параллакс)
    update(t, camX, camY){
      const cx = camX ?? levelMid, cy = camY ?? REF_Y;
      for (const L of layers){
        L.g.position.x = (cx - levelMid) * L.P;
        L.g.position.y = (cy - REF_Y) * L.PY;
      }
      cloudsTex.offset.x = (t * 0.004) % 2;
    },
    dispose(){
      group.traverse(o => { if (o.isMesh) o.geometry.dispose(); });
      for (const d of disposers) d();
    },
  };
}
