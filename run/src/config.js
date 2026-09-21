// Константы игры: полосы, скорости, физика, камера, свет, палитра, качество.
// Числа — решения feature bible 2026 (разделы 2.0 / 2.1 / 2.2 / 2.9). Менять только осознанно: это геймплей.

export const cfg = {
  // полосы (x центра)
  LANES: [-2.55, 0, 2.55],

  // ---------- СКОРОСТЬ (GAME-2) ----------
  // цель: t < 20 с линейно 12→15; дальше 15 + 15·(1 − exp(−(t−20)/90)); жёсткий потолок 30.
  speedStart: 12,
  speedMax: 30,
  speedWarm: { t: 20, from: 12, to: 15 },
  speedAsym: { base: 15, add: 15, tau: 90 },
  speedAccel: 4,          // u/s² — реальная скорость догоняет цель
  speedIntro: 0.5,        // с: разгон 0 → старт на старте забега (easeOutQuad)
  hitSpeedMin: 10,
  hitSpeedMul: 0.6,
  hitSpeedDur: 0.2,       // с: падение скорости после удара
  calmSpeedMul: 0.85,     // настройка «спокойный темп»

  // ---------- ФИЗИКА РИЗИ (PLAYER-2, Pittman) ----------
  // v0 = 2h/th, gUp = 2h/th²; у апекса (|vy| < hangVy) g × hangMul; после апекса g × fallMul; нырок vy = diveVy
  jump: { h: 1.9, th: 0.30, hangVy: 2.0, hangMul: 0.5, fallMul: 1.5, diveVy: -24 },
  slideTime: [0.62, 0.48], // с: lerp по intensity
  laneDur: [150, 115],     // мс: lerp по intensity, easeOutCubic
  edgeBump: { dx: 0.45, out: 0.06, back: 0.14 },
  inputBuffer: 0.13,       // с: UP/DOWN, нажатые «рано», выполняются как только можно
  coyote: 0.08,
  landSquash: 0.22,        // с «сплющивания» после приземления (G.land, читают base-плагины)

  // ---------- УДАРЫ И РОЙ (GAME-4) ----------
  graceTime: 1.6,          // неуязвимость после удара
  hitStop: 0.08,           // с при timeScale 0
  hitStopRamp: 0.04,       // с рампа 0 → 1
  swarmTime: 5.5,          // сколько рой висит «близко»; второй удар за это время = поимка
  mercy: { window: 3.0, gap: 1.6 },  // после удара 3 с новых препятствий не ближе 1.6 с
  catchSlow: { to: 0.25, dur: 0.5 }, // поимка: timeScale 1 → 0.25 за 0.5 с (realDt)
  catchTime: 0.7,          // с от поимки до карточки результатов
  overLock: 1.0,           // с блокировки ввода на результатах
  revivePrice: [50, 100, 200],   // legacy (base/hud): цена «Спасти» по номеру спасения
  // ---------- ЭКОНОМИКА (ECON): кошелёк энергонов между забегами, «Продолжить», прокачка ----------
  reviveCost: 100,         // «Продолжить за 100 ⬡» из кошелька, reviveMax раз за забег
  reviveMax: 1,
  walletKey: "rizyrun_wallet",
  upgradesKey: "rizyrun_upgrades",
  // ---------- УСКОРИТЕЛИ (POWER): пикапы на трассе ----------
  power: {
    kinds: ["magnet", "shield", "boost", "x2"],
    // длительность по уровню прокачки: [без прокачки, ур.1, ур.2, ур.3] — купленные уровни = 6/9/12 и т.д.
    dur: { magnet: [4, 6, 9, 12], shield: [7, 10, 15, 20], boost: [3.5, 5, 7, 9], x2: [6, 8, 12, 16] },
    prices: [150, 400, 900],   // цена уровня 1 / 2 / 3
    firstS: 180,             // м: первый ускоритель
    gap: [350, 600],         // м между ускорителями
    y: 1.1,                  // высота парения
    pick: { z: 1.6, x: 0.95, y: 1.5 },   // зона подбора (y — допуск по высоте, чтобы брать и в прыжке, и в полёте)
    boostMul: 1.5, boostIn: 0.3, boostOut: 1.5, flyY: 1.6, boostGrace: 1.6,   // скорость ×1.5, вход/выход, высота полёта
    magnetRange: 18, magnetPull: 9,      // м вперёд, из которых энергоны тянутся; резкость подтяжки (1/с)
    shieldGrace: 0.6,        // с без повторного удара после того, как щит поглотил ряд
  },

  // ---------- КОЛЛИЗИИ ----------
  // препятствие опасно при |z| <= zLen/2 + hitPad
  hitPad: 0.5,
  jumpClear: 0.9,          // высота, выше которой валик не задевает
  slideTop: 2.4,           // гирлянду не перепрыгнуть: без подката задевает при py < slideTop
  zLen: { jump: 0.9, slide: 0.55, wall: 1.4 },

  // ---------- СПАВН (GAME-2) ----------
  spawnAhead: 118,         // м: сущность появляется, когда до неё ≤ spawnAhead (z = −118)
  firstObstacleS: 40,      // м от старта: ≥ 3.0 с
  gapWarm: 2.6,            // с между паттернами первые 20 с
  gap: [2.4, 1.1],         // с: lerp по d = clamp((t−20)/160, 0, 1)^0.8
  gapMinM: 16,
  innerGap: [0.9, 1.2],    // с между рядами внутри паттерна
  breather: { sec: 3.5, min: 40, max: 100, every: 5, skipWithin: 150 },
  obstacleDespawnZ: 11,
  coinDespawnZ: 9,
  tierWeights: [           // [dMax, [T1, T2, T3, T4, T5]]
    [0.25, [70, 30, 0, 0, 0]],
    [0.5,  [30, 45, 25, 0, 0]],
    [0.8,  [0, 35, 40, 25, 0]],
    [1.01, [0, 0, 35, 40, 25]],
  ],

  // ---------- ЭНЕРГОНЫ (WORLD-5, GAME-3) ----------
  coinPick: { z: 1.6, x: 0.95, y: 1.05, yBase: 0.95 },   // z — «магнит» вдоль трассы
  coinStep: 1.7,
  coinLine: [8, 12], coinArc: 9, coinSlide: 6, coinLaneS: 10,

  // ---------- КОМБО / NEAR-MISS (GAME-8) ----------
  combo: { tiers: [15, 40, 80, 140], leakAfter: 3.0, leak: 4, coin: 1, arc: 3, near: 5, mission: 5 },
  nearMiss: { laneWindow: 0.28, jumpMargin: 0.3, slideWindow: 0.15, cooldown: 1.0,
              slowTo: 0.7, slowHold: 0.09, slowRamp: 0.12 },

  milestoneStep: 250,
  recordMin: 100,

  // ---------- ТУТОРИАЛ (GAME-7) ----------
  tutorial: { key: "rizyrun_tut_v1", speed: 11, slowAt: 1.2, holdAt: 0.35, slowTo: 0.2, slowIn: 0.18, back: 0.25 },

  // ---------- КАМЕРА (CAM-1..5) ----------
  CAM: { fov: 60, fovI: 8, y: 3.8, z: 6.4, zI: 0.7, lookY: 1.0, lookZ: -10, near: 0.1, far: 400,
         portraitFov: 10, portraitY: 4.2, roll: 0.011, swayRoll: 0.012 },
  CAM_TITLE: { target: [0, 1.15, 0], r: 5.1, y: 1.6, phi: 0.51, phiAmp: 0.17, period: 25, fov: 45 },
  CAM_SWOOP: { dur: 1.1, mid: [3.2, 2.6, 1.0], retry: 0.6, fade: 0.3, controlAt: 0.7, controlRetry: 0.3 },
  CAM_CATCH: { orbit: 25, back: 1.5, up: 0.6, dur: 0.7 },
  TRAUMA: { decay: 1.5, hit: 0.55, catch: 0.35, edge: 0.18, hardLand: 0.12, near: 0.10, dive: 0.08,
            rotZ: 3, rotY: 1.2, rotX: 1.2, offX: 0.12, offY: 0.10 },

  // ---------- СВЕТ (LOOK-2 / LOOK-3) ----------
  LIGHT: {
    // при IBL (look включён)
    // числа согласованы с look/materials.js LIGHTS (владелец look)
    hemi: { sky: 0xC8DEFF, ground: 0xF4EEE8, intensity: 0.30 },
    sun:  { color: 0xFFF1DC, intensity: 2.6, dir: [-0.62, 0.70, -0.25], dist: 30, targetZ: -12,
            // орто-бокс в мире; y −2.5..4.5 учитывает провал изогнутого мира
            bias: -0.0003, normalBias: 0.03, near: 1, far: 70, box: { x: [-8, 8], y: [-2.5, 4.5], z: [-40, 8] } },
    fill: { color: 0xBFD8FF, intensity: 0.45, dir: [0.30, 0.50, 1.0], dist: 20 },   // со стороны камеры, справа, без тени
    exposure: 1.0,
    // без look (?look=0): старые числа, иначе картинка без окружения чёрная
    legacy: { hemi: 1.05, sun: 2.35, fill: 0.5, exposure: 1.18 },
  },

  FOG: { color: 0xFFF1E4, near: 30, far: 95 },   // цвет == горизонт неба (LOOK-8 УТРО); ставит плагин world

  // палитра
  FOG_COL: 0xdaeeff,
  P: {
    skin:0x5cc0ec, hair:0xd2f550, jeans:0x2f6ff0, lime:0xC0FF3F,
    pink:0xffb3d5, pink2:0xff7eb6, red:0xff6b6b, blue:0x7ec3ff,
    mint:0x7fd89a, cream:0xfff4e2, peach:0xffd2a8, brown:0xb9764a, wood:0xd9a066,
  },
  BRAND: { blue: 0x0536D4, lime: 0xC0FF3F, ink: 0x070D36, hazard: 0xFF3B5C, danger: 0xFF2436, snow: 0xF2F6FF, shadow: 0x2A3C9A },

  // качество: low — только blob-тени; dpr/dprMax читает post.js и main
  QUALITY: {
    low:  { dprMax: 1.25, dpr: 1.25, shadows: false, shadowMap: 0 },
    med:  { dprMax: 1.5,  dpr: 1.5,  shadows: true,  shadowMap: 1024 },
    high: { dprMax: 2,    dpr: 2,    shadows: true,  shadowMap: 2048 },
  },

  bestKey: "rizyrun_best",
  settingsKey: "rizyrun_settings",
  missionsKey: "rizyrun_missions",
};
cfg.quality = cfg.QUALITY;   // post.js читает cfg.quality[q].dpr

export default cfg;
