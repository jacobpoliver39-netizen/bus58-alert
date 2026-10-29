const fs = require("fs");
const path = require("path");
const webpush = require("web-push");
const { NotificationSettings } = require("./notification-settings");

const subscriptionsFile =
  process.env.SUBSCRIPTIONS_FILE ||
  path.join(__dirname, "../push-subscriptions.json");

class NotificationManager {
  constructor(settings = new NotificationSettings()) {
    this.notifiedBuses = new Set();
    this.settings = settings;
  }

  loadSubscriptions() {
    try {
      return JSON.parse(fs.readFileSync(subscriptionsFile, "utf8"));
    } catch {
      return [];
    }
  }

  async sendToAll(payload) {
    const subscriptions = this.loadSubscriptions();

    await Promise.all(
      subscriptions.map(async (subscription) => {
        try {
          await webpush.sendNotification(
            subscription,
            JSON.stringify(payload)
          );
        } catch (error) {
          console.error(
            `Push delivery failed (${error.statusCode || "unknown"}):`,
            error.message
          );
        }
      })
    );
  }

  async checkBuses(buses) {
    for (const bus of buses) {
      const validPosition =
        Number.isFinite(bus.distanceFromRouteMeters) &&
        bus.distanceFromRouteMeters <= 80 &&
        bus.hasPassedStop !== true &&
        Number.isFinite(bus.distanceToStopMeters) &&
        bus.distanceToStopMeters >= 0;

      if (!validPosition) {
        continue;
      }

      // Do not consume the alert for this bus while notifications
      // are disabled or outside the configured schedule.
      if (!this.settings.isAllowedAt()) {
        continue;
      }

      if (this.notifiedBuses.has(bus.vehicleNumber)) {
        continue;
      }

      this.notifiedBuses.add(bus.vehicleNumber);

      await this.sendToAll({
        title: "Bus 58 detected near ΕΚΚΛΗΣΙΑ",
        body: `Bus ${bus.vehicleNumber} has been detected ${bus.distanceToStopMeters} m before ΕΚΚΛΗΣΙΑ. Time to leave!`,
        url: "/",
        tag: `bus58-${bus.vehicleNumber}`,
      });

      console.log(
        `Processed detection alert for bus ${bus.vehicleNumber}, ` +
        `${bus.distanceToStopMeters} m before ΕΚΚΛΗΣΙΑ`
      );
    }

    // Re-arm only when a bus is explicitly observed past the stop
    // or outside the valid route approach.
    for (const bus of buses) {
      const noLongerApproaching =
        bus.hasPassedStop === true ||
        (Number.isFinite(bus.distanceFromRouteMeters) &&
          bus.distanceFromRouteMeters > 80) ||
        bus.distanceToStopMeters === null;

      if (noLongerApproaching) {
        this.notifiedBuses.delete(bus.vehicleNumber);
      }
    }
  }
}

module.exports = { NotificationManager };