// РИЗИ: ПОБЕГ ИЗ ИДЕАЛИТИ — мини-бродилка в духе Little Big Adventure.
// Движок: canvas 960x540, пре-рендеренные фоны + спрайты с масштабом по глубине.

"use strict";

// ---------- УТИЛИТЫ ----------
const cv = document.getElementById("cv");
const ctx = cv.getContext("2d");
ctx.imageSmoothingEnabled = true;
ctx.imageSmoothingQuality = "high";   // без этого тонкие лапы Му-Хрю мылятся при ужатии
const $ = id => document.getElementById(id);
const clamp = (v,a,b) => Math.max(a, Math.min(b, v));
const dist = (x1,y1,x2,y2) => Math.hypot(x2-x1, y2-y1);
const lerp = (a,b,t) => a + (b-a)*t;

function pointInPoly(x, y, poly){
  let inside = false;
  for (let i=0, j=poly.length-1; i<poly.length; j=i++){
    const xi=poly[i][0], yi=poly[i][1], xj=poly[j][0], yj=poly[j][1];
    if (((yi>y)!==(yj>y)) && (x < (xj-xi)*(y-yi)/(yj-yi)+xi)) inside = !inside;
  }
  return inside;
}

// ---------- ЗАГРУЗКА АРТА ----------
const A = {}; // ключ -> {img|canvas, ok}
function makePlaceholder(key){
  const [color, label] = PLACEHOLDER[key] || ["#666", key];
  const isBg = key.startsWith("bg_");
  const c = document.createElement("canvas");
  c.width = isBg ? 960 : 220; c.height = isBg ? 540 : 330;
  const g = c.getContext("2d");
  if (isBg){
    const gr = g.createLinearGradient(0,0,0,540);
    gr.addColorStop(0, "#0a0e24"); gr.addColorStop(.55, color); gr.addColorStop(1, "#0a0e24");
    g.fillStyle = gr; g.fillRect(0,0,960,540);
    g.fillStyle = "rgba(255,255,255,.08)";
    for (let i=0;i<40;i++) g.fillRect(Math.random()*960, Math.random()*540, 3, 3);
    g.fillStyle = "rgba(255,255,255,.25)"; g.font = "700 28px system-ui"; g.textAlign="center";
    g.fillText(label, 480, 90);
  } else {
    // «войлочная» капля-фигурка
    g.fillStyle = color;
    g.beginPath(); g.ellipse(110, 210, 62, 95, 0, 0, 7); g.fill();
    g.beginPath(); g.arc(110, 80, 48, 0, 7); g.fill();
    g.fillStyle = "#0b0f2a";
    g.beginPath(); g.arc(92, 72, 7, 0, 7); g.arc(128, 72, 7, 0, 7); g.fill();
    g.beginPath(); g.arc(110, 96, 10, 0, Math.PI); g.stroke();
  }
  return c;
}
function loadAssets(done){
  const keys = Object.keys(IMGS);
  let left = keys.length;
  keys.forEach(k => {
    const img = new Image();
    img.onload = () => { A[k] = {img, ok:true}; if (--left===0) done(); };
    img.onerror = () => { A[k] = {img: makePlaceholder(k), ok:false}; if (--left===0) done(); };
    img.src = IMGS[k] + "?v=" + ART_VERSION;
  });
}
const ART_VERSION = 2;

// ---------- СОСТОЯНИЕ ----------
const S = {
  mode: "title",            // title | play | dialog | cut | fade | end
  scene: "home",
  stage: 0,
  x: 480, y: 430, dir: 1,   // dir: 1 вправо, -1 влево
  faceX: 0, faceY: 1,       // направление взгляда (8-way) для выбора ракурса
  moving: false, running: false, walkAmp: 0,
  energy: 100, energons: 0,
  pulseT: 0,                // время с последнего импульса (для анимации кольца)
  pulseX: 0, pulseY: 0,
  trueSight: 0,             // сек. истинного зрения
  paralyzed: 0,
  shipCharge: 0,
  illusionSolved: false,
  lampFound: false,
  fantJoined: false,
  pulseUnlocked: false,
  oldmanDone: false,
  boosterOffer: false,
  alarmCooldown: 0,
  waveTimer: 0,
  walkT: 0,
  debug: false,
  gargAsleepHintShown: false,
};
let entities = { npcs: [], pickups: [], enemies: [], zones: [], gargoyle: null, shipNode: null, illusionItems: [] };
let companions = {
  kubi: {x:450,y:400},
  fant: {x:450,y:400},
  muhru: {x:450,y:430, faceX:0, faceY:1, walkT:0, walkAmp:0, moving:false},
};

// Му-Хрю идёт следом сам: держит дистанцию, разворачивается и переставляет ноги
function updateFollower(f, dt, tx, ty, sc, speed){
  const d = dist(f.x, f.y, tx, ty);
  const depth = depthScale(sc, f.y);
  if (d > 58){
    const vx = (tx-f.x)/d, vy = (ty-f.y)/d;
    const step = Math.min(d - 52, speed * depth * dt);
    const nx = f.x + vx*step, ny = f.y + vy*step;
    if (pointInPoly(nx, ny, sc.poly)){ f.x = nx; f.y = ny; }
    else { f.x = lerp(f.x, tx, dt*1.5); f.y = lerp(f.y, ty, dt*1.5); }
    f.faceX = Math.abs(vx) > 0.4 ? Math.sign(vx) : 0;
    f.faceY = Math.abs(vy) > 0.3 ? Math.sign(vy) : (f.faceX ? 0 : 1);
    f.walkT += (step / (180 * depth * 0.19)) * Math.PI;
    f.moving = true;
  } else f.moving = false;
  f.walkAmp = lerp(f.walkAmp, f.moving ? 1 : 0, Math.min(1, dt*9));
}

// Куда сейчас идти по заданию — над этой точкой висит маркер
function questTarget(){
  const npc = id => entities.npcs.find(n => n.id === id);
  const pick = k => entities.pickups.find(p => p.kind === k);
  if (S.scene === "home"){
    if (S.stage === 0) return npc("savia");
    if (S.stage === 1) return npc("attic");
    if (S.stage === 3) return { x:938, y:470 };
  }
  if (S.scene === "street"){
    if (S.stage === 4) return pick("lamp");
    if (S.stage === 5) return npc("muhru");
    if (S.stage >= 6) return npc("hatch");
  }
  if (S.scene === "tunnels" && S.stage === 7) return { x:790, y:325 };
  if (S.scene === "hangar" && S.stage === 9) return entities.shipNode;
  if (S.scene === "lumenira" && S.stage === 10) return { x:490, y:430 };
  return null;
}

