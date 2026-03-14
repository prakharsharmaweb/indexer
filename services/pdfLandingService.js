const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const axios = require("axios");
const { normalizeHttpUrl } = require("../urlUtils");

const PDF_LANDING_DIR = path.join(__dirname, "..", "public", "pdf-landing");
const INDEX_FILE = path.join(PDF_LANDING_DIR, "index.html");
const MANIFEST_FILE = path.join(PDF_LANDING_DIR, "manifest.json");
const REQUEST_TIMEOUT_MS = Number(
  process.env.PDF_LANDING_TIMEOUT_MS || 10000
);

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildSlug(url) {
  return crypto.createHash("sha1").update(url).digest("hex").slice(0, 20);
}

function getBaseUrl() {
  return (process.env.PUBLIC_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
}

async function readManifest() {
  try {
    const content = await fs.readFile(MANIFEST_FILE, "utf8");
    const parsed = JSON.parse(content);

    if (!Array.isArray(parsed.items)) {
      return { items: [] };
    }

    return parsed;
  } catch (error) {
    if (error.code === "ENOENT") {
      return { items: [] };
    }

    throw error;
  }
}

async function detectPdf(targetUrl) {
  try {
    const response = await axios({
      method: "HEAD",
      url: targetUrl,
      timeout: REQUEST_TIMEOUT_MS,
      maxRedirects: 5,
      validateStatus: () => true,
    });
    const contentType = String(response.headers["content-type"] || "").toLowerCase();
    return (
      contentType.includes("application/pdf") ||
      targetUrl.toLowerCase().endsWith(".pdf")
    );
  } catch {
    return targetUrl.toLowerCase().endsWith(".pdf");
  }
}

function buildLandingPage(item, items) {
  const baseUrl = getBaseUrl();
  const canonicalUrl = `${baseUrl}/pdf-landing/${item.slug}`;
  const relatedPages = items
    .slice(0, 20)
    .map(
      (entry) =>
        `<li><a href="/pdf-landing/${escapeHtml(entry.slug)}">${escapeHtml(
          entry.title
        )}</a></li>`
    )
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(item.title)}</title>
  <meta name="description" content="Landing page for external PDF ${escapeHtml(item.url)}">
  <meta name="robots" content="index,follow,max-image-preview:large">
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}">
</head>
<body>
  <header>
    <h1>${escapeHtml(item.title)}</h1>
    <p><a href="${escapeHtml(item.url)}">${escapeHtml(item.url)}</a></p>
    <nav>
      <a href="/pdf-landing">PDF Landing Index</a>
      <a href="/external-assets/index.html">External Asset Index</a>
      <a href="/dynamic-sitemap.xml">XML Sitemap</a>
    </nav>
  </header>
  <main>
    <section>
      <h2>Direct PDF Link</h2>
      <p><a href="${escapeHtml(item.url)}">${escapeHtml(item.url)}</a></p>
      <p>This HTML page is kept indexable so search engines can discover the external PDF through a normal crawl path.</p>
    </section>
    <section>
      <h2>PDF Preview</h2>
      <object data="${escapeHtml(item.url)}" type="application/pdf" width="100%" height="900">
        <a href="${escapeHtml(item.url)}">Open the PDF directly</a>
      </object>
    </section>
    <section>
      <h2>Other PDF Landing Pages</h2>
      <ul>
        ${relatedPages}
      </ul>
    </section>
  </main>
</body>
</html>
`;
}

function buildIndexPage(items) {
  const links = items
    .map(
      (item) =>
        `<li><a href="/pdf-landing/${escapeHtml(item.slug)}">${escapeHtml(
          item.title
        )}</a></li>`
    )
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PDF Landing Index</title>
  <meta name="robots" content="index,follow">
</head>
<body>
  <h1>PDF Landing Index</h1>
  <ul>
    ${links}
  </ul>
</body>
</html>
`;
}

async function pdfLandingService(url) {
  const normalizedUrl = normalizeHttpUrl(url);
  const isPdf = await detectPdf(normalizedUrl);

  if (!isPdf) {
    return {
      skipped: true,
      reason: "URL is not a PDF.",
    };
  }

  await fs.mkdir(PDF_LANDING_DIR, { recursive: true });

  const manifest = await readManifest();
  const slug = buildSlug(normalizedUrl);
  const title = `PDF Landing ${slug}`;
  const existingItem = manifest.items.find((item) => item.url === normalizedUrl);

  if (existingItem) {
    existingItem.updatedAt = new Date().toISOString();
  } else {
    manifest.items.unshift({
      slug,
      title,
      url: normalizedUrl,
      fileName: `${slug}.html`,
      updatedAt: new Date().toISOString(),
    });
  }

  manifest.items = manifest.items.slice(0, 200);

  for (const item of manifest.items) {
    const html = buildLandingPage(item, manifest.items);
    await fs.writeFile(
      path.join(PDF_LANDING_DIR, item.fileName),
      html,
      "utf8"
    );
  }

  await fs.writeFile(INDEX_FILE, buildIndexPage(manifest.items), "utf8");
  await fs.writeFile(MANIFEST_FILE, JSON.stringify(manifest, null, 2), "utf8");

  return {
    skipped: false,
    totalPages: manifest.items.length,
    latestLandingPage: `/pdf-landing/${slug}`,
  };
}

module.exports = pdfLandingService;
