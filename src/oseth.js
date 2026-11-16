const BASE_URL = "https://oseth.com.gr/en/telematics-api/route";

// The two directions of route 58. Stop IDs differ between directions,
// so a stop is always identified by (direction, stopId).
const DIRECTIONS = {
  outbound: {
    routeId: "58_7448_2_3",
    shapeId: "6365",
    label: "Toward Panorama / Chortiatis",
  },
  inbound: {
    routeId: "58_7448_1_3",
    shapeId: "6546",
    label: "Toward Venizelou (city centre)",
  },
};

function isValidCoordinate(lat, lng) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

function parseLineString(lineString) {
  if (typeof lineString !== "string") {
    throw new Error("OSETH route geometry is missing");
  }

  const match = lineString.trim().match(/^LINESTRING\s*\((.+)\)$/i);
  if (!match) {
    throw new Error("Unsupported OSETH route geometry format");
  }

  const points = match[1].split(",").map((pair, index) => {
    const coordinates = pair.trim().split(/\s+/).map(Number);
    const [lng, lat] = coordinates;

    if (coordinates.length < 2 || !isValidCoordinate(lat, lng)) {
      throw new Error(`Invalid route coordinate at point ${index}`);
    }

    return {
      routed_y: lat,
      routed_x: lng,
      routed_order: index,
    };
  });

  if (points.length < 2) {
    throw new Error("OSETH route geometry needs at least two points");
  }

  return points;
}

class OsethClient {
  constructor(direction) {
    const config = DIRECTIONS[direction];

    if (!config) {
      throw new Error(`Unknown route direction: ${direction}`);
    }

    this.direction = direction;
    this.routeId = config.routeId;
    this.shapeId = config.shapeId;
  }

  async fetchRouteInfo() {
    const url = new URL(`${BASE_URL}/${this.routeId}/info`);
    url.searchParams.set("shapeId", this.shapeId);
    url.searchParams.set("language", "en");

    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      throw new Error(`OSETH returned HTTP ${response.status}`);
    }

    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error("OSETH returned invalid JSON");
    }

    if (result.error || !result.data) {
      throw new Error(`OSETH API error: ${result.error || "Missing data"}`);
    }

    if (
      result.data.id !== this.routeId ||
      String(result.data.shape?.id) !== this.shapeId
    ) {
      throw new Error("OSETH returned unexpected route or shape data");
    }

    return result.data;
  }

  normalizeStops(stops) {
    const normalized = (stops ?? []).map((stop, index) => {
      const latitude = Number(stop.latitude);
      const longitude = Number(stop.longitude);

      if (stop.id == null || !isValidCoordinate(latitude, longitude)) {
        throw new Error("OSETH returned an invalid stop record");
      }

      return {
        id: String(stop.id),
        name: String(stop.name ?? stop.id),
        latitude,
        longitude,
        sequence: Number.isFinite(Number(stop.sequence))
          ? Number(stop.sequence)
          : index + 1,
      };
    });

    if (normalized.length === 0) {
      throw new Error("OSETH returned no stops for the route");
    }

    return normalized;
  }

  normalizeVehicles(vehicles, fetchedAt) {
    return (vehicles ?? []).map((vehicle) => {
      const lat = Number(vehicle.latitude);
      const lng = Number(vehicle.longitude);

      if (vehicle.id == null || !isValidCoordinate(lat, lng)) {
        throw new Error("OSETH returned an invalid vehicle record");
      }

      return {
        VEH_NO: String(vehicle.id),
        CS_LAT: lat,
        CS_LNG: lng,
        CS_DATE: fetchedAt,
        bearing: Number.isFinite(Number(vehicle.bearing))
          ? Number(vehicle.bearing)
          : null,
      };
    });
  }

  // One request returns the route geometry, its stops and the live vehicles.
  async getLiveSnapshot() {
    const data = await this.fetchRouteInfo();
    const fetchedAt = new Date().toISOString();

    return {
      fetchedAt,
      direction: this.direction,
      headsign: data.headsign ?? null,
      details: parseLineString(data.shape?.lineString),
      stops: this.normalizeStops(data.stops),
      buses: this.normalizeVehicles(data.vehicles, fetchedAt),
    };
  }
}

module.exports = { OsethClient, DIRECTIONS, parseLineString };
