// Тексты HUD: русские формы множественного числа и шаблоны строк миссий.
// Шаблон: "Перепрыгни {n} {валик|валика|валиков}" — {n} число, {one|few|many} слово в нужной форме.

// 1 валик · 2 валика · 5 валиков · 11 валиков · 21 валик · 22 валика
export function pluralRu(n, one, few, many) {
  const a = Math.abs(Math.floor(n)) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}

// разбор шаблона на части: { t: "text" | "n" | "forms", s?, forms? } (один раз на смену миссии)
const RX = /\{n\}|\{([^{}|]+)\|([^{}|]+)\|([^{}|]+)\}/g;
export function parseTemplate(tpl) {
  const parts = [];
  let last = 0, m;
  RX.lastIndex = 0;
  while ((m = RX.exec(tpl))) {
    if (m.index > last) parts.push({ t: "text", s: tpl.slice(last, m.index) });
    if (m[0] === "{n}") parts.push({ t: "n" });
    else parts.push({ t: "forms", forms: [m[1], m[2], m[3]] });
    last = m.index + m[0].length;
  }
  if (last < tpl.length) parts.push({ t: "text", s: tpl.slice(last) });
  return parts;
}

// готовая строка: formatTemplate("Собери {n} {энергон|энергона|энергонов}", 2) → "Собери 2 энергона"
export function formatTemplate(tpl, n) {
  return tpl.replace(RX, (all, one, few, many) => (all === "{n}" ? String(n) : pluralRu(n, one, few, many)));
}

// «N энергонов», «N метров» и т.п. для карточек
export const plural = (n, one, few, many) => `${n} ${pluralRu(n, one, few, many)}`;

export const TXT = {
  resHead: "Рой догнал!",
  best: "Лучший забег!",
  toRecord: n => `+${n} м до рекорда`,
  toGoal: (goal, left) => `до ${goal} м оставалось ${left} м`,
  streak: n => `День ${n} подряд`,                     // формулировка из HUD-7, склонение не нужно
  next: s => `Следующая: ${s}`,
  revive: "Спасти Ризи?",
  go: "ВПЕРЁД!",
  praise: "Отлично!",
  tutDone: "Разминка пройдена — дальше по-настоящему!",
};
