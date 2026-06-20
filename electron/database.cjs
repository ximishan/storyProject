const Database = require("better-sqlite3");
const crypto = require("node:crypto");

const schema = `
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT DEFAULT '',
  input_text TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  current_step INTEGER DEFAULT 0,
  track TEXT DEFAULT 'character-story',
  style TEXT DEFAULT 'black-white',
  ratio TEXT DEFAULT '9:16',
  output_dir TEXT DEFAULT '',
  error_message TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime')),
  completed_at TEXT
);
CREATE TABLE IF NOT EXISTS task_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  type TEXT NOT NULL,
  step INTEGER,
  detail TEXT,
  data_json TEXT,
  ts INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS draft_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  config TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS custom_styles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  tag TEXT NOT NULL DEFAULT '',
  prefix TEXT NOT NULL DEFAULT '',
  suffix TEXT NOT NULL DEFAULT '',
  negative_prompt TEXT NOT NULL DEFAULT '',
  description TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS user_prompt_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  base_track TEXT NOT NULL,
  step1_rewrite_system_prompt TEXT DEFAULT '',
  step1_metadata_system_prompt TEXT DEFAULT '',
  step3_system_prompt TEXT DEFAULT '',
  style_id TEXT DEFAULT 'cinematic',
  image_seed_pools_json TEXT DEFAULT '[]',
  needs_character_card INTEGER,
  step3_skeleton_modules_json TEXT DEFAULT '[]',
  reference_kind TEXT DEFAULT '',
  image_prompt_template TEXT DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  used_count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS playground_jobs (
  id TEXT PRIMARY KEY,
  prompt TEXT NOT NULL,
  style_id TEXT DEFAULT '',
  provider TEXT NOT NULL,
  ratio TEXT NOT NULL,
  resolution TEXT DEFAULT '1k',
  image_path TEXT DEFAULT '',
  reference_image_path TEXT DEFAULT '',
  status TEXT NOT NULL,
  error_msg TEXT DEFAULT '',
  created_at INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE TABLE IF NOT EXISTS cover_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  prompt TEXT DEFAULT '',
  title_position TEXT DEFAULT 'center',
  title_color TEXT DEFAULT '#FFFFFF',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS llm_profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  provider TEXT NOT NULL,
  protocol TEXT NOT NULL,
  base_url TEXT DEFAULT '',
  api_key TEXT DEFAULT '',
  model TEXT DEFAULT '',
  proxy_url TEXT DEFAULT '',
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS bgm_library (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS voice_presets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  provider TEXT NOT NULL,
  voice_id TEXT NOT NULL,
  source_audio_path TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  last_used_at TEXT
);`;

function openDatabase(path) {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(schema);
  migrateTasks(db);
  migratePromptTemplates(db);
  seedTemplates(db);
  refreshBuiltinTemplates(db);
  seedCoverTemplates(db);
  return db;
}

