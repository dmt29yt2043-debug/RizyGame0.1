// VFX-4: DOM-конфетти для UI (миссия выполнена, новый рекорд). Canvas 2D поверх игры, pointer-events: none.
// Отступление от библии (записано): вместо файла canvas-confetti v1.9.3 — своя реализация того же API-подмножества
// (particleCount, angle, spread, startVelocity, decay, gravity, drift, ticks, origin, colors, scalar) и той же физики
// «на тик 1/60»: без скачивания стороннего кода и без аллокаций в кадре. Формы — войлочные скруглённые
// прямоугольники и кружки (никаких острых квадратов), переворот по оси даёт тёмную изнанку.
// Reduced motion: частиц −70% (библия 2.0 / HUD-8).

const MAX = 900;
const RM_MUL = 0.3;

// пресеты из библии VFX-4 (координаты origin — доли экрана)
export const CONFETTI_PRESETS = {
  mission: [{ particleCount: 40, spread: 70, startVelocity: 28, scalar: 0.8, ticks: 120, origin: { x: 0.5, y: 0.08 },
    colors: ["#C0FF3F", "#0536D4", "#FFFFFF"] }],
  record: [
    { particleCount: 90, angle: 60, spread: 55, startVelocity: 55, origin: { x: 0, y: 0.9 }, colors: ["#C0FF3F", "#0536D4", "#FFFFFF", "#8FD3FF"] },
    { particleCount: 90, angle: 120, spread: 55, startVelocity: 55, origin: { x: 1, y: 0.9 }, colors: ["#C0FF3F", "#0536D4", "#FFFFFF", "#8FD3FF"] },
    { delay: 0.35, particleCount: 50, angle: 60, spread: 55, startVelocity: 55, origin: { x: 0, y: 0.9 }, colors: ["#C0FF3F", "#0536D4", "#FFFFFF", "#8FD3FF"] },
    { delay: 0.35, particleCount: 50, angle: 120, spread: 55, startVelocity: 55, origin: { x: 1, y: 0.9 }, colors: ["#C0FF3F", "#0536D4", "#FFFFFF", "#8FD3FF"] },
  ],
};

const DEF = { particleCount: 50, angle: 90, spread: 45, startVelocity: 45, decay: 0.9, gravity: 1, drift: 0, ticks: 200,
  scalar: 1, colors: ["#C0FF3F", "#0536D4", "#FFFFFF"] };

// "#RRGGBB" → изнанка (темнее на 28%) — считается один раз на цвет
function shade(hex, k){
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * k), g = Math.round(((n >> 8) & 255) * k), b = Math.round((n & 255) * k);
  return "rgb(" + r + "," + g + "," + b + ")";
}

