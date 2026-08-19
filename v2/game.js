// РИЗИ: ПОБЕГ ИЗ ИДЕАЛИТИ 2.0 — уровень «Дом»
// Большой скроллируемый мир, камера за игроком, бег и риг ног.

"use strict";

const cv = document.getElementById("cv");
const ctx = cv.getContext("2d");
ctx.imageSmoothingEnabled = true;
ctx.imageSmoothingQuality = "high";
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

// ---------- МИР ----------
const MAP_SCALE = 2;                 // карта 1536x1024 рисуется в 2x
const W_W = 1536 * MAP_SCALE;        // 3072
const W_H = 1024 * MAP_SCALE;        // 2048
const VIEW_W = 960, VIEW_H = 540;

// Проходимость (мировые координаты, по арту карты):
// двор у дома → калитка → большое снежное поле → площадь с аркой города
let WALK = [[430,700],[880,620],[1080,640],[1120,900],[1560,780],[2260,720],
            [2400,900],[2440,1300],[2620,1800],[1900,1960],[600,1880],[430,1480],[430,1000]];

// Точки уровня (по арту карты)
const P = {
  spawn:  {x:1150, y:1000},   // тропа под садовой калиткой
  mama:   {x:500,  y:660},    // перед оранжереей
  attic:  {x:800,  y:620},    // крыльцо дома
  gate:   {x:2170, y:1560},   // неоновая арка города
};

const ENERGONS = [[1300,1100,10],[1700,950,10],[2100,830,15],[1500,1600,10],[2200,1300,15],[900,1500,10]];

// ---------- АРТ ----------
const IMGS = {
  map:   "assets/map.png",
  rz_front:"assets/rizy_front.png", rz_45l:"assets/rizy_45l.png", rz_left:"assets/rizy_left.png",
  rz_back:"assets/rizy_back.png",   rz_right:"assets/rizy_right.png", rz_45r:"assets/rizy_45r.png",
  mama:  "assets/mama.png",
  kubi:  "../assets/sprites/kubi.png",
  cut_book:"../assets/cut/book.webp",
  cut_sad: "../assets/cut/sad.webp",
  cut_home:"../assets/cut/home.webp",
  cut_prologue:"../assets/cut/prologue.webp",
};
const A = {};
function loadAssets(done){
  const keys = Object.keys(IMGS);
  let left = keys.length;
  keys.forEach(k => {
    const img = new Image();
    img.onload = () => { A[k] = {img, ok:true}; if (--left===0) done(); };
    img.onerror = () => {
      const c = document.createElement("canvas"); c.width = 120; c.height = 200;
      const g = c.getContext("2d"); g.fillStyle = "#56b7e6"; g.fillRect(20,20,80,160);
      A[k] = {img:c, ok:false}; if (--left===0) done();
    };
    img.src = IMGS[k] + "?a=1";
  });
}

// Риг ног: {cut — линия бёдер, split — раздел ног, mode} — реальные значения по нарезке
let RIG = {
  rz_front:{cut:0.662, split:0.52,  mode:"split"},
  rz_45l:  {cut:0.70,  split:0.523, mode:"split"},
  rz_left: {cut:0.63,  mode:"scissor"},
  rz_back: {cut:0.662, split:0.495, mode:"split"},
  rz_right:{cut:0.63,  mode:"scissor"},
  rz_45r:  {cut:0.70,  split:0.471, mode:"split"},
};

