// БАЗОВЫЙ плагин звука (фолбэк = legacy/run.js): короткие процедурные «бипы» WebAudio на события игры.

export default {
  name: "audio",
  install(ctx){
    const { bus } = ctx;
    const G = ctx.G;
    let AC = null;
    const timers = [];

    function beep(f, dur, type="triangle", gain=0.06, slide=0){
      if (ctx.simulating) return;       // симуляция (sim/фоторежим) — без сотен осцилляторов
      try {
        AC = AC || new (window.AudioContext||window.webkitAudioContext)();
        const o = AC.createOscillator(), g = AC.createGain();
        o.type = type; o.frequency.value = f;
        if (slide) o.frequency.linearRampToValueAtTime(f+slide, AC.currentTime+dur);
        g.gain.value = gain; g.gain.exponentialRampToValueAtTime(0.0001, AC.currentTime+dur);
        o.connect(g); g.connect(AC.destination);
        o.start(); o.stop(AC.currentTime+dur);
      } catch(e){}
    }

    const H = {
      "lane":     () => beep(330,.05,"square",.03),
      "jump":     () => beep(470,.12,"sine",.05,250),
      "slide":    () => beep(215,.1,"sine",.04,-80),
      "start":    () => beep(560,.15,"triangle",.06,290),
      "land":     () => beep(150,.08,"sine",.04),
      "hit":      () => beep(120,.25,"sawtooth",.09),
      "pickup":   () => beep(900+Math.min(600,G.energons*8),.07,"triangle",.05,150),
      "gameover": () => {
        beep(300,.3,"sawtooth",.07,-160);
        timers.push(setTimeout(()=>beep(180,.5,"sawtooth",.06,-90), 220));
      },
    };
    for (const k in H) bus.on(k, H[k]);

    return {
      beep,
      update(){},
      dispose(){
        for (const k in H) bus.off(k, H[k]);
        for (const t of timers) clearTimeout(t);
        try { AC && AC.close(); } catch(e){}
      },
    };
  },
};
