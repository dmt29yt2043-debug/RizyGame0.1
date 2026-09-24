// Проверка проходимости уровня по физическим константам.
// Работает и в node (tools/check.mjs), и в браузере (PLAT.check()).
//
// Шаг 1 — «огибающие»: тем же stepPlayer, что и в игре, в пустом мире прогоняем прыжок с разбега
//   для каждой стратегии (прыжок / двойной / прыжок+рывок / двойной+рывок), перебирая моменты второго
//   прыжка и рывка. Получаем максимальную высоту и дальность приземления на перепад dy.
// Шаг 2 — каждый обязательный переход пути (разрыв gap по x и перепад dy) сравниваем с огибающей
//   сильнейшей стратегии, доступной на участке: запас = дальность/разрыв − 1 и высота/перепад − 1, нужно ≥ 15 %.
// Шаг 3 — «призрак»: тот же прыжок с найденными таймингами в НАСТОЯЩЕЙ геометрии уровня
//   (потолки, стены, узкие цели) — героиня должна встать на целевую платформу.
import { PHYS } from "./config.js";
import { createPlayer, stepPlayer } from "./physics.js";

export const MARGIN = 0.15;
export const STRATS = [
  { id: "jump",  name: "прыжок",          dj: false, dash: false },
  { id: "djump", name: "двойной прыжок",  dj: true,  dash: false },
  { id: "dash",  name: "прыжок + рывок",  dj: false, dash: true  },
  { id: "all",   name: "двойной + рывок", dj: true,  dash: true  },
];
const DT = PHYS.dt;
const EMPTY = { solids: [], plats: [] };

// один полёт: разбег на полной скорости, прыжок в t=0, прыжок зажат; tDj/tDash — моменты (с) или −1.
// init(p, inp) — переопределить старт (по умолчанию — разбег и прыжок с земли); используется для отскока
// с лианы (flyVine ниже), где старт — уже в воздухе с фиксированной скоростью отскока.
function fly(tDj, tDash, world = EMPTY, x0 = 0, y0 = 0, steer = null, maxT = 3, init = null){
  const p = createPlayer(x0, y0);
  const inp = { left: false, right: true, up: false, down: false, jump: true, jumpPressed: true, dashPressed: false };
  if (init) init(p, inp); else { p.vx = PHYS.maxRun; p.grounded = true; }
  const pts = [{ x: p.x, y: p.y, vy: p.vy }];
  const ev = [];
  const n = Math.round(maxT / DT);
  let djDone = false, dashDone = false, dropJump = false;
  for (let i = 1; i <= n; i++){
    const t = i * DT;
    if (steer){ const s = steer(p); inp.left = s < 0; inp.right = s > 0; }
    if (tDj >= 0 && !djDone && t >= tDj){ djDone = true; inp.jump = false; dropJump = true; }
    else if (dropJump){ dropJump = false; inp.jump = true; inp.jumpPressed = true; }
    if (tDash >= 0 && !dashDone && t >= tDash){ dashDone = true; inp.dashPressed = true; }
    ev.length = 0;
    stepPlayer(p, inp, DT, world, ev);
    pts.push({ x: p.x, y: p.y, vy: p.vy, grounded: p.grounded, ground: p.ground });
    if (world !== EMPTY && (p.grounded && i > 3)) break;
    if (p.y < -30) break;
  }
  return { pts, p };
}

// дальность: x в момент, когда траектория НА СПУСКЕ пересекает y = dy (интерполяция); −Inf если не достаёт
function reachOf(pts, dy){
  let best = -Infinity;
  for (let i = 1; i < pts.length; i++){
    const a = pts[i - 1], b = pts[i];
    if (b.vy > 0) continue;
    if (a.y >= dy && b.y < dy){
      const k = (a.y - dy) / Math.max(1e-9, a.y - b.y);
      best = Math.max(best, a.x + (b.x - a.x) * k);
    }
  }
  return best;
}
const apexOf = pts => pts.reduce((m, q) => Math.max(m, q.y), -Infinity);

