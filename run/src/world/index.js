// world-kit — «Снежная Река» 2026: небо и туман, трасса-жёлоб, трёхслойный декор, фонари, сет-пьесы,
// препятствия и энергоны. Самодостаточный модуль: адаптер src/plugins/world.js только связывает события с вызовами.
//
//   const kit = createWorldKit(ctx, { seed, onEvent, reducedMotion, autoPalette })
//   kit.update(simDt, realDt, G)        // каждый кадр; G.dist — единственное, что обязательно
//   kit.makeObstacle(ent) → Object3D    // прокси из пула; main пишет proxy.position.z = ent.z
//   kit.makeCoin(ent) → Object3D
//   kit.makePowerup(ent) → Object3D     // ускоритель: ent.kind "magnet"|"shield"|"boost"|"x2", парит на ent.y
//   kit.release(obj)                    // на despawn/pickup
//   kit.setPalette(i, instant?)         // 0 УТРО, 1 ПОЛДЕНЬ-КЭНДИ, 2 ЗОЛОТОЙ ЧАС, 3 СИНИЙ ЧАС
//   kit.setBest(best)                   // флаг «РЕКОРД» на дистанции best (WORLD-7), звать на старте забега
//   kit.dispose()
// Контракт и шаги адаптера src/plugins/world.js — в конце файла (ADAPTER).
import * as THREE from "three";
import { createMats } from "./mats.js";
import { createSky, PALETTES } from "./sky.js";
import { createTrack } from "./track.js";
import { createDecor } from "./decor.js";
import { createPieces, PIECE_TYPES } from "./pieces.js";
import { createEntities } from "./entities.js";
import { createGates } from "./gates.js";
import { createRiver } from "./river.js";
import { L_NEAR, L_LAMP } from "./decor.js";
import { damp, clamp } from "./util.js";

export { PALETTES, PIECE_TYPES };

