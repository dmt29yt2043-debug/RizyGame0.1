#!/usr/bin/env node
// Проверка проходимости уровней: node game/platformer/tools/check.mjs
// Код физики и огибающих — тот же, что в игре (src/physics.js, src/check.js), включая лазание по лианам
// (уровень 2: PHYS.climbSpeed/climbHopX/climbHopY, via:"vine" в level.path — см. src/check.js). Выход 1,
// если хоть один уровень не проходим.
import { checkLevel, formatReport } from "../src/check.js";
import { LEVELS } from "../src/levels/index.js";

let allOk = true;
for (const lv of LEVELS){
  const LEVEL = lv.data;
  console.log(`\n########## УРОВЕНЬ ${lv.id}: «${LEVEL.name}» ##########`);
  const main = checkLevel(LEVEL);
  console.log("=== ОБЯЗАТЕЛЬНЫЙ МАРШРУТ ===");
  console.log(formatReport(main));
  let ok = main.ok;
  (LEVEL.secrets || []).forEach((route, i) => {
    const r = checkLevel({ ...LEVEL, path: route });
    ok = ok && r.ok;
    console.log(`\n=== СЕКРЕТ ${i + 1} (звёздный кристалл) ===`);
    console.log(formatReport(r).split("\n").slice(7).join("\n"));
  });
  allOk = allOk && ok;
  console.log(`\nУровень ${lv.id}: ${ok ? "ВСЁ ПРОХОДИМО" : "ЕСТЬ НЕПРОХОДИМЫЕ МЕСТА"}`);
}
console.log(`\n===== ИТОГ: ${allOk ? "ВСЁ ПРОХОДИМО" : "ЕСТЬ НЕПРОХОДИМЫЕ МЕСТА"} =====`);
process.exit(allOk ? 0 : 1);
