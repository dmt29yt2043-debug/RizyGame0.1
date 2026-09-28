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
import { createLife } from "./life.js";
import { createCloudBanks } from "./cloudbank.js";

const TAN = Math.tan(THREE.MathUtils.degToRad(CAM.fov / 2));
// TextureLoader резолвит обычную строку относительно URL страницы, а не модуля — берём абсолютный
// URL от этого файла (game/platformer/src/look/sky.js → ../../assets/bg/ = game/platformer/assets/bg/)
const BG = new URL("../../assets/bg/", import.meta.url).href;

// загрузка PNG асинхронна: копим промисы, чтобы main.js мог дождаться готовности перед первым
// кадром (особенно важно для фоторежима — он рисует один кадр сразу, не дожидаясь сети/диска)
const _pending = [];
export function bgReady(){ return Promise.all(_pending); }

// «Ложная глубина резкости»: нарисованные слои один раз размываем при загрузке (canvas-фильтр blur), дальние
// сильнее ближних — игровой слой становится самым резким и контрастным в кадре (столп «Ризи — звезда кадра»).
// Настоящий BokehPass остаётся только на high (post.js). Нет ctx.filter (старый Safari) — размытие
// уменьшением-увеличением. px — радиус в пикселях картинки 1536×1024.
function blurImage(img, px){
  if (!(px > 0)) return img;
  const W = img.width, H = img.height;
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const g = c.getContext("2d");
  if (typeof g.filter === "string"){
    // края слоёв и так растворены альфой (fadeMaterial), у неба края за кадром — полей под размытие не нужно
    g.filter = `blur(${px}px)`;
    g.drawImage(img, 0, 0);
    g.filter = "none";
    return c;
  }
  const k = Math.max(1.5, 1 + px * 0.6), sw = Math.max(8, Math.round(W / k)), sh = Math.max(8, Math.round(H / k));
  const small = document.createElement("canvas"); small.width = sw; small.height = sh;
  const sg = small.getContext("2d"); sg.imageSmoothingQuality = "high"; sg.drawImage(img, 0, 0, sw, sh);
  g.clearRect(0, 0, W, H); g.imageSmoothingQuality = "high"; g.drawImage(small, 0, 0, W, H);
  return c;
}
const imgLoader = new THREE.ImageLoader();

