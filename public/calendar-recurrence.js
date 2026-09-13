const DAY_MS = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseDate(value) {
  if (typeof value !== "string" || !ISO_DATE.test(value)) throw new Error("Invalid date");
  const [year, month, day] = value.split("-").map(Number);
  const result = new Date(Date.UTC(year, month - 1, day));
  if (formatDate(result) !== value) throw new Error("Invalid date");
  return result;
}

export function formatDate(value) {
  return value.toISOString().slice(0, 10);
}

export function addDays(value, days) {
  if (!Number.isInteger(days)) throw new Error("Invalid day interval");
  const result = parseDate(value);
  result.setUTCDate(result.getUTCDate() + days);
  return formatDate(result);
}

export function daysBetween(from, to) {
  return Math.round((parseDate(to) - parseDate(from)) / DAY_MS);
}

export function weekStart(value) {
  const result = typeof value === "string" ? parseDate(value) : new Date(value);
  result.setUTCDate(result.getUTCDate() - ((result.getUTCDay() + 6) % 7));
  return result;
}

export function occursOn(chore, value) {
  if (value < chore.nextDue) return false;
  const interval = Math.max(1, Number(chore.scheduleInterval) || 1);
  if (chore.scheduleKind === "once") return value === chore.nextDue;
  if (chore.scheduleKind === "daily" || chore.scheduleKind === "every") return daysBetween(chore.nextDue, value) % interval === 0;
  if (chore.scheduleKind === "weekly") {
    const weeks = Math.floor((weekStart(value) - weekStart(chore.anchorDate || chore.nextDue)) / (7 * DAY_MS));
    return weeks >= 0 && weeks % interval === 0 && Boolean(Number(chore.weekdaysMask) & (1 << parseDate(value).getUTCDay()));
  }
  if (chore.scheduleKind === "monthly") {
    const start = parseDate(chore.nextDue);
    const candidate = parseDate(value);
    const months = (candidate.getUTCFullYear() - start.getUTCFullYear()) * 12 + candidate.getUTCMonth() - start.getUTCMonth();
    if (months === 0) return value === chore.nextDue;
    const monthDay = Number(chore.monthDay) || start.getUTCDate();
    const lastDay = new Date(Date.UTC(candidate.getUTCFullYear(), candidate.getUTCMonth() + 1, 0)).getUTCDate();
    return months > 0 && months % interval === 0 && candidate.getUTCDate() === Math.min(monthDay, lastDay);
  }
  return false;
}

export function occurrencesInRange(chore, start, end) {
  const result = [];
  for (let cursor = parseDate(start); formatDate(cursor) <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const value = formatDate(cursor);
    if (occursOn(chore, value)) result.push(value);
  }
  return result;
}
