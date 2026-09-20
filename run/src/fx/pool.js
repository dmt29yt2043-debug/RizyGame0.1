// VFX-кит: GPU-пул мягких частиц. Один InstancedMesh-квад = одна частица, весь пул = ОДИН draw call.
// Движение аналитическое в вершинном шейдере:  p = start + vel·(1−e^(−drag·t))/drag + ½·grav·t²,
// поэтому CPU пишет в буфер только в момент эмиссии (кольцевой write-индекс, updateRange на кусок).
// Смешивание премультиплицированное: rgb·a, alpha·(1−add) — в одном вызове и обычные облачка,
// и аддитивные звёзды (add=1 → чистое сложение), и «полу-аддитивные» вспышки.
import * as THREE from "three";

// типы форм (aMisc.x)
export const TYPE = { PUFF: 0, PUFF2: 1, STAR: 2, FLAKE: 3, DISK: 4, RING: 5, STREAK: 6, CONFETTI: 7 };
// флаги (aMisc.z, битовая маска)
export const FLAG = {
  HOMING: 1,     // к uTarget по easeInQuad (магнит энергона)
  FLAT: 2,       // лежит на земле (кольцо приземления), не билборд
  FLUTTER: 4,    // конфетти: кувыркается (сжатие по оси + затенение)
  EASE_OUT: 8,   // размер по easeOutCubic (иначе линейно)
  LATE_FADE: 16, // альфа держится и гаснет в последние 30% жизни (иначе (1−k)^1.5)
  NO_GROUND: 32, // без мягкого среза о землю
};

const STRIDE = 24;

