// Кит героини «Ризи» для Ризи RUN. Самодостаточный модуль: процедурная модель или GLB + общий контроллер анимации.
//
//   import { createRizy } from "../actors/rizy/index.js";
//   const rizy = await createRizy(ctx, { prefer: "auto" });   // "auto" | "glb" | "procedural"
//   scene.add(rizy.root);
//   каждый кадр:  rizy.setState({...}); rizy.update(realDt, simDt);
//   события:      rizy.trigger("hit" | "nearmiss" | "edgebump" | "milestone" | "record" | "lane" | "jump" | "land" | "dive" | "spin", payload)
//
//   сервис:       rizy.reset() (новый забег), rizy.stats() → { kind, tris, calls, callsWithShadows }, rizy.setReducedMotion(b)
//
// state (все поля необязательны, передаются каждый кадр):
//   mode       "title" | "countdown" | "play" | "catch" | "over"  (catch показывается как over)
//   blinkOn    G.blinkOn — видимость при мигании неуязвимости ведёт main (иначе кит мигает сам по grace)
//   runPhase   G.runPhase (рад, цикл шага 2π)          speedI  0..1 (нормированная скорость, bible 2.0)
//   laneX      G.x (кит сам ставит root.position.x)      laneVel u/s (если нет — производная laneX по simDt)
//   py, vy     высота и вертикальная скорость (root.position.y = py); взлёт/приземление кит ловит сам
//   sliding    G.sliding (сек, > 0 — подкат)             grace   сек неуязвимости (> 0 — мигание)
//   landT      сек после приземления (необязательно; уменьшение = новое приземление)
//   hitT       сек после удара (необязательно; уменьшение = новый удар, эквивалент trigger("hit"))
//   laneDir, laneT  направление и сек с начала смены полосы (необязательно; иначе детект по laneVel)
//   dive       нырок в воздухе                           celebrate  прыжки с руками вверх на экране рекорда
//   danger     0..1, > 0 — оглядки на рой
//
// opts: prefer, url (GLB, по умолчанию run/assets/rizy.glb), scale (0.93), height (GLB, 2.08 м),
//       sunDir (Vector3 мира; иначе ищется DirectionalLight в ctx.scene), driveRoot (true), reducedMotion,
//       scarf (false: на мастер-листе шарфа нет; true — verlet-лента, +1 draw call), backpack (false, процедурная),
//       blobShadow (по умолчанию true на low, где карт теней нет: мягкое пятно под ногами, +1 draw call)
//
// prefer:"auto" (по умолчанию) — процедурная модель. GLB берётся, только если рядом лежит манифест
// rizy.glb.json с { "autoPrefer": true } или { "review": { "likeness": ≥ 8 } }: сравнение кадров
// (игровая камера и крупный план титула) показало, что текущий Blender-GLB rev8 уступает процедурной
// (шлем-волосы, слабый принт, нет моргания) — см. отчёт кита. Так новая поставка включается без правки кода.
import * as THREE from "three";
import { createAnimator } from "./anim.js";
import { buildProcedural } from "./procedural.js";
import { createScarf } from "./scarf.js";
import { rimUniforms, patchRim } from "./rim.js";

const LIME = new THREE.Color(0xC0FF3F);
// блики глаз (чисто белые вершины) слегка светятся — «живой» взгляд на титуле даже в тени
const FACE_SHINE = `
#ifdef USE_COLOR
  totalEmissiveRadiance += vColor.rgb * step(0.999, min(vColor.r, min(vColor.g, vColor.b))) * 0.9;
#endif
`;

export const DEFAULT_GLB_URL = new URL("../../../assets/rizy.glb", import.meta.url).href;
// Выбор режима auto по итогам сравнения кадров (крупный план титула и игровая камера, 2026-09-14):
// процедурная выигрывает у Blender rev8 по лицу, принту свитера и форме волос. Смена на "glb" — одна строка.
export const AUTO_CHOICE = "procedural";

// манифест GLB (rizy.glb.json): решает, брать ли GLB в режиме auto; также может нести таблицу клипов
async function readManifest(url){
  try {
    const r = await fetch(url + ".json", { cache: "no-store" });
    if (!r.ok) return null;
    return await r.json();
  } catch (e){ return null; }
}

