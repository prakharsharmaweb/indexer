const axios = require("axios");
const { normalizeHttpUrl } = require("../urlUtils");

const REQUEST_TIMEOUT_MS = Number(process.env.CRAWLER_TIMEOUT_MS || 10000);

const FETCH_PROFILES = [
  {
    profile: "Desktop Browser",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  },
  {
    profile: "Mobile Browser",
    userAgent:
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Mobile Safari/537.36",
  },
];

async function fetchProfile(targetUrl, profile) {
  const startedAt = Date.now();
  const response = await axios({
    method: "GET",
    url: targetUrl,
    timeout: REQUEST_TIMEOUT_MS,
    maxRedirects: 5,
    validateStatus: () => true,
    responseType: "text",
    headers: {
      "User-Agent": profile.userAgent,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    },
  });

  return {
    profile: profile.profile,
    success: response.status >= 200 && response.status < 400,
    status: response.status,
    latencyMs: Date.now() - startedAt,
    finalUrl:
      response.request?.res?.responseUrl || response.config?.url || targetUrl,
    contentType: String(response.headers["content-type"] || "").toLowerCase(),
    bytes:
      typeof response.data === "string"
        ? Buffer.byteLength(response.data)
        : 0,
  };
}

async function crawlerService(url) {
  const normalizedUrl = normalizeHttpUrl(url);
  const fetches = [];

  for (const profile of FETCH_PROFILES) {
    try {
      fetches.push(await fetchProfile(normalizedUrl, profile));
    } catch (error) {
      fetches.push({
        profile: profile.profile,
        success: false,
        error: error.message,
      });
    }
  }

  return {
    url: normalizedUrl,
    fetches,
    fetchProfilesAttempted: FETCH_PROFILES.length,
  };
}

module.exports = crawlerService;
