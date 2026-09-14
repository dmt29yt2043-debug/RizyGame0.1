// Ризи RUN v3 — look/materials.js
// Окружение (PMREM из процедурного неба) + фабрика материалов «войлок / леденец / снег / дерево / лёд / металл / свечение»
// + общие процедурные текстуры. Модулю нужны только ctx.THREE, ctx.renderer, ctx.scene, ctx.quality.

// ---------- ДЕТЕРМИНИРОВАННЫЙ ШУМ (свой ГПСЧ: текстуры одинаковы при любом ?seed) ----------
function makeRng(seed){
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// тайлящийся value-noise на решётке Px×Py; x,y — в клетках решётки
function lattice(Px, Py, seed){
  const r = makeRng(seed), g = new Float32Array(Px * Py);
  for (let i = 0; i < g.length; i++) g[i] = r();
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    let fx = x - xi, fy = y - yi;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const x0 = ((xi % Px) + Px) % Px, y0 = ((yi % Py) + Py) % Py;
    const x1 = (x0 + 1) % Px, y1 = (y0 + 1) % Py;
    const a = g[y0 * Px + x0], b = g[y0 * Px + x1], c = g[y1 * Px + x0], d = g[y1 * Px + x1];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}
// fbm по u,v ∈ [0,1): каждая октава тайлится (период удваивается)
function fbm(Px, Py, oct, seed){
  const L = [];
  for (let k = 0; k < oct; k++) L.push([lattice(Px << k, Py << k, seed + k * 131), Px << k, Py << k]);
  return (u, v) => {
    let s = 0, amp = 0.5, n = 0;
    for (let k = 0; k < oct; k++){ s += L[k][0](u * L[k][1], v * L[k][2]) * amp; n += amp; amp *= 0.5; }
    return s / n;
  };
}
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export async function createLook(ctx){
  const THREE = ctx.THREE, renderer = ctx.renderer, scene = ctx.scene;
  const Q = ctx.quality === "low" ? "low" : ctx.quality === "high" ? "high" : "med";
  const LOW = Q === "low", HIGH = Q === "high";
  const S = LOW ? 512 : 1024;                       // размер тайлов земли/дерева/шума
  const ANISO = Math.min(LOW ? 4 : 8, renderer.capabilities.getMaxAnisotropy());
  // уступаем цикл событий между тяжёлыми генерациями (MessageChannel: таймеры фоновых вкладок троттлятся)
  const tick = () => new Promise(r => { const ch = new MessageChannel(); ch.port1.onmessage = () => r(); ch.port2.postMessage(0); });
  const WHITE = new THREE.Color(0xffffff);

  // ---------- ОБЩИЕ УТИЛИТЫ ТЕКСТУР ----------
  function dataTex(data, W, H, srgb){
    const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true; t.anisotropy = ANISO;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  }
  // нормали из поля высот (центральные разности с заворотом → шов не виден); k — крутизна на 1024 px
  function normalFromHeight(h, W, H, k){
    const d = new Uint8Array(W * H * 4), s = k * W / 1024;
    for (let y = 0; y < H; y++){
      const yu = ((y + 1) % H) * W, yd = ((y - 1 + H) % H) * W, yr = y * W;
      for (let x = 0; x < W; x++){
        const xr = (x + 1) % W, xl = (x - 1 + W) % W;
        const dx = (h[yr + xr] - h[yr + xl]) * s, dy = (h[yu + x] - h[yd + x]) * s;
        const il = 1 / Math.sqrt(dx * dx + dy * dy + 1), i = (yr + x) * 4;
        d[i] = (-dx * il * 0.5 + 0.5) * 255; d[i + 1] = (-dy * il * 0.5 + 0.5) * 255; d[i + 2] = (il * 0.5 + 0.5) * 255; d[i + 3] = 255;
      }
    }
    return dataTex(d, W, H, false);
  }
  function canvasTex(w, h, draw, srgb = true){
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    draw(c.getContext("2d"), w, h);
    const t = new THREE.CanvasTexture(c);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = ANISO;
    return t;
  }
  const rgb = c => { const x = new THREE.Color(c).getHex(); return [(x >> 16) & 255, (x >> 8) & 255, x & 255]; };

  // ---------- ОКРУЖЕНИЕ: небо-градиент + тёплое солнце → PMREM ----------
  function buildEnv(){
    const sky = new THREE.Scene();
    const col = (hex, k) => new THREE.Color(hex).multiplyScalar(k);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, depthTest: false,
      uniforms: {
        // яркость неба ~0.3: в r160 диффуз от окружения = PI·env, так что 0.3 ≈ полусфера интенсивностью ~1
        uZen: { value: col("#6ab4f0", 0.30) },     // холодный зенит
        uMid: { value: col("#b4e0ff", 0.34) },
        uHor: { value: col("#ffe4d8", 0.50) },     // кремово-розовый горизонт
        uGnd: { value: col("#f2f6ff", 0.62) },     // отсвет освещённого снега снизу (он ярче неба) — не даёт лаку темнеть по краям
        uSun: { value: col("#fff0d2", 1.0) },
        uSunDir: { value: new THREE.Vector3(11, 17, 7).normalize() },   // как солнце в игре
      },
      vertexShader: `varying vec3 vDir;
        void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `varying vec3 vDir;
        uniform vec3 uZen, uMid, uHor, uGnd, uSun, uSunDir;
        void main(){
          vec3 d = normalize(vDir); float y = d.y;
          vec3 sky = mix(uHor, uMid, smoothstep(0.0, 0.28, y));
          sky = mix(sky, uZen, smoothstep(0.25, 1.0, y));
          vec3 c = y >= 0.0 ? sky : mix(uHor, uGnd, smoothstep(0.0, 0.18, -y));
          float s = max(dot(d, uSunDir), 0.0);
          // диск (HDR, для бликов лака) + мягкий ореол + тёплая дымка вокруг
          c += uSun * (pow(s, 1400.0) * 24.0 + pow(s, 90.0) * 0.5 + pow(s, 6.0) * 0.12);
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    const geo = new THREE.SphereGeometry(10, 48, 24);
    sky.add(new THREE.Mesh(geo, mat));
    const pm = new THREE.PMREMGenerator(renderer);
    const rt = pm.fromScene(sky, 0.015, 0.1, 100);
    pm.dispose(); geo.dispose(); mat.dispose();
    rt.texture.name = "look:env";
    return rt.texture;
  }
  const tEnv = performance.now();
  const env = buildEnv();
  const msEnv = Math.round(performance.now() - tEnv);
  scene.environment = env;

  // ---------- ТЕКСТУРЫ ----------
  // шум нормалей «войлок»: средние комочки + мелкие ворсинки
  function buildNoiseNormal(){
    const W = S, h = new Float32Array(W * W);
    const lump = fbm(12, 12, 3, 11), fib = fbm(96, 96, 2, 29);
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++){
      const u = x / W, v = y / W;
      h[y * W + x] = lump(u, v) * 0.65 + fib(u, v) * 0.35;
    }
    const t = normalFromHeight(h, W, W, 5.5); t.name = "look:noiseNormal"; return t;
  }

  // снег: высоты (дюны + зерно), альбедо (впадины чуть голубее), редкие искры для bloom
  function buildSnow(){
    const W = S, N = W * W, h = new Float32Array(N);
    const dune = fbm(4, 4, 3, 7), grain = fbm(48, 48, 2, 53), patch = fbm(3, 3, 3, 91);
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++){
      const u = x / W, v = y / W;
      h[y * W + x] = dune(u, v) * 0.8 + grain(u, v) * 0.2;
    }
    const normal = normalFromHeight(h, W, W, 5); normal.name = "look:snowNormal";
    const alb = new Uint8Array(N * 4);
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++){
      const i = y * W + x, u = x / W, v = y / W;
      // впадины и крупные пятна — едва заметный холодный оттенок, гребни — тёплый белый
      const cold = smooth(0.62, 0.3, h[i]) * 0.55 + smooth(0.45, 0.72, patch(u, v)) * 0.45;
      const j = i * 4;
      alb[j] = 255 - cold * 20; alb[j + 1] = 255 - cold * 11; alb[j + 2] = 255 - cold * 1; alb[j + 3] = 255;
    }
    const albedo = dataTex(alb, W, W, true); albedo.name = "look:snowGround";
    // искры: чёрный фон, редкие мягкие точки 1–2 px; ярких мало, тусклых много
    const sp = new Uint8Array(N * 4), r = makeRng(4242), cnt = Math.round(N / 2600);
    for (let i = 3; i < sp.length; i += 4) sp[i] = 255;
    for (let n = 0; n < cnt; n++){
      const cx = r() * W, cy = r() * W, rad = (0.7 + r() * 0.8) * W / 1024 + 0.35, I = Math.pow(r(), 2.2);
      const tint = r();
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++){
        const px = ((Math.floor(cx) + dx) % W + W) % W, py = ((Math.floor(cy) + dy) % W + W) % W;
        const ddx = Math.floor(cx) + dx + 0.5 - cx, ddy = Math.floor(cy) + dy + 0.5 - cy;
        const a = Math.exp(-(ddx * ddx + ddy * ddy) / (rad * rad)) * I;
        if (a < 0.01) continue;
        const j = (py * W + px) * 4;
        sp[j]     = Math.min(255, sp[j]     + a * (tint < 0.3 ? 200 : 255));
        sp[j + 1] = Math.min(255, sp[j + 1] + a * 250);
        sp[j + 2] = Math.min(255, sp[j + 2] + a * (tint > 0.7 ? 200 : 255));
      }
    }
    const sparkleMap = dataTex(sp, W, W, true); sparkleMap.name = "look:snowSparkle";
    return { normal, albedo, sparkleMap };
  }

  // дерево: 8 поперечных досок на тайл, стыки вразбежку, волокна, щели; ORM: R = AO, G = шероховатость
  function buildWood(){
    const W = S, N = W * W, P = 8, ph = W / P;
    const COLS = ["#f0cfa4", "#e6c096", "#f5d7ad", "#dfb98e"].map(rgb);
    const r = makeRng(1717), plank = [];
    for (let i = 0; i < P; i++){
      plank.push({ joint: r() < 0.7 ? r() : -1, cA: COLS[Math.floor(r() * 4)], cB: COLS[Math.floor(r() * 4)],
                   kA: 0.92 + r() * 0.12, kB: 0.92 + r() * 0.12, off: r() * 10, knot: r() < 0.35 ? [r(), 0.3 + r() * 0.4] : null });
    }
    const warp = fbm(3, 8, 3, 303), fine = fbm(64, 256, 2, 404), blot = fbm(4, 16, 2, 505);
    const h = new Float32Array(N), alb = new Uint8Array(N * 4), orm = new Uint8Array(N * 4);
    const gap = 3.2 * W / 1024, bevel = 13 * W / 1024;
    for (let y = 0; y < W; y++){
      const pi = Math.floor(y / ph), fv = y / ph - pi, pl = plank[pi], v = y / W;
      const dy = Math.min(fv, 1 - fv) * ph;
      for (let x = 0; x < W; x++){
        const u = x / W, i = y * W + x, j = i * 4;
        let dx = 1e9, seg = 0;
        if (pl.joint >= 0){
          const dd = Math.abs(u - pl.joint) * W; dx = Math.min(dd, W - dd);
          seg = u >= pl.joint ? 1 : 0;
        }
        const d = Math.min(dy, dx);
        const edge = smooth(gap, gap + bevel, d);            // 0 в щели → 1 на плоскости доски
        // волокна: изогнутые линии вдоль доски (u), фаза из шума — тайлится по u
        let t = (fv * 1.0 + (warp(u, v) - 0.5) * 0.9 + pl.off + seg * 0.37) * 9;
        if (pl.knot){
          const kx = Math.min(Math.abs(u - pl.knot[0]), 1 - Math.abs(u - pl.knot[0])) * W / ph * 0.5, ky = fv - pl.knot[1];
          const kr = Math.sqrt(kx * kx * 0.25 + ky * ky);
          t += Math.exp(-kr * kr * 60) * 2.5 + (kr < 0.12 ? (0.12 - kr) * 20 : 0);
        }
        const s = t - Math.floor(t);
        const line = Math.pow(1 - Math.abs(s - 0.5) * 2, 6);   // тонкая тёмная прожилка
        const t2 = t * 2.7 + 0.3, s2 = t2 - Math.floor(t2);
        const line2 = Math.pow(1 - Math.abs(s2 - 0.5) * 2, 10) * 0.5; // вторичные частые волокна
        const fn = fine(u, v);
        const col = seg ? pl.cB : pl.cA, k = seg ? pl.kB : pl.kA;
        const shade = k * (1 - line * 0.2 - line2 * 0.1) * (0.94 + fn * 0.08) * (0.9 + blot(u, v) * 0.16) * (0.8 + edge * 0.2);
        const gapT = 1 - smooth(gap * 0.4, gap + 1.5, d);
        // волокна уводим в более тёплый/насыщенный тон, щели — тёмный орех
        const warm = 1 - (line + line2) * 0.08;
        alb[j]     = Math.min(255, col[0] * shade * (1 - gapT) + 96 * gapT);
        alb[j + 1] = Math.min(255, col[1] * shade * warm * (1 - gapT) + 60 * gapT);
        alb[j + 2] = Math.min(255, col[2] * shade * warm * warm * (1 - gapT) + 36 * gapT);
        alb[j + 3] = 255;
        h[i] = edge * 0.9 - line * 0.06 - line2 * 0.03 + fn * 0.05;
        orm[j] = 255 * (0.55 + 0.45 * edge);                 // AO в щелях
        orm[j + 1] = 255 * Math.min(1, 0.62 + line * 0.12 + (1 - fn) * 0.1 + (1 - edge) * 0.3);
        orm[j + 2] = 0; orm[j + 3] = 255;
      }
    }
    const albedo = dataTex(alb, W, W, true); albedo.name = "look:woodPlanks";
    const normal = normalFromHeight(h, W, W, 3.0); normal.name = "look:woodNormal";
    const ormT = dataTex(orm, W, W, false); ormT.name = "look:woodOrm";
    return { albedo, normal, orm: ormT };
  }

  // мягкая круглая точка (вместо квадратных пикселей снега/частиц)
  const softDot = canvasTex(128, 128, (g, w) => {
    const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    gr.addColorStop(0.00, "rgba(255,255,255,1)");
    gr.addColorStop(0.35, "rgba(255,255,255,.85)");
    gr.addColorStop(0.65, "rgba(255,255,255,.32)");
    gr.addColorStop(1.00, "rgba(255,255,255,0)");
    g.fillStyle = gr; g.fillRect(0, 0, w, w);
  });
  softDot.name = "look:softDot";
  // четырёхлучевая звёздочка-блик
  const sparkle = canvasTex(128, 128, (g, w) => {
    const im = g.createImageData(w, w), c = w / 2;
    for (let y = 0; y < w; y++) for (let x = 0; x < w; x++){
      const dx = (x + 0.5 - c) / c, dy = (y + 0.5 - c) / c, r2 = dx * dx + dy * dy;
      const ax = Math.abs(dx), ay = Math.abs(dy);
      const ray = Math.exp(-ay * ay * 900) * Math.pow(Math.max(0, 1 - ax), 2.2) + Math.exp(-ax * ax * 900) * Math.pow(Math.max(0, 1 - ay), 2.2);
      const du = Math.abs(dx + dy) * 0.7071, dv = Math.abs(dx - dy) * 0.7071;
      const diag = (Math.exp(-dv * dv * 1400) * Math.pow(Math.max(0, 1 - du * 2.4), 2) + Math.exp(-du * du * 1400) * Math.pow(Math.max(0, 1 - dv * 2.4), 2)) * 0.35;
      const a = Math.min(1, ray + diag + Math.exp(-r2 * 60) * 0.9 + Math.exp(-r2 * 8) * 0.18);
      const i = (y * w + x) * 4;
      im.data[i] = 255; im.data[i + 1] = 255; im.data[i + 2] = 255; im.data[i + 3] = a * 255;
    }
    g.putImageData(im, 0, 0);
  });
  sparkle.name = "look:sparkle";

  const ms = {}, T = (k, f) => { const t = performance.now(), r = f(); ms[k] = Math.round(performance.now() - t); return r; };
  await tick();
  const noiseNormal = T("noise", buildNoiseNormal);
  await tick();
  const SNOW = T("snow", buildSnow);
  await tick();
  const WOOD = T("wood", buildWood);

  // полоски / спираль для леденцов (кэш по цветам и узору); 3×3 суперсэмплинг вместо размытых краёв
  const patCache = new Map();
  function patternTex(a, b, n, kind){
    const key = kind + rgb(a) + rgb(b) + n;
    if (patCache.has(key)) return patCache.get(key);
    const W = LOW ? 256 : 512, A = rgb(a), B = rgb(b);
    const t = canvasTex(W, W, (g) => {
      const im = g.createImageData(W, W);
      for (let y = 0; y < W; y++) for (let x = 0; x < W; x++){
        let cov = 0;
        for (let sy = 0; sy < 3; sy++) for (let sx = 0; sx < 3; sx++){
          const u = (x + (sx + 0.5) / 3) / W, v = (y + (sy + 0.5) / 3) / W;
          let tt;
          if (kind === "swirl"){
            const px = u * 2 - 1, py = v * 2 - 1;
            tt = (Math.atan2(py, px) / (Math.PI * 2)) * n + Math.sqrt(px * px + py * py) * 2.2;
          } else tt = (u + v) * n;               // диагональ: на трубе/цилиндре даёт спираль «карамельной трости»
          if (tt - Math.floor(tt) < 0.5) cov++;
        }
        const k = cov / 9, i = (y * W + x) * 4;
        im.data[i] = A[0] * (1 - k) + B[0] * k; im.data[i + 1] = A[1] * (1 - k) + B[1] * k;
        im.data[i + 2] = A[2] * (1 - k) + B[2] * k; im.data[i + 3] = 255;
      }
      g.putImageData(im, 0, 0);
    });
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.name = "look:" + kind;
    patCache.set(key, t);
    return t;
  }

  // копия текстуры со своим repeat: общий source → на GPU одна загрузка
  const repCache = new Map();
  function rep(tex, r){
    if (!tex || r == null) return tex;
    const x = typeof r === "number" ? r : r[0], y = typeof r === "number" ? r : r[1];
    if (x === 1 && y === 1) return tex;
    const key = tex.uuid + ":" + x + ":" + y;
    let t = repCache.get(key);
    if (!t){ t = tex.clone(); t.repeat.set(x, y); t.needsUpdate = true; repCache.set(key, t); }
    return t;
  }

  // ---------- ФАБРИКА МАТЕРИАЛОВ ----------
  // служебные ключи опций (не свойства материала)
  const SPECIAL = new Set(["repeat", "normal", "unique", "fibre", "stripe", "stripes", "pattern", "sparkle", "transmission"]);
  const keyVal = v => {
    if (v == null || typeof v !== "object") return String(v);
    if (v.isColor) return v.getHexString();
    if (v.uuid) return v.uuid;
    if (v.isVector2) return v.x + "," + v.y;
    if (Array.isArray(v)) return v.map(keyVal).join(",");
    return JSON.stringify(v);
  };
  const colKey = c => c == null ? "" : new THREE.Color(c).getHexString();
  const cache = new Map();
  function cached(type, key, o, build){
    if (o && o.unique) return build();
    let k = type + "|" + key;
    if (o) for (const n of Object.keys(o).sort()) k += "|" + n + "=" + keyVal(o[n]);
    let m = cache.get(k);
    if (!m){ m = build(); m.name = "look:" + type; cache.set(k, m); }
    return m;
  }
  // переносим обычные свойства из опций; чужие для этого класса (sheen на low) молча пропускаем
  function apply(m, o){
    if (!o) return m;
    for (const n in o){
      if (SPECIAL.has(n) || o[n] === undefined || m[n] === undefined) continue;
      const v = o[n], cur = m[n];
      if (cur && cur.isColor && !(v && v.isColor)) cur.set(v);
      else if (cur && cur.isVector2 && typeof v === "number") cur.set(v, v);
      else m[n] = v;
    }
    return m;
  }
  const Std = p => new THREE.MeshStandardMaterial(p);
  const Phys = p => new THREE.MeshPhysicalMaterial(p);
  const nscale = (o, def) => { const s = o && o.normal != null ? o.normal : def; return new THREE.Vector2(s, s); };

  // войлок: персонажи, ёлки, помпоны
  function felt(color, o){
    return cached("felt", colKey(color), o, () => {
      const c = new THREE.Color(color), fib = !(o && o.fibre === false);
      const p = { color: c, roughness: 0.85, metalness: 0, envMapIntensity: 1 };
      if (fib){ p.normalMap = rep(noiseNormal, o && o.repeat != null ? o.repeat : 2); p.normalScale = nscale(o, 0.3); }
      if (LOW) return apply(Std(Object.assign(p, { roughness: 0.9 })), o);
      return apply(Phys(Object.assign(p, {
        sheen: 1, sheenColor: c.clone().lerp(WHITE, 0.3), sheenRoughness: 0.8,
      })), o);
    });
  }

  // леденец: лак поверх цветного пластика; o.stripe — второй цвет узора (o.pattern "stripes"|"swirl", o.stripes — число полос)
  function candy(color, o){
    return cached("candy", colKey(color), o, () => {
      const c = new THREE.Color(color);
      // лёгкое собственное свечение цветом узора — «сахарная» полупрозрачность, белые полосы в тени не серые
      const p = { color: c, roughness: 0.35, metalness: 0, envMapIntensity: 1, emissive: c.clone(), emissiveIntensity: 0.1 };
      if (o && o.stripe != null){
        const kind = o.pattern === "swirl" ? "swirl" : "stripes";
        p.map = rep(patternTex(color, o.stripe, o.stripes || (kind === "swirl" ? 4 : 3), kind), o.repeat);
        p.color = WHITE.clone(); p.emissive = WHITE.clone(); p.emissiveMap = p.map;
      }
      if (LOW) return apply(Std(Object.assign(p, { roughness: 0.26 })), o);
      return apply(Phys(Object.assign(p, { clearcoat: 1, clearcoatRoughness: 0.12 })), o);
    });
  }

  // снег: белый (не серый!), мягкие нормали, холодные впадины, редкие искры в emissive (ловит bloom)
  function snow(o){
    return cached("snow", "", o, () => {
      const r = o && o.repeat != null ? o.repeat : 1;
      const spk = o && o.sparkle != null ? o.sparkle : 1;
      const p = {
        // альбедо > 1 с голубым смещением — сознательный «стилизованный» ход: ACES иначе давит белый снег в серый;
        // освещённый снег уходит в чистый белый, тень — в светло-голубую
        color: new THREE.Color().setRGB(1.7, 1.78, 2.0), map: rep(SNOW.albedo, r), roughness: 0.92, metalness: 0,
        normalMap: rep(SNOW.normal, r), normalScale: nscale(o, 0.8),
        emissive: 0xffffff, emissiveMap: spk > 0 ? rep(SNOW.sparkleMap, r) : null, emissiveIntensity: spk > 0 ? 3 * spk : 0,
        envMapIntensity: 1.1,
      };
      if (LOW) return apply(Std(p), o);
      // приглушённый зеркальный отклик: снег матовый, без пластикового блеска на скользящих углах
      return apply(Phys(Object.assign(p, { specularIntensity: 0.5 })), o);
    });
  }

  // тёплые доски настила: альбедо + нормали (щели, волокна) + ORM (AO/шероховатость)
  function wood(o){
    return cached("wood", "", o, () => {
      const r = o && o.repeat != null ? o.repeat : 1;
      const orm = rep(WOOD.orm, r);
      return apply(Std({
        color: 0xffffff, map: rep(WOOD.albedo, r), metalness: 0, roughness: 1,
        normalMap: rep(WOOD.normal, r), normalScale: nscale(o, 1),
        roughnessMap: orm, aoMap: orm, aoMapIntensity: 1, envMapIntensity: 1,
      }), o);
    });
  }

  // лёд: глянцевый бледно-циановый, лак, лёгкое «внутреннее» свечение; пропускание только high + o.transmission
  function ice(o){
    return cached("ice", "", o, () => {
      // насыщенная голубая «толща» + сильные отражения неба/солнца + волнистая нормаль → читается как стекло, не пластик
      const p = {
        color: 0x3cb6ec, roughness: 0.06, metalness: 0, envMapIntensity: 1.7,
        emissive: 0x1a86cc, emissiveIntensity: 0.4,
        normalMap: rep(noiseNormal, o && o.repeat != null ? o.repeat : 0.5), normalScale: nscale(o, 0.3),
      };
      if (LOW) return apply(Std(Object.assign(p, { metalness: 0.15, roughness: 0.1 })), o);
      const m = Phys(Object.assign(p, { clearcoat: 1, clearcoatRoughness: 0.06, ior: 1.6, specularIntensity: 1 }));
      if (HIGH && o && o.transmission){ m.transmission = 0.55; m.thickness = 0.8; m.attenuationColor.set(0x8fd8ff); m.attenuationDistance = 1.5; }
      return apply(m, o);
    });
  }

  // металл: хром/золото колокольчиков и фонарей (Standard на всех уровнях — Physical тут ничего не даёт)
  function metal(color, o){
    // слабый собственный подсвет цветом: жёлтое золото под голубым небом иначе уходит в оливковый
    return cached("metal", colKey(color), o, () => {
      const c = new THREE.Color(color);
      return apply(Std({ color: c, metalness: 1, roughness: 0.28, envMapIntensity: 2.2, emissive: c, emissiveIntensity: 0.1 }), o);
    });
  }

  // свечение для bloom: emissiveIntensity > 1, тонмаппинг остаётся (toneMapped: true)
  function glow(color, intensity = 2.5, o){
    return cached("glow", colKey(color) + "|" + intensity, o, () => {
      const c = new THREE.Color(color);
      return apply(Std({ color: c.clone().multiplyScalar(0.6), emissive: c, emissiveIntensity: intensity,
                         roughness: 0.4, metalness: 0, toneMapped: true }), o);
    });
  }

  function dispose(){
    for (const m of cache.values()) m.dispose();
    cache.clear();
    for (const t of [...repCache.values(), ...patCache.values(), noiseNormal, softDot, sparkle,
                     SNOW.normal, SNOW.albedo, SNOW.sparkleMap, WOOD.albedo, WOOD.normal, WOOD.orm]) t.dispose();
    repCache.clear(); patCache.clear();
    if (scene.environment === env) scene.environment = null;
    env.dispose();
  }

  return {
    env, quality: Q,
    felt, candy, snow, wood, ice, metal, glow,
    tex: {
      softDot, sparkle, noiseNormal, woodPlanks: WOOD.albedo, snowGround: SNOW.albedo,
      // дополнительно (вне контракта): парные карты
      snowNormal: SNOW.normal, snowSparkle: SNOW.sparkleMap, woodNormal: WOOD.normal, woodOrm: WOOD.orm,
    },
    // рекомендуемый свет при включённом окружении (PMREM уже даёт мягкий «амбиент»)
    hints: { hemi: 0.3, sun: 3.0, fill: 0.25, exposure: 1.05 },
    stats: () => ({ materials: cache.size, textures: repCache.size + patCache.size + 10, ms: Object.assign({ env: msEnv }, ms) }),
    dispose,
  };
}
