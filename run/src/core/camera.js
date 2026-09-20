// Камера (CAM-1..5): риг раннера, FOV от интенсивности и кики, крен, тряска trauma², облёт на титуле,
// пролёт в забег, камера поимки. Всё на realDt. Без аллокаций в update().
import { easeOutQuad, easeOutCubic, easeInOutCubic } from "./ease.js";

const DEG = Math.PI / 180;

export function createCameraRig({ THREE, camera, cfg, G, getCurve }){
  const CAM = cfg.CAM, CT = cfg.CAM_TITLE, CS = cfg.CAM_SWOOP, CC = cfg.CAM_CATCH, TR = cfg.TRAUMA, LANES = cfg.LANES;
  const damp = (a, b, l, dt) => a + (b - a) * (1 - Math.exp(-l * dt));

  // ---------- кики FOV (CAM-2) ----------
  // значение: атака easeOutCubic до amp, затем экспонента с tau; hold держит amp, пока не отпустят
  const KICKS = {
    boost:  { amp: 8,    attack: 0.15, tau: 0.2,  t: 9, hold: false },
    hit:    { amp: 5,    attack: 0.06, tau: 0.15, t: 9, hold: false },
    big:    { amp: 3,    attack: 0.05, tau: 0.25, t: 9, hold: false },   // рубеж / tier-up
    near:   { amp: 2,    attack: 0.04, tau: 0.15, t: 9, hold: false },
    tunIn:  { amp: -3,   attack: 0.35, tau: 0.25, t: 9, hold: false },
    tunOut: { amp: 4,    attack: 0.05, tau: 0.3,  t: 9, hold: false },
    land:   { amp: -1.5, attack: 0.03, tau: 0.06, t: 9, hold: false },
  };
  const KLIST = Object.values(KICKS);
  function kickValue(k){
    if (k.hold) return k.amp * easeOutCubic(k.t / k.attack);
    if (k.t < k.attack) return k.amp * easeOutCubic(k.t / k.attack);
    const x = (k.t - k.attack) / k.tau;
    return x > 8 ? 0 : k.amp * Math.exp(-x);
  }
  function kick(name, on){
    const k = KICKS[name]; if (!k) return;
    if (on === false){
      // отпуск удерживаемого: продолжить спад с текущего значения
      if (k.hold){ k.hold = false; k.t = k.attack; }
      return;
    }
    k.t = 0; k.hold = on === true;
  }

  // ---------- состояние ----------
  const rig = { x: 0, y: CAM.y, fov: CAM.fov, lastFov: -1, tunnelY: 0 };
  const mode = { name: "title", t: 0, dur: 1, retry: false, freeDir: 1 };
  const pos0 = new THREE.Vector3(), quat0 = new THREE.Quaternion(), fov0 = { v: CT.fov };
  const pRun = new THREE.Vector3(), qRun = new THREE.Quaternion();
  const mid = new THREE.Vector3();
  const curvePts = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const path = new THREE.CatmullRomCurve3(curvePts, false, "centripetal");
  const dummy = new THREE.Object3D();
  const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3(), look = new THREE.Vector3();
  const tmpQ = new THREE.Quaternion();
  const catchPos = new THREE.Vector3(), catchLook = new THREE.Vector3(), catchQ = new THREE.Quaternion();
  const out = { fovNoKick: CAM.fov };

  // поза забега → dummy (позиция + ориентация, без тряски)
  function runPose(dt, obj){
    const I = G.intensity, py = G.py, portrait = camera.aspect < 1;
    rig.x = damp(rig.x, G.x * 0.5, 6, dt);
    rig.y = damp(rig.y, (portrait ? CAM.portraitY : CAM.y) + py * 0.18, 5, dt);
    const tn = G.tunnel || 0;
    rig.tunnelY = damp(rig.tunnelY, -0.4 * tn, 1 / 0.35 * 3, dt);
    obj.position.set(rig.x, rig.y + rig.tunnelY, CAM.z + CAM.zI * I);
    look.set(G.x * 0.6, CAM.lookY + py * 0.3, CAM.lookZ);
    obj.up.set(0, 1, 0);
    obj.lookAt(look);
    // крен: к целевой полосе + лёгкий от бокового покачивания мира
    const curve = getCurve();
    let sway = 0;
    if (curve && curve.enabled === false) sway = 0;                          // изгиб выключен — крена от покачивания нет
    else if (curve && typeof curve.sway === "number") sway = curve.sway;     // uSway −1..1
    else if (curve && curve.uniforms && curve.uniforms.bendX){
      const sx = (curve.opts && curve.opts.swayX) || 0.0012;
      sway = Math.max(-1, Math.min(1, curve.uniforms.bendX.value / sx));
    }
    const roll = G.reducedMotion ? 0 : -(LANES[G.lane] - G.x) * CAM.roll + sway * CAM.swayRoll;
    obj.rotateZ(roll);
  }

  function titlePose(t, obj){
    const phi = CT.phi + CT.phiAmp * Math.sin(2 * Math.PI * t / CT.period);
    obj.position.set(CT.r * Math.sin(phi), CT.y, -CT.r * Math.cos(phi));
    obj.up.set(0, 1, 0);
    look.set(CT.target[0], CT.target[1], CT.target[2]);
    obj.lookAt(look);
  }

  function fovRun(){
    const RM = G.reducedMotion;
    let f = CAM.fov + (camera.aspect < 1 ? CAM.portraitFov : 0);
    if (!RM) f += CAM.fovI * easeOutQuad(G.intensity);
    out.fovNoKick = f;
    if (!RM){
      let k = 0;
      for (let i = 0; i < KLIST.length; i++) k += kickValue(KLIST[i]);
      f += Math.max(-8, Math.min(10, k));
    }
    return f;
  }

  function setFov(f){
    camera.fov = f;
    if (Math.abs(f - rig.lastFov) > 0.02){ rig.lastFov = f; camera.updateProjectionMatrix(); }
  }

  // ---------- переходы ----------
  function toTitle(){ mode.name = "title"; mode.t = 0; }
  function startSwoop(retry){
    pos0.copy(camera.position); quat0.copy(camera.quaternion); fov0.v = camera.fov;
    mode.name = "swoop"; mode.t = 0; mode.retry = !!retry;
    mode.dur = retry ? CS.retry : CS.dur;
    rig.x = G.x * 0.5; rig.y = CAM.y;
    // reduced motion: без пролёта (кроссфейд делает main через #fade)
    if (G.reducedMotion) mode.dur = 0.0001;
  }
  function startCatch(freeDir){
    mode.name = "catch"; mode.t = 0; mode.freeDir = freeDir || 1;
    pos0.copy(camera.position); quat0.copy(camera.quaternion); fov0.v = camera.fov;
    // облёт на 25° вокруг Ризи в сторону свободной полосы, отъезд назад и вверх
    const pivotX = G.x;
    tmpV.copy(camera.position); tmpV.x -= pivotX; tmpV.y = 0;
    tmpV.applyAxisAngle(tmpV2.set(0, 1, 0), -mode.freeDir * CC.orbit * DEG);
    catchPos.set(pivotX + tmpV.x, camera.position.y + CC.up, tmpV.z + CC.back);
    catchLook.set(G.x, 1.0, -5);
    dummy.position.copy(catchPos); dummy.up.set(0, 1, 0); dummy.lookAt(catchLook);
    catchQ.copy(dummy.quaternion);
  }

  // ---------- кадр ----------
  function update(dt, titleClock){
    mode.t += dt;
    for (let i = 0; i < KLIST.length; i++) KLIST[i].t += dt;

    if (mode.name === "title"){
      titlePose(titleClock, camera);
      setFov(CT.fov + (camera.aspect < 1 ? CAM.portraitFov : 0));
    } else if (mode.name === "swoop"){
      const u = Math.min(1, mode.t / mode.dur), e = easeInOutCubic(u);
      runPose(dt, dummy);
      pRun.copy(dummy.position); qRun.copy(dummy.quaternion);
      if (mode.retry){
        camera.position.lerpVectors(pos0, pRun, e);
      } else {
        mid.set(CS.mid[0], CS.mid[1], CS.mid[2]);
        curvePts[0].copy(pos0); curvePts[1].copy(mid); curvePts[2].copy(pRun);
        path.getPoint(e, camera.position);
      }
      tmpQ.copy(quat0).slerp(qRun, e);
      camera.quaternion.copy(tmpQ);
      setFov(fov0.v + (fovRun() - fov0.v) * e);
      if (u >= 1) mode.name = "run";
    } else if (mode.name === "catch"){
      const e = easeInOutCubic(mode.t / CC.dur);
      camera.position.lerpVectors(pos0, catchPos, e);
      tmpQ.copy(quat0).slerp(catchQ, e);
      camera.quaternion.copy(tmpQ);
      fovRun();
      rig.fov = damp(camera.fov, out.fovNoKick, 4, dt);
      setFov(rig.fov);
    } else {
      runPose(dt, camera);
      rig.fov = damp(camera.fov, fovRun(), 4, dt);
      setFov(rig.fov);
    }

    // тряска trauma² (Eiserloh): после ориентации, поворот + сдвиг
    const shake = G.reducedMotion ? 0 : G.trauma * G.trauma;
    if (shake > 1e-5 && mode.name !== "title"){
      const t = titleClock;
      const n0 = 0.6 * Math.sin(13.1 * t) + 0.4 * Math.sin(21.7 * t);
      const n1 = 0.6 * Math.sin(13.1 * t + 1.7) + 0.4 * Math.sin(21.7 * t + 3.91);
      const n2 = 0.6 * Math.sin(13.1 * t + 3.9) + 0.4 * Math.sin(21.7 * t + 8.97);
      camera.rotateZ(TR.rotZ * DEG * shake * n0);
      camera.rotateY(TR.rotY * DEG * shake * n1);
      camera.rotateX(TR.rotX * DEG * shake * n2);
      camera.translateX(TR.offX * shake * n1);
      camera.translateY(TR.offY * shake * n2);
    }
    camera.updateMatrixWorld();
  }

  return { update, kick, toTitle, startSwoop, startCatch, mode, rig, get fovNoKick(){ return out.fovNoKick; } };
}
