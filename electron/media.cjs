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

function wrapCaption(text, maxChars) {
  if (!maxChars || text.length <= maxChars) return text;
  const lines = [];
  for (let index = 0; index < text.length; index += maxChars) lines.push(text.slice(index, index + maxChars));
  return lines.join("\n");
}

function writeSrt(scenes, destination, maxChars = 0) {
  let cursor = 0;
  const blocks = scenes.map((scene, index) => {
    const start = cursor;
    cursor += scene.duration;
    const caption = `${scene.speaker_name ? `${scene.speaker_name}：` : ""}${scene.narration.trim()}`;
    return `${index + 1}\n${srtTime(start)} --> ${srtTime(cursor)}\n${wrapCaption(caption, maxChars)}\n`;
  });
  atomicWriteFile(destination, blocks.join("\n"), "utf8");
  return destination;
}

function escapeFilterPath(file) {
  return file.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
}


function buildImageMotionFilter({ fitted, width, height, frames, animation, motionStrength = 1, dynamicScene = false }) {
  const safeFrames = Math.max(1, Number(frames) || 1);
  const strength = Math.max(0.25, Math.min(3, Number(motionStrength) || 1));
  const selected = dynamicScene && animation === "无动画" ? "缩放" : String(animation || "缩放");
  const progress = `on/${safeFrames}`;
  const centerX = "(iw-iw/zoom)/2";
  const centerY = "(ih-ih/zoom)/2";
  const zoomInStep = (dynamicScene ? 0.0012 : 0.00045) * strength;
  const zoomOutStep = (dynamicScene ? 0.0010 : 0.00038) * strength;
  const zoomLimit = dynamicScene ? 1.16 : 1.10;
  const zoompan = ({ z, x = centerX, y = centerY, prefix = "" }) =>
    `${fitted},${prefix}zoompan=z='${z}':x='${x}':y='${y}':d=${safeFrames}:s=${width}x${height}:fps=30`;

  switch (selected) {
    case "无动画":
      return `${fitted},fps=30`;
    case "缩放 II":
      return zoompan({ z: `if(eq(on,0),${zoomLimit},max(1.0,zoom-${zoomOutStep.toFixed(6)}))` });
    case "左拉镜":
      return zoompan({ z: "1.15", x: `(iw-iw/zoom)*(1-${progress})` });
    case "右拉镜":
      return zoompan({ z: "1.15", x: `(iw-iw/zoom)*${progress}` });
    case "向左缩小":
      return zoompan({ z: `if(eq(on,0),1.16,max(1.0,zoom-${zoomOutStep.toFixed(6)}))`, x: "0" });
    case "向右缩小":
      return zoompan({ z: `if(eq(on,0),1.16,max(1.0,zoom-${zoomOutStep.toFixed(6)}))`, x: "iw-iw/zoom" });
    case "形变左缩":
      return zoompan({ z: `if(eq(on,0),1.14,max(1.0,zoom-${zoomOutStep.toFixed(6)}))`, x: `(iw-iw/zoom)*(1-${progress})`, y: `(ih-ih/zoom)*(0.35+0.15*${progress})` });
    case "形变右缩":
      return zoompan({ z: `if(eq(on,0),1.14,max(1.0,zoom-${zoomOutStep.toFixed(6)}))`, x: `(iw-iw/zoom)*${progress}`, y: `(ih-ih/zoom)*(0.35+0.15*${progress})` });
    case "上下分割":
      return zoompan({ z: "1.10", y: `(ih-ih/zoom)*${progress}` });
    case "左右分割":
      return zoompan({ z: "1.10", x: `(iw-iw/zoom)*${progress}` });
    case "向左下降":
      return zoompan({ z: "1.10", x: `(iw-iw/zoom)*(1-${progress})`, y: `(ih-ih/zoom)*${progress}` });
    case "向右下降":
      return zoompan({ z: "1.10", x: `(iw-iw/zoom)*${progress}`, y: `(ih-ih/zoom)*${progress}` });
    case "旋转缩小":
      return `${zoompan({ z: `if(eq(on,0),1.15,max(1.0,zoom-${zoomOutStep.toFixed(6)}))` })},rotate='-0.025*n/${safeFrames}':ow=iw:oh=ih:c=black@0`;
    case "旋转上升":
      return `${zoompan({ z: `min(zoom+${zoomInStep.toFixed(6)},1.12)`, y: `(ih-ih/zoom)*(1-${progress})` })},rotate='0.025*n/${safeFrames}':ow=iw:oh=ih:c=black@0`;
    case "翻转":
      return zoompan({ z: `min(zoom+${(zoomInStep * .6).toFixed(6)},1.08)`, prefix: "hflip," });
    case "形变缩小":
      return zoompan({ z: `if(eq(on,0),1.17,max(1.0,zoom-${zoomOutStep.toFixed(6)}))`, x: `(iw-iw/zoom)*(0.25+0.5*${progress})` });
    case "回弹伸缩":
      return zoompan({ z: `1+0.09*sin(PI*${progress})` });
    case "滑滑梯":
      return zoompan({ z: "1.12", x: `(iw-iw/zoom)*${progress}`, y: `(ih-ih/zoom)*${progress}` });
    case "缩放":
    default:
      return zoompan({ z: `min(zoom+${zoomInStep.toFixed(6)},${zoomLimit})` });
  }
}

