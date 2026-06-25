const fs = require("node:fs");
const path = require("node:path");
let ProxyAgent = null;
let undiciFetch = null;
try { ({ ProxyAgent, fetch: undiciFetch } = require("undici")); } catch {}
const llmProxyAgentCache = new Map();
const { atomicWriteJson, atomicWriteFile, readJsonSafe, fingerprint } = require("./checkpoint.cjs");
const { resolveVisualStyle } = require("./visual-styles.cjs");
const { taskReferenceAvailable } = require("./reference-routing.cjs");
const { currentCancellationSignal, cancellationError, throwIfCancelled } = require("./cancellation.cjs");

const systemPromptTemplates = Object.fromEntries(
  require("../shared/system-prompt-templates.json").map(item => [item.id, item])
);

const REWRITE_BASE_PROMPT = `你是专业的中文短视频文案编导。请根据用户的任务参数处理原始文案。
只返回合法 JSON，不要输出 Markdown 代码块。JSON 字符串内部如需引用原话，优先使用中文引号“”，不得直接插入未转义的英文双引号。JSON 结构：
{
  "title": "视频标题",
  "summary": "80字以内摘要",
  "narration": "处理后的完整旁白"
}
必须保留原文核心事实、人物关系和因果，不得凭空补充具体姓名、年份、数据、机构或结论。`;

const METADATA_BASE_PROMPT = `你是短视频视觉策划。请从旁白中抽取后续分镜和人物/产品一致性所需的结构化元数据。
只返回合法 JSON，不要输出 Markdown 代码块。JSON 字符串内部如需引用原话，优先使用中文引号“”，不得直接插入未转义的英文双引号。JSON 结构：
{
  "publish": {
    "title": "封面主标题",
    "subtitle": ["副标题第一句", "副标题第二句"],
    "summary": "视频发布简介",
    "tags": ["#标签1", "#标签2"],
    "comments": ["种子评论1", "种子评论2", "种子评论3", "种子评论4", "种子评论5"]
  },
  "character_card": {
    "enabled": true,
    "name": "主角名或unknown",
    "identity": "身份",
    "gender": "性别或unknown",
    "age_stages": ["不同年代的年龄阶段"],
    "face": "稳定脸部特征",
    "hair": "稳定发型特征",
    "clothing": "稳定服装特征",
    "stable_prompt": "可重复注入每个主角镜头的中文描述"
  },
  "product_card": {
    "enabled": false,
    "name": "产品/菜品/关键物件名",
    "appearance": "外形、颜色、材质、结构",
    "stable_prompt": "可重复注入产品镜头的中文描述"
  },
  "era_and_location": [
    {"segment": "适用剧情阶段", "era": "年代", "location": "地点", "prompt": "年代与地域视觉描述"}
  ],
  "key_objects": ["关键物件"],
  "facts": ["不可改动的事实"],
  "visual_continuity": ["跨镜头必须保持的视觉规则"]
}
publish 必须依据旁白与赛道规则生成；没有副标题、标签或评论时返回空数组。不得编造旁白中不存在的人名、品牌、价格、疗效、身份、年份或历史事实。
不明确的视觉信息必须写 unknown 或留空，不得猜测。`;

const SCENE_BASE_PROMPT = `你是专业短视频分镜师和图片提示词工程师。请把旁白拆成连续分镜。
只返回合法 JSON，不要输出 Markdown 代码块。JSON 字符串内部如需引用原话，优先使用中文引号“”，不得直接插入未转义的英文双引号。JSON 结构：
{
  "scenes": [
    {
      "index": 1,
      "narration": "本镜对应的原始旁白，不能漏字或重复",
      "visual": "给人看的简洁画面说明",
      "desc_prompt": "只描述本镜主体、动作、环境、镜头、光线和关键细节的中文提示词",
      "use_reference": true,
      "reference_reason": "为什么需要或不需要参考图",
      "subject_presence": "character|product|both|none",
      "era_and_location": "本镜年代与地点",
      "duration_hint": 5,
      "speaker_role": "A或B，仅双人播客需要"
    }
  ]
}
每镜只表达一个明确视觉重点。旁白必须完整覆盖，不得改写、漏句或重复。不要输出 caption_segments，字幕会在完整 TTS 生成后由程序按真实音频时长和自然语义自动切分。use_reference 必须根据本镜是否真正出现需要保持一致的主角/产品来判断，空镜、环境、器物、资料画面通常为 false。\n图片合规硬规则：当旁白涉及手术、受伤、流血、尸体、暴力或死亡时，不得在 desc_prompt 中直接描写令人不适的细节。必须改用包扎后的手指、医生神情、医疗站环境、布帘遮挡、器械整理、远景或象征性画面。不得输出“鲜血、血液、染血、伤口特写、割口清晰可见、缝合伤口、器官外露、尸体特写、极近景微距”等表达。赛道专用要求不得覆盖本条规则。`;

const JSON_REPAIR_PROMPT = `你是严格的 JSON 修复器。用户会提供一段本应为 JSON、但可能包含未转义引号、非法换行、尾逗号或多余说明的文本。
只返回修复后的合法 JSON，不要输出 Markdown，不要解释，不要改写字段含义，不要删除原有有效内容。JSON 字符串中的英文双引号必须正确转义。`;

function llmProxyDispatcher(value = "") {
  let proxyUrl = String(value || "").trim();
  if (!proxyUrl) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(proxyUrl)) proxyUrl = `http://${proxyUrl}`;
  let parsed;
  try { parsed = new URL(proxyUrl); }
  catch { throw new Error(`LLM 代理地址格式错误：${proxyUrl}`); }
  if (!["http:", "https:"].includes(parsed.protocol) || !parsed.hostname || !parsed.port) {
    throw new Error("LLM 代理地址必须是包含端口的 HTTP/HTTPS 地址，例如 http://127.0.0.1:7897");
  }
  const normalized = parsed.toString().replace(/\/$/, "");
  if (!ProxyAgent || !undiciFetch) throw new Error("已配置 LLM 代理，但 undici 的 fetch/ProxyAgent 不可用，请重新安装项目依赖");
  let dispatcher = llmProxyAgentCache.get(normalized);
  if (!dispatcher) {
    dispatcher = new ProxyAgent(normalized);
    llmProxyAgentCache.set(normalized, dispatcher);
  }
  return { normalized, dispatcher };
}

async function llmFetch(url, options, proxyUrl) {
  const signal = options?.signal || currentCancellationSignal();
  throwIfCancelled(signal);
  const proxy = llmProxyDispatcher(proxyUrl);
  try {
    const requestOptions = { ...options, ...(signal ? { signal } : {}) };
    if (proxy) return await undiciFetch(url, { ...requestOptions, dispatcher: proxy.dispatcher });
    return await globalThis.fetch(url, requestOptions);
  } catch (error) {
    if (signal?.aborted || error?.name === "AbortError") throw cancellationError(signal);
    if (proxy) {
      const detail = String(error?.cause?.message || error?.message || error);
      const wrapped = new Error(`通过 LLM 代理 ${proxy.normalized} 请求失败：${detail}`);
      wrapped.code = error?.cause?.code || error?.code || "PROXY_REQUEST_FAILED";
      wrapped.cause = error;
      throw wrapped;
    }
    throw error;
  }
}

function normalizeProcessingMode(value) {
  return value === "semi" ? "semi_auto" : (value || "auto");
}

function splitSourceText(sourceText, targetScenes = 0) {
  return splitNarrationForScenePlan(sourceText, targetScenes || inferAutoSceneCount(sourceText));
}

function podcastSpeakerRoleLine(line) {
  const match = String(line || "").match(/^[\[【]\s*([ABab])\s*[\]】]\s*(.+)$/);
  return match ? { role: match[1].toUpperCase(), text: match[2].trim() } : null;
}

function localSubjectPresence(text, referenceKind) {
  const value = String(text || "");
  const hasProduct = /产品|商品|包装|瓶|盒|菜|食物|器物|物件|手机|设备|衣服/.test(value);
  const hasCharacter = /他|她|我|主角|男人|女人|男孩|女孩|老人|孩子|人物|先生|女士|父亲|母亲|丈夫|妻子/.test(value);
  if (referenceKind === "product") return hasProduct ? "product" : "none";
  if (referenceKind === "character") return hasCharacter ? "character" : "none";
  if (referenceKind === "none") return "none";
  if (hasProduct && hasCharacter) return "both";
  if (hasProduct) return "product";
  if (hasCharacter) return "character";
  return "none";
}

function buildMechanicalScript(task, sourceText = task.input_text, template = {}) {
  const podcastLines = task.task_type === "podcast"
    ? String(sourceText || "").split(/\r?\n/).map(line => line.trim()).filter(Boolean)
    : [];
  const parsedPodcast = podcastLines.map(podcastSpeakerRoleLine).filter(Boolean);
  const taggedPodcastRequired = task.task_type === "podcast" && normalizeProcessingMode(task.processing_mode) !== "auto";
  if (taggedPodcastRequired && (podcastLines.length === 0 || parsedPodcast.length !== podcastLines.length)) {
    throw new Error("双人播客使用半自动或直接出片时，每一行都必须以 [A] 或 [B] 开头");
  }
  const chunks = parsedPodcast.length
    ? parsedPodcast
    : splitSourceText(sourceText, task.target_scenes).map((text, index) => ({ role: index % 2 ? "B" : "A", text }));
  if (!chunks.length) throw new Error("原始文案为空");
  const referenceKind = normalizeReferenceKind(template.reference_kind);
  const scenes = chunks.map((item, index) => {
    const subjectPresence = localSubjectPresence(item.text, referenceKind);
    const useReference = subjectPresence !== "none" && taskReferenceAvailable(task, subjectPresence);
    task.style_config || resolveVisualStyle(task.style);
    const rawImagePrompt = `${item.text}，主体明确，构图完整，适合${task.ratio}短视频画面，无文字无水印`;
    return {
      index: index + 1,
      narration: item.text,
      visual: item.text,
      desc_prompt: rawImagePrompt,
      desc_prompt_original: "",
      image_prompt: rawImagePrompt,
      image_prompt_original: "",
      image_prompt_safety_adjusted: false,
      image_prompt_safety_reasons: [],
      use_reference: useReference,
      reference_reason: useReference ? "直接出片模式使用本地关键词规则判断" : "本镜未识别到需要保持一致的主体",
      subject_presence: useReference ? subjectPresence : "none",
      era_and_location: "",
      duration_hint: Math.max(3, Math.min(12, item.text.length / 4.2)),
      ...(task.task_type === "podcast" ? { speaker_role: item.role } : {})
    };
  });
  return {
    title: task.title || String(sourceText || "").slice(0, 18),
    summary: String(sourceText || "").slice(0, 80),
    subtitle: [],
    tags: [],
    comments: [],
    narration: scenes.map(scene => scene.narration).join(task.task_type === "podcast" ? "\n" : ""),
    metadata: {
      publish: {
        title: task.title || String(sourceText || "").slice(0, 18),
        subtitle: [],
        summary: String(sourceText || "").slice(0, 80),
        tags: [],
        comments: []
      },
      character_card: { enabled: false, stable_prompt: "" },
      product_card: { enabled: false, stable_prompt: "" },
      era_and_location: [],
      key_objects: [],
      facts: [],
      visual_continuity: [],
      planner_mode: "local-mechanical",
      template_id: template.id || task.track || ""
    },
    scenes
  };
}

