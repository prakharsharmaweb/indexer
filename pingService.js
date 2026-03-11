
const axios = require("axios");
const { normalizeHttpUrl } = require("./urlUtils");

const REQUEST_TIMEOUT_MS = Number(process.env.PING_TIMEOUT_MS || 10000);
const RETRY_COUNT = Number(process.env.PING_RETRY_COUNT || 3);
const BASE_RETRY_DELAY_MS = Number(process.env.PING_RETRY_DELAY_MS || 1000);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/*
XML-RPC ping body
*/

function createXmlRpcBody(targetUrl) {

  const blogName = new URL(targetUrl).hostname;

  return [
    '<?xml version="1.0"?>',
    "<methodCall>",
    "  <methodName>weblogUpdates.ping</methodName>",
    "  <params>",
    "    <param>",
    `      <value><string>${escapeXml(blogName)}</string></value>`,
    "    </param>",
    "    <param>",
    `      <value><string>${escapeXml(targetUrl)}</string></value>`,
    "    </param>",
    "  </params>",
    "</methodCall>",
  ].join("\n");

}

function isSuccessStatus(status) {
  return status >= 200 && status < 300;
}

function isNonRetriableHttpStatus(status) {
  return status >= 400 && status < 500 && status !== 429;
}

/*
Retry wrapper
*/

async function requestWithRetries(service) {

  let lastError;

  for (let attempt = 1; attempt <= RETRY_COUNT + 1; attempt++) {

    try {

      const response = await service.run();

      if (!isSuccessStatus(response.status)) {

        if (service.nonFatalStatuses?.includes(response.status)) {

          return {
            service: service.name,
            ok: true,
            ignored: true,
            status: response.status,
            attempts: attempt
          };

        }

        const error = new Error(`HTTP ${response.status}`);

        if (isNonRetriableHttpStatus(response.status)) {
          error.nonRetriable = true;
        }

        throw error;

      }

      return {
        service: service.name,
        ok: true,
        status: response.status,
        attempts: attempt
      };

    } catch (error) {

      lastError = error;

      if (error.nonRetriable) break;

      if (attempt <= RETRY_COUNT) {
        await sleep(BASE_RETRY_DELAY_MS * attempt);
      }

    }

  }

  throw new Error(
    `${service.name} failed after ${RETRY_COUNT + 1} attempts: ${lastError.message}`
  );

}

/*
Main ping service
*/

async function pingService(url) {

  if (typeof url !== "string" || !url.trim()) {
    throw new Error("pingService requires a non-empty URL string.");
  }

  const normalizedUrl = normalizeHttpUrl(url);

  const xmlRpcBody = createXmlRpcBody(normalizedUrl);

  /*
  Ping targets
  */

  const services = [

    /*
    Google sitemap ping
    */

    {
      name: "Google",
      run: () =>
        axios({
          method: "GET",
          url: "https://www.google.com/ping",
          params: { sitemap: normalizedUrl },
          timeout: REQUEST_TIMEOUT_MS,
          validateStatus: () => true
        })
    },

    /*
    Bing sitemap ping
    */

    {
      name: "Bing",
      run: () =>
        axios({
          method: "GET",
          url: "https://www.bing.com/ping",
          params: { sitemap: normalizedUrl },
          timeout: REQUEST_TIMEOUT_MS,
          validateStatus: () => true
        })
    },

    /*
    Pingomatic
    */

    {
      name: "Pingomatic",
      run: () =>
        axios({
          method: "POST",
          url: process.env.PINGOMATIC_URL || "http://rpc.pingomatic.com/",
          data: xmlRpcBody,
          headers: { "Content-Type": "text/xml" },
          timeout: REQUEST_TIMEOUT_MS,
          validateStatus: () => true
        })
    },

    /*
    Twingly blog ping
    */

    {
      name: "Twingly",
      run: () =>
        axios({
          method: "POST",
          url: process.env.TWINGLY_PING_URL || "http://rpc.twingly.com/",
          data: xmlRpcBody,
          headers: { "Content-Type": "text/xml" },
          timeout: REQUEST_TIMEOUT_MS,
          validateStatus: () => true
        })
    },

    /*
    Feedburner ping
    */

    {
      name: "Feedburner",
      nonFatalStatuses: [400, 404, 410],
      run: () =>
        axios({
          method: "POST",
          url: process.env.FEEDBURNER_PING_URL || "http://ping.feedburner.com/",
          data: xmlRpcBody,
          headers: { "Content-Type": "text/xml" },
          timeout: REQUEST_TIMEOUT_MS,
          validateStatus: () => true
        })
    }

  ];

  /*
  Execute pings in parallel
  */

  const settled = await Promise.allSettled(
    services.map(service => requestWithRetries(service))
  );

  const successful = settled
    .filter(result => result.status === "fulfilled")
    .map(result => result.value);

  const failed = settled
    .filter(result => result.status === "rejected")
    .map(result => result.reason.message);

  if (successful.length === 0) {
    throw new Error(`Ping failures: ${failed.join("; ")}`);
  }

  return {
    url: normalizedUrl,
    successful,
    failed
  };

}

module.exports = pingService;
