const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { writeSrt, _captionTest } = require("../electron/media.cjs");
const { _pipelineTest } = require("../electron/pipeline.cjs");

const maxChars = 12;
const narration = "年轻时，她常常站在家里的商店里，透过窗户看街上的马车和行人。";
const task = { draft_template: { caption: { maxCharsPerLine: maxChars } } };
const scene = {
  index: 1,
  duration: 6,
  narration,
  // 即使规划阶段已有字幕分段，TTS 也必须读取完整 narration。
  caption_segments: ["年轻时她常常站在家里的商店里", "透过窗户看街上的马车和行人"]
};

assert.equal(
  _pipelineTest.sceneVoiceText(scene),
  narration,
  "TTS 必须一次性读取完整旁白，不能按照字幕分段合成"
);

const timings = _pipelineTest.syncSceneCaptionTimings(scene, scene.duration, task);
assert.ok(timings.length >= 2, "长旁白应在字幕显示层按自然语义拆成多条");
assert.equal(timings[0].start, 0, "第一条字幕必须从音频起点开始");
assert.equal(timings.at(-1).end, scene.duration, "最后一条字幕必须跟到音频结束");
for (let index = 1; index < timings.length; index += 1) {
  assert.equal(timings[index].start, timings[index - 1].end, "字幕时间轴必须连续跟随语音");
}
assert.ok(timings.every(item => item.text && !/[\r\n]/u.test(item.text)), "每条字幕必须保持单行");

const normalizedNarration = _captionTest.stripCaptionDisplayPunctuation(narration);
assert.equal(
  timings.map(item => item.text).join(""),
  normalizedNarration,
  "字幕切分后不得漏字、添字或改变旁白内容"
);

// 旧任务中即使已经存在一条超长 caption_timing，渲染时也只能拆字幕，不能改音频。
const legacyScene = {
  duration: 6,
  narration,
  caption_timings: [{ text: narration, start: 0, end: 6 }]
};
const schedule = _captionTest.sceneCaptionSchedule(legacyScene, maxChars);
assert.ok(schedule.length >= 2, "超长旧字幕时间段应在显示层自然拆分");
assert.equal(schedule[0].start, 0);
assert.equal(schedule.at(-1).end, 6);
assert.ok(schedule.every(item => !/[\r\n]/u.test(item.text)), "渲染字幕不得包含换行");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "storybound-subtitle-follow-audio-"));
const srtPath = path.join(tempDir, "subtitles.srt");
writeSrt([legacyScene], srtPath, maxChars);
const srt = fs.readFileSync(srtPath, "utf8").trim();
const srtBlocks = srt.split(/\r?\n\r?\n/);
assert.equal(srtBlocks.length, schedule.length, "SRT 条目数必须与字幕显示时间轴一致");
for (const block of srtBlocks) {
  const lines = block.split(/\r?\n/);
  assert.equal(lines.length, 3, "每个 SRT 条目只能有一行字幕正文");
}

const assPath = path.join(tempDir, "final-overlay.ass");
_captionTest.writeAssOverlay({
  scenes: [legacyScene],
  destination: assPath,
  width: 1080,
  height: 1920,
  template: {
    caption: {
      visible: true,
      maxCharsPerLine: maxChars,
      fontSize: 12,
      color: "#FFFFFF",
      background: { color: "#000000", alpha: 0.5 },
      border: { color: "#000000", width: 0, alpha: 0 }
    },
    title: { visible: false },
    subtitle: { visible: false },
    disclaimer: { visible: false }
  },
  title: "",
  subtitle: "",
  renderOptions: {
    burnCaption: true,
    burnTitle: false,
    burnSubtitle: false,
    burnDisclaimer: false
  }
});
const captionRows = fs.readFileSync(assPath, "utf8")
  .split(/\r?\n/)
  .filter(line => line.includes(",Caption,"));
assert.equal(captionRows.length, schedule.length, "ASS 事件数必须与字幕显示时间轴一致");
assert.ok(captionRows.every(line => !line.includes("\\N")), "旁白字幕不得插入 ASS 换行标记");

const pipelineSource = fs.readFileSync(path.join(__dirname, "../electron/pipeline.cjs"), "utf8");
const synthBlock = pipelineSource.match(/async function synthesizeSegmentedScene[\s\S]*?\n}\n\nfunction writePublishAssets/)?.[0] || "";
assert.equal((synthBlock.match(/synthesizeSpeech\(/g) || []).length, 1, "每个镜头只能调用一次 TTS");
assert.ok(!synthBlock.includes("concat.txt"), "TTS 不得再把字幕片段逐条合成后拼接");

fs.rmSync(tempDir, { recursive: true, force: true });
console.log("Subtitle follows continuous TTS regression test passed");
