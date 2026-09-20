// Миссии забега: цепочка заданий «перепрыгни 6 валиков», «проскользни под 5 гирляндами»…
// G.mission мутируется на месте; события mission:progress / mission:complete. Индекс хранится в rizyrun_missions.

// русские формы множественного числа: plural(n, "валик", "валика", "валиков")
export function plural(n, one, few, many){
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

export const MISSIONS = [
  { id: "jump6",   kind: "jump",  goal: 6,   text: n => `Перепрыгни ${n} ${plural(n, "валик", "валика", "валиков")}` },
  { id: "coin50",  kind: "coin",  goal: 50,  text: n => `Собери ${n} ${plural(n, "энергон", "энергона", "энергонов")}` },
  { id: "slide5",  kind: "slide", goal: 5,   text: n => `Проскользни под ${n} ${plural(n, "гирляндой", "гирляндами", "гирляндами")}` },
  { id: "near3",   kind: "near",  goal: 3,   text: n => `Увернись ловко ${n} ${plural(n, "раз", "раза", "раз")}` },
  { id: "dist500", kind: "dist",  goal: 500, text: n => `Пробеги ${n} м` },
  { id: "lane25",  kind: "lane",  goal: 25,  text: n => `Смени дорожку ${n} ${plural(n, "раз", "раза", "раз")}` },
  { id: "jump12",  kind: "jump",  goal: 12,  text: n => `Перепрыгни ${n} ${plural(n, "валик", "валика", "валиков")}` },
  { id: "coin120", kind: "coin",  goal: 120, text: n => `Собери ${n} ${plural(n, "энергон", "энергона", "энергонов")}` },
  { id: "dist1000",kind: "dist",  goal: 1000,text: n => `Пробеги ${n} м` },
];

export function createMissions({ cfg, G, bus, persist }){
  const m = G.mission;
  let index = 0, startDist = 0, lastDistStep = -1;

  function load(){
    if (!persist()) return 0;
    try { const j = JSON.parse(localStorage.getItem(cfg.missionsKey) || "{}"); return (j.index | 0) % MISSIONS.length; } catch (e){ return 0; }
  }
  function save(){
    if (!persist()) return;
    try { localStorage.setItem(cfg.missionsKey, JSON.stringify({ index })); } catch (e){}
  }
  function set(i){
    const d = MISSIONS[i % MISSIONS.length];
    index = i % MISSIONS.length;
    m.id = d.id; m.kind = d.kind; m.goal = d.goal; m.text = d.text(d.goal);
    m.progress = 0; m.done = false; m.index = index;
    startDist = G.dist; lastDistStep = -1;
  }
  function reset(){ set(load()); bus.emit("mission:progress", m); }

  // шаг прогресса; возвращает true, если это шаг действия (для очков комбо)
  function track(kind, amount = 1){
    if (m.done || kind !== m.kind) return false;
    m.progress = Math.min(m.goal, m.progress + amount);
    bus.emit("mission:progress", m);
    if (m.progress >= m.goal) complete();
    return kind !== "coin";
  }
  function complete(){
    m.done = true;
    bus.emit("mission:complete", m);
    index = (index + 1) % MISSIONS.length;
    save();
    set(index);
    bus.emit("mission:progress", m);
  }
  function update(){
    if (m.done || m.kind !== "dist") return;
    const p = Math.floor(G.dist - startDist);
    const step = Math.floor(p / 10);
    if (step !== lastDistStep){
      lastDistStep = step;
      m.progress = Math.min(m.goal, p);
      bus.emit("mission:progress", m);
      if (m.progress >= m.goal) complete();
    }
  }
  return { reset, track, update };
}
