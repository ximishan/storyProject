const fs = require("node:fs");
const path = require("node:path");
const { spawnAsync, ffmpegPath, imageSize, mediaDuration } = require("./services.cjs");
const { atomicWriteFile, fileLooksUsable } = require("./checkpoint.cjs");

function srtTime(seconds) {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = String(Math.floor(ms / 3600000)).padStart(2, "0");
  const m = String(Math.floor(ms % 3600000 / 60000)).padStart(2, "0");
  const s = String(Math.floor(ms % 60000 / 1000)).padStart(2, "0");
  const rest = String(ms % 1000).padStart(3, "0");
  return `${h}:${m}:${s},${rest}`;
}

function assTime(seconds) {
  const centiseconds = Math.max(0, Math.round(Number(seconds || 0) * 100));
  const h = Math.floor(centiseconds / 360000);
  const m = String(Math.floor(centiseconds % 360000 / 6000)).padStart(2, "0");
  const s = String(Math.floor(centiseconds % 6000 / 100)).padStart(2, "0");
  const cs = String(centiseconds % 100).padStart(2, "0");
  return `${h}:${m}:${s}.${cs}`;
}

function stripCaptionTrailingPunctuation(text, { keepQuestionExclamation = true } = {}) {
  let source = String(text || "").trim();
  if (!source) return "";

  // 先临时取出末尾引号/括号，这样“你好。”会变成“你好”，而不是留下句号。
  const closingMatch = source.match(/[”’"'）)\]】》〉〕］」』]+$/u);
  const closing = closingMatch ? closingMatch[0] : "";
  if (closing) source = source.slice(0, -closing.length).trimEnd();

  const trailing = keepQuestionExclamation
    ? /[，。；：、,.;:]+$/u
    : /[，。！？；：、,.!?;:]+$/u;
  source = source.replace(trailing, "").trimEnd();
  return `${source}${closing}`.trim();
}

function stripCaptionDisplayPunctuation(text) {
  return String(text || "")
    // 姓名中的间隔点属于正文，例如“诺尔曼·白求恩”，不能按普通标点删除。
    .replace(/·/gu, "\uE000")
    .replace(/\p{P}+/gu, "")
    .replace(/\uE000/gu, "·")
    .replace(/\s+/g, "")
    .trim();
}

function protectedCaptionRanges(text) {
  const source = String(text || "");
  const ranges = [];
  const patterns = [
    /\d{2,4}年(?:\d{1,2}月(?:\d{1,2}日)?)?/gu,
    /\d{1,2}[:：]\d{2}(?::\d{2})?/gu,
    /\d+(?:[.,]\d+)?(?:万|亿|千|百)?(?:多|余|来)?(?:周年|个月|小时|分钟|公里|千米|厘米|毫米|公斤|千克|万元|亿元|年前|年后|年代|世纪|左右|以上|以下|岁|年|月|日|天|分|秒|米|斤|克|吨|元|块|美元|个|次|名|位|人|家|本|章|集|期|层|楼|号|点|时|%|％)?/gu,
    /[A-Za-z]+(?:[-_.][A-Za-z0-9]+)+/gu,
    /…{2,}|\.{3,}/gu,
    /[\u3400-\u9FFF]{1,10}·[\u3400-\u9FFF]{1,10}/gu
  ];
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(source))) {
      if (match[0].length > 1) ranges.push({ start: match.index, end: match.index + match[0].length });
      if (!match[0].length) pattern.lastIndex += 1;
    }
  }
  return ranges.sort((a, b) => a.start - b.start || b.end - a.end);
}

function captionCutIndex(text, start, preferredEnd, hardEnd) {
  const source = String(text || "");
  const length = source.length;
  let cut = Math.min(length, Math.max(start + 1, preferredEnd));
  if (cut >= length) return length;

  const ranges = protectedCaptionRanges(source);
  const protectedRange = ranges.find(range => cut > range.start && cut < range.end);
  if (protectedRange) {
    const leftLength = protectedRange.start - start;
    const rightEnd = Math.min(length, protectedRange.end);
    if (leftLength >= Math.max(4, Math.floor((preferredEnd - start) * 0.55))) cut = protectedRange.start;
    else if (rightEnd <= hardEnd) cut = rightEnd;
  }

  // 优先在新分句或新动作之前切换字幕，避免“理解的决定带着一支医疗”这类粘连。
  const semanticStarts = /(?:让|但|却|而|于是|随后|然后|后来|最终|带着|拿着|走进|走到|来到|开始|继续|转身|回到|奔向|钻进|钻入)/gu;
  const semanticCandidates = [];
  semanticStarts.lastIndex = start;
  let semanticMatch;
  while ((semanticMatch = semanticStarts.exec(source))) {
    const candidate = semanticMatch.index;
    if (candidate <= start + 3) continue;
    if (candidate > hardEnd) break;
    if (ranges.some(range => candidate > range.start && candidate < range.end)) continue;
    semanticCandidates.push(candidate);
    if (!semanticMatch[0].length) semanticStarts.lastIndex += 1;
  }
  if (semanticCandidates.length) {
    cut = semanticCandidates.reduce((best, candidate) =>
      Math.abs(preferredEnd - candidate) < Math.abs(preferredEnd - best) ? candidate : best
    );
  }

  // 在不破坏数字单位、人名等完整短语的前提下，优先在自然停顿位置换行。
  const minNatural = start + Math.max(4, Math.floor((preferredEnd - start) * 0.58));
  for (let index = cut - 1; index >= minNatural; index -= 1) {
    if (/[，、,；;：:\s]/u.test(source[index])) {
      const candidate = index + 1;
      const splitsProtected = ranges.some(range => candidate > range.start && candidate < range.end);
      if (!splitsProtected) {
        cut = candidate;
        break;
      }
    }
  }

  // 没有标点时，优先在常见方位/时间短语之后断开。
  // 例如“跑到中国的战场上钻破庙”应切成“跑到中国的战场上 / 钻破庙”，
  // 避免按固定字数把后一个动词短语的开头粘到上一条字幕。
  if (cut === Math.min(length, Math.max(start + 1, preferredEnd))) {
    const minimumTail = 2;
    for (let index = cut - 1; index >= minNatural; index -= 1) {
      const candidate = index + 1;
      if (length - candidate < minimumTail) continue;
      if (!/[上里内外前后时下处旁]/u.test(source[index])) continue;
      const splitsProtected = ranges.some(range => candidate > range.start && candidate < range.end);
      if (!splitsProtected) {
        cut = candidate;
        break;
      }
    }
  }
  return Math.max(start + 1, cut);
}

