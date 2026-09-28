// Сборка статической геометрии в один меш (один draw call на материал).
// Batch копит треугольники: позиция, нормаль, uv, цвет вершины (линейный), «дымка» aHaze (0…1, см.
// matlib.js withHaze) — затем build() → BufferGeometry. hazeFn(x, y, z) — функция дымки для всех
// следующих вершин (ставит строитель фасада на время одного блока; null — дымки нет).
import * as THREE from "three";

const _v = new THREE.Vector3(), _n = new THREE.Vector3(), _m3 = new THREE.Matrix3();
const _c = new THREE.Color();

// прототип: геометрия, заранее развёрнутая в неиндексированные массивы (для частого add с матрицей)
export function proto(geo){
  const g = geo.index ? geo.toNonIndexed() : geo;
  const pos = g.attributes.position.array.slice(), nor = g.attributes.normal.array.slice();
  const uv = g.attributes.uv ? g.attributes.uv.array.slice() : new Float32Array(pos.length / 3 * 2);
  if (g !== geo) g.dispose();
  geo.dispose();
  return { pos, nor, uv, count: pos.length / 3 };
}

export class Batch {
  constructor(){ this.p = []; this.n = []; this.uv = []; this.c = []; this.h = []; this.hazeFn = null; }

  _haze(x, y, z){ this.h.push(this.hazeFn ? this.hazeFn(x, y, z) : 0); }

  // четырёхугольник a-b-c-d против часовой (видимая сторона), нормаль считается сама
  quad(a, b, c, d, uvs = null, color = 0xffffff){
    _c.set(color);
    const e1 = new THREE.Vector3().subVectors(b, a), e2 = new THREE.Vector3().subVectors(d, a);
    const nn = new THREE.Vector3().crossVectors(e1, e2).normalize();
    const U = uvs || [[0, 0], [1, 0], [1, 1], [0, 1]];
    const P = [a, b, c, d];
    for (const i of [0, 1, 2, 0, 2, 3]){
      this.p.push(P[i].x, P[i].y, P[i].z); this.n.push(nn.x, nn.y, nn.z);
      this.uv.push(U[i][0], U[i][1]); this.c.push(_c.r, _c.g, _c.b);
      this._haze(P[i].x, P[i].y, P[i].z);
    }
  }

  // одна вершина с явными данными (для строителей профилей в arch.js)
  vert(x, y, z, nx, ny, nz, u, v, r, g, b){
    this.p.push(x, y, z); this.n.push(nx, ny, nz); this.uv.push(u, v); this.c.push(r, g, b);
    this._haze(x, y, z);
  }

  // любая BufferGeometry с матрицей и цветом (или функцией цвета от вершины и нормали);
  // uvConst — [u, v] для всех вершин (гладкое золото: см. matlib GOLD_PLAIN_UV)
  add(geo, matrix, color = 0xffffff, uvConst = null){
    const g = geo.index ? geo.toNonIndexed() : geo;
    const pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv;
    _m3.getNormalMatrix(matrix);
    const fn = typeof color === "function";
    if (!fn) _c.set(color);
    for (let i = 0; i < pos.count; i++){
      _v.fromBufferAttribute(pos, i).applyMatrix4(matrix);
      _n.fromBufferAttribute(nor, i).applyMatrix3(_m3).normalize();
      this.p.push(_v.x, _v.y, _v.z); this.n.push(_n.x, _n.y, _n.z);
      if (uvConst) this.uv.push(uvConst[0], uvConst[1]); else this.uv.push(uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0);
      if (fn) _c.set(color(_v, _n, i));
      this.c.push(_c.r, _c.g, _c.b);
      this._haze(_v.x, _v.y, _v.z);
    }
    if (g !== geo) g.dispose();
  }

  // прототип (см. proto()) с матрицей: быстрее add() — без BufferAttribute и toNonIndexed на каждый вызов.
  // uvMap: null — uv прототипа; [u, v] — постоянный uv; функция (x, y, z, i) → [u, v] — свой uv
  addProto(pr, matrix, color = 0xffffff, uvMap = null){
    _m3.getNormalMatrix(matrix);
    const e = matrix.elements, fn = typeof color === "function";
    if (!fn) _c.set(color);
    const P = pr.pos, N = pr.nor, U = pr.uv;
    for (let i = 0; i < pr.count; i++){
      const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
      const wx = e[0] * x + e[4] * y + e[8] * z + e[12], wy = e[1] * x + e[5] * y + e[9] * z + e[13], wz = e[2] * x + e[6] * y + e[10] * z + e[14];
      _n.set(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]).applyMatrix3(_m3).normalize();
      this.p.push(wx, wy, wz); this.n.push(_n.x, _n.y, _n.z);
      if (!uvMap) this.uv.push(U[i * 2], U[i * 2 + 1]);
      else if (typeof uvMap === "function"){ const t = uvMap(wx, wy, wz, i); this.uv.push(t[0], t[1]); }
      else this.uv.push(uvMap[0], uvMap[1]);
      if (fn){ _v.set(wx, wy, wz); _c.set(color(_v, _n, i)); }
      this.c.push(_c.r, _c.g, _c.b);
      this._haze(wx, wy, wz);
    }
  }

  // коробка по углам (x0,y0,z0)-(x1,y1,z1); faces — какие грани нужны; colors — {px,nx,py,ny,pz,nz} или один цвет
  box(x0, y0, z0, x1, y1, z1, colors, faces = "pxnxpynypznz"){
    const col = k => typeof colors === "object" ? (colors[k] ?? colors.all ?? 0xffffff) : colors;
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    if (faces.includes("pz")) this.quad(V(x0, y0, z1), V(x1, y0, z1), V(x1, y1, z1), V(x0, y1, z1), null, col("pz"));
    if (faces.includes("nz")) this.quad(V(x1, y0, z0), V(x0, y0, z0), V(x0, y1, z0), V(x1, y1, z0), null, col("nz"));
    if (faces.includes("py")) this.quad(V(x0, y1, z1), V(x1, y1, z1), V(x1, y1, z0), V(x0, y1, z0), null, col("py"));
    if (faces.includes("ny")) this.quad(V(x0, y0, z0), V(x1, y0, z0), V(x1, y0, z1), V(x0, y0, z1), null, col("ny"));
    if (faces.includes("px")) this.quad(V(x1, y0, z1), V(x1, y0, z0), V(x1, y1, z0), V(x1, y1, z1), null, col("px"));
    if (faces.includes("nx")) this.quad(V(x0, y0, z0), V(x0, y0, z1), V(x0, y1, z1), V(x0, y1, z0), null, col("nx"));
  }

  get empty(){ return this.p.length === 0; }

  build(){
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.c, 3));
    // aHaze всегда есть (иначе у материала с дымкой атрибут читал бы случайное «общее» значение WebGL)
    g.setAttribute("aHaze", new THREE.Float32BufferAttribute(this.h.length === this.p.length / 3 ? this.h : new Float32Array(this.p.length / 3), 1));
    g.computeBoundingSphere();
    return g;
  }
}

// плоская фигура (THREE.Shape) в плоскости XY на глубине z, цвет вершин — в Batch
export function addShape(batch, shape, z, color, segs = 12){
  const geo = new THREE.ShapeGeometry(shape, segs);
  batch.add(geo, new THREE.Matrix4().makeTranslation(0, 0, z), color);
  geo.dispose();
}
