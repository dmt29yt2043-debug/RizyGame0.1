// Звук: всё синтезируется WebAudio на лету, без файлов.
// Прыжок, двойной прыжок, рывок, кристалл (в серии нота растёт по пентатонике), звёздный кристалл,
// гашение Гасителя, урон, приземление, чекпоинт, победа; тихий фоновый пэд.
// Контекст создаётся на первый ввод (политика автозапуска браузеров). Громкость 0..1 в localStorage.
import { GAME } from "./config.js";

const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28, 31];   // мажорная пентатоника, полутона
const hz = m => 440 * Math.pow(2, (m - 69) / 12);

export function createAudio(){
  let ctx = null, master = null, sfx = null, music = null, noiseBuf = null, padOn = false, padTimer = 0;
  let volume = 0.7;
  try { const v = parseFloat(localStorage.getItem(GAME.volumeKey)); if (Number.isFinite(v)) volume = Math.min(1, Math.max(0, v)); } catch (e){}
  let muted = false;

  function ensure(){
    if (ctx) { if (ctx.state === "suspended") ctx.resume().catch(() => {}); return true; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try { ctx = new AC(); } catch (e){ return false; }
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2;
    master = ctx.createGain(); master.gain.value = muted ? 0 : volume;
    sfx = ctx.createGain(); sfx.gain.value = 0.9;
    music = ctx.createGain(); music.gain.value = 0.0;
    sfx.connect(comp); music.connect(comp); comp.connect(master); master.connect(ctx.destination);
    // буфер белого шума на 1 с
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    let s = 12345;
    for (let i = 0; i < d.length; i++){ s = (s * 1103515245 + 12345) & 0x7fffffff; d[i] = (s / 0x7fffffff) * 2 - 1; }
    return true;
  }

  // ---------- кирпичики ----------
  function tone({ f = 440, f2 = null, t = 0, dur = 0.15, type = "sine", g = 0.3, a = 0.005, curve = "exp", dest = null, detune = 0 }){
    const o = ctx.createOscillator(), e = ctx.createGain();
    const t0 = ctx.currentTime + t;
    o.type = type; o.frequency.setValueAtTime(f, t0); o.detune.value = detune;
    if (f2) curve === "exp" ? o.frequency.exponentialRampToValueAtTime(f2, t0 + dur) : o.frequency.linearRampToValueAtTime(f2, t0 + dur);
    e.gain.setValueAtTime(0.0001, t0);
    e.gain.exponentialRampToValueAtTime(g, t0 + a);
    e.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(e); e.connect(dest || sfx);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }
  function noise({ t = 0, dur = 0.2, g = 0.2, type = "bandpass", f = 1200, f2 = null, q = 1, a = 0.005 }){
    const src = ctx.createBufferSource(), flt = ctx.createBiquadFilter(), e = ctx.createGain();
    const t0 = ctx.currentTime + t;
    src.buffer = noiseBuf; src.loop = true;
    flt.type = type; flt.frequency.setValueAtTime(f, t0); flt.Q.value = q;
    if (f2) flt.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
    e.gain.setValueAtTime(0.0001, t0);
    e.gain.exponentialRampToValueAtTime(g, t0 + a);
    e.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(flt); flt.connect(e); e.connect(sfx);
    src.start(t0, Math.random() * 0.5); src.stop(t0 + dur + 0.05);
  }
  // колокольчик: основной тон + негармонические обертоны
  function bell(m, t = 0, g = 0.22, dur = 0.7){
    const f = hz(m);
    tone({ f, t, dur, type: "sine", g });
    tone({ f: f * 2.01, t, dur: dur * 0.6, type: "sine", g: g * 0.35 });
    tone({ f: f * 3.02, t, dur: dur * 0.35, type: "triangle", g: g * 0.12 });
  }

  const SFX = {
    jump(){ tone({ f: 330, f2: 620, dur: 0.14, type: "triangle", g: 0.22 }); tone({ f: 660, f2: 1100, dur: 0.08, type: "sine", g: 0.06, t: 0.01 }); },
    djump(){ tone({ f: 520, f2: 1040, dur: 0.16, type: "triangle", g: 0.2 }); bell(88, 0.04, 0.08, 0.3); noise({ dur: 0.15, g: 0.05, f: 5000, f2: 9000, q: 2 }); },
    dash(){ noise({ dur: 0.26, g: 0.28, type: "bandpass", f: 700, f2: 3800, q: 1.2, a: 0.01 }); tone({ f: 220, f2: 110, dur: 0.18, type: "sawtooth", g: 0.05 }); },
    land(){ noise({ dur: 0.09, g: 0.12, type: "lowpass", f: 700, f2: 200, q: 0.7 }); tone({ f: 140, f2: 70, dur: 0.08, g: 0.08 }); },
    crystal(n){ const m = 76 + PENTA[Math.min(PENTA.length - 1, n)]; bell(m, 0, 0.2, 0.55); bell(m + 12, 0.05, 0.06, 0.3); },
    star(){ [0, 4, 7, 12, 16].forEach((d, i) => bell(79 + d, i * 0.06, 0.18, 0.8)); noise({ dur: 0.5, g: 0.05, f: 7000, q: 3 }); },
    stomp(){ tone({ f: 260, f2: 70, dur: 0.18, type: "sine", g: 0.35 }); noise({ dur: 0.14, g: 0.2, type: "lowpass", f: 1400, f2: 300 }); tone({ f: 880, f2: 1320, dur: 0.1, type: "triangle", g: 0.08, t: 0.05 }); },
    hurt(){ tone({ f: 420, f2: 160, dur: 0.32, type: "square", g: 0.12 }); tone({ f: 427, f2: 150, dur: 0.32, type: "sawtooth", g: 0.06 }); noise({ dur: 0.2, g: 0.1, type: "lowpass", f: 900 }); },
    fall(){ tone({ f: 600, f2: 120, dur: 0.5, type: "triangle", g: 0.16 }); },
    checkpoint(){ noise({ dur: 0.5, g: 0.16, type: "lowpass", f: 400, f2: 2400, q: 0.8, a: 0.05 }); [0, 4, 7, 12].forEach((d, i) => bell(72 + d, 0.08 + i * 0.08, 0.14, 0.6)); },
    win(){
      const seq = [0, 4, 7, 12, 7, 12, 16, 19, 24];
      seq.forEach((d, i) => { bell(72 + d, i * 0.11, 0.16, 0.9); tone({ f: hz(60 + d), t: i * 0.11, dur: 0.3, type: "triangle", g: 0.05 }); });
      [60, 64, 67, 72].forEach(m => tone({ f: hz(m), t: 1.0, dur: 2.2, type: "triangle", g: 0.07, a: 0.08 }));
    },
    over(){ [7, 4, 0, -5].forEach((d, i) => tone({ f: hz(67 + d), t: i * 0.16, dur: 0.35, type: "triangle", g: 0.12 })); },
    click(){ tone({ f: 900, f2: 1200, dur: 0.05, type: "sine", g: 0.08 }); },
    start(){ [0, 7, 12].forEach((d, i) => bell(76 + d, i * 0.07, 0.14, 0.5)); },
  };

  // ---------- фоновый пэд: мягкие аккорды I–vi–IV–V в фа мажоре ----------
  const CHORDS = [[53, 57, 60, 65], [50, 53, 57, 62], [46, 50, 53, 58], [48, 52, 55, 60]];
  let chordIdx = 0;
  function padChord(){
    if (!ctx || !padOn) return;
    const t0 = ctx.currentTime, dur = 4.4;
    const flt = ctx.createBiquadFilter(); flt.type = "lowpass"; flt.frequency.value = 900; flt.Q.value = 0.4;
    flt.connect(music);
    for (const m of CHORDS[chordIdx % CHORDS.length]){
      for (const det of [-6, 6]){
        const o = ctx.createOscillator(), e = ctx.createGain();
        o.type = "triangle"; o.frequency.value = hz(m); o.detune.value = det;
        e.gain.setValueAtTime(0.0001, t0);
        e.gain.linearRampToValueAtTime(0.05, t0 + 1.4);
        e.gain.linearRampToValueAtTime(0.0001, t0 + dur + 1.2);
        o.connect(e); e.connect(flt); o.start(t0); o.stop(t0 + dur + 1.3);
      }
    }
    // редкая «музыкальная шкатулка» сверху
    const top = CHORDS[chordIdx % CHORDS.length];
    [0, 1, 2, 3].forEach(i => { if (Math.random() < 0.55) { const m = top[(i * 3) % 4] + 24; const o = ctx.createOscillator(), e = ctx.createGain(); const t = t0 + 0.4 + i * 0.9;
      o.type = "sine"; o.frequency.value = hz(m); e.gain.setValueAtTime(0.0001, t); e.gain.exponentialRampToValueAtTime(0.03, t + 0.01); e.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
      o.connect(e); e.connect(music); o.start(t); o.stop(t + 1.2); } });
    chordIdx++;
  }

  return {
    get ready(){ return !!ctx; },
    unlock(){ return ensure(); },
    play(name, arg){
      if (!ctx || muted) return;
      try { SFX[name] && SFX[name](arg); } catch (e){}
    },
    // пэд: вкл/выкл с плавным уровнем; tick зовётся из кадра
    music(on){
      padOn = on;
      if (!ctx) return;
      const t = ctx.currentTime;
      music.gain.cancelScheduledValues(t);
      music.gain.setTargetAtTime(on ? 0.55 : 0.0, t, on ? 1.2 : 0.3);
      if (on && padTimer <= 0) padTimer = 0.01;
    },
    tick(dt){
      if (!ctx || !padOn) return;
      padTimer -= dt;
      if (padTimer <= 0){ padChord(); padTimer = 4.4; }
    },
    duck(on){ if (ctx) music.gain.setTargetAtTime(on ? 0.12 : (padOn ? 0.55 : 0), ctx.currentTime, 0.15); },
    get volume(){ return volume; },
    setVolume(v){
      volume = Math.min(1, Math.max(0, v));
      if (master) master.gain.setTargetAtTime(volume, ctx.currentTime, 0.03);
      try { localStorage.setItem(GAME.volumeKey, String(volume)); } catch (e){}
    },
    setMuted(m){ muted = !!m; if (master) master.gain.setTargetAtTime(muted ? 0 : volume, ctx.currentTime, 0.03); },
  };
}
