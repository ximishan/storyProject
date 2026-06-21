const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const os = require("node:os");
const { spawn } = require("node:child_process");
const { ProxyAgent } = require("undici");
const { testModelConnection } = require("./llm-planner.cjs");

function spawnAsync(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, ...options });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", chunk => { stdout += chunk.toString(); });
    child.stderr?.on("data", chunk => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", code => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr.trim() || stdout.trim() || `${path.basename(command)} 退出码 ${code}`));
    });
  });
}

function fetchWithProxy(url, options = {}, proxyUrl = "") {
  return fetch(url, {
    ...options,
    ...(proxyUrl ? { dispatcher: new ProxyAgent(proxyUrl) } : {})
  });
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

async function downloadFile(url, destination, headers = {}, proxyUrl = "") {
  const response = await fetchWithProxy(url, { headers }, proxyUrl);
  if (!response.ok) throw new Error(`下载素材失败 (${response.status})`);
  fs.writeFileSync(destination, Buffer.from(await response.arrayBuffer()));
}

const getByPath = (source, fieldPath) => String(fieldPath || "").split(".")
  .filter(Boolean).reduce((value, key) => value?.[Number.isInteger(Number(key)) ? Number(key) : key], source);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function mappedImageSize(section, ratio) {
  try {
    const mapping = JSON.parse(section.ratio_mapping_json || "{}");
    return mapping[ratio] || imageSize(ratio).apiSize;
  } catch {
    return imageSize(ratio).apiSize;
  }
}

async function saveImageResponse(item, destination, proxyUrl = "") {
  if (typeof item === "string" && /^data:image\//.test(item)) {
    fs.writeFileSync(destination, Buffer.from(item.split(",")[1], "base64"));
  } else if (typeof item === "string" && /^https?:\/\//.test(item)) {
    await downloadFile(item, destination, {}, proxyUrl);
  } else if (item?.b64_json || item?.base64) {
    fs.writeFileSync(destination, Buffer.from(item.b64_json || item.base64, "base64"));
  } else if (item?.url || item?.fileUrl) {
    await downloadFile(item.url || item.fileUrl, destination, {}, proxyUrl);
  } else {
    throw new Error("图片接口未返回可识别的图片地址或 Base64 数据");
  }
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
      throw new Error(`${actionName}返回的不是有效 JSON：${text.slice(0, 240)}`);
    }
  }
  if (!response.ok) {
    const message = payload?.error?.message || payload?.message || payload?.msg || `${actionName}失败 (${response.status})`;
    throw new Error(message);
  }
  return payload;
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
      const item = getByPath(statusPayload, section.image_field || "data.0.url");
      await saveImageResponse(item, destination, section.proxy_url);
      return { path: destination, provider: "custom_image", taskId, sourceUrl: item?.url || (typeof item === "string" ? item : "") };
    }
    if (["failed", "error", "cancelled"].includes(status)) throw new Error(statusPayload?.message || `图片任务失败：${status}`);
  }
  throw new Error("图片任务等待超时");
}

async function generateOpenAiImage({ provider, config, prompt, destination, ratio, resumeTaskId = "", onRemoteTask = () => {}, requestId = "" }) {
  const section = provider === "modelscope" ? config.modelscope
    : provider === "custom_image" ? config.custom_image : config.gpt_image;
  const baseUrl = section.base_url || (provider === "modelscope"
    ? "https://api-inference.modelscope.cn/v1"
    : "https://api.openai.com/v1");
  if (!section.api_key) throw new Error(`${provider} 尚未配置 API Key`);
  if (provider === "custom_image" && section.async_mode && resumeTaskId) {
    if (!section.status_path) throw new Error("异步图片接口尚未填写状态查询路径");
    return pollCustomImageTask({ section, baseUrl, taskId: resumeTaskId, destination });
  }
  const endpoint = resolveImageEndpoint(baseUrl, provider === "custom_image" ? section.submit_path : "/images/generations", "generation");
  const extraBody = parseExtraBody(section);
  const responseFormat = section.response_format || "b64_json";
  const body = {
    model: section.model || "gpt-image-2",
    prompt,
    n: 1,
    size: mappedImageSize(section, ratio),
    ...(section.quality ? { quality: section.quality } : {}),
    ...(responseFormat && responseFormat !== "auto" ? { response_format: responseFormat } : {}),
    ...extraBody
  };
  const headers = { "content-type": "application/json", authorization: `Bearer ${section.api_key}` };
  if (requestId) {
    headers["idempotency-key"] = requestId;
    headers["x-idempotency-key"] = requestId;
  }
  const response = await fetchWithProxy(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  }, section.proxy_url);
  const payload = await readJsonResponse(response, "图片生成");
  if (provider === "custom_image" && section.async_mode) {
    const taskId = getByPath(payload, section.task_id_field || "task_id");
    if (!taskId || !section.status_path) throw new Error("异步图片接口未返回任务 ID，或尚未填写状态查询路径");
    onRemoteTask({ taskId: String(taskId), provider: "custom_image" });
    return pollCustomImageTask({ section, baseUrl, taskId: String(taskId), destination });
  }
  const item = payload.data?.[0] || payload.output?.images?.[0] || getByPath(payload, section.image_field);
  await saveImageResponse(item, destination, section.proxy_url);
  return { path: destination, provider };
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

