
const fs = require("fs/promises");
const path = require("path");
const { normalizeHttpUrl } = require("./urlUtils");

const DISCOVER_DIR = path.join(__dirname, "public", "discover");

const URLS_PER_PAGE = 200;

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildPage(urls, page) {

  const links = urls
    .map(u => `<li><a href="${escapeHtml(u)}">${escapeHtml(u)}</a></li>`)
    .join("\n");

  return `
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Discovery Page ${page}</title>
<meta name="robots" content="index,follow">
</head>

<body>

<h1>Discovery Page ${page}</h1>

<ul>
${links}
</ul>

</body>
</html>
`;
}

async function discoveryService(url) {

  const normalizedUrl = normalizeHttpUrl(url);

  await fs.mkdir(DISCOVER_DIR, { recursive: true });

  const files = await fs.readdir(DISCOVER_DIR).catch(() => []);

  let page = 1;

  if (files.length > 0) {
    page = files.length;
  }

  const file = path.join(DISCOVER_DIR, `page-${page}.html`);

  let urls = [];

  try {

    const html = await fs.readFile(file, "utf8");

    urls = [...html.matchAll(/href="(.*?)"/g)].map(x => x[1]);

  } catch {}

  urls.push(normalizedUrl);

  if (urls.length > URLS_PER_PAGE) {
    page++;
    urls = [normalizedUrl];
  }

  const html = buildPage(urls, page);

  await fs.writeFile(
    path.join(DISCOVER_DIR, `page-${page}.html`),
    html,
    "utf8"
  );

  return {
    page
  };

}

module.exports = discoveryService;

