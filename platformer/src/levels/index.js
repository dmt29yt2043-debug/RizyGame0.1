// Реестр уровней: данные (LEVEL) + «вид» (свет, задники, ночная гамма) для каждого. level1 — данные
// без изменений (src/level.js), level2 — src/levels/level2.js. main.js строит/разбирает мир по этим записям.
import { PAL } from "../config.js";
import { LEVEL1 } from "./level1.js";
import { LEVEL2 } from "./level2.js";

export const LEVELS = [
  {
    id: 1, key: "l1",
    title: "Закатный Идеалити",
    data: LEVEL1,
    night: false,
    bgDir: "",                 // assets/bg/*.png — как раньше
    unlock: null,               // всегда открыт
    look: {
      hemiSky: PAL.hemiSky, hemiGround: PAL.hemiGround, hemiI: 0.95,
      keyLight: PAL.keyLight, sunI: 2.1, sunPos: [7, 11, 9],
      fog: null,
      heart: {},
      biolumFlowers: false,
    },
  },
  {
    id: 2, key: "l2",
    title: "Ночной Идеалити",
    data: LEVEL2,
    night: true,
    bgDir: "l2/",
    unlock: 1,                  // открывается после победы на уровне 1
    look: {
      // холодный лунный ключевой свет сверху-слева + фиолетовый заполняющий + тёплые отблески фонарей —
      // тёплые блики дают материалы (золото/окна), не общий свет
      hemiSky: 0x4a4a8f, hemiGround: 0x241b3f, hemiI: 0.65,
      keyLight: 0xcfe0ff, sunI: 1.25, sunPos: [-6, 12, 8],
      fog: { color: 0x231a3a, near: 50, far: 165 },
      heart: { gemColor: 0x9fc2ff, gemEmissive: 0x6a86ff, heartColor: 0xc9d8ff, heartEmissive: 0x7a93ff },
      biolumFlowers: true,
    },
  },
];

export function getLevelDef(id){ return LEVELS.find(l => l.id === id) || LEVELS[0]; }
export function levelIndexOf(id){ return LEVELS.findIndex(l => l.id === id); }
export function nextLevelOf(id){
  const i = levelIndexOf(id);
  return i >= 0 && i + 1 < LEVELS.length ? LEVELS[i + 1] : null;
}
