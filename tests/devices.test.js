const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DeviceStore, isValidSubscription } = require("../src/devices");

function makePaths(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "bus58-devices-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  return {
    file: path.join(directory, "devices.json"),
    legacySubscriptionsFile: path.join(directory, "push-subscriptions.json"),
    legacySettingsFile: path.join(directory, "notification-settings.json"),
  };
}

function makeSubscription(name) {
  return {
    endpoint: `https://fcm.googleapis.com/fcm/send/${name}`,
    expirationTime: null,
    keys: { p256dh: "key", auth: "auth" },
  };
}

test("accepts only subscriptions from known push services", () => {
  assert.equal(isValidSubscription(makeSubscription("a")), true);
  assert.equal(
    isValidSubscription({
      ...makeSubscription("a"),
      endpoint: "https://web.push.apple.com/abc",
    }),
    true
  );

  for (const endpoint of [
    "https://example.com/push",
    "http://fcm.googleapis.com/fcm/send/a",
    "https://fcm.googleapis.com.evil.example/a",
    "not a url",
  ]) {
    assert.equal(
      isValidSubscription({ ...makeSubscription("a"), endpoint }),
      false,
      endpoint
    );
  }

  assert.equal(isValidSubscription({ endpoint: "https://fcm.googleapis.com/a" }), false);
  assert.equal(isValidSubscription(null), false);
});

test("each device keeps its own stop and preferences", (t) => {
  const store = new DeviceStore(makePaths(t));

  const first = store.upsert({
    subscription: makeSubscription("one"),
    direction: "outbound",
    stopId: "1221",
    settings: { startTime: "07:30", leadMinutes: 15 },
  });
  store.upsert({
    subscription: makeSubscription("two"),
    direction: "inbound",
    stopId: 1260,
    settings: { scheduleEnabled: false },
  });

  assert.equal(first.created, true);
  assert.equal(store.all().length, 2);

  const one = store.findByEndpoint(makeSubscription("one").endpoint);
  const two = store.findByEndpoint(makeSubscription("two").endpoint);

  assert.equal(one.stopId, "1221");
  assert.equal(one.settings.startTime, "07:30");
  assert.equal(one.settings.leadMinutes, 15);
  assert.equal(one.settings.scheduleEnabled, true);
  assert.equal(two.direction, "inbound");
  assert.equal(two.stopId, "1260");
  assert.equal(two.settings.scheduleEnabled, false);
});

test("saving again updates the same device", (t) => {
  const store = new DeviceStore(makePaths(t));
  const subscription = makeSubscription("one");

  store.upsert({ subscription, direction: "outbound", stopId: "1221" });
  const second = store.upsert({
    subscription,
    direction: "inbound",
    stopId: "1260",
  });

  assert.equal(second.created, false);
  assert.equal(store.all().length, 1);
  assert.equal(store.findByEndpoint(subscription.endpoint).stopId, "1260");
});

test("rejects invalid input", (t) => {
  const store = new DeviceStore(makePaths(t));
  const subscription = makeSubscription("one");

  assert.throws(
    () => store.upsert({ subscription: {}, direction: "outbound", stopId: "1" }),
    RangeError
  );
  assert.throws(
    () => store.upsert({ subscription, direction: "sideways", stopId: "1" }),
    /Unknown direction/
  );
  assert.throws(
    () => store.upsert({ subscription, direction: "constructor", stopId: "1" }),
    /Unknown direction/
  );
  assert.throws(
    () => store.upsert({ subscription, direction: "outbound", stopId: "x" }),
    /Unknown stop/
  );
  assert.equal(store.all().length, 0);
  assert.equal(store.findByEndpoint("https://fcm.googleapis.com/nope"), null);
});

test("persists devices across restarts and removes them", (t) => {
  const paths = makePaths(t);
  const store = new DeviceStore(paths);
  const { device } = store.upsert({
    subscription: makeSubscription("one"),
    direction: "outbound",
    stopId: "1221",
    settings: { leadMinutes: 30 },
  });

  const reloaded = new DeviceStore(paths);
  assert.equal(reloaded.all().length, 1);
  assert.equal(reloaded.all()[0].settings.leadMinutes, 30);

  reloaded.remove(device.id);
  assert.equal(new DeviceStore(paths).all().length, 0);
});

test("imports subscribers of the single-stop version once", (t) => {
  const paths = makePaths(t);

  fs.writeFileSync(
    paths.legacySubscriptionsFile,
    JSON.stringify([makeSubscription("legacy")])
  );
  fs.writeFileSync(
    paths.legacySettingsFile,
    JSON.stringify({ startTime: "06:45", endTime: "08:30", weekdays: [1, 2] })
  );

  const store = new DeviceStore(paths);
  const [device] = store.all();

  assert.equal(device.direction, "outbound");
  assert.equal(device.stopId, "1221");
  assert.equal(device.settings.startTime, "06:45");
  assert.deepEqual(device.settings.weekdays, [1, 2]);
  assert.equal(device.settings.leadMinutes, 20);

  // Once devices.json exists the legacy files are ignored.
  store.remove(device.id);
  assert.equal(new DeviceStore(paths).all().length, 0);
});
