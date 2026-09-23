// Ввод: клавиатура (по e.code — независимо от раскладки; e.key и keyCode — запасной вариант),
// мышь (правая кнопка — рывок), экранные кнопки на тач-экране.
// Держим «зажатые» действия (left/right/jump/dash) и отдаём фронты нажатий в onAction(action, down).
// Действия: left right jump dash retry pause enter up down

export function actionOf(ev){
  const c = ev.code || "";
  const k = (ev.key || "").toLowerCase();
  const n = ev.keyCode || ev.which || 0;
  if (c === "Escape" || k === "escape" || k === "esc" || n === 27) return "pause";
  if (c === "KeyP" || k === "p" || k === "з" || n === 80) return "pause";
  if (c === "Enter" || c === "NumpadEnter" || k === "enter" || n === 13) return "enter";
  if (c === "Space" || k === " " || k === "spacebar" || n === 32) return "jump";
  if (c === "ShiftLeft" || c === "ShiftRight" || k === "shift" || n === 16) return "dash";
  if (c === "KeyK" || c === "KeyX" || c === "KeyL" || k === "k" || k === "x" || k === "л" || k === "ч") return "dash";
  if (c === "KeyR" || k === "r" || k === "к" || n === 82) return "retry";
  if (c === "ArrowLeft" || c === "KeyA" || k === "arrowleft" || k === "a" || k === "ф" || n === 37 || n === 65) return "left";
  if (c === "ArrowRight" || c === "KeyD" || k === "arrowright" || k === "d" || k === "в" || n === 39 || n === 68) return "right";
  if (c === "ArrowUp" || c === "KeyW" || k === "arrowup" || k === "w" || k === "ц" || n === 38 || n === 87) return "up";
  if (c === "ArrowDown" || c === "KeyS" || k === "arrowdown" || k === "s" || k === "ы" || n === 40 || n === 83) return "down";
  if (c === "KeyJ" || c === "KeyZ" || k === "j" || k === "z" || k === "о" || k === "я") return "jump";
  return "";
}

const isUi = t => !!(t && t.closest && t.closest("button, a, input, select, textarea, [data-ui]"));

export function createInput({ onAction, menuOpen = () => false }){
  // held — источники по действию: клавиатура по коду клавиши, мышь, тач-кнопки. Действие зажато, если есть хоть один источник.
  const held = { left: new Set(), right: new Set(), jump: new Set(), dash: new Set(), up: new Set(), down: new Set() };
  const state = { kind: "keys", touch: false };

  function press(action, down, src){
    if (!action) return;
    const H = held[action];
    if (H){
      const was = H.size > 0;
      if (down) H.add(src); else H.delete(src);
      const now = H.size > 0;
      if (now !== was) onAction(action, now, src);
      return;
    }
    if (down) onAction(action, true, src);
  }

  const onKeyDown = ev => {
    const a = actionOf(ev);
    if (!a) return;
    // в открытом меню Enter/Пробел по сфокусированной кнопке — её собственный клик
    if (menuOpen() && isUi(ev.target) && (a === "enter" || a === "jump") && ev.target.tagName !== "INPUT") return;
    ev.preventDefault();
    state.kind = "keys";
    const src = "k:" + (ev.code || ev.key || ev.keyCode);
    if (ev.repeat){ return; }
    press(a, true, src);
    // «вверх» — ещё и прыжок в игре (W/↑)
    if (a === "up") press("jump", true, src + ":j");
  };
  const onKeyUp = ev => {
    const a = actionOf(ev);
    if (!a) return;
    const src = "k:" + (ev.code || ev.key || ev.keyCode);
    press(a, false, src);
    if (a === "up") press("jump", false, src + ":j");
    // Shift без code в некоторых окружениях — снимаем все клавиатурные источники действия
    if (a === "dash") for (const s of [...held.dash]) if (s.startsWith("k:")) press("dash", false, s);
  };

  const onMouseDown = ev => {
    if (ev.button === 2){ ev.preventDefault(); state.kind = "mouse"; press("dash", true, "mouse"); return; }
    if (ev.button === 0 && !isUi(ev.target)) { state.kind = "mouse"; onAction("click", true, "mouse"); }
  };
  const onMouseUp = ev => { if (ev.button === 2) press("dash", false, "mouse"); };
  const onContext = ev => { if (!isUi(ev.target)) ev.preventDefault(); };

  // потеря фокуса — отпускаем всё, чтобы ничего не «залипло»
  const releaseAll = () => { for (const a in held) for (const s of [...held[a]]) press(a, false, s); };
  const onBlur = () => { releaseAll(); onAction("blur", true, "window"); };
  const onVis = () => { if (document.hidden){ releaseAll(); onAction("blur", true, "window"); } };

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("mousedown", onMouseDown);
  window.addEventListener("mouseup", onMouseUp);
  window.addEventListener("contextmenu", onContext);
  window.addEventListener("blur", onBlur);
  document.addEventListener("visibilitychange", onVis);

  // ---------- тач-кнопки ----------
  function bindTouchButton(el, action){
    const src = "t:" + action;
    const down = e => { e.preventDefault(); state.kind = "touch"; state.touch = true; el.classList.add("on"); press(action, true, src); try { el.setPointerCapture(e.pointerId); } catch (_){} };
    const up = e => { e.preventDefault(); el.classList.remove("on"); press(action, false, src); };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("lostpointercapture", up);
  }
  window.addEventListener("touchstart", () => { if (!state.touch){ state.touch = true; onAction("touchmode", true, "touch"); } }, { passive: true });

  return {
    state, held, press, bindTouchButton, releaseAll,
    isHeld: a => held[a] && held[a].size > 0,
    dispose(){
      window.removeEventListener("keydown", onKeyDown); window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("mousedown", onMouseDown); window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("contextmenu", onContext); window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVis);
    },
  };
}
