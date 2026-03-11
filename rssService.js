
const fs = require("fs/promises");
const path = require("path");
const { normalizeHttpUrl } = require("./urlUtils");

const PUBLIC_DIR = path.join(__dirname, "public");
const RSS_FILE = path.join(PUBLIC_DIR, "rss.xml");

/*
Increase feed capacity for better discovery
*/
const MAX_ITEMS = Number(process.env.RSS_MAX_ITEMS || 1000);

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

/*
Public RSS URL
*/
function getFeedUrl() {
  const baseUrl = (process.env.PUBLIC_BASE_URL || "http://localhost:3000")
    .replace(/\/+$/, "");

  return `${baseUrl}/rss.xml`;
}

/*
Read existing RSS items
*/
async function readExistingItems() {

  let xml;

  try {
    xml = await fs.readFile(RSS_FILE, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }

  const itemRegex = /<item>[\s\S]*?<\/item>/g;
  const linkRegex = /<link>([\s\S]*?)<\/link>/;
  const guidRegex = /<guid(?:\s+[^>]*)?>([\s\S]*?)<\/guid>/;
  const pubDateRegex = /<pubDate>([\s\S]*?)<\/pubDate>/;

  const items = [];
  let match = itemRegex.exec(xml);

  while (match) {

    const block = match[0];

    const linkMatch = linkRegex.exec(block);

    if (!linkMatch?.[1]) continue;

    const url = unescapeXml(linkMatch[1].trim());

    const guidMatch = guidRegex.exec(block);
    const pubDateMatch = pubDateRegex.exec(block);

    items.push({
      url,
      guid: guidMatch?.[1]?.trim() || `${url}#${Date.now()}`,
      pubDate: pubDateMatch?.[1]?.trim() || new Date().toUTCString()
    });

    match = itemRegex.exec(xml);
  }

  return items;
}

/*
Build RSS XML
*/
function buildFeedXml(items) {

  const itemsXml = items
    .map((item) => {

      const escapedUrl = escapeXml(item.url);
      const escapedGuid = escapeXml(item.guid);
      const escapedDate = escapeXml(item.pubDate);

      return [
        "    <item>",
        `      <title>${escapedUrl}</title>`,
        `      <link>${escapedUrl}</link>`,
        `      <guid isPermaLink="false">${escapedGuid}</guid>`,
        `      <pubDate>${escapedDate}</pubDate>`,
        "    </item>"
      ].join("\n");

    })
    .join("\n");

  const feedUrl = escapeXml(getFeedUrl());

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<rss version=\"2.0\">",
    "  <channel>",
    "    <title>Indexing RSS Feed</title>",
    `    <link>${feedUrl}</link>`,
    "    <description>Latest submitted URLs for indexing</description>",
    `    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>`,
    itemsXml,
    "  </channel>",
    "</rss>",
    ""
  ].join("\n");

}

/*
Main service
*/
async function rssService(url) {

  if (typeof url !== "string" || !url.trim()) {
    throw new Error("rssService requires a non-empty URL string.");
  }

  const normalizedUrl = normalizeHttpUrl(url);

  await fs.mkdir(PUBLIC_DIR, { recursive: true });

  const existingItems = await readExistingItems();

  /*
  Deduplicate existing URL
  */
  const filtered = existingItems.filter(
    (item) => item.url !== normalizedUrl
  );

  const newItem = {
    url: normalizedUrl,
    guid: `${normalizedUrl}#${Date.now()}`,
    pubDate: new Date().toUTCString()
  };

  const updatedItems = [newItem, ...filtered].slice(0, MAX_ITEMS);

  const rssXml = buildFeedXml(updatedItems);

  /*
  Atomic write
  */

  const tmpFile = RSS_FILE + ".tmp";

  await fs.writeFile(tmpFile, rssXml, "utf8");

  await fs.rename(tmpFile, RSS_FILE);

  return {
    rssUrl: getFeedUrl(),
    items: updatedItems.length
  };

}

module.exports = rssService;