function safeJsonArray(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function asBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const normalized = String(value || "").trim().toLowerCase();
  return ["true", "1", "yes", "y", "是"].includes(normalized);
}

function normalizeReferenceKind(value) {
  const normalized = String(value || "").toLowerCase();
  return ["character", "product", "auto", "none"].includes(normalized) ? normalized : "auto";
}

function resolveTemplate(task) {
  const systemTemplate = systemPromptTemplates[task.prompt_template_id]
    || systemPromptTemplates[task.track]
    || {};
  return { ...systemTemplate, ...(task.prompt_template || {}) };
}

function resolveCharacterCardMode(template) {
  const explicit = String(template.character_card_mode || "").toLowerCase();
  if (["follow", "force", "skip"].includes(explicit)) return explicit;
  return template.needs_character_card ? "follow" : "skip";
}

function characterCardEnabled(template) {
  const mode = resolveCharacterCardMode(template);
  if (mode === "force") return true;
  if (mode === "skip") return false;
  return Boolean(template.needs_character_card);
}

function stripJsonFence(text) {
  return String(text || "")
    .replace(/^\uFEFF/, "")
    .trim()
    .replace(/^```(?:json|javascript|js)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
}

function extractJsonCandidates(text) {
  const raw = stripJsonFence(text);
  const candidates = [];
  const push = value => {
    const normalized = String(value || "").trim();
    if (normalized && !candidates.includes(normalized)) candidates.push(normalized);
  };
  push(raw);

  const objectStart = raw.indexOf("{");
  const objectEnd = raw.lastIndexOf("}");
  if (objectStart >= 0 && objectEnd > objectStart) push(raw.slice(objectStart, objectEnd + 1));

  const arrayStart = raw.indexOf("[");
  const arrayEnd = raw.lastIndexOf("]");
  if (arrayStart >= 0 && arrayEnd > arrayStart) push(raw.slice(arrayStart, arrayEnd + 1));
  return candidates;
}

function replaceOutsideStrings(text) {
  let output = "";
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      output += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      output += char;
      continue;
    }
    if (char === "：") output += ":";
    else if (char === "，") output += ",";
    else output += char;
  }
  return output
    .replace(/\bTrue\b/g, "true")
    .replace(/\bFalse\b/g, "false")
    .replace(/\bNone\b/g, "null");
}

function repairStringQuotesAndControls(text) {
  let output = "";
  let inString = false;
  let escaped = false;
  let stringRole = "value";

  const nextNonWhitespaceIndex = start => {
    for (let index = start; index < text.length; index += 1) {
      if (!/\s/.test(text[index])) return index;
    }
    return -1;
  };
  const previousNonWhitespace = start => {
    for (let index = start; index >= 0; index -= 1) {
      if (!/\s/.test(text[index])) return text[index];
    }
    return "";
  };
  const commaLooksLikeDelimiter = commaIndex => {
    const nextIndex = nextNonWhitespaceIndex(commaIndex + 1);
    if (nextIndex < 0) return true;
    const next = text[nextIndex];
    return next === '"' || next === "{" || next === "[" || next === "}" || next === "]"
      || next === "-" || /[0-9tfn]/i.test(next);
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (!inString) {
      if (char === '"') {
        const previous = previousNonWhitespace(index - 1);
        stringRole = previous === ":" || previous === "[" ? "value" : "key-or-value";
        inString = true;
      }
      output += char;
      continue;
    }

    if (escaped) {
      output += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      output += char;
      escaped = true;
      continue;
    }
    if (char === "\n") {
      output += "\\n";
      continue;
    }
    if (char === "\r") {
      output += "\\r";
      continue;
    }
    if (char === "\t") {
      output += "\\t";
      continue;
    }
    if (char === '"') {
      const nextIndex = nextNonWhitespaceIndex(index + 1);
      const next = nextIndex >= 0 ? text[nextIndex] : "";
      const closesKey = stringRole === "key-or-value" && next === ":";
      const closesValue = next === "}" || next === "]" || next === ""
        || (next === "," && commaLooksLikeDelimiter(nextIndex));
      if (closesKey || closesValue) {
        output += char;
        inString = false;
      } else {
        output += '\\"';
      }
      continue;
    }
    const code = char.charCodeAt(0);
    if (code >= 0 && code < 0x20) {
      output += `\\u${code.toString(16).padStart(4, "0")}`;
      continue;
    }
    output += char;
  }
  return output;
}


function repairJsonCandidate(candidate) {
  let repaired = String(candidate || "")
    .replace(/([{,]\s*)'([^'\\]*(?:\\.[^'\\]*)*)'\s*:/g, (_match, prefix, key) => `${prefix}${JSON.stringify(key)}:`)
    .replace(/:\s*'([^'\\]*(?:\\.[^'\\]*)*)'(\s*[,}])/g, (_match, value, suffix) => `:${JSON.stringify(value)}${suffix}`);
  repaired = repairStringQuotesAndControls(repaired);
  repaired = replaceOutsideStrings(repaired);
  repaired = repaired.replace(/,\s*([}\]])/g, "$1");
  return repaired;
}

function parseErrorDetails(error, text) {
  const message = String(error?.message || error || "JSON 解析失败");
  const match = message.match(/position\s+(\d+)/i);
  const position = match ? Number(match[1]) : -1;
  const start = position >= 0 ? Math.max(0, position - 80) : 0;
  const end = position >= 0 ? Math.min(text.length, position + 120) : Math.min(text.length, 240);
  return {
    message,
    position,
    snippet: text.slice(start, end)
  };
}

function cleanJsonText(text) {
  const candidates = extractJsonCandidates(text);
  let lastFailure = null;

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch (error) {
      lastFailure = parseErrorDetails(error, candidate);
    }

    const repaired = repairJsonCandidate(candidate);
    if (repaired !== candidate) {
      try {
        return JSON.parse(repaired);
      } catch (error) {
        lastFailure = parseErrorDetails(error, repaired);
      }
    }
  }

  const detail = lastFailure || { message: "没有找到 JSON 对象", position: -1, snippet: stripJsonFence(text).slice(0, 240) };
  const error = new Error(`语言模型返回的 JSON 格式错误：${detail.message}${detail.snippet ? `；附近内容：${detail.snippet}` : ""}`);
  error.code = "LLM_INVALID_JSON";
  error.position = detail.position;
  error.snippet = detail.snippet;
  error.rawText = String(text || "");
  throw error;
}

function ensureDirectory(target) {
  if (target) fs.mkdirSync(target, { recursive: true });
}

function writeDebug(debugDir, filename, value) {
  if (!debugDir) return;
  ensureDirectory(debugDir);
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  atomicWriteFile(path.join(debugDir, filename), text, "utf8");
}

function openAiEndpoint(baseUrl) {
  const base = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!base) throw new Error("语言模型 Base URL 为空");
  return /\/chat\/completions$/i.test(base) ? base : `${base}/chat/completions`;
}

function anthropicEndpoint(baseUrl) {
  const base = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!base) throw new Error("语言模型 Base URL 为空");
  if (/\/messages$/i.test(base)) return base;
  return /\/v1$/i.test(base) ? `${base}/messages` : `${base}/v1/messages`;
}

async function readResponsePayload(response, stage, suppliedText = null) {
  const text = suppliedText === null ? await response.text() : suppliedText;
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; }
  catch {
    const error = new Error(`${stage}接口返回的不是有效 JSON（HTTP ${response.status}）：${text.slice(0, 240)}`);
    error.status = response.status;
    error.responseText = text;
    throw error;
  }
  if (!response.ok) {
    const error = new Error(payload?.error?.message || payload?.message || `${stage}失败 (${response.status})`);
    error.status = response.status;
    error.payload = payload;
    error.responseText = text;
    throw error;
  }
  return payload;
}

function modelProtocolHint(llm, endpoint, message) {
  if (llm.protocol !== "anthropic") return message;
  if (!/invalid json|request body|unsupported|temperature|system/i.test(String(message || ""))) return message;
  return `${message}。当前按 Claude 原生协议请求 ${endpoint}。请核对中转站文档：若接口地址是 /v1/chat/completions，应在设置中选择“OpenAI 兼容”；只有明确提供 /v1/messages 时才选择“Claude 原生”。`;
}

async function callModelJson(config, { stage, system, user, temperature = 0.3, debugDir, maxTokens = 8192, allowJsonRepair = true }) {
  throwIfCancelled();
  const llm = config.llm || {};
  if (!llm.api_key) throw new Error("尚未配置语言模型 API Key，请先前往设置");
  if (!llm.model) throw new Error("尚未配置语言模型名称，请先前往设置");
  if (!llm.base_url) throw new Error("尚未配置语言模型 Base URL，请先前往设置");

  const requestLog = {
    stage,
    protocol: llm.protocol || "openai",
    model: llm.model,
    base_url: llm.base_url,
    temperature,
    max_tokens: maxTokens,
    system,
    user
  };
  writeDebug(debugDir, `${stage}-request.json`, requestLog);

  let rawText = "";
  if (llm.protocol === "anthropic") {
    const endpoint = anthropicEndpoint(llm.base_url);
    // temperature 对部分新 Claude 模型及部分中转实现并不兼容，因此 Claude 原生请求默认不发送该字段。
    const requestBody = {
      model: llm.model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }]
    };
    writeDebug(debugDir, `${stage}-request-body.json`, { endpoint, ...requestBody });

    let response = await llmFetch(endpoint, {
      method: "POST",
      headers: {
        "accept": "application/json",
        "content-type": "application/json",
        "x-api-key": llm.api_key,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify(requestBody)
    }, llm.proxy_url);

    let failedText = null;
    if (!response.ok && response.status === 400) {
      failedText = await response.text();
      writeDebug(debugDir, `${stage}-error-response-first.txt`, failedText);
      let failedMessage = failedText;
      try {
        const failed = failedText ? JSON.parse(failedText) : {};
        failedMessage = failed?.error?.message || failed?.message || failedText;
      } catch {}

      // 某些中转站声称兼容 /v1/messages，但不接受顶层 system 字段。
      // 首次 400 时改用最小请求体重试一次，把 system 合并进用户消息。
      if (/invalid json|request body|system|unsupported/i.test(String(failedMessage || ""))) {
        const fallbackBody = {
          model: llm.model,
          max_tokens: maxTokens,
          messages: [{ role: "user", content: `${system}\n\n用户任务：\n${user}` }]
        };
        writeDebug(debugDir, `${stage}-request-body-fallback.json`, { endpoint, ...fallbackBody });
        response = await llmFetch(endpoint, {
          method: "POST",
          headers: {
            "accept": "application/json",
            "content-type": "application/json",
            "x-api-key": llm.api_key,
            "anthropic-version": "2023-06-01"
          },
          body: JSON.stringify(fallbackBody)
        }, llm.proxy_url);
        failedText = null;
      }
    }

    let payload;
    try {
      payload = await readResponsePayload(response, stage, failedText);
    } catch (error) {
      writeDebug(debugDir, `${stage}-error-response-final.txt`, error.responseText || error.message || String(error));
      throw new Error(modelProtocolHint(llm, endpoint, error.message));
    }
    rawText = payload.content?.filter(item => item.type === "text").map(item => item.text).join("\n") || "";
  } else {
    const endpoint = openAiEndpoint(llm.base_url);
    const requestBody = {
      model: llm.model,
      temperature,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ]
    };
    writeDebug(debugDir, `${stage}-request-body.json`, { endpoint, ...requestBody });

    let response = await llmFetch(endpoint, {
      method: "POST",
      headers: {
        "accept": "application/json",
        "content-type": "application/json",
        authorization: `Bearer ${llm.api_key}`
      },
      body: JSON.stringify(requestBody)
    }, llm.proxy_url);
    if (!response.ok && response.status === 400) {
      const failedText = await response.text();
      writeDebug(debugDir, `${stage}-error-response-first.txt`, failedText);
      if (/response_format|json_object|unsupported/i.test(failedText)) {
        delete requestBody.response_format;
        writeDebug(debugDir, `${stage}-request-body-fallback.json`, { endpoint, ...requestBody });
        response = await llmFetch(endpoint, {
          method: "POST",
          headers: {
            "accept": "application/json",
            "content-type": "application/json",
            authorization: `Bearer ${llm.api_key}`
          },
          body: JSON.stringify(requestBody)
        }, llm.proxy_url);
      } else {
        let failed = {};
        try { failed = JSON.parse(failedText); } catch {}
        throw new Error(failed?.error?.message || failed?.message || `${stage}失败 (400)`);
      }
    }
    const payload = await readResponsePayload(response, stage);
    rawText = payload.choices?.[0]?.message?.content || payload.output_text || "";
  }

  throwIfCancelled();
  writeDebug(debugDir, `${stage}-response.txt`, rawText);
  if (!String(rawText || "").trim()) throw new Error(`${stage}接口成功返回，但没有找到模型文本内容`);

  let parsed;
  try {
    parsed = cleanJsonText(rawText);
  } catch (error) {
    writeDebug(debugDir, `${stage}-json-parse-error.json`, {
      message: error.message,
      code: error.code || "",
      position: Number.isFinite(error.position) ? error.position : -1,
      snippet: error.snippet || ""
    });
    if (!allowJsonRepair) {
      throw new Error(`${stage}返回内容仍不是合法 JSON：${error.message}。原始响应已保存到 llm-debug/${stage}-response.txt，可直接重试当前阶段，无需重新生成前两步。`);
    }

    parsed = await callModelJson(config, {
      stage: `${stage}-json-repair`,
      system: JSON_REPAIR_PROMPT,
      user: `请修复下面的内容，使其成为合法 JSON。只修复格式，不改变字段和值的含义：

${rawText}`,
      temperature: 0,
      debugDir,
      maxTokens,
      allowJsonRepair: false
    });
    writeDebug(debugDir, `${stage}-repaired.json`, parsed);
  }

  writeDebug(debugDir, `${stage}-parsed.json`, parsed);
  return parsed;
}

async function testModelConnection(config) {
  return callModelJson(config, {
    stage: "连接测试",
    system: "你是接口连通性测试助手。只返回合法 JSON，不要输出 Markdown。",
    user: '请只返回 {"ok":true}',
    temperature: 0,
    maxTokens: 64
  });
}

function cardPrompt(card) {
  if (!card || card.enabled === false) return "";
  if (typeof card === "string") return card;
  return String(card.stable_prompt || [card.name, card.identity, card.gender, card.face, card.hair, card.clothing]
    .filter(Boolean).join("，") || "");
}

function normalizeStringArray(value, limit = 0) {
  const items = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[\r\n,，]+/)
      : [];
  const normalized = items.map(item => String(item || "").trim()).filter(Boolean);
  return limit > 0 ? normalized.slice(0, limit) : normalized;
}

function eraPrompt(metadata, scene) {
  if (scene?.era_and_location) return String(scene.era_and_location);
  const items = Array.isArray(metadata?.era_and_location) ? metadata.era_and_location : [];
  return items.map(item => typeof item === "string" ? item : item.prompt || [item.era, item.location].filter(Boolean).join("，"))
    .filter(Boolean).join("；");
}

function applyImagePromptTemplate({ scene, metadata, template, ratio, modules }) {
  const visualAction = String(scene.desc_prompt || scene.image_prompt || scene.visual || scene.narration || "").trim();
  const characterPrompt = cardPrompt(metadata.character_card);
  const productPrompt = cardPrompt(metadata.product_card);
  const eraLocation = eraPrompt(metadata, scene);
  const rawTemplate = String(template.image_prompt_template || "{character_card}，{product_card}，{era_and_location}，{visual_action}，{ratio}构图");
  let prompt = rawTemplate
    .replaceAll("{visual_action}", visualAction)
    .replaceAll("{ratio}", ratio || "9:16")
    .replaceAll("{character_card}", scene.subject_presence === "product" || scene.subject_presence === "none" ? "" : characterPrompt)
    .replaceAll("{product_card}", scene.subject_presence === "character" || scene.subject_presence === "none" ? "" : productPrompt)
    .replaceAll("{era_and_location}", eraLocation)
    .replace(/(?:\s*，\s*){2,}/g, "，")
    .replace(/^\s*，|，\s*$/g, "")
    .trim();
  const suffixes = [];
  if (modules.includes("anti-text") || modules.includes("no-text")) suffixes.push("画面中不要出现字幕、台词、标语、商标、乱码或水印");
  if (modules.includes("character-consistency") && characterPrompt && !prompt.includes(characterPrompt)) suffixes.push(`人物一致性：${characterPrompt}`);
  if (modules.includes("product-consistency") && productPrompt && !prompt.includes(productPrompt)) suffixes.push(`产品一致性：${productPrompt}`);
  if (modules.includes("cross-era") && eraLocation && !prompt.includes(eraLocation)) suffixes.push(`年代与地域：${eraLocation}`);
  if (suffixes.length) prompt = [prompt, ...suffixes].filter(Boolean).join("，");
  return prompt;
}

function normalizeMetadata(raw, template) {
  const metadata = raw && typeof raw === "object" ? { ...raw } : {};
  const rawPublish = metadata.publish && typeof metadata.publish === "object"
    ? metadata.publish
    : metadata;
  const publish = {
    title: String(rawPublish.title || "").trim(),
    subtitle: normalizeStringArray(rawPublish.subtitle, 3),
    summary: String(rawPublish.summary || "").trim().slice(0, 500),
    tags: normalizeStringArray(rawPublish.tags, 12),
    comments: normalizeStringArray(rawPublish.comments, 8)
  };
  const wantCharacter = characterCardEnabled(template);
  const character = metadata.character_card && typeof metadata.character_card === "object"
    ? { ...metadata.character_card }
    : { stable_prompt: typeof metadata.character_card === "string" ? metadata.character_card : "" };
  character.enabled = wantCharacter && character.enabled !== false;
  if (!wantCharacter) character.stable_prompt = "";
  const product = metadata.product_card && typeof metadata.product_card === "object"
    ? { ...metadata.product_card }
    : { stable_prompt: typeof metadata.product_card === "string" ? metadata.product_card : "" };
  product.enabled = product.enabled !== false && Boolean(cardPrompt(product));
  return {
    publish,
    character_card: character,
    product_card: product,
    era_and_location: Array.isArray(metadata.era_and_location) ? metadata.era_and_location : [],
    key_objects: Array.isArray(metadata.key_objects) ? metadata.key_objects : [],
    facts: Array.isArray(metadata.facts) ? metadata.facts : [],
    visual_continuity: Array.isArray(metadata.visual_continuity) ? metadata.visual_continuity : []
  };
}

function captionComparable(text) {
  return String(text || "").replace(/\u00B7/gu, "\uE000").replace(/\p{P}|\s/gu, "").replace(/\uE000/gu, "\u00B7");
}

function splitStrongCaptionBoundaries(text) {
  const source = String(text || "").trim();
  if (!source) return [];
  const parts = source.match(/[^。！？!?；;]+[。！？!?；;]*/gu) || [source];
  return parts.map(item => item.trim()).filter(Boolean);
}

function normalizeCaptionSegments(narration, segments) {
  const values = Array.isArray(segments)
    ? segments.flatMap(item => splitStrongCaptionBoundaries(item))
    : [];
  if (!values.length) return [];
  // 保留句末标点供 TTS 表达疑问、感叹和停顿；字幕显示层会单独隐藏普通标点。
  return captionComparable(values.join("")) === captionComparable(narration) ? values : [];
}

function normalizeScene(scene, index, task, metadata, template, modules) {
  const referenceKind = normalizeReferenceKind(template.reference_kind);
  const hasReference = taskReferenceAvailable(task, referenceKind);
  const subjectPresence = ["character", "product", "both", "none"].includes(scene.subject_presence)
    ? scene.subject_presence : "none";
  const kindMatches = referenceKind === "auto"
    ? subjectPresence !== "none"
    : referenceKind === "character"
      ? ["character", "both"].includes(subjectPresence)
      : referenceKind === "product"
        ? ["product", "both"].includes(subjectPresence)
        : false;
  const useReference = hasReference && referenceKind !== "none" && kindMatches && asBoolean(scene.use_reference);
  const rawDescPrompt = String(scene.desc_prompt || scene.image_prompt || scene.visual || "");
  const normalized = {
    index: index + 1,
    narration: String(scene.narration || ""),
    caption_segments: normalizeCaptionSegments(scene.narration, scene.caption_segments),
    visual: String(scene.visual || scene.desc_prompt || ""),
    desc_prompt: rawDescPrompt,
    desc_prompt_original: "",
    image_prompt: "",
    use_reference: useReference,
    reference_reason: hasReference
      ? String(scene.reference_reason || (useReference ? "本镜出现需要保持一致的主体" : "本镜不需要参考图"))
      : task.character_consistency_mode === "auto" ? "任务将自动生成人物九宫格参考图" : "任务未上传参考图",
    subject_presence: subjectPresence,
    era_and_location: String(scene.era_and_location || ""),
    duration_hint: Number(scene.duration_hint) || Math.max(3, Math.min(12, String(scene.narration || "").length / 4.2)),
    speaker_role: scene.speaker_role === "B" ? "B" : "A",
    speaker_name: String(scene.speaker_name || ""),
    speaker_id: String(scene.speaker_id || "")
  };
  const templatedPrompt = applyImagePromptTemplate({ scene: normalized, metadata, template, ratio: task.ratio, modules });
  normalized.image_prompt = templatedPrompt;
  normalized.image_prompt_original = "";
  normalized.image_prompt_safety_adjusted = false;
  normalized.image_prompt_safety_reasons = [];
  return normalized;
}

function buildRewriteUserPrompt(task, template) {
  return `内容类型：${task.track}\n视频形态：${task.task_type === "podcast" ? "双人播客" : "单人旁白"}\n处理模式：${normalizeProcessingMode(task.processing_mode)}\n改写强度：${task.rewrite_intensity || "standard"}\n叙事视角：${task.narrative_pov || "original"}\n目标字数：${task.target_length || "跟随原文"}\n推广内容：${task.keep_promotion ? "保留" : "删除"}\n\n请严格执行 system 中的赛道专用规则。\n\n原始文案：\n${task.input_text}`;
}

function buildMetadataUserPrompt(task, template, content, characterMode, referenceKind) {
  return `内容类型：${task.track}\n主角档案模式：${characterMode}（follow=跟随赛道，force=强制提取，skip=强制跳过）\n本赛道是否需要主角档案：${template.needs_character_card ? "是" : "否"}\n参考图类型：${referenceKind}\n是否已有可用参考图：${taskReferenceAvailable(task, referenceKind) ? "是" : "否"}\n\n请严格执行 system 中的封面、发布与视觉元数据规则，并同时完整填写 publish 与视觉元数据字段。\n\n工作标题：${content.title}\n工作摘要：${content.summary}\n旁白：\n${content.narration}`;
}

function buildSceneUserPrompt(task, template, content, metadata, modules, seedPools, referenceKind) {
  const referenceRule = template.reference_decision_prompt || "只有镜头中清晰出现主角/产品且保持身份外观一致有价值时，use_reference 才能为 true；环境、空镜、器物特写和资料画面设为 false。";
  const styleConfig = task.style_config || resolveVisualStyle(task.style);
  return `内容类型：${task.track}
视频形态：${task.task_type === "podcast" ? "双人播客；每个镜头必须输出 speaker_role(A/B)" : "单人旁白"}
目标分镜数：${task.target_scenes || `由大模型按自然语义决定，整体节奏约每分钟 ${TARGET_SCENES_PER_MINUTE} 镜（默认语速下通常约 ${AUTO_SCENE_TARGET_MIN_CHARS}～${AUTO_SCENE_TARGET_MAX_CHARS} 字/镜）`}
画面比例：${task.ratio}
当前画面风格：${styleConfig.name}（${styleConfig.id}）
风格前缀：${styleConfig.prefix}
风格后缀：${styleConfig.suffix}
允许使用色彩词：${styleConfig.allow_color ? "true" : "false"}
重要：本次用户选择的“当前画面风格”拥有最高优先级。system 模板中关于“默认油画/默认黑白/默认电影”等说明只属于赛道示例，不得覆盖本次选择。
重要：desc_prompt 只输出场景内容，不要写任何画风名称、风格前缀、风格后缀或 negative_prompt；程序会在生图请求阶段统一拼接并校验。
参考图类型：${referenceKind}
是否已有可用参考图：${taskReferenceAvailable(task, referenceKind) ? "是" : "否"}
参考图判断标准：${referenceRule}
分镜骨架模块：${JSON.stringify(modules)}
图片种子池：${JSON.stringify(seedPools)}

图片合规硬规则：
涉及医疗救治、受伤、暴力或死亡的旁白，只能使用克制的替代画面。优先表现包扎后的状态、人物神情、环境、器械、布帘遮挡、中景或远景，不得描述开放性创口、流体细节、缝合过程、尸体细节或极近景微距。

请严格执行 system 中的赛道分镜规则，最终输出格式只遵守 system 统一 scenes JSON 协议。

元数据：
${JSON.stringify(metadata, null, 2)}

必须完整覆盖的旁白：
${content.narration}`;
}


const SEMI_AUTO_SCENE_GROUP_PROMPT = `你是专业的短视频分镜导演。当前是“半自动锁定原文”模式：原文一个字都不能修改。

程序已经把原文拆成带编号的连续原文单元。你只负责判断哪些相邻编号应合并为同一个分镜。

核心节奏标准：
- 整体控制在每分钟约 5 个分镜，每个镜头通常承载约 10～14 秒旁白。
- 默认语速下，每镜通常约 40～55 个中文字符；字数只用于辅助判断，不能机械截断。
- 同一时间、地点、人物动作和情绪中的短单元应主动合并。
- 只有明确的时间跳转、地点切换、主体改变、关键动作或强情绪转折时，才提前切镜。
- 不要生成十几二十字的碎片镜头，也不要把两个明显不同的画面强行合并。

只返回合法 JSON，不要输出 Markdown，也不要返回任何原文文字。JSON 结构：
{
  "groups": [
    {"unit_ids": [1, 2]},
    {"unit_ids": [3, 4, 5]}
  ]
}

硬规则：
1. 只能返回编号，不得返回 narration、text、visual、desc_prompt 或任何原文文字。
2. 所有编号必须按原顺序出现，且每个编号必须恰好使用一次，不能遗漏、重复、倒序或跳号。
3. 每一组只能包含连续编号；不得把不相邻的编号放入同一组。
4. 未明确指定数量时，根据整体时长和自然语义决定分镜数，整体尽量接近每分钟 5 镜。
5. 用户明确指定分镜数时，groups 数量必须严格等于指定数量。`;

const SCENE_PLAN_PROMPT = `你是专业的短视频分镜导演。请直接根据完整旁白的叙事推进、时间变化、地点变化、人物动作和情绪转折来划分镜头，不要机械按字数截断。

核心节奏标准：
- 整体控制在每分钟约 5 个分镜，也就是每个镜头通常承载约 10～14 秒旁白。
- 默认语速下，每镜通常约 40～55 个中文字符；中文标点计入字符数，空格和换行不计。
- “每分钟约 5 镜”是整体节奏目标，字数只用于辅助判断，不能机械每到固定字数就截断。
- 短句如果与前后处于同一时间、地点、人物动作或情绪，应主动合并，不能单独切成只有十几二十字的碎片镜头。
- 只有发生明确的时间跳转、地点切换、主体改变、关键动作或强情绪转折时，才允许提前切镜。
- 不要为了满足预估镜头数破坏完整语义；也不要把两个明显不同的画面硬塞进同一镜头。

只返回合法 JSON，不要输出 Markdown。JSON 结构：
{
  "scenes": [
    {"index": 1, "narration": "本镜完整旁白"}
  ]
}

硬规则：
1. narration 必须从原旁白按原顺序连续切分，完整覆盖原文，不得改写、漏字、添字、重复或改变标点。
2. 优先在句号、问号、感叹号、分号、破折号后的完整语义处，或明确的时间/地点/动作转换处切镜。
3. 不得从姓名、日期、数字单位、固定短语、主谓宾结构、转折关系或因果关系中间切断。
4. 未明确指定数量时，由你根据完整旁白预计时长和自然语义决定数量，整体尽量接近每分钟 5 镜。
5. 除首尾镜头或真正独立的强转场外，非末尾镜头通常不得少于约 32 个中文字符。
6. 不要返回 visual、desc_prompt、caption_segments 等其他字段。`;

const SCENE_BATCH_SIZE = 5;
const TARGET_SCENES_PER_MINUTE = 5;
const BASE_CHINESE_CHARS_PER_MINUTE = 230;
const AUTO_SCENE_TARGET_MIN_CHARS = 40;
const AUTO_SCENE_TARGET_MAX_CHARS = 55;
const AUTO_SCENE_TARGET_CHARS = 46;

function countSceneCharacters(text) {
  // 中文标点保留并计数，只忽略空格、制表符和换行。
  return Array.from(String(text || "").replace(/\s+/gu, "")).length;
}

function normalizeTtsSpeed(value) {
  const speed = Number(value || 1);
  return Number.isFinite(speed) ? Math.max(0.75, Math.min(1.5, speed)) : 1;
}

function estimateNarrationDurationSeconds(text, ttsSpeed = 1) {
  const characterCount = countSceneCharacters(text);
  if (!characterCount) return 0;
  return characterCount / (BASE_CHINESE_CHARS_PER_MINUTE * normalizeTtsSpeed(ttsSpeed)) * 60;
}

function inferAutoSceneCount(text, ttsSpeed = 1) {
  const durationSeconds = estimateNarrationDurationSeconds(text, ttsSpeed);
  if (!durationSeconds) return 1;
  // 核心标准：每分钟约 5 个镜头。按预计口播时长换算，而不是先机械切字。
  return Math.max(1, Math.round(durationSeconds / 60 * TARGET_SCENES_PER_MINUTE));
}

function splitNarrationAtNaturalPoint(text) {
  const source = String(text || "").trim();
  if (source.length < 2) return [source];
  const midpoint = Math.floor(source.length / 2);
  const candidates = [];
  for (let index = 1; index < source.length - 1; index += 1) {
    if (/[，、：:,；;。！？!?\s]/u.test(source[index])) candidates.push(index + 1);
  }
  let splitIndex = candidates
    .filter(index => index >= 4 && source.length - index >= 4)
    .sort((left, right) => Math.abs(left - midpoint) - Math.abs(right - midpoint))[0];
  if (!splitIndex) splitIndex = Math.max(1, Math.min(source.length - 1, midpoint));
  return [source.slice(0, splitIndex).trim(), source.slice(splitIndex).trim()].filter(Boolean);
}

function groupNarrationParts(parts, targetCount) {
  const source = parts.map(item => String(item || "").trim()).filter(Boolean);
  if (!source.length) return [];
  const target = Math.max(1, Math.min(Number(targetCount || source.length), source.length));
  if (target >= source.length) return source;

  const groups = [];
  let cursor = 0;
  let remainingLength = source.reduce((sum, item) => sum + item.length, 0);
  for (let groupIndex = 0; groupIndex < target; groupIndex += 1) {
    const groupsLeft = target - groupIndex;
    if (groupsLeft === 1) {
      groups.push(source.slice(cursor).join(""));
      break;
    }

    const desiredLength = remainingLength / groupsLeft;
    const selected = [];
    let selectedLength = 0;
    while (cursor < source.length) {
      const item = source[cursor];
      const mustLeave = groupsLeft - 1;
      if (selected.length && source.length - cursor <= mustLeave) break;
      const nextLength = selectedLength + item.length;
      if (selected.length && nextLength > desiredLength) break;
      selected.push(item);
      selectedLength = nextLength;
      cursor += 1;
    }
    if (!selected.length) {
      selected.push(source[cursor]);
      selectedLength = source[cursor].length;
      cursor += 1;
    }
    groups.push(selected.join(""));
    remainingLength -= selectedLength;
  }
  return groups.filter(Boolean);
}

function splitNarrationForScenePlan(narration, requestedCount = 0, ttsSpeed = 1) {
  const source = String(narration || "").trim();
  if (!source) return [];
  let parts = (source.match(/[^。！？!?；;\n]+[。！？!?；;]?/gu) || [source])
    .map(item => item.trim())
    .filter(Boolean);
  const inferredCount = inferAutoSceneCount(source, ttsSpeed);
  const targetCount = Math.max(1, Number(requestedCount || inferredCount));

  while (parts.length < targetCount) {
    let longestIndex = -1;
    let longestLength = 0;
    parts.forEach((item, index) => {
      if (item.length > longestLength && item.length >= 8) {
        longestIndex = index;
        longestLength = item.length;
      }
    });
    if (longestIndex < 0) break;
    const split = splitNarrationAtNaturalPoint(parts[longestIndex]);
    if (split.length < 2 || split.some(item => !item)) break;
    parts.splice(longestIndex, 1, ...split);
  }

  return parts.length > targetCount
    ? groupNarrationParts(parts, targetCount)
    : parts;
}

function buildSceneNarrationAssignments(task, narration) {
  if (task.task_type === "podcast") {
    const lines = String(narration || "")
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean);
    return lines.map((line, index) => {
      const parsed = podcastSpeakerRoleLine(line);
      return {
        index: index + 1,
        narration: parsed?.text || line,
        speaker_role: parsed?.role || (index % 2 ? "B" : "A")
      };
    });
  }

  return splitNarrationForScenePlan(narration, task.target_scenes, task.tts_speed).map((item, index) => ({
    index: index + 1,
    narration: item
  }));
}


function splitNarrationIntoAtomicUnits(value) {
  const source = String(value || "");
  if (!source) return [];

  // 先在中文自然停顿符号后切成最小原文片段。每一段都保留原始标点和空白，
  // 后续只允许按编号合并，因此最终旁白一定能逐字还原。
  const rawParts = [];
  let startOffset = 0;
  let sourceOffset = 0;
  const characters = Array.from(source);
  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index];
    sourceOffset += character.length;
    const isBoundary = /[。！？!?；;，,、：:—…\n]/u.test(character);
    if (!isBoundary) continue;

    // 连续破折号/省略号视为同一个停顿；句末标点后的引号、括号及紧邻空白归入前一单元。
    let lookahead = index + 1;
    while (lookahead < characters.length && character === characters[lookahead] && /[—…]/u.test(character)) {
      sourceOffset += characters[lookahead].length;
      index = lookahead;
      lookahead += 1;
    }
    while (lookahead < characters.length && /[”’"'）)\]】}》〉」』]/u.test(characters[lookahead])) {
      sourceOffset += characters[lookahead].length;
      index = lookahead;
      lookahead += 1;
    }
    while (lookahead < characters.length && /[ \t\r\n]/u.test(characters[lookahead])) {
      sourceOffset += characters[lookahead].length;
      index = lookahead;
      lookahead += 1;
    }
    if (sourceOffset > startOffset) {
      rawParts.push(source.slice(startOffset, sourceOffset));
      startOffset = sourceOffset;
    }
  }
  if (startOffset < source.length) rawParts.push(source.slice(startOffset));
  if (!rawParts.length) rawParts.push(source);

  // 保留这些自然停顿片段作为最小编号单元，不在程序端预先决定镜头边界。
  // 只有单个片段自身超过 68 字时，才按原始字符位置拆成更小编号单元，
  // Claude 可以继续把相邻编号重新合并，原文仍然逐字不变。
  const units = [];
  for (const part of rawParts) {
    if (countSceneCharacters(part) <= 68) {
      units.push(part);
      continue;
    }
    const charactersInPart = Array.from(part);
    let cursor = 0;
    while (cursor < charactersInPart.length) {
      const remaining = charactersInPart.length - cursor;
      if (remaining <= 68) {
        units.push(charactersInPart.slice(cursor).join(""));
        break;
      }
      const targetEnd = Math.min(charactersInPart.length, cursor + 46);
      let splitEnd = targetEnd;
      for (let probe = targetEnd; probe > cursor + 30; probe -= 1) {
        if (/[，,、：:；;。！？!?—…\s]/u.test(charactersInPart[probe - 1])) {
          splitEnd = probe;
          break;
        }
      }
      units.push(charactersInPart.slice(cursor, splitEnd).join(""));
      cursor = splitEnd;
    }
  }

  const result = units.map((unit, index) => ({
    id: index + 1,
    text: unit,
    characters: countSceneCharacters(unit)
  }));
  if (result.map(item => item.text).join("") !== source) {
    throw new Error("半自动原文单元切分未能逐字还原输入文案");
  }
  return result;
}

function extractSemiAutoSceneGroups(payload) {
  const rawGroups = Array.isArray(payload?.groups) ? payload.groups : [];
  if (!rawGroups.length) throw new Error("半自动分镜阶段没有返回 groups 数组");
  return rawGroups.map((group, index) => {
    const values = Array.isArray(group)
      ? group
      : Array.isArray(group?.unit_ids)
        ? group.unit_ids
        : Array.isArray(group?.ids)
          ? group.ids
          : Array.isArray(group?.units)
            ? group.units
            : [];
    const ids = values.map(value => Number(value)).filter(Number.isInteger);
    if (!ids.length) throw new Error(`半自动第 ${index + 1} 个分镜组没有有效编号`);
    return ids;
  });
}

function validateSemiAutoSceneGroups(payload, units, task, narration, requestedCount = 0) {
  const groups = extractSemiAutoSceneGroups(payload);
  if (Number(requestedCount) > 0 && groups.length !== Number(requestedCount)) {
    throw new Error(`半自动分镜数量不正确：期望 ${Number(requestedCount)}，实际 ${groups.length}`);
  }

  const flattened = groups.flat();
  const expected = units.map(item => item.id);
  if (flattened.length !== expected.length || flattened.some((id, index) => id !== expected[index])) {
    throw new Error("半自动分镜编号必须从 1 开始按顺序完整覆盖，每个编号只能使用一次");
  }
  groups.forEach((ids, groupIndex) => {
    for (let index = 1; index < ids.length; index += 1) {
      if (ids[index] !== ids[index - 1] + 1) {
        throw new Error(`半自动第 ${groupIndex + 1} 个分镜包含不连续编号`);
      }
    }
  });

  const unitById = new Map(units.map(item => [item.id, item]));
  const assignments = groups.map((ids, index) => ({
    index: index + 1,
    narration: ids.map(id => unitById.get(id)?.text || "").join(""),
    source_unit_ids: ids
  }));
  const joined = assignments.map(item => item.narration).join("");
  if (joined !== String(narration || "")) {
    throw new Error("半自动分镜组合未能逐字完整覆盖原旁白");
  }
  validateSceneAssignmentDensity(assignments, task, narration, requestedCount);
  return assignments;
}

async function resolveSemiAutoSceneNarrationAssignments({ config, task, content, debugDir, modelIdentity }) {
  const narration = String(content.narration || "");
  const units = splitNarrationIntoAtomicUnits(narration);
  if (!units.length) throw new Error("半自动模式没有可用于分镜的原文单元");

  const manualCount = Number(task.target_scenes || 0) > 0 ? Math.max(1, Number(task.target_scenes)) : 0;
  if (manualCount > units.length) {
    throw new Error(`手动分镜数 ${manualCount} 超过可用原文单元数 ${units.length}，请减少目标分镜数或增加自然标点`);
  }
  const estimatedCount = inferAutoSceneCount(narration, task.tts_speed);
  const estimatedDurationSeconds = estimateNarrationDurationSeconds(narration, task.tts_speed);
  const input = {
    version: 2,
    model: modelIdentity,
    mode: "semi-auto-locked-source-unit-groups",
    narration,
    units,
    manual_count: manualCount,
    estimated_count: estimatedCount,
    estimated_duration_seconds: Math.round(estimatedDurationSeconds),
    target_scenes_per_minute: TARGET_SCENES_PER_MINUTE,
    tts_speed: normalizeTtsSpeed(task.tts_speed)
  };
  const cached = readStageCache(debugDir, "03-scenes-plan-semi", input);
  if (cached) {
    try { return validateSemiAutoSceneGroups(cached, units, task, narration, manualCount); }
    catch (error) { writeDebug(debugDir, "03-scenes-plan-semi-cache-invalid.json", { message: error.message }); }
  }

  const unitsForPrompt = units.map(item => ({
    id: item.id,
    characters: item.characters,
    text: item.text
  }));
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const countInstruction = manualCount
      ? `用户明确指定分镜数：${manualCount}。groups 数量必须严格等于 ${manualCount}。`
      : `预计旁白约 ${Math.round(estimatedDurationSeconds)} 秒，整体目标约每分钟 5 镜，参考数量约 ${estimatedCount} 镜。请根据语义合并相邻编号。`;
    const correction = attempt === 1 || !lastError
      ? ""
      : `\n\n上一次编号分组未通过校验，原因：${lastError.message || String(lastError)}\n请只修正编号分组，不要返回任何文字。`;

    try {
      const payload = await callModelJson(config, {
        stage: attempt === 1 ? "03-scenes-plan-semi" : `03-scenes-plan-semi-retry-${attempt}`,
        system: SEMI_AUTO_SCENE_GROUP_PROMPT,
        user: `${countInstruction}\n\n以下是按原顺序排列的原文单元。只返回 groups 和 unit_ids：\n${JSON.stringify(unitsForPrompt, null, 2)}${correction}`,
        temperature: 0.1,
        debugDir,
        maxTokens: Math.max(1024, Math.min(4096, units.length * 40 + estimatedCount * 40))
      });
      const assignments = validateSemiAutoSceneGroups(payload, units, task, narration, manualCount);
      const result = { groups: assignments.map(item => ({ unit_ids: item.source_unit_ids })) };
      writeStageCache(debugDir, "03-scenes-plan-semi", input, result);
      return assignments;
    } catch (error) {
      lastError = error;
      writeDebug(debugDir, `03-scenes-plan-semi-attempt-${attempt}-invalid.json`, {
        message: error?.message || String(error),
        manual_count: manualCount,
        estimated_count: estimatedCount,
        unit_count: units.length
      });
    }
  }
  throw new Error(`半自动分镜编号连续两次未通过校验：${lastError?.message || String(lastError || "未知错误")}`);
}



function semanticSceneText(value) {
  return Array.from(String(value || ""))
    .filter(character => /[\p{L}\p{N}]/u.test(character))
    .join("");
}

function buildSceneSourceMaps(value) {
  const source = String(value || "").trim();
  let semantic = "";
  let sourceOffset = 0;
  const semanticEndOffsets = [];
  const naturalBoundaries = [];
  for (const character of Array.from(source)) {
    sourceOffset += character.length;
    if (/[\p{L}\p{N}]/u.test(character)) {
      semantic += character;
      semanticEndOffsets.push(sourceOffset);
    }
    if (/[。！？!?；;]/u.test(character)) {
      naturalBoundaries.push({ semanticIndex: semantic.length, sourceOffset, strength: 3 });
    } else if (/[，,、：:—…]/u.test(character)) {
      naturalBoundaries.push({ semanticIndex: semantic.length, sourceOffset, strength: 1 });
    } else if (/\n/u.test(character)) {
      naturalBoundaries.push({ semanticIndex: semantic.length, sourceOffset, strength: 2 });
    }
  }
  return { source, semantic, semanticEndOffsets, naturalBoundaries };
}

function extendSceneBoundary(source, sourceOffset) {
  let offset = Math.max(0, Math.min(source.length, Number(sourceOffset || 0)));
  while (offset < source.length && /[\s，。！？；：、,.!?;:…—–\-”“‘’"'）)\]】}》〉」』]/u.test(source[offset])) {
    offset += 1;
  }
  return offset;
}

function findClaudeSuffixBoundary(sourceSemantic, returnedSemantic, expectedEnd, minimumEnd, maximumEnd) {
  const maxNeedleLength = Math.min(18, returnedSemantic.length);
  for (let needleLength = maxNeedleLength; needleLength >= 6; needleLength -= 1) {
    const needle = returnedSemantic.slice(-needleLength);
    if (!needle) continue;
    const matches = [];
    let searchFrom = Math.max(0, minimumEnd - needleLength);
    while (searchFrom < sourceSemantic.length) {
      const found = sourceSemantic.indexOf(needle, searchFrom);
      if (found < 0) break;
      const end = found + needleLength;
      if (end > minimumEnd && end <= maximumEnd) matches.push(end);
      searchFrom = found + 1;
    }
    if (matches.length) {
      return matches.sort((left, right) => Math.abs(left - expectedEnd) - Math.abs(right - expectedEnd))[0];
    }
  }
  return 0;
}

function chooseNaturalSceneBoundary(maps, expectedEnd, minimumEnd, maximumEnd) {
  const candidates = maps.naturalBoundaries
    .filter(item => item.semanticIndex > minimumEnd && item.semanticIndex <= maximumEnd)
    .map(item => ({
      ...item,
      score: Math.abs(item.semanticIndex - expectedEnd) - item.strength * 1.5
    }))
    .sort((left, right) => left.score - right.score);
  if (candidates.length) return candidates[0].semanticIndex;
  return Math.max(minimumEnd + 1, Math.min(maximumEnd, expectedEnd));
}

function reconstructExactSceneAssignments(rawScenes, task, narration) {
  const maps = buildSceneSourceMaps(narration);
  if (!maps.source || !maps.semantic) throw new Error("原旁白为空，无法恢复分镜边界");
  const returnedTexts = rawScenes.map(scene => String(scene?.narration || "").trim());
  const returnedSemantic = returnedTexts.map(semanticSceneText);
  const returnedTotal = returnedSemantic.reduce((sum, item) => sum + item.length, 0);
  if (!returnedTotal) throw new Error("Claude 分镜没有可用于恢复边界的文本");

  const sceneCount = returnedTexts.length;
  const boundaries = [];
  let cumulativeReturned = 0;
  let previousSemanticEnd = 0;
  let previousSourceOffset = 0;

  for (let index = 0; index < sceneCount - 1; index += 1) {
    cumulativeReturned += returnedSemantic[index].length;
    const remainingScenes = sceneCount - index - 1;
    const expectedEnd = Math.round(cumulativeReturned / returnedTotal * maps.semantic.length);
    const minimumEnd = previousSemanticEnd;
    const maximumEnd = Math.max(minimumEnd + 1, maps.semantic.length - remainingScenes);
    const suffixEnd = findClaudeSuffixBoundary(
      maps.semantic,
      returnedSemantic[index],
      expectedEnd,
      minimumEnd,
      maximumEnd
    );
    const semanticEnd = suffixEnd || chooseNaturalSceneBoundary(maps, expectedEnd, minimumEnd, maximumEnd);
    const mappedOffset = maps.semanticEndOffsets[Math.max(0, semanticEnd - 1)] || previousSourceOffset + 1;
    let sourceOffset = extendSceneBoundary(maps.source, mappedOffset);
    if (sourceOffset <= previousSourceOffset || sourceOffset >= maps.source.length) {
      sourceOffset = Math.max(previousSourceOffset + 1, Math.min(maps.source.length - 1, mappedOffset));
    }
    boundaries.push(sourceOffset);
    previousSemanticEnd = semanticEnd;
    previousSourceOffset = sourceOffset;
  }

  const assignments = [];
  let startOffset = 0;
  for (let index = 0; index < sceneCount; index += 1) {
    const endOffset = index < boundaries.length ? boundaries[index] : maps.source.length;
    const exactNarration = maps.source.slice(startOffset, endOffset).trim();
    if (!exactNarration) throw new Error(`恢复第 ${index + 1} 个分镜时得到空旁白`);
    assignments.push({
      index: index + 1,
      narration: exactNarration,
      ...(task.task_type === "podcast" ? { speaker_role: rawScenes[index]?.speaker_role === "B" ? "B" : "A" } : {})
    });
    startOffset = endOffset;
  }
  return assignments;
}

function validateSceneNarrationAssignments(payload, task, narration, requestedCount = 0) {
  const rawScenes = Array.isArray(payload?.scenes) ? payload.scenes : [];
  if (!rawScenes.length) throw new Error("分镜切分阶段没有返回 scenes 数组");
  let assignments = rawScenes.map((scene, index) => ({
    index: index + 1,
    narration: String(scene?.narration || "").trim(),
    ...(task.task_type === "podcast" ? { speaker_role: scene?.speaker_role === "B" ? "B" : "A" } : {})
  }));
  if (assignments.some(item => !item.narration)) throw new Error("分镜切分结果存在空旁白");
  if (Number(requestedCount) > 0 && task.task_type !== "podcast" && assignments.length !== Number(requestedCount)) {
    throw new Error(`分镜切分数量不正确：期望 ${Number(requestedCount)}，实际 ${assignments.length}`);
  }
  const compact = value => String(value || "").replace(/\s+/gu, "");
  let joined = assignments.map(item => item.narration).join(task.task_type === "podcast" ? "\n" : "");
  if (compact(joined) !== compact(narration) && task.task_type !== "podcast") {
    // Claude 负责决定镜头数量和语义边界；程序再从原旁白按这些边界恢复原文，
    // 避免模型仅改变引号、标点或个别措辞就让整项任务失败。
    assignments = reconstructExactSceneAssignments(rawScenes, task, narration);
    joined = assignments.map(item => item.narration).join("");
  }
  if (compact(joined) !== compact(narration)) {
    throw new Error("无法根据 Claude 分镜边界恢复完整原旁白");
  }

  validateSceneAssignmentDensity(assignments, task, narration, requestedCount);
  return assignments;
}

function validateSceneAssignmentDensity(assignments, task, narration, requestedCount = 0) {
  // 自动数量模式按“每分钟约 5 镜”校验整体节奏，同时拦截十几二十字的碎片镜头。
  if (Number(requestedCount) || task.task_type === "podcast") return assignments;
  const lengths = assignments.map(item => countSceneCharacters(item.narration));
  const nonFinal = lengths.slice(0, -1);
  const tooShort = nonFinal.filter(length => length < 32);
  const tooLong = lengths.filter(length => length > 72);
  const outsidePreferred = lengths.filter(length => length < 38 || length > 60);
  const totalCharacters = lengths.reduce((sum, length) => sum + length, 0);
  const average = totalCharacters / Math.max(1, lengths.length);
  const durationSeconds = estimateNarrationDurationSeconds(narration, task.tts_speed);
  const estimatedCount = inferAutoSceneCount(narration, task.tts_speed);
  const tolerance = Math.max(2, Math.ceil(estimatedCount * 0.2));
  const scenesPerMinute = durationSeconds > 0 ? assignments.length / (durationSeconds / 60) : TARGET_SCENES_PER_MINUTE;

  if (tooShort.length) {
    throw new Error(`分镜过于碎片化：存在 ${tooShort.length} 个非末尾镜头少于 32 字，请与前后同场景内容合并`);
  }
  if (tooLong.length) {
    throw new Error(`分镜过长：存在 ${tooLong.length} 个镜头超过 72 字，请在自然语义或画面转折处切分`);
  }
  if (outsidePreferred.length > Math.max(2, Math.floor(assignments.length * 0.3))) {
    throw new Error(`分镜时长分布不稳定：${outsidePreferred.length}/${assignments.length} 个镜头不在约 38～60 字范围`);
  }
  if (assignments.length > 2 && (average < 38 || average > 60)) {
    throw new Error(`分镜平均长度不合理：当前平均 ${average.toFixed(1)} 字，应让整体接近每分钟 5 镜`);
  }
  if (estimatedCount >= 4 && Math.abs(assignments.length - estimatedCount) > tolerance) {
    throw new Error(`分镜数量偏离预计时长过多：约 ${Math.round(durationSeconds)} 秒旁白预计 ${estimatedCount} 镜，实际 ${assignments.length} 镜`);
  }
  if (durationSeconds >= 45 && (scenesPerMinute < 3.8 || scenesPerMinute > 6.2)) {
    throw new Error(`分镜节奏不合理：当前约每分钟 ${scenesPerMinute.toFixed(1)} 镜，目标约每分钟 5 镜`);
  }
  return assignments;
}

async function resolveSceneNarrationAssignments({ config, task, content, debugDir, modelIdentity }) {
  if (task.task_type === "podcast") return buildSceneNarrationAssignments(task, content.narration);
  if (normalizeProcessingMode(task.processing_mode) === "semi_auto") {
    return resolveSemiAutoSceneNarrationAssignments({ config, task, content, debugDir, modelIdentity });
  }

  const manualCount = Number(task.target_scenes || 0) > 0 ? Math.max(1, Number(task.target_scenes)) : 0;
  const estimatedCount = inferAutoSceneCount(content.narration, task.tts_speed);
  const estimatedDurationSeconds = estimateNarrationDurationSeconds(content.narration, task.tts_speed);
  const input = {
    version: 6,
    model: modelIdentity,
    narration: content.narration,
    manual_count: manualCount,
    estimated_count: estimatedCount,
    estimated_duration_seconds: Math.round(estimatedDurationSeconds),
    target_scenes_per_minute: TARGET_SCENES_PER_MINUTE,
    tts_speed: normalizeTtsSpeed(task.tts_speed),
    density: "about-5-scenes-per-minute-source-reconstruction",
    task_type: task.task_type
  };
  const cached = readStageCache(debugDir, "03-scenes-plan", input);
  if (cached) {
    try { return validateSceneNarrationAssignments(cached, task, content.narration, manualCount); }
    catch (error) { writeDebug(debugDir, "03-scenes-plan-cache-invalid.json", { message: error.message }); }
  }

  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const countInstruction = manualCount
      ? `用户明确指定镜头数：${manualCount}。必须严格返回 ${manualCount} 个镜头。`
      : `没有指定固定镜头数。按当前语速预计旁白约 ${Math.round(estimatedDurationSeconds)} 秒，整体目标约每分钟 5 镜，参考数量约 ${estimatedCount} 镜。请以自然语义和真实画面变化为主，但不要生成十几二十字的碎片镜头。`;
    const correction = attempt === 1 || !lastError
      ? ""
      : `\n\n上一次结果未通过校验，原因：${lastError.message || String(lastError)}\n请重新划分镜头，重点合并过短镜头。镜头边界确定后，程序会自动从原旁白恢复逐字内容。`;

    try {
      const payload = await callModelJson(config, {
        stage: attempt === 1 ? "03-scenes-plan" : `03-scenes-plan-retry-${attempt}`,
        system: SCENE_PLAN_PROMPT,
        user: `${countInstruction}\n\n必须完整覆盖的原旁白：\n${content.narration}${correction}`,
        temperature: 0.1,
        debugDir,
        maxTokens: Math.max(2048, Math.min(8192, estimatedCount * 280))
      });
      const assignments = validateSceneNarrationAssignments(payload, task, content.narration, manualCount);
      const result = { scenes: assignments };
      writeStageCache(debugDir, "03-scenes-plan", input, result);
      return assignments;
    } catch (error) {
      lastError = error;
      writeDebug(debugDir, `03-scenes-plan-attempt-${attempt}-invalid.json`, {
        message: error?.message || String(error),
        manual_count: manualCount,
        estimated_count: estimatedCount,
        estimated_duration_seconds: Math.round(estimatedDurationSeconds)
      });
    }
  }

  // 不再静默退回本地机械切分。Claude 分镜不合格时明确报错，避免生成大量碎片镜头。
  throw new Error(`Claude 分镜结果连续两次未通过校验：${lastError?.message || String(lastError || "未知错误")}`);
}

function buildSceneBatchUserPrompt(task, template, content, metadata, modules, seedPools, referenceKind, assignments, batchNumber, batchTotal) {
  const batchTask = { ...task, target_scenes: assignments.length };
  const batchNarration = assignments.map(item => item.narration).join(task.task_type === "podcast" ? "\n" : "");
  const basePrompt = buildSceneUserPrompt(
    batchTask,
    template,
    { ...content, narration: batchNarration },
    metadata,
    modules,
    seedPools,
    referenceKind
  );
  const fixedScenes = assignments.map(item => ({
    index: item.index,
    narration: item.narration,
    ...(task.task_type === "podcast" ? { speaker_role: item.speaker_role } : {})
  }));
  return `${basePrompt}

这是第 ${batchNumber}/${batchTotal} 批。本批只处理下面固定镜头清单：
${JSON.stringify(fixedScenes, null, 2)}

强制规则：
1. 必须恰好返回 ${assignments.length} 个 scenes，不得增加、删除、合并或拆分。
2. 每个 scene.index 必须与固定清单一致。
3. narration 必须逐字复制固定清单中的 narration，不得改写、删字或补字。
4. 你只负责补充 visual、desc_prompt、use_reference、reference_reason、subject_presence、era_and_location、duration_hint；双人播客还要保留 speaker_role。
5. 不要输出 caption_segments。`;
}

function alignSceneBatchPayload(payload, assignments, task) {
  const scenes = Array.isArray(payload?.scenes) ? payload.scenes : [];
  if (!scenes.length) throw new Error("本批分镜没有返回 scenes 数组");
  const byIndex = new Map();
  scenes.forEach(scene => {
    const index = Number(scene?.index);
    if (Number.isInteger(index) && !byIndex.has(index)) byIndex.set(index, scene);
  });

  return assignments.map((assignment, position) => {
    const scene = byIndex.get(assignment.index) || scenes[position];
    if (!scene || typeof scene !== "object") {
      throw new Error(`本批缺少第 ${assignment.index} 个镜头`);
    }
    const aligned = {
      ...scene,
      index: assignment.index,
      narration: assignment.narration,
      ...(task.task_type === "podcast" ? { speaker_role: assignment.speaker_role } : {})
    };
    delete aligned.caption_segments;
    return aligned;
  });
}

async function generateSceneBatch({ config, task, template, content, metadata, modules, seedPools, referenceKind, assignments, batchNumber, batchTotal, debugDir, modelIdentity }) {
  const startIndex = assignments[0]?.index || 1;
  const endIndex = assignments[assignments.length - 1]?.index || startIndex;
  const stage = `03-scenes-${String(startIndex).padStart(3, "0")}-${String(endIndex).padStart(3, "0")}`;
  const batchInput = {
    version: 1,
    model: modelIdentity,
    batch_number: batchNumber,
    batch_total: batchTotal,
    assignments,
    ratio: task.ratio,
    style: task.style,
    style_registry_version: task.style_config?.registry_version || "",
    style_prefix: task.style_config?.prefix || "",
    style_suffix: task.style_config?.suffix || "",
    allow_color: task.style_config?.allow_color !== false,
    task_type: task.task_type,
    reference_kind: referenceKind,
    reference_available: taskReferenceAvailable(task, referenceKind),
    reference_decision_prompt: template.reference_decision_prompt || "",
    image_prompt_template: template.image_prompt_template || "",
    modules,
    seed_pools: seedPools,
    metadata,
    template_prompt: template.step3_system_prompt || ""
  };

  const cached = readStageCache(debugDir, stage, batchInput);
  if (cached) return alignSceneBatchPayload(cached, assignments, task);

  try {
    const payload = await callModelJson(config, {
      stage,
      system: `${SCENE_BASE_PROMPT}\n\n赛道专用要求：\n${template.step3_system_prompt || ""}`,
      user: buildSceneBatchUserPrompt(
        task,
        template,
        content,
        metadata,
        modules,
        seedPools,
        referenceKind,
        assignments,
        batchNumber,
        batchTotal
      ),
      temperature: 0.25,
      debugDir,
      maxTokens: Math.max(2048, Math.min(8192, assignments.length * 1400))
    });
    const aligned = alignSceneBatchPayload(payload, assignments, task);
    writeStageCache(debugDir, stage, batchInput, { scenes: aligned });
    return aligned;
  } catch (error) {
    writeDebug(debugDir, `${stage}-batch-error.json`, {
      message: error?.message || String(error),
      start_index: startIndex,
      end_index: endIndex,
      scene_count: assignments.length
    });
    if (assignments.length <= 1) {
      throw new Error(`${stage}生成失败：${error?.message || error}`);
    }

    const midpoint = Math.ceil(assignments.length / 2);
    writeDebug(debugDir, `${stage}-split-retry.json`, {
      reason: error?.message || String(error),
      split_at: midpoint,
      left: assignments.slice(0, midpoint).map(item => item.index),
      right: assignments.slice(midpoint).map(item => item.index)
    });
    const left = await generateSceneBatch({
      config, task, template, content, metadata, modules, seedPools, referenceKind,
      assignments: assignments.slice(0, midpoint),
      batchNumber,
      batchTotal,
      debugDir,
      modelIdentity
    });
    const right = await generateSceneBatch({
      config, task, template, content, metadata, modules, seedPools, referenceKind,
      assignments: assignments.slice(midpoint),
      batchNumber,
      batchTotal,
      debugDir,
      modelIdentity
    });
    return [...left, ...right];
  }
}

async function generateScenesInBatches({ config, task, template, content, metadata, modules, seedPools, referenceKind, assignments, debugDir, modelIdentity }) {
  if (!assignments.length) throw new Error("旁白无法拆分为分镜");
  const batches = [];
  for (let index = 0; index < assignments.length; index += SCENE_BATCH_SIZE) {
    batches.push(assignments.slice(index, index + SCENE_BATCH_SIZE));
  }

  const combined = [];
  for (let index = 0; index < batches.length; index += 1) {
    throwIfCancelled();
    const scenes = await generateSceneBatch({
      config,
      task,
      template,
      content,
      metadata,
      modules,
      seedPools,
      referenceKind,
      assignments: batches[index],
      batchNumber: index + 1,
      batchTotal: batches.length,
      debugDir,
      modelIdentity
    });
    combined.push(...scenes);
  }
  return combined;
}

function llmIdentity(config) {
  const llm = config.llm || {};
  return {
    provider: llm.provider || "",
    protocol: llm.protocol || "",
    base_url: llm.base_url || "",
    model: llm.model || ""
  };
}

function readStageCache(debugDir, stage, input) {
  if (!debugDir) return null;
  const cache = readJsonSafe(path.join(debugDir, `${stage}-checkpoint.json`));
  const expected = fingerprint(input);
  if (!cache || cache.fingerprint !== expected || cache.completed !== true || !cache.result) return null;
  writeDebug(debugDir, `${stage}-reused.json`, {
    reused_at: new Date().toISOString(),
    fingerprint: expected
  });
  return cache.result;
}

function writeStageCache(debugDir, stage, input, result) {
  if (!debugDir) return;
  atomicWriteJson(path.join(debugDir, `${stage}-checkpoint.json`), {
    version: 1,
    stage,
    completed: true,
    completed_at: new Date().toISOString(),
    fingerprint: fingerprint(input),
    result
  });
}

async function planVideoScript({ config, task, outputDir, onStage = () => {} }) {
  throwIfCancelled();
  const template = resolveTemplate(task);
  const mode = normalizeProcessingMode(task.processing_mode);
  const debugDir = outputDir ? path.join(outputDir, "llm-debug") : "";
  const modules = safeJsonArray(template.step3_skeleton_modules_json);
  const seedPools = safeJsonArray(template.image_seed_pools_json);
  const characterMode = resolveCharacterCardMode(template);
  const referenceKind = normalizeReferenceKind(template.reference_kind);

  if (mode === "direct") {
    const result = buildMechanicalScript(task, task.input_text, template);
    writeDebug(debugDir, "00-planner-result.json", result);
    return result;
  }

  if (config.llm?.provider === "local" || config.llm?.protocol === "local") {
    let sourceText = task.input_text;
    if (mode === "auto") {
      if (!task.keep_promotion) sourceText = sourceText.replace(/(?:点击|下单|购买|链接|橱窗|优惠|关注)[^。！？]*[。！？]?/g, "");
      if (task.narrative_pov === "first") sourceText = sourceText.replace(/(?:他|她|主人公|这个人)/g, "我");
      if (task.narrative_pov === "third") sourceText = sourceText.replace(/\b我\b/g, "他");
      if (task.target_length && sourceText.length > Number(task.target_length) * 1.15) sourceText = sourceText.slice(0, Number(task.target_length));
    }
    const result = buildMechanicalScript(task, sourceText, template);
    result.metadata.planner_mode = "local-rules";
    writeDebug(debugDir, "00-planner-result.json", result);
    return result;
  }

  const modelIdentity = llmIdentity(config);
  let content;
  if (mode === "semi_auto") {
    content = {
      title: task.title || String(task.input_text || "").slice(0, 18),
      summary: String(task.input_text || "").slice(0, 80),
      narration: String(task.input_text || "")
    };
    writeDebug(debugDir, "01-rewrite-skipped.json", { reason: "semi_auto 保留原文", content });
  } else {
    const rewriteInput = {
      version: 2,
      model: modelIdentity,
      input_text: task.input_text,
      track: task.track,
      task_type: task.task_type,
      processing_mode: mode,
      rewrite_intensity: task.rewrite_intensity,
      narrative_pov: task.narrative_pov,
      target_length: task.target_length,
      keep_promotion: Boolean(task.keep_promotion),
      template_prompt: template.step1_rewrite_system_prompt || ""
    };
    content = readStageCache(debugDir, "01-rewrite", rewriteInput);
    if (!content) {
      onStage("01-rewrite", "running");
      content = await callModelJson(config, {
        stage: "01-rewrite",
        system: `${REWRITE_BASE_PROMPT}\n\n赛道专用要求：\n${template.step1_rewrite_system_prompt || ""}`,
        user: buildRewriteUserPrompt(task, template),
        temperature: 0.45,
        debugDir
      });
      writeStageCache(debugDir, "01-rewrite", rewriteInput, content);
    }
    throwIfCancelled();
    onStage("01-rewrite", "completed");
  }
  content = {
    title: String(content.title || task.title || String(task.input_text || "").slice(0, 18)),
    summary: String(content.summary || "").slice(0, 200),
    narration: mode === "semi_auto"
      ? String(task.input_text || "")
      : String(content.narration || "").trim()
  };
  if (!content.narration.trim()) throw new Error("文案处理阶段没有返回 narration");

  const metadataInput = {
    version: 2,
    model: modelIdentity,
    content,
    track: task.track,
    character_mode: characterMode,
    needs_character_card: Boolean(template.needs_character_card),
    reference_kind: referenceKind,
    reference_available: taskReferenceAvailable(task, referenceKind),
    template_prompt: template.step1_metadata_system_prompt || ""
  };
  let rawMetadata = readStageCache(debugDir, "02-metadata", metadataInput);
  if (!rawMetadata) {
    onStage("02-metadata", "running");
    rawMetadata = await callModelJson(config, {
      stage: "02-metadata",
      system: `${METADATA_BASE_PROMPT}\n\n赛道专用要求：\n${template.step1_metadata_system_prompt || ""}`,
      user: buildMetadataUserPrompt(task, template, content, characterMode, referenceKind),
      temperature: 0.15,
      debugDir
    });
    writeStageCache(debugDir, "02-metadata", metadataInput, rawMetadata);
  }
  throwIfCancelled();
  onStage("02-metadata", "completed");
  const metadata = normalizeMetadata(rawMetadata, template);
  const publish = metadata.publish || {};
  if (publish.title) content.title = publish.title;
  if (publish.summary) content.summary = publish.summary;

  onStage("03-scenes", "running");
  const sceneAssignments = await resolveSceneNarrationAssignments({
    config,
    task,
    content,
    debugDir,
    modelIdentity
  });
  const scenesInput = {
    version: 7,
    model: modelIdentity,
    processing_mode: mode,
    content,
    metadata,
    target_scenes: task.target_scenes,
    scene_assignments: sceneAssignments,
    batch_size: SCENE_BATCH_SIZE,
    ratio: task.ratio,
    style: task.style,
    style_registry_version: task.style_config?.registry_version || "",
    style_prefix: task.style_config?.prefix || "",
    style_suffix: task.style_config?.suffix || "",
    allow_color: task.style_config?.allow_color !== false,
    task_type: task.task_type,
    reference_kind: referenceKind,
    reference_available: taskReferenceAvailable(task, referenceKind),
    reference_decision_prompt: template.reference_decision_prompt || "",
    image_prompt_template: template.image_prompt_template || "",
    modules,
    seed_pools: seedPools,
    template_prompt: template.step3_system_prompt || ""
  };
  let scenePayload = readStageCache(debugDir, "03-scenes", scenesInput);
  if (!scenePayload) {
    const generatedScenes = await generateScenesInBatches({
      config,
      task,
      template,
      content,
      metadata,
      modules,
      seedPools,
      referenceKind,
      assignments: sceneAssignments,
      debugDir,
      modelIdentity
    });
    scenePayload = { scenes: generatedScenes };
    writeStageCache(debugDir, "03-scenes", scenesInput, scenePayload);
  }
  throwIfCancelled();
  onStage("03-scenes", "completed");
  if (!Array.isArray(scenePayload.scenes) || !scenePayload.scenes.length) {
    throw new Error("分镜阶段没有返回 scenes 数组");
  }
  const scenes = scenePayload.scenes.map((scene, index) => normalizeScene(scene, index, task, metadata, template, modules));
  const narrationCoverage = scenes.map(scene => scene.narration).join(task.task_type === "podcast" ? "\n" : "");
  const result = {
    checkpoint_version: 2,
    title: content.title,
    summary: content.summary,
    subtitle: normalizeStringArray(publish.subtitle, 3),
    tags: normalizeStringArray(publish.tags, 12),
    comments: normalizeStringArray(publish.comments, 8),
    narration: task.task_type === "podcast" ? narrationCoverage : content.narration,
    metadata: {
      ...metadata,
      planner_mode: "staged-llm",
      template_id: template.id || task.prompt_template_id || task.track || "",
      template_name: template.name || "",
      character_card_mode: characterMode,
      reference_kind: referenceKind,
      reference_available: taskReferenceAvailable(task, referenceKind),
      step3_skeleton_modules: modules,
      image_seed_pools: seedPools,
      reference_decision_prompt: template.reference_decision_prompt || ""
    },
    scenes
  };
  writeDebug(debugDir, "00-planner-result.json", result);
  return result;
}

module.exports = {
  planVideoScript,
  buildMechanicalScript,
  cleanJsonText,
  resolveTemplate,
  normalizeProcessingMode,
  normalizeCaptionSegments,
  applyImagePromptTemplate,
  splitNarrationForScenePlan,
  countSceneCharacters,
  inferAutoSceneCount,
  estimateNarrationDurationSeconds,
  buildSceneNarrationAssignments,
  splitNarrationIntoAtomicUnits,
  extractSemiAutoSceneGroups,
  validateSemiAutoSceneGroups,
  validateSceneAssignmentDensity,
  reconstructExactSceneAssignments,
  validateSceneNarrationAssignments,
  testModelConnection
};