async function renderVideo({ app, config, scenes, outputDir, ratio, bgmPath, template = {}, videoIntro = 0 }) {
  const ffmpeg = ffmpegPath(app, config);
  const fallbackSize = imageSize(ratio);
  const width = Number(template.canvas?.width || fallbackSize.width);
  const height = Number(template.canvas?.height || fallbackSize.height);
  const imageConfig = template.image || {};
  const regionTop = Math.max(0, Math.min(height - 2, Math.round(Number(imageConfig.top || 0) * height)));
  const regionHeight = Math.max(2, Math.min(height - regionTop, Math.round(Number(imageConfig.height || 1) * height)));
  const backgroundColor = String(template.canvas?.backgroundColor || "#000000");
  const ffBackgroundColor = backgroundColor.replace(/^#/, "0x");
  const backgroundImage = String(template.canvas?.backgroundImage || "");
  const renderDir = path.join(outputDir, "render");
  fs.mkdirSync(renderDir, { recursive: true });
  const clips = [];

  for (const scene of scenes) {
    const clip = path.join(renderDir, `${String(scene.index).padStart(3, "0")}.mp4`);
    if (fileLooksUsable(clip, 1024)) {
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
    const frames = Math.max(1, Math.ceil(scene.duration * 30));
    const fitMode = imageConfig.fit === "contain" ? "decrease" : "increase";
    const fitted = imageConfig.fit === "contain"
      ? `scale=${width}:${regionHeight}:force_original_aspect_ratio=${fitMode},pad=${width}:${regionHeight}:(ow-iw)/2:(oh-ih)/2:color=${ffBackgroundColor}`
      : `scale=${width}:${regionHeight}:force_original_aspect_ratio=${fitMode},crop=${width}:${regionHeight}`;
    const dynamicScene = Number(videoIntro) === -1 || (Number(videoIntro) > 0 && Number(scene.index) <= Number(videoIntro));
    const hasGeneratedVideo = Boolean(scene.video_path && fs.existsSync(scene.video_path));
    let visualFilter;
    if (hasGeneratedVideo) {
      const sourceDuration = Math.max(.1, await mediaDuration(app, config, scene.video_path));
      const stretch = Math.max(.01, Number(scene.duration || sourceDuration) / sourceDuration);
      visualFilter = `${fitted},setpts=${stretch.toFixed(8)}*PTS,fps=30`;
    } else {
      visualFilter = buildImageMotionFilter({
        fitted,
        width,
        height: regionHeight,
        frames,
        animation: imageConfig.animation === "无" ? "无动画" : imageConfig.animation,
        motionStrength: imageConfig.motionStrength,
        dynamicScene
      });
    }
    const useBackgroundImage = backgroundImage && fs.existsSync(backgroundImage);
    const backgroundFilter = useBackgroundImage
      ? `[2:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}[bg];`
      : "";
    const filter = `[0:v]${visualFilter}[img];${backgroundFilter}[2:v][img]overlay=0:${regionTop}:shortest=1,format=yuv420p[v]`;
    const clipArgs = hasGeneratedVideo
      ? ["-y", "-i", scene.video_path, "-i", scene.audio_path]
      : ["-y", "-loop", "1", "-i", scene.image_path, "-i", scene.audio_path];
    if (useBackgroundImage) clipArgs.push("-loop", "1", "-i", backgroundImage);
    else clipArgs.push("-f", "lavfi", "-i", `color=c=${ffBackgroundColor}:s=${width}x${height}:r=30`);
    clipArgs.push(
      "-t", scene.duration.toFixed(3), "-filter_complex", filter, "-map", "[v]", "-map", "1:a",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "21",
      "-c:a", "aac", "-b:a", "160k", "-shortest", clip
    );
    await spawnAsync(ffmpeg, clipArgs);
    scene.render_clip_status = "completed";
    clips.push(clip);
  }

  const concatFile = path.join(renderDir, "concat.txt");
  atomicWriteFile(concatFile, clips.map(file => `file '${file.replace(/'/g, "'\\''")}'`).join("\n"), "utf8");
  const joined = path.join(renderDir, "joined.mp4");
  await spawnAsync(ffmpeg, ["-y", "-f", "concat", "-safe", "0", "-i", concatFile, "-c", "copy", joined]);

  const subtitlePath = writeSrt(scenes, path.join(outputDir, "subtitles.srt"), Number(template.caption?.maxCharsPerLine || 0));
  const finalVideo = path.join(outputDir, "final.mp4");
  const args = ["-y", "-i", joined];
  if (bgmPath && fs.existsSync(bgmPath)) {
    const narrationGain = Math.max(0, Number(template.audio?.narrationVolume ?? 1));
    const bgmGain = Math.max(0, Number(template.audio?.bgmVolume ?? .12));
    const fadeSeconds = Math.max(0, Number(template.audio?.bgmFadeOutMs ?? 2000) / 1000);
    const total = scenes.reduce((n, s) => n + s.duration, 0);
    args.push("-stream_loop", "-1", "-i", bgmPath);
    args.push("-filter_complex",
      `[0:a]volume=${narrationGain}[a0];[1:a]volume=${bgmGain},afade=t=out:st=${Math.max(0, total - fadeSeconds)}:d=${fadeSeconds}[a1];[a0][a1]amix=inputs=2:duration=first[a]`,
      "-map", "0:v", "-map", "[a]");
  }
  const caption = template.caption || {};
  const color = String(caption.color || "#FFFFFF").replace("#", "");
  const bgr = color.length === 6 ? `${color.slice(4, 6)}${color.slice(2, 4)}${color.slice(0, 2)}` : "FFFFFF";
  const primaryAlpha = Math.round((1 - Math.max(0, Math.min(1, Number(caption.alpha ?? 1)))) * 255).toString(16).padStart(2, "0");
  const backgroundHex = String(caption.background?.color || "#000000").replace("#", "");
  const backgroundBgr = backgroundHex.length === 6 ? `${backgroundHex.slice(4, 6)}${backgroundHex.slice(2, 4)}${backgroundHex.slice(0, 2)}` : "000000";
  const backgroundAlpha = Math.round((1 - Math.max(0, Math.min(1, Number(caption.background?.alpha || 0)))) * 255).toString(16).padStart(2, "0");
  const fontSize = Math.max(12, Number(caption.fontSize || 18));
  const alignment = Number(caption.align || 1) === 0 ? 1 : Number(caption.align || 1) === 2 ? 3 : 2;
  const marginV = Math.round(Math.abs(Number(caption.y ?? -.22)) * height) || 80;
  const borderStyle = Number(caption.background?.alpha || 0) > 0 ? 3 : 1;
  const outline = Math.max(0, Number(caption.border?.width || 0) / 20);
  args.push(
    "-vf", `subtitles='${escapeFilterPath(subtitlePath)}':force_style='FontName=Microsoft YaHei,FontSize=${fontSize},PrimaryColour=&H${primaryAlpha}${bgr},OutlineColour=&H00000000,BackColour=&H${backgroundAlpha}${backgroundBgr},BorderStyle=${borderStyle},Outline=${outline},Bold=${caption.bold ? -1 : 0},Underline=${caption.underline ? -1 : 0},Spacing=${Number(caption.letterSpacing || 0)},Alignment=${alignment},MarginV=${marginV}'`,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
    "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", "-shortest", finalVideo
  );
  await spawnAsync(ffmpeg, args);
  return { finalVideo, subtitlePath };
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
