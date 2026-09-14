// VFX-кит: тоннель линий скорости (VFX-3). Открытый цилиндр R=7, L=80 вокруг камеры, BackSide, аддитивно,
// без теста глубины, renderOrder 999. Сама геометрия держит центр экрана чистым: линии видны только по краям.
import * as THREE from "three";

const VERT = /* glsl */`
varying vec2 vUv;
void main(){
	vUv = uv;
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}
`;

const FRAG = /* glsl */`
uniform float uTime;
uniform float uIntensity;
uniform float uSpeedK;
uniform float uCols;
uniform vec3 uColor;
varying vec2 vUv;
float hash( float n ){ return fract( sin( n * 12.9898 ) * 43758.5453 ); }
void main(){
	float col = floor( vUv.x * uCols );
	float r = hash( col );
	float on = step( 0.82, r );                                        // 18% колонн
	float seg = fract( vUv.y * 3.0 + uTime * ( 1.2 + r * 1.8 ) * uSpeedK );
	float streak = smoothstep( 0.0, 0.08, seg ) * smoothstep( 0.35, 0.12, seg );
	// поперёк колонны — мягкая линия, а не прямоугольник
	// тонкая линия (~18% ширины колонны) с мягким краем — не широкий луч
	float across = 1.0 - smoothstep( 0.02, 0.09, abs( fract( vUv.x * uCols ) - 0.5 ) );
	float alpha = on * streak * across * uIntensity * ( 0.4 + 0.6 * hash( col + 7.0 ) );
	if ( alpha < 0.002 ) discard;
	gl_FragColor = vec4( uColor * alpha, 1.0 );
	#include <colorspace_fragment>
}
`;

export function createSpeedLines(opts){
  const segs = opts.segments || 64;
  const geo = new THREE.CylinderGeometry(7, 7, 80, segs, 1, true);
  geo.rotateX(-Math.PI / 2);          // ось вдоль z; uv.y = 1 впереди (−z), линии летят на камеру
  const uniforms = {
    uTime: { value: 0 }, uIntensity: { value: 0 }, uSpeedK: { value: 1 },
    uCols: { value: 96 }, uColor: { value: new THREE.Color(0xEAF2FF) },
  };
  const mat = new THREE.ShaderMaterial({
    name: "fx:speedlines", uniforms, vertexShader: VERT, fragmentShader: FRAG,
    side: THREE.BackSide, transparent: true, depthTest: false, depthWrite: false,
    blending: THREE.AdditiveBlending, fog: false, toneMapped: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = "fx:speedlines";
  mesh.frustumCulled = false;
  mesh.renderOrder = 999;
  mesh.visible = false;
  mesh.userData.noCurve = true;       // curve.patch: не гнуть
  mesh.matrixAutoUpdate = false;
  return { mesh, uniforms, dispose(){ geo.dispose(); mat.dispose(); } };
}
