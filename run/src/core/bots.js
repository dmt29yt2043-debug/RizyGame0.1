// Боты для RUN.sim: "perfect" (доказательство честности паттернов), "random", "idle".
// Бот видит только то, что видит игрок: заспавненные сущности впереди (без очереди режиссёра).

export function createBots({ cfg, G, entities, doAction, makeRng }){
  const { obstacles, coins } = entities;
  const FREE = 0, JUMP = 1, SLIDE = 2, WALL = 3;
  const row1 = [0, 0, 0], row2 = [0, 0, 0];
  const pad = k => cfg.zLen[k] / 2 + cfg.hitPad;
  const code = k => k === "jump" ? JUMP : k === "slide" ? SLIDE : WALL;

  function perfect(){
    const sp = Math.max(1, G.speed);
    // два ближайших непройденных ряда (группировка по абсолютной дистанции s)
    let s1 = Infinity, s2 = Infinity;
    for (let i = 0; i < obstacles.length; i++){
      const o = obstacles[i];
      if (o.z > pad(o.kind) || o.z < -70) continue;
      if (o.s < s1 - 1){ s2 = s1; s1 = o.s; }
      else if (Math.abs(o.s - s1) <= 1){}
      else if (o.s < s2) s2 = o.s;
    }
    row1[0] = row1[1] = row1[2] = FREE; row2[0] = row2[1] = row2[2] = FREE;
    let z1 = 0, k1 = "wall";
    for (let i = 0; i < obstacles.length; i++){
      const o = obstacles[i];
      if (o.z > pad(o.kind)) continue;
      const r = Math.abs(o.s - s1) <= 1 ? row1 : Math.abs(o.s - s2) <= 1 ? row2 : null;
      if (!r) continue;
      if (r === row1){ z1 = o.z; k1 = o.kind; }
      for (let j = 0; j < o.lanes.length; j++) r[o.lanes[j]] = code(o.kind);
    }
    const has1 = s1 < Infinity, has2 = s2 < Infinity;
    const t1 = has1 ? (-z1 - pad(k1)) / sp : 99;              // сек до входа в зону удара ряда 1

    // выбор полосы: пары (l1, l2) с минимальной стоимостью
    let best = G.lane, bestCost = Infinity;
    const inZone = has1 && t1 < 0.12;
    for (let l1 = 0; l1 < 3; l1++){
      if (has1 && row1[l1] === WALL) continue;
      if (inZone && l1 !== G.lane) continue;                  // ряд уже рядом — не дёргаемся
      // путь через среднюю полосу не должен проходить стену ряда 1 впритык
      if (has1 && Math.abs(l1 - G.lane) === 2 && row1[1] === WALL && t1 < 0.2) continue;
      let c1 = Math.abs(l1 - G.lane) + (row1[l1] ? 1.5 : 0);
      let c2 = Infinity;
      for (let l2 = 0; l2 < 3; l2++){
        if (has2 && row2[l2] === WALL) continue;
        const c = Math.abs(l2 - l1) * 0.8 + (has2 && row2[l2] ? 1.2 : 0);
        if (c < c2) c2 = c;
      }
      if (c2 === Infinity) c2 = 50;
      // энергоны впереди тянут в свою полосу
      let bonus = 0;
      for (let i = 0; i < coins.length; i++){ const c = coins[i]; if (c.lane === l1 && c.z > -22 && c.z < 0.5) bonus += 0.08; }
      const cost = c1 + c2 - Math.min(0.6, bonus);
      if (cost < bestCost - 1e-6){ bestCost = cost; best = l1; }
    }
    if (best < G.lane) doAction("LEFT", "bot");
    else if (best > G.lane) doAction("RIGHT", "bot");

    if (!has1) return;
    const k = row1[G.lane];
    if (k === JUMP && t1 < 0.2 && t1 > -0.1 && G.py < 0.3) doAction("UP", "bot");
    if (k === SLIDE && t1 < 0.12 && !(G.sliding > 0.15)) doAction("DOWN", "bot");
  }

  const ACTS = ["LEFT", "RIGHT", "UP", "DOWN"];
  function make(kind, seed){
    if (kind === "perfect") return perfect;
    if (kind === "random"){
      const r = makeRng(((seed ?? 1) * 7919 + 13) >>> 0);
      return () => { if (r() < 0.03) doAction(ACTS[Math.floor(r() * 4)], "bot"); };
    }
    return () => {};
  }
  return { make };
}
