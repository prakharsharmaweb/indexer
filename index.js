
const express = require("express");
const path = require("path");
const { randomUUID } = require("crypto");
const {
  getSubmissions,
  DB_FILE,
} = require("./db");
const { submitUrl, submitUrls } = require("./submissionService");
const {
  listManagedSites,
  saveManagedSite,
  patchManagedSite,
  importManagedSitesFromSearchConsole,
} = require("./siteManager");
const {
  getConfiguredServiceAccountEmail,
} = require("./services/searchConsoleService");
const { syncManagedSite, syncEnabledManagedSites } = require("./siteSyncService");

if (process.env.START_INDEXING_WORKER === "true") {
  require("./indexingWorker");
}

const app = express();
const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "public");
const PDF_LANDING_DIR = path.join(PUBLIC_DIR, "pdf-landing");
const AUTO_SITE_SYNC_INTERVAL_MS = Number(
  process.env.AUTO_SITE_SYNC_INTERVAL_MINUTES || 1440
) * 60 * 1000;

const USERS = [
  { username: "admin", password: "Admin@12345", role: "admin" },
  { username: "manager", password: "Manager@12345", role: "manager" },
];
const sessions = new Map();

function parseCookies(cookieHeader = "") {
  return cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((acc, part) => {
      const index = part.indexOf("=");
      if (index <= 0) return acc;
      const key = decodeURIComponent(part.slice(0, index).trim());
      const value = decodeURIComponent(part.slice(index + 1).trim());
      acc[key] = value;
      return acc;
    }, {});
}

function sanitizeUser(user) {
  return { username: user.username, role: user.role };
}

function getSessionUser(req) {
  const cookies = parseCookies(req.headers.cookie || "");
  const sid = cookies.sid;
  if (!sid) return null;

  const session = sessions.get(sid);
  if (!session) return null;

  return USERS.find((user) => user.username === session.username) || null;
}

