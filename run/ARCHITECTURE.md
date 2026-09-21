# Ризи RUN v3 — архитектура «2026»

Цель: визуал и ощущение премиального мобильного раннера 2026 года (Minion Rush / Subway Surfers) в стиле RIZYLAND.
Один уровень «Снежная Река». Числа — решения feature bible 2026 (разделы 2.0–2.9); все геймплейные константы в `src/config.js`.
Этот файл — единственный действующий контракт между `main.js`, look-модулями и плагинами. Владелец — core (main.js).

## Раскладка (корень сервера — game/, игра по адресу /run/)
```
game/run/
  index.html            HUD DOM (base), пауза/отсчёт, подсказка обучения, шторка #fade, экран аварии/сторож, importmap
  src/main.js           бутстрап, часы и сигналы, геймплей, свет, look-связка, загрузчик плагинов, фоторежим, window.RUN
  src/config.js         константы: полосы, скорость, физика, удары, спавн, комбо, камера, свет, качество
  src/core/bus.js       шина событий on/off/emit (+ scopeBus для плагинов)
  src/core/util.js      сидированный Math.random (?seed), rnd/pick/clamp/lerp/damp, canvasTex, makeRng
  src/core/ease.js      изинги bible 2.0 (easeOutQuad/Cubic/Back/Expo, easeInOutCubic, easeInCubic…)
  src/core/input.js     клавиатура/мышь/свайпы на touchmove → действия LEFT RIGHT UP DOWN ENTER ESC PAUSE
  src/core/camera.js    риг CAM-1..5: FOV от intensity + кики, крен, trauma², облёт титула, пролёт, камера поимки
  src/core/director.js  паттерны T1–T5, промежутки в секундах, передышки, милосердие, энергоны, сценарий обучения
  src/core/missions.js  цепочка миссий (русские формы множественного числа), rizyrun_missions
  src/core/bots.js      боты sim: perfect / random / idle
  src/look/materials.js окружение (PMREM) + фабрика материалов + числа света LIGHTS
  src/look/tonemap.js   Khronos PBR Neutral (CustomToneMapping) — ставится до первой компиляции
  src/look/curve.js     «изогнутый мир» (глобальный патч чанков)
  src/look/post.js      постобработка (bloom по max-каналу, PBR Neutral, грейд, speed blur, опасность, вспышки)
  src/plugins/<slot>.js живые плагины: world, player, vfx, swarm, hud, audio (адаптеры китов)
  src/base/<slot>.js    ЗАМОРОЖЕННЫЕ фолбэки = поведение legacy/run.js; не редактируются
  src/world, src/actors/rizy, src/actors/swarm, src/fx, src/ui, src/audio — киты (подключаются адаптерами plugins/)
  tools/shot.sh, tools/console.sh, tools/eval.sh, tools/cdp.mjs — headless Chrome
```
Импорты: всегда `import * as THREE from "three"`, аддоны `three/addons/…` (importmap). Плагины и look-модули НЕ импортируют main.js.

## Порядок загрузки (main.js)
1. renderer (MSAA только без поста), scene, camera, свет (`cfg.LIGHT`; без look — legacy-интенсивности и ACES 1.18).
2. `window.RUN` выставлен синхронно (сторож index.html ждёт его 6 с).
3. `initLookEarly`: параллельный импорт curve / materials / tonemap → `installNeutralToneMapping(renderer, 1.0)` →
   `ctx.look.curve = installCurve(ctx)` (ДО любой компиляции шейдеров) → `ctx.look.mats = await createLook(ctx)` → `scene.environment = mats.env`.
4. `loadPlugins()` — по очереди world, player, vfx, swarm, hud, audio (живой → при ошибке base).
5. Подписка main на `spawn:obstacle` / `spawn:coin` ПОСЛЕ плагинов → `ctx.look.patch(ent.object3d)`.
6. `initLookLate`: `curve.patch(scene)`, `gateCurve()`, `ctx.look.post = createPost(ctx)`.
7. `emit("title")` → фоторежим или цикл rAF (+ таймер-страховка для фоновых вкладок).

