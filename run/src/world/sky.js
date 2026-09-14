// world-kit: купол неба (градиент + диск солнца + 3 слоя гор + облака прямо в шейдере, 1 draw call),
// туман в цвет горизонта и цветовой сценарий из 4 ключей (LOOK-8) с плавным переходом.
import * as THREE from "three";
import { clamp } from "./util.js";

// ключи сценария: небо top / horizon = туман / солнце (цвет, сила, высота°) / hemi / фонари / прочее
export const PALETTES = [
  { name: "УТРО",          top: 0x62AEFF, hor: 0xFFF1E4, sun: 0xFFF3DE, sunI: 2.6, sunEl: 38, hemi: 0.30, lamps: 0.0, win: 1.1, sat: 1.10, thr: 0.0, halo: 0.32, rim: 1, mtnK: 1.0 },
  { name: "ПОЛДЕНЬ-КЭНДИ", top: 0x3F8BFF, hor: 0xEAF6FF, sun: 0xFFFFFF, sunI: 2.9, sunEl: 55, hemi: 0.30, lamps: 0.0, win: 0.9, sat: 1.12, thr: 0.0, halo: 0.32, rim: 1, mtnK: 1.0 },
  { name: "ЗОЛОТОЙ ЧАС",   top: 0x7C7BFF, hor: 0xFFC7B0, sun: 0xFFB27A, sunI: 2.2, sunEl: 14, hemi: 0.28, lamps: 0.5, win: 1.8, sat: 1.10, thr: 0.0, halo: 0.36, rim: 1.3, mtnK: 0.85 },
  { name: "СИНИЙ ЧАС",     top: 0x0B1E7A, hor: 0x9DB4FF, sun: 0x9FB8FF, sunI: 0.8, sunEl: 10, hemi: 0.45, lamps: 4.0, win: 4.0, sat: 1.05, thr: -0.4, halo: 0.45, rim: 2, mtnK: 0.55 },
];

const SKY_VERT = /* glsl */`
  varying vec3 vDir;
  void main(){
    vDir = position;
    vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
    gl_Position = p; gl_Position.z = p.w * 0.99999;
  }`;

