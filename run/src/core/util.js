// Утилиты: сидированный Math.random (?seed), rnd/pick/clamp/lerp/damp, canvasTex.
import * as THREE from "three";

// mulberry32 — тот же генератор, что был в legacy/run.js (сравнимые скриншоты)
export function makeRng(seed){
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ?seed=N подменяет Math.random: визуальный поток становится детерминированным.
// Вызывать ДО создания любых объектов three (uuid тоже берёт Math.random).
export let seed = null;
export function installSeed(qp){
  if (!qp.has("seed")) return null;
  seed = (+qp.get("seed") || 1) >>> 0;
  Math.random = makeRng(seed);
  return seed;
}

export const clamp = (v,a,b) => Math.max(a, Math.min(b, v));
export const lerp = (a,b,t) => a + (b-a)*t;
export const rnd = (a,b) => a + Math.random()*(b-a);
export const pick = arr => arr[Math.floor(Math.random()*arr.length)];
// кадро-независимое сглаживание: damp(x, цель, резкость, dt)
export const damp = (a,b,lambda,dt) => a + (b-a)*(1 - Math.exp(-lambda*dt));

export function canvasTex(w, h, draw, rep){
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (rep){ t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep[0], rep[1]); }
  t.anisotropy = 8;
  return t;
}
