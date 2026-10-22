const fs = require("fs");
const path = require("path");
const webpush = require("web-push");

const subscriptionsFile =
  process.env.SUBSCRIPTIONS_FILE ||
  path.join(__dirname, "../push-subscriptions.json");

const ALERT_ETA_MINUTES = Number(
  process.env.ALERT_ETA_MINUTES || 16
);

class NotificationManager {
  constructor() {
    this.notifiedBuses = new Set();
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
        bus.distanceFromRouteMeters <= 80 &&
        !bus.hasPassedStop &&
        bus.distanceToStopMeters !== null;

      if (!validPosition || !bus.movingTowardStop) {
        continue;
      }

      // Require a usable ETA within the alert window.
      if (
        bus.etaMinutes === null ||
        !Number.isFinite(bus.etaMinutes) ||
        bus.etaMinutes < 0 ||
        bus.etaMinutes > ALERT_ETA_MINUTES
      ) {
        continue;
      }

      // Notify only once during this observed approach.
      if (this.notifiedBuses.has(bus.vehicleNumber)) {
        continue;
      }

      this.notifiedBuses.add(bus.vehicleNumber);

      await this.sendToAll({
        title: "Bus 58 is approaching ΕΚΚΛΗΣΙΑ",
        body: `Bus ${bus.vehicleNumber} is about ${Math.round(bus.etaMinutes)} minutes away. Time to leave!`,
        url: "/",
        tag: `bus58-${bus.vehicleNumber}`,
      });

      console.log(
        `Sent approaching-bus alert for ${bus.vehicleNumber}, ETA ${bus.etaMinutes} min`
      );
    }

    // Re-arm only when a bus is explicitly observed past the stop
    // or outside the valid route approach. Missing API results alone
    // are not enough to reset the alert.
    for (const bus of buses) {
      const noLongerApproaching =
        bus.hasPassedStop ||
        bus.distanceFromRouteMeters > 80 ||
        bus.distanceToStopMeters === null;

      if (noLongerApproaching) {
        this.notifiedBuses.delete(bus.vehicleNumber);
      }
    }
  }
}

module.exports = { NotificationManager };
