// Остаточные силуэты при рывке: в начале рывка «запекаем» текущую позу модели Ризи в одну геометрию
// (все меши в пространстве root, для SkinnedMesh — с учётом костей) и расставляем полупрозрачные копии
// вдоль пути. Один draw call на силуэт, пул из 4 штук. Модель не трогаем — только читаем её меши.
import * as THREE from "three";

const _inv = new THREE.Matrix4(), _m = new THREE.Matrix4(), _v = new THREE.Vector3();

export function createGhosts(count = 4){
  const group = new THREE.Group(); group.name = "dash-ghosts";
  let geo = new THREE.BufferGeometry();
  const pool = [];
  // два прохода на силуэт: сначала только глубина, потом цвет по ней — видна одна «оболочка», без наложений
  const depthMat = new THREE.MeshBasicMaterial({ colorWrite: false });
  for (let i = 0; i < count; i++){
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x7fc8ff), transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
    const mesh = new THREE.Mesh(geo, mat);
    const depth = new THREE.Mesh(geo, depthMat);
    for (const m of [mesh, depth]){ m.visible = false; m.frustumCulled = false; m.matrixAutoUpdate = false; group.add(m); }
    depth.renderOrder = 4; mesh.renderOrder = 5;
    pool.push({ mesh, depth, life: 0, max: 0.3 });
  }
  let next = 0;

  function bake(root){
    root.updateMatrixWorld(true);
    _inv.copy(root.matrixWorld).invert();
    const pos = [];
    root.traverse(o => {
      if (!o.isMesh || !o.visible || !o.geometry || !o.geometry.attributes.position) return;
      const g = o.geometry, P = g.attributes.position, idx = g.index;
      _m.multiplyMatrices(_inv, o.matrixWorld);
      const n = idx ? idx.count : P.count;
      if (n > 60000) return;
      for (let i = 0; i < n; i++){
        const k = idx ? idx.getX(i) : i;
        if (o.isSkinnedMesh && o.getVertexPosition) o.getVertexPosition(k, _v); else _v.fromBufferAttribute(P, k);
        _v.applyMatrix4(_m);
        pos.push(_v.x, _v.y, _v.z);
      }
    });
    const ng = new THREE.BufferGeometry();
    ng.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    ng.computeBoundingSphere();
    geo.dispose();
    geo = ng;
    for (const p of pool){ p.mesh.geometry = geo; p.depth.geometry = geo; }
  }

  return {
    group,
    // начало рывка: запечь позу
    start(root){ try { bake(root); } catch (e){ /* модель могла смениться — просто без силуэтов */ } },
    // поставить силуэт там, где сейчас модель
    spawn(root, tint = 0x7fc8ff){
      const p = pool[next]; next = (next + 1) % pool.length;
      root.updateMatrixWorld(true);
      for (const m of [p.mesh, p.depth]){ m.matrix.copy(root.matrixWorld); m.matrixWorldNeedsUpdate = true; m.visible = true; }
      p.mesh.material.color.set(tint);
      p.life = p.max;
    },
    update(dt){
      for (const p of pool){
        if (p.life <= 0) continue;
        p.life -= dt;
        const k = Math.max(0, p.life / p.max);
        p.mesh.material.opacity = 0.55 * k;
        if (p.life <= 0) p.mesh.visible = p.depth.visible = false;
      }
    },
    clear(){ for (const p of pool){ p.life = 0; p.mesh.visible = p.depth.visible = false; } },
  };
}
