
const axios = require("axios");
const { normalizeHttpUrl } = require("./urlUtils");

const REQUEST_TIMEOUT_MS = Number(process.env.CRAWLER_TIMEOUT_MS || 10000);
const RETRIES = Number(process.env.CRAWLER_RETRIES || 2);

/*
Major search engine crawler agents
*/

const CRAWLER_USER_AGENTS = [

  {
    bot: "Googlebot",
    userAgent:
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  },

  {
    bot: "Googlebot-Mobile",
    userAgent:
      "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0 Mobile Safari/537.36 (compatible; Googlebot/2.1)",
  },

  {
    bot: "GoogleInspectionTool",
    userAgent:
      "Mozilla/5.0 (compatible; Google-InspectionTool/1.0)",
  },

  {
    bot: "Bingbot",
    userAgent:
      "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
  },

  {
    bot: "DuckDuckBot",
    userAgent:
      "DuckDuckBot/1.0; (+http://duckduckgo.com/duckduckbot.html)",
  },

];

function isSuccessStatus(status) {
  return status >= 200 && status < 400;
}

async function fetchAsCrawler(targetUrl, crawler) {

  let lastError;

  for (let attempt = 0; attempt <= RETRIES; attempt++) {

    try {

      const start = Date.now();

      const response = await axios({

        method: "GET",
        url: targetUrl,

        timeout: REQUEST_TIMEOUT_MS,

        maxRedirects: 5,

        validateStatus: () => true,

        headers: {

          "User-Agent": crawler.userAgent,

          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",

          "Cache-Control": "no-cache",

          "Pragma": "no-cache",

        },

      });

      if (!isSuccessStatus(response.status)) {
        throw new Error(`HTTP ${response.status}`);
      }

      const latency = Date.now() - start;

      const htmlSize =
        typeof response.data === "string"
          ? Buffer.byteLength(response.data)
          : 0;

      return {

        bot: crawler.bot,

        status: response.status,

        latencyMs: latency,

        htmlBytes: htmlSize,

        finalUrl:
          response.request?.res?.responseUrl ||
          response.config?.url ||
          targetUrl,

      };

    } catch (error) {

      lastError = error;

    }

  }

  throw lastError;

}

/*
Main crawler simulation
*/

async function crawlerService(url) {

  if (typeof url !== "string" || !url.trim()) {
    throw new Error("crawlerService requires a non-empty URL string.");
  }

  const normalizedUrl = normalizeHttpUrl(url);

  const results = [];

  /*
  First crawl wave
  */

  for (const crawler of CRAWLER_USER_AGENTS) {

    try {

      const result = await fetchAsCrawler(normalizedUrl, crawler);

      results.push({

        bot: crawler.bot,

        success: true,

        status: result.status,

        latencyMs: result.latencyMs,

        htmlBytes: result.htmlBytes,

        finalUrl: result.finalUrl,

      });

    } catch (error) {

      results.push({

        bot: crawler.bot,

        success: false,

        error: error.message,

      });

    }

  }

  /*
  Short pause before second crawl wave
  */

  await new Promise((resolve) => setTimeout(resolve, 700));

  /*
  Second crawl burst (Google only)
  */

  const secondWave = ["Googlebot", "Googlebot-Mobile"];

  for (const crawler of CRAWLER_USER_AGENTS) {

    if (!secondWave.includes(crawler.bot)) continue;

    try {

      await fetchAsCrawler(normalizedUrl, crawler);

    } catch (_) {}

  }

  return {

    url: normalizedUrl,

    crawlers: results,

    crawlersAttempted: CRAWLER_USER_AGENTS.length,

  };

}

module.exports = crawlerService;
