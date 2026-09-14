// HUD-кит «Ризи RUN»: самодостаточный DOM-интерфейс поверх канваса.
// createHUD(ctx, { container }) → API (см. README-комментарий внизу файла и отчёт кита).
// Живёт на realDt: хит-стоп и пауза мира HUD не замораживают. Горячий путь update() без аллокаций.
import { EASE, createClock, numView, spring, damp, clamp, OPACITY, SCALE_X, table, easeOutExpo } from "./anim.js";
import { buildDOM, RING_C } from "./hud-dom.js";
import { gemSVG } from "./icons.js";

const CSS_URL = new URL("./hud.css", import.meta.url).href;
const DASH = table(200, u => (RING_C * (1 - u)).toFixed(2));

// CSS подключаем сами; промис резолвится, когда стиль и шрифт готовы (для скриншотов)
function ensureAssets() {
  let link = document.querySelector("link[data-rz-hud]");
  const cssReady = new Promise(res => {
    if (link && link.sheet) return res();
    if (!link) {
      link = document.createElement("link");
      link.rel = "stylesheet"; link.href = CSS_URL; link.dataset.rzHud = "1";
      document.head.appendChild(link);
    }
    link.addEventListener("load", res, { once: true });
    link.addEventListener("error", res, { once: true });
  });
  return cssReady.then(() => Promise.all([
    document.fonts.load('900 32px "RizyNunito"', "РИЗИ RUN 0123456789"),
    document.fonts.load('800 18px "RizyNunito"', "Снежная Река"),
  ]).catch(() => null));
}

const TUT_TEXT = {
  left: "Свайп влево — сменить полосу", right: "Свайп вправо — сменить полосу",
  up: "Свайп вверх — прыжок!", down: "Свайп вниз — подкат!", tap: "Нажми, чтобы бежать!",
};
const TUT_KEYS = { left: "←", right: "→", up: "↑", down: "↓", tap: "Пробел" };
const TUT_DIR = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1], tap: [0, 0] };

