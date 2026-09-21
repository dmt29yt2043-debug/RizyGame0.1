// АДАПТЕР звука: процедурный движок src/audio (шины, лимитер, адаптивная музыка) вместо «бипов».
import { createAudio } from "../audio/index.js";

export default {
  name: "audio",
  install(ctx){
    const { G, bus, qp, cfg } = ctx;
    // в фоторежиме и в симуляции звук не нужен
    if ((qp && qp.has && qp.has("shot")) || ctx.simulating) return { update(){}, dispose(){} };

    const audio = createAudio({ quality: ctx.quality });
    const has = n => typeof audio[n] === "function";
    const call = (n, a, b) => { if (has(n)){ try { return audio[n](a, b); } catch(e){ console.error("[audio] " + n, e); } } };
    const play = (n, o) => { if (!ctx.simulating) call("play", n, o); };
    call("prepare");

    let s = {}; try { s = JSON.parse(localStorage.getItem("rizyrun_settings") || "{}") || {}; } catch(e){}
    if (has("setVolume")){
      call("setVolume", "music", s.music != null ? s.music : 0.7);
      const sfx = s.sfx != null ? s.sfx : 0.8;
      call("setVolume", "sfx", sfx); call("setVolume", "ui", sfx); call("setVolume", "amb", sfx);
    }
    if (s.muted) call("setMuted", true);
    if (has("setHaptics")) call("setHaptics", s.vibration !== false && s.vibro !== false);

    const onGesture = () => { call("unlock"); };
    addEventListener("pointerdown", onGesture, { capture:true, passive:true });
    addEventListener("keydown", onGesture, { capture:true, passive:true });

    bus.on("title", () => call("setMode", "title"));
    bus.on("start", () => { call("startRun", 0); play("start"); });
    bus.on("countdown", n => play("count", { n }));
    bus.on("lane", p => { if (p && p.from === p.to) play("edge", { dir: p.dir }); else play("lane", { dir: p && p.dir }); });
    bus.on("edgebump", p => play("edge", { dir: p && p.dir }));
    bus.on("jump", () => play("jump"));
    bus.on("dive", () => play("dive"));
    bus.on("land", p => play("land", { impact: p && p.impact }));
    bus.on("slide", () => play("slide", { dur: G.sliding || (cfg && cfg.slideTime) || 0.6 }));
    bus.on("pickup", c => play("energon", { lane: c && c.lane }));
    bus.on("nearmiss", o => {
      const lanes = (o && o.lanes) || [G.lane];
      play("nearmiss", { dir: Math.sign(lanes[0] - G.lane) || 1 });
    });
    bus.on("hit", () => play("hit"));
    // ускорители: подбор (тон по виду), окончание, щит принял удар
    bus.on("powerup", p => { if (!p) return; if (p.on) play("powerup", { kind: p.kind }); else if (p.dur < 0) play("shield"); else play("powerdown", { kind: p.kind }); });
    bus.on("upgrade", () => play("mission"));
    bus.on("revive", () => { call("setPaused", false); play("start"); });
    bus.on("gameover", p => { play("gameover"); if (p && p.isBest) play("record", { delay: 1.4 }); });
    bus.on("milestone", () => play("milestone"));
    bus.on("combo:tier", n => play("tier", { tier: n }));
    bus.on("mission:complete", () => play("mission"));
    bus.on("mission:progress", () => play("tick", { i: 3 }));
    bus.on("swarm:far", () => play("relief"));
    bus.on("tunnel:enter", () => call("setTunnel", true));
    bus.on("tunnel:exit", () => call("setTunnel", false));
    bus.on("pause", b => call("setPaused", !!b));
    bus.on("settings", st => {
      if (!st || !has("setVolume")) return;
      if (st.music != null) call("setVolume", "music", st.music);
      if (st.sfx != null){ call("setVolume", "sfx", st.sfx); call("setVolume", "ui", st.sfx); call("setVolume", "amb", st.sfx); }
      if (st.muted != null) call("setMuted", !!st.muted);
    });

    function update(realDt){
      if (ctx.simulating) return;
      call("setIntensity", G.intensity != null ? G.intensity : 0);
      call("setDanger", G.danger || 0);
      call("setDistance", G.dist);
      call("setSwarmNear", G.swarmNear || 0);
      if (has("setRunner")) { try { audio.setRunner(G.runPhase || 0, G.py <= 0.02, G.sliding > 0); } catch(e){} }
      call("update", realDt);
    }
    return {
      update,
      dispose(){
        removeEventListener("pointerdown", onGesture, { capture:true });
        removeEventListener("keydown", onGesture, { capture:true });
        try { audio.dispose(); } catch(e){}
      },
    };
  },
};
