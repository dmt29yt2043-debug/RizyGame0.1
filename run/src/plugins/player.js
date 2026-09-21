// АДАПТЕР игрока: ставит премиальную Ризи из кита src/actors/rizy вместо базовой «коробочной».
// Вся анимация, шарф-лента, пружины пучков и мимика живут в ките; адаптер только передаёт состояние G
// и события шины. Если кит не поднимется — install бросает, и загрузчик откатывается на base/player.js.
import { createRizy } from "../actors/rizy/index.js";

export default {
  name: "player",
  async install(ctx){
    const { G, bus, qp } = ctx;
    const q = qp && qp.get ? qp.get("rizy") : null;
    const rizy = await createRizy(ctx, {
      prefer: q === "glb" || q === "procedural" ? q : "auto",
      reducedMotion: !!G.reducedMotion,
      blobShadow: ctx.quality === "low",
    });
    ctx.scene.add(rizy.root);
    if (ctx.look && typeof ctx.look.patch === "function") ctx.look.patch(rizy.root);

    // одно переиспользуемое состояние — никаких аллокаций в кадре
    const S = { mode:"title", runPhase:0, speedI:0, laneX:0, py:0, vy:0, sliding:0, dive:false,
                grace:0, blinkOn:true, danger:0, celebrate:false };
    const T = (n, p) => { try { rizy.trigger(n, p); } catch(e){ console.error("[player] trigger " + n, e); } };
    let jumps = 0;

    bus.on("lane", p => T("lane", p));
    bus.on("edgebump", p => T("edgebump", p));
    bus.on("jump", () => { jumps++; T("jump", { flip:false }); if ((G.combo | 0) >= 10 && jumps % 3 === 0) T("spin"); });
    bus.on("dive", () => T("dive"));
    bus.on("land", p => T("land", { impact: Math.abs((p && p.vy) || G.vy || 0) }));
    bus.on("hit", () => T("hit"));
    bus.on("catch", () => T("hit"));
    bus.on("nearmiss", o => {
      const lanes = (o && o.lanes) || [G.lane];
      let c = 0; for (const l of lanes) c += l; c /= lanes.length;
      T("nearmiss", { dir: Math.sign(c - G.lane) || (G.laneDir || 1) });
    });
    bus.on("milestone", () => T("milestone"));
    bus.on("record", () => T("record"));
    bus.on("gameover", p => { S.celebrate = !!(p && p.isBest); });
    bus.on("start", () => { S.celebrate = false; try { rizy.reset(); } catch(e){} });
    bus.on("title", () => { S.celebrate = false; try { rizy.reset(); } catch(e){} });
    bus.on("revive", () => { try { rizy.reset(); } catch(e){} });
    // буст: взлёт с сальто; в полёте кит держит позу прыжка по S.py/S.vy (py ≈ 1.6, vy = 0), посадку даёт land
    bus.on("boost", on => { if (on) T("jump", { flip:true }); });
    bus.on("settings", () => { try { rizy.setReducedMotion(!!G.reducedMotion); } catch(e){} });

    function update(realDt, pctx, simDt){
      S.mode = G.mode; S.runPhase = G.runPhase;
      S.speedI = G.intensity != null ? G.intensity : 0;
      S.laneX = G.x; S.py = G.py; S.vy = G.vy; S.sliding = G.sliding; S.dive = !!G.dive;
      S.grace = G.grace; S.blinkOn = G.blinkOn; S.danger = G.danger || 0; S.celebrate = S.celebrate;
      rizy.setState(S);
      rizy.update(realDt, simDt == null ? realDt : simDt);
    }
    // handles.blink: кит сам применяет G.blinkOn, main не должен трогать visible
    return {
      rizy: { g: rizy.root }, handles: { blink: true }, kind: rizy.kind, update,
      dispose(){ try { rizy.dispose(); } catch(e){} if (rizy.root.parent) rizy.root.parent.remove(rizy.root); },
    };
  },
};