// огибающие всех стратегий: для каждой — список вариантов таймингов с траекториями
let _env = null;
export function envelopes(){
  if (_env) return _env;
  const tStep = 1 / 60, tMax = 1.3;
  const times = [];
  for (let t = 0.05; t <= tMax; t += tStep) times.push(+t.toFixed(4));
  const out = {};
  for (const s of STRATS){
    const runs = [];
    if (!s.dj && !s.dash) runs.push({ tDj: -1, tDash: -1 });
    if (s.dj && !s.dash) for (const a of times) runs.push({ tDj: a, tDash: -1 });
    if (!s.dj && s.dash) for (const b of times) runs.push({ tDj: -1, tDash: b });
    if (s.dj && s.dash) for (const a of times) for (let j = 0; j < times.length; j += 2) runs.push({ tDj: a, tDash: times[j] });
    for (const r of runs) r.pts = fly(r.tDj, r.tDash).pts;
    out[s.id] = { strat: s, runs, maxH: Math.max(...runs.map(r => apexOf(r.pts))) };
  }
  _env = out;
  return out;
}
// лучшая дальность стратегии на перепад dy и тайминги, которые её дают
export function reach(sid, dy){
  const E = envelopes()[sid];
  let best = -Infinity, arg = null;
  for (const r of E.runs){ const x = reachOf(r.pts, dy); if (x > best){ best = x; arg = r; } }
  return { x: best, tDj: arg ? arg.tDj : -1, tDash: arg ? arg.tDash : -1 };
}

// ---------- лианы (уровень 2): отскок с лианы — отдельная огибающая ----------
// Старт — не разбег, а фиксированная скорость отскока от лианы (PHYS.climbHopX/Y, см. physics.js), плюс
// (опционально) ещё двойной прыжок/рывок в воздухе — на лиане они восстанавливаются, так что комбо законно.
function flyVine(side, tDj, tDash, world = EMPTY, x0 = 0, y0 = 0, steer = null, maxT = 3){
  return fly(tDj, tDash, world, x0, y0, steer, maxT, (p, inp) => {
    p.vx = side * PHYS.climbHopX; p.vy = PHYS.climbHopY;
    p.grounded = false; p.canDouble = true; p.airDash = true; p.facing = side;
    inp.left = side < 0; inp.right = side > 0;
  });
}
let _venv = null;
function vineEnvelopes(){
  if (_venv) return _venv;
  const tStep = 1 / 60, tMax = 1.1;
  const times = []; for (let t = 0.05; t <= tMax; t += tStep) times.push(+t.toFixed(4));
  const mk = side => {
    const runs = [{ tDj: -1, tDash: -1 }];
    for (const a of times) runs.push({ tDj: a, tDash: -1 });
    for (const b of times) runs.push({ tDj: -1, tDash: b });
    for (const a of times) for (let j = 0; j < times.length; j += 3) runs.push({ tDj: a, tDash: times[j] });
    for (const r of runs) r.pts = flyVine(side, r.tDj, r.tDash).pts;
    return { runs, maxH: Math.max(...runs.map(r => apexOf(r.pts))) };
  };
  _venv = { "-1": mk(-1), "1": mk(1) };
  return _venv;
}
function reachVine(side, dy){
  const E = vineEnvelopes()[side];
  let best = -Infinity, arg = null;
  for (const r of E.runs){ const x = reachOf(r.pts, dy); if (x > best){ best = x; arg = r; } }
  return { x: best, tDj: arg ? arg.tDj : -1, tDash: arg ? arg.tDash : -1 };
}

// ---------- переходы пути ----------
// level.path: [{ id, need, via }] — по порядку; need — самая сильная стратегия, доступная на этом участке;
// via:"vine" — переход НАЧИНАЕТСЯ отскоком с предыдущего узла (он обязан быть лианой), не разбегом.
// Узлы — id твёрдых блоков, платформ, движущихся платформ (у движущихся — лучшее положение, игрок ждёт)
// или лиан (level.vines) — top/lowTop/highTop лианы это высота хвата (низ зоны, v.y0); vineTop/side — для via.
function nodeOf(level, id){
  const s = level.solids.find(r => r.id === id);
  if (s) return { id, x0: s.x0, x1: s.x1, top: s.y1, lowTop: s.y1, highTop: s.y1, kind: "solid" };
  const o = level.oneways.find(r => r.id === id);
  if (o) return { id, x0: o.x0, x1: o.x1, top: o.y, lowTop: o.y, highTop: o.y, kind: "oneway" };
  const m = level.movers.find(r => r.id === id);
  if (m){
    const ax = m.ax || 0, ay = m.ay || 0;
    return { id, x0: m.x0, x1: m.x1, top: m.y, lowTop: m.y - Math.abs(ay), highTop: m.y + Math.abs(ay),
      minX0: m.x0 - Math.abs(ax), maxX1: m.x1 + Math.abs(ax), kind: "mover", m };
  }
  const v = (level.vines || []).find(r => r.id === id);
  if (v) return { id, x0: v.x0, x1: v.x1, top: v.y0, lowTop: v.y0, highTop: v.y0, vineTop: v.y1, side: v.side, kind: "vine" };
  throw new Error("нет узла пути " + id);
}

