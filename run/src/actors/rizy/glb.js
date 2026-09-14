// GLB-адаптер Ризи: GLTFLoader + AnimationMixer, тот же контроллер (anim.js), что у процедурной модели.
// • Кости ищутся по именам (Blender «thigh.L», Mixamo «LeftUpLeg» и т.п.), нет обязательных — ошибка → процедурная.
// • Модель нормируется: рост opts.height (2.08 м), ноги на y = 0, лицо в −Z (glTF смотрит в +Z).
// • Клипы Idle/Run/Jump/Slide/Stumble/Celebrate с кроссфейдом; для состояния без клипа кости крутит
//   процедурная поза (дельта в осях персонажа: L' = L0 · C⁻¹ · D · C). Аддитивные слои — поверх клипов.
// • Кости шарфа (scarf.L.1…, scarf.R.1…) ведёт verlet-цепочка; если их нет — лента крепится к груди.
// • Материалы: Standard → Physical c sheen (войлок), rim на кожу/свитер/волосы/шарф.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { BONES, NB } from "./anim.js";

const norm = s => s.toLowerCase().replace(/^mixamorig\d*[:_]?/, "").replace(/[^a-z0-9]/g, "");
const ALIAS = {
  hips: ["hips", "pelvis", "hip"], spine: ["spine", "spine1", "spine01"], chest: ["chest", "spine2", "upperchest", "spine02", "spine3"],
  neck: ["neck", "neck1"], head: ["head"],
  thighL: ["thighl", "upperlegl", "leftupleg", "lthigh", "thighleft"], shinL: ["shinl", "calfl", "leftleg", "lowerlegl", "lshin", "shinleft"],
  footL: ["footl", "leftfoot", "lfoot", "footleft"],
  thighR: ["thighr", "upperlegr", "rightupleg", "rthigh", "thighright"], shinR: ["shinr", "calfr", "rightleg", "lowerlegr", "rshin", "shinright"],
  footR: ["footr", "rightfoot", "rfoot", "footright"],
  armL: ["upperarml", "leftarm", "arml", "larm", "upperarmleft"], foreL: ["forearml", "leftforearm", "lowerarml", "lforearm", "forearmleft"],
  armR: ["upperarmr", "rightarm", "armr", "rarm", "upperarmright"], foreR: ["forearmr", "rightforearm", "lowerarmr", "rforearm", "forearmright"],
  pack: ["pack", "backpack", "bag"], bunL: ["bunl", "hairbunl"], bunR: ["bunr", "hairbunr"], eyeL: ["eyel", "lefteye"], eyeR: ["eyer", "righteye"],
};
const NEED = ["hips", "head", "thighL", "thighR", "shinL", "shinR", "armL", "armR", "foreL", "foreR"];
const CLIPS = {
  idle: /idle|stand|breath/i, run: /run|sprint|jog/i, air: /jump|air|fall/i, slide: /slide|roll|duck/i,
  stumble: /stumble|hit|trip|hurt/i, celebrate: /celebr|cheer|victory|win|dance/i,
};