export function createWorldKit(ctx, opts = {}){
  const scene = ctx.scene, camera = ctx.camera;
  const quality = ctx.quality === "low" || ctx.quality === "high" ? ctx.quality : "med";
  let seed = opts.seed;
  if (seed == null) seed = ctx.qp && ctx.qp.has && ctx.qp.has("seed") ? (+ctx.qp.get("seed") || 1) : 1;
  let reduced = opts.reducedMotion;
  if (reduced == null){ try { reduced = matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e){ reduced = false; } }

  const events = { name: "", payload: null };
  const emit = (name, payload) => {
    events.name = name; events.payload = payload;
    if (opts.onEvent) opts.onEvent(name, payload);
    else if (opts.bus && opts.bus.emit) opts.bus.emit(name, payload);
  };

  // общие uniform-ы кита
  const U = {
    uDistMod: { value: 0 }, uTime: { value: 0 }, uTimeReal: { value: 0 },
    uSunDirView: { value: new THREE.Vector3(0, 1, 0) }, uBridge: { value: new THREE.Vector2(1e4, 1e4) },
    uGlint: { value: 1 }, uRimCol: { value: new THREE.Color(1, 1, 1) }, uRimColCoin: { value: new THREE.Color(0xE9FFB0) },
    uFade: { value: new THREE.Vector2(70, 115) },
    uRiv0: { value: new THREE.Vector4() }, uRiv1: { value: new THREE.Vector4() },
  };
  const milestoneStep = opts.milestoneStep > 0 ? opts.milestoneStep : 250;

  const mats = createMats(ctx, U);
  const root = new THREE.Group(); root.name = "world:root";
  const sky = createSky(ctx, U);
  root.add(sky.mesh);
  const track = createTrack(mats);
  root.add(track.group);
  const pieces = createPieces(mats, { seed, emit, firstAt: opts.firstPieceAt, milestoneStep });
  root.add(pieces.group);
  const gates = createGates(mats, { emit, step: milestoneStep });
  root.add(gates.group);
  const river = createRiver({ seed });
  const blocked = (s, layer, side) => pieces.blocked(s, layer, side) || gates.blocked(s, layer === L_NEAR || layer === L_LAMP);
  const decor = createDecor(mats, { quality, seed, blocked, river });
  root.add(decor.root);
  const ents = createEntities(mats, { lanes: ctx.cfg && ctx.cfg.LANES });
  root.add(ents.root);

  const ownFog = opts.ownFog !== false;
  const prevFog = scene ? scene.fog : null, prevBg = scene ? scene.background : null;
  if (scene){
    if (ownFog){ scene.fog = sky.fog; scene.background = null; }
    if (opts.autoAdd !== false) scene.add(root);
  }
  const curve = ctx.look && ctx.look.curve;
  if (curve && curve.patch) curve.patch(root);

  // живое состояние для адаптера (свет, камера, пост, аудио)
  const state = {
    dist: 0, tunnel: 0, calm: 0, inTunnel: false,
    palette: sky.state,              // см. sky.js: top, horizon, sunColor, sunIntensity, sunElevation, hemi, lamps, saturation, bloomThresholdDelta …
    reducedMotion: reduced,
  };

  const sunW = new THREE.Vector3(), tmpC = new THREE.Color();
  let tSim = 0, tReal = 0, lastKey = -1, autoPalette = opts.autoPalette !== false;

  function update(simDt, realDt, G){
    simDt = simDt || 0; realDt = realDt == null ? simDt : realDt;
    const dist = G && typeof G.dist === "number" ? G.dist : 0;
    state.dist = dist;
    tSim += simDt; tReal += realDt;
    U.uDistMod.value = dist % 1000;
    U.uTime.value = reduced ? 0 : tSim;
    U.uTimeReal.value = tReal;
    const mt = mats.scrollTextures;
    for (let i = 0; i < mt.length; i++){ const v = dist * mt[i].repeat.y; mt[i].offset.y = v - Math.floor(v); }

    track.update(dist);
    river.update(dist);
    river.toUniforms(dist, U.uRiv0.value, U.uRiv1.value);
    pieces.update(dist);
    gates.update(dist);
    const br = pieces.state.bridge;
    if (br) U.uBridge.value.set(dist - (br.s0 + br.len), dist - br.s0); else U.uBridge.value.set(1e4, 1e4);
    decor.update(dist);
    ents.update(tSim, reduced);

    // цветовой сценарий: ключ каждые 1000 м, не ближе 60 м к сет-пьесе
    if (autoPalette){
      const key = Math.floor(dist / 1000) % PALETTES.length;
      if (lastKey < 0) lastKey = key;
      if (key !== lastKey && !pieces.nearPiece(dist, 60)){ lastKey = key; sky.setKey(key, false); }
    }
    sky.update(realDt, camera);
    const ps = sky.state;
    mats.setGlow(mats.glowLamp, ps.lamps);
    mats.setGlow(mats.glowWin, ps.windows);
    mats.haloLamp.uniforms.uOpacity.value = clamp((ps.lamps - 1.6) * 0.2, 0, 0.5);   // днём ореола нет, в синий час 0.48
    mats.haloCoin.uniforms.uOpacity.value = ps.haloOpacity;
    U.rimStrObst.value = 0.25 * ps.rimMul;
    const k = 0.5 + 0.5 * ps.mtnK;
    tmpC.setRGB(k, k, k).lerp(ps.horizon, 0.3);
    mats.cardTrees.color.copy(tmpC); mats.cardHouses.color.copy(tmpC);

    // тоннель: вход 0.35 с, выход 0.25 с (realDt — это камера/свет)
    state.inTunnel = pieces.state.tunnel;
    state.tunnel = damp(state.tunnel, state.inTunnel ? 1 : 0, state.inTunnel ? 1 / 0.35 * 3 : 1 / 0.25 * 3, realDt);
    state.calm = damp(state.calm, pieces.state.calm ? 1 : 0, 2, realDt);

    // направление на солнце для блёсток (вид)
    const L = ctx.lights && ctx.lights.sun;
    if (L) sunW.copy(L.position).sub(L.target.position).normalize(); else sunW.set(-0.62, 0.7, -0.25).normalize();
    if (camera) U.uSunDirView.value.copy(sunW).transformDirection(camera.matrixWorldInverse);
  }

  // применить палитру и тоннель к свету main (адаптер решает, звать ли); без аллокаций
  // k — необязательные множители { sun, hemi, fill } (объект не создаётся на каждый вызов)
  function applyLights(lights, k){
    if (!lights) return;
    const ps = sky.state, tn = state.tunnel;
    const kS = k && k.sun != null ? k.sun : 1, kH = k && k.hemi != null ? k.hemi : 1, kF = k && k.fill != null ? k.fill : 1;
    // тоннель (WORLD-3): солнце 2.6 → 0.9 (×0.35), hemi 0.30 → 0.12 (×0.4)
    if (lights.sun){ lights.sun.color.copy(ps.sunColor); lights.sun.intensity = ps.sunIntensity * (1 - tn * 0.65) * kS; }
    if (lights.hemi){ lights.hemi.intensity = ps.hemi * (1 - tn * 0.6) * kH; lights.hemi.color.copy(ps.top).lerp(ps.horizon, 0.6); }
    if (lights.fill){ lights.fill.intensity = 0.45 * (1 - tn * 0.5) * kF; }
  }

  function setPalette(i, instant){ sky.setKey(i, !!instant); lastKey = Math.floor(state.dist / 1000) % PALETTES.length; }

  // прогрев шейдеров: все сет-пьесы видимы на время compile
  function compile(renderer, cam){
    const groups = PIECE_TYPES.map(t => pieces.built[t].group).concat([gates.milestone, gates.record]);
    const vis = groups.map(g => g.visible);
    groups.forEach(g => { g.visible = true; });
    try { renderer.compile(scene, cam || camera); } finally { groups.forEach((g, i) => { g.visible = vis[i]; }); }
  }

  function dispose(){
    if (root.parent) root.parent.remove(root);
    if (scene && ownFog){ if (scene.fog === sky.fog) scene.fog = prevFog; if (scene.background === null) scene.background = prevBg; }
    sky.dispose(); track.dispose(); decor.dispose(); pieces.dispose(); gates.dispose(); ents.dispose(); mats.dispose();
  }

  return {
    root, state, events, update,
    makeObstacle: ents.makeObstacle, makeCoin: ents.makeCoin, makePowerup: ents.makePowerup, release: ents.release,
    setPalette, applyLights, compile, dispose,
    // планировщик сет-пьес и подсказки геймплею
    landmarks: pieces.plan,                                   // [{ type, s0, len, shown, revealed, entered, exited, payload }]
    forcePiece: (type, s0) => { pieces.force(type, s0); decor.respawn(state.dist); },
    wallFreeAt: z => pieces.wallFree(state.dist - z),        // z — мировой z (отрицательный впереди)
    coinLaneAt: z => pieces.coinLane(state.dist - z),        // 1 — через центр арки, −1 — без подсказки
    riverSideAt: z => river.sideAt(state.dist - z, 0),       // −1 / 0 / 1 (аудио, камера)
    setBest: best => gates.setBest(best),
    milestoneStep,
    setReducedMotion: v => { reduced = !!v; state.reducedMotion = reduced; },
    // отладка
    debug: { mats, sky, track, decor, pieces, gates, river, ents, U },
  };
}

export default createWorldKit;
