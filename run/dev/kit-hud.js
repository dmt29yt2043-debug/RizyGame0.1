// Стенд HUD-кита поверх стоп-кадра игры.
// По умолчанию: симулирует t=1600 мс шагом 1/60 и замораживает кадр (document.title = "SHOT_READY").
// ?live=1 — живой режим в реальном времени (без SHOT_READY).
// ?screen=title|play|pause|results|revive|settings|none  ?t=мс
// ?combo=3:0.5  ?danger=0..1  ?fx=1 (метки/полёт/серия прямо перед кадром)  ?mission=on|intro|step|done|off  ?n=6
// ?record=1  ?tut=lane|left|right|up|down|tap  ?praise=1  ?cd=3|2|1|0  ?go=1  ?milestone=250  ?banner=текст  ?toast=1
// ?rm=1  ?q=low|med|high  ?notch=1 (safe-area 47/34 px)  ?touch=0|1  ?icon=rt (3D-иконка через three)
// ?stress=1 (60 с событий — утечки/счётчики)  ?selftest=1 (проверки ввода/блокировок/склонений → window.DEV.selftest)
import { createHUD } from "../src/ui/hud.js";
import { pluralRu, formatTemplate } from "../src/ui/text.js";
import { MISSION_POOL } from "../src/ui/progress.js";

const qp = new URLSearchParams(location.search);
const num = (k, d) => (qp.has(k) ? +qp.get(k) : d);
const SCREEN = qp.get("screen") || "play";
const LIVE = qp.get("live") === "1";
const T = LIVE ? null : num("t", 1600);
const W = innerWidth, H = innerHeight;

const bg = document.getElementById("bg");
bg.src = W / H < 0.9 ? "./kit-hud-bg-port.png" : "./kit-hud-bg-land.png";
const stage = document.getElementById("stage");
if (qp.get("notch") === "1") document.getElementById("notch").style.display = "block";

const ctx = { quality: qp.get("q") || "med", qp };
const hud = createHUD(ctx, {
  container: stage, persist: false, edges: true,
  reducedMotion: qp.get("rm") === "1" ? true : qp.get("rm") === "0" ? false : undefined,
  touch: qp.has("touch") ? qp.get("touch") === "1" : undefined,
});
if (qp.get("notch") === "1") { hud.root.style.setProperty("--sa-t", "47px"); hud.root.style.setProperty("--sa-b", "34px"); }
window.HUD = hud;
const log = [];
let simT = 0;
for (const e of ["start", "pause", "resume", "menu", "restart", "settings", "settings:change", "settings:close", "tutorial", "tutorial:skip", "volume",
  "tick", "ding", "stamp", "confetti", "combo:tier", "mission:complete", "countdown", "go", "results:ready", "revive:ready", "revive:answer"])
  hud.on(e, p => log.push([Math.round(simT), e, p && typeof p === "object" ? JSON.stringify(p) : p]));
window.DEV = { log };

// ---------- сценарий: список [мс, fn] ----------
const ev = [];
const at = (ms, fn) => ev.push([Math.max(0, ms), fn]);
const tEnd = T != null ? T : 999999;
const tAt = ms => (T != null ? T - ms : 1500);            // «за ms до кадра» (в живом режиме — на 1.5 с)
const [cTier, cProg] = (qp.get("combo") || "3:0.6").split(":").map(Number);
const dist0 = num("dist", 186), en0 = num("en", 37);
const MIS = "Перепрыгни {n} {валик|валика|валиков}";

