const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { normalizeHttpUrl } = require("../urlUtils");

const HUB_DIR = path.join(__dirname, "..", "public", "external-assets");
const MANIFEST_FILE = path.join(HUB_DIR, "manifest.json");
const INDEX_FILE = path.join(HUB_DIR, "index.html");
const ITEMS_PER_HUB = 25;
const MAX_ITEMS = 1000;

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getBaseUrl() {
  return (process.env.PUBLIC_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
}

function buildSlug(url) {
  return crypto.createHash("sha1").update(url).digest("hex").slice(0, 24);
}

function getHost(url) {
  try {
    return new URL(url).host;
  } catch {
    return "unknown-host";
  }
}

function isPdf(url) {
  return url.toLowerCase().endsWith(".pdf");
}

function chunk(items, size) {
  const pages = [];

  for (let index = 0; index < items.length; index += size) {
    pages.push(items.slice(index, index + size));
  }

  return pages;
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

function buildJsonLd(item, canonicalUrl) {
  return JSON.stringify(
    {
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: item.title,
      url: canonicalUrl,
      mainEntity: {
        "@type": isPdf(item.url) ? "DigitalDocument" : "CreativeWork",
        url: item.url,
        name: item.title,
      },
      about: {
        "@type": "Thing",
        name: item.host,
      },
    },
    null,
    2
  );
}

function buildItemPage(item, allItems) {
  const baseUrl = getBaseUrl();
  const canonicalUrl = `${baseUrl}/external-assets/${item.fileName}`;
  const relatedItems = allItems
    .filter((entry) => entry.slug !== item.slug)
    .slice(0, 20)
    .map(
      (entry) =>
        `<li><a href="/external-assets/${escapeHtml(entry.fileName)}">${escapeHtml(
          entry.title
        )}</a> <span>(${escapeHtml(entry.host)})</span></li>`
    )
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(item.title)}</title>
  <meta name="description" content="Discovery page for ${escapeHtml(item.url)}">
  <meta name="robots" content="index,follow,max-image-preview:large">
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}">
  <script type="application/ld+json">
${buildJsonLd(item, canonicalUrl)}
  </script>
</head>
<body>
  <header>
    <h1>${escapeHtml(item.title)}</h1>
    <p>Source host: <strong>${escapeHtml(item.host)}</strong></p>
    <nav>
      <a href="/external-assets/index.html">External Asset Index</a>
      <a href="/dynamic-sitemap.xml">XML Sitemap</a>
      <a href="${escapeHtml(item.url)}">Open Source URL</a>
    </nav>
  </header>
  <main>
    <section>
      <h2>Source URL</h2>
      <p><a href="${escapeHtml(item.url)}">${escapeHtml(item.url)}</a></p>
      <p>This page exists to surface a crawlable HTML document that references the external asset with normal anchor links.</p>
    </section>
    <section>
      <h2>Discovery Links</h2>
      <ul>
        <li><a href="${escapeHtml(item.url)}">Primary external asset</a></li>
        <li><a href="/wrappers/${escapeHtml(item.wrapperFileName)}">Wrapper page</a></li>
        ${
          item.pdfLandingSlug
            ? `<li><a href="/pdf-landing/${escapeHtml(item.pdfLandingSlug)}">PDF landing page</a></li>`
            : ""
        }
      </ul>
    </section>
    <section>
      <h2>Related External Assets</h2>
      <ul>
        ${relatedItems}
      </ul>
    </section>
  </main>
</body>
</html>
`;
}

function buildHubPage(items, pageNumber, totalPages) {
  const prevLink =
    pageNumber > 1
      ? `<a href="/external-assets/hub-${pageNumber - 1}.html">Previous Hub</a>`
      : "";
  const nextLink =
    pageNumber < totalPages
      ? `<a href="/external-assets/hub-${pageNumber + 1}.html">Next Hub</a>`
      : "";
  const itemLinks = items
    .map(
      (item) =>
        `<article>
  <h2><a href="/external-assets/${escapeHtml(item.fileName)}">${escapeHtml(
          item.title
        )}</a></h2>
  <p><a href="${escapeHtml(item.url)}">${escapeHtml(item.url)}</a></p>
  <p>Host: ${escapeHtml(item.host)}</p>
</article>`
    )
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>External Asset Hub ${pageNumber}</title>
  <meta name="robots" content="index,follow">
</head>
<body>
  <header>
    <h1>External Asset Hub ${pageNumber}</h1>
    <nav>
      <a href="/external-assets/index.html">Hub Index</a>
      ${prevLink}
      ${nextLink}
      <a href="/dynamic-sitemap.xml">XML Sitemap</a>
    </nav>
  </header>
  <main>
    ${itemLinks}
  </main>
</body>
</html>
`;
}

