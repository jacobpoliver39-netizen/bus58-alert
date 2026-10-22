const test = require("node:test");
const assert = require("node:assert/strict");
const { BusTracker } = require("../src/tracker");

function makeTracker() {
  const oasth = {
    getLiveSnapshot: async () => ({
      fetchedAt: new Date().toISOString(),
      targetStop: {
        StopID: "1221",
        StopLat: 40.6,
        StopLng: 22.908,
      },
      buses: [],
    }),
    getRouteData: async () => ({
      details: [
        { routed_y: 40.6, routed_x: 22.9, routed_order: 0 },
        { routed_y: 40.6, routed_x: 22.91, routed_order: 1 },
      ],
    }),
  };

  return new BusTracker(oasth);
}

test("tracker starts with no calculated data", () => {
  const tracker = makeTracker();

  assert.equal(tracker.getStatus().running, false);
  assert.equal(tracker.getStatus().data, null);
});

test("refresh handles an empty live bus list", async () => {
  const tracker = makeTracker();

  await tracker.refresh();

  const status = tracker.getStatus();
  assert.equal(status.lastError, null);
  assert.ok(status.data);
  assert.deepEqual(status.data.buses, []);
});

test("refresh reports errors without crashing", async () => {
  const tracker = makeTracker();
  tracker.oasth.getLiveSnapshot = async () => {
    throw new Error("test API failure");
  };

  await tracker.refresh();

  assert.equal(tracker.getStatus().lastError, "test API failure");
});

test("calculates speed and ETA from successive bus observations", async (t) => {
  const tracker = makeTracker();

  let currentTime = 1_800_000_000_000;
  const originalNow = Date.now;
  Date.now = () => currentTime;

  t.after(() => {
    Date.now = originalNow;
  });

  let longitude = 22.904;

  tracker.oasth.getLiveSnapshot = async () => ({
    fetchedAt: new Date(currentTime).toISOString(),
    targetStop: {
      StopID: "1221",
      StopLat: 40.6,
      StopLng: 22.908,
    },
    buses: [{
      VEH_NO: "3001",
      CS_LAT: 40.6,
      CS_LNG: longitude,
      CS_DATE: new Date(currentTime).toISOString(),
    }],
  });

  await tracker.refresh();

  currentTime += 30_000;
  longitude = 22.9045;
  await tracker.refresh();

  const [bus] = tracker.getStatus().data.buses;

  assert.equal(bus.vehicleNumber, "3001");
  assert.equal(bus.movingTowardStop, true);
  assert.ok(bus.speedKmh > 1);
  assert.ok(bus.etaMinutes > 0);
  assert.equal(bus.status, "estimated");
});

test("updates speed and ETA when the bus accelerates", async (t) => {
  const tracker = makeTracker();

  let currentTime = 1_800_000_100_000;
  const originalNow = Date.now;
  Date.now = () => currentTime;

  t.after(() => {
    Date.now = originalNow;
  });

  let longitude = 22.904;

  tracker.oasth.getLiveSnapshot = async () => ({
    fetchedAt: new Date(currentTime).toISOString(),
    targetStop: {
      StopID: "1221",
      StopLat: 40.6,
      StopLng: 22.908,
    },
    buses: [{
      VEH_NO: "3002",
      CS_LAT: 40.6,
      CS_LNG: longitude,
      CS_DATE: new Date(currentTime).toISOString(),
    }],
  });

  await tracker.refresh();

  currentTime += 30_000;
  longitude = 22.9045;
  await tracker.refresh();

  const [beforeAcceleration] = tracker.getStatus().data.buses;
  assert.equal(beforeAcceleration.status, "estimated");

  currentTime += 30_000;
  longitude = 22.9055;
  await tracker.refresh();

  const [afterAcceleration] = tracker.getStatus().data.buses;

  assert.ok(
    afterAcceleration.speedKmh > beforeAcceleration.speedKmh,
    `Expected speed to rise from ${beforeAcceleration.speedKmh} to ${afterAcceleration.speedKmh} km/h`
  );
  assert.ok(afterAcceleration.etaMinutes > 0);
});

test("raises ETA when the bus slows down", async (t) => {
  const tracker = makeTracker();

  let currentTime = 1_800_000_200_000;
  const originalNow = Date.now;
  Date.now = () => currentTime;

  t.after(() => {
    Date.now = originalNow;
  });

  let longitude = 22.904;

  tracker.oasth.getLiveSnapshot = async () => ({
    fetchedAt: new Date(currentTime).toISOString(),
    targetStop: {
      StopID: "1221",
      StopLat: 40.6,
      StopLng: 22.908,
    },
    buses: [{
      VEH_NO: "3003",
      CS_LAT: 40.6,
      CS_LNG: longitude,
      CS_DATE: new Date(currentTime).toISOString(),
    }],
  });

  await tracker.refresh();

  currentTime += 30_000;
  longitude = 22.905;
  await tracker.refresh();

  const [beforeSlowdown] = tracker.getStatus().data.buses;
  assert.equal(beforeSlowdown.status, "estimated");

  currentTime += 30_000;
  longitude = 22.9052;
  await tracker.refresh();

  const [afterSlowdown] = tracker.getStatus().data.buses;

  assert.ok(
    afterSlowdown.etaMinutes > beforeSlowdown.etaMinutes,
    `Expected ETA to rise from ${beforeSlowdown.etaMinutes} to ${afterSlowdown.etaMinutes} minutes`
  );
});
