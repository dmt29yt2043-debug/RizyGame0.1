// Процедурные текстуры Ризи: вязаный свитер с войлочными цветами, бороздки волос (bump).
// Всё рисуется в canvas один раз при сборке; рандом детерминированный — кадры скриншотов совпадают.
import * as THREE from "three";

function rng(seed){
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function canvas(w, h){ const c = document.createElement("canvas"); c.width = w; c.height = h; return c; }
function toTex(c, srgb, aniso){
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso || 4;
  return t;
}

// Свитер: чёрная вязка + цветы-аппликации (лайм с синей серединкой, синие и голубые с лаймовой).
// Развёртка 2:1 — u вокруг торса (≈1.45 м), v по высоте (≈0.72 м).
export function sweaterTexture(q){
  const W = q === "low" ? 512 : 1024, H = W >> 1, k = W / 1024;
  const c = canvas(W, H), g = c.getContext("2d"), R = rng(11);
  g.fillStyle = "#14151d"; g.fillRect(0, 0, W, H);
  // вязка: столбики «косичкой» — светлые и тёмные зёрна, на расстоянии читается как мягкий трикотаж
  const cw = 12 * k, ch = 11 * k;
  for (let x = 0; x < W; x += cw){
    for (let y = 0; y < H; y += ch){
      for (const s of [-1, 1]){
        g.fillStyle = s < 0 ? "rgba(255,255,255,0.045)" : "rgba(0,0,0,0.22)";
        g.beginPath(); g.ellipse(x + cw * (0.5 + 0.22 * s), y + ch * 0.5, cw * 0.26, ch * 0.52, -0.55 * s, 0, 7); g.fill();
      }
    }
  }
  // цветы: сетка с дрожанием, рисуем с заворотом по u (шов не виден)
  const cols = 12, rows = 5, cellW = W / cols, cellH = H / rows;
  const KINDS = [
    { petal: "#C8F53C", dark: "#86a81f", center: "#2f6df0" },
    { petal: "#3b82ff", dark: "#1f4fb8", center: "#C8F53C" },
    { petal: "#C8F53C", dark: "#86a81f", center: "#15161d" },
    { petal: "#62b7ff", dark: "#2f78c4", center: "#C8F53C" },
  ];
  function flower(x, y, r, K, rot){
    for (const pass of [0, 1, 2]){
      for (let p = 0; p < 5; p++){
        const a = rot + p * Math.PI * 2 / 5;
        const px = x + Math.cos(a) * r * 0.56, py = y + Math.sin(a) * r * 0.56;
        if (pass === 0){ g.fillStyle = "rgba(0,0,0,0.45)"; g.beginPath(); g.arc(px + 1.5 * k, py + 2.5 * k, r * 0.5, 0, 7); g.fill(); }
        else if (pass === 1){ g.fillStyle = K.dark; g.beginPath(); g.arc(px, py, r * 0.5, 0, 7); g.fill(); }
        else {
          // войлочный объём: светлее к центру лепестка
          const gr = g.createRadialGradient(px - r * 0.08, py - r * 0.1, r * 0.05, px, py, r * 0.48);
          gr.addColorStop(0, K.petal); gr.addColorStop(0.8, K.petal); gr.addColorStop(1, K.dark);
          g.fillStyle = gr; g.beginPath(); g.arc(px, py, r * 0.46, 0, 7); g.fill();
        }
      }
    }
    g.fillStyle = K.center; g.beginPath(); g.arc(x, y, r * 0.26, 0, 7); g.fill();
    g.fillStyle = "rgba(255,255,255,0.35)"; g.beginPath(); g.arc(x - r * 0.07, y - r * 0.08, r * 0.08, 0, 7); g.fill();
  }
  for (let j = 0; j < rows; j++){
    for (let i = 0; i < cols; i++){
      const x = (i + 0.5 + (j % 2) * 0.5 + (R() - 0.5) * 0.35) * cellW;
      const y = (j + 0.5 + (R() - 0.5) * 0.3) * cellH;
      const r = cellH * (0.3 + R() * 0.07);
      const K = KINDS[(i * 3 + j * 2 + (R() * 2 | 0)) % KINDS.length];
      const rot = R() * 6.28;
      for (const dx of [-W, 0, W]) flower(x + dx, y, r, K, rot);
    }
  }
  return toTex(c, true, 8);
}

// Бороздки волос для bumpMap: вертикальные «пряди» с лёгким волнением; 16 прядей на повтор по u.
export function hairBumpTexture(q){
  const W = q === "low" ? 128 : 256, H = W;
  const c = canvas(W, H), g = c.getContext("2d"), img = g.createImageData(W, H), d = img.data, R = rng(5);
  const N = 16, ph = new Float32Array(N), wd = new Float32Array(N);
  for (let i = 0; i < N; i++){ ph[i] = R() * 6.28; wd[i] = 0.75 + R() * 0.5; }
  for (let y = 0; y < H; y++){
    for (let x = 0; x < W; x++){
      const v = y / H;
      const u = x / W * N + 0.18 * Math.sin(v * 6.283 * 2 + ph[(x / W * N) | 0]);
      const cell = ((u % N) + N) % N, f = cell - Math.floor(cell), w = wd[Math.floor(cell) % N];
      // профиль пряди: круглый валик, узкая тёмная щель между прядями
      const s = Math.pow(Math.sin(Math.PI * Math.min(1, f / w * 0.98 + 0.01)), 0.6);
      const val = Math.max(0, Math.min(255, 40 + 210 * s + (R() - 0.5) * 10));
      const o = (y * W + x) * 4; d[o] = d[o + 1] = d[o + 2] = val; d[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return toTex(c, false, 4);
}