// ---------- СЦЕНЫ ----------
// Координаты — в пространстве канваса 960x540. horizon — линия «дальнего края» пола.
const SCENES = {
  home: {
    bg: "bg_home", horizon: 290,
    poly: [[75,340],[575,305],[665,318],[950,435],[950,535],[85,535]],
    spawn: [450, 470],
    build(){
      const e = fresh();
      // Мама или капсула — слева, у оранжереи
      e.npcs.push({ id:"savia", key:"sp_savia", x:150, y:385, h:140,
        label: S.stage>=3 ? "E — капсула мамы" : "E — поговорить с мамой",
        capsule: S.stage>=3 });
      // Триггер чердака — у крыльца дома
      if (S.stage===1) e.npcs.push({ id:"attic", key:null, x:365, y:322, h:0, label:"E — подняться на чердак" });
      addEnergons(e, [[700,480,10],[820,475,10],[350,500,15]]);
      e.exits = [{ x1:930, y1:430, x2:960, y2:540, to:"street", need:3,
                   deny:"Сначала — праздник. Мама ждёт у оранжереи." }];
      return e;
    }
  },
  street: {
    bg: "bg_street", horizon: 295,
    poly: [[40,335],[920,330],[950,530],[15,530]],
    spawn: [70, 450],
    build(){
      const e = fresh();
      e.npcs.push({ id:"muhru", key:"sp_muhru", x:150, y:430, h:178, label:"E — Му-Хрю" });
      if (!S.oldmanDone) e.npcs.push({ id:"oldman", key:"sp_oldman", x:770, y:405, h:120, label:"E — старик в огромных очках" });
      e.npcs.push({ id:"booster", key:null, x:150, y:335, h:0, label:"E — бустерная" });
      if (S.stage===4 && !S.lampFound)
        e.pickups.push({ id:"lamp", x:880, y:365, r:26, kind:"lamp", label:"E — взять лампьютер" });
      addEnergons(e, [[420,500,10],[520,380,10],[610,470,15],[760,510,10],[330,430,10]]);
      e.enemies.push(mkKubit(400, 470, 620, 470), mkKubit(500, 390, 700, 390));
      e.npcs.push({ id:"hatch", key:null, x:480, y:458, h:0, label:"E — открыть люк" });
      e.exits = [];
      return e;
    }
  },
  tunnels: {
    bg: "bg_tunnels", horizon: 285,
    poly: [[40,335],[900,308],[940,530],[20,530]],
    spawn: [70, 480],
    build(){
      const e = fresh();
      // старт слева свободен, дальше по очереди: патруль → поле Кристов → спящий Гаргонт → ворота
      e.enemies.push(mkSprut(190, 455, 390, 455));
      e.zones = [ mkKristy(440, 345, 165, 175, 0) ];
      e.gargoyle = { x:680, y:330, r:115 };
      addEnergons(e, [[150,400,10],[300,520,15],[660,505,10],[860,470,20]]);
      e.pickups.push({ id:"boost1", x:150, y:350, r:22, kind:"booster", label:"E — бустер «Фокусник»" });
      e.exits = [{ x1:700, y1:308, x2:880, y2:345, to:"hangar", need:0 }];
      return e;
    }
  },
  hangar: {
    bg: "bg_hangar", horizon: 295,
    poly: [[35,335],[925,335],[950,530],[10,530]],
    spawn: [80, 460],
    build(){
      const e = fresh();
      if (!S.illusionSolved){
        e.illusionItems = [
          { x:300, y:390, kind:"bottle", label:"флакон бустера" },
          { x:520, y:350, kind:"papers", label:"стопка бумаг" },
          { x:680, y:440, kind:"chair",  label:"дизайнерское кресло" },
          { x:430, y:480, kind:"pen",    label:"ручка Му-Хрю", correct:true },
        ];
      }
      e.shipNode = { x:720, y:350, r:115 };
      e.exits = [];
      return e;
    }
  },
  lumenira: {
    bg: "bg_lumenira", horizon: 300,
    poly: [[40,340],[920,340],[945,530],[15,530]],
    spawn: [90, 470],
    build(){
      const e = fresh();
      e.npcs.push({ id:"heart_of_forest", key:null, x:490, y:420, h:0, label:"" });
      e.exits = [];
      return e;
    }
  },
};
function fresh(){ return { npcs:[], pickups:[], enemies:[], zones:[], exits:[], gargoyle:null, shipNode:null, illusionItems:[] }; }
function addEnergons(e, list){ list.forEach(([x,y,v],i) => e.pickups.push({ id:"en"+i+x, x, y, r:16, kind:"energon", value:v })); }
function mkKubit(x1,y1,x2,y2){
  return { kind:"kubit", key:"sp_kubit", x:x1, y:y1, x1,y1,x2,y2, t:Math.random()*2, dirp:1,
           stun:0, chase:false, hitCd:0, h:70, ttl:Infinity };
}
function mkSprut(x1,y1,x2,y2){
  return { kind:"sprut", key:"sp_sprut", x:x1, y:y1, x1,y1,x2,y2, t:0, dirp:1, stun:0, hitCd:0, h:150, ttl:Infinity };
}
function mkKristy(x,y,w,h,phase){ return { kind:"kristy", x,y,w,h, period:6.2, activeFrom:3.4, phase }; }

// ---------- ПЕРЕХОДЫ, ДИАЛОГИ, КАТСЦЕНЫ ----------
let dialogQueue = [], dialogIdx = 0, dialogDone = null;
let cutQueue = [], cutIdx = 0, cutDone = null;

function showDialog(lines, done){
  dialogQueue = lines; dialogIdx = 0; dialogDone = done || null;
  S.mode = "dialog"; $("dialog").style.display = "block";
  renderDialogLine();
}
function renderDialogLine(){
  const l = dialogQueue[dialogIdx];
  $("dname").textContent = l.s;
  $("dtext").textContent = l.t;
  const p = l.p && A[l.p];
  $("dportrait").style.display = p ? "block" : "none";
  if (p){
    if (p.ok) { $("dportrait").src = A[l.p].img.src; }
    else { $("dportrait").src = A[l.p].img.toDataURL ? A[l.p].img.toDataURL() : ""; }
  }
}
function advanceDialog(){
  dialogIdx++;
  if (dialogIdx >= dialogQueue.length){
    $("dialog").style.display = "none";
    // если поверх уже открыта катсцена — не роняем режим в play (гонка диалог/катсцена)
    S.mode = $("cut").style.display === "block" ? "cut" : "play";
    if (dialogDone) { const f = dialogDone; dialogDone = null; f(); }
  } else renderDialogLine();
}

function showCut(steps, done){
  cutQueue = steps; cutIdx = 0; cutDone = done || null;
  $("dialog").style.display = "none";   // катсцена всегда перекрывает диалог
  S.mode = "cut"; $("cut").style.display = "block";
  renderCutStep();
}
function renderCutStep(){
  const c = cutQueue[cutIdx];
  const a = A[c.img];
  $("cutimg").src = a ? (a.ok ? a.img.src : (a.img.toDataURL ? a.img.toDataURL() : "")) : "";
  $("cuttext").innerHTML = c.t;
}
function advanceCut(){
  cutIdx++;
  if (cutIdx >= cutQueue.length){
    $("cut").style.display = "none";
    S.mode = "play";
    if (cutDone) { const f = cutDone; cutDone = null; f(); }
  } else renderCutStep();
}

