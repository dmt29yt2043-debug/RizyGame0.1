// Материалы игровой архитектуры «Идеалити»: полированный мрамор, золото с орнаментом, хром, стекло окон.
// Текстуры процедурные (CanvasTexture, рисуются один раз на уровень);
// если в assets/tex/ лежат нарисованные текстуры и они перечислены в assets/tex/manifest.json — берём их
// (фасад → нижние этажи и башни, пол → столешницы ярусов, фриз → золотой пояс), иначе процедурный вариант.
//
// Раскладка UV, на которую рассчитаны текстуры (её соблюдают walls.js/arch.js):
//   • мрамор (marble)   — u,v в мировых единицах / 3 (тайл 3×3 ед.), прожилки мягкие, повтор по обеим осям;
//   • пол (floor)       — u = x / 2 (повтор), v = 0 у задней кромки яруса → 1 у передней (один тайл по глубине):
//                         плиты с золотыми швами-инкрустацией и золотой полосой вдоль передней кромки;
//   • орнамент (gold)   — u = длина вдоль пояса / ORN_U (повтор), v 0…0.86 — поле орнамента (нижний ряд бусин
//                         → бегущая волна-«витрувианский завиток» → верхний ряд бусин), v 0.9…1 — гладкое
//                         золото (кольца, шары, древки получают постоянный uv = GOLD_PLAIN_UV);
//   • окно (glass)      — u,v 0…1 по окну (арка сверху); днём тёплое стекло с отражением неба, ночью свет.
// Шейдеры: только штатные чанки three + мягкая «дымка» (атрибут aHaze, 0…1) — смешивание готового цвета
// с цветом дымки после освещения. Никаких pow() от отрицательного, деления на ноль и normalize(0).
import * as THREE from "three";
import { makeRng } from "./tex.js";

export const ORN_U = 1.35;                       // мировых единиц на один повтор орнамента вдоль пояса
export const GOLD_PLAIN_UV = [0.5, 0.95];        // uv гладкого золота (верхняя полоса текстуры орнамента)

const TEX_DIR = new URL("../../assets/tex/", import.meta.url).href;

function canvas(w, h){ const c = document.createElement("canvas"); c.width = w; c.height = h; return c; }
function finish(c, renderer, { srgb = true, repeat = true, clampV = false } = {}){
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.wrapT = clampV ? THREE.ClampToEdgeWrapping : (repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping);
  t.anisotropy = renderer ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 1;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}
const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
const smooth = t => t * t * (3 - 2 * t);

