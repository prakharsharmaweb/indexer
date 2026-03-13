const fs = require("fs/promises");
const path = require("path");
const { normalizeHttpUrl } = require("../urlUtils");

const DISCOVERY_DIR = path.join(__dirname, "..", "public", "discovery");
const MANIFEST_FILE = path.join(DISCOVERY_DIR, "manifest.json");
const INDEX_FILE = path.join(DISCOVERY_DIR, "index.html");
const URLS_PER_PAGE = 100;

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function readManifest() {
  try {
    const content = await fs.readFile(MANIFEST_FILE, "utf8");
    const parsed = JSON.parse(content);

    if (!Array.isArray(parsed.urls) || !Array.isArray(parsed.pages)) {
      return { urls: [], pages: [] };
    }

    return parsed;
  } catch (error) {
    if (error.code === "ENOENT") {
      return { urls: [], pages: [] };
    }

    throw error;
  }
}

function chunk(items, size) {
  const chunks = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function buildDiscoveryNav(pageNames) {
  return pageNames
    .map(
      (pageName, index) =>
        `<a href="${escapeHtml(pageName)}">Discovery Page ${index + 1}</a>`
    )
    .join(" ");
}

function buildDiscoveryPage(pageUrls, pageName, pageNames) {
  const urlLinks = pageUrls
    .map(
      (url) =>
        `<li><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></li>`
    )
    .join("\n");
  const pageNav = buildDiscoveryNav(pageNames);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(pageName)}</title>
  <meta name="robots" content="index,follow">
</head>
<body>
  <h1>${escapeHtml(pageName)}</h1>
  <nav>
    <a href="index.html">Discovery Index</a>
    ${pageNav}
  </nav>
  <ul>
    ${urlLinks}
  </ul>
</body>
</html>
`;
}

function buildIndexPage(pageNames) {
  const links = pageNames
    .map(
      (pageName, index) =>
        `<li><a href="${escapeHtml(pageName)}">Discovery Page ${index + 1}</a></li>`
    )
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Discovery Index</title>
  <meta name="robots" content="index,follow">
</head>
<body>
  <h1>Discovery Index</h1>
  <ul>
    ${links}
  </ul>
</body>
</html>
`;
}

async function discoveryService(url) {
  const normalizedUrl = normalizeHttpUrl(url);

  await fs.mkdir(DISCOVERY_DIR, { recursive: true });

  const manifest = await readManifest();
  if (!manifest.urls.includes(normalizedUrl)) {
    manifest.urls.push(normalizedUrl);
  }

  const chunks = chunk(manifest.urls, URLS_PER_PAGE);
  manifest.pages = chunks.map((_, index) => `page-${index + 1}.html`);

  for (let index = 0; index < chunks.length; index += 1) {
    const pageName = manifest.pages[index];
    const html = buildDiscoveryPage(
      chunks[index],
      `Discovery Page ${index + 1}`,
      manifest.pages
    );
    await fs.writeFile(path.join(DISCOVERY_DIR, pageName), html, "utf8");
  }

  await fs.writeFile(INDEX_FILE, buildIndexPage(manifest.pages), "utf8");
  await fs.writeFile(MANIFEST_FILE, JSON.stringify(manifest, null, 2), "utf8");

  return {
    totalUrls: manifest.urls.length,
    totalPages: manifest.pages.length,
    indexPage: "discovery/index.html",
    latestPage: `discovery/${manifest.pages[manifest.pages.length - 1]}`,
  };
}

module.exports = discoveryService;
