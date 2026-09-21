// Процедурные текстуры Ризи: атлас ткани (чёрная вязка / резинка / синий деним со строчкой) и бороздки пряжи (bump).
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

// Области атласа по v (u тайлится по всей ширине): вязка свитера, резинка (низ/манжеты/ворот), деним джинсов.
// stitch — v строчки подгиба внутри денима (низ штанин мапится чуть ниже неё).
export const ATLAS = { knit: [0.0, 0.56], rib: [0.585, 0.675], denim: [0.70, 1.0], stitch: 0.965 };

export function clothAtlas(q){
  const W = q === "low" ? 512 : 1024, H = W >> 1, k = W / 1024;
  const c = canvas(W, H), g = c.getContext("2d"), R = rng(11);
  const Y = v => Math.round((1 - v) * H);                    // v атласа → y холста (flipY)
  g.fillStyle = "#15121a"; g.fillRect(0, 0, W, H);
  // --- вязка: столбики лицевой глади «косичкой» — светлые и тёмные зёрна, на расстоянии мягкий трикотаж ---
  {
    const y0 = Y(ATLAS.knit[1]), y1 = Y(ATLAS.knit[0]), cw = 16 * k, ch = 12 * k;
    for (let x = 0; x < W; x += cw){
      for (let y = y0; y < y1; y += ch){
        for (const s of [-1, 1]){
          g.fillStyle = s < 0 ? "rgba(255,255,255,0.075)" : "rgba(0,0,0,0.32)";
          g.beginPath(); g.ellipse(x + cw * (0.5 + 0.22 * s), y + ch * 0.5, cw * 0.22, ch * 0.5, -0.6 * s, 0, 7); g.fill();
        }
      }
    }
  }
  // --- резинка: вертикальные рубчики 2×1 ---
  {
    const y0 = Y(ATLAS.rib[1]), y1 = Y(ATLAS.rib[0]), p = 16 * k;
    g.fillStyle = "#110e15"; g.fillRect(0, y0, W, y1 - y0);
    for (let x = 0; x < W; x += p){
      g.fillStyle = "rgba(255,255,255,0.11)"; g.fillRect(x + p * 0.12, y0, p * 0.34, y1 - y0);
      g.fillStyle = "rgba(0,0,0,0.4)"; g.fillRect(x + p * 0.62, y0, p * 0.3, y1 - y0);
    }
  }
  // --- деним: ярко-синяя саржа (диагональные нити) + крап + светлая строчка подгиба ---
  {
    const y0 = Y(ATLAS.denim[1]), y1 = Y(ATLAS.denim[0]), h = y1 - y0, p = 4 * k;
    g.fillStyle = "#1f4de0"; g.fillRect(0, y0, W, h);
    g.save(); g.beginPath(); g.rect(0, y0, W, h); g.clip();
    g.lineWidth = 1.3 * k;
    for (let d = -h - p; d < W + p; d += p){
      g.strokeStyle = "rgba(255,255,255,0.075)"; g.beginPath(); g.moveTo(d, y0); g.lineTo(d + h, y1); g.stroke();
      g.strokeStyle = "rgba(0,0,0,0.17)"; g.beginPath(); g.moveTo(d + p * 0.5, y0); g.lineTo(d + p * 0.5 + h, y1); g.stroke();
    }
    for (let i = 0; i < 2600 * k * k; i++){
      g.fillStyle = R() < 0.5 ? "rgba(255,255,255,0.11)" : "rgba(0,0,0,0.2)";
      g.fillRect(R() * W, y0 + R() * h, 2.2 * k, 1.2 * k);
    }
    const ys = Y(ATLAS.stitch);
    g.fillStyle = "rgba(120,160,255,0.45)"; g.fillRect(0, ys - 2 * k, W, 1.6 * k);
    g.fillStyle = "rgba(20,30,110,0.6)"; for (let x = 0; x < W; x += 9 * k) g.fillRect(x, ys - 2 * k, 4 * k, 1.6 * k);
    g.fillStyle = "rgba(120,160,255,0.3)"; g.fillRect(0, ys + 4 * k, W, 1.4 * k);
    g.restore();
  }
  return toTex(c, true, 8);
}

// Бороздки пряжи для bumpMap: параллельные «плайсы» с лёгким волнением; 16 на повтор по u.
// На трубках прядей u = доля окружности + кручение по длине → нити спиралью, как у кручёной пряжи.
export function hairBumpTexture(q){
  const W = q === "low" ? 128 : 256, H = W;
  const c = canvas(W, H), g = c.getContext("2d"), img = g.createImageData(W, H), d = img.data, R = rng(5);
  const N = 16, ph = new Float32Array(N), wd = new Float32Array(N);
  for (let i = 0; i < N; i++){ ph[i] = R() * 6.28; wd[i] = 0.8 + R() * 0.4; }
  for (let y = 0; y < H; y++){
    for (let x = 0; x < W; x++){
      const v = y / H;
      const u = x / W * N + 0.14 * Math.sin(v * 6.283 * 2 + ph[(x / W * N) | 0]);
      const cell = ((u % N) + N) % N, f = cell - Math.floor(cell), w = wd[Math.floor(cell) % N];
      // профиль плайса: круглый валик, узкая тёмная щель между
      const s = Math.pow(Math.sin(Math.PI * Math.min(1, f / w * 0.98 + 0.01)), 0.7);
      const val = Math.max(0, Math.min(255, 50 + 200 * s + (R() - 0.5) * 12));
      const o = (y * W + x) * 4; d[o] = d[o + 1] = d[o + 2] = val; d[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return toTex(c, false, 4);
}
