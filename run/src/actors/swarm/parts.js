// Гасители — детали: геометрия помпона, мех-оболочки, глаз, ореол, крылышки, пятно на снегу.
// Всё под InstancedMesh: один меш = один draw call на весь рой.
import * as THREE from "three";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

// ---------- РАЗМЕРЫ И ЦВЕТА (SWARM-1) ----------
export const DIM = {
  R: 0.45,                 // радиус помпона (диаметр 0.9 м)
  eyeR: 0.105,             // сфера глаза; горячее ядро ≈ 0.16 м в диаметре
  eyeDir: new THREE.Vector3(0, 0.12, 1).normalize(),   // глаз смотрит вперёд (+z) и чуть вверх
  furScale: 0.14,          // оболочки меха: 1.02..1.14 от радиуса
  wingPivot: new THREE.Vector3(0.33, 0.24, -0.12),     // корень правого крыла (левое — зеркально)
  glow: 0.9,               // ореол глаза, м
  decal: 1.8,              // пятно на земле, м
};
export const COL = {
  body: 0x151A3A, sheen: 0x5363D6, rim: 0x5A6BFF, wing: 0x1E2658, lid: 0x0A0E24,
  eye: 0xFF2436,
};

// ---------- ШУМ (детерминированный, только при сборке) ----------
function hash3(x, y, z){
  let h = (x * 374761393 + y * 668265263 + z * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise3(x, y, z){
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  let fx = x - xi, fy = y - yi, fz = z - zi;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
  const l = (a, b, t) => a + (b - a) * t;
  return l(
    l(l(hash3(xi, yi, zi), hash3(xi + 1, yi, zi), fx), l(hash3(xi, yi + 1, zi), hash3(xi + 1, yi + 1, zi), fx), fy),
    l(l(hash3(xi, yi, zi + 1), hash3(xi + 1, yi, zi + 1), fx), l(hash3(xi, yi + 1, zi + 1), hash3(xi + 1, yi + 1, zi + 1), fx), fy),
    fz);
}
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---------- ТЕЛО: икосаэдр с запечёнными комками, хохолком и гнездом под глаз ----------
export function bodyGeometry(detail){
  let g = new THREE.IcosahedronGeometry(DIM.R, detail);
  g.deleteAttribute("normal");
  g = mergeVertices(g, 1e-5);
  const p = g.attributes.position, v = new THREE.Vector3(), e = DIM.eyeDir;
  for (let i = 0; i < p.count; i++){
    v.fromBufferAttribute(p, i).normalize();
    // крупные комки войлока + мелкая «махра»
    const lump = vnoise3(v.x * 2.4 + 5, v.y * 2.4 + 1, v.z * 2.4 + 9) - 0.5;
    const fine = vnoise3(v.x * 7 + 3, v.y * 7 + 7, v.z * 7 + 1) - 0.5;
    let d = lump * 0.16 + fine * 0.05;
    d += 0.07 * sstep(0.8, 1, v.y) * (0.6 + vnoise3(v.x * 9, v.y * 9, v.z * 9));   // хохолок сверху
    const c = v.dot(e);
    d -= 0.12 * sstep(0.84, 0.975, c);                                           // гнездо глаза
    d += 0.045 * sstep(0.62, 0.8, c) * (1 - sstep(0.8, 0.9, c)) * Math.max(0, v.y - e.y * 0.8 + 0.1) * 4; // надбровный валик
    v.multiplyScalar(DIM.R * (1 + d));
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

// крылышко-лепесток: корень в (0,0,0), длина вдоль +x
export function wingGeometry(){
  const g = new THREE.SphereGeometry(1, 16, 10);
  const p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++){
    v.fromBufferAttribute(p, i);
    const t = (v.x + 1) * 0.5;                              // 0 у корня → 1 на кончике
    const w = 0.3 + 0.7 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.08)), 0.7);   // лепесток: шире к середине
    // длина 0.42 м, ширина 0.24 м, кончик загнут вверх и назад
    p.setXYZ(i, t * 0.42, v.y * 0.025 + t * t * 0.09, v.z * 0.12 * w - t * t * 0.06);
  }
  g.computeVertexNormals();
  return g;
}

