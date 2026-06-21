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

function wrapCaption(text, maxChars) {
  const source = String(text || "").trim();
  if (!maxChars || source.length <= maxChars) return source;
  const lines = [];
  for (let index = 0; index < source.length; index += maxChars) lines.push(source.slice(index, index + maxChars));
  return lines.join("\n");
}

function splitCaptionChunks(text, maxCharsPerLine = 14, maxLines = 2) {
  const source = String(text || "").replace(/\s+/g, "").trim();
  if (!source) return [];
  const lineChars = Math.max(6, Number(maxCharsPerLine) || 14);
  const chunkLimit = Math.max(lineChars, lineChars * Math.max(1, Number(maxLines) || 2));
  const sentences = source.match(/[^，。！？；：,.!?;:]+[，。！？；：,.!?;:]?/g) || [source];
  const chunks = [];
  let current = "";
  const pushPiece = piece => {
    let rest = String(piece || "").trim();
    while (rest.length > chunkLimit) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      chunks.push(rest.slice(0, chunkLimit));
      rest = rest.slice(chunkLimit);
    }
    if (!rest) return;
    if (!current) current = rest;
    else if ((current + rest).length <= chunkLimit) current += rest;
    else {
      chunks.push(current);
      current = rest;
    }
  };
  for (const sentence of sentences) pushPiece(sentence);
  if (current) chunks.push(current);
  return chunks.filter(Boolean);
}

function captionSchedule(text, duration, maxCharsPerLine = 14, maxLines = 2) {
  const chunks = splitCaptionChunks(text, maxCharsPerLine, maxLines);
  const total = Math.max(0, Number(duration || 0));
  if (!chunks.length || total <= 0) return [];
  const totalWeight = chunks.reduce((sum, item) => sum + Math.max(1, item.length), 0);
  let cursor = 0;
  return chunks.map((item, index) => {
    const remaining = Math.max(0, total - cursor);
    const raw = index === chunks.length - 1 ? remaining : total * Math.max(1, item.length) / totalWeight;
    const segmentDuration = index === chunks.length - 1 ? remaining : Math.max(0.55, raw);
    const start = cursor;
    const end = index === chunks.length - 1 ? total : Math.min(total, cursor + segmentDuration);
    cursor = end;
    return { text: item, start, end };
  }).filter(item => item.end > item.start);
}

function writeSrt(scenes, destination, maxChars = 14) {
  let timelineCursor = 0;
  let blockIndex = 1;
  const blocks = [];
  for (const scene of scenes) {
    const duration = Number(scene.duration || 0);
    const prefix = scene.speaker_name ? `${scene.speaker_name}：` : "";
    const schedule = captionSchedule(`${prefix}${String(scene.narration || "").trim()}`, duration, Number(maxChars || 14), 2);
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
      const text = `${scene.speaker_name ? `${scene.speaker_name}：` : ""}${String(scene.narration || "").trim()}`;
      const schedule = captionSchedule(text, duration, Number(caption.maxCharsPerLine || 14), 2);
      for (const item of schedule) {
        addEvent(5, sceneCursor + item.start, sceneCursor + item.end, "Caption", item.text, caption, Number(caption.maxCharsPerLine || 14));
      }
      sceneCursor += duration;
    }
  }

  atomicWriteFile(destination, lines.join("\n"), "utf8");
  return destination;
}

