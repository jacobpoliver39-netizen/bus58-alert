const BASE_URL = "https://oseth.com.gr/en/telematics-api/route";
const ROUTE_ID = "58_7448_2_3";
const SHAPE_ID = "6365";
const TARGET_STOP_ID = "1221";

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

    if (
      coordinates.length < 2 ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      lat < -90 ||
      lat > 90 ||
      lng < -180 ||
      lng > 180
    ) {
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
  constructor() {
    this.routeData = null;
  }

  async fetchRouteInfo() {
    const url = new URL(`${BASE_URL}/${ROUTE_ID}/info`);
    url.searchParams.set("shapeId", SHAPE_ID);
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
      result.data.id !== ROUTE_ID ||
      String(result.data.shape?.id) !== SHAPE_ID
    ) {
      throw new Error("OSETH returned unexpected route or shape data");
    }

    return result.data;
  }

  normalizeRoute(data) {
    const stops = data.stops ?? [];
    const target = stops.find(
      (stop) => String(stop.id) === TARGET_STOP_ID
    );

    if (!target) {
      throw new Error(`Target stop ${TARGET_STOP_ID} was not found`);
    }

    const details = parseLineString(data.shape?.lineString);

    return {
      details,
      stops,
      targetStop: {
        StopID: target.id,
        StopCode: target.code,
        StopName: target.name,
        StopLat: target.latitude,
        StopLng: target.longitude,
      },
    };
  }

  normalizeVehicles(vehicles, fetchedAt) {
    return (vehicles ?? []).map((vehicle) => {
      const lat = Number(vehicle.latitude);
      const lng = Number(vehicle.longitude);

      if (
        vehicle.id == null ||
        !Number.isFinite(lat) ||
        !Number.isFinite(lng) ||
        lat < -90 ||
        lat > 90 ||
        lng < -180 ||
        lng > 180
      ) {
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

  async getLiveSnapshot() {
    const data = await this.fetchRouteInfo();
    const fetchedAt = new Date().toISOString();

    this.routeData = this.normalizeRoute(data);

    return {
      fetchedAt,
      routeCode: "58",
      targetStop: this.routeData.targetStop,
      buses: this.normalizeVehicles(data.vehicles, fetchedAt),
    };
  }

  async getRouteData() {
    if (!this.routeData) {
      const data = await this.fetchRouteInfo();
      this.routeData = this.normalizeRoute(data);
    }

    return this.routeData;
  }
}

module.exports = { OsethClient, parseLineString };
