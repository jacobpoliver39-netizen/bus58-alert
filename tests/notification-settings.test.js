const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  NotificationSettings,
} = require("../src/notification-settings");

function makeSettings(t) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "bus58-settings-")
  );
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  return new NotificationSettings(
    path.join(directory, "notification-settings.json")
  );
}

test("defaults to weekdays from 07:00 to 09:00 Athens time", (t) => {
  const settings = makeSettings(t);
  const current = settings.get();

  assert.equal(current.notificationsEnabled, true);
  assert.equal(current.scheduleEnabled, true);
  assert.equal(current.startTime, "07:00");
  assert.equal(current.endTime, "09:00");
  assert.deepEqual(current.weekdays, [1, 2, 3, 4, 5]);
  assert.equal(current.timeZone, "Europe/Athens");
});

test("allows a weekday inside the configured time window", (t) => {
  const settings = makeSettings(t);

  // Monday, 07:30 in Athens during winter.
  assert.equal(
    settings.isAllowedAt(new Date("2026-01-05T05:30:00Z")),
    true
  );
});

test("rejects times before the start and at the end boundary", (t) => {
  const settings = makeSettings(t);

  // Monday, 06:59 and 09:00 in Athens during winter.
  assert.equal(
    settings.isAllowedAt(new Date("2026-01-05T04:59:00Z")),
    false
  );
  assert.equal(
    settings.isAllowedAt(new Date("2026-01-05T07:00:00Z")),
    false
  );
});

test("rejects weekends", (t) => {
  const settings = makeSettings(t);

  // Saturday, 08:00 in Athens during winter.
  assert.equal(
    settings.isAllowedAt(new Date("2026-01-10T06:00:00Z")),
    false
  );
});

test("master switch overrides the schedule", (t) => {
  const settings = makeSettings(t);
  settings.update({ notificationsEnabled: false });

  // Monday, 08:00 in Athens.
  assert.equal(
    settings.isAllowedAt(new Date("2026-01-05T06:00:00Z")),
    false
  );
});

test("disabling the schedule permits alerts at any time", (t) => {
  const settings = makeSettings(t);
  settings.update({ scheduleEnabled: false });

  // Sunday, 02:00 in Athens.
  assert.equal(
    settings.isAllowedAt(new Date("2026-01-10T00:00:00Z")),
    true
  );
});

test("persists updated settings when reloaded", (t) => {
  const settings = makeSettings(t);

  settings.update({
    notificationsEnabled: true,
    scheduleEnabled: true,
    startTime: "08:15",
    endTime: "10:30",
    weekdays: [1, 3, 5],
  });

  const reloaded = new NotificationSettings(settings.file);

  assert.equal(reloaded.get().startTime, "08:15");
  assert.equal(reloaded.get().endTime, "10:30");
  assert.deepEqual(reloaded.get().weekdays, [1, 3, 5]);
});
