const test = require("node:test");
const assert = require("node:assert/strict");
const { NotificationManager } = require("../src/notifications");

function makeBus(overrides = {}) {
  return {
    vehicleNumber: "3001",
    distanceFromRouteMeters: 10,
    hasPassedStop: false,
    distanceToStopMeters: 1500,
    movingTowardStop: false,
    etaMinutes: null,
    ...overrides,
  };
}

function makeManager() {
  const manager = new NotificationManager();
  const sent = [];

  manager.sendToAll = async (payload) => {
    sent.push(payload);
  };

  return { manager, sent };
}

test("alerts immediately on first valid detection without an ETA", async () => {
  const { manager, sent } = makeManager();

  await manager.checkBuses([makeBus()]);

  assert.equal(sent.length, 1);
  assert.match(sent[0].title, /ΕΚΚΛΗΣΙΑ/);
  assert.match(sent[0].body, /3001/);
  assert.match(sent[0].body, /1500 m/);
});

test("alerts even when ETA is invalid or outside the old alert window", async () => {
  for (const etaMinutes of [16.1, Number.NaN, -1]) {
    const { manager, sent } = makeManager();

    await manager.checkBuses([makeBus({ etaMinutes })]);

    assert.equal(sent.length, 1);
  }
});

test("does not require movement history for the first alert", async () => {
  const { manager, sent } = makeManager();

  await manager.checkBuses([
    makeBus({ movingTowardStop: false, etaMinutes: null }),
  ]);

  assert.equal(sent.length, 1);
});

test("does not repeatedly alert for the same approach", async () => {
  const { manager, sent } = makeManager();
  const bus = makeBus();

  await manager.checkBuses([bus]);
  await manager.checkBuses([bus]);

  assert.equal(sent.length, 1);
});

test("does not re-alert immediately after a bus temporarily disappears", async () => {
  const { manager, sent } = makeManager();
  const bus = makeBus();

  await manager.checkBuses([bus]);
  await manager.checkBuses([]);
  await manager.checkBuses([bus]);

  assert.equal(sent.length, 1);
});

test("re-arms after the bus is observed past the stop", async () => {
  const { manager, sent } = makeManager();

  await manager.checkBuses([makeBus()]);

  await manager.checkBuses([
    makeBus({
      hasPassedStop: true,
      distanceToStopMeters: null,
    }),
  ]);

  await manager.checkBuses([makeBus()]);

  assert.equal(sent.length, 2);
});

test("does not alert when the bus is too far from its route", async () => {
  const { manager, sent } = makeManager();

  await manager.checkBuses([
    makeBus({ distanceFromRouteMeters: 81 }),
  ]);

  assert.equal(sent.length, 0);
});

test("does not alert when the bus has passed the stop", async () => {
  const { manager, sent } = makeManager();

  await manager.checkBuses([
    makeBus({
      hasPassedStop: true,
      distanceToStopMeters: null,
    }),
  ]);

  assert.equal(sent.length, 0);
});

test("does not alert when the remaining distance is invalid", async () => {
  const { manager, sent } = makeManager();

  await manager.checkBuses([
    makeBus({ distanceToStopMeters: null }),
  ]);

  assert.equal(sent.length, 0);
});