function buildIndexPage(items, hubCount) {
  const latestItems = items
    .slice(0, 50)
    .map(
      (item) =>
        `<li><a href="/external-assets/${escapeHtml(item.fileName)}">${escapeHtml(
          item.title
        )}</a></li>`
    )
    .join("\n");
  const hubLinks = Array.from({ length: hubCount }, (_, index) => index + 1)
    .map(
      (pageNumber) =>
        `<li><a href="/external-assets/hub-${pageNumber}.html">Hub ${pageNumber}</a></li>`
    )
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>External Asset Index</title>
  <meta name="robots" content="index,follow">
</head>
<body>
  <h1>External Asset Index</h1>
  <section>
    <h2>Hub Pages</h2>
    <ul>
      ${hubLinks}
    </ul>
  </section>
  <section>
    <h2>Latest External Assets</h2>
    <ul>
      ${latestItems}
    </ul>
  </section>
</body>
</html>
`;
}

async function externalAssetHubService(url) {
  const normalizedUrl = normalizeHttpUrl(url);

  await fs.mkdir(HUB_DIR, { recursive: true });

  const manifest = await readManifest();
  const slug = buildSlug(normalizedUrl);
  const now = new Date().toISOString();
  const existingItem = manifest.items.find((item) => item.url === normalizedUrl);
  const nextItem = {
    slug,
    title: `External Asset ${slug}`,
    url: normalizedUrl,
    host: getHost(normalizedUrl),
    fileName: `${slug}.html`,
    wrapperFileName: `${crypto
      .createHash("sha1")
      .update(normalizedUrl)
      .digest("hex")
      .slice(0, 16)}.html`,
    pdfLandingSlug: isPdf(normalizedUrl) ? buildSlug(normalizedUrl).slice(0, 20) : null,
    updatedAt: now,
  };

  if (existingItem) {
    Object.assign(existingItem, nextItem);
  } else {
    manifest.items.unshift(nextItem);
  }

  manifest.items = manifest.items.slice(0, MAX_ITEMS);

  for (const item of manifest.items) {
    const html = buildItemPage(item, manifest.items);
    await fs.writeFile(path.join(HUB_DIR, item.fileName), html, "utf8");
  }

  const pages = chunk(manifest.items, ITEMS_PER_HUB);

  for (let index = 0; index < pages.length; index += 1) {
    await fs.writeFile(
      path.join(HUB_DIR, `hub-${index + 1}.html`),
      buildHubPage(pages[index], index + 1, pages.length),
      "utf8"
    );
  }

  await fs.writeFile(INDEX_FILE, buildIndexPage(manifest.items, pages.length), "utf8");
  await fs.writeFile(MANIFEST_FILE, JSON.stringify(manifest, null, 2), "utf8");

  return {
    totalItems: manifest.items.length,
    latestPage: `/external-assets/${nextItem.fileName}`,
    latestHub: pages.length ? `/external-assets/hub-1.html` : null,
  };
}

module.exports = externalAssetHubService;
