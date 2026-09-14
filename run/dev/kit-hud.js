// Стенд HUD-кита поверх стоп-кадра игры.
// ?screen=title|play|pause|results|none  ?t=мс — симулировать t мс шагом 1/60 и заморозить (SHOT_READY)
// ?combo=3:0.5  ?danger=0..1  ?fx=1 (метки/полёт/серия прямо перед кадром)  ?mission=intro|step|done|off
// ?record=1  ?tut=left|right|up|down|tap  ?cd=3|2|1|0  ?milestone=250  ?toast=1  ?rm=1  ?q=low|med|high
// ?notch=1 (safe-area 47 px)  ?icon=rt (3D-иконка через three)  ?stress=1 (60 с событий — утечки/счётчики)
import { createHUD } from "../src/ui/hud.js";

const qp = new URLSearchParams(location.search);
const num = (k, d) => (qp.has(k) ? +qp.get(k) : d);
const SCREEN = qp.get("screen") || "play";
const T = qp.has("t") ? +qp.get("t") : null;
const W = innerWidth, H = innerHeight;

const bg = document.getElementById("bg");
bg.src = W / H < 0.9 ? "./kit-hud-bg-port.png" : "./kit-hud-bg-land.png";
const stage = document.getElementById("stage");
if (qp.get("notch") === "1") {
  document.getElementById("notch").style.display = "block";
}

const ctx = { quality: qp.get("q") || "med", qp };
const hud = createHUD(ctx, { container: stage, reducedMotion: qp.get("rm") === "1", touch: qp.has("touch") ? qp.get("touch") === "1" : undefined });
if (qp.get("notch") === "1") { hud.root.style.setProperty("--sa-t", "47px"); hud.root.style.setProperty("--sa-b", "34px"); }
window.HUD = hud;
const log = [];
for (const e of ["start", "pause", "resume", "menu", "restart", "settings", "tutorial", "volume", "tick", "ding", "stamp", "confetti", "combo:tier", "mission:complete", "countdown", "go", "results:ready"])
  hud.on(e, p => log.push([Math.round(simT), e, typeof p === "object" ? JSON.stringify(p) : p]));
window.DEV = { log };

// ---------- сценарий: список [мс, fn] ----------
const ev = [];
const at = (ms, fn) => ev.push([Math.max(0, ms), fn]);
const tEnd = T != null ? T : 999999;
const [cTier, cProg] = (qp.get("combo") || "3:0.6").split(":").map(Number);
const dist0 = num("dist", 186), en0 = num("en", 37);

if (SCREEN === "play" || SCREEN === "pause") {
  at(0, () => {
    hud.show("play"); hud.setBest(num("best", 412));
    hud.setEnergons(en0, { instant: true });
    hud.setDanger(num("danger", 0));
    const mis = qp.get("mission") || "on";
    if (mis !== "off") hud.setMission("Перепрыгни {n} валиков", 0.25, { n: 6, stars: 1, intro: mis === "intro" });
    if (cTier > 1 || cProg > 0) { hud.setCombo(Math.max(1, cTier - 1), 0.9); hud.setCombo(cTier, cProg); }
  });
  // дистанция растёт 18 м/с — число «живое» на любом t
  for (let ms = 0; ms <= Math.min(tEnd, 60000); ms += 50) at(ms, () => hud.setDistance(dist0 + ms * 0.018));
  if (qp.get("fx") === "1" && T != null) {
    // серия из 8 монет, 5-я летит в счётчик, +10 за дугу и «ЛОВКО!»
    for (let i = 0; i < 8; i++) at(T - 1150 + i * 110, () => {
      hud.setEnergons(hud._en = (hud._en || en0) + 1);
      if (i === 4) hud.flyToCounter(W * 0.52, H * 0.62);
    });
    at(T - 360, () => hud.popLabel("+10", "plus", W * 0.58, H * 0.46));
    at(T - 260, () => hud.popLabel("ЛОВКО!", "nice"));
    if (cTier > 1) at(T - 180, () => hud.setCombo(cTier + 1, 0.1));
  }
  if (qp.get("mission") === "step") at(T - 90, () => hud.setMission("Перепрыгни {n} валиков", 0.5, { n: 5, stars: 1 }));
  if (qp.get("mission") === "done") at(T - 700, () => hud.missionComplete({ stars: 2, next: { text: "Проскользни под {n} гирляндами", n: 5, stars: 2 } }));
  if (qp.has("milestone")) at(T - 420, () => hud.milestone(num("milestone", 250)));
  if (qp.get("toast") === "1") at(T - 500, () => hud.toast("Новый рекорд!"));
  if (qp.has("cd")) at(T - 250, () => hud.countdown(num("cd", 3)));
  if (qp.has("tut")) at(0, () => hud.tutorial(qp.get("tut")));
  if (SCREEN === "pause") at(200, () => hud.show("pause"));
}
if (SCREEN === "title") {
  at(0, () => { hud.show("title"); hud.setBest(num("best", 1234)); hud.setStars(num("stars", 14)); });
}
if (SCREEN === "results") {
  const record = qp.get("record") === "1";
  at(0, () => {
    hud.setBest(num("best", record ? 402 : 612));
    hud.results({
      dist: num("dist", 486), energons: num("en", 57), bonus: num("bonus", 64), isBest: record,
      best: num("best", record ? 402 : 612), streak: num("streak", 3),
      quip: "«Статистика занесена в журнал миссии», — вздыхает Куби.", speaker: "Куби",
      missions: [{ text: "Перепрыгни 8 валиков", done: true }], nextMission: "Проскользни под 5 гирляндами",
    }).then(a => log.push([Math.round(simT), "resolved", a]));
  });
  if (qp.has("presskey")) at(num("presskey", 500), () => dispatchEvent(new KeyboardEvent("keydown", { code: "Space", bubbles: true })));
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
    let env = null;
    try {
      const { createLook } = await import("../src/look/materials.js");
      const look = await createLook({ THREE, renderer, scene: new THREE.Scene(), quality: "med", qp });
      env = look && look.env;
    } catch (e) { console.warn("[kit-hud] look недоступен, иконка без env:", e.message); }
    renderer.info.reset();
    const url = renderEnergonIcon(renderer, { size: 128, env });
    window.DEV.iconCalls = renderer.info.render.calls;
    hud.setEnergonIcon(url);
  } catch (e) { console.warn("[kit-hud] icon=rt не удалось:", e.message); }
}

let simT = 0, ei = 0;
function runTo(ms) {
  while (simT < ms) {
    while (ei < ev.length && ev[ei][0] <= simT) ev[ei++][1]();
    const d = Math.min(1000 / 60, ms - simT) || 1000 / 60;
    hud.update(d / 1000);
    simT += d;
  }
  while (ei < ev.length && ev[ei][0] <= simT) ev[ei++][1]();
}

await hud.ready;
await maybeIcon();
if (T != null) {
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
