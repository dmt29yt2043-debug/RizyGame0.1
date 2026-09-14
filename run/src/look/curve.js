// «Изогнутый мир» раннера: трасса впереди уходит вниз за горизонт и плавно покачивается вбок,
// а всё рядом с игроком (z > originZ - start) остаётся без изгиба.
//
// Как устроено (выбран ГЛОБАЛЬНЫЙ патч шейдерных чанков, а не onBeforeCompile на каждом материале):
//  • ShaderChunk.project_vertex / worldpos_vertex дописаны так, что вершина переводится в мир
//    (после instanceMatrix / batchingMatrix), сдвигается   x += bendX·d²,  y -= bendY·d²,
//    d = max(0, (originZ - worldZ) - start)   и уже потом умножается на viewMatrix.
//    Эти чанки включают ВСЕ встроенные материалы: Basic/Lambert/Phong/Standard/Physical/Toon/Matcap/Normal,
//    Points, LineBasic/Dashed, ShadowMaterial и — главное — внутренние MeshDepthMaterial/MeshDistanceMaterial
//    теневого прохода (они приватны в WebGLShadowMap, customDepthMaterial на каждый меш не нужен,
//    варианты с alphaTest/map тоже сгибаются). Тени, туман, освещение, GTAO-проход нормалей — всё совпадает.
//  • Sprite не использует project_vertex — патчим ShaderLib.sprite.vertexShader отдельно (гнём центр спрайта).
//  • Нормали поворачиваются по касательной изгиба (дальняя дорога темнеет «за перегибом»).
//  • Один общий uniform curveParams = { value: Float32Array(4) } добавлен в ShaderLib.*.uniforms.
//    UniformsUtils.clone копирует типизированный массив ПО ССЫЛКЕ, поэтому все программы видят один буфер.
//  • Изгиб включается только на время renderer.render(ctx.scene) (scene.onBeforeRender/onAfterRender),
//    чужие сцены (PMREM-окружение, превью) рисуются без изгиба.
//  • Материал можно исключить: material.defines.CURVE_OFF (patch делает это сам для userData.noCurve).
//  ВАЖНО: installCurve надо вызвать ДО первой компиляции шейдеров (ключ кэша программ не содержит исходник).
//
// Отсечение по фрустуму (правило):
//  • Mesh / Points / Line: объекту ставится «изгибо-знающая» boundingSphere — прокси с геттерами,
//    центр сдвинут на изгиб центра, радиус увеличен на разброс изгиба по сфере. Frustum.intersectsObject
//    читает object.boundingSphere, считается без аллокаций; raycast по-прежнему идёт по геометрии (без изгиба).
//  • InstancedMesh и Sprite: frustumCulled = false (у InstancedMesh своя пересчитываемая сфера на весь ряд,
//    у спрайта — фиксированная сфера в позиции). SkinnedMesh не трогаем (персонаж у игрока, изгиба нет).
//  • Длинные плоские куски трассы должны быть сегментированы по z (шаг ≤ ~2 м), иначе изгибаться нечему.

import * as THREE from "three";

const DEFAULTS = {
  bendY: 0.0025,      // провал горизонта, 1/м
  start: 6,           // метров без изгиба перед игроком
  originZ: 0,         // z игрока
  swayX: 0.0011,      // амплитуда бокового покачивания, 1/м
  swayPeriod: 20,     // сек на полный цикл «влево — прямо — вправо — прямо»
  swayEase: 1.2,      // скорость выхода/возврата покачивания при смене режима, 1/с
  scene: null,        // сцена, на которой изгиб активен (по умолчанию ctx.scene)
};

// общий буфер: [bendX, bendY, start, originZ] — именно его видят шейдеры
const GPU = new Float32Array(4);
const U_CURVE = { value: GPU };

