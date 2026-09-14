// БАЗОВЫЙ плагин мира (фолбэк = поведение legacy/run.js): небо, земля, трасса, валы, бордюры,
// поручни, столбики, кусты, реквизит, арки, горы, облака, снег + ВИЗУАЛ препятствий и энергонов.
// Порядок создания объектов совпадает с монолитом: uuid тоже тянет Math.random,
// так при ?seed декор стоит там же, где на старых скриншотах.
import * as THREE from "three";

export default {
  name: "world",
  install(ctx){
    const { scene, cfg, util, bus } = ctx;
    const { rnd, pick, canvasTex } = util;
    const P = cfg.P, LANES = cfg.LANES;
    const owned = [];                         // корневые объекты сцены этого плагина
    const add = o => { scene.add(o); owned.push(o); return o; };

    // ---------- НЕБО ----------
    scene.fog = new THREE.Fog(cfg.FOG_COL, 34, 128);
    scene.background = canvasTex(64, 256, (g,w,h) => {
      const gr = g.createLinearGradient(0,0,0,h);
      gr.addColorStop(0.00, "#6fc3ff");
      gr.addColorStop(0.42, "#a9dcff");
      gr.addColorStop(0.72, "#daeeff");
      gr.addColorStop(0.88, "#ffe9e4");
      gr.addColorStop(1.00, "#fff3e0");
      g.fillStyle = gr; g.fillRect(0,0,w,h);
    });

    // мягкое сияние солнца
    const glowTex = canvasTex(128,128,(g,w,h)=>{
      const gr = g.createRadialGradient(w/2,h/2,2,w/2,h/2,w/2);
      gr.addColorStop(0,"rgba(255,252,236,1)");
      gr.addColorStop(.28,"rgba(255,240,190,.8)");
      gr.addColorStop(1,"rgba(255,240,190,0)");
      g.fillStyle = gr; g.fillRect(0,0,w,h);
    });
    const sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map:glowTex, transparent:true, depthWrite:false, fog:false }));
    sunGlow.position.set(30, 33, -140); sunGlow.scale.set(58,58,1);
    add(sunGlow);

    const mat = (color, o) => new THREE.MeshStandardMaterial(Object.assign({ color, roughness:.88, metalness:0 }, o||{}));
    function msh(geo, m, cast=true, recv=false){
      const x = new THREE.Mesh(geo, m); x.castShadow = cast; x.receiveShadow = recv; return x;
    }

    // ---------- ЗЕМЛЯ / ТРАССА ----------
    const snowTex = canvasTex(256,256,(g,w,h)=>{
      g.fillStyle = "#ffffff"; g.fillRect(0,0,w,h);
      for (let i=0;i<500;i++){
        g.fillStyle = `rgba(186,214,255,${rnd(.05,.18)})`;
        g.beginPath(); g.arc(rnd(0,w), rnd(0,h), rnd(1,3.6), 0, 7); g.fill();
      }
    },[24,64]);
    const ground = msh(new THREE.PlaneGeometry(200,340), mat(0xffffff,{map:snowTex,roughness:1}), false, true);
    ground.rotation.x = -Math.PI/2; ground.position.set(0,-0.03,-120);
    add(ground);

    // брусчатка тропы: тёплые плиты + снежные намёты + светлая «река» по центру
    const roadTex = canvasTex(512,1024,(g,w,h)=>{
      g.fillStyle = "#e8c49a"; g.fillRect(0,0,w,h);
      // поперечные доски настила
      const planks = 26, ph = h/planks;
      for (let i=0;i<planks;i++){
        const y = i*ph;
        g.fillStyle = pick(["#f0cfa4","#e6c096","#f5d7ad","#dfb98e"]);
        g.beginPath(); g.roundRect(6, y+4, w-12, ph-8, 9); g.fill();
        g.strokeStyle = "rgba(150,105,62,.35)"; g.lineWidth = 3; g.stroke();
        // прожилки дерева
        g.strokeStyle = "rgba(160,115,70,.16)"; g.lineWidth = 2;
        for (let k=0;k<3;k++){
          const yy = y + 8 + k*(ph-16)/3;
          g.beginPath(); g.moveTo(14, yy);
          g.bezierCurveTo(w*0.33, yy+rnd(-4,4), w*0.66, yy+rnd(-4,4), w-14, yy);
          g.stroke();
        }
      }
      // снежные намёты по краям
      for (let i=0;i<70;i++){
        const x = Math.random()<.5 ? rnd(0,w*0.2) : rnd(w*0.8,w);
        g.fillStyle = `rgba(255,255,255,${rnd(.4,.85)})`;
        g.beginPath(); g.ellipse(x, rnd(0,h), rnd(14,40), rnd(7,16), rnd(0,3), 0, 7); g.fill();
      }
      // светлая «река» по центру
      const gr = g.createLinearGradient(w*0.38,0,w*0.62,0);
      gr.addColorStop(0,"rgba(190,240,255,0)");
      gr.addColorStop(.5,"rgba(190,245,255,.4)");
      gr.addColorStop(1,"rgba(190,240,255,0)");
      g.fillStyle = gr; g.fillRect(w*0.38,0,w*0.24,h);
      // пуговки разметки полос
      for (const x of [w*0.335, w*0.665]){
        for (let y=20; y<h; y+=64){
          g.fillStyle = "rgba(255,255,255,.85)";
          g.beginPath(); g.arc(x, y, 8, 0, 7); g.fill();
          g.strokeStyle = "rgba(120,150,200,.5)"; g.lineWidth = 2.5; g.stroke();
        }
      }
    },[1,18]);
    const road = msh(new THREE.PlaneGeometry(9,300), mat(0xffffff,{map:roadTex,roughness:.92}), false, true);
    road.rotation.x = -Math.PI/2; road.position.set(0,0,-120);
    add(road);

    // снежные валы вдоль трассы (статичные длинные формы)
    const bankGeo = new THREE.CapsuleGeometry(0.95, 300, 6, 14);
    for (const x of [-5.5, 5.5]){
      const bank = msh(bankGeo, mat(0xffffff,{roughness:1}), true, true);
      bank.rotation.x = Math.PI/2;
      bank.position.set(x, 0.35, -120);
      bank.scale.set(1, 1, 0.72);
      add(bank);
    }
    // карамельные бордюры у самой тропы
    for (const [x,c] of [[-4.55,P.pink],[4.55,P.blue]]){
      const curb = msh(new THREE.CapsuleGeometry(0.2, 300, 4, 10), mat(c,{roughness:.7}), true, true);
      curb.rotation.x = Math.PI/2;
      curb.position.set(x, 0.17, -120);
      add(curb);
    }
    // непрерывные поручни поверх валов
    for (const x of [-5.5, 5.5]){
      const rail = msh(new THREE.CylinderGeometry(0.075,0.075,300,8), mat(P.wood,{roughness:.7}));
      rail.rotation.x = Math.PI/2;
      rail.position.set(x, 1.45, -120);
      add(rail);
    }

    // ---------- РЕЦИКЛИРУЕМЫЕ ПОЛОСЫ РЕКВИЗИТА ----------
    function strip(count, spacing, factory){
      const items = [];
      for (let i=0;i<count;i++){
        const o = factory(i);
        if (o){ o.position.z = -i*spacing; add(o); items.push(o); }
      }
      return { items, span: count*spacing };
    }
    function advance(s, dz){
      for (const o of s.items){
        o.position.z += dz;
        if (o.position.z > 14) o.position.z -= s.span;
      }
    }

    // столбики ограды + фонарики
    const postMat = mat(P.wood,{roughness:.75});
    const capMat = mat(0xffffff,{roughness:1});
    const bulbMats = [P.pink2,P.lime,P.blue,0xffd166].map(c =>
      new THREE.MeshStandardMaterial({ color:c, emissive:c, emissiveIntensity:.45, roughness:.4 }));
    const posts = strip(26, 5, i => {
      const g = new THREE.Group();
      g.userData.noShadow = true;
      for (const x of [-5.5, 5.5]){
        const p = msh(new THREE.CylinderGeometry(0.13,0.15,1.5,8), postMat);
        p.position.set(x, 0.95, 0);
        const cap = msh(new THREE.SphereGeometry(0.19,10,8), capMat);
        cap.position.set(x, 1.72, 0); cap.scale.y = .7;
        g.add(p, cap);
        if (i % 2 === 0){
          const bulb = msh(new THREE.SphereGeometry(0.13,10,8), bulbMats[i % bulbMats.length]);
          bulb.position.set(x + (x<0?0.3:-0.3), 1.3, 0);
          g.add(bulb);
        }
      }
      return g;
    });

    // пушистые кусты сразу за оградой
    const hedgeMats = [0x8fdf9f, 0x7fd0b0, 0xa8e88a].map(c => mat(c,{roughness:.95}));
    const hedges = strip(30, 4.2, i => {
      const g = new THREE.Group();
      g.userData.noShadow = true;
      for (const side of [-1,1]){
        const b = new THREE.Group();
        const m = hedgeMats[(i+(side>0?1:0)) % hedgeMats.length];
        for (let k=0;k<2;k++){
          const r = rnd(0.85,1.25);
          const s = msh(new THREE.SphereGeometry(r,12,9), m);
          s.position.set(rnd(-0.6,0.6), r*0.62, rnd(-0.7,0.7));
          b.add(s);
          const snowcap = msh(new THREE.SphereGeometry(r*0.78,10,7), capMat);
          snowcap.position.set(s.position.x, s.position.y+r*0.42, s.position.z);
          snowcap.scale.set(1,.38,1);
          b.add(snowcap);
        }
        b.position.set(side*rnd(6.5,7.2), 0, rnd(-1.4,1.4));
        g.add(b);
      }
      return g;
    });

    // кэш геометрий/материалов для объектов, создаваемых во время забега (без утечек GPU-буферов)
    const geoCache = new Map(), matCache = new Map();
    const cgeo = (key, make) => { let g = geoCache.get(key); if (!g){ g = make(); geoCache.set(key, g); } return g; };
    const cmat = (key) => {
      let m = matCache.get(key);
      if (!m){ m = key === "trunk" ? mat(P.brown) : mat(key,{roughness:.95}); matCache.set(key, m); }
      return m;
    };

    // крупный реквизит: ёлки, домики, леденцы, снеговики
    // cached=true — для ёлок на препятствиях (создаются часто, геометрия/материалы общие)
    function felterTree(cached){
      const g = new THREE.Group();
      const c1 = pick([0x63c98a, 0x77d97f, 0x59bf9a, 0x86e07a]);
      const m = cached ? cmat(c1) : mat(c1,{roughness:.95});
      const tiers = [[1.25,0.95],[0.95,1.85],[0.68,2.55],[0.42,3.1]];
      for (const [r,y] of tiers){
        const s = msh(cached ? cgeo("ts"+r, () => new THREE.SphereGeometry(r,12,10)) : new THREE.SphereGeometry(r,12,10), m);
        s.position.y = y; s.scale.y = .82; g.add(s);
        const cap = msh(cached ? cgeo("tc"+r, () => new THREE.SphereGeometry(r*0.72,10,8)) : new THREE.SphereGeometry(r*0.72,10,8), capMat);
        cap.position.y = y + r*0.42; cap.scale.set(1,.34,1);
        g.add(cap);
      }
      const trunk = msh(cached ? cgeo("trunk", () => new THREE.CylinderGeometry(0.17,0.22,0.6,8)) : new THREE.CylinderGeometry(0.17,0.22,0.6,8),
        cached ? cmat("trunk") : mat(P.brown));
      trunk.position.y = 0.28; g.add(trunk);
      const k = rnd(0.85,1.5); g.scale.set(k,k,k);
      return g;
    }
    function candyHouse(){
      const g = new THREE.Group();
      const bodyC = pick([P.cream, P.peach, 0xdff0ff, 0xffe3ec, 0xe8f7d8]);
      const roofC = pick([P.pink2, P.red, P.mint, 0x6fa8ff]);
      const w = rnd(3,4), d = rnd(2.8,3.6), hh = rnd(2,2.9);
      const body = msh(new THREE.BoxGeometry(w,hh,d), mat(bodyC,{roughness:.92}));
      body.position.y = hh/2;
      const roof = msh(new THREE.ConeGeometry(Math.max(w,d)*0.78, 1.5, 4), mat(roofC,{roughness:.85}));
      roof.position.y = hh + 0.72; roof.rotation.y = Math.PI/4;
      const rcap = msh(new THREE.ConeGeometry(Math.max(w,d)*0.62, 0.6, 4), capMat);
      rcap.position.y = hh + 1.14; rcap.rotation.y = Math.PI/4;
      const winMat = new THREE.MeshStandardMaterial({ color:0xfff3c4, emissive:0xffc75e, emissiveIntensity:1.1, roughness:.5 });
      g.add(body, roof, rcap);
      for (const dx of [-w*0.26, w*0.26]){
        const win = msh(new THREE.BoxGeometry(0.62,0.72,0.1), winMat);
        win.position.set(dx, hh*0.58, d/2+0.03); g.add(win);
        const frame = msh(new THREE.BoxGeometry(0.74,0.84,0.06), mat(0xffffff));
        frame.position.set(dx, hh*0.58, d/2+0.01); g.add(frame);
      }
      const door = msh(new THREE.BoxGeometry(0.66,1.05,0.1), mat(P.brown,{roughness:.8}));
      door.position.set(0, 0.52, d/2+0.03); g.add(door);
      // гирлянда по фасаду
      for (let i=0;i<6;i++){
        const b = msh(new THREE.SphereGeometry(0.1,8,8), bulbMats[i%bulbMats.length]);
        b.position.set(-w/2+0.35+i*(w-0.7)/5, hh - 0.12 - Math.sin(i/5*Math.PI)*0.18, d/2+0.06);
        g.add(b);
      }
      return g;
    }
    function lollipop(){
      const g = new THREE.Group();
      const pole = msh(new THREE.CylinderGeometry(0.1,0.1,3,8), mat(0xffffff,{roughness:.6}));
      pole.position.y = 1.5;
      const pop = msh(new THREE.SphereGeometry(0.5,14,12), mat(pick([P.pink2,P.lime,P.blue,0xffd166]),{roughness:.45}));
      pop.position.y = 3.1;
      const swirl = msh(new THREE.TorusGeometry(0.3,0.07,8,16), mat(0xffffff,{roughness:.5}));
      swirl.position.y = 3.1; swirl.position.z = 0.42;
      g.add(pole, pop, swirl);
      return g;
    }
    function snowman(){
      const g = new THREE.Group();
      const b1 = msh(new THREE.SphereGeometry(0.62,12,10), capMat); b1.position.y = 0.56;
      const b2 = msh(new THREE.SphereGeometry(0.44,12,10), capMat); b2.position.y = 1.36;
      const b3 = msh(new THREE.SphereGeometry(0.32,12,10), capMat); b3.position.y = 1.95;
      const nose = msh(new THREE.ConeGeometry(0.08,0.34,8), mat(0xff9a55));
      nose.rotation.x = Math.PI/2; nose.position.set(0,1.97,0.34);
      const hat = msh(new THREE.SphereGeometry(0.27,10,8), mat(P.pink2));
      hat.position.y = 2.2; hat.scale.y = .62;
      const scarf = msh(new THREE.TorusGeometry(0.3,0.09,8,14), mat(P.lime));
      scarf.position.y = 1.68; scarf.rotation.x = Math.PI/2;
      for (const [x,y] of [[-0.14,2.0],[0.14,2.0]]){
        const eye = msh(new THREE.SphereGeometry(0.05,8,8), mat(0x22243c));
        eye.position.set(x,y,0.29); g.add(eye);
      }
      g.add(b1,b2,b3,nose,hat,scarf);
      return g;
    }
    const props = strip(16, 7.5, i => {
      const g = new THREE.Group();
      g.userData.noShadow = true;
      for (const side of [-1,1]){
        const r = Math.random();
        const item = r < .46 ? felterTree() : r < .68 ? candyHouse() : r < .86 ? lollipop() : snowman();
        item.position.set(side*rnd(8.4,12.5), 0, rnd(-2.6,2.6));
        item.scale.multiplyScalar(1.18);
        item.rotation.y = side<0 ? rnd(0.2,0.6) : rnd(-0.6,-0.2);
        g.add(item);
      }
      // дальний слой — одна крупная ёлка через группу
      if (i % 2 === 0){
        const t = felterTree();
        t.position.set((i%4===0?-1:1)*rnd(16,22), 0, rnd(-4,4));
        t.scale.multiplyScalar(1.55);
        g.add(t);
      }
      return g;
    });

    // арки над трассой — крупные ориентиры
    const signTex = canvasTex(512,128,(g,w,h)=>{
      g.fillStyle = "#fffdf7"; g.beginPath(); g.roundRect(6,6,w-12,h-12,26); g.fill();
      g.strokeStyle = "#0b1240"; g.lineWidth = 9; g.stroke();
      g.fillStyle = "#0536D4"; g.font = "900 62px 'Avenir Next', system-ui, sans-serif";
      g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText("ИДЕАЛИТИ", w/2, h/2+3);
    });
    const arches = strip(3, 46, () => {
      const g = new THREE.Group();
      const legMat = mat(0xffffff,{roughness:.6});
      const stripeMat = mat(P.red,{roughness:.6});
      for (const x of [-4.9, 4.9]){
        for (let i=0;i<8;i++){
          const seg = msh(new THREE.CylinderGeometry(0.19,0.19,0.55,10), i%2 ? stripeMat : legMat);
          seg.position.set(x, 0.3+i*0.55, 0);
          g.add(seg);
        }
      }
      const top = msh(new THREE.TorusGeometry(4.9, 0.2, 10, 28, Math.PI), legMat);
      top.position.y = 4.7;
      g.add(top);
      const sign = msh(new THREE.BoxGeometry(3.4,0.86,0.14), mat(0xffffff,{map:signTex,roughness:.6}));
      sign.position.set(0, 5.0, 0.02);
      g.add(sign);
      for (let i=0;i<13;i++){
        const a = Math.PI*(i/12);
        const b = msh(new THREE.SphereGeometry(0.15,10,8), bulbMats[i%bulbMats.length]);
        b.position.set(Math.cos(a)*4.9, 4.7+Math.sin(a)*4.9, 0.28);
        g.add(b);
      }
      return g;
    });

    // декор без теней: заметный прирост fps без потери картинки
    for (const s of [posts, hedges, props]){
      for (const o of s.items){
        if (!o.userData.noShadow) continue;
        o.traverse(n => { if (n.isMesh) n.castShadow = false; });
      }
    }

    // дальние горы
    const mountTex = canvasTex(1024,256,(g,w,h)=>{
      g.clearRect(0,0,w,h);
      for (let layer=0; layer<2; layer++){
        g.fillStyle = layer ? "rgba(186,214,250,.95)" : "rgba(206,229,255,.8)";
        g.beginPath(); g.moveTo(0,h);
        let x = 0;
        while (x < w){
          const pw = rnd(90,190), ph = rnd(70,180) - layer*22;
          g.lineTo(x+pw/2, h-ph); g.lineTo(x+pw, h);
          x += pw;
        }
        g.lineTo(w,h); g.closePath(); g.fill();
      }
      g.fillStyle = "rgba(255,255,255,.9)";
      for (let i=0;i<26;i++){
        const x = rnd(0,w), y = rnd(60,150);
        g.beginPath(); g.moveTo(x-14,y+18); g.lineTo(x,y); g.lineTo(x+14,y+18); g.closePath(); g.fill();
      }
    });
    const mountains = new THREE.Mesh(new THREE.PlaneGeometry(420,72),
      new THREE.MeshBasicMaterial({ map:mountTex, transparent:true, fog:false, depthWrite:false }));
    mountains.position.set(0, 22, -175);
    add(mountains);

    // облака
    const clouds = [];
    for (let i=0;i<11;i++){
      const g = new THREE.Group();
      const cm = new THREE.MeshBasicMaterial({ color:0xffffff, fog:false });
      for (let p=0;p<4;p++){
        const s = new THREE.Mesh(new THREE.SphereGeometry(rnd(1.6,2.8),10,8), cm);
        s.position.set(p*rnd(1.4,2.2)-3, rnd(-.4,.4), rnd(-.6,.6));
        s.scale.y = .5; g.add(s);
      }
      g.position.set(rnd(-60,60), rnd(15,30), -rnd(50,170));
      g.userData.v = rnd(.3,.9);
      add(g); clouds.push(g);
    }
    // снежинки
    const snowN = 500;
    const snowGeo = new THREE.BufferGeometry();
    const snowPos = new Float32Array(snowN*3);
    for (let i=0;i<snowN;i++){
      snowPos[i*3] = rnd(-28,28); snowPos[i*3+1] = rnd(0,22); snowPos[i*3+2] = rnd(-90,12);
    }
    snowGeo.setAttribute("position", new THREE.BufferAttribute(snowPos,3));
    const snowPts = new THREE.Points(snowGeo, new THREE.PointsMaterial({
      color:0xffffff, size:.19, transparent:true, opacity:.95, depthWrite:false }));
    add(snowPts);

    // ---------- ВИЗУАЛ ПРЕПЯТСТВИЙ И ЭНЕРГОНОВ ----------
    // материалы создаются лениво при первом спавне — как в монолите (после Ризи и роя)
    let E = null;
    function entityMats(){
      if (E) return E;
      E = {
        rollA: mat(P.pink,{roughness:.75}), rollB: mat(0xffffff,{roughness:.8}),
        poleW: mat(0xffffff,{roughness:.6}), poleR: mat(P.red,{roughness:.6}),
        scarfM: mat(P.lime,{roughness:.85}),
        coinMat: new THREE.MeshStandardMaterial({ color:0xff5fae, emissive:0xff2f92, emissiveIntensity:.55, roughness:.3, metalness:.25 }),
        coinGeo: new THREE.CylinderGeometry(0.3,0.3,0.12,8),
        coinHaloMat: new THREE.SpriteMaterial({ map:glowTex, color:0xffb3d5, transparent:true,
          opacity:.4, depthWrite:false, blending:THREE.AdditiveBlending }),
      };
      return E;
    }

    function mkRoll(lane){
      const M = entityMats();
      const g = new THREE.Group();
      const segGeo = cgeo("rollSeg", () => new THREE.CylinderGeometry(0.36,0.36,0.46,14));
      for (let i=0;i<5;i++){
        const seg = msh(segGeo, i%2 ? M.rollA : M.rollB);
        seg.rotation.z = Math.PI/2; seg.position.set(-0.92+i*0.46, 0.38, 0);
        g.add(seg);
      }
      const capGeo = cgeo("rollCap", () => new THREE.SphereGeometry(0.36,12,10));
      for (const x of [-1.15,1.15]){
        const cap = msh(capGeo, M.rollB);
        cap.position.set(x,0.38,0); g.add(cap);
      }
      const bow = msh(cgeo("rollBow", () => new THREE.TorusGeometry(0.16,0.06,8,14)), M.scarfM);
      bow.position.set(0,0.74,0); g.add(bow);
      g.position.x = LANES[lane];
      return g;
    }
    function mkGarland(lanes){
      const M = entityMats();
      const g = new THREE.Group();
      const x1 = LANES[lanes[0]]-1.3, x2 = LANES[lanes[lanes.length-1]]+1.3;
      const segGeo = cgeo("garSeg", () => new THREE.CylinderGeometry(0.11,0.11,0.46,10));
      const topGeo = cgeo("garTop", () => new THREE.SphereGeometry(0.18,10,8));
      for (const x of [x1,x2]){
        for (let i=0;i<6;i++){
          const seg = msh(segGeo, i%2 ? M.poleR : M.poleW);
          seg.position.set(x, 0.23+i*0.46, 0); g.add(seg);
        }
        const top = msh(topGeo, M.poleR);
        top.position.set(x,3.0,0); g.add(top);
      }
      const band = msh(cgeo("garBand"+lanes.length, () => new THREE.BoxGeometry(x2-x1,0.36,0.12)), M.scarfM);
      // в монолите лента всегда стояла в x=0 и «висела» мимо столбов на крайних полосах — центрируем
      band.position.set((x1+x2)/2, 1.45, 0); g.add(band);
      const bulbGeo = cgeo("garBulb", () => new THREE.SphereGeometry(0.11,10,8));
      for (let i=0;i<8;i++){
        const t = i/7;
        const b = msh(bulbGeo, bulbMats[i%bulbMats.length]);
        b.position.set(x1+(x2-x1)*t, 1.2-Math.sin(t*Math.PI)*0.14, 0.02);
        g.add(b);
      }
      return g;
    }
    function mkMound(lane){
      const g = new THREE.Group();
      const mound = msh(cgeo("mound", () => new THREE.SphereGeometry(1.0,16,12)), capMat);
      mound.position.y = 0.32; mound.scale.set(1.08,.78,.92);
      const t = felterTree(true); t.scale.setScalar(0.5); t.position.y = 0.5;
      g.add(mound, t);
      g.position.x = LANES[lane];
      return g;
    }

    // энергоны переиспользуются: держатель + монетка + ореол
    const coinPool = [];
    function mkCoin(){
      const M = entityMats();
      const holder = new THREE.Group();
      const c = msh(M.coinGeo, M.coinMat);
      c.rotation.x = Math.PI/2;
      holder.add(c);
      const halo = new THREE.Sprite(M.coinHaloMat);
      halo.scale.set(1.1,1.1,1);
      holder.add(halo);
      holder.userData.coin = c;
      return holder;
    }

    const onSpawnObstacle = ent => {
      let g;
      if (ent.kind === "jump") g = mkRoll(ent.lanes[0]);
      else if (ent.kind === "slide") g = mkGarland(ent.lanes);
      else g = mkMound(ent.lanes[0]);
      g.position.z = ent.z;
      scene.add(g);
      ent.object3d = g;
    };
    const onSpawnCoin = ent => {
      const h = coinPool.pop() || mkCoin();
      h.userData.coin.rotation.z = 0;
      h.position.set(ent.x, ent.y, ent.z);
      scene.add(h);
      ent.object3d = h;
    };
    const onDespawn = ent => {
      const o = ent.object3d;
      if (!o) return;
      if (o.parent) o.parent.remove(o);
      if (o.userData.coin) coinPool.push(o);   // препятствия не пулим: общие геометрии, объекты уйдут в GC
      ent.object3d = null;
    };
    bus.on("spawn:obstacle", onSpawnObstacle);
    bus.on("spawn:coin", onSpawnCoin);
    bus.on("despawn", onDespawn);

    const G = ctx.G;
    return {
      update(dt){
        const dz = G.dz;
        if (!(dz > 0)) return;              // мир едет только в забеге
        roadTex.offset.y -= dz/18.75;
        snowTex.offset.y -= dz/5.3;
        advance(posts, dz); advance(hedges, dz); advance(props, dz); advance(arches, dz);
        for (const c of clouds){
          c.position.x += c.userData.v*dt;
          if (c.position.x > 66) c.position.x = -66;
        }
        const sp = snowPts.geometry.attributes.position.array;
        for (let i=0;i<snowN;i++){
          sp[i*3+1] -= dt*rnd(1.0,1.9);
          sp[i*3+2] += dz*0.28;
          if (sp[i*3+1] < 0) sp[i*3+1] = rnd(16,22);
          if (sp[i*3+2] > 12) sp[i*3+2] -= 100;
        }
        snowPts.geometry.attributes.position.needsUpdate = true;
        // энергоны крутятся
        const coins = ctx.entities.coins;
        for (let i=0;i<coins.length;i++){
          const o = coins[i].object3d;
          if (o) o.userData.coin.rotation.z += dt*4;
        }
      },
      dispose(){
        bus.off("spawn:obstacle", onSpawnObstacle);
        bus.off("spawn:coin", onSpawnCoin);
        bus.off("despawn", onDespawn);
        for (const o of owned) scene.remove(o);
        for (const list of [ctx.entities.obstacles, ctx.entities.coins])
          for (const e of list){ if (e.object3d && e.object3d.parent) e.object3d.parent.remove(e.object3d); e.object3d = null; }
        scene.fog = null; scene.background = null;
      },
    };
  },
};
