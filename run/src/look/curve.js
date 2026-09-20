// «Изогнутый мир» раннера (LOOK-4): трасса впереди уходит вниз за горизонт и плавно покачивается вбок,
// а всё рядом с игроком (первые start метров перед originZ) остаётся без изгиба.
//   d = max(0, (originZ − wz) − start);   wy −= bendY·d²;   wx += swayX·sway·d²
// Числа библии: start 6 м, bendY 0.0007 (горизонт ≈ 68 м при камере 3.8 м), пик swayX ±0.0012 (±4.6 м на горизонте).
//
// Как устроено (ГЛОБАЛЬНЫЙ патч шейдерных чанков, а не onBeforeCompile на каждом материале):
//  • ShaderChunk.project_vertex / worldpos_vertex дописаны так, что вершина переводится в мир
//    (после instanceMatrix / batchingMatrix), сгибается и уже потом умножается на viewMatrix.
//    Эти чанки есть во ВСЕХ встроенных материалах: Basic/Lambert/Phong/Standard/Physical/Toon/Matcap/Normal,
//    Points, LineBasic/Dashed, ShadowMaterial и — главное — во внутренних MeshDepthMaterial/MeshDistanceMaterial
//    теневого прохода. Поэтому отдельный customDepthMaterial на каждый источник тени (как в библии) не нужен:
//    тени, туман, освещение, GTAO-нормали сгибаются одинаково «бесплатно», включая alphaTest/map-варианты.
//  • Sprite не использует project_vertex — патчим ShaderLib.sprite.vertexShader (гнём центр спрайта).
//  • Нормали поворачиваются по касательной изгиба (J^-T), освещение за перегибом честное.
//  • Один общий uniform curveParams = { value: Float32Array(4) } добавлен в ShaderLib.*.uniforms.
//    UniformsUtils.clone копирует типизированный массив ПО ССЫЛКЕ, поэтому все программы видят один буфер.
//  • Изгиб включается только на время renderer.render(ctx.scene) (scene.onBeforeRender/onAfterRender, в r160
//    это ДО карты теней), чужие сцены (PMREM-окружение, превью HUD) рисуются без изгиба.
//  • Чанки патчатся при ИМПОРТЕ модуля: импортируйте curve.js до создания первых материалов
//    (ключ кэша программ three не содержит исходник — собранная до патча программа гнуться не будет).
//  • Свои ShaderMaterial: #include <curve_pars_vertex>, затем #ifdef CURVE_ON w = curveBend(w); #endif,
//    uniform curveParams подставляет patch() (или берите THREE.ShaderLib.basic.uniforms.curveParams).
//
// Исключения (patch() читает userData объекта):
//  • userData.noCurve  → define CURVE_OFF (материал не гнётся; тень — своя несогнутая depth-материалина);
//  • userData.curveSoft → define CURVE_SOFT (изгиб ×0.1 — дальние горы и карточки, LOOK-4).
//  Материал с CURVE_OFF/CURVE_SOFT должен быть своим: define ставится на материал, а не на объект.
//
// Отсечение по фрустуму (правило «без попов»):
//  • Mesh / Points / Line: объекту ставится «изгибо-знающая» boundingSphere — прокси с геттерами,
//    центр сдвинут на изгиб центра, радиус увеличен на разброс изгиба по сфере. Frustum.intersectsObject
//    читает object.boundingSphere (и в основном, и в теневом проходе), без аллокаций; raycast идёт по геометрии.
//  • InstancedMesh и Sprite: frustumCulled = false (у InstancedMesh сфера на весь ряд, у спрайта — точка).
//    SkinnedMesh не трогаем (персонаж у игрока, изгиба нет).
//  • Длинные плоские куски трассы должны быть сегментированы по z (шаг ≤ 1 м), иначе изгибаться нечему.
//  • Объекты, добавленные позже, передавайте в patch() (идемпотентно); без patch они гнутся, но могут «попать».

import * as THREE from "three";

