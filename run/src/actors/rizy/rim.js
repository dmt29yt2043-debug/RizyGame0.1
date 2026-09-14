// PLAYER-3: rim-свет (Френель с учётом солнца) через onBeforeCompile. Общие uniform-объекты:
// один набор на «кожу/свитер», другой на «волосы/шарф»; uSunDirView пишется раз в кадр.
import * as THREE from "three";

export function rimUniforms(color, strength, pow){
  return { uRimColor: { value: new THREE.Color(color) }, uRimStr: { value: strength }, uRimPow: { value: pow },
           base: { color: new THREE.Color(color), strength } };
}

// extraFrag — дополнительный GLSL после rim (например, самосвечение бликов глаз)
export function patchRim(mat, rim, sunU, extraFrag){
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey;
  mat.onBeforeCompile = function (sh, r){
    if (prev) prev.call(this, sh, r);
    sh.uniforms.uSunDirView = sunU;
    let code = "";
    if (rim){
      sh.uniforms.uRimColor = rim.uRimColor; sh.uniforms.uRimStr = rim.uRimStr; sh.uniforms.uRimPow = rim.uRimPow;
      code += `
      {
        float rimFr = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), uRimPow);
        float rimSide = 0.35 + 0.65 * saturate(dot(normal, uSunDirView));
        totalEmissiveRadiance += uRimColor * rimFr * rimSide * uRimStr;
      }`;
    }
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec3 uRimColor;\nuniform float uRimStr;\nuniform float uRimPow;\nuniform vec3 uSunDirView;")
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n" + code + (extraFrag || ""));
  };
  mat.customProgramCacheKey = function (){
    return (prevKey ? prevKey.call(this) : "") + "|rizyRim" + (rim ? "R" : "") + (extraFrag ? "E" + extraFrag.length : "");
  };
  mat.needsUpdate = true;
  return mat;
}
