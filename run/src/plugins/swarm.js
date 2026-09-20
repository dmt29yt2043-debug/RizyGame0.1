// АДАПТЕР роя: пушистые Гасители из кита src/actors/swarm вместо базовых кубиков.
import { createSwarm } from "../actors/swarm/swarm.js";

const readSettings = () => { try { return JSON.parse(localStorage.getItem("rizyrun_settings") || "{}") || {}; } catch(e){ return {}; } };

export default {
  name: "swarm",
  install(ctx){
    const { G, bus, cfg } = ctx;
    const st = readSettings();
    let rm = st.reducedMotion != null ? !!st.reducedMotion : !!G.reducedMotion;
    try { rm = rm || matchMedia("(prefers-reduced-motion: reduce)").matches; } catch(e){}
    const sw = createSwarm({ camera: ctx.camera, quality: ctx.quality, look: ctx.look, scene: ctx.scene, reducedMotion: rm },
                           { trackHalfWidth: 3.9, groundY: 0 });
    ctx.scene.add(sw.root);
    if (ctx.look && typeof ctx.look.patch === "function") ctx.look.patch(sw.root);

    const S = { mode:"title", near:false, danger:0, playerX:0, playerY:0, playerZ:0, speedI:0 };
    const call = (n, a) => { try { if (typeof sw[n] === "function") sw[n](a); } catch(e){ console.error("[swarm] " + n, e); } };

    bus.on("gameover", () => call("catch", { x:G.x, y:G.py, z:0 }));
    bus.on("start", () => call("release"));
    bus.on("title", () => call("reset"));
    bus.on("swarm:far", () => call("far"));
    bus.on("revive", () => call("revive", { x:G.x, y:G.py, z:0 }));
    bus.on("settings", () => call("setReducedMotion", !!G.reducedMotion));

    function update(realDt, pctx, simDt){
      S.mode = G.mode;
      S.near = G.swarmNear > 0;
      S.danger = G.danger != null ? G.danger : Math.max(0, Math.min(1, G.swarmNear / ((cfg && cfg.swarmTime) || 5.5)));
      S.playerX = G.x; S.playerY = G.py; S.playerZ = 0;
      S.speedI = G.intensity != null ? G.intensity : 0;
      try { sw.update(realDt, simDt == null ? realDt : simDt, S); } catch(e){ console.error("[swarm] update", e); }
    }
    return { update, dispose(){ try { sw.dispose(); } catch(e){} } };
  },
};
