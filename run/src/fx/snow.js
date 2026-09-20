// VFX-кит: окружающий снег вокруг камеры. Один InstancedMesh-квад на снежинку, ОДИН draw call.
// Позиция целиком в шейдере: падение 0.7–1.3 м/с, дрейф sin(0.3t)·0.4, прокрутка мира uScroll (+z),
// заворот по модулю в боксе 30×16×60 м, привязанном к камере. CPU каждый кадр пишет только униформы.
// Круглый мягкий диск; выше скорости 20 — вытягивается вдоль экранной скорости (длина 0.02·speed м).
import * as THREE from "three";
import { curveHook } from "./pool.js";

const VERT = /* glsl */`
#include <common>
#include <fog_pars_vertex>
//FX_CURVE_PARS
uniform float uTime;
uniform float uScroll;
uniform vec3 uCam;
uniform vec3 uBox;
uniform vec3 uBoxOff;     // центр бокса относительно камеры
uniform float uSpeed;
uniform float uStretch;   // 0..1
uniform float uNearFade;
uniform float uAlpha;
attribute vec4 aSeed;     // x, y, z в [0,1), размер (м)
attribute vec2 aRand;     // скорость падения, фаза
varying vec2 vUv;
varying float vAlpha;

void main(){
	float ph = aRand.y * 6.2831;
	vec3 b = aSeed.xyz * uBox;
	b.y -= uTime * aRand.x;
	b.x += sin( 0.3 * uTime + ph ) * 0.4;
	b.z += uScroll;
	vec3 lo = uCam + uBoxOff - 0.5 * uBox;
	vec3 rel = mod( b - lo, uBox );
	vec3 w = lo + rel;
	// мягкое появление у граней бокса (чтобы заворот не «щёлкал»)
	vec3 edge = min( rel, uBox - rel );
	float fade = smoothstep( 0.0, 2.0, edge.x ) * smoothstep( 0.0, 1.5, edge.y ) * smoothstep( 0.0, 4.0, edge.z );
#ifdef CURVE_ON
	w = curveBend( w );
#endif
	vec4 mv = viewMatrix * vec4( w, 1.0 );
	float size = aSeed.w;
	// экранная скорость: мир летит на камеру (+z), снег падает и дрейфует
	vec3 v = vec3( 0.12 * cos( 0.3 * uTime + ph ), -aRand.x, uSpeed );
	vec3 vv = mat3( viewMatrix ) * v;
	vec2 sd = vv.xy * ( -mv.z ) + mv.xy * vv.z;
	float l = length( sd );
	vec2 d = l > 1e-5 ? sd / l : vec2( 0.0, 1.0 );
	float len = mix( size, max( size, 0.02 * uSpeed ), uStretch );
	vec2 c = position.xy;
	vUv = c * 2.0;
	mv.xy += d * ( c.y * len ) + vec2( -d.y, d.x ) * ( c.x * size );
	// растянутая снежинка той же «массы» — прозрачнее
	vAlpha = uAlpha * fade * mix( 1.0, clamp( sqrt( size / len ) * 1.35, 0.35, 1.0 ), uStretch );
	// у камеры: растянутая снежинка гаснет раньше (иначе 0.6-метровый штрих в метре от объектива = брус на пол-экрана)
	float nf = mix( uNearFade, uNearFade * 3.6, uStretch );
	vAlpha *= smoothstep( nf * 0.4, nf, -mv.z );
	gl_Position = projectionMatrix * mv;
	// на скорости центр кадра чище: героиня и полосы читаются, «гиперпрыжок» только по краям
	vec2 ndc = gl_Position.xy / max( gl_Position.w, 1e-4 );
	vAlpha *= mix( 1.0, 0.3 + 0.7 * smoothstep( 0.12, 0.62, length( ndc * vec2( 1.0, 0.85 ) ) ), uStretch );
#ifdef USE_FOG
	vFogDepth = -mv.z;
#endif
}
`;

const FRAG = /* glsl */`
#include <common>
#include <fog_pars_fragment>
uniform vec3 uColor;
varying vec2 vUv;
varying float vAlpha;
void main(){
	float r = length( vUv );
	float m = 1.0 - smoothstep( 0.25, 1.0, r );
	float a = m * vAlpha;
	if ( a < 0.004 ) discard;
	// ядро чуть холоднее кромки не нужно: чистый снег, лёгкий голубой край даёт читаемость на белом
	vec3 col = mix( vec3( 0.80, 0.87, 1.0 ), uColor, smoothstep( 1.0, 0.45, r ) );
#ifdef USE_FOG
	#ifdef FOG_EXP2
	float ff = 1.0 - exp( -fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
	float ff = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	col = mix( col, fogColor, ff );
	a *= 1.0 - ff * 0.6;
#endif
	gl_FragColor = vec4( col, a );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	gl_FragColor.rgb *= gl_FragColor.a;
}
`;

export function createSnow(opts){
  const count = opts.count | 0;
  const box = opts.box || [30, 16, 60];
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  const seed = new Float32Array(count * 4), rand = new Float32Array(count * 2);
  // свой ГПСЧ — раскладка снега не зависит от ?seed игры
  let s = 91131;
  const r = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  for (let i = 0; i < count; i++){
    seed[i * 4] = r(); seed[i * 4 + 1] = r(); seed[i * 4 + 2] = r();
    // размер 0.05–0.13 м, мелких больше
    const q = r(); seed[i * 4 + 3] = 0.05 + 0.08 * q * q;
    rand[i * 2] = 0.7 + 0.6 * r(); rand[i * 2 + 1] = r();
  }
  geo.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seed, 4));
  geo.setAttribute("aRand", new THREE.InstancedBufferAttribute(rand, 2));
  geo.instanceCount = count;

  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uTime: { value: 0 }, uScroll: { value: 0 },
    uCam: { value: new THREE.Vector3() },
    uBox: { value: new THREE.Vector3(box[0], box[1], box[2]) },
    uBoxOff: { value: new THREE.Vector3(0, 3.5, -box[2] / 2 + 6) },   // от камеры: −54..+6 м по z
    uSpeed: { value: 12 }, uStretch: { value: 0 },
    uNearFade: { value: 0.9 }, uAlpha: { value: 0.92 },
    uColor: { value: new THREE.Color(0xF2F6FF) },
  }]);
  const mat = new THREE.ShaderMaterial({
    name: "fx:snow", uniforms, vertexShader: VERT, fragmentShader: FRAG,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,   // плоские/штрих-квады меняют обход
    fog: true,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
  curveHook(mat);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = "fx:snow";
  mesh.frustumCulled = false;
  mesh.renderOrder = opts.renderOrder || 0;

  // сколько снежинок рисовать (reduced motion/качество меняют на лету, без пересоздания)
  function setCount(n){ geo.instanceCount = Math.max(0, Math.min(count, n | 0)); mesh.visible = geo.instanceCount > 0; }

  return { mesh, uniforms, count, setCount, dispose(){ geo.dispose(); mat.dispose(); } };
}
