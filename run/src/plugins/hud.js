// АДАПТЕР интерфейса: HUD-кит src/ui (пилюли, миссии, комбо, карточки, кошелёк, магазин, ускорители) вместо базового DOM из index.html.
import { createHUD } from "../ui/hud.js";
import { createMissions, recordDaily } from "../ui/progress.js";
import { POWER } from "../ui/text.js";

const LEGACY = ["score", "energons", "swarm", "title", "over"];

export default {
  name: "hud",
  async install(ctx){
    const { G, bus, cfg, qp } = ctx;
    const $ = id => document.getElementById(id);
    const prev = {};
    for (const id of LEGACY){ const el = $(id); if (el){ prev[id] = el.style.display; el.style.display = "none"; } }

    let hud = null;
    try {
      hud = createHUD(ctx, {
        container: $("wrap"),
        milestoneStep: (cfg && cfg.milestoneStep) || 250,
        edges: !(ctx.look && ctx.look.post),   // если пост рисует виньетку — HUD свою не дублирует
        shop: cfg && cfg.power ? { prices: cfg.power.prices, dur: cfg.power.dur } : undefined,
      });
      await Promise.race([hud.ready, new Promise(r => setTimeout(r, 2000))]);
    } catch (e){
      for (const id of LEGACY){ const el = $(id); if (el) el.style.display = prev[id] || ""; }
      try { hud && hud.dispose && hud.dispose(); } catch(_){}
      throw e;                                  // загрузчик откатится на base/hud.js
    }

    const has = n => hud && typeof hud[n] === "function";
    const call = (n, a, b, c) => { if (has(n)){ try { return hud[n](a, b, c); } catch(e){ console.error("[hud] " + n, e); } } };
    const act = a => { const R = window.RUN; if (R && typeof R.doAction === "function") R.doAction(a); };
    const actions = () => ctx.actions || (window.RUN && window.RUN.actions) || null;

    let missions = null;
    try { missions = createMissions(); } catch(e){}
    try { recordDaily(); } catch(e){}
    call("setBest", G.best || 0);
    if (missions && missions.stars != null) call("setStars", missions.stars);
    call("setWallet", G.wallet || 0);
    call("setUpgrades", G.upgrades);
    try { if (hud.settings) bus.emit("settings", hud.settings); } catch(e){}

    // кнопки HUD → действия игры
    if (has("on")){
      const map = { start:"ENTER", restart:"ENTER", again:"ENTER", play:"ENTER", resume:"ESC", pause:"ESC", title:"ESC", menu:"ESC" };
      for (const k in map){ try { hud.on(k, () => act(map[k])); } catch(e){} }
      // ECON: «Продолжить за N ⬡» и покупки в магазине идут напрямую в actions main
      try { hud.on("continue", () => { const A = actions(); if (A && typeof A.revive === "function") A.revive(); }); } catch(e){}
      try {
        hud.on("buy", kind => {
          const A = actions();
          if (!A || typeof A.buyUpgrade !== "function") return;
          if (A.buyUpgrade(kind)){ call("setUpgrades", G.upgrades); call("shopBought", kind); }
        });
      } catch(e){}
    }

    const tmpV = { x:0, y:0, z:0 }, tmpXY = { x:0, y:0 };
    const missionAdd = (key, n) => {
      if (!missions || typeof missions.add !== "function") return;
      let r = null;
      try { r = missions.add(key, n); } catch(e){ return; }
      if (!r) return;
      const view = typeof missions.view === "function" ? missions.view() : null;
      if (r.completed){
        call("missionComplete", r);
        try { bus.emit("mission:complete", r); } catch(e){}
        if (missions.stars != null) call("setStars", missions.stars);
      } else {
        try { bus.emit("mission:progress", r); } catch(e){}
      }
      if (view) call("setMission", view, view.progress, view);
    };

    // подписи всплывающих меток по виду ускорителя
    const LABEL = {};
    for (const p of POWER) LABEL[p.kind] = p.label;
    const KINDS = (cfg && cfg.power && cfg.power.kinds) || ["magnet", "shield", "boost", "x2"];

    bus.on("title", () => {
      call("show", "title"); call("setBest", G.best || 0);
      if (missions && missions.stars != null) call("setStars", missions.stars);
      call("setWallet", G.wallet || 0); call("setUpgrades", G.upgrades);
      // фоторежим: &shop=1 — открыть карточку «Прокачка» для кадра
      if (qp && qp.has && qp.has("shot") && qp.get("shop") === "1") call("openShop");
    });
    bus.on("start", () => {
      call("show", "play");
      call("setEnergons", 0, { instant:true });
      call("setDistance", 0);
      call("setCombo", 1, 0);
      call("setDanger", 0);
      if (missions && typeof missions.onStart === "function"){ try { missions.onStart(); } catch(e){} }
      if (missions && typeof missions.view === "function"){
        const v = missions.view(); if (v) call("setMission", v, v.progress, v);
      }
      call("go");
    });
    bus.on("pickup", c => {
      call("setEnergons", G.energons, { streak: G.combo });
      if (((G.combo | 0) % 5) === 0 && c && c.object3d && has("projectToHUD") && has("flyToCounter")){
        try {
          const p = c.object3d.position; tmpV.x = p.x; tmpV.y = p.y; tmpV.z = p.z;
          hud.projectToHUD(tmpV, tmpXY); hud.flyToCounter(tmpXY.x, tmpXY.y);
        } catch(e){}
      }
      missionAdd("energons", 1);
    });
    bus.on("nearmiss", () => { call("popLabel", "ЛОВКО!", "nice"); missionAdd("nice", 1); });
    bus.on("despawn", e => {
      if (e && (e.kind === "jump" || e.kind === "slide") && e.passed && !e.touched) missionAdd(e.kind, 1);
    });
    bus.on("combo:tier", n => call("setCombo", n, 0));
    bus.on("milestone", m => call("milestone", m));
    bus.on("hit", () => call("popLabel", "ОЙ!", "warn"));
    bus.on("powerup", p => { if (p && p.on) call("popLabel", LABEL[p.kind] || "БОНУС!", "big"); });
    bus.on("shield:break", () => call("popLabel", "ЩИТ ПРИНЯЛ УДАР", "info"));
    bus.on("wallet", p => { if (p) call("setWallet", p.total); });
    bus.on("upgrade", () => call("setUpgrades", G.upgrades));
    bus.on("gameover", p => {
      const stats = { dist: Math.round(G.dist), energons: G.energons, bonus: G.bonusEnergons, isBest: !!(p && p.isBest), best: G.best,
        wallet: p && p.wallet, revive: p && p.revive };
      if (has("results")) { try { hud.results(stats); } catch(e){ call("show", "results"); } }
      else call("show", "results");
    });
    // «Продолжить»: карточка результатов уходит, отсчёт 3-2-1 рисует HUD (после паузы отсчёт показывает базовый #cd)
    bus.on("revive", () => { call("show", "play"); call("setEnergons", G.energons, { instant:true }); });
    bus.on("countdown", n => { if (hud.screen === "play") call("countdown", n); });
    bus.on("resume", () => { if (hud.screen === "play") call("go"); });
    bus.on("pause", b => call("show", b ? "pause" : "play"));

    function update(realDt){
      call("setDistance", G.dist);
      call("setDanger", G.danger || 0);
      if (G.powers && has("setPowerup")){
        for (let i = 0; i < KINDS.length; i++){
          const k = KINDS[i], t = G.powers[k], d = G.powerDur ? G.powerDur[k] : 0;
          hud.setPowerup(k, t > 0 && d > 0 ? t / d : 0);
        }
      }
      if (has("update")) { try { hud.update(realDt); } catch(e){} }
    }
    return {
      handles: { hud:true, score:true, energons:true, swarm:true, panels:true },
      update,
      dispose(){
        try { hud.dispose(); } catch(e){}
        for (const id of LEGACY){ const el = $(id); if (el) el.style.display = prev[id] || ""; }
      },
    };
  },
};