// ---------- НОРМАЛИ «ВОЙЛОК» (если look.materials не загрузился) ----------
function fallbackNoiseNormal(){
  const W = 128, d = new Uint8Array(W * W * 4), h = new Float32Array(W * W);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++)
    h[y * W + x] = vnoise3(x / 8, y / 8, 0.5) * 0.6 + vnoise3(x / 2.5, y / 2.5, 3.5) * 0.4;
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++){
    const dx = (h[y * W + (x + 1) % W] - h[y * W + (x + W - 1) % W]) * 3;
    const dy = (h[((y + 1) % W) * W + x] - h[((y + W - 1) % W) * W + x]) * 3;
    const il = 1 / Math.hypot(dx, dy, 1), i = (y * W + x) * 4;
    d[i] = (-dx * il * 0.5 + 0.5) * 255; d[i + 1] = (-dy * il * 0.5 + 0.5) * 255; d[i + 2] = (il * 0.5 + 0.5) * 255; d[i + 3] = 255;
  }
  const t = new THREE.DataTexture(d, W, W);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true; t.needsUpdate = true;
  return t;
}

// ---------- GLSL ----------
const NOISE_GLSL = /* glsl */`
  float swHash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float swNoise(vec3 x){
    vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(swHash(i), swHash(i + vec3(1,0,0)), f.x), mix(swHash(i + vec3(0,1,0)), swHash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(swHash(i + vec3(0,0,1)), swHash(i + vec3(1,0,1)), f.x), mix(swHash(i + vec3(0,1,1)), swHash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }`;

