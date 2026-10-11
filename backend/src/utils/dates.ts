import { AppError } from './errors';

export const DAY_MS = 86_400_000;

/** Days are UTC calendar days, as 'YYYY-MM-DD'. (Shop-local timezones are a documented limitation.) */
export function parseDay(s: string): Date {
  const d = new Date(`${s}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) {
    throw new AppError(400, 'invalid_date', `Invalid date: ${s}`);
  }
  return d;
}

export const formatDay = (d: Date): string => d.toISOString().slice(0, 10);
export const addDays = (d: Date, n: number): Date => new Date(d.getTime() + n * DAY_MS);
export const diffDays = (from: Date, to: Date): number => Math.round((to.getTime() - from.getTime()) / DAY_MS);
export const todayUTC = (now: Date = new Date()): Date => parseDay(formatDay(now));

/** Inclusive range of UTC days. */
export function eachDay(start: Date, end: Date): Date[] {
  const out: Date[] = [];
  for (let d = start; d.getTime() <= end.getTime(); d = addDays(d, 1)) out.push(d);
  return out;
}