function setStage(n){
  S.stage = n;
  $("objText").textContent = OBJECTIVES[n] || "";
  rebuildScene();
}
function rebuildScene(){
  entities = SCENES[S.scene].build();
}
function gotoScene(name, after){
  $("fade").style.opacity = 1;
  setTimeout(() => {
    S.scene = name;
    const sc = SCENES[name];
    S.x = sc.spawn[0]; S.y = sc.spawn[1];
    companions.kubi = { x:S.x-40, y:S.y-10 };
    companions.fant = { x:S.x+40, y:S.y-10 };
    companions.muhru = { x:S.x-70, y:S.y+8, faceX:0, faceY:1, walkT:0, walkAmp:0, moving:false };
    rebuildScene();
    sceneLabel(SCENE_NAMES[name]);
    $("fade").style.opacity = 0;
    if (after) after();
  }, 500);
}
function sceneLabel(text){
  const el = $("label");
  el.textContent = text; el.style.opacity = 1;
  setTimeout(()=>{ el.style.opacity = 0; }, 2600);
}
function flash(){
  const f = $("flash");
  f.style.transition = "none"; f.style.opacity = .95;
  setTimeout(()=>{ f.style.transition = "opacity 1.2s"; f.style.opacity = 0; }, 30);
}

// ---------- ВВОД ----------
const keys = {};
addEventListener("keydown", ev => {
  if (["ArrowUp","ArrowDown","ArrowLeft","ArrowRight","Space"].includes(ev.code)) ev.preventDefault();
  keys[ev.code] = true;

  if (ev.code === "F2"){ S.debug = !S.debug; return; }

  if (S.mode === "title" && (ev.code === "Enter" || ev.code === "KeyE")) return startGame();
  if (S.mode === "end" && ev.code === "Enter") return location.reload();
  if (S.mode === "dialog" && (ev.code === "KeyE" || ev.code === "Enter")) return advanceDialog();
  if (S.mode === "cut" && (ev.code === "KeyE" || ev.code === "Enter")) return advanceCut();
  if (S.mode === "play"){
    if (ev.code === "KeyE" || ev.code === "Enter") tryInteract();
    if (ev.code === "Space") tryPulse();
  }
});
addEventListener("keyup", ev => { keys[ev.code] = false; });
cv.addEventListener("click", ev => {
  if (!S.debug) return;
  const r = cv.getBoundingClientRect();
  const x = Math.round((ev.clientX - r.left) * (960 / r.width));
  const y = Math.round((ev.clientY - r.top) * (540 / r.height));
  console.log(`[debug] click: [${x}, ${y}] scene=${S.scene}`);
});

// ---------- ГЕЙМПЛЕЙ ----------
function startGame(){
  $("title").style.display = "none";
  showCut(CUTS.prologue, () => {
    S.mode = "play";
    setStage(0);
    sceneLabel(SCENE_NAMES.home);
  });
}

function nearestInteractable(){
  let best = null, bestD = 100;
  for (const n of entities.npcs){
    const d = dist(S.x, S.y, n.x, n.y);
    if (d < bestD) { best = {type:"npc", o:n}; bestD = d; }
  }
  for (const p of entities.pickups){
    const d = dist(S.x, S.y, p.x, p.y);
    if (p.kind !== "energon" && d < bestD) { best = {type:"pickup", o:p}; bestD = d; }
  }
  return best;
}

function tryInteract(){
  const n = nearestInteractable();
  if (!n) return;
  if (n.type === "pickup"){
    if (n.o.kind === "lamp"){
      S.lampFound = true;
      entities.pickups = entities.pickups.filter(p => p !== n.o);
      setStage(5);
      showDialog([{s:"Куби", p:"sp_kubi", t:"Лампьютер найден! Древний, автономный, пахнет пылью и свободой. Несём Му-Хрю."}]);
    } else if (n.o.kind === "booster"){
      entities.pickups = entities.pickups.filter(p => p !== n.o);
      S.energy = clamp(S.energy + 50, 0, 100);
      showDialog([{s:"Куби", p:"sp_kubi", t:"Бустер «Фокусник» усвоен. +50 энергии. Вкус: жёлтый."}]);
    }
    return;
  }
  const id = n.o.id;
  if (id === "savia"){
    if (S.stage === 0) showDialog(DIALOGS.mama_start, () => setStage(1));
    else if (S.stage < 3) showDialog([{s:"Савия", p:"sp_savia", t:"Коробка на чердаке, милая. Я пока согрею моколад."}]);
    else showDialog(DIALOGS.mama_capsule);
  }
  else if (id === "attic" && S.stage === 1){
    showCut(CUTS.book, () => { S.pulseUnlocked = true; setStage(2); });
  }
  else if (id === "muhru"){
    if (S.stage === 3){ /* авто-диалог уже был, повтор */ showDialog(DIALOGS.muhru_wait); }
    else if (S.stage === 4) showDialog(DIALOGS.muhru_wait);
    else if (S.stage === 5 && S.lampFound) showDialog(DIALOGS.muhru_lamp, () => setStage(6));
    else showDialog([{s:"Му-Хрю", p:"sp_muhru", t:"Вперёд, Ризи. Я прикрою. Хвост — по ветру!"}]);
  }
  else if (id === "oldman"){
    if (!S.oldmanDone){
      S.oldmanDone = true;
      S.energy = clamp(S.energy + 40, 0, 100);
      showDialog(DIALOGS.oldman, () => rebuildScene());
    } else showDialog(DIALOGS.oldman_later);
  }
  else if (id === "booster"){
    if (!S.boosterOffer){
      S.boosterOffer = true;
      showDialog(S.energons >= 100 ? DIALOGS.booster_shop : DIALOGS.booster_poor,
        () => setTimeout(()=>{ S.boosterOffer = false; }, 4000));
    } else if (S.energons >= 100){
      S.energons -= 100; S.energy = clamp(S.energy + 50, 0, 100); S.boosterOffer = false;
      showDialog([{s:"Куби", p:"sp_kubi", t:"Сделка совершена. Минус 100 энергонов, плюс 50 энергии. «Энергия — это всегда привлекательно!»"}]);
    } else {
      S.boosterOffer = false;
      showDialog(DIALOGS.booster_poor);
    }
  }
  else if (id === "hatch"){
    if (S.stage >= 6) gotoScene("tunnels", () => { setStage(7); showDialog(DIALOGS.tunnel_enter); });
    else showDialog([{s:"Куби", p:"sp_kubi", t:"Люк заперт протоколом. Сначала избавимся от кнопки слежения — иначе туннели сдадут нас Кубу за один пульс."}]);
  }
}

