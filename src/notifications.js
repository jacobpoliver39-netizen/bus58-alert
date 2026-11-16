const webpush = require("web-push");
const { isAllowedAt } = require("./notification-settings");

// An alert that was sent is forgotten once its bus has not been seen
// approaching for this long, so the vehicle's next trip alerts again even
// if it was never observed passing the stop.
const REARM_AFTER_MS = 15 * 60 * 1000;

class NotificationManager {
  constructor(deviceStore) {
    this.devices = deviceStore;
    // "deviceId|direction|stopId|vehicle" -> when last seen approaching
    this.notified = new Map();
  }

  // Returns false when the push service reports the subscription as gone.
  async send(device, payload) {
    try {
      await webpush.sendNotification(
        device.subscription,
        JSON.stringify(payload)
      );
    } catch (error) {
      console.error(
        `Push delivery failed (${error.statusCode || "unknown"}):`,
        error.message
      );

      if (error.statusCode === 404 || error.statusCode === 410) {
        return false;
      }
    }

    return true;
  }

  async checkAll(tracker, now = new Date()) {
    const time = now.getTime();

    await Promise.all(
      this.devices.all().map((device) =>
        this.checkDevice(device, tracker, now)
      )
    );

    for (const [key, lastSeen] of this.notified) {
      if (time - lastSeen > REARM_AFTER_MS) {
        this.notified.delete(key);
      }
    }
  }

  async checkDevice(device, tracker, now) {
    const status = tracker.getStopStatus(device.direction, device.stopId);
    if (!status) return;

    const allowed = isAllowedAt(device.settings, now);

    for (const bus of status.buses) {
      const key = [
        device.id,
        device.direction,
        device.stopId,
        bus.vehicleNumber,
      ].join("|");

      // Re-arm once the bus is past the stop or off the route.
      if (!bus.approaching) {
        this.notified.delete(key);
        continue;
      }

      if (this.notified.has(key)) {
        this.notified.set(key, now.getTime());
        continue;
      }

      // Outside the schedule the alert is not consumed, so it fires as
      // soon as the window opens while the bus is still on its way.
      if (!allowed || bus.etaMinutes > device.settings.leadMinutes) {
        continue;
      }

      this.notified.set(key, now.getTime());

      const minutes = Math.max(1, Math.round(bus.etaMinutes));
      const delivered = await this.send(device, {
        title: `Bus 58: about ${minutes} min to ${status.stop.name}`,
        body:
          `Bus ${bus.vehicleNumber} is ${bus.distanceToStopMeters} m ` +
          `from ${status.stop.name}. Time to leave!`,
        url: "/",
        tag: `bus58-${bus.vehicleNumber}`,
      });

      if (!delivered) {
        this.devices.remove(device.id);
        return;
      }
    }
  }
}

module.exports = { NotificationManager };
