const axios = require("axios");

const SEARCH_CONSOLE_SCOPE = "https://www.googleapis.com/auth/webmasters";
const SEARCH_CONSOLE_API_BASE = "https://www.googleapis.com/webmasters/v3";
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

async function submitSitemapToSearchConsole(sitemapUrl) {
  const siteUrl = process.env.GOOGLE_SEARCH_CONSOLE_SITE_URL;
  if (!siteUrl) {
    return {
      submitted: false,
      skipped: true,
      reason: "GOOGLE_SEARCH_CONSOLE_SITE_URL is not set.",
    };
  }

  const accessToken = await getAccessToken();
  if (!accessToken) {
    return {
      submitted: false,
      skipped: true,
      reason: "GOOGLE_SERVICE_ACCOUNT_JSON is not set.",
    };
  }

  const endpoint = `${SEARCH_CONSOLE_API_BASE}/sites/${encodeURIComponent(
    siteUrl
  )}/sitemaps/${encodeURIComponent(sitemapUrl)}`;

  await axios({
    method: "PUT",
    url: endpoint,
    timeout: REQUEST_TIMEOUT_MS,
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  return {
    submitted: true,
    skipped: false,
    siteUrl,
    sitemapUrl,
  };
}

module.exports = {
  submitSitemapToSearchConsole,
};
