import type { SizeUnit } from '../state';

export const MM_PER_IN = 25.4;

export function toMm(value: number, unit: SizeUnit, dpi: number): number {
  if (unit === 'mm') return value;
  if (unit === 'in') return value * MM_PER_IN;
  return (value / dpi) * MM_PER_IN;
}

export function toPx(value: number, unit: SizeUnit, dpi: number): number {
  if (unit === 'px') return Math.max(1, Math.round(value));
  return Math.max(1, Math.round((toMm(value, unit, dpi) / MM_PER_IN) * dpi));
}

export function pxToMm(px: number, dpi: number): number {
  return (px / dpi) * MM_PER_IN;
}

export function formatMm(mm: number): string {
  return mm >= 100 ? `${mm.toFixed(0)} mm` : `${mm.toFixed(1)} mm`;
}

/** Hard cap so a typo like 4000 mm at 1200 dpi doesn't freeze the tab. */
export const MAX_PX = 12000;

export function clampPx(px: number): number {
  return Math.min(MAX_PX, Math.max(16, Math.round(px)));
}
