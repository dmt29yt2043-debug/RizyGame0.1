// Физика героини: фиксированный шаг, AABB против прямоугольников уровня.
// Без three и без DOM — тот же код гоняет node-проверка проходимости (src/check.js).
//
// Мир для шага: { solids: [{x0,x1,y0,y1}], plats: [{x0,x1,y, dx,dy, id}] }
//   solids — твёрдые блоки со всех сторон; plats — «насквозь снизу» (и движущиеся), держат только сверху.
// Ввод: { left, right, jump (зажат), jumpPressed (фронт), dashPressed (фронт) } — фронты шаг гасит сам.
// События шага складываются в массив ev: "jump" | "djump" | "land" | "dash".
import { PHYS } from "./config.js";

export function createPlayer(x = 0, y = 0){
  return {
    x, y, vx: 0, vy: 0,
    px: x, py: y,              // позиция до шага (интерполяция рендера, «гашение» сверху)
    facing: 1, grounded: true, ground: null,
    coyote: 0, buffer: 0, canDouble: true, airDash: true,
    dashT: 0, dashDir: 1, dashCD: 0,
    lock: 0,                   // с без управления (отброс после удара)
    invuln: 0,
    jumping: false,            // поднимаемся после своего прыжка (для короткого прыжка)
    airT: 0, fallFrom: y,
  };
}

const EPS = 1e-4;

function overlapX(p, r){ return p.x + PHYS.w * 0.5 > r.x0 + EPS && p.x - PHYS.w * 0.5 < r.x1 - EPS; }
function overlapY(p, r){ return p.y + PHYS.h > r.y0 + EPS && p.y < r.y1 - EPS; }

