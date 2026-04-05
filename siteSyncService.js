const axios = require("axios");
const { listSearchConsoleSitemaps, submitSitemapToSearchConsole } = require("./services/searchConsoleService");
const { listManagedSites, patchManagedSite, matchesUrlToSite } = require("./siteManager");
const { submitUrls } = require("./submissionService");

const REQUEST_TIMEOUT_MS = Number(process.env.SITE_SYNC_TIMEOUT_MS || 10000);
const MAX_SITEMAP_DEPTH = Number(process.env.SITE_SYNC_MAX_DEPTH || 3);
const MAX_URLS_PER_SYNC = Number(process.env.SITE_SYNC_MAX_URLS || 500);

function extractLocValues(xml) {
  const pattern = /<loc>([\s\S]*?)<\/loc>/gi;
  const values = [];
  let match = pattern.exec(xml);

  while (match) {
    values.push(match[1].trim());
    match = pattern.exec(xml);
  }

  return values;
}

async function fetchXml(url) {
  const response = await axios({
    method: "GET",
    url,
    timeout: REQUEST_TIMEOUT_MS,
    maxRedirects: 5,
    validateStatus: () => true,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; ManagedSiteSync/1.0; +https://example.com/bot)",
    },
  });

  if (response.status < 200 || response.status >= 400) {
    throw new Error(`Failed to fetch sitemap ${url}: HTTP ${response.status}`);
  }

  return typeof response.data === "string" ? response.data : String(response.data || "");
}

async function collectUrlsFromSitemap(sitemapUrl, depth = 0, visited = new Set()) {
  if (visited.has(sitemapUrl) || depth > MAX_SITEMAP_DEPTH) {
    return [];
  }

  visited.add(sitemapUrl);
  const xml = await fetchXml(sitemapUrl);
  const locs = extractLocValues(xml);
  const isSitemapIndex = /<sitemapindex[\s>]/i.test(xml);

  if (!isSitemapIndex) {
    return locs.filter((value) => /^https?:\/\//i.test(value));
  }

  const nestedResults = [];

  for (const nestedSitemapUrl of locs) {
    if (!/^https?:\/\//i.test(nestedSitemapUrl)) {
      continue;
    }

    const nestedUrls = await collectUrlsFromSitemap(
      nestedSitemapUrl,
      depth + 1,
      visited
    );
    nestedResults.push(...nestedUrls);

    if (nestedResults.length >= MAX_URLS_PER_SYNC) {
      break;
    }
  }

  return nestedResults;
}

function buildDefaultSitemapCandidates(siteUrl) {
  if (siteUrl.startsWith("sc-domain:")) {
    return [];
  }

  const prefix = siteUrl.replace(/\/+$/, "");
  return [
    `${prefix}/sitemap.xml`,
    `${prefix}/sitemap_index.xml`,
    `${prefix}/sitemap-index.xml`,
  ];
}

async function resolveSiteSitemaps(site) {
  const explicitSitemaps = Array.isArray(site.sitemapUrls) ? site.sitemapUrls.filter(Boolean) : [];
  if (explicitSitemaps.length > 0) {
    return explicitSitemaps;
  }

  try {
    const apiSitemaps = await listSearchConsoleSitemaps(site.siteUrl);
    const urls = apiSitemaps
      .map((entry) => entry.path || entry.sitemapUrl || "")
      .filter((value) => /^https?:\/\//i.test(value));

    if (urls.length > 0) {
      return urls;
    }
  } catch {
    // Fallback to default sitemap guesses when Search Console doesn't list any.
  }

  return buildDefaultSitemapCandidates(site.siteUrl);
}

async function syncManagedSite(siteId, options = {}) {
  const sites = await listManagedSites();
  const site = sites.find((entry) => entry.id === siteId);

  if (!site) {
    throw new Error("Managed site not found.");
  }

  if (site.googleVerified !== true) {
    throw new Error(
      site.googleVerificationError ||
        "Managed site is not verified in Google Search Console."
    );
  }

  try {
    const sitemapUrls = await resolveSiteSitemaps(site);
    if (sitemapUrls.length === 0) {
      throw new Error("No sitemap URLs configured or discovered for this site.");
    }

    let collectedUrls = [];

    for (const sitemapUrl of sitemapUrls) {
      const urls = await collectUrlsFromSitemap(sitemapUrl);
      collectedUrls.push(...urls);

      if (collectedUrls.length >= MAX_URLS_PER_SYNC) {
        break;
      }
    }

    collectedUrls = [...new Set(collectedUrls)]
      .filter((url) => matchesUrlToSite(url, site.siteUrl))
      .slice(0, MAX_URLS_PER_SYNC);

    const { queued, skipped } = await submitUrls({
      urls: collectedUrls,
      priority: options.priority || 5,
      requestedBy: options.requestedBy || `site-sync:${site.siteUrl}`,
      skipExisting: true,
    });

    const now = new Date().toISOString();
    await patchManagedSite(site.id, {
      sitemapUrls,
      lastSyncAt: now,
      lastSyncStatus: "success",
      lastSyncQueuedCount: queued.length,
      lastSyncSkippedCount: skipped.length,
      lastSyncError: "",
    });

    for (const sitemapUrl of sitemapUrls) {
      try {
        await submitSitemapToSearchConsole(site.siteUrl, sitemapUrl);
      } catch {
        // Keep sync success even if sitemap submission fails.
      }
    }

    return {
      site,
      sitemapUrls,
      queuedCount: queued.length,
      skippedCount: skipped.length,
      queued,
      skipped,
    };
  } catch (error) {
    await patchManagedSite(site.id, {
      lastSyncAt: new Date().toISOString(),
      lastSyncStatus: "failed",
      lastSyncError: error.message,
    });
    throw error;
  }
}

async function syncEnabledManagedSites(options = {}) {
  const sites = (await listManagedSites()).filter(
    (site) => site.enabled !== false && site.autoSyncEnabled !== false
  );
  const results = [];

  for (const site of sites) {
    try {
      const result = await syncManagedSite(site.id, options);
      results.push({
        siteId: site.id,
        success: true,
        ...result,
      });
    } catch (error) {
      await patchManagedSite(site.id, {
        lastSyncAt: new Date().toISOString(),
        lastSyncStatus: "failed",
        lastSyncError: error.message,
      });

      results.push({
        siteId: site.id,
        success: false,
        error: error.message,
      });
    }
  }

  return results;
}

module.exports = {
  resolveSiteSitemaps,
  syncManagedSite,
  syncEnabledManagedSites,
};
