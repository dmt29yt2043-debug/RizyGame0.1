// GLB-адаптер Ризи: GLTFLoader + AnimationMixer, тот же контроллер (anim.js), что у процедурной модели.
// • Кости ищутся по именам (Blender «thigh.L», Mixamo «LeftUpLeg» и т.п.), нет обязательных — ошибка → процедурная.
// • Модель нормируется: рост opts.height (2.08 м), ноги на y = 0, лицо в −Z (glTF смотрит в +Z).
// • Клипы: один общий клип режется THREE.AnimationUtils.subclip по таблице кадров «rizy_clips»
//   (extras сцены/узла RizyRig, либо манифест rizy.glb.json), иначе ищутся отдельные клипы по именам.
//   Idle/Run/Jump/Slide/Stumble/Celebrate с кроссфейдом; для состояния без клипа кости крутит процедурная поза
//   (дельта в осях персонажа: L' = L0 · C⁻¹ · D · C). Аддитивные слои — поверх клипов.
// • Примитивы (по одному на материал) сливаются в 3 SkinnedMesh с цветом в вершинах: войлок / волосы+шарф / лицо.
// • Кости шарфа (scarf.L.1…, scarf.R.1…) ведёт verlet-цепочка; если их нет — лента крепится к груди.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
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
// имя в таблице rizy_clips → слот контроллера
const TABLE_SLOT = { idle: "idle", run: "run", jump: "air", slide: "slide", stumble: "stumble", celebrate: "celebrate" };