function migrateTasks(db) {
  const columns = new Set(db.prepare("PRAGMA table_info(tasks)").all().map(column => column.name));
  const additions = [
    ["pipeline_data", "TEXT"],
    ["video_path", "TEXT DEFAULT ''"],
    ["draft_dir", "TEXT DEFAULT ''"],
    ["target_scenes", "INTEGER DEFAULT 8"],
    ["tts_provider", "TEXT DEFAULT 'system'"],
    ["tts_speed", "REAL DEFAULT 1.0"],
    ["prompt_template_id", "TEXT DEFAULT ''"]
    ,["rewrite_intensity", "TEXT DEFAULT 'standard'"]
    ,["narrative_pov", "TEXT DEFAULT 'original'"]
    ,["keep_promotion", "INTEGER DEFAULT 0"]
    ,["material_source", "TEXT DEFAULT 'ai'"]
    ,["target_length", "INTEGER"]
    ,["template_id", "TEXT DEFAULT 'default-portrait-9-16'"]
    ,["reference_image_path", "TEXT DEFAULT ''"]
    ,["cover_image_mode", "TEXT DEFAULT 'off'"]
    ,["cover_template_id", "TEXT DEFAULT 'cinematic-poster'"]
    ,["cover_path", "TEXT DEFAULT ''"]
    ,["pause_mode", "TEXT DEFAULT 'script'"]
    ,["cancel_requested", "INTEGER DEFAULT 0"]
    ,["queue_order", "INTEGER DEFAULT 0"]
    ,["source_mode", "TEXT DEFAULT 'paste'"]
    ,["source_query", "TEXT DEFAULT ''"]
    ,["source_requirements", "TEXT DEFAULT ''"]
    ,["bgm_id", "TEXT DEFAULT 'builtin'"]
    ,["speaker", "TEXT DEFAULT 'zh_male_dongfanghaoran_uranus_bigtts'"]
    ,["task_type", "TEXT DEFAULT 'story'"]
    ,["script_format", "TEXT DEFAULT 'narration'"]
    ,["podcast_image_mode", "TEXT DEFAULT 'multi'"]
    ,["podcast_speakers", "TEXT DEFAULT 'mizai-dayi'"]
    ,["processing_mode", "TEXT DEFAULT 'auto'"]
    ,["pause_points", "TEXT DEFAULT '[]'"]
    ,["video_intro", "INTEGER DEFAULT 0"]
    ,["video_intro_duration", "INTEGER DEFAULT 0"]
    ,["research_web", "INTEGER DEFAULT 1"]
    ,["research_ai", "INTEGER DEFAULT 0"]
    ,["research_ima", "INTEGER DEFAULT 0"]
  ];
  for (const [name, sql] of additions) {
    if (!columns.has(name)) db.exec(`ALTER TABLE tasks ADD COLUMN ${name} ${sql}`);
  }
}

function migratePromptTemplates(db) {
  const columns = new Set(db.prepare("PRAGMA table_info(user_prompt_templates)").all().map(column => column.name));
  const additions = [
    ["step1_metadata_system_prompt", "TEXT DEFAULT ''"],
    ["image_seed_pools_json", "TEXT DEFAULT '[]'"],
    ["needs_character_card", "INTEGER"],
    ["step3_skeleton_modules_json", "TEXT DEFAULT '[]'"],
    ["reference_kind", "TEXT DEFAULT ''"]
    ,["image_prompt_template", "TEXT DEFAULT ''"]
  ];
  for (const [name, sql] of additions) {
    if (!columns.has(name)) db.exec(`ALTER TABLE user_prompt_templates ADD COLUMN ${name} ${sql}`);
  }
}