const PARS = `
#ifndef CURVE_PARS
#define CURVE_PARS
#ifndef CURVE_OFF
#define CURVE_ON
uniform vec4 curveParams; // x: bendX, y: bendY, z: start, w: originZ
float curveDist( float wz ) { return max( 0.0, ( curveParams.w - wz ) - curveParams.z ); }
vec3 curveBend( vec3 w ) {
	float d = curveDist( w.z ); d *= d;
	return vec3( w.x + curveParams.x * d, w.y - curveParams.y * d, w.z );
}
// нормаль в мировых осях: J^-T от x += bx·d², y -= by·d²
vec3 curveNormal( vec3 n, float wz ) {
	float d2 = 2.0 * curveDist( wz );
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
function patchChunks(){
  if (chunksPatched || THREE.ShaderChunk.morphtarget_pars_vertex.includes("CURVE_PARS")) { chunksPatched = true; return; }
  const C = THREE.ShaderChunk;
  // объявления — в вершинный pars-чанк, который есть во всех встроенных вершинных шейдерах с project_vertex
  C.morphtarget_pars_vertex = PARS + C.morphtarget_pars_vertex;
  C.normal_pars_vertex = "#ifndef FLAT_SHADED\n#define CURVE_VNORMAL\n#endif\n" + C.normal_pars_vertex;
  C.project_vertex = PROJECT;
  // мировая позиция для теней-приёмников, envmap, transmission, MeshDistanceMaterial
  C.worldpos_vertex = C.worldpos_vertex.replace(/\n#endif\s*$/,
    "\n\t#ifdef CURVE_ON\n\t\tworldPosition.xyz = curveBend( worldPosition.xyz );\n\t#endif\n#endif");
  // куски для своих ShaderMaterial: #include <curve_pars_vertex>, vec3 w = curveBend( w );
  C.curve_pars_vertex = PARS;
  const sp = THREE.ShaderLib.sprite;
  sp.vertexShader = sp.vertexShader.replace("#include <common>", "#include <common>\n" + PARS).replace(SPRITE_FROM, SPRITE_TO);
  for (const id of LIB_IDS) if (THREE.ShaderLib[id]) THREE.ShaderLib[id].uniforms.curveParams = U_CURVE;
  chunksPatched = true;
}

// прокси для Frustum.intersectsObject: сфера геометрии, сдвинутая изгибом (локальные координаты объекта)
class CurveBounds {
  constructor(obj, P){ this.o = obj; this.P = P; this._c = new THREE.Vector3(); this._r = 0; }
  _calc(){
    const g = this.o.geometry;
    if (g.boundingSphere === null) g.computeBoundingSphere();
    const bs = g.boundingSphere, c = bs.center, e = this.o.matrixWorld.elements, P = this.P;
    this._c.copy(c); this._r = bs.radius;
    if (P[0] === 0 && P[1] === 0) return;
    const sx = e[0]*e[0]+e[1]*e[1]+e[2]*e[2], sy = e[4]*e[4]+e[5]*e[5]+e[6]*e[6], sz = e[8]*e[8]+e[9]*e[9]+e[10]*e[10];
    const sc = Math.sqrt(Math.max(sx, sy, sz)) || 1;
    const wz = e[2]*c.x + e[6]*c.y + e[10]*c.z + e[14], rw = bs.radius * sc;
    const dFar = P[3] - (wz - rw) - P[2];
    if (dFar <= 0) return;
    const dC = Math.max(0, P[3] - wz - P[2]), dNear = Math.max(0, P[3] - (wz + rw) - P[2]);
    const kk = Math.sqrt(P[0]*P[0] + P[1]*P[1]);
    // сдвиг центра (мир) → локально через обратную 3×3 (общий случай, неравномерный масштаб тоже)
    const ox = P[0]*dC*dC, oy = -P[1]*dC*dC;
    const a = e[0], b = e[4], cc = e[8], d = e[1], ee = e[5], f = e[9], gg = e[2], h = e[6], i = e[10];
    const A = ee*i - f*h, B = -(d*i - f*gg), Cc = d*h - ee*gg;
    const det = a*A + b*B + cc*Cc;
    if (Math.abs(det) > 1e-12){
      // inv = adj / det; нужен inv·(ox, oy, 0)
      const inv = 1/det;
      this._c.x += (A*ox + (cc*h - b*i)*oy) * inv;
      this._c.y += (B*ox + (a*i - cc*gg)*oy) * inv;
      this._c.z += (Cc*ox + (b*gg - a*h)*oy) * inv;
    }
    // разброс смещения по сфере: max(|off(dFar) - off(dC)|, |off(dC) - off(dNear)|)
    const spread = kk * Math.max(dFar*dFar - dC*dC, dC*dC - dNear*dNear);
    this._r = bs.radius + spread / sc;
  }
  get center(){ this._calc(); return this._c; }
  get radius(){ this._calc(); return this._r; }
}

export function installCurve(ctx, opts){
  const o = Object.assign({}, DEFAULTS, opts || {});
  const scene = o.scene || (ctx && ctx.scene);
  const renderer = ctx && ctx.renderer;
  if (renderer && renderer.info && renderer.info.programs && renderer.info.programs.length)
    console.warn("[curve] installCurve вызван после компиляции шейдеров — уже собранные программы не будут гнуться");
  patchChunks();

  // «живые» значения (CPU); в GPU-буфер копируются только на время рендера своей сцены
  const LIVE = new Float32Array([0, o.bendY, o.start, o.originZ]);
  const st = { k: 0, phase: 0, lastDist: null };
  const api = { enabled: true, opts: o };

  const field = i => ({ get value(){ return LIVE[i]; }, set value(v){ LIVE[i] = v; } });
  api.uniforms = { bendX: field(0), bendY: field(1), start: field(2), originZ: field(3), curveParams: U_CURVE };

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
  }

  const seenObj = new WeakSet(), seenMat = new WeakSet(), offDepth = new WeakMap();

  function patchMaterial(m, off){
    if (!m || seenMat.has(m)) return;
    seenMat.add(m);
    if (off){
      m.defines = Object.assign({}, m.defines, { CURVE_OFF: "" });
      m.needsUpdate = true;
    }
    // свои шейдеры: общий uniform, если его ещё нет (чанки подключаются через #include)
    if (m.isShaderMaterial && m.uniforms && !m.uniforms.curveParams) m.uniforms.curveParams = U_CURVE;
  }

  function patchObject(obj, off){
    if (obj.userData && obj.userData.noCurve) off = true;
    const mats = obj.material ? (Array.isArray(obj.material) ? obj.material : [obj.material]) : null;
    if (mats) for (let i = 0; i < mats.length; i++) patchMaterial(mats[i], off);
    if (obj.customDepthMaterial) patchMaterial(obj.customDepthMaterial, off);
    if (obj.customDistanceMaterial) patchMaterial(obj.customDistanceMaterial, off);
    if (!seenObj.has(obj)){
      seenObj.add(obj);
      if (off){
        // исключённый объект, отбрасывающий тень, — своя несогнутая depth-материалина
        if (obj.castShadow && obj.isMesh && !obj.customDepthMaterial){
          const src = mats && mats[0];
          let dm = src && offDepth.get(src);
          if (!dm){
            dm = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
            dm.defines = { CURVE_OFF: "" };
            if (src) offDepth.set(src, dm);
          }
          obj.customDepthMaterial = dm;
        }
      } else if (obj.isInstancedMesh || obj.isSprite){
        obj.frustumCulled = false;
      } else if ((obj.isMesh || obj.isPoints || obj.isLine) && !obj.isSkinnedMesh && obj.frustumCulled && obj.boundingSphere === undefined){
        obj.boundingSphere = new CurveBounds(obj, GPU);
      }
    }
    const ch = obj.children;
    for (let i = 0; i < ch.length; i++) patchObject(ch[i], off);
  }

  // patch(корень | материал | массив): идемпотентен, повторные вызовы только проверяют WeakSet
  api.patch = function(target){
    if (!target) return target;
    if (Array.isArray(target)){ for (const t of target) api.patch(t); return target; }
    if (target.isMaterial) patchMaterial(target, false);
    else if (target.isObject3D) patchObject(target, false);
    return target;
  };

  // CPU-копия изгиба (например, спроецировать всплывающие цифры HUD): мутирует и возвращает v
  api.bendPoint = function(v){
    const d = Math.max(0, (LIVE[3] - v.z) - LIVE[2]), d2 = d*d;
    if (api.enabled){ v.x += LIVE[0]*d2; v.y -= LIVE[1]*d2; }
    return v;
  };

  // покачивание вбок из пройденной дистанции: фаза копится по приросту G.dist,
  // длина цикла в метрах = скорость × swayPeriod, так что цикл ≈ swayPeriod секунд на любой скорости
  api.update = function(dt, G){
    const play = !!G && G.mode === "play";
    st.k += ((play ? 1 : 0) - st.k) * (1 - Math.exp(-(dt || 0) * o.swayEase));
    if (G && typeof G.dist === "number"){
      const dd = st.lastDist === null ? 0 : G.dist - st.lastDist;
      st.lastDist = G.dist;
      if (dd > 0 && dd < 50){
        const spd = Math.min(32, Math.max(8, G.speed || 13));
        st.phase += dd / (spd * o.swayPeriod);
      }
    }
    const p = st.phase * Math.PI * 2;
    const wave = 0.74 * Math.sin(p) + 0.26 * Math.sin(p * 2.37 + 1.9);
    LIVE[0] = o.swayX * wave * st.k;
    LIVE[1] = o.bendY; LIVE[2] = o.start; LIVE[3] = o.originZ;
  };

  // для тестов: принудительно задать фазу и вес покачивания
  api.setSway = function(phase, k){ st.phase = phase; st.k = k; api.update(0, null); };

  return api;
}
