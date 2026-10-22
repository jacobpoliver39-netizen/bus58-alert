const test = require("node:test");
const assert = require("node:assert/strict");
const { calculateBusDistances } = require("../src/eta");

const route = [
  { routed_y: 40.6, routed_x: 22.9, routed_order: 0 },
  { routed_y: 40.6, routed_x: 22.91, routed_order: 1 },
];

const targetStop = {
  StopID: "1221",
  StopLat: 40.6,
  StopLng: 22.908,
};

function makeBus(longitude, vehicleNumber = "3001") {
  return {
    VEH_NO: vehicleNumber,
    CS_LAT: 40.6,
    CS_LNG: longitude,
    CS_DATE: "2026-10-22T10:00:00.000Z",
  };
}

test("calculates remaining route distance for a bus before the stop", () => {
  const [bus] = calculateBusDistances(
    [makeBus(22.904)],
    route,
    targetStop
  );

  assert.equal(bus.hasPassedStop, false);
  assert.ok(bus.distanceToStopMeters > 0);
  assert.ok(bus.distanceFromRouteMeters <= 1);
  assert.ok(
    Math.abs(
      bus.distanceToStopMeters -
      (bus.targetAlongRouteMeters - bus.alongRouteMeters)
    ) <= 2
  );
});

test("marks a bus beyond the target stop as having passed it", () => {
  const [bus] = calculateBusDistances(
    [makeBus(22.909)],
    route,
    targetStop
  );

  assert.equal(bus.hasPassedStop, true);
  assert.equal(bus.distanceToStopMeters, null);
});

test("returns no remaining distance when the bus is at the stop", () => {
  const [bus] = calculateBusDistances(
    [makeBus(22.908)],
    route,
    targetStop
  );

  assert.equal(bus.hasPassedStop, false);
  assert.ok(bus.distanceToStopMeters <= 2);
});

test("uses route order when the route doubles back near itself", () => {
  const loopingRoute = [
    { routed_y: 40.6, routed_x: 22.9, routed_order: 0 },
    { routed_y: 40.6, routed_x: 22.91, routed_order: 1 },
    { routed_y: 40.6001, routed_x: 22.91, routed_order: 2 },
    { routed_y: 40.6001, routed_x: 22.9, routed_order: 3 },
  ];

  const loopingStop = {
    StopID: "1221",
    StopLat: 40.6001,
    StopLng: 22.9,
  };

  const [bus] = calculateBusDistances(
    [makeBus(22.905)],
    loopingRoute,
    loopingStop
  );

  assert.ok(bus.distanceFromRouteMeters <= 1);
  assert.ok(bus.distanceToStopMeters > 0);
  assert.equal(bus.hasPassedStop, false);
});
