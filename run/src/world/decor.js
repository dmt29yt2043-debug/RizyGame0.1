// world-kit: трёхслойный инстансный декор с ритмом (WORLD-2) + фонари каждые 12 м через сторону.
// A ближний (сетка 3 м, x ±5.4..7.5, 30% пропусков, заборы сериями), B средний (9 ± 3 м, x ±9.5..18),
// C дальние карточки (x ±26..70), фонари, льдины на реке (WORLD-6). Запись идёт в кольцевые буферы по «дистанции трассы» s;
// экземпляры переписываются только когда список изменился (спавн/уход за камеру), прокрутка — сдвигом группы.
import * as THREE from "three";
import { Part, makeRng } from "./util.js";
import * as PR from "./props.js";
import { bankHeight } from "./track.js";

export const L_NEAR = 0, L_MID = 1, L_FAR = 2, L_LAMP = 3, L_RIVER = 4;
const NL = 5;                                        // число слоёв
const AHEAD = 112, BEHIND = 12;

class Ring {
  constructor(cap){
    this.cap = cap; this.head = 0; this.len = 0;
    this.s = new Float64Array(cap); this.t = new Int8Array(cap);
    this.x = new Float32Array(cap); this.y = new Float32Array(cap);
    this.cs = new Float32Array(cap); this.sn = new Float32Array(cap);
    this.sx = new Float32Array(cap); this.sy = new Float32Array(cap); this.tint = new Float32Array(cap);
  }
  push(s, t, x, y, cs, sn, sx, sy, tint){
    if (this.len >= this.cap) this.shift();
    const i = (this.head + this.len) % this.cap; this.len++;
    this.s[i] = s; this.t[i] = t; this.x[i] = x; this.y[i] = y; this.cs[i] = cs; this.sn[i] = sn;
    this.sx[i] = sx; this.sy[i] = sy; this.tint[i] = tint;
  }
  shift(){ this.head = (this.head + 1) % this.cap; this.len--; }
  clear(){ this.head = 0; this.len = 0; }
}