const DEFAULTS = {
  bendY: 0.0007,      // uKy: провал горизонта, 1/м (тестовый диапазон 0.0005–0.0012)
  start: 6,           // uFlat: метров без изгиба перед игроком
  originZ: 0,         // uPlayerZ: z игрока (мир едет на игрока, Ризи стоит в 0)
  swayX: 0.0012,      // пик uKx, 1/м
  // покачивание по ДИСТАНЦИИ: полуцикл = подъём + удержание + спад + прямо, затем зеркально.
  // Библия: «цикл на каждые 360 м: 90 / 60 / 90 / 30 м». Сумма 270 м — это полуцикл, а не весь цикл; чтобы
  // полный цикл остался 360 м (смена знака ≈ 6 с на скорости 30), доли 90:60:90:30 сжаты до 60:40:60:20.
  swayRamp: 60,
  swayHold: 40,
  swayStraight: 20,
  swayMinFlip: 6,     // сек: знак меняется не чаще (на бусте полуцикл «ждёт» на прямом участке)
  swayFade: 1.5,      // сек: гашение/возврат покачивания (мосты, тоннели, не-play)
  scene: null,        // сцена, на которой изгиб активен (по умолчанию ctx.scene)
};

// общий буфер: [bendX, bendY, start, originZ] — именно его видят шейдеры
const GPU = new Float32Array(4);
const U_CURVE = { value: GPU };
const SOFT_K = 0.1;

const PARS = `
#ifndef CURVE_PARS
#define CURVE_PARS
#ifndef CURVE_OFF
#define CURVE_ON
uniform vec4 curveParams; // x: bendX (с учётом sway), y: bendY, z: start, w: originZ
#ifdef CURVE_SOFT
const float curveK = ${SOFT_K.toFixed(2)};
#else
const float curveK = 1.0;
#endif
float curveDist( float wz ) { return max( 0.0, ( curveParams.w - wz ) - curveParams.z ); }
vec3 curveBend( vec3 w ) {
	float d = curveDist( w.z ); d *= d * curveK;
	return vec3( w.x + curveParams.x * d, w.y - curveParams.y * d, w.z );
}
// нормаль в мировых осях: J^-T от x += bx·d², y -= by·d²
vec3 curveNormal( vec3 n, float wz ) {
	float d2 = 2.0 * curveK * curveDist( wz );
	return normalize( vec3( n.x, n.y, n.z + d2 * ( curveParams.x * n.x - curveParams.y * n.y ) ) );
}
#endif
#endif
`;

const PROJECT = `vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
	mvPosition = batchingMatrix * mvPosition;
#endif
#ifdef USE_INSTANCING
	mvPosition = instanceMatrix * mvPosition;
#endif
#ifdef CURVE_ON
	vec4 curveW = modelMatrix * mvPosition;
	#ifdef CURVE_VNORMAL
		transformedNormal = transformDirection( curveNormal( inverseTransformDirection( transformedNormal, viewMatrix ), curveW.z ), viewMatrix );
		vNormal = transformedNormal;
	#endif
	curveW.xyz = curveBend( curveW.xyz );
	mvPosition = viewMatrix * curveW;
#else
	mvPosition = modelViewMatrix * mvPosition;
#endif
gl_Position = projectionMatrix * mvPosition;`;

const SPRITE_FROM = "vec4 mvPosition = modelViewMatrix * vec4( 0.0, 0.0, 0.0, 1.0 );";
const SPRITE_TO = `#ifdef CURVE_ON
	vec4 mvPosition = viewMatrix * vec4( curveBend( modelMatrix[ 3 ].xyz ), 1.0 );
#else
	vec4 mvPosition = modelViewMatrix * vec4( 0.0, 0.0, 0.0, 1.0 );
#endif`;

const LIB_IDS = ["basic", "lambert", "phong", "standard", "physical", "toon", "matcap", "points",
  "dashed", "depth", "distanceRGBA", "normal", "sprite", "shadow"];