const SKY_FRAG = /* glsl */`
  uniform vec3 uTop, uHor, uSunCol, uSunDir, uCloudLit, uCloudShade;
  uniform vec3 uM0, uM1, uM2;
  uniform float uSunK, uTime, uMtnK, uCamX;
  varying vec3 vDir;
  // гребень: острые пики, мягкие долины (1 − |sin|), в радианах возвышения
  float ridge(float a, float f, float ph, float base, float amp){
    float h = 0.55 * (1.0 - abs(sin(a * f + ph)))
            + 0.30 * (1.0 - abs(sin(a * f * 2.13 + ph * 1.7)))
            + 0.15 * (1.0 - abs(sin(a * f * 4.71 + ph * 0.3)));
    return base + amp * h * h;
  }
  float puff(vec2 p, vec2 c, float r){ return smoothstep(r, r * 0.55, length((p - c) * vec2(1.0, 1.9))); }
  void main(){
    vec3 d = normalize(vDir);
    float y = d.y;
    float az = atan(d.x, -d.z);
    vec3 col = mix(uHor, uTop, pow(clamp(y * 1.6 + 0.08, 0.0, 1.0), 0.6));
    col = mix(col, uHor * 0.96, smoothstep(0.0, -0.03, y));
    // солнце: диск (HDR) + мягкое сияние
    float sd = max(dot(d, uSunDir), 0.0);
    col += uSunCol * (smoothstep(0.9990, 0.9996, sd) * 8.0 + pow(sd, 64.0) * 0.6 + pow(sd, 8.0) * 0.08) * uSunK;
    // облака: 6 штук, каждое из 4 шапок, дрейф по азимуту
    float cl = 0.0, top = 0.0;
    for (int i = 0; i < 6; i++){
      float fi = float(i);
      float cx = mod(fi * 1.047 + 0.35 + uTime * 0.0015 * (1.0 + fi * 0.17), 6.2831853) - 3.14159265;
      float cy = 0.10 + 0.07 * fract(fi * 0.618 + 0.2);
      float s = 0.030 + 0.012 * fract(fi * 0.381);
      vec2 p = vec2(az, y);
      float w = cos(cy);
      p.x *= w; cx *= w;
      float c = max(max(puff(p, vec2(cx, cy), s * 1.6), puff(p, vec2(cx + s * 1.8, cy - s * 0.2), s * 1.2)),
                    max(puff(p, vec2(cx - s * 1.7, cy - s * 0.25), s * 1.1), puff(p, vec2(cx + s * 0.6, cy + s * 0.55), s * 1.25)));
      c *= smoothstep(cy - s * 0.75, cy - s * 0.35, y);
      if (c > cl){ cl = c; top = clamp((y - cy) / (s * 1.6) + 0.55, 0.0, 1.0); }
    }
    col = mix(col, mix(uCloudShade, uCloudLit, top), cl * 0.78);
    // горы: дальний → ближний; цвет подмешан к горизонту 80 / 60 / 40 %
    float ax = az + uCamX;
    vec3 M[3]; M[0] = uM0; M[1] = uM1; M[2] = uM2;
    for (int i = 0; i < 3; i++){
      float fi = float(i);
      float f = 3.1 + fi * 1.9, ph = 1.3 + fi * 2.1;
      float base = -0.03, amp = 0.12 - fi * 0.028;
      float px = ax * (1.0 + fi * 0.08);
      float h = ridge(px, f, ph, base, amp);
      if (y < h){
        float e = 0.004;
        float dh = (ridge(px + e, f, ph, base, amp) - ridge(px - e, f, ph, base, amp)) / (2.0 * e);
        // склон «лицом» к солнцу (солнце слева: светлее склоны, растущие вправо)
        float lit = clamp(0.62 + dh * 0.9 * sign(-uSunDir.x + 1e-4) * -1.0, 0.35, 1.0);
        float mixH = 0.8 - fi * 0.2;
        vec3 body = mix(M[i] * uMtnK * mix(0.78, 1.04, lit), uHor, mixH);
        float capLine = h - 0.010 - 0.30 * max(0.0, h - (base + amp * 0.35));
        float cap = smoothstep(capLine - 0.002, capLine + 0.002, y) * step(base + amp * 0.3, h);
        vec3 snow = mix(vec3(1.0) * uMtnK * mix(0.84, 1.08, lit), uHor, mixH * 0.8);
        col = mix(body, snow, cap);
        // дымка к подножию
        col = mix(col, uHor, 0.55 * smoothstep(base + amp * 0.25, base - 0.02, y));
      }
    }
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

export function createSky(ctx, U){
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTop: { value: new THREE.Color() }, uHor: { value: new THREE.Color() },
      uSunCol: { value: new THREE.Color() }, uSunDir: { value: new THREE.Vector3() }, uSunK: { value: 1 },
      uCloudLit: { value: new THREE.Color(1, 1, 1) }, uCloudShade: { value: new THREE.Color(0xDDE6FF) },
      uM0: { value: new THREE.Color(0xCFE0FF) }, uM1: { value: new THREE.Color(0xB9D2FF) }, uM2: { value: new THREE.Color(0xE8F1FF) },
      uMtnK: { value: 1 }, uTime: U.uTimeReal, uCamX: { value: 0 },
    },
    vertexShader: SKY_VERT, fragmentShader: SKY_FRAG,
    side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(300, 32, 16), mat);
  mesh.frustumCulled = false; mesh.renderOrder = -10; mesh.userData.noCurve = true;
  mesh.castShadow = mesh.receiveShadow = false;
  mesh.name = "world:sky";

  const fog = new THREE.Fog(0xffffff, 30, 95);

  // живое состояние палитры (читает адаптер: свет, пост)
  const state = {
    index: 0, from: 0, to: 0, t: 1, dur: 25,
    top: new THREE.Color(), horizon: new THREE.Color(), sunColor: new THREE.Color(),
    sunIntensity: 2.6, sunElevation: 38, hemi: 0.3, lamps: 0, windows: 1.1, saturation: 1.1,
    bloomThresholdDelta: 0, haloOpacity: 0.32, rimMul: 1, mtnK: 1,
  };
  const cA = new THREE.Color(), cB = new THREE.Color();
  function blend(k){
    const a = PALETTES[state.from], b = PALETTES[state.to];
    const L = (x, y) => x + (y - x) * k;
    state.top.copy(cA.setHex(a.top)).lerp(cB.setHex(b.top), k);
    state.horizon.copy(cA.setHex(a.hor)).lerp(cB.setHex(b.hor), k);
    state.sunColor.copy(cA.setHex(a.sun)).lerp(cB.setHex(b.sun), k);
    state.sunIntensity = L(a.sunI, b.sunI); state.sunElevation = L(a.sunEl, b.sunEl);
    state.hemi = L(a.hemi, b.hemi); state.lamps = L(a.lamps, b.lamps); state.windows = L(a.win, b.win);
    state.saturation = L(a.sat, b.sat); state.bloomThresholdDelta = L(a.thr, b.thr);
    state.haloOpacity = L(a.halo, b.halo); state.rimMul = L(a.rim, b.rim); state.mtnK = L(a.mtnK, b.mtnK);
  }

  function setKey(i, instant){
    i = ((i | 0) % PALETTES.length + PALETTES.length) % PALETTES.length;
    if (instant){ state.from = state.to = i; state.t = 1; }
    else if (i !== state.to){
      // переход из текущего смешанного состояния: «замораживаем» текущее как from (ближайший ключ)
      state.from = state.t < 0.5 ? state.from : state.to; state.to = i; state.t = 0;
    }
    state.index = i;
    blend(instant ? 1 : 0);
  }

  const sunDir = new THREE.Vector3();
  function update(realDt, camera){
    if (state.t < 1){ state.t = Math.min(1, state.t + realDt / state.dur); }
    const k = state.t * state.t * (3 - 2 * state.t);
    blend(k);
    const u = mat.uniforms;
    u.uTop.value.copy(state.top);
    u.uHor.value.copy(state.horizon);
    fog.color.copy(state.horizon);
    // диск солнца в кадре слева сверху: азимут −30°, высота ~12° (ниже в золотой / синий час)
    const el = clamp(state.sunElevation * 0.28, 5, 16) * Math.PI / 180, az = -30 * Math.PI / 180;
    sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
    u.uSunDir.value.copy(sunDir);
    u.uSunCol.value.copy(state.sunColor);
    u.uSunK.value = clamp(state.sunIntensity / 2.6, 0.25, 1.2);
    u.uMtnK.value = state.mtnK;
    u.uCloudShade.value.copy(state.horizon).lerp(cA.setHex(0xC9D6F5), 0.5).multiplyScalar(0.55 + 0.45 * state.mtnK);
    u.uCloudLit.value.setRGB(1, 1, 1).lerp(state.sunColor, 0.25).multiplyScalar(0.6 + 0.4 * state.mtnK);
    if (camera) u.uCamX.value = camera.position.x * 0.0006;
  }

  setKey(0, true);
  update(0, null);
  return { mesh, fog, state, setKey, update, dispose(){ mesh.geometry.dispose(); mat.dispose(); } };
}
