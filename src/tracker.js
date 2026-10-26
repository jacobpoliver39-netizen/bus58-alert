const { calculateBusDistances } = require("./eta");
const ROUTE_START_TO_STOP_METERS = 4299;
const ROUTE_START_TO_STOP_MINUTES = 18;

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

        const validPosition =
          bus.distanceFromRouteMeters <= 80 &&
          !bus.hasPassedStop &&
          bus.distanceToStopMeters !== null;

        let observations = this.history.get(bus.vehicleNumber) ?? [];
        let speedMps = null;
        let etaMinutes = null;
        let movingTowardStop = false;

        if (validPosition) {
          observations.push({
            observedAt: now,
            alongRouteMeters: bus.alongRouteMeters,
          });

          // Keep up to 5 observations from the previous 150 seconds.
          observations = observations.filter(
            (observation) => now - observation.observedAt <= 150000
          );
          observations = observations.slice(-5);
        } else {
          observations = [];
        }

        if (validPosition && observations.length >= 2) {
          const first = observations[0];
          const last = observations[observations.length - 1];

          const elapsedSeconds =
            (last.observedAt - first.observedAt) / 1000;
          const progressMeters =
            last.alongRouteMeters - first.alongRouteMeters;

          if (
            elapsedSeconds >= 10 &&
            elapsedSeconds <= 90 &&
            progressMeters >= 15
          ) {
            const measuredSpeed = progressMeters / elapsedSeconds;

            if (measuredSpeed >= 0.5 && measuredSpeed <= 15) {
              movingTowardStop = true;
            }

            if (measuredSpeed >= 1 && measuredSpeed <= 15) {
              speedMps = measuredSpeed;
            }
          }
        }

        if (validPosition) {
          const distanceFromStart = bus.alongRouteMeters;

          etaMinutes =
            ((4299 - distanceFromStart) / 4299) * 18;

          etaMinutes = Math.max(0, etaMinutes);
        }

        this.history.set(bus.vehicleNumber, observations);

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