export async function createRizy(ctx, opts = {}){
  const prefer = opts.prefer || "auto";
  const url = opts.url || DEFAULT_GLB_URL;
  let rig = null, glbError = null, manifest = null;
  let wantGlb = prefer === "glb";
  if (prefer === "auto"){
    // без сетевых проб по умолчанию (404 на манифест засоряет консоль и tools/console.sh);
    // адаптер может передать opts.manifest (объект) или opts.probeManifest:true
    manifest = opts.manifest || (opts.probeManifest ? await readManifest(url) : null);
    wantGlb = AUTO_CHOICE === "glb" || !!(manifest && (manifest.autoPrefer === true || (manifest.review && manifest.review.likeness >= 8)));
  }
  if (wantGlb){
    try {
      const { loadGlbRig } = await import("./glb.js");
      // таблица клипов обычно в extras самого GLB; манифест читаем только по явной просьбе (без 404 в консоли)
      if (!manifest && opts.probeManifest) manifest = await readManifest(url);
      rig = await loadGlbRig(ctx, Object.assign({}, opts, { url, manifest }));
    } catch (e){
      glbError = e;
      rig = null;
      console.warn("rizy: GLB недоступен, беру процедурную —", e && e.message);
    }
  }
  if (!rig) rig = buildProcedural(ctx, opts);

  const anim = createAnimator({ reducedMotion: opts.reducedMotion });
  const rimBody = rimUniforms(0xD6F1FF, 0.45, 3.0), rimHair = rimUniforms(0xEFFFC8, 0.40, 3.0);
  for (const m of rig.rimTargets.body) patchRim(m, rimBody, rig.sunU);
  for (const m of rig.rimTargets.hair) patchRim(m, rimHair, rig.sunU);
  if (rig.rimTargets.face) patchRim(rig.rimTargets.face, null, rig.sunU, FACE_SHINE);

  // шарф: только по opts.scarf (у GLB с костями шарфа — всегда, иначе кости повиснут). Лента (процедурная /
  // GLB без костей шарфа) или только симуляция для костей GLB
  let scarf = null, scarfMat = null;
  const LOW = ctx.quality === "low", HIGH = ctx.quality === "high";
  const wantScarf = !opts.noScarf && (opts.scarf === true || !!rig.scarfBones);
  if (wantScarf && rig.anchors){
    if (!rig.scarfBones){
      scarfMat = LOW ? new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.85, side: THREE.DoubleSide })
                     : new THREE.MeshPhysicalMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.82, sheen: 1, sheenRoughness: 0.6,
                         sheenColor: new THREE.Color(0.28, 0.32, 0.22) });
      scarfMat.name = "rizy:scarf";
      patchRim(scarfMat, rimHair, rig.sunU);
    }
    const bs = rig.baseScale || 1;
    scarf = createScarf({
      anchors: rig.anchors, colliders: rig.colliders, root: rig.root, material: scarfMat,
      nodes: rig.scarfNodes || 10, seg: rig.scarfSeg || 0.082 * bs,
      width: 0.165 * bs, thick: 0.032 * bs,
      rings: LOW ? 10 : HIGH ? 16 : 13, sides: LOW ? 6 : HIGH ? 10 : 8, castShadow: !LOW,
    });
    if (scarf.mesh) rig.root.add(scarf.mesh);
  }

  // blob-тень (low): радиальный градиент на плоскости, сжимается и бледнеет с высотой прыжка
  let blob = null;
  if (opts.blobShadow !== undefined ? opts.blobShadow : LOW){
    const c = document.createElement("canvas"); c.width = c.height = 64;
    const g = c.getContext("2d"), gr = g.createRadialGradient(32, 32, 2, 32, 32, 31);
    gr.addColorStop(0, "rgba(20,30,90,0.55)"); gr.addColorStop(0.55, "rgba(20,30,90,0.28)"); gr.addColorStop(1, "rgba(20,30,90,0)");
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    blob = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.3), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: true }));
    blob.name = "rizy:blob"; blob.rotation.x = -Math.PI / 2; blob.renderOrder = 1; blob.frustumCulled = false;
    rig.root.add(blob);
  }

  // солнце для rim: opts.sunDir или первый DirectionalLight сцены
  const sunWorld = new THREE.Vector3(11, 17, 7).normalize(), tmpV = new THREE.Vector3();
  let sunLight = null, sunSearched = false;
  if (opts.sunDir) sunWorld.copy(opts.sunDir).normalize();
  const driveRoot = opts.driveRoot !== false;
  let rimWasFlash = false;

  function update(realDt, simDt){
    if (simDt === undefined) simDt = realDt;
    const o = anim.update(realDt, simDt), S = anim.S;
    const R = rig.root;
    rig.yawG.rotation.set(0, o.yaw, o.roll);
    const bs = rig.baseScale;
    rig.squashG.scale.set(bs * o.sx, bs * o.sy, bs * o.sz);
    // applyPose может обнулить o.hopY (GLB-клип праздника уже поднимает таз сам)
    rig.applyPose(o.base, o.add, o, simDt, anim);
    if (driveRoot){ R.position.x = S.laneX; R.position.y = S.py + o.hopY; }
    if (blob){
      // пятно остаётся на земле (y = 0.012 в мире), при прыжке сжимается и бледнеет
      const hgt = Math.max(0, R.position.y), k = 1 / (1 + hgt * 0.45);
      blob.position.y = 0.012 - hgt; blob.scale.set(k * (1 + 0.25 * Math.max(0, o.wSlide)), k * (1 + 0.5 * Math.max(0, o.wSlide)), 1);
      blob.material.opacity = k;
    }
    R.visible = o.visible;

    // вспышка rim на near-miss: #C0FF3F, сила 0.9
    if (o.rimFlash > 0){
      rimBody.uRimColor.value.copy(rimBody.base.color).lerp(LIME, o.rimFlash);
      rimBody.uRimStr.value = rimBody.base.strength + (0.9 - rimBody.base.strength) * o.rimFlash;
      rimHair.uRimColor.value.copy(rimHair.base.color).lerp(LIME, o.rimFlash);
      rimHair.uRimStr.value = rimHair.base.strength + (0.9 - rimHair.base.strength) * o.rimFlash;
      rimWasFlash = true;
    } else if (rimWasFlash){
      rimBody.uRimColor.value.copy(rimBody.base.color); rimBody.uRimStr.value = rimBody.base.strength;
      rimHair.uRimColor.value.copy(rimHair.base.color); rimHair.uRimStr.value = rimHair.base.strength;
      rimWasFlash = false;
    }

    // направление солнца в осях камеры (раз в кадр)
    if (!opts.sunDir){
      if (!sunSearched && ctx.scene){
        sunSearched = true;
        ctx.scene.traverse(x => { if (x.isDirectionalLight && (!sunLight || (x.castShadow && !sunLight.castShadow))) sunLight = x; });
      }
      if (sunLight){ sunLight.getWorldPosition(sunWorld); sunLight.target.getWorldPosition(tmpV); sunWorld.sub(tmpV).normalize(); }
    }
    if (ctx.camera) rig.sunU.value.copy(sunWorld).transformDirection(ctx.camera.matrixWorldInverse);

    if (scarf){
      const w = scarf.wind;
      w.x = o.windX; w.y = o.windY; w.z = o.windZ; w.flutter = o.flutter; w.lift = o.lift; w.splay = o.splay;
      R.updateMatrixWorld(true);
      scarf.update(realDt);
      if (rig.driveScarf) rig.driveScarf(scarf);
    }
  }

  // мгновенный сброс (новый забег / телепорт): шарф и пружины без «хлыста» из прошлой позиции
  function reset(){ if (scarf) scarf.reset(); anim.resetSprings(); }

  function dispose(){
    if (scarf) scarf.dispose();
    if (scarfMat) scarfMat.dispose();
    if (blob){ blob.geometry.dispose(); blob.material.map.dispose(); blob.material.dispose(); }
    rig.dispose();
    if (rig.root.parent) rig.root.parent.remove(rig.root);
  }

  // треугольники персонажа (без теневого прохода) и draw calls: основной проход / с тенями
  function stats(){
    let tris = 0, calls = 0, shadowCalls = 0;
    rig.root.traverse(m => {
      if (!m.isMesh) return;
      const g = m.geometry;
      tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
      calls++; if (m.castShadow) shadowCalls++;
    });
    return { kind: rig.kind, tris: Math.round(tris), calls, callsWithShadows: calls + shadowCalls };
  }

  return {
    root: rig.root,
    kind: rig.kind,
    rig, anim, scarf,
    glbError: glbError ? String(glbError.message || glbError) : null,
    rim: { body: rimBody, hair: rimHair },
    setState: anim.setState,
    trigger: anim.trigger,
    update, reset, stats,
    setReducedMotion(b){ anim.setReducedMotion(b); },
    get state(){ return anim.out.state; },
    dispose,
  };
}