// таблица клипов: манифест → extras сцены → extras любого узла (строка JSON или объект)
function clipTable(gltf, manifest){
  const parse = v => { if (!v) return null; if (typeof v === "string"){ try { return JSON.parse(v); } catch (e){ return null; } } return v; };
  let t = manifest && parse(manifest.rizy_clips || manifest.clips);
  if (!t) t = parse(gltf.scene.userData && gltf.scene.userData.rizy_clips);
  if (!t) gltf.scene.traverse(o => { if (!t && o.userData && o.userData.rizy_clips) t = parse(o.userData.rizy_clips); });
  return t && typeof t === "object" ? t : null;
}

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

  // ---------- слияние примитивов: 3 SkinnedMesh с цветом в вершинах ----------
  const faceRx = /eye|mouth|pupil|brow/i, hairRx = /^(hair|scarf|bun)(?!tie)/i;
  const buckets = { body: [], hair: [], face: [] };
  for (const m of skinned){
    const mat = Array.isArray(m.material) ? m.material[0] : m.material;
    const nm = (mat && mat.name) || "";
    const cls = faceRx.test(nm) ? "face" : hairRx.test(nm.replace(/[^a-z]/gi, "")) ? "hair" : "body";
    buckets[cls].push(m);
  }
  const tmpC = new THREE.Color();
  function prepGeo(m){
    const src = m.geometry, g = new THREE.BufferGeometry();
    const n = src.attributes.position.count;
    g.setAttribute("position", src.attributes.position.clone());
    if (src.attributes.normal) g.setAttribute("normal", src.attributes.normal.clone());
    // единые типы костных атрибутов (mergeGeometries требует одинаковых массивов)
    const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    const SI = src.attributes.skinIndex, SW = src.attributes.skinWeight;
    for (let i = 0; i < n; i++) for (let k = 0; k < 4; k++){
      si[i * 4 + k] = SI ? SI.getComponent(i, k) : 0;
      sw[i * 4 + k] = SW ? SW.getComponent(i, k) : (k === 0 ? 1 : 0);
    }
    g.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(si, 4));
    g.setAttribute("skinWeight", new THREE.Float32BufferAttribute(sw, 4));
    const mat = Array.isArray(m.material) ? m.material[0] : m.material;
    tmpC.copy(mat && mat.color ? mat.color : tmpC.setRGB(1, 1, 1));
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++){ col[i * 3] = tmpC.r; col[i * 3 + 1] = tmpC.g; col[i * 3 + 2] = tmpC.b; }
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    if (src.index) g.setIndex(new THREE.BufferAttribute(new Uint32Array(src.index.array), 1));
    else { const ix = new Uint32Array(n); for (let i = 0; i < n; i++) ix[i] = i; g.setIndex(new THREE.BufferAttribute(ix, 1)); }
    if (!g.attributes.normal) g.computeVertexNormals();
    return g;
  }
  const Mat = (p, sheen) => {
    if (q === "low") return new THREE.MeshStandardMaterial(p);
    return new THREE.MeshPhysicalMaterial(Object.assign(p, sheen ? { sheen: 1, sheenRoughness: 0.55, sheenColor: new THREE.Color(0.35, 0.35, 0.37) } : {}));
  };
  const mats = {
    body: Mat({ color: 0xffffff, vertexColors: true, roughness: 0.78, metalness: 0 }, true),
    hair: Mat({ color: 0xffffff, vertexColors: true, roughness: 0.68, metalness: 0 }, true),
    face: q === "low" ? new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.2 })
                      : new THREE.MeshPhysicalMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.06 }),
  };
  for (const k in mats) mats[k].name = "rizy:glb:" + k;
  const merged = {};
  const oldMats = new Set();
  let tris = 0;
  for (const k of ["body", "hair", "face"]){
    const list = buckets[k];
    if (!list.length) continue;
    const ref = list[0];
    const geo = mergeGeometries(list.map(prepGeo), false);
    if (!geo) throw new Error("GLB: не удалось слить примитивы " + k);
    geo.computeBoundingSphere();
    tris += geo.index.count / 3;
    const sm = new THREE.SkinnedMesh(geo, mats[k]);
    sm.name = "rizy:glb:" + k;
    sm.position.copy(ref.position); sm.quaternion.copy(ref.quaternion); sm.scale.copy(ref.scale);
    sm.castShadow = k !== "face"; sm.receiveShadow = true; sm.frustumCulled = false;
    ref.parent.add(sm);
    sm.bind(ref.skeleton, ref.bindMatrix);
    merged[k] = sm;
    for (const m of list){
      const ms = Array.isArray(m.material) ? m.material : [m.material];
      for (const x of ms) oldMats.add(x);
      m.geometry.dispose();
      m.parent.remove(m);
    }
  }
  for (const x of oldMats){ for (const key in x) if (x[key] && x[key].isTexture) x[key].dispose(); x.dispose(); }
  model.traverse(o => { if (o.isMesh && !o.isSkinnedMesh){ o.castShadow = true; o.receiveShadow = true; } });

  // ---------- клипы ----------
  let mixer = null;
  const actions = {};
  const clipInfo = {};
  const hipsName = bm[idx("hips")].name;
  if (gltf.animations && gltf.animations.length){
    mixer = new THREE.AnimationMixer(model);
    const table = clipTable(gltf, opts.manifest);
    if (table){
      // самый длинный клип — общий «таймлайн» из Blender
      const src = gltf.animations.reduce((a, c) => (c.duration > a.duration ? c : a), gltf.animations[0]);
      for (const name in table){
        const slot = TABLE_SLOT[name.toLowerCase()], e = table[name];
        if (!slot || !e) continue;
        const fps = e.fps || 30, loop = e.loop !== false;
        // subclip исключает конечный кадр: у цикла он равен первому, у одноразового клипа добавляем +1
        const clip = THREE.AnimationUtils.subclip(src, name, e.frameStart, e.frameEnd + (loop ? 0 : 1), fps);
        if (slot === "air"){
          // высоту прыжка задаёт игра (py): подъём таза из клипа удвоил бы прыжок
          clip.tracks = clip.tracks.filter(t => t.name !== hipsName + ".position");
        }
        if (!clip.tracks.length || !(clip.duration > 0)) continue;
        const a = mixer.clipAction(clip);
        a.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
        a.clampWhenFinished = !loop;
        a.enabled = true; a.setEffectiveWeight(0); a.play();
        actions[slot] = a; clipInfo[slot] = { name, dur: +clip.duration.toFixed(3), loop };
      }
    } else {
      for (const k in CLIPS){
        const clip = gltf.animations.find(c => CLIPS[k].test(c.name));
        if (clip){ const a = mixer.clipAction(clip); a.enabled = true; a.setEffectiveWeight(0); a.play(); actions[k] = a; clipInfo[k] = { name: clip.name, dur: clip.duration }; }
      }
    }
    if (!Object.keys(actions).length){ mixer.stopAllAction(); mixer = null; }
  }
  let curAct = null, wClip = 0, lastHit = 99, slideT = 0;

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
      const d = new THREE.Vector3(s * 0.3, -0.25, 1).transformDirection(inv);
      anchors.push({ obj: o, dirObj: chest, dir: [d.x, d.y, d.z] });
    }
  }

  // ---------- кадр ----------
  const E = new THREE.Euler(), D = new THREE.Quaternion(), T = new THREE.Quaternion(), Tq = new THREE.Quaternion();
  const procQ = []; for (let i = 0; i < NB; i++) procQ.push(new THREE.Quaternion());
  const tv = new THREE.Vector3(), tv2 = new THREE.Vector3(), pw = new THREE.Quaternion(), pwi = new THREE.Quaternion();
  const hipsI = idx("hips"), packI = idx("pack"), bunLI = idx("bunL"), bunRI = idx("bunR"), eyeLI = idx("eyeL"), eyeRI = idx("eyeR");

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
        act.reset().setEffectiveWeight(1);
        if (curAct) curAct.crossFadeTo(act, 0.15, false);
        else act.fadeIn(0.15);
        curAct = act;
        slideT = 0;
      }
      if (actions.run) actions.run.timeScale = 0.9 + 0.5 * an.S.speedI;
      if (actions.air && state === "air"){ const a = actions.air; a.timeScale = 0; a.time = Math.min(1, an.jumpT / 0.63) * a.getClip().duration; }
      // подкат: клип растягивается на длительность подката игры (0.48..0.62 с), держится на последнем кадре
      if (actions.slide && state === "slide"){ slideT += simDt; const a = actions.slide; a.timeScale = 0; a.time = Math.min(1, slideT / 0.55) * a.getClip().duration * 0.999; }
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
      // клип праздника сам поднимает таз — процедурный «хоп» корня не нужен
      if (want === "celebrate" && actions.celebrate) out.hopY = 0;
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
    if (bm[eyeLI]) bm[eyeLI].scale.set(S0[eyeLI].x, S0[eyeLI].y * out.eyeL, S0[eyeLI].z);
    if (bm[eyeRI]) bm[eyeRI].scale.set(S0[eyeRI].x, S0[eyeRI].y * out.eyeR, S0[eyeRI].z);
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
    for (const k in merged) merged[k].geometry.dispose();
    for (const k in mats) mats[k].dispose();
    model.traverse(o => {
      if (o.isMesh && !merged[o.name.replace("rizy:glb:", "")]){ if (o.geometry) o.geometry.dispose(); }
    });
  }

  return {
    kind: "glb", root, yawG, squashG, baseScale, bones: bm, model, gltf, mixer, actions, meshes: merged, mats,
    rimTargets: { body: [mats.body], hair: [mats.hair], face: mats.face },
    sunU, anchors, colliders, scarfBones, scarfNodes, scarfSeg, applyPose, driveScarf, dispose,
    info: { height: h, tris, clips: clipInfo, scarfChains: scarfBones ? [lc.length, rc.length] : null,
            missing: BONES.filter((n, i) => !bm[i]) },
  };
}