// ---------- периодический value-noise (бесшовный по обеим осям) ----------
function periodicNoise(cells, rnd){
  const g = new Float32Array(cells * cells);
  for (let i = 0; i < g.length; i++) g[i] = rnd();
  return (u, v) => {                                 // u, v в долях тайла (0..1, дальше — повтор)
    const x = (u - Math.floor(u)) * cells, y = (v - Math.floor(v)) * cells;
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = smooth(x - x0), fy = smooth(y - y0);
    const x1 = (x0 + 1) % cells, y1 = (y0 + 1) % cells;
    const a = g[y0 * cells + x0], b = g[y0 * cells + x1], c = g[y1 * cells + x0], d = g[y1 * cells + x1];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}
function fbm(rnd, octaves){
  const layers = octaves.map(([cells, amp]) => ({ n: periodicNoise(cells, rnd), amp }));
  const sum = layers.reduce((s, l) => s + l.amp, 0);
  return (u, v) => { let s = 0; for (const l of layers) s += l.n(u, v) * l.amp; return s / sum; };
}
// три прохода «коробочного» размытия по Float32 полю (≈ гаусс), по x — с заворотом, по y — с заворотом/без
function blurField(f, W, H, r, wrapY = true){
  const tmp = new Float32Array(f.length);
  const pass = (src, dst, horiz) => {
    const n = 2 * r + 1;
    if (horiz){
      for (let y = 0; y < H; y++){
        let s = 0;
        for (let k = -r; k <= r; k++) s += src[y * W + ((k % W) + W) % W];
        for (let x = 0; x < W; x++){
          dst[y * W + x] = s / n;
          s += src[y * W + (x + r + 1) % W] - src[y * W + ((x - r) % W + W) % W];
        }
      }
    } else {
      for (let x = 0; x < W; x++){
        const at = y => wrapY ? src[(((y % H) + H) % H) * W + x] : src[Math.min(H - 1, Math.max(0, y)) * W + x];
        let s = 0;
        for (let k = -r; k <= r; k++) s += at(k);
        for (let y = 0; y < H; y++){
          dst[y * W + x] = s / n;
          s += at(y + r + 1) - at(y - r);
        }
      }
    }
  };
  for (let i = 0; i < 3; i++){ pass(f, tmp, true); pass(tmp, f, false); }
  return f;
}
// карта нормалей из поля высот (0..1): canvas-строки идут вниз, а v в three — вверх (flipY), отсюда знак gv
function normalCanvas(h, W, H, strength, wrapY = false){
  const c = canvas(W, H), g = c.getContext("2d"), img = g.createImageData(W, H), d = img.data;
  const at = (x, y) => h[(wrapY ? ((y % H) + H) % H : Math.min(H - 1, Math.max(0, y))) * W + ((x % W) + W) % W];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++){
    const gu = (at(x + 1, y) - at(x - 1, y)) * 0.5 * strength;
    const gv = -(at(x, y + 1) - at(x, y - 1)) * 0.5 * strength;
    const l = Math.hypot(gu, gv, 1);
    const i = (y * W + x) * 4;
    d[i] = Math.round((-gu / l * 0.5 + 0.5) * 255);
    d[i + 1] = Math.round((-gv / l * 0.5 + 0.5) * 255);
    d[i + 2] = Math.round((1 / l * 0.5 + 0.5) * 255);
    d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

// ---------- МРАМОР (лица, колонны, арки): сливочный с облачной неровностью тона и мягкими прожилками ----------
// Тайл 512² ↔ 3×3 мировых ед. Прожилки рисуются с заворотом (9 копий со сдвигом ±тайл) — шва нет.
function paintMarble(W, H, seed, { base, light, shade, vein, veinWarm, veins = 6, contrast = 1 }){
  const c = canvas(W, H), g = c.getContext("2d");
  const rnd = makeRng(seed);
  const cloud = fbm(rnd, [[3, 1], [6, 0.55], [12, 0.3], [24, 0.14]]);
  const img = g.createImageData(W, H), d = img.data;
  const B = new THREE.Color(base), L = new THREE.Color(light), S = new THREE.Color(shade), col = new THREE.Color();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++){
    const n = cloud(x / W, y / H);
    const t = clamp01((n - 0.5) * 2.2 * contrast + 0.5);
    if (t > 0.5) col.copy(B).lerp(L, (t - 0.5) * 2); else col.copy(S).lerp(B, t * 2);
    const gr = (rnd() - 0.5) * 0.018;
    const i = (y * W + x) * 4;
    d[i] = clamp01(col.r + gr) * 255; d[i + 1] = clamp01(col.g + gr) * 255; d[i + 2] = clamp01(col.b + gr) * 255; d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  // прожилки: плавные ломаные с изменением направления, три штриха (широкий бледный, средний, тонкий)
  g.lineCap = "round"; g.lineJoin = "round";
  for (let k = 0; k < veins; k++){
    const pts = [];
    let x = rnd() * W, y = rnd() * H, a = rnd() * Math.PI * 2;
    const n = 7 + Math.floor(rnd() * 6);
    for (let j = 0; j < n; j++){ pts.push([x, y]); a += (rnd() - 0.5) * 1.1; const L2 = 26 + rnd() * 50; x += Math.cos(a) * L2; y += Math.sin(a) * L2 * 0.8; }
    const warm = rnd() < 0.35;
    const colV = warm ? veinWarm : vein;
    const strokes = [[7, 0.05], [2.6, 0.12], [1.0, 0.28]];
    for (const [lw, al] of strokes){
      g.strokeStyle = `rgba(${colV[0]},${colV[1]},${colV[2]},${al * (0.7 + rnd() * 0.5)})`; g.lineWidth = lw * (0.7 + rnd() * 0.6);
      for (const ox of [-W, 0, W]) for (const oy of [-H, 0, H]){
        g.beginPath(); g.moveTo(pts[0][0] + ox, pts[0][1] + oy);
        for (let j = 1; j < pts.length - 1; j++){
          const mx = (pts[j][0] + pts[j + 1][0]) / 2, my = (pts[j][1] + pts[j + 1][1]) / 2;
          g.quadraticCurveTo(pts[j][0] + ox, pts[j][1] + oy, mx + ox, my + oy);
        }
        g.stroke();
      }
    }
  }
  return c;
}
const MARBLE_DAY = { base: 0xf6f0e8, light: 0xfffcf8, shade: 0xe7dbcf, vein: [168, 146, 128], veinWarm: [196, 160, 104], veins: 7 };
const MARBLE_NIGHT = { base: 0xf4ece1, light: 0xfffaf2, shade: 0xe2d4c4, vein: [160, 140, 132], veinWarm: [196, 160, 104], veins: 7 };

// ---------- ПОЛ ЯРУСА (вид сверху): плиты со швами-инкрустацией, золотая полоса у передней кромки ----------
// Цвет + карта «шероховатость/металл» (G — roughness, B — metalness, как ждёт three): золото — металл.
function paintFloor(W, H, seed, night){
  const P = night ? MARBLE_NIGHT : MARBLE_DAY;
  const col = paintMarble(W, H, seed, { ...P, veins: 5, contrast: 0.8, base: night ? P.base : 0xf7f4f0, light: 0xfffefb, shade: night ? P.shade : 0xebe3dc });
  const g = col.getContext("2d");
  const mr = canvas(W, H), m = mr.getContext("2d");
  m.fillStyle = "rgb(0,48,0)"; m.fillRect(0, 0, W, H);          // мрамор: roughness ≈ 0.19, не металл
  const gold = "#e2b85a", goldMR = "rgb(0,70,255)";               // золото: roughness ≈ 0.27, металл
  // v = 0 — задняя кромка (низ канваса), v = 1 — передняя (верх канваса, flipY)
  const yOf = v => (1 - v) * H;
  const hline = (v, th) => { const y = yOf(v); g.fillStyle = gold; g.fillRect(0, y - th / 2, W, th); m.fillStyle = goldMR; m.fillRect(0, y - th / 2, W, th); };
  // швы плит по x (каждые 0.5 тайла = 1 ед.) — в пределах поля между полосами
  const vA = 0.13, vB = 0.8;
  for (const u of [0, 0.5]){
    const x = u * W;
    g.fillStyle = gold; g.fillRect(x - 1.5, yOf(vB), 3, yOf(vA) - yOf(vB));
    m.fillStyle = goldMR; m.fillRect(x - 1.5, yOf(vB), 3, yOf(vA) - yOf(vB));
    if (u === 0){ g.fillRect(W - 1.5, yOf(vB), 1.5, yOf(vA) - yOf(vB)); m.fillRect(W - 1.5, yOf(vB), 1.5, yOf(vA) - yOf(vB)); }
  }
  // ромбики-вставки на серединах плит
  for (const u of [0.25, 0.75]){
    const x = u * W, y = yOf((vA + vB) / 2), r = 13;
    for (const ctx of [g, m]){
      ctx.fillStyle = ctx === g ? gold : goldMR;
      ctx.beginPath(); ctx.moveTo(x, y - r * 1.6); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r * 1.6); ctx.lineTo(x - r, y); ctx.closePath(); ctx.fill();
    }
    g.fillStyle = night ? "rgba(255,248,240,0.9)" : "rgba(255,250,242,0.95)";
    g.beginPath(); g.moveTo(x, y - 9); g.lineTo(x + 5.5, y); g.lineTo(x, y + 9); g.lineTo(x - 5.5, y); g.closePath(); g.fill();
    m.fillStyle = "rgb(0,48,0)"; m.beginPath(); m.moveTo(x, y - 9); m.lineTo(x + 5.5, y); m.lineTo(x, y + 9); m.lineTo(x - 5.5, y); m.closePath(); m.fill();
  }
  hline(vA, 3); hline(vB, 3);
  // передний бордюр: полоса мрамора потемнее + широкая золотая лента и тонкая линия у самой кромки
  g.fillStyle = night ? "rgba(214,206,214,0.35)" : "rgba(226,206,184,0.35)"; g.fillRect(0, yOf(0.97), W, yOf(vB) - yOf(0.97));
  hline(0.87, 7); hline(0.955, 2.5);
  return { color: col, mr };
}

// ---------- ЗОЛОТОЙ ОРНАМЕНТ (пояс яруса, обод дисков): поле высот → нормали + цвет с тенью в углублениях ----------
function paintOrnament(W, H){
  const h = new Float32Array(W * H);
  const plainRows = Math.round(H * 0.1);                   // верх канваса = v 0.9…1 — гладкое золото
  // вспомогательные «кисти» по полю высот
  const disc = (cx, cy, r, amp) => {
    const x0 = Math.floor(cx - r - 1), x1 = Math.ceil(cx + r + 1), y0 = Math.max(0, Math.floor(cy - r - 1)), y1 = Math.min(H - 1, Math.ceil(cy + r + 1));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++){
      const dd = Math.hypot(x - cx, y - cy) / r; if (dd >= 1) continue;
      const i = y * W + ((x % W) + W) % W;
      h[i] = Math.max(h[i], amp * Math.sqrt(1 - dd * dd));
    }
  };
  const band = (y0, y1, amp) => { for (let y = Math.max(0, Math.floor(y0)); y < Math.min(H, Math.ceil(y1)); y++) for (let x = 0; x < W; x++) h[y * W + x] = Math.max(h[y * W + x], amp); };
  const stroke = (pts, r, amp) => { for (let i = 0; i < pts.length - 1; i++){ const [ax, ay] = pts[i], [bx, by] = pts[i + 1]; const n = Math.ceil(Math.hypot(bx - ax, by - ay) / 1.2); for (let k = 0; k <= n; k++) disc(ax + (bx - ax) * k / n, ay + (by - ay) * k / n, r, amp); } };
  // гладкая верхняя полоса
  for (let y = 0; y < plainRows; y++) for (let x = 0; x < W; x++) h[y * W + x] = 0.55;
  const top = plainRows + 2, bot = H - 2, span = bot - top;
  const Y = t => top + span * t;                            // t 0 — верх поля (v≈0.86), 1 — низ (v 0)
  // бортики-рёбра по краям поля
  band(Y(0.0), Y(0.05), 0.72); band(Y(0.95), Y(1.0), 0.72);
  // ряды бусин (жемчуг) сверху и снизу
  const beadN = 36;
  for (let i = 0; i < beadN; i++){ disc((i + 0.5) * W / beadN, Y(0.13), span * 0.075, 1.0); disc((i + 0.5) * W / beadN, Y(0.87), span * 0.075, 1.0); }
  band(Y(0.22), Y(0.25), 0.62); band(Y(0.75), Y(0.78), 0.62);
  // бегущая волна-завиток: 4 периода на тайл
  const per = W / 4, cy = Y(0.5), A = span * 0.17;
  for (let p = 0; p < 4; p++){
    const x0 = p * per, pts = [];
    for (let k = 0; k <= 40; k++){ const t = k / 40; pts.push([x0 + t * per, cy + A * Math.sin(t * Math.PI * 2)]); }
    stroke(pts, span * 0.045, 0.95);
    // завиток: спираль у гребня волны
    const sx = x0 + per * 0.25, sy = cy - A * 0.15, spiral = [];
    for (let k = 0; k <= 30; k++){ const t = k / 30, a = Math.PI * 0.5 + t * Math.PI * 1.9, r = A * 0.95 * (1 - t * 0.75); spiral.push([sx + Math.cos(a) * r * 0.8, sy - Math.sin(a) * r * 0.62]); }
    stroke(spiral, span * 0.036, 0.9);
    // розетка во «впадине»
    disc(x0 + per * 0.75, cy - A * 0.25, span * 0.07, 0.85);
    for (let q = 0; q < 6; q++){ const a = q / 6 * Math.PI * 2; disc(x0 + per * 0.75 + Math.cos(a) * span * 0.09, cy - A * 0.25 + Math.sin(a) * span * 0.09, span * 0.035, 0.7); }
  }
  // фон поля слегка утоплен (0.2), рельеф сверху
  for (let y = plainRows; y < H; y++) for (let x = 0; x < W; x++){ const i = y * W + x; h[i] = Math.max(h[i], 0.2); }
  blurField(h, W, H, 1, false);
  // нормали
  const nrm = normalCanvas(h, W, H, 7.5, false);
  // цвет: в углублениях темнее (читается даже без бликов), на гребнях — светлее
  const col = canvas(W, H), g = col.getContext("2d"), img = g.createImageData(W, H), d = img.data;
  const rough = canvas(W, H), rg = rough.getContext("2d"), rimg = rg.createImageData(W, H), rd = rimg.data;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++){
    const i = y * W + x, v = h[i];
    const k = y < plainRows ? 1 : 0.42 + 0.7 * clamp01((v - 0.15) / 0.8);
    d[i * 4] = Math.min(255, 255 * k); d[i * 4 + 1] = Math.min(255, 247 * k); d[i * 4 + 2] = Math.min(255, 232 * k); d[i * 4 + 3] = 255;
    const r = y < plainRows ? 0.22 : 0.46 - 0.32 * clamp01((v - 0.2) / 0.75);   // гребни полированы, фон — матовее
    rd[i * 4] = 0; rd[i * 4 + 1] = Math.round(r * 255); rd[i * 4 + 2] = 255; rd[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0); rg.putImageData(rimg, 0, 0);
  return { color: col, normal: nrm, rough };
}
// нарисованный фриз (assets/tex/frieze.*) → рельеф по яркости (для золотого пояса)
function frieze2maps(image){
  const W = 512, H = Math.max(32, Math.round(512 * image.height / image.width));
  const src = canvas(W, H), sg = src.getContext("2d");
  sg.drawImage(image, 0, 0, W, H);
  const px = sg.getImageData(0, 0, W, H).data;
  const h = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) h[i] = (px[i * 4] * 0.3 + px[i * 4 + 1] * 0.55 + px[i * 4 + 2] * 0.15) / 255;
  blurField(h, W, H, 1, false);
  // цвет — только светлота рельефа (0.45…1.05, как у процедурного орнамента): оттенок золота даёт материал,
  // иначе нарисованное «золото» умножалось бы на золото ещё раз и выгорало
  let lo = 1, hi = 0; for (const v of h){ if (v < lo) lo = v; if (v > hi) hi = v; }
  const col = canvas(W, H), g = col.getContext("2d"), img = g.createImageData(W, H), d = img.data;
  for (let i = 0; i < W * H; i++){
    const k = 0.45 + 0.6 * clamp01((h[i] - lo) / Math.max(1e-3, hi - lo));
    d[i * 4] = Math.min(255, 255 * k); d[i * 4 + 1] = Math.min(255, 247 * k); d[i * 4 + 2] = Math.min(255, 232 * k); d[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return { color: col, normal: normalCanvas(h, W, H, 5, false) };
}

// ---------- ОКНО-АРКА: день — тёплое стекло с отражением неба, ночь — тёплый свет изнутри ----------
function paintWindow(night){
  const W = 128, H = 256, c = canvas(W, H), g = c.getContext("2d");
  const archR = W / 2;                                   // арка — верхние W/2 пикселей
  if (night){
    const gr = g.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, "#ffcf8a"); gr.addColorStop(0.45, "#ffb865"); gr.addColorStop(1, "#ff9a48");
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    const rg = g.createRadialGradient(W / 2, H * 0.62, 4, W / 2, H * 0.62, H * 0.55);
    rg.addColorStop(0, "rgba(255,244,214,0.95)"); rg.addColorStop(1, "rgba(255,190,110,0)");
    g.fillStyle = rg; g.fillRect(0, 0, W, H);
  } else {
    const gr = g.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, "#c9c4f0"); gr.addColorStop(0.35, "#f1c8c8"); gr.addColorStop(0.7, "#f6cf9f"); gr.addColorStop(1, "#e7ad69");
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    // косой блик на стекле
    g.save(); g.globalAlpha = 0.28; g.fillStyle = "#fffaf0";
    g.beginPath(); g.moveTo(W * 0.15, H); g.lineTo(W * 0.45, H); g.lineTo(W * 0.95, H * 0.2); g.lineTo(W * 0.75, H * 0.2); g.closePath(); g.fill();
    g.restore();
  }
  // переплёт: вертикаль по центру, две горизонтали, лучи в арке
  g.strokeStyle = night ? "rgba(96,58,52,0.85)" : "rgba(246,232,204,0.95)"; g.lineWidth = 6; g.lineCap = "round";
  g.beginPath(); g.moveTo(W / 2, archR * 0.35); g.lineTo(W / 2, H); g.stroke();
  for (const t of [0.5, 0.76]){ g.beginPath(); g.moveTo(0, H * t); g.lineTo(W, H * t); g.stroke(); }
  g.beginPath(); g.moveTo(0, archR); g.lineTo(W, archR); g.stroke();
  for (const a of [-0.55, 0.55]){ g.beginPath(); g.moveTo(W / 2, archR); g.lineTo(W / 2 + Math.sin(a) * archR, archR - Math.cos(a) * archR); g.stroke(); }
  g.lineWidth = 4; g.beginPath(); g.arc(W / 2, archR, archR * 0.42, Math.PI, 0); g.stroke();
  return c;
}

