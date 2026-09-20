// Тонмаппинг «Khronos PBR Neutral» для three r160 (штатный NeutralToneMapping появился только в r162).
// LOOK-1: ACES уводил лайм #C0FF3F в жёлтый, а синий #0536D4 в фиолетовый; Neutral держит базовые цвета 1:1
// до пика 0.76 и мягко сжимает только света.
//
// Одна кривая — два пути:
//  • прямой рендер (фолбэк без поста, dev-страницы): чанк CustomToneMapping подменяется при импорте модуля,
//    дальше достаточно renderer.toneMapping = THREE.CustomToneMapping (экспозиция — toneMappingExposure);
//  • пост (post.js): финальный проход вызывает тот же GLSL над линейным HDR (neutralGLSL("postNeutral")).
// При рендере в цель (EffectComposer) three сам выключает тонмаппинг материалов — двойного не будет.
import * as THREE from "three";

// GLSL-функция с заданным именем (разные имена, чтобы не столкнуться с чанком в одной программе)
export function neutralGLSL(name){
  return `
vec3 ${name}( vec3 color ) {
	const float startCompression = 0.76;
	const float desaturation = 0.15;
	float x = min( color.r, min( color.g, color.b ) );
	float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
	color -= offset;
	float peak = max( color.r, max( color.g, color.b ) );
	if ( peak < startCompression ) return color;
	const float d = 1.0 - startCompression;
	float newPeak = 1.0 - d * d / ( peak + d - startCompression );
	color *= newPeak / peak;
	float g = 1.0 - 1.0 / ( desaturation * ( peak - newPeak ) + 1.0 );
	return mix( color, vec3( newPeak ), g );
}`;
}

// тот же расчёт на CPU (калибровка, тесты цвета): мутирует и возвращает out = [r, g, b] (линейные)
export function neutralCPU(r, g, b, out){
  const x = Math.min(r, g, b), off = x < 0.08 ? x - 6.25 * x * x : 0.04;
  r -= off; g -= off; b -= off;
  const peak = Math.max(r, g, b);
  if (peak >= 0.76){
    const d = 0.24, np = 1 - d * d / (peak + d - 0.76), s = np / peak;
    r *= s; g *= s; b *= s;
    const k = 1 - 1 / (0.15 * (peak - np) + 1);
    r += (np - r) * k; g += (np - g) * k; b += (np - b) * k;
  }
  out = out || [0, 0, 0];
  out[0] = r; out[1] = g; out[2] = b;
  return out;
}

const FROM = "vec3 CustomToneMapping( vec3 color ) { return color; }";
const TO = neutralGLSL("lookPbrNeutral") + "\nvec3 CustomToneMapping( vec3 color ) { return lookPbrNeutral( color * toneMappingExposure ); }";

// идемпотентно; вызывается при импорте, но можно и явно (вернёт true, если кривая на месте)
export function installNeutralToneMapping(renderer, exposure){
  const C = THREE.ShaderChunk;
  if (!C.tonemapping_pars_fragment.includes("lookPbrNeutral")){
    if (C.tonemapping_pars_fragment.includes(FROM)) C.tonemapping_pars_fragment = C.tonemapping_pars_fragment.replace(FROM, TO);
    else { console.warn("[tonemap] чанк CustomToneMapping не найден — другая версия three?"); return false; }
  }
  if (renderer){
    renderer.toneMapping = THREE.CustomToneMapping;
    if (typeof exposure === "number") renderer.toneMappingExposure = exposure;
  }
  return true;
}

installNeutralToneMapping();
