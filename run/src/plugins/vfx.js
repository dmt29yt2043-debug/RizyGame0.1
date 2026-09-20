// АДАПТЕР эффектов: GPU-частицы из кита src/fx (мягкие круглые, пул, линии скорости, конфетти).
import { createVFX } from "../fx/vfx.js";

const readSettings = () => { try { return JSON.parse(localStorage.getItem("rizyrun_settings") || "{}") || {}; } catch(e){ return {}; } };

export default {
  name: "vfx",
  install(ctx){
    const { G, bus } = ctx;
    const st = readSettings();
    const vfx = createVFX(ctx, { reducedMotion: st.reducedMotion != null ? !!st.reducedMotion : !!G.reducedMotion });
    ctx.scene.add(vfx.root);
    if (ctx.look && typeof ctx.look.patch === "function") ctx.look.patch(vfx.root);

    // переиспользуемые объекты — ноль аллокаций в кадре
    const P = { x:0, y:0, z:0 };
    const O = { dt:0, dir:1, side:0, impact:1, big:false, delay:0 };
    const at = (x, y, z) => { P.x = x; P.y = y; P.z = z; return P; };
    const emit = (n, p, o) => { try { vfx.emit(n, p, o); } catch(e){ console.error("[vfx] emit " + n, e); } };
    let footPhase = 0, wasAir = false;

    bus.on("jump", () => emit("takeoff", at(G.x, 0, 0)));
    bus.on("dive", () => emit("dive", at(G.x, G.py, 0)));
    bus.on("land", p => {
      const raw = p && p.impact != null ? p.impact : Math.abs(G.vy || 0);
      O.impact = Math.max(0, Math.min(1, raw <= 1 ? raw : raw / 14));
      emit("land", at(G.x, 0, 0), O);
    });
    bus.on("lane", p => { O.dir = (p && p.dir) || 1; emit("lane", at(G.x, G.py + 0.6, 0), O); });
    bus.on("edgebump", p => { O.dir = (p && p.dir) || 1; emit("edgebump", at(G.x, G.py + 0.6, 0), O); });
    bus.on("pickup", c => {
      O.big = ((G.combo | 0) % 5) === 0;
      emit("pickup", c && c.object3d ? c.object3d.position : at(G.x, G.py + 1.2, 0), O);
      O.big = false;
    });
    bus.on("nearmiss", o => {
      const lanes = (o && o.lanes) || [G.lane];
      let c = 0; for (const l of lanes) c += l; c /= lanes.length;
      O.side = Math.sign(c - G.lane) || 1;
      emit("nearmiss", at(G.x, G.py + 1.0, 0), O);
    });
    bus.on("hit", () => emit("hit", at(G.x, G.py + 0.9, 0)));
    bus.on("milestone", () => { emit("milestone", at(G.x, G.py + 1.0, 0)); try { vfx.celebrate("mission"); } catch(e){} });
    bus.on("gameover", p => { if (p && p.isBest){ try { vfx.celebrate("record"); } catch(e){} } });
    bus.on("start", () => { try { vfx.clear(); } catch(e){} });
    bus.on("title", () => { try { vfx.clear(); } catch(e){} });
    bus.on("tunnel:enter", () => { try { vfx.setSpeedLinesHidden(true); } catch(e){} });
    bus.on("tunnel:exit", () => { try { vfx.setSpeedLinesHidden(false); } catch(e){} });
    bus.on("settings", () => { try { vfx.setReducedMotion(!!G.reducedMotion); } catch(e){} });

    function update(realDt, pctx, simDt){
      const sim = simDt == null ? realDt : simDt;
      try { vfx.setIntensity(G.intensity != null ? G.intensity : 0); } catch(e){}
      if (G.mode === "play"){
        const onGround = G.py <= 0.02 && !(G.sliding > 0);
        if (G.sliding > 0){ O.dt = sim; emit("slide", at(G.x, 0, 0), O); }
        else if (onGround){
          // шаги по фазе бега: два касания за цикл
          const ph = (G.runPhase || 0) / Math.PI;
          if (Math.floor(ph) !== footPhase){
            footPhase = Math.floor(ph);
            emit(footPhase % 2 ? "footR" : "footL", at(G.x, 0, 0));
          }
        }
        if (wasAir && onGround) wasAir = false;
        if (G.py > 0.02) wasAir = true;
      }
      try { vfx.update(realDt); } catch(e){ console.error("[vfx] update", e); }
    }
    return { handles: { snow: true }, update, dispose(){ try { vfx.dispose(); } catch(e){} } };
  },
};