export function createHUD(ctx = {}, opts = {}) {
  const container = opts.container || document.body;
  const quality = ctx.quality || "med";
  const touch = opts.touch ?? (typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches);
  const step = opts.milestoneStep || (ctx.cfg && ctx.cfg.milestoneStep) || 250;
  const edges = opts.edges !== false;

  const root = document.createElement("div");
  root.className = `rz-hud rz-q-${quality}`;
  const R = buildDOM(root, { touch });
  container.appendChild(root);
  const ready = ensureAssets();

  const clock = createClock();
  const handlers = new Map();
  const emit = (e, p) => { const l = handlers.get(e); if (l) for (const fn of l) { try { fn(p); } catch (err) { console.error("[hud]", e, err); } } };

  // ---------- раскладка ----------
  let W = container.clientWidth || innerWidth, H = container.clientHeight || innerHeight, portrait = false;
  function layout() {
    W = container.clientWidth || innerWidth; H = container.clientHeight || innerHeight;
    portrait = W < 700 && H > W;
    root.classList.toggle("rz-portrait", portrait);
  }
  layout();
  const ro = typeof ResizeObserver === "function" ? new ResizeObserver(layout) : null;
  if (ro) ro.observe(container); else addEventListener("resize", layout);

  // ---------- reduced motion ----------
  const mq = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
  let rm = opts.reducedMotion ?? (mq ? mq.matches : false);
  const onMQ = e => { if (opts.reducedMotion == null) setReducedMotion(e.matches); };
  if (mq && mq.addEventListener) mq.addEventListener("change", onMQ);
  root.classList.toggle("rz-rm", rm); clock.setReduced(rm);

  // ---------- ввод: кнопки и «глушилка» для слушателей main на window ----------
  const stopEv = ev => ev.stopPropagation();
  const STOP = ["pointerdown", "pointerup", "mousedown", "touchstart", "touchend", "click"];
  const guard = el => { for (const t of STOP) el.addEventListener(t, stopEv, { passive: true }); };
  [R.pauseBtn, R.gear, R.pause, R.results].forEach(guard);

  let screen = "none", overlay = null, locked = false, resResolve = null;
  function act(name) {
    if (name === "restart" || name === "menu") {
      if (screen !== "results" || locked) { if (screen === "pause" && name === "menu") emit("menu"); return; }
      const r = resResolve; resResolve = null;
      emit(name);
      if (r) r(name);
      return;
    }
    emit(name);
  }
  root.addEventListener("click", ev => {
    const b = ev.target.closest("[data-act]");
    if (!b || !root.contains(b)) return;
    const a = b.dataset.act;
    if (a === "start") return;              // старт на титуле — pointerup ниже
    act(a);
  });
  // тап по титулу: событие start (main и так стартует по своему pointerdown — адаптер решает, слушать ли)
  R.title.querySelector(".rz-title-tap").addEventListener("pointerup", () => emit("start"));
  const onVol = () => {
    R.volM.style.setProperty("--v", R.volM.value + "%"); R.volS.style.setProperty("--v", R.volS.value + "%");
    emit("volume", { music: R.volM.value / 100, sfx: R.volS.value / 100 });
  };
  R.volM.addEventListener("input", onVol); R.volS.addEventListener("input", onVol);

  // клавиши на карточке результатов: блокировка 1 с, дальше Space/Enter/↑ = «Ещё раз!», Esc = меню.
  // Слушаем в фазе capture и глушим событие, чтобы main не перезапустил забег мимо HUD.
  const onKey = ev => {
    if (screen !== "results" || opts.keys === false) return;
    const c = ev.code;
    const isGo = c === "Space" || c === "Enter" || c === "NumpadEnter" || c === "ArrowUp" || c === "KeyW";
    const isEsc = c === "Escape";
    if (!isGo && !isEsc) return;
    ev.preventDefault(); ev.stopImmediatePropagation();
    if (locked || ev.repeat) return;
    act(isGo ? "restart" : "menu");
  };
  addEventListener("keydown", onKey, true);

  // ---------- состояние игрового HUD ----------
  const distN = numView(R.distN, 6), goalN = numView(R.goal, 5), leftN = numView(R.left, 4);
  const enN = numView(R.enN, 5), streakN = numView(R.streakN, 3), pctN = numView(R.pctN, 4);
  const tBestN = numView(R.tBest, 6), tStarsN = numView(R.tStars, 3), rBestN = numView(R.rBest, 6);
  const rDistN = numView(R.rDistN, 6), rEnN = numView(R.rEnN, 5), rBonusN = numView(R.rBonusN, 5), rTotalN = numView(R.rTotalN, 6);
  const enSpring = spring(R.enBody), distSpring = spring(R.distBody);
  let best = 0;
  let enTarget = 0, enDisplay = 0, flashT = 0;
  let streakCount = 0, streakIdle = 9, streakShown = false;
  let comboTier = 0, comboVis = false, ringTarget = 0, ringShown = 0, ringIdx = -1;
  let dTarget = 0, dShown = 0, dPhase = 0, vigIdx = -1, swOpIdx = -1, swFillIdx = -1;
  let hudTime = 0, lastToast = -99, lblNext = 0, lblSide = 1;
  const flyBusy = [false, false, false];

  // ---------- экраны ----------
  const SCREENS = { play: R.play, title: R.title, pause: R.pause, results: R.results };
  function show(name) {
    const prev = screen;
    if (name === prev) return;
    screen = name;
    // пауза — оверлей поверх игры; результаты скрывают игровой HUD
    const base = name === "pause" ? "play" : name;
    for (const k in SCREENS) {
      const on = k === base || k === name;
      const el = SCREENS[k];
      if (!on && !el.hidden) { clock.cancelGroup(k); if (k !== "play") clock.clearEl(el); el.hidden = true; }
      else if (on && el.hidden) { el.hidden = false; enter(k); }
    }
    if (name !== "results") { locked = false; }
    if (name !== "play" && name !== "pause") hideTransient();
    emit("screen", name);
  }
  function hideTransient() {
    tutorial(null);
    clock.clearEl(R.cd); clock.clearEl(R.banner); clock.clearEl(R.toast);
  }
  function enter(k) {
    const d = rm ? 1 : 1;       // длительности масштабируются ниже по месту
    if (k === "title") {
      clock.play(R.logo, rm
        ? [{ opacity: 0 }, { opacity: 1 }]
        : [{ opacity: 0, transform: "translateY(-40px) scale(.8)" }, { opacity: 1, transform: "translateY(0) scale(1)" }],
        { duration: rm ? 300 : 550, delay: rm ? 0 : 150, easing: EASE.outBack }, { keep: true, chan: "in", group: "title" });
      clock.play(R.titleBot, [{ opacity: 0, transform: rm ? "none" : "translateY(18px)" }, { opacity: 1, transform: "none" }],
        { duration: 320 * d, delay: rm ? 0 : 420, easing: EASE.outCubic }, { keep: true, chan: "in", group: "title" });
      if (!rm) clock.play(R.prompt, [{ opacity: 1 }, { opacity: 0.55 }, { opacity: 1 }],
        { duration: 1400, delay: 750, iterations: Infinity, easing: "ease-in-out" }, { chan: "pulse", group: "title" });
    } else if (k === "play") {
      enSpring.reset(); distSpring.reset();
      for (const el of [R.tl, R.tr]) clock.play(el, [{ opacity: 0, transform: rm ? "none" : "translateY(-14px)" }, { opacity: 1, transform: "none" }],
        { duration: rm ? 200 : 320, easing: EASE.outBack }, { chan: "in" });
    } else if (k === "pause") {
      clock.play(R.pauseShade, [{ opacity: 0 }, { opacity: 1 }], { duration: rm ? 1 : 180, easing: "linear" }, { keep: true, chan: "in", group: "pause" });
      clock.play(R.pauseCard, [{ opacity: 0, transform: rm ? "none" : "scale(.9)" }, { opacity: 1, transform: "none" }],
        { duration: rm ? 1 : 220, easing: EASE.outBack }, { keep: true, chan: "in", group: "pause" });
      clock.after(rm ? 1 : 200, () => R.resumeBtn.focus({ preventScroll: true }), "pause");
    }
  }

  // ---------- числа ----------
  function setDistance(m) {
    distN.set(m);
    const goal = (Math.floor(m / step) + 1) * step;
    goalN.set(goal); leftN.set(Math.ceil(goal - m));
  }
  function setBest(m) { best = m; tBestN.set(m); rBestN.set(m); }
  function setStars(n) { tStarsN.set(n); }

  function setEnergons(n, o) {
    const instant = o && o.instant;
    if (instant || n < enTarget) {
      enTarget = enDisplay = n; enN.set(n);
      streakCount = 0; if (streakShown) { streakShown = false; clock.clearEl(R.streak); }
      return;
    }
    const inc = n - enTarget;
    enTarget = n;
    if (inc <= 0 || (o && o.bump === false)) return;
    if (!rm) enSpring.kick(2.4);
    flash();
    streakCount = (o && o.streak != null) ? o.streak : streakCount + inc;
    streakIdle = 0;
    if (streakCount >= 2) {
      streakN.set(streakCount);
      streakShown = true;
      clock.play(R.streak, rm
        ? [{ opacity: 1, transform: "none" }, { opacity: 1, transform: "none" }]
        : [{ opacity: 1, transform: "scale(1)" }, { opacity: 1, transform: "scale(1.15)", offset: 0.5 }, { opacity: 1, transform: "scale(1)" }],
        { duration: 160, easing: "ease-out" }, { keep: true, chan: "s" });
    }
  }
  function flash() { flashT = 0.09; R.enN.classList.add("flash"); }

  // полёт энергона из точки экрана (px относительно контейнера) в иконку счётчика
  function flyToCounter(x, y) {
    let slot = -1;
    for (let i = 0; i < 3; i++) if (!flyBusy[i]) { slot = i; break; }
    if (slot < 0 || rm) { if (!rm) enSpring.kick(3.6); flash(); return false; }
    const rr = root.getBoundingClientRect(), ir = R.enIco.getBoundingClientRect();
    const tx = ir.left - rr.left + ir.width / 2, ty = ir.top - rr.top + ir.height / 2;
    const cx = (x + tx) / 2, cy = Math.min(y, ty) - 120;
    const frames = [];
    const N = 16;
    for (let i = 0; i <= N; i++) {
      const u = i / N, e = u * u * u, a = 1 - e;          // easeInCubic по времени
      const px = a * a * x + 2 * a * e * cx + e * e * tx, py = a * a * y + 2 * a * e * cy + e * e * ty;
      const s = 1.15 - 0.35 * e;
      frames.push({ offset: u, opacity: u === 0 ? 0 : u > 0.97 ? 0.6 : 1, transform: `translate3d(${px.toFixed(1)}px,${py.toFixed(1)}px,0) scale(${s.toFixed(3)}) rotate(${(e * 200).toFixed(0)}deg)` });
    }
    flyBusy[slot] = true;
    clock.play(R.flies[slot], frames, { duration: 420, easing: "linear" }, {
      done: () => { flyBusy[slot] = false; enSpring.kick(3.6); flash(); emit("fly:arrive"); },
    });
    return true;
  }
  // проекция мировой точки в координаты HUD (out — переиспользуемый объект {x,y})
  let _pv = null;
  function projectToHUD(v3, out) {
    if (!ctx.camera) return null;
    if (!_pv) _pv = v3.clone();
    _pv.copy(v3).project(ctx.camera);
    out.x = (_pv.x * 0.5 + 0.5) * W; out.y = (-_pv.y * 0.5 + 0.5) * H;
    return out;
  }

  // ---------- всплывающие метки ----------
  const LBL_KIND = { plus: "", big: "big", nice: "nice", warn: "warn", info: "info" };
  function popLabel(text, kind = "plus", x, y) {
    const n = quality === "low" ? 6 : 10;
    const i = lblNext; lblNext = (lblNext + 1) % n;
    const wrap = R.labels[i], span = R.labelSpans[i];
    clock.clearEl(wrap);
    wrap.className = "rz-lbl " + (LBL_KIND[kind] || "");
    span.textContent = text;
    lblSide = -lblSide;
    const px = x != null ? x : W / 2 + (kind === "nice" ? 0 : lblSide * 22);
    const py = y != null ? y : H * (kind === "nice" ? 0.33 : 0.4);
    wrap.style.transform = `translate3d(${px.toFixed(1)}px,${py.toFixed(1)}px,0)`;
    const rot = kind === "nice" ? " rotate(-4deg)" : "";
    const T = "translate(-50%,-50%) ";
    clock.play(span, rm
      ? [{ opacity: 0, transform: T + rot }, { opacity: 1, offset: 0.15, transform: T + rot }, { opacity: 1, offset: 0.7, transform: T + rot }, { opacity: 0, transform: T + rot }]
      : [
        { offset: 0, opacity: 0, transform: `${T}translateY(0) scale(.6)${rot}` },
        { offset: 0.14, opacity: 1, transform: `${T}translateY(-14px) scale(1.18)${rot}` },
        { offset: 0.6, opacity: 1, transform: `${T}translateY(-44px) scale(1)${rot}` },
        { offset: 1, opacity: 0, transform: `${T}translateY(-70px) scale(.92)${rot}` },
      ], { duration: kind === "nice" ? 900 : 700, easing: EASE.label }, { chan: "p" });
  }

  // ---------- комбо ----------
  function setCombo(tier, progress = 0, o) {
    const mult = (o && o.mult != null) ? o.mult : tier;
    const vis = tier > 1 || progress > 0.001;
    if (vis !== comboVis) {
      comboVis = vis;
      R.pct.hidden = !vis;
      clock.play(R.combo, vis
        ? [{ opacity: 0, transform: rm ? "none" : "scale(.5)" }, { opacity: 1, transform: "none" }]
        : [{ opacity: 1, transform: "none" }, { opacity: 0, transform: rm ? "none" : "scale(.7)" }],
        { duration: vis ? 260 : 180, easing: vis ? EASE.outBack : EASE.outCubic }, { keep: true, chan: "vis" });
    }
    if (tier !== comboTier) R.comboX.textContent = String(Math.max(1, tier));
    if (tier > comboTier && comboTier >= 1) {
      ringShown = 0;
      if (!rm) {
        clock.play(R.comboIn, [
          { offset: 0, transform: "scale(1)", easing: EASE.outQuad },
          { offset: 110 / 390, transform: "scale(1.45)", easing: EASE.outBack },
          { offset: 1, transform: "scale(1)" }], { duration: 390, easing: "linear" }, { chan: "pop" });
        clock.play(R.wave, [{ opacity: 0.8, transform: "scale(1)" }, { opacity: 0, transform: "scale(2.4)" }],
          { duration: 450, easing: EASE.outCubic }, { chan: "w" });
      }
      emit("combo:tier", tier);
    } else if (tier < comboTier && comboTier > 1 && !rm) {
      clock.play(R.comboIn, [
        { transform: "translateX(0)" }, { transform: "translateX(-6px)" }, { transform: "translateX(6px)" },
        { transform: "translateX(-6px)" }, { transform: "translateX(6px)" }, { transform: "translateX(-6px)" },
        { transform: "translateX(0)" }], { duration: 240, easing: "linear" }, { chan: "pop" });
    }
    comboTier = tier;
    ringTarget = clamp(progress, 0, 1);
    pctN.set(Math.round((mult - 1) * 100 + 100 * ringTarget));
  }

  // ---------- миссия ----------
  let misTpl = null, misN = null, misProg = 0, misStarsN = -1, misRoll = null;
  function renderStars(el, filled, total) {
    let s = "";
    for (let i = 0; i < total; i++) s += R.starSVG(i < filled);
    el.innerHTML = s;
  }
  function buildMissionText(tpl, n) {
    R.misTxt.textContent = "";
    const parts = tpl.split("{n}");
    misRoll = null;
    parts.forEach((p, i) => {
      if (p) R.misTxt.appendChild(document.createTextNode(p.trim() === "" ? " " : p));
      if (i < parts.length - 1) {
        misRoll = document.createElement("span");
        misRoll.className = "rz-mis-roll";
        misRoll.innerHTML = `<span>${n}</span>`;
        R.misTxt.appendChild(misRoll);
      }
    });
  }
  function setMission(text, progress = 0, o = {}) {
    if (text == null) { R.mis.hidden = true; misTpl = null; return; }
    const wasHidden = R.mis.hidden;
    R.mis.hidden = false;
    const n = o.n;
    if (text !== misTpl) {
      misTpl = text; misN = n;
      buildMissionText(text, n);
    } else if (n != null && n !== misN && misRoll) {
      // шаг: старое число уходит вверх, новое приходит снизу
      const old = misRoll.firstElementChild;
      const nu = document.createElement("span"); nu.textContent = String(n);
      misRoll.appendChild(nu);
      misN = n;
      if (rm) { old.remove(); }
      else {
        clock.play(old, [{ transform: "translateY(0)", opacity: 1 }, { transform: "translateY(-100%)", opacity: 0 }], { duration: 160, easing: EASE.outCubic }, { done: () => old.remove() });
        clock.play(nu, [{ transform: "translateY(100%)", opacity: 0 }, { transform: "translateY(0)", opacity: 1 }], { duration: 160, easing: EASE.outCubic });
      }
      emit("mission:step", n);
    }
    const total = o.total || 3, stars = o.stars != null ? o.stars : Math.max(0, misStarsN);
    if (stars !== misStarsN || !R.misStars.firstChild) { misStarsN = stars; renderStars(R.misStars, stars, total); }
    const p = clamp(progress, 0, 1);
    clock.play(R.misFill, [{ transform: SCALE_X[Math.round(misProg * 400)] }, { transform: SCALE_X[Math.round(p * 400)] }],
      { duration: rm || wasHidden ? 1 : 250, easing: EASE.outCubic }, { keep: true, chan: "bar" });
    misProg = p;
    if (o.intro) {
      const top = R.mis.offsetTop || 16;
      const dy = Math.max(0, H * (portrait ? 0.27 : 0.25) - top);
      clock.play(R.mis, rm
        ? [{ opacity: 0 }, { opacity: 1, offset: 0.1 }, { opacity: 1 }]
        : [
          { offset: 0, opacity: 0, transform: `translateY(${dy}px) scale(.9)`, easing: EASE.outBack },
          { offset: 260 / 2900, opacity: 1, transform: `translateY(${dy}px) scale(1.35)` },
          { offset: 2500 / 2900, opacity: 1, transform: `translateY(${dy}px) scale(1.35)`, easing: EASE.inOutCubic },
          { offset: 1, opacity: 1, transform: "translateY(0) scale(1)" }],
        { duration: rm ? 600 : 2900, easing: "linear" }, { keep: true, chan: "intro" });
    }
  }
  function missionComplete(o = {}) {
    return new Promise(resolve => {
      const total = o.total || 3, filled = o.stars != null ? o.stars : Math.min(total, misStarsN + 1);
      renderStars(R.misStarsDone, filled, total);
      const k = rm ? 1 : 1;
      const wide = 340 / 280;
      clock.play(R.misBg, [{ transform: "scaleX(1)" }, { transform: `scaleX(${wide})` }], { duration: 200 * k, easing: EASE.outBack }, { keep: true, chan: "w" });
      clock.play(R.misLime, [{ opacity: 0, transform: "scaleX(1)" }, { opacity: 1, transform: `scaleX(${wide})` }], { duration: 200, easing: EASE.outBack }, { keep: true, chan: "w" });
      clock.play(R.misIn, [{ opacity: 1 }, { opacity: 0 }], { duration: 120 }, { keep: true, chan: "o" });
      clock.play(R.misBar, [{ opacity: 1 }, { opacity: 0 }], { duration: 120 }, { keep: true, chan: "o" });
      clock.play(R.misDone, [{ opacity: 0, transform: rm ? "none" : "scale(.8)" }, { opacity: 1, transform: "none" }], { duration: 200, delay: 60, easing: EASE.outBack }, { keep: true, chan: "o" });
      clock.play(R.misCheck, [{ strokeDashoffset: 26 }, { strokeDashoffset: 0 }], { duration: 250, delay: 120, easing: EASE.outCubic }, { keep: true, chan: "c" });
      const stars = R.misStarsDone.children;
      for (let i = 0; i < stars.length; i++) {
        if (i >= filled || rm) continue;
        clock.play(stars[i], [{ transform: "scale(0)", offset: 0 }, { transform: "scale(1.3)", offset: 0.6 }, { transform: "scale(1)" }],
          { duration: 220, delay: 200 + 90 * i, easing: EASE.outCubic }, { keep: true, chan: "st" });
      }
      emit("mission:complete");
      const rr = root.getBoundingClientRect(), mr = R.mis.getBoundingClientRect();
      emit("confetti", { kind: "mission", x: mr.left - rr.left + mr.width / 2, y: mr.top - rr.top + mr.height / 2 });
      clock.after(200 + 1400, () => {
        // уход «ГОТОВО!» и въезд следующей миссии справа
        clock.play(R.misDone, [{ opacity: 1 }, { opacity: 0 }], { duration: 160 }, { keep: true, chan: "o" });
        clock.play(R.misLime, [{ opacity: 1, transform: `scaleX(${wide})` }, { opacity: 0, transform: "scaleX(1)" }], { duration: 220, easing: EASE.outCubic }, { keep: true, chan: "w" });
        clock.play(R.misBg, [{ transform: `scaleX(${wide})` }, { transform: "scaleX(1)" }], { duration: 220, easing: EASE.outCubic }, { keep: true, chan: "w" });
        const nx = o.next;
        if (nx) { misProg = 0; setMission(nx.text, nx.progress || 0, nx); }
        else { clock.after(220, () => { R.mis.hidden = true; misTpl = null; }); }
        clock.play(R.misIn, [{ opacity: 0, transform: rm ? "none" : "translateX(60px)" }, { opacity: 1, transform: "none" }], { duration: 300, delay: 120, easing: EASE.outCubic }, { keep: true, chan: "o" });
        clock.play(R.misBar, [{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay: 120 }, { keep: true, chan: "o" });
        clock.after(420, resolve);
      });
    });
  }

  // ---------- опасность ----------
  function setDanger(d) { dTarget = clamp(d || 0, 0, 1); }

  // ---------- отсчёт ----------
  function countdown(n) {
    return new Promise(resolve => {
      const go = !(n > 0);
      R.cd.classList.toggle("go", go);
      R.cdTxt.textContent = go ? "ВПЕРЁД!" : String(n);
      const T = "translate(-50%,-50%) ";
      clock.play(R.cdTxt, rm
        ? [{ opacity: 0, transform: T }, { opacity: 1, offset: 0.3, transform: T }, { opacity: 1, offset: 0.75, transform: T }, { opacity: 0, transform: T }]
        : [
          { offset: 0, opacity: 0, transform: T + "scale(2)", easing: EASE.outBack },
          { offset: 0.3, opacity: 1, transform: T + "scale(1)" },
          { offset: 0.75, opacity: 1, transform: T + "scale(1)", easing: EASE.inCubic },
          { offset: 1, opacity: 0, transform: T + "scale(.7)" }],
        { duration: 600, easing: "linear" }, { chan: "cd", done: resolve });
      R.cd.style.opacity = "1";
      emit(go ? "go" : "countdown", n);
    });
  }
  async function runCountdown(from = 3) {
    for (let i = from; i >= 1; i--) await countdown(i);
    await countdown(0);
  }

  // ---------- рубеж и тосты ----------
  function milestone(m) {
    R.bannerTxt.textContent = `${m} м!`;
    clock.play(R.banner, rm
      ? [{ opacity: 0 }, { opacity: 1, offset: 0.1 }, { opacity: 1, offset: 0.88 }, { opacity: 0 }]
      : [
        { offset: 0, opacity: 0, transform: "translateY(-24px) scale(.6)", easing: EASE.outBack },
        { offset: 280 / 1680, opacity: 1, transform: "translateY(0) scale(1)" },
        { offset: 1480 / 1680, opacity: 1, transform: "translateY(0) scale(1)", easing: EASE.inCubic },
        { offset: 1, opacity: 0, transform: "translateY(-16px) scale(.9)" }],
      { duration: 1680, easing: "linear" }, { chan: "b" });
    if (!rm) clock.play(R.distPill, [{ transform: "scale(1)" }, { transform: "scale(1.35)", offset: 0.4 }, { transform: "scale(1)" }],
      { duration: 350, easing: EASE.outCubic }, { chan: "m" });
    emit("milestone", m);
  }
  function toast(text, o) {
    if (!(o && o.force) && hudTime - lastToast < 8) return false;
    lastToast = hudTime;
    R.toastTxt.textContent = text;
    clock.play(R.toast, rm
      ? [{ opacity: 0 }, { opacity: 1, offset: 0.1 }, { opacity: 1, offset: 0.9 }, { opacity: 0 }]
      : [
        { offset: 0, opacity: 0, transform: "translateY(-18px) scale(.8)", easing: EASE.outBack },
        { offset: 0.11, opacity: 1, transform: "none" },
        { offset: 0.9, opacity: 1, transform: "none", easing: EASE.inCubic },
        { offset: 1, opacity: 0, transform: "translateY(-12px)" }],
      { duration: 2200, easing: "linear" }, { chan: "t" });
    return true;
  }

  // ---------- туториал ----------
  let tutStep = null;
  function tutorial(stepArg) {
    const g = stepArg == null ? null : (typeof stepArg === "string" ? stepArg : stepArg.gesture);
    clock.cancelGroup("tut");
    clock.clearEl(R.tut);
    tutStep = g;
    if (!g || !TUT_DIR[g]) { R.tut.hidden = true; return; }
    R.tut.hidden = false;
    R.tutTxt.textContent = (typeof stepArg === "object" && stepArg.text) || TUT_TEXT[g];
    R.tutKeys.innerHTML = touch ? "" : `<span class="rz-key">${TUT_KEYS[g]}</span>`;
    const [dx, dy] = TUT_DIR[g], L = portrait ? 90 : 120;
    const sx = -dx * L / 2, sy = -dy * L / 2, ex = dx * L / 2, ey = dy * L / 2;
    const ang = Math.atan2(dy, dx) * 180 / Math.PI;
    const tr = (x, y, s = 1) => `translate(${x}px,${y}px) scale(${s})`;
    const O = { group: "tut", keep: true };
    clock.play(R.tutCard, [{ opacity: 0, transform: "translateX(-50%) translateY(12px)" }, { opacity: 1, transform: "translateX(-50%)" }],
      { duration: rm ? 1 : 260, easing: EASE.outBack }, O);
    if (rm) {
      // статичная подсказка: рука в конце жеста и полный след
      R.tutHand.style.opacity = "1"; R.tutHand.style.transform = tr(ex, ey);
      R.tutTrail.style.opacity = g === "tap" ? "0" : ".9";
      R.tutTrail.style.width = L + "px";
      R.tutTrail.style.transform = `translate(${sx}px,${sy}px) rotate(${ang}deg)`;
      R.tutDot.style.opacity = g === "tap" ? "1" : "0";
      return;
    }
    R.tutHand.style.opacity = ""; R.tutHand.style.transform = ""; R.tutTrail.style.opacity = ""; R.tutDot.style.opacity = "";
    const LOOP = { duration: 1400, iterations: Infinity, easing: "linear" };
    if (g === "tap") {
      clock.play(R.tutHand, [
        { offset: 0, opacity: 0, transform: tr(0, 14, 1.2) },
        { offset: 0.15, opacity: 1, transform: tr(0, 0, 1), easing: EASE.outCubic },
        { offset: 0.3, opacity: 1, transform: tr(0, 0, 0.88) },
        { offset: 0.45, opacity: 1, transform: tr(0, 0, 1) },
        { offset: 0.8, opacity: 0, transform: tr(0, 0, 1) }, { offset: 1, opacity: 0, transform: tr(0, 0, 1) }], LOOP, O);
      clock.play(R.tutDot, [
        { offset: 0, opacity: 0, transform: "scale(.4)" }, { offset: 0.3, opacity: 0, transform: "scale(.4)" },
        { offset: 0.34, opacity: 1, transform: "scale(.6)", easing: EASE.outCubic },
        { offset: 0.7, opacity: 0, transform: "scale(1.8)" }, { offset: 1, opacity: 0, transform: "scale(1.8)" }], LOOP, O);
      clock.play(R.tutTrail, [{ opacity: 0 }, { opacity: 0 }], LOOP, O);
    } else {
      R.tutTrail.style.width = L + "px";
      const trail = (k, o) => ({ opacity: o, transform: `translate(${sx}px,${sy}px) rotate(${ang}deg) scaleX(${k})` });
      clock.play(R.tutHand, [
        { offset: 0, opacity: 0, transform: tr(sx, sy, 1.15) },
        { offset: 0.12, opacity: 1, transform: tr(sx, sy, 1), easing: EASE.inOutCubic },
        { offset: 0.55, opacity: 1, transform: tr(ex, ey, 1) },
        { offset: 0.75, opacity: 0, transform: tr(ex, ey, 1.05) },
        { offset: 1, opacity: 0, transform: tr(ex, ey, 1.05) }], LOOP, O);
      clock.play(R.tutTrail, [
        { offset: 0, ...trail(0, 0) }, { offset: 0.12, ...trail(0.02, 0.95), easing: EASE.inOutCubic },
        { offset: 0.55, ...trail(1, 0.95) }, { offset: 0.75, ...trail(1, 0) }, { offset: 1, ...trail(1, 0) }], LOOP, O);
      clock.play(R.tutDot, [
        { offset: 0, opacity: 0, transform: `translate(${sx}px,${sy}px) scale(.5)` },
        { offset: 0.12, opacity: 1, transform: `translate(${sx}px,${sy}px) scale(.8)`, easing: EASE.outCubic },
        { offset: 0.4, opacity: 0, transform: `translate(${sx}px,${sy}px) scale(1.7)` },
        { offset: 1, opacity: 0, transform: `translate(${sx}px,${sy}px) scale(1.7)` }], LOOP, O);
    }
    emit("tutorial:shown", g);
  }

  // ---------- результаты ----------
  let resT = 0, resOn = false;
  const roll = [
    { nv: rDistN, to: 0, t0: 0, dur: 1, row: 0, last: -1 },
    { nv: rEnN, to: 0, t0: 0, dur: 700, row: 1, last: -1 },
    { nv: rBonusN, to: 0, t0: 0, dur: 400, row: 2, last: -1 },
  ];
  let tickLast = -1;
  function results(stats = {}) {
    if (resResolve) { const r = resResolve; resResolve = null; r("replaced"); }
    const dist = Math.max(0, Math.round(stats.dist || 0));
    const en = Math.max(0, Math.round(stats.energons || 0));
    const bonus = Math.max(0, Math.round(stats.bonus || 0));
    const total = stats.total != null ? Math.round(stats.total) : dist + bonus;
    const isBest = !!stats.isBest;
    const bestV = Math.max(stats.best != null ? stats.best : best, isBest ? total : 0);
    setBest(bestV);

    clock.clearEl(R.results);
    show("results");
    locked = true; resT = 0; resOn = true; tickLast = -1;
    R.resHead.textContent = stats.title || "Рой догнал!";
    rDistN.set(0); rEnN.set(0); rBonusN.set(0); rTotalN.set(total);
    R.rBonus.hidden = bonus <= 0;
    R.streakChip.hidden = !(stats.streak > 1);
    if (stats.streak > 1) R.streakChip.textContent = `День ${stats.streak} подряд`;
    // подсказка: меньшее из «до рекорда» и «до следующей полусотни»
    let hint = "";
    if (isBest) hint = "Лучший забег!";
    else {
      const toRec = bestV - total;
      const goal = (Math.floor(total / 500) + 1) * 500, left = goal - total;
      hint = (toRec > 0 && toRec <= left) ? `+${toRec} м до рекорда` : `до ${goal} м оставалось ${left} м`;
    }
    R.hint.textContent = hint;
    R.quip.hidden = !stats.quip;
    if (stats.quip) { R.quipP.textContent = stats.quip; R.quipAva.textContent = (stats.speaker || "Куби")[0]; }
    const ms = stats.missions || [];
    R.mlist.hidden = !ms.length && !stats.nextMission;
    R.mlist.textContent = "";
    for (const m of ms) {
      const d = document.createElement("div");
      d.innerHTML = m.done ? `<svg class="rz-check" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10.5" fill="#070D36"/><path d="M6.8 12.4 L10.4 16 L17.4 8.6" fill="none" stroke="#C0FF3F" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>` : "•";
      d.appendChild(document.createTextNode(m.text));
      R.mlist.appendChild(d);
    }
    if (stats.nextMission) { const d = document.createElement("div"); d.textContent = `Следующая: ${stats.nextMission}`; d.style.color = "#0536D4"; R.mlist.appendChild(d); }

    const G = "results";
    const Dd = Math.min(1400, 400 + dist * 0.8);
    roll[0].to = dist; roll[0].t0 = 300; roll[0].dur = Dd;
    roll[1].to = en; roll[1].t0 = 300 + Dd; roll[1].dur = 700;
    const bT = 300 + Dd + 700;
    roll[2].to = bonus; roll[2].t0 = bT + 120; roll[2].dur = bonus > 0 ? 400 : 0;
    for (const r of roll) r.last = -1;
    const bEnd = bonus > 0 ? bT + 520 : bT;
    const totalT = bEnd + 60;
    const fast = rm;
    const O = (extra) => ({ keep: true, chan: "in", group: G, ...extra });

    clock.play(R.resShade, [{ opacity: 0 }, { opacity: 1 }], { duration: 250, easing: "linear" }, O());
    clock.play(R.resCard, [{ opacity: 0, transform: fast ? "none" : "translateY(40px)" }, { opacity: 1, transform: "none" }],
      { duration: fast ? 250 : 380, easing: EASE.outBack }, O());
    clock.play(R.resHeadBox, [{ transform: "translate(-50%,-55%) scale(" + (fast ? 1 : 0.6) + ")" }, { transform: "translate(-50%,-55%) scale(1)" }],
      { duration: 300, delay: 120, easing: EASE.outBack }, O());
    const rowIn = (el, delay, fromX) => clock.play(el, [{ opacity: 0, transform: fast ? "none" : `translate(${fromX}px,8px)` }, { opacity: 1, transform: "none" }],
      { duration: 240, delay, easing: EASE.outCubic }, O());
    rowIn(R.rDist, 200, -16);
    rowIn(R.rEn, 290, -16);
    rowIn(R.bestLine, 380, 0);
    rowIn(R.quip, 470, 0);
    rowIn(R.mlist, 560, 0);
    if (bonus > 0) clock.play(R.rBonus, [{ opacity: 0, transform: fast ? "none" : "translateX(40px)" }, { opacity: 1, transform: "none" }],
      { duration: 250, delay: bT, easing: EASE.outBack }, O());
    clock.play(R.rTotal, fast
      ? [{ opacity: 0 }, { opacity: 1 }]
      : [{ opacity: 0, transform: "scale(1.2)" }, { opacity: 1, transform: "scale(1)" }],
      { duration: 180, delay: totalT, easing: EASE.outCubic }, O());
    clock.after(totalT, () => emit("ding"), G);
    if (isBest) {
      const sT = totalT + 180 + 200;
      clock.play(R.stamp, fast
        ? [{ opacity: 0, transform: "rotate(-6deg)" }, { opacity: 1, transform: "rotate(-6deg)" }]
        : [{ opacity: 0, transform: "scale(2.6) rotate(-12deg)" }, { opacity: 1, transform: "scale(1) rotate(-6deg)" }],
        { duration: 260, delay: sT, easing: EASE.outBack }, O());
      clock.after(sT, () => emit("stamp"), G);
      if (!fast) clock.play(R.resCenter, [
        { transform: "translateX(0)" }, { transform: "translateX(-5px)" }, { transform: "translateX(5px)" }, { transform: "translateX(-5px)" },
        { transform: "translateX(5px)" }, { transform: "translateX(-5px)" }, { transform: "translateX(0)" }],
        { duration: 220, delay: sT + 260, easing: "linear" }, { chan: "sh", group: G });
      clock.after(sT + 260, () => emit("confetti", { kind: "record" }), G);
    }
    // кнопки и конец блокировки ввода — на 1000 мс
    clock.play(R.resBtns, [{ opacity: 0, transform: fast ? "none" : "translateY(16px)" }, { opacity: 1, transform: "none" }],
      { duration: 260, delay: 1000, easing: EASE.outBack }, O());
    clock.after(1000, () => {
      locked = false;
      R.restartBtn.focus({ preventScroll: true });
      if (!rm) clock.play(R.restartBtn, [{ transform: "scale(1)" }, { transform: "scale(1.04)" }, { transform: "scale(1)" }],
        { duration: 1600, iterations: Infinity, easing: "ease-in-out" }, { chan: "br", group: G });
      emit("results:ready");
    }, G);
    return new Promise(res => { resResolve = res; });
  }
  // «Ещё раз!» и меню — только после блокировки
  R.results.addEventListener("pointerdown", ev => { if (locked) ev.preventDefault(); });

  // ---------- reduced motion ----------
  function setReducedMotion(b) {
    rm = !!b;
    root.classList.toggle("rz-rm", rm);
    clock.setReduced(rm);
    if (rm) { enSpring.reset(); distSpring.reset(); }
    if (tutStep) tutorial(tutStep);
  }
  function setEnergonIcon(src) {
    const html = `<img src="${src}" alt="" draggable="false">`;
    R.enIco.innerHTML = html;
    for (const f of R.flies) f.innerHTML = html;
  }
  function setVolumes(v) {
    if (v.music != null) R.volM.value = Math.round(v.music * 100);
    if (v.sfx != null) R.volS.value = Math.round(v.sfx * 100);
    R.volM.style.setProperty("--v", R.volM.value + "%"); R.volS.style.setProperty("--v", R.volS.value + "%");
  }
  setVolumes({ music: 0.7, sfx: 0.8 });

  // ---------- кадр ----------
  function update(realDt) {
    const dt = realDt > 0.1 ? 0.1 : realDt < 0 ? 0 : realDt;
    hudTime += dt;
    clock.tick(dt * 1000);

    if (screen === "play" || screen === "pause") {
      enSpring.tick(dt); distSpring.tick(dt);
      // докрутка счётчика энергонов
      if (enDisplay < enTarget) {
        const stepN = Math.ceil((enTarget - enDisplay) * (1 - Math.exp(-12 * dt)));
        enDisplay += stepN > 1 ? stepN : 1;
        if (enDisplay > enTarget) enDisplay = enTarget;
        enN.set(enDisplay);
      }
      if (flashT > 0) { flashT -= dt; if (flashT <= 0) R.enN.classList.remove("flash"); }
      // чип серии улетает через 500 мс после последней монеты
      streakIdle += dt;
      if (streakShown && streakIdle > 0.5) {
        streakShown = false; streakCount = 0;
        clock.play(R.streak, rm ? [{ opacity: 1 }, { opacity: 0 }] : [{ opacity: 1, transform: "translateY(0)" }, { opacity: 0, transform: "translateY(-30px)" }],
          { duration: 400, easing: EASE.outCubic }, { keep: true, chan: "s" });
      }
      // кольцо комбо: 250 мс easeOutCubic ≈ damp λ 14
      ringShown = rm ? ringTarget : damp(ringShown, ringTarget, 14, dt);
      const ri = Math.round(ringShown * 200);
      if (ri !== ringIdx) { ringIdx = ri; R.ringFill.setAttribute("stroke-dashoffset", DASH[ri]); }
      // опасность: атака tau 0.1 с, спад tau 0.6 с; пульс «сердцебиение» чаще при близком рое
      dShown = damp(dShown, dTarget, dTarget > dShown ? 10 : 1.67, dt);
      if (dShown < 0.002 && dTarget === 0) dShown = 0;
      dPhase += dt * (1.1 + 1.1 * dShown);
      if (dPhase > 1) dPhase -= 1;
      const beat1 = Math.exp(-dPhase * 9), beat2 = dPhase > 0.22 ? 0.6 * Math.exp(-(dPhase - 0.22) * 9) : 0;
      const beat = beat1 > beat2 ? beat1 : beat2;
      const vig = edges ? dShown * (rm ? 0.75 : 0.45 + 0.55 * beat) : 0;
      const vi = Math.round(vig * 100);
      if (vi !== vigIdx) { vigIdx = vi; R.danger.style.opacity = OPACITY[vi]; }
      const so = Math.round(clamp(dShown * 6, 0, 1) * 100);
      if (so !== swOpIdx) { swOpIdx = so; R.swarm.style.opacity = OPACITY[so]; }
      const sf = Math.round(dShown * 400);
      if (sf !== swFillIdx) { swFillIdx = sf; R.swarmFill.style.transform = SCALE_X[sf]; }
    }

    if (resOn && screen === "results") {
      resT += dt * 1000;
      for (let i = 0; i < 3; i++) {
        const r = roll[i];
        if (resT < r.t0) continue;
        const u = r.dur > 0 ? (resT - r.t0) / r.dur : 1;
        const v = u >= 1 ? r.to : Math.round(r.to * easeOutExpo(u));
        if (v !== r.last) {
          r.last = v; r.nv.set(v);
          if (resT - tickLast > 55 && u < 1) { tickLast = resT; emit("tick", r.row); }
        }
      }
    }
  }

  function dispose() {
    removeEventListener("keydown", onKey, true);
    if (mq && mq.removeEventListener) mq.removeEventListener("change", onMQ);
    if (ro) ro.disconnect(); else removeEventListener("resize", layout);
    clock.clearEl(root);
    root.remove();
    handlers.clear();
    if (resResolve) { const r = resResolve; resResolve = null; r("disposed"); }
  }

  function on(evt, fn) {
    if (!handlers.has(evt)) handlers.set(evt, new Set());
    handlers.get(evt).add(fn);
    return () => handlers.get(evt).delete(fn);
  }

  return {
    root, ready,
    show, setDistance, setBest, setStars, setEnergons, flyToCounter, projectToHUD, popLabel,
    setCombo, setMission, missionComplete, setDanger, countdown, runCountdown, milestone, toast,
    results, tutorial, on, setReducedMotion, setEnergonIcon, setVolumes, update, dispose,
    get screen() { return screen; }, get locked() { return locked; }, get reducedMotion() { return rm; },
    _debug: { clock, R },
  };
}
