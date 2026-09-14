// БАЗОВЫЙ плагин HUD (фолбэк = legacy/run.js): пробег, энергоны, полоса роя, титульная и финальная карточки.
// DOM живёт в index.html; плагин только переключает и заполняет его.

const QUIPS = [
  "«Статистика занесена в журнал миссии», — вздыхает Куби.",
  "«Рекомендация: в следующий раз — быстрее», — говорит Куби. Спасибо, Куби.",
  "«Мой хвост видел этот подкат. Уважение», — передаёт Му-Хрю.",
  "Мисс Фантастика мурлычет. Энергия сердца восстановлена.",
];

export default {
  name: "hud",
  install(ctx){
    const { $, bus, util, cfg } = ctx;
    const G = ctx.G;
    const scoreN = $("score").querySelector(".n");
    const enN = $("energons").querySelector(".n");
    const pill = $("energons");
    const swarmEl = $("swarm"), swarmFill = $("swarmFill");
    $("best").textContent = G.best;

    let lastScore = -1, lastFill = -1, bumpT = 0;

    const onStart = () => {
      $("title").style.display = "none";
      $("over").style.display = "none";
      swarmEl.style.display = "none";
      enN.textContent = G.energons;
      lastScore = -1; lastFill = -1;
    };
    const onTitle = () => {
      $("over").style.display = "none";
      $("title").style.display = "flex";
    };
    const onOver = (r) => {
      $("finalDist").textContent = r.dist;
      $("finalEn").textContent = r.energons;
      if (r.isBest) $("best").textContent = G.best;
      $("newBest").style.display = r.isBest ? "block" : "none";
      $("quip").textContent = util.pick(QUIPS);
      $("over").style.display = "flex";
      swarmEl.style.display = "none";
    };
    const onPickup = () => {
      enN.textContent = G.energons;
      pill.classList.add("bump");
      clearTimeout(bumpT);
      bumpT = setTimeout(() => pill.classList.remove("bump"), 120);
    };
    const onNear = () => { swarmEl.style.display = "block"; };
    const onFar = () => { swarmEl.style.display = "none"; };

    bus.on("start", onStart);
    bus.on("title", onTitle);
    bus.on("gameover", onOver);
    bus.on("pickup", onPickup);
    bus.on("swarm:near", onNear);
    bus.on("swarm:far", onFar);

    return {
      update(){
        if (G.mode !== "play") return;
        const d = Math.floor(G.dist);
        if (d !== lastScore){ lastScore = d; scoreN.textContent = d; }
        if (G.swarmNear > 0){
          // ширину пишем только при заметном изменении — без лишних строк и перерисовок
          const f = Math.round(util.clamp(G.swarmNear/cfg.swarmTime,0,1)*500);
          if (f !== lastFill){ lastFill = f; swarmFill.style.width = (f/5) + "%"; }
        }
      },
      dispose(){
        bus.off("start", onStart); bus.off("title", onTitle); bus.off("gameover", onOver);
        bus.off("pickup", onPickup); bus.off("swarm:near", onNear); bus.off("swarm:far", onFar);
        clearTimeout(bumpT);
      },
    };
  },
};
