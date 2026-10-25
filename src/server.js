require("dotenv").config();

const express = require("express");
const fs = require("fs");
const path = require("path");
const webpush = require("web-push");

const { OsethClient } = require("./oseth");
const { calculateBusDistances } = require("./eta");
const { BusTracker } = require("./tracker");
const { NotificationManager } = require("./notifications");
const app = express();
const PORT = process.env.PORT || 3000;
const oasth = new OsethClient();
const notificationManager = new NotificationManager();

const tracker = new BusTracker(oasth, 30000, async (buses) => {
  await notificationManager.checkBuses(buses);
});


const subscriptionsFile =
  process.env.SUBSCRIPTIONS_FILE ||
  path.join(__dirname, "../push-subscriptions.json");
  
app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.join(__dirname, "../public")));

const publicKey = process.env.VAPID_PUBLIC_KEY;
const privateKey = process.env.VAPID_PRIVATE_KEY;
const vapidSubject = process.env.VAPID_SUBJECT;

if (!publicKey || !privateKey || !vapidSubject) {
  console.error("Missing VAPID settings. Check your .env file.");
  process.exit(1);
}

webpush.setVapidDetails(vapidSubject, publicKey, privateKey);

function readSubscriptions() {
  try {
    return JSON.parse(fs.readFileSync(subscriptionsFile, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

function saveSubscriptions(subscriptions) {
  fs.writeFileSync(
    subscriptionsFile,
    JSON.stringify(subscriptions, null, 2),
    { mode: 0o600 }
  );
}

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    app: "bus58-alert",
    targetStop: 1221,
    targetRoute: "58",
    direction: "toward Anatolia College",
  });
});

app.get("/api/status", (_req, res) => {
  res.json(tracker.getStatus());
});

app.get("/api/live", async (_req, res) => {
  try {
    const snapshot = await oasth.getLiveSnapshot();
    const busDistances = calculateBusDistances(
      snapshot.buses,
      (await oasth.getRouteData()).details,
      snapshot.targetStop
    );

    res.json({ ...snapshot, busDistances });
  } catch (error) {
    console.error("Failed to fetch OASTH data:", error.message);
    res.status(502).json({
      error: "Could not retrieve live bus data",
      details: error.message,
    });
  }
});

app.get("/api/push/public-key", (_req, res) => {
  res.json({ publicKey });
});

app.post("/api/push/subscribe", async (req, res) => {
  const subscription = req.body;

  if (
    !subscription ||
    typeof subscription.endpoint !== "string" ||
    !subscription.keys?.p256dh ||
    !subscription.keys?.auth
  ) {
    return res.status(400).json({ error: "Invalid push subscription." });
  }

  try {
    const subscriptions = readSubscriptions();
    const updated = [
      ...subscriptions.filter((item) => item.endpoint !== subscription.endpoint),
      subscription,
    ];

    saveSubscriptions(updated);

    try {
      await webpush.sendNotification(
        subscription,
        JSON.stringify({
          title: "Bus 58 Alert",
          body: "Push notifications are connected successfully!",
          url: "/",
          tag: "bus58-setup",
        })
      );
    } catch (error) {
      console.error("Subscription saved, but test push failed:", error.message);
      return res.status(502).json({
        error: "Subscription saved, but the test notification could not be sent.",
      });
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Failed to save push subscription:", error.message);
    res.status(500).json({ error: "Could not save the subscription." });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  tracker.start();
  console.log(`Bus 58 Alert running on port ${PORT}`);
});

