// Раскладка оформления по данным уровня (чистые функции, без three): соседи блоков, глубина, до которой
// фасад обязан быть сплошным, и места для реквизита (фонари, урны, балюстрады). Этим пользуются walls.js
// (геометрия), flowers.js (цветы в урнах), props.js (свет фонарей), cloudbank.js (облака под ярусами) —
// один расчёт на всех, чтобы цветы не висели в воздухе, а облака не резали фасад посреди окна.
//
// «Срез» (cut) блока — высота, ниже которой фасад растворяется в облаках. Правило: фасад сплошной
// везде, где Ризи может его коснуться — до самой низкой «рабочей» высоты рядом (верх соседнего блока,
// платформы, низ лианы, нижняя точка хода лифта в пределах REACH по x) минус запас; и не меньше чем на
// MIN_DEPTH под верхом блока (чтобы под каждым ярусом была видна аркада целиком).
import { makeRng } from "./tex.js";

const REACH = 6.0, MARGIN = 2.0, MIN_DEPTH = 4.3;
const EPS = 1e-3;

export function isColumnKind(s){ return s.kind === "keep" || s.kind === "tower"; }

export function levelIsNight(level){ return !!(level.vines && level.vines.length); }

export function blockLayout(level){
  const S = level.solids;
  // «рабочие» высоты: [x0, x1, y]
  const work = [];
  for (const s of S) if (s.kind !== "tower") work.push([s.x0, s.x1, s.y1, s]);
  for (const o of level.oneways) work.push([o.x0, o.x1, o.y, null]);
  for (const m of level.movers) work.push([m.x0 - (m.ax || 0), m.x1 + (m.ax || 0), m.y - (m.ay || 0), null]);
  for (const v of level.vines || []) work.push([v.x0, v.x1, v.y0, null]);
  const dist = (a0, a1, b0, b1) => a1 < b0 ? b0 - a1 : b1 < a0 ? a0 - b1 : 0;
  return S.map(s => {
    const nL = S.find(o => o !== s && Math.abs(o.x1 - s.x0) < EPS) || null;
    const nR = S.find(o => o !== s && Math.abs(o.x0 - s.x1) < EPS) || null;
    let low = Infinity;
    for (const [a, b, y, src] of work){
      if (src === s) continue;
      if (dist(a, b, s.x0, s.x1) <= REACH) low = Math.min(low, y);
    }
    let cut = s.y1 - MIN_DEPTH;
    if (Number.isFinite(low)) cut = Math.min(cut, low - MARGIN);
    cut = Math.max(cut, s.y0);
    return { s, nL, nR, cut, col: isColumnKind(s) };
  });
}

// места реквизита на задней кромке ярусов: [{ kind: "lamp"|"urn"|"rail", x, x1?, y, block }]
// Не ставим у табличек, флажков-чекпоинтов, Сердца и у краёв, где рядом лиана (там Ризи лезет).
export function decorSpots(level){
  const rnd = makeRng(777);
  const busy = [];
  for (const sg of level.signs) busy.push([sg.x - 1.5, sg.x + 1.5]);
  for (const t of level.torches) busy.push([t.x - 0.9, t.x + 0.9]);
  busy.push([level.heart.x - 3, level.heart.x + 3]);
  const free = (a, b) => !busy.some(([p, q]) => b > p && a < q);
  const out = [];
  const walls = level.solids.filter(s => s.kind === "wall" || !s.kind).sort((a, b) => a.x0 - b.x0);
  walls.forEach((s, bi) => {
    const w = s.x1 - s.x0;
    if (w < 4.5) return;
    const y = s.y1;
    // фонари у краёв широких ярусов и через ~7 ед.
    const lamps = [];
    const inset = 0.75;
    const nL = Math.max(2, Math.round(w / 7) + 1);
    for (let i = 0; i < nL; i++){
      const x = s.x0 + inset + (w - 2 * inset) * (nL === 1 ? 0.5 : i / (nL - 1));
      if (free(x - 0.35, x + 0.35)) lamps.push(x);
    }
    for (const x of lamps) out.push({ kind: "lamp", x, y, block: s });
    // между фонарями — балюстрада (каждый второй ярус) или урны с цветами
    const pts = [s.x0 + 0.3, ...lamps, s.x1 - 0.3].sort((a, b) => a - b);
    for (let i = 0; i < pts.length - 1; i++){
      const a = pts[i] + 0.45, b = pts[i + 1] - 0.45;
      if (b - a < 1.2) continue;
      if ((bi + i) % 2 === 0 && b - a > 2.2){
        // балюстрада — отрезки, свободные от табличек/флажков
        let x = a;
        while (x < b){
          let e = Math.min(b, x + 6);
          if (!free(x, e)){ x += 0.5; continue; }
          if (e - x >= 1.2) out.push({ kind: "rail", x, x1: e, y, block: s });
          x = e + 0.6;
        }
      } else {
        const n = Math.max(1, Math.floor((b - a) / 2.6));
        for (let k = 0; k < n; k++){
          const x = a + (b - a) * (k + 0.5) / n + (rnd() - 0.5) * 0.3;
          if (free(x - 0.45, x + 0.45)) out.push({ kind: "urn", x, y, block: s, big: rnd() < 0.4 });
        }
      }
    }
  });
  return out;
}
