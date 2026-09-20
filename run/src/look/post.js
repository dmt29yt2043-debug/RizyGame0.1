// Постобработка «2026» (LOOK-1, 5, 6, 7):
//   RenderPass (линейный HDR, HalfFloat) → GTAO (только high) → UnrealBloom (половинное разрешение,
//   порог по МАКСИМАЛЬНОМУ каналу) → FinalPass (speed blur + CA в HDR → экспозиция → PBR Neutral →
//   sRGB → грейд, виньетка, опасность, вспышки, дизеринг) → SMAA (med/high) / FXAA (low) → экран.
// Тонмаппинг ровно один раз — в FinalPass (он и есть наш OutputPass). renderer.toneMapping на кадр поста не влияет:
// при рендере в цель three сам выключает тонмаппинг материалов. Для прямого рендера без поста ставьте
// renderer.toneMapping = THREE.CustomToneMapping (кривая та же, см. tonemap.js).
// Сглаживание ПОСЛЕ тонмаппинга: SMAA/FXAA ищут края по воспринимаемой яркости в LDR.
// В покое пост сдержан (грейд + лёгкая виньетка); всё остальное — от сигналов и событий (LOOK-6).
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { SMAAPass } from "three/addons/postprocessing/SMAAPass.js";
import { FXAAShader } from "three/addons/shaders/FXAAShader.js";
import { neutralGLSL } from "./tonemap.js";

// потолок devicePixelRatio по качеству (перекрывается cfg.QUALITY[q].dprMax)
const DPR_CAP = { low: 1.25, med: 1.5, high: 2 };
// отсчёты радиального speed-blur (библия: 8; на low экономим)
const BLUR_TAPS = { low: 6, med: 8, high: 8 };
const SMOOTH_TAU = { intensity: 0.5, dangerUp: 0.1, dangerDown: 0.6 };

// ---------- ЯРКИЙ ПРОХОД BLOOM ----------
// Ключ = максимум канала (LOOK-1: Rec.709-яркость #FF2436×5 всего 1.06 и порог бы не прошла), мягкое колено.
// Почти бесцветным пикселям порог выше на whiteGuard: блёстки (6) и диск солнца (8) проходят, солнечный снег — никогда.
const BRIGHT_FRAG = /* glsl */`
  uniform sampler2D tDiffuse;
  uniform float luminosityThreshold;
  uniform float smoothWidth;
  uniform float whiteGuard;
  varying vec2 vUv;
  void main() {
    vec3 c = min(texture2D(tDiffuse, vUv).rgb, vec3(16.0));   // гасим «светлячков»
    float mx = max(c.r, max(c.g, c.b));
    float mn = min(c.r, min(c.g, c.b));
    float sat = (mx - mn) / max(mx, 1e-4);
    float th = luminosityThreshold + whiteGuard * (1.0 - smoothstep(0.10, 0.40, sat));
    float k = max(smoothWidth, 1e-4);
    float soft = clamp(mx - th + k, 0.0, 2.0 * k);
    soft = soft * soft / (4.0 * k);
    float w = max(soft, mx - th) / max(mx, 1e-4);
    gl_FragColor = vec4(c * w, 1.0);
  }`;
const BASIC_VERT = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

// ---------- СМЕШИВАНИЕ GTAO С ЗАТУХАНИЕМ ПО ДАЛЬНОСТИ ----------
// Вдали (в тумане) AO не нужен и только пачкает; к тому же изогнутый мир там сильнее расходится с G-буфером.
const AO_BLEND_FRAG = /* glsl */`
  #include <packing>
  uniform sampler2D tDiffuse;
  uniform sampler2D tDepth;
  uniform float intensity;
  uniform float cameraNear;
  uniform float cameraFar;
  uniform float fadeNear;
  uniform float fadeFar;
  varying vec2 vUv;
  void main() {
    float ao = texture2D(tDiffuse, vUv).r;
    float d = texture2D(tDepth, vUv).x;
    float vz = -perspectiveDepthToViewZ(d, cameraNear, cameraFar);
    float k = intensity * (1.0 - smoothstep(fadeNear, fadeFar, vz));
    gl_FragColor = vec4(vec3(mix(1.0, ao, k)), 1.0);
  }`;

