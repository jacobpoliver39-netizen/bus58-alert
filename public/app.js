const PREFS_KEY = "bus58-prefs";

const DEFAULT_SETTINGS = {
  notificationsEnabled: true,
  scheduleEnabled: true,
  startTime: "07:00",
  endTime: "09:00",
  weekdays: [1, 2, 3, 4, 5],
  leadMinutes: 10,
};

const enableButton = document.getElementById("enableButton");
const permissionStatus = document.getElementById("permissionStatus");
const connection = document.getElementById("connection");
const lastUpdated = document.getElementById("lastUpdated");
const busList = document.getElementById("busList");
const refreshButton = document.getElementById("refreshButton");
const directionSelect = document.getElementById("directionSelect");
const stopSelect = document.getElementById("stopSelect");
const stopName = document.getElementById("stopName");
const stopSummary = document.getElementById("stopSummary");
const notificationsEnabledInput =
  document.getElementById("notificationsEnabled");
const scheduleEnabledInput = document.getElementById("scheduleEnabled");
const scheduleOptions = document.getElementById("scheduleOptions");
const startTimeInput = document.getElementById("startTime");
const endTimeInput = document.getElementById("endTime");
const leadMinutesSelect = document.getElementById("leadMinutes");
const saveSettingsButton = document.getElementById("saveSettingsButton");
const settingsStatus = document.getElementById("settingsStatus");

// This device's own choices. They live in this browser and, once push is
// enabled, in this device's record on the server.
let prefs = {
  direction: "outbound",
  stopId: "",
  settings: { ...DEFAULT_SETTINGS },
};
let directions = [];
let subscription = null;

function readLocalPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY));
    if (!saved || typeof saved !== "object") return null;

    return {
      direction: saved.direction || "outbound",
      stopId: saved.stopId || "",
      settings: { ...DEFAULT_SETTINGS, ...saved.settings },
    };
  } catch {
    return null;
  }
}

function writeLocalPrefs() {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Private browsing: preferences then last only for this visit.
  }
}

function pushSupported() {
  return (
    "Notification" in window &&
    "serviceWorker" in navigator &&
    "PushManager" in window
  );
}

async function findExistingSubscription() {
  if (!pushSupported()) return null;

  try {
    const registration = await navigator.serviceWorker.getRegistration();
    return registration
      ? await registration.pushManager.getSubscription()
      : null;
  } catch {
    return null;
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  const raw = atob(base64);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

/* ---------- Stop selection ---------- */

function currentDirection() {
  return directions.find((item) => item.id === prefs.direction);
}

function currentStop() {
  return currentDirection()?.stops.find((stop) => stop.id === prefs.stopId);
}

function renderStopPicker() {
  directionSelect.replaceChildren(
    ...directions.map((item) => new Option(item.label, item.id))
  );
  directionSelect.value = prefs.direction;
  directionSelect.disabled = directions.length === 0;

  const stops = currentDirection()?.stops ?? [];

  stopSelect.replaceChildren(
    new Option(stops.length ? "Choose a stop…" : "Loading stops…", ""),
    ...stops.map(
      (stop) => new Option(`${stop.sequence}. ${stop.name}`, stop.id)
    )
  );
  stopSelect.value = currentStop() ? prefs.stopId : "";
  stopSelect.disabled = stops.length === 0;

  const stop = currentStop();

  if (stop) {
    stopName.textContent = stop.name;
    stopSummary.textContent =
      `Stop ${stop.id} · Route 58 ${currentDirection().label.toLowerCase()}`;
  } else {
    stopName.textContent = "Choose your stop";
    stopSummary.textContent =
      "Pick the direction you travel in, then the stop you board at.";
  }
}

async function loadRoutes() {
  try {
    const response = await fetch("/api/routes", { cache: "no-store" });
    if (!response.ok) throw new Error(`Server returned HTTP ${response.status}`);

    directions = (await response.json()).directions;

    if (!currentDirection() && directions.length) {
      prefs.direction = directions[0].id;
    }
  } catch (error) {
    stopSummary.textContent = `Could not load stops: ${error.message}`;
  }

  renderStopPicker();

  // The server may still be fetching the stop lists right after it starts.
  if (directions.length === 0 || directions.some((item) => !item.stops.length)) {
    setTimeout(loadRoutes, 5000);
  }
}

directionSelect.addEventListener("change", () => {
  prefs.direction = directionSelect.value;
  prefs.stopId = "";
  writeLocalPrefs();
  renderStopPicker();
  loadStatus();
});

stopSelect.addEventListener("change", async () => {
  prefs.stopId = stopSelect.value;
  writeLocalPrefs();
  renderStopPicker();
  loadStatus();

  if (prefs.stopId && subscription) {
    try {
      await syncDevice();
      settingsStatus.textContent =
        `Alerts now follow ${currentStop().name}.`;
    } catch (error) {
      settingsStatus.textContent = `Could not save your stop: ${error.message}`;
    }
  }
});

/* ---------- Server sync ---------- */

// Sends this device's stop and preferences to the server.
async function syncDevice() {
  const response = await fetch("/api/device", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      subscription,
      direction: prefs.direction,
      stopId: prefs.stopId,
      settings: prefs.settings,
    }),
  });

  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.error || `Server returned HTTP ${response.status}`);
  }

  prefs.settings = result.settings;
  writeLocalPrefs();
  return result;
}

