# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Node/Express PWA ("Jacob's 58-Mate") for riders of Thessaloniki bus 58. Each installed copy picks a direction and a stop, sees live buses approaching that stop, and gets a web-push notification when a bus is a chosen number of minutes away. Stop and preferences are per device. No build step, no framework, no database: plain CommonJS on the server, static files in `public/`, one JSON file on disk for state.

## Commands

```bash
npm start                              # node src/server.js (port 3000, or $PORT)
npm run dev                            # nodemon, watches src/ and public/
npm test                               # node --test (built-in runner, all of tests/)
node --test tests/tracker.test.js      # one file
node --test --test-name-pattern="ETA"  # tests matching a name
```

There is no linter or formatter configured.

The server exits at startup unless `.env` defines `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT`. Optional: `PORT`, `DEVICES_FILE`. `SUBSCRIPTIONS_FILE` and `NOTIFICATION_SETTINGS_FILE` belong to the old single-stop version; they are now only read once for migration, and the directory of `SUBSCRIPTIONS_FILE` is where `devices.json` goes when `DEVICES_FILE` is unset.

When running the server locally, point `DEVICES_FILE` and `SUBSCRIPTIONS_FILE` at a scratch directory. Otherwise real subscriptions in the repo root are loaded and real pushes can be sent.

## Architecture

Data flows one way, every 30 seconds:

```
OsethClient x2 ──▶ BusTracker ──▶ NotificationManager ──▶ web-push
 (oseth.js)        (tracker.js,    (notifications.js)
 one per            eta.js)              ▲
 direction             │                 │
                       ▼            DeviceStore (devices.js)
              GET /api/status       + schedule rules
              GET /api/routes         (notification-settings.js)
```

`src/server.js` wires these together and owns the HTTP routes.

- **Directions and stops.** `DIRECTIONS` in `src/oseth.js` holds the OSETH route and shape IDs for `outbound` (toward Panorama/Chortiatis) and `inbound` (toward Venizelou). Stop IDs differ between directions, so a stop is always the pair (direction, stopId). Nothing about any particular stop is hard-coded except the legacy migration.
- **Data source.** One `OsethClient` per direction; a single request returns route geometry, stops and live vehicles. Vehicles and geometry are normalized into the old OASTH field shapes (`VEH_NO`, `CS_LAT`, `CS_LNG`, `routed_x`/`routed_y`/`routed_order`) that `eta.js` consumes. `src/oasth.js` is the previous data source and is not imported anywhere.
- **Geometry.** `src/eta.js` projects stops and buses onto the route polyline to get metres from the route start. Stops are located in sequence order, each at or after the previous one, so they stay ordered where a route reuses a street.
- **Tracking.** `BusTracker` stores, per direction, stop positions and bus positions. It is stop-agnostic; `getStopStatus(direction, stopId)` derives distance, `approaching` and ETA for one stop on demand. A failing direction keeps its last good data and reports the error. ETA is intentionally *not* derived from measured speed: it is distance divided by a fixed pace (`METERS_PER_MINUTE`, 4299 m in 18 min). Measured speed is display only.
- **Devices.** `DeviceStore` keeps one record per push subscription: `{ id, subscription, direction, stopId, settings }`, with `id` = SHA-256 of the push endpoint. There are no accounts; knowing the endpoint is the credential (`POST /api/device/lookup`, `PUT /api/device`). Endpoints must be HTTPS on a known push-service host, so the server cannot be pointed at arbitrary URLs.
- **Notifications.** `NotificationManager.checkAll` runs after every refresh and, per device, alerts once per vehicle when the bus is approaching that device's stop, its ETA is within the device's `leadMinutes`, and the device's schedule allows it. Outside the schedule the alert is not consumed, so it fires when the window opens. A vehicle is re-armed when seen past the stop or off route, or after 15 minutes without being seen approaching. A device is deleted when the push service answers 404/410.
- **Settings.** `notification-settings.js` is pure: `normalizeSettings` falls back to defaults field by field rather than rejecting, and `isAllowedAt(settings, date)` evaluates the weekday/time window in `Europe/Athens` (windows may cross midnight).

### State

`devices.json` is gitignored, written atomically with mode 0600, and rewritten in full on every change. On first start without it, `DeviceStore` imports `push-subscriptions.json` + `notification-settings.json` from the single-stop version as outbound stop 1221 with a 20-minute lead. The already-notified map and speed history are in memory only, so a restart can re-notify for a bus already inside a device's lead time.

### Frontend

`public/app.js` keeps this device's direction, stop and settings in `localStorage` (`bus58-prefs`) and mirrors them to the server with `PUT /api/device` whenever a push subscription exists, including once on every load so a server that lost its data recovers. A device with a subscription but no local prefs restores them via `/api/device/lookup`. It polls `/api/status?direction=&stop=` every 15 s. `public/sw.js` only handles `push` and `notificationclick` (no offline caching). Push subscription requires HTTPS or localhost.

## Tests

Tests use `node:test` with `node:assert/strict` and never hit the network: the tracker gets stub clients, notification tests use a fake store and tracker and replace `manager.send`, OSETH tests exercise only the pure parsing/normalizing methods, and device tests use a temp directory. `server.js` has no tests and starts listening on import.
