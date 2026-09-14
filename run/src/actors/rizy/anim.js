// Контроллер анимации Ризи (общий для процедурной модели и GLB).
// Вход: состояние игры (setState) + события (trigger). Выход: две позы в «осях персонажа» —
//   base (смешанные базовые позы: титул / бег / воздух / подкат / нырок / финиш) и
//   add  (аддитивные слои: наклон при смене полосы, спотыкание, near-miss, оглядка, кулак, приземление),
// плюс корень (крен, рыскание, сжатие, прыжок-хоп), пружины пучков/рюкзака, моргание, ветер шарфа.
// Время: simDt — позы и таймеры реакций (замирают в хит-стоп), realDt — пружины и мигание (PLAYER-5).
// Оси: персонаж смотрит в −Z, Y вверх. rot.x > 0 у бедра/плеча = конечность вперёд; у колена < 0 = сгиб;
// rot.x > 0 у корпуса = отклон назад. L = −X, R = +X.

export const BONES = ["hips", "spine", "chest", "neck", "head",
  "thighL", "shinL", "footL", "thighR", "shinR", "footR",
  "armL", "foreL", "armR", "foreR", "pack", "bunL", "bunR", "eyeL", "eyeR"];
export const NB = 18;                    // кости с вращением в позе (глаза — только масштаб)
export const B = {}; BONES.forEach((n, i) => { B[n] = i; });
export const POSE_LEN = NB * 3 + 3;      // + смещение таза xyz
export const HX = NB * 3;

const PI = Math.PI, TAU = PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, l, dt) => a + (b - a) * (1 - Math.exp(-l * dt));
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const eOutQuad = t => 1 - (1 - t) * (1 - t);
const eOutCubic = t => 1 - Math.pow(1 - t, 3);
const eOutBack = t => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
const eInOutSine = t => -(Math.cos(PI * t) - 1) / 2;
const eInOutCubic = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function set(P, b, x, y, z){ const o = b * 3; P[o] = x; P[o + 1] = y; P[o + 2] = z; }
function addB(P, b, x, y, z){ const o = b * 3; P[o] += x; P[o + 1] += y; P[o + 2] += z; }
function mix(out, P, w){ if (w === 0) return; for (let i = 0; i < POSE_LEN; i++) out[i] += (P[i] - out[i]) * w; }

