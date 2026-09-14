// Постобработка «2026»: линейный HDR → (GTAO) → Bloom → Grade → OutputPass (ACES + sRGB) → SMAA/FXAA.
// Сглаживание стоит ПОСЛЕ OutputPass: FXAA/SMAA ищут края по воспринимаемой яркости в LDR,
// в линейном HDR белый снег против тёмного края даёт «лесенку» (так же сделано в примерах three).
// Тонмаппинг и sRGB применяются ровно один раз — в OutputPass (RenderPass в цель рендерит без них).
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { SMAAPass } from "three/addons/postprocessing/SMAAPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { FXAAShader } from "three/addons/shaders/FXAAShader.js";

// потолок devicePixelRatio по качеству (перекрывается cfg.quality[q].dpr, если есть)
const DPR_CAP = { low: 1.25, med: 1.5, high: 2 };
// сколько отсчётов у радиального speed-blur
const BLUR_TAPS = { low: 6, med: 8, high: 10 };

// ---------- ЯРКИЙ ПРОХОД BLOOM ----------
// Вместо стандартного «luma > порог» (он пропускает весь пиксель целиком, и белый снег светится):
// ключ = максимум канала, мягкое колено с вычитанием порога, а почти бесцветным пикселям порог выше.
// Итог: насыщенные эмиссивы (энергоны, глаз Гасителя, фонари) светятся, белый снег — нет.
const BRIGHT_FRAG = /* glsl */`
  uniform sampler2D tDiffuse;
  uniform float luminosityThreshold;
  uniform float smoothWidth;
  uniform float whiteGuard;
  varying vec2 vUv;
  void main() {
    vec3 c = min(texture2D(tDiffuse, vUv).rgb, vec3(24.0));   // гасим «светлячков»
    float mx = max(c.r, max(c.g, c.b));
    float mn = min(c.r, min(c.g, c.b));
    float sat = mx > 1e-4 ? (mx - mn) / mx : 0.0;
    // белому нужно быть намного ярче, чтобы засветиться
    float th = luminosityThreshold + whiteGuard * (1.0 - smoothstep(0.08, 0.45, sat));
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
// Вдали (в тумане) AO не нужен и только пачкает; к тому же изогнутый мир там расходится с G-буфером.
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

// ---------- GRADE: speed-blur, контраст, насыщенность, тёплый тон, виньетка, опасность, зерно ----------
const GRADE_FRAG = /* glsl */`
  uniform sampler2D tDiffuse;
  uniform vec2  uRes;
  uniform float uTime;
  uniform float uExposure;
  uniform float uVignette;
  uniform float uSaturation;
  uniform float uWarmth;
  uniform float uContrast;
  uniform float uSpeed;
  uniform float uDanger;
  uniform float uGrain;
  varying vec2 vUv;
  const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  void main() {
    vec2 d = vUv - 0.5;
    float aspect = uRes.x / uRes.y;
    // 0 в центре, 1 в углу кадра (с учётом пропорций)
    float r = length(vec2(d.x * aspect, d.y)) / length(vec2(aspect * 0.5, 0.5));
    float n = hash12(gl_FragCoord.xy + fract(uTime * 7.13) * vec2(113.1, 71.7));

    vec4 src = texture2D(tDiffuse, vUv);
    vec3 col = src.rgb;
    float alpha = src.a;                                 // маска неба для OutputPass

    // радиальный размыв к центру: центр (Ризи) чёткий, края тянутся
    if (uSpeed > 0.001) {
      float m = smoothstep(0.22, 1.0, r) * uSpeed;
      vec2 stepUv = d * (m * 0.11 / float(BLUR_TAPS));
      vec3 acc = col; float wsum = 1.0;
      for (int i = 1; i < BLUR_TAPS; i++) {
        float fi = float(i) - n;                         // джиттер убирает «ступеньки» отсчётов
        float wi = 1.0 - 0.6 * float(i) / float(BLUR_TAPS);
        acc += texture2D(tDiffuse, vUv - stepUv * fi).rgb * wi;
        wsum += wi;
      }
      col = acc / wsum;
    }
    col = max(col, vec3(0.0));

    // мягкий контраст в лог-пространстве вокруг средне-серого (с учётом экспозиции)
    float pivot = 0.18 / uExposure;
    col = pow(col / pivot + 1e-6, vec3(uContrast)) * pivot;

    // насыщенность
    float lum = dot(col, LUMA);
    col = max(mix(vec3(lum), col, uSaturation), vec3(0.0));
    lum = dot(col, LUMA);

    // сплит-тон: холодные приподнятые тени, тёплые света; яркий белый (снег) остаётся белым
    float le = lum * uExposure;
    float mx = max(col.r, max(col.g, col.b));
    float sat = mx > 1e-4 ? (mx - min(col.r, min(col.g, col.b))) / mx : 0.0;
    float hi = smoothstep(0.08, 0.75, le);
    float warmK = hi * mix(1.0 - smoothstep(0.7, 1.3, le), 1.0, smoothstep(0.06, 0.3, sat));
    vec3 cool = vec3(0.95, 0.985, 1.06);
    vec3 warm = vec3(1.05, 1.0, 0.93);
    col *= mix(vec3(1.0), mix(cool, mix(vec3(1.0), warm, warmK), hi), uWarmth);
    col += vec3(0.004, 0.007, 0.014) * uWarmth * (1.0 - hi) / uExposure;

    // виньетка с лёгким уходом в чернильно-синий
    float v = smoothstep(0.42, 1.12, r) * uVignette;
    col *= mix(vec3(1.0), vec3(0.58, 0.64, 0.84), v);

    // опасность: пульсирующая розово-красная кромка
    if (uDanger > 0.001) {
      float pulse = 0.5 + 0.5 * sin(uTime * 6.8);
      float e = smoothstep(0.34 - 0.08 * pulse, 1.02, r);
      e *= e;
      vec3 dc = vec3(1.0, 0.07, 0.24) * (0.75 + 0.35 * pulse) / uExposure;
      float dm = clamp(e * uDanger * (0.55 + 0.35 * pulse), 0.0, 0.9);
      col = mix(col, dc, dm);
      alpha = mix(alpha, 1.0, dm);                       // тинт одинаково тонмаппится и на небе, и на земле
    }

    // дизеринг (всегда) + плёночное зерно (только high)
    col *= 1.0 + (n - 0.5) * (0.012 + uGrain);

    gl_FragColor = vec4(col, alpha);
  }`;

// ---------- НЕБО КАК БЕЗ ПОСТА ----------
// При прямом рендере фон (цвет, sRGB-текстура scene.background, цвет очистки) в r160 НЕ тонмаппится,
// а OutputPass тонмаппит всё — небо выцветает. Обратный ACES не спасает: насыщенный голубой вне его охвата.
// Поэтому маска в альфе: фон пишет alpha=0, непрозрачная геометрия — 1, прозрачное накапливает покрытие.
// Bloom/GTAO/Grade альфу сохраняют, а OutputPass смешивает «с тонмаппингом» и «без» по этой альфе.
const OUTPUT_SKY_PATCH = [
  "gl_FragColor = texture2D( tDiffuse, vUv );",
  "vec4 srcTexel = texture2D( tDiffuse, vUv );\n\t\t\tgl_FragColor = srcTexel;",
  "// color space",
  "gl_FragColor.rgb = mix( clamp( srcTexel.rgb, 0.0, 1.0 ), gl_FragColor.rgb, mix( 1.0, clamp( srcTexel.a, 0.0, 1.0 ), uSkyMatch ) );\n\t\t\tgl_FragColor.a = 1.0;\n\t\t\t// color space",
];

export function createPost(ctx) {
  const renderer = ctx.renderer, scene = ctx.scene, camera = ctx.camera;

  const params = {
    bloom: 0.48,          // сила bloom (0 — проход выключен)
    vignette: 0.32,       // 0..1
    saturation: 1.08,     // множитель (1 — без изменений)
    warmth: 0.55,         // 0..1 сплит-тон
    speedBlur: 0,         // 0..1 (складывается с авто-значением от G.speed)
    danger: 0,            // 0..1 (складывается с авто-значением от G.swarmNear)
    // дополнительно (вне контракта):
    contrast: 1.05,       // степень в лог-пространстве
    bloomThreshold: 1.15, // порог по максимуму канала в линейном HDR (до экспозиции)
    bloomRadius: 0.45,
    grain: 0.035,         // амплитуда зерна на high
    auto: !!ctx.G,        // сам читать G.speed / G.swarmNear
    skyMatch: true,       // фон выглядит как без поста (маска неба в альфе, см. skyPrep)
  };

  let quality = ctx.quality || "med";
  let W = 0, H = 0, PR = 1, time = 0;
  let autoSpeed = 0, autoDanger = 0;
  let gen = 0;                       // поколение цепочки: защищает от поздней загрузки SMAA после пересборки
  const sizeTmp = new THREE.Vector2();

  let composer = null;
  const P = { render: null, gtao: null, bloom: null, grade: null, output: null, smaa: null, fxaa: null };
  let curvePatched = false;
  let readyResolve = null;
  const api = { params, render, setSize, setQuality, passes: P, get composer(){ return composer; }, ready: null };

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
    // цель ставим ДО setClearColor внутри RenderPass: иначе цвет очистки переводится в sRGB, а не в линейный
    const rpRender = P.render.render;
    P.render.render = function (r, wb, rb, dt, mask) { r.setRenderTarget(rb); rpRender.call(this, r, wb, rb, dt, mask); };
    composer.addPass(P.render);

    if (q === "high") {
      const gtao = new GTAOPass(scene, camera, 256, 256, undefined,
        { radius: 0.7, distanceExponent: 1.5, thickness: 1.0, distanceFallOff: 1.0, scale: 1.6, samples: 16 },
        { lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, samples: 16, rings: 2, radiusExponent: 1 });
      gtao.blendIntensity = 1.0;
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
      // иначе three рисует служебный квад фона (2×2 у начала координат, без атрибута normal) материалом
      // MeshNormalMaterial: NaN-нормали и ложная глубина прямоугольником прямо за Ризи.
      const origOverride = gtao.renderOverride;
      gtao.renderOverride = function (r, mat, rt, cc, ca) {
        const au = r.shadowMap.autoUpdate, bgk = this.scene.background;
        r.shadowMap.autoUpdate = false;
        this.scene.background = null;
        try { origOverride.call(this, r, mat, rt, cc, ca); }
        finally { r.shadowMap.autoUpdate = au; this.scene.background = bgk; }
      };
      // AO в разрешении CSS-пикселей: на retina это вчетверо дешевле, после денойза разницы не видно
      const origSize = gtao.setSize;
      gtao.setSize = function (w, h) {
        const k = Math.min(1, 1 / PR);
        origSize.call(this, Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k)));
      };
      P.gtao = gtao;
      composer.addPass(gtao);
    }

    const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), params.bloom, params.bloomRadius, params.bloomThreshold);
    // свой яркий проход (те же uniform-ы + whiteGuard)
    bloom.highPassUniforms.whiteGuard = { value: 1.6 };
    bloom.highPassUniforms.smoothWidth.value = 0.35;
    bloom.materialHighPassFilter.dispose();
    bloom.materialHighPassFilter = new THREE.ShaderMaterial({
      uniforms: bloom.highPassUniforms, vertexShader: BASIC_VERT, fragmentShader: BRIGHT_FRAG,
    });
    if (q === "low") {                              // на low — вдвое меньшая пирамида
      const origSize = bloom.setSize;
      bloom.setSize = function (w, h) { origSize.call(this, Math.max(2, w >> 1), Math.max(2, h >> 1)); };
    }
    // RGB складываем как раньше, альфу (маску неба) не трогаем
    Object.assign(bloom.blendMaterial, {
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
      blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneFactor,
      blendEquationAlpha: THREE.AddEquation, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
    });
    P.bloom = bloom;
    composer.addPass(bloom);

    P.grade = new ShaderPass(new THREE.ShaderMaterial({
      defines: { BLUR_TAPS: BLUR_TAPS[q] || 8 },
      uniforms: {
        tDiffuse: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, uTime: { value: 0 },
        uExposure: { value: 1 }, uVignette: { value: 0 }, uSaturation: { value: 1 }, uWarmth: { value: 0 },
        uContrast: { value: 1 }, uSpeed: { value: 0 }, uDanger: { value: 0 }, uGrain: { value: 0 },
      },
      vertexShader: BASIC_VERT, fragmentShader: GRADE_FRAG,
    }));
    composer.addPass(P.grade);

    P.output = new OutputPass();
    {
      const om = P.output.material, fs0 = om.fragmentShader;
      // RawShaderMaterial: uniform объявляем после precision, рядом с tDiffuse
      om.fragmentShader = fs0
        .replace("uniform sampler2D tDiffuse;", "uniform sampler2D tDiffuse;\n\t\tuniform float uSkyMatch;")
        .replace(OUTPUT_SKY_PATCH[0], OUTPUT_SKY_PATCH[1]).replace(OUTPUT_SKY_PATCH[2], OUTPUT_SKY_PATCH[3]);
      if (!om.fragmentShader.includes("srcTexel.a")) console.warn("post: патч OutputPass не применился");
      P.output.uniforms.uSkyMatch = { value: 1 };
      om.uniforms = P.output.uniforms;
    }
    composer.addPass(P.output);

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

  // --- небо: фон на время рендера подменяется копией с alpha=0 ---
  // Возвращает то, что поставить в scene.background. Цветной фон → null + цвет очистки в RenderPass.
  const sky = { src: null, ver: -1, tex: null };
  function skyPrep(b) {
    const rp = P.render;
    rp.clearColor = null;
    const on = params.skyMatch && renderer.toneMapping !== THREE.NoToneMapping;
    P.output.uniforms.uSkyMatch.value = on ? 1 : 0;
    rp.clearAlpha = on ? 0 : null;
    if (!on || !b) return b;
    if (b.isColor) { rp.clearColor = b; return null; }
    // тонмаппится и при прямом рендере (линейные/кубические) — трогать не надо
    if (!b.isTexture || b.isCubeTexture || b.isRenderTargetTexture || b.mapping !== THREE.UVMapping ||
        b.colorSpace !== THREE.SRGBColorSpace) { P.output.uniforms.uSkyMatch.value = 0; return b; }
    if (sky.src === b && sky.ver === b.version) return sky.tex || b;
    const img = b.image;
    if (!img || !img.width || !img.height) return b;
    sky.src = b; sky.ver = b.version;
    if (sky.tex) { sky.tex.dispose(); sky.tex = null; }
    try {
      let w = img.width, h = img.height, src = img.data;
      let px;
      if (src && src.length === w * h * 4 && src instanceof Uint8Array) px = src;   // DataTexture RGBA8
      else {
        const sc = Math.min(1, 2048 / Math.max(w, h));
        w = Math.max(1, Math.round(w * sc)); h = Math.max(1, Math.round(h * sc));
        const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
        const g2 = cv.getContext("2d");
        g2.drawImage(img, 0, 0, w, h);
        px = g2.getImageData(0, 0, w, h).data;
      }
      const flip = !!b.flipY && !src;                // у DataTexture строка 0 — низ кадра
      const out = new Uint8Array(w * h * 4);
      for (let y = 0; y < h; y++) {
        const sy = flip ? h - 1 - y : y;
        out.set(px.subarray((sy * w) * 4, (sy * w + w) * 4), y * w * 4);
      }
      for (let i = 3; i < out.length; i += 4) out[i] = 0;
      const t = new THREE.DataTexture(out, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
      t.colorSpace = b.colorSpace;
      t.magFilter = b.magFilter; t.minFilter = THREE.LinearFilter;
      t.generateMipmaps = false;
      t.wrapS = b.wrapS; t.wrapT = b.wrapT;
      t.offset.copy(b.offset); t.repeat.copy(b.repeat); t.center.copy(b.center); t.rotation = b.rotation;
      t.matrixAutoUpdate = b.matrixAutoUpdate; t.matrix.copy(b.matrix);
      t.needsUpdate = true;
      sky.tex = t;
    } catch (e) {
      console.warn("post: копия неба не создана, небо пойдёт через тонмаппинг", e);
      sky.tex = null;
    }
    if (!sky.tex) P.output.uniforms.uSkyMatch.value = 0;
    return sky.tex || b;
  }

  function dispose() {
    // то, что штатные dispose() проходов r160 забывают
    if (P.gtao) { P.gtao.blendMaterial.dispose(); P.gtao.gtaoMaterial.dispose(); }
    if (P.bloom) P.bloom.materialHighPassFilter.dispose();
    for (const k in P) {
      const p = P[k];
      if (p && p.dispose) p.dispose();
      if (p && p.material && p.material.dispose) p.material.dispose();
      P[k] = null;
    }
    if (composer) composer.dispose();
    composer = null;
  }

  function setSize(w, h) {
    W = Math.max(1, w | 0); H = Math.max(1, h | 0);
    const cq = ctx.cfg && ctx.cfg.quality && ctx.cfg.quality[quality];
    const cap = (cq && cq.dpr) || DPR_CAP[quality] || 1.5;
    PR = Math.min(window.devicePixelRatio || 1, 2, cap);
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

  function render(dt) {
    dt = dt || 0;
    time += dt;
    // размер канваса поменяли снаружи — подстраиваемся (без аллокаций)
    renderer.getSize(sizeTmp);
    if (sizeTmp.x !== W || sizeTmp.y !== H) setSize(sizeTmp.x, sizeTmp.y);

    // изогнутый мир: G-буфер GTAO должен гнуться так же
    if (P.gtao && !curvePatched && ctx.look && ctx.look.curve && ctx.look.curve.patch) {
      try { ctx.look.curve.patch(P.gtao.normalMaterial); } catch (e) { console.error("post: curve.patch", e); }
      curvePatched = true;
    }

    // авто-эффекты от состояния игры
    const G = ctx.G;
    if (params.auto && G) {
      const play = G.mode === "play";
      const sT = play ? Math.min(1, Math.max(0, (G.speed - 15) / 17)) * 0.75 : 0;
      const dT = play && G.swarmNear > 0 ? 1 : 0;
      const ks = 1 - Math.exp(-dt * 2.5), kd = 1 - Math.exp(-dt * (dT > autoDanger ? 6 : 2.5));
      autoSpeed += (sT - autoSpeed) * ks;
      autoDanger += (dT - autoDanger) * kd;
    } else { autoSpeed = 0; autoDanger = 0; }

    const u = P.grade.uniforms;
    u.uTime.value = time;
    u.uExposure.value = renderer.toneMappingExposure || 1;
    u.uVignette.value = params.vignette;
    u.uSaturation.value = params.saturation;
    u.uWarmth.value = params.warmth;
    u.uContrast.value = params.contrast;
    u.uSpeed.value = Math.min(1, Math.max(0, params.speedBlur + autoSpeed));
    u.uDanger.value = Math.min(1, Math.max(0, params.danger + autoDanger));
    u.uGrain.value = quality === "high" ? params.grain : 0;

    const b = P.bloom;
    b.enabled = params.bloom > 0.001;
    b.strength = params.bloom;
    b.radius = params.bloomRadius;
    b.threshold = params.bloomThreshold;

    if (P.gtao) {
      const bu = P.gtao.blendMaterial.uniforms;
      bu.cameraNear.value = camera.near; bu.cameraFar.value = camera.far;
    }

    const origBg = scene.background;
    scene.background = skyPrep(origBg);
    try { composer.render(dt); }
    finally { scene.background = origBg; }
  }

  build(quality === "low" || quality === "high" ? quality : "med");
  return api;
}
