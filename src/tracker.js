const { buildRoute, locateStops, locateBuses } = require("./eta");

// Average pace used for every ETA: measured as 4299 m of route in 18 minutes.
const METERS_PER_MINUTE = 4299 / 18;
const MAX_OFF_ROUTE_METERS = 80;

class BusTracker {
  // `clients` maps a direction name to an object with getLiveSnapshot().
  constructor(clients, pollIntervalMs = 30000, onUpdate = null) {
    this.clients = clients;
    this.onUpdate = onUpdate;
    this.pollIntervalMs = pollIntervalMs;
    this.history = new Map();
    this.directions = {};
    this.errors = {};
    this.timer = null;
    this.refreshing = false;
  }

  async refresh() {
    if (this.refreshing) return;
    this.refreshing = true;

    try {
      await Promise.all(
        Object.entries(this.clients).map(async ([direction, client]) => {
          try {
            this.directions[direction] = this.track(
              direction,
              await client.getLiveSnapshot()
            );
            this.errors[direction] = null;
          } catch (error) {
            this.errors[direction] = error.message;
            console.error(
              `Bus tracker refresh failed (${direction}):`,
              error.message
            );
          }
        })
      );

      if (this.onUpdate) {
        await this.onUpdate(this);
      }
    } catch (error) {
      console.error("Bus tracker update handler failed:", error.message);
    } finally {
      this.refreshing = false;
    }
  }

  track(direction, snapshot) {
    const route = buildRoute(snapshot.details);
    const stops = locateStops(snapshot.stops, route);
    const now = Date.now();

    const buses = locateBuses(snapshot.buses, route).map((bus) => {
      const key = `${direction}:${bus.vehicleNumber}`;
      const onRoute = bus.distanceFromRouteMeters <= MAX_OFF_ROUTE_METERS;
      let observations = [];

      if (onRoute) {
        // Keep up to 5 observations from the previous 150 seconds.
        observations = [
          ...(this.history.get(key) ?? []),
          { observedAt: now, alongRouteMeters: bus.alongRouteMeters },
        ]
          .filter((item) => now - item.observedAt <= 150000)
          .slice(-5);
      }

      this.history.set(key, observations);

      return {
        ...bus,
        onRoute,
        speedKmh: measureSpeedKmh(observations),
      };
    });

    // Forget vehicles that are no longer in this direction's feed.
    const present = new Set(
      buses.map((bus) => `${direction}:${bus.vehicleNumber}`)
    );
    for (const key of this.history.keys()) {
      if (key.startsWith(`${direction}:`) && !present.has(key)) {
        this.history.delete(key);
      }
    }

    return {
      fetchedAt: snapshot.fetchedAt,
      observedAt: new Date(now).toISOString(),
      headsign: snapshot.headsign ?? null,
      stops,
      buses,
    };
  }

  // Everything the app knows about one stop: the stop itself and each bus
  // in that direction with its distance and ETA to that stop. Returns null
  // when the direction has no data yet or the stop is not on it.
  getStopStatus(direction, stopId) {
    const data = this.directions[direction];
    const stop = data?.stops.find((item) => item.id === String(stopId));

    if (!stop) return null;

    const buses = data.buses.map((bus) => {
      const remaining = stop.alongMeters - bus.alongRouteMeters;
      const hasPassedStop = remaining < 0;
      const approaching = bus.onRoute && !hasPassedStop;

      return {
        vehicleNumber: bus.vehicleNumber,
        distanceFromRouteMeters: bus.distanceFromRouteMeters,
        distanceToStopMeters: hasPassedStop ? null : remaining,
        hasPassedStop,
        approaching,
        speedKmh: bus.speedKmh,
        etaMinutes: approaching
          ? Math.round((remaining / METERS_PER_MINUTE) * 10) / 10
          : null,
      };
    });

    return {
      direction,
      stop: { id: stop.id, name: stop.name, sequence: stop.sequence },
      fetchedAt: data.fetchedAt,
      observedAt: data.observedAt,
      lastError: this.errors[direction] ?? null,
      buses,
    };
  }

  hasStop(direction, stopId) {
    const data = this.directions[direction];
    return Boolean(data?.stops.some((stop) => stop.id === String(stopId)));
  }

  getRoutes() {
    return Object.entries(this.directions).map(([direction, data]) => ({
      id: direction,
      headsign: data.headsign,
      stops: data.stops.map(({ id, name, sequence }) => ({
        id,
        name,
        sequence,
      })),
    }));
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

  isRunning() {
    return Boolean(this.timer);
  }
}

// Speed is shown for information only; ETAs use the fixed average pace.
function measureSpeedKmh(observations) {
  if (observations.length < 2) return null;

  const first = observations[0];
  const last = observations[observations.length - 1];
  const elapsedSeconds = (last.observedAt - first.observedAt) / 1000;
  const progressMeters = last.alongRouteMeters - first.alongRouteMeters;

  if (elapsedSeconds < 10 || elapsedSeconds > 150 || progressMeters < 15) {
    return null;
  }

  const speedMps = progressMeters / elapsedSeconds;
  if (speedMps < 1 || speedMps > 15) return null;

  return Math.round(speedMps * 3.6 * 10) / 10;
}

module.exports = { BusTracker, METERS_PER_MINUTE };