// ---------- ТЕКСТЫ ----------
const OBJ = {
  0:"Поговори с мамой у оранжереи.",
  1:"Поднимись к дому и достань коробку с чердака.",
  2:"Активируй кристальное сердце — нажми ПРОБЕЛ.",
  3:"Беги к городским воротам — в Идеалити (направо вниз).",
  4:"Уровень пройден!",
};
const DLG = {
  mama0: [
    {s:"Савия", p:"mama", t:"Ризи, милая! Сегодня канун Нового Блока. Давай наконец нарядим нашу старую ёлку — как при папе."},
    {s:"Ризи", p:"rz_front", t:"Правда?! Настоящий праздник? Бегу!"},
    {s:"Савия", p:"mama", t:"Игрушки в красной коробке на чердаке. Она тяжёлая, так что Куби тебе не помощница."},
    {s:"Куби", p:"kubi", t:"Возражение принято, но проигнорировано. Протокол праздника активирован. Вероятность радости: 99,2%."},
  ],
  mama1: [{s:"Савия", p:"mama", t:"Коробка на чердаке, милая. Я пока согрею моколад."}],
  capsule: [
    {s:"Ризи", p:"rz_front", t:"Я вытащу тебя отсюда, мама. Обещаю. Мы снова будем вместе."},
    {s:"Куби", p:"kubi", t:"Капсула стабильна. Отсчёт до отключения питания… идёт. Нам нужно спешить, Ризи."},
  ],
  gateEarly: [{s:"Куби", p:"kubi", t:"Ворота в город. Сначала — праздник: мама ждёт у оранжереи."}],
};
const CUTS = {
  intro: [
    {img:"cut_prologue", t:"Идеалити. Город, где есть всё и даже больше. Только настоящего в нём почти не осталось."},
    {img:"cut_home", t:"На холме между небоскрёбами прячется старый деревянный дом с оранжереей. Здесь живёт Ризи — синяя девчонка, которая тайком читает бумажные книги."},
  ],
  book: [
    {img:"cut_book", t:"На чердаке, среди папиных вещей, с грохотом падает тяжёлая книга. Тёмная кожа, древние символы — и прозрачный кристалл в центре обложки."},
    {img:"cut_book", t:"Кристалл вспыхивает, отзываясь на стук её сердца. Папин голос: «У тебя кристальное сердце. Береги свои способности»."},
    {img:"cut_book", t:"Тёплая волна поднимается в груди. Попробуй: ПРОБЕЛ — импульс кристального сердца."},
  ],
  capsule: [
    {img:"cut_sad", t:"Утром в дверь стучат. Два кубита с красными огнями: «Долг семьи перед Идеалити просрочен»."},
    {img:"cut_sad", t:"Лазерные лучи сплетают вокруг мамы прозрачную сферу. Тело — в капсулу, сознание — отрабатывать долг в метавселенной."},
    {img:"cut_sad", t:"<span class='who'>Савия:</span> «Милая, не нужно… Увидимся там!»"},
    {img:"cut_sad", t:"Ризи сжимает кулаки. «Я вытащу тебя отсюда. Обещаю». Теперь — к воротам Идеалити."},
  ],
  finale: [
    {img:"cut_prologue", t:"Ворота города открываются. Впереди — неоновые улицы, туннели под Идеалити и корабль, спрятанный Опусом."},
    {img:"cut_prologue", t:"КОНЕЦ ПЕРВОГО УРОВНЯ. Версия 2.0 — продолжение уже строится…"},
  ],
};

// ---------- СОСТОЯНИЕ ----------
const S = {
  mode:"title", stage:0,
  x:P.spawn.x, y:P.spawn.y, faceX:0, faceY:1,
  moving:false, walkT:0, walkAmp:0,
  energy:100, energons:0,
  pulseT:0, pulseX:0, pulseY:0, pulseUnlocked:false,
  capsuleOn:false, debug:false,
};
let cam = {x:0, y:0};
let pickups = ENERGONS.map(([x,y,v],i) => ({x,y,v,id:i}));
let kubi = {x:S.x-50, y:S.y-10};

