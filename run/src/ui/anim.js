// Время и анимации HUD.
// Все WAAPI-анимации создаются на ПАУЗЕ и двигаются вручную из update(realDt):
// HUD живёт на realDt, кадры для скриншотов детерминированы, а при остановке цикла всё замирает.
// В горячем пути (tick) ноль аллокаций: массивы переиспользуются, строки берутся из готовых таблиц.

export const EASE = {
  outBack: "cubic-bezier(.34,1.56,.64,1)",
  outCubic: "cubic-bezier(.33,1,.68,1)",
  inOutCubic: "cubic-bezier(.65,0,.35,1)",
  outExpo: "cubic-bezier(.16,1,.3,1)",
  inCubic: "cubic-bezier(.32,0,.67,0)",
  outQuad: "cubic-bezier(.5,1,.89,1)",
  label: "cubic-bezier(.22,1,.36,1)",
};
export const easeOutExpo = u => (u >= 1 ? 1 : 1 - Math.pow(2, -10 * u));
export const easeInCubic = u => u * u * u;
export const damp = (a, b, lambda, dt) => a + (b - a) * (1 - Math.exp(-lambda * dt));
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// ---------- таблицы строк (чтобы не строить строки каждый кадр) ----------
export function table(n, fn) { const t = new Array(n + 1); for (let i = 0; i <= n; i++) t[i] = fn(i / n, i); return t; }
export const OPACITY = table(100, u => String(Math.round(u * 100) / 100));
export const SCALE_X = table(400, u => `scaleX(${u.toFixed(4)})`);
// scale 0.6..1.6 шагом 0.004
const SC_MIN = 0.6, SC_STEP = 0.004;
export const SCALE = table(250, (u, i) => `scale(${(SC_MIN + i * SC_STEP).toFixed(3)})`);
export const scaleIndex = s => clamp(Math.round((s - SC_MIN) / SC_STEP), 0, 250);
const DIG = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];

// ---------- часы анимаций ----------
export function createClock() {
  const list = [];            // активные записи
  const pool = [];            // переиспользуемые записи
  let reduced = false;

  // el.animate на паузе; opts: duration, delay, easing, iterations, fill; o.keep — не отменять по окончании
  // o.chan — канал: новая анимация на том же элементе и канале отменяет предыдущую
  function play(el, frames, opts, o) {
    const chan = o && o.chan;
    if (chan) {
      const box = el.__rz || (el.__rz = {});
      const prev = box[chan];
      if (prev && prev.a) { prev.a.cancel(); prev.dead = true; }
    }
    const a = el.animate(frames, { fill: "both", ...opts });
    a.pause(); a.currentTime = 0;
    const r = pool.pop() || {};
    r.a = a; r.t = 0; r.dead = false; r.el = el; r.chan = chan || null;
    r.end = (opts.iterations === Infinity) ? Infinity : (opts.delay || 0) + (opts.duration || 0) * (opts.iterations || 1);
    r.keep = !!(o && o.keep); r.cb = (o && o.done) || null; r.group = (o && o.group) || null;
    if (chan) el.__rz[chan] = r;
    list.push(r);
    return r;
  }
  // обычный таймер на часах HUD (без DOM)
  function after(ms, cb, group) {
    const r = pool.pop() || {};
    r.a = null; r.t = 0; r.end = ms; r.dead = false; r.el = null; r.chan = null; r.keep = false; r.cb = cb; r.group = group || null;
    list.push(r);
    return r;
  }
  function release(i) {
    const r = list[i];
    const last = list.pop();
    if (i < list.length) list[i] = last;
    if (r.el && r.chan && r.el.__rz && r.el.__rz[r.chan] === r) r.el.__rz[r.chan] = null;
    r.a = null; r.el = null; r.cb = null; r.group = null;
    pool.push(r);
  }
  function tick(ms) {
    for (let i = list.length - 1; i >= 0; i--) {
      const r = list[i];
      if (i >= list.length) continue;
      if (r.dead) { release(i); continue; }
      r.t += ms;
      if (r.a) r.a.currentTime = r.t < r.end ? r.t : r.end;
      if (r.t >= r.end) {
        const cb = r.cb;
        if (r.a && !r.keep) r.a.cancel();
        // запись с keep остаётся жить в элементе (fill), но из списка уходит
        if (r.keep && r.el && r.chan && r.el.__rz) r.el.__rz[r.chan] = { a: r.a, dead: false };
        release(i);
        if (cb) cb();
      }
    }
  }
  // отменить всё из группы (например, при смене экрана)
  function cancelGroup(group) {
    for (let i = list.length - 1; i >= 0; i--) {
      const r = list[i];
      if (r.group === group) { if (r.a) r.a.cancel(); r.dead = true; }
    }
  }
  // снять удержанные fill-анимации элемента и его потомков
  function clearEl(el) {
    const an = el.getAnimations({ subtree: true });
    for (let i = 0; i < an.length; i++) an[i].cancel();
    for (let i = 0; i < list.length; i++) if (list[i].el && el.contains(list[i].el)) list[i].dead = true;
  }
  function setReduced(b) { reduced = b; }
  return { play, after, tick, cancelGroup, clearEl, setReduced, get reduced() { return reduced; }, get count() { return list.length; } };
}

// ---------- число из цифр-спанов: запись без аллокаций ----------
export function numView(parent, maxDigits) {
  const cells = [];
  parent.classList.add("rz-num");
  for (let i = 0; i < maxDigits; i++) {
    const c = document.createElement("i");
    c.textContent = "0";
    parent.appendChild(c);
    cells.push(c);
  }
  const shown = new Int8Array(maxDigits).fill(-2);
  let value = -1;
  function set(v) {
    v = v < 0 ? 0 : Math.floor(v);
    if (v === value) return;
    value = v;
    let x = v;
    for (let i = maxDigits - 1; i >= 0; i--) {
      const d = x % 10;
      const lead = x === 0 && i < maxDigits - 1;       // ведущий ноль скрыт
      const code = lead ? -1 : d;
      if (shown[i] !== code) {
        shown[i] = code;
        if (lead) cells[i].hidden = true;
        else { cells[i].hidden = false; cells[i].textContent = DIG[d]; }
      }
      x = (x - d) / 10;
    }
  }
  set(0);
  return { set, get value() { return value; } };
}

// ---------- пружина scale: s'' = −k·(s−1) − c·s' ----------
export function spring(el, k = 320, c = 16, max = 1.35) {
  let s = 1, v = 0, idx = -1;
  return {
    kick(imp) { v += imp; },
    tick(dt) {
      // полунеявный Эйлер с подшагами — устойчиво при просадках fps
      let n = Math.ceil(dt / 0.008); if (n > 8) n = 8;
      const h = dt / n;
      for (let i = 0; i < n; i++) { v += (-k * (s - 1) - c * v) * h; s += v * h; if (s > max) { s = max; if (v > 0) v = 0; } }
      if (Math.abs(s - 1) < 0.0015 && Math.abs(v) < 0.01) { s = 1; v = 0; }
      const j = scaleIndex(s);
      if (j !== idx) { idx = j; el.style.transform = SCALE[j]; }
    },
    reset() { s = 1; v = 0; idx = scaleIndex(1); el.style.transform = SCALE[idx]; },
    get s() { return s; },
  };
}
