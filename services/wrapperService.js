const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { normalizeHttpUrl } = require("../urlUtils");

const WRAPPER_DIR = path.join(__dirname, "..", "public", "wrappers");
const MANIFEST_FILE = path.join(WRAPPER_DIR, "manifest.json");

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildSlug(url) {
  return crypto.createHash("sha1").update(url).digest("hex").slice(0, 16);
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

function buildWrapperPage(url, allItems, fileName) {
  const title = `Instant Discovery Wrapper`;
  const relatedLinks = allItems
    .slice(0, 25)
    .map(
      (item) =>
        `<li><a href="${escapeHtml(item.url)}">${escapeHtml(item.url)}</a></li>`
    )
    .join("\n");

  const wrapperLinks = allItems
    .slice(0, 25)
    .map(
      (item) =>
        `<li><a href="${escapeHtml(item.fileName)}">${escapeHtml(
          item.fileName
        )}</a></li>`
    )
    .join("\n");

  const isPdf = url.toLowerCase().endsWith(".pdf");
  const preview = isPdf
    ? `<object data="${escapeHtml(url)}" type="application/pdf" width="100%" height="720">
  <a href="${escapeHtml(url)}">Open PDF directly</a>
</object>`
    : `<iframe src="${escapeHtml(url)}" title="Wrapped URL Preview" width="100%" height="720" loading="eager"></iframe>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <meta name="robots" content="index,follow,max-image-preview:large">
  <link rel="canonical" href="${escapeHtml(url)}">
</head>
<body>
  <header>
    <h1>${escapeHtml(title)}</h1>
    <p><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p>
    <p><a href="/dynamic-sitemap.xml">XML Sitemap</a> <a href="/discovery/index.html">Discovery Index</a></p>
  </header>
  <main>
    ${preview}
    <section>
      <h2>Target URL</h2>
      <ul>
        <li><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></li>
      </ul>
    </section>
    <section>
      <h2>More Wrapped URLs</h2>
      <ul>
        ${wrapperLinks}
      </ul>
    </section>
    <section>
      <h2>Direct Crawl Links</h2>
      <ul>
        ${relatedLinks}
      </ul>
    </section>
  </main>
  <footer>
    <p>Wrapper file: ${escapeHtml(fileName)}</p>
  </footer>
</body>
</html>
`;
}

async function wrapperService(url) {
  const normalizedUrl = normalizeHttpUrl(url);

  await fs.mkdir(WRAPPER_DIR, { recursive: true });

  const manifest = await readManifest();
  const existing = manifest.items.find((item) => item.url === normalizedUrl);

  if (!existing) {
    manifest.items.unshift({
      url: normalizedUrl,
      fileName: `${buildSlug(normalizedUrl)}.html`,
      updatedAt: new Date().toISOString(),
    });
  } else {
    existing.updatedAt = new Date().toISOString();
  }

  manifest.items = manifest.items.slice(0, 500);

  for (const item of manifest.items) {
    const html = buildWrapperPage(item.url, manifest.items, item.fileName);
    await fs.writeFile(path.join(WRAPPER_DIR, item.fileName), html, "utf8");
  }

  await fs.writeFile(MANIFEST_FILE, JSON.stringify(manifest, null, 2), "utf8");

  return {
    totalPages: manifest.items.length,
    latestWrapper: `wrappers/${manifest.items[0].fileName}`,
  };
}

module.exports = wrapperService;
