import assert from "node:assert/strict";
import test from "node:test";
import { occurrencesInRange } from "../public/calendar-recurrence.js";

test("calendar projects daily and every-N chores from their next due date", () => {
  assert.deepEqual(occurrencesInRange({ scheduleKind: "daily", scheduleInterval: 1, nextDue: "2026-08-29" }, "2026-08-29", "2026-09-02"), ["2026-08-29", "2026-08-30", "2026-08-31", "2026-09-01", "2026-09-02"]);
  assert.deepEqual(occurrencesInRange({ scheduleKind: "every", scheduleInterval: 3, nextDue: "2026-08-29" }, "2026-08-29", "2026-09-05"), ["2026-08-29", "2026-09-01", "2026-09-04"]);
});

test("calendar projects weekly selections and monthly clamped anchors", () => {
  assert.deepEqual(occurrencesInRange({ scheduleKind: "weekly", scheduleInterval: 2, nextDue: "2026-08-03", anchorDate: "2026-08-03", weekdaysMask: (1 << 1) | (1 << 3) }, "2026-08-01", "2026-08-31"), ["2026-08-03", "2026-08-05", "2026-08-17", "2026-08-19", "2026-08-31"]);
  assert.deepEqual(occurrencesInRange({ scheduleKind: "monthly", scheduleInterval: 1, nextDue: "2026-01-31", monthDay: 31 }, "2026-02-01", "2026-03-31"), ["2026-02-28", "2026-03-31"]);
  assert.deepEqual(occurrencesInRange({ scheduleKind: "monthly", scheduleInterval: 1, nextDue: "2024-01-15", monthDay: 31 }, "2024-01-15", "2024-03-31"), ["2024-01-15", "2024-02-29", "2024-03-31"]);
});