if (SCREEN === "play" || SCREEN === "pause" || SCREEN === "revive") {
  at(0, () => {
    hud.show("play"); hud.setBest(num("best", 412));
    hud.setEnergons(en0, { instant: true });
    hud.setDanger(num("danger", 0));
    const mis = qp.get("mission") || "on";
    if (mis !== "off") hud.setMission(MIS, 0.25, { n: num("n", 6), stars: 1, intro: mis === "intro" });
    if (cTier > 1 || cProg > 0) { hud.setCombo(Math.max(1, cTier - 1), 0.9); hud.setCombo(cTier, cProg); }
  });
  // дистанция растёт 18 м/с — число «живое» на любом t
  for (let ms = 0; ms <= Math.min(tEnd, 60000); ms += 50) at(ms, () => hud.setDistance(dist0 + ms * 0.018));
  if (qp.get("fx") === "1") {
    // серия из 8 монет, 5-я летит в счётчик, +10 за дугу и «ЛОВКО!»
    let n = en0;
    for (let i = 0; i < 8; i++) at(tAt(1150) + i * 110, () => { hud.setEnergons(++n); if (i === 4) hud.flyToCounter(W * 0.52, H * 0.62); });
    at(tAt(360), () => hud.popLabel("+10", "plus", W * 0.58, H * 0.46));
    at(tAt(260), () => hud.popLabel("ЛОВКО!", "nice"));
    if (cTier > 1) at(tAt(180), () => hud.setCombo(cTier + 1, 0.1));
  }
  if (qp.get("mission") === "step") at(tAt(90), () => hud.setMission(MIS, 0.5, { n: num("n", 6) - 1, stars: 1 }));
  if (qp.get("mission") === "done") at(tAt(700), () => hud.missionComplete({ stars: 2, next: { tpl: "Проскользни под {n} {гирляндой|гирляндами|гирляндами}", n: 5, stars: 2 } }));
  if (qp.has("milestone")) at(tAt(420), () => hud.milestone(num("milestone", 250)));
  if (qp.has("banner")) at(tAt(420), () => hud.banner(qp.get("banner")));
  if (qp.get("toast") === "1") at(tAt(500), () => hud.toast("Новый рекорд!"));
  if (qp.has("cd")) at(tAt(250), () => hud.countdown(num("cd", 3)));
  if (qp.get("go") === "1") at(tAt(260), () => hud.go());
  if (qp.has("tut")) at(0, () => hud.tutorial({ gesture: qp.get("tut"), skip: true }));
  if (qp.get("praise") === "1") at(tAt(300), () => hud.tutorialPraise());
  if (SCREEN === "pause") at(200, () => hud.show("pause"));
  if (SCREEN === "revive") at(200, () => hud.revive({ cost: num("cost", 100), have: en0 }).then(a => log.push([Math.round(simT), "revive→", a])));
}
if (SCREEN === "title" || SCREEN === "settings") {
  at(0, () => { hud.show("title"); hud.setBest(num("best", 1234)); hud.setStars(num("stars", 14)); });
  if (SCREEN === "settings") at(300, () => hud.openSettings());
}
if (SCREEN === "results") {
  const record = qp.get("record") === "1";
  at(0, () => {
    hud.setBest(num("best", record ? 402 : 612));
    hud.results({
      dist: num("dist", 486), energons: num("en", 57), bonus: num("bonus", 64), isBest: record,
      best: num("best", record ? 402 : 612), streak: num("streak", 3),
      quip: "«Статистика занесена в журнал миссии», — вздыхает Куби.", speaker: "Куби",
      tip: qp.get("tip") === "1" ? "Гирлянду — подкатом: свайп вниз / ↓" : null,
      missions: [{ text: formatTemplate(MISSION_POOL[0].tpl, 8), done: true }], nextMission: formatTemplate(MISSION_POOL[1].tpl, 5),
    }).then(a => log.push([Math.round(simT), "resolved", a]));
  });
  if (qp.has("presskey")) at(num("presskey", 500), () => dispatchEvent(new KeyboardEvent("keydown", { code: "Space", key: " ", bubbles: true })));
}
if (SCREEN === "none") at(0, () => hud.show("none"));
if (qp.get("stress") === "1") {
  // 60 с событий: каждые 120 мс монета, 900 мс метка, 3 с тир комбо, 5 с рубеж
  let n = en0;
  for (let ms = 0; ms < 60000; ms += 120) at(ms, () => { hud.setEnergons(++n); if (n % 5 === 0) hud.flyToCounter(W * 0.5, H * 0.6); });
  for (let ms = 0; ms < 60000; ms += 900) at(ms, () => hud.popLabel("ЛОВКО!", "nice"));
  for (let ms = 0; ms < 60000; ms += 3000) at(ms, () => hud.setCombo(1 + ((ms / 3000) % 5), 0.3));
  for (let ms = 0; ms < 60000; ms += 5000) at(ms, () => hud.milestone(250 + ms / 20));
}
ev.sort((a, b) => a[0] - b[0]);