## ctx (создаёт main.js; плагин получает Object.create(ctx) со своей scope-шиной)
```js
ctx = {
  THREE, renderer, scene, camera, G, cfg, bus, qp,
  quality,                         // "low" | "med" | "high" (?q=, авто: low на мобильных/≤4 ядрах, иначе med)
  look: { mats, curve, post,       // любой может быть null (?look=0, ?nopost=1, ?nocurve=1, ошибка модуля)
          patch(obj) → obj,        // гнуть поздно добавленные объекты (идемпотентно; без изгиба — no-op)
          enabled },               // false при ?look=0
  lights: { hemi, sun, fill, sunDir },   // солнце и fill ведёт main каждый кадр
  entities: { obstacles: [], coins: [], powerups: [] },
  util: { rnd, pick, clamp, lerp, damp, canvasTex, makeRng, ease },
  $,                               // getElementById
  time: { t, dt, simT, simDt },    // t/dt — реальное время; simT/simDt — масштабированное
  settings,                        // rizyrun_settings: { reducedMotion: null|bool, calm, contrast, vibro }
  simulating,                      // true во время sim()/предпрогона фоторежима (звук молчит, localStorage не пишется)
  actions: { start(opts), pause(), resume(), revive() → bool, toTitle(), skipTutorial(), setSetting(k, v),
             buyUpgrade(kind) → bool, upgradePrice(kind), powerDur(kind), reviveInfo() → { price, can, have } },
}
```

## Контракт плагина
```js
export default {
  name: "world",
  install(ctx) {                    // может быть async (таймаут 20 с)
    return {
      update(realDt, ctx, simDt) {},   // base-плагины со старым update(dt, ctx) получают realDt первым — работают как раньше
      dispose() {},
      // необязательно:
      handles: { blink: true, tutorial: true },  // плагин сам мигает неуязвимостью / сам рисует подсказки обучения
      curveReady: true,                           // (только world) трасса сегментирована — main включит изгиб
      rizy,                                       // (legacy player) rizy.g.visible = G.blinkOn ставит main, если нет handles.blink
    };
  },
};
```
- Исключения в `update()` ловятся по плагину; 3 подряд → замена на base (визуал сущностей пересоздаётся, изгиб перепроверяется).
- `?breakplugin=<slot>` — принудительная ошибка установки живого плагина (проверка фолбэка).
- Правило времени: сущности, физика, анимация бега — `simDt` (или `G.dz`); камера, затухание тряски, HUD, звук, частицы, пружины — `realDt`.

## Часы (GAME-0)
`simDt = realDt × G.timeScale`, `timeScale = min(пауза 0, хит-стоп, слоу-мо поимки, near-miss slow, туториал)`.
- Хит-стоп: 0 на 80 мс → рамп до 1 за 40 мс. Near-miss: 0.7 на 90 мс + рамп 120 мс (выкл. при reduced motion).
- Поимка: 1 → 0.25 за 500 мс по realDt. Туториал: 1 → 0.2 за 180 мс при ≤ 1.2 с до ряда, 0 при ≤ 0.35 с до верного ввода, возврат за 250 мс.
- Пауза и отсчёт 3-2-1: 0. Фоторежим: предпрогон принудительно 1, добивочные шаги (`&t`) принудительно 0.
- Шаг цикла ≤ 1/60 с (длинный кадр режется), провал > 0.35 с не догоняется. Порядок шага:
  часы → геймплей(simDt) → сигналы → `curve.update(realDt, G)` → плагины → мигание → камера → свет → пост → `frame`.