function requireAuth(req, res, next) {
  const user = getSessionUser(req);
  if (!user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  req.user = user;
  return next();
}

function normalizeStatus(status) {
  if (!status) return "processing";

  if (["success", "rejected", "processing"].includes(status)) {
    return status;
  }

  if (status === "completed") return "success";
  if (status === "failed") return "rejected";
  if (status === "queued") return "processing";

  return "processing";
}

function toHistoryItem(item) {
  return {
    ...item,
    status: normalizeStatus(item.status),
    processedAt: item.processedAt || item.completedAt || item.failedAt || null,
    reason: item.reason || item.error || "",
    requestedBy: item.requestedBy || "-",
    httpStatus: item.httpStatus || null,
    latencyMs: item.latencyMs || null,
    helperUrls: extractHelperUrls(item.result),
    searchConsoleInspection: extractSearchConsoleInspection(item.result),
  };
}

function normalizePathLink(value) {
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  return value.startsWith("/") ? value : `/${value}`;
}

function extractServiceResult(result, serviceName) {
  return Array.isArray(result?.results)
    ? result.results.find((entry) => entry.service === serviceName && entry.success)?.result
    : null;
}

function extractHelperUrls(result) {
  const sitemap = extractServiceResult(result, "sitemapService");
  const pdfLanding = extractServiceResult(result, "pdfLandingService");
  const wrapper = extractServiceResult(result, "wrapperService");
  const externalAssetHub = extractServiceResult(result, "externalAssetHubService");
  const discovery = extractServiceResult(result, "discoveryService");
  const linkGraph = extractServiceResult(result, "linkGraphService");
  const backlinks = extractServiceResult(result, "backlinkService");

  return [
    sitemap?.sitemapUrl
      ? { label: "Sitemap", href: normalizePathLink(sitemap.sitemapUrl) }
      : null,
    pdfLanding?.latestLandingPage
      ? { label: "PDF Landing", href: normalizePathLink(pdfLanding.latestLandingPage) }
      : null,
    wrapper?.latestWrapper
      ? { label: "Wrapper", href: normalizePathLink(wrapper.latestWrapper) }
      : null,
    externalAssetHub?.latestPage
      ? { label: "External Hub", href: normalizePathLink(externalAssetHub.latestPage) }
      : null,
    discovery?.latestPage
      ? { label: "Discovery", href: normalizePathLink(discovery.latestPage) }
      : null,
    linkGraph?.latestPage
      ? { label: "Link Graph", href: normalizePathLink(linkGraph.latestPage) }
      : null,
    backlinks?.latestPageUrl
      ? { label: "Backlinks", href: normalizePathLink(backlinks.latestPageUrl) }
      : null,
  ].filter(Boolean);
}

function extractSearchConsoleInspection(result) {
  return extractServiceResult(result, "searchConsoleInspectionService");
}

function buildSearchConsoleConnectionStatus() {
  const serviceAccountEmail = getConfiguredServiceAccountEmail();

  return {
    configured: Boolean(serviceAccountEmail),
    serviceAccountEmail,
    propertyHint: process.env.GOOGLE_SEARCH_CONSOLE_SITE_URL || "",
  };
}

function toIsoDate(dateValue) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function buildOverview(submissions) {
  const items = submissions.map(toHistoryItem);
  const now = new Date();

  const totals = {
    submitted: items.length,
    successful: items.filter((item) => item.status === "success").length,
    unsuccessful: items.filter((item) => item.status === "rejected").length,
    processing: items.filter((item) => item.status === "processing").length,
  };

  const successItems = items.filter((item) => item.status === "success");
  const successProcessedDates = successItems
    .map((item) => new Date(item.processedAt || item.submittedAt))
    .filter((date) => !Number.isNaN(date.getTime()));

  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);

  const startOfWeek = new Date(now);
  startOfWeek.setDate(startOfWeek.getDate() - 6);
  startOfWeek.setHours(0, 0, 0, 0);

  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfYear = new Date(now.getFullYear(), 0, 1);

  const indexed = {
    day: successProcessedDates.filter((d) => d >= startOfDay).length,
    week: successProcessedDates.filter((d) => d >= startOfWeek).length,
    month: successProcessedDates.filter((d) => d >= startOfMonth).length,
    year: successProcessedDates.filter((d) => d >= startOfYear).length,
    total: successItems.length,
  };

  const rate = totals.submitted === 0 ? 0 : Math.round((totals.successful / totals.submitted) * 100);

  const durations = items
    .filter((item) => item.processedAt)
    .map((item) => {
      if (typeof item.latencyMs === "number" && Number.isFinite(item.latencyMs)) {
        return item.latencyMs;
      }

      const start = new Date(item.submittedAt).getTime();
      const end = new Date(item.processedAt).getTime();
      if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
      return end - start;
    })
    .filter((value) => value != null);

  const avgProcessingSeconds =
    durations.length === 0
      ? 0
      : Number((durations.reduce((sum, value) => sum + value, 0) / durations.length / 1000).toFixed(2));

  const recentTerminal = items
    .filter((item) => item.status === "success" || item.status === "rejected")
    .sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime())
    .slice(0, 20);
  const recentSuccessRate =
    recentTerminal.length === 0
      ? 0
      : Math.round((recentTerminal.filter((item) => item.status === "success").length / recentTerminal.length) * 100);

  const dayBuckets = [];
  for (let i = 6; i >= 0; i -= 1) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    const key = date.toISOString().slice(0, 10);
    dayBuckets.push({ date: key, total: 0, success: 0, rejected: 0 });
  }

  const bucketMap = new Map(dayBuckets.map((bucket) => [bucket.date, bucket]));
  for (const item of items) {
    const key = toIsoDate(item.submittedAt);
    const bucket = key ? bucketMap.get(key) : null;
    if (!bucket) continue;

    bucket.total += 1;
    if (item.status === "success") bucket.success += 1;
    if (item.status === "rejected") bucket.rejected += 1;
  }

  return {
    indexed,
    totals,
    indexingRate: rate,
    avgProcessingSeconds,
    recentSuccessRate,
    last7Days: dayBuckets,
  };
}