// ---------- ДИАЛОГИ/КАТСЦЕНЫ ----------
let dialogQueue=[], dialogIdx=0, dialogDone=null;
let cutQueue=[], cutIdx=0, cutDone=null;
function showDialog(lines, done){
  dialogQueue=lines; dialogIdx=0; dialogDone=done||null;
  S.mode="dialog"; $("dialog").style.display="block"; renderLine();
}
function renderLine(){
  const l = dialogQueue[dialogIdx];
  $("dname").textContent = l.s; $("dtext").textContent = l.t;
  const a = A[l.p];
  $("dportrait").src = a ? (a.img.src || "") : "";
}
function advanceDialog(){
  dialogIdx++;
  if (dialogIdx >= dialogQueue.length){
    $("dialog").style.display="none";
    S.mode = $("cut").style.display==="block" ? "cut" : "play";
    if (dialogDone){ const f=dialogDone; dialogDone=null; f(); }
  } else renderLine();
}
function showCut(steps, done){
  cutQueue=steps; cutIdx=0; cutDone=done||null;
  $("dialog").style.display="none";
  S.mode="cut"; $("cut").style.display="block"; renderCut();
}
function renderCut(){
  const c = cutQueue[cutIdx];
  const a = A[c.img];
  $("cutimg").src = a ? (a.img.src||"") : "";
  $("cuttext").innerHTML = c.t;
}
function advanceCut(){
  cutIdx++;
  if (cutIdx >= cutQueue.length){
    $("cut").style.display="none"; S.mode="play";
    if (cutDone){ const f=cutDone; cutDone=null; f(); }
  } else renderCut();
}
function setStage(n){ S.stage = n; $("objText").textContent = OBJ[n] || ""; }
function sceneLabel(t){
  const el = $("label"); el.textContent = t; el.style.opacity = 1;
  setTimeout(()=>{ el.style.opacity = 0; }, 2600);
}

// ---------- ВВОД ----------
const keys = {};
addEventListener("keydown", ev => {
  if (["ArrowUp","ArrowDown","ArrowLeft","ArrowRight","Space"].includes(ev.code)) ev.preventDefault();
  keys[ev.code] = true;
  if (ev.code === "F2"){ S.debug = !S.debug; return; }
  if (S.mode==="title" && (ev.code==="Enter"||ev.code==="KeyE")) return startGame();
  if (S.mode==="end" && ev.code==="Enter") return location.reload();
  if (S.mode==="dialog" && (ev.code==="KeyE"||ev.code==="Enter")) return advanceDialog();
  if (S.mode==="cut" && (ev.code==="KeyE"||ev.code==="Enter")) return advanceCut();
  if (S.mode==="play"){
    if (ev.code==="KeyE"||ev.code==="Enter") tryInteract();
    if (ev.code==="Space") tryPulse();
  }
});
addEventListener("keyup", ev => { keys[ev.code] = false; });
cv.addEventListener("click", ev => {
  if (!S.debug) return;
  const r = cv.getBoundingClientRect();
  const x = Math.round((ev.clientX-r.left)*(VIEW_W/r.width) + cam.x);
  const y = Math.round((ev.clientY-r.top)*(VIEW_H/r.height) + cam.y);
  console.log(`[v2 debug] мир: [${x}, ${y}]`);
});

function startGame(){
  $("title").style.display = "none";
  showCut(CUTS.intro, () => { S.mode="play"; setStage(0); sceneLabel("Дом Ризи · канун Нового Блока"); });
}

// ---------- ГЕЙМПЛЕЙ ----------
function interactables(){
  const list = [];
  list.push({ id:"mama", x:P.mama.x, y:P.mama.y, r:120,
              label: S.capsuleOn ? "E — капсула мамы" : "E — поговорить с мамой" });
  if (S.stage === 1) list.push({ id:"attic", x:P.attic.x, y:P.attic.y, r:110, label:"E — подняться на чердак" });
  return list;
}
function nearest(){
  let best=null, bd=1e9;
  for (const it of interactables()){
    const d = dist(S.x,S.y,it.x,it.y);
    if (d < it.r && d < bd){ best = it; bd = d; }
  }
  return best;
}
function tryInteract(){
  const n = nearest();
  if (!n) return;
  if (n.id === "mama"){
    if (S.stage === 0) showDialog(DLG.mama0, () => setStage(1));
    else if (!S.capsuleOn) showDialog(DLG.mama1);
    else showDialog(DLG.capsule);
  }
  if (n.id === "attic" && S.stage === 1){
    showCut(CUTS.book, () => { S.pulseUnlocked = true; setStage(2); });
  }
}
function tryPulse(){
  if (!S.pulseUnlocked || S.energy < 15 || (S.pulseT > 0 && S.pulseT < 0.7)) return;
  S.energy -= 15;
  S.pulseT = 0.001; S.pulseX = S.x; S.pulseY = S.y;
  if (S.stage === 2){
    setTimeout(() => showCut(CUTS.capsule, () => { S.capsuleOn = true; setStage(3); }), 700);
  }
}
function questTarget(){
  if (S.stage === 0) return P.mama;
  if (S.stage === 1) return P.attic;
  if (S.stage === 3) return P.gate;
  return null;
}