function tryPulse(){
  if (!S.pulseUnlocked || S.energy < 15 || (S.pulseT > 0 && S.pulseT < 0.7)) return;
  S.energy -= 15;
  S.pulseT = 0.001; S.pulseX = S.x; S.pulseY = S.y;
  S.trueSight = 6;

  // обучение: первый импульс дома
  if (S.stage === 2){
    setTimeout(() => showCut(CUTS.capsule, () => setStage(3)), 600);
    return;
  }
  const R = 175;
  // оглушение кубитов
  for (const en of entities.enemies){
    if (en.kind === "kubit" && dist(S.x,S.y,en.x,en.y) < R) en.stun = 4;
  }
  // Закулисье: проверка предмета
  if (S.scene === "hangar" && !S.illusionSolved && entities.illusionItems.length){
    let nearest = null, nd = 95;
    for (const it of entities.illusionItems){
      const d = dist(S.x,S.y,it.x,it.y);
      if (d < nd){ nearest = it; nd = d; }
    }
    if (nearest){
      if (nearest.correct){
        S.illusionSolved = true;
        setStage(9);
        showDialog([
          {s:"Ризи", p:"sp_rizy", t:"Ручка Му-Хрю! Единственная вещь не из этого места…"},
          {s:"Куби", p:"sp_kubi", t:"Иллюзия трещит и осыпается розовой пылью. Проекторы Рептила отключены. Отличная работа, носитель кристального сердца."},
        ], () => showDialog(DIALOGS.hangar_node));
      } else {
        S.energy = clamp(S.energy - 10, 0, 100);
        showDialog([{s:"Куби", p:"sp_kubi", t:`«${nearest.label}»? Нет. Эта вещь отсюда. Иллюзия смеётся. Минус 10 энергии — страх кормит Закулисье.`}]);
      }
    }
  }
  // Анибус: зарядка
  if (S.scene === "hangar" && S.stage === 9 && entities.shipNode){
    if (dist(S.x,S.y,entities.shipNode.x,entities.shipNode.y) < entities.shipNode.r + 40){
      S.shipCharge++;
      if (S.shipCharge >= 3){
        flash();
        setTimeout(() => showCut(CUTS.escape, () => {
          gotoScene("lumenira", () => setStage(10));
        }), 700);
      } else {
        sceneLabel(`Анибус: ${S.shipCharge}/3 ⬥`);
      }
    }
  }
}

function faint(){
  showDialog([
    {s:"Куби", p:"sp_kubi", t:"Энергия на нуле. Ризи оседает в снег… Мисс Фантастика мурлычет изо всех сил. Дыши. Просто дыши."},
    {s:"Ризи", p:"sp_rizy", t:"…Я в порядке. Кристальное сердце не сдаётся."},
  ], () => {
    const sc = SCENES[S.scene];
    S.x = sc.spawn[0]; S.y = sc.spawn[1];
    S.energy = 55; S.paralyzed = 0;
  });
}

// ---------- ОБНОВЛЕНИЕ ----------
let lastT = performance.now();
function step(now){
  let elapsed = Math.min(0.5, (now - lastT)/1000);
  lastT = now;
  // фикс. под-шаги: при редких тиках (фоновая вкладка) игровое время не замедляется
  while (elapsed > 0 && S.mode === "play"){
    const dt = Math.min(0.05, elapsed);
    update(dt);
    elapsed -= dt;
  }
  draw(now/1000);
}
function tick(now){ step(now); requestAnimationFrame(tick); }
// запасной цикл: если rAF приостановлен (фоновая вкладка, энергосбережение) — игра не замирает
setInterval(() => { const now = performance.now(); if (now - lastT > 60) step(now); }, 50);

