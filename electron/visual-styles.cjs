const builtinStyles = require("../shared/visual-styles.json");

// Verified against Storybound 1.7.0 bundle assets/index-4x08xVVG.js.
const STYLE_REGISTRY_VERSION = "storybound-1.7.0";
const STYLE_REGISTRY_SOURCE_SHA256 = "68edc1aa13794663381fab73aff524b9fb11f082782aef5c7592e5132937b79a";

// Legacy IDs used by earlier rebuilds. They are migrated to the original 1.7.0 IDs.
const LEGACY_STYLE_ALIASES = Object.freeze({
  "retro-film": "vintage-film",
  magazine: "illustration",
  "folk-illustration": "folk-tale-gongbi"
});

const TRACK_DEFAULT_STYLES = Object.freeze({
  "character-story": "black-white",
  "health-book": "oil-painting",
  "culture-knowledge": "ancient-cinematic",
  "picture-book": "pixar-3d",
  ecommerce: "realistic",
  inspiration: "cinematic",
  "folk-tale": "folk-tale-gongbi",
  general: "realistic",
  "food-vlog": "vintage-film"
});

const styleById = new Map(builtinStyles.map(item => [item.id, item]));
const styleByName = new Map(builtinStyles.map(item => [item.name, item]));

const LEGACY_STYLE_PREFIXES = Object.freeze([
  "黑白纪实摄影，真实胶片颗粒，自然光，情绪克制",
  "印象派油画，柔和笔触，温暖自然光，多层次色彩",
  "古风电影画面，东方美学，古代建筑与服饰，电影级光影",
  "可爱高品质3D绘本动画，圆润角色，柔和灯光，鲜明色彩",
  "真实商业摄影，现代自然光，清晰产品细节",
  "现代电影感，柔和光影，情绪化构图",
  "东方民间工笔叙事，电影光影，传统服饰与乡土环境",
  "现代写实电影画面，自然光，真实人物与环境",
  "美食电影摄影，暖色灯光，真实食物质感与烟火气"
]);

