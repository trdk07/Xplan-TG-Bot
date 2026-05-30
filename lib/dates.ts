const DAY_MS = 24 * 60 * 60 * 1000;

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

export function addMonths(date: Date, months: number): Date {
  const result = new Date(date.getTime());
  const originalDay = result.getUTCDate();

  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);

  const lastDayOfTargetMonth = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(originalDay, lastDayOfTargetMonth));

  return result;
}

export function renewalBaseDate(
  currentDueAt: string | null | undefined,
  now = new Date(),
): Date {
  if (!currentDueAt) return new Date(now.getTime());
  const currentDueDate = new Date(currentDueAt);
  return currentDueDate.getTime() > now.getTime()
    ? currentDueDate
    : new Date(now.getTime());
}

export function isPast(date: string | null | undefined, now = new Date()): boolean {
  if (!date) return false;
  return new Date(date).getTime() <= now.getTime();
}

export function isoDateTime(date: Date): string {
  return date.toISOString();
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "-";
  return new Intl.DateTimeFormat("zh-TW", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Taipei",
  }).format(new Date(value));
}

export function daysUntil(value: string | null | undefined, now = new Date()): number | null {
  if (!value) return null;
  return Math.ceil((new Date(value).getTime() - now.getTime()) / DAY_MS);
}
