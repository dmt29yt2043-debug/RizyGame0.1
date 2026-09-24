// Прогресс игрока между уровнями: localStorage, всё в try/catch (может быть недоступен — приватный режим и т.п.).
// Формат: { unlocked: [1,2,...], best: { [levelId]: { time, crystals, stars } }, volume, quality }
import { UNLOCK_ALL } from "./config.js";

const KEY = "rizy-plat-progress-v1";

function read(){
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "null");
    if (raw && typeof raw === "object") return raw;
  } catch (e){}
  return {};
}
function write(data){
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e){}
}

export function loadProgress(){
  const d = read();
  return {
    unlocked: Array.isArray(d.unlocked) && d.unlocked.length ? d.unlocked.slice() : [1],
    best: d.best && typeof d.best === "object" ? d.best : {},
    quality: ["low", "med", "high"].includes(d.quality) ? d.quality : null,
    lastLevel: Number.isFinite(d.lastLevel) ? d.lastLevel : 1,
  };
}

export function isUnlocked(progress, id){ return UNLOCK_ALL || progress.unlocked.includes(id); }

export function unlock(progress, id){
  if (!progress.unlocked.includes(id)){ progress.unlocked.push(id); progress.unlocked.sort((a, b) => a - b); }
  write({ unlocked: progress.unlocked, best: progress.best, quality: progress.quality, lastLevel: progress.lastLevel });
}

export function setLastLevel(progress, id){
  progress.lastLevel = id;
  write({ unlocked: progress.unlocked, best: progress.best, quality: progress.quality, lastLevel: progress.lastLevel });
}

export function setQuality(progress, q){
  progress.quality = q;
  write({ unlocked: progress.unlocked, best: progress.best, quality: progress.quality, lastLevel: progress.lastLevel });
}

// сохранить лучший результат уровня (если лучше прежнего по времени); возвращает true, если это новый рекорд
export function saveLevelBest(progress, id, { time, crystals, stars }){
  const prev = progress.best[id];
  const better = !prev || time < prev.time;
  progress.best[id] = {
    time: better ? time : prev.time,
    crystals: Math.max(crystals, prev ? prev.crystals : 0),
    stars: Math.max(stars, prev ? prev.stars : 0),
  };
  write({ unlocked: progress.unlocked, best: progress.best, quality: progress.quality, lastLevel: progress.lastLevel });
  return better;
}

export function getBest(progress, id){ return progress.best[id] || null; }
