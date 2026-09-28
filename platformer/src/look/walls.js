// Игровая архитектура «Идеалити» — то, по чему бежит Ризи (язык форм — концепт владельца dev/ref/play-tiers.png):
//   • ЯРУС (solid kind "wall"): толстая мраморная плита — полированный пол с золотой инкрустацией, скруглённая
//     кромка-«подушка», мощный золотой пояс с орнаментом, выкружка сатинового золота и золотой валик; карниз заворачивает
//     за угол там, где сосед ниже или пропасть. Под ним — аркада в духе задников: фриз с золотыми заклёпками,
//     арки на колоннах с золотыми капителями, в глубине лоджии — арочные окна (днём тёплое стекло, ночью свет).
//     Высокие фасады (уровень 2) продолжаются этажами с пилястрами и окнами; ниже «среза» (layout.js) —
//     облака (cloudbank.js), а не бетон до низа экрана.
//   • КОЛОННА (kind "keep"): каннелированный цилиндр из мрамора с золотыми кольцами, капитель-чаша и круглый
//     диск-ярус с золотым ободом сверху; флажок на древке.
//   • БАШНЯ (kind "tower", края уровня): большая колонна с рядами окон в золотых кольцах, венчающим карнизом,
//     куполом с золотыми рёбрами, фонариком и шпилем.
//   • ПЛАТФОРМЫ (oneways) и движущиеся (movers): парящие диски — мрамор, золотой обод, хромовая чаша с
//     золотыми рёбрами и навершием (движущиеся — ещё фиолетовое свечение снизу).
//   • Реквизит на задней кромке ярусов (layout.js decorSpots): фонари на золотых столбиках, урны, балюстрады.
// Коллизии не меняются: силуэт каждой грани, которой Ризи может коснуться, совпадает с AABB блока (плоскость
// игры z = 0): бока ярусов — сплошные торцы/пилоны, колонны — эллипс с полуосью ровно w/2 по x.
// Ночью заклёпки фриза становятся гирляндой тёплых огоньков, окна аркад и фонари светятся (стекло с emissive).
// Draw calls: мрамор (+ фасад, если он нарисованный), пол, золото, хром, стекло, декор (6–7) + 4 инстанс-меша
// движущихся дисков. q=low — меньше сегментов и без отдельных балясин (DET), материалы без лака (matlib lite).
import * as THREE from "three";
import { PAL } from "../config.js";
import { Batch, proto } from "./geo.js";
import { makeRng } from "./tex.js";
import { buildLandmarks } from "./landmarks.js";
import {
  V, HP, arc, cove, smoothNormals, profileVy, tierFrames, sweep, fillXZ, lathe, ellipseCap, archPanel, archPanelF,
  spandrel, archSweep, mat, setDetail, protoSphere, protoSphereLo, protoBox, protoCyl, protoBell, protoBaluster, protoUrn, protoLampGlass, P,
} from "./arch.js";
import { createArchMaterials, loadPainted, ORN_U, GOLD_PLAIN_UV } from "./matlib.js";
import { blockLayout, decorSpots, levelIsNight } from "./layout.js";

export const ZF = 1.0;      // лицевая плоскость фасадов (перед плоскостью игры z = 0)
export const ZB = -1.15;    // задняя кромка пола ярусов
// сечение карниза яруса (y — вниз от верха, o — вынос от лицевой плоскости): подушка до TIER.front, золотой
// пояс goldTop…goldBot, золотая выкружка и валик до faceTop, фриз до friezeBot
export const TIER = { c0: 0.26, front: 0.45, goldTop: -0.30, goldBot: -0.67, faceTop: -1.08, friezeBot: -1.40 };
export const CAP = { front: TIER.front, bottom: TIER.faceTop };          // старые имена (life.js/flowers.js)
// диски: полуось по z, глубина чаши у статичных и движущихся
export const DISC = { rz: 0.95, bowl: 0.85, bowlMover: 0.55 };
// цвет дымки внизу фасадов (под цвет облаков задника у нижнего края кадра)
export const HAZE = { day: 0xe7bcc3, night: 0x6d66aa };
// места реквизита (одни и те же для walls/flowers/life)
export const LAMP = { z: -0.85, h: 1.95 };
export const URN = { z: -0.78 };
export const RAIL = { z: -0.98, h: 0.68 };