function smartSplitCaptionText(text, maxChars, { maxOverflow = 4 } = {}) {
  const source = String(text || "").trim();
  const limit = Math.max(1, Number(maxChars) || 1);
  if (!source || source.length <= limit) return source ? [source] : [];

  const pieces = [];
  let cursor = 0;
  while (cursor < source.length) {
    const remaining = source.length - cursor;
    if (remaining <= limit) {
      pieces.push(source.slice(cursor));
      break;
    }
    const preferredEnd = cursor + limit;
    const hardEnd = Math.min(source.length, preferredEnd + Math.max(0, Number(maxOverflow) || 0));
    const cut = captionCutIndex(source, cursor, preferredEnd, hardEnd);
    pieces.push(source.slice(cursor, cut));
    cursor = cut;
  }
  return pieces.filter(Boolean);
}

function wrapCaptionLine(text, maxChars) {
  const source = String(text || "").trim();
  const limit = Math.max(1, Number(maxChars) || 14);
  if (!source || source.length <= limit) return source ? [source] : [];

  // 两行以内时优先做均衡换行，避免第二行只剩“多岁”或“……”这样的孤行。
  if (source.length <= limit * 2) {
    const ideal = Math.ceil(source.length / 2);
    const cut = captionCutIndex(source, 0, ideal, Math.min(source.length, limit));
    if (cut > 0 && cut < source.length && source.length - cut <= limit + 2) {
      return [source.slice(0, cut), source.slice(cut)];
    }
  }
  return smartSplitCaptionText(source, limit);
}

function wrapCaption(text, maxChars) {
  const source = String(text || "").trim();
  if (!maxChars || source.length <= maxChars) return source;
  return source
    .split(/\r?\n/)
    .flatMap(line => wrapCaptionLine(line, Number(maxChars) || 14))
    .join("\n");
}

function splitPunctuatedCaptionPieces(text) {
  const source = String(text || "");
  const punctuation = new Set(Array.from("，。！？；：、,.!?;:"));
  const closing = new Set(Array.from("”’\"'）)】》〉〕］」』"));
  const pieces = [];
  let current = "";

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    current += char;
    if (!punctuation.has(char)) continue;

    // 小数、千位分隔等数字内部标点不属于字幕断句符号。
    const previous = source[index - 1] || "";
    const next = source[index + 1] || "";
    if ((char === "." || char === ",") && /\d/u.test(previous) && /\d/u.test(next)) continue;

    while (index + 1 < source.length && punctuation.has(source[index + 1])) {
      index += 1;
      current += source[index];
    }
    while (index + 1 < source.length && closing.has(source[index + 1])) {
      index += 1;
      current += source[index];
    }
    pieces.push(current);
    current = "";
  }
  if (current) pieces.push(current);
  return pieces.filter(Boolean);
}

function splitCaptionChunks(text, maxCharsPerLine = 14, maxLines = 1) {
  const source = String(text || "").replace(/\s+/g, "").trim();
  if (!source) return [];
  const lineChars = Math.max(6, Number(maxCharsPerLine) || 14);
  const chunkLimit = Math.max(lineChars, lineChars * Math.max(1, Number(maxLines) || 2));
  const pieces = splitPunctuatedCaptionPieces(source);
  const chunks = [];
  let current = "";

  const pushChunk = value => {
    // 标点仍参与上面的智能断句，但成片字幕只显示正文，避免口播字幕显得零碎杂乱。
    const cleaned = stripCaptionDisplayPunctuation(
      stripCaptionTrailingPunctuation(value, { keepQuestionExclamation: false })
    );
    if (cleaned) chunks.push(cleaned);
  };

  const appendPiece = rawPiece => {
    let piece = String(rawPiece || "").trim();
    if (!piece) return;
    const delimiterMatch = piece.match(/[，。！？；：、,.!?;:]+$/u);
    const delimiter = delimiterMatch ? delimiterMatch[0] : "";
    const strongBoundary = /[。！？!?；;]/u.test(delimiter);

    if (current && current.length + piece.length > chunkLimit) {
      pushChunk(current);
      current = "";
    }

    if (piece.length > chunkLimit) {
      if (current) {
        pushChunk(current);
        current = "";
      }
      const segments = smartSplitCaptionText(piece, chunkLimit, {
        maxOverflow: Number(maxLines) === 1 ? 0 : 6
      });
      for (let index = 0; index < segments.length; index += 1) {
        const segment = segments[index];
        const isLast = index === segments.length - 1;
        if (isLast && !strongBoundary) current = segment;
        else pushChunk(segment);
      }
    } else {
      current += piece;
    }

    // 句号、问号、感叹号和分号属于明确语义边界，不再与下一句拼成同一字幕。
    if (strongBoundary && current) {
      pushChunk(current);
      current = "";
    } else if (delimiter && current.length >= lineChars) {
      // 较长分句在逗号处直接切成下一条字幕，避免单条字幕被挤成三行。
      pushChunk(current);
      current = "";
    }
  };

  for (const piece of pieces) appendPiece(piece);
  if (current) pushChunk(current);
  return chunks.filter(Boolean);
}

