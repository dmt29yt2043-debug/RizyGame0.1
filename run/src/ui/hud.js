// HUD-кит «Ризи RUN»: самодостаточный DOM-интерфейс поверх канваса.
// createHUD(ctx, opts) → API (полный контракт — в комментарии в конце файла).
// Живёт на realDt: хит-стоп и пауза мира HUD не замораживают. Горячий путь update() без аллокаций.
// Кит только показывает и сообщает о намерениях игрока (события on(...)); управлять игрой — дело адаптера.
import { EASE, createClock, numView, spring, damp, clamp, OPACITY, SCALE_X, table, easeOutExpo } from "./anim.js";
import { buildDOM, RING_C, REV_C } from "./hud-dom.js";
import { parseTemplate, pluralRu, TXT, POWER } from "./text.js";
import { loadSettings, saveSettings, DEFAULT_SETTINGS } from "./progress.js";

const CSS_URL = new URL("./hud.css", import.meta.url).href;
const DASH = table(200, u => (RING_C * (1 - u)).toFixed(2));
const REV_DASH = table(400, u => (REV_C * u).toFixed(2));

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
  // оба сабсета (кириллица + латиница) и оба веса, иначе первый кадр уйдёт фолбэком
  return cssReady.then(() => Promise.all([
    document.fonts.load('900 32px "RizyNunito"', "РИЗИ RUN 0123456789 Ёё"),
    document.fonts.load('800 18px "RizyNunito"', "Снежная Река m"),
  ]).catch(() => null));
}

// та же раскладка клавиш, что в main.js (code, key и keyCode; русская раскладка)
function keyOf(ev) {
  const c = ev.code || "", k = (ev.key || "").toLowerCase(), n = ev.keyCode || ev.which || 0;
  if (c === "Enter" || c === "NumpadEnter" || k === "enter" || n === 13) return "ENTER";
  if (c === "Space" || k === " " || k === "spacebar" || n === 32) return "SPACE";
  if (c === "Escape" || k === "escape" || k === "esc" || n === 27) return "ESC";
  if (c === "KeyP" || k === "p" || k === "з" || n === 80) return "P";
  if (c === "ArrowUp" || c === "KeyW" || k === "arrowup" || k === "w" || k === "ц" || n === 38 || n === 87) return "UP";
  if (c === "ArrowDown" || c === "KeyS" || k === "arrowdown" || k === "s" || k === "ы" || n === 40 || n === 83) return "DOWN";
  if (c === "ArrowLeft" || c === "KeyA" || k === "arrowleft" || k === "a" || k === "ф" || n === 37 || n === 65) return "LEFT";
  if (c === "ArrowRight" || c === "KeyD" || k === "arrowright" || k === "d" || k === "в" || n === 39 || n === 68) return "RIGHT";
  return "";
}

// GAME-7: подписи ≤ 5 слов; на клавиатуре — клавиши + действие
const TUT = {
  lane:  { touch: "Свайп вбок — сменить дорожку",  keys: ["←", "→"], alt: "/ A D", act: "сменить дорожку", dir: [1, 0] },
  left:  { touch: "Свайп влево — сменить дорожку", keys: ["←"], alt: "/ A", act: "сменить дорожку", dir: [-1, 0] },
  right: { touch: "Свайп вправо — сменить дорожку", keys: ["→"], alt: "/ D", act: "сменить дорожку", dir: [1, 0] },
  up:    { touch: "Свайп вверх — прыжок", keys: ["↑"], alt: "/ W / Пробел", act: "прыжок", dir: [0, -1] },
  down:  { touch: "Свайп вниз — подкат", keys: ["↓"], alt: "/ S", act: "подкат", dir: [0, 1] },
  tap:   { touch: "Нажми, чтобы бежать!", keys: ["Пробел"], alt: "", act: "бежать", dir: [0, 0] },
};
const MODAL = { pause: 1, results: 1, settings: 1, revive: 1, shop: 1 };
const OVER_PLAY = { pause: 1, revive: 1 };