export function createAnimator(opts = {}){
  const S = {
    mode: "title", runPhase: 0, speedI: 0, laneX: 0, laneVel: NaN, py: 0, vy: 0, sliding: 0,
    landT: NaN, hitT: NaN, grace: 0, dive: false, celebrate: false, danger: 0,
  };
  const base = new Float32Array(POSE_LEN), add = new Float32Array(POSE_LEN);
  const Pr = new Float32Array(POSE_LEN), Pa = new Float32Array(POSE_LEN), Ps = new Float32Array(POSE_LEN),
        Pd = new Float32Array(POSE_LEN), Po = new Float32Array(POSE_LEN);
  const out = {
    base, add, roll: 0, yaw: 0, sx: 1, sy: 1, sz: 1, hopY: 0, visible: true,
    eyeL: 1, eyeR: 1, bunX: 0, bunY: 0, packX: 0, packY: 0, packRx: 0, packRz: 0,
    rimFlash: 0, windX: 0, windY: 0, windZ: 0, flutter: 0, lift: 0,
    wAir: 0, wSlide: 0, wRun: 0, wOver: 0, state: "idle",
  };
  let reduced = !!opts.reducedMotion;

  // таймеры событий (сек, sim)
  const BIG = 99;
  let tS = 0, tR = 0;
  let jumpT = BIG, landT = BIG, landImpact = 0, hitT = BIG, nearT = BIG, nearDir = 1, edgeT = BIG, edgeDir = 1,
      mileT = BIG, spinT = BIG, flipOn = false, leanT = BIG, leanDir = 0, leanDur = 0.14;
  let wRun = 0, wOver = 0, wAir = 0, wDive = 0, wSlide = 0, slideIn = 0, slideOutT = BIG, slideOutFrom = 0, wasSliding = false;
  let grounded = true, minAirVy = 0, prevLaneX = NaN, lastHitT = NaN, lastLandT = NaN;
  // титул: взгляд по сторонам, взмах рукой, моргание — детерминированный псевдорандом
  let seed = 12345;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  let lookFrom = 0, lookTo = 0, lookT = BIG, nextLook = 4.5, waveT = BIG, nextWave = 6.0, blinkT = BIG, nextBlink = 3.9;
  let dangerT = 0, dangerSide = 1;
  // пружины (real)
  let bx = 0, bvx = 0, by = 0, bvy = 0, kx = 0, kvx = 0, ky = 0, kvy = 0;
  let pvx = 0, pvy = 0, pX = NaN, pY = NaN, rimFlashT = BIG;

  function setState(s){
    if (!s) return;
    if (s.mode !== undefined) S.mode = s.mode;
    if (s.runPhase !== undefined) S.runPhase = s.runPhase;
    if (s.speedI !== undefined) S.speedI = s.speedI;
    if (s.laneX !== undefined) S.laneX = s.laneX;
    S.laneVel = s.laneVel !== undefined ? s.laneVel : NaN;
    if (s.py !== undefined) S.py = s.py;
    if (s.vy !== undefined) S.vy = s.vy;
    if (s.sliding !== undefined) S.sliding = +s.sliding || 0;
    if (s.grace !== undefined) S.grace = s.grace;
    if (s.dive !== undefined) S.dive = !!s.dive;
    if (s.celebrate !== undefined) S.celebrate = !!s.celebrate;
    if (s.danger !== undefined) S.danger = s.danger;
    // «секунды с события»: уменьшение значения = новое событие
    if (s.hitT !== undefined && s.hitT !== null){
      if (!(s.hitT >= lastHitT) && s.hitT < 0.5) trigger("hit");
      lastHitT = s.hitT;
    }
    if (s.landT !== undefined && s.landT !== null){
      if (!(s.landT >= lastLandT) && s.landT < 0.3 && landT > 0.05) trigger("land", { impact: Math.abs(minAirVy) || 12 });
      lastLandT = s.landT;
    }
    if (s.laneDir !== undefined && s.laneT !== undefined && s.laneT < leanT && s.laneT < 0.05 && s.laneDir) trigger("lane", { dir: s.laneDir });
  }

  function trigger(name, p){
    switch (name){
      case "jump": jumpT = 0; flipOn = !!(p && p.flip) && !reduced; break;
      case "land": landT = 0; landImpact = p && p.impact != null ? Math.abs(p.impact) : Math.abs(minAirVy); break;
      case "hit": hitT = 0; break;
      case "nearmiss": nearT = 0; nearDir = p && p.dir ? Math.sign(p.dir) : 1; rimFlashT = 0; break;
      case "edgebump": edgeT = 0; edgeDir = p && p.dir ? Math.sign(p.dir) : 1; break;
      case "milestone": case "record": mileT = 0; break;
      case "spin": case "combo": if (!grounded && !reduced) spinT = 0; break;
      case "lane": leanT = 0; leanDir = p && p.dir ? Math.sign(p.dir) : 0; leanDur = lerp(0.15, 0.115, S.speedI); break;
      case "dive": S.dive = true; break;
    }
  }

  // ---------- БАЗОВЫЕ ПОЗЫ ----------
  function poseIdle(P, t, over){
    P.fill(0);
    const br = Math.sin(t * TAU * 0.25), sway = Math.sin(t * 0.9);
    set(P, B.hips, 0, 0, 0.035 * sway); P[HX] = 0.012 * sway; P[HX + 1] = -0.004 + 0.004 * br;
    set(P, B.spine, 0.015 - 0.012 * br, 0, -0.03 * sway);
    set(P, B.chest, -0.01 * br, 0, -0.012 * sway);
    // взгляд по сторонам ±0.35 рад, 500 мс easeInOutSine
    const lk = lookT < 0.5 ? lerp(lookFrom, lookTo, eInOutSine(lookT / 0.5)) : lookTo;
    set(P, B.neck, 0, lk * 0.12, 0);
    set(P, B.head, 0.04, lk * 0.23, 0.07 + 0.025 * sway);
    set(P, B.thighL, 0.02, 0.05, -0.035 * sway - 0.02); set(P, B.shinL, -0.04, 0, 0); set(P, B.footL, 0.02, 0, 0.035 * sway);
    set(P, B.thighR, 0.02, -0.05, -0.035 * sway + 0.02); set(P, B.shinR, -0.04, 0, 0); set(P, B.footR, 0.02, 0, 0.035 * sway);
    set(P, B.armL, 0.06, 0.1, -0.2 - 0.02 * br); set(P, B.foreL, 0.28, 0, 0);
    set(P, B.armR, 0.06, -0.1, 0.2 + 0.02 * br); set(P, B.foreR, 0.28, 0, 0);
    // взмах рукой каждые 8 с
    if (!over && waveT < 1.6){
      const w = Math.sin(PI * clamp(waveT / 1.6, 0, 1)), ww = clamp(w * 1.8, 0, 1);
      const o = B.armR * 3, f = B.foreR * 3;
      P[o] = lerp(P[o], -0.2, ww); P[o + 2] = lerp(P[o + 2], 2.5, ww);
      P[f] = lerp(P[f], 0.35, ww); P[f + 2] = lerp(P[f + 2], 0.45 * Math.sin(waveT * 13), ww);
      P[B.head * 3 + 2] += 0.08 * ww;
    }
  }

  function poseRun(P, p, I){
    P.fill(0);
    const sp = Math.sin(p), cp = Math.cos(p), cpp = Math.max(0, cp), cpn = Math.max(0, -cp);
    const amp = lerp(0.78, 0.95, I);
    // ноги: широкий мах, колено сгибается на выносе (cos > 0 у левой)
    set(P, B.thighL, 0.18 + amp * sp, 0, -0.03);
    set(P, B.shinL, -(0.22 + 1.45 * Math.pow(cpp, 1.3)), 0, 0);
    set(P, B.footL, 0.25 * cpp - 0.35 * Math.max(0, -sp) * cpn, 0, 0);
    set(P, B.thighR, 0.18 - amp * sp, 0, 0.03);
    set(P, B.shinR, -(0.22 + 1.45 * Math.pow(cpn, 1.3)), 0, 0);
    set(P, B.footR, 0.25 * cpn - 0.35 * Math.max(0, sp) * cpp, 0, 0);
    // корпус: наклон вперёд 6°·I, скручивание таза против плеч, покачивание 0.06 м на удвоенной частоте
    P[HX + 1] = -0.045 + 0.06 * Math.abs(cp);
    set(P, B.hips, 0.0, -0.13 * sp, 0.045 * sp);
    set(P, B.spine, -0.16 - 0.105 * I + 0.03 * Math.abs(cp), 0.1 * sp, -0.03 * sp);
    set(P, B.chest, -0.03, 0.12 * sp, -0.015 * sp);
    set(P, B.neck, 0.05, -0.05 * sp, 0);
    set(P, B.head, 0.1 + 0.105 * I - 0.03 * Math.abs(cp), -0.04 * sp, 0.02 * sp);
    // руки: противофаза ногам, локти согнуты «как у бегуна»
    set(P, B.armL, -0.85 * sp + 0.05, 0.1, -0.2);
    set(P, B.foreL, 1.15 + 0.35 * Math.max(0, -sp), 0, 0);
    set(P, B.armR, 0.85 * sp + 0.05, -0.1, 0.2);
    set(P, B.foreR, 1.15 + 0.35 * Math.max(0, sp), 0, 0);
  }

  function poseAir(P, vy, jt){
    P.fill(0);
    const a = clamp(vy / 12.67, -1, 1);
    const fall = sstep(0.25, -0.7, a);          // 0 — взлёт/апекс, 1 — падение
    const tuck = sstep(0.0, 0.18, jt);          // первые кадры — толчок прямыми ногами
    set(P, B.thighL, lerp(0.2, lerp(1.35, 0.55, fall), tuck), 0, -0.05);
    set(P, B.shinL, lerp(-0.2, lerp(-1.75, -0.45, fall), tuck), 0, 0);
    set(P, B.footL, lerp(-0.4, 0.3, tuck), 0, 0);
    set(P, B.thighR, lerp(-0.35, lerp(-0.3, 0.1, fall), tuck), 0, 0.05);
    set(P, B.shinR, lerp(-0.2, lerp(-1.1, -0.35, fall), tuck), 0, 0);
    set(P, B.footR, lerp(-0.5, 0.1, tuck), 0, 0);
    P[HX + 1] = 0.02;
    set(P, B.spine, lerp(-0.2, -0.05, fall), 0, 0);
    set(P, B.chest, -0.02, 0, 0);
    set(P, B.head, lerp(0.14, 0.2, fall), 0, 0);
    // руки: вверх-наружу на взлёте, выше при падении (баланс)
    set(P, B.armL, lerp(-0.5, 0.3, tuck), 0.15, lerp(-0.4, lerp(-1.05, -1.45, fall), tuck));
    set(P, B.foreL, lerp(0.6, 0.45, fall), 0, 0);
    set(P, B.armR, lerp(0.6, 0.3, tuck), -0.15, lerp(0.4, lerp(1.05, 1.45, fall), tuck));
    set(P, B.foreR, lerp(0.6, 0.45, fall), 0, 0);
  }

  function poseSlide(P, t){
    P.fill(0);
    const w = Math.sin(t * 22) * 0.02;
    P[HX + 1] = -0.52; P[HX + 2] = 0.05;
    set(P, B.hips, 1.12, 0.12, 0.05);
    set(P, B.thighL, 0.4, 0, -0.04); set(P, B.shinL, -0.08, 0, 0); set(P, B.footL, -0.35, 0, 0);
    set(P, B.thighR, -0.15, 0, 0.12); set(P, B.shinR, -2.0, 0, 0); set(P, B.footR, 0.2, 0, 0);
    set(P, B.spine, -0.45, -0.1, 0); set(P, B.chest, -0.22 + w, -0.04, 0);
    set(P, B.neck, -0.12, 0, 0); set(P, B.head, -0.28, 0.0, 0.05);
    set(P, B.armL, 0.55, 0.2, -0.75); set(P, B.foreL, 0.35, 0, 0);
    set(P, B.armR, -0.2, -0.2, 1.75 + w * 3); set(P, B.foreR, 0.5, 0, 0);
  }

  function poseDive(P){
    P.fill(0);
    set(P, B.hips, -0.3, 0, 0);
    set(P, B.spine, -0.2, 0, 0); set(P, B.head, 0.3, 0, 0);
    set(P, B.thighL, 0.25, 0, 0.05); set(P, B.shinL, -0.3, 0, 0);
    set(P, B.thighR, 0.2, 0, -0.05); set(P, B.shinR, -0.35, 0, 0);
    set(P, B.armL, 0.2, 0, -2.75); set(P, B.foreL, 0.15, 0, 0);
    set(P, B.armR, 0.2, 0, 2.75); set(P, B.foreR, 0.15, 0, 0);
  }

  // финиш: рекорд — прыжки с поднятыми руками; иначе — грустная стойка
  function poseOver(P, t){
    if (S.celebrate){
      P.fill(0);
      const per = 0.62, ph = (t % per) / per, h = Math.max(0, Math.sin(PI * ph));
      out.hopY = reduced ? 0 : 0.34 * h;
      const tk = h * h;
      set(P, B.thighL, 0.7 * tk, 0, -0.08); set(P, B.shinL, -1.2 * tk - 0.05, 0, 0); set(P, B.footL, 0.3 * tk, 0, 0);
      set(P, B.thighR, 0.55 * tk, 0, 0.08); set(P, B.shinR, -1.0 * tk - 0.05, 0, 0); set(P, B.footR, 0.3 * tk, 0, 0);
      P[HX + 1] = -0.06 * (1 - h);
      set(P, B.spine, 0.06, 0, 0); set(P, B.head, -0.22, 0.12 * Math.sin(t * 5), 0.1 * Math.sin(t * 5));
      const wv = 0.22 * Math.sin(t * 10);
      set(P, B.armL, 0.1, 0, -2.6 + wv); set(P, B.foreL, 0.35, 0, 0);
      set(P, B.armR, 0.1, 0, 2.6 + wv); set(P, B.foreR, 0.35, 0, 0);
    } else {
      poseIdle(P, t, true);
      out.hopY = 0;
      addB(P, B.spine, -0.12, 0, 0); addB(P, B.neck, 0.12, 0, 0); addB(P, B.head, 0.28, 0, 0);
      set(P, B.armL, 0.02, 0, -0.08); set(P, B.foreL, 0.08, 0, 0);
      set(P, B.armR, 0.02, 0, 0.08); set(P, B.foreR, 0.08, 0, 0);
    }
  }

  // ---------- КАДР ----------
  function update(realDt, simDt){
    const dR = Math.min(Math.max(realDt, 0), 0.1), dS = Math.min(Math.max(simDt, 0), 0.1);
    tS += dS; tR += dR;
    const play = S.mode === "play", over = S.mode === "over", title = !play && !over;

    // скорость по X: своя производная, если адаптер не дал laneVel
    let lv = S.laneVel;
    if (lv !== lv){ lv = dS > 0 && prevLaneX === prevLaneX ? (S.laneX - prevLaneX) / dS : 0; }
    prevLaneX = S.laneX;
    if (play && Math.abs(lv) > 7 && (leanT > leanDur + 0.1 || Math.sign(lv) !== leanDir)) trigger("lane", { dir: Math.sign(lv) });

    // взлёт / приземление по py, vy
    const g = S.py <= 0.02;
    if (grounded && !g && S.vy > 0 && jumpT > 0.1) trigger("jump", { flip: false });
    if (!g) minAirVy = Math.min(minAirVy, S.vy);
    if (!grounded && g){ if (landT > 0.05) trigger("land", { impact: Math.abs(minAirVy) }); flipOn = false; }
    if (g) minAirVy = 0;
    grounded = g;
    if (g && S.dive) S.dive = false;

    jumpT += dS; landT += dS; hitT += dS; nearT += dS; edgeT += dS; mileT += dS; spinT += dS; leanT += dS; slideOutT += dS;
    lookT += dS; waveT += dS; blinkT += dR; rimFlashT += dR;

    // титульные расписания
    if (title || (over && !S.celebrate)){
      nextLook -= dS; nextWave -= dS;
      if (nextLook <= 0){ lookFrom = lookTo; lookTo = Math.abs(lookTo) > 0.1 ? 0 : (rnd() < 0.5 ? -1 : 1) * (0.6 + 0.4 * rnd()); lookT = 0; nextLook = 4 + 3 * rnd(); }
      if (nextWave <= 0 && title){ waveT = 0; nextWave = 8; }
    }
    nextBlink -= dR;
    if (nextBlink <= 0){ blinkT = 0; nextBlink = 2.4 + 2.2 * rnd(); }

    // веса поз
    wRun = damp(wRun, play ? 1 : 0, 8, dS);
    wOver = damp(wOver, over ? 1 : 0, 6, dS);
    const air = play && !g;
    wAir = damp(wAir, air ? 1 : 0, air ? 22 : 38, dS);
    wDive = damp(wDive, air && S.dive ? 1 : 0, 25, dS);
    // подкат: вход 70 мс easeOutQuad, выход 120 мс easeOutBack (лёгкий «пружинный» подъём)
    const sl = play && S.sliding > 0;
    if (sl){ slideIn = Math.min(1, slideIn + dS / 0.07); wSlide = eOutQuad(slideIn); wasSliding = true; }
    else {
      if (wasSliding){ wasSliding = false; slideOutT = 0; slideOutFrom = wSlide; }
      wSlide = slideOutT < 0.12 ? Math.max(-0.12, slideOutFrom * (1 - eOutBack(slideOutT / 0.12))) : 0;
      slideIn = Math.max(0, wSlide);
    }

    // смешивание
    out.hopY = 0;
    poseIdle(base, tS, false);
    if (wRun > 0.001){ poseRun(Pr, S.runPhase, S.speedI); mix(base, Pr, wRun); }
    if (wOver > 0.001){ poseOver(Po, tS); mix(base, Po, wOver); }
    if (wAir > 0.001){ poseAir(Pa, S.vy, jumpT); mix(base, Pa, wAir); }
    if (wDive > 0.001){ poseDive(Pd); mix(base, Pd, wDive); }
    if (Math.abs(wSlide) > 0.001){ poseSlide(Ps, tS); mix(base, Ps, wSlide); }
    out.state = wSlide > 0.5 ? "slide" : wAir > 0.5 ? "air" : play ? "run" : over ? (S.celebrate ? "celebrate" : "over") : "idle";

    // ---------- АДДИТИВНЫЕ СЛОИ ----------
    add.fill(0);
    let roll = 0, yaw = 0, sy = 1, sxz = 1;

    // PLAYER-1: наклон в сторону смены полосы, e = sin(π·min(1, t/(dur+100мс)))
    if (leanT < leanDur + 0.1){
      const e = Math.sin(PI * Math.min(1, leanT / (leanDur + 0.1)));
      roll += -leanDir * 0.26 * e;
      addB(add, B.chest, 0, -leanDir * 0.1 * e, 0);
      addB(add, B.head, 0, -leanDir * 0.1 * e, 0);
      addB(add, B.hips, 0, 0, leanDir * 0.1 * e);
      addB(add, B.armL, 0, 0, -0.35 * e * Math.max(0, leanDir));   // рука «в сторону» для баланса
      addB(add, B.armR, 0, 0, 0.35 * e * Math.max(0, -leanDir));
    }
    // edge bump: 10° к стене за 60 мс, возврат 140 мс easeOutBack
    if (edgeT < 0.2){
      const k = edgeT < 0.06 ? eOutQuad(edgeT / 0.06) : 1 - eOutBack((edgeT - 0.06) / 0.14);
      roll += -edgeDir * 0.175 * k;
      addB(add, B.head, 0, 0, edgeDir * 0.2 * k);
      addB(add, B.armL, 0, 0, -0.5 * k); addB(add, B.armR, 0, 0, 0.5 * k);
    }
    // приземление: сжатие scaleY = 1 − clamp(|vy|/60, .08, .24), вход 60 мс, возврат 200 мс easeOutBack + сгиб коленей
    if (landT < 0.26){
      const amt = clamp(landImpact / 60, 0.08, 0.24);
      const k = landT < 0.06 ? eOutQuad(landT / 0.06) : 1 - eOutBack((landT - 0.06) / 0.2);
      sy *= 1 - amt * k;
      const kb = Math.max(0, k) * (amt / 0.24);
      addB(add, B.thighL, 0.5 * kb, 0, 0); addB(add, B.shinL, -1.0 * kb, 0, 0); addB(add, B.footL, 0.5 * kb, 0, 0);
      addB(add, B.thighR, 0.5 * kb, 0, 0); addB(add, B.shinR, -1.0 * kb, 0, 0); addB(add, B.footR, 0.5 * kb, 0, 0);
      add[HX + 1] -= 0.12 * kb;
      addB(add, B.spine, -0.2 * kb, 0, 0); addB(add, B.head, 0.12 * kb, 0, 0);
      addB(add, B.armL, 0, 0, -0.3 * kb); addB(add, B.armR, 0, 0, 0.3 * kb);
    }
    // взлёт: scaleY 1.18 / XZ 0.92 за 90 мс easeOutQuad, к 200 мс обратно
    if (jumpT < 0.2 && play){
      const k = jumpT < 0.09 ? eOutQuad(jumpT / 0.09) : 1 - eOutQuad((jumpT - 0.09) / 0.11);
      sy *= 1 + 0.18 * k;
      sxz *= 1 - 0.08 * k;
    }
    if (wDive > 0.01){ sy *= 1 + 0.1 * wDive; sxz *= 1 - 0.05 * wDive; }
    // сальто (P1): hips.x −2π за время полёта, easeInOutSine
    if (flipOn && !g) add[B.hips * 3] += -TAU * eInOutSine(clamp(jumpT / 0.6, 0, 1));
    // серия 10+: поворот 360° за 0.3 с только в воздухе
    if (spinT < 0.3) yaw += TAU * eInOutCubic(spinT / 0.3);

    // PLAYER-6: спотыкание — pitch +0.45 за 110 мс, возврат 350 мс easeOutBack, «мельница» ±60° на 6 Гц 0.4 с
    if (hitT < 0.46){
      const k = hitT < 0.11 ? eOutQuad(hitT / 0.11) : 1 - eOutBack((hitT - 0.11) / 0.35);
      addB(add, B.spine, 0.45 * k, 0, 0);
      addB(add, B.head, 0.2 * k, 0, 0);
      add[HX + 2] += 0.08 * k;
      if (hitT < 0.4){
        const f = 1 - hitT / 0.4, w = Math.sin(TAU * 6 * hitT) * 1.05 * f;
        addB(add, B.armL, w, 0, -0.9 * f); addB(add, B.armR, -w, 0, 0.9 * f);
      }
    }
    // near-miss: торс −12°, голова 35° к препятствию, 0.35 с
    if (nearT < 0.35){
      const k = Math.sin(PI * nearT / 0.35);
      addB(add, B.spine, -0.21 * k, 0, 0);
      addB(add, B.head, 0, -nearDir * 0.61 * k, 0);
    }
    // опасность: оглядка 70° на 0.25 с каждые 1.2 с
    if (play && S.danger > 0.01){
      dangerT += dS;
      if (dangerT >= 1.2){ dangerT -= 1.2; dangerSide = -dangerSide; }
      if (dangerT < 0.25 && g && wSlide < 0.3){
        const k = Math.sin(PI * dangerT / 0.25);
        addB(add, B.head, 0, dangerSide * 1.0 * k, 0);
        addB(add, B.neck, 0, dangerSide * 0.22 * k, 0);
        addB(add, B.chest, 0, dangerSide * 0.3 * k, 0);
      }
    } else dangerT = 0.9;
    // рубеж: взмах кулаком 0.5 с (правая рука)
    if (mileT < 0.5){
      const k = Math.pow(Math.sin(PI * mileT / 0.5), 0.6), o = B.armR * 3, f = B.foreR * 3;
      add[o] += (0.3 - base[o] - add[o]) * k; add[o + 2] += (2.7 - base[o + 2] - add[o + 2]) * k;
      add[f] += (1.6 - base[f] - add[f]) * k;
    }

    // титул: дыхание scale 1 ± 0.015 на 0.25 Гц
    if (!play) sy *= 1 + 0.015 * Math.sin(tS * TAU * 0.25) * (1 - wRun);

    out.roll = roll; out.yaw = yaw; out.sy = sy; out.sx = out.sz = sxz / Math.sqrt(sy);
    if (sy === 1) out.sx = out.sz = sxz;

    // моргание и зажмуривание при ударе
    let eye = 1;
    if (blinkT < 0.14) eye = 1 - 0.92 * Math.sin(PI * blinkT / 0.14);
    if (hitT < 0.3) eye = Math.min(eye, 0.15);
    out.eyeL = out.eyeR = eye;

    // мигание неуязвимости (real), в reduced motion не мигаем
    out.visible = !(play && S.grace > 0 && !reduced && hitT > 0.12 && ((tR * 12) | 0) % 2 === 1);

    // ---------- ПРУЖИНЫ (real) ----------
    const wx = S.laneX + base[HX], wy = S.py + base[HX + 1] + add[HX + 1] + out.hopY;
    if (pX !== pX || dR <= 0){ pX = wx; pY = wy; pvx = 0; pvy = 0; }
    if (dR > 0){
      const vx = (wx - pX) / dR, vy2 = (wy - pY) / dR;
      const ax = clamp((vx - pvx) / dR, -250, 250), ay = clamp((vy2 - pvy) / dR, -250, 250);
      pX = wx; pY = wy; pvx = vx; pvy = vy2;
      const gm = reduced ? 0.5 : 1;
      const n = Math.max(1, Math.ceil(dR / 0.0125)), h = dR / n;
      for (let i = 0; i < n; i++){
        // пучки: k 140, c 13, макс 0.03 м
        bvx += (-140 * bx - 13 * bvx - ax * 0.05 * gm) * h; bx += bvx * h;
        bvy += (-140 * by - 13 * bvy - ay * 0.035 * gm) * h; by += bvy * h;
        // рюкзак: k 120, c 9, макс 0.05 м и 6°
        kvx += (-120 * kx - 9 * kvx - ax * 0.06 * gm) * h; kx += kvx * h;
        kvy += (-120 * ky - 9 * kvy - ay * 0.05 * gm) * h; ky += kvy * h;
      }
      bx = clamp(bx, -0.03, 0.03); by = clamp(by, -0.03, 0.03);
      kx = clamp(kx, -0.05, 0.05); ky = clamp(ky, -0.05, 0.05);
    }
    out.bunX = bx; out.bunY = by;
    out.packX = kx; out.packY = ky;
    out.packRx = clamp(-ky * 2.1, -0.105, 0.105); out.packRz = clamp(kx * 2.1, -0.105, 0.105);

    // near-miss: вспышка rim 150 мс
    out.rimFlash = rimFlashT < 0.15 ? 1 : Math.max(0, 1 - (rimFlashT - 0.15) / 0.12);

    // ветер шарфа: встречный поток от скорости, в подкате хвосты вверх, на титуле лёгкий бриз
    const spd = lerp(12, 30, S.speedI);
    if (play){
      out.windX = -lv * 0.25; out.windY = 2.0; out.windZ = spd * 0.75;
      out.flutter = 0.6 + 0.8 * S.speedI; out.lift = 14 * Math.max(0, wSlide) + (wAir > 0.5 && S.vy < 0 ? 5 : 0);
    } else {
      out.windX = 0.8 + 0.6 * Math.sin(tS * 0.7); out.windY = 0.5; out.windZ = 2.2 + 1.2 * Math.sin(tS * 1.3);
      out.flutter = 0.25; out.lift = 0;
    }
    out.wAir = wAir; out.wSlide = wSlide; out.wRun = wRun; out.wOver = wOver;
    return out;
  }

  return {
    S, out, setState, trigger, update,
    setReducedMotion(b){ reduced = !!b; },
    get jumpT(){ return jumpT; }, get hitT(){ return hitT; },
  };
}
