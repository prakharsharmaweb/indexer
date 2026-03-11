
const { Queue } = require("bullmq");
const { normalizeHttpUrl } = require("./urlUtils");

const QUEUE_NAME = "indexingQueue";

/*
Redis connection
*/

const connection = process.env.REDIS_URL
  ? { url: process.env.REDIS_URL }
  : {
      host: process.env.REDIS_HOST || "127.0.0.1",
      port: Number(process.env.REDIS_PORT || 6379),
      password: process.env.REDIS_PASSWORD || undefined,
    };

let indexingQueue;

/*
Create / reuse queue
*/

function getIndexingQueue() {

  if (!indexingQueue) {

    indexingQueue = new Queue(QUEUE_NAME, {

      connection,

      defaultJobOptions: {

        /*
        Retry configuration
        */

        attempts: Number(process.env.INDEXING_JOB_ATTEMPTS || 5),

        backoff: {
          type: "exponential",
          delay: Number(process.env.INDEXING_JOB_BACKOFF_MS || 2000),
        },

        /*
        Job cleanup
        */

        removeOnComplete: 1000,
        removeOnFail: 5000,

      },

    });

    indexingQueue.on("error", (error) => {
      console.error(`[${QUEUE_NAME}] Queue error: ${error.message}`);
    });

    indexingQueue.on("waiting", (jobId) => {
      console.log(`[${QUEUE_NAME}] Job queued: ${jobId}`);
    });

  }

  return indexingQueue;
}

/*
Add single indexing job
*/

async function addIndexingJob(url, priority = 5, jobId, delayMs = 0) {

  const normalizedUrl = normalizeHttpUrl(url);

  const parsedPriority = Number(priority);

  if (!Number.isFinite(parsedPriority)) {
    throw new Error("Priority must be a valid number.");
  }

  const jobOptions = {

    priority: parsedPriority,

    /*
    optional job id
    prevents duplicates
    */

    jobId: jobId ? String(jobId) : undefined,

    /*
    scheduled indexing
    */

    delay: Number(delayMs || 0),

  };

  return getIndexingQueue().add(
    "index-url",
    { url: normalizedUrl },
    jobOptions
  );

}

/*
Bulk indexing jobs
*/

async function addBulkIndexingJobs(urls, priority = 5) {

  if (!Array.isArray(urls) || urls.length === 0) {
    throw new Error("urls must be a non-empty array");
  }

  const queue = getIndexingQueue();

  const jobs = urls.map((url) => {

    const normalizedUrl = normalizeHttpUrl(url);

    return {

      name: "index-url",

      data: { url: normalizedUrl },

      opts: {
        priority: Number(priority || 5),
      },

    };

  });

  return queue.addBulk(jobs);

}

/*
Queue statistics
*/

async function getQueueStats() {

  const queue = getIndexingQueue();

  const counts = await queue.getJobCounts(
    "waiting",
    "active",
    "completed",
    "failed",
    "delayed"
  );

  return counts;

}

module.exports = {

  QUEUE_NAME,

  connection,

  getIndexingQueue,

  addIndexingJob,

  addBulkIndexingJobs,

  getQueueStats,

};

