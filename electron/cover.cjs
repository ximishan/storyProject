const fs = require("node:fs");
const path = require("node:path");
const { spawnAsync, ffmpegPath, imageSize, generateSceneImage } = require("./services.cjs");
const { coverReferencePaths } = require("./reference-routing.cjs");

function assEscape(text) {
  return String(text || "").replace(/[{}]/g, "").replace(/\n/g, "\\N");
}

async function generateCover({ app, config, task, outputDir, script, sourceImage, template }) {
  const coverMode = task.cover_image_mode === "title" ? "titled"
    : task.cover_image_mode === "blank" ? "plain" : (task.cover_image_mode || "off");
  if (coverMode === "off") return "";
  const coverDir = path.join(outputDir, "cover");
  fs.mkdirSync(coverDir, { recursive: true });
  const baseImage = path.join(coverDir, "base.png");
  if (sourceImage && fs.existsSync(sourceImage)) {
    fs.copyFileSync(sourceImage, baseImage);
  } else {
    await generateSceneImage({
      app, config,
      prompt: `${template?.prompt || "海报构图"}，${script.summary || script.title}`,
      styleConfig: task.style_config,
      destination: baseImage, ratio: "3:4", index: 0,
      referenceImagePath: coverReferencePaths(task, script?.metadata?.reference_kind || "auto")
    });
  }
  const output = path.join(coverDir, "cover.jpg");
  const { width, height } = imageSize("3:4");
  if (coverMode === "plain") {
    await spawnAsync(ffmpegPath(app, config), [
      "-y", "-i", baseImage,
      "-vf", `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`,
      "-frames:v", "1", output
    ]);
    return output;
  }
  const assPath = path.join(coverDir, "title.ass");
  const alignment = template?.title_position === "top" ? 8 : template?.title_position === "bottom" ? 2 : 5;
  const color = String(template?.title_color || "#FFFFFF").replace("#", "");
  const bgr = color.length === 6 ? `${color.slice(4, 6)}${color.slice(2, 4)}${color.slice(0, 2)}` : "FFFFFF";
  fs.writeFileSync(assPath, `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
[V4+ Styles]
Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding
Style: Default,Microsoft YaHei,${Math.round(width / 13)},&H00${bgr},&H00FFFFFF,&H90000000,&H70000000,-1,0,0,0,100,100,2,0,1,5,2,${alignment},${Math.round(width * .08)},${Math.round(width * .08)},${Math.round(height * .12)},1
[Events]
Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text
Dialogue: 0,0:00:00.00,0:00:05.00,Default,,0,0,0,,${assEscape(task.title || script.title)}
`, "utf8");
  const escaped = assPath.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
  await spawnAsync(ffmpegPath(app, config), [
    "-y", "-i", baseImage,
    "-vf", `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},ass='${escaped}'`,
    "-frames:v", "1", output
  ]);
  return output;
}

module.exports = { generateCover };
