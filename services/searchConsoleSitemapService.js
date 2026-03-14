const {
  submitSitemapToSearchConsole: submitToSearchConsole,
} = require("./searchConsoleService");

async function submitSitemapToSearchConsole(sitemapUrl) {
  const siteUrl = process.env.GOOGLE_SEARCH_CONSOLE_SITE_URL;
  if (!siteUrl) {
    return {
      submitted: false,
      skipped: true,
      reason: "GOOGLE_SEARCH_CONSOLE_SITE_URL is not set.",
    };
  }

  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    return {
      submitted: false,
      skipped: true,
      reason: "GOOGLE_SERVICE_ACCOUNT_JSON is not set.",
    };
  }

  return submitToSearchConsole(siteUrl, sitemapUrl);
}

module.exports = {
  submitSitemapToSearchConsole,
};
