// world-kit: «Снежная Река» у трассы (WORLD-6). Отрезки 400–800 м, разрывы 250–500 м (≈ 60% дистанции),
// сторона чередуется. Лёд рисует шейдер поля (mats.ground: маска по uRiv0/uRiv1), льдины — слой декора.
// Там, где идёт река, средний слой B с этой стороны не ставится, дальние карточки отодвигаются за реку.
import { makeRng } from "./util.js";

export const RIVER = { x0: 12, x1: 34 };            // |x| берегов (м); бровка — снег поля
const FIRST = 60;                                    // первая река начинается на 60 м (видна с первых секунд)

export function createRiver(o){
  const rng = makeRng(((o && o.seed) >>> 0 || 1) * 23 + 5);
  const segs = [];                                   // [{ s0, s1, side }] по возрастанию s0, не больше 4
  const pool = [];
  for (let i = 0; i < 6; i++) pool.push({ s0: 0, s1: 0, side: 1 });
  let nextS = FIRST, nextSide = 1, lastDist = -1e9;

  function push(){
    const g = pool.pop(); if (!g) return;
    const len = 400 + rng() * 400;
    g.s0 = nextS; g.s1 = nextS + len; g.side = nextSide;
    segs.push(g);
    nextS = g.s1 + 250 + rng() * 250; nextSide = -nextSide;
  }
  function reset(dist){
    while (segs.length) pool.push(segs.pop());
    nextS = Math.max(FIRST, dist + FIRST); nextSide = 1;
  }
  function update(dist){
    if (dist < lastDist - 1) reset(dist);
    lastDist = dist;
    // держим план на 900 м вперёд (декор смотрит на ≤ 140 м), прошедшее выкидываем без splice
    while (segs.length && segs[0].s1 < dist - 40){ const g = segs[0]; for (let k = 0; k < segs.length - 1; k++) segs[k] = segs[k + 1]; segs.length--; pool.push(g); }
    while (segs.length < 3) push();
  }
  // сторона реки на дистанции s: −1 / 1, 0 — реки нет. pad — запас по краям отрезка (м)
  function sideAt(s, pad){
    pad = pad || 0;
    for (let i = 0; i < segs.length; i++){ const g = segs[i]; if (s > g.s0 - pad && s < g.s1 + pad) return g.side; }
    return 0;
  }
  // записать до двух ближайших к окну [dist − 20, dist + 140] отрезков в uniform-ы (мировые z: z = dist − s)
  function toUniforms(dist, u0, u1){
    let k = 0;
    u0.set(0, 0, 0, 0); u1.set(0, 0, 0, 0);
    for (let i = 0; i < segs.length && k < 2; i++){
      const g = segs[i];
      if (g.s1 < dist - 20 || g.s0 > dist + 140) continue;
      (k === 0 ? u0 : u1).set(dist - g.s1, dist - g.s0, g.side, 1);
      k++;
    }
  }
  return { segs, update, reset, sideAt, toUniforms };
}
