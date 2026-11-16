const test = require("node:test");
const assert = require("node:assert/strict");
const { BusTracker, METERS_PER_MINUTE } = require("../src/tracker");

// A straight west-to-east line about 845 m long with three stops.
function makeSnapshot(buses = []) {
  return {
    fetchedAt: new Date().toISOString(),
    headsign: "TEST",
    details: [
      { routed_y: 40.6, routed_x: 22.9, routed_order: 0 },
      { routed_y: 40.6, routed_x: 22.91, routed_order: 1 },
    ],
    stops: [
      { id: "1", name: "Start", latitude: 40.6, longitude: 22.9, sequence: 1 },
      { id: "2", name: "Middle", latitude: 40.6, longitude: 22.905, sequence: 2 },
      { id: "3", name: "End", latitude: 40.6, longitude: 22.91, sequence: 3 },
    ],
    buses: buses.map(([id, lng, lat = 40.6]) => ({
      VEH_NO: id,
      CS_LAT: lat,
      CS_LNG: lng,
      CS_DATE: "now",
    })),
  };
}

function makeTracker(feeds, onUpdate = null) {
  const clients = Object.fromEntries(
    Object.entries(feeds).map(([direction, feed]) => [
      direction,
      { getLiveSnapshot: async () => feed() },
    ])
  );

  return new BusTracker(clients, 30000, onUpdate);
}

test("starts with no data", () => {
  const tracker = makeTracker({ outbound: () => makeSnapshot() });

  assert.equal(tracker.isRunning(), false);
  assert.deepEqual(tracker.getRoutes(), []);
  assert.equal(tracker.getStopStatus("outbound", "2"), null);
});

test("lists the stops of every direction after a refresh", async () => {
  const tracker = makeTracker({
    outbound: () => makeSnapshot(),
    inbound: () => makeSnapshot(),
  });

  await tracker.refresh();

  const routes = tracker.getRoutes();
  assert.deepEqual(routes.map((route) => route.id), ["outbound", "inbound"]);
  assert.deepEqual(routes[0].stops.map((stop) => stop.name), [
    "Start",
    "Middle",
    "End",
  ]);
  assert.equal(tracker.hasStop("outbound", "2"), true);
  assert.equal(tracker.hasStop("outbound", "99"), false);
  assert.equal(tracker.getStopStatus("outbound", "99"), null);
});

test("reports distance and ETA relative to the requested stop", async () => {
  const tracker = makeTracker({
    outbound: () => makeSnapshot([["3001", 22.9025]]),
  });

  await tracker.refresh();

  const middle = tracker.getStopStatus("outbound", "2");
  const [bus] = middle.buses;

  assert.equal(middle.stop.name, "Middle");
  assert.equal(bus.approaching, true);
  assert.equal(bus.hasPassedStop, false);
  assert.ok(bus.distanceToStopMeters > 200 && bus.distanceToStopMeters < 220);
  assert.equal(
    bus.etaMinutes,
    Math.round((bus.distanceToStopMeters / METERS_PER_MINUTE) * 10) / 10
  );

  // The same bus has already passed the first stop.
  const [passed] = tracker.getStopStatus("outbound", "1").buses;
  assert.equal(passed.hasPassedStop, true);
  assert.equal(passed.approaching, false);
  assert.equal(passed.distanceToStopMeters, null);
  assert.equal(passed.etaMinutes, null);

  // And is further from the last stop than from the middle one.
  const [far] = tracker.getStopStatus("outbound", "3").buses;
  assert.ok(far.etaMinutes > bus.etaMinutes);
});

test("a bus far from the route is not approaching", async () => {
  const tracker = makeTracker({
    outbound: () => makeSnapshot([["3001", 22.9025, 40.61]]),
  });

  await tracker.refresh();

  const [bus] = tracker.getStopStatus("outbound", "2").buses;
  assert.equal(bus.approaching, false);
  assert.equal(bus.etaMinutes, null);
});

test("measures speed from successive observations", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });

  let lng = 22.9;
  const tracker = makeTracker({
    outbound: () => makeSnapshot([["3001", lng]]),
  });

  await tracker.refresh();
  assert.equal(tracker.getStopStatus("outbound", "3").buses[0].speedKmh, null);

  // About 211 m in 30 s is roughly 25 km/h.
  t.mock.timers.tick(30000);
  lng = 22.9025;
  await tracker.refresh();

  const speed = tracker.getStopStatus("outbound", "3").buses[0].speedKmh;
  assert.ok(speed > 24 && speed < 27, `unexpected speed ${speed}`);
});

test("one direction failing does not hide the other", async () => {
  let fail = false;
  const tracker = makeTracker({
    outbound: () => makeSnapshot([["3001", 22.9025]]),
    inbound: () => {
      if (fail) throw new Error("feed down");
      return makeSnapshot();
    },
  });

  await tracker.refresh();
  fail = true;
  await tracker.refresh();

  assert.equal(tracker.getStopStatus("outbound", "2").lastError, null);
  // The last good inbound data is kept, with the error reported.
  assert.equal(tracker.getStopStatus("inbound", "2").lastError, "feed down");
});

test("calls the update handler with the tracker after each refresh", async () => {
  const seen = [];
  const tracker = makeTracker(
    { outbound: () => makeSnapshot() },
    async (current) => seen.push(current)
  );

  await tracker.refresh();

  assert.deepEqual(seen, [tracker]);
});