const GOLD = 0xf0bf4e, GOLD_SHADE = 0xd79f40, CHROME = 0xc9cdd8;   // хром чуть темнее — отражения читаются металлом
const PLAIN = GOLD_PLAIN_UV;
const SINK = 1.5;                          // на сколько фасады/стволы уходят под срез (в плотное облако)
const BULB = new THREE.Color(1.0, 0.78, 0.5).multiplyScalar(1.25);   // ночные огоньки по фризу
const muv = (x, y) => [x / 3, y / 3];
const _c1 = new THREE.Color(), _c2 = new THREE.Color();
const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
const sstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// четырёхугольник с вертикальным градиентом цвета (низ → верх) и явной нормалью
function gradQuad(b, a, bb, c, d, n, uv, colBot, colTop){
  _c1.set(colBot); _c2.set(colTop);
  const P4 = [a, bb, c, d], cs = [_c1, _c1, _c2, _c2];
  for (const tri of [[0, 1, 2], [0, 2, 3]]){
    for (const k of tri){
      const p = P4[k], t = uv(p);
      b.vert(p.x, p.y, p.z, n.x, n.y, n.z, t[0], t[1], cs[k].r, cs[k].g, cs[k].b);
    }
  }
}
// золотая деталь с гладким uv
function goldP(B, pr, m, color = GOLD){ B.gold.addProto(pr, m, color, PLAIN); }
function goldBox(B, x0, y0, z0, x1, y1, z1, color = GOLD){ goldP(B, protoBox(), mat((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, x1 - x0, y1 - y0, z1 - z0), color); }
function marbleBox(b, x0, y0, z0, x1, y1, z1, color = 0xffffff){
  b.addProto(protoBox(), mat((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, x1 - x0, y1 - y0, z1 - z0), color, (x, y, z) => [(x + z) / 3, y / 3]);
}
// тор нужного радиуса и толщины (кэш по размерам) — кольца, арки окон
let DET = 1;                                // детализация (buildWalls: q=low → 0.55)
function torusP(r, tube, arcA = Math.PI * 2, seg = 16){
  seg = Math.max(6, Math.round(seg * DET));
  const key = `tor${r.toFixed(3)}|${tube.toFixed(3)}|${arcA.toFixed(3)}|${seg}`;
  return P(key, () => new THREE.TorusGeometry(r, tube, 6, seg, arcA));
}

// ---------- сечения ----------
function tierProfiles(){
  const cushion = arc(TIER.c0, -0.15, 0.19, 0.15, HP, -HP, 10);
  cushion.forEach(p => { p.v = p.y / 3; });
  const band = [];
  for (let i = 0; i <= 6; i++){ const t = i / 6; band.push({ o: 0.322 + 0.016 * Math.sin(Math.PI * t), y: -0.372 - 0.226 * t }); }
  smoothNormals(band);
  const gold = [...arc(0.336, -0.336, 0.036, 0.036, HP, -HP * 0.6, 4), ...band, ...arc(0.336, -0.634, 0.036, 0.036, HP * 0.6, -HP, 4)];
  profileVy(gold, -0.30, 0.86, -0.67, 0.0);
  const coveP = cove(0.33, -1.02, 0.30, 0.35, HP, Math.PI, 8).map(p => ({ ...p, v: PLAIN[1] }));
  const astr = arc(0.03, -1.05, 0.03, 0.03, HP, -HP, 4).map(p => ({ ...p, v: PLAIN[1] }));
  const frieze = [{ o: 0.035, y: TIER.faceTop, no: 0.2, ny: 1, v: TIER.faceTop / 3 }, { o: 0.035, y: TIER.faceTop - 0.01, no: 1, ny: 0, v: TIER.faceTop / 3 },
    { o: 0.035, y: TIER.friezeBot + 0.02, no: 1, ny: 0, v: TIER.friezeBot / 3 }, { o: 0.0, y: TIER.friezeBot, no: 0.3, ny: -1, v: TIER.friezeBot / 3 }];
  return { cushion, gold, cove: coveP, astr, frieze };
}
const TP = tierProfiles();

// ================= ЯРУС =================
function tier(B, info, night, rnd){
  const { s, nL, nR, cut } = info;
  const eps = 1e-3, y1 = s.y1, xa = s.x0, xb = s.x1;
  const retL = !nL || nL.y1 < y1 - eps, retR = !nR || nR.y1 < y1 - eps;
  // возврат карниза рядом с НИЖНИМ соседом почти не выступает (Ризи стоит там вплотную к ступени)
  const kxL = nL ? 0.12 : 0.42, kxR = nR ? 0.12 : 0.42;
  const F = tierFrames(xa, xb, ZF, ZB, retL, retR, { kxL, kxR, uScale: ORN_U });
  sweep(B.marble, TP.cushion, F, y1, 0xffffff);
  sweep(B.gold, TP.gold, F, y1, GOLD);
  sweep(B.gold, TP.cove, F, y1, GOLD_SHADE);          // выкружка — сатиновое золото (как «чаши» под ярусами концепта)
  sweep(B.gold, TP.astr, F, y1, GOLD);
  sweep(B.marble, TP.frieze, F, y1, 0xe2d6ca);          // фриз в тени карниза — темнее подушки: глубина под ярусом
  // пол: скруглённые передние углы по линии начала подушки
  const pts = F.map(f => [f.x + TIER.c0 * f.ox, f.z + TIER.c0 * f.oz]);
  if (!retL) pts.unshift([xa, ZB]);
  if (!retR) pts.push([xb, ZB]);
  const zFront = ZF + TIER.c0;
  fillXZ(B.floor, pts, y1, 0xffffff, B.floorPainted ? (x, z) => [x / 2, z / 2] : (x, z) => [x / 2, (z - ZB) / (zFront - ZB)]);
  // золотые заклёпки по фризу; ночью это гирлянда тёплых огоньков (стекло со свечением, как окна)
  const yS = y1 - 1.24;
  for (let x = xa + 0.35; x < xb - 0.3; x += 0.62){
    if (night) B.glass.addProto(protoSphereLo(), mat(x, yS, ZF + 0.05, 0.05, 0.05, 0.035), BULB, [0.25, 0.4]);
    else goldP(B, protoSphereLo(), mat(x, yS, ZF + 0.05, 0.045, 0.045, 0.03));
  }

  // фасад: дымка растёт книзу к срезу (облака дальше — cloudbank.js)
  const yTop = y1 + TIER.friezeBot;
  B.setHaze((x, y) => 0.5 * sstep(y1 - 1.6, cut, y));
  let yb = arcadeStorey(B, info, yTop, night, rnd);
  const lines = [yb];
  // фасад уходит ниже среза — его нижний край всегда внутри плотной части облака (cloudbank.js)
  while (yb > cut - SINK){
    const h = Math.min(2.7, Math.max(1.8, yb - (cut - SINK)));
    plainStorey(B, info, yb, yb - h, night, rnd);
    yb -= h;
    lines.push(yb);
  }
  const yLow = Math.min(yb, cut);
  // торцы: где сосед ниже — до его верха, где пропасть — до среза
  for (const side of [-1, 1]){
    const n = side < 0 ? nL : nR, x = side < 0 ? xa : xb;
    if (n && n.y1 >= y1 - eps) continue;
    const from = n ? Math.max(yLow, n.y1) : yLow, to = yTop;
    if (to - from < 0.02) continue;
    const za = side < 0 ? ZB : ZF, zb2 = side < 0 ? ZF : ZB;
    gradQuad(B.marble, V(x, from, za), V(x, from, zb2), V(x, to, zb2), V(x, to, za), V(side, 0, 0), p => [p.z / 3, p.y / 3], 0xe6dccf, 0xf4ece2);
    // торец в перспективе виден полосой: пилястра на заднем углу и золотые пояса этажей, заворачивающие с фасада
    const xo = x + side * 0.05;
    marbleBox(B.marble, Math.min(x, xo), from, ZB, Math.max(x, xo), to, ZB + 0.32, 0xfbf6ef);
    for (const yl of lines) if (yl > from + 0.05 && yl < to - 0.05) goldBox(B, Math.min(x, x + side * 0.07), yl - 0.075, ZB, Math.max(x, x + side * 0.07), yl - 0.015, ZF + 0.075);
  }
  B.setHaze(null);
}

// аркада: арки на колоннах, лоджия с окнами в глубине; возвращает y низа этажа
function arcadeStorey(B, info, yTop, night, rnd){
  const { s, nL, nR } = info;
  const xa = s.x0, xb = s.x1, w = xb - xa;
  const pw = 0.46, D = 0.62, zb = ZF - D;
  const span = w - 2 * pw;
  const nb = Math.max(1, Math.round(span / 2.1));
  const bay = span / nb;
  const R = Math.max(0.42, bay / 2 - 0.2);
  const yCrown = yTop - 0.16, ys = yCrown - R;
  const colH = 1.72, yb = ys - colH, yBot = yb - 0.24;
  const aoBack = night ? 0xa29cb6 : 0xbba493, aoTop = night ? 0x7d7796 : 0x94796a;
  const openL = xa + pw + bay / 2 - R, openR = xb - pw - bay / 2 + R;
  // пилоны по краям (ниже пяты арок) + их внутренние щёки
  const zN = V(0, 0, 1);
  gradQuad(B.marble, V(xa, yBot, ZF), V(openL, yBot, ZF), V(openL, ys, ZF), V(xa, ys, ZF), zN, p => muv(p.x, p.y), 0xf0e6da, 0xffffff);
  gradQuad(B.marble, V(openR, yBot, ZF), V(xb, yBot, ZF), V(xb, ys, ZF), V(openR, ys, ZF), zN, p => muv(p.x, p.y), 0xf0e6da, 0xffffff);
  gradQuad(B.marble, V(openL, yb, ZF), V(openL, yb, zb), V(openL, ys, zb), V(openL, ys, ZF), V(1, 0, 0), p => [p.z / 3, p.y / 3], aoBack, 0xe8dccf);
  gradQuad(B.marble, V(openR, yb, zb), V(openR, yb, ZF), V(openR, ys, ZF), V(openR, ys, zb), V(-1, 0, 0), p => [p.z / 3, p.y / 3], aoBack, 0xe8dccf);
  // пилястры-накладки на пилонах с золотой капителью
  for (const px of [xa + pw * 0.5, xb - pw * 0.5]){
    marbleBox(B.marble, px - 0.15, yBot, ZF, px + 0.15, ys - 0.12, ZF + 0.06, 0xfaf4ec);
    goldBox(B, px - 0.19, ys - 0.14, ZF, px + 0.19, ys - 0.04, ZF + 0.1);
  }
  const winLit = () => night ? (rnd() < 0.78 ? 1 : 0.28) : 1;
  for (let i = 0; i < nb; i++){
    const xc = xa + pw + (i + 0.5) * bay;
    const xl = i === 0 ? xa : xc - bay / 2, xr = i === nb - 1 ? xb : xc + bay / 2;
    spandrel(B.marble, xl, xr, ys, yTop, xc, R, ZF, 0xf4ece3, muv);
    // архивольт: мраморный валик вокруг арки, золотая бусина по внутренней кромке, замковый камень
    archSweep(B.marble, xc, ys, ZF, R, [
      { r: 0, z: 0, nr: -1, nz: 0, v: 0 }, { r: 0, z: 0.05, nr: -0.6, nz: 0.8, v: 0.02 }, { r: 0.05, z: 0.075, nr: 0, nz: 1, v: 0.04 },
      { r: 0.11, z: 0.068, nr: 0.4, nz: 0.9, v: 0.06 }, { r: 0.16, z: 0.0, nr: 0.9, nz: 0.4, v: 0.08 }], 14, 0xfffaf2, 3);
    archSweep(B.gold, xc, ys, ZF + 0.035, R - 0.012, [
      { r: -0.03, z: 0, nr: -1, nz: 0, v: PLAIN[1] }, { r: -0.012, z: 0.03, nr: -0.3, nz: 1, v: PLAIN[1] }, { r: 0.02, z: 0.02, nr: 0.8, nz: 0.6, v: PLAIN[1] }], 14, GOLD);
    goldP(B, protoBox(), mat(xc, yCrown + 0.02, ZF + 0.07, 0.15, 0.22, 0.08));
    goldP(B, protoSphereLo(), mat(xc, yCrown - 0.12, ZF + 0.1, 0.06, 0.06, 0.05));
    // свод (внутренняя поверхность арки) и задняя стена лоджии
    archSweep(B.marble, xc, ys, ZF, R, [{ r: 0, z: 0, nr: -1, nz: 0, v: 0 }, { r: 0, z: -D, nr: -1, nz: 0, v: D / 3 }], 12, aoBack);
    gradQuad(B.marble, V(xc - R - 0.24, yb, zb), V(xc + R + 0.24, yb, zb), V(xc + R + 0.24, ys + R, zb), V(xc - R - 0.24, ys + R, zb), zN, p => muv(p.x, p.y), aoBack, aoTop);
    // арочное окно в глубине (+ золотая рама)
    const ww = Math.min(0.98, R * 1.12), wy0 = yb + 0.42, wh = ys + R * 0.66 - wy0;
    const lit = winLit();
    archPanel(B.glass, xc, wy0, ww, wh, zb + 0.012, new THREE.Color().setScalar(lit));
    const fr = 0.035, zf2 = zb + 0.03;
    goldBox(B, xc - ww / 2 - fr, wy0, zf2 - 0.015, xc - ww / 2 + fr * 0.4, wy0 + wh - ww / 2, zf2 + 0.02);
    goldBox(B, xc + ww / 2 - fr * 0.4, wy0, zf2 - 0.015, xc + ww / 2 + fr, wy0 + wh - ww / 2, zf2 + 0.02);
    goldP(B, torusP(ww / 2 + 0.005, fr, Math.PI, 12), mat(xc, wy0 + wh - ww / 2, zf2));
    goldBox(B, xc - ww / 2 - 0.08, wy0 - 0.06, zb, xc + ww / 2 + 0.08, wy0, zf2 + 0.05);
    // парапет между колоннами + пол лоджии
    marbleBox(B.marble, xc - R - 0.02, yb, ZF - 0.16, xc + R + 0.02, yb + 0.3, ZF, 0xf6eee4);
    goldBox(B, xc - R, yb + 0.3, ZF - 0.08, xc + R, yb + 0.33, ZF + 0.005);
    gradQuad(B.marble, V(xc - R, yb, zb), V(xc + R, yb, zb), V(xc + R, yb, ZF - 0.16), V(xc - R, yb, ZF - 0.16), V(0, 1, 0), p => [p.x / 3, p.z / 3], aoBack, aoBack);
    // колонна справа от пролёта (кроме последнего — там пилон)
    if (i < nb - 1) column(B, xc + bay / 2, yb, ys, ZF - 0.19, 0.16);
  }
  // пояс-карниз этажа: золотой поясок и мраморная тяга, заворачивают на открытые торцы
  const eL = !nL || nL.y1 < s.y1 ? 0.06 : 0, eR = !nR || nR.y1 < s.y1 ? 0.06 : 0;
  goldBox(B, xa - eL, yb - 0.075, ZF - 0.02, xb + eR, yb - 0.015, ZF + 0.075);
  marbleBox(B.marble, xa - eL, yBot, ZF - 0.02, xb + eR, yb - 0.075, ZF + 0.05, 0xf8f1e8);
  return yBot;
}

// колонна аркады: плинт, золотая база, каннелированный ствол, золотая капитель-колокол, абака
function column(B, x, yb, ys, zc, r){
  marbleBox(B.marble, x - 0.21, yb, zc - 0.21, x + 0.21, yb + 0.13, zc + 0.21, 0xf6eee4);
  goldP(B, torusP(r + 0.025, 0.035, Math.PI * 2, 16), mat(x, yb + 0.17, zc, 1, 1, 1, HP));
  const y0 = yb + 0.2, y1 = ys - 0.3;
  lathe(B.marble, [{ o: 1, y: y1 - y0, no: 1, ny: 0, flute: true, v: (y1 - y0) / 3 }, { o: 1, y: 0, no: 1, ny: 0, flute: true, v: 0 }],
    { cx: x, cz: zc, y0, sx: r * 0.92, sz: r * 0.92, seg: 16, a0: -0.7, a1: Math.PI + 0.7, flute: { n: 12, amp: 0.45 }, color: 0xffffff });
  goldP(B, protoBell(), mat(x, ys - 0.3, zc, r * 0.95, 0.22, r * 0.95));
  marbleBox(B.marble, x - 0.25, ys - 0.07, zc - 0.22, x + 0.25, ys, zc + 0.22, 0xfbf6ef);
}

// этаж ниже аркады: стена с пилястрами и арочными окнами (или нарисованный фасад, если он есть)
function plainStorey(B, info, yTop, yBot, night, rnd){
  const { s } = info;
  const xa = s.x0, xb = s.x1, w = xb - xa, h = yTop - yBot;
  const zN = V(0, 0, 1);
  if (B.facadePainted){
    const u = x => x / Math.max(1.5, h);
    gradQuad(B.facade, V(xa, yBot, ZF), V(xb, yBot, ZF), V(xb, yTop, ZF), V(xa, yTop, ZF), zN, p => [u(p.x), (p.y - yBot) / h], 0xffffff, 0xffffff);
  } else {
    gradQuad(B.marble, V(xa, yBot, ZF), V(xb, yBot, ZF), V(xb, yTop, ZF), V(xa, yTop, ZF), zN, p => muv(p.x, p.y), 0xefe5d9, 0xfaf5ee);
    const nb = Math.max(1, Math.round((w - 0.6) / 2.1)), bay = (w - 0.6) / nb;
    for (let i = 0; i <= nb; i++){
      const px = xa + 0.3 + i * bay;
      marbleBox(B.marble, px - 0.14, yBot, ZF, px + 0.14, yTop - 0.2, ZF + 0.07, 0xfbf6ef);
      goldBox(B, px - 0.18, yTop - 0.26, ZF, px + 0.18, yTop - 0.18, ZF + 0.1);
    }
    for (let i = 0; i < nb; i++){
      const xc = xa + 0.3 + (i + 0.5) * bay, ww = Math.min(0.8, bay * 0.42), wy0 = yBot + 0.45, wh = Math.min(1.6, h - 0.95);
      if (wh < 0.8) continue;
      const lit = night ? (rnd() < 0.7 ? 1 : 0.25) : 0.92;
      archPanel(B.glass, xc, wy0, ww, wh, ZF + 0.012, new THREE.Color().setScalar(lit));
      goldBox(B, xc - ww / 2 - 0.04, wy0, ZF, xc - ww / 2 + 0.01, wy0 + wh - ww / 2, ZF + 0.05);
      goldBox(B, xc + ww / 2 - 0.01, wy0, ZF, xc + ww / 2 + 0.04, wy0 + wh - ww / 2, ZF + 0.05);
      goldP(B, torusP(ww / 2 + 0.01, 0.03, Math.PI, 12), mat(xc, wy0 + wh - ww / 2, ZF + 0.03));
      goldBox(B, xc - ww / 2 - 0.08, wy0 - 0.07, ZF, xc + ww / 2 + 0.08, wy0, ZF + 0.08);
    }
  }
  goldBox(B, xa, yBot + 0.02, ZF - 0.02, xb, yBot + 0.08, ZF + 0.06);
}

// ================= КОЛОННА (keep) и БАШНЯ (tower) =================
function discTopProfiles(R0){
  const cushion = arc(R0 - 0.16, -0.14, 0.16, 0.14, HP, -HP, 8).map(p => ({ ...p, v: p.y / 3 }));
  const band = [];
  for (let i = 0; i <= 5; i++){ const t = i / 5; band.push({ o: R0 - 0.1 + 0.014 * Math.sin(Math.PI * t), y: -0.33 - 0.2 * t }); }
  smoothNormals(band);
  const gold = [...arc(R0 - 0.085, -0.3, 0.032, 0.032, HP, -HP * 0.6, 4), ...band, ...arc(R0 - 0.085, -0.56, 0.032, 0.032, HP * 0.6, -HP, 4)];
  profileVy(gold, -0.268, 0.86, -0.592, 0.0);
  return { cushion, gold };
}

function keepColumn(B, info, night, rnd){
  const { s, cut } = info;
  const cx = (s.x0 + s.x1) / 2, rx = (s.x1 - s.x0) / 2, y1 = s.y1;
  const rz = rx <= 1 ? rx : Math.min(1.45, rx * 0.5);
  // диск-ярус сверху
  const rxd = rx + 0.14, rzd = rz + 0.32, R0 = rzd, sx = rxd / rzd;
  const dp = discTopProfiles(R0);
  const seg = rx > 1.5 ? 56 : 36;
  lathe(B.marble, dp.cushion, { cx, cz: 0, y0: y1, sx, sz: 1, seg, color: 0xffffff });
  ellipseCap(B.marble, cx, 0, y1, (R0 - 0.16) * sx, R0 - 0.16, seg, 1, 0xffffff, (x, z) => [x / 3, z / 3]);
  const ri = (R0 - 0.16) * 0.72;
  lathe(B.gold, [{ o: ri + 0.035, y: 0.004, no: 0, ny: 1, v: PLAIN[1] }, { o: ri - 0.035, y: 0.004, no: 0, ny: 1, v: PLAIN[1] }], { cx, cz: 0, y0: y1, sx, sz: 1, seg, color: GOLD });
  lathe(B.gold, dp.gold, { cx, cz: 0, y0: y1, sx, sz: 1, seg, color: GOLD, uLen: ORN_U, oRef: R0 });
  // хромовая чаша-выкружка к стволу
  const rEnd = rz * 0.97, bowlH = rx > 1.5 ? 0.75 : 0.55;
  lathe(B.chrome, cove(R0 - 0.1, -0.6 - bowlH, R0 - 0.1 - rEnd, bowlH, HP, Math.PI, 8), { cx, cz: 0, y0: y1, sx, sz: 1, seg, color: CHROME });
  // золотая капитель: валик + поясок
  const yCap = y1 - 0.6 - bowlH;
  const ringAt = (y, t = 0.06) => lathe(B.gold, arc(rx, 0, t, t * 1.15, HP, -HP, 6).map(p => ({ ...p, v: PLAIN[1] })), { cx, cz: 0, y0: y, sx: 1, sz: rz / rx, seg, color: GOLD });
  ringAt(yCap - 0.04, 0.07); ringAt(yCap - 0.24, 0.045);
  // ствол с каннелюрами (передние ~250°), ряды по высоте — ради плавной дымки
  const perim = 2 * Math.PI * Math.sqrt((rx * rx + rz * rz) / 2);
  const nFl = Math.max(10, Math.round(perim / 0.24));
  const yTopShaft = yCap - 0.1, rows = [];
  for (let y = yTopShaft; y > cut - SINK; y -= 1.6) rows.push(y);
  rows.push(cut - SINK);
  const shaft = rows.map(y => ({ o: 1, y: y - yTopShaft, no: 1, ny: 0, flute: true, v: y / 3 }));
  B.setHaze((x, y) => 0.5 * sstep(y1 - 1.6, cut, y));
  lathe(B.marble, shaft, { cx, cz: 0, y0: yTopShaft, sx: rx, sz: rz, seg: Math.min(140, Math.round(nFl * 1.6)), a0: -0.6, a1: Math.PI + 0.6, flute: { n: nFl, amp: 0.75 }, color: 0xffffff });
  for (let y = yCap - 3.2; y > cut + 0.5; y -= 3.0) ringAt(y, 0.05);
  // окна на широких колоннах (башни-«крепости» уровня 1)
  if (rx > 1.5){
    for (let y = yCap - 2.9; y > cut + 1.2; y -= 3.0){
      for (const a of [Math.PI * 0.32, Math.PI * 0.5, Math.PI * 0.68]){
        const N = V(Math.cos(a) / rx, 0, Math.sin(a) / rz).normalize(), Rv = V(N.z, 0, -N.x);
        const O = V(cx + (rx + 0.012) * Math.cos(a), y, (rz + 0.012) * Math.sin(a));
        archPanelF(B.glass, O, Rv, N, 0.6, 1.25, new THREE.Color().setScalar(night ? (rnd() < 0.8 ? 1 : 0.3) : 0.95));
        goldP(B, torusP(0.32, 0.03, Math.PI, 10), new THREE.Matrix4().makeBasis(Rv, V(0, 1, 0), N).setPosition(O.clone().addScaledVector(V(0, 1, 0), 1.25 - 0.3).addScaledVector(N, 0.02)));
      }
    }
  }
  B.setHaze(null);
  pennant(B.deco, B, cx, y1, 1.7, Math.abs(Math.round(s.x0)));
}

function towerBody(B, info, night, rnd){
  const { s, cut } = info;
  const cx = (s.x0 + s.x1) / 2, rx = (s.x1 - s.x0) / 2, rz = Math.min(2.1, rx * 0.84), y1 = s.y1;
  const seg = 72;
  const perim = 2 * Math.PI * Math.sqrt((rx * rx + rz * rz) / 2), nFl = Math.round(perim / 0.3);
  const yTopShaft = y1 - 1.1;
  const rows = [];
  for (let y = yTopShaft; y > cut - SINK; y -= 1.6) rows.push(y);
  rows.push(cut - SINK);
  B.setHaze((x, y) => 0.5 * sstep(y1 - 3, cut, y));
  lathe(B.marble, rows.map(y => ({ o: 1, y: y - yTopShaft, no: 1, ny: 0, flute: true, v: y / 3 })),
    { cx, cz: 0, y0: yTopShaft, sx: rx, sz: rz, seg: 110, a0: -0.7, a1: Math.PI + 0.7, flute: { n: nFl, amp: 0.65 }, color: 0xffffff });
  const ringAt = (y, t) => lathe(B.gold, arc(rx, 0, t, t * 1.15, HP, -HP, 6).map(p => ({ ...p, v: PLAIN[1] })), { cx, cz: 0, y0: y, sx: 1, sz: rz / rx, seg, a0: -0.7, a1: Math.PI + 0.7, color: GOLD });
  // ряды окон между золотыми кольцами
  for (let y = yTopShaft - 0.5, row = 0; y > cut + 1.6; y -= 3.1, row++){
    ringAt(y, 0.07);
    for (let k = 0; k < 5; k++){
      const a = Math.PI * (0.22 + 0.14 * k);
      const N = V(Math.cos(a) / rx, 0, Math.sin(a) / rz).normalize(), Rv = V(N.z, 0, -N.x);
      const O = V(cx + (rx + 0.012) * Math.cos(a), y - 2.45, (rz + 0.012) * Math.sin(a));
      archPanelF(B.glass, O, Rv, N, 0.62, 1.6, new THREE.Color().setScalar(night ? (rnd() < 0.75 ? 1 : 0.3) : 0.95));
      goldP(B, torusP(0.33, 0.035, Math.PI, 10), new THREE.Matrix4().makeBasis(Rv, V(0, 1, 0), N).setPosition(O.clone().addScaledVector(V(0, 1, 0), 1.6 - 0.31).addScaledVector(N, 0.02)));
    }
  }
  B.setHaze(null);
  // венчающий карниз: золотой пояс с орнаментом и мраморная подушка
  const R0 = rz + 0.3, sx = (rx + 0.3) / R0, dp = discTopProfiles(R0);
  lathe(B.marble, dp.cushion, { cx, cz: 0, y0: y1, sx, sz: 1, seg, color: 0xffffff });
  lathe(B.gold, dp.gold, { cx, cz: 0, y0: y1, sx, sz: 1, seg, color: GOLD, uLen: ORN_U, oRef: R0 });
  lathe(B.chrome, cove(R0 - 0.1, -0.6 - 0.5, R0 - 0.1 - rz, 0.5, HP, Math.PI, 8), { cx, cz: 0, y0: y1, sx, sz: 1, seg, color: CHROME });
  ellipseCap(B.marble, cx, 0, y1, (R0 - 0.16) * sx, R0 - 0.16, seg, 1, 0xffffff, (x, z) => [x / 3, z / 3]);
  // купол с золотыми рёбрами, фонарик и шпиль
  const dr = rx * 0.78, dh = 2.3;
  const dome = [];
  for (let i = 0; i <= 10; i++){ const t = i / 10, a = t * HP; dome.push({ o: Math.cos(a), y: Math.sin(a) * dh, v: t }); }
  smoothNormals(dome.reverse()); dome.reverse();
  lathe(B.marble, dome.map(p => ({ ...p })), { cx, cz: 0, y0: y1 + 0.05, sx: dr, sz: dr * rz / rx, seg: 48, color: 0xfffaf4 });
  for (let k = 0; k < 8; k++){
    const a = k / 8 * Math.PI * 2 + 0.2;
    lathe(B.gold, dome.map(p => ({ o: p.o * 1.012, y: p.y * 1.005, no: p.no, ny: p.ny, v: PLAIN[1] })), { cx, cz: 0, y0: y1 + 0.05, sx: dr, sz: dr * rz / rx, seg: 1, a0: a - 0.025, a1: a + 0.025, color: GOLD });
  }
  const yL = y1 + 0.05 + dh;
  goldP(B, protoCyl(12), mat(cx, yL + 0.3, 0, 0.32, 0.6, 0.32));
  B.marble.addProto(protoCyl(12), mat(cx, yL + 0.3, 0, 0.26, 0.62, 0.26), 0xffffff, (x, y, z) => [x / 3, y / 3]);
  goldP(B, P("cone", () => new THREE.ConeGeometry(0.3, 1.6, 12)), mat(cx, yL + 1.4, 0));
  goldP(B, protoSphere(), mat(cx, yL + 2.3, 0, 0.12, 0.12, 0.12));
  pennant(B.deco, B, cx, yL + 2.3, 0.01, s.x0 < 0 ? 1 : 2);
}

// ================= ДИСКИ (oneways / movers) =================
// b — { marble, gold, chrome } батчи; w — ширина платформы; bowlH — глубина чаши
function discPlatform(b, cx, y, w, bowlH){
  const R0 = DISC.rz, rx = w / 2 + 0.1, sx = rx / R0, seg = 36;
  const cushion = arc(R0 - 0.15, -0.13, 0.15, 0.13, HP, -HP, 8).map(p => ({ ...p, v: p.y / 3 }));
  lathe(b.marble, cushion, { cx, cz: 0, y0: y, sx, sz: 1, seg, color: 0xffffff });
  ellipseCap(b.marble, cx, 0, y, (R0 - 0.15) * sx, R0 - 0.15, seg, 1, 0xffffff, (x, z) => [x / 3, z / 3]);
  const ri = (R0 - 0.15) * 0.68;
  lathe(b.gold, [{ o: ri + 0.03, y: 0.004, no: 0, ny: 1, v: PLAIN[1] }, { o: ri - 0.03, y: 0.004, no: 0, ny: 1, v: PLAIN[1] }], { cx, cz: 0, y0: y, sx, sz: 1, seg, color: GOLD });
  const band = [];
  for (let i = 0; i <= 5; i++){ const t = i / 5; band.push({ o: R0 - 0.07 + 0.014 * Math.sin(Math.PI * t), y: -0.3 - 0.19 * t }); }
  smoothNormals(band);
  const gold = [...arc(R0 - 0.06, -0.27, 0.03, 0.03, HP, -HP * 0.6, 4), ...band, ...arc(R0 - 0.06, -0.52, 0.03, 0.03, HP * 0.6, -HP, 4)];
  profileVy(gold, -0.24, 0.86, -0.55, 0.0);
  lathe(b.gold, gold, { cx, cz: 0, y0: y, sx, sz: 1, seg, color: GOLD, uLen: ORN_U, oRef: R0 });
  // хромовая чаша, сужающаяся к золотому навершию
  const r0 = R0 - 0.08, bowl = [];
  for (let i = 0; i <= 10; i++){ const t = i / 10; bowl.push({ o: Math.max(0.05, r0 * Math.pow(Math.max(0, 1 - Math.pow(t, 1.7)), 0.7)), y: -0.55 - bowlH * t }); }
  smoothNormals(bowl);
  lathe(b.chrome, bowl, { cx, cz: 0, y0: y, sx, sz: 1, seg: 28, color: CHROME });
  // золотые рёбра по чаше
  for (let k = 0; k < 8; k++){
    const a = k / 8 * Math.PI * 2 + Math.PI / 8;
    lathe(b.gold, bowl.slice(0, 9).map(p => ({ o: p.o + 0.018, y: p.y, no: p.no, ny: p.ny, v: PLAIN[1] })), { cx, cz: 0, y0: y, sx, sz: 1, seg: 1, a0: a - 0.035, a1: a + 0.035, color: GOLD });
  }
  b.gold.addProto(protoSphere(), mat(cx, y - 0.55 - bowlH - 0.02, 0, 0.085, 0.085, 0.085), GOLD, PLAIN);
  b.gold.addProto(P("cone", () => new THREE.ConeGeometry(0.3, 1.6, 12)), mat(cx, y - 0.55 - bowlH - 0.2, 0, 0.12, -0.18, 0.12), GOLD, PLAIN);
}

// фиолетовое свечение движущейся платформы: светящийся ободок под золотом + мягкий «луч» вниз
function moverGlow(b, cx, w){
  const R = DISC.rz, sx = (w / 2 + 0.1) / R;
  const purple = new THREE.Color(PAL.purple), hot = new THREE.Color(0xc9a8ff).multiplyScalar(3.0);
  lathe(b, arc(R - 0.2, -0.58, 0.05, 0.035, HP, -HP, 4), { cx, cz: 0, y0: 0, sx, sz: 1, seg: 28, color: hot });
  const top = -0.5, bot = -2.2, hw = w * 0.36;
  const c0 = purple.clone().multiplyScalar(1.3);
  for (const a of [0, Math.PI / 2]){
    const dx = Math.cos(a) * hw, dz = Math.sin(a) * (a ? R * 0.8 : hw);
    const Pq = [V(cx - dx, top, -dz), V(cx + dx, top, dz), V(cx + dx, bot, dz), V(cx - dx, bot, -dz)];
    for (const tri of [[0, 1, 2], [0, 2, 3]]) for (const k of tri){ const c = k < 2 ? c0 : { r: 0, g: 0, b: 0 }; b.vert(Pq[k].x, Pq[k].y, Pq[k].z, 0, 0, 1, 0, 0, c.r, c.g, c.b); }
  }
  const cy = -0.6, rr = R * 1.25, sg = 24, cc = purple.clone().multiplyScalar(0.95);
  for (let k = 0; k < sg; k++){
    const a0 = k / sg * Math.PI * 2, a1 = (k + 1) / sg * Math.PI * 2;
    b.vert(cx, cy, 0, 0, 1, 0, 0, 0, cc.r, cc.g, cc.b);
    b.vert(cx + Math.cos(a1) * rr * sx, cy, Math.sin(a1) * rr, 0, 1, 0, 0, 0, 0, 0, 0);
    b.vert(cx + Math.cos(a0) * rr * sx, cy, Math.sin(a0) * rr, 0, 1, 0, 0, 0, 0, 0, 0);
  }
}

// золотая рама шахты лифта: две штанги из-под кадра до верха хода, хомуты, перекладина с шарами наверху
function railGuides(B, m){
  const top = m.y + m.ay + 1.5, bot = -9, z = -0.62;
  const xs = [m.x0 - 0.25, m.x1 + 0.25];
  for (const x of xs){
    goldP(B, protoCyl(8), mat(x, (top + bot) / 2, z, 0.05, top - bot, 0.05));
    goldP(B, protoSphere(), mat(x, top + 0.06, z, 0.1, 0.1, 0.1));
    for (let y = bot + 0.8; y < top - 0.4; y += 1.35) goldP(B, protoCyl(10), mat(x, y, z, 0.085, 0.07, 0.085));
  }
  goldP(B, protoCyl(8), mat((xs[0] + xs[1]) / 2, top - 0.12, z, 0.04, xs[1] - xs[0], 0.04, 0, 0, HP));
}

// вымпел на золотом древке (синий/фиолетовый — лайм оставлен наградам и чекпоинтам)
function pennant(d, B, x, y, h, idx){
  if (h > 0.05){
    goldP(B, protoCyl(8), mat(x, y + h / 2, -0.4, 0.05, h, 0.05));
    goldP(B, protoSphere(), mat(x, y + h + 0.06, -0.4, 0.085, 0.085, 0.085));
  }
  const sh = new THREE.Shape();
  sh.moveTo(0, 0); sh.quadraticCurveTo(0.55, -0.05, 1.05, -0.24); sh.quadraticCurveTo(0.55, -0.34, 0, -0.52); sh.closePath();
  const g = new THREE.ShapeGeometry(sh, 6);
  d.add(g, new THREE.Matrix4().makeTranslation(x + 0.04, y + h - 0.06, -0.4), idx % 2 ? PAL.purple : PAL.blue);
  g.dispose();
}

// ================= РЕКВИЗИТ: фонари, урны, балюстрады (задняя кромка ярусов) =================
function lampPost(B, x, y, night){
  const z = LAMP.z;
  marbleBox(B.marble, x - 0.13, y, z - 0.13, x + 0.13, y + 0.26, z + 0.13, 0xf8f2ea);
  goldP(B, protoCyl(12), mat(x, y + 0.3, z, 0.12, 0.08, 0.12));
  goldP(B, protoCyl(8), mat(x, y + 0.3 + (LAMP.h - 0.62) / 2, z, 0.034, LAMP.h - 0.62, 0.034));
  goldP(B, protoSphereLo(), mat(x, y + 0.95, z, 0.06, 0.05, 0.06));
  goldP(B, torusP(0.1, 0.018, Math.PI * 2, 12), mat(x, y + LAMP.h - 0.3, z, 1, 1, 1, HP));
  // колба-фонарь (стекло со свечением), решётка-«клетка» и шапочка
  const gy = y + LAMP.h - 0.3;
  B.glass.addProto(protoLampGlass(), mat(x, gy, z, 0.19, 0.36, 0.19), new THREE.Color(1.0, 0.72, 0.42).multiplyScalar(night ? 1.5 : 2.2), [0.25, 0.4]);
  for (let k = 0; k < 4; k++){
    const a = k / 4 * Math.PI * 2 + 0.4;
    goldP(B, protoCyl(6), mat(x + Math.cos(a) * 0.085, gy + 0.19, z + Math.sin(a) * 0.085, 0.012, 0.36, 0.012));
  }
  goldP(B, P("cone", () => new THREE.ConeGeometry(0.3, 1.6, 12)), mat(x, gy + 0.43, z, 0.5, 0.09, 0.5));
  goldP(B, protoSphereLo(), mat(x, gy + 0.52, z, 0.045, 0.045, 0.045));
}
function urn(B, x, y, big){
  const z = URN.z, h = big ? 0.62 : 0.5, r = big ? 0.3 : 0.25;
  B.marble.addProto(protoUrn(), mat(x, y, z, r * 2, h, r * 2), 0xfbf6ef, (px, py, pz) => [(px + pz) / 3, py / 3]);
  goldP(B, torusP(r * 0.92, 0.025, Math.PI * 2, 16), mat(x, y + h * 0.985, z, 1, 1, 1, HP));
  goldP(B, torusP(r * 0.62, 0.02, Math.PI * 2, 14), mat(x, y + h * 0.08, z, 1, 1, 1, HP));
}
export const URN_TOP = big => (big ? 0.62 : 0.5);
function balustrade(B, x0, x1, y){
  const z = RAIL.z, h = RAIL.h;
  marbleBox(B.marble, x0, y, z - 0.13, x1, y + 0.1, z + 0.13, 0xf6efe6);
  const n = Math.max(2, Math.round((x1 - x0) / 0.27));
  for (let i = 0; i <= n; i++){
    const x = x0 + (x1 - x0) * i / n;
    if (i === 0 || i === n){
      marbleBox(B.marble, x - 0.11, y, z - 0.14, x + 0.11, y + h + 0.06, z + 0.14, 0xfbf6ef);
      goldP(B, protoSphere(), mat(x, y + h + 0.16, z, 0.085, 0.085, 0.085));
      continue;
    }
    if (DET < 1) continue;                                   // q=low: вместо балясин — сплошной парапет (ниже)
    B.marble.addProto(protoBaluster(), mat(x, y + 0.1, z, 0.2, h - 0.2, 0.2), 0xfffaf3, (px, py, pz) => [px / 3, py / 3]);
  }
  if (DET < 1) marbleBox(B.marble, x0, y + 0.1, z - 0.06, x1, y + h - 0.1, z + 0.06, 0xf3ebe0);
  marbleBox(B.marble, x0 - 0.02, y + h - 0.1, z - 0.15, x1 + 0.02, y + h, z + 0.15, 0xfbf6ef);
  goldBox(B, x0, y + h, z + 0.07, x1, y + h + 0.025, z + 0.155);
}

// Дальний план пропастей: стройная колонна с диском позади провала — держит глубину там, где нет ярусов.
// Это средний план (z ≈ −9), поэтому заметно в дымке (воздушная перспектива), с золотыми кольцами.
function backdropPits(level, B, night){
  const main = level.solids.filter(s => s.kind !== "tower").sort((a, b) => a.x0 - b.x0);
  const rnd = makeRng(404);
  const tint = night ? 0xd9d6f2 : 0xf1e4ea;
  for (let i = 1; i < main.length; i++){
    const a = main[i - 1], b = main[i];
    const gap = b.x0 - a.x1;
    if (gap <= 3.2) continue;
    const cx = (a.x1 + b.x0) / 2 + (rnd() - 0.5) * gap * 0.25, z = -9.2;
    const ty = Math.max(a.y1, b.y1) + 1.4 + rnd() * 1.4;
    const bot = -14;                                              // низ всегда за кадром
    const hz = Math.min(a.y1, b.y1) - 6;
    const h0 = night ? 0.5 : 0.36;                               // ночью средний план глубже в дымке
    B.setHaze((x, y) => h0 + (0.96 - h0) * sstep(ty, hz, y));
    lathe(B.marble, [{ o: 1, y: -1.05, no: 1, ny: 0, flute: true, v: 0 }, { o: 1, y: -3.5, no: 1, ny: 0, flute: true, v: 0.8 }, { o: 1, y: bot - ty, no: 1, ny: 0, flute: true, v: 3 }],
      { cx, cz: z, y0: ty, sx: 0.72, sz: 0.72, seg: 22, a0: -0.5, a1: Math.PI + 0.5, flute: { n: 16, amp: 0.7 }, color: tint });
    const R0 = 1.2, dp = discTopProfiles(R0);
    lathe(B.marble, dp.cushion, { cx, cz: z, y0: ty, sx: 1, sz: 1, seg: 28, color: tint });
    ellipseCap(B.marble, cx, z, ty, R0 - 0.16, R0 - 0.16, 28, 1, tint, (x, zz) => [x / 3, zz / 3]);
    lathe(B.gold, dp.gold, { cx, cz: z, y0: ty, sx: 1, sz: 1, seg: 28, color: GOLD, uLen: ORN_U, oRef: R0 });
    lathe(B.gold, cove(R0 - 0.1, -1.05, R0 - 0.1 - 0.74, 0.45, HP, Math.PI, 6).map(p => ({ ...p, v: PLAIN[1] })), { cx, cz: z, y0: ty, sx: 1, sz: 1, seg: 28, color: GOLD_SHADE });
    for (let y = ty - 1.25; y > hz; y -= 2.6)
      lathe(B.gold, arc(0.72, 0, 0.05, 0.06, HP, -HP, 4).map(p => ({ ...p, v: PLAIN[1] })), { cx, cz: z, y0: y, sx: 1, sz: 1, seg: 20, a0: -0.5, a1: Math.PI + 0.5, color: GOLD });
    B.setHaze(null);
    pennant(B.deco, B, cx, ty + 0.02, 1.2, i);
  }
}

// ================= СБОРКА =================
function makeBatches(){
  const B = { marble: new Batch(), floor: new Batch(), gold: new Batch(), chrome: new Batch(), glass: new Batch(), deco: new Batch(), facade: null };
  B.setHaze = fn => { for (const k of ["marble", "floor", "gold", "chrome", "glass", "facade"]) if (B[k]) B[k].hazeFn = fn; };
  return B;
}

export async function buildWalls(level, renderer, { night = levelIsNight(level), quality = "med" } = {}){
  const group = new THREE.Group(); group.name = "walls";
  DET = quality === "low" ? 0.55 : 1;
  setDetail(DET);
  const painted = await loadPainted(night);
  const M = createArchMaterials(renderer, { night, painted, haze: night ? HAZE.night : HAZE.day, lite: quality === "low" });
  const B = makeBatches();
  B.facadePainted = M.facadePainted; B.floorPainted = M.floorPainted;
  B.facade = M.facadePainted ? new Batch() : B.marble;
  const rnd = makeRng(2027);
  const info = blockLayout(level);

  for (const it of info){
    if (it.s.kind === "tower") towerBody(B, it, night, rnd);
    else if (it.s.kind === "keep") keepColumn(B, it, night, rnd);
    else tier(B, it, night, rnd);
  }
  // статичные платформы — парящие диски
  for (const o of level.oneways) discPlatform(B, (o.x0 + o.x1) / 2, o.y, o.x1 - o.x0, DISC.bowl);
  for (const m of level.movers) if (m.ay) railGuides(B, m);
  // реквизит
  for (const d of decorSpots(level)){
    if (d.kind === "lamp") lampPost(B, d.x, d.y, night);
    else if (d.kind === "urn") urn(B, d.x, d.y, d.big);
    else if (d.kind === "rail") balustrade(B, d.x, d.x1, d.y);
  }
  backdropPits(level, B, night);
  // ориентиры-«открытки» (landmarks.js) — в те же батчи; золото — гладкое (uv на гладкую полосу)
  // мрамор — с мировыми uv (у примитивов three uv растянуты на весь предмет: прожилки шли бы полосами)
  const goldPlain = { add: (g, m, c) => B.gold.add(g, m, c, PLAIN) };
  const marbleWorld = { add: (g, m, c) => B.marble.addProto(proto(g.clone()), m, c, (x, y, z) => [(x + z) / 3, y / 3]) };
  buildLandmarks(level, night, { top: marbleWorld, gold: goldPlain, chrome: B.chrome });

  const decoMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 0.4 });
  const mk = (b, mat2, name) => {
    if (!b || b.empty) return null;
    const m = new THREE.Mesh(b.build(), mat2); m.name = name; m.matrixAutoUpdate = false; m.updateMatrix(); group.add(m); return m;
  };
  mk(B.marble, M.marble, "arch-marble");
  if (M.facadePainted) mk(B.facade, M.facade, "arch-facade");
  mk(B.floor, M.floor, "arch-floor");
  mk(B.gold, M.gold, "arch-gold");
  mk(B.chrome, M.chrome, "arch-chrome");
  mk(B.glass, M.glass, "arch-glass");
  mk(B.deco, decoMat, "arch-deco");

  // ---------- движущиеся диски: инстансинг (4 draw call'а на все), прототип при единичной ширине ----------
  const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide });
  const nMovers = Math.max(1, level.movers.length);
  const unitW = DISC.rz * 2;
  const U = { marble: new Batch(), gold: new Batch(), chrome: new Batch() }, ulb = new Batch();
  discPlatform(U, 0, 0, unitW, DISC.bowlMover);
  moverGlow(ulb, 0, unitW);
  const moverTop = new THREE.InstancedMesh(U.marble.build(), M.marble, nMovers);
  const moverGold = new THREE.InstancedMesh(U.gold.build(), M.gold, nMovers);
  const moverChrome = new THREE.InstancedMesh(U.chrome.build(), M.chrome, nMovers);
  const moverGlowMesh = new THREE.InstancedMesh(ulb.build(), glowMat, nMovers);
  for (const mm of [moverTop, moverGold, moverChrome, moverGlowMesh]) mm.frustumCulled = false;
  moverGlowMesh.renderOrder = 4;
  moverTop.name = "mover-top"; moverGold.name = "mover-gold"; moverChrome.name = "mover-chrome"; moverGlowMesh.name = "mover-glow";
  group.add(moverTop, moverGold, moverChrome, moverGlowMesh);
  const _m = new THREE.Matrix4();
  if (!level.movers.length){ _m.makeScale(0, 0, 0); for (const mm of [moverTop, moverGold, moverChrome, moverGlowMesh]) mm.setMatrixAt(0, _m); }
  // масштаб x: реальная ширина / единичная (с поправкой на вынос обода +0.1 с каждой стороны)
  const moverMeshes = { top: moverTop, gold: moverGold, chrome: moverChrome, glow: moverGlowMesh,
    items: level.movers.map((m, i) => ({ i, sx: ((m.x1 - m.x0) / 2 + 0.1) / (unitW / 2 + 0.1) })) };
  group.userData.dispose = () => M.dispose();
  setDetail(1); DET = 1;
  return { group, moverMeshes, materials: M };
}

// движущиеся платформы: сдвиг инстансов по позициям из физики (с интерполяцией)
const _p = new THREE.Vector3(), _s = new THREE.Vector3(), _q0 = new THREE.Quaternion(), _mm = new THREE.Matrix4();
export function placeMovers(moverMeshes, world, alpha){
  const { top, gold, chrome, glow, items } = moverMeshes;
  for (const it of items){
    const pl = world.movers[it.i];
    const cx = pl.x0 - pl.dx * (1 - alpha) + (pl.x1 - pl.x0) / 2;
    const cy = pl.y - pl.dy * (1 - alpha);
    _p.set(cx, cy, 0); _s.set(it.sx, 1, 1);
    _mm.compose(_p, _q0, _s);
    top.setMatrixAt(it.i, _mm); gold.setMatrixAt(it.i, _mm); chrome.setMatrixAt(it.i, _mm); glow.setMatrixAt(it.i, _mm);
  }
  if (items.length){
    top.instanceMatrix.needsUpdate = true; gold.instanceMatrix.needsUpdate = true;
    chrome.instanceMatrix.needsUpdate = true; glow.instanceMatrix.needsUpdate = true;
  }
}