function builtinTemplateRows() {
  return [
    {
      id: "default-portrait-9-16", name: "默认竖屏",
      config: {
        canvas: { width: 1080, height: 1920, ratio: "9:16", backgroundColor: "#000000", backgroundImage: "" },
        image: { ratio: "9:16", fit: "cover", top: 0, height: 1, animation: "缩放", motionStrength: 1 },
        title: { visible: true, x: 0, y: 0.04739583333333333, fontSize: 25, color: "#FFDE00", alpha: 1, bold: true, underline: true, align: 1, letterSpacing: 0, lineSpacing: 0, border: { color: "#000000", width: 40, alpha: 1 } },
        subtitle: { visible: true, x: 0, y: -0.21666666666666667, fontSize: 12, color: "#FFFFFF", alpha: 1, bold: false, underline: false, align: 1, letterSpacing: 2, lineSpacing: 4, border: { color: "#000000", width: 40, alpha: 1 } },
        caption: { visible: true, x: 0, y: -0.21510416666666668, fontSize: 12, color: "#FFDE00", alpha: 1, bold: false, underline: false, align: 1, letterSpacing: 0, lineSpacing: 0, border: { color: "#000000", width: 0, alpha: 0 }, maxCharsPerLine: 12, background: { color: "#000000", alpha: 0.5, roundRadius: 0.3 } },
        disclaimer: { visible: true, x: 0, y: -0.903125, fontSize: 8, color: "#FFFFFF", alpha: 0.26, bold: false, underline: false, align: 1, letterSpacing: 0, lineSpacing: 5, border: { color: "#000000", width: 40, alpha: 1 }, text: "图片由AI生成与网络下载\n科普视频，无不良引导" },
        audio: { narrationVolume: 10, bgmVolume: 3, bgmFadeOutMs: 2000, defaultBgmId: "" }
      }
    },
    {
      id: "builtin-portrait-4-3", name: "竖屏4:3",
      config: {
        canvas: { width: 1080, height: 1920, ratio: "9:16", backgroundColor: "#000000", backgroundImage: "" },
        image: { ratio: "4:3", fit: "cover", top: 0.2890625, height: 0.421875, animation: "缩放", motionStrength: 1 },
        title: { visible: true, x: 0, y: 0.8357783211083945, fontSize: 20, color: "#FFDE00", alpha: 1, bold: true, underline: false, align: 1, letterSpacing: 0, lineSpacing: 0, border: { color: "#000000", width: 40, alpha: 1 } },
        subtitle: { visible: true, x: 0, y: 0.5953125, fontSize: 12, color: "#FFFFFF", alpha: 1, bold: false, underline: false, align: 1, letterSpacing: 2, lineSpacing: 4, border: { color: "#000000", width: 40, alpha: 1 } },
        caption: { visible: true, x: 0, y: -0.5572916666666666, fontSize: 12, color: "#FFDE00", alpha: 1, bold: false, underline: false, align: 1, letterSpacing: 0, lineSpacing: 0, border: { color: "#000000", width: 0, alpha: 0 }, maxCharsPerLine: 12, background: { color: "#000000", alpha: 0.5, roundRadius: 0.3 } },
        disclaimer: { visible: true, x: 0, y: -0.8141628912685337, fontSize: 8, color: "#FFFFFF", alpha: 1, bold: false, underline: false, align: 1, letterSpacing: 0, lineSpacing: 5, border: { color: "#000000", width: 40, alpha: 1 }, text: "图片由AI生成与网络下载\n科普视频，无不良引导" },
        audio: { narrationVolume: 10, bgmVolume: 3, bgmFadeOutMs: 2000, defaultBgmId: "" }
      }
    },
    {
      id: "builtin-landscape-16-9", name: "横屏16:9",
      config: {
        canvas: { width: 1920, height: 1080, ratio: "16:9", backgroundColor: "#000000", backgroundImage: "" },
        image: { ratio: "16:9", fit: "cover", top: 0, height: 1, animation: "缩放", motionStrength: 1 },
        title: { visible: true, x: 0, y: 0.12777777777777777, fontSize: 20, color: "#FFDE00", alpha: 1, bold: true, underline: false, align: 1, letterSpacing: 0, lineSpacing: 0, border: { color: "#000000", width: 40, alpha: 1 } },
        subtitle: { visible: true, x: 0, y: -0.43333333333333335, fontSize: 8, color: "#FFFFFF", alpha: 1, bold: false, underline: false, align: 1, letterSpacing: 2, lineSpacing: 4, border: { color: "#000000", width: 40, alpha: 1 } },
        caption: { visible: true, x: 0, y: -0.6425925925925926, fontSize: 8, color: "#FFDE00", alpha: 1, bold: false, underline: false, align: 1, letterSpacing: 0, lineSpacing: 0, border: { color: "#000000", width: 0, alpha: 0 }, maxCharsPerLine: 12, background: { color: "#000000", alpha: 0.5, roundRadius: 0.3 } },
        disclaimer: { visible: true, x: 0, y: -0.8787037037037037, fontSize: 5, color: "#FFFFFF", alpha: 0.5, bold: false, underline: false, align: 1, letterSpacing: 0, lineSpacing: 5, border: { color: "#000000", width: 40, alpha: 1 }, text: "图片由AI生成与网络下载 科普视频，无不良引导" },
        audio: { narrationVolume: 10, bgmVolume: 3, bgmFadeOutMs: 2000, defaultBgmId: "" }
      }
    }
  ];
}

