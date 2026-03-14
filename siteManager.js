const crypto = require("crypto");
const {
  getManagedSites,
  upsertManagedSite,
  upsertManagedSites,
  updateManagedSiteById,
} = require("./db");
const {
  normalizeSiteUrl,
  listSearchConsoleSites,
} = require("./services/searchConsoleService");

function createSiteId(siteUrl) {
  return crypto.createHash("sha1").update(siteUrl).digest("hex").slice(0, 16);
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean).map((value) => String(value).trim()))];
}

function sanitizeSitemapUrls(values) {
  return uniqueStrings(Array.isArray(values) ? values : []).filter((value) =>
    /^https?:\/\//i.test(value)
  );
}

function normalizeManagedSiteInput(input = {}) {
  const siteUrl = normalizeSiteUrl(input.siteUrl);
  const now = new Date().toISOString();

  return {
    id: input.id || createSiteId(siteUrl),
    siteUrl,
    label: String(input.label || siteUrl),
    permissionLevel: input.permissionLevel || "siteOwner",
    enabled: input.enabled !== false,
    autoSyncEnabled: input.autoSyncEnabled !== false,
    sitemapUrls: sanitizeSitemapUrls(input.sitemapUrls),
    source: input.source || "manual",
    importedAt: input.importedAt || now,
    lastImportedAt: input.lastImportedAt || now,
    lastSyncAt: input.lastSyncAt || null,
    lastSyncStatus: input.lastSyncStatus || "never",
    lastSyncQueuedCount: Number(input.lastSyncQueuedCount || 0),
    lastSyncSkippedCount: Number(input.lastSyncSkippedCount || 0),
    lastSyncError: input.lastSyncError || "",
  };
}

function parseManagedSitesEnv() {
  const raw = process.env.MANAGED_SITES_JSON;
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.map((item) =>
      normalizeManagedSiteInput(
        typeof item === "string" ? { siteUrl: item, source: "env" } : { ...item, source: "env" }
      )
    );
  } catch {
    return [];
  }
}

async function ensureEnvManagedSites() {
  const envSites = parseManagedSitesEnv();
  if (envSites.length === 0) {
    return [];
  }

  await upsertManagedSites(envSites);
  return envSites;
}

async function listManagedSites() {
  await ensureEnvManagedSites();

  const sites = await getManagedSites();
  return sites
    .slice()
    .sort((left, right) => String(left.label || left.siteUrl).localeCompare(String(right.label || right.siteUrl)));
}

async function saveManagedSite(input) {
  const site = normalizeManagedSiteInput(input);
  return upsertManagedSite(site);
}

async function patchManagedSite(siteId, patch = {}) {
  const currentSites = await listManagedSites();
  const currentSite = currentSites.find((site) => site.id === siteId);
  if (!currentSite) {
    return null;
  }

  const nextSite = normalizeManagedSiteInput({
    ...currentSite,
    label: patch.label !== undefined ? patch.label : currentSite.label,
    enabled: patch.enabled !== undefined ? patch.enabled : currentSite.enabled,
    autoSyncEnabled:
      patch.autoSyncEnabled !== undefined
        ? patch.autoSyncEnabled
        : currentSite.autoSyncEnabled,
    sitemapUrls:
      patch.sitemapUrls !== undefined
        ? patch.sitemapUrls
        : currentSite.sitemapUrls,
    permissionLevel:
      patch.permissionLevel !== undefined
        ? patch.permissionLevel
        : currentSite.permissionLevel,
    source: patch.source !== undefined ? patch.source : currentSite.source,
    id: currentSite.id,
    importedAt: currentSite.importedAt,
    lastImportedAt: currentSite.lastImportedAt,
    lastSyncAt: patch.lastSyncAt ?? currentSite.lastSyncAt,
    lastSyncStatus: patch.lastSyncStatus ?? currentSite.lastSyncStatus,
    lastSyncQueuedCount:
      patch.lastSyncQueuedCount ?? currentSite.lastSyncQueuedCount,
    lastSyncSkippedCount:
      patch.lastSyncSkippedCount ?? currentSite.lastSyncSkippedCount,
    lastSyncError: patch.lastSyncError ?? currentSite.lastSyncError,
  });

  return updateManagedSiteById(siteId, nextSite);
}

async function importManagedSitesFromSearchConsole() {
  const existingSites = await listManagedSites();
  const entries = await listSearchConsoleSites();
  const importedAt = new Date().toISOString();
  const normalizedSites = entries.map((entry) =>
    normalizeManagedSiteInput((() => {
      const siteUrl = normalizeSiteUrl(entry.siteUrl);
      const existingSite = existingSites.find((site) => site.siteUrl === siteUrl);

      return {
        ...existingSite,
        siteUrl,
        label: existingSite?.label || entry.siteUrl,
        permissionLevel: entry.permissionLevel || existingSite?.permissionLevel || "siteOwner",
        source: "search-console",
        importedAt: existingSite?.importedAt || importedAt,
        lastImportedAt: importedAt,
      };
    })())
  );

  await upsertManagedSites(normalizedSites);
  return normalizedSites;
}

function matchesUrlToSite(url, siteUrl) {
  if (!url || !siteUrl) return false;

  if (siteUrl.startsWith("sc-domain:")) {
    const rootDomain = siteUrl.slice("sc-domain:".length).toLowerCase();
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname === rootDomain || hostname.endsWith(`.${rootDomain}`);
  }

  return String(url).startsWith(siteUrl);
}

async function findBestManagedSiteForUrl(url, options = {}) {
  const sites = await listManagedSites();
  const candidates = sites.filter((site) => {
    if (options.enabledOnly && site.enabled === false) {
      return false;
    }

    return matchesUrlToSite(url, site.siteUrl);
  });

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((left, right) => right.siteUrl.length - left.siteUrl.length);
  return candidates[0];
}

module.exports = {
  createSiteId,
  normalizeManagedSiteInput,
  listManagedSites,
  saveManagedSite,
  patchManagedSite,
  importManagedSitesFromSearchConsole,
  findBestManagedSiteForUrl,
  matchesUrlToSite,
};
