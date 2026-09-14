// Константы игры: полосы, скорости, физика, камера, палитра, качество.
// Значения один в один из legacy/run.js — менять только осознанно (это геймплей).

export const cfg = {
  // полосы (x центра)
  LANES: [-2.55, 0, 2.55],

  // скорость: старт, потолок, прирост в секунду; удар режет скорость
  speedStart: 13,
  speedMax: 32,
  speedAccel: 0.3,
  hitSpeedMin: 12,
  hitSpeedMul: 0.55,

  // физика Ризи
  gravity: 25,
  jumpVy: 9.6,
  slideTime: 0.7,
  laneLerp: 13,          // скорость подтягивания x к полосе
  landSquash: 0.22,      // сек «сплющивания» после приземления

  // удары и рой
  graceTime: 1.6,        // неуязвимость после удара
  shakeTime: 0.75,
  swarmTime: 5.5,        // сколько рой висит «близко»; второй удар за это время = конец

  // коллизии (препятствие опасно при |z| <= zLen/2 + hitPad)
  hitPad: 0.5,
  jumpClear: 0.9,        // высота, выше которой валик не задевает
  slideClear: 1.0,       // высота, выше которой гирлянда не задевает
  zLen: { jump: 0.9, slide: 0.55, wall: 1.4 },

  // спавн
  obstacleFirstZ: -46,
  coinFirstZ: -28,
  obstacleTrigger: -40,
  obstacleSpawnZ: -118,
  coinTrigger: -30,
  coinSpawnZ: -112,
  obstacleDespawnZ: 11,
  coinDespawnZ: 9,

  // энергоны: подбор
  coinPick: { z: 0.75, x: 0.95, y: 1.05, yBase: 0.95 },
  coinRow: 7, coinArc: 5, coinStep: 1.4, coinArcChance: 0.32,

  milestoneStep: 100,

  // камера
  CAM: { fov: 58, y: 3.05, z: 5.45, near: 0.1, far: 400, lookZ: -8 },

  // палитра
  FOG_COL: 0xdaeeff,
  P: {
    skin:0x5cc0ec, hair:0xd2f550, jeans:0x2f6ff0, lime:0xC0FF3F,
    pink:0xffb3d5, pink2:0xff7eb6, red:0xff6b6b, blue:0x7ec3ff,
    mint:0x7fd89a, cream:0xfff4e2, peach:0xffd2a8, brown:0xb9764a, wood:0xd9a066,
  },
  BRAND: { blue: 0x0536D4, lime: 0xC0FF3F, ink: 0x070D36 },

  // качество: что включает каждый уровень (base-плагины это пока не читают)
  QUALITY: {
    low:  { dprMax: 1.5, shadows: true, shadowMap: 1024 },
    med:  { dprMax: 2,   shadows: true, shadowMap: 2048 },
    high: { dprMax: 2,   shadows: true, shadowMap: 2048 },
  },

  bestKey: "rizyrun_best",
};

export default cfg;