// ---------- FINAL: HDR-эффекты → PBR Neutral → sRGB → грейд ----------
const FINAL_FRAG = /* glsl */`
  uniform sampler2D tDiffuse;
  uniform vec2  uRes;
  uniform float uTime;
  uniform float uExposure;
  uniform float uSaturation;
  uniform float uContrast;
  uniform vec3  uHiTint;
  uniform vec3  uShTint;
  uniform float uHiAmt;
  uniform float uShAmt;
  uniform float uVignette;
  uniform float uVigOffset;
  uniform float uBlur;        // длина радиального размытия, UV
  uniform vec2  uBlurC;       // центр размытия (грудь Ризи), UV
  uniform float uCA;          // хроматическая аберрация на краю, UV
  uniform vec3  uDangerCol;
  uniform float uDanger;      // итоговая непрозрачность кромки опасности (с пульсом)
  uniform vec3  uFlashCol;
  uniform float uFlash;
  varying vec2 vUv;
  const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
  ${neutralGLSL("postNeutral")}

  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  vec3 toSRGB(vec3 c) {
    return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
  }

  void main() {
    vec2 d = vUv - 0.5;
    float r = length(d) * 1.41421356;                      // 0 в центре, 1 в углу кадра
    float n = hash12(gl_FragCoord.xy + fract(uTime * 7.13) * vec2(113.1, 71.7));

    // --- HDR: аберрация удара и размытие скорости (героиня в чистой зоне всегда резкая) ---
    vec3 col;
    if (uCA > 1e-5) {
      vec2 o = d * (uCA * 1.41421356 * r);
      col = vec3(texture2D(tDiffuse, vUv + o).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - o).b);
    } else {
      col = texture2D(tDiffuse, vUv).rgb;
    }
    if (uBlur > 1e-5) {
      vec2 bd = vUv - uBlurC;
      float m = smoothstep(0.30, 0.55, length(bd * vec2(uRes.x / uRes.y, 1.0)));
      if (m > 0.0) {
        vec2 stp = bd / max(length(bd), 1e-4) * (uBlur * m / float(BLUR_TAPS - 1));
        vec3 acc = col; float ws = 1.0;
        for (int i = 1; i < BLUR_TAPS; i++) {
          float fi = float(i) - n;                            // джиттер вместо «ступенек» отсчётов
          float wi = 1.0 - 0.5 * float(i) / float(BLUR_TAPS);
          acc += texture2D(tDiffuse, vUv - stp * fi).rgb * wi;
          ws += wi;
        }
        col = acc / ws;
      }
    }

    // --- тонмаппинг: ровно один раз ---
    col = postNeutral(max(col, vec3(0.0)) * uExposure);
    vec3 c = toSRGB(clamp(col, 0.0, 1.0));

    // --- грейд в дисплейном пространстве ---
    // контраст: S-кривая с неподвижными 0 и 1 (белый снег не клиппится); наклон в середине = uContrast
    c = mix(c, c * c * (3.0 - 2.0 * c), clamp((uContrast - 1.0) * 2.0, -1.0, 1.0));
    float L = dot(c, LUMA);
    c = max(mix(vec3(L), c, uSaturation), vec3(0.0));
    // холодные зимние тени (#2A3C9A, не чернила) и тёплые света (#FFF4E0)
    c = mix(c, uShTint, uShAmt * (1.0 - smoothstep(0.0, 0.5, L)));
    c = mix(c, uHiTint, uHiAmt * smoothstep(0.55, 1.0, L));

    // виньетка: мягкий уход к краям, синий канал гасится меньше (холодная, а не серая)
    vec2 vu = d * 2.0 * uVigOffset;
    float v = smoothstep(0.3, 1.6, dot(vu, vu));
    c *= vec3(1.0) - uVignette * v * vec3(1.0, 0.94, 0.80);

    // опасность: тёмно-винная кромка (inner 0.55, softness 0.45)
    if (uDanger > 1e-4) c = mix(c, uDangerCol, clamp(smoothstep(0.55, 1.0, r) * uDanger, 0.0, 1.0));
    // вспышка удара / события по краю
    if (uFlash > 1e-4) c = mix(c, uFlashCol, clamp(smoothstep(0.35, 1.0, r) * uFlash, 0.0, 1.0));

    // дизеринг против полос в градиенте неба (зерна нет — LOOK-5)
    c += (n - 0.5) / 255.0;
    gl_FragColor = vec4(c, 1.0);
  }`;