function captionSchedule(text, duration, maxCharsPerLine = 14, maxLines = 1) {
  const chunks = splitCaptionChunks(text, maxCharsPerLine, maxLines);
  const total = Math.max(0, Number(duration || 0));
  if (!chunks.length || total <= 0) return [];

  const weights = chunks.map(item => Math.max(1, String(item || "").replace(/[，。！？；：、,.!?;:\s]/gu, "").length));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  // 时长充足时保证每条至少 0.55 秒；时长不足时按字数比例压缩，绝不丢掉最后一条字幕。
  const minimum = total >= chunks.length * 0.55 ? 0.55 : 0;
  const weightedPool = Math.max(0, total - minimum * chunks.length);
  const durations = weights.map(weight => minimum + weightedPool * weight / Math.max(1, totalWeight));

  let cursor = 0;
  return chunks.map((item, index) => {
    const start = cursor;
    const end = index === chunks.length - 1 ? total : Math.min(total, cursor + durations[index]);
    cursor = end;
    return { text: item, start, end };
  }).filter(item => item.end > item.start);
}

function sceneCaptionSchedule(scene, maxChars = 14) {
  const duration = Number(scene?.duration || 0);
  const timings = Array.isArray(scene?.caption_timings) ? scene.caption_timings : [];
  if (timings.length) {
    return timings.map(item => ({
      text: stripCaptionDisplayPunctuation(item.text),
      start: Math.max(0, Number(item.start || 0)),
      end: Math.min(duration, Number(item.end || 0))
    })).filter(item => item.text && item.end > item.start);
  }
  const segments = Array.isArray(scene?.caption_segments)
    ? scene.caption_segments.map(item => stripCaptionDisplayPunctuation(item)).filter(Boolean)
    : [];
  if (segments.length && duration > 0) {
    const weights = segments.map(item => Math.max(1, item.length));
    const totalWeight = weights.reduce((sum, item) => sum + item, 0);
    let cursor = 0;
    return segments.map((text, index) => {
      const start = cursor;
      const end = index === segments.length - 1 ? duration : cursor + duration * weights[index] / totalWeight;
      cursor = end;
      return { text, start, end };
    });
  }
  const prefix = scene?.speaker_name ? `${scene.speaker_name}：` : "";
  return captionSchedule(`${prefix}${String(scene?.narration || "").trim()}`, duration, Number(maxChars || 14), 1);
}

function writeSrt(scenes, destination, maxChars = 14) {
  let timelineCursor = 0;
  let blockIndex = 1;
  const blocks = [];
  for (const scene of scenes) {
    const duration = Number(scene.duration || 0);
    const schedule = sceneCaptionSchedule(scene, Number(maxChars || 14));
    for (const item of schedule) {
      blocks.push(`${blockIndex++}\n${srtTime(timelineCursor + item.start)} --> ${srtTime(timelineCursor + item.end)}\n${wrapCaption(item.text, Number(maxChars || 14))}\n`);
    }
    timelineCursor += duration;
  }
  atomicWriteFile(destination, blocks.join("\n"), "utf8");
  return destination;
}

function escapeFilterPath(file) {
  return file.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

function even(value) {
  return Math.max(2, Math.round(Number(value || 2) / 2) * 2);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value)));
}

