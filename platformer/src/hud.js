// HUD и экраны на DOM: счётчик кристаллов, звёздные, сердечки, таймер, кнопка паузы, строка подсказок;
// титул, меню паузы (Продолжить / Заново / С начала / громкость), «Попробуем ещё раз», победа; тач-кнопки.
// Модуль ничего не знает об игре: зовёт onCommand(name, arg) и принимает set()/show().

const ICON = {
  crystal: `<svg viewBox="0 0 32 32"><path d="M16 2 L25 12 L16 30 L7 12 Z" fill="#3fe6d4" stroke="#070D36" stroke-width="2.6" stroke-linejoin="round"/><path d="M16 2 L19 12 L16 30 L13 12 Z M7 12 H25" fill="#8ff5ea" stroke="#070D36" stroke-width="1.6" stroke-linejoin="round"/><path d="M10.5 9.5 L13.5 6" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>`,
  heart: `<svg viewBox="0 0 32 30"><path class="f" d="M16 27 C6 20 2.5 14.5 2.5 9.5 C2.5 5.5 5.6 2.8 9.2 2.8 C12.1 2.8 14.4 4.6 16 7 C17.6 4.6 19.9 2.8 22.8 2.8 C26.4 2.8 29.5 5.5 29.5 9.5 C29.5 14.5 26 20 16 27 Z" fill="#ff5c8a" stroke="#070D36" stroke-width="2.6" stroke-linejoin="round"/><path d="M8 8.5 C8.5 7 9.8 6.2 11 6.3" stroke="#fff" stroke-width="2.2" stroke-linecap="round" fill="none"/></svg>`,
  star: `<svg viewBox="0 0 32 32"><path class="f" d="M16 2.5 L20 11.5 L29.5 12.3 L22.3 18.7 L24.5 28.5 L16 23.4 L7.5 28.5 L9.7 18.7 L2.5 12.3 L12 11.5 Z" fill="#C0FF3F" stroke="#070D36" stroke-width="2.6" stroke-linejoin="round"/></svg>`,
  clock: `<svg viewBox="0 0 32 32"><circle cx="16" cy="17" r="12" fill="#fff" stroke="#070D36" stroke-width="2.8"/><path d="M16 10 V17 L21 20" stroke="#0536D4" stroke-width="3" stroke-linecap="round" fill="none"/><rect x="13" y="1.5" width="6" height="4" rx="1.5" fill="#070D36"/></svg>`,
  pause: `<svg viewBox="0 0 20 20"><rect x="3.5" y="2.5" width="4.6" height="15" rx="1.6" fill="#070D36"/><rect x="11.9" y="2.5" width="4.6" height="15" rx="1.6" fill="#070D36"/></svg>`,
  left: `<svg viewBox="0 0 32 32"><path d="M20 6 L9 16 L20 26" stroke="#070D36" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>`,
  right: `<svg viewBox="0 0 32 32"><path d="M12 6 L23 16 L12 26" stroke="#070D36" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>`,
  jump: `<svg viewBox="0 0 32 32"><path d="M8 20 L16 11 L24 20" stroke="#070D36" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M8 28 L16 19 L24 28" stroke="#070D36" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" fill="none" opacity=".45"/></svg>`,
  dash: `<svg viewBox="0 0 32 32"><path d="M6 9 L15 16 L6 23 M16 9 L25 16 L16 23" stroke="#070D36" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>`,
};

export const fmtTime = s => {
  s = Math.max(0, s);
  const m = Math.floor(s / 60), r = s - m * 60;
  return `${m}:${r < 10 ? "0" : ""}${r.toFixed(1)}`;
};

