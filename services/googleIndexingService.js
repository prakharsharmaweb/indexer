const axios = require("axios");
const { GoogleAuth } = require("google-auth-library");
const { normalizeHttpUrl } = require("../urlUtils");

const INDEXING_API_URL =
  "https://indexing.googleapis.com/v3/urlNotifications:publish";
const INDEXING_SCOPE = "https://www.googleapis.com/auth/indexing";
const MAX_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = Number(
  process.env.GOOGLE_INDEXING_TIMEOUT_MS || 10000
);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function googleIndexingService(url) {
  const submittedUrl = normalizeHttpUrl(url);
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
          url: submittedUrl,
          type: "URL_UPDATED",
        },
      });

      return {
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
