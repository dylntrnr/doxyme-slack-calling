const fs = require("fs/promises");
const path = require("path");

const DEFAULT_DATA_DIR = path.join(process.cwd(), "data");
const FALLBACK_DATA_DIR = "/tmp/doxyme-slack-calling";
const USERS_FILE = "users.json";

let dataDirPromise;
let writeLock = Promise.resolve();

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function canWrite(dirPath) {
  try {
    await ensureDir(dirPath);
    await fs.access(dirPath, fs.constants.W_OK);
    return true;
  } catch (err) {
    return false;
  }
}

async function resolveDataDir() {
  if (dataDirPromise) return dataDirPromise;
  dataDirPromise = (async () => {
    if (process.env.DATA_DIR) {
      await ensureDir(process.env.DATA_DIR);
      return process.env.DATA_DIR;
    }
    if (await canWrite(DEFAULT_DATA_DIR)) return DEFAULT_DATA_DIR;
    await ensureDir(FALLBACK_DATA_DIR);
    return FALLBACK_DATA_DIR;
  })();
  return dataDirPromise;
}

async function getUsersFilePath() {
  const dir = await resolveDataDir();
  return path.join(dir, USERS_FILE);
}

async function ensureFile(filePath, defaultValue) {
  try {
    await fs.access(filePath, fs.constants.F_OK);
  } catch (err) {
    await fs.writeFile(filePath, JSON.stringify(defaultValue, null, 2));
  }
}

async function readJson(filePath, defaultValue) {
  try {
    await ensureFile(filePath, defaultValue);
    const contents = await fs.readFile(filePath, "utf8");
    if (!contents.trim()) return defaultValue;
    return JSON.parse(contents);
  } catch (err) {
    if (err.code === "ENOENT") return defaultValue;
    throw err;
  }
}

async function writeJsonAtomic(filePath, data) {
  const dir = path.dirname(filePath);
  const tempPath = path.join(dir, `${path.basename(filePath)}.tmp`);
  await fs.writeFile(tempPath, JSON.stringify(data, null, 2));
  await fs.rename(tempPath, filePath);
}

async function withWriteLock(fn) {
  const previous = writeLock;
  let release;
  writeLock = new Promise((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await fn();
  } finally {
    release();
  }
}

async function getUser(slackUserId) {
  const filePath = await getUsersFilePath();
  const data = await readJson(filePath, {});
  return data[slackUserId] || null;
}

async function setUser(slackUserId, doxyUrl) {
  const filePath = await getUsersFilePath();
  return withWriteLock(async () => {
    const data = await readJson(filePath, {});
    data[slackUserId] = {
      doxyUrl,
      updatedAt: new Date().toISOString()
    };
    await writeJsonAtomic(filePath, data);
    return data[slackUserId];
  });
}

module.exports = {
  getUser,
  setUser,
  resolveDataDir
};
