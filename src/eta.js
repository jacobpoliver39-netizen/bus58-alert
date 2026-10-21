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
    point: projected,
    t,
    offsetMeters: distanceMeters(point, projected),
  };
}

function locateOnRoute(point, routePoints, cumulative) {
  let best = null;

  for (let i = 0; i < routePoints.length - 1; i++) {
    const a = routePoints[i];
    const b = routePoints[i + 1];
    const projection = projectPoint(point, a, b);
    const segmentLength = cumulative[i + 1] - cumulative[i];

    const candidate = {
      segmentIndex: i,
      alongMeters: cumulative[i] + projection.t * segmentLength,
      offsetMeters: projection.offsetMeters,
    };

    if (!best || candidate.offsetMeters < best.offsetMeters) {
      best = candidate;
    }
  }

  return best;
}

function calculateBusDistances(buses, routeDetails, targetStop) {
  const routePoints = (routeDetails ?? [])
    .map((p) => ({
      lat: Number(p.routed_y),
      lng: Number(p.routed_x),
      order: Number(p.routed_order),
    }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
    .sort((a, b) => a.order - b.order);

  if (routePoints.length < 2) {
    throw new Error("Not enough route geometry to calculate distance");
  }

  const cumulative = [0];

  for (let i = 1; i < routePoints.length; i++) {
    cumulative[i] =
      cumulative[i - 1] + distanceMeters(routePoints[i - 1], routePoints[i]);
  }

  const target = {
    lat: Number(targetStop.StopLat),
    lng: Number(targetStop.StopLng),
  };

  const targetLocation = locateOnRoute(target, routePoints, cumulative);

  return (buses ?? []).map((bus) => {
    const location = {
      lat: Number(bus.CS_LAT),
      lng: Number(bus.CS_LNG),
    };

    const busLocation = locateOnRoute(location, routePoints, cumulative);
    const remaining = targetLocation.alongMeters - busLocation.alongMeters;

    return {
      vehicleNumber: bus.VEH_NO,
      busTimestamp: bus.CS_DATE,
      latitude: location.lat,
      longitude: location.lng,
      distanceFromRouteMeters: Math.round(busLocation.offsetMeters),
      alongRouteMeters: Math.round(busLocation.alongMeters),
      targetAlongRouteMeters: Math.round(targetLocation.alongMeters),
      distanceToStopMeters:
        remaining >= 0 ? Math.round(remaining) : null,
      hasPassedStop: remaining < 0,
    };
  });
}

module.exports = { calculateBusDistances };
