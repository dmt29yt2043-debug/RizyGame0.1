// VFX-кит: процедурный атлас 256×256 (рисуется на canvas один раз).
// Ячейки 2×2: [0] облачко A, [1] облачко B, [2] звезда-блик (4 луча + диагонали), [3] снежинка-кристалл.
// Каналы: R — «освещённость» (верх-слева светлее, для объёма облачка), A — маска формы. G/B = 255.
// Остальные формы (круг, кольцо, штрих, конфетти) считаются прямо в шейдере — чёткие на любом размере.
import * as THREE from "three";

// свой ГПСЧ: атлас одинаков при любом ?seed
function rng(seed){
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function createAtlas(){
  const S = 256, C = 128;
  const cv = document.createElement("canvas"); cv.width = S; cv.height = S;
  const g = cv.getContext("2d");
  const im = g.createImageData(S, S), D = im.data;

  // облачко: объединение мягких шаров, освещение по нормали «сферы» каждого шара
  function puff(ox, oy, seed){
    const r = rng(seed), blobs = [];
    blobs.push([0, 0.06, 0.52]);
    for (let i = 0; i < 6; i++){
      const a = i / 6 * Math.PI * 2 + r() * 0.7, d = 0.28 + r() * 0.16;
      blobs.push([Math.cos(a) * d, Math.sin(a) * d * 0.85 + 0.04, 0.26 + r() * 0.14]);
    }
    for (let y = 0; y < C; y++) for (let x = 0; x < C; x++){
      const u = (x + 0.5) / C * 2 - 1, v = (y + 0.5) / C * 2 - 1;
      let dens = 0, lit = 0, wsum = 0;
      for (const [bx, by, br] of blobs){
        const dx = (u - bx) / br, dy = (v - by) / br, q = dx * dx + dy * dy;
        if (q >= 1) continue;
        const h = Math.sqrt(1 - q);                 // высота «сферы»
        const w = (1 - q) * (1 - q);
        dens += w;
        // свет сверху-слева (экранный y вниз): n·L
        const nl = Math.max(0, -dx * 0.35 - dy * 0.6 + h * 0.72);
        lit += nl * w; wsum += w;
      }
      const a = sstep(0.05, 0.55, dens) * sstep(1.0, 0.86, Math.hypot(u, v));
      const L = wsum > 0 ? Math.min(1, 0.35 + lit / wsum * 0.75) : 1;
      const i = ((oy + y) * S + ox + x) * 4;
      D[i] = L * 255; D[i + 1] = 255; D[i + 2] = 255; D[i + 3] = a * 255;
    }
  }

  // звезда-блик: яркое ядро, 4 длинных луча, 4 коротких диагональных
  function star(ox, oy){
    for (let y = 0; y < C; y++) for (let x = 0; x < C; x++){
      const dx = (x + 0.5) / C * 2 - 1, dy = (y + 0.5) / C * 2 - 1, r2 = dx * dx + dy * dy;
      const ax = Math.abs(dx), ay = Math.abs(dy);
      const ray = Math.exp(-ay * ay * 700) * Math.pow(Math.max(0, 1 - ax), 2.4) + Math.exp(-ax * ax * 700) * Math.pow(Math.max(0, 1 - ay), 2.4);
      const du = Math.abs(dx + dy) * 0.7071, dv = Math.abs(dx - dy) * 0.7071;
      const diag = (Math.exp(-dv * dv * 1200) * Math.pow(Math.max(0, 1 - du * 2.2), 2) + Math.exp(-du * du * 1200) * Math.pow(Math.max(0, 1 - dv * 2.2), 2)) * 0.4;
      const a = Math.min(1, ray + diag + Math.exp(-r2 * 40) + Math.exp(-r2 * 6) * 0.22);
      const i = ((oy + y) * S + ox + x) * 4;
      D[i] = 255; D[i + 1] = 255; D[i + 2] = 255; D[i + 3] = a * 255;
    }
  }

  // снежинка: 6 мягких лучей с веточками + круглое ядро (для блёсток в подкате)
  function flake(ox, oy){
    for (let y = 0; y < C; y++) for (let x = 0; x < C; x++){
      const u = (x + 0.5) / C * 2 - 1, v = (y + 0.5) / C * 2 - 1, r = Math.hypot(u, v);
      let a = 0;
      for (let k = 0; k < 6; k++){
        const ang = k * Math.PI / 3, cx = Math.cos(ang), sy = Math.sin(ang);
        const along = u * cx + v * sy, across = -u * sy + v * cx;
        if (along > 0 && along < 0.9) a = Math.max(a, Math.exp(-across * across * 900) * (1 - along / 0.95));
        // веточки под 60° на середине луча
        for (const s of [-1, 1]){
          const bx = along - 0.5, bang = s * Math.PI / 3;
          const ba = bx * Math.cos(bang) + across * Math.sin(bang), bc = -bx * Math.sin(bang) + across * Math.cos(bang);
          if (ba > 0 && ba < 0.28) a = Math.max(a, Math.exp(-bc * bc * 1100) * (1 - ba / 0.3) * 0.9);
        }
      }
      a = Math.min(1, a + Math.exp(-r * r * 60) * 0.9) * sstep(1, 0.9, r);
      const i = ((oy + y) * S + ox + x) * 4;
      D[i] = 255; D[i + 1] = 255; D[i + 2] = 255; D[i + 3] = a * 255;
    }
  }

  puff(0, 0, 11); puff(C, 0, 29); star(0, C); flake(C, C);
  g.putImageData(im, 0, 0);

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.NoColorSpace;          // данные, а не цвет
  tex.premultiplyAlpha = false;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.name = "fx:atlas";
  return tex;
}
