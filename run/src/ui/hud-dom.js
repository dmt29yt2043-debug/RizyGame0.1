// Разметка HUD: строим DOM один раз и возвращаем ссылки R. Никаких ссылок на index.html.
import { gemSVG, pauseSVG, playSVG, retrySVG, gearSVG, checkSVG, swarmSVG, handSVG, snowflakeSVG, trophySVG, starSVG } from "./icons.js";

export const RING_R = 26;
export const RING_C = 2 * Math.PI * RING_R;

const h = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };

export function buildDOM(root, { touch }) {
  const R = {};
  const q = (sel, from = root) => from.querySelector(sel);

  // ---------- ИГРА ----------
  R.play = h(`<div class="rz-scr rz-play" hidden>
    <div class="rz-danger"></div>
    <div class="rz-tl">
      <button class="rz-round rz-hit" data-act="pause" aria-label="Пауза">${pauseSVG}</button>
      <div class="rz-distcol">
        <div class="rz-pill rz-dist"><div class="rz-pill-body"><span class="rz-dist-n rz-stroke"></span><span class="rz-dist-u rz-stroke">м</span></div></div>
        <div class="rz-next"><span>до</span><span class="rz-goal"></span><span>м:</span><b></b></div>
      </div>
    </div>
    <div class="rz-mis" hidden>
      <div class="rz-mis-bg"></div><div class="rz-mis-lime"></div>
      <div class="rz-mis-in">
        <div class="rz-mis-glyph">${starSVG(true)}</div>
        <div class="rz-mis-txt"></div>
        <div class="rz-stars"></div>
      </div>
      <div class="rz-mis-bar"><div class="rz-mis-fill"></div></div>
      <div class="rz-mis-done">${checkSVG}<span>ГОТОВО!</span><div class="rz-stars rz-stars-done"></div></div>
    </div>
    <div class="rz-tr">
      <div class="rz-pill rz-en"><div class="rz-pill-body"><div class="rz-en-ico">${gemSVG()}</div><span class="rz-en-n rz-stroke"></span></div></div>
      <div class="rz-row2">
        <span class="rz-streak"><span>+</span><span class="rz-streak-n"></span></span>
        <span class="rz-pct" hidden><span>+</span><span class="rz-pct-n"></span><span>%</span></span>
        <div class="rz-combo"><div class="rz-combo-in">
          <div class="rz-combo-core"><div class="rz-combo-x"><small>x</small><span>2</span></div></div>
          <svg class="rz-ring" viewBox="0 0 64 64" aria-hidden="true">
            <circle cx="32" cy="32" r="${RING_R}" fill="none" stroke="rgba(255,255,255,.16)" stroke-width="6"/>
            <circle class="rz-ring-fill" cx="32" cy="32" r="${RING_R}" fill="none" stroke="#C0FF3F" stroke-width="6" stroke-linecap="round"
              stroke-dasharray="${RING_C.toFixed(2)}" stroke-dashoffset="${RING_C.toFixed(2)}"/>
          </svg>
          <div class="rz-wave"></div>
        </div></div>
      </div>
    </div>
    <div class="rz-swarm">
      <div class="rz-swarm-lbl">РОЙ БЛИЗКО!</div>
      <div class="rz-swarm-row"><div class="rz-swarm-ico">${swarmSVG}</div><div class="rz-swarm-track"><div class="rz-swarm-fill"></div></div></div>
    </div>
  </div>`);
  root.appendChild(R.play);
  R.danger = q(".rz-danger", R.play);
  R.pauseBtn = q("[data-act=pause]", R.play);
  R.distPill = q(".rz-dist", R.play); R.distBody = q(".rz-dist .rz-pill-body", R.play); R.distN = q(".rz-dist-n", R.play);
  R.next = q(".rz-next", R.play); R.goal = q(".rz-goal", R.play); R.left = q(".rz-next b", R.play);
  R.mis = q(".rz-mis", R.play); R.misBg = q(".rz-mis-bg", R.play); R.misLime = q(".rz-mis-lime", R.play);
  R.misIn = q(".rz-mis-in", R.play); R.misTxt = q(".rz-mis-txt", R.play); R.misStars = q(".rz-mis-in .rz-stars", R.play);
  R.misFill = q(".rz-mis-fill", R.play); R.misBar = q(".rz-mis-bar", R.play);
  R.misDone = q(".rz-mis-done", R.play); R.misCheck = q(".rz-mis-done .rz-check path", R.play); R.misStarsDone = q(".rz-stars-done", R.play);
  R.enPill = q(".rz-en", R.play); R.enBody = q(".rz-en .rz-pill-body", R.play); R.enIco = q(".rz-en-ico", R.play); R.enN = q(".rz-en-n", R.play);
  R.streak = q(".rz-streak", R.play); R.streakN = q(".rz-streak-n", R.play);
  R.pct = q(".rz-pct", R.play); R.pctN = q(".rz-pct-n", R.play);
  R.combo = q(".rz-combo", R.play); R.comboIn = q(".rz-combo-in", R.play); R.comboX = q(".rz-combo-x span", R.play);
  R.ringFill = q(".rz-ring-fill", R.play); R.wave = q(".rz-wave", R.play);
  R.swarm = q(".rz-swarm", R.play); R.swarmFill = q(".rz-swarm-fill", R.play);
  R.tl = q(".rz-tl", R.play); R.tr = q(".rz-tr", R.play);

  // ---------- ТИТУЛ ----------
  R.title = h(`<div class="rz-scr rz-title" hidden>
    <div class="rz-scrim-t"></div><div class="rz-scrim-b"></div>
    <div class="rz-title-tap rz-hit" data-act="start"></div>
    <div class="rz-logo"><div class="rz-logo-in">
      <div class="rz-logo-row"><span class="rz-word"><span class="b">РИЗИ</span><span class="f">РИЗИ</span></span><span class="rz-run">RUN</span></div>
      <div class="rz-sub">${snowflakeSVG}<span>Снежная Река</span>${snowflakeSVG}</div>
    </div></div>
    <button class="rz-round rz-hit rz-gear" data-act="settings" aria-label="Настройки">${gearSVG}</button>
    <div class="rz-title-bot">
      <div class="rz-prompt"><div class="rz-prompt-hand">${handSVG}</div><span>Нажми, чтобы бежать!</span></div>
      <div class="rz-chips">
        <div class="rz-chip">${trophySVG}<span>Рекорд</span><b class="rz-t-best"></b><span>м</span></div>
        <div class="rz-chip rz-chip-stars">${starSVG(true)}<span>Звёзды:</span><b class="rz-t-stars"></b></div>
      </div>
      ${touch ? "" : `<div class="rz-keys">Пробел — старт · ← → полоса · ↑ прыжок · ↓ подкат · Esc пауза</div>`}
    </div>
  </div>`);
  root.appendChild(R.title);
  R.logo = q(".rz-logo", R.title); R.prompt = q(".rz-prompt", R.title); R.titleBot = q(".rz-title-bot", R.title);
  R.tBest = q(".rz-t-best", R.title); R.tStars = q(".rz-t-stars", R.title); R.gear = q(".rz-gear", R.title);

  // ---------- ПАУЗА ----------
  R.pause = h(`<div class="rz-scr rz-pause" hidden>
    <div class="rz-shade"></div>
    <div class="rz-center"><div class="rz-card rz-pause-card">
      <div class="rz-card-head"><div><span>Пауза</span></div></div>
      <button class="rz-btn main" data-act="resume">${playSVG}<span>Продолжить</span></button>
      <div class="rz-vol">
        <label for="rzVolM">Музыка</label><input id="rzVolM" class="rz-range" type="range" min="0" max="100" value="70" data-vol="music">
        <label for="rzVolS">Звуки</label><input id="rzVolS" class="rz-range" type="range" min="0" max="100" value="80" data-vol="sfx">
      </div>
      <div class="rz-row-btns">
        <button class="rz-btn ghost" data-act="tutorial">Обучение</button>
        <button class="rz-btn ghost" data-act="menu">В меню</button>
      </div>
    </div></div>
  </div>`);
  root.appendChild(R.pause);
  R.pauseShade = q(".rz-shade", R.pause); R.pauseCard = q(".rz-card", R.pause); R.resumeBtn = q("[data-act=resume]", R.pause);
  R.volM = q("[data-vol=music]", R.pause); R.volS = q("[data-vol=sfx]", R.pause);

  // ---------- РЕЗУЛЬТАТЫ ----------
  R.results = h(`<div class="rz-scr rz-results" hidden>
    <div class="rz-shade"></div>
    <div class="rz-center"><div class="rz-card rz-res-card">
      <div class="rz-card-head"><div><span class="rz-res-head">Рой догнал!</span></div></div>
      <div class="rz-stamp"><div><span>НОВЫЙ РЕКОРД!</span></div></div>
      <div class="rz-rrow r-dist"><div class="ico" style="color:#0536D4">${snowflakeSVG}</div><div class="lbl">Сегодня</div><div class="val"><span class="n"></span><small>м</small></div></div>
      <div class="rz-rrow r-en"><div class="ico">${gemSVG()}</div><div class="lbl">Энергоны</div><div class="val"><span class="n"></span></div></div>
      <div class="rz-rrow r-bonus"><div class="ico">${starSVG(true)}</div><div class="lbl">Бонус ловкости</div><div class="val"><small>+</small><span class="n"></span><small>м</small></div></div>
      <div class="rz-rrow total"><div class="ico">${trophySVG}</div><div class="lbl">Итог</div><div class="val"><span class="n"></span><small>м</small></div></div>
      <div class="rz-best-line"><span>Рекорд: <b class="rz-r-best"></b> м</span><span class="hint"></span></div>
      <div class="rz-quip"><div class="ava">К</div><p></p></div>
      <div class="rz-mlist"></div>
      <div class="rz-res-btns">
        <button class="rz-btn main" data-act="restart">${retrySVG}<span>Ещё раз!</span></button>
        <button class="rz-btn ghost" data-act="menu">Меню</button>
      </div>
      <div class="rz-streakchip" hidden></div>
    </div></div>
  </div>`);
  root.appendChild(R.results);
  const rs = R.results;
  R.resShade = q(".rz-shade", rs); R.resCenter = q(".rz-center", rs); R.resCard = q(".rz-card", rs);
  R.resHead = q(".rz-res-head", rs); R.resHeadBox = q(".rz-card-head > div", rs); R.stamp = q(".rz-stamp", rs);
  R.rDist = q(".r-dist", rs); R.rEn = q(".r-en", rs); R.rBonus = q(".r-bonus", rs); R.rTotal = q(".total", rs);
  R.rDistN = q(".r-dist .n", rs); R.rEnN = q(".r-en .n", rs); R.rBonusN = q(".r-bonus .n", rs); R.rTotalN = q(".total .n", rs);
  R.bestLine = q(".rz-best-line", rs); R.rBest = q(".rz-r-best", rs); R.hint = q(".rz-best-line .hint", rs);
  R.quip = q(".rz-quip", rs); R.quipAva = q(".rz-quip .ava", rs); R.quipP = q(".rz-quip p", rs);
  R.mlist = q(".rz-mlist", rs); R.resBtns = q(".rz-res-btns", rs); R.restartBtn = q("[data-act=restart]", rs);
  R.streakChip = q(".rz-streakchip", rs);

  // ---------- СЛОЙ ЭФФЕКТОВ (поверх всех экранов) ----------
  R.fx = h(`<div class="rz-fx">
    <div class="rz-banner"><div></div></div>
    <div class="rz-toast"><div>${trophySVG}<span></span></div></div>
    <div class="rz-cd"><span></span></div>
    <div class="rz-tut" hidden>
      <div class="rz-tut-zone"><div class="rz-tut-trail"></div><div class="rz-tut-dot"></div><div class="rz-tut-hand">${handSVG}</div></div>
      <div class="rz-tut-card"><div><span class="rz-tut-keys"></span><span class="rz-tut-txt"></span></div></div>
    </div>
  </div>`);
  root.appendChild(R.fx);
  R.banner = q(".rz-banner", R.fx); R.bannerTxt = q(".rz-banner > div", R.fx);
  R.toast = q(".rz-toast", R.fx); R.toastTxt = q(".rz-toast span", R.fx);
  R.cd = q(".rz-cd", R.fx); R.cdTxt = q(".rz-cd > span", R.fx);
  R.tut = q(".rz-tut", R.fx); R.tutZone = q(".rz-tut-zone", R.fx); R.tutTrail = q(".rz-tut-trail", R.fx);
  R.tutDot = q(".rz-tut-dot", R.fx); R.tutHand = q(".rz-tut-hand", R.fx); R.tutKeys = q(".rz-tut-keys", R.fx); R.tutTxt = q(".rz-tut-txt", R.fx);
  R.tutCard = q(".rz-tut-card > div", R.fx);

  // пулы: 10 меток и 3 летящих энергона
  R.labels = []; R.labelSpans = [];
  for (let i = 0; i < 10; i++) {
    const l = h(`<div class="rz-lbl"><span></span></div>`);
    R.fx.appendChild(l); R.labels.push(l); R.labelSpans.push(l.firstElementChild);
  }
  R.flies = [];
  for (let i = 0; i < 3; i++) {
    const f = h(`<div class="rz-fly">${gemSVG()}</div>`);
    R.fx.appendChild(f); R.flies.push(f);
  }
  R.starSVG = starSVG;
  return R;
}