function normalizeHex6(hex, fallback = "FFFFFF") {
  const raw = String(hex || fallback).replace(/^#/, "").trim();
  if (/^[0-9a-fA-F]{3}$/.test(raw)) return raw.split("").map(char => char + char).join("");
  if (/^[0-9a-fA-F]{6}$/.test(raw)) return raw;
  return fallback;
}

function assColor(hex, alpha = 1) {
  const safe = normalizeHex6(hex, "FFFFFF");
  const bgr = `${safe.slice(4, 6)}${safe.slice(2, 4)}${safe.slice(0, 2)}`;
  const aa = Math.round((1 - clamp(alpha ?? 1, 0, 1)) * 255).toString(16).padStart(2, "0").toUpperCase();
  return `&H${aa}${bgr.toUpperCase()}`;
}

function assEscape(text) {
  return String(text || "")
    .replace(/\\/g, "\\\\")
    .replace(/\{/g, "｛")
    .replace(/\}/g, "｝")
    .replace(/\r?\n/g, "\\N");
}

function layerPosition(layer, width, height) {
  const x = Math.round(width * (0.5 + clamp(layer?.x || 0, -1, 1) * 0.5));
  const y = Math.round(height * (0.5 - clamp(layer?.y || 0, -1, 1) * 0.5));
  const align = Number(layer?.align || 1) === 0 ? 4 : Number(layer?.align || 1) === 2 ? 6 : 5;
  return { x, y, align };
}

function makeAssStyle(name, layer, width, height, { background = false } = {}) {
  const fontScale = Math.max(1.8, height / 720);
  const fontSize = Math.max(18, Math.round(Number(layer?.fontSize || 12) * fontScale));
  const primary = assColor(layer?.color || "#FFFFFF", layer?.alpha ?? 1);
  const outlineColor = assColor(layer?.border?.color || "#000000", layer?.border?.alpha ?? 1);
  const backColor = background
    ? assColor(layer?.background?.color || "#000000", layer?.background?.alpha ?? 0.5)
    : assColor("#000000", 0);
  const borderStyle = background ? 3 : 1;
  const outline = background
    ? Math.max(4, Math.round(fontSize * 0.14))
    : Math.max(0, Number(layer?.border?.width || 0) / 20);
  const spacing = Number(layer?.letterSpacing || 0) * Math.max(1, width / 1080);
  return [
    name,
    "Microsoft YaHei",
    fontSize,
    primary,
    primary,
    outlineColor,
    backColor,
    layer?.bold ? -1 : 0,
    0,
    layer?.underline ? -1 : 0,
    0,
    100,
    100,
    spacing.toFixed(2),
    0,
    borderStyle,
    outline.toFixed(2),
    0,
    5,
    20,
    20,
    20,
    1
  ].join(",");
}

function writeAssOverlay({ scenes, destination, width, height, template = {}, title = "", subtitle = "", renderOptions = {} }) {
  const autoTextLayout = renderOptions.autoTextLayout !== false;
  const rawCaption = template.caption || {};
  const rawTitle = template.title || {};
  const rawSubtitle = template.subtitle || {};
  const rawDisclaimer = template.disclaimer || {};
  const caption = autoTextLayout ? { ...rawCaption, x: 0, y: -0.58, maxCharsPerLine: Number(rawCaption.maxCharsPerLine || 14) } : rawCaption;
  const titleLayer = autoTextLayout ? { ...rawTitle, x: 0, y: 0.68, maxCharsPerLine: 12 } : rawTitle;
  const subtitleLayer = autoTextLayout ? { ...rawSubtitle, x: 0, y: 0.50, maxCharsPerLine: 16 } : rawSubtitle;
  const disclaimer = autoTextLayout ? { ...rawDisclaimer, x: 0, y: -0.92 } : rawDisclaimer;
  const totalDuration = scenes.reduce((sum, scene) => sum + Number(scene.duration || 0), 0);
  const introDuration = Math.min(totalDuration, Math.max(0, Number(renderOptions.titleDuration ?? 3.2)));
  const burnCaption = renderOptions.burnCaption !== false && caption.visible !== false;
  const burnTitle = renderOptions.burnTitle !== false && titleLayer.visible !== false && String(title || "").trim();
  const burnSubtitle = renderOptions.burnSubtitle !== false && subtitleLayer.visible !== false && String(subtitle || "").trim();
  const burnDisclaimer = renderOptions.burnDisclaimer !== false && disclaimer.visible !== false && String(disclaimer.text || "").trim();

  const lines = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    "WrapStyle: 2",
    "ScaledBorderAndShadow: yes",
    "YCbCr Matrix: TV.601",
    "",
    "[V4+ Styles]",
    "Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding",
    `Style: ${makeAssStyle("Title", titleLayer, width, height)}`,
    `Style: ${makeAssStyle("Subtitle", subtitleLayer, width, height)}`,
    `Style: ${makeAssStyle("Caption", caption, width, height, { background: Number(caption.background?.alpha || 0) > 0 })}`,
    `Style: ${makeAssStyle("Disclaimer", disclaimer, width, height)}`,
    "",
    "[Events]",
    "Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text"
  ];

  const addEvent = (layer, start, end, style, text, config, maxChars = 0) => {
    if (!text || end <= start) return;
    const position = layerPosition(config, width, height);
    const wrapped = wrapCaption(String(text).trim(), maxChars).replace(/\n/g, "\\N");
    lines.push(`Dialogue: ${layer},${assTime(start)},${assTime(end)},${style},,0,0,0,,{\\an${position.align}\\pos(${position.x},${position.y})}${assEscape(wrapped).replace(/\\\\N/g, "\\N")}`);
  };

  if (burnTitle && introDuration > 0) {
    addEvent(3, 0, introDuration, "Title", String(title).trim().slice(0, 24), titleLayer, Number(titleLayer.maxCharsPerLine || 12));
  }
  if (burnSubtitle && introDuration > 0) {
    const conciseSubtitle = String(subtitle).trim().split(/[。！？!?]/)[0].slice(0, 32);
    addEvent(2, 0, introDuration, "Subtitle", conciseSubtitle, subtitleLayer, Number(subtitleLayer.maxCharsPerLine || 16));
  }
  if (burnDisclaimer) addEvent(4, 0, totalDuration, "Disclaimer", disclaimer.text, disclaimer, Number(disclaimer.maxCharsPerLine || 22));

  if (burnCaption) {
    let sceneCursor = 0;
    for (const scene of scenes) {
      const duration = Number(scene.duration || 0);
      const schedule = sceneCaptionSchedule(scene, Number(caption.maxCharsPerLine || 14));
      for (const item of schedule) {
        addEvent(5, sceneCursor + item.start, sceneCursor + item.end, "Caption", item.text, caption, Number(caption.maxCharsPerLine || 14));
      }
      sceneCursor += duration;
    }
  }

  atomicWriteFile(destination, lines.join("\n"), "utf8");
  return destination;
}