export function createHUD(ctx = {}, opts = {}) {
  const container = opts.container || document.body;
  const quality = ctx.quality || "med";
  const touch = opts.touch ?? (typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches);
  const step = opts.milestoneStep || 250;
  // красные края опасности: по умолчанию только если нет поста (LOOK-6 рисует danger-виньетку сам)
  const edges = opts.edges ?? !(ctx.look && ctx.look.post);

  const root = document.createElement("div");
  root.className = `rz-hud rz-q-${quality}`;
  const R = buildDOM(root, { touch });
  R.misWrap = R.mis.parentElement;
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

  // ---------- настройки и reduced motion ----------
  const persist = opts.persist !== false;
  const settings = { ...DEFAULT_SETTINGS, ...(opts.settings || (persist ? loadSettings() : null) || {}) };
  const mq = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
  let forcedRm = opts.reducedMotion != null ? !!opts.reducedMotion : null;     // стенд/тесты: жёстко
  let rm = false;
  const wantRm = () => forcedRm != null ? forcedRm : settings.reducedMotion != null ? settings.reducedMotion : !!(mq && mq.matches);
  const onMQ = () => applyRm();
  if (mq && mq.addEventListener) mq.addEventListener("change", onMQ);

  // ---------- ввод ----------
  // Кнопки, карточки и затемнения глушат всплытие на корне HUD: слушатели main на window не видят этих нажатий,
  // а делегат кликов ниже (тоже на корне) их видит. Тап по титулу (.rz-title-tap) пропускаем — старт делает main.
  const STOP_SEL = "button, input, .rz-card, .rz-shade";
  const onStopEv = ev => { const t = ev.target; if (t && t.closest && t.closest(STOP_SEL)) ev.stopPropagation(); };
  const STOP = ["pointerdown", "pointerup", "mousedown", "mouseup", "touchstart", "touchend", "click", "dblclick", "contextmenu"];
  for (const t of STOP) root.addEventListener(t, onStopEv, { passive: true });

  let screen = "none", locked = false, resResolve = null, settingsOpen = false, shopOpen = false;
  const top = () => (settingsOpen ? "settings" : shopOpen ? "shop" : screen);

  function act(name) {
    switch (name) {
      case "restart": case "menu":
        if (settingsOpen || shopOpen) return;
        if (screen === "results") {
          if (locked) return;
          const r = resResolve; resResolve = null;
          emit(name); if (r) r(name);
        } else if (screen === "pause" && name === "menu") emit("menu");
        return;
      case "continue":
        // «Продолжить за N ⬡»: только на результатах, после блокировки и если хватает энергонов
        if (screen !== "results" || locked || !contOk) return;
        emit("continue");
        return;
      case "pause": if (screen === "play" && !settingsOpen) emit("pause"); return;
      case "resume": if (screen === "pause" && !settingsOpen) emit("resume"); return;
      case "settings": openSettings(); return;
      case "close": closeSettings(); return;
      case "shop": openShop(); return;
      case "shop:close": closeShop(); return;
      case "revive": case "decline": finishRevive(name); return;
      case "tutorial": if (settingsOpen) closeSettings(); emit("tutorial"); return;
      case "tutorial:skip": emit("tutorial:skip"); return;
    }
  }
  root.addEventListener("click", ev => {
    const b = ev.target.closest && ev.target.closest("[data-act],[data-set],[data-rm],[data-buy]");
    if (!b || !root.contains(b)) return;
    if (b.dataset.set) return toggleSetting(b.dataset.set);
    if (b.dataset.rm) return setRmChoice(b.dataset.rm);
    if (b.dataset.buy) { if (shopOpen && !b.disabled) emit("buy", b.dataset.buy); return; }
    if (b.dataset.act !== "start") act(b.dataset.act);
  });
  // тап по титулу: событие start (main и так стартует по своему pointerdown — адаптер стартует, только если G.mode всё ещё "title")
  R.title.querySelector(".rz-title-tap").addEventListener("pointerup", () => { if (screen === "title" && !settingsOpen && !shopOpen) emit("start"); });

  // громкости: 4 слайдера (пауза + настройки) синхронны; emit на input, запись на change
  const RANGES = [R.volM, R.volS, R.setVolM, R.setVolS];
  function syncRanges() {
    const m = Math.round(settings.music * 100), s = Math.round(settings.sfx * 100);
    for (const r of RANGES) { const v = r.dataset.vol === "music" ? m : s; if (+r.value !== v) r.value = v; r.style.setProperty("--v", v + "%"); }
  }
  for (const r of RANGES) {
    r.addEventListener("input", () => {
      settings[r.dataset.vol] = r.value / 100;
      syncRanges();
      emit("volume", { music: settings.music, sfx: settings.sfx });
    });
    r.addEventListener("change", () => commitSettings());
  }

  // Клавиши модальных экранов (пауза, результаты, настройки, revive). Слушаем в capture на window:
  // фокус вне HUD → глушим событие целиком (main не перезапустит забег мимо блокировки);
  // фокус на кнопке/слайдере HUD → даём нативную активацию, а до main не пускает слушатель на корне.
  const onKeyCapture = ev => {
    if (opts.keys === false) return;
    const k = keyOf(ev);
    if (!k) return;
    const t = top();
    if (t === "play") {
      if ((k === "ESC" || k === "P") && !ev.repeat) { ev.preventDefault(); act("pause"); }
      return;
    }
    if (!MODAL[t]) return;
    const inHud = root.contains(ev.target);
    if (!inHud) ev.stopImmediatePropagation();
    const el = inHud && ev.target.closest ? ev.target.closest("button, input") : null;
    if (el && (k === "ENTER" || k === "SPACE" || (el.tagName === "INPUT" && k !== "ESC"))) return;
    ev.preventDefault();
    if (ev.repeat) return;
    const go = k === "ENTER" || k === "SPACE";
    if (t === "results") { if (go || k === "UP") act("restart"); else if (k === "ESC") act("menu"); }
    else if (t === "pause") { if (go || k === "ESC" || k === "P") act("resume"); }
    else if (t === "settings") { if (k === "ESC") act("close"); }
    else if (t === "shop") { if (k === "ESC") act("shop:close"); }
    else if (t === "revive") { if (go) act("revive"); else if (k === "ESC") act("decline"); }
  };
  const onKeyRoot = ev => { if (MODAL[top()]) ev.stopPropagation(); };
  addEventListener("keydown", onKeyCapture, true);
  root.addEventListener("keydown", onKeyRoot);

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
  const flashTimes = new Float64Array(3).fill(-9); let flashI = 0;

  // ---------- экраны ----------
  const SCREENS = { play: R.play, title: R.title, pause: R.pause, results: R.results, revive: R.revive };
  let titleLeaving = false;
  function show(name) {
    if (name !== "none" && !SCREENS[name]) return;
    const prev = screen;
    if (name === prev) return;
    screen = name;
    // пауза и revive — оверлеи поверх игры; результаты скрывают игровой HUD
    const base = OVER_PLAY[name] ? "play" : name;
    for (const k in SCREENS) {
      const on = k === base || k === name;
      const el = SCREENS[k];
      if (!on && !el.hidden && !(k === "title" && titleLeaving)) leave(k, el);
      else if (on && (el.hidden || (k === "title" && titleLeaving))) {
        if (k === "title" && titleLeaving) { titleLeaving = false; clock.clearEl(el); }
        el.hidden = false; enter(k, prev);
      }
    }
    if (name !== "results") locked = false;
    if (name !== "revive" && revResolve) finishRevive("cancel");
    if (name !== "play" && name !== "pause" && name !== "revive") hideTransient();
    if (settingsOpen && name !== "title" && name !== "pause") closeSettings();
    if (shopOpen && name !== "title") closeShop();
    if (name === "play") for (const p of POWER) setPowerup(p.kind, 0);
    // фокус не должен остаться на скрытой кнопке (иначе Пробел «нажмёт» её)
    const ae = document.activeElement;
    if (ae && root.contains(ae) && ae.closest("[hidden]")) ae.blur();
    emit("screen", name);
  }
  function leave(k, el) {
    clock.cancelGroup(k);
    if (k === "title") {
      // CAM-4: UI титула гаснет за 200 мс
      titleLeaving = true;
      clock.play(el, [{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: "linear" },
        { chan: "leave", done: () => { titleLeaving = false; clock.clearEl(el); el.hidden = true; } });
      return;
    }
    if (k !== "play") clock.clearEl(el);
    el.hidden = true;
  }
  function hideTransient() {
    tutorial(null);
    clock.clearEl(R.cd); clock.clearEl(R.banner); clock.clearEl(R.toast);
  }
  function enter(k, prev) {
    if (k === "title") {
      clock.play(R.logo, rm
        ? [{ opacity: 0 }, { opacity: 1 }]
        : [{ opacity: 0, transform: "translateY(-40px) scale(.8)" }, { opacity: 1, transform: "translateY(0) scale(1)" }],
        { duration: rm ? 300 : 550, delay: rm ? 0 : 150, easing: EASE.outBack }, { keep: true, chan: "in", group: "title" });
      clock.play(R.titleBot, [{ opacity: 0, transform: rm ? "none" : "translateY(18px)" }, { opacity: 1, transform: "none" }],
        { duration: 320, delay: rm ? 0 : 420, easing: EASE.outCubic }, { keep: true, chan: "in", group: "title" });
      if (!rm) clock.play(R.prompt, [{ opacity: 1 }, { opacity: 0.55 }, { opacity: 1 }],
        { duration: 1400, delay: 750, iterations: Infinity, easing: "ease-in-out" }, { chan: "pulse", group: "title" });
    } else if (k === "play") {
      enSpring.reset(); distSpring.reset();
      for (const el of [R.tl, R.tr]) clock.play(el, [{ opacity: 0, transform: rm ? "none" : "translateY(-14px)" }, { opacity: 1, transform: "none" }],
        { duration: rm ? 200 : 320, delay: prev === "title" ? 150 : 0, easing: EASE.outBack }, { chan: "in" });
    } else if (k === "pause") {
      clock.play(R.pauseShade, [{ opacity: 0 }, { opacity: 1 }], { duration: rm ? 1 : 180, easing: "linear" }, { keep: true, chan: "in", group: "pause" });
      clock.play(R.pauseCard, [{ opacity: 0, transform: rm ? "none" : "scale(.9)" }, { opacity: 1, transform: "none" }],
        { duration: rm ? 1 : 220, easing: EASE.outBack }, { keep: true, chan: "in", group: "pause" });
      clock.after(rm ? 1 : 200, () => R.resumeBtn.focus({ preventScroll: true }), "pause");
    }
  }

  // ---------- настройки (HUD-8) ----------
  function applySettingsUI() {
    const rmv = settings.reducedMotion == null ? "auto" : settings.reducedMotion ? "on" : "off";
    for (const b of R.setRm) b.setAttribute("aria-pressed", String(b.dataset.rm === rmv));
    for (const b of R.setTgl) b.setAttribute("aria-pressed", String(!!settings[b.dataset.set]));
    syncRanges();
  }
  function commitSettings() {
    if (persist) saveSettings(settings);
    emit("settings:change", settings);
  }
  function toggleSetting(key) { settings[key] = !settings[key]; applySettingsUI(); commitSettings(); }
  function setRmChoice(v) {
    settings.reducedMotion = v === "auto" ? null : v === "on";
    applySettingsUI(); applyRm(); commitSettings();
  }
  function openSettings() {
    if (settingsOpen) return;
    settingsOpen = true;
    applySettingsUI();
    R.settings.hidden = false;
    clock.play(R.setShade, [{ opacity: 0 }, { opacity: 1 }], { duration: rm ? 1 : 200, easing: "linear" }, { keep: true, chan: "in", group: "settings" });
    clock.play(R.setCard, [{ opacity: 0, transform: rm ? "none" : "translateY(24px) scale(.96)" }, { opacity: 1, transform: "none" }],
      { duration: rm ? 1 : 200, easing: EASE.outCubic }, { keep: true, chan: "in", group: "settings" });
    clock.after(rm ? 1 : 120, () => R.setClose.focus({ preventScroll: true }), "settings");
    emit("settings", settings);
  }
  function closeSettings() {
    if (!settingsOpen) return;
    settingsOpen = false;
    clock.cancelGroup("settings"); clock.clearEl(R.settings);
    R.settings.hidden = true;
    const back = screen === "pause" ? R.resumeBtn : screen === "title" ? R.gear : null;
    if (back) back.focus({ preventScroll: true });
    emit("settings:close", settings);
  }

  // ---------- кошелёк и прокачка (ECON) ----------
  // opts.shop = { prices: [ур.1, ур.2, ур.3], dur: { kind: [база, ур.1, ур.2, ур.3] } } — числа из cfg.power
  const shopInfo = opts.shop || { prices: [150, 400, 900], dur: {} };
  const walletN = numView(R.tWallet, 7), sWalletN = numView(R.sWallet, 7);
  let walletV = 0;
  const shopLv = { magnet: 0, shield: 0, boost: 0, x2: 0 };
  function setWallet(n) {
    walletV = Math.max(0, Math.round(n || 0));
    walletN.set(walletV); sWalletN.set(walletV);
    refreshShop();
  }
  function setUpgrades(levels) {
    if (levels) for (const p of POWER) shopLv[p.kind] = clamp(levels[p.kind] | 0, 0, shopInfo.prices.length);
    refreshShop();
  }
  function refreshShop() {
    for (const p of POWER) {
      const r = R.shopRows[p.kind], lv = shopLv[p.kind], maxLv = shopInfo.prices.length;
      const durs = shopInfo.dur[p.kind] || [];
      for (let i = 0; i < r.lv.length; i++) r.lv[i].classList.toggle("on", i < lv);
      r.cur.textContent = durs[lv] != null ? TXT.sec(durs[lv]) : "";
      const max = lv >= maxLv;
      r.nxt.textContent = max ? TXT.shopMax : (durs[lv + 1] != null ? TXT.sec(durs[lv + 1]) : "");
      r.arr.hidden = max;
      r.row.classList.toggle("max", max);
      if (max) { r.price.textContent = TXT.shopMax; r.btn.disabled = true; r.btn.classList.remove("poor"); }
      else {
        const price = shopInfo.prices[lv];
        r.price.textContent = String(price);
        const ok = walletV >= price;
        r.btn.disabled = !ok; r.btn.classList.toggle("poor", !ok);
      }
    }
  }
  function openShop() {
    if (shopOpen || screen !== "title") return;
    shopOpen = true;
    refreshShop();
    R.shop.hidden = false;
    clock.play(R.shopShade, [{ opacity: 0 }, { opacity: 1 }], { duration: rm ? 1 : 200, easing: "linear" }, { keep: true, chan: "in", group: "shop" });
    clock.play(R.shopCard, [{ opacity: 0, transform: rm ? "none" : "translateY(24px) scale(.96)" }, { opacity: 1, transform: "none" }],
      { duration: rm ? 1 : 220, easing: EASE.outBack }, { keep: true, chan: "in", group: "shop" });
    clock.after(rm ? 1 : 120, () => R.shopClose.focus({ preventScroll: true }), "shop");
    emit("shop");
  }
  function closeShop() {
    if (!shopOpen) return;
    shopOpen = false;
    clock.cancelGroup("shop"); clock.clearEl(R.shop);
    R.shop.hidden = true;
    if (screen === "title") R.shopBtn.focus({ preventScroll: true });
    emit("shop:close");
  }
  // покупка удалась: подпрыгивание строки
  function shopBought(kind) {
    const r = R.shopRows[kind];
    if (!r || rm) return;
    clock.play(r.row, [{ transform: "scale(1)" }, { transform: "scale(1.04)", offset: 0.4 }, { transform: "scale(1)" }], { duration: 300, easing: EASE.outBack }, { chan: "b" });
  }

  // ---------- активные ускорители (POWER): иконка + убывающая полоска ----------
  const pwOn = { magnet: false, shield: false, boost: false, x2: false };
  const pwIdx = { magnet: -1, shield: -1, boost: -1, x2: -1 };
  const pwLow = { magnet: false, shield: false, boost: false, x2: false };
  function setPowerup(kind, frac) {
    const c = R.pw[kind];
    if (!c) return;
    const on = frac > 0;
    if (on !== pwOn[kind]) {
      pwOn[kind] = on;
      if (on) {
        c.el.hidden = false; pwIdx[kind] = -1;
        clock.play(c.el, [{ opacity: 0, transform: rm ? "none" : "scale(.5)" }, { opacity: 1, transform: "none" }],
          { duration: rm ? 1 : 260, easing: EASE.outBack }, { keep: true, chan: "v" });
      } else {
        clock.play(c.el, [{ opacity: 1, transform: "none" }, { opacity: 0, transform: rm ? "none" : "scale(.7)" }],
          { duration: rm ? 1 : 200, easing: EASE.outCubic }, { keep: true, chan: "v", done: () => { if (!pwOn[kind]) c.el.hidden = true; } });
      }
    }
    if (!on) return;
    const i = Math.round(clamp(frac, 0, 1) * 400);
    if (i !== pwIdx[kind]) { pwIdx[kind] = i; c.bar.style.transform = SCALE_X[i]; }
    const low = frac < 0.25;
    if (low !== pwLow[kind]) { pwLow[kind] = low; c.el.classList.toggle("low", low); }
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
  function popLabel(text, kind = "plus", x, y, dur) {
    const n = quality === "low" ? 6 : 10;
    const i = lblNext; lblNext = (lblNext + 1) % n;
    const wrap = R.labels[i], span = R.labelSpans[i];
    clock.clearEl(wrap);
    wrap.className = "rz-lbl " + (LBL_KIND[kind] || "");
    span.textContent = text;
    lblSide = -lblSide;
    const px = x != null ? x : W / 2 + (kind === "nice" ? 0 : lblSide * 22);
    // в портрете миссия стоит ниже — «ЛОВКО!» поднимаем из-под неё
    const py = y != null ? y : H * (kind === "nice" ? (portrait ? 0.42 : 0.33) : 0.4);
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
      ], { duration: dur || (kind === "nice" ? 900 : 700), easing: EASE.label }, { chan: "p" });
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
  // шаблон "Перепрыгни {n} {валик|валика|валиков}": число катится, слово меняет форму вместе с числом
  let misTpl = null, misN = null, misProg = 0, misStarsN = -1, misRoll = null;
  const misForms = [];
  function renderStars(el, filled, total) {
    let s = "";
    for (let i = 0; i < total; i++) s += R.starSVG(i < filled);
    el.innerHTML = s;
  }
  function buildMissionText(tpl, n) {
    R.misTxt.textContent = "";
    misRoll = null; misForms.length = 0;
    for (const p of parseTemplate(tpl)) {
      if (p.t === "text") R.misTxt.appendChild(document.createTextNode(p.s));
      else if (p.t === "n") {
        misRoll = document.createElement("span");
        misRoll.className = "rz-mis-roll";
        const s = document.createElement("span"); s.textContent = String(n ?? "");
        misRoll.appendChild(s);
        R.misTxt.appendChild(misRoll);
      } else {
        const s = document.createElement("span");
        s.textContent = pluralRu(n ?? 0, p.forms[0], p.forms[1], p.forms[2]);
        misForms.push({ el: s, forms: p.forms });
        R.misTxt.appendChild(s);
      }
    }
  }
  // setMission(tpl, progress, {n, stars, total, intro}) или setMission(view) из progress.createMissions().view()
  function setMission(text, progress = 0, o = {}) {
    if (text && typeof text === "object") { o = text; progress = o.progress || 0; text = o.tpl || o.text; }
    if (text == null) { R.mis.hidden = true; misTpl = null; return; }
    const wasHidden = R.mis.hidden;
    R.mis.hidden = false;
    const n = o.n;
    if (text !== misTpl) {
      misTpl = text; misN = n;
      buildMissionText(text, n);
    } else if (n != null && n !== misN) {
      misN = n;
      for (const f of misForms) f.el.textContent = pluralRu(n, f.forms[0], f.forms[1], f.forms[2]);
      if (misRoll) {
        // шаг: старое число уходит вверх, новое приходит снизу (160 мс easeOutCubic)
        while (misRoll.children.length > 1) misRoll.firstElementChild.remove();
        const old = misRoll.firstElementChild;
        const nu = document.createElement("span"); nu.textContent = String(n);
        misRoll.appendChild(nu);
        if (rm || !old) { if (old) old.remove(); }
        else {
          clock.play(old, [{ transform: "translateY(0)", opacity: 1 }, { transform: "translateY(-100%)", opacity: 0 }], { duration: 160, easing: EASE.outCubic }, { keep: true, done: () => old.remove() });
          clock.play(nu, [{ transform: "translateY(100%)", opacity: 0 }, { transform: "translateY(0)", opacity: 1 }], { duration: 160, easing: EASE.outCubic });
        }
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
      // крупно по центру 2.5 с, затем сжатие в пилюлю за 400 мс easeInOutCubic
      const topPx = R.misWrap.offsetTop || 16;
      const dy = Math.max(0, H * (portrait ? 0.27 : 0.25) - topPx);
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
      const w = R.mis.offsetWidth || 280;
      const wide = (w + 60) / w;                            // 280 → 340 px, как в HUD-4
      clock.play(R.misBg, [{ transform: "scaleX(1)" }, { transform: `scaleX(${wide})` }], { duration: rm ? 1 : 200, easing: EASE.outBack }, { keep: true, chan: "w" });
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
        if (nx) { misProg = 0; setMission(nx.tpl || nx.text, nx.progress || 0, nx); }
        else { clock.after(220, () => { R.mis.hidden = true; misTpl = null; }); }
        clock.play(R.misIn, [{ opacity: 0, transform: rm ? "none" : "translateX(60px)" }, { opacity: 1, transform: "none" }], { duration: 300, delay: 120, easing: EASE.outCubic }, { keep: true, chan: "o" });
        clock.play(R.misBar, [{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay: 120 }, { keep: true, chan: "o" });
        clock.after(420, resolve);
      });
    });
  }

  // ---------- опасность ----------
  function setDanger(d) { dTarget = clamp(d || 0, 0, 1); }

  // ---------- отсчёт и «ВПЕРЁД!» ----------
  const CD_T = "translate(-50%,-50%) ";
  // HUD-3: цифра 600 мс — вход scale 2→1 + fade 180 мс easeOutBack, держать 270 мс, уход scale .7 + fade 150 мс
  function countdown(n) {
    if (!(n > 0)) return go();
    return new Promise(resolve => {
      R.cd.classList.remove("go");
      R.cdTxt.textContent = String(n);
      clock.play(R.cdTxt, rm
        ? [{ opacity: 0, transform: CD_T }, { opacity: 1, offset: 0.3, transform: CD_T }, { opacity: 1, offset: 0.75, transform: CD_T }, { opacity: 0, transform: CD_T }]
        : [
          { offset: 0, opacity: 0, transform: CD_T + "scale(2)", easing: EASE.outBack },
          { offset: 0.3, opacity: 1, transform: CD_T + "scale(1)" },
          { offset: 0.75, opacity: 1, transform: CD_T + "scale(1)", easing: EASE.inCubic },
          { offset: 1, opacity: 0, transform: CD_T + "scale(.7)" }],
        { duration: 600, easing: "linear" }, { chan: "cd", done: resolve });
      emit("countdown", n);
    });
  }
  // CAM-4: scale .4→1.25 за 160 мс → 1 за 140 мс, держать 250 мс, уход scale 1.5 + fade 220 мс easeInCubic
  // (сумма сегментов 770 мс; «на 700 мс» в библии — округление, сегменты приоритетнее)
  function go() {
    return new Promise(resolve => {
      R.cd.classList.add("go");
      R.cdTxt.textContent = TXT.go;
      const D = 770;
      clock.play(R.cdTxt, rm
        ? [{ opacity: 0, transform: CD_T }, { opacity: 1, offset: 0.2, transform: CD_T }, { opacity: 1, offset: 550 / D, transform: CD_T }, { opacity: 0, transform: CD_T }]
        : [
          { offset: 0, opacity: 0, transform: CD_T + "scale(.4)", easing: EASE.outCubic },
          { offset: 160 / D, opacity: 1, transform: CD_T + "scale(1.25)", easing: EASE.outCubic },
          { offset: 300 / D, opacity: 1, transform: CD_T + "scale(1)" },
          { offset: 550 / D, opacity: 1, transform: CD_T + "scale(1)", easing: EASE.inCubic },
          { offset: 1, opacity: 0, transform: CD_T + "scale(1.5)" }],
        { duration: D, easing: "linear" }, { chan: "cd", done: resolve });
      emit("go");
    });
  }
  async function runCountdown(from = 3) {
    for (let i = from; i >= 1; i--) await countdown(i);
    await go();
  }

  // ---------- баннер, рубеж и тосты ----------
  // HUD-6: лаймовая лента, вход 280 мс easeOutBack, держать 1.2 с, уход 200 мс
  function banner(text, o) {
    // слова с дефисом («по-настоящему») — в неразрывный span, чтобы строка не рвалась на «по-»
    R.bannerTxt.textContent = "";
    const words = text.split(" ");
    for (let i = 0; i < words.length; i++) {
      if (i) R.bannerTxt.appendChild(document.createTextNode(" "));
      if (words[i].indexOf("-") > 0) { const s = document.createElement("span"); s.textContent = words[i]; R.bannerTxt.appendChild(s); }
      else R.bannerTxt.appendChild(document.createTextNode(words[i]));
    }
    R.banner.classList.toggle("long", text.length > 12);
    const hold = (o && o.hold) || 1200, D = 280 + hold + 200;
    clock.play(R.banner, rm
      ? [{ opacity: 0 }, { opacity: 1, offset: 0.1 }, { opacity: 1, offset: (280 + hold) / D }, { opacity: 0 }]
      : [
        { offset: 0, opacity: 0, transform: "translateY(-24px) scale(.6)", easing: EASE.outBack },
        { offset: 280 / D, opacity: 1, transform: "translateY(0) scale(1)" },
        { offset: (280 + hold) / D, opacity: 1, transform: "translateY(0) scale(1)", easing: EASE.inCubic },
        { offset: 1, opacity: 0, transform: "translateY(-16px) scale(.9)" }],
      { duration: D, easing: "linear" }, { chan: "b" });
  }
  function milestone(m) {
    banner(`${m} м!`);
    if (!rm) clock.play(R.distPill, [{ transform: "scale(1)" }, { transform: "scale(1.35)", offset: 0.4 }, { transform: "scale(1)" }],
      { duration: 350, easing: EASE.outCubic }, { chan: "m" });
    emit("milestone", m);
  }
  // тосты не чаще раза в 8 с, 2.2 с, верхняя треть
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
      { duration: (o && o.duration) || 2200, easing: "linear" }, { chan: "t" });
    return true;
  }
  // HUD-8: ограничитель вспышек ≤ 3 в секунду (для bloom/краёв/конфетти — спрашивать перед вспышкой)
  function allowFlash() {
    const oldest = flashTimes[flashI];
    if (hudTime - oldest < 1) return false;
    flashTimes[flashI] = hudTime; flashI = (flashI + 1) % 3;
    return true;
  }

  // ---------- туториал (GAME-7) ----------
  // рука белая 75% + лаймовый след: fade 150 мс → свайп 90 px за 600 мс ease-in-out → fade 150 мс → пауза 250 мс
  let tutStep = null, tutArg = null;
  const CYCLE = 1150;
  function tutorial(stepArg) {
    const g = stepArg == null ? null : (typeof stepArg === "string" ? stepArg : stepArg.gesture);
    clock.cancelGroup("tut");
    clock.clearEl(R.tut);
    tutStep = g; tutArg = stepArg;
    if (!g || !TUT[g]) { R.tut.hidden = true; return; }
    const def = TUT[g];
    R.tut.hidden = false;
    R.tutSkip.hidden = !(typeof stepArg === "object" && stepArg.skip);
    const custom = typeof stepArg === "object" && stepArg.text;
    if (touch || custom) { R.tutKeys.textContent = ""; R.tutTxt.textContent = custom || def.touch; }
    else {
      let k = "";
      for (const c of def.keys) k += `<span class="rz-key">${c}</span>`;
      if (def.alt) k += `<span class="rz-key-alt">${def.alt}</span>`;
      R.tutKeys.innerHTML = k;
      R.tutTxt.textContent = "— " + def.act;
    }
    const [dx, dy] = def.dir, L = 90;
    const sx = -dx * L / 2, sy = -dy * L / 2, ex = dx * L / 2, ey = dy * L / 2;
    const ang = Math.atan2(dy, dx) * 180 / Math.PI;
    const tr = (x, y, s = 1) => `translate(${x}px,${y}px) scale(${s})`;
    const O = { group: "tut", keep: true };
    clock.play(R.tutCard, [{ opacity: 0, transform: rm ? "translateX(-50%)" : "translateX(-50%) translateY(12px)" }, { opacity: 1, transform: "translateX(-50%)" }],
      { duration: rm ? 1 : 260, easing: EASE.outBack }, O);
    R.tutTrail.style.width = L + "px";
    if (rm) {
      // статичная подсказка: рука в конце жеста и полный след
      R.tutHand.style.opacity = ".75"; R.tutHand.style.transform = tr(ex, ey);
      R.tutTrail.style.opacity = g === "tap" ? "0" : ".9";
      R.tutTrail.style.transform = `translate(${sx}px,${sy}px) rotate(${ang}deg)`;
      R.tutDot.style.opacity = g === "tap" ? "1" : "0";
      emit("tutorial:shown", g);
      return;
    }
    R.tutHand.style.opacity = ""; R.tutHand.style.transform = ""; R.tutTrail.style.opacity = ""; R.tutTrail.style.transform = ""; R.tutDot.style.opacity = "";
    const LOOP = { duration: CYCLE, iterations: Infinity, easing: "linear" };
    const a = 150 / CYCLE, b = 750 / CYCLE, c = 900 / CYCLE;
    if (g === "tap") {
      clock.play(R.tutHand, [
        { offset: 0, opacity: 0, transform: tr(0, 14, 1.2) },
        { offset: a, opacity: 0.75, transform: tr(0, 0, 1), easing: EASE.outCubic },
        { offset: 0.35, opacity: 0.75, transform: tr(0, 0, 0.88) },
        { offset: 0.5, opacity: 0.75, transform: tr(0, 0, 1) },
        { offset: c, opacity: 0, transform: tr(0, 0, 1) }, { offset: 1, opacity: 0, transform: tr(0, 0, 1) }], LOOP, O);
      clock.play(R.tutDot, [
        { offset: 0, opacity: 0, transform: "scale(.4)" }, { offset: 0.35, opacity: 0, transform: "scale(.4)" },
        { offset: 0.38, opacity: 1, transform: "scale(.6)", easing: EASE.outCubic },
        { offset: 0.75, opacity: 0, transform: "scale(1.8)" }, { offset: 1, opacity: 0, transform: "scale(1.8)" }], LOOP, O);
      clock.play(R.tutTrail, [{ opacity: 0 }, { opacity: 0 }], LOOP, O);
    } else {
      // «вбок» чередует направление: два цикла вправо и влево
      const two = g === "lane";
      const LP = two ? { ...LOOP, duration: CYCLE * 2 } : LOOP;
      const hand = [], trl = [], dot = [];
      for (let r = 0; r < (two ? 2 : 1); r++) {
        const s = two ? 0.5 : 1, o0 = r * s, flip = r === 1 ? -1 : 1;
        const hx = sx * flip, hy = sy, gx = ex * flip, gy = ey;
        const tt = (k, o) => ({ opacity: o, transform: `translate(${hx}px,${hy}px) rotate(${flip < 0 ? ang + 180 : ang}deg) scaleX(${k})` });
        hand.push(
          { offset: o0, opacity: 0, transform: tr(hx, hy, 1.15) },
          { offset: o0 + a * s, opacity: 0.75, transform: tr(hx, hy, 1), easing: EASE.inOutCubic },
          { offset: o0 + b * s, opacity: 0.75, transform: tr(gx, gy, 1) },
          { offset: o0 + c * s, opacity: 0, transform: tr(gx, gy, 1.05) },
          { offset: o0 + s * 0.999, opacity: 0, transform: tr(gx, gy, 1.05) });
        trl.push({ offset: o0, ...tt(0, 0) }, { offset: o0 + a * s, ...tt(0.02, 0.95), easing: EASE.inOutCubic },
          { offset: o0 + b * s, ...tt(1, 0.95) }, { offset: o0 + c * s, ...tt(1, 0) }, { offset: o0 + s * 0.999, ...tt(1, 0) });
        dot.push(
          { offset: o0, opacity: 0, transform: `translate(${hx}px,${hy}px) scale(.5)` },
          { offset: o0 + a * s, opacity: 1, transform: `translate(${hx}px,${hy}px) scale(.8)`, easing: EASE.outCubic },
          { offset: o0 + 0.45 * s, opacity: 0, transform: `translate(${hx}px,${hy}px) scale(1.7)` },
          { offset: o0 + s * 0.999, opacity: 0, transform: `translate(${hx}px,${hy}px) scale(1.7)` });
      }
      hand.push({ ...hand[hand.length - 1], offset: 1 }); trl.push({ ...trl[trl.length - 1], offset: 1 }); dot.push({ ...dot[dot.length - 1], offset: 1 });
      clock.play(R.tutHand, hand, LP, O);
      clock.play(R.tutTrail, trl, LP, O);
      clock.play(R.tutDot, dot, LP, O);
    }
    emit("tutorial:shown", g);
  }
  // верный ввод: подсказка уходит за 250 мс + «Отлично!» 0.8 с
  function tutorialPraise(text = TXT.praise) {
    if (tutStep) {
      const cur = tutArg;
      clock.cancelGroup("tut");
      clock.play(R.tut, [{ opacity: 1 }, { opacity: 0 }], { duration: rm ? 1 : 250, easing: EASE.outCubic },
        { group: "tut", done: () => { if (tutArg === cur) tutorial(null); } });
    }
    popLabel(text, "nice", null, null, 800);
    emit("tutorial:praise");
  }

  // ---------- revive «Спасти Ризи?» (GAME-6) ----------
  let revResolve = null, revOn = false, revT = 0, revDur = 4000, revArmed = false, revIdx = -1;
  const REV_ARM = 600;
  function revive(o = {}) {
    if (revResolve) finishRevive("replaced");
    const cost = Math.max(0, Math.round(o.cost ?? 50));
    revDur = o.timeout ?? 4000;
    R.revCost.textContent = `Спасти за ${cost}`;
    R.revHave.textContent = o.have != null ? `У тебя ${o.have} ${pluralRu(o.have, "энергон", "энергона", "энергонов")}` : "";
    R.revHave.hidden = o.have == null;
    clock.clearEl(R.revive);
    show("revive");
    revOn = true; revT = 0; revArmed = false; revIdx = -1;
    R.revBtns.classList.add("off");
    R.revFill.setAttribute("stroke-dashoffset", REV_DASH[0]);
    const G = "revive";
    clock.play(R.revShade, [{ opacity: 0 }, { opacity: 1 }], { duration: 250, easing: "linear" }, { keep: true, chan: "in", group: G });
    clock.play(R.revCard, [{ opacity: 0, transform: rm ? "none" : "translateY(40px) scale(.94)" }, { opacity: 1, transform: "none" }],
      { duration: rm ? 200 : 320, easing: EASE.outBack }, { keep: true, chan: "in", group: G });
    if (!rm) clock.play(R.revHeart, [{ transform: "scale(1)" }, { transform: "scale(1.12)", offset: 0.15 }, { transform: "scale(1)", offset: 0.35 }, { transform: "scale(1)" }],
      { duration: 700, iterations: Infinity, easing: "ease-out" }, { chan: "beat", group: G });
    return new Promise(res => { revResolve = res; });
  }
  function finishRevive(ans) {
    if (!revResolve && !revOn) return;
    if ((ans === "revive" || ans === "decline") && (!revOn || !revArmed)) return;   // кнопки активны через 0.6 с
    revOn = false;
    const r = revResolve; revResolve = null;
    clock.cancelGroup("revive");
    emit("revive:answer", ans);
    if (r) r(ans);
  }

  // ---------- результаты (HUD-7) ----------
  let resT = 0, resOn = false, contOk = false;
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
    // GAME-8: бонус ловкости — энергоны, дистанция не умножается; итог = энергоны + бонус
    const bonus = Math.max(0, Math.round(stats.bonus || 0));
    const total = stats.total != null ? Math.round(stats.total) : en + bonus;
    const isBest = !!stats.isBest;
    const bestV = Math.max(stats.best != null ? stats.best : best, isBest ? dist : 0);
    setBest(bestV);

    clock.clearEl(R.results);
    show("results");
    locked = true; resT = 0; resOn = true; tickLast = -1;
    R.resHead.textContent = stats.title || TXT.resHead;
    rDistN.set(0); rEnN.set(0); rBonusN.set(0); rTotalN.set(total);
    R.rBonus.hidden = bonus <= 0;
    R.rTotal.hidden = bonus <= 0;                          // без бонуса итог совпадает с «Энергоны»
    R.streakChip.hidden = !(stats.streak > 1);
    if (stats.streak > 1) R.streakChip.textContent = TXT.streak(stats.streak);
    // ECON: «+N за забег · всего M» и «Продолжить за 100 ⬡» (неактивна с подсказкой, если не хватает)
    const w = stats.wallet;
    R.walletLine.hidden = !w;
    if (w) R.walletTxt.textContent = TXT.walletLine(Math.round(w.earned || 0), Math.round(w.total || 0));
    const rv = stats.revive;
    contOk = !!(rv && rv.can);
    R.contBtn.hidden = !rv;
    R.contHint.hidden = !rv || contOk;
    if (rv) {
      R.contTxt.textContent = TXT.cont(Math.round(rv.price || 0));
      R.contBtn.disabled = !contOk; R.contBtn.classList.toggle("dim", !contOk);
      if (!contOk) R.contHint.textContent = TXT.contNo(Math.round(rv.have || 0), Math.round(rv.price || 0));
    }
    if (w) setWallet(w.total);
    // подсказка: меньшее из «до рекорда» и «до следующих 500 м» (по дистанции — рекорд в метрах)
    let hint;
    if (isBest) hint = TXT.best;
    else {
      const toRec = bestV - dist;
      const goal = (Math.floor(dist / 500) + 1) * 500, left = goal - dist;
      hint = (toRec > 0 && toRec <= left) ? TXT.toRecord(toRec) : TXT.toGoal(goal, left);
    }
    R.hint.textContent = hint;
    R.bestLine.classList.toggle("calm", !!stats.calm);
    R.tip.hidden = !stats.tip;
    if (stats.tip) R.tip.textContent = stats.tip;
    R.quip.hidden = !stats.quip;
    if (stats.quip) { R.quipP.textContent = stats.quip; R.quipAva.textContent = (stats.speaker || "Куби")[0]; }
    const ms = stats.missions || [];
    R.mlist.hidden = !ms.length && !stats.nextMission;
    R.mlist.textContent = "";
    for (const m of ms) {
      const d = document.createElement("div");
      d.innerHTML = m.done ? `<svg class="rz-check" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10.5" fill="#070D36"/><path d="M6.8 12.4 L10.4 16 L17.4 8.6" fill="none" stroke="#C0FF3F" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>` : "<i>•</i>";
      d.appendChild(document.createTextNode(m.text));
      R.mlist.appendChild(d);
    }
    if (stats.nextMission) { const d = document.createElement("div"); d.className = "next"; d.textContent = TXT.next(stats.nextMission); R.mlist.appendChild(d); }

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
    const O = () => ({ keep: true, chan: "in", group: G });

    clock.play(R.resShade, [{ opacity: 0 }, { opacity: 1 }], { duration: 250, easing: "linear" }, O());
    clock.play(R.resCard, [{ opacity: 0, transform: fast ? "none" : "translateY(40px)" }, { opacity: 1, transform: "none" }],
      { duration: fast ? 250 : 380, easing: EASE.outBack }, O());
    clock.play(R.resHeadBox, [{ transform: "translate(-50%,-55%) scale(" + (fast ? 1 : 0.6) + ")" }, { transform: "translate(-50%,-55%) scale(1)" }],
      { duration: 300, delay: 120, easing: EASE.outBack }, O());
    const rowIn = (el, delay, fromX) => clock.play(el, [{ opacity: 0, transform: fast ? "none" : `translate(${fromX}px,8px)` }, { opacity: 1, transform: "none" }],
      { duration: 240, delay, easing: EASE.outCubic }, O());
    rowIn(R.rDist, 200, -16);
    rowIn(R.rEn, 290, -16);
    rowIn(R.walletLine, 380, 0);
    rowIn(R.bestLine, 380, 0);
    rowIn(R.tip, 470, 0);
    rowIn(R.quip, 470, 0);
    rowIn(R.mlist, 560, 0);
    if (bonus > 0) {
      clock.play(R.rBonus, [{ opacity: 0, transform: fast ? "none" : "translateX(40px)" }, { opacity: 1, transform: "none" }],
        { duration: 250, delay: bT, easing: EASE.outBack }, O());
      clock.play(R.rTotal, fast
        ? [{ opacity: 0 }, { opacity: 1 }]
        : [{ opacity: 0, transform: "scale(1.2)" }, { opacity: 1, transform: "scale(1)" }],
        { duration: 180, delay: totalT, easing: EASE.outCubic }, O());
    }
    clock.after(totalT, () => emit("ding"), G);
    if (isBest) {
      const sT = totalT + 180 + 200;
      clock.play(R.stamp, fast
        ? [{ opacity: 0, transform: "rotate(-6deg)" }, { opacity: 1, transform: "rotate(-6deg)" }]
        : [{ opacity: 0, transform: "scale(2.6) rotate(-12deg)" }, { opacity: 1, transform: "scale(1) rotate(-6deg)" }],
        { duration: 260, delay: sT, easing: EASE.outBack }, O());
      clock.after(sT, () => emit("stamp"), G);
      // штамп встаёт на место заголовка: заголовок гаснет под ним, чтобы край плашки не торчал
      clock.play(R.resHeadBox.parentElement, [{ opacity: 1 }, { opacity: 0 }], { duration: 120, delay: sT + 100, easing: "linear" }, { keep: true, chan: "hd", group: G });
      if (!fast) clock.play(R.resCenter, [
        { transform: "translateX(0)" }, { transform: "translateX(-5px)" }, { transform: "translateX(5px)" }, { transform: "translateX(-5px)" },
        { transform: "translateX(5px)" }, { transform: "translateX(-5px)" }, { transform: "translateX(0)" }],
        { duration: 220, delay: sT + 260, easing: "linear" }, { chan: "sh", group: G });
      clock.after(sT + 260, () => emit("confetti", { kind: "record" }), G);
    }
    // кнопки и конец блокировки ввода — на 1000 мс
    R.resBtns.classList.add("off");
    clock.play(R.resBtns, [{ opacity: 0, transform: fast ? "none" : "translateY(16px)" }, { opacity: 1, transform: "none" }],
      { duration: 260, delay: 1000, easing: EASE.outBack }, O());
    clock.after(1000, () => {
      locked = false;
      R.resBtns.classList.remove("off");
      (contOk ? R.contBtn : R.restartBtn).focus({ preventScroll: true });
      if (!rm) clock.play(R.restartBtn, [{ transform: "scale(1)" }, { transform: "scale(1.04)" }, { transform: "scale(1)" }],
        { duration: 1600, iterations: Infinity, easing: "ease-in-out" }, { chan: "br", group: G });
      emit("results:ready");
    }, G);
    return new Promise(res => { resResolve = res; });
  }

  // ---------- reduced motion ----------
  function applyRm() {
    const b = wantRm();
    if (b === rm && root.classList.contains("rz-rm") === rm) return;
    rm = b;
    root.classList.toggle("rz-rm", rm);
    clock.setReduced(rm);
    if (rm) { enSpring.reset(); distSpring.reset(); }
    if (tutStep) tutorial(tutArg);
    emit("reducedmotion", rm);
  }
  // публично: true/false — выбор игрока (сохраняется), null — «как в системе»
  function setReducedMotion(b) {
    forcedRm = null;
    settings.reducedMotion = b == null ? null : !!b;
    applySettingsUI(); applyRm(); commitSettings();
  }
  function setEnergonIcon(src) {
    const html = `<img src="${src}" alt="" draggable="false">`;
    R.enIco.innerHTML = html;
    for (const f of R.flies) f.innerHTML = html;
  }
  function setVolumes(v) {
    if (v.music != null) settings.music = clamp(v.music, 0, 1);
    if (v.sfx != null) settings.sfx = clamp(v.sfx, 0, 1);
    syncRanges();
  }
  applySettingsUI();
  applyRm();

  // ---------- кадр ----------
  function update(realDt) {
    const dt = realDt > 0.1 ? 0.1 : realDt < 0 ? 0 : realDt;
    hudTime += dt;
    clock.tick(dt * 1000);

    if (screen === "play" || screen === "pause" || screen === "revive") {
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

    if (revOn) {
      revT += dt * 1000;
      const u = revT >= revDur ? 1 : revT / revDur;
      const i = Math.round(u * 400);
      if (i !== revIdx) { revIdx = i; R.revFill.setAttribute("stroke-dashoffset", REV_DASH[i]); }
      if (!revArmed && revT >= REV_ARM) {
        revArmed = true; R.revBtns.classList.remove("off");
        R.revBtn.focus({ preventScroll: true });
        emit("revive:ready");
      }
      if (revT >= revDur) finishRevive("timeout");
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
      if (resT > 4000) resOn = false;
    }
  }

  function dispose() {
    removeEventListener("keydown", onKeyCapture, true);
    if (mq && mq.removeEventListener) mq.removeEventListener("change", onMQ);
    if (ro) ro.disconnect(); else removeEventListener("resize", layout);
    clock.clearEl(root);
    root.remove();
    if (resResolve) { const r = resResolve; resResolve = null; r("disposed"); }
    if (revResolve) { const r = revResolve; revResolve = null; r("disposed"); }
    handlers.clear();
  }

  function on(evt, fn) {
    if (!handlers.has(evt)) handlers.set(evt, new Set());
    handlers.get(evt).add(fn);
    return () => handlers.get(evt).delete(fn);
  }

  return {
    root, ready,
    show, setDistance, setBest, setStars, setEnergons, flyToCounter, projectToHUD, popLabel,
    setCombo, setMission, missionComplete, setDanger, countdown, go, runCountdown, banner, milestone, toast, allowFlash,
    results, revive, tutorial, tutorialPraise, openSettings, closeSettings, on,
    setWallet, setUpgrades, setPowerup, openShop, closeShop, shopBought,
    setReducedMotion, setEnergonIcon, setVolumes, update, dispose,
    get screen() { return screen; }, get locked() { return locked; }, get reducedMotion() { return rm; },
    get settings() { return settings; }, get settingsOpen() { return settingsOpen; }, get shopOpen() { return shopOpen; },
    _debug: { clock, R },
  };
}

