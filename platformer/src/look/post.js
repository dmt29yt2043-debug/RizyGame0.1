// Постобработка (med/high): RenderPass (линейный HDR, HalfFloat) → UnrealBloom (половинное разрешение,
// порог выше 1 — светятся кристаллы, кромки золота, лифты, глаза Гасителей) → (high) лёгкий BokehPass
// (слабая глубина резкости, фокус на игровой плоскости) → тёплая закатная виньетка-грейд → OutputPass
// (там же — нейтральный тонмаппинг, включённый в main.js через installNeutralToneMapping).
// На low пост выключен: прямой рендер, свечение изображают аддитивные ореолы.
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { BokehPass } from "three/addons/postprocessing/BokehPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { CAM } from "../config.js";

// тёплый закатный грейд: мягкая виньетка к цвету чернил/сливы (не к чёрному — так лайм не сереет),
// лёгкий тёплый подъём светов
const VIGNETTE = {
  uniforms: {
    tDiffuse: { value: null }, uAmount: { value: 0.16 }, uFlash: { value: new THREE.Vector4(1, 1, 1, 0) },
    uEdge: { value: new THREE.Color(0x2a1f4d) }, uWarm: { value: new THREE.Color(0xffddb0) }, uWarmK: { value: 0.05 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uAmount; uniform vec4 uFlash; uniform vec3 uEdge, uWarm; uniform float uWarmK;
    varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 d = vUv - 0.5;
      float vgn = smoothstep(0.25, 0.85, dot(d, d) * 2.2);
      vec3 darkened = c.rgb * mix(vec3(1.0), uEdge, 0.55);              // тёмный край — в тон чернил, не серый
      c.rgb = mix(c.rgb, darkened, vgn * uAmount * 3.0);
      float lum = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      c.rgb += uWarm * uWarmK * lum;                                                        // лёгкий тёплый подъём светов
      c.rgb = mix(c.rgb, uFlash.rgb, uFlash.a);                                              // вспышка урона/победы
      gl_FragColor = c;
    }`,
};

// страховка перед bloom: пиксель с NaN/Inf (любая будущая ошибка в шейдере) гасим в ноль.
// Иначе размытие bloom растаскивает один такой пиксель на весь кадр — экран чернеет (так было с лентой рывка на Metal).
const SANITIZE = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      bvec4 bad = bvec4(c.r != c.r || c.r > 60000.0, c.g != c.g || c.g > 60000.0, c.b != c.b || c.b > 60000.0, c.a != c.a);
      if (any(bad)) c = vec4(0.0, 0.0, 0.0, 1.0);
      gl_FragColor = c;
    }`,
};

export function createPost(renderer, scene, camera, { bloom = 0.55, samples = 4, dof = false } = {}){
  const size = renderer.getSize(new THREE.Vector2());
  const dpr = renderer.getPixelRatio();
  // MSAA прямо в HDR-цели (WebGL2): сглаживание без отдельного прохода
  const rt = new THREE.WebGLRenderTarget(size.x * dpr, size.y * dpr, { type: THREE.HalfFloatType, samples: renderer.capabilities.isWebGL2 ? samples : 0 });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new ShaderPass(SANITIZE));
  const bloomPass = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), bloom, 0.5, 1.0);
  bloomPass.highPassUniforms && (bloomPass.highPassUniforms.smoothWidth.value = 0.35);
  composer.addPass(bloomPass);
  // лёгкая глубина резкости — только high: фокус на плоскости игры (камера смотрит на неё с CAM.dist)
  let bokeh = null;
  if (dof){
    bokeh = new BokehPass(scene, camera, { focus: CAM.dist, aperture: 0.0009, maxblur: 0.006 });
    composer.addPass(bokeh);
  }
  const vig = new ShaderPass(VIGNETTE);
  composer.addPass(vig);
  composer.addPass(new OutputPass());
  return {
    composer, bloomPass, vig, bokeh,
    // composer.setSize уже проходит по всем пассам (в т.ч. BokehPass — обновит aspect и карту глубины)
    setSize(w, h, dpr){ composer.setPixelRatio(dpr); composer.setSize(w, h); bloomPass.resolution.set(w / 2, h / 2); },
    flash(r, g, b, a){ vig.uniforms.uFlash.value.set(r, g, b, a); },
    render(dt){ composer.render(dt); },
  };
}
