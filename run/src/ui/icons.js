// SVG-иконки HUD: энергон-кристалл, пауза, звезда, галочка, рука-подсказка, помпон роя, шестерёнка.
// Всё векторное — чёткое на любом dpr, без сетевых запросов.

const INK = "#070D36";

// Лаймовый кристалл: 6 граней + площадка, обводка чернилами, блик и искра.
// uid нужен, чтобы id градиентов не конфликтовали при нескольких копиях в DOM.
let gemN = 0;
export function gemSVG(cls = "") {
  const u = "g" + (gemN++);
  return `<svg class="${cls}" viewBox="0 0 64 64" aria-hidden="true">
  <defs>
    <linearGradient id="${u}t" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#F4FFC2"/><stop offset=".55" stop-color="#C8FF4A"/><stop offset="1" stop-color="#9EE020"/>
    </linearGradient>
    <radialGradient id="${u}s" cx=".5" cy=".5" r=".5">
      <stop offset="0" stop-color="#fff" stop-opacity="1"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <ellipse cx="32" cy="60" rx="17" ry="3.2" fill="${INK}" opacity=".22"/>
  <g stroke-linejoin="round">
    <polygon points="32,3 55,17 55,43 32,58 9,43 9,17" fill="#8FD11C" stroke="${INK}" stroke-width="4"/>
    <polygon points="32,3 55,17 44,22 32,13" fill="#E3FF8E"/>
    <polygon points="32,3 32,13 20,22 9,17" fill="#F6FFD0"/>
    <polygon points="9,17 20,22 20,38 9,43" fill="#CFFF5C"/>
    <polygon points="55,17 55,43 44,38 44,22" fill="#9BDB1E"/>
    <polygon points="9,43 20,38 32,47 32,58" fill="#A9E62A"/>
    <polygon points="55,43 32,58 32,47 44,38" fill="#6FB312"/>
    <polygon points="32,13 44,22 44,38 32,47 20,38 20,22" fill="url(#${u}t)"/>
    <g fill="none" stroke="${INK}" stroke-opacity=".28" stroke-width="1.2">
      <polyline points="32,3 32,13 44,22 55,17"/><polyline points="9,17 20,22 32,13"/>
      <polyline points="20,22 20,38 9,43"/><polyline points="44,22 44,38 55,43"/>
      <polyline points="20,38 32,47 44,38"/><line x1="32" y1="47" x2="32" y2="58"/>
    </g>
    <polygon points="32,3 55,17 55,43 32,58 9,43 9,17" fill="none" stroke="${INK}" stroke-width="4"/>
  </g>
  <path d="M15 20.5 L27 11.5" stroke="#fff" stroke-width="4" stroke-linecap="round" opacity=".95"/>
  <path d="M24 27 L24 33" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".7"/>
  <circle cx="47" cy="12" r="7" fill="url(#${u}s)"/>
  <path d="M47 6.5 L48.3 10.7 L52.5 12 L48.3 13.3 L47 17.5 L45.7 13.3 L41.5 12 L45.7 10.7 Z" fill="#fff"/>
</svg>`;
}

export const pauseSVG = `<svg viewBox="0 0 32 32" aria-hidden="true">
  <rect x="7.5" y="6" width="6" height="20" rx="2.6" fill="#fff" stroke="${INK}" stroke-width="2.2"/>
  <rect x="18.5" y="6" width="6" height="20" rx="2.6" fill="#fff" stroke="${INK}" stroke-width="2.2"/>
</svg>`;

export const playSVG = `<svg viewBox="0 0 32 32" aria-hidden="true">
  <path d="M10 6.5 L25.5 16 L10 25.5 Z" fill="currentColor" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/>
</svg>`;

export const retrySVG = `<svg viewBox="0 0 32 32" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="4.2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M25 16a9 9 0 1 1-3-6.7"/><path d="M23.5 3.8 L23 10 L16.8 9.6"/>
</svg>`;

export const gearSVG = `<svg viewBox="0 0 32 32" aria-hidden="true">
  <path fill="#fff" stroke="${INK}" stroke-width="2.2" stroke-linejoin="round"
   d="M13.6 3.5h4.8l.8 3.4 2.3 1.3 3.3-1.1 2.4 4.2-2.6 2.3v2.8l2.6 2.3-2.4 4.2-3.3-1.1-2.3 1.3-.8 3.4h-4.8l-.8-3.4-2.3-1.3-3.3 1.1-2.4-4.2 2.6-2.3v-2.8L4.8 11.3l2.4-4.2 3.3 1.1 2.3-1.3z"/>
  <circle cx="16" cy="16" r="4.2" fill="#0536D4" stroke="${INK}" stroke-width="2.2"/>
</svg>`;

