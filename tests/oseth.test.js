const test = require("node:test");
const assert = require("node:assert/strict");
const { OsethClient, DIRECTIONS, parseLineString } = require("../src/oseth");

test("parses WKT coordinates into ordered route points", () => {
  assert.deepEqual(
    parseLineString("LINESTRING (22.93984 40.63497,22.94029 40.63540)"),
    [
      { routed_y: 40.63497, routed_x: 22.93984, routed_order: 0 },
      { routed_y: 40.6354, routed_x: 22.94029, routed_order: 1 },
    ]
  );
});

test("rejects missing or malformed route geometry", () => {
  assert.throws(() => parseLineString(null), /geometry is missing/);
  assert.throws(() => parseLineString("NOT A LINE"), /Unsupported/);
  assert.throws(
    () => parseLineString("LINESTRING (22.9 40.6)"),
    /at least two points/
  );
  assert.throws(
    () => parseLineString("LINESTRING (999 40.6,22.9 40.7)"),
    /Invalid route coordinate/
  );
});

test("each direction has its own route and shape", () => {
  const outbound = new OsethClient("outbound");
  const inbound = new OsethClient("inbound");

  assert.equal(outbound.routeId, DIRECTIONS.outbound.routeId);
  assert.notEqual(outbound.routeId, inbound.routeId);
  assert.notEqual(outbound.shapeId, inbound.shapeId);
  assert.throws(() => new OsethClient("sideways"), /Unknown route direction/);
});

test("normalizes every stop on the route", () => {
  const client = new OsethClient("outbound");
  const stops = client.normalizeStops([
    {
      id: 15037,
      name: "EKKLISIA",
      latitude: "40.60066",
      longitude: 22.99125,
      sequence: 22,
    },
    { id: "1221", name: "EKKLISIA", latitude: 40.60853, longitude: 22.96585 },
  ]);

  assert.deepEqual(stops, [
    {
      id: "15037",
      name: "EKKLISIA",
      latitude: 40.60066,
      longitude: 22.99125,
      sequence: 22,
    },
    {
      id: "1221",
      name: "EKKLISIA",
      latitude: 40.60853,
      longitude: 22.96585,
      sequence: 2,
    },
  ]);
});

test("rejects missing or invalid stops", () => {
  const client = new OsethClient("inbound");

  assert.throws(() => client.normalizeStops([]), /no stops/);
  assert.throws(
    () => client.normalizeStops([{ id: "1", latitude: 999, longitude: 22.9 }]),
    /invalid stop record/
  );
});

test("normalizes live vehicle records", () => {
  const client = new OsethClient("outbound");
  const fetchedAt = "2026-10-22T10:00:00.000Z";

  assert.deepEqual(
    client.normalizeVehicles(
      [{
        id: "3001",
        latitude: 40.604,
        longitude: 22.968,
        bearing: 162,
      }],
      fetchedAt
    ),
    [{
      VEH_NO: "3001",
      CS_LAT: 40.604,
      CS_LNG: 22.968,
      CS_DATE: fetchedAt,
      bearing: 162,
    }]
  );
});

test("rejects invalid vehicle coordinates", () => {
  const client = new OsethClient("outbound");

  assert.throws(
    () => client.normalizeVehicles(
      [{ id: "3001", latitude: 999, longitude: 22.9 }],
      new Date().toISOString()
    ),
    /invalid vehicle record/
  );
});
