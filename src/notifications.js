const fs = require("fs");
const path = require("path");
const webpush = require("web-push");

const subscriptionsFile = path.join(
  __dirname,
  "../push-subscriptions.json"
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

      if (!validPosition) {
        continue;
      }



      if (!bus.movingTowardStop) {
        continue;
      }

      // Notify only once during this observed approach.
      if (this.notifiedBuses.has(bus.vehicleNumber)) {
        continue;
      }

      this.notifiedBuses.add(bus.vehicleNumber);

      await this.sendToAll({
        title: "Bus 58 is approaching ΕΚΚΛΗΣΙΑ",
        body: bus.etaMinutes !== null
          ? `Bus ${bus.vehicleNumber} is about ${Math.round(bus.etaMinutes)} minutes away. Time to leave!`
          : `Bus ${bus.vehicleNumber} is moving toward ΕΚΚΛΗΣΙΑ. Check the app for its status.`,
        url: "/",
        tag: `bus58-${bus.vehicleNumber}`,
      });

      console.log(
        `Sent approaching-bus alert for ${bus.vehicleNumber}, ${
          bus.etaMinutes !== null
            ? `ETA ${bus.etaMinutes} min`
            : "ETA unavailable"
        }`
      );
    }

    // Re-arm a bus only when it is explicitly observed past the stop
    // or outside the valid route approach. Missing API results alone
    // are not enough to reset the alert.
    for (const bus of buses) {
      const vehicleNumber = bus.vehicleNumber;

      const noLongerApproaching =
        bus.hasPassedStop ||
        bus.distanceFromRouteMeters > 80 ||
        bus.distanceToStopMeters === null;

      if (noLongerApproaching) {
        this.notifiedBuses.delete(vehicleNumber);
      }
    }


  }
}

module.exports = { NotificationManager };