// ---------- ЦИКЛ ----------
let lastT = performance.now();
function step(now){
  let elapsed = Math.min(0.5, (now-lastT)/1000);
  lastT = now;
  while (elapsed > 0 && S.mode === "play"){
    const dt = Math.min(0.05, elapsed);
    update(dt); elapsed -= dt;
  }
  draw(now/1000);
}
function tick(now){ step(now); requestAnimationFrame(tick); }
setInterval(() => { const now = performance.now(); if (now-lastT > 60) step(now); }, 50);

function depthScale(y){ return 0.8 + 0.35 * (y / W_H); }

function update(dt){
  const dx = (keys.ArrowRight||keys.KeyD?1:0) - (keys.ArrowLeft||keys.KeyA?1:0);
  const dy = (keys.ArrowDown||keys.KeyS?1:0) - (keys.ArrowUp||keys.KeyW?1:0);
  S.moving = dx!==0 || dy!==0;
  if (S.moving){
    const depth = depthScale(S.y);
    const sp = 300 * depth * dt;                    // бег — базовый темп, как в референсе
    const len = Math.hypot(dx,dy)||1;
    const px0=S.x, py0=S.y;
    const nx = S.x + dx/len*sp, ny = S.y + dy/len*sp*0.85;
    if (pointInPoly(nx,ny,WALK)){ S.x=nx; S.y=ny; }
    else if (pointInPoly(nx,S.y,WALK)) S.x=nx;
    else if (pointInPoly(S.x,ny,WALK)) S.y=ny;
    S.faceX=dx; S.faceY=dy;
    const moved = Math.hypot(S.x-px0, S.y-py0);
    S.walkT += (moved / (185 * depth * 0.20)) * Math.PI;   // частый шаг = бег
  }
  S.walkAmp = lerp(S.walkAmp, S.moving?1:0, Math.min(1,dt*10));
  if (S.walkAmp < .02 && !S.moving) S.walkT = 0;

  if (!S.moving) S.energy = clamp(S.energy + 4*dt, 0, 100);
  if (S.pulseT > 0) S.pulseT += dt;
  if (S.pulseT > 1.2) S.pulseT = 0;

  // Куби летит рядом
  kubi.x = lerp(kubi.x, S.x - 55*(S.faceX||1), 3*dt);
  kubi.y = lerp(kubi.y, S.y - 105, 3*dt);

  // энергоны
  pickups = pickups.filter(p => {
    if (dist(S.x,S.y,p.x,p.y) < 46){ S.energons += p.v; return false; }
    return true;
  });

  // ворота
  if (dist(S.x,S.y,P.gate.x,P.gate.y) < 130){
    if (S.stage === 3){
      setStage(4);
      showCut(CUTS.finale, endGame);
    } else if (S.mode === "play" && !S._gateCd){
      S._gateCd = true; setTimeout(()=>{ S._gateCd = false; }, 6000);
      showDialog(DLG.gateEarly);
    }
  }

  // камера мягко следует
  cam.x = clamp(lerp(cam.x, S.x - VIEW_W/2, Math.min(1,dt*4)), 0, W_W-VIEW_W);
  cam.y = clamp(lerp(cam.y, S.y - VIEW_H/2 - 40, Math.min(1,dt*4)), 0, W_H-VIEW_H);

  $("energyBar").style.width = S.energy + "%";
  const n = nearest();
  const hint = $("hint");
  if (n){ hint.textContent = n.label; hint.style.display = "block"; }
  else hint.style.display = "none";
}

function endGame(){
  S.mode = "end";
  const t = $("title");
  t.style.display = "flex";
  t.innerHTML = `<h1>УРОВЕНЬ ПРОЙДЕН <span class="v2">2.0</span></h1>
    <div class="sub">Собрано энергонов: ${S.energons} · Дальше — улицы Идеалити. Скоро!</div>
    <div class="press">ENTER — сыграть ещё раз · <a href="../" style="color:#7ef0ff">классическая версия</a></div>`;
}

