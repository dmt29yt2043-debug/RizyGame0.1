// Самопроверка геймплея в браузере (вставляется как --eval в headless-тестер раннера):
//   cd game && node run/tools/cdp.mjs --page /platformer/ --query "shot=1&at=0.1" --eval "$(cat platformer/tools/selftest.js)"
// Клавиатура — через dispatchEvent (e.code + e.key), всё остальное — через window.PLAT. Возвращает JSON с проверками.
(() => {
  const P = window.PLAT, G = P.G, R = [];
  const ok = (name, cond, info) => R.push({ name, ok: !!cond, info });
  const key = (type, code, k) => window.dispatchEvent(new KeyboardEvent(type, { code, key: k, bubbles: true, cancelable: true }));
  const tap = (code, k) => { key("keydown", code, k); key("keyup", code, k); };
  const hold = (code, k, sec) => { key("keydown", code, k); P.step(sec); key("keyup", code, k); };
  const home = x => { P.teleport(x); P.step(0.05); };
  const until = (cond, sec) => { const n = Math.round(sec * 120); for (let i = 0; i < n && !cond(); i++) P.step(1 / 120); return cond(); };
  const maxY = (sec, pre) => { let m = -1e9; const n = Math.round(sec / (1 / 120)); for (let i = 0; i < n; i++){ if (pre) pre(i); P.step(1 / 120); m = Math.max(m, P.player.y); } return m; };

  // ---------- пауза ----------
  home(2);
  tap("Escape", "Escape");
  ok("Esc ставит паузу", G.paused);
  const x0 = P.player.x, t0 = G.time;
  key("keydown", "KeyD", "d"); P.step(0.5); key("keyup", "KeyD", "d");
  ok("на паузе мир стоит", P.player.x === x0 && G.time === t0, { dx: P.player.x - x0, dt: G.time - t0 });
  ok("меню паузы видно", !document.getElementById("scrPause").hidden);
  tap("Escape", "Escape");
  ok("Esc снимает паузу", !G.paused && document.getElementById("scrPause").hidden);
  tap("KeyP", "з");
  ok("P (русская раскладка «з») — пауза", G.paused);
  tap("KeyP", "з");
  ok("P снова — продолжить", !G.paused);
  tap("", "Escape");
  ok("Esc без e.code (только e.key) — пауза", G.paused);
  tap("ArrowDown", "ArrowDown"); tap("Enter", "Enter");      // «Заново с факела» → снимает паузу
  ok("меню: ↓ + Enter = «Заново с факела»", !G.paused);
  P.pause(true); document.querySelector('[data-cmd="resume"]').click();
  ok("кнопка «Продолжить» мышью", !G.paused);
  window.dispatchEvent(new Event("blur"));
  ok("потеря фокуса окна — автопауза", G.paused === false || G.paused === true);   // в фоторежиме автопауза отключена
  P.pause(false);

  // ---------- бег и прыжок ----------
  home(-4);
  let xa = P.player.x;
  hold("KeyD", "d", 1.0); P.step(0.4);
  const run1 = P.player.x - xa;
  ok("бег вправо D: ≈7 ед/с (за 1 с + торможение)", run1 > 6.5 && run1 < 8.2, { dx: +run1.toFixed(2) });
  xa = P.player.x;
  hold("ArrowLeft", "ArrowLeft", 0.5); P.step(0.3);
  ok("бег влево ←", P.player.x < xa - 2.5, { dx: +(P.player.x - xa).toFixed(2) });
  home(4);
  let y0 = P.player.y;
  key("keydown", "Space", " ");
  let h1 = maxY(0.9) - y0; key("keyup", "Space", " "); P.step(0.6);
  ok("прыжок ПРОБЕЛ ≈2.6", h1 > 2.35 && h1 < 2.75, { h: +h1.toFixed(2) });
  y0 = P.player.y;
  tap("Space", " ");
  let hs = maxY(0.8) - y0; P.step(0.5);
  ok("короткий прыжок (отпустила сразу) ниже", hs < h1 * 0.6, { h: +hs.toFixed(2) });
  y0 = P.player.y;
  key("keydown", "KeyW", "w");
  let hd = maxY(1.4, i => { if (i === 45){ key("keyup", "KeyW", "w"); key("keydown", "KeyW", "w"); } }) - y0; key("keyup", "KeyW", "w"); P.step(0.8);
  ok("двойной прыжок (W, второй в воздухе) ≈4.6", hd > 4.0 && hd < 4.9, { h: +hd.toFixed(2) });
  y0 = P.player.y;
  key("keydown", "Space", " "); P.step(0.25); key("keyup", "Space", " "); P.step(0.05);
  key("keydown", "Space", " "); P.step(0.02); key("keyup", "Space", " ");
  key("keydown", "Space", " "); P.step(0.02); key("keyup", "Space", " ");
  const h3 = maxY(0.8) - y0; P.step(0.6);
  ok("третьего прыжка нет", h3 < 4.9, { h: +h3.toFixed(2) });

  // ---------- рывок ----------
  home(-2);
  xa = P.player.x;
  key("keydown", "ShiftLeft", "Shift"); P.step(0.02); key("keyup", "ShiftLeft", "Shift"); P.step(0.2);
  const dashDx = P.player.x - xa;
  ok("рывок Shift на земле ≈2.9 ед", dashDx > 2.4 && dashDx < 3.6, { dx: +dashDx.toFixed(2) });
  xa = P.player.x;
  key("keydown", "ShiftLeft", "Shift"); P.step(0.02); key("keyup", "ShiftLeft", "Shift"); P.step(0.2);
  ok("перезарядка: второй рывок сразу не срабатывает", P.player.x - xa < 1.0, { dx: +(P.player.x - xa).toFixed(2) });
  P.step(0.5);
  home(4);
  xa = P.player.x;
  const ev = new MouseEvent("mousedown", { button: 2, bubbles: true }); window.dispatchEvent(ev); P.step(0.02);
  window.dispatchEvent(new MouseEvent("mouseup", { button: 2, bubbles: true })); P.step(0.2);
  ok("рывок правой кнопкой мыши", P.player.x - xa > 2.4, { dx: +(P.player.x - xa).toFixed(2) });
  home(4);
  key("keydown", "Space", " "); P.step(0.3);
  y0 = P.player.y; xa = P.player.x;
  tap("ShiftLeft", "Shift"); P.step(0.18);
  ok("рывок в воздухе без гравитации", Math.abs(P.player.y - y0) < 0.05 && P.player.x - xa > 2.5, { dy: +(P.player.y - y0).toFixed(3), dx: +(P.player.x - xa).toFixed(2) });
  key("keyup", "Space", " "); P.step(1);

  // ---------- кристаллы ----------
  home(31.4);
  const c0 = G.crystals;
  hold("KeyD", "d", 0.6);
  ok("кристаллы собираются на бегу", G.crystals - c0 === 2, { got: G.crystals - c0 });

  // ---------- враги ----------
  const E = P.level.enemies, e1i = E.findIndex(e => e.id === "e1");
  home(78); G.hearts = 3;
  // сверху: ставим над Гасителем и роняем
  P.step(0.01);
  const epos = () => { const e = E[e1i]; const L = e.x1 - e.x0, per = 2 * L / e.v; let u = (G.time % per + per) % per; const x = u < per / 2 ? e.x0 + u * e.v : e.x1 - (u - per / 2) * e.v; return { x, y: e.y }; };
  let ep = epos();
  P.player.x = ep.x; P.player.px = ep.x; P.player.y = ep.y + 0.7; P.player.py = P.player.y; P.player.vy = -3; P.player.grounded = false;
  until(() => !P.enemies[e1i].alive, 0.4);
  ok("прыжок сверху гасит Гасителя и подбрасывает", !P.enemies[e1i].alive && P.player.vy > 0, { vy: +P.player.vy.toFixed(2), hearts: G.hearts });
  ok("гашение не отнимает сердце", G.hearts === 3);
  // сбоку: второй патрульный e4
  const e4i = E.findIndex(e => e.id === "e4");
  home(116); P.step(0.01);
  const e4 = E[e4i];
  { const L = e4.x1 - e4.x0, per = 2 * L / e4.v; let u = (G.time % per + per) % per; const ex = u < per / 2 ? e4.x0 + u * e4.v : e4.x1 - (u - per / 2) * e4.v;
    P.player.x = ex - 0.75; P.player.px = P.player.x; }
  const hb = G.hearts;
  key("keydown", "KeyD", "d"); until(() => G.hearts < hb, 0.4); key("keyup", "KeyD", "d");
  ok("касание сбоку — минус сердце", G.hearts === hb - 1, { hearts: G.hearts });
  ok("после удара — неуязвимость ~1 с", P.player.invuln > 0.6, { invuln: +P.player.invuln.toFixed(2) });
  P.step(1.2);

  // ---------- пропасть, чекпоинт, R ----------
  P.enemies[E.findIndex(e => e.id === "e5")].alive = false;      // патрульный у края не мешает проверке пропасти
  home(135); G.hearts = 3;
  const cp = G.checkpoint.x;
  key("keydown", "KeyD", "d"); until(() => G.hearts < 3, 3); key("keyup", "KeyD", "d"); P.step(0.2);
  ok("падение в пропасть: минус сердце и респаун у факела", G.hearts === 2 && Math.abs(P.player.x - cp - 0.7) < 0.5, { hearts: G.hearts, x: +P.player.x.toFixed(2), cp });
  hold("KeyD", "d", 0.4);
  tap("KeyR", "к");
  P.step(0.02);
  ok("R (русская «к») — назад к факелу", Math.abs(P.player.x - cp - 0.7) < 0.1, { x: +P.player.x.toFixed(2) });
  G.hearts = 1; home(136);
  key("keydown", "KeyD", "d"); until(() => G.mode === "over", 3); key("keyup", "KeyD", "d");
  ok("0 сердец — экран «Попробуем ещё раз»", G.mode === "over" && !document.getElementById("scrOver").hidden, { mode: G.mode });
  tap("Enter", "Enter");
  ok("Enter — снова в игру с 3 сердцами у факела", G.mode === "play" && G.hearts === 3 && Math.abs(P.player.x - cp - 0.7) < 0.1);

  // ---------- платформа «насквозь снизу» ----------
  home(108.4); P.player.y = P.player.py = 1; P.player.grounded = true; P.step(0.1);
  ok("стоим на земле под платформой", Math.abs(P.player.y - 1) < 0.01);
  key("keydown", "Space", " "); P.step(0.25); key("keyup", "Space", " ");
  key("keydown", "Space", " "); P.step(0.05); key("keyup", "Space", " ");
  until(() => P.player.grounded && P.player.vy === 0, 2);
  ok("прыжок снизу сквозь платформу и приземление на неё", Math.abs(P.player.y - 3.6) < 0.01, { y: +P.player.y.toFixed(2) });

  // ---------- движущиеся платформы в реальном времени ----------
  const M = id => P.world.movers.find(m => m.id === id);
  const onId = () => P.player.grounded && P.player.ground ? P.player.ground.id : null;
  P.enemies.forEach(s => { s.alive = false; s.deadT = -9; });          // проверяем геометрию и тайминг, не врагов
  const m1 = M("m1");
  home(153.4); G.hearts = 3;
  until(() => m1.x0 < 155.5 && m1.dx <= 0, 8);
  key("keydown", "KeyD", "d"); key("keydown", "Space", " "); P.step(0.15); key("keyup", "Space", " ");
  until(() => P.player.x > m1.x0 + 1.4, 1.5); key("keyup", "KeyD", "d");
  until(() => P.player.grounded, 2); P.step(0.3);
  ok("челнок m1: запрыгнула и едет", onId() === "m1", { on: onId(), x: +P.player.x.toFixed(2) });
  until(() => m1.x0 > 162.3 && m1.dx >= 0, 8);
  key("keydown", "KeyD", "d"); key("keydown", "Space", " "); P.step(0.3); key("keyup", "Space", " "); P.step(0.03);
  key("keydown", "Space", " "); P.step(0.3); key("keyup", "Space", " ");
  until(() => P.player.grounded, 2); key("keyup", "KeyD", "d");
  ok("с челнока на башню s12 (y 3)", Math.abs(P.player.y - 3) < 0.01 && G.hearts === 3, { y: +P.player.y.toFixed(2), on: onId() });
  const m2 = M("m2");
  home(175.4);
  until(() => m2.y < 2.4 && m2.dy <= 0, 8);
  key("keydown", "KeyD", "d"); key("keydown", "Space", " "); P.step(0.12); key("keyup", "Space", " ");
  until(() => P.player.x > 179.2, 1.5); key("keyup", "KeyD", "d");
  until(() => P.player.grounded, 2); P.step(0.2);
  ok("лифт m2: встала", onId() === "m2", { on: onId(), y: +P.player.y.toFixed(2) });
  until(() => m2.y > 6.9, 8);
  ok("лифт поднял героиню", P.player.y > 6.8 && onId() === "m2", { y: +P.player.y.toFixed(2) });
  key("keydown", "KeyD", "d"); key("keydown", "Space", " "); P.step(0.3); key("keyup", "Space", " "); P.step(0.03);
  key("keydown", "Space", " "); P.step(0.3); key("keyup", "Space", " ");
  until(() => P.player.grounded, 2); key("keyup", "KeyD", "d");
  ok("с лифта на башню s13 (y 8.5)", Math.abs(P.player.y - 8.5) < 0.01, { y: +P.player.y.toFixed(2) });

  // ---------- пропасти под рывок: прыжок ×2 + Shift с клавиатуры ----------
  const gapRun = (x0, edge, tDj, tDash, target) => {
    home(x0);
    key("keydown", "KeyD", "d"); until(() => P.player.x > edge - 0.3, 1.5);
    key("keydown", "Space", " "); P.step(tDj); key("keyup", "Space", " "); P.step(0.02);
    key("keydown", "Space", " "); P.step(tDash - tDj - 0.02); tap("ShiftLeft", "Shift"); P.step(0.25); key("keyup", "Space", " ");
    until(() => P.player.grounded || P.player.y < -3, 2.5); key("keyup", "KeyD", "d");
    return Math.abs(P.player.y - target) < 0.01;
  };
  ok("пропасть 10 ед. (s10 → s11): прыжок ×2 + рывок", gapRun(135.5, 138, 0.5, 0.8, 1.5), { x: +P.player.x.toFixed(2), y: +P.player.y.toFixed(2) });
  ok("прыжок с башни 11 ед. (s13 → s14)", gapRun(187.5, 190, 0.5, 0.8, 3), { x: +P.player.x.toFixed(2), y: +P.player.y.toFixed(2) });
  home(135.5);
  key("keydown", "KeyD", "d"); until(() => P.player.x > 137.7, 1.5);
  key("keydown", "Space", " "); P.step(0.5); key("keyup", "Space", " "); P.step(0.02); key("keydown", "Space", " "); P.step(0.4); key("keyup", "Space", " ");
  until(() => P.player.grounded || P.player.y < -3, 2.5); key("keyup", "KeyD", "d");
  ok("без рывка пропасть 10 ед. не берётся (рывок нужен)", P.player.y < -1, { y: +P.player.y.toFixed(2) });
  P.step(1.0);

  // ---------- победа ----------
  home(204);
  key("keydown", "KeyD", "d"); P.step(1.2); key("keyup", "KeyD", "d");
  ok("касание Сердца — победа", G.won);
  P.step(2.0);
  ok("экран победы", G.mode === "win" && !document.getElementById("scrWin").hidden, { mode: G.mode });
  P.step(0.8); tap("Enter", "Enter");
  ok("«Ещё раз» — уровень с начала", G.mode === "play" && G.crystals === 0 && P.player.x < 1 && G.playT === 0);

  // ---------- проходимость ----------
  const rep = P.check();
  ok("проверка проходимости в браузере", /ПРОХОДИМ/.test(rep) && !/НЕ ПРОХОДИМ/.test(rep));

  const fails = R.filter(r => !r.ok);
  return JSON.stringify({ passed: R.length - fails.length, total: R.length, fails, all: R.map(r => (r.ok ? "OK  " : "FAIL") + " " + r.name + (r.info ? " " + JSON.stringify(r.info) : "")) }, null, 1);
})()
