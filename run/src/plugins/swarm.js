// БАЗОВЫЙ плагин роя (фолбэк = legacy/run.js): Гасители-кубиты висят над трассой за спиной Ризи.
import * as THREE from "three";

export default {
  name: "swarm",
  install(ctx){
    const { scene, util } = ctx;
    const { rnd, lerp } = util;
    const G = ctx.G;

    const mat = (color, o) => new THREE.MeshStandardMaterial(Object.assign({ color, roughness:.88, metalness:0 }, o||{}));
    function msh(geo, m, cast=true, recv=false){
      const x = new THREE.Mesh(geo, m); x.castShadow = cast; x.receiveShadow = recv; return x;
    }

    const swarm = new THREE.Group();
    const kubits = [];
    const kubitMat = mat(0x33344f,{roughness:.85});
    const kubitEye = new THREE.MeshStandardMaterial({ color:0x6b0018, emissive:0xff3a4e, emissiveIntensity:2.4, roughness:.4 });
    for (let i=0;i<14;i++){
      const k = new THREE.Group();
      k.add(msh(new THREE.SphereGeometry(0.17,12,10), kubitMat, false));
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.085,10,8), kubitEye);
      e.position.set(0,0,-0.12); k.add(e);
      for (const s of [-1,1]){
        const w = msh(new THREE.SphereGeometry(0.07,8,6), kubitMat, false);
        w.position.set(0.18*s, 0.09, 0); w.scale.set(1.5,.28,.85);
        k.add(w);
      }
      // рой держится ВЫШЕ головы и по краям — не перекрывает трассу
      k.userData = { ox:rnd(-3.4,3.4), oy:rnd(2.9,5.2), oz:rnd(-.8,.8), ph:rnd(0,7), sp:rnd(2,4) };
      swarm.add(k); kubits.push(k);
    }
    scene.add(swarm);

    return {
      swarm,
      update(dt){
        const perf = ctx.time.t;
        const nearK = G.swarmNear > 0 ? 1 : 0;
        const baseZ = G.mode==="play" ? lerp(9.5, 4.6, nearK) : 7.0;
        swarm.position.z = lerp(swarm.position.z, baseZ, Math.min(1,dt*2.2));
        swarm.position.y = 0.4;
        for (let i=0;i<kubits.length;i++){
          const k = kubits[i], u = k.userData;
          k.position.set(
            u.ox + Math.sin(perf*u.sp+u.ph)*0.5,
            u.oy + Math.sin(perf*u.sp*1.3+u.ph)*0.35,
            u.oz + Math.cos(perf*u.sp*0.7+u.ph)*0.5
          );
          k.rotation.y = Math.sin(perf*u.sp+u.ph)*0.6;
          k.rotation.z = Math.cos(perf*u.sp*1.1+u.ph)*0.25;
        }
      },
      dispose(){ scene.remove(swarm); },
    };
  },
};
