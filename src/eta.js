const EARTH_RADIUS_METERS = 6371000;

function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

function distanceMeters(a, b) {
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const dLat = lat2 - lat1;
  const dLng = toRadians(b.lng - a.lng);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_METERS *
    Math.asin(Math.sqrt(Math.min(1, h)));
}

function projectPoint(point, a, b) {
  const referenceLat = toRadians(point.lat);
  const metersPerDegreeLat = 111132;
  const metersPerDegreeLng =
    111320 * Math.cos(referenceLat);

  const ax = (a.lng - point.lng) * metersPerDegreeLng;
  const ay = (a.lat - point.lat) * metersPerDegreeLat;
  const bx = (b.lng - point.lng) * metersPerDegreeLng;
  const by = (b.lat - point.lat) * metersPerDegreeLat;

  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;

  const t = lengthSquared === 0
    ? 0
    : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSquared));

  const projected = {
    lat: a.lat + t * (b.lat - a.lat),
    lng: a.lng + t * (b.lng - a.lng),
  };

  return {
    t,
    offsetMeters: distanceMeters(point, projected),
  };
}

// Turns the feed's route geometry into an ordered polyline with the
// cumulative distance from the start of the route at every point.
function buildRoute(routeDetails) {
  const points = (routeDetails ?? [])
    .map((p) => ({
      lat: Number(p.routed_y),
      lng: Number(p.routed_x),
      order: Number(p.routed_order),
    }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
    .sort((a, b) => a.order - b.order);

  if (points.length < 2) {
    throw new Error("Not enough route geometry to calculate distance");
  }

  const cumulative = [0];

  for (let i = 1; i < points.length; i++) {
    cumulative[i] =
      cumulative[i - 1] + distanceMeters(points[i - 1], points[i]);
  }

  return { points, cumulative };
}

// Finds where a point sits on the route. `fromMeters` restricts the search
// to the part of the route at or after that distance, which keeps stops in
// order where the route runs along the same street twice.
function locateOnRoute(point, route, fromMeters = 0) {
  const { points, cumulative } = route;
  let best = null;

  for (let i = 0; i < points.length - 1; i++) {
    if (cumulative[i + 1] < fromMeters) continue;

    const segmentLength = cumulative[i + 1] - cumulative[i];
    const end = points[i + 1];
    let start = points[i];
    let startMeters = cumulative[i];

    // Only the part of this segment at or after fromMeters is eligible.
    if (startMeters < fromMeters && segmentLength > 0) {
      const skip = (fromMeters - startMeters) / segmentLength;
      start = {
        lat: start.lat + skip * (end.lat - start.lat),
        lng: start.lng + skip * (end.lng - start.lng),
      };
      startMeters = fromMeters;
    }

    const projection = projectPoint(point, start, end);
    const alongMeters =
      startMeters + projection.t * (cumulative[i + 1] - startMeters);

    if (!best || projection.offsetMeters < best.offsetMeters) {
      best = { alongMeters, offsetMeters: projection.offsetMeters };
    }
  }

  return best;
}

function locateStops(stops, route) {
  let previousAlong = 0;

  return [...(stops ?? [])]
    .sort((a, b) => a.sequence - b.sequence)
    .map((stop) => {
      const location = locateOnRoute(
        { lat: Number(stop.latitude), lng: Number(stop.longitude) },
        route,
        previousAlong
      );

      previousAlong = location.alongMeters;

      return {
        id: String(stop.id),
        name: stop.name,
        sequence: stop.sequence,
        alongMeters: Math.round(location.alongMeters),
      };
    });
}

function locateBuses(buses, route) {
  return (buses ?? []).map((bus) => {
    const position = { lat: Number(bus.CS_LAT), lng: Number(bus.CS_LNG) };
    const location = locateOnRoute(position, route);

    return {
      vehicleNumber: bus.VEH_NO,
      busTimestamp: bus.CS_DATE,
      latitude: position.lat,
      longitude: position.lng,
      distanceFromRouteMeters: Math.round(location.offsetMeters),
      alongRouteMeters: Math.round(location.alongMeters),
    };
  });
}

module.exports = { buildRoute, locateOnRoute, locateStops, locateBuses };
