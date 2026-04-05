const axios = require("axios");
const { normalizeHttpUrl } = require("../urlUtils");

const REQUEST_TIMEOUT_MS = Number(
  process.env.INDEXABILITY_TIMEOUT_MS || 10000
);

function parseMetaRobots(html) {
  const match = html.match(
    /<meta[^>]+name=["']robots["'][^>]+content=["']([^"']+)["']/i
  );
  return match ? match[1].toLowerCase() : "";
}

function parseCanonicalUrl(html, baseUrl) {
  const linkTags = html.match(/<link\b[^>]*>/gi) || [];

  for (const tag of linkTags) {
    const relMatch = tag.match(/\brel=["']([^"']+)["']/i);
    if (!relMatch?.[1] || !/\bcanonical\b/i.test(relMatch[1])) {
      continue;
    }

    const hrefMatch = tag.match(/\bhref=["']([^"']+)["']/i);
    if (!hrefMatch?.[1]) {
      continue;
    }

    try {
      return new URL(hrefMatch[1].trim(), baseUrl).toString();
    } catch {
      return "";
    }
  }

  return "";
}

function normalizePathname(url) {
  const parsed = new URL(url);
  const pathname = parsed.pathname || "/";
  return parsed.search ? `${pathname}${parsed.search}` : pathname;
}

function stripUrlHash(url) {
  const parsed = new URL(url);
  parsed.hash = "";
  return parsed.toString();
}

function parseRobotsTxt(content) {
  const groups = {};
  let currentAgents = [];

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) {
      currentAgents = [];
      continue;
    }

    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim().toLowerCase();
    const value = line.slice(separatorIndex + 1).trim();

    if (key === "user-agent") {
      const agent = value.toLowerCase();
      currentAgents = [agent];
      if (!groups[agent]) {
        groups[agent] = [];
      }
      continue;
    }

    if (!currentAgents.length) {
      continue;
    }

    if (key === "allow" || key === "disallow") {
      for (const agent of currentAgents) {
        groups[agent].push({
          type: key,
          value,
        });
      }
    }
  }

  return groups;
}

function isBlockedByRobots(rulesByAgent, targetPath) {
  const applicableRules = [
    ...(rulesByAgent.googlebot || []),
    ...(rulesByAgent["*"] || []),
  ].filter((rule) => rule.value && targetPath.startsWith(rule.value));

  if (!applicableRules.length) {
    return false;
  }

  applicableRules.sort((left, right) => right.value.length - left.value.length);
  return applicableRules[0].type === "disallow";
}

async function fetchRobotsStatus(targetUrl) {
  const parsed = new URL(targetUrl);
  const robotsUrl = `${parsed.origin}/robots.txt`;

  try {
    const response = await axios({
      method: "GET",
      url: robotsUrl,
      timeout: REQUEST_TIMEOUT_MS,
      validateStatus: () => true,
    });

    if (response.status !== 200 || typeof response.data !== "string") {
      return {
        available: false,
        blocked: false,
      };
    }

    const rulesByAgent = parseRobotsTxt(response.data);
    return {
      available: true,
      blocked: isBlockedByRobots(rulesByAgent, normalizePathname(targetUrl)),
    };
  } catch {
    return {
      available: false,
      blocked: false,
    };
  }
}

async function requestUrl(targetUrl, method) {
  return axios({
    method,
    url: targetUrl,
    timeout: REQUEST_TIMEOUT_MS,
    maxRedirects: 5,
    validateStatus: () => true,
    responseType: "text",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; IndexabilityChecker/1.0; +https://example.com/bot)",
    },
  });
}

async function indexabilityService(url) {
  const submittedUrl = normalizeHttpUrl(url);
  const issues = [];
  const recommendations = [];
  let response = await requestUrl(submittedUrl, "HEAD");

  if (
    response.status === 405 ||
    !response.headers["content-type"] ||
    String(response.headers["content-type"] || "").toLowerCase().includes("text/html")
  ) {
    response = await requestUrl(submittedUrl, "GET");
  }

  const finalUrl =
    response.request?.res?.responseUrl || response.config?.url || submittedUrl;
  const status = response.status;
  const contentType = String(response.headers["content-type"] || "").toLowerCase();
  const xRobotsTag = String(response.headers["x-robots-tag"] || "").toLowerCase();
  const robotsStatus = await fetchRobotsStatus(finalUrl);
  const redirected = stripUrlHash(finalUrl) !== stripUrlHash(submittedUrl);

  if (status < 200 || status >= 400) {
    issues.push(`URL returned HTTP ${status}`);
    recommendations.push("Serve the URL with a stable 200 response.");
  }

  if (redirected) {
    issues.push(`Submitted URL redirects to ${finalUrl}.`);
    recommendations.push("Submit the final canonical URL directly and serve it with a stable 200 response.");
  }

  if (robotsStatus.blocked) {
    issues.push("Blocked by robots.txt for Googlebot.");
    recommendations.push("Allow crawling in robots.txt for this path.");
  }

  if (xRobotsTag.includes("noindex")) {
    issues.push("X-Robots-Tag contains noindex.");
    recommendations.push("Remove the noindex directive from response headers.");
  }

  let metaRobots = "";
  let canonicalUrl = "";
  let canonicalMatchesFinal = true;
  const isHtml = contentType.includes("text/html");
  const isPdf =
    contentType.includes("application/pdf") || finalUrl.toLowerCase().endsWith(".pdf");

  if (isHtml && typeof response.data === "string") {
    metaRobots = parseMetaRobots(response.data);
    canonicalUrl = parseCanonicalUrl(response.data, finalUrl);

    if (metaRobots.includes("noindex")) {
      issues.push("HTML meta robots contains noindex.");
      recommendations.push("Remove the meta robots noindex directive.");
    }

    if (canonicalUrl) {
      canonicalMatchesFinal = stripUrlHash(canonicalUrl) === stripUrlHash(finalUrl);

      if (!canonicalMatchesFinal) {
        issues.push(`Canonical points to ${canonicalUrl}.`);
        recommendations.push("Make the canonical URL match the page you want Google to index.");
      }
    }
  }

  if (isPdf) {
    recommendations.push("Link the PDF from crawlable HTML pages and include it in your sitemap.");
    recommendations.push("Use Google Search Console URL Inspection for the verified property.");
  }

  const crawlableByGoogle =
    status === 200 &&
    !robotsStatus.blocked &&
    !xRobotsTag.includes("noindex") &&
    !metaRobots.includes("noindex") &&
    canonicalMatchesFinal &&
    !redirected;

  const summary = crawlableByGoogle
    ? `Indexability looks good${isPdf ? " for a PDF" : ""}.`
    : issues.join(" ");

  return {
    url: submittedUrl,
    finalUrl,
    status,
    contentType,
    isHtml,
    isPdf,
    xRobotsTag,
    metaRobots,
    canonicalUrl,
    canonicalMatchesFinal,
    redirected,
    robotsTxtChecked: robotsStatus.available,
    blockedByRobots: robotsStatus.blocked,
    crawlableByGoogle,
    issues,
    recommendations,
    summary,
  };
}

module.exports = indexabilityService;
