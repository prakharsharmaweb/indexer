const axios = require("axios");
const { normalizeHttpUrl } = require("../urlUtils");

const INDEXING_API_URL =
  "https://indexing.googleapis.com/v3/urlNotifications:publish";
const INDEXING_SCOPE = "https://www.googleapis.com/auth/indexing";
const MAX_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = Number(
  process.env.GOOGLE_INDEXING_TIMEOUT_MS || 10000
);
const ELIGIBLE_STRUCTURED_DATA_PATTERNS = [
  /jobposting/i,
  /broadcastevent/i,
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not set.");
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON.");
  }
}

async function getAccessToken() {
  const { GoogleAuth } = getGoogleAuthLibrary();
  const credentials = getServiceAccountCredentials();
  const auth = new GoogleAuth({
    credentials,
    scopes: [INDEXING_SCOPE],
  });
  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();
  const token =
    typeof tokenResponse === "string" ? tokenResponse : tokenResponse?.token;

  if (!token) {
    throw new Error("Could not obtain Google access token.");
  }

  return token;
}

async function inspectUrlEligibility(targetUrl) {
  const response = await axios({
    method: "GET",
    url: targetUrl,
    timeout: REQUEST_TIMEOUT_MS,
    maxRedirects: 5,
    validateStatus: () => true,
    responseType: "text",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; GoogleEligibilityChecker/1.0; +https://example.com/bot)",
    },
  });

  const finalUrl =
    response.request?.res?.responseUrl || response.config?.url || targetUrl;
  const contentType = String(response.headers["content-type"] || "").toLowerCase();

  if (response.status < 200 || response.status >= 400) {
    return {
      eligible: false,
      reason: `URL returned HTTP ${response.status}`,
      finalUrl,
      contentType,
    };
  }

  if (
    contentType.includes("application/pdf") ||
    finalUrl.toLowerCase().endsWith(".pdf")
  ) {
    return {
      eligible: false,
      reason: "Google Indexing API does not support PDF URLs.",
      finalUrl,
      contentType,
    };
  }

  if (!contentType.includes("text/html")) {
    return {
      eligible: false,
      reason: `Unsupported content type for Google Indexing API: ${contentType || "unknown"}`,
      finalUrl,
      contentType,
    };
  }

  const html = typeof response.data === "string" ? response.data : "";
  const hasEligibleMarkup = ELIGIBLE_STRUCTURED_DATA_PATTERNS.some((pattern) =>
    pattern.test(html)
  );

  if (!hasEligibleMarkup) {
    return {
      eligible: false,
      reason:
        "Google Indexing API is only for eligible JobPosting or livestream pages.",
      finalUrl,
      contentType,
    };
  }

  return {
    eligible: true,
    finalUrl,
    contentType,
  };
}

async function googleIndexingService(url) {
  const submittedUrl = normalizeHttpUrl(url);
  const eligibility = await inspectUrlEligibility(submittedUrl);

  if (!eligibility.eligible) {
    return {
      skipped: true,
      eligible: false,
      reason: eligibility.reason,
      finalUrl: eligibility.finalUrl,
      contentType: eligibility.contentType,
    };
  }

  let lastError;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const accessToken = await getAccessToken();

      const response = await axios({
        method: "POST",
        url: INDEXING_API_URL,
        timeout: REQUEST_TIMEOUT_MS,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        data: {
          url: eligibility.finalUrl || submittedUrl,
          type: "URL_UPDATED",
        },
      });

      return {
        skipped: false,
        eligible: true,
        status: response.status,
        data: response.data,
        attempts: attempt,
      };
    } catch (error) {
      lastError = error;

      if (attempt < MAX_ATTEMPTS) {
        await sleep(attempt * 1000);
      }
    }
  }

  throw new Error(
    `googleIndexingService failed after ${MAX_ATTEMPTS} attempts: ${
      lastError?.response?.data?.error?.message ||
      lastError?.message ||
      "Unknown error"
    }`
  );
}

module.exports = googleIndexingService;
//hhhh