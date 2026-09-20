// Прогресс игрока без DOM: настройки, миссии со звёздами, ежедневная серия.
// Всё localStorage в try/catch (приватный режим, запрет cookies). Вызовы — по событиям, не каждый кадр.
import { formatTemplate } from "./text.js";

const KEYS = { settings: "rizyrun_settings", missions: "rizyrun_missions", daily: "rizyrun_daily", streak: "rizyrun_streak" };

function readJSON(key) { try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : null; } catch (e) { return null; } }
function writeJSON(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); return true; } catch (e) { return false; } }

// ---------- настройки (HUD-8) ----------
// reducedMotion: null = как в системе, true/false = выбор игрока
export const DEFAULT_SETTINGS = Object.freeze({ music: 0.7, sfx: 0.8, reducedMotion: null, calm: false, contrast: false, vibration: true });
export function loadSettings() {
  const s = readJSON(KEYS.settings) || {};
  const out = { ...DEFAULT_SETTINGS };
  for (const k in DEFAULT_SETTINGS) if (k in s) out[k] = s[k];
  out.music = clamp01(out.music); out.sfx = clamp01(out.sfx);
  if (out.reducedMotion !== true && out.reducedMotion !== false) out.reducedMotion = null;
  return out;
}
export function saveSettings(s) { return writeJSON(KEYS.settings, s); }
const clamp01 = v => (typeof v === "number" && v === v ? (v < 0 ? 0 : v > 1 ? 1 : v) : 0.7);

// ---------- ежедневная серия (HUD-7, P1) ----------
const dayStr = d => d.toLocaleDateString("sv-SE");           // "2026-09-14"
export function recordDaily(now = new Date()) {
  const today = dayStr(now);
  const y = new Date(now); y.setDate(y.getDate() - 1);
  let last = null, streak = 0;
  try { last = localStorage.getItem(KEYS.daily); streak = +localStorage.getItem(KEYS.streak) || 0; } catch (e) {}
  if (last === today) return { today, streak: Math.max(1, streak), isNewDay: false };
  streak = last === dayStr(y) ? streak + 1 : 1;
  try { localStorage.setItem(KEYS.daily, today); localStorage.setItem(KEYS.streak, String(streak)); } catch (e) {}
  return { today, streak, isNewDay: true };
}

// ---------- миссии (HUD-4) ----------
// kind: "total" — копится между забегами; "run" — только в одном забеге (сбрасывается на старте);
// "clean" — метры без ударов (сбрасывается ударом и стартом)
export const MISSION_POOL = [
  { id: "jumps",    tpl: "Перепрыгни {n} {валик|валика|валиков}",          goal: 8,   kind: "total" },
  { id: "slides",   tpl: "Проскользни под {n} {гирляндой|гирляндами|гирляндами}", goal: 5, kind: "total" },
  { id: "energons", tpl: "Собери {n} {энергон|энергона|энергонов}",       goal: 60,  kind: "total" },
  { id: "clean",    tpl: "Пробеги {n} м без ударов",                       goal: 300, kind: "clean" },
  { id: "nice",     tpl: "{n} {раз|раза|раз} ЛОВКО!",                      goal: 3,   kind: "total" },
  { id: "arcs",     tpl: "Собери {n} {дугу|дуги|дуг} энергонов целиком",   goal: 3,   kind: "total" },
];
const byId = id => MISSION_POOL.find(m => m.id === id);

// Модель: активна одна миссия из набора из 3; набор закрыт → новый набор, звёзды копятся.
// add(id, amount) → null | { step: true, left } | { complete: true, next }
export function createMissions(o = {}) {
  const pool = o.pool || MISSION_POOL;
  const rnd = o.random || Math.random;
  let st = readJSON(KEYS.missions);
  if (!st || !Array.isArray(st.set) || st.set.length !== 3 || !st.set.every(byIdIn(pool))) st = null;
  if (!st) st = { set: pickSet(pool, rnd, null), idx: 0, count: 0, stars: 0, last: null };
  const save = () => writeJSON(KEYS.missions, st);

  function active() { return pool.find(m => m.id === st.set[st.idx]); }
  function view() {
    const m = active(), left = Math.max(0, Math.ceil(m.goal - st.count));
    return {
      id: m.id, tpl: m.tpl, n: left, goal: m.goal, text: formatTemplate(m.tpl, left),
      progress: Math.min(1, st.count / m.goal), stars: st.idx, total: 3, starsTotal: st.stars,
    };
  }
  function add(id, amount = 1) {
    const m = active();
    if (!m || m.id !== id || amount <= 0) return null;
    const before = Math.ceil(m.goal - st.count);
    st.count += amount;
    const left = Math.max(0, Math.ceil(m.goal - st.count));
    if (left > 0) { if (left !== before && m.kind !== "clean") save(); return left !== before ? { step: true, left } : null; }
    // выполнено
    st.stars += 1; st.last = m.id; st.count = 0; st.idx += 1;
    if (st.idx >= 3) { st.set = pickSet(pool, rnd, st.last); st.idx = 0; }
    save();
    return { complete: true, done: { id: m.id, text: formatTemplate(m.tpl, m.goal) }, next: view() };
  }
  // «clean»: метры без ударов считаются от последнего удара
  let cleanFrom = 0;
  function onStart() { const m = active(); if (m.kind !== "total") { st.count = 0; } cleanFrom = 0; }
  function onHit(dist) { const m = active(); if (m.kind === "clean") st.count = 0; cleanFrom = dist; }
  function onDistance(dist) {
    const m = active();
    if (m.kind !== "clean") return null;
    const want = Math.floor(dist - cleanFrom);
    return want > st.count ? add("clean", want - st.count) : null;
  }
  return { view, add, onStart, onHit, onDistance, get stars() { return st.stars; }, get state() { return st; } };
}
function byIdIn(pool) { return id => pool.some(m => m.id === id); }
function pickSet(pool, rnd, exclude) {
  const ids = pool.map(m => m.id).filter(id => id !== exclude);
  for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = ids[i]; ids[i] = ids[j]; ids[j] = t; }
  return ids.slice(0, 3);
}