export function createDecor(mats, o){
  const Q = o.quality || "med";
  const seed = (o.seed >>> 0) || 1;
  const blocked = o.blocked || (() => false);
  const river = o.river || null;                     // createRiver(): sideAt(s, pad) → −1 / 0 / 1
  const root = new THREE.Group(); root.name = "world:decor";
  const T = [];                                     // типы: { layer, parts, halo? }
  const ownGeo = [];
  function type(layer, specs){
    const parts = [];
    for (const [geo, mat, cap, extra] of specs){
      ownGeo.push(geo);
      const p = new Part(geo, mat, cap, Object.assign({ receive: true }, extra));
      root.add(p.mesh); parts.push(p);
    }
    T.push({ layer, parts }); return T.length - 1;
  }

  // ---------- типы ----------
  const N = { cane: type(L_NEAR, [[PR.nearCane(), mats.candy, 40]]),
    fence: type(L_NEAR, [[PR.nearFence(), mats.felt, 48]]),
    lolli: type(L_NEAR, [[PR.nearLolliTree(), mats.candy, 40]]),
    hump:  type(L_NEAR, [[PR.nearHummock(), mats.snowDecor, 40]]),
    fir:   type(L_NEAR, [[PR.nearFir(), mats.felt, 40]]),
    snowman: type(L_NEAR, [[PR.nearSnowman(), mats.felt, 24]]) };
  const hA = PR.midHouseA(), hB = PR.midHouseB();
  const Md = { treeA: type(L_MID, [[PR.midTreeA(), mats.felt, 20]]),
    treeB: type(L_MID, [[PR.midTreeB(), mats.felt, 20]]),
    houseA: type(L_MID, [[hA.body, mats.felt, 12], [hA.win, mats.glowWin, 12, { receive: false }]]),
    houseB: type(L_MID, [[hB.body, mats.felt, 12], [hB.win, mats.glowWin, 12, { receive: false }]]),
    jelly: type(L_MID, [[PR.midJellyHill(), mats.candy, 12]]),
    lolly: type(L_MID, [[PR.midBigLolly(), mats.candy, 12]]) };
  const card = () => { const g = new THREE.PlaneGeometry(1, 1); g.translate(0, 0.5, 0); return g; };
  const F = { trees: type(L_FAR, [[card(), mats.cardTrees, 28, { receive: false }]]),
    houses: type(L_FAR, [[card(), mats.cardHouses, 20, { receive: false }]]) };
  const lampG = PR.lamp();
  const LAMP = type(L_LAMP, [[lampG.body, mats.candy, 16], [lampG.core, mats.glowLamp, 16, { receive: false }],
    [new THREE.PlaneGeometry(1, 1), mats.haloLamp, 16, { receive: false, renderOrder: 3 }]]);
  T[LAMP].halo = 2; T[LAMP].coreY = lampG.coreY;
  const FLOE = type(L_RIVER, [[PR.floe(), mats.ice, 48, { receive: true }]]);

  // веса ближнего и среднего слоёв (забор — отдельной серией)
  const NEAR_PICK = [[N.fir, 0.30], [N.hump, 0.22], [N.cane, 0.18], [N.lolli, 0.18], [N.snowman, 0.12]];
  const MID_PICK = [[Md.treeA, 0.30], [Md.treeB, 0.25], [Md.houseA, 0.14], [Md.houseB, 0.12], [Md.jelly, 0.10], [Md.lolly, 0.09]];
  const SKIP = Q === "low" ? 0.45 : Q === "high" ? 0.22 : 0.30;

  // ---------- состояние слоёв ----------
  const SIDES = [-1, 1];
  const rings = [[new Ring(64), new Ring(64)], [new Ring(32), new Ring(32)], [new Ring(32), new Ring(32)], [new Ring(20)], [new Ring(24), new Ring(24)]];
  const rng = [[makeRng(seed * 11 + 1), makeRng(seed * 11 + 2)], [makeRng(seed * 13 + 3), makeRng(seed * 13 + 4)],
               [makeRng(seed * 17 + 5), makeRng(seed * 17 + 6)], [makeRng(seed * 19 + 7)], [makeRng(seed * 29 + 8), makeRng(seed * 29 + 9)]];
  const next = [[0, 0], [0, 0], [0, 0], [0], [0, 0]];
  const side = { last: [[-1, -1], [-1, -1]], fence: [0, 0], cool: [0, 0], lampSide: -1 };
  const dirty = [true, true, true, true, true];
  let s0 = 0, lastDist = -1e9;

  function pickW(r, table, avoid){
    let u = r(), k = 0;
    for (; k < table.length - 1; k++){ u -= table[k][1]; if (u <= 0) break; }
    if (table[k][0] === avoid) k = (k + 1) % table.length;       // два одинаковых подряд не ставим
    return table[k][0];
  }

  function spawnNear(si, s){
    const sd = SIDES[si], r = rng[L_NEAR][si], ring = rings[L_NEAR][si];
    if (blocked(s, L_NEAR, sd)){ side.fence[si] = 0; return; }
    let t;
    if (side.fence[si] > 0){ t = N.fence; side.fence[si] -= 3; if (side.fence[si] <= 0) side.cool[si] = 12; }
    else {
      side.cool[si] -= 3;
      const u = r();
      if (u < SKIP) return;
      if (side.cool[si] <= 0 && r() < 0.09){ t = N.fence; side.fence[si] = 20 + r() * 20 - 3; }
      else t = pickW(r, NEAR_PICK, side.last[0][si]);
    }
    side.last[0][si] = t;
    let x, cs = 1, sn = 0, sc = 1, tint = 0.94 + r() * 0.12, yaw = 0;
    if (t === N.fence){ x = sd * 5.75; tint = 1; }
    else {
      x = sd * (5.5 + r() * 2.0); sc = 0.85 + r() * 0.35;
      if (t === N.fir || t === N.hump) yaw = r() * Math.PI * 2;
      else if (t === N.cane) yaw = (sd > 0 ? Math.PI : 0) + (r() - 0.5) * 0.87;
      else yaw = (r() - 0.5) * 0.87 - sd * 0.25;
      cs = Math.cos(yaw); sn = Math.sin(yaw);
    }
    const y = bankHeight(Math.abs(x)) * 0.6 - 0.08;
    ring.push(s, t, x, y, cs, sn, sc, sc, tint);
  }
  function spawnMid(si, s){
    const sd = SIDES[si], r = rng[L_MID][si], ring = rings[L_MID][si];
    if (blocked(s, L_MID, sd)) return;
    if (river && river.sideAt(s, 14) === sd) return;          // река заменяет средний слой с этой стороны
    const t = pickW(r, MID_PICK, side.last[1][si]); side.last[1][si] = t;
    const x = sd * (9.5 + r() * 8.5), sc = 0.85 + r() * 0.35;
    let yaw;
    if (t === Md.houseA || t === Md.houseB) yaw = (sd > 0 ? -0.97 : 0.97) + (r() - 0.5) * 0.6;
    else if (t === Md.lolly) yaw = (r() - 0.5) * 0.87;
    else yaw = r() * Math.PI * 2;
    ring.push(s, t, x, bankHeight(Math.abs(x)) * 0.5, Math.cos(yaw), Math.sin(yaw), sc, sc, 0.94 + r() * 0.12);
  }
  function spawnFar(si, s){
    const sd = SIDES[si], r = rng[L_FAR][si], ring = rings[L_FAR][si];
    if (blocked(s, L_FAR, sd)) return;
    const t = r() < 0.62 ? F.trees : F.houses;
    const x0 = river && river.sideAt(s, 20) === sd ? 38 : 26;   // за рекой, а не на льду
    const x = sd * (x0 + r() * (70 - x0)), w = (t === F.trees ? 18 : 22) + r() * 14, h = w * (0.42 + r() * 0.16);
    const yaw = -sd * 0.18 * r();
    ring.push(s, t, x, -0.5, Math.cos(yaw), Math.sin(yaw), w, h, 0.9 + r() * 0.1);
  }
  function spawnLamp(s){
    const sd = side.lampSide; side.lampSide = -sd;
    if (blocked(s, L_LAMP, sd)) return;
    const x = sd * 5.45;
    rings[L_LAMP][0].push(s, LAMP, x, bankHeight(5.45) * 0.55 - 0.05, 1, 0, 1, 1, 1);
  }

  // льдины: только внутри русла (|x| 17..29 — с запасом от берегов 12..34)
  function spawnFloe(si, s){
    const sd = SIDES[si], r = rng[L_RIVER][si], ring = rings[L_RIVER][si];
    if (!river || river.sideAt(s, -12) !== sd) return;
    const x = sd * (17 + r() * 12), sc = 0.7 + r() * 1.1, yaw = r() * Math.PI * 2;
    ring.push(s, FLOE, x, -0.26, Math.cos(yaw), Math.sin(yaw), sc, 1, 0.94 + r() * 0.1);
  }

  function reset(dist){
    for (const L of rings) for (const g of L) g.clear();
    for (const l of [L_NEAR, L_MID, L_FAR, L_RIVER]) for (let si = 0; si < 2; si++) next[l][si] = dist - BEHIND + (l === L_NEAR ? 0 : rng[l][si]() * 6);
    next[L_LAMP][0] = Math.ceil((dist - BEHIND) / 12) * 12;
    side.fence[0] = side.fence[1] = 0; side.cool[0] = side.cool[1] = 0;
    s0 = Math.floor(dist); dirty.fill(true);
  }

  function rebuild(layer){
    for (let k = 0; k < T.length; k++){ const ty = T[k]; if (ty.layer !== layer) continue; for (let j = 0; j < ty.parts.length; j++) ty.parts[j].begin(); }
    const L = rings[layer];
    for (let g = 0; g < L.length; g++){
      const ring = L[g];
      for (let q = 0; q < ring.len; q++){
        const i = (ring.head + q) % ring.cap, ty = T[ring.t[i]];
        const z = -(ring.s[i] - s0), x = ring.x[i], y = ring.y[i], cs = ring.cs[i], sn = ring.sn[i];
        const sx = ring.sx[i], sy = ring.sy[i], tt = ring.tint[i];
        for (let j = 0; j < ty.parts.length; j++){
          if (j === ty.halo) ty.parts[j].pushS(x, y + ty.coreY * sy, z, 1, 0, 1.9, 1.9, 1.9, 1, 1, 1);
          else ty.parts[j].pushS(x, y, z, cs, sn, sx, sy, layer === L_FAR ? 1 : layer === L_RIVER ? sx * 0.8 : sx, tt, tt, tt);
        }
      }
    }
    for (let k = 0; k < T.length; k++){ const ty = T[k]; if (ty.layer !== layer) continue; for (let j = 0; j < ty.parts.length; j++) ty.parts[j].end(); }
    dirty[layer] = false;
  }

  const STEP_NEAR = 3;
  function update(dist){
    if (dist < lastDist - 1 || lastDist < -1e8) reset(dist);
    lastDist = dist;
    const lim = dist + AHEAD, old = dist - BEHIND;
    for (let si = 0; si < 2; si++){
      while (next[L_NEAR][si] < lim){ spawnNear(si, next[L_NEAR][si]); next[L_NEAR][si] += STEP_NEAR; dirty[L_NEAR] = true; }
      while (next[L_MID][si] < lim){ spawnMid(si, next[L_MID][si]); next[L_MID][si] += 6 + rng[L_MID][si]() * 6; dirty[L_MID] = true; }
      while (next[L_FAR][si] < lim + 20){ spawnFar(si, next[L_FAR][si]); next[L_FAR][si] += 7 + rng[L_FAR][si]() * 8; dirty[L_FAR] = true; }
      while (next[L_RIVER][si] < lim){ spawnFloe(si, next[L_RIVER][si]); next[L_RIVER][si] += 4 + rng[L_RIVER][si]() * 6; dirty[L_RIVER] = true; }
    }
    while (next[L_LAMP][0] < lim){ spawnLamp(next[L_LAMP][0]); next[L_LAMP][0] += 12; dirty[L_LAMP] = true; }
    for (let l = 0; l < NL; l++) for (let g = 0; g < rings[l].length; g++){
      const ring = rings[l][g];
      const back = l === L_FAR ? old - 30 : old;
      while (ring.len && ring.s[ring.head] < back){ ring.shift(); dirty[l] = true; }
    }
    if (dist - s0 > 400){ s0 += 400; dirty.fill(true); }
    root.position.z = dist - s0;
    for (let l = 0; l < NL; l++) if (dirty[l]) rebuild(l);
  }

  // пересобрать уже заспавненное (после смены планов сет-пьес): просто начать слой заново от текущей дистанции
  function respawn(dist){ lastDist = -1e9; update(dist); }

  function count(){ let n = 0; for (const ty of T) for (const p of ty.parts) n += p.n; return n; }
  function dispose(){ for (const g of ownGeo) g.dispose(); }
  return { root, update, respawn, reset, count, types: T, dispose };
}
