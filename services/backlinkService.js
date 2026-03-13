const fs = require("fs/promises");
const path = require("path");
const { normalizeHttpUrl } = require("../urlUtils");

const BACKLINK_DIR = path.join(__dirname, "..", "public", "backlinks");
const MANIFEST_FILE = path.join(BACKLINK_DIR, "manifest.json");
const URLS_PER_HUB = 50;

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

function buildHubPage(urls, pageIndex, totalPages) {
  const links = urls
    .map(
      (url) =>
        `<li><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></li>`
    )
    .join("\n");

  const previous =
    pageIndex > 1 ? `<a href="hub-${pageIndex - 1}.html">Previous Hub</a>` : "";
  const next =
    pageIndex < totalPages
      ? `<a href="hub-${pageIndex + 1}.html">Next Hub</a>`
      : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Backlink Hub ${pageIndex}</title>
  <meta name="robots" content="index,follow">
</head>
<body>
  <h1>Backlink Hub ${pageIndex}</h1>
  <nav>${previous} ${next}</nav>
  <ul>
    ${links}
  </ul>
</body>
</html>
`;
}

async function backlinkService(url) {
  const normalizedUrl = normalizeHttpUrl(url);

  await fs.mkdir(BACKLINK_DIR, { recursive: true });

  const manifest = await readManifest();
  if (!manifest.urls.includes(normalizedUrl)) {
    manifest.urls.push(normalizedUrl);
  }

  const chunks = chunk(manifest.urls, URLS_PER_HUB);
  manifest.pages = chunks.map((_, index) => `hub-${index + 1}.html`);

  for (let index = 0; index < chunks.length; index += 1) {
    const html = buildHubPage(chunks[index], index + 1, chunks.length);
    await fs.writeFile(
      path.join(BACKLINK_DIR, manifest.pages[index]),
      html,
      "utf8"
    );
  }

  await fs.writeFile(MANIFEST_FILE, JSON.stringify(manifest, null, 2), "utf8");

  return {
    totalUrls: manifest.urls.length,
    totalPages: manifest.pages.length,
    latestPageUrl: `backlinks/${manifest.pages[manifest.pages.length - 1]}`,
    backlinksDirectoryUrl: "backlinks",
  };
}

module.exports = backlinkService;
