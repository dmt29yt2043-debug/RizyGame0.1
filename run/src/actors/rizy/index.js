// Кит героини «Ризи» для Ризи RUN. Самодостаточный модуль: процедурная модель или GLB + общий контроллер анимации.
//
//   import { createRizy } from "../actors/rizy/index.js";
//   const rizy = await createRizy(ctx, { prefer: "auto" });   // "auto" | "glb" | "procedural"
//   scene.add(rizy.root);
//   каждый кадр:  rizy.setState({...}); rizy.update(realDt, simDt);
//   события:      rizy.trigger("hit" | "nearmiss" | "edgebump" | "milestone" | "record" | "lane" | "jump" | "land" | "dive" | "spin", payload)
//
// state (все поля необязательны, передаются каждый кадр):
//   mode       "title" | "countdown" | "play" | "over"
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
//       sunDir (Vector3 мира; иначе ищется DirectionalLight в ctx.scene), driveRoot (true), reducedMotion, noScarf
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

export async function createRizy(ctx, opts = {}){
  const prefer = opts.prefer || "auto";
  let rig = null, glbError = null;
  if (prefer !== "procedural"){
    try {
      const { loadGlbRig } = await import("./glb.js");
      rig = await loadGlbRig(ctx, opts);
    } catch (e){
      glbError = e;
      rig = null;
      if (prefer === "glb") console.warn("rizy: GLB недоступен, беру процедурную —", e && e.message);
    }
  }
  if (!rig) rig = buildProcedural(ctx, opts);

  const anim = createAnimator({ reducedMotion: opts.reducedMotion });
  const rimBody = rimUniforms(0xD6F1FF, 0.45, 3.0), rimHair = rimUniforms(0xEFFFC8, 0.40, 3.0);
  for (const m of rig.rimTargets.body) patchRim(m, rimBody, rig.sunU);
  for (const m of rig.rimTargets.hair) patchRim(m, rimHair, rig.sunU);
  if (rig.rimTargets.face) patchRim(rig.rimTargets.face, null, rig.sunU, FACE_SHINE);

  // шарф: лента (процедурная / GLB без костей шарфа) или только симуляция для костей GLB
  let scarf = null, scarfMat = null;
  if (!opts.noScarf && rig.anchors){
    const LOW = ctx.quality === "low";
    if (!rig.scarfBones){
      scarfMat = LOW ? new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.85 })
                     : new THREE.MeshPhysicalMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.82, sheen: 1, sheenRoughness: 0.6,
                         sheenColor: new THREE.Color(0.28, 0.32, 0.22) });
      scarfMat.name = "rizy:scarf";
      patchRim(scarfMat, rimHair, rig.sunU);
    }
    scarf = createScarf({
      anchors: rig.anchors, colliders: rig.colliders, root: rig.root, material: scarfMat,
      nodes: rig.scarfNodes || 8, seg: rig.scarfSeg || 0.074 * (rig.baseScale || 1),
      width: 0.13 * (rig.baseScale || 1), thick: 0.03 * (rig.baseScale || 1),
      rings: LOW ? 12 : 15, sides: LOW ? 8 : 10, castShadow: true,
    });
    if (scarf.mesh) rig.root.add(scarf.mesh);
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
    if (driveRoot){ R.position.x = S.laneX; R.position.y = S.py + o.hopY; }
    rig.yawG.rotation.set(0, o.yaw, o.roll);
    const bs = rig.baseScale;
    rig.squashG.scale.set(bs * o.sx, bs * o.sy, bs * o.sz);
    rig.applyPose(o.base, o.add, o, simDt, anim);
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
      w.x = o.windX; w.y = o.windY; w.z = o.windZ; w.flutter = o.flutter; w.lift = o.lift;
      R.updateMatrixWorld(true);
      scarf.update(realDt);
      if (rig.driveScarf) rig.driveScarf(scarf);
    }
  }

  function dispose(){
    if (scarf) scarf.dispose();
    if (scarfMat) scarfMat.dispose();
    rig.dispose();
    if (rig.root.parent) rig.root.parent.remove(rig.root);
  }

  return {
    root: rig.root,
    kind: rig.kind,
    rig, anim, scarf,
    glbError: glbError ? String(glbError.message || glbError) : null,
    rim: { body: rimBody, hair: rimHair },
    setState: anim.setState,
    trigger: anim.trigger,
    update,
    setReducedMotion(b){ anim.setReducedMotion(b); },
    get state(){ return anim.out.state; },
    dispose,
  };
}