// ---------- НАРИСОВАННЫЕ ТЕКСТУРЫ (необязательно): assets/tex/manifest.json { "facade-day": "facade-day.jpg", … } ----------
// Манифест лежит рядом с текстурами всегда (пустой — {}), поэтому запрос не даёт 404 в консоли, даже когда
// картинок ещё нет. Положил файл → вписал в манифест → загрузчик подхватит при следующей загрузке уровня.
let _manifest = null;
async function paintedManifest(){
  if (_manifest) return _manifest;
  try {
    const r = await fetch(TEX_DIR + "manifest.json", { cache: "no-cache" });
    _manifest = r.ok ? await r.json() : {};
  } catch (e){ _manifest = {}; }
  return _manifest;
}
function loadImage(url){
  return new Promise(res => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = url; });
}
// { facade, floor, frieze } — Image или null
export async function loadPainted(night){
  const man = await paintedManifest();
  const want = { facade: night ? "facade-night" : "facade-day", floor: "floor", frieze: "frieze" };
  const out = {};
  await Promise.all(Object.entries(want).map(async ([k, name]) => {
    const f = man[name];
    out[k] = typeof f === "string" && f ? await loadImage(TEX_DIR + f) : null;
  }));
  return out;
}

// ---------- МАТЕРИАЛЫ ----------
// «Дымка» — атрибут aHaze (0…1) у геометрии: после освещения цвет смешивается с uHaze (глубина к облакам
// внизу фасадов). Нет атрибута — нет дымки (значение по умолчанию 0 задаёт сама геометрия Batch).
function withHaze(mat, hazeColor, key){
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    sh.uniforms.uHaze = { value: new THREE.Color(hazeColor) };
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aHaze;\nvarying float vHaze;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvHaze = aHaze;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec3 uHaze;\nvarying float vHaze;")
      .replace("#include <opaque_fragment>", "#include <opaque_fragment>\ngl_FragColor.rgb = mix(gl_FragColor.rgb, uHaze, clamp(vHaze, 0.0, 1.0));");
    mat.userData.shader = sh;
  };
  mat.customProgramCacheKey = () => "arch-" + key;
  return mat;
}

