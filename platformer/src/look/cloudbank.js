// Облака под ярусами: низ каждого блока (ниже «среза», layout.js) тонет в облаке — как дома на нарисованных
// задниках утопают в облачном море. Облако — полоса той же нарисованной текстуры облаков задника (clouds.png /
// clouds-night.png, её нижняя «гряда» с пушистым верхним краем), плоскость чуть перед фасадом; края по x —
// мягкие (альфа вершин), верх — собственная пушистая кромка картинки. Один меш на весь уровень (1 draw call).
import * as THREE from "three";
import { blockLayout } from "./layout.js";
import { ZF } from "./walls.js";
import { makeRng } from "./tex.js";

// кусок картинки облаков: v от V_BOT (низ гряды) до V_TOP (пушистый верх) — см. профиль альфы clouds*.png
const V_TOP = 0.47, V_BOT = 0.04;
const TEX_W = 22;                                 // мировых единиц на ширину картинки
const IMG_W = 1536, IMG_H = 1024;
const H = (V_TOP - V_BOT) * IMG_H / (IMG_W / TEX_W);   // высота полосы в мировых ед. (≈ 6.2)
const ABOVE = 2.1;                                // верх полосы над срезом
const Z = ZF + 1.15;                              // перед каскадами цветов на фасаде
const MARGIN = 0.9, EDGE = 1.1, MIN_W = 5.0;      // вынос за края блока, ширина мягкого края, мин. ширина

export function createCloudBanks(level){
  const rnd = makeRng(1717);
  const pos = [], uv = [], col = [], idx = [];
  const info = blockLayout(level);
  for (const it of info){
    const s = it.s;
    // узкие блоки (колонны) — облако не уже MIN_W, иначе мягкие края съедают всю плотность
    const cxm = (s.x0 + s.x1) / 2, half = Math.max((s.x1 - s.x0) / 2 + MARGIN, MIN_W / 2);
    const x0 = cxm - half, x1 = cxm + half;
    const yT = it.cut + ABOVE, yB = yT - H;
    const u0 = rnd() * 2;
    // колонки сетки: мягкие края (альфа 0 → 1 на EDGE), середина — одна колонка
    const xs = [x0, x0 + EDGE, x1 - EDGE, x1].filter((x, i, a) => i === 0 || x > a[i - 1] + 1e-3);
    const ys = [yT, yT - 1.0, yB + 1.2, yB];                 // верхняя строка — альфа 0: край квада не виден
    const base = pos.length / 3;
    for (let j = 0; j < ys.length; j++){
      for (let i = 0; i < xs.length; i++){
        const x = xs[i], y = ys[j];
        pos.push(x, y, Z + (i % 2 ? 0.02 : 0));
        uv.push(u0 + (x - x0) / TEX_W, V_TOP - (yT - y) / H * (V_TOP - V_BOT));
        const edge = i === 0 || i === xs.length - 1 ? 0 : 1;
        const vert = j === 0 || j === ys.length - 1 ? 0 : 1;
        col.push(1, 1, 1, edge * vert);
      }
    }
    const nx = xs.length;
    for (let j = 0; j < ys.length - 1; j++) for (let i = 0; i < nx - 1; i++){
      const a = base + j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 4));
  g.setIndex(idx);
  g.computeBoundingSphere();
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, fog: false, opacity: 0 });
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = "cloud-banks"; mesh.renderOrder = 1; mesh.frustumCulled = false;
  return {
    mesh,
    // текстура облаков задника (своя копия с зеркальным повтором по x, без дрейфа)
    setTexture(src){
      if (!src || !src.image) return;
      const t = src.clone();
      t.wrapS = THREE.MirroredRepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
      t.repeat.set(1, 1); t.offset.set(0, 0); t.needsUpdate = true;
      mat.map = t; mat.opacity = 1; mat.needsUpdate = true;
      mesh.userData.tex = t;
    },
    dispose(){ g.dispose(); if (mesh.userData.tex) mesh.userData.tex.dispose(); mat.dispose(); },
  };
}