// синий rim (#5A6BFF, pow 2.5, ×0.5) — вне освещения, чтобы силуэт читался и в тени, и на белом снегу
function addRim(shader, uniforms){
  shader.uniforms.uRimCol = uniforms.uRimCol;
  shader.uniforms.uRimK = uniforms.uRimK;
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <common>", "#include <common>\nuniform vec3 uRimCol;\nuniform float uRimK;")
    .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
      {
        vec3 rimV = isOrthographic ? vec3(0.0, 0.0, 1.0) : normalize(vViewPosition);
        float rimF = pow(1.0 - saturate(dot(normal, rimV)), 2.5);
        totalEmissiveRadiance += uRimCol * rimF * uRimK;
      }`);
}

// ---------- МАТЕРИАЛЫ ----------
export function createMaterials(opts){
  const { quality, look } = opts;
  const LOW = quality === "low";
  const src = look && look.tex && look.tex.noiseNormal;
  let noise;
  if (src){ noise = src.clone(); noise.repeat.set(4, 4); noise.needsUpdate = true; }
  else { noise = fallbackNoiseNormal(); noise.repeat.set(4, 4); }
  const ownNoise = noise;

  // общие uniform-ы: rim можно подкрутить на лету (например, ярче в погоне)
  const U = {
    uRimCol: { value: new THREE.Color(COL.rim) },
    uRimK: { value: 0.5 },
    uFurLen: { value: DIM.R * DIM.furScale },
    uLayers: { value: 1 },
    uEyeDir: { value: DIM.eyeDir.clone() },
    uEyeCol: { value: new THREE.Color(COL.eye) },
    uLidCol: { value: new THREE.Color(COL.lid) },
    uTime: { value: 0 },
  };

  const felt = (color, extra) => {
    const p = Object.assign({
      color, roughness: 1, metalness: 0,
      normalMap: noise, normalScale: new THREE.Vector2(0.7, 0.7),
    }, extra || {});
    const m = LOW ? new THREE.MeshStandardMaterial(p)
      : new THREE.MeshPhysicalMaterial(Object.assign(p, { sheen: 1, sheenColor: new THREE.Color(COL.sheen), sheenRoughness: 0.5 }));
    return m;
  };

  // тело
  const body = felt(COL.body);
  body.onBeforeCompile = sh => addRim(sh, U);
  body.customProgramCacheKey = () => "swarm-body";

  // крылышки: тот же войлок, чуть светлее и синее, чтобы форма читалась на фоне тела
  const wing = felt(COL.wing, { normalScale: new THREE.Vector2(0.3, 0.3) });
  wing.side = THREE.DoubleSide;
  wing.onBeforeCompile = sh => addRim(sh, U);
  wing.customProgramCacheKey = () => "swarm-wing";

  // оболочки меха: слой = gl_InstanceID % uLayers; номер дрона — в instanceColor.r (кит сортирует дроны
  // от дальнего к ближнему, и узор ворса не должен «перескакивать» вместе со слотом).
  // Ворс — 3D value-noise по направлению (без UV → ни швов, ни щипков на полюсах), порог растёт к кончикам.
  // Край ворсинки сглажен по fwidth и смешивается альфой (без MSAA в композере жёсткий discard давал «лесенку»).
  const fur = felt(COL.body, { normalScale: new THREE.Vector2(0.35, 0.35), transparent: true, depthWrite: true });
  fur.onBeforeCompile = sh => {
    addRim(sh, U);
    sh.uniforms.uFurLen = U.uFurLen; sh.uniforms.uLayers = U.uLayers; sh.uniforms.uEyeDir = U.uEyeDir;
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uFurLen;\nuniform int uLayers;\nvarying vec3 vFurN;\nvarying float vFurL;")
      .replace("#include <begin_vertex>", `#include <begin_vertex>
        float furL = (float(gl_InstanceID % uLayers) + 1.0) / float(uLayers);
        vFurL = furL;
        vFurN = normalize(position);
        transformed += normalize(objectNormal) * uFurLen * furL;
        transformed.y -= uFurLen * 0.35 * furL * furL;     // кончики чуть свисают`);
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec3 uEyeDir;\nvarying vec3 vFurN;\nvarying float vFurL;\n" + NOISE_GLSL)
      // свой color_fragment: vColor здесь не цвет, а номер дрона
      .replace("#include <color_fragment>", `
        {
          float furId = floor(vColor.r * 64.0);
          vec3 fp = vFurN * 11.0 + vec3(furId * 7.31, furId * 3.17, furId * 5.53);
          float n = swNoise(fp) * 0.62 + swNoise(fp * 2.9 + 4.1) * 0.38;
          float th = mix(0.3, 0.78, vFurL);
          float w = clamp(fwidth(n) * 1.25, 0.012, 0.12);
          float a = smoothstep(th - w, th + w, n);
          // гнездо глаза: ворс вокруг не лезет на глаз (тоже мягко)
          float ec = dot(vFurN, uEyeDir) - (0.9 - 0.05 * (1.0 - vFurL));
          a *= 1.0 - smoothstep(-0.02, 0.02, ec);
          // внешние слои чуть прозрачнее — кончики «пушатся», а не режутся
          a *= mix(1.0, 0.75, vFurL * vFurL);
          if (a < 0.04) discard;
          diffuseColor.a *= a;
          // корни темнее (самозатенение), кончики светлее — объём «махры»
          diffuseColor.rgb *= mix(0.4, 1.05, vFurL);
        }`);
  };
  fur.customProgramCacheKey = () => "swarm-fur";

  // глаз: HDR-красный (max-channel bloom), тёмный зрачок-щель, веко «хмурой дугой», мерцание — через instanceColor:
  //   r = интенсивность (emissive 2..7), g = раскрытие века 0..1, b = косина взгляда (зрачок)
  const eye = new THREE.MeshBasicMaterial({ color: 0xffffff });
  eye.onBeforeCompile = sh => {
    sh.uniforms.uEyeCol = U.uEyeCol; sh.uniforms.uLidCol = U.uLidCol; sh.uniforms.uEyeR = { value: DIM.eyeR };
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vEyeP;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvEyeP = position;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec3 uEyeCol;\nuniform vec3 uLidCol;\nuniform float uEyeR;\nvarying vec3 vEyeP;")
      .replace("#include <color_fragment>", `
        {
          vec3 q = vEyeP / uEyeR;                   // единичная сфера, фронт +z
          float I = vColor.r, open = vColor.g, look = vColor.b - 0.5;
          float d = length(q.xy);
          float aa = 0.06;
          // радужка: горячая в центре, чуть темнее к краю (ядро ≈ 0.16 м)
          float core = 1.0 - smoothstep(0.1, 0.76, d);
          vec3 c = uEyeCol * I * (0.35 + 0.9 * core);
          // белёсо-горячее кольцо вокруг зрачка → «раскалённый» глаз, но оттенок остаётся красным
          float ring = smoothstep(0.1, 0.2, abs(q.x - look * 0.4)) * (1.0 - smoothstep(0.2, 0.42, length(vec2(q.x - look * 0.4, q.y * 0.55))));
          c += vec3(1.0, 0.0, 0.03) * ring * I * 0.16;      // чистый красный и слабее: ACES + bloom не уводят в оранжевый
          // зрачок-щель
          // широко раскрытый глаз («попалась!»): зрачок сжимается в точку — длинная щель делила радужку на «сердечко»
          float wide = smoothstep(0.8, 0.92, open);
          float px = (q.x - look * 0.4) / mix(0.13, 0.17, wide), py = (q.y + 0.05 * wide) / mix(0.62, 0.2, wide);
          float pupil = 1.0 - smoothstep(0.85, 1.15, px * px + py * py);
          c = mix(c, vec3(0.03, 0.0, 0.005) * I, pupil * 0.95);
          // блик-искорка сверху слева (живой, «мультяшный» глаз)
          float gl = 1.0 - smoothstep(0.06, 0.11, length(q.xy - vec2(-0.4, -0.02)));
          c = mix(c, vec3(1.5, 1.2, 1.25), gl * 0.7);
          // веко: хмурая дуга «галочкой» (в центре ниже, к краям выше), тёмный войлок; open 0 = закрыт
          // изгиб слабее у широко раскрытого глаза, иначе у «попалась!» дуга с щелью зрачка читается как сердечко
          float lidY = mix(-1.05, 0.95, open) - mix(0.4, 0.18, smoothstep(0.6, 0.95, open)) * (1.0 - q.x * q.x);
          float lid = smoothstep(lidY - aa, lidY + aa, q.y);
          // нижняя кромка века: тонкая тёмная тень на раскалённом глазе + еле заметная синяя фаска
          float shade = smoothstep(lidY - 0.22, lidY, q.y) * (1.0 - lid);
          c *= 1.0 - 0.55 * shade;
          float edge = smoothstep(lidY - 0.02, lidY + 0.04, q.y) * (1.0 - smoothstep(lidY + 0.04, lidY + 0.12, q.y));
          c = mix(c, uLidCol + vec3(0.01, 0.015, 0.05) * edge, lid);
          // задняя сторона сферы — просто тёмная (утоплена в мех)
          c = mix(c, uLidCol, smoothstep(0.1, -0.2, q.z));
          diffuseColor.rgb = c;
        }`);
  };
  eye.customProgramCacheKey = () => "swarm-eye";

  // ореол глаза: биллборд, аддитивный; instanceColor.r = яркость
  const glow = new THREE.ShaderMaterial({
    uniforms: { uCol: U.uEyeCol },
    vertexShader: /* glsl */`
      varying vec2 vUv; varying float vI;
      void main(){
        vec4 mv = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float sc = length(instanceMatrix[0].xyz);
        mv.xy += position.xy * sc;
        mv.z += 0.3;                               // к камере: ореол не режется собственным мехом
        gl_Position = projectionMatrix * mv;
        vUv = uv; vI = instanceColor.r;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uCol; varying vec2 vUv; varying float vI;
      void main(){
        float d = length(vUv - 0.5) * 2.0;
        // тугое ядро у глаза + слабый широкий хвост: тело рядом не краснеет (иначе войлок уходит в фиолетовый)
        float a = exp(-d * d * 60.0) * 0.8 + exp(-d * d * 14.0) * 0.18 + exp(-d * d * 4.0) * 0.04 * (1.0 - smoothstep(0.7, 1.0, d));
        gl_FragColor = vec4(uCol * vI * a, a * 0.5);
      }`,
    transparent: true, depthWrite: false, depthTest: true,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor,
  });

  // пятно на земле: множитель (тень + «ложный красный свет»); instanceColor: r = тень, g = красный
  const decal = new THREE.ShaderMaterial({
    vertexShader: /* glsl */`
      varying vec2 vUv; varying vec2 vK;
      void main(){ vUv = uv; vK = instanceColor.rg; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      varying vec2 vUv; varying vec2 vK;
      void main(){
        float d = length(vUv - 0.5) * 2.0;
        float sh = exp(-d * d * 9.0) * vK.r;                 // тугая мягкая тень
        float rd = (1.0 - smoothstep(0.0, 1.0, d)) * vK.g;   // широкое красное пятно
        vec3 m = vec3(1.0) - sh * vec3(0.55, 0.5, 0.38) - rd * vec3(0.0, 0.75, 0.68);
        gl_FragColor = vec4(max(m, vec3(0.0)), 1.0);
      }`,
    transparent: true, depthWrite: false, depthTest: true,
    blending: THREE.CustomBlending,
    blendSrc: THREE.ZeroFactor, blendDst: THREE.SrcColorFactor,
    blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });

  return {
    U, body, wing, fur, eye, glow, decal,
    dispose(){
      for (const m of [body, wing, fur, eye, glow, decal]) m.dispose();
      ownNoise.dispose();
    },
  };
}
