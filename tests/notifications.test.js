
const test = require("node:test");
const assert = require("node:assert/strict");
const { NotificationManager } = require("../src/notifications");

function makeBus(overrides = {}) {
  return {
    vehicleNumber: "3001",
    distanceFromRouteMeters: 10,
    hasPassedStop: false,
    distanceToStopMeters: 1500,
    movingTowardStop: true,
    etaMinutes: 5,
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

test("alerts when a bus is moving toward the stop", async () => {
  const { manager, sent } = makeManager();

  await manager.checkBuses([makeBus()]);

  assert.equal(sent.length, 1);
  assert.match(sent[0].title, /approaching/);
  assert.match(sent[0].body, /3001/);
});

test("does not alert repeatedly for the same approach", async () => {
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

test("does not alert when the bus is not moving toward the stop", async () => {
  const { manager, sent } = makeManager();

  await manager.checkBuses([makeBus({ movingTowardStop: false })]);

  assert.equal(sent.length, 0);
});
test("re-arms after the bus is observed past the stop", async () => {
  const { manager, sent } = makeManager();

  await manager.checkBuses([makeBus()]);

  await manager.checkBuses([
    makeBus({
      hasPassedStop: true,
      distanceToStopMeters: null,
      movingTowardStop: false,
    }),
  ]);

  await manager.checkBuses([makeBus()]);

  assert.equal(sent.length, 2);
});
