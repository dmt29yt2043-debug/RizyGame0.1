// Иконка энергона для HUD: один раз рендерим 3D-кристалл в render target и отдаём dataURL для <img>.
// Вызывать при загрузке (не в игровом цикле): 2 draw calls, синхронное чтение пикселей один раз.
import * as THREE from "three";

// renderer — ctx.renderer игры; object — готовый Object3D энергона из world (необязательно);
// env — PMREM-текстура (ctx.look.mats.env), чтобы грани ловили то же небо, что в игре.
export function renderEnergonIcon(renderer, { size = 128, object = null, env = null, color = 0xC0FF3F } = {}) {
  const S = size * 2;                                    // суперсэмплинг 2× вместо MSAA (readPixels проще)
  const rt = new THREE.WebGLRenderTarget(S, S, { depthBuffer: true });
  rt.texture.colorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  if (env) scene.environment = env;
  // кристалл занимает ~80% кадра (иначе на 52 px от него остаётся точка)
  const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
  cam.position.set(0, 0.25, 3.2); cam.lookAt(0, -0.02, 0);
  // в render target нет тонмаппинга: при сильном свете лайм выгорает в бледный, при слабом — в оливковый
  scene.add(new THREE.HemisphereLight(0xeaf4ff, 0x4a5cb8, env ? 0.5 : 1.0));
  const key = new THREE.DirectionalLight(0xfff4de, 2.0); key.position.set(-2.5, 3.5, 3); scene.add(key);
  const rim = new THREE.DirectionalLight(0xbfe0ff, 1.2); rim.position.set(3, 1, -2); scene.add(rim);

  let geo = null, mats = [];
  let gem = object;
  if (!gem) {
    // шестигранная бипирамида с «площадкой» — как кристалл в SVG-фолбэке
    const pts = [new THREE.Vector2(0, -0.78), new THREE.Vector2(0.62, -0.18), new THREE.Vector2(0.62, 0.2), new THREE.Vector2(0.34, 0.62), new THREE.Vector2(0, 0.66)];
    geo = new THREE.LatheGeometry(pts, 6);
    const m = new THREE.MeshPhysicalMaterial({ color, roughness: 0.3, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.1,
      emissive: color, emissiveIntensity: 0.16, flatShading: true });
    const outline = new THREE.MeshBasicMaterial({ color: 0x070D36, side: THREE.BackSide });
    mats.push(m, outline);
    gem = new THREE.Group();
    const body = new THREE.Mesh(geo, m);
    // обводка чернилами ~3 px на иконке 52 px — как у SVG-кристалла и пилюль
    const ink = new THREE.Mesh(geo, outline); ink.scale.setScalar(1.17);
    gem.add(ink, body);
    gem.rotation.set(0.18, 0.42, -0.12);
  }
  scene.add(gem);

  // сохранить и восстановить состояние общего рендерера
  const prevRT = renderer.getRenderTarget();
  const prevClear = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  const prevAuto = renderer.autoClear;
  renderer.setRenderTarget(rt);
  renderer.setClearColor(0x000000, 0);
  renderer.autoClear = true;
  renderer.clear();
  renderer.render(scene, cam);
  const buf = new Uint8Array(S * S * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, S, S, buf);
  renderer.setRenderTarget(prevRT);
  renderer.setClearColor(prevClear, prevAlpha);
  renderer.autoClear = prevAuto;

  // r160 пишет в render target ЛИНЕЙНЫЙ цвет без тонмаппинга (outputColorSpace действует только на экран):
  // переводим байты в sRGB по таблице, иначе иконка тёмная и грязная
  const LUT = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    const c = i / 255;
    LUT[i] = Math.round(255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055));
  }
  for (let i = 0; i < buf.length; i += 4) { buf[i] = LUT[buf[i]]; buf[i + 1] = LUT[buf[i + 1]]; buf[i + 2] = LUT[buf[i + 2]]; }

  // переворот по Y + уменьшение 2× через canvas
  const big = document.createElement("canvas"); big.width = big.height = S;
  const g = big.getContext("2d");
  const img = g.createImageData(S, S);
  for (let y = 0; y < S; y++) img.data.set(buf.subarray((S - 1 - y) * S * 4, (S - y) * S * 4), y * S * 4);
  g.putImageData(img, 0, 0);
  const out = document.createElement("canvas"); out.width = out.height = size;
  const g2 = out.getContext("2d");
  g2.imageSmoothingQuality = "high";
  g2.drawImage(big, 0, 0, size, size);

  if (!object) scene.remove(gem);
  if (geo) geo.dispose();
  for (const m of mats) m.dispose();
  rt.dispose();
  return out.toDataURL("image/png");
}