export function createHud({ root, totalCrystals, totalStars, hearts, onCommand }){
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };

  // ---------- игровой HUD ----------
  const hud = el("div", "pz-hud"); hud.id = "hud";
  const tl = el("div", "pz-tl"), row = el("div", "pz-row");
  const crys = el("div", "pz-pill pz-crys", `${ICON.crystal}<b>0</b><small>/ ${totalCrystals}</small>`);
  const starsBox = el("div", "pz-stars");
  for (let i = 0; i < totalStars; i++) starsBox.appendChild(el("span", "", ICON.star).firstChild);
  row.append(crys, starsBox);
  const heartsBox = el("div", "pz-hearts");
  for (let i = 0; i < hearts; i++) heartsBox.appendChild(el("span", "", ICON.heart).firstChild);
  tl.append(row, heartsBox);
  const tr = el("div", "pz-tr");
  const time = el("div", "pz-pill pz-time", `${ICON.clock}<b>0:00.0</b>`);
  const pauseBtn = el("button", "pz-round", ICON.pause); pauseBtn.setAttribute("aria-label", "Пауза"); pauseBtn.dataset.ui = "1";
  pauseBtn.addEventListener("click", e => { e.currentTarget.blur(); onCommand("pause"); });
  tr.append(time, pauseBtn);
  const hint = el("div", "pz-hint", `<i>A D</i> — бег<span class="sep">·</span><i>ПРОБЕЛ</i> — прыжок ×2<span class="sep">·</span><i>SHIFT</i> / ПКМ — рывок<span class="sep">·</span><i>R</i> — заново<span class="sep">·</span><i>ESC</i> — пауза`);
  const toast = el("div", "pz-toast");
  const banner = el("div", "pz-banner", `<small></small><b></b>`);
  const touch = el("div", "pz-touch"); touch.hidden = true;
  const tb = {};
  for (const [k, cls, icon] of [["left", "l", ICON.left], ["right", "r", ICON.right], ["jump", "j", ICON.jump], ["dash", "d", ICON.dash]]){
    const b = el("div", "pz-tbtn " + cls, icon); b.dataset.ui = "1"; touch.appendChild(b); tb[k] = b;
  }
  hud.append(tl, tr, hint, toast, banner, touch);

  // ---------- экраны ----------
  const mkScreen = (id, html, dim) => { const s = el("div", "pz-screen" + (dim ? " pz-dim" : ""), `<div class="pz-card">${html}</div>`); s.id = id; s.hidden = true; return s; };
  const title = mkScreen("scrTitle", `
    <h1>РИЗИ<span class="dot">·</span></h1>
    <div class="pz-sub">Кристальный путь</div>
    <div class="pz-text">В груди у Ризи — кристальное сердце. Пройди по крепостным стенам Идеалити, собери кристаллы,
      погаси Гасителей и найди настоящее Кристальное сердце.</div>
    <button class="pz-btn big" data-cmd="play">Играть</button>
    <div class="pz-keys"><span><kbd>A</kbd><kbd>D</kbd> бег</span> · <span><kbd>ПРОБЕЛ</kbd> прыжок ×2</span> · <span><kbd>SHIFT</kbd> рывок</span><br><span><kbd>R</kbd> заново</span> · <span><kbd>ESC</kbd> пауза</span> · <span>Enter или клик — начать</span></div>
    <div class="pz-best" hidden></div>`);
  const pause = mkScreen("scrPause", `
    <h2>Пауза</h2>
    <div class="pz-menu">
      <button class="pz-btn" data-cmd="resume" data-i="0">Продолжить</button>
      <button class="pz-btn alt" data-cmd="retry" data-i="1">Заново с факела</button>
      <button class="pz-btn alt" data-cmd="restart" data-i="2">Уровень с начала</button>
      <label class="pz-vol" data-i="3"><span>Громкость</span><input type="range" min="0" max="100" step="5" data-ui><b>70%</b></label>
    </div>
    <div class="pz-keys"><kbd>↑</kbd><kbd>↓</kbd> выбор · <kbd>Enter</kbd> ок · <kbd>←</kbd><kbd>→</kbd> громкость · <kbd>ESC</kbd> назад в игру</div>`, true);
  const over = mkScreen("scrOver", `
    <h2>Попробуем ещё раз!</h2>
    <div class="pz-text">Сердечки кончились, но факел горит — Ризи начнёт с последнего чекпоинта с полными силами.</div>
    <button class="pz-btn big" data-cmd="continue">Ещё раз</button>
    <div class="pz-keys"><kbd>Enter</kbd> или <kbd>R</kbd> — продолжить</div>`, true);
  const win = mkScreen("scrWin", `
    <h2>Кристальное сердце найдено!</h2>
    <div class="pz-record" hidden>Новый рекорд!</div>
    <div class="pz-stats">
      <span class="k">Кристаллы</span><span class="v" data-v="crys"></span>
      <span class="k">Звёздные</span><span class="v pz-starline" data-v="stars"></span>
      <span class="k">Время</span><span class="v" data-v="time"></span>
    </div>
    <div class="pz-best" data-v="best"></div>
    <button class="pz-btn big" data-cmd="again">Ещё раз</button>
    <div class="pz-keys"><kbd>Enter</kbd> — пройти заново</div>`);
  const fade = el("div"); fade.id = "pzFade";
  root.append(hud, title, pause, over, win, fade);

  // кнопки экранов
  for (const b of root.querySelectorAll("[data-cmd]")){
    b.addEventListener("click", e => { e.preventDefault(); e.currentTarget.blur(); onCommand(b.dataset.cmd); });
  }
  const vol = pause.querySelector("input"), volB = pause.querySelector(".pz-vol b");
  vol.addEventListener("input", () => { volB.textContent = vol.value + "%"; onCommand("volume", vol.value / 100); });

  // ---------- состояние ----------
  const last = { crystals: -1, stars: "", hearts: -1, time: "" };
  let screen = null, sel = 0, toastT = 0, bannerT = 0;
  const menuItems = () => [...pause.querySelectorAll("[data-i]")];

  function setSel(i){
    const items = menuItems();
    sel = (i + items.length) % items.length;
    items.forEach((it, k) => it.classList.toggle("sel", k === sel));
  }

  return {
    hud,
    touchButtons: tb,
    set({ crystals, stars, hearts: h, time: t }){
      if (crystals !== last.crystals){
        crys.querySelector("b").textContent = crystals;
        if (last.crystals >= 0 && crystals > last.crystals){ crys.classList.remove("bump"); void crys.offsetWidth; crys.classList.add("bump"); }
        last.crystals = crystals;
      }
      const sk = stars.map(Number).join("");
      if (sk !== last.stars){ [...starsBox.children].forEach((s, i) => s.classList.toggle("got", !!stars[i])); last.stars = sk; }
      if (h !== last.hearts){
        [...heartsBox.children].forEach((s, i) => {
          const lost = i >= h;
          if (lost && !s.classList.contains("lost") && last.hearts >= 0){ s.classList.remove("hit"); void s.getBoundingClientRect(); s.classList.add("hit"); }
          s.classList.toggle("lost", lost);
        });
        last.hearts = h;
      }
      const ts = fmtTime(t);
      if (ts !== last.time){ time.querySelector("b").textContent = ts; last.time = ts; }
    },
    show(name){
      screen = name;
      title.hidden = name !== "title"; pause.hidden = name !== "pause"; over.hidden = name !== "over"; win.hidden = name !== "win";
      hud.style.visibility = name === "title" ? "hidden" : "visible";
      if (name === "pause") setSel(0);
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    },
    get screen(){ return screen; },
    menuMove(d){ if (screen === "pause") setSel(sel + d); },
    menuSide(d){
      if (screen !== "pause" || menuItems()[sel] !== pause.querySelector(".pz-vol")) return false;
      vol.value = Math.max(0, Math.min(100, +vol.value + d * 10)); vol.dispatchEvent(new Event("input"));
      return true;
    },
    // Enter/Пробел на экране
    activate(){
      if (screen === "title") onCommand("play");
      else if (screen === "over") onCommand("continue");
      else if (screen === "win") onCommand("again");
      else if (screen === "pause"){ const it = menuItems()[sel]; if (it && it.dataset.cmd) onCommand(it.dataset.cmd); }
    },
    setVolume(v){ vol.value = Math.round(v * 100); volB.textContent = vol.value + "%"; },
    setBest(text){ const b = title.querySelector(".pz-best"); b.textContent = text || ""; b.hidden = !text; },
    toast(text, dur = 1.6){ toast.textContent = text; toast.classList.add("on"); toastT = dur; },
    banner(small, big, dur = 2.0){ banner.querySelector("small").textContent = small; banner.querySelector("b").textContent = big; banner.classList.add("on"); bannerT = dur; },
    win({ crystals, total, stars, time: t, best, record }){
      win.querySelector('[data-v="crys"]').innerHTML = `${crystals} / ${total}`;
      win.querySelector('[data-v="stars"]').innerHTML = stars.map(g => ICON.star.replace("<svg", `<svg class="${g ? "got" : ""}"`)).join("");
      win.querySelector('[data-v="time"]').textContent = fmtTime(t);
      win.querySelector('[data-v="best"]').textContent = best || "";
      win.querySelector(".pz-record").hidden = !record;
    },
    fade(a){ fade.style.opacity = a; },
    touchMode(on){ touch.hidden = !on; hint.hidden = !!on; },
    update(dt){
      if (toastT > 0){ toastT -= dt; if (toastT <= 0) toast.classList.remove("on"); }
      if (bannerT > 0){ bannerT -= dt; if (bannerT <= 0) banner.classList.remove("on"); }
    },
  };
}