const CAPCUT_MOTION_PRESETS = Object.freeze({
  "缩放": { startScale: 1.00, endScale: 1.14, startX: .50, endX: .50, startY: .50, endY: .50 },
  "缩放 II": { startScale: 1.16, endScale: 1.02, startX: .50, endX: .50, startY: .50, endY: .50 },
  "左拉镜": { startScale: 1.16, endScale: 1.16, startX: .84, endX: .16, startY: .50, endY: .50 },
  "右拉镜": { startScale: 1.16, endScale: 1.16, startX: .16, endX: .84, startY: .50, endY: .50 },
  "向左缩小": { startScale: 1.16, endScale: 1.02, startX: .55, endX: .16, startY: .50, endY: .50 },
  "向右缩小": { startScale: 1.16, endScale: 1.02, startX: .45, endX: .84, startY: .50, endY: .50 },
  "形变左缩": { startScale: 1.14, endScale: 1.03, startX: .70, endX: .18, startY: .42, endY: .58, startAngle: 0, endAngle: -1.8 },
  "形变右缩": { startScale: 1.14, endScale: 1.03, startX: .30, endX: .82, startY: .42, endY: .58, startAngle: 0, endAngle: 1.8 },
  "上下分割": { startScale: 1.12, endScale: 1.03, startX: .50, endX: .50, startY: .16, endY: .84 },
  "左右分割": { startScale: 1.12, endScale: 1.03, startX: .16, endX: .84, startY: .50, endY: .50 },
  "向左下降": { startScale: 1.13, endScale: 1.03, startX: .80, endX: .18, startY: .18, endY: .82, startAngle: 0, endAngle: -1.2 },
  "向右下降": { startScale: 1.13, endScale: 1.03, startX: .20, endX: .82, startY: .18, endY: .82, startAngle: 0, endAngle: 1.2 },
  "旋转缩小": { startScale: 1.20, endScale: 1.04, startX: .50, endX: .50, startY: .50, endY: .50, startAngle: 0, endAngle: -2.8 },
  "旋转上升": { startScale: 1.04, endScale: 1.15, startX: .50, endX: .50, startY: .82, endY: .22, startAngle: -1.6, endAngle: 1.6 },
  "翻转": { startScale: 1.10, endScale: 1.10, startX: .50, endX: .50, startY: .50, endY: .50, startAngle: -1.2, endAngle: 1.2, flip: true },
  "形变缩小": { startScale: 1.18, endScale: 1.03, startX: .30, endX: .70, startY: .40, endY: .60, startAngle: 0, endAngle: -1.8 },
  "回弹伸缩": { startScale: 1.00, endScale: 1.07, startX: .50, endX: .50, startY: .50, endY: .50, bounce: true },
  "滑滑梯": { startScale: 1.16, endScale: 1.04, startX: .12, endX: .88, startY: .12, endY: .88, startAngle: -2.0, endAngle: 1.2 }
});

function ffNumber(value, digits = 8) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(digits).replace(/0+$/, "").replace(/\.$/, "") : "0";
}

function motionStrengthFactor(value, dynamicScene = false) {
  const strength = clamp(value ?? .5, .25, 2);
  // 旧模板默认强度是 0.5，因此把 0.5 作为剪映标准档。
  // 对数映射能避免强度稍微变化时位移突然翻倍，也不再切换渲染算法。
  const factor = clamp(.65 + .6 * Math.log2(1 + strength), .82, 1.60);
  return dynamicScene ? Math.min(1.65, factor * 1.06) : factor;
}

function scaleAroundOne(value, factor) {
  return 1 + (Number(value || 1) - 1) * factor;
}

function anchorAroundCenter(value, factor) {
  return clamp(.5 + (Number(value ?? .5) - .5) * factor, .02, .98);
}

function fittedImageFilter({ width, height, fit = "cover", backgroundColor = "0x000000" }) {
  return fit === "contain"
    ? `scale=${width}:${height}:force_original_aspect_ratio=decrease:flags=lanczos+accurate_rnd+full_chroma_int,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=${backgroundColor},setsar=1`
    : `scale=${width}:${height}:force_original_aspect_ratio=increase:flags=lanczos+accurate_rnd+full_chroma_int,crop=${width}:${height},setsar=1`;
}

