// HUD и экраны на DOM: счётчик кристаллов, звёздные, сердечки, таймер, кнопка паузы, строка подсказок;
// титул с меню (Играть / Уровни / Настройки), экран уровней (карточки), настройки (звук + качество),
// пауза, «Попробуем ещё раз», победа (+ «Следующий уровень»); тач-кнопки.
// Модуль ничего не знает об игре: зовёт onCommand(name, arg) и принимает set()/show()/levels()/settings().

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
  lock: `<svg viewBox="0 0 24 24"><rect x="5" y="10.5" width="14" height="10" rx="2.5" fill="#fff" stroke="#070D36" stroke-width="2.2"/><path d="M8 10.5 V7.5 A4 4 0 0 1 16 7.5 V10.5" fill="none" stroke="#070D36" stroke-width="2.2"/><circle cx="12" cy="15.3" r="1.8" fill="#070D36"/></svg>`,
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
  let starsBox = el("div", "pz-stars");
  row.append(crys, starsBox);
  const heartsBox = el("div", "pz-hearts");
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

  // ---------- состояние (объявлено рано — rebuildTop уже сбрасывает last.* при первой сборке) ----------
  const last = { crystals: -1, stars: "", hearts: -1, time: "" };

  function rebuildTop(nCrys, nStars){
    crys.querySelector("small").textContent = `/ ${nCrys}`;
    starsBox.innerHTML = "";
    for (let i = 0; i < nStars; i++) starsBox.appendChild(el("span", "", ICON.star).firstChild);
    heartsBox.innerHTML = "";
    for (let i = 0; i < hearts; i++) heartsBox.appendChild(el("span", "", ICON.heart).firstChild);
    last.crystals = -1; last.stars = ""; last.hearts = -1;
  }
  rebuildTop(totalCrystals, totalStars);

  // ---------- экраны ----------
  const mkScreen = (id, html, dim) => { const s = el("div", "pz-screen" + (dim ? " pz-dim" : ""), `<div class="pz-card">${html}</div>`); s.id = id; s.hidden = true; return s; };
  const title = mkScreen("scrTitle", `
    <h1>РИЗИ<span class="dot">·</span></h1>
    <div class="pz-sub">Кристальный путь</div>
    <div class="pz-text">В груди у Ризи — кристальное сердце. Пройди по крепостным стенам Идеалити, собери кристаллы,
      погаси Гасителей и найди настоящее Кристальное сердце.</div>
    <div class="pz-menu">
      <button class="pz-btn big" data-cmd="play" data-i="0">Играть</button>
      <button class="pz-btn alt" data-cmd="levels" data-i="1">Уровни</button>
      <button class="pz-btn alt" data-cmd="settings" data-i="2">Настройки</button>
    </div>
    <div class="pz-keys"><span><kbd>A</kbd><kbd>D</kbd> бег</span> · <span><kbd>ПРОБЕЛ</kbd> прыжок ×2</span> · <span><kbd>SHIFT</kbd> рывок</span><br><span><kbd>R</kbd> заново</span> · <span><kbd>ESC</kbd> пауза</span> · <span>Enter или клик — выбрать</span></div>
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
    <div class="pz-menu" id="winMenu">
      <button class="pz-btn big" data-cmd="nextlevel" data-i="0" hidden>Следующий уровень</button>
      <button class="pz-btn alt" data-cmd="again" data-i="1">Ещё раз</button>
    </div>
    <div class="pz-keys"><kbd>Enter</kbd> — далее</div>`);
  const levels = mkScreen("scrLevels", `
    <h2>Уровни</h2>
    <div class="pz-levels" id="levelsGrid"></div>
    <button class="pz-btn alt" data-cmd="backtitle" id="levelsBack">Назад</button>
    <div class="pz-keys"><kbd>↑</kbd><kbd>↓</kbd> выбор · <kbd>Enter</kbd> открыть · <kbd>ESC</kbd> назад</div>`, true);
  const settings = mkScreen("scrSettings", `
    <h2>Настройки</h2>
    <div class="pz-menu">
      <label class="pz-vol" data-i="0"><span>Громкость</span><input type="range" min="0" max="100" step="5" data-ui><b>70%</b></label>
      <div class="pz-quality" data-i="1"><span>Качество графики</span>
        <div class="pz-qopts">
          <button class="pz-qbtn" data-q="low" data-ui="1">low</button>
          <button class="pz-qbtn" data-q="med" data-ui="1">med</button>
          <button class="pz-qbtn" data-q="high" data-ui="1">high</button>
        </div>
      </label>
      <button class="pz-btn alt" data-cmd="backtitle" data-i="2">Назад</button>
    </div>
    <div class="pz-keys"><kbd>↑</kbd><kbd>↓</kbd> выбор · <kbd>←</kbd><kbd>→</kbd> изменить · <kbd>ESC</kbd> назад</div>`, true);
  const fade = el("div"); fade.id = "pzFade";
  root.append(hud, title, pause, over, win, levels, settings, fade);

  // кнопки экранов
  root.addEventListener("click", e => {
    const b = e.target.closest("[data-cmd]");
    if (!b || b.disabled) return;
    e.preventDefault(); b.blur();
    onCommand(b.dataset.cmd, b.dataset.arg !== undefined ? b.dataset.arg : undefined);
  });
  const vol = pause.querySelector("input"), volB = pause.querySelector(".pz-vol b");
  vol.addEventListener("input", () => { volB.textContent = vol.value + "%"; onCommand("volume", vol.value / 100); syncVol(sVol); });
  const sVol = settings.querySelector("input"), sVolB = settings.querySelector(".pz-vol b");
  sVol.addEventListener("input", () => { sVolB.textContent = sVol.value + "%"; onCommand("volume", sVol.value / 100); syncVol(vol); });
  function syncVol(target){ /* держим оба ползунка (пауза/настройки) синхронными визуально */ }
  const qBtns = [...settings.querySelectorAll(".pz-qbtn")];
  for (const b of qBtns) b.addEventListener("click", e => { e.stopPropagation(); onCommand("quality", b.dataset.q); });
  function setQualityUI(q){ for (const b of qBtns) b.classList.toggle("on", b.dataset.q === q); }

  // ---------- состояние ----------
  let screen = null, sel = 0, toastT = 0, bannerT = 0;
  const screenEl = () => ({ title, pause, over, win, levels, settings }[screen]);
  // .hidden исключаем — например, кнопка «Следующий уровень» скрыта на последнем уровне
  const menuItems = () => { const s = screenEl(); return s ? [...s.querySelectorAll("[data-i]")].filter(x => !x.hidden) : []; };

  function setSel(i){
    const items = menuItems();
    if (!items.length) return;
    sel = (i + items.length) % items.length;
    items.forEach((it, k) => it.classList.toggle("sel", k === sel));
  }

  return {
    hud,
    touchButtons: tb,
    setLevelMeta({ totalCrystals: nc, totalStars: ns }){ rebuildTop(nc, ns); },
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
      levels.hidden = name !== "levels"; settings.hidden = name !== "settings";
      hud.style.visibility = (name === "title" || name === "levels" || name === "settings") ? "hidden" : "visible";
      if (name === "pause" || name === "title" || name === "levels" || name === "settings") setSel(0);
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    },
    get screen(){ return screen; },
    menuMove(d){ if (menuItems().length) setSel(sel + d); },
    menuSide(d){
      const items = menuItems(), it = items[sel];
      if (!it) return false;
      if (it.classList.contains("pz-vol")){
        const input = it.querySelector("input");
        input.value = Math.max(0, Math.min(100, +input.value + d * 10)); input.dispatchEvent(new Event("input"));
        return true;
      }
      if (it.classList.contains("pz-quality")){
        const order = ["low", "med", "high"];
        const cur = qBtns.findIndex(b => b.classList.contains("on"));
        const next = order[Math.max(0, Math.min(2, (cur < 0 ? 1 : cur) + d))];
        onCommand("quality", next);
        return true;
      }
      return false;
    },
    // Enter/Пробел на экране
    activate(){
      if (screen === "title") onCommand("play");
      else if (screen === "over") onCommand("continue");
      else if (screen === "win"){ const it = menuItems()[sel]; onCommand(it && it.dataset.cmd ? it.dataset.cmd : "again"); }
      else { const it = menuItems()[sel]; if (it && it.dataset.cmd) onCommand(it.dataset.cmd, it.dataset.arg); }
    },
    setVolume(v){
      const pct = Math.round(v * 100);
      vol.value = pct; volB.textContent = pct + "%";
      sVol.value = pct; sVolB.textContent = pct + "%";
    },
    setQuality: setQualityUI,
    setBest(text){ const b = title.querySelector(".pz-best"); b.textContent = text || ""; b.hidden = !text; },
    toast(text, dur = 1.6){ toast.textContent = text; toast.classList.add("on"); toastT = dur; },
    banner(small, big, dur = 2.0){ banner.querySelector("small").textContent = small; banner.querySelector("b").textContent = big; banner.classList.add("on"); bannerT = dur; },
    win({ crystals, total, stars, time: t, best, record, hasNext }){
      win.querySelector('[data-v="crys"]').innerHTML = `${crystals} / ${total}`;
      win.querySelector('[data-v="stars"]').innerHTML = stars.map(g => ICON.star.replace("<svg", `<svg class="${g ? "got" : ""}"`)).join("");
      win.querySelector('[data-v="time"]').textContent = fmtTime(t);
      win.querySelector('[data-v="best"]').textContent = best || "";
      win.querySelector(".pz-record").hidden = !record;
      win.querySelector('[data-cmd="nextlevel"]').hidden = !hasNext;
      screen = "win"; setSel(0);
    },
    // карточки уровней: list = [{id,title,unlocked,stars,crystals,totalCrystals,totalStars,best,lockedHint}]
    levels(list){
      const grid = levels.querySelector("#levelsGrid");
      grid.innerHTML = "";
      list.forEach((lv, i) => {
        const starsHtml = Array.from({ length: lv.totalStars }, (_, k) => ICON.star.replace("<svg", `<svg class="${k < lv.stars ? "got" : ""}"`)).join("");
        const card = el("button", "pz-lvl-card" + (lv.unlocked ? "" : " locked"), `
          <div class="pz-lvl-top">${lv.unlocked ? "" : ICON.lock}<b>${lv.title}</b></div>
          ${lv.unlocked ? `
            <div class="pz-lvl-stars">${starsHtml}</div>
            <div class="pz-lvl-row">${ICON.crystal}<span>${lv.crystals} / ${lv.totalCrystals}</span></div>
            <div class="pz-lvl-row">${ICON.clock}<span>${lv.best ? fmtTime(lv.best) : "—"}</span></div>
          ` : `<div class="pz-lvl-hint">${lv.lockedHint}</div>`}`);
        card.dataset.i = i;
        if (lv.unlocked){ card.dataset.cmd = "selectlevel"; card.dataset.arg = lv.id; }
        else card.disabled = true;
        grid.appendChild(card);
      });
      setSel(0);
    },
    fade(a){ fade.style.opacity = a; },
    touchMode(on){ touch.hidden = !on; hint.hidden = !!on; },
    update(dt){
      if (toastT > 0){ toastT -= dt; if (toastT <= 0) toast.classList.remove("on"); }
      if (bannerT > 0){ bannerT -= dt; if (bannerT <= 0) banner.classList.remove("on"); }
    },
  };
}