## G — состояние (владелец main.js; плагины только читают)
| Поле | Смысл |
|---|---|
| `mode` | `"title" \| "play" \| "catch" \| "over" \| "countdown"` (catch — 0.7 с слоу-мо поимки перед результатами; countdown — после паузы/спасения) |
| `paused`, `countdown` | пауза; секунды до конца отсчёта |
| `dist`, `energons`, `bonusEnergons`, `best` | метры; энергоны; бонус ловкости (Σ(mult−1) за подборы); рекорд |
| `lane`, `laneDir` | 0..2 (меняется мгновенно — честные коллизии); −1/1 последний сдвиг |
| `laneFrom`, `laneTo`, `laneT`, `laneDur` | твин x: от, до, прогресс 0..1, длительность (с) = lerp(0.150, 0.115, I) |
| `x`, `edgeX` | x Ризи = твин + отскок от края (edge bump, ±0.45) |
| `py`, `vy`, `dive` | высота, вертикальная скорость, нырок в воздухе |
| `sliding`, `slideDur` | сек подката осталось (>0 = подкат); полная длительность lerp(0.62, 0.48, I) |
| `land` | сек «сплющивания» после приземления (0.22) |
| `speed`, `speedTarget` | текущая и целевая скорость (GAME-2, 12→30) |
| `runT`, `runPhase`, `introT`, `retry` | время забега (simDt); фаза шага; реальное время с начала забега; рестарт без титула |
| `dz` | метров мир проехал в этом шаге (0 вне play/catch) |
| `grace`, `blinkOn` | неуязвимость (с); видимость при мигании (10 Гц 1.2 с → 5 Гц 0.4 с, 70%) |
| `swarmNear`, `revives`, `catchT`, `overT` | сек «рой близко»; спасений; сек поимки; сек на результатах |
| `intensity` | I = clamp((speed−12)/18) со сглаживанием tau 0.5 с (realDt) |
| `danger` | clamp(swarmNear/swarmTime) атака tau 0.1 с, спад 0.6 с |
| `trauma`, `shake` | 0..1, спад 1.5/с; shake = trauma² (0 при reduced motion) |
| `timeScale`, `realDt`, `simDt` | см. «Часы» |
| `tunnel` | 1 между `tunnel:enter` и `tunnel:exit` |
| `combo`, `mult`, `comboIdleT` | очки комбо; множитель x1..x5 (пороги 15/40/80/140); сек без событий (после 3 с утечка 4/с) |
| `nearMiss` | `{ count, kind: "lane"\|"jump"\|"slide", t (runT), obstacle }` |
| `mission` | `{ id, kind, text, goal, progress, done, index }` (мутируется на месте) |
| `tutorial` | `{ active, step, phase, action }` |
| `reducedMotion`, `calm`, `inputKind` | ОС/настройка/?rm; «спокойный темп» (скорость ×0.85); `"keys" \| "mouse" \| "touch"` |
| `wallet`, `upgrades` | ECON: кошелёк энергонов между забегами (`rizyrun_wallet`); уровни прокачки `{ magnet, shield, boost, x2 }` 0..3 (`rizyrun_upgrades`) |
| `powers`, `powerDur` | POWER: секунды до конца каждого бонуса (независимые таймеры, складываются); полная длительность подбора (для полоски HUD) |
| `flying`, `boostK` | буст: полёт над препятствиями (py → 1.6, без коллизий, прыжок/подкат игнорируются); коэффициент скорости 0..1 (×1 + 0.5·boostK), вход 0.3 с, выход 1.5 с |

## Сущности: логика в main, визуал в world
- obstacle: `{ id, kind: "jump"|"slide"|"wall", lanes: [..] (общий замороженный массив — не мутировать), z, s, row, tier, zLen,
  object3d: null, passed, touched, entered, inLane, minPy, near: ""|"lane"|"jump"|"slide", fatal }`.
  Валики и стены — по сущности на полосу; гирлянда — одна сущность на соседние полосы. Ряд = общий `row`/`s`.
- coin: `{ id, lane, x, y, z, s, arc, arcN, object3d: null, mag }` (`arc` ≠ 0 — энергон дуги из `arcN` штук; x может быть между полосами;
  `mag` — уже тянется магнитом: main двигает x/y и пишет их в `object3d.position`).
- powerup: `{ id, kind: "magnet"|"shield"|"boost"|"x2", lane, x, y (1.1), z, s, object3d: null }` — ускоритель; препятствием НЕ считается
  (боты и режиссёр его не видят). Режиссёр ставит первый на ≈180 м, дальше каждые 350–600 м посреди промежутка/передышки,
  в случайной полосе без препятствия в радиусе 6 м (`cfg.power`). Подбор: `|z| < 1.6`, `|x − G.x| < 0.95`, `|y − (0.95 + py)| < 1.5`.
  Эффекты: магнит — энергоны из всех полос в 18 м впереди тянутся к груди (`magnet` на первый рывок); щит — один удар без страйка/роя/комбо
  (`shield:break`, grace 0.6 с без мигания); буст — `G.flying`, скорость ×1.5, неуязвимость, энергоны ×2, рой отпускает, на выходе
  планирование 3.5 м/с вниз + grace 1.6 с; ×2 — энергон за два (с бустом ×4). Длительности — `cfg.power.dur[kind][уровень]`.