// dir — подпапка уровня относительно assets/bg/ ("" — уровень 1, "l2/" — уровень 2); onResult(ok) — если
// картинки ещё нет (уровень 2 генерируется параллельно с этой работой), вызывающий делает плавный фолбэк.
// blur — радиус «ложной глубины резкости» (см. blurImage).
function loadBg(name, dir = "", onResult, blur = 0){
  let done;
  _pending.push(new Promise(res => { done = res; }));
  const t = new THREE.Texture();
  imgLoader.load(BG + dir + name,
    img => { t.image = blurImage(img, blur); t.needsUpdate = true; done(); onResult && onResult(true); },
    undefined,
    err => { console.warn("[sky] не загрузилась", dir + name, err); done(); onResult && onResult(false); });
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}
// радиусы размытия по глубине (небо — дальше всех)
const BLUR = { sky: 3.2, city: 2.6, clouds: 1.6, hall: 0.8 };

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
  }, BLUR.sky);
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
  // низ — не тёмная «земля», а море облаков под городом (светлое, в цвет облаков задника): хромовые
  // выкружки и чаши под ярусами отражают именно его — светлый металл с тёплыми рефлексами, как в концепте
  const NP = night ? {
    low: 0x2a2050, mid: 0x362a5c, top: 0x171331, sun: 0xcfe0ff, ground: 0x2a2352, horizon: 0x6a5fa6,
    glint: 0xbcd4ff,
  } : {
    low: PAL.skyLow, mid: PAL.skyMid, top: PAL.skyTop, sun: PAL.sun, ground: 0xc39aa0, horizon: 0xf8d6bf,
    glint: 0xfff0d8,
  };
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, fog: false, depthWrite: false,
    uniforms: {
      uPano: { value: hasPano ? panorama : null }, uHas: { value: hasPano ? 1 : 0 },
      uLow: { value: new THREE.Color(NP.low) }, uMid: { value: new THREE.Color(NP.mid) }, uTop: { value: new THREE.Color(NP.top) },
      uSun: { value: new THREE.Color(NP.sun) }, uSunDir: { value: new THREE.Vector3(night ? -0.5 : 0.6, 0.3, 0.5).normalize() },
      uGround: { value: new THREE.Color(NP.ground) }, uHorizon: { value: new THREE.Color(NP.horizon) },
      uGlint: { value: new THREE.Vector3(night ? -0.05 : 0.05, 0.34, 0.94).normalize() }, uGlintC: { value: new THREE.Color(NP.glint).multiplyScalar(night ? 5 : 9) },
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
          // картинка на верхнюю полусферу: зенит — верх кадра, горизонт — линия города (v ≈ 0.66).
          // По горизонтали — зеркально и без шва: вглубь сцены (−z) — середина картинки (город), за спиной
          // камеры (+z) — правый край (закат и солнце): лицевые грани отражают тёплый закат, а не шов картинки
          float u = 0.5 + 0.5 * abs(atan(d.x, -d.z)) / 3.14159265;
          float el = asin(clamp(d.y, 0.0, 1.0)) / 1.5707963;
          vec2 uv = vec2(u, 1.0 - 0.66 * (1.0 - el));
          sky = texture2D(uPano, uv).rgb;
        } else {
          sky = mix(uLow, uMid, smoothstep(0.0, 0.25, d.y));
          sky = mix(sky, uTop, smoothstep(0.2, 0.9, d.y));
          sky += uSun * pow(max(dot(d, uSunDir), 0.0), 9.0) * 1.2;
        }
        // низ: от тёплого горизонта к тёмной сливе
        vec3 ground = mix(uHorizon, uGround, smoothstep(0.05, 0.8, -d.y));   // облака под городом: светлые у горизонта, глубже — сиреневее
        vec3 c = d.y >= 0.0 ? sky : ground;
        c = mix(c, mix(sky, uHorizon, 0.5), (1.0 - smoothstep(0.0, 0.04, abs(d.y))) * 0.5);   // мягкий шов горизонта
        // HDR-блик закатного «окна» сверху-сзади камеры: его ловят золотые валики и хромовые чаши лицом
        // к зрителю — яркая кромка выше порога bloom (светящиеся золотые края, как в референсе)
        // (почти по центру за камерой: скруглённые кромки ярусов, ободы дисков и бусины золота ловят его
        // блестящей линией — главный «лак» мрамора и блеск золота, как в концепте)
        c += uGlintC * pow(max(dot(d, uGlint), 0.0), 60.0);
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
// у облаков карта повторяется и дрейфует): fx — доля ширины с каждого бока, fb/ft — снизу/сверху.
// grade — иерархия слоёв (столп «Ризи — звезда кадра»): нарисованный задник чуть приглушаем (desat —
// снижение насыщенности, contrast<1 — снижение контраста) и уводим в лёгкую дымку цвета неба (haze/
// hazeColor) — тонко, 10-20%, чтобы не убить красоту фона; игровой слой (стены/кристаллы/Ризи) остаётся
// самым «вкусным». twinkle (только ночной город) — лёгкое мерцание огней, см. createBackdrop.update().
function fadeMaterial(map, { fx = 0, fb = 0, ft = 0, opacity = 1, solid = 0, desat = 0, haze = 0, hazeColor = 0xffffff, contrast = 1 } = {}){
  const mat = new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, fog: false, opacity });
  mat.onBeforeCompile = sh => {
    sh.uniforms.uFade = { value: new THREE.Vector3(fx, fb, ft) };
    sh.uniforms.uSolid = { value: solid };
    sh.uniforms.uGrade = { value: new THREE.Vector4(desat, haze, contrast, 0) };
    sh.uniforms.uHaze = { value: new THREE.Color(hazeColor) };
    sh.uniforms.uTwinkle = { value: 0 };
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vFadeUv;")
      .replace("#include <uv_vertex>", "#include <uv_vertex>\nvFadeUv = uv;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec3 uFade;\nuniform float uSolid;\nuniform vec4 uGrade;\nuniform vec3 uHaze;\nuniform float uTwinkle;\nvarying vec2 vFadeUv;")
      .replace("#include <map_fragment>", `#include <map_fragment>
        float bgLum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(bgLum), uGrade.x);
        diffuseColor.rgb = mix(diffuseColor.rgb, uHaze, uGrade.y);
        diffuseColor.rgb = (diffuseColor.rgb - 0.5) * uGrade.z + 0.5 + uTwinkle;
        // uSolid > 0: полупрозрачные края вырезки (стеклянные башни) делаем плотнее — меньше «призраков»
        if (uSolid > 0.0) diffuseColor.a = mix(diffuseColor.a, smoothstep(0.02, 0.55, diffuseColor.a), uSolid);
        float fadeK = 1.0;
        if (uFade.x > 0.0) fadeK *= smoothstep(0.0, uFade.x, vFadeUv.x) * smoothstep(0.0, uFade.x, 1.0 - vFadeUv.x);
        if (uFade.y > 0.0) fadeK *= smoothstep(0.0, uFade.y, vFadeUv.y);
        if (uFade.z > 0.0) fadeK *= smoothstep(0.0, uFade.z, 1.0 - vFadeUv.y);
        diffuseColor.a *= fadeK;`);
    mat.userData.shader = sh;
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
  // иерархия слоёв (столп «Ризи — звезда кадра», см. fadeMaterial выше): дальний расписной город —
  // самая приглушённая/холодная дымка; облака — вполовину слабее (они и так мягкие); зал у финиша
  // («золотой зал», «обсерватория») не трогаем — он уже эталон композиции по ревью.
  const gradeCity = night
    ? { desat: 0.18, haze: 0.18, hazeColor: 0x5b5aa0, contrast: 0.82 }
    : { desat: 0.16, haze: 0.17, hazeColor: 0xffd9c4, contrast: 0.82 };
  const gradeClouds = night
    ? { desat: 0.1, haze: 0.11, hazeColor: 0x6a6ab0, contrast: 0.9 }
    : { desat: 0.08, haze: 0.09, hazeColor: 0xffe6d4, contrast: 0.9 };

  // ---- город: 6 тайлов a/b/c с зеркалами, перекрытие = ширина растворения краёв ----
  let cityMats = [];
  {
    const D = 70, P = 0.3, PY = 0.85, FX = 0.17;
    const hh = halfH(D), h = 34, w = h * IMG_ASPECT;
    const yBot = centerY(REF_Y, D) - 0.86 * hh;                         // низ облачного подножия — под кадром
    const names = night ? ["city-night-a.png", "city-night-b.png", "city-night-c.png"] : ["city-mid-a.png", "city-mid-b.png", "city-mid-c.png"];
    const texs = names.map((n, i) => loadBg(n, dir, ok => { if (!ok) mats[i].opacity = 0; }, BLUR.city));
    const mats = texs.map(t => fadeMaterial(t, { fx: FX, fb: 0.12, solid: 1, ...gradeCity }));
    cityMats = mats;
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

  // ---- облака под ярусами (cloudbank.js): мир, без параллакса; текстуру получат, когда загрузятся облака ----
  const banks = createCloudBanks(level);
  group.add(banks.mesh);
  disposers.push(() => banks.dispose());

  // ---- облака: одна широкая плоскость, MirroredRepeat по x, медленный дрейф ----
  let cloudsTex;
  {
    const D = 45, P = 0.5, PY = 0.7;
    const hh = halfH(D), h = hh * 2.05, w = h * IMG_ASPECT;
    const yBot = centerY(REF_Y, D) - 1.02 * hh;
    const camMin = level.minX - 2, camMax = level.maxX + 2, halfW = hh * 2.4;
    const lo = camMin - halfW - (camMin - levelMid) * P, hi = camMax + halfW - (camMax - levelMid) * P;
    const reps = Math.ceil((hi - lo) / w);
    const cloudsMat = fadeMaterial(null, { fb: 0.1, fx: 0.02, opacity: 0.88, ...gradeClouds });
    cloudsTex = loadBg(night ? "clouds-night.png" : "clouds.png", dir, ok => {
      if (!ok){ cloudsMat.opacity = 0; return; }
      banks.setTexture(cloudsTex);              // облака под ярусами — своя копия (без повтора и дрейфа)
      cloudsTex.wrapS = THREE.MirroredRepeatWrapping; cloudsTex.wrapT = THREE.ClampToEdgeWrapping;
      cloudsTex.repeat.set(reps, 1);
      cloudsMat.map = cloudsTex; cloudsMat.needsUpdate = true;
    }, BLUR.clouds);
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
    }, BLUR.hall);
    if (!night) mat.map = hallTex;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    mesh.position.set(level.heart.x - 3, centerY(3, D) + 1.2, CAM.dist - D);
    mesh.renderOrder = -30;
    mesh.name = "hall";
    group.add(mesh);
    disposers.push(() => { hallTex.dispose(); mat.dispose(); if (fallback && mat.map !== fallback) fallback.dispose(); });
  }

  // «живой» фон (life.js) — тарелки/пыльца-лепестки/светлячки/звёзды/окна/искры ориентиров/передний
  // план: один общий Points, встраивается через ту же группу/update, что и остальной задник (main.js
  // не трогаем — см. buildLevel: и группа, и update() уже проходят через backdrop).
  const life = createLife(level, { night });
  group.add(life.group);

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
      // мягкое мерцание огней ночного города — общий лёгкий пульс + случайный сдвиг фазы на тайл
      if (night) cityMats.forEach((m, idx) => {
        const sh = m.userData.shader; if (!sh) return;
        sh.uniforms.uTwinkle.value = 0.012 * Math.sin(t * 0.6 + idx * 2.1) + 0.01 * Math.max(0, Math.sin(t * 2.4 + idx * 4.2));
      });
      life.update(t, cx, cy);
    },
    dispose(){
      group.traverse(o => { if (o.isMesh) o.geometry.dispose(); });
      life.dispose();
      for (const d of disposers) d();
    },
  };
}
