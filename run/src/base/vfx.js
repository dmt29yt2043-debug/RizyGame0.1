// БАЗОВЫЙ плагин эффектов (фолбэк = legacy/run.js): снежная пыль из-под ног, при подкате и приземлении.
import * as THREE from "three";

export default {
  name: "vfx",
  install(ctx){
    const { scene, bus, util } = ctx;
    const { rnd } = util;
    const G = ctx.G;

    // снежная пыль из-под ног
    const dustN = 60;
    const dustGeo = new THREE.BufferGeometry();
    const dustPos = new Float32Array(dustN*3);
    const dustVel = new Float32Array(dustN*4);   // x, y, z, life — без объектов на каждую пылинку
    for (let i=0;i<dustN;i++) dustPos[i*3+1] = -99;
    dustGeo.setAttribute("position", new THREE.BufferAttribute(dustPos,3));
    const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({
      color:0xffffff, size:.16, transparent:true, opacity:.9, depthWrite:false }));
    scene.add(dust);
    let dustIdx = 0;
    function emitDust(x,y,z){
      const i = dustIdx = (dustIdx+1) % dustN;
      dustPos[i*3] = x + rnd(-0.12,0.12);
      dustPos[i*3+1] = y + 0.05;
      dustPos[i*3+2] = z + rnd(-0.1,0.1);
      dustVel[i*4] = rnd(-.7,.7); dustVel[i*4+1] = rnd(1.1,2.4); dustVel[i*4+2] = rnd(1.5,3.5); dustVel[i*4+3] = 0.5;
    }

    // приземление — облачко пыли
    const onLand = () => { for (let i=0;i<6;i++) emitDust(G.x, 0, 0); };
    bus.on("land", onLand);

    return {
      emitDust,
      update(dt){
        if (G.dz > 0){
          // подкат и бег поднимают снег
          if (G.sliding > 0){ if (Math.random()<0.5) emitDust(G.x,0,0.2); }
          else if (G.py <= 0.01 && Math.random() < 0.55) emitDust(G.x, 0, 0.1);
        }
        for (let i=0;i<dustN;i++){
          if (dustVel[i*4+3] <= 0) continue;
          dustVel[i*4+3] -= dt;
          dustPos[i*3]   += dustVel[i*4]*dt;
          dustPos[i*3+1] += dustVel[i*4+1]*dt;
          dustPos[i*3+2] += dustVel[i*4+2]*dt;
          dustVel[i*4+1] -= 5*dt;
          if (dustVel[i*4+3] <= 0) dustPos[i*3+1] = -99;
        }
        dust.geometry.attributes.position.needsUpdate = true;
      },
      dispose(){
        bus.off("land", onLand);
        scene.remove(dust);
        dustGeo.dispose(); dust.material.dispose();
      },
    };
  },
};
