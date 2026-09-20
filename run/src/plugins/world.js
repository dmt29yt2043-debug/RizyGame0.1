// АДАПТЕР мира: ставит кит src/world («Снежная Река» 2026) вместо базовой трассы.
// Кит сам держит небо, туман, жёлоб трассы, трёхслойный декор, фонари, сет-пьесы, реку,
// а также визуал препятствий и энергонов (пул). Адаптер связывает события main ↔ вызовы кита.
import { createWorldKit } from "../world/index.js";

export default {
  name: "world",
  install(ctx){
    const { G, bus } = ctx;
    const kit = createWorldKit(ctx, {
      reducedMotion: !!G.reducedMotion,
      // события кита (сет-пьесы, тоннель, ориентиры) уходят в общую шину; milestone остаётся за main
      onEvent: (name, payload) => {
        if (!name || name === "milestone") return;
        try { bus.emit(name, payload); } catch(e){ console.error("[world] emit " + name, e); }
      },
    });
    ctx.scene.add(kit.root);
    if (ctx.look && typeof ctx.look.patch === "function") ctx.look.patch(kit.root);

    bus.on("spawn:obstacle", e => {
      try { e.object3d = kit.makeObstacle(e); } catch(err){ console.error("[world] makeObstacle", err); }
    });
    bus.on("spawn:coin", e => {
      try { e.object3d = kit.makeCoin(e); } catch(err){ console.error("[world] makeCoin", err); }
    });
    bus.on("despawn", e => {
      if (e && e.object3d){ try { kit.release(e.object3d); } catch(err){} e.object3d = null; }
    });
    bus.on("start", () => { try { kit.setBest(G.best || 0); } catch(e){} });
    bus.on("settings", () => { try { kit.setReducedMotion(!!G.reducedMotion); } catch(e){} });

    function update(realDt, pctx, simDt){
      kit.update(simDt == null ? realDt : simDt, realDt, G);
      if (typeof kit.applyLights === "function") kit.applyLights(ctx.lights);
    }
    // curveReady: мир умеет изогнутый мир (шейдеры кита включают curve_pars_vertex)
    return {
      handles: { curve: true }, curveReady: true, kit, update,
      dispose(){ try { kit.dispose(); } catch(e){} },
    };
  },
};