function seedTemplates(db) {
  const count = db.prepare("SELECT count(*) AS count FROM draft_templates").get().count;
  if (count) return;
  const now = new Date().toISOString();
  const insert = db.prepare(`
    INSERT INTO draft_templates (id,name,is_default,config,created_at,updated_at)
    VALUES (@id,@name,1,@config,@now,@now)
  `);
  const tx = db.transaction(() => {
    for (const { id, name, config } of builtinTemplateRows()) {
      insert.run({
        id, name, now,
        config: JSON.stringify(config)
      });
    }
  });
  tx();
}

function refreshBuiltinTemplates(db) {
  const now = new Date().toISOString();
  const update = db.prepare("UPDATE draft_templates SET name=?,config=?,updated_at=? WHERE id=? AND is_default=1");
  for (const { id, name, config } of builtinTemplateRows()) {
    update.run(name, JSON.stringify(config), now, id);
  }
}

function seedCoverTemplates(db) {
  const count = db.prepare("SELECT count(*) AS count FROM cover_templates").get().count;
  if (count) return;
  const now = new Date().toISOString();
  const insert = db.prepare("INSERT INTO cover_templates(id,name,description,prompt,title_position,title_color,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)");
  [
    ["cinematic-poster", "电影海报感", "强光影与主体特写", "电影海报构图，主体突出，强烈光影，预留标题区域", "center", "#FFFFFF"],
    ["minimal", "极简留白", "简洁背景与大面积留白", "极简摄影，大面积干净留白，高级排版空间", "top", "#FFFFFF"],
    ["emotion", "人物情绪", "人物近景与情绪表达", "人物情绪特写，电影感，背景虚化，预留标题空间", "bottom", "#FFE066"],
    ["chinese", "国风古韵", "水墨与传统构图", "中国传统美学，国风画面，水墨意境，海报构图", "top", "#F5D6A1"]
  ].forEach(item => insert.run(...item, now, now));
}

function createTask(db, input) {
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO tasks (
      id,title,input_text,track,style,ratio,target_scenes,tts_speed,prompt_template_id,
      rewrite_intensity,narrative_pov,keep_promotion,material_source,target_length,template_id,
      reference_image_path,cover_image_mode,cover_template_id,pause_mode,source_mode,source_query,source_requirements,bgm_id,
      speaker,task_type,script_format,podcast_image_mode,podcast_speakers,processing_mode,pause_points,
      video_intro,video_intro_duration,research_web,research_ai,research_ima
    )
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    id, input.title, input.inputText, input.track, input.style, input.ratio,
    input.targetScenes ? Number(input.targetScenes) : null, Number(input.ttsSpeed || 1), input.promptTemplateId || "",
    input.rewriteIntensity || "standard", input.narrativePov || "original", input.keepPromotion ? 1 : 0,
    input.materialSource || "ai", input.targetLength ? Number(input.targetLength) : null,
    input.templateId || "default-portrait-9-16", input.referenceImagePath || "",
    input.coverImageMode || "off", input.coverTemplateId || "cinematic-poster",
    input.pauseMode || "none", input.sourceMode || "paste", input.sourceQuery || "", input.sourceRequirements || "",
    input.bgmId || "builtin", input.speaker || "zh_male_dongfanghaoran_uranus_bigtts",
    input.taskType || "story", input.scriptFormat || (input.taskType === "podcast" ? "dialogue" : "narration"),
    input.podcastImageMode || "multi", input.podcastSpeakers || "mizai-dayi", input.processingMode || "auto",
    JSON.stringify(input.pausePoints || []), Number(input.videoIntro || 0), Number(input.videoIntroDuration || 0),
    input.researchWeb === false ? 0 : 1, input.researchAi ? 1 : 0, input.researchIma ? 1 : 0
  );
  return db.prepare("SELECT * FROM tasks WHERE id=?").get(id);
}

module.exports = { openDatabase, createTask };
