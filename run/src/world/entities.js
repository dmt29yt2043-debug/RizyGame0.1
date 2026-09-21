// world-kit: визуал препятствий и энергонов (WORLD-4, WORLD-5).
// makeObstacle/makeCoin возвращают лёгкий «прокси» Object3D из пула; main двигает proxy.position.z,
// а кит каждый кадр пересобирает из живых прокси инстансные части: константное число draw call
// при любом количестве препятствий. Прокси, отцепленный от родителя (parent === null), считается удалённым.
import * as THREE from "three";
import { Part, clamp } from "./util.js";
import * as PR from "./props.js";

const K_JUMP = 0, K_SLIDE = 1, K_WALL = 2;

export function createEntities(mats, o){
  const LANES = (o && o.lanes) || [-2.55, 0, 2.55];
  const root = new THREE.Group(); root.name = "world:entities";
  const geos = [];
  const part = (geo, mat, cap, opt) => { geos.push(geo); const p = new Part(geo, mat, cap, opt); root.add(p.mesh); return p; };

  const jump = part(PR.obstJump(), mats.candyHaz, 24, { cast: true });
  const seg = PR.obstSlideSeg();
  const banner = part(seg.banner, mats.feltHaz, 36, { cast: true });
  const bar = part(seg.bar, mats.candyHaz, 36, { cast: true });
  const bulbs = part(seg.bulbs, mats.glowBulb, 36, { receive: false });
  const pole = part(PR.obstSlidePole(), mats.candyHaz, 40, { cast: true });
  const walls = [part(PR.obstSleigh(), mats.candyHaz, 18, { cast: true }), part(PR.obstGifts(), mats.candyHaz, 18, { cast: true }),
                 part(PR.obstCart(), mats.candyHaz, 18, { cast: true })];
  const decalGeo = PR.groundQuad(1.6, 1.1);
  const aDecal = new THREE.InstancedBufferAttribute(new Float32Array(48 * 2), 2);
  decalGeo.setAttribute("aDecal", aDecal);
  const decal = part(decalGeo, mats.decal, 48, { receive: false, renderOrder: 2 });

  const CAP_COIN = 140;
  const shell = part(PR.coinShell(), mats.coinShell, CAP_COIN, { receive: false, renderOrder: 4 });
  const core = part(PR.coinCore(), mats.coinCore, CAP_COIN, { receive: false });
  const halo = part(PR.quad(), mats.haloCoin, CAP_COIN, { receive: false, renderOrder: 5 });
  const blob = part(PR.groundQuad(1, 1), mats.blob, CAP_COIN, { receive: false, renderOrder: 2 });
  // ускорители: фигурка по виду (рисуется только активная часть — обычно 1 draw call) + кольцо + ореол + blob-тень
  const CAP_PW = 8;
  const pw = [part(PR.powerMagnet(), mats.candy, CAP_PW, { cast: true }), part(PR.powerShield(), mats.candy, CAP_PW, { cast: true }),
              part(PR.powerBoost(), mats.candy, CAP_PW, { cast: true }), part(PR.powerX2(), mats.candy, CAP_PW, { cast: true })];
  const pwRing = part(PR.powerRing(), mats.glowPower, CAP_PW, { receive: false });
  const pwHalo = part(PR.quad(), mats.haloPower, CAP_PW, { receive: false, renderOrder: 5 });
  const ALL = [jump, banner, bar, bulbs, pole, walls[0], walls[1], walls[2], decal, shell, core, halo, blob, pw[0], pw[1], pw[2], pw[3], pwRing, pwHalo];
  const PW_KIND = { magnet: 0, shield: 1, boost: 2, x2: 3 };
  // оттенки ореола и кольца (линейные): синий, небесный, лайм, розовый
  const PW_COL = [[0.05, 0.25, 1.0], [0.45, 0.85, 1.0], [0.7, 1.0, 0.2], [1.0, 0.45, 0.72]];

  const liveO = [], liveC = [], liveP = [], freeO = [], freeC = [], freeP = [];

  function attach(p, list){ p.userData.kit = 1; p.userData.idx = list.length; list.push(p); root.add(p); return p; }

  function makeObstacle(ent){
    const p = freeO.pop() || new THREE.Object3D();
    const u = p.userData, lanes = ent.lanes && ent.lanes.length ? ent.lanes : [1];
    let lo = 2, hi = 0;
    for (let i = 0; i < lanes.length; i++){ if (lanes[i] < lo) lo = lanes[i]; if (lanes[i] > hi) hi = lanes[i]; }
    u.coin = false; u.pw = false; u.lo = lo; u.hi = hi;
    u.kind = ent.kind === "jump" ? K_JUMP : ent.kind === "slide" ? K_SLIDE : K_WALL;
    const z = typeof ent.z === "number" ? ent.z : 0;
    // вариант стены: от z и полосы — у многополосной стены (отдельные сущности с общим z) соседи разные
    u.variant = ent.variant != null ? ent.variant % 3 : ((Math.floor(-z * 7.3) + lo) % 3 + 3) % 3;
    p.position.set((LANES[lo] + LANES[hi]) / 2, 0, z); p.scale.set(1, 1, 1); p.visible = true;
    return attach(p, liveO);
  }
  function makeCoin(ent){
    const p = freeC.pop() || new THREE.Object3D();
    p.userData.coin = true; p.userData.pw = false;
    p.position.set(ent.x != null ? ent.x : LANES[ent.lane != null ? ent.lane : 1], ent.y != null ? ent.y : 0.95, ent.z || 0);
    p.scale.set(1, 1, 1); p.visible = true;
    return attach(p, liveC);
  }
  function makePowerup(ent){
    const p = freeP.pop() || new THREE.Object3D();
    const u = p.userData;
    u.coin = false; u.pw = true; u.kind = PW_KIND[ent.kind] || 0;
    p.position.set(ent.x != null ? ent.x : LANES[ent.lane != null ? ent.lane : 1], ent.y != null ? ent.y : 1.1, ent.z || 0);
    p.scale.set(1, 1, 1); p.visible = true;
    return attach(p, liveP);
  }
  function release(p){
    if (!p || !p.userData || !p.userData.kit) return false;
    const u = p.userData, list = u.pw ? liveP : u.coin ? liveC : liveO;
    u.kit = 0;
    const last = list.pop();
    if (last !== p){ list[u.idx] = last; last.userData.idx = u.idx; }
    if (p.parent) p.parent.remove(p);
    (u.pw ? freeP : u.coin ? freeC : freeO).push(p);
    return true;
  }

  function pushDecal(x, z, kind, a){
    const i = decal.pushS(x, 0.036, z, 1, 0, 1, 1, 1, 1, 1, 1);
    if (i >= 0){ aDecal.array[i * 2] = kind; aDecal.array[i * 2 + 1] = a; }
  }

  function update(t, reduced){
    for (let i = 0; i < ALL.length; i++) ALL[i].begin();
    const wave = reduced ? 0.4 : 1;
    for (let i = liveO.length - 1; i >= 0; i--){
      const p = liveO[i];
      if (!p.parent){ release(p); continue; }
      if (!p.visible) continue;
      const u = p.userData, x = p.position.x, y = p.position.y, z = p.position.z, sy = p.scale.y;
      if (z < -135 || z > 14) continue;
      const cx = (LANES[u.lo] + LANES[u.hi]) / 2;
      if (u.kind === K_JUMP) jump.pushS(x, y, z, 1, 0, 1, sy, 1, 1, 1, 1);
      else if (u.kind === K_SLIDE){
        for (let l = u.lo; l <= u.hi; l++){
          const sx = x + LANES[l] - cx;
          banner.pushS(sx, y, z, 1, 0, 1, sy, 1, 1, 1, 1);
          bar.pushS(sx, y, z, 1, 0, 1, sy, 1, 1, 1, 1);
          bulbs.pushS(sx, y, z, 1, 0, 1, sy, 1, 1, 1, 1);
        }
        const half = (LANES[u.hi] - LANES[u.lo]) / 2 + 1.33;
        pole.pushS(x - half, y, z, 1, 0, 1, sy, 1, 1, 1, 1);
        pole.pushS(x + half, y, z, 1, 0, 1, sy, 1, 1, 1, 1);
      } else walls[u.variant].pushS(x, y, z, 1, 0, 1, sy, 1, 1, 1, 1);
      // знак на земле за 7 м: 0 на 55 м → 0.85 на ≤ 20 м, гаснет, когда уходит под Ризи
      const dz = z + 7, d = -dz;                   // знак БЛИЖЕ к игроку, чем препятствие (z растёт к камере)
      const a = clamp((55 - d) / 35, 0, 1) * 0.85 * clamp((1 - dz) / 3, 0, 1);
      if (a > 0.01) for (let l = u.lo; l <= u.hi; l++) pushDecal(x + LANES[l] - cx, dz, u.kind, a);
    }
    for (let i = liveC.length - 1; i >= 0; i--){
      const p = liveC[i];
      if (!p.parent){ release(p); continue; }
      if (!p.visible) continue;
      const x = p.position.x, y = p.position.y, z = p.position.z, s = p.scale.x;
      if (z < -135 || z > 12) continue;
      // бегущая к игроку волна вращения + парение
      const ang = t * 3.2 + z * 0.22, yy = y + 0.07 * Math.sin(t * 9 + z * 0.6) * wave;
      const cs = Math.cos(ang), sn = Math.sin(ang);
      shell.pushS(x, yy, z, cs, sn, s, s, s, 1, 1, 1);
      core.pushS(x, yy, z, cs, sn, s, s, s, 1, 1, 1);
      halo.pushS(x, yy, z, 1, 0, 1.5 * s, 1.5 * s, 1.5 * s, 1, 1, 1);
      const bs = 0.7 * (1 - 0.35 * clamp((yy - 0.95) / 1.2, 0, 1)) * s;
      blob.pushS(x, 0.03, z, 1, 0, bs, 1, bs, 1, 1, 1);
    }
    // ускорители: парение 1.1 ± 0.12 м, вращение 2.4 рад/с, кольцо крутится быстрее, ореол и тень в цвет бонуса
    for (let i = liveP.length - 1; i >= 0; i--){
      const p = liveP[i];
      if (!p.parent){ release(p); continue; }
      if (!p.visible) continue;
      const x = p.position.x, y = p.position.y, z = p.position.z, s = p.scale.x, k = p.userData.kind, c = PW_COL[k];
      if (z < -135 || z > 12) continue;
      const ang = t * 2.4 + z * 0.15, yy = y + 0.12 * Math.sin(t * 2.6 + z * 0.4) * wave;
      const cs = Math.cos(ang), sn = Math.sin(ang), a2 = ang * 1.7, sc = 1.3 * s;   // фигурка крупнее энергона: читается издалека
      pw[k].pushS(x, yy, z, cs, sn, sc, sc, sc, 1, 1, 1);
      pwRing.pushS(x, yy, z, Math.cos(a2), Math.sin(a2), sc, sc, sc, c[0], c[1], c[2]);
      pwHalo.pushS(x, yy, z, 1, 0, 3.2 * s, 3.2 * s, 3.2 * s, c[0], c[1], c[2]);
      blob.pushS(x, 0.03, z, 1, 0, 1.2 * s, 1, 1.2 * s, 1, 1, 1);
    }
    for (let i = 0; i < ALL.length; i++) ALL[i].end();
    aDecal.needsUpdate = true;
  }

  function dispose(){ for (const g of geos) g.dispose(); }
  return { root, makeObstacle, makeCoin, makePowerup, release, update, liveObstacles: liveO, liveCoins: liveC, livePowerups: liveP, parts: ALL, dispose };
}
