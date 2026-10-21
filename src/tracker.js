const { calculateBusDistances } = require("./eta");

class BusTracker {
  constructor(oasth, pollIntervalMs = 30000, onUpdate = null) {
    this.oasth = oasth;
    this.onUpdate = onUpdate;
    this.pollIntervalMs = pollIntervalMs;
    this.history = new Map();
    this.latest = null;
    this.timer = null;
    this.refreshing = false;
    this.lastError = null;
  }

  async refresh() {
    if (this.refreshing) return;
    this.refreshing = true;

    try {
      const snapshot = await this.oasth.getLiveSnapshot();
      const route = await this.oasth.getRouteData();

      const distances = calculateBusDistances(
        snapshot.buses,
        route.details,
        snapshot.targetStop
      );

      const now = Date.now();

      const trackedBuses = distances.map((bus) => {
        const previous = this.history.get(bus.vehicleNumber);
        let speedMps = null;
        let etaMinutes = null;
        let movingTowardStop = false;

        const validPosition =
          bus.distanceFromRouteMeters <= 80 &&
          !bus.hasPassedStop &&
          bus.distanceToStopMeters !== null;

        if (previous && validPosition && previous.validPosition) {
          const elapsedSeconds = (now - previous.observedAt) / 1000;
          const progressMeters =
            bus.alongRouteMeters - previous.alongRouteMeters;

          if (
            elapsedSeconds >= 10 &&
            elapsedSeconds <= 180 &&
            progressMeters >= 15
          ) {
            const measuredSpeed = progressMeters / elapsedSeconds;

            // Confirm forward movement, even if an ETA is not yet reliable.
            if (measuredSpeed >= 0.5 && measuredSpeed <= 15) {
              movingTowardStop = true;
            }

            // Use stricter limits for ETA estimates.
            if (measuredSpeed >= 1 && measuredSpeed <= 15) {
              speedMps = measuredSpeed;
            }
          }
        }

        if (
          validPosition &&
          speedMps !== null &&
          bus.distanceToStopMeters > 0
        ) {
          etaMinutes = bus.distanceToStopMeters / speedMps / 60;
        }



        this.history.set(bus.vehicleNumber, {
          observedAt: now,
          alongRouteMeters: bus.alongRouteMeters,
          validPosition,
        });

        return {
          ...bus,
          movingTowardStop,
          speedKmh: speedMps === null
            ? null
            : Math.round(speedMps * 3.6 * 10) / 10,
          etaMinutes: etaMinutes === null
            ? null
            : Math.round(etaMinutes * 10) / 10,
          status: !validPosition
            ? "not-approaching"
            : etaMinutes === null
              ? "collecting-data"
              : "estimated",
        };
      });

      this.latest = {
        fetchedAt: snapshot.fetchedAt,
        observedAt: new Date(now).toISOString(),
        targetStop: snapshot.targetStop,
        buses: trackedBuses,
      };

      this.lastError = null;
      if (this.onUpdate) {
        await this.onUpdate(this.latest.buses);
      }
    } catch (error) {
      this.lastError = error.message;
      console.error("Bus tracker refresh failed:", error.message);
    } finally {
      this.refreshing = false;
    }
  }

  start() {
    if (this.timer) return;

    // Start immediately, then continue at the configured interval.
    this.refresh();
    this.timer = setInterval(
      () => this.refresh(),
      this.pollIntervalMs
    );
  }

  getStatus() {
    return {
      running: Boolean(this.timer),
      pollIntervalSeconds: this.pollIntervalMs / 1000,
      lastError: this.lastError,
      data: this.latest,
    };
  }
}

module.exports = { BusTracker };