function buildStablePanFilter({ fitted, width, height, frames, direction, motionStrength = 1, fps = 60 }) {
  const safeFrames = Math.max(2, Number(frames) || 2);
  const safeFps = Math.max(30, Math.min(60, Number(fps) || 60));
  const strength = clamp(motionStrength || 1, 0.25, 2);

  // 0.8.7：不再从整张超扫区域的一端拉到另一端。
  // 旧实现位移过大，短镜头里每帧移动距离明显，视觉上会像抖动。
  // 现在只在画面中心附近做小幅平移，并以 60fps 输出。
  const scale = clamp(1.075 + 0.025 * strength, 1.075, 1.125);
  const supersample = 2;
  const overscanWidth = even(width * scale);
  const overscanHeight = even(height * scale);
  const highWidth = even(overscanWidth * supersample);
  const highHeight = even(overscanHeight * supersample);
  const cropWidth = even(width * supersample);
  const cropHeight = even(height * supersample);
  const maxX = Math.max(0, highWidth - cropWidth);
  const maxY = Math.max(0, highHeight - cropHeight);
  const centerX = maxX / 2;
  const centerY = maxY / 2;

  // 最多移动输出画面宽度约 3.5%～7%，避免短镜头快速扫动。
  const requestedTravel = width * supersample * (0.035 + 0.015 * strength);
  const travel = Math.max(2, Math.min(maxX * 0.72, requestedTravel));
  const halfTravel = travel / 2;
  const startX = direction === "right" ? centerX - halfTravel : centerX + halfTravel;
  const endX = direction === "right" ? centerX + halfTravel : centerX - halfTravel;
  const progress = `min(1,max(0,n/${safeFrames - 1}))`;
  const x = `max(0,min(${maxX},round(${startX.toFixed(4)}+(${(endX - startX).toFixed(4)})*${progress})))`;
  const y = `max(0,min(${maxY},round(${centerY.toFixed(4)})))`;

  // 在二倍画布上移动、缩回目标尺寸，并用相邻帧轻量混合消除整数像素步进感。
  return `${fitted},scale=${highWidth}:${highHeight}:flags=lanczos,setsar=1,` +
    `crop=${cropWidth}:${cropHeight}:x='${x}':y='${y}',` +
    `scale=${width}:${height}:flags=lanczos,fps=${safeFps},setpts=N/(${safeFps}*TB),` +
    `tmix=frames=2:weights='1 1'`;
}

