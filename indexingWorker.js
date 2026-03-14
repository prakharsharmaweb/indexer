
const { Worker, QueueEvents } = require("bullmq");
const { QUEUE_NAME, connection, addIndexingJob } = require("./queue");
const { markSubmissionByJobId } = require("./db");

/*
Service loader
*/

function loadService(serviceName) {

  const candidatePaths = [
    `./services/${serviceName}`,
    `./${serviceName}`
  ];

  for (const p of candidatePaths) {

    try {
      return require(p);
    } catch (error) {

      if (
        error.code !== "MODULE_NOT_FOUND" ||
        !error.message.includes(serviceName)
      ) {
        throw error;
      }

    }

  }

  throw new Error(
    `Could not load ${serviceName}. Expected module at ./services/${serviceName}.js or ./${serviceName}.js`
  );

}

/*
Resolve exported handler
*/

function getServiceHandler(serviceModule, serviceName) {

  if (typeof serviceModule === "function") return serviceModule;

  if (typeof serviceModule?.index === "function") return serviceModule.index;

  if (typeof serviceModule?.run === "function") return serviceModule.run;

  if (typeof serviceModule?.execute === "function") return serviceModule.execute;

  throw new Error(
    `${serviceName} must export a function or index/run/execute`
  );

}

/*
Load indexing services
*/

const rssService = loadService("rssService");
const sitemapService = loadService("sitemapService");
const backlinkService = loadService("backlinkService");
const discoveryService = loadService("discoveryService");
const indexabilityService = loadService("indexabilityService");
const googleIndexingService = loadService("googleIndexingService");
const linkGraphService = loadService("linkGraphService");
const externalAssetHubService = loadService("externalAssetHubService");
const pdfLandingService = loadService("pdfLandingService");
const wrapperService = loadService("wrapperService");
const searchConsoleInspectionService = loadService("searchConsoleInspectionService");
const crawlerService = loadService("crawlerService");
const pingService = loadService("pingService");

/*
Service execution order
*/

const services = [
  { name: "indexabilityService", module: indexabilityService },

  { name: "googleIndexingService", module: googleIndexingService },

  { name: "pdfLandingService", module: pdfLandingService },

  { name: "wrapperService", module: wrapperService },

  { name: "externalAssetHubService", module: externalAssetHubService },

  { name: "discoveryService", module: discoveryService },

  { name: "linkGraphService", module: linkGraphService },

  { name: "backlinkService", module: backlinkService },

  { name: "rssService", module: rssService },

  { name: "sitemapService", module: sitemapService },

  { name: "searchConsoleInspectionService", module: searchConsoleInspectionService },

  { name: "crawlerService", module: crawlerService },

  { name: "pingService", module: pingService }

];

/*
Execute single service
*/

async function runService(service, url) {

  const handler = getServiceHandler(service.module, service.name);

  try {

    const result = await handler(url);

    console.log(`[INDEXING] ${service.name} completed`);

    return {
      service: service.name,
      success: true,
      result
    };

  } catch (error) {

    console.error(`[INDEXING] ${service.name} failed: ${error.message}`);

    return {
      service: service.name,
      success: false,
      error: error.message
    };

  }

}

/*
Delay utility
*/

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function buildCompletionReason(result) {
  if (!result || !Array.isArray(result.results)) {
    return "";
  }

  const parts = [];
  const indexabilityResult = result.results.find(
    (entry) => entry.service === "indexabilityService" && entry.success
  )?.result;
  const googleResult = result.results.find(
    (entry) => entry.service === "googleIndexingService" && entry.success
  )?.result;
  const failedServices = result.results
    .filter((entry) => !entry.success)
    .map((entry) => entry.service);
  const inspectionResult = result.results.find(
    (entry) => entry.service === "searchConsoleInspectionService" && entry.success
  )?.result;

  if (indexabilityResult?.summary) {
    parts.push(indexabilityResult.summary);
  }

  if (googleResult?.skipped && googleResult?.reason) {
    parts.push(`Google API skipped: ${googleResult.reason}`);
  }

  if (inspectionResult?.skipped && inspectionResult?.reason) {
    parts.push(`Search Console inspection skipped: ${inspectionResult.reason}`);
  } else if (inspectionResult?.verdict) {
    parts.push(
      `Search Console verdict: ${inspectionResult.verdict} (${inspectionResult.coverageState || "Unknown"})`
    );
  }

  if (failedServices.length > 0) {
    parts.push(`Service issues: ${failedServices.join(", ")}`);
  }

  return parts.join(" | ");
}

/*
Worker
*/

const worker = new Worker(

  QUEUE_NAME,

  async (job) => {

    const { url } = job.data || {};

    if (!url) {
      throw new Error("Job missing required field: url");
    }

    console.log(`[${QUEUE_NAME}] Processing URL: ${url}`);

    const results = [];

    const startedAt = Date.now();

    /*
    Run indexing pipeline
    */

    for (const service of services) {

      const result = await runService(service, url);

      results.push(result);

      /*
      Delay improves crawl signal spacing
      */

      await delay(500);

    }

    const duration = Date.now() - startedAt;

    console.log(`[INDEXING] Pipeline finished in ${duration} ms`);

    return {
      url,
      results,
      duration
    };

  },

  {
    connection,
    concurrency: Number(process.env.INDEXING_WORKER_CONCURRENCY || 5)
  }

);

/*
Queue events
*/

const queueEvents = new QueueEvents(
  QUEUE_NAME,
  { connection }
);

/*
Worker ready
*/

worker.on("ready", () => {
  console.log(`[${QUEUE_NAME}] Worker ready`);
});

/*
Job completed
*/

worker.on("completed", async (job, result) => {
  const duration = Number(result?.duration);
  await markSubmissionByJobId(job.id, {

    status: "success",

    processedAt: new Date().toISOString(),

    httpStatus: 200,

    reason: buildCompletionReason(result),

    latencyMs: Number.isFinite(duration) ? duration : null,

    result

  });

  console.log(`[${QUEUE_NAME}] Job completed: ${job.id}`);

});

/*
Job failed
*/

worker.on("failed", async (job, error) => {

  if (job?.id != null) {

    await markSubmissionByJobId(job.id, {

      status: "rejected",

      processedAt: new Date().toISOString(),

      httpStatus: 500,

      reason: error.message,

      error: error.message

    });

  }

  console.error(
    `[${QUEUE_NAME}] Job failed: ${job?.id ?? "unknown"} - ${error.message}`
  );

});

/*
Queue events error
*/

queueEvents.on("error", (error) => {

  console.error(`[${QUEUE_NAME}] QueueEvents error:`, error);

});

/*
Graceful shutdown
*/

async function shutdown() {

  console.log("Shutting down worker...");

  await Promise.all([
    worker.close(),
    queueEvents.close()
  ]);

  process.exit(0);

}

process.on("SIGINT", shutdown);

process.on("SIGTERM", shutdown);

module.exports = { worker };
