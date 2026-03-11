function normalizeHttpUrl(input) {
  if (typeof input !== "string" || !input.trim()) {
    throw new Error("Invalid URL: URL is required.");
  }

  const original = input.trim();
  let candidate = original;

  // Users often paste Google operators like: site:https://example.com/page
  if (/^site\s*:/i.test(candidate)) {
    candidate = candidate.replace(/^site\s*:/i, "").trim();
  }

  if (!candidate) {
    throw new Error(`Invalid URL: ${original}`);
  }

  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error(`Invalid URL: ${original}`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Invalid URL: ${original}. Only http(s) URLs are supported.`);
  }

  return parsed.toString();
}

module.exports = {
  normalizeHttpUrl,
};
