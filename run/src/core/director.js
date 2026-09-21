// Режиссёр трассы (GAME-2 / GAME-3 / GAME-7): паттерны препятствий по тирам, промежутки в СЕКУНДАХ,
// передышки, милосердие после удара, энергоны по безопасным линиям, сценарий первого забега.
//
// Координаты: у каждой сущности абсолютная дистанция s (м от старта). Мировой z = G.dist − s (впереди z < 0).
// Паттерн генерируется в очередь заранее, сущности появляются по одной, когда s − G.dist ≤ cfg.spawnAhead.
// Горячий путь update() не аллоцирует: элементы очереди берутся из пула, наборы полос — общие массивы.

const FREE = 0, JUMP = 1, SLIDE = 2, WALL = 3;
const KIND = ["", "jump", "slide", "wall"];

// общие неизменяемые наборы полос: LANESET[a][b] = [a..b]
const LANESET = [[[0], [0, 1], [0, 1, 2]], [null, [1], [1, 2]], [null, null, [2]]];
for (const row of LANESET) for (const a of row) if (a) Object.freeze(a);
export const laneSet = (a, b) => LANESET[a][b];

export function createDirector({ cfg, G, rng, addObstacle, addCoin, addPowerup }){
  const PW = cfg.power || { kinds: ["magnet", "shield", "boost", "x2"], firstS: 180, gap: [350, 600] };
  const PKIND = PW.kinds;
  const rnd = (a, b) => a + rng() * (b - a);
  const irnd = n => Math.floor(rng() * n);
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const lerp = (a, b, t) => a + (b - a) * t;

  // ---------- очередь с пулом ----------
  const pool = [];
  const queue = [];                        // отсортирована по s
  function item(){
    const it = pool.pop() || { type: 0, kind: 0, a: 0, b: 0, s: 0, x: 0, y: 0, arc: 0, arcN: 0, row: 0, tier: 0 };
    it.arc = 0; it.arcN = 0; it.x = NaN; it.y = 0; it.row = 0; it.tier = 0;
    return it;
  }
  function push(it){
    // вставка с сохранением порядка (обычно в хвост)
    let i = queue.length;
    queue.push(it);
    while (i > 0 && queue[i - 1].s > it.s){ queue[i] = queue[i - 1]; i--; }
    queue[i] = it;
  }
  function obst(kind, a, b, s, row, tier){
    const it = item(); it.type = 1; it.kind = kind; it.a = a; it.b = b; it.s = s; it.row = row; it.tier = tier;
    push(it);
  }
  function coin(lane, x, y, s, arc, arcN){
    const it = item(); it.type = 2; it.a = lane; it.x = x; it.y = y; it.s = s; it.arc = arc || 0; it.arcN = arcN || 0;
    push(it);
  }
  function power(kind, lane, s){
    const it = item(); it.type = 3; it.kind = kind; it.a = lane; it.b = lane; it.s = s;
    push(it);
  }

  // ---------- состояние ----------
  const st = {
    nextS: cfg.firstObstacleS, patterns: 0, rowId: 0, arcId: 0,
    lastBreatherS: -1e9, breatherReq: false, mercyUntilT: -1, lastTier: 0,
    tutorial: null,                        // сценарий первого забега (см. startTutorial)
    endS: 0,                               // дальний край последнего сгенерированного паттерна
    nextPowerS: PW.firstS, lastPower: -1, powerups: 0,   // ускорители: следующая дистанция, последний вид, выдано
  };
  // занятые клетки последних рядов (для проверки энергонов): [s, c0, c1, c2] × RING
  const RING = 24, occ = new Float32Array(RING * 4); let occN = 0;
  function markRow(s, c){ const i = (occN++ % RING) * 4; occ[i] = s; occ[i + 1] = c[0]; occ[i + 2] = c[1]; occ[i + 3] = c[2]; }
  function blocked(lane, s, pad){
    const n = Math.min(occN, RING);
    for (let k = 0; k < n; k++){ const i = k * 4; if (occ[i + 1 + lane] !== FREE && Math.abs(occ[i] - s) < pad) return true; }
    return false;
  }

  // ---------- скорость и сложность ----------
  function targetSpeed(t){
    const W = cfg.speedWarm, A = cfg.speedAsym;
    let v = t < W.t ? lerp(W.from, W.to, clamp(t / W.t, 0, 1)) : A.base + A.add * (1 - Math.exp(-(t - W.t) / A.tau));
    return Math.min(cfg.speedMax, v);
  }
  const difficulty = t => Math.pow(clamp((t - 20) / 160, 0, 1), 0.8);
  // метры на секунду для планирования: берём БОЛЬШУЮ из текущей и будущей скорости → промежутки не короче заданных секунд
  const planSpeed = () => Math.max(G.speed, targetSpeed(G.runT + 4), cfg.speedStart) * (G.calm ? cfg.calmSpeedMul : 1);

  function pickTier(d, t){
    if (t < 20) return 1;
    const W = cfg.tierWeights;
    let w = W[W.length - 1][1];
    for (let i = 0; i < W.length; i++) if (d < W[i][0]) { w = W[i][1]; break; }
    let sum = 0; for (let i = 0; i < 5; i++) sum += w[i];
    let r = rng() * sum;
    for (let i = 0; i < 5; i++){ r -= w[i]; if (r < 0 && w[i] > 0) return i + 1; }
    return 1;
  }

  // ---------- ряды ----------
  const cells = [0, 0, 0];
  function rowT1(c){
    c[0] = c[1] = c[2] = FREE;
    const r = rng();
    c[irnd(3)] = r < 0.36 ? JUMP : r < 0.63 ? SLIDE : WALL;
  }
  function rowT2(c){
    const r = rng();
    if (r < 0.5){ c[0] = c[1] = c[2] = WALL; c[irnd(3)] = FREE; }          // две стены, одна полоса свободна
    else if (r < 0.75){ c[0] = c[1] = c[2] = JUMP; }                       // валики на всю ширину
    else { c[0] = c[1] = c[2] = SLIDE; }                                   // гирлянда на всю ширину
  }
  function wallsExcept(c, free){ c[0] = c[1] = c[2] = WALL; c[free] = FREE; }

  // ряд → сущности-заготовки (стены и валики по полосам, гирлянда одной лентой на соседние полосы)
  function emitRow(c, s, tier){
    const row = ++st.rowId;
    for (let l = 0; l < 3; l++){
      const k = c[l];
      if (k === JUMP || k === WALL) obst(k, l, l, s, row, tier);
      else if (k === SLIDE){
        let e = l; while (e < 2 && c[e + 1] === SLIDE) e++;
        obst(SLIDE, l, e, s, row, tier);
        l = e;
      }
    }
    markRow(s, c);
  }

  // энергоны на ряд: дуга над валиком, низкая линия под гирляндой, линия в свободной полосе перед стеной
  function coinsForRow(c, s, sp){
    let jl = -1, sl = -1, fl = -1;
    const o = irnd(3);
    for (let k = 0; k < 3; k++){ const l = (o + k) % 3; if (c[l] === JUMP && jl < 0) jl = l; if (c[l] === SLIDE && sl < 0) sl = l; if (c[l] === FREE && fl < 0) fl = l; }
    const r = rng();
    if (jl >= 0 && r < 0.5){
      const n = cfg.coinArc, len = sp * 0.63, id = ++st.arcId, s0 = s - len * 0.42;
      for (let i = 0; i < n; i++){
        const u = i / (n - 1);
        coin(jl, NaN, 0.95 + cfg.jump.h * 4 * u * (1 - u), s0 + u * len, id, n);
      }
      return;
    }
    if (sl >= 0 && r < 0.75){
      for (let i = 0; i < cfg.coinSlide; i++){
        const cs = s - 2.5 + i * 1.0;
        coin(sl, NaN, 0.45, cs);
      }
      return;
    }
    if (fl >= 0){
      const n = cfg.coinLine[0] + irnd(cfg.coinLine[1] - cfg.coinLine[0] + 1);
      for (let i = 0; i < n; i++){
        const cs = s + 2 - (n - 1 - i) * cfg.coinStep;
        if (!blocked(fl, cs, 2.2)) coin(fl, NaN, 0.95, cs);
      }
    }
  }

  // линия/змейка энергонов в свободном отрезке [s0, s1]
  function coinsFill(s0, s1){
    const len = s1 - s0;
    if (len < 8) return;
    if (rng() < 0.45 && len >= 16){
      const a = irnd(3); let b = irnd(3); if (b === a) b = (a + 1 + irnd(2)) % 3;
      const n = cfg.coinLaneS, L = Math.min(14, len - 2), base = s0 + (len - L) / 2;
      const LA = cfg.LANES[a], LB = cfg.LANES[b];
      for (let i = 0; i < n; i++){
        const u = i / (n - 1), k = u * u * (3 - 2 * u), x = LA + (LB - LA) * k;
        const lane = Math.abs(x - LA) < Math.abs(x - LB) ? a : b;
        coin(lane, x, 0.95, base + u * L);
      }
    } else {
      const lane = irnd(3);
      const n = Math.min(cfg.coinLine[1], Math.floor((len - 2) / cfg.coinStep) + 1);
      const base = s0 + (len - (n - 1) * cfg.coinStep) / 2;
      for (let i = 0; i < n; i++) coin(lane, NaN, 0.95, base + i * cfg.coinStep);
    }
  }

  // ускоритель в свободном отрезке [s0, s1] (между рядами никогда: ставим только в промежутки и передышки).
  // Полоса случайная, но не «в ряду» с препятствием той же полосы (проверка по кольцу занятых клеток).
  // Возвращает s ускорителя или −1, если сейчас не время (следующий по плану дальше s1).
  function powerIn(s0, s1){
    if (!addPowerup || st.nextPowerS > s1 || s1 - s0 < 10) return -1;
    const ps = Math.max(s0 + 5, Math.min(s1 - 5, (s0 + s1) * 0.5));
    let lane = irnd(3), ok = false;
    for (let k = 0; k < 3; k++){ const l = (lane + k) % 3; if (!blocked(l, ps, 6)){ lane = l; ok = true; break; } }
    if (!ok) return -1;
    let kind = irnd(PKIND.length);
    if (kind === st.lastPower) kind = (kind + 1) % PKIND.length;
    st.lastPower = kind; st.powerups++;
    power(kind, lane, ps);
    st.nextPowerS = ps + rnd(PW.gap[0], PW.gap[1]);
    return ps;
  }

  // ---------- паттерны ----------
  function genPattern(){
    const t = G.runT, sp = planSpeed(), d = difficulty(t);
    const s = st.nextS;
    const inner = () => Math.max(rnd(cfg.innerGap[0], cfg.innerGap[1]) * sp, 12);

    // передышка: после каждого 5-го паттерна, рубежа и сет-пьесы (не чаще раза в 150 м)
    const wantBreather = st.breatherReq || (st.patterns > 0 && st.patterns % cfg.breather.every === 0 && st.lastTier !== 0);
    if (wantBreather && s - st.lastBreatherS > cfg.breather.skipWithin){
      st.breatherReq = false;
      const len = clamp(cfg.breather.sec * sp, cfg.breather.min, cfg.breather.max);
      coinsFill(s, s + len * 0.5);
      coinsFill(s + len * 0.5 + 4, s + len - 4);
      powerIn(s + len * 0.5 - 2, s + len * 0.5 + 6);   // в 4-метровом «окне» между двумя линиями энергонов
      st.lastBreatherS = s; st.lastTier = 0; st.endS = s + len;
      st.nextS = s + len;
      return;
    }
    st.breatherReq = false;

    const tier = pickTier(d, t);
    let sEnd = s;
    const c = cells;
    if (tier === 1){ rowT1(c); emitRow(c, s, 1); coinsForRow(c, s, sp); }
    else if (tier === 2){ rowT2(c); emitRow(c, s, 2); coinsForRow(c, s, sp); }
    else if (tier === 3){
      rowT1(c); if (rng() < 0.5) rowT2(c);
      emitRow(c, s, 3); coinsForRow(c, s, sp);
      sEnd = s + inner();
      rowT1(c); emitRow(c, sEnd, 3); coinsForRow(c, sEnd, sp);
    } else if (tier === 4){
      // стены → валики на всю ширину → стены со сменой полосы
      const A = irnd(3); let B = irnd(3); if (B === A) B = (A + 1 + irnd(2)) % 3;
      wallsExcept(c, A); emitRow(c, s, 4); coinsForRow(c, s, sp);
      const s2 = s + inner();
      c[0] = c[1] = c[2] = JUMP; emitRow(c, s2, 4); coinsForRow(c, s2, sp);
      sEnd = s2 + inner();
      wallsExcept(c, B); emitRow(c, sEnd, 4); coinsForRow(c, sEnd, sp);
    } else {
      // зигзаг стен + гирлянда
      const A = irnd(3); const B = A === 1 ? (rng() < 0.5 ? 0 : 2) : (rng() < 0.5 ? 1 : 2 - A);
      wallsExcept(c, A); emitRow(c, s, 5); coinsForRow(c, s, sp);
      const s2 = s + inner();
      wallsExcept(c, B); emitRow(c, s2, 5); coinsForRow(c, s2, sp);
      sEnd = s2 + inner();
      c[0] = c[1] = c[2] = SLIDE; emitRow(c, sEnd, 5); coinsForRow(c, sEnd, sp);
    }
    st.patterns++; st.lastTier = tier;
    const gapSec = t < 20 ? cfg.gapWarm : lerp(cfg.gap[0], cfg.gap[1], d);
    const gapM = Math.max(cfg.gapMinM, gapSec * sp);
    st.endS = sEnd;
    st.nextS = sEnd + gapM;
    // ускоритель — посреди промежутка; энергоны в промежутке между паттернами (полсекунды отступа от рядов),
    // при ускорителе линия укорачивается до него, чтобы пикап не стоял в ряду энергонов
    const g0 = sEnd + Math.max(6, sp * 0.5), g1 = st.nextS - Math.max(6, sp * 0.5);
    const ps = powerIn(sEnd + 6, st.nextS - 6);
    if (rng() < 0.7) coinsFill(g0, ps > 0 ? Math.min(g1, ps - 3) : g1);
  }

  // ---------- сценарий обучения (GAME-7) ----------
  // шаги: 1 стена в центре → смена полосы; 2 валики на 3 полосах → прыжок; 3 гирлянда → подкат; 4 свободные T1 8 с
  function startTutorial(){
    const v = cfg.tutorial.speed, c = cells;
    // шаги через 2.7 с (2.5 с дороги + ряд), свободный отрезок 6.5 с вместо 8: при худшем случае (игрок ждёт
    // до заморозки) каждое слоу-мо 0.2 съедает ≈4 с реального времени, а обучение обязано уложиться в ≤ 25 с
    const s1 = 32, s2 = s1 + v * 2.7, s3 = s2 + v * 2.7, s4 = s3 + v * 1.2, sEnd = s3 + v * 6.5;
    c[0] = FREE; c[1] = WALL; c[2] = FREE; emitRow(c, s1, 1);
    for (let i = 0; i < 6; i++){ coin(0, NaN, 0.95, s1 - 4 + i * 1.7); coin(2, NaN, 0.95, s1 - 4 + i * 1.7); }
    c[0] = c[1] = c[2] = JUMP; emitRow(c, s2, 1); coinsForRow(c, s2, v);
    c[0] = c[1] = c[2] = SLIDE; emitRow(c, s3, 1);
    for (let i = 0; i < cfg.coinSlide; i++) coin(1, NaN, 0.45, s3 - 2.5 + i);
    c[0] = FREE; c[1] = FREE; c[2] = WALL; emitRow(c, s4 + v * 1.3, 1); coinsForRow(c, s4 + v * 1.3, v);
    c[0] = JUMP; c[1] = FREE; c[2] = FREE; emitRow(c, s4 + v * 3.3, 1); coinsForRow(c, s4 + v * 3.3, v);
    coinsFill(s4 + v * 4.1, sEnd - 4);
    st.tutorial = {
      steps: [
        { n: 1, action: "lane", s: s1, kind: "wall" },
        { n: 2, action: "jump", s: s2, kind: "jump" },
        { n: 3, action: "slide", s: s3, kind: "slide" },
        { n: 4, action: "free", s: s4, kind: "" },
      ],
      endS: sEnd,
    };
    st.nextS = sEnd + 12;
    st.lastBreatherS = sEnd;
  }

  // ---------- API ----------
  function reset({ tutorial = false } = {}){
    for (let i = 0; i < queue.length; i++) pool.push(queue[i]);
    queue.length = 0;
    st.nextS = cfg.firstObstacleS; st.patterns = 0; st.rowId = 0; st.arcId = 0;
    st.lastBreatherS = -1e9; st.breatherReq = false; st.mercyUntilT = -1; st.lastTier = 0; st.endS = 0;
    st.tutorial = null; occN = 0;
    st.nextPowerS = PW.firstS; st.lastPower = -1; st.powerups = 0;
    if (tutorial) startTutorial();
  }

  function update(){
    // генерируем заранее, чтобы весь паттерн был в очереди до того, как его первый ряд дойдёт до спавна
    let guard = 0;
    while (st.nextS - G.dist <= cfg.spawnAhead + 90 && guard++ < 4) genPattern();
    while (queue.length && queue[0].s - G.dist <= cfg.spawnAhead){
      const it = queue.shift();
      const z = G.dist - it.s;
      if (it.type === 1) addObstacle(KIND[it.kind], LANESET[it.a][it.b], z, it.s, it.row, it.tier);
      else if (it.type === 3) addPowerup(PKIND[it.kind], it.a, z, it.s);
      else addCoin(it.a, it.x, it.y, z, it.s, it.arc, it.arcN);
      pool.push(it);
    }
  }

  // милосердие: 3 с после удара новые препятствия не ближе 1.6 с к моменту удара (заспавненные уже
  // перекрыты неуязвимостью graceTime 1.6 с), дальше очередь сдвигается целиком — порядок рядов не ломается
  function onHit(){
    const sp = Math.max(G.speed, cfg.hitSpeedMin);
    const minS = G.dist + cfg.spawnAhead + cfg.mercy.gap * sp;
    let shift = 0;
    for (let i = 0; i < queue.length; i++){
      if (queue[i].type !== 1) continue;
      if (queue[i].s < minS) shift = Math.max(shift, minS - queue[i].s);
      break;
    }
    if (shift > 0){ for (let i = 0; i < queue.length; i++) queue[i].s += shift; st.nextS += shift; st.endS += shift; }
    st.mercyUntilT = G.runT + cfg.mercy.window;
  }

  function requestBreather(){ st.breatherReq = true; }

  return { reset, update, onHit, requestBreather, targetSpeed, difficulty, state: st, queue };
}
