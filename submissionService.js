const { randomUUID } = require("crypto");
const { addIndexingJob } = require("./queue");
const { normalizeHttpUrl } = require("./urlUtils");
const { addSubmission, markSubmissionByJobId, getSubmissions } = require("./db");

const QUEUE_SUBMIT_TIMEOUT_MS = Number(process.env.QUEUE_SUBMIT_TIMEOUT_MS || 8000);

function withTimeout(promise, ms, timeoutMessage) {
  let timer;

  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(timeoutMessage)), ms);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function submitUrl({ url, priority = 5, requestedBy = "system", delayMs = 0 }) {
  if (typeof url !== "string" || !url.trim()) {
    throw new Error("Field 'url' is required.");
  }

  const normalizedUrl = normalizeHttpUrl(url);
  const parsedPriority = Number(priority);

  if (!Number.isFinite(parsedPriority)) {
    throw new Error("Field 'priority' must be a valid number.");
  }

  const submissionId = randomUUID();
  const submittedAt = new Date().toISOString();
  const submission = {
    id: submissionId,
    jobId: submissionId,
    url: normalizedUrl,
    priority: parsedPriority,
    requestedBy,
    status: "processing",
    submittedAt,
    processedAt: null,
    reason: "",
    httpStatus: null,
    latencyMs: null,
  };

  await addSubmission(submission);

  const startedAt = Date.now();
  try {
    await withTimeout(
      addIndexingJob(normalizedUrl, parsedPriority, submissionId, delayMs),
      QUEUE_SUBMIT_TIMEOUT_MS,
      "Queue submit timeout"
    );
  } catch (error) {
    const finishedAt = Date.now();
    await markSubmissionByJobId(submissionId, {
      status: "rejected",
      processedAt: new Date().toISOString(),
      reason: `Queue submit failed: ${error.message}`,
      httpStatus: 503,
      latencyMs: finishedAt - startedAt,
      error: error.message,
    });
    throw new Error("Could not queue submission.");
  }

  return submission;
}

async function submitUrls({
  urls,
  priority = 5,
  requestedBy = "system",
  delayMs = 0,
  skipExisting = false,
}) {
  if (!Array.isArray(urls) || urls.length === 0) {
    throw new Error("At least one URL is required.");
  }

  const existingUrls = skipExisting
    ? new Set((await getSubmissions()).map((item) => item.url))
    : new Set();
  const queued = [];
  const skipped = [];
  const normalizedBatch = [];

  for (const url of urls) {
    const normalizedUrl = normalizeHttpUrl(url);
    if (normalizedBatch.includes(normalizedUrl)) {
      skipped.push({ url: normalizedUrl, reason: "Duplicate URL in request." });
      continue;
    }

    normalizedBatch.push(normalizedUrl);

    if (skipExisting && existingUrls.has(normalizedUrl)) {
      skipped.push({ url: normalizedUrl, reason: "URL already submitted." });
      continue;
    }

    const submission = await submitUrl({
      url: normalizedUrl,
      priority,
      requestedBy,
      delayMs,
    });

    queued.push(submission);
    existingUrls.add(normalizedUrl);
  }

  return { queued, skipped };
}

module.exports = {
  submitUrl,
  submitUrls,
  withTimeout,
};
