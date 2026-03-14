const fs = require("fs/promises");
const path = require("path");

const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "submissions.json");
const EMPTY_DB = { submissions: [], managedSites: [] };

let writeChain = Promise.resolve();

async function ensureDbFile() {
  await fs.mkdir(DATA_DIR, { recursive: true });

  try {
    await fs.access(DB_FILE);
  } catch (error) {
    if (error.code === "ENOENT") {
      await fs.writeFile(DB_FILE, JSON.stringify(EMPTY_DB, null, 2), "utf8");
      return;
    }
    throw error;
  }
}

async function readDb() {
  await ensureDbFile();

  const raw = await fs.readFile(DB_FILE, "utf8");
  if (!raw.trim()) return { ...EMPTY_DB };

  const parsed = JSON.parse(raw);
  return {
    submissions: Array.isArray(parsed.submissions) ? parsed.submissions : [],
    managedSites: Array.isArray(parsed.managedSites) ? parsed.managedSites : [],
  };
}

function updateDb(mutator) {
  // Keep the chain usable even if a previous write failed.
  writeChain = writeChain.catch(() => undefined).then(async () => {
    const db = await readDb();
    const result = await mutator(db);
    await fs.writeFile(DB_FILE, JSON.stringify(db, null, 2), "utf8");
    return result;
  });

  return writeChain;
}

async function addSubmission(submission) {
  return updateDb((db) => {
    db.submissions.push(submission);
    return submission;
  });
}

async function markSubmissionByJobId(jobId, patch) {
  return updateDb((db) => {
    const submission = db.submissions.find((item) => String(item.jobId) === String(jobId));
    if (!submission) return null;
    Object.assign(submission, patch);
    return submission;
  });
}

async function getSubmissions() {
  await writeChain;
  const db = await readDb();
  return db.submissions;
}

async function getManagedSites() {
  await writeChain;
  const db = await readDb();
  return db.managedSites;
}

async function upsertManagedSite(site) {
  return updateDb((db) => {
    const index = db.managedSites.findIndex((item) => item.id === site.id);

    if (index === -1) {
      db.managedSites.push(site);
      return site;
    }

    db.managedSites[index] = {
      ...db.managedSites[index],
      ...site,
    };

    return db.managedSites[index];
  });
}

async function upsertManagedSites(sites) {
  return updateDb((db) => {
    const results = [];

    for (const site of sites) {
      const index = db.managedSites.findIndex((item) => item.id === site.id);

      if (index === -1) {
        db.managedSites.push(site);
        results.push(site);
        continue;
      }

      db.managedSites[index] = {
        ...db.managedSites[index],
        ...site,
      };

      results.push(db.managedSites[index]);
    }

    return results;
  });
}

async function updateManagedSiteById(siteId, patch) {
  return updateDb((db) => {
    const site = db.managedSites.find((item) => item.id === siteId);
    if (!site) return null;

    Object.assign(site, patch);
    return site;
  });
}

module.exports = {
  DB_FILE,
  addSubmission,
  markSubmissionByJobId,
  getSubmissions,
  getManagedSites,
  upsertManagedSite,
  upsertManagedSites,
  updateManagedSiteById,
};
