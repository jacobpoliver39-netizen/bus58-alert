// Per-device notification preferences: pure validation and schedule logic.
// Storage lives in devices.js.

const TIME_ZONE = "Europe/Athens";

const DEFAULT_SETTINGS = {
  notificationsEnabled: true,
  scheduleEnabled: true,
  startTime: "07:00",
  endTime: "09:00",
  weekdays: [1, 2, 3, 4, 5],
  // Alert when a bus is estimated to be this many minutes from the stop.
  leadMinutes: 10,
  timeZone: TIME_ZONE,
};

const MIN_LEAD_MINUTES = 1;
const MAX_LEAD_MINUTES = 120;

function isValidTime(value) {
  return typeof value === "string" &&
    /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function normalizeSettings(input = {}) {
  const source = input && typeof input === "object" ? input : {};

  const weekdays = Array.isArray(source.weekdays)
    ? [...new Set(source.weekdays.filter(
        (day) => Number.isInteger(day) && day >= 0 && day <= 6
      ))].sort()
    : [...DEFAULT_SETTINGS.weekdays];

  const leadMinutes =
    Number.isInteger(source.leadMinutes) &&
    source.leadMinutes >= MIN_LEAD_MINUTES &&
    source.leadMinutes <= MAX_LEAD_MINUTES
      ? source.leadMinutes
      : DEFAULT_SETTINGS.leadMinutes;

  return {
    notificationsEnabled:
      typeof source.notificationsEnabled === "boolean"
        ? source.notificationsEnabled
        : DEFAULT_SETTINGS.notificationsEnabled,
    scheduleEnabled:
      typeof source.scheduleEnabled === "boolean"
        ? source.scheduleEnabled
        : DEFAULT_SETTINGS.scheduleEnabled,
    startTime: isValidTime(source.startTime)
      ? source.startTime
      : DEFAULT_SETTINGS.startTime,
    endTime: isValidTime(source.endTime)
      ? source.endTime
      : DEFAULT_SETTINGS.endTime,
    weekdays,
    leadMinutes,
    timeZone: TIME_ZONE,
  };
}

function toMinutes(time) {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
}

function isAllowedAt(settings, date = new Date()) {
  if (!settings.notificationsEnabled) return false;
  if (!settings.scheduleEnabled) return true;

  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE,
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
  const startMinutes = toMinutes(settings.startTime);
  const endMinutes = toMinutes(settings.endTime);

  if (!settings.weekdays.includes(day)) return false;

  if (startMinutes === endMinutes) return false;

  if (startMinutes < endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }

  // A window crossing midnight is active after its start or before its end.
  return currentMinutes >= startMinutes || currentMinutes < endMinutes;
}

module.exports = {
  DEFAULT_SETTINGS,
  normalizeSettings,
  isAllowedAt,
};