let chunksPatched = false;
export function ensureCurveChunks(){
  if (chunksPatched) return true;
  const C = THREE.ShaderChunk;
  if (!C.morphtarget_pars_vertex.includes("CURVE_PARS")){
    if (!C.project_vertex.includes("mvPosition = modelViewMatrix * mvPosition;")){
      console.warn("[curve] project_vertex не узнан — другая версия three? изгиб выключен");
      return false;
    }
    // объявления — в вершинный pars-чанк, который есть во всех встроенных вершинных шейдерах с project_vertex
    C.morphtarget_pars_vertex = PARS + C.morphtarget_pars_vertex;
    C.normal_pars_vertex = "#ifndef FLAT_SHADED\n#define CURVE_VNORMAL\n#endif\n" + C.normal_pars_vertex;
    C.project_vertex = PROJECT;
    // мировая позиция для теней-приёмников, envmap, transmission, MeshDistanceMaterial
    C.worldpos_vertex = C.worldpos_vertex.replace(/\n#endif\s*$/,
      "\n\t#ifdef CURVE_ON\n\t\tworldPosition.xyz = curveBend( worldPosition.xyz );\n\t#endif\n#endif");
    // куски для своих ShaderMaterial
    C.curve_pars_vertex = PARS;
    const sp = THREE.ShaderLib.sprite;
    sp.vertexShader = sp.vertexShader.replace("#include <common>", "#include <common>\n" + PARS).replace(SPRITE_FROM, SPRITE_TO);
  }
  for (const id of LIB_IDS) if (THREE.ShaderLib[id]) THREE.ShaderLib[id].uniforms.curveParams = U_CURVE;
  chunksPatched = true;
  return true;
}
ensureCurveChunks();

// прокси для Frustum.intersectsObject: сфера геометрии, сдвинутая изгибом (локальные координаты объекта)
class CurveBounds {
  constructor(obj, k){ this.o = obj; this.k = k; this._c = new THREE.Vector3(); this._r = 0; }
  _calc(){
    const g = this.o.geometry;
    if (g.boundingSphere === null) g.computeBoundingSphere();
    const bs = g.boundingSphere, c = bs.center, e = this.o.matrixWorld.elements, P = GPU, K = this.k;
    this._c.copy(c); this._r = bs.radius;
    const bx = P[0] * K, by = P[1] * K;
    if (bx === 0 && by === 0) return;
    const sx = e[0]*e[0]+e[1]*e[1]+e[2]*e[2], sy = e[4]*e[4]+e[5]*e[5]+e[6]*e[6], sz = e[8]*e[8]+e[9]*e[9]+e[10]*e[10];
    const sc = Math.sqrt(Math.max(sx, sy, sz)) || 1;
    const wz = e[2]*c.x + e[6]*c.y + e[10]*c.z + e[14], rw = bs.radius * sc;
    const dFar = P[3] - (wz - rw) - P[2];
    if (dFar <= 0) return;
    const dC = Math.max(0, P[3] - wz - P[2]), dNear = Math.max(0, P[3] - (wz + rw) - P[2]);
    const kk = Math.sqrt(bx*bx + by*by);
    // сдвиг центра (мир) → локально через обратную 3×3 (общий случай, неравномерный масштаб тоже)
    const ox = bx*dC*dC, oy = -by*dC*dC;
    const a = e[0], b = e[4], cc = e[8], d = e[1], ee = e[5], f = e[9], gg = e[2], h = e[6], i = e[10];
    const A = ee*i - f*h, B = -(d*i - f*gg), Cc = d*h - ee*gg;
    const det = a*A + b*B + cc*Cc;
    if (Math.abs(det) > 1e-12){
      const inv = 1/det;   // inv = adj / det; нужен inv·(ox, oy, 0)
      this._c.x += (A*ox + (cc*h - b*i)*oy) * inv;
      this._c.y += (B*ox + (a*i - cc*gg)*oy) * inv;
      this._c.z += (Cc*ox + (b*gg - a*h)*oy) * inv;
    }
    // разброс смещения по сфере: max(|off(dFar) − off(dC)|, |off(dC) − off(dNear)|)
    const spread = kk * Math.max(dFar*dFar - dC*dC, dC*dC - dNear*dNear);
    this._r = bs.radius + spread / sc;
  }
  get center(){ this._calc(); return this._c; }
  get radius(){ this._calc(); return this._r; }
}

const smooth01 = t => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