app.use(express.json({ limit: "1mb" }));

app.get("/dynamic-sitemap.xml", async (req, res) => {
  const filePath = path.join(PUBLIC_DIR, "dynamic-sitemap.xml");

  try {
    await require("fs/promises").access(filePath);
    res.setHeader("Content-Type", "application/xml");
    return res.sendFile(filePath);
  } catch {
    res.setHeader("Content-Type", "application/xml");
    return res.status(404).send(`<?xml version="1.0" encoding="UTF-8"?>
<error>Sitemap not generated yet</error>`);
  }
});

app.get("/dynamic-sitemap-index.xml", async (req, res) => {
  const filePath = path.join(PUBLIC_DIR, "dynamic-sitemap-index.xml");

  try {
    await require("fs/promises").access(filePath);
    res.setHeader("Content-Type", "application/xml");
    return res.sendFile(filePath);
  } catch {
    res.setHeader("Content-Type", "application/xml");
    return res.status(404).send(`<?xml version="1.0" encoding="UTF-8"?>
<error>Sitemap index not generated yet</error>`);
  }
});

app.get("/pdf-landing", async (_req, res, next) => {
  const filePath = path.join(PDF_LANDING_DIR, "index.html");

  try {
    await require("fs/promises").access(filePath);
    return res.sendFile(filePath);
  } catch (error) {
    if (error.code === "ENOENT") {
      return res.status(404).send("PDF landing index not generated yet.");
    }

    return next(error);
  }
});

app.get("/pdf-landing/:slug", async (req, res, next) => {
  const filePath = path.join(PDF_LANDING_DIR, `${req.params.slug}.html`);

  try {
    await require("fs/promises").access(filePath);
    return res.sendFile(filePath);
  } catch (error) {
    if (error.code === "ENOENT") {
      return res.status(404).send("PDF landing page not found.");
    }

    return next(error);
  }
});

app.use(express.static(PUBLIC_DIR, { fallthrough: true }));

app.post("/api/auth/login", (req, res) => {
  const { username, password } = req.body || {};
  const user = USERS.find((candidate) => candidate.username === username && candidate.password === password);

  if (!user) {
    return res.status(401).json({ error: "Invalid username or password" });
  }

  const sid = randomUUID();
  sessions.set(sid, { username: user.username, createdAt: Date.now() });

  res.setHeader("Set-Cookie", `sid=${encodeURIComponent(sid)}; Path=/; HttpOnly; SameSite=Lax`);
  return res.json({ user: sanitizeUser(user) });
});