// Звезда набора миссий: filled — лаймовая, иначе полупрозрачная пустая
export function starSVG(filled) {
  return `<svg class="rz-star${filled ? " on" : ""}" viewBox="0 0 24 24" aria-hidden="true">
  <path d="M12 2.6l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 16.4l-5.4 2.9 1.1-6.1L3.2 9l6.1-.8z"
   stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>
</svg>`;
}

// Галочка «ГОТОВО!»: путь рисуется через stroke-dashoffset (длина ≈ 26)
export const checkSVG = `<svg class="rz-check" viewBox="0 0 24 24" aria-hidden="true">
  <circle cx="12" cy="12" r="10.5" fill="${INK}"/>
  <path d="M6.8 12.4 L10.4 16 L17.4 8.6" fill="none" stroke="#C0FF3F" stroke-width="3.2"
   stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="26" stroke-dashoffset="26"/>
</svg>`;

// Помпон Гасителя для полосы роя: тёмный войлок, синий ободок, красный глаз
export const swarmSVG = `<svg viewBox="0 0 40 40" aria-hidden="true">
  <g fill="#1A1F4A" stroke="${INK}" stroke-width="2">
    <circle cx="20" cy="21" r="14"/>
  </g>
  <g fill="#1A1F4A">
    <circle cx="8" cy="14" r="4"/><circle cx="31" cy="12" r="4.5"/><circle cx="20" cy="7" r="4.5"/>
    <circle cx="6.5" cy="26" r="3.6"/><circle cx="33.5" cy="27" r="3.8"/>
  </g>
  <path d="M9 13a14 14 0 0 1 19-5" stroke="#4E6BFF" stroke-width="2.4" fill="none" stroke-linecap="round" opacity=".8"/>
  <circle cx="20" cy="21" r="6.4" fill="#FF2436"/>
  <circle cx="20" cy="21" r="3" fill="#FFD6DA"/>
</svg>`;

// Рука-подсказка туториала (указательный палец вверх)
export const handSVG = `<svg viewBox="0 0 64 72" aria-hidden="true">
  <path fill="#fff" stroke="${INK}" stroke-width="3.4" stroke-linejoin="round" stroke-linecap="round"
   d="M24 36V10.5a5 5 0 0 1 10 0V30l1-.2V26a4.8 4.8 0 0 1 9.4 0v5l1-.1a4.6 4.6 0 0 1 9 1.3v4.2l.6-.1a4.3 4.3 0 0 1 8 2.2v11.5c0 11-8 19-19.5 19H38C29 69 24 64 19 57l-8.7-12.8a5 5 0 0 1 7.7-6.3z"/>
  <path d="M28 12.5v8" stroke="#C0FF3F" stroke-width="3" stroke-linecap="round" opacity=".0"/>
</svg>`;

// Сердце revive: синий войлок с бликом
export const heartSVG = `<svg viewBox="0 0 48 48" aria-hidden="true">
  <path d="M24 42 C10 32 4 25 4 16.5 A10.5 10.5 0 0 1 24 11 A10.5 10.5 0 0 1 44 16.5 C44 25 38 32 24 42Z"
   fill="#1E5BFF" stroke="${INK}" stroke-width="3.4" stroke-linejoin="round"/>
  <path d="M11.5 16 A6 6 0 0 1 18 10.8" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round" opacity=".85"/>
</svg>`;

export const snowflakeSVG =`<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round">
  <path d="M12 2.5v19M3.8 7.25l16.4 9.5M3.8 16.75l16.4-9.5M9.5 4.2 12 6.7l2.5-2.5M9.5 19.8 12 17.3l2.5 2.5"/>
</svg>`;

export const trophySVG = `<svg viewBox="0 0 24 24" aria-hidden="true">
  <path d="M7 3.5h10v4.2a5 5 0 0 1-10 0zM7 5H3.8v1.6A3.6 3.6 0 0 0 7.4 10.2M17 5h3.2v1.6a3.6 3.6 0 0 1-3.6 3.6M12 12.7v3.8M8 20.5h8l-1-4H9z"
   fill="#C0FF3F" stroke="#070D36" stroke-width="2" stroke-linejoin="round"/>
</svg>`;