// ---------- 3D-иконка энергона (необязательно) ----------
async function maybeIcon() {
  if (qp.get("icon") !== "rt") return;
  try {
    const THREE = await import("three");
    const { renderEnergonIcon } = await import("../src/ui/energon-icon.js");
    const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
    renderer.setSize(8, 8);
    renderer.info.reset();
    const url = renderEnergonIcon(renderer, { size: 128 });
    window.DEV.iconCalls = renderer.info.render.calls;
    window.DEV.iconURL = url.length;
    hud.setEnergonIcon(url);
    await new Promise(r => { const im = new Image(); im.onload = im.onerror = r; im.src = url; });
  } catch (e) { console.warn("[kit-hud] icon=rt не удалось:", e.message); }
}

let ei = 0;
function runTo(ms) {
  while (simT < ms) {
    while (ei < ev.length && ev[ei][0] <= simT) ev[ei++][1]();
    const d = Math.min(1000 / 60, ms - simT) || 1000 / 60;
    hud.update(d / 1000);
    simT += d;
  }
  while (ei < ev.length && ev[ei][0] <= simT) ev[ei++][1]();
}
const frames = (n) => { for (let i = 0; i < n; i++) { hud.update(1 / 60); simT += 1000 / 60; } };

// ---------- самопроверка: реальные DOM-события по кнопкам и клавишам ----------
async function selftest() {
  const R = hud._debug.R, res = {};
  const got = [];
  const offs = ["pause", "resume", "restart", "menu", "revive:answer", "settings:change"].map(e => hud.on(e, p => got.push(e + (typeof p === "string" ? ":" + p : ""))));
  const winHits = [];                                      // что дошло бы до слушателей main на window
  const spy = e => winHits.push(e.type + ":" + (e.code || ""));
  for (const t of ["pointerdown", "click", "touchend", "keydown"]) addEventListener(t, spy);
  const key = (code, target = document.body) => target.dispatchEvent(new KeyboardEvent("keydown", { code, key: code === "Space" ? " " : code, bubbles: true, cancelable: true }));
  const tap = el => { el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse" })); el.click(); };

  // 1) склонения
  const P = n => `${n} ${pluralRu(n, "валик", "валика", "валиков")}`;
  res.plural = [1, 2, 5, 11, 21, 22, 25, 111, 104].map(P).join(", ");
  res.pluralOk = res.plural === "1 валик, 2 валика, 5 валиков, 11 валиков, 21 валик, 22 валика, 25 валиков, 111 валиков, 104 валика";
  res.pool = MISSION_POOL.map(m => [1, 3, m.goal].map(n => formatTemplate(m.tpl, n)).join(" / "));

  // 2) кнопка паузы в игре: событие HUD есть, до window не всплыло
  hud.show("play"); frames(2);
  got.length = 0; winHits.length = 0;
  tap(R.pauseBtn);
  res.pauseBtn = { hud: got.slice(), window: winHits.slice() };
  // Esc в игре → pause
  got.length = 0; key("Escape"); res.escInPlay = got.slice();

  // 3) пауза: Space не доходит до main, возобновляет
  hud.show("pause"); frames(20);
  got.length = 0; winHits.length = 0;
  key("ArrowLeft"); key("Space");
  res.pauseKeys = { hud: got.slice(), window: winHits.slice() };
  got.length = 0; tap(R.pause.querySelector(".rz-shade")); res.pauseShadeTap = { hud: got.slice(), window: winHits.filter(s => !s.startsWith("keydown")) };

  // 4) отсчёт: после окончания цифра скрыта
  hud.show("play");
  hud.countdown(2); frames(12); res.cdMid = +getComputedStyle(R.cdTxt).opacity;
  frames(40); res.cdAfter = +getComputedStyle(R.cdTxt).opacity;
  hud.go(); frames(60); res.goAfter = +getComputedStyle(R.cdTxt).opacity;

  // 5) результаты: 1 с блокировки
  got.length = 0; winHits.length = 0;
  let answer = null;
  hud.results({ dist: 300, energons: 20, bonus: 5 }).then(a => { answer = a; });
  frames(30);                                               // 0.5 с
  key("Space"); tap(R.results.querySelector(".rz-shade")); tap(R.restartBtn);
  res.lock500 = { locked: hud.locked, hud: got.slice(), window: winHits.slice() };
  frames(33);                                               // ~1.05 с
  tap(R.results.querySelector(".rz-shade"));
  res.shadeAfterLock = got.slice();
  res.unlockedAt1050 = !hud.locked;
  key("Space");
  await Promise.resolve();
  res.restartAfterLock = { hud: got.slice(), answer, window: winHits.slice() };

  // 6) revive: кнопки активны через 0.6 с, таймаут 4 с
  let rv = null;
  hud.show("play"); hud.revive({ cost: 50, have: 80 }).then(a => { rv = a; });
  frames(20); tap(R.revBtn); await Promise.resolve(); res.revive300 = rv;
  frames(20); tap(R.revBtn); await Promise.resolve(); res.revive660 = rv;
  hud.show("play"); hud.revive({ cost: 50 }).then(a => { rv = a; }); frames(250); await Promise.resolve(); res.reviveTimeout = rv;

  // 7) настройки: тумблеры и сегмент reduced motion
  hud.show("title"); frames(5); tap(R.gear); frames(15);
  res.settingsOpen = hud.settingsOpen;
  got.length = 0;
  tap(R.settings.querySelector('[data-set="calm"]')); tap(R.settings.querySelector('[data-rm="on"]'));
  res.settings = { calm: hud.settings.calm, rmSetting: hud.settings.reducedMotion, rmActive: hud.reducedMotion, events: got.length };
  key("Escape"); res.settingsClosedByEsc = !hud.settingsOpen;
  hud.setReducedMotion(null);

  // 8) шрифт: кириллица и латиница реально Nunito
  const faces = [...document.fonts].filter(f => f.family.replace(/"/g, "") === "RizyNunito");
  res.fontFaces = faces.map(f => f.status);
  res.fontCheck = document.fonts.check('900 20px "RizyNunito"', "ЖжЁё") && document.fonts.check('800 18px "RizyNunito"', "Rizy 0123");
  const cv = document.createElement("canvas").getContext("2d");
  cv.font = '900 40px "RizyNunito", monospace'; const a = cv.measureText("Перепрыгни валиков").width;
  cv.font = "900 40px monospace"; const b = cv.measureText("Перепрыгни валиков").width;
  res.fontCyrWidth = [Math.round(a), Math.round(b)];
  // табличные цифры: ширина «111111» = «888888»
  const m1 = document.createElement("span"), m8 = document.createElement("span");
  m1.style.cssText = m8.style.cssText = "position:absolute;visibility:hidden;font:900 30px RizyNunito;font-variant-numeric:tabular-nums";
  m1.textContent = "111111"; m8.textContent = "888888"; hud.root.append(m1, m8);
  res.tabular = [m1.getBoundingClientRect().width, m8.getBoundingClientRect().width].map(Math.round);
  m1.remove(); m8.remove();

  for (const t of ["pointerdown", "click", "touchend", "keydown"]) removeEventListener(t, spy);
  offs.forEach(f => f());
  res.anims = hud._debug.clock.count;
  const ok = res.pluralOk && res.pauseBtn.hud.includes("pause") && res.pauseBtn.window.length === 0 && res.escInPlay.includes("pause")
    && res.pauseKeys.hud.includes("resume") && res.pauseKeys.window.length === 0 && res.pauseShadeTap.window.length === 0
    && res.cdMid > 0.5 && res.cdAfter === 0 && res.goAfter === 0
    && res.lock500.locked && res.lock500.hud.length === 0 && res.lock500.window.length === 0
    && res.shadeAfterLock.length === 0 && res.unlockedAt1050 && res.restartAfterLock.answer === "restart" && res.restartAfterLock.window.length === 0
    && res.revive300 === null && res.revive660 === "revive" && res.reviveTimeout === "timeout"
    && res.settingsOpen && res.settings.calm === true && res.settings.rmActive === true && res.settingsClosedByEsc
    && res.fontCheck && res.tabular[0] === res.tabular[1];
  res.ok = ok;
  window.DEV.selftest = res;
}

await hud.ready;
await maybeIcon();
if (qp.get("selftest") === "1") {
  await selftest();
  document.title = "SHOT_READY";
} else if (T != null) {
  const t0 = performance.now();
  runTo(T);
  window.DEV.simMs = Math.round(performance.now() - t0);
  window.DEV.anims = hud._debug.clock.count;
  window.DEV.domAnims = document.getAnimations().length;
  requestAnimationFrame(() => requestAnimationFrame(() => { document.title = "SHOT_READY"; }));
} else {
  // живой режим: реальное время
  let last = performance.now();
  const loop = now => {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    const target = simT + dt * 1000;
    while (ei < ev.length && ev[ei][0] <= target) ev[ei++][1]();
    hud.update(dt); simT = target;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  document.title = "kit-hud live";
}
