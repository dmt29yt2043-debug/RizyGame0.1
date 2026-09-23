// Константы платформера «Ризи: Кристальный путь»: физика, камера, качество, палитра.
// Модуль без three — его импортируют и игра, и node-проверка проходимости (tools/check.mjs).
// Физика — это геймплей: меняешь число → прогони `node tools/check.mjs`.

export const PHYS = {
  dt: 1 / 120,            // фиксированный шаг симуляции

  // ---------- БЕГ ----------
  maxRun: 7.0,            // ед/с
  accelGround: 70,        // разгон на земле, ед/с²
  decelGround: 80,        // торможение без ввода
  turnGround: 120,        // разворот (ввод против скорости)
  accelAir: 48,
  decelAir: 16,

  // ---------- ПРЫЖОК ----------
  // v0 = 2h/t, g = 2h/t²; вниз g × fallMul; отпустил кнопку на подъёме — g × cutMul (короткий прыжок)
  jumpH: 2.6,             // высота одиночного прыжка (удержание)
  jumpTUp: 0.38,          // время до вершины
  djumpH: 2.05,           // второй прыжок чуть ниже
  fallMul: 1.35,
  cutMul: 2.8,
  hangVy: 1.2,            // у вершины (|vy| < hangVy, кнопка зажата) g × hangMul — лёгкое «зависание»
  hangMul: 0.7,
  maxFall: 19,
  coyote: 0.10,           // «время койота»: прыжок ещё можно, если только что сошла с края
  buffer: 0.12,           // буфер прыжка: нажала чуть раньше приземления — прыжок сработает

  // ---------- РЫВОК ----------
  dashT: 0.18,            // длительность
  dashV: 16,              // горизонтальная скорость, гравитации нет
  dashExit: 7.0,          // скорость на выходе из рывка
  dashCD: 0.4,            // перезарядка (от конца рывка)

  // ---------- ТЕЛО ----------
  w: 0.62,                // ширина AABB (ступни — середина низа)
  h: 1.4,                 // высота AABB

  // ---------- ВРАГИ И УРОН ----------
  stompV: 11.5,           // отскок после «гашения»
  stompVHeld: 13.5,       // если прыжок зажат — выше
  hurtKnockX: 6.5,
  hurtKnockY: 7.5,
  hurtLock: 0.28,         // с без управления после удара
  invuln: 1.0,            // мигание-неуязвимость
  killY: -7.5,            // ниже — пропасть
};

// производные величины
PHYS.g = 2 * PHYS.jumpH / (PHYS.jumpTUp * PHYS.jumpTUp);
PHYS.v1 = PHYS.g * PHYS.jumpTUp;
PHYS.v2 = Math.sqrt(2 * PHYS.g * PHYS.djumpH);

export const GAME = {
  hearts: 3,
  comboWindow: 1.1,       // с между кристаллами, чтобы нота шла вверх
  winDelay: 1.6,          // с от касания Сердца до экрана победы
  overDelay: 1.1,         // с от последнего сердечка до экрана «Попробуем ещё раз»
  respawnFade: 0.35,
  bestKey: "rizy-plat-best-v1",
  volumeKey: "rizy-plat-volume-v1",
};

export const CAM = {
  fov: 32,
  dist: 24,               // от камеры до плоскости игры (z = 0)
  height: 4.6,            // камера над точкой фокуса
  lookUp: 3.6,            // куда смотрит относительно фокуса (лёгкий наклон вниз ≈ 2.4°)
  lead: 2.4,              // упреждение по направлению бега
  leadRate: 2.2,
  followX: 5.5,           // скорость догона (1/с)
  followY: 3.2,
  deadUp: 2.4,            // вертикальная «мёртвая зона» в прыжке
  deadDown: 1.2,
};

// low — без поста (MSAA канваса, свечение — аддитивные ореолы); med — bloom + MSAA в HDR-цели;
// high — плюс карта теней от солнца (область вокруг кадра) и больше частиц
export const QUALITY = {
  low:  { dprMax: 1.25, post: false, bloom: 0,    shadows: false, halos: 1.0, particles: 260 },
  med:  { dprMax: 1.5,  post: true,  bloom: 0.55, shadows: false, halos: 0.6, particles: 420 },
  high: { dprMax: 2,    post: true,  bloom: 0.62, shadows: true,  halos: 0.6, particles: 600 },
};

// палитра (sRGB). Пастельная Идеалити в духе референса: персиковое небо, лавандовые силуэты, кремовый кирпич.
export const PAL = {
  skyTop:    0xbd93c6,
  skyMid:    0xe2a9c2,
  skyLow:    0xf6cbb4,
  sun:       0xfff4c9,
  sunHalo:   0xffe7b8,
  cityFar:   0xdcbdd8,
  cityMid:   0xc9afda,
  cityNear:  0xb6a3d8,
  winFar:    0xe8cfe2,
  winMid:    0xe2d3ee,
  winNear:   0xf1e8f8,
  winLit:    0xfff1c4,
  hillFar:   0xe7c2d7,
  hillNear:  0xd7b9dd,
  brick:     0xf7e8dc,
  mortar:    0xe2cbc3,
  band:      0xf1e0e1,
  inset:     0x8e7abd,
  trim:      0xfff8ef,
  gold:      0xe5c07f,
  top:       0xfbefe5,
  lav:       0xb9a6dc,
  lavDeep:   0x7d6bb0,
  mint:      0xa8ecd6,
  ink:       0x070D36,
  blue:      0x0536D4,
  lime:      0xC0FF3F,
  crystalA:  0x3fe6d4,  // бирюзовый
  crystalB:  0x5cb6ff,  // голубой
  crystalC:  0xff86cf,  // розовый
  star:      0xd8ff4a,
  gasBody:   0x4a3f66,  // войлок Гасителя (под текстурой волокон темнеет)
  gasEye:    0xff2d3f,
};
