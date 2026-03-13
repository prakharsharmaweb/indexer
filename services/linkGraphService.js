const fs = require("fs/promises");
const path = require("path");
const { normalizeHttpUrl } = require("../urlUtils");

const LINKGRAPH_DIR = path.join(__dirname, "..", "public", "linkgraph");
const MANIFEST_FILE = path.join(LINKGRAPH_DIR, "manifest.json");
const URLS_PER_PAGE = 10;

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

function buildGraphNav(pageNames) {
  return pageNames
    .map(
      (pageName, index) =>
        `<a href="${escapeHtml(pageName)}">Graph ${index + 1}</a>`
    )
    .join(" ");
}

function buildGraphPage(pageUrls, pageName, pageNames) {
  const nodes = pageUrls
    .map((sourceUrl) => {
      const relatedLinks = pageUrls
        .map(
          (targetUrl) =>
            `<a href="${escapeHtml(targetUrl)}">${escapeHtml(targetUrl)}</a>`
        )
        .join(" ");

      return `<section>
  <h2><a href="${escapeHtml(sourceUrl)}">${escapeHtml(sourceUrl)}</a></h2>
  <p>${relatedLinks}</p>
</section>`;
    })
    .join("\n");

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
  <nav>${buildGraphNav(pageNames)}</nav>
  ${nodes}
</body>
</html>
`;
}

async function linkGraphService(url) {
  const normalizedUrl = normalizeHttpUrl(url);

  await fs.mkdir(LINKGRAPH_DIR, { recursive: true });

  const manifest = await readManifest();
  if (!manifest.urls.includes(normalizedUrl)) {
    manifest.urls.push(normalizedUrl);
  }

  const chunks = chunk(manifest.urls, URLS_PER_PAGE);
  manifest.pages = chunks.map((_, index) => `graph-${index + 1}.html`);

  for (let index = 0; index < chunks.length; index += 1) {
    const html = buildGraphPage(
      chunks[index],
      `Link Graph ${index + 1}`,
      manifest.pages
    );
    await fs.writeFile(
      path.join(LINKGRAPH_DIR, manifest.pages[index]),
      html,
      "utf8"
    );
  }

  await fs.writeFile(MANIFEST_FILE, JSON.stringify(manifest, null, 2), "utf8");

  return {
    totalUrls: manifest.urls.length,
    totalPages: manifest.pages.length,
    latestPage: `linkgraph/${manifest.pages[manifest.pages.length - 1]}`,
  };
}

module.exports = linkGraphService;
