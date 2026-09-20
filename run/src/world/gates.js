// world-kit: ворота-рубежи и флаг «РЕКОРД» (WORLD-7).
// Рубеж: фонарные ворота с надписью «250 м» на каждой кратной step дистанции, выходят из-за горизонта
// вместе с обычным спавном. Флаг рекорда: если best > 100, ставится ровно на дистанции best; при пересечении — emit("record").
// По одному экземпляру на тип: шаг ≥ 200 м больше окна видимости (AHEAD + BEHIND = 133 м). Надписи — CanvasTexture,
// перерисовываются только при смене числа (не в кадре). 3–4 draw call на всё.
import * as THREE from "three";
import { GeoBuilder, M, loadKitFont, SIGN_FONT } from "./util.js";
import * as PR from "./props.js";

const PI = Math.PI;
const { rbox, cyl, cone, sph } = PR;
export const GATE_AHEAD = 118, GATE_BEHIND = 15;

function labelCanvas(w, h){
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}
function star(g, x, y, r1, r2){
  g.beginPath();
  for (let i = 0; i < 10; i++){ const a = i * PI / 5 - PI / 2, rr = i % 2 ? r2 : r1; g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
  g.fill();
}
// рубеж: кремовая доска, синие цифры (без лайма: это не награда)
function drawMilestone(tex, meters){
  const c = tex.image, g = c.getContext("2d"), w = c.width, h = c.height;
  g.clearRect(0, 0, w, h);
  g.fillStyle = "#FFF8EC"; g.beginPath(); g.roundRect(6, 6, w - 12, h - 12, 70); g.fill();
  g.strokeStyle = "#0536D4"; g.lineWidth = 16; g.beginPath(); g.roundRect(24, 24, w - 48, h - 48, 54); g.stroke();
  g.fillStyle = "#0536D4"; g.textAlign = "center"; g.textBaseline = "middle";
  g.font = "900 150px " + SIGN_FONT;
  g.fillText(`${meters} м`, w / 2, h / 2 + 10);
  tex.needsUpdate = true;
}
// рекорд: синий флаг, белый текст, лаймовые звёзды (рекорд — событие-награда)
function drawRecord(tex, best){
  const c = tex.image, g = c.getContext("2d"), w = c.width, h = c.height;
  g.clearRect(0, 0, w, h);
  g.fillStyle = "#0536D4"; g.beginPath(); g.roundRect(6, 6, w - 12, h - 12, 60); g.fill();
  g.strokeStyle = "#FFFFFF"; g.lineWidth = 12; g.beginPath(); g.roundRect(22, 22, w - 44, h - 44, 46); g.stroke();
  g.fillStyle = "#FFFFFF"; g.textAlign = "center"; g.textBaseline = "middle";
  g.font = "900 96px " + SIGN_FONT;
  g.fillText("РЕКОРД", w / 2, h * 0.36);
  g.font = "900 84px " + SIGN_FONT;
  g.fillText(`${Math.round(best)} м`, w / 2, h * 0.7);
  g.fillStyle = "#C0FF3F";
  star(g, 92, h / 2, 40, 17); star(g, w - 92, h / 2, 40, 17);
  tex.needsUpdate = true;
}

export function createGates(mats, o){
  const emit = o.emit || (() => {});
  const step = o.step > 0 ? o.step : 250;
  const group = new THREE.Group(); group.name = "world:gates";
  const owned = [];

  // ---------- ворота-рубеж: два фонарных столба 5.4 м, перекладина-гирлянда, доска с числом на 6.3 м ----------
  const ms = new THREE.Group(); ms.name = "gate:milestone";
  {
    const c = new GeoBuilder(), gl = new GeoBuilder(), navy = 0x3C4C9A;
    for (const s of [-1, 1]){
      const x = s * 5.75;
      c.add(rbox(0.6, 0.5, 0.6, 0.1), navy, M(x, 0.25, 0), { ao: [0, 0.5, 0.65] });
      c.add(cyl(0.13, 0.16, 5.0, 12, 8), 0xF3EEF6, M(x, 2.9, 0), { stripe: { period: 0.42, len: 5.0, turns: 1 } });
      c.add(cyl(0.3, 0.22, 0.12, 12), navy, M(x, 5.45, 0));
      c.add(cone(0.42, 0.42, 4), navy, M(x, 6.25, 0, 0, PI / 4, 0));
      c.add(cone(0.3, 0.18, 4), 0xffffff, M(x, 6.36, 0, 0, PI / 4, 0));
      gl.add(rbox(0.34, 0.46, 0.34, 0.06), 0xffffff, M(x, 5.78, 0));
    }
    // гирлянда между столбами (провис) — светящиеся лампочки 4
    for (let i = 0; i <= 18; i++){
      const x = -5.4 + i * 10.8 / 18, y = 5.05 - 0.45 * (1 - (x / 5.4) ** 2);
      gl.add(sph(0.09, 6, 4), 0xffffff, M(x, y, 0.05));
    }
    // тросы доски
    for (const x of [-1.9, 1.9]) c.add(cyl(0.025, 0.025, 1.0, 5), navy, M(x, 7.35, 0));
    const body = new THREE.Mesh(c.build(), mats.candy); body.castShadow = true; body.receiveShadow = true;
    const glow = new THREE.Mesh(gl.build(), mats.glowBulb);
    ms.add(body, glow);
    owned.push(body.geometry, glow.geometry);
  }
  const msTex = labelCanvas(1024, 320);
  const msMat = new THREE.MeshStandardMaterial({ map: msTex, emissiveMap: msTex, emissive: 0xffffff, emissiveIntensity: 0.15, roughness: 0.8, transparent: true, alphaTest: 0.5 });
  const msBoard = new THREE.Mesh(new THREE.PlaneGeometry(5.0, 1.56), msMat);
  msBoard.position.set(0, 6.9, 0.02); msBoard.receiveShadow = true;
  ms.add(msBoard);
  owned.push(msTex, msMat, msBoard.geometry);
  ms.visible = false;
  group.add(ms);

  // ---------- флаг рекорда: два высоких столба, флаг-полотно на 5.6 м ----------
  const rec = new THREE.Group(); rec.name = "gate:record";
  {
    const c = new GeoBuilder(), gl = new GeoBuilder();
    for (const s of [-1, 1]){
      const x = s * 5.75;
      c.add(rbox(0.5, 0.4, 0.5, 0.08), 0x070D36, M(x, 0.2, 0));
      c.add(cyl(0.11, 0.13, 7.4, 12, 10), 0xF3EEF6, M(x, 3.9, 0), { stripe: { period: 0.42, len: 7.4, turns: 1 } });
      gl.add(sph(0.26, 12, 8), 0xffffff, M(x, 7.75, 0));
    }
    for (let i = 0; i <= 22; i++){
      const x = -5.5 + i * 11 / 22;
      gl.add(sph(0.08, 6, 4), 0xffffff, M(x, 7.25 - 0.25 * (1 - (x / 5.5) ** 2), 0.05));
    }
    const body = new THREE.Mesh(c.build(), mats.candy); body.castShadow = true; body.receiveShadow = true;
    const glow = new THREE.Mesh(gl.build(), mats.glowBulb);
    rec.add(body, glow);
    owned.push(body.geometry, glow.geometry);
  }
  const recTex = labelCanvas(1024, 400);
  const recMat = new THREE.MeshStandardMaterial({ map: recTex, emissiveMap: recTex, emissive: 0xffffff, emissiveIntensity: 0.2, roughness: 0.85, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide });
  // полотно с лёгкой волной (запечено в геометрию: 12 × 1 сегментов)
  const flagGeo = new THREE.PlaneGeometry(6.4, 2.5, 12, 1);
  { const p = flagGeo.attributes.position; for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getX(i) * 0.9) * 0.12); flagGeo.computeVertexNormals(); }
  const recFlag = new THREE.Mesh(flagGeo, recMat);
  recFlag.position.set(0, 5.6, 0.02); recFlag.castShadow = true; recFlag.receiveShadow = true;
  rec.add(recFlag);
  owned.push(recTex, recMat, flagGeo);
  rec.visible = false;
  group.add(rec);

  // ---------- состояние ----------
  const state = { msS: 0, msLabel: -1, best: 0, recArmed: false, recFired: false, recLabel: -1, passS: 0 };
  let lastDist = -1e9;
  drawMilestone(msTex, step); state.msLabel = step;

  // шрифт: перерисовать текущие надписи, когда Nunito загрузится
  loadKitFont().then(ok => {
    if (!ok) return;
    if (state.msLabel > 0) drawMilestone(msTex, state.msLabel);
    if (state.recLabel > 0) drawRecord(recTex, state.recLabel);
  });

  function setBest(best){
    best = +best || 0;
    state.best = best; state.recArmed = best > 100; state.recFired = false;
    if (state.recArmed && Math.round(best) !== state.recLabel){ state.recLabel = Math.round(best); drawRecord(recTex, state.recLabel); }
  }

  function reset(){ state.recFired = false; state.passS = 0; }

  function update(dist){
    if (dist < lastDist - 1) reset();
    lastDist = dist;
    // ближайший рубеж, ещё не ушедший за спину
    const s = Math.max(step, Math.ceil((dist - GATE_BEHIND) / step) * step);
    const recNear = state.recArmed && Math.abs(state.best - s) < 14;     // флаг рекорда рядом — ворота не дублируем
    if (s - dist < GATE_AHEAD && !recNear){
      if (s !== state.msLabel){ state.msLabel = s; drawMilestone(msTex, s); }
      ms.visible = true; ms.position.z = dist - s;
      if (dist >= s && state.passS !== s){ state.passS = s; emit("gate:pass", s); }
    } else ms.visible = false;

    if (state.recArmed && dist + GATE_AHEAD >= state.best && dist < state.best + GATE_BEHIND){
      rec.visible = true; rec.position.z = dist - state.best;
      if (!state.recFired && dist >= state.best){ state.recFired = true; emit("record", state.best); }
    } else rec.visible = false;
  }

  // блокировка декора у ворот (s — дистанция трассы)
  function blocked(s, nearOrLamp){
    if (!nearOrLamp) return false;
    const m = Math.round(s / step) * step;
    if (m >= step && Math.abs(s - m) < 5) return true;
    return state.recArmed && Math.abs(s - state.best) < 5;
  }

  function dispose(){ for (const d of owned) d.dispose(); }
  return { group, milestone: ms, record: rec, state, step, setBest, update, blocked, dispose };
}
