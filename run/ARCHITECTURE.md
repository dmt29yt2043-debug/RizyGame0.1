# Ризи RUN v3 — архитектура «2026»

Цель: визуал и ощущение премиального мобильного раннера 2026 года (Minion Rush / Subway Surfers) в стиле RIZYLAND,
сохранив текущий геймплей. Один уровень «Снежная Река».

## Раскладка (корень сервера — game/, игра по адресу /run/)
```
game/run/
  index.html            HUD DOM + экран аварии/сторож + importmap + <script type=module src="src/main.js">
  three.module.js       three r160
  addons/               three/examples/jsm (импорт как "three/addons/...")
  src/main.js           бутстрап, цикл, ввод, геймплей, камера, загрузчик плагинов, фоторежим, window.RUN
  src/config.js         константы: полосы, скорости, камера, палитра, качество
  src/core/bus.js       шина событий on/off/emit
  src/core/util.js      сидированный Math.random (?seed), rnd/pick/clamp/lerp/damp, canvasTex
  src/look/materials.js окружение (PMREM) + фабрика материалов + общие текстуры
  src/look/curve.js     «изогнутый мир» (горизонт уходит вниз и плавно вбок)
  src/look/post.js      постобработка
  src/plugins/world.js  трасса, декор, сет-пьесы, ВИЗУАЛ препятствий и энергонов
  src/plugins/player.js визуал и анимация Ризи (GLB assets/rizy.glb если есть, иначе процедурная)
  src/plugins/swarm.js  визуал роя Гасителей
  src/plugins/vfx.js    частицы и эффекты
  src/plugins/hud.js    HUD, меню, отсчёт, всплывающие цифры
  src/plugins/audio.js  музыка и звуки (WebAudio, процедурно)
  src/base/<slot>.js    ЗАМОРОЖЕННЫЕ фолбэки = поведение legacy/run.js; после фазы Foundation не редактируются
  legacy/run.js         старый монолит, только для справки
  assets/               rizy.glb (+ rizy.glb.json), текстуры
  tools/shot.sh         скриншот headless Chrome
  tools/console.sh      заголовок, экран аварии, ошибки консоли
```

## Импорты
- Всегда `import * as THREE from "three"`, аддоны — `import { X } from "three/addons/…/X.js"` (importmap в index.html).
- Плагины и look-модули НЕ импортируют main.js — всё получают через `ctx`.

## ctx (создаёт main.js)
```js
ctx = {
  THREE, renderer, scene, camera,
  G,            // живое состояние игры — плагины только читают
  cfg,          // src/config.js
  bus,          // on(evt, fn) / off / emit(evt, payload)
  qp,           // URLSearchParams
  quality,      // "low" | "med" | "high"   (?q=, по умолчанию авто: med, low на мобильных)
  look: { mats, curve, post },   // любой может быть null, если модуль не загрузился
  entities: { obstacles: [], coins: [] },
  util,         // rnd, pick, clamp, lerp, damp, canvasTex
  $,            // getElementById
  time: { t, dt },
}
```

## G — состояние (владелец main.js)
`mode` ("title" | "countdown" | "play" | "over"), `dist`, `energons`, `best`, `lane` (0..2), `x`, `py`, `vy`,
`sliding` (сек, >0 = подкат), `speed`, `runPhase`, `grace`, `swarmNear` (сек, >0 = рой близко), `shake`,
`land` (сек после приземления), `combo`, `laneDir` (-1/0/1 последний сдвиг).

## Контракт плагина
```js
export default {
  name: "world",
  install(ctx) {            // может быть async
    // …создать объекты, подписаться на события…
    return { update(dt, ctx) {}, dispose() {} };
  },
};
```
Загрузчик в main.js для слотов `world, player, swarm, vfx, hud, audio`:
живой `./plugins/<slot>.js` → при ошибке импорта/установки console.error и фолбэк `./base/<slot>.js`.
Исключения в `update()` ловятся по плагину; после 3 подряд — замена на base.

