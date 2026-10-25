



const enableButton = document.getElementById("enableButton");
const permissionStatus = document.getElementById("permissionStatus");
const connection = document.getElementById("connection");
const lastUpdated = document.getElementById("lastUpdated");
const busList = document.getElementById("busList");
const refreshButton = document.getElementById("refreshButton");



function updatePermissionStatus() {
  if (!("Notification" in window) || !("serviceWorker" in navigator)) {
    permissionStatus.textContent =
      "This browser does not support the required notification features.";
    enableButton.disabled = true;
    return;
  }

  if (Notification.permission === "denied") {
    permissionStatus.textContent =
      "Notifications are blocked. Change this site's notification permission in browser settings.";
    enableButton.disabled = true;
  } else if (Notification.permission === "granted") {
    permissionStatus.textContent =
      "Permission granted. Tap below to connect push notifications.";
    enableButton.disabled = false;
  } else {
    permissionStatus.textContent =
      "Tap below to allow and configure push notifications.";
    enableButton.disabled = false;
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

enableButton.addEventListener("click", async () => {
  enableButton.disabled = true;
  enableButton.textContent = "Connecting…";

  try {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
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

    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
    }

    const response = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(subscription),
    });

    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Subscription failed.");

    permissionStatus.textContent =
      "Push notifications connected. A test notification should arrive shortly.";
  } catch (error) {
    permissionStatus.textContent = error.message;
  } finally {
    enableButton.textContent = "Enable push notifications";
    enableButton.disabled = Notification.permission === "denied";
    updatePermissionStatusAfterAttempt();
  }
});

function updatePermissionStatusAfterAttempt() {
  if (Notification.permission === "granted") {
    enableButton.textContent = "Enable push notifications";
    enableButton.disabled = false;
  }
}

function renderStatus(result) {
  const data = result.data;

  if (!data) {
    connection.textContent = "Waiting for data";
    lastUpdated.textContent = result.lastError || "No bus data received yet.";
    busList.innerHTML = "<p class='muted'>Waiting for OASTH data…</p>";
    return;
  }

  connection.textContent = result.lastError ? "Feed issue" : "Connected";
  lastUpdated.textContent =
    `Server checked: ${new Date(data.observedAt).toLocaleTimeString()}`;

  const approachingBuses = data.buses.filter(
  (bus) => bus.hasPassedStop !== true
  );

  if (!approachingBuses.length) { 
    busList.innerHTML =
      "<p class='muted'>No buses are approaching your stop right now.</p>";
    return;
  }

  busList.replaceChildren();

  for (const bus of approachingBuses) {
    const card = document.createElement("div");
    card.className = "bus";

    const title = document.createElement("strong");
    title.textContent = `Bus ${bus.vehicleNumber}`;

    const status = document.createElement("p");
    const descriptions = {
      "not-approaching": "This bus has passed the stop or is not on a valid approach.",
      "collecting-data": "Collecting movement data to estimate arrival.",
      estimated: "An initial ETA estimate is available.",
    };
    status.textContent = descriptions[bus.status] || "Status unavailable.";

    const eta = document.createElement("p");
    eta.textContent = bus.etaMinutes !== null
      ? `Estimated arrival: ${bus.etaMinutes} min` +
        (bus.speedKmh !== null ? ` · ${bus.speedKmh} km/h` : "")
      : "ETA unavailable";

    const distance = document.createElement("p");
    distance.className = "muted";
    distance.textContent = bus.distanceToStopMeters === null
      ? "No remaining distance: bus may have passed the stop."
      : `${bus.distanceToStopMeters} m along the route to ΕΚΚΛΗΣΙΑ`;

    card.append(title, status, eta, distance);
    busList.append(card);
  }
}

async function loadStatus() {
  try {
    const response = await fetch("/api/status", { cache: "no-store" });
    if (!response.ok) throw new Error(`Server returned HTTP ${response.status}`);
    renderStatus(await response.json());
  } catch (error) {
    connection.textContent = "Disconnected";
    lastUpdated.textContent = error.message;
  }
}

refreshButton.addEventListener("click", loadStatus);

updatePermissionStatus();
loadStatus();
setInterval(loadStatus, 15000);
