const DAY_MS = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const KINDS = new Map([
  ["once", "once"],
  ["daily", "daily"],
  ["every", "every"],
  ["every-n", "every"],
  ["every_n", "every"],
  ["everyN", "every"],
  ["interval", "every"],
  ["weekly", "weekly"],
  ["monthly", "monthly"],
]);

export function parseDate(value) {
  if (typeof value !== "string" || !ISO_DATE.test(value)) throw new Error("Invalid date");
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (formatDate(date) !== value) throw new Error("Invalid date");
  return date;
}

export function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

export function addDays(value, days) {
  const date = parseDate(value);
  if (!Number.isInteger(days)) throw new Error("Invalid day interval");
  date.setUTCDate(date.getUTCDate() + days);
  return formatDate(date);
}

export function daysBetween(from, to) {
  return Math.round((parseDate(to) - parseDate(from)) / DAY_MS);
}

export function weekdayBit(value) {
  return 1 << parseDate(value).getUTCDay();
}

export function rotateWeekdays(mask, days) {
  if (!Number.isInteger(mask) || mask < 0 || mask > 0b1111111) throw new Error("Invalid weekday mask");
  const offset = ((days % 7) + 7) % 7;
  let result = mask;
  for (let index = 0; index < offset; index += 1) {
    result = ((result << 1) & 0b1111111) | ((result >> 6) & 1);
  }
  return result;
}

function lastDay(year, monthIndex) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

export function shiftSeries(chore, days) {
  if (!Number.isInteger(days) || days < 1) return { ...chore };
  const nextDue = addDays(chore.next_due, days);
  const anchorDate = addDays(chore.anchor_date, days);
  const shifted = {
    ...chore,
    next_due: nextDue,
    anchor_date: anchorDate,
    missed_count: (chore.missed_count || 0) + days,
  };
  if (chore.schedule_kind === "weekly") shifted.weekdays_mask = rotateWeekdays(chore.weekdays_mask, days);
  if (chore.schedule_kind === "monthly") shifted.month_day = parseDate(anchorDate).getUTCDate();
  return shifted;
}

function weekStart(value) {
  const date = typeof value === "string" ? parseDate(value) : new Date(value);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date;
}

export function nextOccurrence(chore) {
  const interval = Math.max(1, chore.schedule_interval || 1);
  if (chore.schedule_kind === "once") return null;
  if (chore.schedule_kind === "daily" || chore.schedule_kind === "every") {
    return addDays(chore.next_due, interval);
  }
  if (chore.schedule_kind === "weekly") {
    const anchorWeek = weekStart(chore.anchor_date);
    for (let offset = 1; offset <= interval * 14 + 7; offset += 1) {
      const candidateValue = addDays(chore.next_due, offset);
      const candidate = parseDate(candidateValue);
      const weeks = Math.floor((weekStart(candidate) - anchorWeek) / (7 * DAY_MS));
      if (weeks >= 0 && weeks % interval === 0 && (chore.weekdays_mask & (1 << candidate.getUTCDay()))) {
        return candidateValue;
      }
    }
    throw new Error("Could not calculate weekly occurrence");
  }
  if (chore.schedule_kind === "monthly") {
    const current = parseDate(chore.next_due);
    const target = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + interval, 1));
    const monthDay = chore.month_day || current.getUTCDate();
    target.setUTCDate(Math.min(monthDay, lastDay(target.getUTCFullYear(), target.getUTCMonth())));
    return formatDate(target);
  }
  throw new Error("Unknown schedule");
}

export function normalizeSchedule(input = {}) {
  const kind = KINDS.get(input.kind);
  if (!kind) throw new Error("Choose a valid schedule");
  const interval = kind === "once" ? 1 : Number(input.interval ?? 1);
  if (!Number.isInteger(interval) || interval < 1 || interval > 365) {
    throw new Error("Interval must be between 1 and 365");
  }
  const nextDue = input.nextDue;
  parseDate(nextDue);
  const anchorDate = input.anchorDate ?? nextDue;
  parseDate(anchorDate);

  let weekdaysMask = 0;
  if (kind === "weekly") {
    if (input.weekdays != null && !Array.isArray(input.weekdays)) throw new Error("Invalid weekdays");
    const weekdays = input.weekdays ?? [parseDate(nextDue).getUTCDay()];
    if (weekdays.length < 1 || weekdays.length > 7) throw new Error("Choose at least one weekday");
    for (const day of weekdays) {
      if (!Number.isInteger(day) || day < 0 || day > 6) throw new Error("Invalid weekday");
      weekdaysMask |= 1 << day;
    }
    if (!(weekdaysMask & weekdayBit(nextDue))) throw new Error("Due date must match a selected weekday");
    const weeks = (weekStart(nextDue) - weekStart(anchorDate)) / (7 * DAY_MS);
    if (weeks < 0 || weeks % interval !== 0) throw new Error("Due date must match the weekly interval");
  }

  let monthDay = null;
  if (kind === "monthly") {
    monthDay = input.monthDay == null ? parseDate(anchorDate).getUTCDate() : Number(input.monthDay);
    if (!Number.isInteger(monthDay) || monthDay < 1 || monthDay > 31) throw new Error("Invalid month day");
  }

  return {
    schedule_kind: kind,
    schedule_interval: interval,
    weekdays_mask: weekdaysMask,
    month_day: monthDay,
    anchor_date: anchorDate,
    next_due: nextDue,
  };
}

export function localDateTime(timeZone, date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return { date: `${values.year}-${values.month}-${values.day}`, time: `${values.hour}:${values.minute}` };
}
