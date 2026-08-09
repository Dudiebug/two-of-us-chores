import test from "node:test";
import assert from "node:assert/strict";
import {
  addDays,
  daysBetween,
  nextOccurrence,
  normalizeSchedule,
  shiftSeries,
} from "../src/recurrence.mjs";

test("daily and every-N recurrence advance by the configured days", () => {
  assert.equal(addDays("2024-02-28", 1), "2024-02-29");
  assert.equal(daysBetween("2024-02-28", "2024-03-02"), 3);
  assert.equal(nextOccurrence({ schedule_kind: "daily", schedule_interval: 1, next_due: "2024-02-29" }), "2024-03-01");
  assert.equal(nextOccurrence({ schedule_kind: "every", schedule_interval: 3, next_due: "2024-03-01" }), "2024-03-04");
  assert.equal(normalizeSchedule({ kind: "every-n", interval: 4, nextDue: "2024-03-01" }).schedule_kind, "every");
});

test("weekly recurrence respects selected weekdays and week interval", () => {
  const monday = { schedule_kind: "weekly", schedule_interval: 2, next_due: "2024-01-01", anchor_date: "2024-01-01", weekdays_mask: (1 << 1) | (1 << 3) };
  assert.equal(nextOccurrence(monday), "2024-01-03");
  assert.equal(nextOccurrence({ ...monday, next_due: "2024-01-03" }), "2024-01-15");
  const schedule = normalizeSchedule({ kind: "weekly", interval: 1, nextDue: "2024-01-03", weekdays: [3, 5] });
  assert.equal(schedule.weekdays_mask, (1 << 3) | (1 << 5));
  assert.throws(() => normalizeSchedule({
    kind: "weekly", interval: 2, nextDue: "2024-01-08", anchorDate: "2024-01-01", weekdays: [1],
  }), /weekly interval/);
});

test("monthly recurrence retains its anchor through leap and short months", () => {
  const monthly = { schedule_kind: "monthly", schedule_interval: 1, next_due: "2024-01-31", month_day: 31 };
  assert.equal(nextOccurrence(monthly), "2024-02-29");
  assert.equal(nextOccurrence({ ...monthly, next_due: "2024-02-29" }), "2024-03-31");
  assert.equal(nextOccurrence({ ...monthly, next_due: "2023-01-31" }), "2023-02-28");
});

test("missed rollover shifts the entire series once for all late days", () => {
  const weekly = {
    schedule_kind: "weekly",
    schedule_interval: 1,
    next_due: "2024-06-03",
    anchor_date: "2024-06-03",
    weekdays_mask: 1 << 1,
    missed_count: 0,
  };
  const shifted = shiftSeries(weekly, 3);
  assert.equal(shifted.next_due, "2024-06-06");
  assert.equal(shifted.anchor_date, "2024-06-06");
  assert.equal(shifted.weekdays_mask, 1 << 4);
  assert.equal(shifted.missed_count, 3);

  const monthly = shiftSeries({ ...weekly, schedule_kind: "monthly", next_due: "2024-01-31", anchor_date: "2024-01-31", month_day: 31 }, 2);
  assert.equal(monthly.next_due, "2024-02-02");
  assert.equal(monthly.month_day, 2);
});