- `s` — абсолютная дистанция; каждый шаг `z = G.dist − s` (впереди z < 0), main пишет `object3d.position.z = z`.
- Спавн при `s − dist ≤ 118` → `emit("spawn:*", ent)` → плагин ставит `ent.object3d` → main гнёт его. Удаление → `emit("despawn", ent)`.
- Коллизии: зона `|z| ≤ zLen/2 + 0.5` на `G.lane`. jump: `py < 0.9`; slide: нет подката и `py < 2.4` (гирлянду не перепрыгнуть); wall: всегда.

## События (payload; объекты с пометкой ♻ переиспользуются — не хранить ссылку)
| Событие | Когда | Payload |
|---|---|---|
| `title` | титульный экран | — |
| `start` | старт забега | ♻ `{ retry, tutorial }` |
| `countdown` | отсчёт после паузы/спасения | `n` (3, 2, 1) |
| `pause` | пауза / вкладка скрыта / продолжили | `bool` |
| `resume` | отсчёт закончен | — |
| `lane` | смена полосы | ♻ `{ dir, from, to }` |
| `edgebump` | свайп в стену с крайней полосы | ♻ `{ dir }` |
| `jump`, `slide`, `dive` | действие | — |
| `land` | приземление с vy < −2 | ♻ `{ impact 0..1 (=|vy|/24), vy, dive }` |
| `pickup` | подбор энергона | coin |
| `hit` | удар (и в неуязвимости не шлётся) | obstacle (`fatal: true` — второй удар при рое рядом) |
| `swarm:near`, `swarm:far` | рой догнал / отстал | — |
| `catch` | фатальный удар, начало слоу-мо поимки | ♻ `{ dist, obstacle }` |
| `gameover` | через 0.7 с после catch | `{ dist, energons, bonus, best, isBest, revive: { price, can, have, left }, wallet: { earned, total } }` (энергоны + бонус зачислены в кошелёк) |
| `revive` | «Продолжить» за `cfg.reviveCost` из кошелька (≤ `reviveMax` раз за забег), затем `countdown` 3-2-1 | — |
| `spawn:powerup` | ускоритель появился (world ставит `object3d`) | ent |
| `powerup` | бонус включился / кончился | ♻ `{ kind, on, dur }` (`dur` < 0 — щит разбит ударом) |
| `boost` | буст начался / кончился (main шлёт сам; камера +8°, пост, линии скорости) | `bool` |
| `magnet` | энергон начал тянуться к Ризи | coin |
| `shield:break` | щит поглотил ряд | obstacle |
| `wallet` | кошелёк изменился | ♻ `{ total, delta }` |
| `upgrade` | куплен уровень (`actions.buyUpgrade(kind)`) | `{ kind, level, price }` |
| `nearmiss` | ловкий проход (окна GAME-8, кулдаун 1 с) | obstacle (`near` = вид) |
| `combo:tier` | смена множителя | `n` (1..5) |
| `mission:progress`, `mission:complete` | шаг / выполнение миссии | `G.mission` |
| `milestone` | каждые 250 м | `meters` |
| `landmark` | ворота-рубеж (main) или сет-пьеса (world) | ♻ `{ type: "gate", meters, s }` (world шлёт свои type) |
| `record` | пересечение рекорда (best > 100) | ♻ `{ best }` |
| `speedup` | целая часть скорости выросла | `speed` |
| `tutorial:step` | фазы обучения | ♻ `{ n, phase: "show"\|"prompt"\|"hold"\|"success"\|"free"\|"done"\|"skip", action: "lane"\|"jump"\|"slide"\|"", text }` |
| `settings` | `actions.setSetting` | settings |
| `spawn:obstacle`, `spawn:coin`, `despawn` | сущности | ent |
| `resize` | окно | `{ w, h }` |
| `frame` | конец шага | ♻ `{ dt, realDt, simDt }` |
| Принимает main от плагинов: `tunnel:enter`, `tunnel:exit` (камера −3° и −0.4 м, G.tunnel), `boost(bool)` (FOV +8°) | | |

