const fs = require("node:fs");
const path = require("node:path");
const { spawnAsync, resolveResource } = require("./services.cjs");

function templateForRatio(ratio) {
  const sizes = {
    "9:16": { width: 1080, height: 1920 },
    "3:4": { width: 1080, height: 1440 },
    "1:1": { width: 1080, height: 1080 },
    "4:3": { width: 1440, height: 1080 },
    "16:9": { width: 1920, height: 1080 }
  };
  const size = sizes[ratio] || sizes["9:16"];
  return {
    canvas: { width: size.width, height: size.height, ratio, backgroundColor: "#000000", backgroundImage: "" },
    image: { ratio, fit: "cover", top: 0, height: 1, animation: "左拉镜", motionStrength: 0.5 },
    title: { visible: true, x: 0, y: .68, fontSize: 25, color: "#FFDE00", alpha: 1, bold: true, align: 1, border: { color: "#000000", width: 40, alpha: 1 } },
    caption: { visible: true, x: 0, y: -.58, fontSize: 12, color: "#FFFFFF", alpha: 1, align: 1, maxCharsPerLine: 14, background: { color: "#000000", alpha: .5, roundRadius: .3 }, border: { color: "#000000", width: 0, alpha: 0 } },
    audio: { narrationVolume: 10, bgmVolume: 3, bgmFadeOutMs: 2000 }
  };
}

async function generateJianyingDraft({ app, config, task, outputDir, scenes, bgmPath }) {
  const sentences = scenes.map(scene => ({
    id: scene.index,
    cap: scene.narration,
    desc_prompt: scene.image_prompt,
    image_path: scene.image_path || "",
    video_path: scene.video_path || ""
  }));
  const segments = scenes.map(scene => ({
    index: scene.index,
    duration: scene.duration,
    path: scene.audio_path,
    image_path: scene.image_path || "",
    video_path: scene.video_path || ""
  }));
  fs.writeFileSync(path.join(outputDir, "02-sentences.json"), JSON.stringify(sentences, null, 2), "utf8");
  fs.writeFileSync(path.join(outputDir, "03-segments.json"), JSON.stringify(segments, null, 2), "utf8");

  const exe = resolveResource(app, "draft-generator.exe");
  if (!fs.existsSync(exe)) throw new Error("剪映草稿生成器不存在");
  let subtitle = [];
  try {
    const summary = JSON.parse(task.pipeline_data || "{}").summary;
    if (summary) subtitle = [summary];
  } catch {}
  const input = {
    task_dir: outputDir,
    cover_title: { title: task.title, subtitle },
    bgm_path: bgmPath || "",
    jianying_draft_path: config.jianying?.draft_path || "",
    template: task.draft_template || templateForRatio(task.ratio),
    task_title: task.title,
    dynamic_videos: scenes.filter(scene => scene.video_path).map(scene => ({
      index: scene.index,
      video_path: scene.video_path,
      duration: scene.duration
    }))
  };
  const { stdout } = await spawnAsync(exe, ["--input", JSON.stringify(input)]);
  const line = stdout.trim().split(/\r?\n/).filter(Boolean).pop();
  const result = JSON.parse(line || "{}");
  if (!result.success) throw new Error(result.error || "剪映草稿生成失败");
  return result;
}

async function generateMusicDraft({ app, config, title, outputDir, audioPath, audioDuration, images, lyrics, ratio }) {
  const exe = resolveResource(app, "draft-generator.exe");
  if (!fs.existsSync(exe)) throw new Error("剪映草稿生成器不存在");
  const each = audioDuration / images.length;
  const assignments = images.map((imagePath, index) => ({
    type: "image",
    image_path: imagePath,
    start: index * each,
    end: (index + 1) * each
  }));
  const lyricLines = String(lyrics || "").split(/\r?\n/).map(text => text.trim()).filter(Boolean);
  const lyricDuration = lyricLines.length ? audioDuration / lyricLines.length : 0;
  const lyricItems = lyricLines.map((text, index) => ({
    text,
    start: index * lyricDuration,
    end: (index + 1) * lyricDuration
  }));
  const input = {
    mode: "music_mv",
    work_dir: outputDir,
    audio_path: audioPath,
    audio_duration: audioDuration,
    material_source: "local",
    assignments,
    lyrics: lyricItems,
    jianying_draft_path: config.jianying?.draft_path || "",
    task_title: title,
    template: templateForRatio(ratio),
    cover_title: { title, subtitle: [] },
    cover_image_path: images[0]
  };
  const { stdout } = await spawnAsync(exe, ["--input", JSON.stringify(input)]);
  const line = stdout.trim().split(/\r?\n/).filter(Boolean).pop();
  const result = JSON.parse(line || "{}");
  if (!result.success) throw new Error(result.error || "音乐 MV 草稿生成失败");
  return result;
}

module.exports = { generateJianyingDraft, generateMusicDraft, templateForRatio };
