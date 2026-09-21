// Войлочные/тканевые волокна без UV: шум по позиции вершины В ПОЗЕ ПРИВЯЗКИ (attribute position до скиннинга),
// поэтому фактура «нарисована» на теле и не плывёт при анимации. Лёгкая рябь альбедо + зерно нормали.
// Подключается через onBeforeCompile с цепочкой prev (совместимо с patchRim из rim.js).
export function patchFibre(mat, o = {}){
  const freq = o.freq || 90, amp = o.amp != null ? o.amp : 0.1, nrm = o.nrm != null ? o.nrm : 0.1;
  const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey;
  mat.onBeforeCompile = function (sh, r){
    if (prev) prev.call(this, sh, r);
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vRzP;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvRzP = position;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>
varying vec3 vRzP;
float rzHash(vec3 p){ p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float rzNoise(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(rzHash(i), rzHash(i + vec3(1,0,0)), f.x), mix(rzHash(i + vec3(0,1,0)), rzHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(rzHash(i + vec3(0,0,1)), rzHash(i + vec3(1,0,1)), f.x), mix(rzHash(i + vec3(0,1,1)), rzHash(i + vec3(1,1,1)), f.x), f.y), f.z); }`)
      .replace("#include <color_fragment>", `#include <color_fragment>
{ vec3 q = vRzP * ${freq.toFixed(1)}; float f = 0.6 * rzNoise(q) + 0.4 * rzNoise(q * 2.9 + 7.3);
  diffuseColor.rgb *= 1.0 + ${amp.toFixed(3)} * (f - 0.5) * 2.0; }`)
      .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
{ vec3 q = vRzP * ${(freq * 1.7).toFixed(1)};
  normal = normalize(normal + ${nrm.toFixed(3)} * (vec3(rzNoise(q + 3.1), rzNoise(q + 41.7), rzNoise(q + 19.3)) - 0.5)); }`);
  };
  mat.customProgramCacheKey = function (){ return (prevKey ? prevKey.call(this) : "") + "|rizyFibre" + freq + "/" + amp + "/" + nrm; };
  mat.needsUpdate = true;
  return mat;
}