// набор материалов уровня. night — лунная гамма; painted — результат loadPainted(); haze — цвет дымки
// lite (q=low) — без лака (MeshStandardMaterial вместо Physical): дешевле на слабых видеокартах
export function createArchMaterials(renderer, { night = false, painted = {}, haze = 0xf3c9c4, lite = false } = {}){
  const Phys = lite ? (o => { delete o.clearcoat; delete o.clearcoatRoughness; return new THREE.MeshStandardMaterial(o); }) : (o => new THREE.MeshPhysicalMaterial(o));
  const P = night ? MARBLE_NIGHT : MARBLE_DAY;
  const disposables = [];
  const keep = t => { disposables.push(t); return t; };

  // мрамор фасадов и колонн
  const marbleTex = keep(finish(paintMarble(512, 512, 11, P), renderer));
  // фасад нижних этажей и башен: нарисованный (если есть) или тот же мрамор
  let facadeTex = marbleTex, facadePainted = false;
  if (painted.facade){
    facadeTex = keep(new THREE.Texture(painted.facade)); facadeTex.needsUpdate = true;
    facadeTex.colorSpace = THREE.SRGBColorSpace; facadeTex.wrapS = THREE.RepeatWrapping; facadeTex.wrapT = THREE.ClampToEdgeWrapping;
    facadeTex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    facadePainted = true;
  }
  const floor = paintFloor(512, 256, 23, night);
  let floorTex = keep(finish(floor.color, renderer, { clampV: true }));
  const floorMR = keep(finish(floor.mr, renderer, { srgb: false, clampV: true }));
  let floorPainted = false;
  if (painted.floor){
    floorTex = keep(new THREE.Texture(painted.floor)); floorTex.needsUpdate = true;
    floorTex.colorSpace = THREE.SRGBColorSpace; floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
    floorTex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    floorPainted = true;
  }
  const orn = paintOrnament(512, 144);
  let ornColor = keep(finish(orn.color, renderer, { clampV: true }));
  let ornNormal = keep(finish(orn.normal, renderer, { srgb: false, clampV: true }));
  const ornRough = keep(finish(orn.rough, renderer, { srgb: false, clampV: true }));
  if (painted.frieze){
    const fm = frieze2maps(painted.frieze);
    ornColor = keep(finish(fm.color, renderer, { clampV: true }));
    ornNormal = keep(finish(fm.normal, renderer, { srgb: false, clampV: true }));
  }
  const winTex = keep(finish(paintWindow(night), renderer, { repeat: false }));

  const hazeC = new THREE.Color(haze);
  const envK = night ? 1.0 : 1.0;
  // мрамор: лёгкий лак (clearcoat) — отражает небо/город, кромки и колонны ловят блики
  const marble = withHaze(Phys({
    map: marbleTex, vertexColors: true, roughness: 0.3, metalness: 0,
    clearcoat: 0.75, clearcoatRoughness: 0.1, envMapIntensity: 0.55 * envK,
  }), hazeC, "marble");
  const facade = facadePainted ? withHaze(Phys({
    map: facadeTex, vertexColors: true, roughness: 0.4, metalness: 0,
    clearcoat: 0.35, clearcoatRoughness: 0.2, envMapIntensity: 0.6 * envK,
  }), hazeC, "facade") : marble;
  // пол: полированные плиты, золотая инкрустация — металл (карта G/B)
  const floorMat = withHaze(Phys({
    map: floorTex, vertexColors: true, roughness: 1, metalness: 1,
    roughnessMap: floorPainted ? null : floorMR, metalnessMap: floorPainted ? null : floorMR,
    clearcoat: 0.7, clearcoatRoughness: 0.08, envMapIntensity: 0.7 * envK,
  }), hazeC, "floor");
  if (floorPainted){ floorMat.roughness = 0.22; floorMat.metalness = 0; }
  // золото с орнаментом (рельеф — normalMap), гладкое — верхняя полоса текстуры
  const gold = withHaze(new THREE.MeshStandardMaterial({
    map: ornColor, normalMap: ornNormal, normalScale: new THREE.Vector2(1, 1), roughnessMap: ornRough,
    vertexColors: true, roughness: 1, metalness: 1, envMapIntensity: 1.7 * envK,
  }), hazeC, "gold");
  const chrome = withHaze(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.07, metalness: 1, envMapIntensity: 1.25 * envK }), hazeC, "chrome");
  // ночь: общий свет намеренно тусклый и холодный (levels/index.js), а в ночных задниках здания — тёплые,
  // подсвеченные окнами и фонарями. Тёплая «подсветка» (emissive по той же текстуре — прожилки видны)
  // держит мрамор кремовым, а не серым; лунный свет сверху добавляет голубоватые блики.
  if (night){
    marble.emissive.set(0xa88763); marble.emissiveMap = marbleTex; marble.emissiveIntensity = 0.55;
    floorMat.emissive.set(0xa08463); floorMat.emissiveMap = floorTex; floorMat.emissiveIntensity = 0.5;
    gold.emissive.set(0x6b4413); gold.emissiveMap = ornColor; gold.emissiveIntensity = 0.55;
    chrome.emissive.set(0x2a2a44); chrome.emissiveIntensity = 0.5;
    if (facade !== marble){ facade.emissive.set(0x8a7560); facade.emissiveMap = facadeTex; facade.emissiveIntensity = 0.42; }
  }
  // стекло окон: днём — тёплое стекло с лёгким свечением, ночью — яркий тёплый свет (выше порога bloom)
  const glass = withHaze(new THREE.MeshStandardMaterial({
    map: winTex, emissiveMap: winTex, emissive: new THREE.Color(night ? 0xffffff : 0xffe2c0),
    emissiveIntensity: night ? 1.9 : 0.32, vertexColors: true, roughness: 0.12, metalness: night ? 0 : 0.35,
    envMapIntensity: night ? 0.3 : 0.9,
  }), hazeC, "glass");
  // яркость окна задаёт вершинный цвет (часть окон ночью не горит) — множим на него и свечение
  const gPrev = glass.onBeforeCompile;
  glass.onBeforeCompile = (sh, r) => {
    gPrev(sh, r);
    sh.fragmentShader = sh.fragmentShader.replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n#ifdef USE_COLOR\ntotalEmissiveRadiance *= vColor.rgb;\n#endif");
  };
  glass.customProgramCacheKey = () => "arch-glass" + (night ? "-n" : "-d");

  return {
    marble, facade, floor: floorMat, gold, chrome, glass, facadePainted, floorPainted,
    textures: { marbleTex, floorTex, ornColor, ornNormal, winTex },
    dispose(){ for (const t of disposables) t.dispose(); for (const m of new Set([marble, facade, floorMat, gold, chrome, glass])) m.dispose(); },
  };
}