const VERT = /* glsl */`
#include <common>
#include <fog_pars_vertex>
//FX_CURVE_PARS
uniform float uTime;
uniform vec3 uTarget;
uniform float uNearFade;
attribute vec4 aStart;   // xyz, birth
attribute vec4 aVel;     // xyz, life
attribute vec4 aPhys;    // drag, grav, rot0, spin
attribute vec4 aSize;    // s0, s1, stretch, fadeIn
attribute vec4 aColor;   // rgb (может быть HDR > 1), alpha0
attribute vec4 aMisc;    // type, add, flags, seed
varying vec2 vUv;
varying vec4 vColor;
varying vec4 vInfo;      // type, add, k, flags
varying float vWorldY;
varying float vShade;

// бит флага без целочисленной арифметики (работает и в GLSL ES 1.0 / WebGL1)
float fxFlag( float f, float b ){ return mod( floor( f / b + 0.001 ), 2.0 ); }

void main(){
	float t = uTime - aStart.w;
	float life = aVel.w;
	if ( t < 0.0 || t >= life || life <= 0.0 ){
		gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 );   // вне клипа → ноль фрагментов
		return;
	}
	float k = t / life;
	float fl = aMisc.z;
	float drag = aPhys.x;
	float e = drag > 0.001 ? ( 1.0 - exp( -drag * t ) ) / drag : t;
	vec3 p = aStart.xyz + aVel.xyz * e;
	p.y += 0.5 * aPhys.y * t * t;
	if ( fxFlag( fl, 1.0 ) > 0.5 ){
		// магнит: easeInQuad к цели + дуга В СТОРОНУ (знак из seed) — шлейф идёт сбоку от силуэта, а не сквозь спину.
		// 2.2 м на пике дуги: с игровой камеры (6.4 м сзади) полуширина Ризи ≈ 0.45 м — шлейф гарантированно снаружи.
		float bow = sin( 3.14159 * k ) * ( 1.0 - k * 0.3 );
		p = mix( p, uTarget, k * k );
		p.x += ( aMisc.w - 0.5 ) * 2.2 * bow;
		p.y += 0.45 * bow;
	}

	float sk = fxFlag( fl, 8.0 ) > 0.5 ? 1.0 - ( 1.0 - k ) * ( 1.0 - k ) * ( 1.0 - k ) : k;
	float size = mix( aSize.x, aSize.y, sk );
	float alpha = aColor.a;
	if ( fxFlag( fl, 16.0 ) > 0.5 ) alpha *= 1.0 - smoothstep( 0.7, 1.0, k );
	else alpha *= pow( 1.0 - k, 1.5 );
	if ( aSize.w > 0.0 ) alpha *= smoothstep( 0.0, aSize.w, k );

	vec3 w = p;
#ifdef CURVE_ON
	w = curveBend( w );
#endif
	vec2 c = position.xy;              // −0.5..0.5
	vUv = c * 2.0;
	vShade = 1.0;
	vec4 mv;
	float gy = 10.0;
	if ( fxFlag( fl, 2.0 ) > 0.5 ){
		mv = viewMatrix * vec4( w.x + c.x * size, w.y, w.z + c.y * size, 1.0 );
	} else {
		mv = viewMatrix * vec4( w, 1.0 );
		vec2 q;
		if ( aMisc.x > 5.5 && aMisc.x < 6.5 ){
			// штрих: вытянут вдоль экранной скорости (текущей, с учётом drag и гравитации)
			vec3 v = aVel.xyz * exp( -drag * t );
			v.y += aPhys.y * t;
			vec3 vv = mat3( viewMatrix ) * v;
			vec2 sd = vv.xy * ( -mv.z ) + mv.xy * vv.z;   // производная проекции
			float l = length( sd );
			vec2 d = l > 1e-5 ? sd / l : vec2( 0.0, 1.0 );
			q = d * ( c.y * size * aSize.z ) + vec2( -d.y, d.x ) * ( c.x * size );
		} else {
			float ang = aPhys.z + aPhys.w * t;
			vec2 cc = c * size;
			if ( fxFlag( fl, 4.0 ) > 0.5 ){
				float fp = cos( aMisc.w * 6.2831 + t * ( 5.0 + aMisc.w * 7.0 ) );
				cc.x *= 0.12 + 0.88 * abs( fp );
				vShade = 0.72 + 0.28 * abs( fp ) + 0.12 * sign( fp );
			}
			float cs = cos( ang ), sn = sin( ang );
			q = vec2( cs * cc.x - sn * cc.y, sn * cc.x + cs * cc.y );
		}
		mv.xy += q;
		gy = p.y + q.x * viewMatrix[ 1 ][ 0 ] + q.y * viewMatrix[ 1 ][ 1 ];   // мировой y угла: (Rᵀ·q).y
		if ( fxFlag( fl, 32.0 ) > 0.5 ) gy = 10.0;
	}
	vWorldY = gy;
	// у самой камеры частица не должна заливать экран
	alpha *= smoothstep( uNearFade * 0.35, uNearFade, -mv.z );
	vColor = vec4( aColor.rgb, alpha );
	vInfo = vec4( aMisc.x, aMisc.y, k, aMisc.z );
	gl_Position = projectionMatrix * mv;
#ifdef USE_FOG
	vFogDepth = -mv.z;
#endif
}
`;

