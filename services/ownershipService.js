const { normalizeHttpUrl } = require("../urlUtils");
const { findBestManagedSiteForUrl, getManagedSiteById } = require("../siteManager");

async function resolveManagedSite(url, context = {}) {
  if (context.managedSiteId) {
    const site = await getManagedSiteById(context.managedSiteId);
    if (site) {
      return site;
    }
  }

  return findBestManagedSiteForUrl(url, {
    enabledOnly: true,
  });
}

async function ownershipService(url, context = {}) {
  const normalizedUrl = normalizeHttpUrl(url);
  const site = await resolveManagedSite(normalizedUrl, context);

  if (!site) {
    throw new Error(
      "No enabled managed Google Search Console property matches this URL."
    );
  }

  if (site.enabled === false) {
    throw new Error("The matching managed site is disabled.");
  }

  if (site.googleVerified !== true) {
    throw new Error(
      site.googleVerificationError ||
        "The matching managed site is not verified in Google Search Console."
    );
  }

  return {
    siteId: site.id,
    siteUrl: site.siteUrl,
    label: site.label || site.siteUrl,
    googleVerified: true,
    googleVerificationProperty: site.googleVerificationProperty || site.siteUrl,
    priorityInspectionThreshold: Number(site.priorityInspectionThreshold || 2),
  };
}

module.exports = ownershipService;
