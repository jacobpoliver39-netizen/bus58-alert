require("dotenv").config();

const express = require("express");
const path = require("path");
const webpush = require("web-push");

const { OsethClient, DIRECTIONS } = require("./oseth");
const { BusTracker } = require("./tracker");
const { DeviceStore } = require("./devices");
const { NotificationManager } = require("./notifications");

const app = express();
const PORT = process.env.PORT || 3000;

const publicKey = process.env.VAPID_PUBLIC_KEY;
const privateKey = process.env.VAPID_PRIVATE_KEY;
const vapidSubject = process.env.VAPID_SUBJECT;

if (!publicKey || !privateKey || !vapidSubject) {
  console.error("Missing VAPID settings. Check your .env file.");
  process.exit(1);
}

webpush.setVapidDetails(vapidSubject, publicKey, privateKey);

const devices = new DeviceStore();
const notificationManager = new NotificationManager(devices);

const clients = Object.fromEntries(
  Object.keys(DIRECTIONS).map((direction) => [
    direction,
    new OsethClient(direction),
  ])
);

const tracker = new BusTracker(clients, 30000, async (current) => {
  await notificationManager.checkAll(current);
});

app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.join(__dirname, "../public")));

app.get("/health", (_req, res) => {
  res.json({ status: "ok", app: "bus58-alert", route: "58" });
});

// Both directions of the route with their stops, for the stop picker.
app.get("/api/routes", (_req, res) => {
  const loaded = new Map(
    tracker.getRoutes().map((route) => [route.id, route])
  );

  res.json({
    directions: Object.entries(DIRECTIONS).map(([id, config]) => ({
      id,
      label: config.label,
      headsign: loaded.get(id)?.headsign ?? null,
      stops: loaded.get(id)?.stops ?? [],
    })),
  });
});

// Live buses relative to one stop: /api/status?direction=outbound&stop=1221
app.get("/api/status", (req, res) => {
  const direction = String(req.query.direction ?? "");
  const stopId = String(req.query.stop ?? "");

  if (!Object.hasOwn(DIRECTIONS, direction)) {
    return res.status(400).json({ error: "Unknown direction." });
  }

  const status = tracker.getStopStatus(direction, stopId);

  if (!status) {
    const stillLoading = tracker.getRoutes().every(
      (route) => route.id !== direction
    );

    return res.status(stillLoading ? 503 : 404).json({
      error: stillLoading
        ? tracker.errors[direction] || "Live bus data is not available yet."
        : "That stop is not on this direction of the route.",
    });
  }

  res.json(status);
});

app.get("/api/push/public-key", (_req, res) => {
  res.json({ publicKey });
});

// A device reads its own saved stop and preferences by presenting its
// push endpoint, which only that device and this server know.
app.post("/api/device/lookup", (req, res) => {
  const device = devices.findByEndpoint(req.body?.endpoint);

  if (!device) {
    return res.status(404).json({ error: "This device is not registered." });
  }

  res.json({
    direction: device.direction,
    stopId: device.stopId,
    settings: device.settings,
  });
});

// Registers a device or updates its stop and preferences.
app.put("/api/device", async (req, res) => {
  const { subscription, direction, stopId, settings } = req.body ?? {};

  if (
    tracker.getRoutes().some((route) => route.id === direction) &&
    !tracker.hasStop(direction, stopId)
  ) {
    return res.status(400).json({
      error: "That stop is not on this direction of the route.",
    });
  }

  let result;

  try {
    result = devices.upsert({ subscription, direction, stopId, settings });
  } catch (error) {
    if (error instanceof RangeError) {
      return res.status(400).json({ error: error.message });
    }

    console.error("Failed to save device:", error.message);
    return res.status(500).json({ error: "Could not save your preferences." });
  }

  const { device, created } = result;

  if (created) {
    const delivered = await notificationManager.send(device, {
      title: "58-Mate",
      body: "Push notifications are connected successfully!",
      url: "/",
      tag: "bus58-setup",
    });

    if (!delivered) {
      devices.remove(device.id);
      return res.status(400).json({
        error: "The push subscription was rejected. Try enabling again.",
      });
    }
  }

  res.json({
    success: true,
    created,
    direction: device.direction,
    stopId: device.stopId,
    settings: device.settings,
  });
});

app.listen(PORT, "0.0.0.0", () => {
  tracker.start();
  console.log(`Bus 58 Alert running on port ${PORT}`);
});
