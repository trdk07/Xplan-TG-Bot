const DAY_MS = 24 * 60 * 60 * 1000;

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
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
