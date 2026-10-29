const fs = require("fs");
const path = require("path");

const settingsFile =
  process.env.NOTIFICATION_SETTINGS_FILE ||
  (process.env.SUBSCRIPTIONS_FILE
    ? path.join(path.dirname(process.env.SUBSCRIPTIONS_FILE),
        "notification-settings.json")
    : path.join(__dirname, "../notification-settings.json"));

const DEFAULT_SETTINGS = {
  notificationsEnabled: true,
  scheduleEnabled: true,
  startTime: "07:00",
  endTime: "09:00",
  weekdays: [1, 2, 3, 4, 5],
  timeZone: "Europe/Athens",
};

function isValidTime(value) {
  return typeof value === "string" &&
    /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function normalizeSettings(input = {}) {
  const weekdays = Array.isArray(input.weekdays)
    ? [...new Set(input.weekdays.filter(
        (day) => Number.isInteger(day) && day >= 0 && day <= 6
      ))].sort()
    : DEFAULT_SETTINGS.weekdays;

  return {
    notificationsEnabled:
      typeof input.notificationsEnabled === "boolean"
        ? input.notificationsEnabled
        : DEFAULT_SETTINGS.notificationsEnabled,
    scheduleEnabled:
      typeof input.scheduleEnabled === "boolean"
        ? input.scheduleEnabled
        : DEFAULT_SETTINGS.scheduleEnabled,
    startTime: isValidTime(input.startTime)
      ? input.startTime
      : DEFAULT_SETTINGS.startTime,
    endTime: isValidTime(input.endTime)
      ? input.endTime
      : DEFAULT_SETTINGS.endTime,
    weekdays,
    timeZone: "Europe/Athens",
  };
}

class NotificationSettings {
  constructor(file = settingsFile) {
    this.file = file;
    this.settings = this.load();
  }

  load() {
    try {
      return normalizeSettings(
        JSON.parse(fs.readFileSync(this.file, "utf8"))
      );
    } catch (error) {
      if (error.code !== "ENOENT") {
        console.error("Could not read notification settings:", error.message);
      }
      return { ...DEFAULT_SETTINGS, weekdays: [...DEFAULT_SETTINGS.weekdays] };
    }
  }

  get() {
    return {
      ...this.settings,
      weekdays: [...this.settings.weekdays],
    };
  }

  update(input) {
    const next = normalizeSettings(input);
    const directory = path.dirname(this.file);

    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(next, null, 2), {
      mode: 0o600,
    });

    this.settings = next;
    return this.get();
  }

  isAllowedAt(date = new Date()) {
    const settings = this.settings;

    if (!settings.notificationsEnabled) return false;
    if (!settings.scheduleEnabled) return true;

    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: settings.timeZone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);

    const values = Object.fromEntries(
      parts.map(({ type, value }) => [type, value])
    );

    const dayNumbers = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
    };

    const day = dayNumbers[values.weekday];
    const currentMinutes = Number(values.hour) * 60 + Number(values.minute);
    const startMinutes = Number(settings.startTime.slice(0, 2)) * 60 +
      Number(settings.startTime.slice(3));
    const endMinutes = Number(settings.endTime.slice(0, 2)) * 60 +
      Number(settings.endTime.slice(3));

    if (!settings.weekdays.includes(day)) return false;

    if (startMinutes === endMinutes) return false;

    if (startMinutes < endMinutes) {
      return currentMinutes >= startMinutes && currentMinutes < endMinutes;
    }

    // A window crossing midnight is active after its start or before its end.
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  }
}

module.exports = {
  NotificationSettings,
  DEFAULT_SETTINGS,
  normalizeSettings,
};