async function lookupDevice() {
  try {
    const response = await fetch("/api/device/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: subscription.endpoint }),
    });

    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

/* ---------- Push notifications ---------- */

function updatePermissionStatus() {
  enableButton.textContent = "Enable push notifications";

  if (!pushSupported()) {
    permissionStatus.textContent =
      "This browser does not support push notifications. On iPhone, add " +
      "the app to your Home Screen first.";
    enableButton.disabled = true;
    return;
  }

  if (Notification.permission === "denied") {
    permissionStatus.textContent =
      "Notifications are blocked. Change this site's notification " +
      "permission in your browser settings.";
    enableButton.disabled = true;
    return;
  }

  enableButton.disabled = false;

  if (subscription && Notification.permission === "granted") {
    enableButton.textContent = "Reconnect push notifications";
    permissionStatus.textContent = currentStop()
      ? "Push notifications are connected on this device."
      : "Push notifications are connected. Choose a stop to get alerts.";
  } else {
    permissionStatus.textContent =
      "Tap above to allow push notifications on this device.";
  }
}

enableButton.addEventListener("click", async () => {
  if (!currentStop()) {
    permissionStatus.textContent = "Choose your stop first.";
    stopSelect.focus();
    return;
  }

  enableButton.disabled = true;
  enableButton.textContent = "Connecting…";

  let message = null;

  try {
    if (!pushSupported()) {
      throw new Error("Push notifications are not supported in this browser.");
    }

    if (!window.isSecureContext) {
      throw new Error("Push setup requires HTTPS, or localhost for local testing.");
    }

    const permission = await Notification.requestPermission();

    if (permission !== "granted") {
      throw new Error("Notification permission was not granted.");
    }

    const registration = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;

    const keyResponse = await fetch("/api/push/public-key");
    if (!keyResponse.ok) throw new Error("Could not retrieve the push key.");

    const { publicKey } = await keyResponse.json();

    subscription =
      (await registration.pushManager.getSubscription()) ||
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      }));

    readSettingsForm();
    const result = await syncDevice();

    message = result.created
      ? "Push notifications connected. A test notification should arrive shortly."
      : "Push notifications are connected on this device.";
  } catch (error) {
    message = error.message;
  }

  updatePermissionStatus();
  permissionStatus.textContent = message;
});

/* ---------- Preferences ---------- */

function updateScheduleControls() {
  const scheduleActive = scheduleEnabledInput.checked;
  scheduleOptions.hidden = !scheduleActive;

  for (const input of scheduleOptions.querySelectorAll("input")) {
    input.disabled = !scheduleActive;
  }
}

function displaySettings(settings) {
  notificationsEnabledInput.checked = settings.notificationsEnabled;
  scheduleEnabledInput.checked = settings.scheduleEnabled;
  startTimeInput.value = settings.startTime;
  endTimeInput.value = settings.endTime;

  const lead = String(settings.leadMinutes);

  if (![...leadMinutesSelect.options].some((option) => option.value === lead)) {
    leadMinutesSelect.add(new Option(`${lead} minutes away`, lead));
  }
  leadMinutesSelect.value = lead;

  const activeDays = new Set(settings.weekdays.map(String));

  document.querySelectorAll('input[name="weekday"]').forEach((input) => {
    input.checked = activeDays.has(input.value);
  });

  updateScheduleControls();
}

function readSettingsForm() {
  prefs.settings = {
    notificationsEnabled: notificationsEnabledInput.checked,
    scheduleEnabled: scheduleEnabledInput.checked,
    startTime: startTimeInput.value || DEFAULT_SETTINGS.startTime,
    endTime: endTimeInput.value || DEFAULT_SETTINGS.endTime,
    weekdays: Array.from(
      document.querySelectorAll('input[name="weekday"]:checked'),
      (input) => Number(input.value)
    ),
    leadMinutes: Number(leadMinutesSelect.value),
  };
}