function update(dt){
  const sc = SCENES[S.scene];
  // движение
  let dx = (keys.ArrowRight||keys.KeyD ? 1:0) - (keys.ArrowLeft||keys.KeyA ? 1:0);
  let dy = (keys.ArrowDown||keys.KeyS ? 1:0) - (keys.ArrowUp||keys.KeyW ? 1:0);
  S.running = !!(keys.ShiftLeft || keys.ShiftRight);
  S.moving = (dx!==0 || dy!==0) && S.paralyzed<=0;
  if (S.paralyzed > 0) S.paralyzed -= dt;

  if (S.moving){
    const depth = depthScale(sc, S.y);
    const sp = (S.running ? 195 : 115) * depth * dt;
    const len = Math.hypot(dx,dy) || 1;
    const px0 = S.x, py0 = S.y;
    const nx = S.x + dx/len*sp, ny = S.y + dy/len*sp*0.82;
    if (pointInPoly(nx, ny, sc.poly)) { S.x = nx; S.y = ny; }
    else if (pointInPoly(nx, S.y, sc.poly)) S.x = nx;
    else if (pointInPoly(S.x, ny, sc.poly)) S.y = ny;
    if (dx !== 0) S.dir = dx > 0 ? 1 : -1;
    S.faceX = dx; S.faceY = dy;
    // фаза шага идёт от пройденного пути, а не от времени: ступни не «проскальзывают»
    const moved = Math.hypot(S.x - px0, S.y - py0);
    S.walkT += (moved / (150 * depth * 0.19)) * Math.PI;
  }
  // плавно гасим мах ног при остановке, чтобы кукла не замирала рывком
  S.walkAmp = lerp(S.walkAmp, S.moving ? 1 : 0, Math.min(1, dt*9));
  if (S.walkAmp < 0.02 && !S.moving) S.walkT = 0;

  // энергия: тишина лечит
  if (!S.moving) S.energy = clamp(S.energy + (S.fantJoined ? 6 : 4)*dt, 0, 100);
  else if (!S.running) S.energy = clamp(S.energy + 1.5*dt, 0, 100);
  if (S.stage >= 4) S.fantJoined = true;

  if (S.pulseT > 0) S.pulseT += dt;
  if (S.pulseT > 1.2) S.pulseT = 0;
  if (S.trueSight > 0) S.trueSight -= dt;
  if (S.alarmCooldown > 0) S.alarmCooldown -= dt;

  // Му-Хрю идёт с Ризи после отключения кнопки (в городе он ещё стоит как NPC)
  S.muhruFollows = S.stage >= 6 && S.scene !== "street" && S.scene !== "home";
  if (S.muhruFollows){
    updateFollower(companions.muhru, dt, S.x - 62*S.dir, S.y + 10, sc, 190);
  }

  // спутники
  const tKubi = { x: S.x - 38*S.dir, y: S.y - 78 };
  companions.kubi.x = lerp(companions.kubi.x, tKubi.x, 3*dt);
  companions.kubi.y = lerp(companions.kubi.y, tKubi.y, 3*dt);
  if (S.fantJoined){
    const tF = { x: S.x + 34*S.dir, y: S.y - 64 };
    companions.fant.x = lerp(companions.fant.x, tF.x, 2.4*dt);
    companions.fant.y = lerp(companions.fant.y, tF.y, 2.4*dt);
  }

  // сборы энергонов
  entities.pickups = entities.pickups.filter(p => {
    if (p.kind === "energon" && dist(S.x,S.y,p.x,p.y) < 30){
      S.energons += p.value; return false;
    }
    return true;
  });

  // враги
  for (const en of entities.enemies){
    if (en.ttl !== Infinity){ en.ttl -= dt; }
    if (en.stun > 0){ en.stun -= dt; continue; }
    if (en.hitCd > 0) en.hitCd -= dt;
    const speed = en.kind === "kubit" ? 95 : 34;
    const d = dist(S.x, S.y, en.x, en.y);
    if (en.kind === "kubit" && (d < 135 || en.chase) && d < 290 && S.stage >= 3){
      en.chase = true;
      const vx = (S.x - en.x)/d, vy = (S.y - en.y)/d;
      en.x += vx * speed * 1.25 * dt; en.y += vy * speed * 1.25 * dt;
    } else {
      en.chase = false;
      // патруль между (x1,y1)-(x2,y2)
      const tx = en.dirp > 0 ? en.x2 : en.x1, ty = en.dirp > 0 ? en.y2 : en.y1;
      const dd = dist(en.x, en.y, tx, ty);
      if (dd < 6) en.dirp *= -1;
      else { en.x += (tx-en.x)/dd * speed * dt; en.y += (ty-en.y)/dd * speed * dt; }
    }
    const hitR = en.kind === "sprut" ? 78 : 42;
    if (d < hitR && en.hitCd <= 0 && S.stage >= 3){
      en.hitCd = 1.6;
      S.energy = clamp(S.energy - (en.kind==="sprut" ? 25 : 18), 0, 100);
      // отброс
      const kx = (S.x - en.x)/(d||1), ky = (S.y - en.y)/(d||1);
      for (let i=1;i<=8;i++){
        const nx = S.x + kx*6, ny = S.y + ky*6;
        if (pointInPoly(nx,ny,sc.poly)) { S.x = nx; S.y = ny; }
      }
      shake = 0.35;
      if (S.energy <= 0) return faint();
    }
  }
  entities.enemies = entities.enemies.filter(en => en.ttl > 0);

  // Кристы
  for (const z of entities.zones){
    if (z.kind !== "kristy") continue;
    const phase = (perfT + z.phase) % z.period;
    z.active = phase > z.activeFrom;
    const zcx = z.x + z.w/2, zcy = z.y + z.h/2;
    const nx = (S.x - zcx)/(z.w/2), ny = (S.y - zcy)/(z.h/2);
    if (z.active && nx*nx + ny*ny < 1 && S.paralyzed <= 0){
      S.paralyzed = 1.3;
      S.energy = clamp(S.energy - 15, 0, 100);
      shake = 0.5;
      // выталкивает наружу по кратчайшему направлению от центра поля
      const len = Math.hypot(nx, ny) || 1;
      S.x = zcx + (nx/len) * (z.w/2 + 16);
      S.y = zcy + (ny/len) * (z.h/2 + 12);
      if (!pointInPoly(S.x, S.y, sc.poly)) S.y = clamp(S.y, sc.horizon + 55, 528);
      if (S.energy <= 0) return faint();
    }
  }

  // Гаргонт: бег в его зоне = тревога
  const g = entities.gargoyle;
  if (g && S.running && S.moving && S.alarmCooldown <= 0 && dist(S.x,S.y,g.x,g.y) < g.r){
    S.alarmCooldown = 18;
    shake = 0.8;
    sceneLabel("КРИК ГАРГОНТА! ТРЕВОГА!");
    for (let i=0;i<3;i++){
      const k = mkKubit(60+i*30, 350+i*40, 60+i*30, 350+i*40);
      k.ttl = 12; k.chase = true;
      entities.enemies.push(k);
    }
  }

  // подстраховка: с лампьютером у Му-Хрю сцена начинается сама, без нажатия E
  if (S.scene === "street" && S.stage === 5 && S.lampFound){
    const m = entities.npcs.find(n => n.id === "muhru");
    if (m && dist(S.x, S.y, m.x, m.y) < 85){
      showDialog(DIALOGS.muhru_lamp, () => setStage(6));
      return;
    }
  }

  // выходы
  for (const ex of (entities.exits||[])){
    if (S.x > ex.x1 && S.x < ex.x2 && S.y > ex.y1 && S.y < ex.y2){
      if (S.stage >= (ex.need||0)){
        if (ex.to === "hangar"){
          gotoScene("hangar", () => {
            setStage(8);
            showDialog([
              {s:"Куби", p:"sp_kubi", t:"Ангар «Антарес-15». Внимание: зафиксированы проекторы иллюзий Рептила… сигнал… нестабилен… ззз…"},
              {s:"Му-Хрю", p:"sp_muhru", t:"Пространство плывёт. Закулисье! Опус писал: «Иллюзия теряет власть, если разум спокоен. Найди предмет, который не на своём месте»."},
            ]);
          });
        } else if (ex.to === "street"){
          gotoScene("street", () => {
            if (S.stage === 3){
              showDialog(DIALOGS.muhru_meet, () => setStage(4));
            }
          });
        } else gotoScene(ex.to);
        return;
      } else if (ex.deny){
        S.x -= 12 * S.dir;
        showDialog([{s:"Куби", p:"sp_kubi", t:ex.deny}]);
        return;
      }
    }
  }

  // волны кубитов в ангаре на этапе 9
  if (S.scene === "hangar" && S.stage === 9){
    S.waveTimer -= dt;
    if (S.waveTimer <= 0){
      S.waveTimer = 7.5;
      const k = mkKubit(50, 470, 50, 470);
      k.chase = true; k.ttl = 30;
      entities.enemies.push(k);
    }
  }

  // Люменира: дойти до центра
  if (S.scene === "lumenira" && S.stage === 10 && dist(S.x,S.y,490,430) < 60){
    setStage(11);
    showCut(CUTS.butterfly, () => showCut(CUTS.epilogue, endGame));
  }

  // HUD
  $("energyBar").style.width = S.energy + "%";
  $("energons").textContent = "⬡ " + S.energons + " энергонов";
  const ni = nearestInteractable();
  const hint = $("hint");
  if (ni && (ni.o.label || "").length){ hint.textContent = ni.o.label; hint.style.display = "block"; }
  else hint.style.display = "none";
}

function endGame(){
  S.mode = "end";
  const t = $("title");
  t.style.display = "flex";
  t.innerHTML = `<h1>СВОБОДА<br><span>ЭТО ТОЛЬКО НАЧАЛО</span></h1>
    <div class="sub">Ризи, Му-Хрю, Куби и мисс Фантастика — в лесах Люмениры.<br>
    Впереди — семь кристаллов, Суперкристалл и мама. Продолжение следует…</div>
    <div class="press">ENTER — сыграть ещё раз</div>`;
}