export function stepPlayer(p, inp, dt, world, ev){
  const P = PHYS;
  p.px = p.x; p.py = p.y;
  const wasGrounded = p.grounded;

  // едем на движущейся платформе: она уже сдвинулась в этом шаге
  if (p.grounded && p.ground && (p.ground.dx || p.ground.dy)){ p.x += p.ground.dx; p.y += p.ground.dy; }

  // ---------- таймеры ----------
  p.coyote = Math.max(0, p.coyote - dt);
  p.buffer = Math.max(0, p.buffer - dt);
  p.dashCD = Math.max(0, p.dashCD - dt);
  p.lock = Math.max(0, p.lock - dt);
  p.invuln = Math.max(0, p.invuln - dt);

  const ctl = p.lock <= 0;
  const dir = ctl ? ((inp.right ? 1 : 0) - (inp.left ? 1 : 0)) : 0;

  // ---------- рывок ----------
  if (inp.dashPressed){
    inp.dashPressed = false;
    if (ctl && p.dashT <= 0 && p.dashCD <= 0 && (p.grounded || p.airDash)){
      p.dashDir = dir || p.facing;
      p.facing = p.dashDir;
      p.dashT = P.dashT;
      if (!p.grounded) p.airDash = false;
      p.vy = 0; p.jumping = false;
      ev.push("dash");
    }
  }

  // ---------- прыжок: нажатие ----------
  if (inp.jumpPressed){
    inp.jumpPressed = false;
    if (ctl) p.buffer = P.buffer;
  }
  if (p.buffer > 0 && p.dashT <= 0 && ctl){
    if (p.grounded || p.coyote > 0){
      p.vy = P.v1; p.grounded = false; p.ground = null; p.coyote = 0; p.buffer = 0; p.jumping = true;
      ev.push("jump");
    } else if (p.canDouble){
      p.vy = P.v2; p.canDouble = false; p.buffer = 0; p.jumping = true;
      ev.push("djump");
    }
  }

  // ---------- горизонталь ----------
  if (p.dashT > 0){
    p.dashT -= dt;
    p.vx = p.dashDir * P.dashV;
    p.vy = 0;
    if (p.dashT <= 0){ p.dashT = 0; p.vx = p.dashDir * P.dashExit; p.dashCD = P.dashCD; }
  } else {
    const target = dir * P.maxRun;
    let a;
    if (p.grounded) a = dir === 0 ? P.decelGround : (Math.sign(p.vx) !== dir && Math.abs(p.vx) > 0.1 ? P.turnGround : P.accelGround);
    else a = dir === 0 ? P.decelAir : P.accelAir;
    if (!ctl) a = P.decelAir * 0.5;                  // отброс — почти без трения
    const d = target - p.vx, s = a * dt;
    p.vx = Math.abs(d) <= s ? target : p.vx + Math.sign(d) * s;
    if (dir !== 0 && ctl) p.facing = dir;
  }

  // ---------- гравитация ----------
  if (p.dashT <= 0){
    let m;
    if (p.vy > 0) m = (p.jumping && !inp.jump) ? P.cutMul : 1;
    else m = P.fallMul;
    if (inp.jump && Math.abs(p.vy) < P.hangVy) m = Math.min(m, P.hangMul);
    p.vy = Math.max(-P.maxFall, p.vy - P.g * m * dt);
    if (p.vy <= 0) p.jumping = false;
  }

  // ---------- движение по X ----------
  p.x += p.vx * dt;
  const hw = P.w * 0.5;
  for (const r of world.solids){
    if (!overlapY(p, r) || !overlapX(p, r)) continue;
    // выталкиваем в сторону, откуда пришли (по центру прошлой позиции)
    if (p.px <= (r.x0 + r.x1) * 0.5){ p.x = r.x0 - hw; } else { p.x = r.x1 + hw; }
    if (p.dashT > 0){ p.dashT = 0; p.dashCD = P.dashCD; }
    p.vx = 0;
  }

  // ---------- движение по Y ----------
  const prevBottom = p.y, vyBefore = p.vy;
  p.y += p.vy * dt;
  let landed = null;
  if (p.vy <= 0){
    for (const r of world.solids){
      if (!overlapX(p, r) || !overlapY(p, r)) continue;
      if (prevBottom >= r.y1 - 0.05){ p.y = r.y1; p.vy = 0; landed = r; }
    }
    for (const r of world.plats){
      if (!overlapX(p, r)) continue;
      // была выше прошлого положения верха платформы (она могла подъехать за шаг)
      const top = r.y;
      if (prevBottom >= top - (r.dy || 0) - 0.02 && p.y <= top){ p.y = top; p.vy = 0; landed = r; }
    }
  } else {
    for (const r of world.solids){
      if (!overlapX(p, r) || !overlapY(p, r)) continue;
      p.y = r.y0 - P.h; p.vy = 0; p.jumping = false;       // стукнулась головой
    }
  }

  // стоим на земле без скорости — всё равно «щупаем» опору (иначе едущая вниз платформа роняет)
  if (!landed && wasGrounded && p.vy <= 0 && p.dashT <= 0){
    const probe = support(p, world, 0.06);
    if (probe){ p.y = probe.top; p.vy = 0; landed = probe.r; }
  }

  if (landed){
    if (!wasGrounded){
      p.landVy = vyBefore;                             // скорость удара о землю — для силы пыли
      ev.push("land");
    }
    p.grounded = true; p.ground = landed; p.canDouble = true; p.airDash = true; p.jumping = false;
    p.airT = 0; p.fallFrom = p.y;
  } else {
    if (wasGrounded && p.vy <= 0 && !p.jumping && p.dashT <= 0) p.coyote = P.coyote;
    if (wasGrounded) p.fallFrom = p.y;
    p.grounded = false; p.ground = null;
    p.airT += dt;
  }
}

// опора под ступнями не ниже depth: { top, r } | null
export function support(p, world, depth){
  let best = null;
  const hw = PHYS.w * 0.5;
  for (const r of world.solids){
    if (p.x + hw <= r.x0 + EPS || p.x - hw >= r.x1 - EPS) continue;
    if (p.y >= r.y1 - 0.001 && p.y - r.y1 <= depth && (!best || r.y1 > best.top)) best = { top: r.y1, r };
  }
  for (const r of world.plats){
    if (p.x + hw <= r.x0 + EPS || p.x - hw >= r.x1 - EPS) continue;
    if (p.y >= r.y - 0.001 && p.y - r.y <= depth && (!best || r.y > best.top)) best = { top: r.y, r };
  }
  return best;
}

// верх опоры под точкой x (для факелов, теней, телепорта фоторежима): самая высокая поверхность ниже y
export function groundAt(world, x, y = 1e9){
  let top = -Infinity;
  for (const r of world.solids) if (x >= r.x0 && x <= r.x1 && r.y1 <= y + 1e-3 && r.y1 > top) top = r.y1;
  for (const r of world.plats) if (x >= r.x0 && x <= r.x1 && r.y <= y + 1e-3 && r.y > top) top = r.y;
  return top;
}