async function generateRunningHubImage({ config, prompt, destination, ratio, referenceImagePath, resumeTaskId = "", onRemoteTask = () => {} }) {
  const section = config.runninghub;
  if (!section.api_key) throw new Error("RunningHub 尚未配置 API Key");
  if (!section.workflow_id) {
    return generateRunningHubOfficialImage({ config, prompt, destination, ratio, referenceImagePath, resumeTaskId, onRemoteTask });
  }
  const baseUrl = (section.base_url || "https://www.runninghub.cn").replace(/\/$/, "");
  if (resumeTaskId) {
    return pollRunningHubWorkflowImage({ baseUrl, section, taskId: resumeTaskId, destination });
  }
  let nodeInfoList;
  try { nodeInfoList = JSON.parse(section.node_info_json || "[]"); } catch { throw new Error("RunningHub 节点参数 JSON 格式错误"); }
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


async function generateRunningHubOfficialImage({ config, prompt, destination, ratio, referenceImagePath, resumeTaskId = "", onRemoteTask = () => {} }) {
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


async function generateReferenceImage({ provider, config, prompt, destination, ratio, referenceImagePath, requestId = "" }) {
  const section = provider === "modelscope" ? config.modelscope
    : provider === "custom_image" ? config.custom_image : config.gpt_image;
  if (!section?.api_key) throw new Error(`${provider} 尚未配置 API Key`);
  const referencePaths = normalizeReferenceImagePaths(referenceImagePath);
  if (!referencePaths.length) throw new Error("参考图不存在或不可读取");
  const baseUrl = section.base_url || "https://api.openai.com/v1";
  const endpoint = resolveImageEndpoint(baseUrl, provider === "custom_image" ? section.edit_path : "/images/edits", "edit");
  const form = new FormData();
  form.append("model", section.model || "gpt-image-2");
  form.append("prompt", `${prompt}\n保持参考图中的人物身份、面部特征、发型、服装与整体构图逻辑一致。`);
  form.append("size", mappedImageSize(section, ratio));
  if (section.quality) form.append("quality", section.quality);
  const responseFormat = section.edit_response_format || "b64_json";
  if (responseFormat && responseFormat !== "auto") form.append("response_format", responseFormat);
  for (const imagePath of referencePaths) {
    form.append("image", new Blob([fs.readFileSync(imagePath)]), path.basename(imagePath));
  }
  const extraBody = parseExtraBody(section);
  for (const [key, value] of Object.entries(extraBody)) appendFormField(form, key, value);
  const headers = { authorization: `Bearer ${section.api_key}` };
  if (requestId) {
    headers["idempotency-key"] = requestId;
    headers["x-idempotency-key"] = requestId;
  }
  const response = await fetchWithProxy(endpoint, {
    method: "POST",
    headers,
    body: form
  }, section.proxy_url);
  const payload = await readJsonResponse(response, "参考图编辑");
  const item = payload.data?.[0] || payload.output?.images?.[0] || getByPath(payload, section.image_field);
  await saveImageResponse(item, destination, section.proxy_url);
  return { path: destination, provider };
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
    const response = await fetch(endpoint, { headers: { "user-agent": "Storybound-Rebuild/0.4" } });
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
  if (provider === "runninghub") return generateRunningHubImage(args);
  if (args.referenceImagePath && fs.existsSync(args.referenceImagePath) && provider !== "placeholder") {
    return generateReferenceImage({ ...args, provider });
  }
  if (args.referenceImagePath && fs.existsSync(args.referenceImagePath) && provider === "placeholder") {
    const { width, height } = imageSize(args.ratio);
    await spawnAsync(ffmpegPath(args.app, args.config), [
      "-y", "-i", args.referenceImagePath,
      "-vf", `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`,
      "-frames:v", "1", args.destination
    ]);
    return { path: args.destination, provider: "reference-local" };
  }
  if (provider === "placeholder") return createPlaceholderImage(args);
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

async function synthesizeSystemVoice({ app, config, text, destination, speed, speaker }) {
  if (process.platform !== "win32") throw new Error("本机系统语音仅支持 Windows");
  const textPath = `${destination}.txt`;
  fs.writeFileSync(textPath, text, "utf8");
  const resourceScript = resolveResource(app, "sapi.ps1");
  const script = fs.existsSync(resourceScript) ? resourceScript : path.join(__dirname, "sapi.ps1");
  const rate = Math.max(-10, Math.min(10, Math.round((Number(speed || 1) - 1) * 5)));
  const configuredVoice = String(config?.tts?.system?.voice || "").trim();
  const requestedVoice = String(speaker || "").trim();
  const voiceName = requestedVoice && !requestedVoice.includes("_bigtts") ? requestedVoice : configuredVoice;
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
    const response = await fetch(section.base_url || "https://openspeech.bytedance.com/api/v3/tts/unidirectional", {
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
    });
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
  const provider = args.config.tts?.provider || "system";
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
  synthesizeSpeech, mediaDuration, imageSize, downloadFile, testConnection, generateRunningHubVideo,
  listSystemVoices
};