// ---------- ОТРИСОВКА ----------
let shake = 0;
let perfT = 0;
function depthScale(sc, y){
  return clamp(0.42 + 0.6 * (y - sc.horizon) / (540 - sc.horizon), 0.34, 1.05);
}

// Риг походки: где резать спрайт на торс и ноги (доля высоты) и где делить ноги (доля ширины).
// "split" — ноги видны раздельно; "scissor" — ноги сомкнуты, шагаем ножницами.
const RIG = {
  sp_rizy:        { cut:0.60, mode:"scissor" },
  sp_rizy_front:  { cut:0.591, split:0.489, mode:"split" },
  sp_rizy_back:   { cut:0.588, split:0.489, mode:"split" },
  sp_rizy_45r:    { cut:0.60, mode:"scissor" },
  sp_rizy_left:   { cut:0.60, mode:"scissor" },
  sp_rizy_right:  { cut:0.60, mode:"scissor" },
  sp_muhru:       { cut:0.70, mode:"scissor" },
  sp_muhru_front: { cut:0.718, split:0.667, mode:"split" },
  sp_muhru_back:  { cut:0.70, mode:"scissor" },
  sp_muhru_45r:   { cut:0.70, mode:"scissor" },
  sp_muhru_left:  { cut:0.70, mode:"scissor" },
  sp_muhru_right: { cut:0.70, mode:"scissor" },
};

// Тень всегда лежит на земле в точке (x,y) — персонаж по ней «стоит», а не висит.
// Размер считаем от РОСТА: у вида в профиль спрайт узкий, и от ширины тень выходила бы с пятак.
function drawGroundShadow(x, y, h, k){
  ctx.save();
  ctx.fillStyle = `rgba(0,0,10,${0.36 * (k===undefined?1:k)})`;
  ctx.beginPath(); ctx.ellipse(x, y, h*0.17, h*0.06, 0, 0, 7); ctx.fill();
  ctx.restore();
}

// Персонаж с настоящей походкой: ноги отрезаются от торса и качаются от бедра.
// opt: {phase — фаза шага, amp — 0..1 насколько шагает, flip, idle — дышать стоя}
function drawWalker(key, x, y, h, opt){
  const o = opt || {};
  const a = A[key];
  if (!a) return;
  const img = a.img;
  const iw = img.width || 220, ih = img.height || 330;
  const w = h * iw/ih;
  const s = h / ih;
  const amp = o.amp || 0;
  const ph = o.phase || 0;

  drawGroundShadow(x, y, h, 1 - amp*0.22);

  const rig = a.ok ? RIG[key] : null;
  const flip = o.flip ? -1 : 1;
  const top = y - h;
  // дыхание/покачивание в покое, чтобы кукла не стояла мёртво
  const idleT = o.idle === false ? 0 : Math.sin(perfT*1.8 + x)*0.9*(1-amp);

  if (!rig){
    ctx.save();
    ctx.translate(x, y + idleT*0.3);
    ctx.scale(flip, 1);
    ctx.drawImage(img, -w/2, -h - idleT*0.3, w, h);
    ctx.restore();
    return;
  }

  const swing  = Math.sin(ph) * 0.30 * amp;              // мах ноги
  const bodyUp = Math.abs(Math.cos(ph)) * h * 0.022 * amp;  // корпус выше, когда ноги вместе
  const cutY = rig.cut * ih;
  const pivY = cutY - ih*0.05;                            // ось вращения выше линии разреза
  const lap  = ih * 0.035;                                // нахлёст торса, прячет шов

  // кусок спрайта, повёрнутый вокруг точки (pivotSX, pivotSY) в координатах источника
  function piece(sx, sy, sw, sh, pvx, pvy, ang, dy, dark){
    ctx.save();
    ctx.translate(x + flip*(pvx - iw/2)*s, top + pvy*s + (dy||0));
    ctx.scale(flip, 1);
    ctx.rotate(ang);
    if (dark) ctx.filter = "brightness(0.62)";   // дальняя нога уходит в тень — читается как отдельная
    ctx.drawImage(img, sx, sy, sw, sh, (sx - pvx)*s, (sy - pvy)*s, sw*s, sh*s);
    ctx.restore();
  }

  if (rig.mode === "split"){
    const spx = rig.split * iw;
    piece(0, cutY, spx, ih-cutY, spx*0.5, pivY, -swing*0.85, 0, amp > 0.05);      // дальняя нога
    piece(spx, cutY, iw-spx, ih-cutY, spx + (iw-spx)*0.5, pivY, swing*0.85);      // ближняя
    piece(0, 0, iw, cutY+lap, iw/2, pivY, swing*0.05, -bodyUp - idleT);           // торс сверху
  } else {
    piece(0, cutY, iw, ih-cutY, iw/2, pivY, -swing*1.15, 0, amp > 0.05);          // дальняя нога
    piece(0, 0, iw, cutY+lap, iw/2, pivY, swing*0.06, -bodyUp - idleT);           // торс
    piece(0, cutY, iw, ih-cutY, iw/2, pivY, swing*1.15);                          // ближняя нога
  }
}

// Совместимость: статичные персонажи и враги рисуются тем же путём
function drawSprite(key, x, y, h, flip, bobPhase){
  drawWalker(key, x, y, h, { amp:0, flip, idle: bobPhase !== undefined });
}

// Ракурс по направлению взгляда: спина / профиль / три четверти
function viewFor(pref, fx, fy){
  const K = k => "sp_" + pref + k;
  if (fy < 0) return fx < 0 ? K("_left") : fx > 0 ? K("_right") : K("_back");
  if (fy > 0) return fx < 0 ? K("") : fx > 0 ? K("_45r") : K("_front");
  return fx < 0 ? K("_left") : fx > 0 ? K("_right") : K("_front");
}