const hex3 = (hex, v) => v.set(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255);
const clamp01 = x => (x < 0 ? 0 : x > 1 ? 1 : x);
const damp = (a, b, lambda, dt) => a + (b - a) * (1 - Math.exp(-lambda * dt));
const smooth01 = t => { t = clamp01(t); return t * t * (3 - 2 * t); };

export function createPost(ctx) {
  const renderer = ctx.renderer, scene = ctx.scene, camera = ctx.camera;
  const qp = ctx.qp || null;

  // числа покоя — из библии 2.1 (LOOK-1, LOOK-5); ключи контракта сохранены
  const params = {
    bloom: 0.40,          // сила bloom (0 — проход выключен)
    vignette: 0.15,       // «darkness» виньетки покоя, 0..1
    saturation: 1.10,     // множитель (1 — без изменений)
    warmth: 1.0,          // множитель сплит-тона (1 — числа библии: света 3%, тени 6%)
    speedBlur: 0,         // 0..1 — ручная добавка к размытию (1 = 0.010 UV)
    danger: 0,            // 0..1 — ручная добавка к опасности
    // дополнительно (вне исходного контракта):
    exposure: 1.0,        // экспозиция перед PBR Neutral
    contrast: 1.05,
    vignetteOffset: 0.95,
    bloomThreshold: 1.20, // по максимуму канала в линейном HDR = 1.25 × max-канал солнечной трассы
    bloomRadius: 0.40,
    bloomSmooth: 0.20,
    whiteGuard: 0.80,     // добавка к порогу для бесцветных пикселей
    blurCenter: new THREE.Vector2(0.5, 0.30),   // UV (низ = 0): грудь Ризи ≈ 70% сверху
    blurMax: 0.010,       // UV при intensity 1 (скорость 30)
    blurBoost: 0.006,     // UV добавка на бусте
    shadowTint: 0x2A3C9A, highlightTint: 0xFFF4E0,
    dangerColor: 0x2A0620,
    auto: !!ctx.G,        // сам читать G (intensity/danger/mode), если сигнал не задан через setSignals
    adaptiveDpr: !(qp && qp.has && qp.has("shot")),
    grain: 0,             // не используется (LOOK-5: без зерна), оставлен для совместимости
    skyMatch: false,      // не используется: небо и туман идут через одну кривую (туман == горизонт)
  };

  // сигналы: null — брать из G (auto)
  const S = { intensity: null, danger: null, boost: false, over: null, tunnel: false, beat: null, reducedMotion: false };
  // сглаженное состояние (читается снаружи для отладки)
  const state = { intensity: 0, danger: 0, blur: 0, bloom: 0, flash: 0, ca: 0, over: 0, tunnel: 0, dpr: 1 };

  let quality = ctx.quality || "med";
  let W = 0, H = 0, PR = 1, time = 0;
  let gen = 0;                       // поколение цепочки: защищает от поздней загрузки SMAA после пересборки
  const sizeTmp = new THREE.Vector2();

  // события (без аллокаций в кадре)
  const flashCol = new THREE.Vector3(1, 0.14, 0.21);
  let flashT = 0, flashDur = 0, flashAmt = 0, caT = 0, caDur = 0.28, caAmt = 0;
  const flashRing = [-9, -9, -9]; let flashIdx = 0;
  let spike = 0, spikeHold = 0, tunDip = 0, boostK = 0, lastTunnel = false;
  let slowT = 0, fastT = 0, dprLimit = 99;

  let composer = null;
  const P = { render: null, gtao: null, bloom: null, grade: null, output: null, smaa: null, fxaa: null };
  let curvePatched = false;
  let readyResolve = null;
  const api = { params, state, render, setSize, setQuality, passes: P, get composer(){ return composer; }, ready: null };

  // --- сборка цепочки под качество ---
  function build(q) {
    dispose();
    gen++;
    quality = q;
    const myGen = gen;
    api.ready = new Promise(res => { readyResolve = res; });

    composer = new EffectComposer(renderer);   // HalfFloat цели по умолчанию
    composer.renderTarget1.texture.name = "post.rt1";

    P.render = new RenderPass(scene, camera);
    composer.addPass(P.render);

    if (q === "high") {
      // LOOK-7: radius 0.6, distanceExponent 1.5, thickness 1, scale 1, samples 16, distanceFallOff 1, blend 0.7
      const gtao = new GTAOPass(scene, camera, 256, 256, undefined,
        { radius: 0.6, distanceExponent: 1.5, thickness: 1.0, distanceFallOff: 1.0, scale: 1.0, samples: 16 },
        { lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, samples: 16, rings: 2, radiusExponent: 1 });
      gtao.blendIntensity = 0.7;
      // страховка от NaN в GTAO r160: косинусы горизонтов могут вылезти за 1 (sqrt/acos → NaN),
      // а денойз размазывает любой NaN в чёрное пятно. Зажимаем и подменяем.
      const gm = gtao.gtaoMaterial, fs0 = gm.fragmentShader;
      gm.fragmentShader = fs0
        .replace("vec2 sinHorizons = sqrt(1. - cosHorizons * cosHorizons);",
          "cosHorizons = clamp(cosHorizons, -1., 1.);\n\t\t\t\tvec2 sinHorizons = sqrt(max(vec2(0.), 1. - cosHorizons * cosHorizons));")
        .replace("ao += occlusion;", "ao += (isnan(occlusion) || isinf(occlusion)) ? 1. : occlusion;")
        .replace("ao = clamp(ao / float(DIRECTIONS), 0., 1.);",
          "ao = (isnan(ao) || isinf(ao)) ? 1. : clamp(ao / float(DIRECTIONS), 0., 1.);");
      // битая нормаль в G-буфере (геометрия без атрибута normal) → нормаль из глубины
      gm.fragmentShader = gm.fragmentShader.replace("vec3 viewNormal = getViewNormal(vUv);",
        "vec3 viewNormal = getViewNormal(vUv);\n\t\t\tif (any(isnan(viewNormal)) || dot(viewNormal, viewNormal) < 0.25) viewNormal = computeNormalFromDepth(vUv);");
      if (gm.fragmentShader === fs0 || !gm.fragmentShader.includes("computeNormalFromDepth(vUv)"))
        console.warn("post: патч GTAO не применился (другая версия шейдера?)");
      gm.needsUpdate = true;
      const pm = gtao.pdMaterial, ps0 = pm.fragmentShader;
      pm.fragmentShader = ps0
        .replace("vec3 viewNormal = getViewNormal(vUv);",
          "vec3 viewNormal = getViewNormal(vUv);\n\t\t\tif (any(isnan(viewNormal))) viewNormal = computeNormalFromDepth(vUv);")
        .replace("vec3 sampleNormal = getViewNormal(sampleUv);",
          "vec3 sampleNormal = getViewNormal(sampleUv);\n\t\t\tif (any(isnan(sampleNormal))) sampleNormal = viewNormal;");
      if (pm.fragmentShader === ps0) console.warn("post: патч денойза GTAO не применился");
      pm.needsUpdate = true;
      // своё смешивание: AO гаснет с дальностью
      const bm = gtao.blendMaterial;
      gtao.blendMaterial = new THREE.ShaderMaterial({
        uniforms: {
          tDiffuse: { value: null }, tDepth: { value: gtao.depthTexture }, intensity: { value: 1 },
          cameraNear: { value: camera.near }, cameraFar: { value: camera.far },
          fadeNear: { value: 14 }, fadeFar: { value: 42 },
        },
        vertexShader: BASIC_VERT, fragmentShader: AO_BLEND_FRAG,
        transparent: true, depthTest: false, depthWrite: false,
        blending: THREE.CustomBlending, blendSrc: THREE.DstColorFactor, blendDst: THREE.ZeroFactor,
        blendEquation: THREE.AddEquation, blendSrcAlpha: THREE.DstAlphaFactor, blendDstAlpha: THREE.ZeroFactor,
        blendEquationAlpha: THREE.AddEquation,
      });
      bm.dispose();
      // G-буфер: прячем точки/линии/спрайты и прозрачные частицы без записи глубины
      const hidden = [];
      const hideVisit = o => {
        if (!o.visible) return;
        const m = o.material;
        if (o.isPoints || o.isLine || o.isSprite || (m && m.transparent === true && m.depthWrite === false)) {
          o.visible = false; hidden.push(o);
        }
      };
      gtao.overrideVisibility = function () { hidden.length = 0; this.scene.traverseVisible(hideVisit); };
      gtao.restoreVisibility = function () { for (let i = 0; i < hidden.length; i++) hidden[i].visible = true; hidden.length = 0; };
      // G-буфер: второй рендер сцены не должен заново считать карты теней, и в нём не должно быть фона —
      // иначе three рисует служебный квад фона материалом MeshNormalMaterial (NaN-нормали прямо за Ризи).
      const origOverride = gtao.renderOverride;
      gtao.renderOverride = function (r, mat, rt, cc, ca) {
        const au = r.shadowMap.autoUpdate, bgk = this.scene.background;
        r.shadowMap.autoUpdate = false;
        this.scene.background = null;
        try { origOverride.call(this, r, mat, rt, cc, ca); }
        finally { r.shadowMap.autoUpdate = au; this.scene.background = bgk; }
      };
      // половинное разрешение, если буфер больше 1.5 МП (LOOK-7)
      const origSize = gtao.setSize;
      gtao.setSize = function (w, h) {
        const k = w * h > 1.5e6 ? 0.5 : 1;
        origSize.call(this, Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k)));
      };
      P.gtao = gtao;
      composer.addPass(gtao);
    }

    // UnrealBloomPass r160 уже считает яркий проход и пирамиду от половины буфера
    const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), params.bloom, params.bloomRadius, params.bloomThreshold);
    bloom.highPassUniforms.whiteGuard = { value: params.whiteGuard };
    bloom.highPassUniforms.smoothWidth.value = params.bloomSmooth;
    bloom.materialHighPassFilter.dispose();
    bloom.materialHighPassFilter = new THREE.ShaderMaterial({
      uniforms: bloom.highPassUniforms, vertexShader: BASIC_VERT, fragmentShader: BRIGHT_FRAG,
    });
    if (q === "low") {                              // на low — ещё вдвое меньшая пирамида
      const origSize = bloom.setSize;
      bloom.setSize = function (w, h) { origSize.call(this, Math.max(2, w >> 1), Math.max(2, h >> 1)); };
    }
    P.bloom = bloom;
    composer.addPass(bloom);

    P.grade = new ShaderPass(new THREE.ShaderMaterial({
      name: "look:post.final",
      defines: { BLUR_TAPS: BLUR_TAPS[q] || 8 },
      uniforms: {
        tDiffuse: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, uTime: { value: 0 },
        uExposure: { value: 1 }, uSaturation: { value: 1 }, uContrast: { value: 1 },
        uHiTint: { value: new THREE.Vector3(1, 1, 1) }, uShTint: { value: new THREE.Vector3(0, 0, 0) },
        uHiAmt: { value: 0 }, uShAmt: { value: 0 }, uVignette: { value: 0 }, uVigOffset: { value: 1 },
        uBlur: { value: 0 }, uBlurC: { value: new THREE.Vector2(0.5, 0.3) }, uCA: { value: 0 },
        uDangerCol: { value: new THREE.Vector3() }, uDanger: { value: 0 },
        uFlashCol: { value: flashCol }, uFlash: { value: 0 },
      },
      vertexShader: BASIC_VERT, fragmentShader: FINAL_FRAG,
      toneMapped: false, depthTest: false, depthWrite: false,
    }));
    P.output = P.grade;   // совместимость: «выходной» проход — это он же
    composer.addPass(P.grade);

    // FXAA: на low основной, на med/high — подмена, пока не загрузились текстуры SMAA
    P.fxaa = new ShaderPass(FXAAShader);
    composer.addPass(P.fxaa);
    if (q !== "low") {
      P.smaa = new SMAAPass(256, 256);
      P.smaa.enabled = false;
      composer.addPass(P.smaa);
      const imgs = [P.smaa.areaTexture.image, P.smaa.searchTexture.image];
      Promise.all(imgs.map(im => (im.decode ? im.decode() : Promise.resolve()))).then(() => {
        if (myGen !== gen || !P.smaa) return;
        P.smaa.areaTexture.needsUpdate = true;
        P.smaa.searchTexture.needsUpdate = true;
        P.smaa.enabled = true;
        P.fxaa.enabled = false;
        readyResolve();
      }, err => {
        console.error("post: SMAA не загрузился, остаётся FXAA", err);
        if (myGen === gen) readyResolve();
      });
    } else {
      readyResolve();
    }

    curvePatched = false;
    if (W && H) setSize(W, H);
    else { renderer.getSize(sizeTmp); setSize(sizeTmp.x, sizeTmp.y); }
  }

  function dispose() {
    // то, что штатные dispose() проходов r160 забывают
    if (P.gtao) { P.gtao.blendMaterial.dispose(); P.gtao.gtaoMaterial.dispose(); }
    if (P.bloom) P.bloom.materialHighPassFilter.dispose();
    for (const k in P) {
      const p = P[k];
      if (p && k !== "output") {
        if (p.dispose) p.dispose();
        if (p.material && p.material.dispose) p.material.dispose();
      }
      P[k] = null;
    }
    if (composer) composer.dispose();
    composer = null;
  }

  function dprCap() {
    const c = ctx.cfg;
    const cq = c && ((c.QUALITY && c.QUALITY[quality]) || (c.quality && c.quality[quality]));
    return (cq && (cq.dprMax || cq.dpr)) || DPR_CAP[quality] || 1.5;
  }

  function setSize(w, h) {
    W = Math.max(1, w | 0); H = Math.max(1, h | 0);
    PR = Math.min(window.devicePixelRatio || 1, 2, dprCap(), dprLimit);
    state.dpr = PR;
    renderer.setPixelRatio(PR);
    renderer.setSize(W, H);
    if (!composer) return;
    composer.setPixelRatio(PR);   // внутри вызывает setSize всех проходов с учётом PR
    composer.setSize(W, H);
    const ew = Math.round(W * PR), eh = Math.round(H * PR);
    P.grade.uniforms.uRes.value.set(ew, eh);
    P.fxaa.uniforms.resolution.value.set(1 / ew, 1 / eh);
  }

  function setQuality(q) {
    if (q !== "low" && q !== "med" && q !== "high") q = "med";
    if (q === quality && composer) return;
    build(q);
  }

  // ---------- СИГНАЛЫ И СОБЫТИЯ (LOOK-6) ----------
  // setSignals({ intensity 0..1, danger 0..1, boost bool, over bool, tunnel bool, beat 0..1 (фаза четверти),
  //              reducedMotion bool }) — передавайте только изменившееся; null возвращает ключ в auto (из G)
  api.setSignals = function (o) {
    if (!o) return api;
    for (const k in S) if (o[k] !== undefined) S[k] = o[k];
    return api;
  };

  // вспышка по краю кадра: цвет, длительность (мс), сила, аберрация (UV). Ограничитель ≤ 3/с (HUD-8).
  api.flash = function (colorHex = 0xFF2436, ms = 450, amount = 0.45, ca = 0) {
    if (time - flashRing[flashIdx] < 1) return false;   // самая старая из трёх последних была меньше секунды назад
    flashRing[flashIdx] = time; flashIdx = (flashIdx + 1) % 3;
    hex3(colorHex, flashCol);
    flashT = 0; flashDur = Math.max(0.016, ms / 1000); flashAmt = amount;
    if (ca > 0 && !S.reducedMotion) { caT = 0; caAmt = ca; }
    return true;
  };
  // удар: край #FF2436 0.45 → 0 за 450 мс easeOutQuad, CA 0.005 UV → 0 за 280 мс
  api.hit = function () { return api.flash(0xFF2436, 450, 0.45, 0.005); };

  // всплеск bloom: +amount, держится ms, затем спад tau 150 мс; сумма ≤ +0.3
  api.bloomSpike = function (amount = 0.12, ms = 0) {
    spike = Math.min(0.3, spike + amount);
    spikeHold = Math.max(spikeHold, ms / 1000);
    return api;
  };

  // подписка на шину (вызывать ОДИН раз, если события не прокидываются вручную)
  let bound = null;
  api.bindBus = function (bus) {
    if (!bus || !bus.on || bound) return api;
    bound = [
      ["hit", () => api.hit()],
      ["pickup", () => api.bloomSpike(0.12, 0)],
      ["combo:tier", () => api.bloomSpike(0.25, 400)],
      ["milestone", () => api.bloomSpike(0.25, 400)],
      ["tunnel:enter", () => api.setSignals({ tunnel: true })],
      ["tunnel:exit", () => api.setSignals({ tunnel: false })],
      ["boost", on => api.setSignals({ boost: !!on })],
    ];
    for (const [e, f] of bound) bus.on(e, f);
    api.unbindBus = () => { if (bus.off) for (const [e, f] of bound) bus.off(e, f); bound = null; };
    return api;
  };

  function updateSignals(dt) {
    const G = params.auto ? ctx.G : null;
    // интенсивность (2.0): I = clamp((speed − 12)/18), сглаживание tau 0.5 с
    let I;
    if (S.intensity !== null) I = S.intensity;
    else if (G && typeof G.intensity === "number") I = G.intensity;
    else if (G) I = damp(state.intensity, clamp01(((G.speed || 0) - 12) / 18), 1 / SMOOTH_TAU.intensity, dt);
    else I = 0;
    state.intensity = clamp01(I);
    // опасность: атака tau 0.1, спад tau 0.6
    let D;
    if (S.danger !== null) D = S.danger;
    else if (G && typeof G.danger === "number") D = G.danger;
    else if (G) {
      const st = (ctx.cfg && ctx.cfg.swarmTime) || 5.5, raw = G.mode === "play" ? clamp01((G.swarmNear || 0) / st) : 0;
      D = damp(state.danger, raw, 1 / (raw > state.danger ? SMOOTH_TAU.dangerUp : SMOOTH_TAU.dangerDown), dt);
    } else D = 0;
    state.danger = clamp01(D);
    // game over: 500 мс
    const over = S.over !== null ? !!S.over : !!(G && G.mode === "over");
    state.over = damp(state.over, over ? 1 : 0, 6, dt);
    // тоннель: вход 0.35 с, выход 0.25 с; на выходе порог bloom −0.5 на 0.4 с
    const tun = !!S.tunnel;
    state.tunnel = tun ? Math.min(1, state.tunnel + dt / 0.35) : Math.max(0, state.tunnel - dt / 0.25);
    if (lastTunnel && !tun) tunDip = 0.4;
    lastTunnel = tun;
    tunDip = Math.max(0, tunDip - dt);
    boostK = S.boost ? Math.min(1, boostK + dt / 0.15) : Math.max(0, boostK - dt / 0.6);
    // события
    flashT += dt; caT += dt;
    const fp = flashDur > 0 ? clamp01(flashT / flashDur) : 1;
    state.flash = flashAmt * (1 - fp) * (1 - fp);
    const cp = clamp01(caT / caDur);
    state.ca = S.reducedMotion ? 0 : caAmt * (1 - cp) * (1 - cp);
    if (spikeHold > 0) spikeHold -= dt; else spike *= Math.exp(-dt / 0.15);
    // размытие: 0 до скорости 20 (I = 8/18), 0.010 UV на 30, +0.006 на бусте
    const ramp = clamp01((state.intensity - 8 / 18) / (10 / 18));
    state.blur = S.reducedMotion ? 0 : params.blurMax * (ramp + clamp01(params.speedBlur)) + params.blurBoost * boostK;
  }

  // адаптивное разрешение (LOOK-7): кадр > 20 мс дольше 2 с → DPR 1.25; назад после 5 с под 14 мс
  function adaptDpr(dt) {
    if (!params.adaptiveDpr || dt <= 0 || dt > 0.25) return;
    const ms = dt * 1000;
    if (ms > 20) { slowT += dt; fastT = 0; } else if (ms < 14) { fastT += dt; slowT = 0; } else { slowT = 0; fastT = 0; }
    if (slowT > 2 && dprLimit > 1.25 && PR > 1.25) { dprLimit = 1.25; slowT = 0; setSize(W, H); }
    else if (fastT > 5 && dprLimit < 99) { dprLimit = 99; fastT = 0; setSize(W, H); }
  }

  function render(dt) {
    dt = dt > 0 ? Math.min(dt, 0.25) : 0;
    time += dt;
    // размер канваса поменяли снаружи — подстраиваемся (без аллокаций)
    renderer.getSize(sizeTmp);
    if (sizeTmp.x !== W || sizeTmp.y !== H) setSize(sizeTmp.x, sizeTmp.y);
    adaptDpr(dt);

    // изогнутый мир: G-буфер GTAO должен гнуться так же
    if (P.gtao && !curvePatched && ctx.look && ctx.look.curve && ctx.look.curve.patch) {
      try { ctx.look.curve.patch(P.gtao.normalMaterial); } catch (e) { console.error("post: curve.patch", e); }
      curvePatched = true;
    }

    updateSignals(dt);
    const dg = state.danger, ov = state.over;

    const u = P.grade.uniforms;
    u.uTime.value = time;
    u.uExposure.value = params.exposure * Math.pow(2, -0.3 * state.tunnel);
    u.uSaturation.value = (params.saturation + (0.35 - params.saturation) * ov) * (1 - 0.12 * dg);
    u.uContrast.value = params.contrast * (1 + 0.08 * dg);
    hex3(params.highlightTint, u.uHiTint.value);
    hex3(params.shadowTint, u.uShTint.value);
    u.uHiAmt.value = 0.03 * params.warmth;
    u.uShAmt.value = 0.06 * params.warmth;
    u.uVignette.value = params.vignette + (0.5 - params.vignette) * ov;
    u.uVigOffset.value = params.vignetteOffset;
    u.uBlur.value = state.blur;
    u.uBlurC.value.copy(params.blurCenter);
    u.uCA.value = state.ca;
    // кромка опасности: 0.18 + 0.30·danger, пульс ±0.07 на четвертях (фолбэк 2 Гц), плавное появление
    const dTot = clamp01(dg + params.danger);
    if (dTot > 0.001) {
      const ph = S.beat !== null ? S.beat : time * 2.0;
      const pulse = S.reducedMotion ? 0 : Math.cos(ph * Math.PI * 2) * 0.07;
      u.uDanger.value = (0.18 + 0.30 * dTot + pulse) * smooth01(dTot / 0.2);
    } else u.uDanger.value = 0;
    hex3(params.dangerColor, u.uDangerCol.value);
    u.uFlash.value = state.flash;

    const b = P.bloom;
    state.bloom = params.bloom + spike;
    b.enabled = state.bloom > 0.001;
    b.strength = state.bloom;
    b.radius = params.bloomRadius;
    b.threshold = params.bloomThreshold - (tunDip > 0 ? 0.5 * smooth01(tunDip / 0.1) : 0);
    b.highPassUniforms.smoothWidth.value = params.bloomSmooth;
    b.highPassUniforms.whiteGuard.value = params.whiteGuard;

    if (P.gtao) {
      const bu = P.gtao.blendMaterial.uniforms;
      bu.cameraNear.value = camera.near; bu.cameraFar.value = camera.far;
    }

    composer.render(dt);
  }

  api.dispose = function () { if (api.unbindBus) api.unbindBus(); dispose(); };

  build(quality === "low" || quality === "high" ? quality : "med");
  return api;
}