function buildCapCutMotionFilter({
  width, height, frames, animation, motionStrength = .5, dynamicScene = false,
  sceneIndex = 1, fps = 30, fit = "cover", backgroundColor = "0x000000"
}) {
  const safeFrames = Math.max(2, Number(frames) || 2);
  const safeFps = Math.max(24, Math.min(60, Number(fps) || 30));
  let selected = String(animation || "无动画");
  if (selected === "交替拉镜") selected = Number(sceneIndex) % 2 === 0 ? "右拉镜" : "左拉镜";

  const fitted = fittedImageFilter({ width, height, fit, backgroundColor });
  if (selected === "无" || selected === "无动画") {
    return `${fitted},fps=${safeFps},setpts=N/(${safeFps}*TB),format=yuv420p`;
  }

  const preset = CAPCUT_MOTION_PRESETS[selected] || CAPCUT_MOTION_PRESETS["缩放"];
  const factor = motionStrengthFactor(motionStrength, dynamicScene);
  const startScale = Math.max(1.0001, scaleAroundOne(preset.startScale, factor));
  const endScale = Math.max(1.0001, scaleAroundOne(preset.endScale, factor));
  const startX = anchorAroundCenter(preset.startX, factor);
  const endX = anchorAroundCenter(preset.endX, factor);
  const startY = anchorAroundCenter(preset.startY, factor);
  const endY = anchorAroundCenter(preset.endY, factor);
  const startAngle = Number(preset.startAngle || 0) * factor;
  const endAngle = Number(preset.endAngle || 0) * factor;

  // perspective 会在每一帧重新计算浮点变换矩阵，并使用 cubic 插值。
  // 与 zoompan 的整数裁剪坐标不同，这条路径不需要 floor/trunc，也不需要
  // 巨大的 2～3 倍画布，因此既能保持亚像素运动，也能显著降低内存占用。
  const linear = `min(1,max(0,on/${safeFrames - 1}))`;
  const eased = `(0.5-0.5*cos(PI*(${linear})))`;
  const lerp = (from, to, progress = eased) => `(${ffNumber(from)}+(${ffNumber(to - from)})*(${progress}))`;

  let scaleExpression;
  if (preset.bounce) {
    const split = .62;
    const peak = scaleAroundOne(1.145, factor);
    const settle = scaleAroundOne(1.07, factor);
    const firstProgress = `min(1,max(0,(${linear})/${split}))`;
    const secondProgress = `min(1,max(0,((${linear})-${split})/${1 - split}))`;
    const firstEase = `(0.5-0.5*cos(PI*(${firstProgress})))`;
    const secondEase = `(0.5-0.5*cos(PI*(${secondProgress})))`;
    scaleExpression = `if(lt(${linear},${split}),${lerp(1, peak, firstEase)},${lerp(peak, settle, secondEase)})`;
  } else {
    scaleExpression = lerp(startScale, endScale);
  }

  const xAnchor = lerp(startX, endX);
  const yAnchor = lerp(startY, endY);
  const angleDegrees = lerp(startAngle, endAngle);
  const angleRadians = `((${angleDegrees})*PI/180)`;
  const cosAngle = `cos(${angleRadians})`;
  const sinAngle = `sin(${angleRadians})`;
  const centerX = `(W/2+W*((${scaleExpression})-1)*(0.5-(${xAnchor})))`;
  const centerY = `(H/2+H*((${scaleExpression})-1)*(0.5-(${yAnchor})))`;

  const corner = (vx, vy) => ({
    x: `(${centerX}+(${scaleExpression})*((${vx})*(${cosAngle})-(${vy})*(${sinAngle})))`,
    y: `(${centerY}+(${scaleExpression})*((${vx})*(${sinAngle})+(${vy})*(${cosAngle})))`
  });
  const topLeft = corner("-W/2", "-H/2");
  const topRight = corner("W/2", "-H/2");
  const bottomLeft = corner("-W/2", "H/2");
  const bottomRight = corner("W/2", "H/2");

  let filter = `${fitted},fps=${safeFps},setpts=N/(${safeFps}*TB),format=gbrp,` +
    `perspective=` +
    `x0='${topLeft.x}':y0='${topLeft.y}':` +
    `x1='${topRight.x}':y1='${topRight.y}':` +
    `x2='${bottomLeft.x}':y2='${bottomLeft.y}':` +
    `x3='${bottomRight.x}':y3='${bottomRight.y}':` +
    `sense=destination:eval=frame:interpolation=cubic`;

  if (preset.flip) {
    const flipAmount = `(W*${ffNumber(Math.min(.035 * factor, .055))}*(${eased}))`;
    filter += `,perspective=` +
      `x0='${flipAmount}':y0='0':` +
      `x1='W-1-(${flipAmount})':y1='(${flipAmount})*0.10':` +
      `x2='0':y2='H-1':` +
      `x3='W-1':y3='H-1-(${flipAmount})*0.10':` +
      `sense=destination:eval=frame:interpolation=cubic`;
  }

  return `${filter},setsar=1,format=yuv420p`;
}

function buildStablePanFilter({ width, height, frames, direction, motionStrength = .5, fps = 30, fit = "cover", backgroundColor = "0x000000" }) {
  return buildCapCutMotionFilter({
    width,
    height,
    frames,
    animation: direction === "right" ? "右拉镜" : "左拉镜",
    motionStrength,
    fps,
    fit,
    backgroundColor
  });
}

function buildImageMotionFilter({
  fitted, width, height, frames, animation, motionStrength = .5, dynamicScene = false,
  sceneIndex = 1, fps = 30, fit = "cover", backgroundColor = "0x000000"
}) {
  // fitted 参数仅为兼容旧调用保留；新动画引擎会直接在高分辨率工作画布上完成适配。
  void fitted;
  return buildCapCutMotionFilter({
    width,
    height,
    frames,
    animation,
    motionStrength,
    dynamicScene,
    sceneIndex,
    fps,
    fit,
    backgroundColor
  });
}

function normalizedGain(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return numeric > 2 ? numeric / 10 : numeric;
}