scheduleEnabledInput.addEventListener("change", updateScheduleControls);

saveSettingsButton.addEventListener("click", async () => {
  const weekdayCount = document.querySelectorAll(
    'input[name="weekday"]:checked'
  ).length;

  if (scheduleEnabledInput.checked && weekdayCount === 0) {
    settingsStatus.textContent =
      "Select at least one active day, or turn off the schedule.";
    return;
  }

  if (
    scheduleEnabledInput.checked &&
    startTimeInput.value === endTimeInput.value
  ) {
    settingsStatus.textContent = "Start and end times cannot be the same.";
    return;
  }

  readSettingsForm();
  writeLocalPrefs();

  if (!subscription) {
    settingsStatus.textContent =
      "Preferences saved on this device. Enable push notifications to " +
      "start receiving alerts.";
    return;
  }

  if (!currentStop()) {
    settingsStatus.textContent =
      "Preferences saved. Choose a stop to start receiving alerts.";
    return;
  }

  saveSettingsButton.disabled = true;
  settingsStatus.textContent = "Saving preferences…";

  try {
    await syncDevice();
    displaySettings(prefs.settings);
    settingsStatus.textContent = "Preferences saved for this device.";
  } catch (error) {
    settingsStatus.textContent = `Could not save preferences: ${error.message}`;
  } finally {
    saveSettingsButton.disabled = false;
  }
});

/* ---------- Live status ---------- */

function renderStatus(status) {
  connection.textContent = status.lastError ? "Feed issue" : "Connected";
  lastUpdated.textContent =
    `Server checked: ${new Date(status.observedAt).toLocaleTimeString()}`;

  const approaching = status.buses
    .filter((bus) => bus.approaching)
    .sort((a, b) => a.distanceToStopMeters - b.distanceToStopMeters);

  if (!approaching.length) {
    busList.innerHTML =
      "<p class='muted'>No buses are approaching your stop right now.</p>";
    return;
  }

  busList.replaceChildren();

  for (const bus of approaching) {
    const card = document.createElement("div");
    card.className = "bus";

    const title = document.createElement("strong");
    title.textContent = `Bus ${bus.vehicleNumber}`;

    const eta = document.createElement("p");
    eta.textContent =
      `Estimated arrival: ${bus.etaMinutes} min` +
      (bus.speedKmh !== null ? ` · ${bus.speedKmh} km/h` : "");

    const distance = document.createElement("p");
    distance.className = "muted";
    distance.textContent =
      `${bus.distanceToStopMeters} m along the route to ${status.stop.name}`;

    card.append(title, eta, distance);
    busList.append(card);
  }
}

async function loadStatus() {
  if (!prefs.stopId) {
    connection.textContent = "No stop";
    lastUpdated.textContent = "Choose your stop to see live buses.";
    busList.replaceChildren();
    return;
  }

  const requested = `${prefs.direction}:${prefs.stopId}`;

  try {
    const query = new URLSearchParams({
      direction: prefs.direction,
      stop: prefs.stopId,
    });
    const response = await fetch(`/api/status?${query}`, { cache: "no-store" });
    const result = await response.json();

    // Ignore a reply for a stop the user has since moved away from.
    if (requested !== `${prefs.direction}:${prefs.stopId}`) return;

    if (!response.ok) {
      connection.textContent = "Waiting for data";
      lastUpdated.textContent =
        result.error || `Server returned HTTP ${response.status}`;
      busList.replaceChildren();
      return;
    }

    renderStatus(result);
  } catch (error) {
    connection.textContent = "Disconnected";
    lastUpdated.textContent = error.message;
  }
}

refreshButton.addEventListener("click", loadStatus);

/* ---------- Start-up ---------- */

async function start() {
  const local = readLocalPrefs();
  if (local) prefs = local;

  subscription = await findExistingSubscription();

  // A device that subscribed before preferences were stored locally (or
  // whose browser storage was cleared) gets its saved choices back.
  if (!local && subscription) {
    const saved = await lookupDevice();

    if (saved) {
      prefs = {
        direction: saved.direction,
        stopId: saved.stopId,
        settings: { ...DEFAULT_SETTINGS, ...saved.settings },
      };
      writeLocalPrefs();
    }
  }

  displaySettings(prefs.settings);
  await loadRoutes();
  updatePermissionStatus();
  loadStatus();
  setInterval(loadStatus, 15000);

  // Keep the server's copy in step, including after the server lost it.
  if (subscription && currentStop()) {
    syncDevice().catch(() => {});
  }
}

start();