// ---------- ОТРИСОВКА ----------
function drawGroundShadow(x, y, h, k){
  ctx.save();
  ctx.fillStyle = `rgba(0,0,20,${0.35*(k===undefined?1:k)})`;
  ctx.beginPath(); ctx.ellipse(x, y, h*0.18, h*0.065, 0, 0, 7); ctx.fill();
  ctx.restore();
}
function drawWalker(key, x, y, h, opt){
  const o = opt||{};
  const a = A[key]; if (!a) return;
  const img = a.img;
  const iw = img.width||120, ih = img.height||200;
  const s = h/ih, w = h*iw/ih;
  const amp = o.amp||0, ph = o.phase||0;
  drawGroundShadow(x, y, h, 1 - amp*0.2);
  const rig = a.ok ? RIG[key] : null;
  const flip = o.flip ? -1 : 1;
  const top = y - h;
  const idleT = Math.sin(perfT*1.8 + x)*0.9*(1-amp);
  if (!rig){
    ctx.save(); ctx.translate(x, y); ctx.scale(flip,1);
    ctx.drawImage(img, -w/2, -h, w, h); ctx.restore(); return;
  }
  const swing = Math.sin(ph) * 0.38 * amp;             // бег — мах шире
  const bodyUp = Math.abs(Math.cos(ph)) * h * 0.03 * amp;
  const lean = amp * 0.06 * (o.leanDir||0);            // наклон корпуса вперёд при беге
  const cutY = rig.cut * ih;
  const pivY = cutY - ih*0.05;
  const lap = ih*0.035;
  function piece(sx,sy,sw,sh,pvx,pvy,ang,dy,dark){
    ctx.save();
    ctx.translate(x + flip*(pvx-iw/2)*s, top + pvy*s + (dy||0));
    ctx.scale(flip,1); ctx.rotate(ang);
    if (dark) ctx.filter = "brightness(0.6)";
    ctx.drawImage(img, sx,sy,sw,sh, (sx-pvx)*s, (sy-pvy)*s, sw*s, sh*s);
    ctx.restore();
  }
  if (rig.mode==="split"){
    const spx = rig.split*iw;
    piece(0,cutY,spx,ih-cutY, spx*0.5,pivY, -swing*0.9, 0, amp>0.05);
    piece(spx,cutY,iw-spx,ih-cutY, spx+(iw-spx)*0.5,pivY, swing*0.9);
    piece(0,0,iw,cutY+lap, iw/2,pivY, swing*0.05+lean, -bodyUp-idleT);
  } else {
    piece(0,cutY,iw,ih-cutY, iw/2,pivY, -swing*1.2, 0, amp>0.05);
    piece(0,0,iw,cutY+lap, iw/2,pivY, swing*0.06+lean, -bodyUp-idleT);
    piece(0,cutY,iw,ih-cutY, iw/2,pivY, swing*1.2);
  }
}
function viewKey(fx, fy){
  if (fy < 0) return fx<0 ? "rz_left" : fx>0 ? "rz_right" : "rz_back";
  if (fy > 0) return fx<0 ? "rz_45l" : fx>0 ? "rz_45r" : "rz_front";
  return fx<0 ? "rz_left" : fx>0 ? "rz_right" : "rz_front";
}