async function renderVideo({
  app, config, scenes, outputDir, ratio, bgmPath, template = {}, videoIntro = 0,
  forceRebuild = false, outputName = "final.mp4", renderOptions = {}, title = "", subtitle = "", onProgress = () => {}
}) {
  if (!Array.isArray(scenes) || !scenes.length) throw new Error("至少需要一个场景");
  const ffmpeg = ffmpegPath(app, config);
  const fallbackSize = imageSize(ratio);
  const width = even(Number(template.canvas?.width || fallbackSize.width));
  const height = even(Number(template.canvas?.height || fallbackSize.height));
  const imageConfig = { ...(template.image || {}), ...(renderOptions.image || {}) };
  const selectedAnimation = renderOptions.animation || imageConfig.animation || "无动画";
  const selectedStrength = renderOptions.motionStrength ?? imageConfig.motionStrength ?? 1;
  const renderFps = 30;
  const forceStaticImages = renderOptions.forceStaticImages !== false;
  const regionTop = Math.max(0, Math.min(height - 2, Math.round(Number(imageConfig.top || 0) * height / 2) * 2));
  const regionHeight = Math.max(2, Math.min(height - regionTop, even(Number(imageConfig.height || 1) * height)));
  const backgroundColor = String(template.canvas?.backgroundColor || "#000000");
  const ffBackgroundColor = `0x${normalizeHex6(backgroundColor, "000000")}`;
  const backgroundImage = String(template.canvas?.backgroundImage || "");
  const renderDir = path.join(outputDir, "render");

  if (forceRebuild) {
    try { fs.rmSync(renderDir, { recursive: true, force: true }); } catch {}
  }
  fs.mkdirSync(renderDir, { recursive: true });
  const clips = [];

  for (let scenePosition = 0; scenePosition < scenes.length; scenePosition += 1) {
    const scene = scenes[scenePosition];
    onProgress({ phase: "clip", current: scenePosition + 1, total: scenes.length, sceneIndex: scene.index });
    const clip = path.join(renderDir, `${String(scene.index).padStart(3, "0")}.mp4`);
    if (!forceRebuild && fileLooksUsable(clip, 1024)) {
      try {
        const existingDuration = await mediaDuration(app, config, clip);
        if (existingDuration > 0.05 && Math.abs(existingDuration - Number(scene.duration || 0)) < 1.25) {
          clips.push(clip);
          scene.render_clip_status = "completed";
          continue;
        }
      } catch {}
      try { fs.rmSync(clip, { force: true }); } catch {}
    }
    scene.render_clip_status = "running";
    const frames = Math.max(1, Math.ceil(Number(scene.duration || 0) * renderFps));
    const fitMode = imageConfig.fit === "contain" ? "decrease" : "increase";
    const fitted = imageConfig.fit === "contain"
      ? `scale=${width}:${regionHeight}:force_original_aspect_ratio=${fitMode},pad=${width}:${regionHeight}:(ow-iw)/2:(oh-ih)/2:color=${ffBackgroundColor},setsar=1`
      : `scale=${width}:${regionHeight}:force_original_aspect_ratio=${fitMode},crop=${width}:${regionHeight},setsar=1`;
    const dynamicScene = Number(videoIntro) === -1 || (Number(videoIntro) > 0 && Number(scene.index) <= Number(videoIntro));
    const hasGeneratedVideo = !forceStaticImages && Boolean(scene.video_path && fs.existsSync(scene.video_path));
    let visualFilter;
    if (hasGeneratedVideo) {
      const sourceDuration = Math.max(.1, await mediaDuration(app, config, scene.video_path));
      const stretch = Math.max(.01, Number(scene.duration || sourceDuration) / sourceDuration);
      visualFilter = `${fitted},setpts=${stretch.toFixed(8)}*PTS,fps=${renderFps}`;
    } else {
      visualFilter = buildImageMotionFilter({
        fitted,
        width,
        height: regionHeight,
        frames,
        animation: selectedAnimation === "无" ? "无动画" : selectedAnimation,
        motionStrength: selectedStrength,
        dynamicScene,
        sceneIndex: scene.index,
        fps: renderFps,
        fit: imageConfig.fit === "contain" ? "contain" : "cover",
        backgroundColor: ffBackgroundColor
      });
    }
    const useBackgroundImage = backgroundImage && fs.existsSync(backgroundImage);
    const backgroundFilter = useBackgroundImage
      ? `[2:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}[bg];`
      : "";
    const filter = `[0:v]${visualFilter}[img];${backgroundFilter}[2:v][img]overlay=0:${regionTop}:shortest=1,format=yuv420p[v]`;
    const clipArgs = hasGeneratedVideo
      ? ["-y", "-i", scene.video_path, "-i", scene.audio_path]
      : ["-y", "-loop", "1", "-framerate", String(renderFps), "-i", scene.image_path, "-i", scene.audio_path];
    if (useBackgroundImage) clipArgs.push("-loop", "1", "-framerate", String(renderFps), "-i", backgroundImage);
    else clipArgs.push("-f", "lavfi", "-i", `color=c=${ffBackgroundColor}:s=${width}x${height}:r=${renderFps}`);
    clipArgs.push(
      "-filter_complex_threads", "2",
      "-t", Number(scene.duration || 0).toFixed(3), "-filter_complex", filter, "-map", "[v]", "-map", "1:a",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-threads", "4", "-r", String(renderFps),
      "-c:a", "aac", "-b:a", "160k", "-shortest", clip
    );
    await spawnAsync(ffmpeg, clipArgs);
    scene.render_clip_status = "completed";
    clips.push(clip);
  }

  onProgress({ phase: "concat", current: scenes.length, total: scenes.length });
  const concatFile = path.join(renderDir, "concat.txt");
  atomicWriteFile(concatFile, clips.map(file => `file '${file.replace(/'/g, "'\\''")}'`).join("\n"), "utf8");
  const joined = path.join(renderDir, "joined.mp4");
  await spawnAsync(ffmpeg, ["-y", "-f", "concat", "-safe", "0", "-i", concatFile, "-c", "copy", joined]);

  const subtitlePath = writeSrt(scenes, path.join(outputDir, "subtitles.srt"), Number(template.caption?.maxCharsPerLine || 0));
  const assPath = writeAssOverlay({
    scenes,
    destination: path.join(outputDir, "final-overlay.ass"),
    width,
    height,
    template,
    title,
    subtitle,
    renderOptions
  });
  const finalVideo = path.join(outputDir, outputName);
  try { fs.rmSync(finalVideo, { force: true }); } catch {}
  const args = ["-y", "-i", joined];
  if (bgmPath && fs.existsSync(bgmPath)) {
    const narrationGain = Math.max(0, normalizedGain(template.audio?.narrationVolume, 1));
    const bgmGain = Math.max(0, normalizedGain(template.audio?.bgmVolume, .12));
    const fadeSeconds = Math.max(0, Number(template.audio?.bgmFadeOutMs ?? 2000) / 1000);
    const total = scenes.reduce((n, s) => n + Number(s.duration || 0), 0);
    args.push("-stream_loop", "-1", "-i", bgmPath);
    args.push("-filter_complex",
      `[0:a]volume=${narrationGain}[a0];[1:a]volume=${bgmGain},afade=t=out:st=${Math.max(0, total - fadeSeconds)}:d=${fadeSeconds}[a1];[a0][a1]amix=inputs=2:duration=first:normalize=0[a]`,
      "-map", "0:v", "-map", "[a]");
  } else {
    args.push("-map", "0:v", "-map", "0:a");
  }
  onProgress({ phase: "overlay", current: scenes.length, total: scenes.length });
  args.push(
    "-vf", `ass='${escapeFilterPath(assPath)}'`,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-threads", "4", "-r", String(renderFps),
    "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", "-shortest", finalVideo
  );
  await spawnAsync(ffmpeg, args);
  return { finalVideo, subtitlePath, assPath };
}

