const test = require("node:test");
const assert = require("node:assert/strict");
const { OsethClient, parseLineString } = require("../src/oseth");

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

test("normalizes the exact target stop and route geometry", () => {
  const client = new OsethClient();
  const route = client.normalizeRoute({
    shape: {
      lineString: "LINESTRING (22.9 40.6,22.91 40.61)",
    },
    stops: [
      {
        id: "15037",
        code: "15037",
        name: "EKKLISIA",
        latitude: 40.60066,
        longitude: 22.99125,
        sequence: 22,
      },
      {
        id: "1221",
        code: "1221",
        name: "EKKLISIA",
        latitude: 40.60853,
        longitude: 22.96585,
        sequence: 14,
      },
    ],
  });

  assert.equal(route.targetStop.StopID, "1221");
  assert.equal(route.targetStop.StopLat, 40.60853);
  assert.equal(route.targetStop.StopLng, 22.96585);
  assert.equal(route.details.length, 2);
  assert.equal(route.stops.length, 2);
});

test("rejects a route missing the target stop", () => {
  const client = new OsethClient();

  assert.throws(
    () => client.normalizeRoute({
      shape: { lineString: "LINESTRING (22.9 40.6,22.91 40.61)" },
      stops: [{ id: "15037", name: "EKKLISIA" }],
    }),
    /Target stop 1221 was not found/
  );
});

test("normalizes live vehicle records for the existing ETA code", () => {
  const client = new OsethClient();
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
  const client = new OsethClient();

  assert.throws(
    () => client.normalizeVehicles(
      [{ id: "3001", latitude: 999, longitude: 22.9 }],
      new Date().toISOString()
    ),
    /invalid vehicle record/
  );
});