## Look-хуки
- **Тонмаппинг**: при look — `THREE.CustomToneMapping` = PBR Neutral (tonemap.js), экспозиция 1.0; пост применяет ту же кривую в финальном проходе. `?look=0` — ACES 1.18.
- **Свет** (`cfg.LIGHT`, согласован с `materials.js LIGHTS`): hemi 0.30 (#C8DEFF/#F4EEE8), солнце #FFF1DC 2.6 из `normalize(−0.62, 0.70, −0.25)` на 30 м от цели `(G.x снап к текселю, 0, −12)`,
  fill #BFD8FF 0.45 с камеры, без тени. Тени PCFSoft, bias −0.0003, normalBias 0.03; карта low 0 (только blob-тени) / med 1024 / high 2048;
  орто-бокс считается из мирового бокса x −8..8, y −2.5..4.5, z −40..8 в пространстве света.
- **Изгиб**: `installCurve(ctx)` до компиляции; `curve.update(realDt, G)` каждый шаг; `curve.patch(scene)` после плагинов, `patch(ent.object3d)` на спавне,
  `ctx.look.patch(obj)` для поздних объектов + страховочный обход сцены раз в 2 с. **Гейт**: `curve.enabled` = world-плагин объявил `curveReady`
  (или `handles.curve`); legacy-трасса несегментирована и под изгибом «уезжает». `?curve=1|0` — принудительно. Крен камеры берёт `curve.sway`, если изгиб включён.
- **Пост** (main драйвит вручную, `bindBus` НЕ вызывается): каждый шаг `post.setSignals({ intensity, danger, reducedMotion, over })`;
  `hit` → `post.hit()` (или `flash(#FF2436, 450)`); подбор → `bloomSpike(0.12, 400)` (сумма ≤ 0.3); tier-up и рубеж → `bloomSpike(0.25, 400)`.
  Старый API без `setSignals` поддерживается (params.auto=false, speedBlur/danger/bloom/saturation/vignette ведёт main). Рендер через `post.render(realDt)`;
  если он бросит — один console.error и дальше прямой рендер. Адаптивное разрешение: у поста своё; без поста — в main (кадр > 20 мс 2 с → dpr 1.25).
- **Флаги**: `?look=0` (без IBL/изгиба/поста), `?nopost=1`, `?nocurve=1`, `?curve=1|0`, `?q=low|med|high`.

## Камера (CAM-1..5, src/core/camera.js)
Забег: FOV `60 + 8·easeOutQuad(I)` + кики (hit +5, рубеж/tier +3, near +2, boost +8, тоннель −3/+4, жёсткое приземление −1.5; сумма в [−8, +10]),
`damp(fov, target, 4)`, projection только при Δ > 0.02°. Позиция `x = damp(G.x·0.5, 6)`, `y = damp(3.8 + py·0.18, 5)`, `z = 6.4 + 0.7·I`, взгляд `(G.x·0.6, 1.0 + py·0.3, −10)`,
крен `−(LANES[lane] − x)·0.011 + sway·0.012`. Портрет: FOV +10, y 4.2. Тряска после ориентации: rotZ 3°, rotY/rotX 1.2°, сдвиг 0.12/0.10 м × trauma² × шум Эйзерло.
Титул: облёт `(5.1·sin φ, 1.6, −5.1·cos φ)` вокруг (0, 1.15, 0), φ = 0.51 + 0.17·sin(2πt/25), FOV 45. Старт: CatmullRom через (3.2, 2.6, 1.0) + slerp, 1.1 с easeInOutCubic
(рестарт — 0.6 с прямая доводка). Управление с 0.7 с (рестарт 0.3 с). Поимка: облёт 25° к свободной полосе, +1.5 м назад, +0.6 м вверх за 0.7 с, FOV без киков.
Reduced motion: без тряски/киков/FOV от скорости/крена; пролёт заменён кроссфейдом `#fade` 300 мс.

## Геймплей (GAME-1..8)
- Ввод: свайп решается на touchmove (порог max(22 px, 4% меньшей стороны), доминантная ось, второй свайп тем же касанием через 120 мс, жест ≤ 350 мс);
  тап ≤ 200 мс и < 12 px = прыжок. Буфер 130 мс для UP в воздухе, coyote 80 мс. UP в подкате — отменяет подкат и прыгает; DOWN в воздухе — нырок (vy −24) и авто-подкат.
  Клавиши ←/A →/D ↑/W/Space ↓/S, Esc/P — пауза. Элементы `button, a, input, [data-ui], [data-action]` ввод игры не запускают.
- Прыжок Pittman: h 1.9, th 0.30 → v0 12.67, gUp 42.2; |vy| < 2 → g×0.5; падение g×1.5. Интегрирование трапецией. Полёт ≈ 0.65 с.
- Скорость: t < 20 с 12→15, дальше `15 + 15·(1 − e^(−(t−20)/90))`, потолок 30; разгон со старта 0.5 с; догон цели +4 u/s². Удар: ×0.6 за 200 мс (≥ 10).
- Удар: хит-стоп, trauma +0.55, пост hit, неуязвимость 1.6 с с миганием, сброс комбо, милосердие (очередь режиссёра сдвигается: новые ряды не ближе 1.6 с).
  Два удара за время роя (5.5 с) → `catch` → через 0.7 с `gameover` → 1 с блокировка ввода → ENTER/тап = рестарт без титула (управление через 0.3 с).
- Режиссёр: промежуток 2.6 с (t < 20) → lerp(2.4, 1.1, d), d = clamp((t−20)/160)^0.8, метры = max(16, сек × скорость планирования);
  ряды внутри паттерна 0.9–1.2 с; первые 20 с только T1; веса тиров из cfg.tierWeights; передышка 3.5 с (40–100 м, только энергоны) после каждого 5-го паттерна,
  рубежа и `requestBreather()`; энергоны: дуга над валиком (9 шт., апекс 0.95 + 1.9), низкая линия под гирляндой (y 0.45), линия в свободной полосе, змейка между паттернами.
- Near-miss: (a) ряд прошёл по полосе, покинутой < 280 мс назад; (b) валик пройден с запасом высоты < 0.3 м; (c) гирлянда < 150 мс после начала подката. Кулдаун 1 с.
  Награда: комбо +5, trauma +0.10, FOV +2, micro-slow. Комбо: энергон +1, целая дуга +3, near-miss +5, шаг миссии-действия +5.
- Обучение (первый запуск без `rizyrun_tut_v1`, `?tut=1|0`): скорость 11; стена в центре → полоса; валики на 3 полосах → прыжок; гирлянда → подкат; свободный отрезок.
  Проиграть нельзя (удар без «страйка» и без роя). «Пропустить обучение» (`#tutSkip` или `actions.skipTutorial()`). В фоторежиме и sim не включается.
- Миссии: цепочка из src/core/missions.js, индекс в `rizyrun_missions`.

## Фоторежим и тесты
- `tools/shot.sh OUT.png "seed=7&shot=1&at=6[&lane=0][&pose=jump|slide][&cam=title][&hideui=1][&q=med][&fx=hit,pickup,milestone,danger,nearmiss][&t=60]" [W H]`
  - `seed` — детерминированный мир; `shot=1&at=N` — автостарт, N с шагом 1/60 без смертей (timeScale = 1), заморозка, ОДИН рендер (preserveDrawingBuffer), `document.title = "SHOT_READY"`.
  - `cam=title` — облёт титула в момент t = at (без старта). `lane`, `pose` — как раньше.
  - `fx=…` — событие перед кадром (через запятую): hit (удар по ближайшему ряду, без смерти), pickup, milestone, danger (рой рядом, danger = 1), nearmiss,
    over (поимка + карточка результатов; анимацию карточки проживать через `&t=2600`).
  - `powerup=magnet|shield|boost|x2` — бонус включается за 1.25 с до кадра; `wallet=N`, `upg=a,b,c,d` — кошелёк и уровни прокачки только в памяти;
    `shop=1` (с `cam=title`) — открыть карточку «Прокачка».
  - `t=мс` — сколько прожить после события только realDt (timeScale 0: тряска, вспышка, кики, пост идут; мир стоит). Без `t` — один добивочный шаг 1/60.
  - `rm=1` — reduced motion, `tut=1` — обучение, `breakplugin=<slot>` — проверка фолбэка.
- `tools/console.sh "query"` → JSON `{ ok, title, crash, exceptions, console }`; `tools/eval.sh "query" "JS"` → + `eval`.
- **window.RUN**: `{ ctx, G, renderer, scene, camera, startRun, step(realDt), render, sim, fairness, plugins, doAction(a, src), stats, frameInfo,
  director, rig, actions, events (геттер: последние 160 событий кроме frame, `{ t, name, payload }`), readEvents(n), ready }`.
  - `RUN.sim(seconds, bot = "idle", { seed })` — синхронный прогон шагом 1/60 без рендера (обучение выкл.); bot: `"perfect" | "random" | "idle"`;
    `seed` меняет геймплейный генератор без перезагрузки. Возвращает `{ seed, bot, seconds, dist, speed, energons, bonus, hits, shieldHits, powerups,
    powerupsSpawned, gameover, jumps, slides, laneChanges, nearMisses, mult, patterns, passed: {jump, slide, wall}, hitLog: [{t, dist, kind, lanes, tier, lane, py, sliding}] }`.
  - `RUN.fairness(seeds = [1..10], seconds = 300)` — perfect-бот по сидам. Приёмка: 0 ударов (и 0 `shieldHits`) на каждом сиде; `sim(90, "idle")` заканчивается `gameover`.
    Бот perfect берёт ускоритель в своей полосе (бонус полосы 0.5 < цена смены полосы), но ради него не рискует; sim кошелёк не трогает.
  - `RUN.wallet`, `RUN.activatePower(kind)`, `RUN.walletAdd(n)` — экономика и бонусы для тестов.
  - `RUN.frameInfo` — `renderer.info` за ВЕСЬ последний кадр (тени + сцена + проходы поста; autoReset выключен).

## Бюджет производительности
60 fps на MacBook Air 2020 в Chrome, 1280×720, q=med. Цель в игре ≤ 120 draw calls (лимит 400) — считать по `RUN.frameInfo.calls`.
Горячий цикл без аллокаций: payload-ы ♻, пул элементов очереди режиссёра, общие массивы полос, удаление сущностей без splice.
Аллокации допускаются только на спавн сущностей, генерацию паттерна (раз в 1–3 с), удар и конец забега.

## localStorage (каждое чтение/запись в try/catch; в sim и фоторежиме не пишется)
`rizyrun_best` · `rizyrun_settings` · `rizyrun_tut_v1` · `rizyrun_missions` · `rizyrun_wallet` (число) · `rizyrun_upgrades` (`{ magnet, shield, boost, x2 }`)
(зарезервированы: `rizyrun_daily`, `rizyrun_streak`).

## Экономика (ECON) и ускорители (POWER)
- Кошелёк: на `gameover` в кошелёк идут энергоны + бонус ловкости (после «Продолжить» — только прирост). Титул и магазин показывают `G.wallet`,
  карточка результатов — «+N за забег · всего M». «Продолжить за 100 ⬡» (`cfg.reviveCost`, `reviveMax` 1 раз за забег): рой отпускает, 3-2-1,
  неуязвимость 3 с, скорость ×0.85, препятствия ближе 30 м убираются. Не хватает — кнопка неактивна с подсказкой.
- Магазин «Прокачка» (титул): 4 улучшения × 3 уровня, цены `cfg.power.prices` 150/400/900; длительность `cfg.power.dur[kind]` =
  [без прокачки, ур.1, ур.2, ур.3]: магнит 4/6/9/12 с, щит 7/10/15/20 с, буст 3.5/5/7/9 с, ×2 6/8/12/16 с. HUD: чип с иконкой и убывающей полоской.
- Визуал пикапов — world-кит (`makePowerup`, инстансные части: фигурка по виду + кольцо + ореол + blob, ≈ +3 draw calls при видимом пикапе);
  пузырь щита — vfx-адаптер; звуки `powerup` (высота по виду), `powerdown`, `shield`.

## Стиль RIZYLAND
Электрический синий #0536D4, лайм #C0FF3F (только награды), чернила #070D36, hazard #FF3B5C, danger #FF2436, снег #F2F6FF, холодная тень #2A3C9A.
Мягкие войлочные/игрушечные формы, пастельная зима, яркое боковое солнце. Ризи (по мастер-листам 2026-09): пряжевая кукла — синяя войлочная кожа
#3f80f5, лаймовое каре из прядей пряжи с двумя пучками-спиралями, огромные глянцевые глаза, открытая улыбка с зубами и язычком, короткий чёрный
свитер с аппликациями-цветами (лайм/синий), широкие ярко-синие джинсы, чёрные кеды с белым мыском и лаймовыми шнурками. Шарф и рюкзак —
только по опциям `scarf`/`backpack` (по умолчанию выключены).
Злодеи — рой Гасителей: тёмные войлочные помпоны со светящимся красным глазом.