let perfT = 0;
function draw(t){
  perfT = t;
  ctx.clearRect(0,0,VIEW_W,VIEW_H);
  ctx.save();
  ctx.translate(-Math.round(cam.x), -Math.round(cam.y));

  // карта
  const m = A.map;
  if (m) ctx.drawImage(m.img, 0, 0, W_W, W_H);
  if (S.mode === "title"){ ctx.restore(); return; }

  const drawables = [];

  // энергоны
  for (const p of pickups) drawables.push({y:p.y, fn:()=>{
    ctx.save();
    const b = Math.sin(t*4+p.x)*4;
    ctx.translate(p.x, p.y+b); ctx.rotate(t*1.5+p.x);
    ctx.fillStyle = "#ff9ecb"; ctx.strokeStyle = "#fff"; ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i=0;i<6;i++){ const a=i*Math.PI/3; ctx[i?"lineTo":"moveTo"](Math.cos(a)*13, Math.sin(a)*13); }
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
  }});

  // мама (или капсула)
  drawables.push({y:P.mama.y, fn:()=>{
    const h = 150 * depthScale(P.mama.y);
    drawWalker("mama", P.mama.x, P.mama.y, h, {amp:0});
    if (S.capsuleOn){
      ctx.save();
      const p = 0.5 + Math.sin(perfT*2)*0.15;
      ctx.strokeStyle = `rgba(126,240,255,${p})`;
      ctx.fillStyle = "rgba(126,240,255,.13)";
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(P.mama.x, P.mama.y-h/2, h*0.5, h*0.66, 0, 0, 7);
      ctx.fill(); ctx.stroke();
      ctx.restore();
    }
  }});

  // Куби
  drawables.push({y:kubi.y+120, fn:()=>{
    const h = 52 * depthScale(kubi.y+120);
    const a = A.kubi;
    if (a){ const w = h*a.img.width/a.img.height;
      drawGroundShadow(kubi.x, kubi.y+118, h*0.8, 0.5);
      ctx.drawImage(a.img, kubi.x-w/2, kubi.y + Math.sin(t*2.6)*7 - h/2, w, h); }
  }});

  // Ризи
  drawables.push({y:S.y, fn:()=>{
    const h = 165 * depthScale(S.y);
    drawWalker(viewKey(S.faceX,S.faceY), S.x, S.y, h,
      {phase:S.walkT, amp:S.walkAmp, leanDir: S.moving ? 1 : 0});
  }});

  drawables.sort((a,b)=>a.y-b.y).forEach(d=>d.fn());

  // импульс
  if (S.pulseT > 0){
    const pr = S.pulseT/0.9;
    const R = 260*Math.min(1,pr*1.4);
    ctx.strokeStyle = `rgba(126,240,255,${1-pr})`;
    ctx.lineWidth = 6*(1-pr)+1;
    ctx.beginPath(); ctx.ellipse(S.pulseX, S.pulseY-50, R, R*0.55, 0, 0, 7); ctx.stroke();
    ctx.strokeStyle = `rgba(192,255,63,${(1-pr)*.7})`;
    ctx.beginPath(); ctx.ellipse(S.pulseX, S.pulseY-50, R*.7, R*.38, 0, 0, 7); ctx.stroke();
  }

  // маркер цели
  const qt = questTarget();
  if (qt){
    const bob = Math.sin(t*3.4)*6;
    ctx.save();
    ctx.globalAlpha = 0.55+Math.sin(t*3.4)*0.2;
    ctx.strokeStyle = "#C0FF3F"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.ellipse(qt.x, qt.y, 34, 13, 0, 0, 7); ctx.stroke();
    ctx.globalAlpha = 1; ctx.fillStyle = "#C0FF3F";
    const my = qt.y - 150 + bob;
    ctx.beginPath(); ctx.moveTo(qt.x, my+18); ctx.lineTo(qt.x-12, my); ctx.lineTo(qt.x+12, my);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  // отладка
  if (S.debug){
    ctx.strokeStyle = "#0f0"; ctx.lineWidth = 2;
    ctx.beginPath();
    WALK.forEach(([px,py],i)=> i?ctx.lineTo(px,py):ctx.moveTo(px,py));
    ctx.closePath(); ctx.stroke();
    ctx.fillStyle="#0f0"; ctx.font="16px monospace";
    ctx.fillText(`x=${S.x|0} y=${S.y|0} stage=${S.stage}`, cam.x+12, cam.y+530);
  }
  ctx.restore();
}

// ---------- СТАРТ ----------
$("objText").textContent = OBJ[0];
function fitStage(){
  const k = Math.min(innerWidth/980, innerHeight/560);
  $("stage").style.transform = `scale(${Math.min(k,1.6)})`;
}
addEventListener("resize", fitStage); fitStage();
loadAssets(() => { cam.x = clamp(S.x-VIEW_W/2,0,W_W-VIEW_W); cam.y = clamp(S.y-VIEW_H/2,0,W_H-VIEW_H); requestAnimationFrame(tick); });