async function renderMusicVideo({ app, config, audioPath, images, lyrics, outputDir, ratio }) {
  if (!images.length) throw new Error("至少选择一张图片");
  const ffmpeg = ffmpegPath(app, config);
  const totalDuration = await mediaDuration(app, config, audioPath);
  const { width, height } = imageSize(ratio);
  const renderDir = path.join(outputDir, "render");
  fs.mkdirSync(renderDir, { recursive: true });
  const eachDuration = totalDuration / images.length;
  const clips = [];
  for (let index = 0; index < images.length; index += 1) {
    const clip = path.join(renderDir, `${String(index + 1).padStart(3, "0")}.mp4`);
    const frames = Math.max(1, Math.ceil(eachDuration * 30));
    await spawnAsync(ffmpeg, [
      "-y", "-loop", "1", "-i", images[index], "-t", eachDuration.toFixed(3),
      "-vf", buildImageMotionFilter({
        width, height, frames, animation: "缩放", motionStrength: .5, fps: 30, fit: "cover", backgroundColor: "0x000000"
      }),
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-an", clip
    ]);
    clips.push(clip);
  }
  const concatFile = path.join(renderDir, "concat.txt");
  atomicWriteFile(concatFile, clips.map(file => `file '${file.replace(/'/g, "'\\''")}'`).join("\n"), "utf8");
  const silentVideo = path.join(renderDir, "silent.mp4");
  await spawnAsync(ffmpeg, ["-y", "-f", "concat", "-safe", "0", "-i", concatFile, "-c", "copy", silentVideo]);

  let subtitlePath = "";
  const lyricLines = String(lyrics || "").split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (lyricLines.length) {
    const duration = totalDuration / lyricLines.length;
    subtitlePath = path.join(outputDir, "lyrics.srt");
    atomicWriteFile(subtitlePath, lyricLines.map((line, index) =>
      `${index + 1}\n${srtTime(index * duration)} --> ${srtTime((index + 1) * duration)}\n${line}\n`
    ).join("\n"), "utf8");
  }
  const finalVideo = path.join(outputDir, "music-mv.mp4");
  const args = ["-y", "-i", silentVideo, "-i", audioPath, "-map", "0:v", "-map", "1:a"];
  if (subtitlePath) {
    args.push("-vf", `subtitles='${escapeFilterPath(subtitlePath)}':force_style='FontName=Microsoft YaHei,FontSize=18,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Outline=2,Alignment=2,MarginV=80'`);
  }
  args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", finalVideo);
  await spawnAsync(ffmpeg, args);
  return { finalVideo, subtitlePath, totalDuration, eachDuration };
}

module.exports = {
  writeSrt,
  renderVideo,
  renderMusicVideo,
  _captionTest: { splitCaptionChunks, captionSchedule, sceneCaptionSchedule, stripCaptionDisplayPunctuation }
};
