// Постобработка (med/high): RenderPass (линейный HDR, HalfFloat) → UnrealBloom (половинное разрешение,
// порог выше 1 — светятся только кристаллы, глаза Гасителей, пламя и край солнца) → лёгкая виньетка → OutputPass.
// На low пост выключен: прямой рендер, свечение изображают аддитивные ореолы.
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

const VIGNETTE = {
  uniforms: { tDiffuse: { value: null }, uAmount: { value: 0.14 }, uFlash: { value: new THREE.Vector4(1, 1, 1, 0) } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uAmount; uniform vec4 uFlash; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 d = vUv - 0.5;
      float v = 1.0 - uAmount * smoothstep(0.25, 0.85, dot(d, d) * 2.2);
      c.rgb *= v;
      c.rgb = mix(c.rgb, uFlash.rgb, uFlash.a);          // вспышка урона/победы
      gl_FragColor = c;
    }`,
};

export function createPost(renderer, scene, camera, { bloom = 0.55, samples = 4 } = {}){
  const size = renderer.getSize(new THREE.Vector2());
  const dpr = renderer.getPixelRatio();
  // MSAA прямо в HDR-цели (WebGL2): сглаживание без отдельного прохода
  const rt = new THREE.WebGLRenderTarget(size.x * dpr, size.y * dpr, { type: THREE.HalfFloatType, samples: renderer.capabilities.isWebGL2 ? samples : 0 });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  const bloomPass = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), bloom, 0.5, 1.0);
  bloomPass.highPassUniforms && (bloomPass.highPassUniforms.smoothWidth.value = 0.35);
  composer.addPass(bloomPass);
  const vig = new ShaderPass(VIGNETTE);
  composer.addPass(vig);
  composer.addPass(new OutputPass());
  return {
    composer, bloomPass, vig,
    setSize(w, h, dpr){ composer.setPixelRatio(dpr); composer.setSize(w, h); bloomPass.resolution.set(w / 2, h / 2); },
    flash(r, g, b, a){ vig.uniforms.uFlash.value.set(r, g, b, a); },
    render(dt){ composer.render(dt); },
  };
}
