const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

function ensureDir(target) {
  if (target) fs.mkdirSync(target, { recursive: true });
}

function atomicWriteFile(destination, content, encoding = "utf8") {
  ensureDir(path.dirname(destination));
  const temp = `${destination}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, content, encoding);
  try {
    fs.renameSync(temp, destination);
  } catch (error) {
    try { fs.rmSync(destination, { force: true }); } catch {}
    fs.renameSync(temp, destination);
  }
}

function atomicWriteJson(destination, value) {
  atomicWriteFile(destination, JSON.stringify(value, null, 2), "utf8");
}

function readJsonSafe(filePath, fallback = null) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
  }
  return value;
}

function fingerprint(value) {
  return crypto.createHash("sha256")
    .update(JSON.stringify(stableValue(value)))
    .digest("hex");
}

function fileLooksUsable(filePath, minBytes = 32) {
  try {
    return Boolean(filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile() && fs.statSync(filePath).size >= minBytes);
  } catch {
    return false;
  }
}

function isTransientError(error) {
  const message = String(error?.message || error || "");
  return /timeout|timed out|ECONNRESET|ECONNREFUSED|ENETUNREACH|EAI_AGAIN|socket|network|fetch failed|429|408|502|503|504|temporar|连接|超时|网络|限流|繁忙/i.test(message);
}

async function retryOperation(operation, {
  attempts = 3,
  initialDelayMs = 1200,
  maxDelayMs = 8000,
  onRetry = () => {},
  shouldRetry = isTransientError
} = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !shouldRetry(error)) throw error;
      const delay = Math.min(maxDelayMs, Math.round(initialDelayMs * Math.pow(2, attempt - 1)));
      onRetry(error, attempt, delay);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

module.exports = {
  atomicWriteFile,
  atomicWriteJson,
  readJsonSafe,
  fingerprint,
  fileLooksUsable,
  retryOperation,
  isTransientError
};