export function createConfetti(opts){
  const o0 = opts || {};
  const parent = o0.parent || (typeof document !== "undefined" ? document.body : null);
  const auto = o0.auto !== false;                  // false — кадры двигает step(dt) (тесты/стенд)
  let reduced = !!o0.reducedMotion;
  let canvas = null, g = null, W = 0, H = 0, dpr = 1;

  // пул частиц: плоские типизированные массивы, без объектов
  const X = new Float32Array(MAX), Y = new Float32Array(MAX), V = new Float32Array(MAX), A2 = new Float32Array(MAX);
  const DEC = new Float32Array(MAX), GR = new Float32Array(MAX), DR = new Float32Array(MAX), SC = new Float32Array(MAX);
  const WOB = new Float32Array(MAX), WS = new Float32Array(MAX), TILT = new Float32Array(MAX), TS = new Float32Array(MAX);
  const TICK = new Float32Array(MAX), TT = new Float32Array(MAX), SHAPE = new Uint8Array(MAX), COL = new Uint16Array(MAX);
  const ALIVE = new Uint8Array(MAX);
  let live = 0, w = 0;
  // палитра: индекс → [лицо, изнанка]
  const palFront = [], palBack = [], palIdx = new Map();
  function colorIndex(hex){
    let i = palIdx.get(hex);
    if (i === undefined){ i = palFront.length; palFront.push(hex); palBack.push(shade(hex, 0.72)); palIdx.set(hex, i); }
    return i;
  }
  // отложенные волны (вторая волна рекорда через 350 мс)
  const pendT = new Float32Array(8), pendO = new Array(8).fill(null);
  let clock = 0, raf = 0, lastNow = 0;

  function ensureCanvas(){
    if (canvas || !parent) return !!canvas;
    canvas = document.createElement("canvas");
    canvas.className = "fx-confetti";
    canvas.style.cssText = "position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:" + (o0.zIndex != null ? o0.zIndex : 40);
    parent.appendChild(canvas);
    g = canvas.getContext("2d");
    resize();
    if (typeof window !== "undefined") window.addEventListener("resize", resize);
    return true;
  }
  function resize(){
    if (!canvas) return;
    dpr = Math.min(2, (typeof devicePixelRatio === "number" ? devicePixelRatio : 1));
    W = canvas.clientWidth || innerWidth; H = canvas.clientHeight || innerHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  }

  function burst(o){
    if (!ensureCanvas()) return 0;
    const cnt = Math.round((o.particleCount != null ? o.particleCount : DEF.particleCount) * (reduced ? RM_MUL : 1));
    const angle = (o.angle != null ? o.angle : DEF.angle) * Math.PI / 180;
    const spread = (o.spread != null ? o.spread : DEF.spread) * Math.PI / 180;
    const sv = o.startVelocity != null ? o.startVelocity : DEF.startVelocity;
    const decay = o.decay != null ? o.decay : DEF.decay, grav = (o.gravity != null ? o.gravity : DEF.gravity) * 3;
    const drift = o.drift != null ? o.drift : DEF.drift, ticks = o.ticks != null ? o.ticks : DEF.ticks;
    const scalar = o.scalar != null ? o.scalar : DEF.scalar;
    const cols = o.colors || DEF.colors;
    const ox = (o.origin && o.origin.x != null ? o.origin.x : 0.5) * W, oy = (o.origin && o.origin.y != null ? o.origin.y : 0.5) * H;
    for (let n = 0; n < cnt; n++){
      const i = w; w = (w + 1) % MAX;
      if (!ALIVE[i]) live++;
      ALIVE[i] = 1;
      X[i] = ox; Y[i] = oy;
      V[i] = sv * 0.5 + Math.random() * sv;
      A2[i] = -angle + (0.5 * spread - Math.random() * spread);
      DEC[i] = decay; GR[i] = grav; DR[i] = drift; SC[i] = scalar;
      WOB[i] = Math.random() * 10; WS[i] = Math.min(0.11, Math.random() * 0.1 + 0.05);
      TILT[i] = (Math.random() * 0.5 + 0.25) * Math.PI; TS[i] = Math.random() * 0.1 + 0.05;
      TICK[i] = 0; TT[i] = ticks;
      SHAPE[i] = Math.random() < 0.3 ? 1 : 0;                  // 30% кружков, остальное — скруглённые «войлочные» полоски
      COL[i] = colorIndex(cols[n % cols.length]);
    }
    kick();
    return cnt;
  }

  // fire(opts | opts[]) — как canvas-confetti; у элемента массива может быть delay (с)
  function fire(o){
    if (Array.isArray(o)){ let n = 0; for (let i = 0; i < o.length; i++) n += fire(o[i]); return n; }
    if (!o) return 0;
    if (o.delay > 0){
      for (let k = 0; k < pendO.length; k++) if (!pendO[k]){ pendO[k] = o; pendT[k] = clock + o.delay; kick(); return 0; }
      return 0;
    }
    return burst(o);
  }
  const mission = () => fire(CONFETTI_PRESETS.mission);
  const record = () => fire(CONFETTI_PRESETS.record);

  function kick(){
    if (!auto || raf || typeof requestAnimationFrame === "undefined") return;
    lastNow = performance.now();
    raf = requestAnimationFrame(loop);
  }
  function loop(now){
    const dt = Math.min(0.1, Math.max(0, (now - lastNow) / 1000)); lastNow = now;
    step(dt);
    raf = (live > 0 || hasPending()) ? requestAnimationFrame(loop) : 0;
  }
  function hasPending(){ for (let k = 0; k < pendO.length; k++) if (pendO[k]) return true; return false; }

  // шаг физики «на тик» (1 тик = 1/60 с) и отрисовка
  function step(dt){
    clock += dt;
    for (let k = 0; k < pendO.length; k++) if (pendO[k] && clock >= pendT[k]){ const o = pendO[k]; pendO[k] = null; burst(o); }
    if (!g) return;
    const kt = dt * 60;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, canvas.width, canvas.height);
    if (live === 0) return;
    for (let i = 0; i < MAX; i++){
      if (!ALIVE[i]) continue;
      X[i] += Math.cos(A2[i]) * V[i] * kt + DR[i] * kt;
      Y[i] += Math.sin(A2[i]) * V[i] * kt + GR[i] * kt;
      V[i] *= Math.pow(DEC[i], kt);
      WOB[i] += WS[i] * kt; TILT[i] += TS[i] * kt; TICK[i] += kt;
      const prog = TICK[i] / TT[i];
      if (prog >= 1 || Y[i] > H + 40){ ALIVE[i] = 0; live--; continue; }
      const s = SC[i], flip = Math.cos(TILT[i]), rot = WOB[i] * 0.6;
      const cs = Math.cos(rot), sn = Math.sin(rot);
      // покачивание как у canvas-confetti (wobble ±10·scalar)
      const px = X[i] + 10 * s * Math.cos(WOB[i]) * 0.5, py = Y[i] + 10 * s * Math.sin(WOB[i]) * 0.5;
      const fy = Math.abs(flip) < 0.12 ? (flip < 0 ? -0.12 : 0.12) : flip;
      g.setTransform(dpr * cs, dpr * sn, -dpr * sn * fy, dpr * cs * fy, dpr * px, dpr * py);
      g.globalAlpha = prog < 0.7 ? 1 : 1 - (prog - 0.7) / 0.3;
      g.fillStyle = flip >= 0 ? palFront[COL[i]] : palBack[COL[i]];
      g.beginPath();
      if (SHAPE[i]) g.arc(0, 0, 4.2 * s, 0, 6.2832);
      else {
        const hw = 4 * s, hh = 6.5 * s, r = 2.6 * s;
        // скруглённый прямоугольник вручную (roundRect есть не везде)
        g.moveTo(-hw + r, -hh); g.lineTo(hw - r, -hh); g.quadraticCurveTo(hw, -hh, hw, -hh + r);
        g.lineTo(hw, hh - r); g.quadraticCurveTo(hw, hh, hw - r, hh); g.lineTo(-hw + r, hh);
        g.quadraticCurveTo(-hw, hh, -hw, hh - r); g.lineTo(-hw, -hh + r); g.quadraticCurveTo(-hw, -hh, -hw + r, -hh);
      }
      g.fill();
    }
    g.globalAlpha = 1;
    g.setTransform(1, 0, 0, 1, 0, 0);
  }

  function clear(){
    ALIVE.fill(0); live = 0; pendO.fill(null);
    if (g){ g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, canvas.width, canvas.height); }
  }
  function dispose(){
    clear();
    if (raf && typeof cancelAnimationFrame !== "undefined") cancelAnimationFrame(raf);
    raf = 0;
    if (typeof window !== "undefined") window.removeEventListener("resize", resize);
    if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
    canvas = null; g = null;
  }

  return {
    fire, mission, record, step, clear, dispose, resize,
    setReducedMotion(b){ reduced = !!b; },
    stats(){ return { live, pending: hasPending(), reduced }; },
    get canvas(){ return canvas; },
  };
}
