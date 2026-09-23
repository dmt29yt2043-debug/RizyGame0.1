// Сборка статической геометрии в один меш (один draw call на материал).
// Batch копит треугольники: позиция, нормаль, uv, цвет вершины (линейный), затем build() → BufferGeometry.
import * as THREE from "three";

const _v = new THREE.Vector3(), _n = new THREE.Vector3(), _m3 = new THREE.Matrix3();
const _c = new THREE.Color();

export class Batch {
  constructor(){ this.p = []; this.n = []; this.uv = []; this.c = []; }

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
    }
  }

  // любая BufferGeometry с матрицей и цветом (или функцией цвета от вершины и нормали)
  add(geo, matrix, color = 0xffffff){
    const g = geo.index ? geo.toNonIndexed() : geo;
    const pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv;
    _m3.getNormalMatrix(matrix);
    for (let i = 0; i < pos.count; i++){
      _v.fromBufferAttribute(pos, i).applyMatrix4(matrix);
      _n.fromBufferAttribute(nor, i).applyMatrix3(_m3).normalize();
      this.p.push(_v.x, _v.y, _v.z); this.n.push(_n.x, _n.y, _n.z);
      this.uv.push(uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0);
      if (typeof color === "function") _c.set(color(_v, _n, i)); else _c.set(color);
      this.c.push(_c.r, _c.g, _c.b);
    }
    if (g !== geo) g.dispose();
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
