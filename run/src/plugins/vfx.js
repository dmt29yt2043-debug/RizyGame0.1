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

    // ПУЗЫРЬ ЩИТА: небесно-голубая сфера вокруг Ризи с френелевым ободком (аддитивно, HDR ×1.3 — лёгкий bloom).
    // Живёт на realDt: вход 0.25 с с перехлёстом, дыхание ±3 %, разбитие — раздувание ×1.6 и гашение за 0.22 с.
    const THREE = ctx.THREE;
    const shieldMat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(0x7FD4FF).multiplyScalar(1.9) }, uAlpha: { value: 1 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexShader: `varying vec3 vN; varying vec3 vV;
        void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform vec3 uColor; uniform float uAlpha; varying vec3 vN; varying vec3 vV;
        void main(){ float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2); gl_FragColor = vec4(uColor, (0.14 + 1.0 * f) * uAlpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const shield = new THREE.Mesh(new THREE.SphereGeometry(1.15, 28, 18), shieldMat);
    shield.name = "vfx:shield"; shield.visible = false; shield.renderOrder = 22; shield.frustumCulled = false;
    vfx.root.add(shield);
    const SH = { on:false, t:0, breakT:-1, scale:0 };     // t — сек с включения; breakT ≥ 0 — идёт разбитие

    // переиспользуемые объекты — ноль аллокаций в кадре
    const P = { x:0, y:0, z:0 };
    const O = { dt:0, dir:1, side:0, impact:1, big:false, delay:0 };
    const at = (x, y, z) => { P.x = x; P.y = y; P.z = z; return P; };
    const emit = (n, p, o) => { try { vfx.emit(n, p, o); } catch(e){ console.error("[vfx] emit " + n, e); } };
    let footPhase = 0, wasAir = false;
    function updateShield(realDt){
      const want = G.mode === "play" && G.powers && G.powers.shield > 0;
      if (want && !SH.on){ SH.on = true; SH.t = 0; SH.breakT = -1; }
      else if (!want && SH.on){ SH.on = false; if (SH.breakT < 0) SH.breakT = 0; }   // конец по таймеру — то же гашение
      if (!SH.on && SH.breakT < 0){ shield.visible = false; return; }
      let s = 1, a = 1;
      if (SH.breakT >= 0){
        SH.breakT += realDt;
        const u = Math.min(1, SH.breakT / 0.22);
        s = 1 + 0.6 * u; a = 1 - u;
        if (u >= 1){ SH.breakT = -1; shield.visible = false; return; }
      } else {
        SH.t += realDt;
        const u = Math.min(1, SH.t / 0.25), x = u - 1, back = 1 + 2.70158 * x * x * x + 1.70158 * x * x;   // easeOutBack
        s = Math.max(0.05, back) * (1 + 0.03 * Math.sin(SH.t * 4.5));
        a = Math.min(1, SH.t / 0.12);
      }
      shield.visible = true;
      shield.position.set(G.x, (G.py || 0) + 1.0, 0);
      shield.scale.set(s, s * 1.15, s);
      shieldMat.uniforms.uAlpha.value = a;
    }

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
    // ускорители: подбор — большой лаймовый всплеск; буст — линии скорости; магнит — шлейф от каждого энергона
    bus.on("powerup", p => {
      if (!p || !p.on) return;
      O.big = true; emit("pickup", at(G.x, G.py + 1.1, 0), O); O.big = false;
    });
    bus.on("shield:break", () => {
      SH.on = false; SH.breakT = 0;
      O.side = 0; emit("nearmiss", at(G.x, G.py + 1.0, 0), O);
      O.big = true; emit("pickup", at(G.x, G.py + 1.0, 0), O); O.big = false;
    });
    bus.on("boost", on => { try { vfx.setBoost(!!on); } catch(e){} });
    bus.on("magnet", c => {
      if (!c) return;
      O.side = 0;
      emit("magnet", c.object3d ? c.object3d.position : at(c.x, c.y, c.z), O);
    });
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
      if (G.mode === "play" && !G.flying){
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
      updateShield(realDt);
      try { vfx.update(realDt); } catch(e){ console.error("[vfx] update", e); }
    }
    return { handles: { snow: true }, update, dispose(){ try { shield.geometry.dispose(); shieldMat.dispose(); } catch(e){} try { vfx.dispose(); } catch(e){} } };
  },
};