app.get("/api/auth/me", (req, res) => {
  const user = getSessionUser(req);
  if (!user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  return res.json({ user: sanitizeUser(user) });
});

app.post("/api/auth/logout", (req, res) => {
  const sid = parseCookies(req.headers.cookie || "").sid;
  if (sid) {
    sessions.delete(sid);
  }

  res.setHeader("Set-Cookie", "sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
  return res.json({ message: "Logged out" });
});


app.post("/api/urls/submit", requireAuth, async (req, res, next) => {
  try {
    const command = String(req.body?.command || "");

    if (command === "saveManagedSite") {
      const site = await saveManagedSite({
        siteUrl: req.body?.siteUrl,
        label: req.body?.label,
        sitemapUrls: req.body?.sitemapUrls,
        enabled: req.body?.enabled,
        autoSyncEnabled: req.body?.autoSyncEnabled,
        source: "manual",
      });

      return res.status(201).json({
        message: "Managed site saved",
        site,
      });
    }

    if (command === "importSearchConsole") {
      const imported = await importManagedSitesFromSearchConsole();
      return res.json({
        message: "Search Console properties imported",
        count: imported.length,
        items: imported,
      });
    }

    if (command === "syncEnabledManagedSites") {
      const results = await syncEnabledManagedSites({
        requestedBy: `site-auto-sync:${req.user.username}`,
        priority: req.body?.priority,
      });

      return res.json({
        message: "Enabled managed sites synced",
        count: results.length,
        results,
      });
    }

    if (command === "syncManagedSite") {
      const result = await syncManagedSite(req.body?.siteId, {
        requestedBy: `site-sync:${req.user.username}`,
        priority: req.body?.priority,
      });

      return res.json({
        message: "Managed site synced",
        ...result,
      });
    }

    if (command === "updateManagedSite") {
      const site = await patchManagedSite(req.body?.siteId, {
        label: req.body?.label,
        enabled: req.body?.enabled,
        autoSyncEnabled: req.body?.autoSyncEnabled,
        sitemapUrls: req.body?.sitemapUrls,
      });

      if (!site) {
        return res.status(404).json({ error: "Managed site not found." });
      }

      return res.json({
        message: "Managed site updated",
        site,
      });
    }

    const urls = Array.isArray(req.body?.urls)
      ? req.body.urls
      : [req.body?.url];

    if (!urls || urls.length === 0) {
      return res.status(400).json({ error: "At least one URL is required." });
    }

    const delayMinutes = Number(req.body?.delay_minutes || 0);
    const delayMs = Number.isFinite(delayMinutes)
      ? Math.max(0, delayMinutes) * 60 * 1000
      : 0;
    const { queued, skipped } = await submitUrls({
      urls,
      priority: req.body?.priority,
      requestedBy: req.user.username,
      delayMs,
    });

    return res.status(202).json({
      message: "URLs queued for indexing",
      count: queued.length,
      submissions: queued,
      skipped,
      delayMinutes,
    });

  } catch (error) {

    if (
      String(error.message).startsWith("Field") ||
      String(error.message).startsWith("Invalid URL") ||
      String(error.message).includes("Managed site must be") ||
      String(error.message).includes("GOOGLE_SERVICE_ACCOUNT_JSON")
    ) {
      return res.status(400).json({ error: error.message });
    }

    if (error.message === "Could not queue submission.") {
      return res.status(503).json({ error: error.message });
    }

    if (error.message === "Managed site not found.") {
      return res.status(404).json({ error: error.message });
    }

    return next(error);
  }
});

app.get("/api/urls/history", requireAuth, async (req, res, next) => {
  try {
    const submissions = await getSubmissions();

    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, limitRaw)) : 150;

    const statusFilter = String(req.query.status || "all");
    const validStatus = new Set(["all", "success", "rejected", "processing"]);
    const filter = validStatus.has(statusFilter) ? statusFilter : "all";

    let items = submissions
      .map(toHistoryItem)
      .sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());

    if (filter !== "all") {
      items = items.filter((item) => item.status === filter);
    }

    return res.json({
      limit,
      filter,
      total: items.length,
      items: items.slice(0, limit),
    });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/analytics/overview", requireAuth, async (req, res, next) => {
  try {
    const submissions = await getSubmissions();
    const sites = await listManagedSites();
    return res.json({
      ...buildOverview(submissions),
      managedSites: sites,
      searchConsoleConnection: buildSearchConsoleConnectionStatus(),
    });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/urls/properties", requireAuth, async (_req, res, next) => {
  try {
    const sites = await listManagedSites();
    return res.json({
      connection: buildSearchConsoleConnectionStatus(),
      items: sites,
    });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/urls/properties", requireAuth, async (req, res, next) => {
  try {
    const site = await saveManagedSite({
      siteUrl: req.body?.siteUrl,
      label: req.body?.label,
      sitemapUrls: req.body?.sitemapUrls,
      enabled: req.body?.enabled,
      autoSyncEnabled: req.body?.autoSyncEnabled,
      source: "manual",
    });

    return res.status(201).json({
      message: "Managed site saved",
      site,
    });
  } catch (error) {
    if (
      String(error.message).includes("siteUrl") ||
      String(error.message).includes("Managed site must be") ||
      String(error.message).includes("Invalid URL")
    ) {
      return res.status(400).json({ error: error.message });
    }

    return next(error);
  }
});

app.post("/api/urls/properties/import-search-console", requireAuth, async (_req, res, next) => {
  try {
    const imported = await importManagedSitesFromSearchConsole();
    return res.json({
      message: "Search Console properties imported",
      count: imported.length,
      items: imported,
    });
  } catch (error) {
    if (String(error.message).includes("GOOGLE_SERVICE_ACCOUNT_JSON")) {
      return res.status(400).json({ error: error.message });
    }

    return next(error);
  }
});

app.post("/api/urls/properties/sync-enabled", requireAuth, async (req, res, next) => {
  try {
    const results = await syncEnabledManagedSites({
      requestedBy: `site-auto-sync:${req.user.username}`,
      priority: req.body?.priority,
    });

    return res.json({
      message: "Enabled managed sites synced",
      count: results.length,
      results,
    });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/urls/properties/:siteId/sync", requireAuth, async (req, res, next) => {
  try {
    const result = await syncManagedSite(req.params.siteId, {
      requestedBy: `site-sync:${req.user.username}`,
      priority: req.body?.priority,
    });

    return res.json({
      message: "Managed site synced",
      ...result,
    });
  } catch (error) {
    if (error.message === "Managed site not found.") {
      return res.status(404).json({ error: error.message });
    }

    return next(error);
  }
});

app.post("/api/urls/properties/:siteId/update", requireAuth, async (req, res, next) => {
  try {
    const site = await patchManagedSite(req.params.siteId, {
      label: req.body?.label,
      enabled: req.body?.enabled,
      autoSyncEnabled: req.body?.autoSyncEnabled,
      sitemapUrls: req.body?.sitemapUrls,
    });

    if (!site) {
      return res.status(404).json({ error: "Managed site not found." });
    }

    return res.json({
      message: "Managed site updated",
      site,
    });
  } catch (error) {
    return next(error);
  }
});


app.post("/submit", async (req, res, next) => {
  try {
    const urls = Array.isArray(req.body?.urls)
      ? req.body.urls
      : [req.body?.url];

    if (!urls || urls.length === 0) {
      return res.status(400).json({ error: "At least one URL required." });
    }
    const { queued, skipped } = await submitUrls({
      urls,
      priority: req.body?.priority,
      requestedBy: "public-api",
    });

    return res.status(202).json({
      message: "URLs queued for indexing",
      count: queued.length,
      submissions: queued,
      skipped,
    });

  } catch (error) {

    if (
      String(error.message).startsWith("Field") ||
      String(error.message).startsWith("Invalid URL")
    ) {
      return res.status(400).json({ error: error.message });
    }

    if (error.message === "Could not queue submission.") {
      return res.status(503).json({ error: error.message });
    }

    return next(error);
  }
});



app.get("/history", async (_req, res, next) => {
  try {
    const submissions = await getSubmissions();
    const items = submissions
      .map(toHistoryItem)
      .sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());

    return res.json({
      total: items.length,
      dbFile: DB_FILE,
      submissions: items,
    });
  } catch (error) {
    return next(error);
  }
});

app.get("/analytics", async (_req, res, next) => {
  try {
    const submissions = await getSubmissions();
    return res.json(buildOverview(submissions));
  } catch (error) {
    return next(error);
  }
});



app.use((req, res, next) => {
  if (req.method !== "GET") return next();

  if (
    req.path.startsWith("/api") ||
    req.path === "/dynamic-sitemap.xml" ||
    req.path === "/dynamic-sitemap-index.xml" ||
    req.path === "/pdf-landing" ||
    req.path.startsWith("/pdf-landing/") ||
    req.path === "/submit" ||
    req.path === "/history" ||
    req.path === "/analytics"
  ) {
    return next();
  }

  return res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: "Internal server error." });
});

if (process.env.ENABLE_AUTO_SITE_SYNC === "true") {
  setInterval(() => {
    syncEnabledManagedSites({
      requestedBy: "site-auto-sync",
    }).catch((error) => {
      console.error("Automatic managed-site sync failed:", error.message);
    });
  }, AUTO_SITE_SYNC_INTERVAL_MS);
}

app.listen(PORT, () => {
  console.log(`API server listening on http://localhost:${PORT}`);
});