function draw(t){
  perfT = t;
  const sc = SCENES[S.scene];
  ctx.save();
  if (shake > 0){
    shake -= 0.016;
    ctx.translate((Math.random()-0.5)*8*shake, (Math.random()-0.5)*8*shake);
  }
  // фон
  const bg = A[sc.bg];
  ctx.drawImage(bg.img, 0, 0, 960, 540);

  if (S.mode === "title"){ ctx.restore(); return; }

  // Кристы — отрисовка зон
  for (const z of entities.zones){
    if (z.kind !== "kristy") continue;
    const phase = (t + z.phase) % z.period;
    const active = phase > z.activeFrom;
    const warn = !active && phase > z.activeFrom - 0.9;
    ctx.save();
    const cxz = z.x + z.w/2, cyz = z.y + z.h/2;
    if (active){
      // разряд между Кристами: пульсирующее ядро и бегущие дуги
      const g = ctx.createRadialGradient(cxz, cyz, 4, cxz, cyz, Math.max(z.w,z.h)*0.62);
      g.addColorStop(0, "rgba(180,250,255,.42)");
      g.addColorStop(0.55, "rgba(126,240,255,.22)");
      g.addColorStop(1, "rgba(126,240,255,0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.ellipse(cxz, cyz, z.w*0.56, z.h*0.56, 0, 0, 7); ctx.fill();
      ctx.strokeStyle = "rgba(200,252,255,.75)"; ctx.lineWidth = 1.6;
      for (let i=0;i<4;i++){
        const p = ((t*0.9 + i*0.25) % 1);
        ctx.globalAlpha = Math.sin(p*Math.PI) * 0.8;
        ctx.beginPath();
        ctx.ellipse(cxz, cyz, z.w*0.55*p, z.h*0.55*p, 0, 0, 7);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      // молнии от углов к центру
      ctx.strokeStyle = "rgba(255,255,255,.5)"; ctx.lineWidth = 1;
      for (let i=0;i<4;i++){
        const a = i*Math.PI/2 + t*1.2;
        ctx.beginPath(); ctx.moveTo(cxz + Math.cos(a)*z.w*0.5, cyz + Math.sin(a)*z.h*0.5);
        ctx.lineTo(cxz + Math.cos(a+0.5)*z.w*0.16, cyz + Math.sin(a+0.5)*z.h*0.16);
        ctx.stroke();
      }
    } else {
      // поле спит — но контур виден всегда, чтобы не влететь вслепую
      ctx.strokeStyle = warn ? "rgba(255,120,200,.8)" : "rgba(126,240,255,.3)";
      ctx.setLineDash([10,8]); ctx.lineWidth = 2;
      ctx.lineDashOffset = -t*14;
      ctx.beginPath(); ctx.ellipse(cxz, cyz, z.w*0.5, z.h*0.5, 0, 0, 7); ctx.stroke();
      ctx.setLineDash([]);
      if (warn){
        ctx.fillStyle = "rgba(255,120,200,.12)";
        ctx.beginPath(); ctx.ellipse(cxz, cyz, z.w*0.5, z.h*0.5, 0, 0, 7); ctx.fill();
      }
    }
    if (S.trueSight > 0){
      ctx.fillStyle = active ? "#ff5c8a" : "#C0FF3F";
      ctx.font = "700 15px system-ui"; ctx.textAlign = "center";
      const left = active ? (z.period - phase) : (z.activeFrom - phase);
      ctx.fillText((active ? "⚡ поле: " : "✓ окно: ") + left.toFixed(1) + " п.", z.x + z.w/2, z.y - 8);
    }
    ctx.restore();
  }

  // сущности с сортировкой по глубине
  const drawables = [];
  for (const n of entities.npcs){
    if (!n.key) {
      if (n.id === "hatch") drawables.push({ y:n.y, fn: () => drawHatch(n.x, n.y) });
      if (n.id === "booster") drawables.push({ y:n.y, fn: () => drawGlowSpot(n.x, n.y, "#ff9ecb") });
      if (n.id === "attic") drawables.push({ y:n.y, fn: () => drawGlowSpot(n.x, n.y, "#C0FF3F") });
      continue;
    }
    const h = (n.h || 140) * depthScale(sc, n.y);
    drawables.push({ y:n.y, fn: () => {
      drawSprite(n.key, n.x, n.y, h, false, t*2 + n.x);
      if (n.capsule) drawCapsule(n.x, n.y, h);
    }});
  }
  for (const p of entities.pickups){
    if (p.kind === "energon") drawables.push({ y:p.y, fn: () => drawEnergon(p.x, p.y, t) });
    else drawables.push({ y:p.y, fn: () => drawGlowSpot(p.x, p.y, p.kind==="lamp" ? "#7ef0ff" : "#ffd166") });
  }
  for (const en of entities.enemies){
    const h = en.h * depthScale(sc, en.y);
    drawables.push({ y:en.y, fn: () => {
      drawSprite(en.key, en.x, en.y, h, en.dirp<0, t*3 + en.x);
      if (en.stun > 0){
        ctx.fillStyle = "rgba(192,255,63,.9)"; ctx.font = "700 16px system-ui"; ctx.textAlign="center";
        ctx.fillText("✦ оглушён ✦", en.x, en.y - h - 10);
      } else if (en.kind === "kubit"){
        ctx.fillStyle = en.chase ? "#ff4757" : "rgba(255,71,87,.45)";
        ctx.beginPath(); ctx.arc(en.x, en.y - h - 8, en.chase ? 5 : 3.5, 0, 7); ctx.fill();
      }
    }});
  }
  // предметы Закулисья
  for (const it of entities.illusionItems){
    if (S.illusionSolved) break;
    drawables.push({ y:it.y, fn: () => drawIllusionItem(it, t) });
  }
  // узел Анибуса
  if (entities.shipNode && S.stage === 9){
    const n = entities.shipNode;
    drawables.push({ y: n.y - 100, fn: () => {
      ctx.save();
      const pul = 0.5 + Math.sin(t*3)*0.2;
      ctx.strokeStyle = `rgba(126,240,255,${pul})`;
      ctx.lineWidth = 3;
      ctx.setLineDash([10, 8]);
      ctx.beginPath(); ctx.ellipse(n.x, n.y, n.r, n.r*0.4, 0, 0, 7); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#7ef0ff"; ctx.font = "700 15px system-ui"; ctx.textAlign = "center";
      ctx.fillText(`⬥ Анибус: ${S.shipCharge}/3`, n.x, n.y - n.r*0.4 - 12);
      ctx.restore();
    }});
  }

  // Му-Хрю-спутник
  if (S.muhruFollows){
    const m = companions.muhru;
    drawables.push({ y: m.y, fn: () => {
      let k = viewFor("muhru", m.faceX, m.faceY);
      if (!A[k] || !A[k].ok) k = "sp_muhru";
      drawWalker(k, m.x, m.y, 178 * depthScale(sc, m.y), { phase:m.walkT, amp:m.walkAmp });
    }});
  }

  // спутники
  drawables.push({ y: companions.kubi.y + 80, fn: () => {
    const h = 56 * depthScale(sc, companions.kubi.y + 80);
    drawSprite("sp_kubi", companions.kubi.x, companions.kubi.y + Math.sin(t*2.6)*5 + 40, h, false);
  }});
  if (S.fantJoined) drawables.push({ y: companions.fant.y + 78, fn: () => {
    const h = 44 * depthScale(sc, companions.fant.y + 78);
    drawSprite("sp_fant", companions.fant.x, companions.fant.y + Math.sin(t*3.4+1)*6 + 36, h, S.dir<0);
  }});

  // Ризи
  drawables.push({ y: S.y, fn: () => drawRizy() });

  drawables.sort((a,b) => a.y - b.y);
  drawables.forEach(d => d.fn());

  // маркер цели задания — чтобы никогда не гадать, куда идти
  const qt = questTarget();
  if (qt){
    const bob = Math.sin(t*3.4)*5;
    const my = qt.y - (qt.h ? qt.h*depthScale(sc, qt.y) : 60) - 26 + bob;
    ctx.save();
    ctx.globalAlpha = 0.55 + Math.sin(t*3.4)*0.2;
    ctx.strokeStyle = "#C0FF3F"; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.ellipse(qt.x, qt.y, 26, 10, 0, 0, 7); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#C0FF3F";
    ctx.beginPath();
    ctx.moveTo(qt.x, my + 14); ctx.lineTo(qt.x - 10, my); ctx.lineTo(qt.x + 10, my);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  // импульс сердца
  if (S.pulseT > 0){
    const pr = S.pulseT / 0.9;
    const R = 175 * Math.min(1, pr*1.4);
    ctx.save();
    ctx.strokeStyle = `rgba(126,240,255,${1 - pr})`;
    ctx.lineWidth = 5 * (1 - pr) + 1;
    ctx.beginPath(); ctx.ellipse(S.pulseX, S.pulseY - 40, R, R*0.55, 0, 0, 7); ctx.stroke();
    ctx.strokeStyle = `rgba(192,255,63,${(1 - pr)*.7})`;
    ctx.beginPath(); ctx.ellipse(S.pulseX, S.pulseY - 40, R*.7, R*.38, 0, 0, 7); ctx.stroke();
    ctx.restore();
  }
  // истинное зрение — виньетка
  if (S.trueSight > 0){
    ctx.save();
    ctx.strokeStyle = `rgba(126,240,255,${Math.min(.5, S.trueSight/6)})`;
    ctx.lineWidth = 10;
    ctx.strokeRect(5,5,950,530);
    ctx.restore();
  }

  // отладка
  if (S.debug){
    ctx.save();
    ctx.strokeStyle = "#0f0"; ctx.lineWidth = 1.5;
    ctx.beginPath();
    sc.poly.forEach(([px,py],i) => i ? ctx.lineTo(px,py) : ctx.moveTo(px,py));
    ctx.closePath(); ctx.stroke();
    if (entities.gargoyle){
      const g = entities.gargoyle;
      ctx.strokeStyle = "#f80";
      ctx.beginPath(); ctx.arc(g.x, g.y, g.r, 0, 7); ctx.stroke();
    }
    ctx.fillStyle = "#0f0"; ctx.font = "12px monospace"; ctx.textAlign="left";
    ctx.fillText(`scene=${S.scene} stage=${S.stage} x=${S.x|0} y=${S.y|0}`, 12, 530);
    ctx.restore();
  }
  ctx.restore();
}

function rizyView(){ return viewFor("rizy", S.faceX, S.faceY); }

function drawRizy(){
  const sc = SCENES[S.scene];
  const h = 150 * depthScale(sc, S.y);
  let key = rizyView();
  if (!A[key] || !A[key].ok) key = "sp_rizy";
  ctx.save();
  if (S.paralyzed > 0) ctx.filter = "hue-rotate(160deg) brightness(1.3)";
  drawWalker(key, S.x, S.y, h, { phase: S.walkT, amp: S.walkAmp });
  ctx.restore();
}

function drawEnergon(x, y, t){
  ctx.save();
  const b = Math.sin(t*4 + x) * 3;
  ctx.translate(x, y + b);
  ctx.rotate(t*1.5 + x);
  ctx.fillStyle = "#ff9ecb";
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  for (let i=0;i<6;i++){
    const a = i*Math.PI/3;
    ctx[i?"lineTo":"moveTo"](Math.cos(a)*9, Math.sin(a)*9);
  }
  ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.restore();
}
function drawGlowSpot(x, y, color){
  ctx.save();
  const p = 0.6 + Math.sin(perfT*3 + x)*0.25;
  ctx.fillStyle = color;
  ctx.globalAlpha = p * 0.5;
  ctx.beginPath(); ctx.ellipse(x, y, 26, 12, 0, 0, 7); ctx.fill();
  ctx.globalAlpha = 1;
  ctx.beginPath(); ctx.arc(x, y - 16, 7, 0, 7); ctx.fill();
  ctx.restore();
}
function drawHatch(x, y){
  ctx.save();
  ctx.fillStyle = "#1b2140";
  ctx.strokeStyle = "#7ef0ff";
  ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.ellipse(x, y, 34, 15, 0, 0, 7); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = "rgba(126,240,255,.5)";
  ctx.beginPath(); ctx.ellipse(x, y, 22, 9, 0, 0, 7); ctx.stroke();
  ctx.restore();
}
function drawCapsule(x, y, h){
  ctx.save();
  const p = 0.5 + Math.sin(perfT*2)*0.15;
  ctx.strokeStyle = `rgba(126,240,255,${p})`;
  ctx.fillStyle = "rgba(126,240,255,.12)";
  ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.ellipse(x, y - h/2, h*0.46, h*0.62, 0, 0, 7);
  ctx.fill(); ctx.stroke();
  ctx.restore();
}
function drawIllusionItem(it, t){
  ctx.save();
  const p = 0.6 + Math.sin(t*2.5 + it.x)*0.3;
  ctx.translate(it.x, it.y);
  ctx.globalAlpha = 0.9;
  ctx.strokeStyle = `rgba(255,158,203,${p})`;
  ctx.fillStyle = "rgba(255,158,203,.14)";
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.ellipse(0, 4, 30, 13, 0, 0, 7); ctx.fill(); ctx.stroke();
  ctx.fillStyle = "#ffd7ea";
  if (it.kind === "bottle"){ ctx.fillRect(-6,-34,12,30); ctx.fillRect(-3,-42,6,8); }
  if (it.kind === "papers"){ ctx.fillRect(-16,-16,32,14); ctx.fillRect(-13,-22,26,5); }
  if (it.kind === "chair"){ ctx.fillRect(-14,-30,5,30); ctx.fillRect(-14,-30,28,5); ctx.fillRect(-14,-8,26,5); }
  if (it.kind === "pen"){ ctx.save(); ctx.rotate(-.5); ctx.fillRect(-2,-26,4,26); ctx.restore(); }
  if (S.trueSight > 0){
    ctx.fillStyle = "#fff"; ctx.font = "12px system-ui"; ctx.textAlign = "center";
    ctx.fillText(it.label, 0, 24);
  }
  ctx.restore();
}

// ---------- СТАРТ ----------
$("objText").textContent = OBJECTIVES[0];
function fitStage(){
  const k = Math.min(innerWidth/980, innerHeight/560);
  $("stage").style.transform = `scale(${Math.min(k, 1.6)})`;
}
addEventListener("resize", fitStage);
fitStage();

loadAssets(() => requestAnimationFrame(tick));
