// БАЗОВЫЙ плагин игрока (фолбэк = legacy/run.js): процедурная Ризи, шарф-цепочка, анимация бега/прыжка/подката.
import * as THREE from "three";

export default {
  name: "player",
  install(ctx){
    const { scene, cfg, util } = ctx;
    const { rnd, clamp, lerp, canvasTex } = util;
    const P = cfg.P, LANES = cfg.LANES;

    const mat = (color, o) => new THREE.MeshStandardMaterial(Object.assign({ color, roughness:.88, metalness:0 }, o||{}));
    function msh(geo, m, cast=true, recv=false){
      const x = new THREE.Mesh(geo, m); x.castShadow = cast; x.receiveShadow = recv; return x;
    }

    const sweaterTex = canvasTex(128,128,(g,w,h)=>{
      g.fillStyle = "#1b1b2c"; g.fillRect(0,0,w,h);
      for (let i=0;i<16;i++){
        const x = rnd(8,120), y = rnd(8,120), r = rnd(4.5,6.5);
        g.fillStyle = Math.random()<.5 ? "#C0FF3F" : "#5aa6f0";
        for (let p=0;p<5;p++){
          const a = p*Math.PI*2/5;
          g.beginPath(); g.arc(x+Math.cos(a)*r, y+Math.sin(a)*r, r*0.62, 0, 7); g.fill();
        }
        g.fillStyle = "#1b1b2c";
        g.beginPath(); g.arc(x,y,r*0.45,0,7); g.fill();
      }
    });

    function buildRizy(){
      const M = {
        skin: mat(P.skin,{roughness:.55}),
        hair: mat(P.hair,{roughness:.5}),
        sweater: mat(0xffffff,{map:sweaterTex,roughness:.85}),
        jeans: mat(P.jeans,{roughness:.72}),
        shoe: mat(0x24243d,{roughness:.5}),
        sole: mat(0xffffff,{roughness:.5}),
        pack: mat(0x3f86ee,{roughness:.6}),
        scarf: mat(P.lime,{roughness:.85}),
      };
      const g = new THREE.Group();
      const body = new THREE.Group();
      g.add(body);

      function leg(side){
        const hip = new THREE.Group();
        hip.position.set(0.13*side, 0.9, 0);
        hip.add(msh(new THREE.CapsuleGeometry(0.095,0.32,5,10), M.jeans)).children.at(-1).position.y = -0.22;
        const shin = new THREE.Group(); shin.position.y = -0.48; hip.add(shin);
        const calf = msh(new THREE.CapsuleGeometry(0.082,0.26,5,10), M.jeans);
        calf.position.y = -0.16; shin.add(calf);
        const shoe = msh(new THREE.SphereGeometry(0.13,12,10), M.shoe);
        shoe.position.set(0,-0.38,0.05); shoe.scale.set(1,.72,1.5); shin.add(shoe);
        const sole = msh(new THREE.SphereGeometry(0.115,10,8), M.sole);
        sole.position.set(0,-0.44,0.05); sole.scale.set(1,.32,1.45); shin.add(sole);
        return { hip, shin };
      }
      const L = leg(-1), R = leg(1);
      body.add(L.hip, R.hip);

      const torso = msh(new THREE.CapsuleGeometry(0.29,0.36,7,14), M.sweater);
      torso.position.y = 1.2; body.add(torso);
      const hipBlock = msh(new THREE.CapsuleGeometry(0.26,0.1,6,12), M.jeans);
      hipBlock.position.y = 0.95; body.add(hipBlock);
      const pack = msh(new THREE.CapsuleGeometry(0.19,0.24,6,12), M.pack);
      pack.position.set(0,1.24,0.27); body.add(pack);
      const packFlap = msh(new THREE.SphereGeometry(0.19,10,8), mat(0x2c6bd0,{roughness:.6}));
      packFlap.position.set(0,1.42,0.28); packFlap.scale.set(1,.5,.8); body.add(packFlap);

      function arm(side){
        const sh = new THREE.Group();
        sh.position.set(0.34*side, 1.44, 0);
        sh.rotation.z = 0.16*side;
        const up = msh(new THREE.CapsuleGeometry(0.072,0.2,5,10), M.sweater);
        up.position.y = -0.14; sh.add(up);
        const lo = new THREE.Group(); lo.position.y = -0.3; sh.add(lo);
        const fore = msh(new THREE.CapsuleGeometry(0.064,0.17,5,10), M.sweater);
        fore.position.y = -0.1; lo.add(fore);
        const hand = msh(new THREE.SphereGeometry(0.082,10,8), M.skin);
        hand.position.y = -0.25; lo.add(hand);
        lo.rotation.x = -0.75;
        return sh;
      }
      const AL = arm(-1), AR = arm(1);
      body.add(AL, AR);

      // шарф: цепочка сегментов, тянется за спиной
      const scarfRoot = new THREE.Group();
      scarfRoot.position.set(0,1.52,0.08);
      body.add(scarfRoot);
      const collar = msh(new THREE.TorusGeometry(0.2,0.075,8,16), M.scarf);
      collar.rotation.x = Math.PI/2; scarfRoot.add(collar);
      const scarfSegs = [];
      let parent = scarfRoot;
      for (let i=0;i<5;i++){
        const seg = new THREE.Group();
        seg.position.set(0, i===0 ? -0.02 : 0, i===0 ? 0.12 : 0.22);
        const m = msh(new THREE.BoxGeometry(0.28,0.1,0.3), M.scarf);
        m.position.z = 0.13; seg.add(m);
        parent.add(seg); parent = seg;
        scarfSegs.push(seg);
      }

      const headG = new THREE.Group(); headG.position.y = 1.72; body.add(headG);
      headG.add(msh(new THREE.SphereGeometry(0.27,18,16), M.skin));
      const hairCap = msh(new THREE.SphereGeometry(0.285,18,16), M.hair);
      hairCap.position.set(0,0.07,0.02); hairCap.scale.set(1,.8,1);
      headG.add(hairCap);
      const bobBack = msh(new THREE.CapsuleGeometry(0.21,0.16,6,12), M.hair);
      bobBack.position.set(0,-0.05,0.13); bobBack.scale.set(1.2,1,.62);
      headG.add(bobBack);
      for (const x of [-0.225, 0.225]){
        const side = msh(new THREE.CapsuleGeometry(0.078,0.18,5,10), M.hair);
        side.position.set(x,-0.04,0.03); headG.add(side);
      }
      const bunL = msh(new THREE.SphereGeometry(0.135,12,10), M.hair);
      bunL.position.set(-0.2,0.29,0.02);
      const bunR = bunL.clone(); bunR.position.x = 0.2;
      headG.add(bunL, bunR);
      for (const b of [bunL,bunR]){
        const tie = msh(new THREE.TorusGeometry(0.075,0.028,8,12), mat(P.pink2,{roughness:.6}));
        tie.position.set(b.position.x*0.8, 0.2, 0.02); tie.rotation.y = Math.PI/2;
        headG.add(tie);
      }
      const bangs = msh(new THREE.SphereGeometry(0.22,14,10), M.hair);
      bangs.position.set(0,0.12,-0.15); bangs.scale.set(1.08,.52,.72);
      headG.add(bangs);

      return { g, body, L, R, AL, AR, headG, bunL, bunR, scarfSegs };
    }
    const rizy = buildRizy();
    scene.add(rizy.g);

    const G = ctx.G;
    return {
      rizy,
      update(dt){
        const perf = ctx.time.t;
        rizy.g.position.x = G.x;
        rizy.g.position.y = G.py;
        rizy.g.rotation.z = lerp(rizy.g.rotation.z, (LANES[G.lane]-G.x)*0.16, Math.min(1,dt*8));

        const t = G.runPhase, s = Math.sin(t), c = Math.cos(t);
        const running = G.mode === "play";
        const air = G.py > 0.02, slide = G.sliding > 0;
        const squash = G.land > 0 ? 1 - G.land*0.5 : 1;
        rizy.body.scale.set(1/Math.max(.8,squash), squash, 1/Math.max(.8,squash));

        if (slide){
          rizy.body.rotation.x = lerp(rizy.body.rotation.x, -1.2, Math.min(1,dt*15));
          rizy.body.position.y = lerp(rizy.body.position.y, -0.55, Math.min(1,dt*15));
          rizy.L.hip.rotation.x = lerp(rizy.L.hip.rotation.x, 1.25, dt*13);
          rizy.R.hip.rotation.x = lerp(rizy.R.hip.rotation.x, 1.4, dt*13);
          rizy.AL.rotation.x = -2.5; rizy.AR.rotation.x = -2.5;
        } else if (air){
          rizy.body.rotation.x = lerp(rizy.body.rotation.x, -0.3, dt*11);
          rizy.body.position.y = lerp(rizy.body.position.y, 0, dt*13);
          rizy.L.hip.rotation.x = lerp(rizy.L.hip.rotation.x, -1.05, dt*11);
          rizy.R.hip.rotation.x = lerp(rizy.R.hip.rotation.x, 0.55, dt*11);
          rizy.L.shin.rotation.x = 1.35; rizy.R.shin.rotation.x = 0.6;
          rizy.AL.rotation.x = -1.7; rizy.AR.rotation.x = 0.5;
        } else if (running){
          rizy.body.rotation.x = -0.19 + s*0.025;
          rizy.body.position.y = Math.abs(c)*0.075;
          rizy.L.hip.rotation.x = s*1.15;
          rizy.R.hip.rotation.x = -s*1.15;
          rizy.L.shin.rotation.x = Math.max(0,-s)*1.5 + 0.12;
          rizy.R.shin.rotation.x = Math.max(0, s)*1.5 + 0.12;
          rizy.AL.rotation.x = -s*1.0 - 0.12;
          rizy.AR.rotation.x = s*1.0 - 0.12;
          rizy.headG.rotation.x = s*0.05;
          rizy.bunL.position.y = 0.29 + Math.abs(s)*0.025;
          rizy.bunR.position.y = 0.29 + Math.abs(c)*0.025;
        } else {
          rizy.body.rotation.x = Math.sin(perf*1.6)*0.03;
          rizy.body.position.y = Math.sin(perf*2)*0.02;
          rizy.L.hip.rotation.x = rizy.R.hip.rotation.x = 0;
          rizy.L.shin.rotation.x = rizy.R.shin.rotation.x = 0.05;
          rizy.AL.rotation.x = rizy.AR.rotation.x = 0;
        }
        // шарф развевается тем сильнее, чем быстрее бег
        const wind = running ? clamp(G.speed/26,0,1) : 0.25;
        const segs = rizy.scarfSegs;
        for (let i=0;i<segs.length;i++){
          const seg = segs[i];
          const target = 0.10 + wind*0.34 + Math.sin(perf*7 - i*0.7)*0.20*wind;
          seg.rotation.x = lerp(seg.rotation.x, target, Math.min(1,dt*9));
          seg.rotation.y = Math.sin(perf*5 - i*0.9)*0.055*wind;
        }
      },
      dispose(){ scene.remove(rizy.g); },
    };
  },
};
