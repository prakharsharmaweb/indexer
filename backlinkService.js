
const fs = require("fs/promises");
const path = require("path");
const { randomUUID } = require("crypto");
const { normalizeHttpUrl } = require("./urlUtils");

const BACKLINK_DIR = path.join(__dirname, "public", "backlinks");
const MANIFEST_FILE = path.join(BACKLINK_DIR, "manifest.json");

/*
Increase URLs per page to build stronger crawl graph
*/
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

function chunkUrls(urls, size) {
  const chunks = [];
  for (let i = 0; i < urls.length; i += size) {
    chunks.push(urls.slice(i, i + size));
  }
  return chunks;
}

function buildBacklinkPageHtml(urls, pageNumber, totalPages) {

  const links = urls
    .map((url) => {
      const safeUrl = escapeHtml(url);
      return `<li><a href="${safeUrl}" target="_blank" rel="nofollow noopener">${safeUrl}</a></li>`;
    })
    .join("\n");

  /*
  internal crawl graph linking pages together
  */

  let navigation = "";

  if (pageNumber > 1) {
    navigation += `<a href="page-${pageNumber - 1}.html">Previous</a> `;
  }

  if (pageNumber < totalPages) {
    navigation += `<a href="page-${pageNumber + 1}.html">Next</a>`;
  }

  return `
<!doctype html>
<html lang="en">
<head>

<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />

<title>Backlink Index ${pageNumber}</title>

<meta name="robots" content="index,follow" />

<link rel="canonical" href="/backlinks/page-${pageNumber}.html">

</head>

<body>

<h1>Indexed Links Page ${pageNumber}</h1>

<nav>${navigation}</nav>

<ul>
${links}
</ul>

<footer>

<p>Crawl Index Page ${pageNumber} of ${totalPages}</p>

<a href="/dynamic-sitemap.xml">Sitemap</a>

</footer>

</body>
</html>
`;
}

async function writePagesFromChunks(chunks, existingPages) {

  const pages = [...existingPages];

  for (let i = 0; i < chunks.length; i++) {

    if (!pages[i]) {
      pages[i] = `page-${i + 1}.html`;
    }

    const html = buildBacklinkPageHtml(
      chunks[i],
      i + 1,
      chunks.length
    );

    const filePath = path.join(BACKLINK_DIR, pages[i]);

    await fs.writeFile(filePath, html, "utf8");

  }

  return pages.slice(0, chunks.length);
}

async function backlinkService(url) {

  if (typeof url !== "string" || !url.trim()) {
    throw new Error("backlinkService requires a non-empty URL string.");
  }

  const normalizedUrl = normalizeHttpUrl(url);

  await fs.mkdir(BACKLINK_DIR, { recursive: true });

  const manifest = await readManifest();

  /*
  remove duplicates
  */

  if (!manifest.urls.includes(normalizedUrl)) {
    manifest.urls.push(normalizedUrl);
  }

  /*
  sort for deterministic structure
  */

  manifest.urls = [...new Set(manifest.urls)].sort();

  const chunks = chunkUrls(manifest.urls, URLS_PER_PAGE);

  manifest.pages = await writePagesFromChunks(
    chunks,
    manifest.pages
  );

  await fs.writeFile(
    MANIFEST_FILE,
    JSON.stringify(manifest, null, 2),
    "utf8"
  );

  const baseUrl = (process.env.PUBLIC_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");

  return {
    totalUrls: manifest.urls.length,
    totalPages: manifest.pages.length,
    latestPageUrl: `${baseUrl}/backlinks/${manifest.pages[manifest.pages.length - 1]}`,
    backlinksDirectoryUrl: `${baseUrl}/backlinks`
  };
}

module.exports = backlinkService;

