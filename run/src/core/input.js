// Ввод (GAME-1): клавиатура любой раскладки, мышь/перо по третям экрана, свайпы, решаемые на touchmove.
// Модуль только переводит события в действия "LEFT" | "RIGHT" | "UP" | "DOWN" | "ENTER" | "ESC" | "PAUSE"
// и зовёт onAction(action, source). Что делать с действием, решает main.js.

// Читаем и code, и key, и keyCode: в части окружений и раскладок code приходит пустым.
export function keyOf(ev){
  const c = ev.code || "";
  const k = (ev.key || "").toLowerCase();
  const n = ev.keyCode || ev.which || 0;
  if (c === "Enter"  || k === "enter" || n === 13) return "ENTER";
  if (c === "Space"  || k === " " || k === "spacebar" || n === 32) return "UP";
  if (c === "Escape" || k === "escape" || n === 27) return "ESC";
  if (c === "KeyP"   || k === "p" || k === "з" || n === 80) return "PAUSE";
  if (c === "ArrowLeft"  || c === "KeyA" || k === "arrowleft"  || k === "a" || k === "ф" || n === 37 || n === 65) return "LEFT";
  if (c === "ArrowRight" || c === "KeyD" || k === "arrowright" || k === "d" || k === "в" || n === 39 || n === 68) return "RIGHT";
  if (c === "ArrowUp"    || c === "KeyW" || k === "arrowup"    || k === "w" || k === "ц" || n === 38 || n === 87) return "UP";
  if (c === "ArrowDown"  || c === "KeyS" || k === "arrowdown"  || k === "s" || k === "ы" || n === 40 || n === 83) return "DOWN";
  return "";
}

// элементы интерфейса (кнопки HUD) не должны запускать забег или прыжок
function isUiTarget(t){
  return !!(t && t.closest && t.closest("button, a, input, select, textarea, [data-ui], [data-action]"));
}

export function installInput({ onAction, isPlaying, target = window }){
  const state = { kind: "keys" };          // "keys" | "mouse" | "touch" — для подсказок туториала/HUD
  const act = (a, src) => { if (a) onAction(a, src); };

  const onKey = ev => {
    if (ev.repeat) { const a = keyOf(ev); if (a) ev.preventDefault(); return; }
    const a = keyOf(ev);
    if (!a) return;
    ev.preventDefault();
    state.kind = "keys";
    act(a, "key");
  };

  // мышь/перо: вне забега клик = ENTER; в забеге трети экрана: влево / прыжок / вправо
  const onPointer = ev => {
    if (ev.pointerType === "touch") return;  // касания обрабатывают свайпы
    if (ev.button !== undefined && ev.button !== 0) return;
    if (isUiTarget(ev.target)) return;
    state.kind = "mouse";
    if (!isPlaying()){ act("ENTER", "mouse"); return; }
    const w = innerWidth;
    if (ev.clientX < w * 0.28) act("LEFT", "mouse");
    else if (ev.clientX > w * 0.72) act("RIGHT", "mouse");
    else act("UP", "mouse");
  };

  // свайпы: решение на touchmove, как только палец прошёл порог; второй свайп тем же касанием через 120 мс
  let tid = null, sx = 0, sy = 0, st = 0, t0 = 0, x0 = 0, y0 = 0, fired = false, armAt = 0, moved = 0;
  const thr = () => Math.max(22, 0.04 * Math.min(innerWidth, innerHeight));
  const onTouchStart = ev => {
    if (isUiTarget(ev.target)) return;
    const t = ev.changedTouches[0];
    if (tid !== null) return;
    tid = t.identifier; sx = x0 = t.clientX; sy = y0 = t.clientY;
    st = t0 = performance.now(); fired = false; armAt = 0; moved = 0;
    state.kind = "touch";
  };
  const findTouch = list => { for (let i = 0; i < list.length; i++) if (list[i].identifier === tid) return list[i]; return null; };
  const onTouchMove = ev => {
    if (tid === null) return;
    const t = findTouch(ev.changedTouches);
    if (!t) return;
    if (ev.cancelable) ev.preventDefault();
    const now = performance.now();
    moved = Math.max(moved, Math.abs(t.clientX - x0) + Math.abs(t.clientY - y0));
    if (now < armAt) { sx = t.clientX; sy = t.clientY; st = now; return; }
    if (now - st > 350) { sx = t.clientX; sy = t.clientY; st = now; return; }  // медленный жест — не свайп, сбрасываем начало
    const dx = t.clientX - sx, dy = t.clientY - sy, T = thr();
    if (Math.abs(dx) < T && Math.abs(dy) < T) return;
    if (!isPlaying()) { fired = true; armAt = now + 120; sx = t.clientX; sy = t.clientY; st = now; act("ENTER", "touch"); return; }
    if (Math.abs(dx) > Math.abs(dy)) act(dx > 0 ? "RIGHT" : "LEFT", "touch");
    else act(dy > 0 ? "DOWN" : "UP", "touch");
    fired = true; armAt = now + 120;
    sx = t.clientX; sy = t.clientY; st = now;
  };
  const onTouchEnd = ev => {
    if (tid === null) return;
    const t = findTouch(ev.changedTouches);
    if (!t) return;
    const dur = performance.now() - t0;
    tid = null;
    if (fired) return;
    // тап ≤ 200 мс и < 12 px = прыжок (вне забега — старт)
    if (dur <= 200 && moved < 12) act(isPlaying() ? "UP" : "ENTER", "touch");
    else if (!isPlaying() && moved < 12) act("ENTER", "touch");
  };
  const onTouchCancel = () => { tid = null; };

  target.addEventListener("keydown", onKey);
  target.addEventListener("pointerdown", onPointer);
  target.addEventListener("touchstart", onTouchStart, { passive: true });
  target.addEventListener("touchmove", onTouchMove, { passive: false });
  target.addEventListener("touchend", onTouchEnd, { passive: true });
  target.addEventListener("touchcancel", onTouchCancel, { passive: true });

  state.dispose = () => {
    target.removeEventListener("keydown", onKey);
    target.removeEventListener("pointerdown", onPointer);
    target.removeEventListener("touchstart", onTouchStart);
    target.removeEventListener("touchmove", onTouchMove);
    target.removeEventListener("touchend", onTouchEnd);
    target.removeEventListener("touchcancel", onTouchCancel);
  };
  return state;
}