/* ===================== КОНТРАКТ =====================
createHUD(ctx, { container, touch?, reducedMotion?, edges?, keys?, persist?, settings?, milestoneStep?, shop? })
  ctx: { quality, camera?, look? } — больше ничего не читает. Корень .rz-hud вставляется в container.
  hud.ready — промис: CSS и Nunito (кириллица + латиница) загружены.
  shop: { prices: [ур.1, ур.2, ур.3], dur: { magnet|shield|boost|x2: [база, ур.1, ур.2, ур.3] } } — числа магазина (cfg.power).
Экраны: show("none"|"title"|"play"|"pause"|"revive"|"results"); openSettings()/closeSettings() — оверлей поверх title/pause;
  openShop()/closeShop() — карточка «Прокачка» поверх title.
Экономика: setWallet(n) — кошелёк на титуле и в магазине; setUpgrades({kind: 0..3}) — уровни; shopBought(kind) — отклик покупки;
  results({ …, wallet: {earned, total}, revive: {price, can, have} }) — строка «+N за забег · всего M» и кнопка «Продолжить за N»
  (неактивна с подсказкой, если can=false) → событие continue.
Ускорители: setPowerup(kind, frac 0..1) — чип с иконкой и убывающей полоской (0 — спрятать); звать каждый кадр, без аллокаций.
Игра: setDistance(m) · setBest(m) · setStars(n) · setEnergons(n, {instant?, streak?, bump?}) · flyToCounter(x, y)
  · projectToHUD(v3, out) · popLabel(text, "plus"|"big"|"nice"|"warn"|"info", x?, y?, ms?) · setCombo(tier, progress, {mult?})
  · setMission(tpl|view, progress, {n, stars, total, intro}) · missionComplete({stars, total, next}) → Promise
  · setDanger(0..1) · countdown(n) → Promise (n ≤ 0 → go()) · go() → Promise · runCountdown(3) → Promise
  · banner(text, {hold}) · milestone(m) · toast(text, {force, duration}) → bool · allowFlash() → bool
  · tutorial("lane"|"left"|"right"|"up"|"down"|"tap"| {gesture, text?, skip?} | null) · tutorialPraise(text?)
  · revive({cost, have, timeout}) → Promise<"revive"|"decline"|"timeout"|"cancel"|"replaced">
  · results({dist, energons, bonus, isBest, best, streak, quip, speaker, tip, calm, title, missions:[{text,done}], nextMission})
      → Promise<"restart"|"menu"|"replaced"|"disposed">; ввод заблокирован 1000 мс
  · setReducedMotion(true|false|null) · setEnergonIcon(dataURL) · setVolumes({music, sfx}) · update(realDt) · dispose()
События on(evt, fn) → off(): start, pause, resume, menu, restart, tutorial, tutorial:skip, tutorial:shown, tutorial:praise,
  settings, settings:change(settings), settings:close, volume({music, sfx}), reducedmotion(bool), screen(name),
  countdown(n), go, milestone(m), combo:tier(n), mission:step(n), mission:complete, confetti({kind, x?, y?}),
  tick(row), ding, stamp, results:ready, revive:ready, revive:answer(ans), fly:arrive,
  continue (кнопка «Продолжить за N»), shop, shop:close, buy(kind)
*/
