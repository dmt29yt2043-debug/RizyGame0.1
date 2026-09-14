// Шина событий: on / off / emit. Без аллокаций в emit.
// Подписчики хранятся copy-on-write: off() во время emit не ломает обход.

export function createBus(){
  const map = new Map();
  let errors = 0;

  function on(evt, fn){
    const arr = map.get(evt);
    map.set(evt, arr ? arr.concat([fn]) : [fn]);
    return fn;
  }
  function off(evt, fn){
    const arr = map.get(evt);
    if (!arr) return;
    const i = arr.indexOf(fn);
    if (i < 0) return;
    const next = arr.slice(); next.splice(i, 1);
    if (next.length) map.set(evt, next); else map.delete(evt);
  }
  function emit(evt, payload){
    const arr = map.get(evt);
    if (!arr) return;
    for (let i = 0; i < arr.length; i++){
      try { arr[i](payload); }
      catch (e){
        // сломанный подписчик не должен ронять игру; не засоряем консоль
        errors++;
        if (errors <= 20 || errors % 600 === 0) console.error(`[bus] ошибка в подписчике "${evt}"`, e);
      }
    }
  }
  return { on, off, emit };
}

// Шина с учётом подписок: всё, что плагин подписал, снимается одним offAll()
export function scopeBus(bus){
  const subs = [];
  return {
    on(evt, fn){ bus.on(evt, fn); subs.push([evt, fn]); return fn; },
    off(evt, fn){
      bus.off(evt, fn);
      const i = subs.findIndex(s => s[0] === evt && s[1] === fn);
      if (i >= 0) subs.splice(i, 1);
    },
    emit: bus.emit,
    // вызвать только свои обработчики (например, пересоздать визуал сущностей после замены плагина)
    emitLocal(evt, payload){
      for (const s of subs.slice()){
        if (s[0] !== evt) continue;
        try { s[1](payload); } catch (e){ console.error(`[bus] emitLocal "${evt}"`, e); }
      }
    },
    offAll(){ for (const [evt, fn] of subs) bus.off(evt, fn); subs.length = 0; },
  };
}