const FRAG = /* glsl */`
#include <common>
#include <fog_pars_fragment>
uniform sampler2D uAtlas;
uniform float uAtlasBias;   // смещение LOD: мелкие частицы не уходят на предельные мипы атласа
uniform float uGroundY;
uniform float uGroundSoft;
varying vec2 vUv;
varying vec4 vColor;
varying vec4 vInfo;
varying float vWorldY;
varying float vShade;

void main(){
	float type = vInfo.x;
	float r = length( vUv );
	vec3 col = vColor.rgb;
	float m = 0.0;
	if ( type < 1.5 ){
		// облачко (ячейка 0/1): свет из R, холодная тень снизу
		vec2 uv = vUv * 0.5 + 0.5;
		uv = vec2( uv.x * 0.5 + 0.5 * type, uv.y * 0.5 + 0.5 );
		vec4 tx = texture2D( uAtlas, uv, uAtlasBias );
		m = tx.a;
		col *= mix( vec3( 0.80, 0.86, 0.98 ), vec3( 1.08 ), tx.r );   // холодная, но не серая тень (на досках не «грязь»)
	} else if ( type < 3.5 ){
		// звезда (2) / снежинка (3) — нижняя строка атласа
		vec2 uv = vUv * 0.5 + 0.5;
		uv = vec2( uv.x * 0.5 + 0.5 * ( type - 2.0 ), uv.y * 0.5 );
		vec4 tx = texture2D( uAtlas, uv, uAtlasBias );
		m = tx.a;
		col *= 1.0 + 1.2 * exp( -r * r * 30.0 );     // горячее ядро
	} else if ( type < 4.5 ){
		// мягкий круг
		m = 1.0 - smoothstep( 0.0, 1.0, r );
		m *= m * ( 2.0 - m );
	} else if ( type < 5.5 ){
		// кольцо: толще в начале, тоньше к концу, мягкие края
		float th = mix( 0.26, 0.07, vInfo.z );
		float rr = 1.0 - th - 0.02;
		m = 1.0 - smoothstep( th * 0.25, th, abs( r - rr ) );
		m *= 1.0 + 0.35 * smoothstep( rr, rr + th, r );   // яркая внешняя кромка
	} else if ( type < 6.5 ){
		// штрих: y −1 хвост → +1 голова
		float across = 1.0 - smoothstep( 0.0, 1.0, abs( vUv.x ) );
		float along = smoothstep( -1.0, 0.5, vUv.y ) * ( 1.0 - smoothstep( 0.72, 1.0, vUv.y ) );
		m = across * across * along;
	} else {
		// конфетти: скруглённый прямоугольник 0.6×1 со сглаженным краем
		vec2 d = abs( vUv ) - vec2( 0.34, 0.66 );
		float sd = length( max( d, 0.0 ) ) + min( max( d.x, d.y ), 0.0 ) - 0.26;
		float aa = max( fwidth( sd ), 1e-3 );
		m = 1.0 - smoothstep( -aa, aa, sd );
		col *= vShade;
	}
	float a = m * vColor.a;
	// мягкий срез о землю вместо жёсткой линии пересечения
	a *= smoothstep( uGroundY, uGroundY + uGroundSoft, vWorldY );
	if ( a < 0.003 ) discard;
	float add = vInfo.y;
#ifdef USE_FOG
	#ifdef FOG_EXP2
	float ff = 1.0 - exp( -fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
	float ff = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	col = mix( col, fogColor, ff * ( 1.0 - add ) );
	a *= 1.0 - ff * add;
#endif
	gl_FragColor = vec4( col, a );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	gl_FragColor.rgb *= gl_FragColor.a;
	gl_FragColor.a *= 1.0 - add;
}
`;

// подключить изгиб мира из look/curve.js, если он установлен (иначе частицы просто не гнутся)
export function curveHook(material){
  material.onBeforeCompile = (sh) => {
    const on = !!THREE.ShaderChunk.curve_pars_vertex;
    sh.vertexShader = sh.vertexShader.replace("//FX_CURVE_PARS", on ? "#include <curve_pars_vertex>" : "");
    if (on && !sh.uniforms.curveParams){
      const src = THREE.ShaderLib.points.uniforms.curveParams;
      if (src) sh.uniforms.curveParams = material.uniforms.curveParams = src;
    }
  };
  material.customProgramCacheKey = () => "fx-curve:" + (THREE.ShaderChunk.curve_pars_vertex ? 1 : 0);
}

