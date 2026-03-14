const { normalizeHttpUrl } = require("../urlUtils");
const { findBestManagedSiteForUrl } = require("../siteManager");
const { inspectUrlInSearchConsole } = require("./searchConsoleService");

async function searchConsoleInspectionService(url) {
  const normalizedUrl = normalizeHttpUrl(url);
  const site = await findBestManagedSiteForUrl(normalizedUrl, {
    enabledOnly: true,
  });

  if (!site) {
    return {
      skipped: true,
      reason: "No managed Search Console property matches this URL.",
    };
  }

  try {
    const result = await inspectUrlInSearchConsole(site.siteUrl, normalizedUrl);
    return {
      skipped: false,
      siteId: site.id,
      ...result,
    };
  } catch (error) {
    return {
      skipped: true,
      reason: error.message,
      siteId: site.id,
      siteUrl: site.siteUrl,
    };
  }
}

module.exports = searchConsoleInspectionService;
