const fs = require("fs/promises");
const path = require("path");
const axios = require("axios");
const { normalizeHttpUrl } = require("./urlUtils");

const PUBLIC_DIR = path.join(__dirname, "public");

const ACTIVE_SITEMAP_FILE = "dynamic-sitemap.xml";
const SITEMAP_INDEX_FILE = "dynamic-sitemap-index.xml";

const MAX_URLS_PER_SITEMAP = 50000;

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function unescapeXml(value) {
  return String(value)
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}

function getBaseUrl() {
  return (process.env.PUBLIC_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
}

function getActiveSitemapPath() {
  return path.join(PUBLIC_DIR, ACTIVE_SITEMAP_FILE);
}

function getSitemapIndexPath() {
  return path.join(PUBLIC_DIR, SITEMAP_INDEX_FILE);
}

/*
Validate URLs before inserting into sitemap
*/
function isValidUrl(url) {
  if (!url) return false;
  if (!/^https?:\/\//i.test(url)) return false;
  if (url.startsWith("site:")) return false;

  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

async function readUrlEntries(filePath) {
  let xml;

  try {
    xml = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }

  const urlRegex = /<url>[\s\S]*?<\/url>/g;
  const locRegex = /<loc>([\s\S]*?)<\/loc>/;
  const lastmodRegex = /<lastmod>([\s\S]*?)<\/lastmod>/;

  const entries = [];

  let match = urlRegex.exec(xml);

  while (match) {
    const node = match[0];
    const locMatch = locRegex.exec(node);

    if (locMatch?.[1]) {
      const url = unescapeXml(locMatch[1].trim());

      if (!isValidUrl(url)) {
        match = urlRegex.exec(xml);
        continue;
      }

      entries.push({
        loc: url,
        lastmod:
          lastmodRegex.exec(node)?.[1]?.trim() ||
          new Date().toISOString(),
      });
    }

    match = urlRegex.exec(xml);
  }

  return entries;
}

function buildUrlSetXml(entries) {
  const urlsXml = entries
    .map((entry) => {
      return [
        "  <url>",
        `    <loc>${escapeXml(entry.loc)}</loc>`,
        `    <lastmod>${escapeXml(entry.lastmod)}</lastmod>`,
        "    <changefreq>daily</changefreq>",
        "    <priority>0.8</priority>",
        "  </url>",
      ].join("\n");
    })
    .join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    urlsXml,
    "</urlset>",
    "",
  ].join("\n");
}

function buildSitemapIndexXml(files) {
  const baseUrl = getBaseUrl();
  const now = new Date().toISOString();

  const entriesXml = files
    .map((fileName) => {
      return [
        "  <sitemap>",
        `    <loc>${escapeXml(`${baseUrl}/${fileName}`)}</loc>`,
        `    <lastmod>${escapeXml(now)}</lastmod>`,
        "  </sitemap>",
      ].join("\n");
    })
    .join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    entriesXml,
    "</sitemapindex>",
    "",
  ].join("\n");
}

async function getRotatedSitemapFiles() {
  let files = [];

  try {
    files = await fs.readdir(PUBLIC_DIR);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }

  return files
    .map((name) => {
      const match = /^dynamic-sitemap-(\d+)\.xml$/.exec(name);
      if (!match) return null;

      return {
        name,
        index: Number(match[1]),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.index - b.index)
    .map((item) => item.name);
}

async function rotateActiveSitemap() {
  const activePath = getActiveSitemapPath();

  const rotatedFiles = await getRotatedSitemapFiles();

  const lastIndex = rotatedFiles.length
    ? Number(rotatedFiles[rotatedFiles.length - 1].match(/(\d+)\.xml$/)[1])
    : 0;

  const nextFileName = `dynamic-sitemap-${lastIndex + 1}.xml`;

  const nextPath = path.join(PUBLIC_DIR, nextFileName);

  await fs.rename(activePath, nextPath);

  return nextFileName;
}

async function writeActiveSitemap(entries) {
  const xml = buildUrlSetXml(entries);
  await fs.writeFile(getActiveSitemapPath(), xml, "utf8");
}

async function writeSitemapIndex() {
  const rotatedFiles = await getRotatedSitemapFiles();
  const files = [...rotatedFiles, ACTIVE_SITEMAP_FILE];

  const xml = buildSitemapIndexXml(files);

  await fs.writeFile(getSitemapIndexPath(), xml, "utf8");
}

/*
Notify Google about sitemap update
*/
async function pingGoogleSitemap(sitemapUrl) {
  try {
    await axios.get(
      `https://www.google.com/ping?sitemap=${encodeURIComponent(sitemapUrl)}`
    );
  } catch (_) {}
}

async function sitemapService(url) {
  if (typeof url !== "string" || !url.trim()) {
    throw new Error("sitemapService requires a non-empty URL string.");
  }

  const normalizedUrl = normalizeHttpUrl(url);

  if (!isValidUrl(normalizedUrl)) {
    throw new Error("Invalid URL for sitemap.");
  }

  await fs.mkdir(PUBLIC_DIR, { recursive: true });

  const activePath = getActiveSitemapPath();

  let entries = await readUrlEntries(activePath);

  /*
  Remove duplicates
  */
  entries = entries.filter((entry) => entry.loc !== normalizedUrl);

  entries.push({
    loc: normalizedUrl,
    lastmod: new Date().toISOString(),
  });

  /*
  Limit sitemap size
  */
  if (entries.length >= MAX_URLS_PER_SITEMAP) {
    await rotateActiveSitemap();
    entries = entries.slice(-MAX_URLS_PER_SITEMAP);
  }

  /*
  Stable crawl order
  */
  entries = entries.sort((a, b) => a.loc.localeCompare(b.loc));

  await writeActiveSitemap(entries);
  await writeSitemapIndex();

  const baseUrl = getBaseUrl();

  const sitemapUrl = `${baseUrl}/${ACTIVE_SITEMAP_FILE}`;

  await pingGoogleSitemap(sitemapUrl);

  return {
    sitemapUrl,
    sitemapIndexUrl: `${baseUrl}/${SITEMAP_INDEX_FILE}`,
    totalUrls: entries.length,
  };
}

module.exports = sitemapService;