export function checkLevel(level, { ghost = true } = {}){
  const E = envelopes();
  const rows = [];
  let ok = true;
  const order = STRATS.map(s => s.id);
  for (let i = 1; i < level.path.length; i++){
    const step = level.path[i];
    const A = nodeOf(level, level.path[i - 1].id), B = nodeOf(level, step.id);
    const need = step.need || "all";

    // лиана → следующий узел: старт не разбегом, а отскоком с A (A обязана быть лианой) — отдельная
    // огибающая (flyVine/vineEnvelopes выше), без «призрака» в реальной геометрии (см. ограничения).
    if (step.via === "vine"){
      if (A.kind !== "vine") throw new Error(`via:"vine" у перехода в ${B.id}, но ${A.id} не лиана`);
      const side = A.side;
      // отскок уходит в сторону side (от стены): «свой» край лианы — со стороны side, «свой» край B — с
      // противоположной стороны (движение навстречу друг другу через разрыв)
      const aEdge = side > 0 ? A.x1 : A.x0;
      const bEdge = side > 0 ? (B.kind === "mover" ? B.minX0 : B.x0) : (B.kind === "mover" ? B.maxX1 : B.x1);
      const bTop = B.kind === "mover" ? B.lowTop : B.top;
      const gap = +(side > 0 ? bEdge - aEdge : aEdge - bEdge).toFixed(3);
      const dy = +(bTop - A.vineTop).toFixed(3);
      const R = gap > 0 ? reachVine(side, dy) : { x: Infinity };
      const mx = gap > 0 ? R.x / gap - 1 : Infinity;
      const H = vineEnvelopes()[side].maxH;
      const my = dy > 0 ? H / dy - 1 : Infinity;
      const pass = mx >= MARGIN && my >= MARGIN;
      if (!pass) ok = false;
      rows.push({ from: A.id + " (отскок)", to: B.id, gap, dy, need: "лиана→прыжок", kind: gap > 0 ? "разрыв" : "подъём",
        reach: R.x, maxH: H, mx, my, pass, min: "", ghost: "—" });
      continue;
    }

    // движущиеся: лучшее положение (игрок ждёт подъезда)
    const ax1 = A.kind === "mover" ? A.maxX1 : A.x1;
    const bx0 = B.kind === "mover" ? B.minX0 : B.x0;
    const aTop = A.kind === "mover" ? A.highTop : A.top;
    const bTop = B.kind === "mover" ? B.lowTop : B.top;
    const gap = +(bx0 - ax1).toFixed(3);
    const dy = +(bTop - aTop).toFixed(3);
    const row = { from: A.id, to: B.id, gap, dy, need, kind: "", reach: null, maxH: null, mx: null, my: null, pass: true, min: "", ghost: "" };
    if (gap <= 0 && dy <= 0){ row.kind = "спуск/шаг"; row.min = "бег"; rows.push(row); continue; }
    const test = sid => {
      const H = E[sid].maxH;
      const my = dy > 0 ? H / dy - 1 : Infinity;
      const R = gap > 0 ? reach(sid, dy) : { x: Infinity };
      const mx = gap > 0 ? R.x / gap - 1 : Infinity;
      return { H, my, R, mx, pass: my >= MARGIN && mx >= MARGIN };
    };
    const t = test(need);
    row.kind = gap > 0 ? "разрыв" : "подъём";
    row.maxH = t.H; row.my = t.my; row.reach = t.R.x; row.mx = t.mx; row.pass = t.pass;
    // самая слабая стратегия, которой хватает (показывает, чему учит переход)
    for (const sid of order){ if (test(sid).pass){ row.min = sid; break; } }
    if (!row.min) row.min = "—";
    // призрак в настоящей геометрии: лианы пропускаем — «приземление» там физически не «grounded» (хват
    // в воздухе), запас по dy/gap уже проверен выше тем же кодом полёта, что и у обычных прыжков
    if (ghost && t.pass && B.kind !== "vine" && A.kind !== "vine") row.ghost = ghostRun(level, A, B, need, dy, gap);
    if (!t.pass || row.ghost === "FAIL") ok = false;
    rows.push(row);
  }
  return { ok, rows, env: Object.fromEntries(STRATS.map(s => [s.id, { maxH: E[s.id].maxH, flat: reach(s.id, 0).x }])) };
}

