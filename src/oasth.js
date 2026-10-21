
const crypto = require("node:crypto");

const BASE_URL = "https://telematics.oasth.gr/api/";
const ROUTE_CODE = "192";
const TARGET_STOP_ID = "1221";

class OasthClient {
  constructor() {
    this.cookie = "";
    this.tokenDate = "";
    this.token = "";
    this.routeData = null;
  }

  refreshTokenIfNeeded() {
    const date = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Athens",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .format(new Date())
      .replaceAll("-", "");

    if (date !== this.tokenDate) {
      const phrase = `o@sthW38T3l3m@t!c$$-1${date}`;
      this.token = crypto
        .createHash("sha256")
        .update(phrase)
        .digest("hex");
      this.tokenDate = date;
    }
  }

  async request(action, params = {}) {
    this.refreshTokenIfNeeded();

    const url = new URL(BASE_URL);
    url.searchParams.set("act", action);

    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    const response = await fetch(url, {
      headers: {
        Accept: "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9,el;q=0.8",
        Referer: "https://telematics.oasth.gr/",
        Origin: "https://telematics.oasth.gr",
        "X-CSRF-TOKEN": this.token,
        ...(this.cookie ? { Cookie: this.cookie } : {}),
      },
      signal: AbortSignal.timeout(15000),
    });

    const setCookies = response.headers.getSetCookie?.() ?? [];

    for (const setCookie of setCookies) {
      const match = setCookie.match(/(?:^|;\s*)PHPSESSID=([^;]+)/i);
      if (match) {
        this.cookie = `PHPSESSID=${match[1]}`;
      }
    }

    const text = await response.text();

    if (!response.ok) {
      throw new Error(`OASTH returned HTTP ${response.status}`);
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error("OASTH returned invalid JSON");
    }

    if (
      !Array.isArray(data) &&
      data &&
      typeof data === "object" &&
      data.error
    ) {
      throw new Error(`OASTH API error: ${data.error}`);
    }

    return data;
  }

  async warmUp() {
    // OASTH requires the CSRF token even on the initial session request.
    return this.request("webGetLangs");
  }

  async getLiveBuses() {
    if (!this.cookie) {
      await this.warmUp();
    }

    return this.request("getBusLocation", {
      p1: ROUTE_CODE,
    });
  }

  async getRouteData() {
    if (!this.routeData) {
      if (!this.cookie) {
        await this.warmUp();
      }

      this.routeData = await this.request(
        "webGetRoutesDetailsAndStops",
        { p1: ROUTE_CODE }
      );
    }

    return this.routeData;
  }

  async getLiveSnapshot() {
    // Establish one OASTH session before making concurrent requests.
    if (!this.cookie) {
      await this.warmUp();
    }

    const [buses, route] = await Promise.all([
      this.getLiveBuses(),
      this.getRouteData(),
    ]);

    const stops = route.stops ?? [];
    const targetStop = stops.find(
      (stop) => String(stop.StopID) === TARGET_STOP_ID
    );

    if (!targetStop) {
      throw new Error(`Target stop ${TARGET_STOP_ID} was not found`);
    }

    return {
      fetchedAt: new Date().toISOString(),
      routeCode: ROUTE_CODE,
      targetStop,
      buses,
    };
  }
}

module.exports = { OasthClient };
