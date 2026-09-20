// world-kit: материалы. Берём фабрику look/materials.js, если она есть (войлок/леденец/снег/лёд),
// иначе — простые MeshStandard. Поверх — патчи кита: карамельные полосы по uv (uv.y = 1),
// rim у опасностей, блёстки трассы, «зоны» сет-пьес (мост: лёд реки, дощатый настил, лаймовые бордюры).
import * as THREE from "three";
import { patch, softDotTex, loadKitFont, SIGN_FONT } from "./util.js";

const lin = hex => new THREE.Color(hex);           // THREE.Color уже в линейном рабочем пространстве

export function createMats(ctx, U){
  const L = ctx.look && ctx.look.mats;
  const Q = ctx.quality === "low" ? "low" : ctx.quality === "high" ? "high" : "med";
  const LOW = Q === "low";
  const disposables = [];
  const own = m => { disposables.push(m); return m; };

  // общий GLSL: маска зоны (r.x — дальний край z, r.y — ближний), хэш
  const ZONE = `
    float kitZone(float z, vec2 r){ return smoothstep(r.x - 2.0, r.x + 2.0, z) * (1.0 - smoothstep(r.y - 2.0, r.y + 2.0, z)); }
    float kitHash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }`;

  // ---------- карамель / войлок с полосами ----------
  const STRIPE = `
    if (vKitUv.y > 0.5){
      float d = abs(fract(vKitUv.x) - 0.5);
      float w = fwidth(vKitUv.x) * 0.9 + 1e-4;
      float st = smoothstep(0.25 - w, 0.25 + w, d);
      diffuseColor.rgb = mix(diffuseColor.rgb, uStripeW, st);
    }`;
  const RIM = `totalEmissiveRadiance += uRimCol * pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), uRimPow) * uRimStr;`;

  function kitPatch(m, key, rim){
    const uni = { uStripeW: { value: lin(0xffffff).multiplyScalar(0.92) } };
    if (rim){ uni.uRimCol = U.uRimCol; uni.uRimStr = rim.str; uni.uRimPow = { value: rim.pow }; }
    return patch(m, {
      key, uniforms: uni,
      vPars: "varying vec2 vKitUv;", vBody: "vKitUv = uv;",
      fPars: "varying vec2 vKitUv;\nuniform vec3 uStripeW;\n" + (rim ? "uniform vec3 uRimCol; uniform float uRimStr; uniform float uRimPow;" : ""),
      fColor: STRIPE, fEmis: rim ? RIM : "",
    });
  }

  function baseCandy(o){
    if (L) return L.candy(0xffffff, Object.assign({ unique: true, vertexColors: true, emissiveIntensity: 0 }, o));
    return new THREE.MeshStandardMaterial(Object.assign({ color: 0xffffff, vertexColors: true, roughness: 0.3 }, o));
  }
  function baseFelt(o){
    if (L) return L.felt(0xffffff, Object.assign({ unique: true, vertexColors: true, repeat: 3 }, o));
    return new THREE.MeshStandardMaterial(Object.assign({ color: 0xffffff, vertexColors: true, roughness: 0.9 }, o));
  }
  function baseIce(o){
    if (L){
      const m = L.ice(Object.assign({ unique: true }, o));
      m.color.set(0xffffff); m.vertexColors = true; m.emissive.set(0x0a3d66); m.emissiveIntensity = 0.35;
      return m;
    }
    return new THREE.MeshStandardMaterial(Object.assign({ color: 0xffffff, vertexColors: true, roughness: 0.08, metalness: 0.1 }, o));
  }
  // войлок у декора чуть приглушён по окружению (LOOK-2: мир 0.9)
  const rimStr = { value: 0.25 }, rimStrCoin = { value: 0.6 };
  U.rimStrObst = rimStr; U.rimStrCoin = rimStrCoin;

  const mats = {
    candy: own(kitPatch(baseCandy({ envMapIntensity: 0.9 }), "kitCandy")),
    felt:  own(kitPatch(baseFelt({ envMapIntensity: 0.9 }), "kitFelt")),
    ice:   own(kitPatch(baseIce({}), "kitIce")),
    candyHaz: own(kitPatch(baseCandy({ envMapIntensity: 1.0 }), "kitCandyHaz", { str: rimStr, pow: 4 })),
    feltHaz:  own(kitPatch(baseFelt({ envMapIntensity: 1.0 }), "kitFeltHaz", { str: rimStr, pow: 4 })),
  };

  // ---------- свечение (MeshBasic, HDR-цвет → bloom по максимуму канала) ----------
  function glowMat(hex, k){
    const m = own(new THREE.MeshBasicMaterial({ color: lin(hex).multiplyScalar(k), vertexColors: true }));
    m.userData.base = lin(hex);
    return m;
  }
  mats.glowBulb = glowMat(0xFFF3C4, 4.0);       // лампочки гирлянд и арок
  mats.glowLamp = glowMat(0xFFE0A0, 0.0);       // ядра фонарей (сила из палитры)
  mats.glowWin  = glowMat(0xFFC770, 1.1);       // тёплые окна домиков
  mats.setGlow = (m, k) => { m.color.copy(m.userData.base).multiplyScalar(k); };

  // шипы-метки полос: лёд с лёгким собственным свечением (0.35 — ниже порога bloom)
  mats.stud = own(new THREE.MeshStandardMaterial({ color: 0x7FD4FF, emissive: 0x7FD4FF, emissiveIntensity: 0.35, roughness: 0.12, metalness: 0 }));

  // ---------- энергон ----------
  {
    // Оболочка НЕ должна пересекать порог bloom (1.2 по максимальному каналу): солнце 2.6 даёт ≈0.83 в зелёном,
    // поэтому собственное свечение 0.3 (а не 1.2 из WORLD-5 — то число считалось для bloom по яркости).
    // Светится только ядро 3.5, видное сквозь грани. Непрозрачная: без сортировки и «молочной» заливки.
    // Цвет свечения #A6F02A вместо #7DFF00: чистый зелёный уводил оттенок от лайма #C0FF3F в «траву».
    // clearcoat 0.6 и env 0.55: грани ловят блик, но светлое небо в отражении не «молочит» лайм (ΔE к #C0FF3F)
    const P = { color: 0xC0FF3F, emissive: 0xA6F02A, emissiveIntensity: 0.3, roughness: 0.3, metalness: 0, flatShading: true };
    const shell = LOW ? new THREE.MeshStandardMaterial(P) : new THREE.MeshPhysicalMaterial(Object.assign(P, { clearcoat: 0.6, clearcoatRoughness: 0.12 }));
    shell.envMapIntensity = 0.55;
    mats.coinShell = own(patch(shell, {
      key: "kitCoin", uniforms: { uRimCol: U.uRimColCoin, uRimStr: rimStrCoin, uRimPow: { value: 2 } },
      fPars: "uniform vec3 uRimCol; uniform float uRimStr; uniform float uRimPow;", fEmis: RIM,
    }));
    mats.coinCore = own(new THREE.MeshBasicMaterial({ color: lin(0xE9FFB0).multiplyScalar(3.5) }));
  }

  // ---------- billboard-ореол (инстансный, разворот к камере в вершинном шейдере, с изгибом) ----------
  const hasCurve = !!THREE.ShaderChunk.curve_pars_vertex;
  const curveU = THREE.ShaderLib.basic.uniforms.curveParams;
  function haloMat(hex, opacity){
    const uni = { uColor: { value: lin(hex) }, uOpacity: { value: opacity }, uFade: U.uFade, uLift: { value: 0.3 } };
    if (hasCurve && curveU) uni.curveParams = curveU;
    const m = new THREE.ShaderMaterial({
      uniforms: uni, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `${hasCurve ? "#include <curve_pars_vertex>" : ""}
        uniform vec2 uFade; uniform float uLift;
        varying vec2 vUv; varying vec3 vCol; varying float vF;
        void main(){
          vec4 c = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          float sc = length(instanceMatrix[0].xyz);
          #ifdef CURVE_ON
            c.xyz = curveBend(c.xyz);
          #endif
          vec4 mv = viewMatrix * c;
          mv.xy += position.xy * sc;
          mv.z += uLift;                 // uLift < 0 — ореол позади объекта: тест глубины прячет часть, закрытую им
          vUv = uv;
          #ifdef USE_INSTANCING_COLOR
            vCol = instanceColor;
          #else
            vCol = vec3(1.0);
          #endif
          vF = 1.0 - smoothstep(uFade.x, uFade.y, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `uniform vec3 uColor; uniform float uOpacity;
        varying vec2 vUv; varying vec3 vCol; varying float vF;
        void main(){
          float r = length(vUv - 0.5) * 2.0;
          float a = pow(max(0.0, 1.0 - r), 2.2) * uOpacity * vF;
          gl_FragColor = vec4(uColor * vCol, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    return own(m);
  }
  mats.haloCoin = haloMat(0xC0FF3F, 0.32);
  mats.haloCoin.uniforms.uLift.value = -0.4;         // ореол энергона за кристаллом, не поверх граней
  mats.haloLamp = haloMat(0xFFD890, 0.0);

  // ---------- blob-тень ----------
  const dot = (L && L.tex && L.tex.softDot) || own(softDotTex());
  mats.blob = own(new THREE.MeshBasicMaterial({ color: 0x1E2A6E, map: dot, transparent: true, opacity: 0.18, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));

  // ---------- знаки на земле (атлас 3 × 1, прозрачность на экземпляр через aDecal.y) ----------
  mats.decalAtlas = own(decalAtlas());
  mats.decal = own(patch(new THREE.MeshBasicMaterial({ map: mats.decalAtlas, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), {
    key: "kitDecal",
    vPars: "attribute vec2 aDecal; varying vec2 vDecal;",
    vBody: "vDecal = aDecal;\n#ifdef USE_MAP\n  vMapUv.x = (vMapUv.x + aDecal.x) / 3.0;\n#endif",
    fPars: "varying vec2 vDecal;",
    fColor: "diffuseColor.a *= vDecal.y;",
  }));
  // ---------- трасса ----------
  const cloneTex = (t, rx, ry) => { if (!t) return null; const c = t.clone(); c.wrapS = c.wrapT = THREE.RepeatWrapping; c.repeat.set(rx, ry); c.needsUpdate = true; own(c); return c; };
  const trackMap = own(trackTex(LOW ? 256 : 512));
  trackMap.repeat.set(1, 1 / 8);                    // uv трассы в метрах по z: тайл 8 м
  const woodTex = (L && L.tex && L.tex.woodPlanks) || own(fallbackWood());
  const snowN = L && L.tex && (L.tex.snowNormal || L.tex.noiseNormal);
  const trackNormal = cloneTex(snowN, 9.2 / 2, 1 / 2);
  const trackMat = new THREE.MeshStandardMaterial({
    color: lin(0xF2F6FF).multiplyScalar(1.28), map: trackMap, roughness: 0.8, metalness: 0,
    normalMap: trackNormal, normalScale: new THREE.Vector2(0.45, 0.45), envMapIntensity: 0.9,
  });
  const GLINT = LOW ? "" : `
    {
      vec2 cellP = vec2(vKitW.x, uDistMod - vKitW.z) * 40.0;
      float h = kitHash(floor(cellP) + floor(uTime * 6.0));
      vec3 V = normalize(vViewPosition);
      float spec = pow(saturate(dot(normal, normalize(uSunDirView + V))), 48.0);
      float fade = 1.0 - smoothstep(20.0, 35.0, length(vViewPosition));
      float g = step(0.992, h) * spec * 6.0 * fade;
      totalEmissiveRadiance += vec3(g) * uGlint * (1.0 - kitZone(vKitW.z, uBridge));
    }`;
  mats.track = own(patch(trackMat, {
    key: "kitTrack", uniforms: { uDistMod: U.uDistMod, uTime: U.uTime, uSunDirView: U.uSunDirView, uBridge: U.uBridge, uWood: { value: woodTex }, uGlint: U.uGlint },
    fPars: ZONE + "uniform float uDistMod; uniform float uTime; uniform vec3 uSunDirView; uniform vec2 uBridge; uniform sampler2D uWood; uniform float uGlint;",
    fColor: `
      {
        float zb = kitZone(vKitW.z, uBridge);
        if (zb > 0.001){
          vec3 wd = texture2D(uWood, vec2(vKitW.x / 3.2 + 0.5, (uDistMod - vKitW.z) / 3.2)).rgb;
          diffuseColor.rgb = mix(diffuseColor.rgb, wd * 1.05, zb);
        }
      }`,
    fEmis: GLINT,
  }));

  // бордюр: карамель, диагональные полосы #0536D4 / белый с периодом 0.5 м в мировых координатах (на мосту — лайм)
  const curbBase = baseCandy({ envMapIntensity: 1.0 });
  mats.curb = own(patch(curbBase, {
    key: "kitCurb", uniforms: { uDistMod: U.uDistMod, uBridge: U.uBridge, uBlue: { value: lin(0x0536D4) }, uLime: { value: lin(0xC0FF3F) }, uWhite: { value: lin(0xF6FAFF) } },
    fPars: ZONE + "uniform float uDistMod; uniform vec2 uBridge; uniform vec3 uBlue; uniform vec3 uLime; uniform vec3 uWhite;",
    fColor: `
      {
        float x = ((uDistMod - vKitW.z) + vKitW.y * 1.2 + abs(vKitW.x) * 1.2) / 0.5;
        float d = abs(fract(x) - 0.5);
        float w = fwidth(x) * 0.9 + 1e-4;
        float st = smoothstep(0.25 - w, 0.25 + w, d);
        vec3 a = mix(uBlue, uLime, kitZone(vKitW.z, uBridge));
        diffuseColor.rgb = mix(a, uWhite, st);
      }`,
  }));
  curbBase.vertexColors = false;

  // снег валов и поля: look.snow (белый, искры) с собственными копиями текстур (свой offset для прокрутки)
  function snowMat(rx, ry, key, vBody, extra){
    let m;
    if (L){
      m = L.snow({ unique: true });
      m.map = cloneTex(m.map, rx, ry); m.normalMap = cloneTex(m.normalMap, rx, ry);
      if (m.emissiveMap) m.emissiveMap = cloneTex(m.emissiveMap, rx, ry);
      if (LOW){ m.emissiveMap = null; m.emissiveIntensity = 0; }
    } else m = new THREE.MeshStandardMaterial({ color: lin(0xF4F8FF).multiplyScalar(1.3), roughness: 0.95 });
    m.envMapIntensity = 0.9;
    return own(patch(m, Object.assign({ key, vBody }, extra)));
  }
  mats.bank = snowMat(1 / 4, 1 / 6, "kitBank", `
      {
        float s = uDistMod - kitW.z, sd = sign(kitW.x);
        float bump = 0.20 * sin(6.2831853 * s * 37.0 / 1000.0 + sd * 1.7)
                   + 0.12 * sin(6.2831853 * s * 97.0 / 1000.0 + sd * 0.3)
                   + 0.07 * sin(6.2831853 * s * 229.0 / 1000.0 + sd * 2.2);
        transformed.y *= 1.0 + bump;
        transformed.y -= kitZone(kitW.z, uBridge) * 2.6;
      }`, {
    uniforms: { uDistMod: U.uDistMod, uBridge: U.uBridge },
    vPars: ZONE + "uniform float uDistMod; uniform vec2 uBridge;",
  });
  // река (WORLD-6): русло |x| 12..34 с одной стороны, концы-«линзы», лёгкий меандр; мост — лёд с обеих сторон
  const RIVER_GLSL = `
    float kitRiverSeg(vec3 w, vec4 r, float s){
      if (r.w < 0.5) return 0.0;
      float along = smoothstep(r.x - 1.0, r.x + 22.0, w.z) * (1.0 - smoothstep(r.y - 22.0, r.y + 1.0, w.z));
      float c = 23.0 + 2.2 * sin(s * 0.021 + r.z);
      float hw = (9.6 + 1.2 * sin(s * 0.047 + 2.0)) * sqrt(along);
      return 1.0 - smoothstep(hw - 1.4, hw, abs(w.x * r.z - c));
    }
    float kitRiver(vec3 w){ float s = uDistMod - w.z; return max(kitRiverSeg(w, uRiv0, s), kitRiverSeg(w, uRiv1, s)); }`;
  mats.ground = snowMat(1 / 12, 1 / 12, "kitGround", `
      {
        float side = smoothstep(5.2, 8.0, abs(kitW.x));
        float br = kitZone(kitW.z, uBridge) * side;
        transformed.y -= br * 1.0 + kitRiver(kitW.xyz) * 0.3;
      }`, {
    uniforms: { uBridge: U.uBridge, uIce: { value: lin(0x9ED8F6).multiplyScalar(0.55) }, uDistMod: U.uDistMod, uRiv0: U.uRiv0, uRiv1: U.uRiv1 },
    vPars: ZONE + "uniform vec2 uBridge; uniform float uDistMod; uniform vec4 uRiv0; uniform vec4 uRiv1;" + RIVER_GLSL,
    fPars: ZONE + "uniform vec3 uIce; uniform float uDistMod; uniform vec2 uBridge; uniform vec4 uRiv0; uniform vec4 uRiv1; float vRiver;" + RIVER_GLSL,
    fColor: `
      vRiver = max(kitZone(vKitW.z, uBridge) * smoothstep(5.2, 8.0, abs(vKitW.x)), kitRiver(vKitW));
      {
        float s = uDistMod - vKitW.z;
        float crack = smoothstep(0.985, 1.0, abs(sin(vKitW.x * 0.9 + s * 0.35 + sin(s * 0.13) * 2.0)));
        vec3 ice = uIce * (0.9 + 0.15 * sin(vKitW.x * 0.21 + s * 0.05)) + crack * 0.25;
        diffuseColor.rgb = mix(diffuseColor.rgb, ice, vRiver);
      }`,
    fRough: "roughnessFactor = mix(roughnessFactor, 0.1, vRiver);",
    fEmis: "totalEmissiveRadiance *= 1.0 - vRiver;",
  });
  mats.snowDecor = L ? own(L.snow({ unique: true, repeat: 0.5 })) : own(new THREE.MeshStandardMaterial({ color: lin(0xF4F8FF).multiplyScalar(1.3), roughness: 0.95 }));

  // дальние силуэты: плоские карточки, альфа-тест, туман есть, теней нет
  mats.cardTrees = own(new THREE.MeshBasicMaterial({ map: own(cardTex("trees")), alphaTest: 0.5, color: 0xffffff }));
  mats.cardHouses = own(new THREE.MeshBasicMaterial({ map: own(cardTex("houses")), alphaTest: 0.5, color: 0xffffff }));

  // текстура вывески арки «ИДЕАЛИТИ»
  const signMap = own(signTex("ИДЕАЛИТИ"));
  mats.sign = own(new THREE.MeshStandardMaterial({ map: signMap, roughness: 0.75, emissive: 0xffffff, emissiveMap: signMap, emissiveIntensity: 0.12 }));
  // перерисовать вывеску настоящим Nunito, когда он загрузится (один раз, не в кадре)
  loadKitFont().then(ok => { if (ok && !disposed){ drawSign(signMap.image.getContext("2d"), signMap.image.width, signMap.image.height, "ИДЕАЛИТИ"); signMap.needsUpdate = true; } });

  let disposed = false;
  mats.dispose = () => { disposed = true; for (const d of disposables) d.dispose(); };
  // текстуры, которые прокручиваются по z вместе с миром (uv.v всех полос — метры): offset.y = fract(dist · repeat.y)
  mats.scrollTextures = [trackMap, trackNormal];
  for (const m of [mats.bank, mats.ground]) for (const k of ["map", "normalMap", "emissiveMap"]) if (m[k]) mats.scrollTextures.push(m[k]);
  mats.scrollTextures = mats.scrollTextures.filter(Boolean);
  return mats;
}

// ---------- ПРОЦЕДУРНЫЕ ТЕКСТУРЫ ----------
function canvas(w, h, draw){
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}
function prng(seed){ let a = seed; return () => { a = (a * 16807) % 2147483647; return (a - 1) / 2147483646; }; }

// утрамбованный снег: 9.2 м по ширине, 8 м по длине; колеи #D8E2F5 по 0.25 м у каждой полосы
function trackTex(S){
  const t = canvas(S, S * 2, (g, w, h) => {
    const r = prng(99);
    g.fillStyle = "#f4f7fd"; g.fillRect(0, 0, w, h);
    const px = w / 9.2;
    // крупные пятна утрамбовки
    for (let i = 0; i < 90; i++){
      g.fillStyle = `rgba(${200 + r() * 30},${214 + r() * 25},${240},${0.05 + r() * 0.07})`;
      g.beginPath(); g.ellipse(r() * w, r() * h, 6 + r() * 30, 10 + r() * 60, 0, 0, 7); g.fill();
    }
    // колеи: по две на полосу, мягкие края, лёгкая волна
    for (const lane of [-2.55, 0, 2.55]) for (const off of [-0.42, 0.42]){
      const cx = (lane + off + 4.6) * px;
      for (let y = 0; y < h; y += 2){
        const wob = Math.sin(y / h * Math.PI * 2 * 2) * px * 0.03;
        const gr = g.createLinearGradient(cx - px * 0.2 + wob, 0, cx + px * 0.2 + wob, 0);
        gr.addColorStop(0, "rgba(216,226,245,0)"); gr.addColorStop(0.5, "rgba(206,218,242,0.85)"); gr.addColorStop(1, "rgba(216,226,245,0)");
        g.fillStyle = gr; g.fillRect(cx - px * 0.2 + wob, y, px * 0.4, 2);
      }
    }
    // мелкое зерно
    for (let i = 0; i < w * h / 60; i++){
      const v = r();
      g.fillStyle = v < 0.5 ? "rgba(190,205,235,.18)" : "rgba(255,255,255,.5)";
      g.fillRect(r() * w, r() * h, 1 + r() * 1.5, 1 + r() * 1.5);
    }
    // затемнение у бордюров (контактная тень)
    for (const side of [0, 1]){
      const gr = g.createLinearGradient(side ? w : 0, 0, side ? w - px * 0.5 : px * 0.5, 0);
      gr.addColorStop(0, "rgba(150,170,215,.45)"); gr.addColorStop(1, "rgba(150,170,215,0)");
      g.fillStyle = gr; g.fillRect(side ? w - px * 0.5 : 0, 0, px * 0.5, h);
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function fallbackWood(){
  const t = canvas(256, 256, (g, w, h) => {
    const r = prng(7);
    for (let i = 0; i < 8; i++){
      g.fillStyle = ["#e6c096", "#f0cfa4", "#dfb98e", "#f5d7ad"][i % 4];
      g.fillRect(0, i * h / 8, w, h / 8 - 3);
      g.fillStyle = "rgba(96,60,36,.8)"; g.fillRect(0, (i + 1) * h / 8 - 3, w, 3);
      for (let k = 0; k < 6; k++){ g.fillStyle = "rgba(150,105,62,.15)"; g.fillRect(0, i * h / 8 + r() * h / 8, w, 1); }
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// знаки: JUMP — двойной шеврон вверх #FF3B5C; SLIDE — арка + двойной шеврон вниз #0536D4; WALL — жирный X #070D36
function decalAtlas(){
  const t = canvas(768, 256, (g) => {
    const cell = (i, fn) => { g.save(); g.translate(i * 256 + 128, 128); fn(); g.restore(); };
    const stroke = (path, fill) => {
      g.lineJoin = "round"; g.lineCap = "round";
      g.strokeStyle = "#ffffff"; g.lineWidth = 58; path(); g.stroke();
      g.strokeStyle = fill; g.lineWidth = 36; path(); g.stroke();
    };
    const chev = (y, dir) => () => { g.beginPath(); g.moveTo(-72, y + 34 * dir); g.lineTo(0, y - 30 * dir); g.lineTo(72, y + 34 * dir); };
    // JUMP (шеврон «вверх» = от игрока, в текстуре вверх)
    cell(0, () => { stroke(chev(-40, 1), "#FF3B5C"); stroke(chev(40, 1), "#FF3B5C"); });
    // SLIDE: арка сверху + шевроны вниз
    cell(1, () => {
      stroke(() => { g.beginPath(); g.moveTo(-84, -20); g.lineTo(-84, -70); g.lineTo(84, -70); g.lineTo(84, -20); }, "#0536D4");
      stroke(chev(10, -1), "#0536D4"); stroke(chev(78, -1), "#0536D4");
    });
    // WALL: X
    cell(2, () => { stroke(() => { g.beginPath(); g.moveTo(-70, -70); g.lineTo(70, 70); g.moveTo(70, -70); g.lineTo(-70, 70); }, "#070D36"); });
  });
  t.generateMipmaps = true;
  return t;
}

// дальние карточки: ёлки / ряды домиков; цвет — холодная дымка (тонируется палитрой через material.color)
function cardTex(kind){
  const t = canvas(512, 256, (g, w, h) => {
    const r = prng(kind === "trees" ? 31 : 57);
    g.clearRect(0, 0, w, h);
    if (kind === "trees"){
      for (let i = 0; i < 11; i++){
        const x = 20 + r() * (w - 40), hh = 90 + r() * 150, ww = hh * (0.34 + r() * 0.1);
        const tone = 150 + r() * 40;
        g.fillStyle = `rgb(${tone - 30},${tone + 10},${tone + 55})`;
        for (let k = 0; k < 3; k++){
          const y0 = h - hh * (0.12 + k * 0.28), ww2 = ww * (1 - k * 0.24);
          g.beginPath(); g.moveTo(x - ww2 / 2, y0); g.lineTo(x, y0 - hh * 0.45); g.lineTo(x + ww2 / 2, y0); g.closePath(); g.fill();
        }
        g.fillStyle = "rgba(255,255,255,.9)";
        g.beginPath(); g.moveTo(x - ww * 0.14, h - hh * 0.8); g.lineTo(x, h - hh * 0.98); g.lineTo(x + ww * 0.14, h - hh * 0.8); g.closePath(); g.fill();
      }
      g.fillStyle = "rgb(214,228,250)"; g.fillRect(0, h - 22, w, 22);
    } else {
      let x = 10;
      while (x < w - 60){
        const bw = 50 + r() * 50, bh = 50 + r() * 50, tone = 170 + r() * 35;
        g.fillStyle = `rgb(${tone},${tone + 12},${tone + 45})`;
        g.fillRect(x, h - bh - 20, bw, bh);
        g.beginPath(); g.moveTo(x - 8, h - bh - 20); g.lineTo(x + bw / 2, h - bh - 20 - bw * 0.55); g.lineTo(x + bw + 8, h - bh - 20); g.closePath();
        g.fillStyle = "rgb(250,252,255)"; g.fill();
        g.fillStyle = "rgba(255,206,120,.95)";
        g.fillRect(x + bw * 0.2, h - bh * 0.7 - 20, bw * 0.18, bh * 0.22); g.fillRect(x + bw * 0.6, h - bh * 0.7 - 20, bw * 0.18, bh * 0.22);
        x += bw + 14 + r() * 30;
      }
      g.fillStyle = "rgb(222,234,252)"; g.fillRect(0, h - 22, w, 22);
    }
  });
  t.anisotropy = 4;
  return t;
}

function drawSign(g, w, h, text){
  g.clearRect(0, 0, w, h);
  g.fillStyle = "#0536D4"; g.beginPath(); g.roundRect(8, 8, w - 16, h - 16, 64); g.fill();
  g.strokeStyle = "#ffffff"; g.lineWidth = 14; g.beginPath(); g.roundRect(26, 26, w - 52, h - 52, 50); g.stroke();
  g.fillStyle = "#ffffff"; g.textAlign = "center"; g.textBaseline = "middle";
  g.font = "900 128px " + SIGN_FONT;
  g.fillText(text, w / 2, h / 2 + 8);
  // лаймовые звёздочки по краям — акцент бренда (над трассой, не в игровой полосе)
  g.fillStyle = "#C0FF3F";
  for (const x of [70, w - 70]){ g.beginPath(); for (let i = 0; i < 10; i++){ const a = i * Math.PI / 5 - Math.PI / 2, rr = i % 2 ? 14 : 34; g.lineTo(x + Math.cos(a) * rr, h / 2 + Math.sin(a) * rr); } g.fill(); }
}
function signTex(text){
  return canvas(1024, 256, (g, w, h) => drawSign(g, w, h, text));
}
