const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const os = require("node:os");
const { spawn } = require("node:child_process");
let ProxyAgent = null;
let undiciFetch = null;
try { ({ ProxyAgent, fetch: undiciFetch } = require("undici")); } catch {}
const proxyAgentCache = new Map();
const { testModelConnection } = require("./llm-planner.cjs");
const { buildImageRequestCandidate, buildImageRequestCandidates, imagePromptAudit } = require("./image-prompt-builder.cjs");
const {
  currentCancellationSignal, cancellationError, throwIfCancelled, cancellableSleep, TaskCancelledError, isCancellationError
} = require("./cancellation.cjs");

function spawnAsync(command, args, options = {}) {
  const signal = options.signal || currentCancellationSignal();
  const spawnOptions = { windowsHide: true, ...options };
  delete spawnOptions.signal;
  throwIfCancelled(signal);
  return new Promise((resolve, reject) => {
    let settled = false;
    let child;
    const finish = callback => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = () => {
      try { child?.kill("SIGTERM"); } catch {}
      finish(() => reject(cancellationError(signal)));
    };
    try {
      child = spawn(command, args, spawnOptions);
    } catch (error) {
      reject(error);
      return;
    }
    let stdout = "";
    let stderr = "";
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) { onAbort(); return; }
    child.stdout?.on("data", chunk => { stdout += chunk.toString(); });
    child.stderr?.on("data", chunk => { stderr += chunk.toString(); });
    child.on("error", error => finish(() => reject(signal?.aborted ? cancellationError(signal) : error)));
    child.on("close", code => finish(() => {
      if (signal?.aborted) reject(cancellationError(signal));
      else if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr.trim() || stdout.trim() || `${path.basename(command)} 退出码 ${code}`));
    }));
  });
}

function normalizeProxyUrl(value = "") {
  let proxyUrl = String(value || "").trim();
  if (!proxyUrl) return "";
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(proxyUrl)) proxyUrl = `http://${proxyUrl}`;
  let parsed;
  try {
    parsed = new URL(proxyUrl);
  } catch {
    throw new Error(`代理地址格式错误：${proxyUrl}`);
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`当前仅支持 HTTP/HTTPS 代理，收到：${parsed.protocol}`);
  }
  if (!parsed.hostname || !parsed.port) {
    throw new Error(`代理地址必须包含主机和端口，例如 http://127.0.0.1:7897`);
  }
  return parsed.toString().replace(/\/$/, "");
}

function proxyDispatcher(proxyUrl = "") {
  const normalized = normalizeProxyUrl(proxyUrl);
  if (!normalized) return null;
  if (!ProxyAgent || !undiciFetch) {
    throw new Error("已配置网络代理，但 undici 的 fetch/ProxyAgent 不可用，请在项目目录执行 npm install");
  }
  let dispatcher = proxyAgentCache.get(normalized);
  if (!dispatcher) {
    dispatcher = new ProxyAgent(normalized);
    proxyAgentCache.set(normalized, dispatcher);
  }
  return { normalized, dispatcher };
}

function decorateProxyError(error, proxyUrl, targetUrl) {
  if (!proxyUrl) return error;
  const code = error?.cause?.code || error?.code || "";
  const detail = String(error?.cause?.message || error?.message || error || "网络请求失败");
  const targetHost = (() => { try { return new URL(targetUrl).host; } catch { return String(targetUrl); } })();
  const wrapped = new Error(`通过代理 ${proxyUrl} 访问 ${targetHost} 失败：${detail}`);
  wrapped.code = code || "PROXY_REQUEST_FAILED";
  wrapped.cause = error;
  return wrapped;
}

async function fetchWithProxy(url, options = {}, proxyUrl = "") {
  const signal = options.signal || currentCancellationSignal();
  throwIfCancelled(signal);
  const proxy = proxyDispatcher(proxyUrl);
  const requestOptions = {
    ...options,
    ...(signal ? { signal } : {})
  };
  try {
    // Electron 主进程中的 global fetch 可能走 Chromium/Node 自带实现，
    // 对外部 undici ProxyAgent 的 dispatcher 支持并不稳定。
    // 配置代理时必须同时使用同一份 undici.fetch，确保代理真正生效。
    if (proxy) {
      return await undiciFetch(url, { ...requestOptions, dispatcher: proxy.dispatcher });
    }
    return await globalThis.fetch(url, requestOptions);
  } catch (error) {
    if (signal?.aborted || error?.name === "AbortError") throw cancellationError(signal);
    throw decorateProxyError(error, proxy?.normalized || "", url);
  }
}

async function fetchWithTimeout(url, options = {}, proxyUrl = "", timeoutMs = 20000) {
  const taskSignal = options.signal || currentCancellationSignal();
  throwIfCancelled(taskSignal);
  const controller = new AbortController();
  const timeout = Math.max(3000, Number(timeoutMs || 20000));
  const onTaskAbort = () => controller.abort(cancellationError(taskSignal));
  taskSignal?.addEventListener("abort", onTaskAbort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error("REQUEST_TIMEOUT")), timeout);
  try {
    return await fetchWithProxy(url, { ...options, signal: controller.signal }, proxyUrl);
  } catch (error) {
    if (taskSignal?.aborted) throw cancellationError(taskSignal);
    if (controller.signal.aborted || error?.name === "AbortError") {
      const timeoutError = new Error(`请求超过 ${Math.round(timeout / 1000)} 秒未响应`);
      timeoutError.code = "REQUEST_TIMEOUT";
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
    taskSignal?.removeEventListener("abort", onTaskAbort);
  }
}

function resolveResource(app, ...parts) {
  return app.isPackaged
    ? path.join(process.resourcesPath, ...parts)
    : path.join(__dirname, "..", "resources", ...parts);
}

function ffmpegPath(app, config) {
  const configured = config?.media?.ffmpeg_path;
  if (configured && fs.existsSync(configured)) return configured;
  const bundled = resolveResource(app, "bin", "ffmpeg.exe");
  return fs.existsSync(bundled) ? bundled : "ffmpeg";
}

async function downloadFile(url, destination, headers = {}, proxyUrl = "", timeoutMs = 120000) {
  const response = await fetchWithTimeout(url, { headers }, proxyUrl, timeoutMs);
  if (!response.ok) throw new Error(`下载素材失败 (${response.status})`);
  fs.writeFileSync(destination, Buffer.from(await response.arrayBuffer()));
}

const getByPath = (source, fieldPath) => String(fieldPath || "").split(".")
  .filter(Boolean).reduce((value, key) => value?.[Number.isInteger(Number(key)) ? Number(key) : key], source);

const sleep = ms => cancellableSleep(ms);

function mappedImageSize(section, ratio) {
  try {
    const mapping = JSON.parse(section.ratio_mapping_json || "{}");
    return mapping[ratio] || imageSize(ratio).apiSize;
  } catch {
    return imageSize(ratio).apiSize;
  }
}

function isImageBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8) return false;
  return (
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    || buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
    || buffer.subarray(0, 6).toString("ascii") === "GIF87a"
    || buffer.subarray(0, 6).toString("ascii") === "GIF89a"
    || (buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP")
    || buffer.subarray(0, 2).toString("ascii") === "BM"
    || buffer.subarray(0, 4).toString("hex") === "00000100"
    || buffer.subarray(4, 12).toString("ascii").startsWith("ftypavif")
    || buffer.subarray(4, 12).toString("ascii").startsWith("ftypheic")
  );
}

function decodeImageBase64(value) {
  const source = String(value || "").trim().replace(/^data:image\/[^;]+;base64,/i, "").replace(/\s+/g, "");
  if (source.length < 32 || !/^[A-Za-z0-9+/_=-]+$/.test(source)) return null;
  try {
    const normalized = source.replace(/-/g, "+").replace(/_/g, "/");
    const buffer = Buffer.from(normalized, "base64");
    return isImageBuffer(buffer) ? buffer : null;
  } catch {
    return null;
  }
}