function buildImageMotionFilter({ fitted, width, height, frames, animation, motionStrength = 1, dynamicScene = false, sceneIndex = 1, fps = 30 }) {
  const safeFrames = Math.max(1, Number(frames) || 1);
  const strength = clamp(motionStrength || 1, 0.25, 3);
  let selected = String(animation || "无动画");
  if (selected === "交替拉镜") selected = Number(sceneIndex) % 2 === 0 ? "右拉镜" : "左拉镜";
  const progress = `min(1,max(0,on/${Math.max(1, safeFrames - 1)}))`;
  const centerX = "trunc((iw-iw/zoom)/4)*2";
  const centerY = "trunc((ih-ih/zoom)/4)*2";
  const zoomInStep = (dynamicScene ? 0.0010 : 0.00035) * strength;
  const zoomOutStep = (dynamicScene ? 0.0008 : 0.00030) * strength;
  const zoomLimit = dynamicScene ? 1.13 : 1.08;
  const safeFps = Math.max(24, Math.min(60, Number(fps) || 30));
  const zoompan = ({ z, x = centerX, y = centerY, prefix = "" }) =>
    `${fitted},${prefix}zoompan=z='${z}':x='${x}':y='${y}':d=${safeFrames}:s=${width}x${height}:fps=${safeFps}`;

  switch (selected) {
    case "无动画":
      return `${fitted},fps=${safeFps},setpts=N/(${safeFps}*TB)`;
    case "左拉镜":
      return buildStablePanFilter({ fitted, width, height, frames: safeFrames, direction: "left", motionStrength: strength, fps: safeFps });
    case "右拉镜":
      return buildStablePanFilter({ fitted, width, height, frames: safeFrames, direction: "right", motionStrength: strength, fps: safeFps });
    case "缩放 II":
      return zoompan({ z: `if(eq(on,0),${zoomLimit},max(1.0,zoom-${zoomOutStep.toFixed(6)}))` });
    case "向左缩小":
      return zoompan({ z: `if(eq(on,0),1.12,max(1.0,zoom-${zoomOutStep.toFixed(6)}))`, x: "0" });
    case "向右缩小":
      return zoompan({ z: `if(eq(on,0),1.12,max(1.0,zoom-${zoomOutStep.toFixed(6)}))`, x: "trunc((iw-iw/zoom)/2)*2" });
    case "形变左缩":
      return zoompan({ z: `if(eq(on,0),1.11,max(1.0,zoom-${zoomOutStep.toFixed(6)}))`, x: `trunc(((iw-iw/zoom)*(1-${progress}))/2)*2`, y: `trunc(((ih-ih/zoom)*(0.35+0.15*${progress}))/2)*2` });
    case "形变右缩":
      return zoompan({ z: `if(eq(on,0),1.11,max(1.0,zoom-${zoomOutStep.toFixed(6)}))`, x: `trunc(((iw-iw/zoom)*${progress})/2)*2`, y: `trunc(((ih-ih/zoom)*(0.35+0.15*${progress}))/2)*2` });
    case "上下分割":
      return zoompan({ z: "1.08", y: `trunc(((ih-ih/zoom)*${progress})/2)*2` });
    case "左右分割":
      return zoompan({ z: "1.08", x: `trunc(((iw-iw/zoom)*${progress})/2)*2` });
    case "向左下降":
      return zoompan({ z: "1.08", x: `trunc(((iw-iw/zoom)*(1-${progress}))/2)*2`, y: `trunc(((ih-ih/zoom)*${progress})/2)*2` });
    case "向右下降":
      return zoompan({ z: "1.08", x: `trunc(((iw-iw/zoom)*${progress})/2)*2`, y: `trunc(((ih-ih/zoom)*${progress})/2)*2` });
    case "旋转缩小":
      return `${zoompan({ z: `if(eq(on,0),1.10,max(1.0,zoom-${zoomOutStep.toFixed(6)}))` })},rotate='-0.02*n/${safeFrames}':ow=iw:oh=ih:c=black@0`;
    case "旋转上升":
      return `${zoompan({ z: `min(zoom+${zoomInStep.toFixed(6)},1.10)`, y: `trunc(((ih-ih/zoom)*(1-${progress}))/2)*2` })},rotate='0.02*n/${safeFrames}':ow=iw:oh=ih:c=black@0`;
    case "翻转":
      return zoompan({ z: `min(zoom+${(zoomInStep * .5).toFixed(6)},1.06)`, prefix: "hflip," });
    case "形变缩小":
      return zoompan({ z: `if(eq(on,0),1.12,max(1.0,zoom-${zoomOutStep.toFixed(6)}))`, x: `trunc(((iw-iw/zoom)*(0.25+0.5*${progress}))/2)*2` });
    case "回弹伸缩":
      return zoompan({ z: `1+0.06*sin(PI*${progress})` });
    case "滑滑梯":
      return zoompan({ z: "1.09", x: `trunc(((iw-iw/zoom)*${progress})/2)*2`, y: `trunc(((ih-ih/zoom)*${progress})/2)*2` });
    case "缩放":
    default:
      return zoompan({ z: `min(zoom+${zoomInStep.toFixed(6)},${zoomLimit})` });
  }
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
  const ffmpeg = ffmpegPath(app, config);
  const fallbackSize = imageSize(ratio);
  const width = even(Number(template.canvas?.width || fallbackSize.width));
  const height = even(Number(template.canvas?.height || fallbackSize.height));
  const imageConfig = { ...(template.image || {}), ...(renderOptions.image || {}) };
  const selectedAnimation = renderOptions.animation || imageConfig.animation || "无动画";
  const selectedStrength = renderOptions.motionStrength ?? imageConfig.motionStrength ?? 1;
  const smoothPanMode = ["左拉镜", "右拉镜", "交替拉镜"].includes(String(selectedAnimation));
  const renderFps = smoothPanMode ? 60 : 30;
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
        fps: renderFps
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
      "-t", Number(scene.duration || 0).toFixed(3), "-filter_complex", filter, "-map", "[v]", "-map", "1:a",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-r", String(renderFps),
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
      `[0:a]volume=${narrationGain}[a0];[1:a]volume=${bgmGain},afade=t=out:st=${Math.max(0, total - fadeSeconds)}:d=${fadeSeconds}[a1];[a0][a1]amix=inputs=2:duration=first[a]`,
      "-map", "0:v", "-map", "[a]");
  } else {
    args.push("-map", "0:v", "-map", "0:a");
  }
  onProgress({ phase: "overlay", current: scenes.length, total: scenes.length });
  args.push(
    "-vf", `ass='${escapeFilterPath(assPath)}'`,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-r", String(renderFps),
    "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", "-shortest", finalVideo
  );
  await spawnAsync(ffmpeg, args);
  return { finalVideo, subtitlePath, assPath };
}

async function renderMusicVideo({ app, config, audioPath, images, lyrics, outputDir, ratio }) {
  if (!images.length) throw new Error("至少选择一张图片");
  const ffmpeg = ffmpegPath(app, config);
  const { mediaDuration } = require("./services.cjs");
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
      "-vf", `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},zoompan=z='min(zoom+0.0006,1.07)':d=${frames}:s=${width}x${height}:fps=30,format=yuv420p`,
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
    fs.writeFileSync(subtitlePath, lyricLines.map((line, index) =>
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

module.exports = { writeSrt, renderVideo, renderMusicVideo };
