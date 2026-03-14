const axios = require("axios");

const SEARCH_CONSOLE_SCOPE = "https://www.googleapis.com/auth/webmasters";
const SEARCH_CONSOLE_API_BASE = "https://www.googleapis.com/webmasters/v3";
const INSPECTION_API_URL =
  "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect";
const REQUEST_TIMEOUT_MS = Number(
  process.env.SEARCH_CONSOLE_TIMEOUT_MS || 10000
);

function getGoogleAuthLibrary() {
  try {
    return require("google-auth-library");
  } catch (error) {
    if (error.code === "MODULE_NOT_FOUND") {
      throw new Error(
        "google-auth-library is not installed. Add it to dependencies and rebuild the container."
      );
    }

    throw error;
  }
}

function getServiceAccountCredentials() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON.");
  }
}

function getConfiguredServiceAccountEmail() {
  return getServiceAccountCredentials()?.client_email || null;
}

async function getAccessToken() {
  const credentials = getServiceAccountCredentials();
  if (!credentials) {
    return null;
  }

  const { GoogleAuth } = getGoogleAuthLibrary();
  const auth = new GoogleAuth({
    credentials,
    scopes: [SEARCH_CONSOLE_SCOPE],
  });
  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();

  return typeof tokenResponse === "string"
    ? tokenResponse
    : tokenResponse?.token || null;
}

function normalizeSiteUrl(siteUrl) {
  if (typeof siteUrl !== "string" || !siteUrl.trim()) {
    throw new Error("siteUrl is required.");
  }

  const trimmed = siteUrl.trim();
  if (trimmed.startsWith("sc-domain:")) {
    return trimmed;
  }

  const parsed = new URL(trimmed);
  if (!/^https?:$/.test(parsed.protocol)) {
    throw new Error("Managed site must be an http(s) URL prefix or sc-domain property.");
  }

  const pathname = parsed.pathname.endsWith("/")
    ? parsed.pathname
    : `${parsed.pathname}/`;

  return `${parsed.origin}${pathname}`;
}

async function authenticatedRequest(config) {
  const accessToken = await getAccessToken();
  if (!accessToken) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not set.");
  }

  return axios({
    timeout: REQUEST_TIMEOUT_MS,
    ...config,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(config.headers || {}),
    },
  });
}

async function listSearchConsoleSites() {
  const response = await authenticatedRequest({
    method: "GET",
    url: `${SEARCH_CONSOLE_API_BASE}/sites`,
  });

  return Array.isArray(response.data?.siteEntry) ? response.data.siteEntry : [];
}

async function listSearchConsoleSitemaps(siteUrl) {
  const normalizedSiteUrl = normalizeSiteUrl(siteUrl);
  const response = await authenticatedRequest({
    method: "GET",
    url: `${SEARCH_CONSOLE_API_BASE}/sites/${encodeURIComponent(
      normalizedSiteUrl
    )}/sitemaps`,
  });

  return Array.isArray(response.data?.sitemap) ? response.data.sitemap : [];
}

async function submitSitemapToSearchConsole(siteUrl, sitemapUrl) {
  const normalizedSiteUrl = normalizeSiteUrl(siteUrl);

  await authenticatedRequest({
    method: "PUT",
    url: `${SEARCH_CONSOLE_API_BASE}/sites/${encodeURIComponent(
      normalizedSiteUrl
    )}/sitemaps/${encodeURIComponent(sitemapUrl)}`,
  });

  return {
    submitted: true,
    skipped: false,
    siteUrl: normalizedSiteUrl,
    sitemapUrl,
  };
}

async function inspectUrlInSearchConsole(siteUrl, inspectionUrl) {
  const normalizedSiteUrl = normalizeSiteUrl(siteUrl);

  const response = await authenticatedRequest({
    method: "POST",
    url: INSPECTION_API_URL,
    headers: {
      "Content-Type": "application/json",
    },
    data: {
      inspectionUrl,
      siteUrl: normalizedSiteUrl,
      languageCode: "en-US",
    },
  });

  const result = response.data?.inspectionResult?.indexStatusResult || {};

  return {
    siteUrl: normalizedSiteUrl,
    inspectionUrl,
    verdict: result.verdict || "UNKNOWN",
    coverageState: result.coverageState || "Unknown",
    indexingState: result.indexingState || "Unknown",
    pageFetchState: result.pageFetchState || "Unknown",
    robotsTxtState: result.robotsTxtState || "Unknown",
    lastCrawlTime: result.lastCrawlTime || null,
    googleCanonical: result.googleCanonical || "",
    userCanonical: result.userCanonical || "",
    referringUrls: Array.isArray(result.referringUrls) ? result.referringUrls : [],
  };
}

module.exports = {
  getConfiguredServiceAccountEmail,
  getServiceAccountCredentials,
  getAccessToken,
  normalizeSiteUrl,
  listSearchConsoleSites,
  listSearchConsoleSitemaps,
  submitSitemapToSearchConsole,
  inspectUrlInSearchConsole,
};