export function createPool(opts){
  const cap = opts.capacity | 0;
  const buf = new Float32Array(cap * STRIDE);
  const ib = new THREE.InstancedInterleavedBuffer(buf, STRIDE, 1);
  ib.setUsage(THREE.DynamicDrawUsage);

  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  const names = ["aStart", "aVel", "aPhys", "aSize", "aColor", "aMisc"];
  for (let i = 0; i < names.length; i++) geo.setAttribute(names[i], new THREE.InterleavedBufferAttribute(ib, 4, i * 4));
  geo.instanceCount = cap;
  // все частицы изначально мертвы: life = 0
  for (let i = 0; i < cap; i++) buf[i * STRIDE + 7] = 0;

  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uTime: { value: 0 },
    uTarget: { value: new THREE.Vector3(0, 1.1, 0) },
    uNearFade: { value: 1.2 },
    uAtlas: { value: opts.atlas },
    // мипы атласа: ячейки — ровные степени двойки (квадранты), box-фильтр не смешивает соседей вплоть до
    // уровня 1×1; плюс у всех четырёх форм альфа = 0 в рамке ~9 px (atlas.js gutter). Отрицательный bias
    // держит мелкие частицы на резких уровнях — «квадратных спрайтов» из усреднения не будет.
    uAtlasBias: { value: opts.atlasBias != null ? opts.atlasBias : -0.7 },
    uGroundY: { value: -0.02 },
    uGroundSoft: { value: 0.22 },
  }]);
  uniforms.uAtlas.value = opts.atlas;            // merge клонирует текстуры — вернуть общий атлас
  const mat = new THREE.ShaderMaterial({
    name: "fx:" + opts.name, uniforms, vertexShader: VERT, fragmentShader: FRAG,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,   // плоские/штрих-квады меняют обход
    depthTest: true, fog: true,
    extensions: { derivatives: true },                               // fwidth у конфетти в WebGL1
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
  curveHook(mat);

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = "fx:" + opts.name;
  mesh.frustumCulled = false;
  mesh.renderOrder = opts.renderOrder || 0;
  mesh.userData.noShadow = true;

  // «черновик» частицы: эмиттер заполняет поля и зовёт push() — без аллокаций
  const P = {
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0.3, birth: -1,
    drag: 0, grav: 0, rot: 0, spin: 0, s0: 0.2, s1: 0.4, stretch: 1, fadeIn: 0,
    r: 1, g: 1, b: 1, a: 1, type: 0, add: 0, flags: 0, seed: 0,
  };
  let w = 0, dMin = cap, dMax = -1, pushed = 0, lastEnd = 0;
  const st = { now: 0 };

  function push(){
    const i = w, o = i * STRIDE;
    w = (w + 1) % cap;
    buf[o] = P.x; buf[o + 1] = P.y; buf[o + 2] = P.z; buf[o + 3] = P.birth >= 0 ? P.birth : st.now;
    buf[o + 4] = P.vx; buf[o + 5] = P.vy; buf[o + 6] = P.vz; buf[o + 7] = P.life;
    buf[o + 8] = P.drag; buf[o + 9] = P.grav; buf[o + 10] = P.rot; buf[o + 11] = P.spin;
    buf[o + 12] = P.s0; buf[o + 13] = P.s1; buf[o + 14] = P.stretch; buf[o + 15] = P.fadeIn;
    buf[o + 16] = P.r; buf[o + 17] = P.g; buf[o + 18] = P.b; buf[o + 19] = P.a;
    buf[o + 20] = P.type; buf[o + 21] = P.add; buf[o + 22] = P.flags; buf[o + 23] = P.seed;
    const end = buf[o + 3] + P.life;
    if (end > lastEnd) lastEnd = end;
    if (i < dMin) dMin = i;
    if (i > dMax) dMax = i;
    pushed++;
  }
  // сброс черновика к нейтральным значениям (эмиттеры переопределяют нужное)
  function reset(){
    P.vx = P.vy = P.vz = 0; P.birth = -1; P.drag = 0; P.grav = 0; P.rot = 0; P.spin = 0;
    P.stretch = 1; P.fadeIn = 0; P.a = 1; P.add = 0; P.flags = 0; P.seed = 0;
    return P;
  }

  function setTime(now){ st.now = now; uniforms.uTime.value = now; }

  // один раз за кадр: залить изменённый кусок буфера
  function flush(){
    if (dMax < dMin) return;
    ib.clearUpdateRanges();
    ib.addUpdateRange(dMin * STRIDE, (dMax - dMin + 1) * STRIDE);
    ib.needsUpdate = true;
    dMin = cap; dMax = -1;
  }

  // «убить» всё: life = 0
  function clear(){
    for (let i = 0; i < cap; i++) buf[i * STRIDE + 7] = 0;
    dMin = 0; dMax = cap - 1; lastEnd = 0;
  }

  // сколько живых (для тестов/HUD отладки; проходит весь буфер — не звать каждый кадр)
  function live(){
    let n = 0;
    for (let i = 0; i < cap; i++){
      const o = i * STRIDE, t = st.now - buf[o + 3];
      if (t >= 0 && t < buf[o + 7]) n++;
    }
    return n;
  }

  // конец последней живой частицы — чтобы прятать меш, когда пул пуст (минус draw call)
  function update(){
    mesh.visible = st.now < lastEnd;
  }

  function dispose(){ geo.dispose(); mat.dispose(); }

  return { mesh, P, push, reset, flush, clear, live, setTime, update, dispose, uniforms, capacity: cap,
    get pushed(){ return pushed; } };
}