// «призрак»: разгон и прыжок у края A на тех же таймингах, что дают дальность; рулим к центру цели
function ghostRun(level, A, B, sid, dy, gap){
  const world = ghostWorld(level, A, B);
  const R = reach(sid, dy);
  const s = STRATS.find(q => q.id === sid);
  const bTop = B.kind === "mover" ? B.lowTop : B.top;
  const bx0 = B.kind === "mover" ? B.minX0 : B.x0;
  const bx1 = B.kind === "mover" ? B.minX0 + (B.x1 - B.x0) : B.x1;
  const aTop = A.kind === "mover" ? A.highTop : A.top;
  const ax1 = A.kind === "mover" ? A.maxX1 : A.x1;
  // подъём без разрыва — прыгаем из-под стены, с разрывом — с самого края
  const x0 = gap > 0 ? ax1 - 0.02 : Math.max(bx0 - 1.2, (A.kind === "mover" ? A.maxX1 - (A.x1 - A.x0) : A.x0) + 0.4);
  const cx = (bx0 + bx1) * 0.5;
  const steer = p => (p.x < bx0 + Math.min(0.9, (bx1 - bx0) * 0.4) ? 1 : (p.x < cx - 0.2 ? 1 : (p.x > cx + 0.2 ? -1 : 0)));
  // перебираем тайминги, начиная с «дальнобойных»; хватит одного удачного
  const tries = [];
  if (s.dj || s.dash) tries.push([R.tDj, R.tDash]);
  if (!s.dj && !s.dash) tries.push([-1, -1]);
  if (s.dj && !s.dash) for (let t = 0.25; t <= 0.9; t += 0.05) tries.push([t, -1]);
  if (s.dash && !s.dj) for (let t = 0.2; t <= 0.8; t += 0.05) tries.push([-1, t]);
  if (s.dj && s.dash) for (let a = 0.25; a <= 0.9; a += 0.1) for (let b = 0.2; b <= 1.0; b += 0.1) tries.push([a, b]);
  for (const [tDj, tDash] of tries){
    const { p } = fly(tDj, tDash, world, x0, aTop, steer, 4);
    if (p.grounded && Math.abs(p.y - bTop) < 0.01 && p.x >= bx0 - 0.4 && p.x <= bx1 + 0.4) return "OK";
  }
  return "FAIL";
}

// геометрия для призрака: все твёрдые блоки и платформы; движущиеся «замораживаем» в лучшем положении
function ghostWorld(level, A, B){
  const solids = level.solids.map(r => ({ x0: r.x0, x1: r.x1, y0: r.y0, y1: r.y1 }));
  const plats = level.oneways.map(r => ({ x0: r.x0, x1: r.x1, y: r.y, dx: 0, dy: 0 }));
  for (const m of level.movers){
    let ox = 0, oy = 0;
    if (m.id === B.id){ ox = -Math.abs(m.ax || 0); oy = -Math.abs(m.ay || 0); }
    if (m.id === A.id){ ox = Math.abs(m.ax || 0); oy = Math.abs(m.ay || 0); }
    plats.push({ x0: m.x0 + ox, x1: m.x1 + ox, y: m.y + oy, dx: 0, dy: 0 });
  }
  return { solids, plats };
}

// текстовый отчёт
export function formatReport(res){
  const f = (v, d = 2) => (v === null || v === undefined) ? "  —  " : (Number.isFinite(v) ? v.toFixed(d) : "∞");
  const pct = v => (v === null || v === undefined) ? "   —  " : (Number.isFinite(v) ? ((v * 100).toFixed(0) + "%").padStart(6) : "     ∞");
  const L = [];
  L.push("Огибающие (тем же кодом физики, разбег 7 ед/с, прыжок зажат):");
  for (const s of STRATS) L.push(`  ${s.name.padEnd(16)} высота ${f(res.env[s.id].maxH)}  дальность по ровному ${f(res.env[s.id].flat)}`);
  L.push("");
  L.push("переход              тип        разрыв    dy  стратегия участка  дальн.  запас_x  высота  запас_y  минимум  призрак  итог");
  for (const r of res.rows){
    L.push(`${(r.from + " → " + r.to).padEnd(21)} ${r.kind.padEnd(10)} ${f(Math.max(0, r.gap)).padStart(6)} ${f(r.dy).padStart(5)}  ${r.need.padEnd(17)} ${f(r.reach).padStart(6)} ${pct(r.mx)} ${f(r.maxH).padStart(6)} ${pct(r.my)}  ${String(r.min).padEnd(7)}  ${String(r.ghost || "—").padEnd(7)}  ${r.pass && r.ghost !== "FAIL" ? "OK" : "FAIL"}`);
  }
  const n = res.rows.filter(r => r.kind !== "спуск/шаг").length;
  const worst = res.rows.filter(r => r.kind !== "спуск/шаг").reduce((m, r) => Math.min(m, Math.min(r.mx ?? Infinity, r.my ?? Infinity)), Infinity);
  L.push("");
  L.push(`Итог: ${res.ok ? "ПРОХОДИМ" : "НЕ ПРОХОДИМ"} — переходов с прыжком ${n}, минимальный запас ${(worst * 100).toFixed(0)}% (порог ${MARGIN * 100}%).`);
  return L.join("\n");
}
