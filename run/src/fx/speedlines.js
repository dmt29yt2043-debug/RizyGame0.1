// VFX-кит: тоннель линий скорости (VFX-3). Открытый цилиндр R=7, L=80 вокруг камеры, BackSide, аддитивно,
// без теста глубины, renderOrder 999. Сама геометрия держит центр экрана чистым: поверхность тоннеля начинается
// в ~10° от оси взгляда (дальний конец) и уходит в углы — читаемый «гиперпрыжок» только по краям кадра.
// Покрытие (доля изменённых пикселей на максимуме) меряется стендом: dev/kit-vfx.js → TEST.coverage().
import * as THREE from "three";

const VERT = /* glsl */`
varying vec2 vUv;
varying float vD;          // расстояние до камеры: у краёв кадра тоннель ближе → там штрихи ярче
void main(){
	vUv = uv;
	vec4 mv = modelViewMatrix * vec4( position, 1.0 );
	vD = -mv.z;
	gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */`
uniform float uTime;
uniform float uIntensity;
uniform float uSpeedK;
uniform float uCols;
uniform vec3 uColor;
varying vec2 vUv;
varying float vD;
float hash( float n ){ return fract( sin( n * 12.9898 ) * 43758.5453 ); }
void main(){
	float col = floor( vUv.x * uCols );
	float r = hash( col );
	float on = step( 0.62, r );                                        // 38% колонн заняты штрихами
	float seg = fract( vUv.y * 3.0 + uTime * ( 1.2 + r * 1.8 ) * uSpeedK );
	// штрих длиннее (окно ~0.33 вместо 0.23): на 60 fps он успевает прочитаться как полоса, а не как искра
	float streak = smoothstep( 0.0, 0.10, seg ) * smoothstep( 0.46, 0.13, seg );
	// ширина ~30% колонны с мягким краем: линия, а не волосок (на снегу волосок исчезал)
	float across = 1.0 - smoothstep( 0.05, 0.16, abs( fract( vUv.x * uCols ) - 0.5 ) );
	// ближняя часть тоннеля = края кадра; дальняя (центр экрана) почти гасится — герой остаётся чистым
	float edge = mix( 0.18, 1.0, smoothstep( 34.0, 7.0, vD ) );
	float alpha = on * streak * across * edge * uIntensity * ( 0.45 + 0.55 * hash( col + 7.0 ) );
	if ( alpha < 0.002 ) discard;
	gl_FragColor = vec4( uColor * alpha, 1.0 );
	#include <colorspace_fragment>
}
`;

export function createSpeedLines(opts){
  const segs = (opts && opts.segments) || 64;      // тесселяция цилиндра — печётся при создании, качеством не меняется
  const geo = new THREE.CylinderGeometry(7, 7, 80, segs, 1, true);
  geo.rotateX(-Math.PI / 2);          // ось вдоль z; uv.y = 1 впереди (−z), линии летят на камеру
  const uniforms = {
    uTime: { value: 0 }, uIntensity: { value: 0 }, uSpeedK: { value: 1 },
    uCols: { value: (opts && opts.columns) || 96 }, uColor: { value: new THREE.Color(0xEAF2FF) },
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
  mesh.matrixAutoUpdate = false;      // матрицу пишет vfx.update() (камера) — см. setPose ниже
  // плотность колонн = единственный параметр качества тоннеля (геометрия не пересоздаётся)
  function setColumns(n){ uniforms.uCols.value = Math.max(16, n | 0); }
  // поставить меш в позу камеры. matrixWorldNeedsUpdate ставим сами: корректность не должна зависеть
  // от того, обновляет ли родитель (vfx.root) свою матрицу автоматически
  function setPose(pos, quat, one){
    mesh.matrix.compose(pos, quat, one);
    mesh.matrixWorldNeedsUpdate = true;
  }
  return { mesh, uniforms, setColumns, setPose, dispose(){ geo.dispose(); mat.dispose(); } };
}
