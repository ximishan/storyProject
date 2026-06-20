const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { ProxyAgent } = require("undici");

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

async function generateOpenAiImage({ provider, config, prompt, destination, ratio }) {
  const section = provider === "modelscope" ? config.modelscope
    : provider === "custom_image" ? config.custom_image : config.gpt_image;
  const baseUrl = (section.base_url || (provider === "modelscope"
    ? "https://api-inference.modelscope.cn/v1"
    : "https://api.openai.com/v1")).replace(/\/$/, "");
  if (!section.api_key) throw new Error(`${provider} 尚未配置 API Key`);
  const submitPath = provider === "custom_image" ? section.submit_path || "/images/generations" : "/images/generations";
  let extraBody = {};
  try { extraBody = JSON.parse(section.extra_body_json || "{}"); } catch { throw new Error("外部图片接口的额外请求 JSON 格式错误"); }
  const response = await fetchWithProxy(`${baseUrl}${submitPath.startsWith("/") ? submitPath : `/${submitPath}`}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${section.api_key}` },
    body: JSON.stringify({
      model: section.model || "gpt-image-1",
      prompt,
      n: 1,
      size: mappedImageSize(section, ratio),
      response_format: "b64_json",
      ...extraBody
    })
  }, section.proxy_url);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message || `图片生成失败 (${response.status})`);
  if (provider === "custom_image" && section.async_mode) {
    const taskId = getByPath(payload, section.task_id_field || "task_id");
    if (!taskId || !section.status_path) throw new Error("异步图片接口未返回任务 ID，或尚未填写状态查询路径");
    const successValues = String(section.success_values || "succeeded,completed,success").split(",").map(value => value.trim().toLowerCase());
    for (let attempt = 0; attempt < 120; attempt += 1) {
      await sleep(2000);
      const statusUrl = `${baseUrl}${section.status_path.replace("{task_id}", encodeURIComponent(taskId))}`;
      const poll = await fetchWithProxy(statusUrl, { headers: { authorization: `Bearer ${section.api_key}` } }, section.proxy_url);
      const statusPayload = await poll.json();
      if (!poll.ok) throw new Error(statusPayload?.error?.message || `查询图片任务失败 (${poll.status})`);
      const status = String(getByPath(statusPayload, section.status_field || "status") || "").toLowerCase();
      if (successValues.includes(status)) {
        await saveImageResponse(getByPath(statusPayload, section.image_field || "data.0.url"), destination, section.proxy_url);
        return { path: destination, provider };
      }
      if (["failed", "error", "cancelled"].includes(status)) throw new Error(statusPayload?.message || `图片任务失败：${status}`);
    }
    throw new Error("图片任务等待超时");
  }
  const item = payload.data?.[0] || payload.output?.images?.[0] || getByPath(payload, section.image_field);
  await saveImageResponse(item, destination, section.proxy_url);
  return { path: destination, provider };
}

async function generateRunningHubImage({ config, prompt, destination, ratio, referenceImagePath }) {
  const section = config.runninghub;
  if (!section.api_key || !section.workflow_id) throw new Error("RunningHub 尚未配置 API Key 和 Workflow ID");
  const baseUrl = (section.base_url || "https://www.runninghub.cn").replace(/\/$/, "");
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
      return { path: destination, provider: "runninghub", sourceUrl: image.fileUrl };
    }
    if (Number(output.code || 0) !== 0 && !/running|queue|wait/i.test(output.msg || "")) throw new Error(output.msg || "RunningHub 任务失败");
  }
  throw new Error("RunningHub 任务等待超时");
}

