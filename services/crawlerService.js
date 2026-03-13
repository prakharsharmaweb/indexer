const axios = require("axios");
const { normalizeHttpUrl } = require("../urlUtils");

const REQUEST_TIMEOUT_MS = Number(process.env.CRAWLER_TIMEOUT_MS || 10000);
const REQUEST_DELAY_MS = 2000;
const PASSES = 2;

const CRAWLER_USER_AGENTS = [
  {
    bot: "Googlebot",
    userAgent:
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  },
  {
    bot: "Googlebot-Mobile",
    userAgent:
      "Mozilla/5.0 (Linux; Android 12; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  },
  {
    bot: "Chrome Desktop",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  },
  {
    bot: "Chrome Mobile",
    userAgent:
      "Mozilla/5.0 (Linux; Android 12; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36",
  },
];

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchAsCrawler(targetUrl, crawler) {
  const response = await axios({
    method: "GET",
    url: targetUrl,
    timeout: REQUEST_TIMEOUT_MS,
    maxRedirects: 5,
    validateStatus: () => true,
    headers: {
      "User-Agent": crawler.userAgent,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    },
  });

  return {
    bot: crawler.bot,
    status: response.status,
    success: response.status >= 200 && response.status < 400,
    finalUrl:
      response.request?.res?.responseUrl || response.config?.url || targetUrl,
  };
}

async function crawlerService(url) {
  const normalizedUrl = normalizeHttpUrl(url);
  const passes = [];

  for (let pass = 1; pass <= PASSES; pass += 1) {
    const passResults = [];

    for (let index = 0; index < CRAWLER_USER_AGENTS.length; index += 1) {
      const crawler = CRAWLER_USER_AGENTS[index];

      try {
        passResults.push(await fetchAsCrawler(normalizedUrl, crawler));
      } catch (error) {
        passResults.push({
          bot: crawler.bot,
          success: false,
          error: error.message,
        });
      }

      if (index < CRAWLER_USER_AGENTS.length - 1) {
        await delay(REQUEST_DELAY_MS);
      }
    }

    passes.push({
      pass,
      results: passResults,
    });
  }

  return {
    url: normalizedUrl,
    passes,
    crawlersAttempted: CRAWLER_USER_AGENTS.length,
  };
}

module.exports = crawlerService;
