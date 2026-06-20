const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { openDatabase, createTask } = require("../electron/database.cjs");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "storybound-schema-"));
const db = openDatabase(path.join(root, "test.db"));

const templates = db.prepare("SELECT * FROM draft_templates ORDER BY id").all();
if (templates.length !== 3) throw new Error(`expected 3 built-in templates, got ${templates.length}`);
for (const template of templates) {
  const config = JSON.parse(template.config);
  for (const key of ["canvas", "image", "title", "subtitle", "caption", "disclaimer", "audio"]) {
    if (!config[key]) throw new Error(`${template.id} missing ${key}`);
  }
}

const task = createTask(db, {
  title: "完整任务配置测试",
  inputText: "第一位主播提出问题。第二位主播回答问题。",
  track: "character-story",
  style: "black-white",
  ratio: "9:16",
  targetScenes: 4,
  ttsSpeed: 0.85,
  promptTemplateId: "character-story",
  rewriteIntensity: "deep",
  narrativePov: "first",
  keepPromotion: false,
  materialSource: "ai",
  templateId: "default-portrait-9-16",
  coverImageMode: "title",
  coverTemplateId: "cinematic-poster",
  pauseMode: "every",
  bgmId: "builtin",
  speaker: "zh_male_dongfanghaoran_uranus_bigtts",
  taskType: "podcast",
  scriptFormat: "dialogue",
  podcastImageMode: "multi",
  podcastSpeakers: "mizai-dayi",
  processingMode: "semi",
  pausePoints: [0, 3, 5],
  videoIntro: 3,
  videoIntroDuration: 5,
  researchWeb: true,
  researchAi: true,
  researchIma: false
});

const expected = {
  task_type: "podcast",
  script_format: "dialogue",
  podcast_image_mode: "multi",
  podcast_speakers: "mizai-dayi",
  processing_mode: "semi",
  pause_points: "[0,3,5]",
  video_intro: 3,
  video_intro_duration: 5,
  research_web: 1,
  research_ai: 1,
  research_ima: 0
};
for (const [key, value] of Object.entries(expected)) {
  if (task[key] !== value) throw new Error(`${key}: expected ${value}, got ${task[key]}`);
}

db.close();
fs.rmSync(root, { recursive: true, force: true });
console.log(JSON.stringify({ templates: templates.length, taskFields: Object.keys(expected).length }));