function cleanupPromptSeparators(text) {
  return String(text || "")
    .replace(/[，,]{2,}/g, "，")
    .replace(/^[，,\s]+|[，,\s]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function stripKnownStyleLayer(prompt, selectedStyle = null) {
  let text = String(prompt || "").trim();
  if (!text) return text;

  // Scene prompts must remain content-only. Remove any complete built-in/legacy
  // style wrapper wherever a planning template or an older saved task inserted it.
  const allStyleLayers = [
    ...builtinStyles.flatMap(item => [item.prefix, item.suffix]),
    ...LEGACY_STYLE_PREFIXES
  ]
    .map(item => String(item || "").trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  for (const layer of allStyleLayers) {
    while (text.includes(layer)) text = text.split(layer).join("");
  }

  const selectedId = selectedStyle
    ? canonicalStyleId(typeof selectedStyle === "string" ? selectedStyle : selectedStyle.id)
    : "";

  // A stale LLM/template prompt may contain a partial monochrome directive that
  // is not identical to the full registry prefix. When the user selected any
  // non-monochrome style, remove only explicit rendering directives; do not
  // remove ordinary scene objects such as a framed black-and-white photograph.
  if (selectedId && selectedId !== "black-white") {
    const conflictingMonochromeDirectives = [
      /纯灰阶黑白胶片摄影/gi,
      /黑白胶片摄影/gi,
      /黑白纪实摄影/gi,
      /黑白摄影风格/gi,
      /纯黑白(?:画面|影像|风格)/gi,
      /完全无彩色/gi,
      /无任何颜色饱和度/gi,
      /纯灰阶(?:单色)?/gi,
      /灰阶单色(?:画面|风格)?/gi,
      /单色黑白(?:画面|风格)?/gi
    ];
    for (const pattern of conflictingMonochromeDirectives) text = text.replace(pattern, "");
  }

  return cleanupPromptSeparators(text);
}

class VisualStyleResolutionError extends Error {
  constructor(message, styleToken = "") {
    super(message);
    this.name = "VisualStyleResolutionError";
    this.code = "VISUAL_STYLE_NOT_FOUND";
    this.styleToken = styleToken;
  }
}

function canonicalStyleId(value) {
  const token = String(value || "").trim();
  return LEGACY_STYLE_ALIASES[token] || token;
}

function defaultStyleForTrack(track) {
  return TRACK_DEFAULT_STYLES[String(track || "").trim()] || "realistic";
}

function inferAllowColor(style) {
  if (!style) return true;
  if (typeof style.allow_color === "boolean") return style.allow_color;
  if (typeof style.allowColor === "boolean") return style.allowColor;
  const key = `${style.id || ""} ${style.name || ""} ${style.prefix || ""}`;
  return !(canonicalStyleId(style.id) === "black-white" || /纯灰阶|完全无彩色|纯黑白|黑白摄影|monochrome|grayscale/i.test(key));
}

function normalizeVisualStyle(style, origin = "builtin") {
  if (!style) throw new VisualStyleResolutionError("画面风格配置为空");
  const id = canonicalStyleId(style.id);
  if (!id) throw new VisualStyleResolutionError("画面风格缺少 ID");
  return {
    ...style,
    id,
    name: String(style.name || id),
    tag: String(style.tag || ""),
    short_name: String(style.short_name || style.shortName || ""),
    prefix: String(style.prefix || "").trim(),
    suffix: String(style.suffix || "").trim(),
    negative_prompt: String(style.negative_prompt || style.negativePrompt || "").trim(),
    description: String(style.description || ""),
    track_hints: Array.isArray(style.track_hints)
      ? style.track_hints
      : Array.isArray(style.trackHints) ? style.trackHints : [],
    allow_color: inferAllowColor(style),
    registry_version: String(style.registry_version || STYLE_REGISTRY_VERSION),
    registry_source_sha256: String(style.registry_source_sha256 || STYLE_REGISTRY_SOURCE_SHA256),
    origin
  };
}

function findBuiltinVisualStyle(idOrName) {
  const token = String(idOrName || "").trim();
  if (!token) return null;
  return styleById.get(canonicalStyleId(token)) || styleByName.get(token) || null;
}

function resolveVisualStyle(idOrName, customStyle = null, options = {}) {
  const token = String(idOrName || "").trim();
  if (customStyle) return normalizeVisualStyle(customStyle, "custom");
  const builtin = findBuiltinVisualStyle(token);
  if (builtin) return normalizeVisualStyle(builtin, "builtin");

  const fallbackId = String(options.fallbackId || "").trim();
  if (fallbackId) {
    const fallback = findBuiltinVisualStyle(fallbackId);
    if (fallback) return normalizeVisualStyle(fallback, "fallback");
  }

  throw new VisualStyleResolutionError(
    token
      ? `画面风格“${token}”不存在。请重新选择风格，程序不会再自动回退为黑白摄影。`
      : "任务没有保存画面风格。请重新选择风格后再运行。",
    token
  );
}

function tryResolveVisualStyle(idOrName, customStyle = null) {
  try { return resolveVisualStyle(idOrName, customStyle); }
  catch { return null; }
}

function resolveVisualStyleList(value) {
  const tokens = Array.isArray(value)
    ? value
    : String(value || "").split(/[，,]+/).map(item => item.trim()).filter(Boolean);
  const resolved = [];
  for (const token of tokens) {
    const style = tryResolveVisualStyle(token);
    if (style && !resolved.some(item => item.id === style.id)) resolved.push(style);
  }
  return resolved;
}

function stripColorTermsForMonochrome(prompt) {
  let text = String(prompt || "");
  const marker = "@@CG@@";
  const protectedParts = [];
  text = text.replace(/(完全无|无任何|不要|排除|禁止|避免|无|非)(彩色|色彩饱和度?|色彩鲜艳|色彩缤纷|暖色调|冷色调)/g, match => {
    protectedParts.push(match);
    return `${marker}${protectedParts.length - 1}${marker}`;
  });
  const replacements = [
    [/素色蓝(布|绸|衣|衫|裤|裙)/g, "素色$1"], [/蓝(布|绸|衣|衫|裤|裙)/g, "$1"],
    [/红(布|绸|衣|衫|裤|裙|旗|墙)/g, "$1"], [/青(布|衫|衣|砖|瓦)/g, "$1"],
    [/绿(布|衣|衫|裙)/g, "$1"], [/红木/g, "深色木"], [/红砖/g, "砖"],
    [/红花/g, "花"], [/黄花/g, "花"], [/金黄色?/g, "明亮"], [/金色/g, "明亮"],
    [/银色/g, "灰"], [/铜色/g, "深"], [/红色/g, "深色"], [/橙红色?/g, "深"],
    [/橙色/g, "亮"], [/黄色/g, ""], [/翠绿色?/g, ""], [/墨绿色?/g, "深"],
    [/绿色/g, ""], [/青色/g, ""], [/天蓝色?/g, ""], [/深蓝色?/g, "深"],
    [/蓝灰色?/g, "深灰"], [/蓝色/g, ""], [/紫色/g, "深"], [/粉色/g, "浅"],
    [/粉红色?/g, "浅"], [/棕色/g, "深"], [/褐色/g, "深"], [/咖啡色/g, "深"],
    [/米白色?/g, "浅"], [/米色/g, "浅"], [/乳白色?/g, "浅"], [/雪白色?/g, ""],
    [/暖黄/g, "柔和"], [/暖色调/g, "柔和氛围"], [/冷色调/g, "清冷氛围"],
    [/暖光(色)?/g, "柔光"], [/冷光(色)?/g, "白光"], [/昏黄/g, "昏暗"],
    [/泛黄/g, "陈旧"], [/色温/g, "光质"], [/彩色/g, "黑白"],
    [/色彩缤纷/g, "层次丰富"], [/色彩鲜艳/g, "对比强烈"],
    [/色彩饱和/g, "对比强烈"], [/色调浓郁/g, "对比浓郁"],
    [/色彩(感|层次|过渡|分级)/g, "光影$1"]
  ];
  for (const [pattern, replacement] of replacements) text = text.replace(pattern, replacement);
  text = text.replace(new RegExp(`${marker}(\\d+)${marker}`, "g"), (_match, index) => protectedParts[Number(index)] || "");
  return text
    .replace(/的{2,}/g, "的")
    .replace(/，{2,}/g, "，")
    .replace(/\s{2,}/g, " ")
    .replace(/^[，\s]+|[，\s]+$/g, "");
}

function promptAlreadyHasStyle(prompt, style) {
  const firstPrefixPart = String(style?.prefix || "").split("，")[0].trim();
  return Boolean(firstPrefixPart && String(prompt || "").trim().startsWith(firstPrefixPart));
}

function buildStyledPrompt(style, scenePrompt) {
  const normalized = normalizeVisualStyle(style, style?.origin || "builtin");
  const rawPrompt = stripKnownStyleLayer(scenePrompt, normalized);
  if (!rawPrompt) throw new Error("生图场景提示词为空");
  const combined = promptAlreadyHasStyle(rawPrompt, normalized)
    ? rawPrompt
    : [normalized.prefix, rawPrompt, normalized.suffix].filter(Boolean).join("，");
  return normalized.allow_color ? combined : stripColorTermsForMonochrome(combined);
}

function validateFinalStyledPrompt(style, finalPrompt) {
  const normalized = normalizeVisualStyle(style, style?.origin || "builtin");
  const text = String(finalPrompt || "");
  const errors = [];
  const prefixHead = normalized.prefix.split("，")[0];
  const suffixTail = normalized.suffix.split("，").slice(-1)[0];
  if (prefixHead && !text.includes(prefixHead)) errors.push(`缺少风格前缀：${prefixHead}`);
  if (suffixTail && !text.includes(suffixTail)) errors.push(`缺少风格后缀：${suffixTail}`);
  if (normalized.id === "realistic" && /纯灰阶黑白|完全无彩色|黑白(?:胶片)?(?:纪实)?摄影|无任何颜色饱和度/.test(text)) {
    errors.push("写实彩色提示词中混入了黑白摄影约束");
  }
  if (normalized.id !== "black-white" && /^历史纪实摄影[，,]|[，,]历史纪实摄影[，,]/.test(text)
      && !text.includes(normalized.prefix)) {
    errors.push("非黑白风格被历史纪实兜底覆盖");
  }
  if (errors.length) {
    const error = new Error(`画面风格完整性校验失败：${errors.join("；")}`);
    error.code = "VISUAL_STYLE_INTEGRITY_ERROR";
    error.styleId = normalized.id;
    throw error;
  }
  return true;
}

function styleSnapshot(style) {
  const normalized = normalizeVisualStyle(style, style?.origin || "builtin");
  return {
    id: normalized.id,
    name: normalized.name,
    tag: normalized.tag,
    short_name: normalized.short_name,
    prefix: normalized.prefix,
    suffix: normalized.suffix,
    negative_prompt: normalized.negative_prompt,
    description: normalized.description,
    track_hints: normalized.track_hints,
    allow_color: normalized.allow_color,
    registry_version: normalized.registry_version,
    registry_source_sha256: normalized.registry_source_sha256,
    origin: normalized.origin
  };
}

module.exports = {
  BUILTIN_VISUAL_STYLES: builtinStyles,
  STYLE_REGISTRY_VERSION,
  STYLE_REGISTRY_SOURCE_SHA256,
  LEGACY_STYLE_ALIASES,
  TRACK_DEFAULT_STYLES,
  VisualStyleResolutionError,
  canonicalStyleId,
  defaultStyleForTrack,
  inferAllowColor,
  normalizeVisualStyle,
  findBuiltinVisualStyle,
  resolveVisualStyle,
  tryResolveVisualStyle,
  resolveVisualStyleList,
  stripKnownStyleLayer,
  stripColorTermsForMonochrome,
  buildStyledPrompt,
  validateFinalStyledPrompt,
  styleSnapshot
};