export function installCurve(ctx, opts){
  const scene = (opts && opts.scene) || (ctx && ctx.scene);
  // повторная установка на ту же сцену возвращает тот же api (цепочка onBeforeRender не растёт)
  if (scene && scene.userData.__lookCurve){
    const ex = scene.userData.__lookCurve;
    if (opts) Object.assign(ex.opts, opts);
    ex.update(0, null);
    return ex;
  }
  const o = Object.assign({}, DEFAULTS, opts || {});
  const renderer = ctx && ctx.renderer;
  ensureCurveChunks();
  const progs = renderer && renderer.info && renderer.info.programs;
  if (progs && progs.some(p => p && p.name && !/ShaderMaterial$/.test(p.name)))
    console.warn("[curve] до installCurve уже собраны встроенные программы — если они собраны до импорта curve.js, они не гнутся");

  // «живые» значения (CPU); в GPU-буфер копируются только на время рендера своей сцены
  const LIVE = new Float32Array([0, o.bendY, o.start, o.originZ]);
  const st = { k: 0, m: 0, halfStart: 0, time: 0, lastDist: null, sway: 0, suppress: false };
  const api = { enabled: true, opts: o };

  const field = i => ({ get value(){ return LIVE[i]; }, set value(v){ LIVE[i] = v; } });
  api.uniforms = { bendX: field(0), bendY: field(1), start: field(2), originZ: field(3), curveParams: U_CURVE,
    sway: { get value(){ return st.sway; } } };
  Object.defineProperty(api, "sway", { get(){ return st.sway; } });   // uSway −1..1 (для крена камеры CAM-1)

  if (scene){
    const prevB = scene.onBeforeRender, prevA = scene.onAfterRender;
    scene.onBeforeRender = function(r, s, cam, rt){
      if (api.enabled) GPU.set(LIVE); else GPU.fill(0);
      prevB.call(this, r, s, cam, rt);
    };
    scene.onAfterRender = function(r, s, cam){
      prevA.call(this, r, s, cam);
      GPU.fill(0);
    };
    scene.userData.__lookCurve = api;
  }

  const seenObj = new WeakSet(), offDepth = new WeakMap(), softDepth = new WeakMap();
  const MODE_DEF = [null, "CURVE_SOFT", "CURVE_OFF"];

  // mode: 0 — обычный, 1 — мягкий (×0.1), 2 — без изгиба
  function patchMaterial(m, mode){
    if (!m) return;
    // свои шейдеры: общий uniform, если его ещё нет (чанки подключаются через #include)
    if (m.isShaderMaterial && m.uniforms && !m.uniforms.curveParams) m.uniforms.curveParams = U_CURVE;
    const key = MODE_DEF[mode];
    if (!key || (m.defines && m.defines[key] !== undefined)) return;
    m.defines = Object.assign({}, m.defines, { [key]: "" });
    m.needsUpdate = true;
  }

  function depthFor(src, mode){
    const map = mode === 2 ? offDepth : softDepth;
    let dm = src && map.get(src);
    if (!dm){
      dm = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
      dm.defines = { [MODE_DEF[mode]]: "" };
      if (src){
        dm.alphaTest = src.alphaTest || 0; dm.map = src.alphaTest ? src.map : null;
        map.set(src, dm);
      }
    }
    return dm;
  }

  function patchObject(obj, mode){
    const ud = obj.userData;
    if (ud && ud.noCurve) mode = 2;
    else if (ud && ud.curveSoft && mode < 1) mode = 1;
    const mats = obj.material ? (Array.isArray(obj.material) ? obj.material : [obj.material]) : null;
    if (mats) for (let i = 0; i < mats.length; i++) patchMaterial(mats[i], mode);
    if (obj.customDepthMaterial) patchMaterial(obj.customDepthMaterial, mode);
    if (obj.customDistanceMaterial) patchMaterial(obj.customDistanceMaterial, mode);
    if (!seenObj.has(obj)){
      seenObj.add(obj);
      if (mode > 0 && obj.castShadow && obj.isMesh && !obj.customDepthMaterial){
        // исключённый/мягкий объект, отбрасывающий тень, — своя depth-материалина с тем же режимом
        obj.customDepthMaterial = depthFor(mats && mats[0], mode);
      }
      if (mode === 2){ /* без изгиба — штатное отсечение */ }
      else if (obj.isInstancedMesh || obj.isSprite){
        obj.frustumCulled = false;
      } else if ((obj.isMesh || obj.isPoints || obj.isLine) && !obj.isSkinnedMesh && obj.frustumCulled && obj.boundingSphere === undefined){
        obj.boundingSphere = new CurveBounds(obj, mode === 1 ? SOFT_K : 1);
      }
    }
    const ch = obj.children;
    for (let i = 0; i < ch.length; i++) patchObject(ch[i], mode);
  }

  // patch(корень | материал | массив): идемпотентен; вернуть тот же target
  api.patch = function(target){
    if (!target) return target;
    if (Array.isArray(target)){ for (let i = 0; i < target.length; i++) api.patch(target[i]); return target; }
    if (target.isMaterial) patchMaterial(target, 0);
    else if (target.isObject3D) patchObject(target, 0);
    return target;
  };

  // CPU-копия изгиба (всплывающие цифры HUD, blob-тени без шейдера): мутирует и возвращает v
  api.bendPoint = function(v, soft){
    if (!api.enabled) return v;
    const d = Math.max(0, (LIVE[3] - v.z) - LIVE[2]), d2 = d * d * (soft ? SOFT_K : 1);
    v.x += LIVE[0] * d2; v.y -= LIVE[1] * d2;
    return v;
  };
  // провал по y на дистанции z (без аллокаций)
  api.dropAt = function(z){ const d = Math.max(0, (LIVE[3] - z) - LIVE[2]); return api.enabled ? LIVE[1] * d * d : 0; };

  const halfLen = () => 2 * o.swayRamp + o.swayHold + o.swayStraight;
  function shape(m){
    const H = halfLen(), n = Math.floor(m / H), t = m - n * H, sign = (n & 1) ? -1 : 1;
    const R = o.swayRamp, Hd = o.swayHold;
    let v;
    if (t < R) v = smooth01(t / R);
    else if (t < R + Hd) v = 1;
    else if (t < 2 * R + Hd) v = 1 - smooth01((t - R - Hd) / R);
    else v = 0;
    return sign * v;
  }
  function advance(dd){
    const H = halfLen(), n0 = Math.floor(st.m / H), m1 = st.m + dd;
    if (Math.floor(m1 / H) > n0){
      // новый полуцикл (смена знака): не раньше swayMinFlip секунд после начала предыдущего
      if (st.time - st.halfStart < o.swayMinFlip){ st.m = (n0 + 1) * H - 1e-3; return; }
      st.halfStart = st.time;
    }
    st.m = m1;
  }

  // вызывать каждый кадр: dt — реальное время (сек), G — состояние игры (читаются mode, dist)
  api.update = function(dt, G){
    dt = dt > 0 ? dt : 0;
    st.time += dt;
    const want = G && G.mode === "play" && !st.suppress ? 1 : 0;
    const step = dt / Math.max(0.01, o.swayFade);
    st.k = want > st.k ? Math.min(want, st.k + step) : Math.max(want, st.k - step);
    if (G && typeof G.dist === "number"){
      const dd = st.lastDist === null ? 0 : G.dist - st.lastDist;
      st.lastDist = G.dist;
      if (dd > 0 && dd < 50) advance(dd);
      else if (dd < -1){ st.m = 0; st.halfStart = st.time; }   // новый забег начинается с прямой
    }
    st.sway = shape(st.m) * smooth01(st.k);
    LIVE[0] = o.swayX * st.sway;
    LIVE[1] = o.bendY; LIVE[2] = o.start; LIVE[3] = o.originZ;
  };

  // мосты / тоннели: покачивание → 0 за swayFade секунд и обратно
  api.suppressSway = function(on){ st.suppress = !!on; };

  // для тестов и фоторежима: фаза в долях полного цикла (0.25 — пик «+», 0.75 — пик «−») и вес 0..1
  api.setSway = function(phase, k){
    st.m = ((phase % 1) + 1) % 1 * 2 * halfLen(); st.k = Math.max(0, Math.min(1, k));
    st.sway = shape(st.m) * st.k;
    LIVE[0] = o.swayX * st.sway; LIVE[1] = o.bendY; LIVE[2] = o.start; LIVE[3] = o.originZ;
  };

  // тоннели из шины (если есть); мосты — через suppressSway
  const unbind = [];
  if (ctx && ctx.bus && ctx.bus.on){
    const onIn = () => api.suppressSway(true), onOut = () => api.suppressSway(false);
    ctx.bus.on("tunnel:enter", onIn); ctx.bus.on("tunnel:exit", onOut);
    unbind.push(() => { if (ctx.bus.off){ ctx.bus.off("tunnel:enter", onIn); ctx.bus.off("tunnel:exit", onOut); } });
  }
  api.dispose = function(){ api.enabled = false; for (const f of unbind) f(); unbind.length = 0; };

  api.update(0, null);
  return api;
}
