// Ризи-игрушка: точка входа персонажа платформера (реализация — src/rizy-toy.js).
// Контракт (не менять без согласования):
//   createRizy({ quality: "low"|"med"|"high" }) → {
//     root: THREE.Group   — ступни в начале координат, рост ≈ height, сама поворачивается по s.facing
//     height: number      — рост в единицах мира (≈ 1.5)
//     update(dt, s)       — s = { speed: 0..1 (|vx|/max), vy, grounded, facing: -1|1, dashing, event, time }
//                           event: null | "jump" | "djump" | "land" | "dash" | "hurt" | "collect" | "win" (одноразово, в кадре события)
//     dispose()
//   }
import { createRizyToy } from "./rizy-toy.js";
export function createRizy(opts){ return createRizyToy(opts); }
