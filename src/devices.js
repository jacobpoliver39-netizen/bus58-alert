const crypto = require("node:crypto");
const fs = require("fs");
const path = require("path");

const { DIRECTIONS } = require("./oseth");
const { normalizeSettings } = require("./notification-settings");

const MAX_DEVICES = 20000;

// Hosts of the browser push services. Subscriptions pointing anywhere else
// are rejected so the server cannot be made to POST to arbitrary URLs.
const PUSH_HOST_PATTERNS = [
  /^fcm\.googleapis\.com$/,
  /^android\.googleapis\.com$/,
  /(^|\.)push\.apple\.com$/,
  /(^|\.)push\.services\.mozilla\.com$/,
  /(^|\.)notify\.windows\.com$/,
];

function dataDirectory() {
  return process.env.SUBSCRIPTIONS_FILE
    ? path.dirname(process.env.SUBSCRIPTIONS_FILE)
    : path.join(__dirname, "..");
}

function defaultPaths() {
  const directory = dataDirectory();

  return {
    file: process.env.DEVICES_FILE || path.join(directory, "devices.json"),
    legacySubscriptionsFile:
      process.env.SUBSCRIPTIONS_FILE ||
      path.join(directory, "push-subscriptions.json"),
    legacySettingsFile:
      process.env.NOTIFICATION_SETTINGS_FILE ||
      path.join(directory, "notification-settings.json"),
  };
}

function isValidSubscription(subscription) {
  if (
    !subscription ||
    typeof subscription.endpoint !== "string" ||
    subscription.endpoint.length > 2000 ||
    typeof subscription.keys?.p256dh !== "string" ||
    typeof subscription.keys?.auth !== "string"
  ) {
    return false;
  }

  try {
    const url = new URL(subscription.endpoint);
    return (
      url.protocol === "https:" &&
      PUSH_HOST_PATTERNS.some((pattern) => pattern.test(url.hostname))
    );
  } catch {
    return false;
  }
}

function deviceIdFor(endpoint) {
  return crypto.createHash("sha256").update(endpoint).digest("hex");
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.error(`Could not read ${path.basename(file)}:`, error.message);
    }
    return null;
  }
}

// One record per installed copy of the app, keyed by its push endpoint:
// { id, subscription, direction, stopId, settings, updatedAt }.
// The endpoint is known only to that device and the server, so it doubles
// as the credential for reading and changing the record.
class DeviceStore {
  constructor(paths = defaultPaths()) {
    this.file = paths.file;
    this.devices = new Map();

    const saved = readJson(this.file);

    if (Array.isArray(saved)) {
      for (const device of saved) {
        if (device?.id && isValidSubscription(device.subscription)) {
          this.devices.set(device.id, {
            ...device,
            settings: normalizeSettings(device.settings),
          });
        }
      }
    } else if (!fs.existsSync(this.file)) {
      this.importLegacy(paths);
    }
  }

  // Carries over subscribers of the original single-stop version: stop 1221
  // outbound, the shared schedule, and a lead time long enough to keep
  // alerting as soon as a bus appears on the approach.
  importLegacy({ legacySubscriptionsFile, legacySettingsFile }) {
    const subscriptions = legacySubscriptionsFile
      ? readJson(legacySubscriptionsFile)
      : null;

    if (!Array.isArray(subscriptions) || subscriptions.length === 0) return;

    const legacySettings = legacySettingsFile
      ? readJson(legacySettingsFile)
      : null;

    for (const subscription of subscriptions) {
      if (!isValidSubscription(subscription)) continue;

      this.devices.set(deviceIdFor(subscription.endpoint), {
        id: deviceIdFor(subscription.endpoint),
        subscription,
        direction: "outbound",
        stopId: "1221",
        settings: normalizeSettings({ leadMinutes: 20, ...legacySettings }),
        updatedAt: new Date().toISOString(),
      });
    }

    this.save();
    console.log(`Imported ${this.devices.size} legacy subscription(s).`);
  }

  save() {
    const temporary = `${this.file}.tmp`;

    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(
      temporary,
      JSON.stringify([...this.devices.values()], null, 2),
      { mode: 0o600 }
    );
    fs.renameSync(temporary, this.file);
  }

  all() {
    return [...this.devices.values()];
  }

  findByEndpoint(endpoint) {
    if (typeof endpoint !== "string") return null;
    return this.devices.get(deviceIdFor(endpoint)) ?? null;
  }

  // Creates or replaces the record for a subscription.
  // Returns { device, created }.
  upsert({ subscription, direction, stopId, settings }) {
    if (!isValidSubscription(subscription)) {
      throw new RangeError("Invalid push subscription.");
    }

    if (!Object.hasOwn(DIRECTIONS, direction)) {
      throw new RangeError("Unknown direction.");
    }

    if (!/^\d{1,10}$/.test(String(stopId))) {
      throw new RangeError("Unknown stop.");
    }

    const id = deviceIdFor(subscription.endpoint);
    const created = !this.devices.has(id);

    if (created && this.devices.size >= MAX_DEVICES) {
      throw new RangeError("The server cannot accept more devices right now.");
    }

    const device = {
      id,
      subscription: {
        endpoint: subscription.endpoint,
        expirationTime: subscription.expirationTime ?? null,
        keys: {
          p256dh: subscription.keys.p256dh,
          auth: subscription.keys.auth,
        },
      },
      direction,
      stopId: String(stopId),
      settings: normalizeSettings(settings),
      updatedAt: new Date().toISOString(),
    };

    this.devices.set(id, device);
    this.save();

    return { device, created };
  }

  remove(id) {
    if (this.devices.delete(id)) {
      this.save();
    }
  }
}

module.exports = { DeviceStore, isValidSubscription, deviceIdFor };
