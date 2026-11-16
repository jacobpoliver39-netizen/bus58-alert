const test = require("node:test");
const assert = require("node:assert/strict");
const { NotificationManager } = require("../src/notifications");
const { normalizeSettings } = require("../src/notification-settings");

const ALWAYS = { scheduleEnabled: false, leadMinutes: 10 };

function makeDevice(id, overrides = {}) {
  return {
    id,
    subscription: { endpoint: `https://fcm.googleapis.com/${id}` },
    direction: "outbound",
    stopId: "1221",
    ...overrides,
    settings: normalizeSettings({ ...ALWAYS, ...overrides.settings }),
  };
}

function makeBus(overrides = {}) {
  return {
    vehicleNumber: "3001",
    approaching: true,
    hasPassedStop: false,
    distanceToStopMeters: 1500,
    etaMinutes: 6,
    ...overrides,
  };
}

// `buses` maps "direction:stopId" to the buses seen from that stop.
function makeSetup(deviceList, buses) {
  const devices = new Map(deviceList.map((device) => [device.id, device]));
  const store = {
    all: () => [...devices.values()],
    remove: (id) => devices.delete(id),
  };
  const tracker = {
    getStopStatus: (direction, stopId) => {
      const list = buses[`${direction}:${stopId}`];
      return list
        ? { stop: { id: stopId, name: `Stop ${stopId}` }, buses: list }
        : null;
    },
  };

  const manager = new NotificationManager(store);
  const sent = [];
  manager.send = async (device, payload) => {
    sent.push({ id: device.id, payload });
    return true;
  };

  return { manager, tracker, sent, devices, buses };
}

test("alerts a device when a bus is within its lead time", async () => {
  const { manager, tracker, sent } = makeSetup(
    [makeDevice("a")],
    { "outbound:1221": [makeBus()] }
  );

  await manager.checkAll(tracker);

  assert.equal(sent.length, 1);
  assert.match(sent[0].payload.title, /6 min to Stop 1221/);
  assert.match(sent[0].payload.body, /3001/);
  assert.match(sent[0].payload.body, /1500 m/);
});

test("waits until the bus is inside the lead time", async () => {
  const setup = makeSetup(
    [makeDevice("a")],
    { "outbound:1221": [makeBus({ etaMinutes: 14 })] }
  );

  await setup.manager.checkAll(setup.tracker);
  assert.equal(setup.sent.length, 0);

  setup.buses["outbound:1221"] = [makeBus({ etaMinutes: 9.5 })];
  await setup.manager.checkAll(setup.tracker);
  assert.equal(setup.sent.length, 1);
});

test("each device uses its own stop, direction and lead time", async () => {
  const { manager, tracker, sent } = makeSetup(
    [
      makeDevice("near"),
      makeDevice("patient", { settings: { leadMinutes: 5 } }),
      makeDevice("other-stop", { stopId: "1259" }),
      makeDevice("other-way", { direction: "inbound", stopId: "1260" }),
    ],
    {
      "outbound:1221": [makeBus({ etaMinutes: 8 })],
      "outbound:1259": [makeBus({ etaMinutes: 20 })],
      "inbound:1260": [makeBus({ vehicleNumber: "3002", etaMinutes: 2 })],
    }
  );

  await manager.checkAll(tracker);

  assert.deepEqual(sent.map((item) => item.id).sort(), ["near", "other-way"]);
});

test("one device's schedule does not affect another device", async () => {
  // Monday, 12:00 in Athens: outside the default 07:00-09:00 window.
  const now = new Date("2026-01-05T10:00:00Z");
  const { manager, tracker, sent } = makeSetup(
    [
      makeDevice("mornings", { settings: { scheduleEnabled: true } }),
      makeDevice("always"),
      makeDevice("off", { settings: { notificationsEnabled: false } }),
    ],
    { "outbound:1221": [makeBus()] }
  );

  await manager.checkAll(tracker, now);

  assert.deepEqual(sent.map((item) => item.id), ["always"]);
});

test("an alert held back by the schedule fires when the window opens", async () => {
  const { manager, tracker, sent } = makeSetup(
    [makeDevice("mornings", { settings: { scheduleEnabled: true } })],
    { "outbound:1221": [makeBus()] }
  );

  // Monday, 06:59 then 07:00 in Athens.
  await manager.checkAll(tracker, new Date("2026-01-05T04:59:00Z"));
  assert.equal(sent.length, 0);

  await manager.checkAll(tracker, new Date("2026-01-05T05:00:00Z"));
  assert.equal(sent.length, 1);
});

test("alerts once per bus until it passes the stop", async () => {
  const setup = makeSetup(
    [makeDevice("a")],
    { "outbound:1221": [makeBus()] }
  );

  await setup.manager.checkAll(setup.tracker);
  await setup.manager.checkAll(setup.tracker);
  assert.equal(setup.sent.length, 1);

  setup.buses["outbound:1221"] = [
    makeBus({ approaching: false, hasPassedStop: true, etaMinutes: null }),
  ];
  await setup.manager.checkAll(setup.tracker);

  setup.buses["outbound:1221"] = [makeBus()];
  await setup.manager.checkAll(setup.tracker);
  assert.equal(setup.sent.length, 2);
});

test("re-arms a bus that vanished from the feed for a long time", async () => {
  const setup = makeSetup(
    [makeDevice("a")],
    { "outbound:1221": [makeBus()] }
  );
  const start = new Date("2026-01-05T06:00:00Z");

  await setup.manager.checkAll(setup.tracker, start);

  // A short gap in the feed must not cause a second alert.
  setup.buses["outbound:1221"] = [];
  await setup.manager.checkAll(
    setup.tracker,
    new Date(start.getTime() + 60_000)
  );
  setup.buses["outbound:1221"] = [makeBus()];
  await setup.manager.checkAll(
    setup.tracker,
    new Date(start.getTime() + 120_000)
  );
  assert.equal(setup.sent.length, 1);

  // Gone for over 15 minutes, then back on a new trip.
  setup.buses["outbound:1221"] = [];
  await setup.manager.checkAll(
    setup.tracker,
    new Date(start.getTime() + 20 * 60_000)
  );
  setup.buses["outbound:1221"] = [makeBus()];
  await setup.manager.checkAll(
    setup.tracker,
    new Date(start.getTime() + 21 * 60_000)
  );
  assert.equal(setup.sent.length, 2);
});

test("removes a device whose subscription has expired", async () => {
  const setup = makeSetup(
    [makeDevice("gone"), makeDevice("fine")],
    { "outbound:1221": [makeBus()] }
  );
  setup.manager.send = async (device) => device.id !== "gone";

  await setup.manager.checkAll(setup.tracker);

  assert.deepEqual([...setup.devices.keys()], ["fine"]);
});

test("skips devices whose stop has no data", async () => {
  const { manager, tracker, sent } = makeSetup(
    [makeDevice("a", { stopId: "9999" })],
    { "outbound:1221": [makeBus()] }
  );

  await manager.checkAll(tracker);

  assert.equal(sent.length, 0);
});