function normalizeImageUrl(value, baseUrl = "") {
  let text = String(value || "").trim()
    .replace(/&amp;/gi, "&")
    .replace(/\\u0026/gi, "&")
    .replace(/\\\//g, "/");
  const markdown = text.match(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/i);
  if (markdown) text = markdown[1];
  const embedded = text.match(/https?:\/\/[^\s"'<>]+/i);
  if (embedded && !/^https?:\/\//i.test(text)) text = embedded[0];
  if (/^\/\//.test(text)) return `https:${text}`;
  if (/^https?:\/\//i.test(text)) return text;
  if (/^\//.test(text) && baseUrl) {
    try { return new URL(text, baseUrl).toString(); } catch {}
  }
  return "";
}

function isPollingSourcePath(sourcePath = "") {
  return /(?:^|\.)(?:poll(?:ing)?_?url|status_?url|task_?url|query_?url|result_?url|check_?url)$/i.test(String(sourcePath));
}

function isLikelyPollingUrl(value = "", sourcePath = "") {
  if (isPollingSourcePath(sourcePath)) return true;
  try {
    const parsed = new URL(String(value));
    return /\/(?:api\/)?(?:image-?tasks?|tasks?\/(?:status|result)|operations?)(?:\/|$)/i.test(parsed.pathname)
      && /(?:^|[?&])(?:ids?|task_ids?|operation_ids?)=/i.test(parsed.search);
  } catch {
    return false;
  }
}

function imageCandidateFromValue(value, baseUrl = "", sourcePath = "response") {
  if (typeof value === "string") {
    const text = value.trim();
    if (/^data:image\//i.test(text)) {
      const buffer = decodeImageBase64(text);
      if (buffer) return { kind: "buffer", buffer, sourcePath };
    }
    const url = normalizeImageUrl(text, baseUrl);
    if (url && !isLikelyPollingUrl(url, sourcePath)) return { kind: "url", url, sourcePath };
    const buffer = decodeImageBase64(text);
    if (buffer) return { kind: "buffer", buffer, sourcePath };
    return null;
  }
  if (Buffer.isBuffer(value) && isImageBuffer(value)) return { kind: "buffer", buffer: value, sourcePath };
  return null;
}

const IMAGE_VALUE_KEYS = [
  "b64_json", "b64", "base64", "image_base64", "imageBase64", "image_data", "imageData",
  "url", "fileUrl", "file_url", "image_url", "imageUrl", "output_url", "outputUrl",
  "download_url", "downloadUrl", "src", "image"
];

const IMAGE_CONTAINER_KEYS = [
  "data", "output", "outputs", "images", "image", "result", "results", "response", "content",
  "artifacts", "files", "generations", "choices"
];

function findImageCandidate(payload, configuredField = "", baseUrl = "") {
  const visited = new Set();
  const candidates = [];
  if (configuredField) candidates.push([getByPath(payload, configuredField), configuredField]);
  const knownPaths = [
    "data.0", "data.images.0", "data.output.0", "output.images.0", "output.0", "outputs.0",
    "images.0", "result.data.0", "result.images.0", "result.0", "results.0",
    "response.data.0", "response.images.0", "artifacts.0", "files.0",
    "choices.0.message.content", "choices.0.message.image_url", "choices.0.message.images.0"
  ];
  for (const fieldPath of knownPaths) candidates.push([getByPath(payload, fieldPath), fieldPath]);

  for (const [value, sourcePath] of candidates) {
    const direct = imageCandidateFromValue(value, baseUrl, sourcePath);
    if (direct) return direct;
    if (value && typeof value === "object") {
      for (const key of IMAGE_VALUE_KEYS) {
        const nested = imageCandidateFromValue(value[key], baseUrl, `${sourcePath}.${key}`);
        if (nested) return nested;
      }
    }
  }

  const walk = (value, sourcePath, depth) => {
    if (depth > 8 || value === null || value === undefined) return null;
    const direct = imageCandidateFromValue(value, baseUrl, sourcePath);
    if (direct) return direct;
    if (typeof value !== "object") return null;
    if (visited.has(value)) return null;
    visited.add(value);
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        const found = walk(value[index], `${sourcePath}.${index}`, depth + 1);
        if (found) return found;
      }
      return null;
    }
    for (const key of IMAGE_VALUE_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
      const found = walk(value[key], `${sourcePath}.${key}`, depth + 1);
      if (found) return found;
    }
    for (const key of IMAGE_CONTAINER_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
      const found = walk(value[key], `${sourcePath}.${key}`, depth + 1);
      if (found) return found;
    }
    for (const [key, child] of Object.entries(value)) {
      if (IMAGE_VALUE_KEYS.includes(key) || IMAGE_CONTAINER_KEYS.includes(key)) continue;
      const found = walk(child, `${sourcePath}.${key}`, depth + 1);
      if (found) return found;
    }
    return null;
  };
  return walk(payload, "response", 0);
}


const IMAGE_POLL_URL_KEYS = [
  "poll_url", "pollUrl", "polling_url", "pollingUrl", "status_url", "statusUrl",
  "task_url", "taskUrl", "query_url", "queryUrl", "result_url", "resultUrl",
  "check_url", "checkUrl"
];

function findImagePollCandidate(payload, baseUrl = "") {
  const visited = new Set();
  const knownPaths = [
    "poll_url", "pollUrl", "status_url", "statusUrl", "task_url", "taskUrl",
    "response.poll_url", "response.pollUrl", "response.status_url", "response.statusUrl",
    "data.poll_url", "data.pollUrl", "data.status_url", "data.statusUrl",
    "result.poll_url", "result.pollUrl", "result.status_url", "result.statusUrl"
  ];
  for (const fieldPath of knownPaths) {
    const url = normalizeImageUrl(getByPath(payload, fieldPath), baseUrl);
    if (url) return { url, sourcePath: fieldPath };
  }
  const walk = (value, sourcePath, depth) => {
    if (depth > 8 || value === null || value === undefined || typeof value !== "object") return null;
    if (visited.has(value)) return null;
    visited.add(value);
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        const found = walk(value[index], `${sourcePath}.${index}`, depth + 1);
        if (found) return found;
      }
      return null;
    }
    for (const key of IMAGE_POLL_URL_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
      const url = normalizeImageUrl(value[key], baseUrl);
      if (url) return { url, sourcePath: `${sourcePath}.${key}` };
    }
    for (const [key, child] of Object.entries(value)) {
      const found = walk(child, `${sourcePath}.${key}`, depth + 1);
      if (found) return found;
    }
    return null;
  };
  return walk(payload, "response", 0);
}

function imageTaskIdFromPayload(payload, pollUrl = "") {
  const paths = [
    "task_id", "taskId", "id", "response.task_id", "response.taskId", "response.id",
    "data.task_id", "data.taskId", "data.id", "result.task_id", "result.taskId", "result.id"
  ];
  for (const fieldPath of paths) {
    const value = getByPath(payload, fieldPath);
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  try {
    const parsed = new URL(pollUrl);
    return parsed.searchParams.get("ids") || parsed.searchParams.get("id")
      || parsed.searchParams.get("task_id") || parsed.searchParams.get("taskId") || "";
  } catch {
    return "";
  }
}

function imageTaskStatus(payload) {
  const paths = [
    "status", "state", "task_status", "taskStatus", "response.status", "response.state",
    "response.task_status", "response.taskStatus", "data.status", "data.state",
    "data.task_status", "data.taskStatus", "result.status", "result.state",
    "results.0.status", "results.0.state", "tasks.0.status", "tasks.0.state"
  ];
  for (const fieldPath of paths) {
    const value = getByPath(payload, fieldPath);
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim().toLowerCase();
  }
  return "";
}

function imageTaskMessage(payload) {
  const paths = [
    "error.message", "error", "message", "msg", "detail", "response.error.message",
    "response.message", "data.error.message", "data.message", "result.error.message", "result.message"
  ];
  for (const fieldPath of paths) {
    const value = getByPath(payload, fieldPath);
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function redactImagePayloadForDebug(value, depth = 0) {
  if (depth > 10) return "[max-depth]";
  if (Array.isArray(value)) return value.slice(0, 20).map(item => redactImagePayloadForDebug(item, depth + 1));
  if (value && typeof value === "object") {
    const output = {};
    for (const [key, child] of Object.entries(value)) {
      if (/api[_-]?key|authorization|token/i.test(key)) output[key] = "[redacted]";
      else output[key] = redactImagePayloadForDebug(child, depth + 1);
    }
    return output;
  }
  if (typeof value === "string") {
    if (/^data:image\//i.test(value) || decodeImageBase64(value)) return `[image-base64 length=${value.length}]`;
    const redacted = value.replace(/([?&](?:token|access_token|signature|sig|key|api_key|x-amz-signature|x-goog-signature)=)[^&\s]+/gi, "$1[redacted]");
    return redacted.length > 4000 ? `${redacted.slice(0, 4000)}...[truncated ${redacted.length - 4000} chars]` : redacted;
  }
  return value;
}

function imageResponseDebugPath(destination) {
  const imageDir = path.dirname(destination);
  const outputDir = path.basename(imageDir).toLowerCase() === "images" ? path.dirname(imageDir) : imageDir;
  const debugDir = path.join(outputDir, "image-debug");
  fs.mkdirSync(debugDir, { recursive: true });
  return path.join(debugDir, `${path.basename(destination, path.extname(destination))}-response.json`);
}

function writeImageResponseDebug(destination, data) {
  const debugPath = imageResponseDebugPath(destination);
  try {
    fs.writeFileSync(debugPath, JSON.stringify({
      created_at: new Date().toISOString(),
      ...redactImagePayloadForDebug(data)
    }, null, 2), "utf8");
  } catch {}
  return debugPath;
}

function imageDownloadDebugPath(destination) {
  const imageDir = path.dirname(destination);
  const outputDir = path.basename(imageDir).toLowerCase() === "images" ? path.dirname(imageDir) : imageDir;
  const debugDir = path.join(outputDir, "image-debug");
  fs.mkdirSync(debugDir, { recursive: true });
  return path.join(debugDir, `${path.basename(destination, path.extname(destination))}-download.json`);
}

function writeImageDownloadDebug(destination, data) {
  const debugPath = imageDownloadDebugPath(destination);
  try {
    fs.writeFileSync(debugPath, JSON.stringify({
      created_at: new Date().toISOString(),
      ...redactImagePayloadForDebug(data)
    }, null, 2), "utf8");
  } catch {}
  return debugPath;
}

function imagePollDebugPath(destination) {
  const imageDir = path.dirname(destination);
  const outputDir = path.basename(imageDir).toLowerCase() === "images" ? path.dirname(imageDir) : imageDir;
  const debugDir = path.join(outputDir, "image-debug");
  fs.mkdirSync(debugDir, { recursive: true });
  return path.join(debugDir, `${path.basename(destination, path.extname(destination))}-poll.json`);
}

function writeImagePollDebug(destination, data) {
  const debugPath = imagePollDebugPath(destination);
  try {
    fs.writeFileSync(debugPath, JSON.stringify({
      created_at: new Date().toISOString(),
      ...redactImagePayloadForDebug(data)
    }, null, 2), "utf8");
  } catch {}
  return debugPath;
}

function urlOrigin(value) {
  try { return new URL(value).origin; } catch { return ""; }
}

function imageDownloadHeaders(candidateUrl, baseUrl, apiKey = "") {
  const headers = {
    accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
    "accept-language": "zh-CN,zh;q=0.9,en;q=0.7",
    "cache-control": "no-cache",
    pragma: "no-cache",
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36"
  };
  const candidateOrigin = urlOrigin(candidateUrl);
  const apiOrigin = urlOrigin(baseUrl);
  // 只向同源下载地址附带 API Key，避免把密钥泄露给第三方 CDN。
  if (apiKey && candidateOrigin && apiOrigin && candidateOrigin === apiOrigin) {
    headers.authorization = `Bearer ${apiKey}`;
    headers.referer = `${apiOrigin}/`;
  }
  return headers;
}

function retryDelayMs(response, attempt) {
  const retryAfter = response?.headers?.get?.("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, Math.min(15000, seconds * 1000));
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) return Math.max(0, Math.min(15000, date - Date.now()));
  }
  return Math.min(8000, 500 * (2 ** Math.max(0, attempt - 1)));
}

function isRetryableImageDownloadStatus(status) {
  return [408, 409, 425, 429, 500, 502, 503, 504].includes(Number(status));
}

async function saveImageResponse(item, destination, proxyUrl = "", baseUrl = "", downloadContext = {}, depth = 0) {
  const candidate = item?.kind ? item : findImageCandidate(item, "", baseUrl);
  if (!candidate) throw new Error("图片接口未返回可识别的图片地址或 Base64 数据");
  if (candidate.kind === "buffer") {
    fs.writeFileSync(destination, candidate.buffer);
    return { sourcePath: candidate.sourcePath, sourceUrl: "" };
  }
  if (candidate.kind === "url") {
    const maxAttempts = Math.max(1, Number(downloadContext.maxAttempts || 6));
    const attempts = [];
    let lastError = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      let response;
      try {
        response = await fetchWithProxy(candidate.url, {
          headers: imageDownloadHeaders(candidate.url, baseUrl, downloadContext.apiKey || ""),
          redirect: "follow"
        }, proxyUrl);
      } catch (error) {
        lastError = error;
        attempts.push({ attempt, network_error: String(error?.message || error) });
        if (attempt < maxAttempts) {
          await sleep(Math.min(8000, 500 * (2 ** Math.max(0, attempt - 1))));
          continue;
        }
        break;
      }

      const contentType = response.headers.get("content-type") || "";
      if (!response.ok) {
        let body = "";
        try { body = (await response.text()).slice(0, 1200); } catch {}
        attempts.push({
          attempt,
          status: response.status,
          status_text: response.statusText || "",
          content_type: contentType,
          response_body: body
        });
        lastError = new Error(`HTTP ${response.status}`);
        if (attempt < maxAttempts && isRetryableImageDownloadStatus(response.status)) {
          await sleep(retryDelayMs(response, attempt));
          continue;
        }
        break;
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      if (isImageBuffer(buffer)) {
        fs.writeFileSync(destination, buffer);
        return { sourcePath: candidate.sourcePath, sourceUrl: candidate.url };
      }

      const text = buffer.toString("utf8").trim();
      attempts.push({
        attempt,
        status: response.status,
        content_type: contentType || "未知类型",
        response_body: text.slice(0, 1200)
      });
      // 某些中转站的“图片地址”实际上仍返回一层 JSON，再从中提取真实地址或 Base64。
      if (depth < 2 && text && (/json|text/i.test(contentType || "") || /^[\[{]/.test(text))) {
        try {
          const nestedPayload = JSON.parse(text);
          const nestedCandidate = findImageCandidate(nestedPayload, "", candidate.url);
          if (nestedCandidate) {
            return saveImageResponse(nestedCandidate, destination, proxyUrl, candidate.url, downloadContext, depth + 1);
          }
        } catch {}
      }
      lastError = new Error(`返回内容不是有效图片（${contentType || "未知类型"}）`);
      if (attempt < maxAttempts) {
        await sleep(Math.min(4000, 400 * attempt));
        continue;
      }
    }

    const debugPath = writeImageDownloadDebug(destination, {
      image_url: candidate.url,
      response_field: candidate.sourcePath || "",
      api_base_url: baseUrl,
      proxy_enabled: Boolean(proxyUrl),
      attempts
    });
    const lastStatus = [...attempts].reverse().find(entry => entry.status)?.status;
    if (lastStatus) {
      throw new Error(`下载图片结果失败 (${lastStatus})，已自动重试 ${attempts.length} 次。通常是中转站图片 CDN 暂时不可用、临时地址尚未就绪，或该下载地址需要同源鉴权。调试文件：${debugPath}`);
    }
    throw new Error(`下载图片结果失败：${String(lastError?.message || lastError || "网络异常")}。已自动重试 ${attempts.length} 次。调试文件：${debugPath}`);
  }
  throw new Error("图片接口返回了未知的图片数据类型");
}

async function pollImageResultUrl({
  pollUrl, section, endpoint, destination, provider = "custom_image", taskId = "", onProgress = () => {}
}) {
  let currentUrl = normalizeImageUrl(pollUrl, endpoint) || String(pollUrl || "").trim();
  if (!currentUrl) throw new Error("图片接口返回了空的任务查询地址");
  const startedAt = Date.now();
  const timeoutMs = Math.max(30000, Number(section.poll_timeout_seconds || 360) * 1000);
  const intervalMs = Math.max(1000, Math.min(10000, Number(section.poll_interval_ms || 2500)));
  const requestTimeoutMs = Math.max(5000, Math.min(60000, Number(section.poll_request_timeout_seconds || 20) * 1000));
  const attempts = [];
  let lastStatus = "";
  let lastMessage = "";
  let attempt = 0;
  const reportProgress = (state, message, extra = {}) => {
    const elapsedMs = Date.now() - startedAt;
    const payload = {
      state,
      poll_url: currentUrl,
      api_endpoint: endpoint,
      provider,
      task_id: taskId || imageTaskIdFromPayload({}, currentUrl),
      attempt,
      elapsed_ms: elapsedMs,
      timeout_ms: timeoutMs,
      message,
      attempts,
      ...extra
    };
    const debugPath = writeImagePollDebug(destination, payload);
    try { onProgress({ ...payload, debugPath }); } catch {}
    return debugPath;
  };

  reportProgress("polling", "已开始查询远程图片任务");

  while (Date.now() - startedAt < timeoutMs) {
    attempt += 1;
    let response;
    try {
      const headers = imageDownloadHeaders(currentUrl, endpoint, section.api_key || "");
      headers.accept = "application/json,image/avif,image/webp,image/png,image/jpeg,image/*,*/*;q=0.8";
      response = await fetchWithTimeout(
        currentUrl,
        { method: "GET", headers, redirect: "follow" },
        section.proxy_url,
        requestTimeoutMs
      );
    } catch (error) {
      attempts.push({ attempt, network_error: String(error?.message || error), code: error?.code || "" });
      if (attempts.length > 80) attempts.shift();
      reportProgress("polling", `第 ${attempt} 次查询未成功：${String(error?.message || error)}`);
      await sleep(intervalMs);
      continue;
    }

    const contentType = response.headers.get("content-type") || "";
    if (!response.ok) {
      let body = "";
      try { body = (await response.text()).slice(0, 1600); } catch {}
      attempts.push({
        attempt,
        status: response.status,
        status_text: response.statusText || "",
        content_type: contentType,
        response_body: body
      });
      if (attempts.length > 80) attempts.shift();
      if ([401, 403].includes(response.status)) {
        const debugPath = reportProgress("failed", `图片任务查询鉴权失败 (${response.status})`, {
          http_status: response.status
        });
        throw new Error(`图片任务查询鉴权失败 (${response.status})。调试文件：${debugPath}`);
      }
      if (!isRetryableImageDownloadStatus(response.status) && response.status !== 404) {
        const debugPath = reportProgress("failed", `查询图片任务失败 (${response.status})`, {
          http_status: response.status
        });
        throw new Error(`查询图片任务失败 (${response.status})。调试文件：${debugPath}`);
      }
      reportProgress("polling", `第 ${attempt} 次查询返回 ${response.status}，程序将继续等待`, {
        http_status: response.status
      });
      await sleep(Math.max(intervalMs, retryDelayMs(response, attempt)));
      continue;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (isImageBuffer(buffer)) {
      fs.writeFileSync(destination, buffer);
      reportProgress("completed", "远程图片任务已完成，图片已保存", { image_path: destination });
      return {
        path: destination,
        provider,
        taskId: taskId || imageTaskIdFromPayload({}, currentUrl),
        sourceUrl: currentUrl,
        responseField: "poll_response_binary"
      };
    }

    const text = buffer.toString("utf8").trim();
    let payload = null;
    if (text) {
      try { payload = JSON.parse(text); } catch {}
    }

    attempts.push({
      attempt,
      status: response.status,
      content_type: contentType || "未知类型",
      response_body: payload ? redactImagePayloadForDebug(payload) : text.slice(0, 1600)
    });
    if (attempts.length > 80) attempts.shift();

    if (!payload) {
      const direct = imageCandidateFromValue(text, currentUrl, "poll.response");
      if (direct) {
        const saved = await saveImageResponse(direct, destination, section.proxy_url, currentUrl, { apiKey: section.api_key });
        reportProgress("completed", "远程图片任务已完成，图片已保存", {
          image_path: destination,
          response_field: direct.sourcePath || "poll.response"
        });
        return {
          path: destination,
          provider,
          taskId: taskId || imageTaskIdFromPayload({}, currentUrl),
          sourceUrl: saved.sourceUrl || "",
          responseField: direct.sourcePath || "poll.response"
        };
      }
      lastMessage = text.slice(0, 240);
      reportProgress("polling", `第 ${attempt} 次查询尚未返回图片${lastMessage ? `：${lastMessage}` : ""}`);
      await sleep(intervalMs);
      continue;
    }

    const candidate = findImageCandidate(payload, section.image_field || "", currentUrl);
    if (candidate) {
      const saved = await saveImageResponse(candidate, destination, section.proxy_url, currentUrl, { apiKey: section.api_key });
      reportProgress("completed", "远程图片任务已完成，图片已保存", {
        image_path: destination,
        response_field: candidate.sourcePath || "poll.response"
      });
      return {
        path: destination,
        provider,
        taskId: taskId || imageTaskIdFromPayload(payload, currentUrl),
        sourceUrl: saved.sourceUrl || "",
        responseField: candidate.sourcePath || "poll.response"
      };
    }

    const nestedPoll = findImagePollCandidate(payload, currentUrl);
    if (nestedPoll?.url) currentUrl = nestedPoll.url;
    lastStatus = imageTaskStatus(payload);
    lastMessage = imageTaskMessage(payload);
    if (/failed|failure|error|cancelled|canceled|rejected|blocked|expired/.test(lastStatus)) {
      const debugPath = reportProgress("failed", `图片任务失败${lastStatus ? `：${lastStatus}` : ""}${lastMessage ? `，${lastMessage}` : ""}`, {
        task_id: taskId || imageTaskIdFromPayload(payload, currentUrl),
        final_status: lastStatus,
        final_message: lastMessage
      });
      throw new Error(`图片任务失败${lastStatus ? `：${lastStatus}` : ""}${lastMessage ? `，${lastMessage}` : ""}。调试文件：${debugPath}`);
    }

    reportProgress("polling", `第 ${attempt} 次查询完成，远程任务仍在处理中${lastStatus ? `（${lastStatus}）` : ""}`, {
      final_status: lastStatus,
      final_message: lastMessage
    });
    await sleep(intervalMs);
  }

  const debugPath = reportProgress("timeout", `图片任务等待超时（约 ${Math.round(timeoutMs / 1000)} 秒）`, {
    final_status: lastStatus,
    final_message: lastMessage
  });
  throw new Error(`图片任务等待超时（约 ${Math.round(timeoutMs / 1000)} 秒）${lastStatus ? `，最后状态：${lastStatus}` : ""}。该地址是任务查询接口，不是图片下载地址。调试文件：${debugPath}`);
}

function imageSize(ratio) {
  if (ratio === "21:9") return { width: 1920, height: 823, apiSize: "1536x1024" };
  if (ratio === "16:9") return { width: 1920, height: 1080, apiSize: "1536x1024" };
  if (ratio === "3:2") return { width: 1620, height: 1080, apiSize: "1536x1024" };
  if (ratio === "4:3") return { width: 1440, height: 1080, apiSize: "1536x1024" };
  if (ratio === "1:1") return { width: 1080, height: 1080, apiSize: "1024x1024" };
  if (ratio === "3:4") return { width: 1080, height: 1440, apiSize: "1024x1536" };
  if (ratio === "2:3") return { width: 1080, height: 1620, apiSize: "1024x1536" };
  return { width: 1080, height: 1920, apiSize: "1024x1536" };
}

async function createPlaceholderImage({ app, config, prompt, destination, ratio, index }) {
  const { width, height } = imageSize(ratio);
  const ppm = `${destination}.ppm`;
  const pixels = Buffer.alloc(width * height * 3);
  const seed = crypto.createHash("sha256").update(prompt).digest();
  const c1 = [35 + seed[0] % 70, 25 + seed[1] % 60, 55 + seed[2] % 90];
  const c2 = [15 + seed[3] % 50, 45 + seed[4] % 80, 65 + seed[5] % 100];
  for (let y = 0; y < height; y += 1) {
    const t = y / Math.max(1, height - 1);
    for (let x = 0; x < width; x += 1) {
      const glow = Math.max(0, 1 - Math.hypot(x / width - .68, y / height - .28) * 2.2);
      const offset = (y * width + x) * 3;
      for (let channel = 0; channel < 3; channel += 1) {
        pixels[offset + channel] = Math.min(255, Math.round(c1[channel] * (1 - t) + c2[channel] * t + glow * 45));
      }
    }
  }
  fs.writeFileSync(ppm, Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`), pixels]));
  await spawnAsync(ffmpegPath(app, config), ["-y", "-i", ppm, "-frames:v", "1", destination]);
  fs.unlinkSync(ppm);
  return { path: destination, provider: "placeholder", index };
}

function resolveImageEndpoint(baseUrl, endpointPath, kind = "generation") {
  const rawBase = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!rawBase) throw new Error("图片接口尚未填写 Base URL");
  const targetPath = String(endpointPath || (kind === "edit" ? "/images/edits" : "/images/generations")).trim();
  if (/^https?:\/\//i.test(targetPath)) return targetPath;
  const normalizedPath = targetPath.startsWith("/") ? targetPath : `/${targetPath}`;
  if (/\/images\/(?:generations|edits)$/i.test(rawBase)) {
    return rawBase.replace(/\/images\/(?:generations|edits)$/i, normalizedPath);
  }
  return `${rawBase}${normalizedPath}`;
}

async function readJsonResponse(response, actionName) {
  const text = await response.text();
  let payload = {};
  if (text.trim()) {
    try { payload = JSON.parse(text); }
    catch {
      const error = new Error(`${actionName}返回的不是有效 JSON：${text.slice(0, 240)}`);
      error.status = response.status;
      error.responseText = text.slice(0, 2000);
      throw error;
    }
  }
  if (!response.ok) {
    const message = payload?.error?.message || payload?.message || payload?.msg || `${actionName}失败 (${response.status})`;
    const error = new Error(message);
    error.status = response.status;
    error.code = payload?.error?.code || payload?.code || "";
    error.type = payload?.error?.type || payload?.type || "";
    error.param = payload?.error?.param || payload?.param || "";
    error.responsePayload = payload;
    throw error;
  }
  return payload;
}

function isContentPolicyError(error) {
  const text = [error?.message, error?.code, error?.type, error?.param]
    .filter(Boolean).join(" ").toLowerCase();
  return /content[ _-]?policy|policy[ _-]?(?:violation|rejection)|safety[ _-]?(?:system|violation)|moderation|blocked|rejected by the content|审核|内容策略|违规|敏感内容/.test(text);
}

function imagePolicyDebugPath(destination) {
  const imageDir = path.dirname(destination);
  const outputDir = path.basename(imageDir).toLowerCase() === "images" ? path.dirname(imageDir) : imageDir;
  const debugDir = path.join(outputDir, "image-debug");
  fs.mkdirSync(debugDir, { recursive: true });
  return path.join(debugDir, `${path.basename(destination, path.extname(destination))}-content-policy.json`);
}

function writeImagePolicyDebug(destination, data) {
  try {
    fs.writeFileSync(imagePolicyDebugPath(destination), JSON.stringify({
      created_at: new Date().toISOString(),
      ...data
    }, null, 2), "utf8");
  } catch {}
}

function imageSubmitDebugPath(destination) {
  const imageDir = path.dirname(destination);
  const outputDir = path.basename(imageDir).toLowerCase() === "images" ? path.dirname(imageDir) : imageDir;
  const debugDir = path.join(outputDir, "image-debug");
  fs.mkdirSync(debugDir, { recursive: true });
  return path.join(debugDir, `${path.basename(destination, path.extname(destination))}-submit.json`);
}

function writeImageSubmitDebug(destination, data) {
  try {
    fs.writeFileSync(imageSubmitDebugPath(destination), JSON.stringify({
      created_at: new Date().toISOString(),
      ...data
    }, null, 2), "utf8");
  } catch {}
}

function imageStyleAuditPath(destination) {
  const imageDir = path.dirname(destination);
  const outputDir = path.basename(imageDir).toLowerCase() === "images" ? path.dirname(imageDir) : imageDir;
  const debugDir = path.join(outputDir, "image-debug");
  fs.mkdirSync(debugDir, { recursive: true });
  return path.join(debugDir, `${path.basename(destination, path.extname(destination))}-style-audit.json`);
}

function writeImageStyleAudit(destination, data) {
  try {
    fs.writeFileSync(imageStyleAuditPath(destination), JSON.stringify({
      created_at: new Date().toISOString(),
      ...redactImagePayloadForDebug(data)
    }, null, 2), "utf8");
  } catch {}
}

function negativePromptField(section, provider) {
  const configured = String(section?.negative_prompt_field || "").trim();
  if (configured) return configured;
  return provider === "modelscope" ? "negative_prompt" : "";
}

function imageRequestHeaders(section, requestId = "") {
  const headers = { "content-type": "application/json", authorization: `Bearer ${section.api_key}` };
  if (requestId) {
    headers["idempotency-key"] = requestId;
    headers["x-idempotency-key"] = requestId;
  }
  return headers;
}

function parseExtraBody(section) {
  try { return JSON.parse(section.extra_body_json || "{}"); }
  catch { throw new Error("图片接口的额外请求 JSON 格式错误"); }
}

function appendFormField(form, key, value) {
  if (value === undefined || value === null) return;
  if (Array.isArray(value)) {
    value.forEach(item => appendFormField(form, key, item));
    return;
  }
  if (typeof value === "object") {
    form.append(key, JSON.stringify(value));
    return;
  }
  form.append(key, String(value));
}

function normalizeReferenceImagePaths(referenceImagePath) {
  const values = Array.isArray(referenceImagePath)
    ? referenceImagePath
    : String(referenceImagePath || "").split(/[;\n]/);
  return [...new Set(values.map(value => String(value).trim()).filter(value => value && fs.existsSync(value)))];
}

async function pollCustomImageTask({ section, baseUrl, taskId, destination }) {
  const successValues = String(section.success_values || "succeeded,completed,success")
    .split(",").map(value => value.trim().toLowerCase());
  for (let attempt = 0; attempt < 120; attempt += 1) {
    await sleep(2000);
    const statusUrl = resolveImageEndpoint(baseUrl, section.status_path.replace("{task_id}", encodeURIComponent(taskId)), "generation");
    const poll = await fetchWithProxy(statusUrl, { headers: { authorization: `Bearer ${section.api_key}` } }, section.proxy_url);
    const statusPayload = await readJsonResponse(poll, "查询图片任务");
    const status = String(getByPath(statusPayload, section.status_field || "status") || "").toLowerCase();
    if (successValues.includes(status)) {
      const candidate = findImageCandidate(statusPayload, section.image_field || "data.0.url", statusUrl);
      if (!candidate) {
        const debugPath = writeImageResponseDebug(destination, {
          provider: "custom_image",
          mode: "async_poll",
          status_url: statusUrl,
          configured_image_field: section.image_field || "data.0.url",
          payload: statusPayload
        });
        throw new Error(`异步图片任务已完成，但状态响应中没有找到图片地址或 Base64 数据。原始响应已保存：${debugPath}`);
      }
      const saved = await saveImageResponse(candidate, destination, section.proxy_url, statusUrl, { apiKey: section.api_key });
      return { path: destination, provider: "custom_image", taskId, sourceUrl: saved.sourceUrl || "", responseField: candidate.sourcePath || "" };
    }
    if (["failed", "error", "cancelled"].includes(status)) throw new Error(statusPayload?.message || `图片任务失败：${status}`);
  }
  throw new Error("图片任务等待超时");
}


function apiMartBaseUrl(section = {}) {
  const raw = String(section.base_url || "https://api.apimart.ai/v1").trim().replace(/\/+$/, "");
  return raw
    .replace(/\/images\/generations$/i, "")
    .replace(/\/tasks\/[^/]+$/i, "");
}

function imageFileDataUri(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mime = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg"
    : ext === ".webp" ? "image/webp"
      : ext === ".gif" ? "image/gif"
        : ext === ".bmp" ? "image/bmp" : "image/png";
  return `data:${mime};base64,${fs.readFileSync(filePath).toString("base64")}`;
}

async function pollApiMartImageTask({ section, taskId, destination, onProgress = () => {} }) {
  const startedAt = Date.now();
  const baseUrl = apiMartBaseUrl(section);
  const statusUrl = `${baseUrl}/tasks/${encodeURIComponent(taskId)}`;
  const timeoutMs = Math.max(30_000, Number(section.poll_timeout_seconds || 600) * 1000);
  const intervalMs = Math.max(100, Number(section.poll_interval_ms || 3000));
  const transientStatuses = new Set([404, 408, 409, 425, 429, 500, 502, 503, 504]);
  let attempt = 0;
  let lastStatus = "submitted";
  let lastMessage = "";
  while (Date.now() - startedAt < timeoutMs) {
    attempt += 1;
    if (attempt > 1) await sleep(intervalMs);
    let response;
    try {
      response = await fetchWithTimeout(statusUrl, {
        headers: { authorization: `Bearer ${section.api_key}` }
      }, section.proxy_url || "", Math.max(10000, Number(section.request_timeout_seconds || 45) * 1000));
    } catch (error) {
      if (isCancellationError(error)) throw error;
      lastMessage = String(error?.message || error);
      onProgress({
        state: "polling",
        attempt,
        elapsed_ms: Date.now() - startedAt,
        http_status: 0,
        remote_status: lastStatus,
        message: `查询网络异常：${lastMessage}`,
        task_id: taskId
      });
      continue;
    }

    if (!response.ok && transientStatuses.has(response.status)) {
      lastMessage = `接口暂时返回 ${response.status}`;
      onProgress({
        state: "polling",
        attempt,
        elapsed_ms: Date.now() - startedAt,
        http_status: response.status,
        remote_status: lastStatus,
        message: lastMessage,
        task_id: taskId
      });
      continue;
    }

    const payload = await readJsonResponse(response, "查询 Apimart 图片任务");
    const data = payload?.data || {};
    const status = String(data.status || payload?.status || "").toLowerCase();
    lastStatus = status || lastStatus;
    lastMessage = String(data?.error?.message || data?.message || payload?.error?.message || "");
    onProgress({
      state: status === "completed" ? "completed" : "polling",
      attempt,
      elapsed_ms: Date.now() - startedAt,
      http_status: response.status,
      remote_status: status,
      message: lastMessage,
      task_id: taskId
    });
    if (status === "completed") {
      const imageUrl = data?.result?.images?.[0]?.url?.[0]
        || data?.result?.images?.[0]?.url
        || data?.result?.images?.[0]?.image_url
        || data?.result?.url;
      if (!imageUrl || typeof imageUrl !== "string") {
        const debugPath = writeImageResponseDebug(destination, {
          provider: "apimart",
          mode: "async_poll",
          task_id: taskId,
          status_url: statusUrl,
          payload
        });
        throw new Error(`Apimart 任务已完成，但没有返回可下载图片地址。原始响应已保存：${debugPath}`);
      }
      let downloadError = null;
      for (let downloadAttempt = 1; downloadAttempt <= 3; downloadAttempt += 1) {
        try {
          await downloadFile(imageUrl, destination, {}, section.proxy_url || "");
          downloadError = null;
          break;
        } catch (error) {
          if (isCancellationError(error)) throw error;
          downloadError = error;
          if (downloadAttempt < 3) await sleep(1500 * downloadAttempt);
        }
      }
      if (downloadError) throw downloadError;
      return {
        path: destination,
        provider: "Apimart",
        taskId,
        sourceUrl: imageUrl,
        responseField: "data.result.images.0.url.0"
      };
    }
    if (["failed", "error", "cancelled", "canceled", "rejected", "expired"].includes(status)) {
      throw new Error(lastMessage || `Apimart 图片任务失败：${status || "unknown"}`);
    }
  }
  throw new Error(`Apimart 图片任务等待超时，最后状态：${lastStatus}${lastMessage ? `，${lastMessage}` : ""}`);
}

async function generateApiMartImage({ config, prompt, styleConfig = null, destination, ratio, referenceImagePath = "", resumeTaskId = "", onRemoteTask = () => {}, onProgress = () => {}, requestId = "", shouldStopSubmitting = () => false }) {
  const section = config.apimart || {};
  if (!section.api_key) throw new Error("Apimart 尚未配置 API Key");
  if (resumeTaskId) {
    return pollApiMartImageTask({ section, taskId: String(resumeTaskId), destination, onProgress });
  }
  const endpoint = `${apiMartBaseUrl(section)}/images/generations`;
  const references = normalizeReferenceImagePaths(referenceImagePath);
  const originalPrompt = String(prompt || "");
  const { risk, candidates } = buildImageRequestCandidates({
    scenePrompt: originalPrompt,
    styleConfig,
    policyFallback: section.policy_fallback !== false
  });
  let selectedCandidate = candidates[0];
  let promptUsed = selectedCandidate.prompt;
  let policyAdjusted = Boolean(selectedCandidate.adjusted);
  const errors = [];
  let taskId = "";

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const body = {
      model: "gpt-image-2",
      prompt: candidate.prompt,
      n: 1,
      size: ratio || section.ratio || "9:16",
      resolution: section.resolution || "1k",
      official_fallback: Boolean(section.official_fallback)
    };
    if (references.length) body.image_urls = references.slice(0, 16).map(imageFileDataUri);
    writeImageStyleAudit(destination, {
      ...imagePromptAudit(candidate, "apimart", candidate.level),
      negative_prompt_field: "not-supported"
    });
    writeImageSubmitDebug(destination, {
      provider: "apimart",
      endpoint,
      request_body: { ...body, image_urls: body.image_urls ? body.image_urls.map(() => "<base64-image>") : undefined },
      async_mode: true
    });
    try {
      if (shouldStopSubmitting()) throw new TaskCancelledError("已停止提交后续图片");
      const response = await fetchWithTimeout(endpoint, {
        method: "POST",
        headers: imageRequestHeaders(section, requestId ? `${requestId}${index ? `-policy-${candidate.mode}` : ""}` : ""),
        body: JSON.stringify(body)
      }, section.proxy_url || "", Math.max(15000, Number(section.request_timeout_seconds || 60) * 1000));
      const payload = await readJsonResponse(response, "Apimart 图片生成");
      writeImageSubmitDebug(destination, {
        provider: "apimart",
        endpoint,
        request_body: { ...body, image_urls: body.image_urls ? body.image_urls.map(() => "<base64-image>") : undefined },
        async_mode: true,
        response_status: response.status,
        response_payload: redactImagePayloadForDebug(payload)
      });
      taskId = String(payload?.data?.[0]?.task_id || payload?.data?.task_id || payload?.task_id || "");
      if (!taskId) {
        const debugPath = writeImageResponseDebug(destination, {
          provider: "apimart",
          mode: "submit",
          payload
        });
        throw new Error(`Apimart 未返回任务 ID。原始响应已保存：${debugPath}`);
      }
      selectedCandidate = candidate;
      promptUsed = candidate.prompt;
      policyAdjusted = Boolean(candidate.adjusted || index > 0);
      break;
    } catch (error) {
      errors.push({
        mode: candidate.mode,
        prompt: candidate.prompt,
        message: String(error?.message || error),
        status: error?.status || 0,
        code: error?.code || "",
        type: error?.type || ""
      });
      if (!isContentPolicyError(error) || section.policy_fallback === false || index >= candidates.length - 1) throw error;
    }
  }

  onRemoteTask({ taskId, provider: "Apimart" });
  const result = await pollApiMartImageTask({ section, taskId, destination, onProgress });
  if (policyAdjusted || errors.length) {
    writeImagePolicyDebug(destination, {
      provider: "apimart",
      endpoint,
      model: "gpt-image-2",
      original_prompt: originalPrompt,
      risk,
      prompt_used: promptUsed,
      attempts: errors,
      resolved: true
    });
  }
  return {
    ...result,
    policyAdjusted,
    promptUsed,
    safeScenePrompt: selectedCandidate.safeScenePrompt,
    negativePromptUsed: selectedCandidate.negativePrompt,
    styleId: selectedCandidate.styleId,
    registryVersion: selectedCandidate.registryVersion,
    fallbackLevel: selectedCandidate.level
  };
}

async function generateOpenAiImage({ provider, config, prompt, styleConfig = null, destination, ratio, resumeTaskId = "", onRemoteTask = () => {}, onProgress = () => {}, requestId = "", shouldStopSubmitting = () => false }) {
  const section = provider === "modelscope" ? config.modelscope
    : provider === "custom_image" ? config.custom_image : config.gpt_image;
  const baseUrl = section.base_url || (provider === "modelscope"
    ? "https://api-inference.modelscope.cn/v1"
    : "https://api.openai.com/v1");
  if (!section.api_key) throw new Error(`${provider} 尚未配置 API Key`);
  const endpoint = resolveImageEndpoint(baseUrl, provider === "custom_image" ? section.submit_path : "/images/generations", "generation");
  if (resumeTaskId && /^https?:\/\//i.test(String(resumeTaskId))) {
    return pollImageResultUrl({
      pollUrl: String(resumeTaskId), section, endpoint, destination, provider,
      taskId: imageTaskIdFromPayload({}, String(resumeTaskId)), onProgress
    });
  }
  if (provider === "custom_image" && section.async_mode && resumeTaskId) {
    if (!section.status_path) throw new Error("异步图片接口尚未填写状态查询路径");
    return pollCustomImageTask({ section, baseUrl, taskId: resumeTaskId, destination });
  }
  const extraBody = parseExtraBody(section);
  const responseFormat = String(section.response_format || "auto").trim();
  const moderation = String(section.moderation || "none").trim();

  const submit = async (candidate, suffix = "") => {
    // Extra provider-specific fields are allowed, but cannot override the
    // resolved style prompt or core request fields.
    const body = {
      ...extraBody,
      model: section.model || "gpt-image-2",
      prompt: candidate.prompt,
      n: 1,
      size: mappedImageSize(section, ratio),
      ...(section.quality ? { quality: section.quality } : {}),
      ...(responseFormat && responseFormat !== "auto" ? { response_format: responseFormat } : {}),
      ...(moderation && moderation !== "none" ? { moderation } : {})
    };
    const negativeField = negativePromptField(section, provider);
    if (negativeField && candidate.negativePrompt) body[negativeField] = candidate.negativePrompt;
    writeImageStyleAudit(destination, {
      ...imagePromptAudit(candidate, provider, candidate.level),
      negative_prompt_field: negativeField || "not-supported"
    });
    writeImageSubmitDebug(destination, {
      provider,
      endpoint,
      request_body: body,
      request_suffix: suffix || "",
      response_format_source: responseFormat || "auto",
      async_mode: Boolean(section.async_mode)
    });
    if (shouldStopSubmitting()) throw new TaskCancelledError("已停止提交后续图片");
    const response = await fetchWithProxy(endpoint, {
      method: "POST",
      headers: imageRequestHeaders(section, requestId ? `${requestId}${suffix}` : ""),
      body: JSON.stringify(body)
    }, section.proxy_url);
    const payload = await readJsonResponse(response, "图片生成");
    writeImageSubmitDebug(destination, {
      provider,
      endpoint,
      request_body: body,
      request_suffix: suffix || "",
      response_format_source: responseFormat || "auto",
      async_mode: Boolean(section.async_mode),
      response_status: response.status,
      response_payload: redactImagePayloadForDebug(payload)
    });
    return payload;
  };

  const originalPrompt = String(prompt || "");
  const { risk, candidates } = buildImageRequestCandidates({
    scenePrompt: originalPrompt,
    styleConfig,
    policyFallback: section.policy_fallback !== false
  });

  let payload;
  let selectedCandidate = candidates[0];
  let promptUsed = selectedCandidate.prompt;
  let policyAdjusted = Boolean(selectedCandidate.adjusted);
  const errors = [];
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    try {
      payload = await submit(candidate, index ? `-policy-${candidate.mode}` : (candidate.adjusted ? "-preflight-safe" : ""));
      selectedCandidate = candidate;
      promptUsed = candidate.prompt;
      policyAdjusted = Boolean(candidate.adjusted || index > 0);
      break;
    } catch (error) {
      errors.push({
        mode: candidate.mode,
        prompt: candidate.prompt,
        message: String(error?.message || error),
        status: error?.status || 0,
        code: error?.code || "",
        type: error?.type || ""
      });
      if (!isContentPolicyError(error) || section.policy_fallback === false) throw error;
      if (index >= candidates.length - 1) {
        writeImagePolicyDebug(destination, {
          provider,
          endpoint,
          model: section.model || "gpt-image-2",
          original_prompt: originalPrompt,
          risk,
          attempts: errors,
          resolved: false
        });
        const finalError = new Error(`图片提示词被内容审核拒绝；程序已在发送前改写，并使用更保守画面重试仍未通过。调试文件：${imagePolicyDebugPath(destination)}`);
        finalError.code = "IMAGE_CONTENT_POLICY_REJECTED";
        finalError.status = error?.status || 400;
        throw finalError;
      }
    }
  }

  if (provider === "custom_image" && section.async_mode) {
    const taskId = getByPath(payload, section.task_id_field || "task_id");
    if (!taskId || !section.status_path) throw new Error("异步图片接口未返回任务 ID，或尚未填写状态查询路径");
    onRemoteTask({ taskId: String(taskId), provider: "custom_image" });
    const result = await pollCustomImageTask({ section, baseUrl, taskId: String(taskId), destination });
    if (policyAdjusted || errors.length) {
      writeImagePolicyDebug(destination, {
        provider,
        endpoint,
        model: section.model || "gpt-image-2",
        original_prompt: originalPrompt,
        risk,
        prompt_used: promptUsed,
        attempts: errors,
        resolved: true
      });
    }
    return {
      ...result, policyAdjusted, promptUsed,
      safeScenePrompt: selectedCandidate.safeScenePrompt,
      negativePromptUsed: selectedCandidate.negativePrompt,
      styleId: selectedCandidate.styleId,
      registryVersion: selectedCandidate.registryVersion,
      fallbackLevel: selectedCandidate.level
    };
  }
  const imageCandidate = findImageCandidate(payload, section.image_field, endpoint);
  const pollCandidate = findImagePollCandidate(payload, endpoint);
  if (!imageCandidate && pollCandidate?.url) {
    const taskId = imageTaskIdFromPayload(payload, pollCandidate.url);
    onRemoteTask({ taskId: pollCandidate.url, provider: `${provider}-poll-url` });
    const result = await pollImageResultUrl({
      pollUrl: pollCandidate.url,
      section,
      endpoint,
      destination,
      provider,
      taskId,
      onProgress
    });
    if (policyAdjusted || errors.length) {
      writeImagePolicyDebug(destination, {
        provider,
        endpoint,
        model: section.model || "gpt-image-2",
        original_prompt: originalPrompt,
        risk,
        prompt_used: promptUsed,
        attempts: errors,
        resolved: true
      });
    }
    return {
      ...result, policyAdjusted, promptUsed,
      safeScenePrompt: selectedCandidate.safeScenePrompt,
      negativePromptUsed: selectedCandidate.negativePrompt,
      styleId: selectedCandidate.styleId,
      registryVersion: selectedCandidate.registryVersion,
      fallbackLevel: selectedCandidate.level,
      responseField: result.responseField || pollCandidate.sourcePath || "poll_url"
    };
  }
  if (!imageCandidate) {
    const debugPath = writeImageResponseDebug(destination, {
      provider,
      endpoint,
      model: section.model || "gpt-image-2",
      configured_image_field: section.image_field || "",
      response_top_level_keys: payload && typeof payload === "object" ? Object.keys(payload) : [],
      payload
    });
    const taskId = getByPath(payload, section.task_id_field || "task_id")
      || payload?.id || payload?.task_id || payload?.taskId || payload?.data?.task_id || payload?.data?.taskId;
    if (taskId && provider === "custom_image" && !section.async_mode) {
      throw new Error(`图片接口返回了任务 ID（${String(taskId).slice(0, 80)}），但当前配置为同步模式。请在图片接口设置中开启“异步模式”，并填写状态查询路径。原始响应已保存：${debugPath}`);
    }
    throw new Error(`图片接口请求成功，但返回结构中没有找到图片地址、Base64 数据或任务查询地址。原始响应已保存：${debugPath}`);
  }
  const savedImage = await saveImageResponse(imageCandidate, destination, section.proxy_url, endpoint, { apiKey: section.api_key });
  if (policyAdjusted || errors.length) {
    writeImagePolicyDebug(destination, {
      provider,
      endpoint,
      model: section.model || "gpt-image-2",
      original_prompt: originalPrompt,
      risk,
      prompt_used: promptUsed,
      attempts: errors,
      resolved: true
    });
  }
  return {
    path: destination, provider, policyAdjusted, promptUsed,
    safeScenePrompt: selectedCandidate.safeScenePrompt,
    negativePromptUsed: selectedCandidate.negativePrompt,
    styleId: selectedCandidate.styleId,
    registryVersion: selectedCandidate.registryVersion,
    fallbackLevel: selectedCandidate.level,
    sourceUrl: savedImage.sourceUrl || "",
    responseField: imageCandidate.sourcePath || ""
  };
}

async function pollRunningHubWorkflowImage({ baseUrl, section, taskId, destination }) {
  for (let attempt = 0; attempt < 180; attempt += 1) {
    await sleep(2000);
    const outputResponse = await fetchWithProxy(`${baseUrl}/task/openapi/outputs`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiKey: section.api_key, taskId })
    }, section.proxy_url);
    const output = await outputResponse.json();
    if (!outputResponse.ok) throw new Error(output.msg || `RunningHub 查询失败 (${outputResponse.status})`);
    const files = Array.isArray(output.data) ? output.data : output.data?.outputs || [];
    const image = files.find(file => /image|png|jpe?g|webp/i.test(`${file.fileType || ""} ${file.fileUrl || ""}`));
    if (image?.fileUrl) {
      await downloadFile(image.fileUrl, destination, {}, section.proxy_url);
      return { path: destination, provider: "runninghub", sourceUrl: image.fileUrl, taskId };
    }
    if (Number(output.code || 0) !== 0 && !/running|queue|wait/i.test(output.msg || "")) throw new Error(output.msg || "RunningHub 任务失败");
  }
  throw new Error("RunningHub 任务等待超时");
}

async function generateRunningHubImage({ config, prompt, negativePrompt = "", destination, ratio, referenceImagePath, resumeTaskId = "", onRemoteTask = () => {} }) {
  const section = config.runninghub;
  if (!section.api_key) throw new Error("RunningHub 尚未配置 API Key");
  if (!section.workflow_id) {
    return generateRunningHubOfficialImage({ config, prompt, negativePrompt, destination, ratio, referenceImagePath, resumeTaskId, onRemoteTask });
  }
  const baseUrl = (section.base_url || "https://www.runninghub.cn").replace(/\/$/, "");
  if (resumeTaskId) {
    return pollRunningHubWorkflowImage({ baseUrl, section, taskId: resumeTaskId, destination });
  }
  let nodeInfoList;
  try { nodeInfoList = JSON.parse(section.node_info_json || "[]"); } catch { throw new Error("RunningHub 节点参数 JSON 格式错误"); }
  // Workflow users can opt into the verified style negative prompt with a
  // {{negative_prompt}} placeholder. Unknown provider fields are never injected.
  nodeInfoList = nodeInfoList.map(item => ({
    ...item,
    fieldValue: item.fieldValue === "{{prompt}}" ? prompt
      : item.fieldValue === "{{negative_prompt}}" ? negativePrompt
        : item.fieldValue
  }));
  if (referenceImagePath && fs.existsSync(referenceImagePath)) {
    const form = new FormData();
    form.append("apiKey", section.api_key);
    form.append("fileType", "image");
    form.append("file", new Blob([fs.readFileSync(referenceImagePath)]), path.basename(referenceImagePath));
    const uploadResponse = await fetchWithProxy(`${baseUrl}/task/openapi/upload`, { method: "POST", body: form }, section.proxy_url);
    const uploaded = await uploadResponse.json();
    if (!uploadResponse.ok || Number(uploaded.code || 0) !== 0) throw new Error(uploaded.msg || "RunningHub 参考图上传失败");
    const fileName = uploaded.data?.fileName;
    nodeInfoList = nodeInfoList.map(item => ({
      ...item,
      fieldValue: item.fieldValue === "{{reference_image}}" ? fileName : item.fieldValue
    }));
  }
  if (section.prompt_node_id) {
    nodeInfoList = [...nodeInfoList, {
      nodeId: String(section.prompt_node_id),
      fieldName: section.prompt_field_name || "text",
      fieldValue: prompt
    }];
  }
  const createResponse = await fetchWithProxy(`${baseUrl}/task/openapi/create`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ apiKey: section.api_key, workflowId: section.workflow_id, nodeInfoList })
  }, section.proxy_url);
  const created = await createResponse.json();
  if (!createResponse.ok || Number(created.code || 0) !== 0) throw new Error(created.msg || `RunningHub 提交失败 (${createResponse.status})`);
  const taskId = created.data?.taskId || created.data?.task_id || created.taskId;
  if (!taskId) throw new Error("RunningHub 未返回任务 ID");
  onRemoteTask({ taskId: String(taskId), provider: "runninghub-workflow" });
  return pollRunningHubWorkflowImage({ baseUrl, section, taskId: String(taskId), destination });
}


function nearestRatio(ratio, supported) {
  if (supported.includes(ratio)) return ratio;
  const parse = value => {
    const [width, height] = String(value || "").split(":").map(Number);
    return width > 0 && height > 0 ? width / height : NaN;
  };
  const target = parse(ratio);
  if (!Number.isFinite(target)) return supported.includes("9:16") ? "9:16" : supported[0];
  return supported.reduce((best, current) => (
    Math.abs(parse(current) - target) < Math.abs(parse(best) - target) ? current : best
  ), supported[0]);
}

function unwrapRunningHubPayload(payload) {
  if (payload && typeof payload === "object" && "code" in payload && "data" in payload
      && !("taskId" in payload) && !("status" in payload)) {
    const code = Number(payload.code);
    if (code !== 0 && code !== 200) {
      throw new Error(payload.msg || payload.message || `RunningHub 业务错误 (${payload.code})`);
    }
    return payload.data;
  }
  return payload;
}

async function runningHubV2Request(url, apiKey, body, proxyUrl = "") {
  const response = await fetchWithProxy(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  }, proxyUrl);
  const text = await response.text();
  let payload;
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { message: text }; }
  if (!response.ok) throw new Error(payload?.message || payload?.msg || `RunningHub HTTP ${response.status}`);
  return unwrapRunningHubPayload(payload);
}

async function uploadRunningHubV2Image({ baseUrl, apiKey, imagePath, proxyUrl = "" }) {
  const form = new FormData();
  form.append("file", new Blob([fs.readFileSync(imagePath)]), path.basename(imagePath));
  const response = await fetchWithProxy(`${baseUrl}/openapi/v2/media/upload/binary`, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}` },
    body: form
  }, proxyUrl);
  const text = await response.text();
  let payload;
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { message: text }; }
  if (!response.ok) throw new Error(payload?.message || payload?.msg || `RunningHub 上传失败 (${response.status})`);
  if (Number(payload.code) !== 0 && Number(payload.code) !== 200) {
    throw new Error(payload.message || payload.msg || `RunningHub 上传失败 (${payload.code})`);
  }
  const downloadUrl = payload.data?.download_url || payload.data?.downloadUrl || payload.download_url || payload.downloadUrl;
  if (!downloadUrl) throw new Error("RunningHub 上传成功但未返回下载地址");
  return downloadUrl;
}

async function pollRunningHubV2({ baseUrl, apiKey, taskId, proxyUrl = "", timeoutMs = 15 * 60 * 1000 }) {
  const startedAt = Date.now();
  let delay = 3000;
  let consecutiveErrors = 0;
  while (Date.now() - startedAt < timeoutMs) {
    await sleep(delay);
    let payload;
    try {
      payload = await runningHubV2Request(`${baseUrl}/openapi/v2/query`, apiKey, { taskId }, proxyUrl);
      consecutiveErrors = 0;
    } catch (error) {
      consecutiveErrors += 1;
      if (consecutiveErrors >= 3) throw error;
      continue;
    }
    const status = String(payload?.status || "").toUpperCase();
    if (status === "SUCCESS") {
      const results = Array.isArray(payload.results) ? payload.results : [];
      if (!results.length) throw new Error("RunningHub 任务成功但未返回结果");
      return results;
    }
    if (status === "FAILED") {
      throw new Error(payload.errorMessage || payload.message || `RunningHub 任务失败 (${payload.errorCode || "UNKNOWN"})`);
    }
    delay = Math.min(10000, Math.floor(delay * 1.3));
  }
  throw new Error("RunningHub 视频任务等待超时");
}

async function downloadRunningHubVideoResult({ baseUrl, apiKey, taskId, proxyUrl, destination }) {
  const results = await pollRunningHubV2({ baseUrl, apiKey, taskId, proxyUrl });
  const result = results.find(item => String(item.outputType || "").toLowerCase() === "mp4"
    || /\.mp4(?:\?|$)/i.test(item.url || "")) || results[0];
  if (!result?.url) throw new Error("RunningHub 视频任务未返回可下载地址");
  await downloadFile(result.url, destination, {}, proxyUrl);
  return { sourceUrl: result.url };
}

async function submitRunningHubVideoModel({
  baseUrl, apiKey, proxyUrl, imageUrl, prompt, ratio, durationSec, destination, model, onRemoteTask = () => {}
}) {
  const primary = model === "fallback" ? {
    endpoint: "/openapi/v2/rhart-video/ltx-2.3/image-to-video",
    supportedRatios: ["9:16", "16:9"], minDuration: 5, maxDuration: 20, imageField: "imageUrl"
  } : {
    endpoint: "/openapi/v2/rhart-video-g/image-to-video",
    supportedRatios: ["2:3", "3:2", "1:1", "16:9", "9:16"], minDuration: 6, maxDuration: 30, imageField: "imageUrls"
  };
  const duration = Math.min(primary.maxDuration, Math.max(primary.minDuration, Math.ceil(Number(durationSec) || primary.minDuration)));
  const body = {
    prompt,
    aspectRatio: nearestRatio(ratio, primary.supportedRatios),
    resolution: "720p",
    duration
  };
  body[primary.imageField] = primary.imageField === "imageUrls" ? [imageUrl] : imageUrl;
  const submitted = await runningHubV2Request(`${baseUrl}${primary.endpoint}`, apiKey, body, proxyUrl);
  if (String(submitted?.status || "").toUpperCase() === "FAILED") {
    throw new Error(submitted.errorMessage || "RunningHub 视频提交失败");
  }
  const taskId = submitted?.taskId || submitted?.task_id;
  if (!taskId) throw new Error("RunningHub 视频提交未返回 taskId");
  onRemoteTask({ taskId: String(taskId), model, provider: model === "fallback" ? "runninghub-video-ltx" : "runninghub-video-x" });
  const completed = await downloadRunningHubVideoResult({ baseUrl, apiKey, taskId: String(taskId), proxyUrl, destination });
  return { path: destination, sourceUrl: completed.sourceUrl, taskId: String(taskId), duration };
}


async function generateRunningHubOfficialImage({ config, prompt, negativePrompt = "", destination, ratio, referenceImagePath, resumeTaskId = "", onRemoteTask = () => {} }) {
  const section = config.runninghub || {};
  const baseUrl = (section.base_url || "https://www.runninghub.cn").replace(/\/$/, "");
  const models = {
    "rh-image-x": {
      textEndpoint: "/openapi/v2/rhart-image-x-official/text-to-image",
      editEndpoint: "/openapi/v2/rhart-image-x-official/edit",
      imageField: "image",
      supported: ["2:1", "20:9", "16:9", "4:3", "3:2", "1:1", "2:3", "3:4", "9:16", "9:20", "1:2"],
      outputFormat: true,
      resolution: false
    },
    "rh-image-v2": {
      textEndpoint: "/openapi/v2/rhart-image-n-g31-flash/text-to-image",
      editEndpoint: "/openapi/v2/rhart-image-n-g31-flash/image-to-image",
      imageField: "imageUrls",
      supported: ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "5:4", "4:5", "21:9", "1:4", "4:1", "1:8", "8:1"],
      outputFormat: false,
      resolution: true
    },
    "rh-image-g2": {
      textEndpoint: "/openapi/v2/rhart-image-g-2/text-to-image",
      editEndpoint: "/openapi/v2/rhart-image-g-2/image-to-image",
      imageField: "imageUrls",
      supported: ["1:1", "3:2", "2:3", "5:4", "4:5", "16:9", "9:16", "21:9", "3:4", "4:3", "9:21", "1:2", "2:1", "1:3", "3:1"],
      outputFormat: false,
      resolution: true
    }
  };
  const modelId = models[section.model] ? section.model : "rh-image-g2";
  if (resumeTaskId) {
    const completed = await downloadRunningHubImageResult({ baseUrl, section, taskId: resumeTaskId, destination });
    return { path: destination, provider: modelId, sourceUrl: completed.sourceUrl, taskId: resumeTaskId };
  }
  const model = models[modelId];
  const normalizedRatio = modelId === "rh-image-x" && ratio === "21:9"
    ? "20:9" : nearestRatio(ratio, model.supported);
  const body = { prompt, aspectRatio: normalizedRatio };
  if (model.outputFormat) body.outputFormat = "png";
  if (model.resolution) body.resolution = section.resolution || "1k";
  let endpoint = model.textEndpoint;
  if (referenceImagePath && fs.existsSync(referenceImagePath)) {
    const imageUrl = await uploadRunningHubV2Image({
      baseUrl, apiKey: section.api_key, imagePath: referenceImagePath, proxyUrl: section.proxy_url || ""
    });
    endpoint = model.editEndpoint;
    body[model.imageField] = model.imageField === "image" ? imageUrl : [imageUrl];
  }
  const submitted = await runningHubV2Request(`${baseUrl}${endpoint}`, section.api_key, body, section.proxy_url || "");
  if (String(submitted?.status || "").toUpperCase() === "FAILED") {
    throw new Error(submitted.errorMessage || "RunningHub 图片提交失败");
  }
  const taskId = submitted?.taskId || submitted?.task_id;
  if (!taskId) throw new Error("RunningHub 图片提交未返回 taskId");
  onRemoteTask({ taskId: String(taskId), provider: modelId });
  const completed = await downloadRunningHubImageResult({ baseUrl, section, taskId: String(taskId), destination });
  return { path: destination, provider: modelId, sourceUrl: completed.sourceUrl, taskId: String(taskId) };
}

async function generateRunningHubVideo({
  config, imagePath, prompt, ratio, durationSec, destination,
  resumeTaskId = "", resumeModel = "primary", onRemoteTask = () => {}
}) {
  const section = config.runninghub || {};
  if (!section.api_key) throw new Error("RunningHub 尚未配置 API Key");
  if (!imagePath || !fs.existsSync(imagePath)) throw new Error("图生视频缺少有效的源图片");
  const baseUrl = (section.base_url || "https://www.runninghub.cn").replace(/\/$/, "");
  if (resumeTaskId) {
    const completed = await downloadRunningHubVideoResult({
      baseUrl, apiKey: section.api_key, taskId: resumeTaskId,
      proxyUrl: section.proxy_url || "", destination
    });
    return {
      path: destination,
      sourceUrl: completed.sourceUrl,
      taskId: resumeTaskId,
      provider: resumeModel === "fallback" ? "runninghub-video-ltx" : "runninghub-video-x",
      usedFallback: resumeModel === "fallback"
    };
  }
  const imageUrl = await uploadRunningHubV2Image({
    baseUrl, apiKey: section.api_key, imagePath, proxyUrl: section.proxy_url || ""
  });
  try {
    const result = await submitRunningHubVideoModel({
      baseUrl, apiKey: section.api_key, proxyUrl: section.proxy_url || "", imageUrl,
      prompt, ratio, durationSec, destination, model: "primary", onRemoteTask
    });
    return { ...result, provider: "runninghub-video-x", usedFallback: false };
  } catch (primaryError) {
    const message = primaryError instanceof Error ? primaryError.message : String(primaryError);
    if (/AUDIT|审核|违规|sensitive/i.test(message)) throw primaryError;
    try {
      const result = await submitRunningHubVideoModel({
        baseUrl, apiKey: section.api_key, proxyUrl: section.proxy_url || "", imageUrl,
        prompt, ratio, durationSec, destination, model: "fallback", onRemoteTask
      });
      return { ...result, provider: "runninghub-video-ltx", usedFallback: true };
    } catch (fallbackError) {
      const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      throw new Error(`主模型与兜底模型均失败：${fallbackMessage.slice(0, 220)}`);
    }
  }
}


async function generateReferenceImage({ provider, config, prompt, styleConfig = null, destination, ratio, referenceImagePath, onProgress = () => {}, requestId = "", shouldStopSubmitting = () => false }) {
  const section = provider === "modelscope" ? config.modelscope
    : provider === "custom_image" ? config.custom_image : config.gpt_image;
  if (!section?.api_key) throw new Error(`${provider} 尚未配置 API Key`);
  const referencePaths = normalizeReferenceImagePaths(referenceImagePath);
  if (!referencePaths.length) throw new Error("参考图不存在或不可读取");
  const baseUrl = section.base_url || "https://api.openai.com/v1";
  const endpoint = resolveImageEndpoint(baseUrl, provider === "custom_image" ? section.edit_path : "/images/edits", "edit");
  const extraBody = parseExtraBody(section);
  const moderation = String(section.moderation || "none").trim();

  const submit = async (candidate, suffix = "") => {
    const form = new FormData();
    form.append("model", section.model || "gpt-image-2");
    form.append("prompt", `${candidate.prompt}
保持参考图中核心主体的身份与外观一致：人物需保持发型、服装和年龄特征，产品或物件需保持造型、颜色、包装与关键标识关系；人物采用演员化演绎，不要求复刻真实人物的精确面容。`);
    form.append("size", mappedImageSize(section, ratio));
    if (section.quality) form.append("quality", section.quality);
    const responseFormat = section.edit_response_format || "b64_json";
    if (responseFormat && responseFormat !== "auto") form.append("response_format", responseFormat);
    if (moderation && moderation !== "none") form.append("moderation", moderation);
    const negativeField = negativePromptField(section, provider);
    if (negativeField && candidate.negativePrompt) form.append(negativeField, candidate.negativePrompt);
    for (const imagePath of referencePaths) {
      form.append("image", new Blob([fs.readFileSync(imagePath)]), path.basename(imagePath));
    }
    const reservedFormFields = new Set(["prompt", "image", "model", "size", "quality", "response_format", "moderation", negativeField].filter(Boolean));
    for (const [key, value] of Object.entries(extraBody)) {
      if (!reservedFormFields.has(key)) appendFormField(form, key, value);
    }
    const headers = { authorization: `Bearer ${section.api_key}` };
    if (requestId) {
      headers["idempotency-key"] = `${requestId}${suffix}`;
      headers["x-idempotency-key"] = `${requestId}${suffix}`;
    }
    writeImageStyleAudit(destination, {
      ...imagePromptAudit(candidate, provider, candidate.level),
      mode: "reference_edit",
      negative_prompt_field: negativeField || "not-supported"
    });
    if (shouldStopSubmitting()) throw new TaskCancelledError("已停止提交后续图片");
    const response = await fetchWithProxy(endpoint, {
      method: "POST",
      headers,
      body: form
    }, section.proxy_url);
    return readJsonResponse(response, "参考图编辑");
  };

  const originalPrompt = String(prompt || "");
  const { risk, candidates } = buildImageRequestCandidates({
    scenePrompt: originalPrompt,
    styleConfig,
    policyFallback: section.policy_fallback !== false
  });

  let payload;
  let selectedCandidate = candidates[0];
  let promptUsed = selectedCandidate.prompt;
  let policyAdjusted = Boolean(selectedCandidate.adjusted);
  const errors = [];
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    try {
      payload = await submit(candidate, index ? `-policy-${candidate.mode}` : (candidate.adjusted ? "-preflight-safe" : ""));
      selectedCandidate = candidate;
      promptUsed = candidate.prompt;
      policyAdjusted = Boolean(candidate.adjusted || index > 0);
      break;
    } catch (error) {
      errors.push({
        mode: candidate.mode,
        prompt: candidate.prompt,
        message: String(error?.message || error),
        status: error?.status || 0,
        code: error?.code || "",
        type: error?.type || ""
      });
      if (!isContentPolicyError(error) || section.policy_fallback === false) throw error;
      if (index >= candidates.length - 1) {
        writeImagePolicyDebug(destination, {
          provider,
          endpoint,
          model: section.model || "gpt-image-2",
          mode: "reference_edit",
          original_prompt: originalPrompt,
          selected_style_id: selectedCandidate.styleId || "",
          risk,
          attempts: errors,
          resolved: false
        });
        const finalError = new Error(`参考图提示词被内容审核拒绝；程序已在发送前只改写场景内容，并在每次重试时重新套用同一画面风格，仍未通过。调试文件：${imagePolicyDebugPath(destination)}`);
        finalError.code = "IMAGE_CONTENT_POLICY_REJECTED";
        finalError.status = error?.status || 400;
        throw finalError;
      }
    }
  }
  const imageCandidate = findImageCandidate(payload, section.image_field, endpoint);
  const pollCandidate = findImagePollCandidate(payload, endpoint);
  if (!imageCandidate && pollCandidate?.url) {
    const result = await pollImageResultUrl({
      pollUrl: pollCandidate.url,
      section,
      endpoint,
      destination,
      provider,
      taskId: imageTaskIdFromPayload(payload, pollCandidate.url),
      onProgress
    });
    if (policyAdjusted || errors.length) {
      writeImagePolicyDebug(destination, {
        provider,
        endpoint,
        model: section.model || "gpt-image-2",
        mode: "reference_edit",
        original_prompt: originalPrompt,
        selected_style_id: selectedCandidate.styleId || "",
        risk,
        prompt_used: promptUsed,
        attempts: errors,
        resolved: true
      });
    }
    return {
      ...result,
      policyAdjusted,
      promptUsed,
      safeScenePrompt: selectedCandidate.safeScenePrompt,
      negativePromptUsed: selectedCandidate.negativePrompt,
      styleId: selectedCandidate.styleId,
      registryVersion: selectedCandidate.registryVersion,
      fallbackLevel: selectedCandidate.level,
      responseField: result.responseField || pollCandidate.sourcePath || "poll_url"
    };
  }
  if (!imageCandidate) {
    const debugPath = writeImageResponseDebug(destination, {
      provider,
      endpoint,
      model: section.model || "gpt-image-2",
      mode: "reference_edit",
      configured_image_field: section.image_field || "",
      response_top_level_keys: payload && typeof payload === "object" ? Object.keys(payload) : [],
      payload
    });
    throw new Error(`参考图接口请求成功，但返回结构中没有找到图片地址、Base64 数据或任务查询地址。原始响应已保存：${debugPath}`);
  }
  const savedImage = await saveImageResponse(imageCandidate, destination, section.proxy_url, endpoint, { apiKey: section.api_key });
  if (policyAdjusted || errors.length) {
    writeImagePolicyDebug(destination, {
      provider,
      endpoint,
      model: section.model || "gpt-image-2",
      mode: "reference_edit",
      original_prompt: originalPrompt,
      selected_style_id: selectedCandidate.styleId || "",
      risk,
      prompt_used: promptUsed,
      attempts: errors,
      resolved: true
    });
  }
  return {
    path: destination,
    provider,
    policyAdjusted,
    promptUsed,
    safeScenePrompt: selectedCandidate.safeScenePrompt,
    negativePromptUsed: selectedCandidate.negativePrompt,
    styleId: selectedCandidate.styleId,
    registryVersion: selectedCandidate.registryVersion,
    fallbackLevel: selectedCandidate.level,
    sourceUrl: savedImage.sourceUrl || "",
    responseField: imageCandidate.sourcePath || ""
  };
}

async function generateNetworkImage({ app, config, prompt, destination, ratio }) {
  let imageUrl = "";
  let sourceUrl = "";
  try {
    const endpoint = new URL("https://commons.wikimedia.org/w/api.php");
    endpoint.searchParams.set("action", "query");
    endpoint.searchParams.set("generator", "search");
    endpoint.searchParams.set("gsrsearch", prompt.slice(0, 120));
    endpoint.searchParams.set("gsrnamespace", "6");
    endpoint.searchParams.set("gsrlimit", "8");
    endpoint.searchParams.set("prop", "imageinfo");
    endpoint.searchParams.set("iiprop", "url");
    endpoint.searchParams.set("iiurlwidth", "1920");
    endpoint.searchParams.set("format", "json");
    endpoint.searchParams.set("origin", "*");
    const response = await fetchWithProxy(endpoint, { headers: { "user-agent": "Storybound-Rebuild/0.4" } });
    if (response.ok) {
      const payload = await response.json();
      const pages = Object.values(payload.query?.pages || {});
      const item = pages.find(page => page.imageinfo?.[0]?.thumburl || page.imageinfo?.[0]?.url);
      imageUrl = item?.imageinfo?.[0]?.thumburl || item?.imageinfo?.[0]?.url || "";
      sourceUrl = item?.imageinfo?.[0]?.descriptionurl || "";
    }
  } catch {}
  if (!imageUrl) {
    const searchUrl = `https://www.bing.com/images/search?q=${encodeURIComponent(prompt.slice(0, 120))}&form=HDRSC2`;
    const { stdout } = await spawnAsync("curl.exe", ["-L", "--max-time", "30", "-A", "Mozilla/5.0", searchUrl]);
    const matches = [...stdout.matchAll(/murl&quot;:&quot;(https?:\/\/[^&]+?)&quot;/g)];
    imageUrl = matches.map(match => match[1].replace(/\\u002f/g, "/")).find(url => /\.(?:jpe?g|png|webp)(?:\?|$)/i.test(url)) || "";
    sourceUrl = searchUrl;
  }
  if (!imageUrl) throw new Error("没有找到可用的网络素材");
  const temp = `${destination}.source`;
  try {
    await downloadFile(imageUrl, temp, { "user-agent": "Storybound-Rebuild/0.4" });
  } catch {
    await spawnAsync("curl.exe", ["-L", "--max-time", "45", "-A", "Mozilla/5.0", "-o", temp, imageUrl]);
  }
  const { width, height } = imageSize(ratio);
  await spawnAsync(ffmpegPath(app, config), [
    "-y", "-i", temp, "-vf",
    `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`,
    "-frames:v", "1", destination
  ]);
  fs.unlinkSync(temp);
  return { path: destination, provider: "network", sourceUrl };
}

async function generateSceneImage(args) {
  if (args.materialSource === "network") return generateNetworkImage(args);
  const provider = args.config.image_provider || "placeholder";
  const referencePaths = normalizeReferenceImagePaths(args.referenceImagePath);

  if (provider === "apimart") {
    return generateApiMartImage({
      ...args,
      referenceImagePath: referencePaths
    });
  }

  if (provider === "runninghub") {
    const candidate = buildImageRequestCandidate({
      scenePrompt: args.prompt,
      styleConfig: args.styleConfig,
      level: "preflight"
    });
    writeImageStyleAudit(args.destination, {
      ...imagePromptAudit(candidate, provider, candidate.level),
      negative_prompt_field: args.config.runninghub?.workflow_id ? "{{negative_prompt}}" : "not-supported"
    });
    const result = await generateRunningHubImage({
      ...args,
      prompt: candidate.prompt,
      negativePrompt: candidate.negativePrompt,
      referenceImagePath: referencePaths[0] || ""
    });
    return {
      ...result,
      policyAdjusted: candidate.adjusted,
      promptUsed: candidate.prompt,
      safeScenePrompt: candidate.safeScenePrompt,
      negativePromptUsed: candidate.negativePrompt,
      styleId: candidate.styleId,
      registryVersion: candidate.registryVersion,
      fallbackLevel: candidate.level
    };
  }

  if (referencePaths.length && provider !== "placeholder") {
    return generateReferenceImage({ ...args, provider });
  }
  if (referencePaths.length && provider === "placeholder") {
    const { width, height } = imageSize(args.ratio);
    await spawnAsync(ffmpegPath(args.app, args.config), [
      "-y", "-i", referencePaths[0],
      "-vf", `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`,
      "-frames:v", "1", args.destination
    ]);
    return { path: args.destination, provider: "reference-local" };
  }

  if (provider === "placeholder") {
    const candidate = buildImageRequestCandidate({
      scenePrompt: args.prompt,
      styleConfig: args.styleConfig,
      level: "preflight"
    });
    writeImageStyleAudit(args.destination, imagePromptAudit(candidate, provider, candidate.level));
    const result = await createPlaceholderImage({ ...args, prompt: candidate.prompt });
    return {
      ...result,
      policyAdjusted: candidate.adjusted,
      promptUsed: candidate.prompt,
      safeScenePrompt: candidate.safeScenePrompt,
      negativePromptUsed: candidate.negativePrompt,
      styleId: candidate.styleId,
      registryVersion: candidate.registryVersion,
      fallbackLevel: candidate.level
    };
  }
  if (["gpt_image", "modelscope", "custom_image"].includes(provider)) {
    return generateOpenAiImage({ ...args, provider });
  }
  throw new Error(`图片服务 ${provider} 尚无可用配置；可切换到本地占位图或 OpenAI 兼容接口`);
}

async function testConnection(config, kind, app) {
  if (kind === "llm") {
    if (config.llm?.provider === "local") return { ok: true, message: "本地规则模式可用" };
    try {
      await testModelConnection(config);
      return { ok: true, message: `连接成功 · ${config.llm.protocol === "anthropic" ? "Claude 原生" : "OpenAI 兼容"}` };
    } catch (error) {
      return { ok: false, message: `连接失败：${error?.message || error}` };
    }
  }
  if (kind === "tts") {
    const startedAt = Date.now();
    if (config.tts?.provider === "system") {
      if (process.platform !== "win32") return { ok: false, message: "本机系统语音仅支持 Windows" };
      if (!app) return { ok: false, message: "缺少应用上下文，无法测试本机语音" };
      const destination = path.join(os.tmpdir(), `storybound-system-tts-test-${crypto.randomUUID()}.wav`);
      try {
        await synthesizeSystemVoice({ app, config, text: "你好，这是一段本机默认语音试听。", destination, speed: 1 });
        const audio = fs.readFileSync(destination);
        return {
          ok: audio.length > 0,
          message: audio.length > 0 ? `本机语音可用 · ${Date.now() - startedAt}ms` : "本机语音未生成音频",
          provider: "system",
          dataUrl: `data:audio/wav;base64,${audio.toString("base64")}`
        };
      } finally {
        if (fs.existsSync(destination)) fs.unlinkSync(destination);
      }
    }
    const audio = await requestVolcengineSpeech(config, "你好，这是一段火山引擎语音试听。", 1);
    return {
      ok: audio.length > 0,
      message: audio.length > 0 ? `火山引擎可用 · ${Date.now() - startedAt}ms` : "连接失败：未返回音频",
      provider: "volcengine",
      dataUrl: audio.length > 0 ? `data:audio/mpeg;base64,${audio.toString("base64")}` : ""
    };
  }
  if (kind === "image") {
    if (config.image_provider === "placeholder") return { ok: true, message: "本地图片模式可用" };
    if (config.image_provider === "runninghub") {
      const section = config.runninghub;
      if (!section.api_key) return { ok: false, message: "请填写 RunningHub API Key" };
      return {
        ok: true,
        message: section.workflow_id
          ? "RunningHub 自定义工作流配置完整"
          : `RunningHub 官方模型 ${section.model || "rh-image-g2"} 配置完整`
      };
    }
    const section = config[config.image_provider] || config.gpt_image;
    if (config.image_provider === "apimart") {
      if (!section.api_key || !section.base_url) return { ok: false, message: "请填写 Apimart API Key" };
      const destination = path.join(os.tmpdir(), `storybound-apimart-test-${crypto.randomUUID()}.png`);
      const startedAt = Date.now();
      const routeLabel = section.proxy_url ? `代理 ${normalizeProxyUrl(section.proxy_url)}` : "直连";
      try {
        await generateApiMartImage({
          config,
          prompt: "一个简洁的蓝色圆形图标，纯色背景，无文字",
          destination,
          ratio: "1:1"
        });
        return {
          ok: true,
          message: `Apimart 生图成功 · ${routeLabel} · ${Math.max(1, Math.round((Date.now() - startedAt) / 1000))}秒`
        };
      } catch (error) {
        return {
          ok: false,
          message: `Apimart 测试失败 · ${routeLabel}：${error?.message || error}`
        };
      } finally {
        if (fs.existsSync(destination)) fs.unlinkSync(destination);
      }
    }
    if (config.image_provider === "custom_image") {
      if (!section.api_key || !section.base_url || !section.model) return { ok: false, message: "请填写 Base URL、API Key 和模型" };
      if (section.async_mode) return { ok: true, message: "异步外部接口配置结构完整" };
      const destination = path.join(os.tmpdir(), `storybound-image-test-${crypto.randomUUID()}.png`);
      try {
        await generateOpenAiImage({
          provider: "custom_image",
          config,
          prompt: "一个简洁的蓝色圆形图标，纯色背景，无文字",
          destination,
          ratio: "1:1"
        });
        return { ok: true, message: "连接成功，接口已实际返回测试图片" };
      } finally {
        if (fs.existsSync(destination)) fs.unlinkSync(destination);
      }
    }
    const response = await fetchWithProxy((section.base_url || "https://api.openai.com/v1").replace(/\/$/, "") + "/models", {
      headers: { authorization: `Bearer ${section.api_key}` }
    }, section.proxy_url);
    return { ok: response.ok, message: response.ok ? "连接成功" : `连接失败 (${response.status})` };
  }
  return { ok: true, message: "配置结构正常" };
}

function resolveSystemVoiceName(args = {}) {
  const configuredVoice = String(args.config?.tts?.system?.voice || "").trim();
  const hasTaskVoiceOverride = Object.prototype.hasOwnProperty.call(args, "speaker");
  const requestedVoice = String(args.speaker || "").trim();
  if (!hasTaskVoiceOverride) return configuredVoice;
  if (!requestedVoice || requestedVoice.includes("_bigtts")) return "";
  return requestedVoice;
}

async function synthesizeSystemVoice(args) {
  const { app, config, text, destination, speed } = args;
  if (process.platform !== "win32") throw new Error("本机系统语音仅支持 Windows");
  const textPath = `${destination}.txt`;
  fs.writeFileSync(textPath, text, "utf8");
  const resourceScript = resolveResource(app, "sapi.ps1");
  const script = fs.existsSync(resourceScript) ? resourceScript : path.join(__dirname, "sapi.ps1");
  const rate = Math.max(-10, Math.min(10, Math.round((Number(speed || 1) - 1) * 5)));
  // 任务明确传入空字符串时表示“Windows 系统默认音色”，不能再次回退到设置页指定音色。
  // 未传 speaker（例如设置页试听）时，才使用设置页保存的默认音色。
  const voiceName = resolveSystemVoiceName(args);
  const volume = Math.max(0, Math.min(100, Number(config?.tts?.system?.volume ?? 100)));
  try {
    const args = [
      "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
      "-File", script, "-TextPath", textPath, "-OutputPath", destination,
      "-Rate", String(rate), "-Volume", String(volume)
    ];
    if (voiceName) args.push("-VoiceName", voiceName);
    await spawnAsync("powershell.exe", args);
  } finally {
    if (fs.existsSync(textPath)) fs.unlinkSync(textPath);
  }
  return destination;
}

async function listSystemVoices(app) {
  if (process.platform !== "win32") return [];
  const resourceScript = resolveResource(app, "sapi-voices.ps1");
  const script = fs.existsSync(resourceScript) ? resourceScript : path.join(__dirname, "sapi-voices.ps1");
  const { stdout } = await spawnAsync("powershell.exe", [
    "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script
  ]);
  const text = stdout.trim();
  if (!text) return [];
  const parsed = JSON.parse(text.replace(/^﻿/, ""));
  return Array.isArray(parsed) ? parsed : [parsed];
}

function parseVolcengineAudio(responseText) {
  const audioParts = [];
  const candidates = responseText.split(/\r?\n/)
    .map(line => line.trim().replace(/^data:\s*/, ""))
    .filter(line => line && line !== "[DONE]");
  if (!candidates.length && responseText.trim()) candidates.push(responseText.trim());
  for (const candidate of candidates) {
    try {
      const payload = JSON.parse(candidate);
      if (payload.data) audioParts.push(Buffer.from(payload.data, "base64"));
      const code = Number(payload.code || 0);
      if (code && code !== 20000000) throw new Error(payload.message || `火山 TTS 错误 (${code})`);
    } catch (error) {
      if (error instanceof SyntaxError) continue;
      throw error;
    }
  }
  return Buffer.concat(audioParts);
}

async function requestVolcengineSpeech(config, text, speed, speakerOverride = "") {
  const section = config.tts.volcengine;
  if (!section.app_id || !section.access_key) throw new Error("火山引擎尚未配置 App ID 和 Access Token");
  const speaker = speakerOverride || section.speaker;
  if (!speaker) throw new Error("请选择或填写火山引擎音色 ID");
  const inferredResource = speaker.includes("_moon_bigtts")
    ? "seed-tts-1.0"
    : /_(?:v2_)?(?:saturn|uranus|jupiter)_bigtts$/.test(speaker)
      ? "seed-tts-2.0"
      : "";
  const preferredResource = inferredResource || section.resource_id
    || (section.engine_version === "1.0" ? "seed-tts-1.0" : "seed-tts-2.0");
  const requestWithResource = async resourceId => {
    const response = await fetchWithProxy(section.base_url || "https://openspeech.bytedance.com/api/v3/tts/unidirectional", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Api-App-Id": section.app_id,
        "X-Api-Access-Key": section.access_key,
        "X-Api-Resource-Id": resourceId,
        "X-Api-Request-Id": crypto.randomUUID()
      },
      body: JSON.stringify({
        user: { uid: "storybound-local" },
        req_params: {
          text,
          speaker,
          audio_params: {
            format: "mp3",
            sample_rate: 24000,
            speech_rate: Math.max(-50, Math.min(100, Math.round((Number(speed || 1) - 1) * 100)))
          }
        }
      })
    }, "");
    const responseText = await response.text();
    if (!response.ok) {
      let message = responseText;
      try { message = JSON.parse(responseText).message || responseText; } catch {}
      throw new Error(message || response.headers.get("X-Api-Message") || `火山 TTS 失败 (${response.status})`);
    }
    const audio = parseVolcengineAudio(responseText);
    if (!audio.length) throw new Error(response.headers.get("X-Api-Message") || "火山 TTS 未返回音频数据");
    return audio;
  };
  try {
    return await requestWithResource(preferredResource);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/resource ID is mismatched|resourceId下没有该speaker/i.test(message)) throw error;
    const fallbackResource = preferredResource === "seed-tts-2.0" ? "seed-tts-1.0" : "seed-tts-2.0";
    return requestWithResource(fallbackResource);
  }
}

async function synthesizeVolcengine({ config, text, destination, speed, speaker }) {
  const audio = await requestVolcengineSpeech(config, text, speed, speaker);
  fs.writeFileSync(destination, audio);
  return destination;
}

async function synthesizeSpeech(args) {
  const provider = args.provider || args.config.tts?.provider || "system";
  if (provider === "system") return synthesizeSystemVoice(args);
  if (provider === "volcengine") return synthesizeVolcengine(args);
  throw new Error(`未知语音服务：${provider}`);
}

async function mediaDuration(app, config, file) {
  const { stderr } = await spawnAsync(ffmpegPath(app, config), ["-i", file, "-f", "null", "-"]);
  const match = stderr.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
  if (!match) throw new Error(`无法读取音频时长：${path.basename(file)}`);
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

module.exports = {
  spawnAsync, resolveResource, ffmpegPath, generateSceneImage,
  synthesizeSpeech, requestVolcengineSpeech, mediaDuration, imageSize, downloadFile, testConnection, generateRunningHubVideo,
  listSystemVoices,
  _voiceTest: { resolveSystemVoiceName }
};
