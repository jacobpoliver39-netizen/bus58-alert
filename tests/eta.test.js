const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildRoute,
  locateOnRoute,
  locateStops,
  locateBuses,
} = require("../src/eta");

// A straight west-to-east line about 845 m long.
const straight = [
  { routed_y: 40.6, routed_x: 22.9, routed_order: 0 },
  { routed_y: 40.6, routed_x: 22.91, routed_order: 1 },
];

test("measures cumulative distance and orders points by routed_order", () => {
  const route = buildRoute([...straight].reverse());

  assert.equal(route.points[0].lng, 22.9);
  assert.ok(route.cumulative[1] > 830 && route.cumulative[1] < 860);
});

test("requires at least two route points", () => {
  assert.throws(() => buildRoute([straight[0]]), /Not enough route geometry/);
  assert.throws(() => buildRoute(null), /Not enough route geometry/);
});

test("projects a point onto the route with its offset", () => {
  const route = buildRoute(straight);
  const location = locateOnRoute({ lat: 40.6005, lng: 22.905 }, route);

  assert.ok(Math.abs(location.alongMeters - route.cumulative[1] / 2) < 2);
  assert.ok(location.offsetMeters > 50 && location.offsetMeters < 60);
});

test("locates buses along the route", () => {
  const route = buildRoute(straight);
  const [bus] = locateBuses(
    [{ VEH_NO: "3001", CS_LAT: 40.6, CS_LNG: 22.9025, CS_DATE: "now" }],
    route
  );

  assert.equal(bus.vehicleNumber, "3001");
  assert.equal(bus.distanceFromRouteMeters, 0);
  assert.ok(Math.abs(bus.alongRouteMeters - route.cumulative[1] / 4) < 2);
  assert.deepEqual(locateBuses(null, route), []);
});

test("keeps stops in sequence where the route doubles back on itself", () => {
  // Out along a street and back along the same street.
  const route = buildRoute([
    { routed_y: 40.6, routed_x: 22.9, routed_order: 0 },
    { routed_y: 40.6, routed_x: 22.91, routed_order: 1 },
    { routed_y: 40.6, routed_x: 22.9, routed_order: 2 },
  ]);
  const half = route.cumulative[1];

  const stops = locateStops(
    [
      { id: 3, name: "Back", latitude: 40.6, longitude: 22.9025, sequence: 3 },
      { id: 1, name: "Out", latitude: 40.6, longitude: 22.9025, sequence: 1 },
      { id: 2, name: "Turn", latitude: 40.6, longitude: 22.91, sequence: 2 },
    ],
    route
  );

  assert.deepEqual(stops.map((stop) => stop.id), ["1", "2", "3"]);
  assert.ok(Math.abs(stops[0].alongMeters - half * 0.25) < 2);
  assert.ok(Math.abs(stops[1].alongMeters - half) < 2);
  assert.ok(Math.abs(stops[2].alongMeters - half * 1.75) < 2);
});
