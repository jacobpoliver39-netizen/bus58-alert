const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeSettings,
  isAllowedAt,
} = require("../src/notification-settings");

test("defaults to weekdays from 07:00 to 09:00 Athens time, 10 min lead", () => {
  const current = normalizeSettings();

  assert.equal(current.notificationsEnabled, true);
  assert.equal(current.scheduleEnabled, true);
  assert.equal(current.startTime, "07:00");
  assert.equal(current.endTime, "09:00");
  assert.deepEqual(current.weekdays, [1, 2, 3, 4, 5]);
  assert.equal(current.leadMinutes, 10);
  assert.equal(current.timeZone, "Europe/Athens");
});

test("keeps valid fields and replaces invalid ones with defaults", () => {
  const current = normalizeSettings({
    startTime: "08:15",
    endTime: "25:00",
    weekdays: [5, 1, 1, 9, "2"],
    leadMinutes: 20,
    timeZone: "America/New_York",
  });

  assert.equal(current.startTime, "08:15");
  assert.equal(current.endTime, "09:00");
  assert.deepEqual(current.weekdays, [1, 5]);
  assert.equal(current.leadMinutes, 20);
  assert.equal(current.timeZone, "Europe/Athens");

  for (const leadMinutes of [0, 121, 7.5, "15", null]) {
    assert.equal(normalizeSettings({ leadMinutes }).leadMinutes, 10);
  }

  assert.equal(normalizeSettings(null).leadMinutes, 10);
});

test("allows a weekday inside the configured time window", () => {
  // Monday, 07:30 in Athens during winter.
  assert.equal(
    isAllowedAt(normalizeSettings(), new Date("2026-01-05T05:30:00Z")),
    true
  );
});

test("rejects times before the start and at the end boundary", () => {
  const settings = normalizeSettings();

  // Monday, 06:59 and 09:00 in Athens during winter.
  assert.equal(isAllowedAt(settings, new Date("2026-01-05T04:59:00Z")), false);
  assert.equal(isAllowedAt(settings, new Date("2026-01-05T07:00:00Z")), false);
});

test("rejects weekends", () => {
  // Saturday, 08:00 in Athens during winter.
  assert.equal(
    isAllowedAt(normalizeSettings(), new Date("2026-01-10T06:00:00Z")),
    false
  );
});

test("master switch overrides the schedule", () => {
  // Monday, 08:00 in Athens.
  assert.equal(
    isAllowedAt(
      normalizeSettings({ notificationsEnabled: false }),
      new Date("2026-01-05T06:00:00Z")
    ),
    false
  );
});

test("disabling the schedule permits alerts at any time", () => {
  // Saturday, 02:00 in Athens.
  assert.equal(
    isAllowedAt(
      normalizeSettings({ scheduleEnabled: false }),
      new Date("2026-01-10T00:00:00Z")
    ),
    true
  );
});

test("a window crossing midnight is active on both sides of it", () => {
  const settings = normalizeSettings({
    startTime: "22:00",
    endTime: "02:00",
    weekdays: [0, 1, 2, 3, 4, 5, 6],
  });

  // 23:00, 01:00 and 12:00 in Athens during winter.
  assert.equal(isAllowedAt(settings, new Date("2026-01-05T21:00:00Z")), true);
  assert.equal(isAllowedAt(settings, new Date("2026-01-05T23:00:00Z")), true);
  assert.equal(isAllowedAt(settings, new Date("2026-01-05T10:00:00Z")), false);
});
