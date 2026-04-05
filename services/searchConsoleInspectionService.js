const { normalizeHttpUrl } = require("../urlUtils");
const { findBestManagedSiteForUrl, getManagedSiteById } = require("../siteManager");
const { inspectUrlInSearchConsole } = require("./searchConsoleService");

const DEFAULT_PRIORITY_THRESHOLD = Number(
  process.env.SEARCH_CONSOLE_PRIORITY_THRESHOLD || 2
);

async function searchConsoleInspectionService(url, context = {}) {
  const normalizedUrl = normalizeHttpUrl(url);
  const priority = Number(context.priority || 5);
  const threshold = Number(
    context.priorityInspectionThreshold || DEFAULT_PRIORITY_THRESHOLD
  );
  const site = context.managedSiteId
    ? await getManagedSiteById(context.managedSiteId)
    : await findBestManagedSiteForUrl(normalizedUrl, {
        enabledOnly: true,
      });

  if (!site) {
    return {
      skipped: true,
      reason: "No managed Search Console property matches this URL.",
    };
  }

  if (!Number.isFinite(priority) || priority > threshold) {
    return {
      skipped: true,
      reason: `Reserved for higher-priority URLs (priority ${threshold} or better). Sitemap submission remains the primary signal.`,
      siteId: site.id,
      siteUrl: site.siteUrl,
    };
  }

  try {
    const result = await inspectUrlInSearchConsole(
      site.googleVerificationProperty || site.siteUrl,
      normalizedUrl
    );
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