export async function loadGlbRig(ctx, opts = {}){
  const url = opts.url || new URL("../../../assets/rizy.glb", import.meta.url).href;
  const head = await fetch(url, { method: "HEAD", cache: "no-store" }).catch(() => null);
  if (!head || !head.ok) throw new Error("нет файла " + url);
  const gltf = await new GLTFLoader().loadAsync(url);
  const model = gltf.scene;
  const q = ctx.quality === "low" ? "low" : ctx.quality === "high" ? "high" : "med";

  const skinned = [];
  model.traverse(o => { if (o.isSkinnedMesh) skinned.push(o); });
  if (!skinned.length) throw new Error("GLB без SkinnedMesh");

  // ---------- кости ----------
  const bm = new Array(BONES.length).fill(null);
  const chains = { l: [], r: [] };
  model.traverse(o => {
    if (!o.isBone) return;
    const n = norm(o.name);
    const sc = n.match(/^scarf(l|r)(\d+)$/);
    if (sc){ chains[sc[1]][+sc[2]] = o; return; }
    for (let i = 0; i < BONES.length; i++) if (!bm[i] && ALIAS[BONES[i]].includes(n)) bm[i] = o;
  });
  const idx = n => BONES.indexOf(n);
  if (!bm[idx("chest")]) bm[idx("chest")] = bm[idx("spine")];
  const miss = NEED.filter(n => !bm[idx(n)]);
  if (miss.length) throw new Error("в GLB нет костей: " + miss.join(", "));

  // ---------- иерархия и нормировка ----------
  const root = new THREE.Group(); root.name = "rizy";
  const yawG = new THREE.Group(); yawG.name = "rizy:lean"; root.add(yawG);
  const squashG = new THREE.Group(); squashG.name = "rizy:squash"; yawG.add(squashG);
  const fitG = new THREE.Group(); fitG.name = "rizy:fit"; squashG.add(fitG);
  fitG.rotation.y = opts.glbFacing === "-z" ? 0 : Math.PI;
  fitG.add(model);
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const h = box.max.y - box.min.y;
  if (!(h > 1e-4 && h < 1e4)) throw new Error("GLB: странный размер " + h);
  const baseScale = (opts.height || 2.08) / h;
  fitG.position.y = -box.min.y;
  squashG.scale.setScalar(baseScale);
  root.updateMatrixWorld(true);

  // здравый смысл: голова выше таза, таз выше стоп
  const wy = o => o.getWorldPosition(new THREE.Vector3()).y;
  const footY = bm[idx("footL")] ? wy(bm[idx("footL")]) : wy(bm[idx("shinL")]);
  if (!(wy(bm[idx("head")]) > wy(bm[idx("hips")]) && wy(bm[idx("hips")]) > footY)) throw new Error("GLB: кости вверх ногами / ось не Y");

  // ---------- покой: L0, C (мировая ориентация в осях персонажа), родители для смещений ----------
  const L0 = [], C = [], Ci = [], P0 = [], PQi = [], PK = [];
  for (let i = 0; i < BONES.length; i++){
    const b = bm[i];
    if (!b){ L0.push(null); C.push(null); Ci.push(null); P0.push(null); PQi.push(null); PK.push(0); continue; }
    const wq = b.getWorldQuaternion(new THREE.Quaternion());
    L0.push(b.quaternion.clone()); C.push(wq.clone()); Ci.push(wq.clone().invert());
    P0.push(b.position.clone());
    const pq = b.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
    const ps = b.parent.getWorldScale(new THREE.Vector3()).x;
    PQi.push(pq); PK.push(1 / (ps || 1));
  }
  const S0 = bm.map(b => (b ? b.scale.clone() : null));

  // ---------- материалы: войлок + rim ----------
  const body = [], hair = [], owned = [];
  const felt = /skin|sweater|jean|cuff|pack|flap|shoe|sock|pocket|body|cloth/i, hairRx = /hair|scarf|tie|bun/i;
  const upgrade = m => {
    if (!m || !m.isMeshStandardMaterial) return m;
    let n = m;
    const nm = m.name || "";
    if (!m.isMeshPhysicalMaterial && q !== "low" && (felt.test(nm) || hairRx.test(nm))){
      n = new THREE.MeshPhysicalMaterial();
      THREE.MeshStandardMaterial.prototype.copy.call(n, m);
      n.sheen = 1; n.sheenRoughness = 0.55; n.sheenColor = m.color.clone().lerp(new THREE.Color(1, 1, 1), 0.3);
      n.name = nm; owned.push(n);
    }
    if (felt.test(nm) && !body.includes(n)) body.push(n);
    else if (hairRx.test(nm) && !hair.includes(n)) hair.push(n);
    return n;
  };
  model.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
    o.material = Array.isArray(o.material) ? o.material.map(upgrade) : upgrade(o.material);
  });

  // ---------- клипы ----------
  let mixer = null;
  const actions = {};
  if (gltf.animations && gltf.animations.length){
    mixer = new THREE.AnimationMixer(model);
    for (const k in CLIPS){
      const clip = gltf.animations.find(c => CLIPS[k].test(c.name));
      if (clip){ const a = mixer.clipAction(clip); a.enabled = true; a.setEffectiveWeight(0); a.play(); actions[k] = a; }
    }
    if (!Object.keys(actions).length){ mixer.stopAllAction(); mixer = null; }
  }
  let curAct = null, wClip = 0, lastHit = 99;

  // ---------- шарф ----------
  const sunU = { value: new THREE.Vector3(11, 17, 7).normalize() };
  const chest = bm[idx("chest")], headB = bm[idx("head")], packB = bm[idx("pack")], neck = bm[idx("neck")] || headB;
  const colliders = [
    { obj: headB, up: 0.22, back: 0.02, r: 0.3 },
    { obj: chest, up: 0.0, back: 0.0, r: 0.19 },
  ];
  if (packB) colliders.push({ obj: packB, up: 0.0, back: 0.08, r: 0.18 });
  let anchors = null, scarfBones = null, scarfNodes = 8, scarfSeg = 0.074, axis = null, restL = null;
  const lc = chains.l.filter(Boolean), rc = chains.r.filter(Boolean);
  if (lc.length >= 2 && rc.length >= 2){
    scarfBones = [lc, rc];
    anchors = []; axis = []; restL = [];
    let len = 0, cnt = 0;
    for (const ch of scarfBones){
      const ax = [], rl = [];
      for (let j = 0; j < ch.length; j++){
        const nx = ch[j + 1];
        const a = nx ? nx.position.clone().normalize() : (ax[j - 1] ? ax[j - 1].clone() : new THREE.Vector3(0, 1, 0));
        ax.push(a); rl.push(ch[j].quaternion.clone());
        if (nx){ len += ch[j].getWorldPosition(new THREE.Vector3()).distanceTo(nx.getWorldPosition(new THREE.Vector3())); cnt++; }
      }
      axis.push(ax); restL.push(rl);
      // направление цепочки в осях родителя первой кости
      const d = ax[0].clone().applyQuaternion(ch[0].quaternion);
      anchors.push({ obj: ch[0], dirObj: ch[0].parent, dir: [d.x, d.y, d.z] });
    }
    scarfSeg = len / Math.max(1, cnt);
    scarfNodes = Math.min(lc.length, rc.length) + 1;
  } else {
    anchors = [];
    const inv = new THREE.Matrix4().copy(chest.matrixWorld).invert();
    const np = neck.getWorldPosition(new THREE.Vector3());
    for (const s of [-1, 1]){
      const o = new THREE.Object3D(); o.name = "rizy:scarfAnchor";
      o.position.copy(new THREE.Vector3(s * 0.04, np.y - 0.05, np.z + 0.17).applyMatrix4(inv));
      chest.add(o);
      const d = new THREE.Vector3(s * 0.22, -0.55, 0.8).transformDirection(inv);
      anchors.push({ obj: o, dirObj: chest, dir: [d.x, d.y, d.z] });
    }
  }

  // ---------- кадр ----------
  const E = new THREE.Euler(), D = new THREE.Quaternion(), T = new THREE.Quaternion(), Tq = new THREE.Quaternion();
  const procQ = []; for (let i = 0; i < NB; i++) procQ.push(new THREE.Quaternion());
  const tv = new THREE.Vector3(), tv2 = new THREE.Vector3(), pw = new THREE.Quaternion(), pwi = new THREE.Quaternion();
  const hipsI = idx("hips"), packI = idx("pack"), bunLI = idx("bunL"), bunRI = idx("bunR");

  function offsetBone(i, x, y, z){
    const b = bm[i]; if (!b) return;
    tv.set(x, y, z).divideScalar(baseScale).applyQuaternion(PQi[i]).multiplyScalar(PK[i] * baseScale);
    b.position.copy(P0[i]).add(tv);
  }

  function applyPose(base, add, out, simDt, an){
    const state = out.state;
    const want = state === "air" ? "air" : state === "over" ? "idle" : state;
    const act = mixer ? actions[want] : null;
    // процедурная поза для всех костей
    for (let i = 0; i < NB; i++){
      const b = bm[i]; if (!b) continue;
      const o = i * 3;
      E.set(base[o] + add[o], base[o + 1] + add[o + 1], base[o + 2] + add[o + 2]);
      D.setFromEuler(E);
      T.copy(Ci[i]).multiply(D).multiply(C[i]);
      procQ[i].copy(L0[i]).multiply(T);
    }
    if (mixer){
      wClip += ((act ? 1 : 0) - wClip) * (1 - Math.exp(-12 * simDt));
      if (act && act !== curAct){
        if (curAct) curAct.crossFadeTo(act.reset().setEffectiveWeight(1), 0.15, false);
        else act.reset().setEffectiveWeight(1).fadeIn(0.15);
        curAct = act;
      }
      if (actions.run) actions.run.timeScale = 0.9 + 0.5 * an.S.speedI;
      if (actions.air && state === "air"){ const a = actions.air; a.timeScale = 0; a.time = Math.min(1, an.jumpT / 0.63) * a.getClip().duration; }
      if (actions.stumble && an.hitT < lastHit){
        actions.stumble.reset().setLoop(THREE.LoopOnce, 1).setEffectiveWeight(1).fadeIn(0.06).play();
        actions.stumble.fadeOut(Math.max(0.1, actions.stumble.getClip().duration - 0.15));
      }
      lastHit = an.hitT;
      for (let i = 0; i < NB; i++) if (bm[i]) bm[i].quaternion.copy(L0[i]);
      mixer.update(simDt);
      for (let i = 0; i < NB; i++){
        const b = bm[i]; if (!b) continue;
        const o = i * 3;
        E.set(add[o], add[o + 1], add[o + 2]); D.setFromEuler(E);
        T.copy(Ci[i]).multiply(D).multiply(C[i]);
        Tq.copy(b.quaternion).multiply(T);
        b.quaternion.copy(procQ[i]).slerp(Tq, wClip);
      }
    } else {
      for (let i = 0; i < NB; i++) if (bm[i]) bm[i].quaternion.copy(procQ[i]);
    }
    if (!mixer || wClip < 0.5) offsetBone(hipsI, base[54] + add[54], base[55] + add[55], base[56] + add[56]);
    offsetBone(bunLI, -out.bunX, -out.bunY * 0.85, 0);
    offsetBone(bunRI, -out.bunX * 0.8, -out.bunY, 0);
    if (bm[packI]){
      offsetBone(packI, -out.packX, -out.packY, 0);
      E.set(out.packRx, 0, out.packRz); D.setFromEuler(E);
      T.copy(Ci[packI]).multiply(D).multiply(C[packI]);
      bm[packI].quaternion.multiply(T);
    }
    for (const [n, v] of [["eyeL", out.eyeL], ["eyeR", out.eyeR]]){
      const i = idx(n); if (bm[i]) bm[i].scale.set(S0[i].x, S0[i].y * v, S0[i].z);
    }
  }

  // кости шарфа смотрят вдоль verlet-цепочки (с сохранением «крутки» покоя)
  function driveScarf(scarf){
    if (!scarfBones) return;
    for (let t = 0; t < 2; t++){
      const ch = scarfBones[t], nodes = scarf.nodes[t];
      ch[0].parent.getWorldQuaternion(pw);
      for (let j = 0; j < ch.length && j + 1 < scarf.N; j++){
        const o = j * 3;
        tv.set(nodes[o + 3] - nodes[o], nodes[o + 4] - nodes[o + 1], nodes[o + 5] - nodes[o + 2]).normalize();
        pwi.copy(pw).invert();
        tv.applyQuaternion(pwi);
        tv2.copy(axis[t][j]).applyQuaternion(restL[t][j]);
        T.setFromUnitVectors(tv2, tv);
        ch[j].quaternion.copy(T).multiply(restL[t][j]);
        pw.multiply(ch[j].quaternion);
      }
    }
  }

  function dispose(){
    if (mixer) mixer.stopAllAction();
    model.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const m of ms){ for (const k in m) if (m[k] && m[k].isTexture) m[k].dispose(); m.dispose(); }
    });
    for (const m of owned) m.dispose();
  }

  return {
    kind: "glb", root, yawG, squashG, baseScale, bones: bm, model, gltf, mixer, actions,
    rimTargets: { body, hair, face: null },
    sunU, anchors, colliders, scarfBones, scarfNodes, scarfSeg, applyPose, driveScarf, dispose,
    info: { height: h, clips: Object.keys(actions), scarfChains: scarfBones ? [lc.length, rc.length] : null,
            missing: BONES.filter((n, i) => !bm[i]) },
  };
}