async function generateReferenceImage({ provider, config, prompt, destination, ratio, referenceImagePath }) {
  const section = provider === "modelscope" ? config.modelscope
    : provider === "custom_image" ? config.custom_image : config.gpt_image;
  if (!section?.api_key) throw new Error(`${provider} 尚未配置 API Key`);
  const baseUrl = (section.base_url || "https://api.openai.com/v1").replace(/\/$/, "");
  const form = new FormData();
  form.append("model", section.model || "gpt-image-1");
  form.append("prompt", `${prompt}\n保持参考图中的人物身份、面部特征、发型和服装一致。`);
  form.append("size", imageSize(ratio).apiSize);
  form.append("image", new Blob([fs.readFileSync(referenceImagePath)]), path.basename(referenceImagePath));
  const response = await fetchWithProxy(`${baseUrl}/images/edits`, {
    method: "POST",
    headers: { authorization: `Bearer ${section.api_key}` },
    body: form
  }, section.proxy_url);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message || `参考图生成失败 (${response.status})`);
  const item = payload.data?.[0];
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

async function testConnection(config, kind) {
  if (kind === "llm") {
    if (config.llm?.provider === "local") return { ok: true, message: "本地规则模式可用" };
    const endpoint = (config.llm.base_url || "").replace(/\/$/, "")
      + (config.llm.protocol === "anthropic" ? "/v1/messages" : "/chat/completions");
    const response = await fetchWithProxy(endpoint, {
      method: "POST",
      headers: config.llm.protocol === "anthropic"
        ? { "content-type": "application/json", "x-api-key": config.llm.api_key, "anthropic-version": "2023-06-01" }
        : { "content-type": "application/json", authorization: `Bearer ${config.llm.api_key}` },
      body: JSON.stringify({
        model: config.llm.model,
        max_tokens: 1,
        messages: [{ role: "user", content: "ping" }]
      })
    }, config.llm.proxy_url);
    return { ok: response.ok, message: response.ok ? "连接成功" : `连接失败 (${response.status})` };
  }
  if (kind === "tts") {
    const startedAt = Date.now();
    const audio = await requestVolcengineSpeech(config, "连接测试", 1);
    return {
      ok: audio.length > 0,
      message: audio.length > 0 ? `连接成功 · ${Date.now() - startedAt}ms` : "连接失败：未返回音频"
    };
  }
  if (kind === "image") {
    if (config.image_provider === "placeholder") return { ok: true, message: "本地图片模式可用" };
    if (config.image_provider === "runninghub") {
      const section = config.runninghub;
      if (!section.api_key || !section.workflow_id) return { ok: false, message: "请填写 RunningHub API Key 和 Workflow ID" };
      return { ok: true, message: "RunningHub 配置结构完整；生成图片时会提交工作流验证" };
    }
    const section = config[config.image_provider] || config.gpt_image;
    if (config.image_provider === "custom_image") {
      if (!section.api_key || !section.base_url || !section.model) return { ok: false, message: "请填写外部接口 Base URL、API Key 和模型" };
      return { ok: true, message: section.async_mode ? "异步外部接口配置结构完整" : "OpenAI 兼容图片接口配置结构完整" };
    }
    const response = await fetchWithProxy((section.base_url || "https://api.openai.com/v1").replace(/\/$/, "") + "/models", {
      headers: { authorization: `Bearer ${section.api_key}` }
    }, section.proxy_url);
    return { ok: response.ok, message: response.ok ? "连接成功" : `连接失败 (${response.status})` };
  }
  return { ok: true, message: "配置结构正常" };
}

async function synthesizeSystemVoice({ app, text, destination, speed }) {
  const textPath = `${destination}.txt`;
  fs.writeFileSync(textPath, text, "utf8");
  const resourceScript = resolveResource(app, "sapi.ps1");
  const script = fs.existsSync(resourceScript) ? resourceScript : path.join(__dirname, "sapi.ps1");
  const rate = Math.max(-10, Math.min(10, Math.round((Number(speed || 1) - 1) * 5)));
  try {
    await spawnAsync("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
      "-File", script, "-TextPath", textPath, "-OutputPath", destination, "-Rate", String(rate)
    ]);
  } finally {
    if (fs.existsSync(textPath)) fs.unlinkSync(textPath);
  }
  return destination;
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
  synthesizeSpeech, mediaDuration, imageSize, downloadFile, testConnection
};
