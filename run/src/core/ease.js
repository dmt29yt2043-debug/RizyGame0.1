// Изинги bible 2.0 (аналитические приближения cubic-bezier) — чистые функции, без аллокаций.
export const clamp01 = t => t < 0 ? 0 : t > 1 ? 1 : t;
export const easeOutQuad = t => { t = clamp01(t); return 1 - (1 - t) * (1 - t); };
export const easeInQuad = t => { t = clamp01(t); return t * t; };
export const easeOutCubic = t => { t = clamp01(t); const u = 1 - t; return 1 - u * u * u; };
export const easeInCubic = t => { t = clamp01(t); return t * t * t; };
export const easeInOutCubic = t => { t = clamp01(t); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
export const easeOutExpo = t => { t = clamp01(t); return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t); };
// easeOutBack с перелётом 1.70158 (≈ cubic-bezier(.34,1.56,.64,1))
export const easeOutBack = t => { t = clamp01(t); const c1 = 1.70158, c3 = c1 + 1, u = t - 1; return 1 + c3 * u * u * u + c1 * u * u; };
export const easeInOutSine = t => { t = clamp01(t); return -(Math.cos(Math.PI * t) - 1) / 2; };
