#!/usr/bin/env node
// Проверка проходимости уровня: node game/platformer/tools/check.mjs
// Код физики и огибающих — тот же, что в игре (src/physics.js, src/check.js). Выход 1, если что-то не берётся.
import { LEVEL } from "../src/level.js";
import { checkLevel, formatReport } from "../src/check.js";

const main = checkLevel(LEVEL);
console.log("=== ОБЯЗАТЕЛЬНЫЙ МАРШРУТ ===");
console.log(formatReport(main));
let ok = main.ok;
LEVEL.secrets.forEach((route, i) => {
  const r = checkLevel({ ...LEVEL, path: route });
  ok = ok && r.ok;
  console.log(`\n=== СЕКРЕТ ${i + 1} (звёздный кристалл) ===`);
  console.log(formatReport(r).split("\n").slice(7).join("\n"));
});
console.log(`\n${ok ? "ВСЁ ПРОХОДИМО" : "ЕСТЬ НЕПРОХОДИМЫЕ МЕСТА"}`);
process.exit(ok ? 0 : 1);