## Сущности: логика в main, визуал в world
- obstacle: `{ id, kind: "jump" | "slide" | "wall", lanes: [..], z, zLen, object3d: null }`
  (стены на нескольких полосах — отдельные сущности с общим z)
- coin: `{ id, lane, x, y, z, object3d: null }`
- main: создаёт сущность → `emit("spawn:obstacle"|"spawn:coin", ent)` → плагин ставит `ent.object3d` и добавляет в сцену;
  каждый кадр main двигает `ent.z` и пишет `ent.object3d.position.z = ent.z`; при удалении → `emit("despawn", ent)`,
  плагин убирает/переиспользует объект.

## События
`title, countdown(n), start, gameover({dist, energons, isBest}), jump, land({impact}), slide, lane({dir, from, to}),
pickup(coin), hit(obstacle), nearmiss(obstacle), swarm:near, swarm:far, milestone(meters), speedup(speed),
spawn:obstacle(ent), spawn:coin(ent), despawn(ent), resize({w, h}), pause(bool), frame({dt})`

## API look-модулей
**materials.js** — `export async function createLook(ctx)` →
```js
{ env,                                  // PMREM-текстура, также ставится в scene.environment
  felt(color, o?), candy(color, o?), snow(o?), wood(o?), ice(o?), metal(color, o?), glow(color, intensity?),
  tex: { softDot, sparkle, noiseNormal, woodPlanks, snowGround } }
```
Материалы — MeshStandard/MeshPhysical (sheen для войлока/ткани, clearcoat для леденцов), текстуры процедурные (canvas/DataTexture).

**curve.js** — `export function installCurve(ctx, opts?)` → `{ uniforms, patch(objOrMaterial), update(dt, G) }`
Мир уходит вниз с расстоянием и плавно покачивается вбок; около игрока (|z| < 6) изгиба нет.
Тени должны совпадать; Sprite/Points не ломать (патчить или исключать). `patch` идемпотентен.

**post.js** — `export function createPost(ctx)` →
`{ render(dt), setSize(w, h), setQuality(q), params: { bloom, vignette, saturation, warmth, speedBlur, danger } }`
RenderPass → (GTAO на high) → UnrealBloom → Grade (виньетка, тёплый тон, насыщенность, радиальный speed-blur от скорости,
красная пульсация при `swarmNear`) → SMAA (med/high) / FXAA (low) → OutputPass. Если `post` есть — main вызывает `post.render(dt)`.

## Фоторежим и тесты
- `tools/shot.sh OUT.png "seed=7&shot=1&at=5[&lane=0][&pose=jump|slide][&cam=title][&q=high]" [W] [H]`
- `tools/console.sh "seed=7&shot=1&at=3"` → `TITLE:`, `CRASH_OVERLAY:`, `CONSOLE:`
- `seed` делает мир детерминированным; `shot=1&at=N` — автостарт, симуляция N сек шагом 1/60 (без смертей),
  заморозка, ОДИН рендер (preserveDrawingBuffer), `document.title = "SHOT_READY"`. `cam=title` — кадр титульного экрана.
- Базовые кадры до v3: `<scratchpad>/shots/baseline/{title,run,run2}.png`.
- Скриншоты — SwiftShader: медленно, но корректно. Не держи бесконечный рендер в замороженном кадре.

## Бюджет производительности
60 fps на MacBook Air 2020 в Chrome, 1280×720, dpr ≤ 2, q=med. `renderer.info.render.calls` ≤ 400 в игре
(InstancedMesh/слияние геометрии для повторяющегося декора). Никаких аллокаций в горячем цикле.

## Стиль RIZYLAND
Электрический синий #0536D4, лайм #C0FF3F, чернила #070D36. Мягкие войлочные/игрушечные формы, пастельная зима,
яркое солнце. Ризи: небесно-голубая кожа, лаймовое каре с двумя пучками, чёрный свитер с лаймовыми/синими цветами,
синие джинсы с подворотом, чёрные кеды с белой подошвой, лаймовый шарф, синий рюкзак.
Злодеи — рой Гасителей: тёмные войлочные помпоны со светящимся красным глазом.
