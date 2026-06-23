const fs = require("node:fs");
const path = require("node:path");
let ProxyAgent = null;
try { ({ ProxyAgent } = require("undici")); } catch {}
const { atomicWriteJson, atomicWriteFile, readJsonSafe, fingerprint } = require("./checkpoint.cjs");
const { buildPolicySafeImagePrompt } = require("./image-prompt-safety.cjs");
const { taskReferenceAvailable } = require("./reference-routing.cjs");

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
      "caption_segments": ["6到12字的完整语义字幕", "不得拆开词语"],
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
每镜只表达一个明确视觉重点。旁白必须完整覆盖，不得改写、漏句或重复。use_reference 必须根据本镜是否真正出现需要保持一致的主角/产品来判断，空镜、环境、器物、资料画面通常为 false。\n图片合规硬规则：当旁白涉及手术、受伤、流血、尸体、暴力或死亡时，不得在 desc_prompt 中直接描写令人不适的细节。必须改用包扎后的手指、医生神情、医疗站环境、布帘遮挡、器械整理、远景或象征性画面。不得输出“鲜血、血液、染血、伤口特写、割口清晰可见、缝合伤口、器官外露、尸体特写、极近景微距”等表达。赛道专用要求不得覆盖本条规则。`;

const JSON_REPAIR_PROMPT = `你是严格的 JSON 修复器。用户会提供一段本应为 JSON、但可能包含未转义引号、非法换行、尾逗号或多余说明的文本。
只返回修复后的合法 JSON，不要输出 Markdown，不要解释，不要改写字段含义，不要删除原有有效内容。JSON 字符串中的英文双引号必须正确转义。`;

function llmFetch(url, options, proxyUrl) {
  if (proxyUrl && !ProxyAgent) throw new Error("已配置 LLM 代理，但 undici 依赖不可用，请重新安装项目依赖");
  return fetch(url, {
    ...options,
    ...(proxyUrl ? { dispatcher: new ProxyAgent(proxyUrl) } : {})
  });
}

function normalizeProcessingMode(value) {
  return value === "semi" ? "semi_auto" : (value || "auto");
}

function splitSourceText(sourceText, targetScenes = 0) {
  const pieces = String(sourceText || "")
    .split(/(?<=[。！？!?；;])|\n+/)
    .map(item => item.trim())
    .filter(Boolean);
  if (!pieces.length) return [];
  const target = Math.max(1, Number(targetScenes || pieces.length));
  const chunkSize = Math.max(1, Math.ceil(pieces.length / target));
  const chunks = [];
  for (let index = 0; index < pieces.length; index += chunkSize) {
    chunks.push(pieces.slice(index, index + chunkSize).join(""));
  }
  return chunks;
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
    const rawImagePrompt = `${task.style}风格，${item.text}，主体明确，构图完整，适合${task.ratio}短视频画面，无文字无水印`;
    const promptSafety = buildPolicySafeImagePrompt(rawImagePrompt, "preflight");
    return {
      index: index + 1,
      narration: item.text,
      visual: item.text,
      desc_prompt: promptSafety.prompt,
      desc_prompt_original: promptSafety.adjusted ? item.text : "",
      image_prompt: promptSafety.prompt,
      image_prompt_original: promptSafety.adjusted ? rawImagePrompt : "",
      image_prompt_safety_adjusted: promptSafety.adjusted,
      image_prompt_safety_reasons: promptSafety.reasons,
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
      throw new Error(`${stage}返回内容仍不是合法 JSON：${error.message}`);
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
  const descSafety = buildPolicySafeImagePrompt(rawDescPrompt, "preflight");
  const normalized = {
    index: index + 1,
    narration: String(scene.narration || ""),
    caption_segments: normalizeCaptionSegments(scene.narration, scene.caption_segments),
    visual: String(scene.visual || scene.desc_prompt || ""),
    desc_prompt: descSafety.prompt,
    desc_prompt_original: descSafety.adjusted ? rawDescPrompt : "",
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
  const promptSafety = buildPolicySafeImagePrompt(templatedPrompt, "preflight");
  normalized.image_prompt = promptSafety.prompt;
  normalized.image_prompt_original = promptSafety.adjusted ? templatedPrompt : "";
  normalized.image_prompt_safety_adjusted = Boolean(descSafety.adjusted || promptSafety.adjusted);
  normalized.image_prompt_safety_reasons = [...new Set([...(descSafety.reasons || []), ...(promptSafety.reasons || [])])];
  return normalized;
}

function buildRewriteUserPrompt(task, template) {
  return `内容类型：${task.track}\n视频形态：${task.task_type === "podcast" ? "双人播客" : "单人旁白"}\n处理模式：${normalizeProcessingMode(task.processing_mode)}\n改写强度：${task.rewrite_intensity || "standard"}\n叙事视角：${task.narrative_pov || "original"}\n目标字数：${task.target_length || "跟随原文"}\n推广内容：${task.keep_promotion ? "保留" : "删除"}\n\n请严格执行 system 中的赛道专用规则。\n\n原始文案：\n${task.input_text}`;
}

function buildMetadataUserPrompt(task, template, content, characterMode, referenceKind) {
  return `内容类型：${task.track}\n主角档案模式：${characterMode}（follow=跟随赛道，force=强制提取，skip=强制跳过）\n本赛道是否需要主角档案：${template.needs_character_card ? "是" : "否"}\n参考图类型：${referenceKind}\n是否已有可用参考图：${taskReferenceAvailable(task, referenceKind) ? "是" : "否"}\n\n请严格执行 system 中的封面、发布与视觉元数据规则，并同时完整填写 publish 与视觉元数据字段。\n\n工作标题：${content.title}\n工作摘要：${content.summary}\n旁白：\n${content.narration}`;
}

function buildSceneUserPrompt(task, template, content, metadata, modules, seedPools, referenceKind) {
  const captionRule = "字幕语义分段硬规则：每个场景必须输出 caption_segments。优先按 narration 原有标点切分；每段建议 6-12 个汉字，必须是完整词语、完整短语或完整语义，禁止按固定字数切断姓名、动词或名词。显示时删除普通标点，但姓名间隔点“·”必须保留。所有分段拼接并去掉普通标点后，必须与 narration 正文完全一致。";
  const referenceRule = `${captionRule}\n${template.reference_decision_prompt || "只有镜头中清晰出现主角/产品且保持身份外观一致有价值时，use_reference 才能为 true；环境、空镜、器物特写和资料画面设为 false。"}`;
  return `内容类型：${task.track}\n视频形态：${task.task_type === "podcast" ? "双人播客；每个镜头必须输出 speaker_role(A/B)" : "单人旁白"}\n目标分镜数：${task.target_scenes || "根据旁白长度自动决定"}\n画面比例：${task.ratio}\n视觉风格：${task.style}\n参考图类型：${referenceKind}\n是否已有可用参考图：${taskReferenceAvailable(task, referenceKind) ? "是" : "否"}\n参考图判断标准：${referenceRule}\n分镜骨架模块：${JSON.stringify(modules)}\n图片种子池：${JSON.stringify(seedPools)}\n\n图片合规硬规则：\n涉及医疗救治、受伤、暴力或死亡的旁白，只能使用克制的替代画面。优先表现包扎后的状态、人物神情、环境、器械、布帘遮挡、中景或远景，不得描述开放性创口、流体细节、缝合过程、尸体细节或极近景微距。\n\n请严格执行 system 中的赛道分镜规则，最终输出格式只遵守 system 统一 scenes JSON 协议。\n\n元数据：\n${JSON.stringify(metadata, null, 2)}\n\n必须完整覆盖的旁白：\n${content.narration}`;
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
    onStage("01-rewrite", "completed");
  }
  content = {
    title: String(content.title || task.title || String(task.input_text || "").slice(0, 18)),
    summary: String(content.summary || "").slice(0, 200),
    narration: String(content.narration || (mode === "semi_auto" ? task.input_text : "")).trim()
  };
  if (!content.narration) throw new Error("文案处理阶段没有返回 narration");

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
  onStage("02-metadata", "completed");
  const metadata = normalizeMetadata(rawMetadata, template);
  const publish = metadata.publish || {};
  if (publish.title) content.title = publish.title;
  if (publish.summary) content.summary = publish.summary;

  const scenesInput = {
    version: 2,
    model: modelIdentity,
    content,
    metadata,
    target_scenes: task.target_scenes,
    ratio: task.ratio,
    style: task.style,
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
    onStage("03-scenes", "running");
    scenePayload = await callModelJson(config, {
      stage: "03-scenes",
      system: `${SCENE_BASE_PROMPT}\n\n赛道专用要求：\n${template.step3_system_prompt || ""}`,
      user: buildSceneUserPrompt(task, template, content, metadata, modules, seedPools, referenceKind),
      temperature: 0.35,
      debugDir
    });
    writeStageCache(debugDir, "03-scenes", scenesInput, scenePayload);
  }
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
  testModelConnection
};
