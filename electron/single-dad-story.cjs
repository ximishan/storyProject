const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");

const SINGLE_DAD_TEMPLATE_ID = "single-dad-story";
const SINGLE_DAD_STYLE_ID = "single-dad-picturebook";
const SINGLE_DAD_TEMPLATE_NAME = "父女日常故事";

const ASSET_FILES = Object.freeze({
  "DAD-001": "DAD-001.webp",
  "CHILD-001": "CHILD-001.webp",
  "DUO-001": "DUO-001.webp"
});

function isSingleDadStoryTask(task) {
  const track = String(task?.track || "").trim();
  const templateId = String(task?.prompt_template_id || task?.promptTemplateId || task?.prompt_template?.id || "").trim();
  const templateName = String(task?.prompt_template?.name || "").trim();
  return track === SINGLE_DAD_TEMPLATE_ID
    || templateId === SINGLE_DAD_TEMPLATE_ID
    || templateName === SINGLE_DAD_TEMPLATE_NAME;
}

function applySingleDadTaskDefaults(input) {
  if (!isSingleDadStoryTask(input)) return input;
  return {
    ...input,
    track: "family-emotion",
    style: SINGLE_DAD_STYLE_ID,
    targetScenes: Number(input?.targetScenes || 0) > 0 ? Number(input.targetScenes) : 8,
    processingMode: "semi_auto",
    pauseMode: "script",
    pausePoints: [4],
    characterConsistencyMode: "off",
    bgmId: "none",
    videoIntro: 0,
    videoIntroDuration: 0,
    coverImageMode: "off",
    taskType: "story"
  };
}

function singleDadAssetDir() {
  const override = String(process.env.STORYBOUND_SINGLE_DAD_ASSET_DIR || "").trim();
  if (override) return override;
  const packaged = typeof process.resourcesPath === "string"
    ? path.join(process.resourcesPath, "single-dad-story")
    : "";
  const development = path.join(__dirname, "..", "resources", "single-dad-story");
  if (packaged && fs.existsSync(packaged)) return packaged;
  return development;
}

function isReadablePng(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return false;
  try {
    const buffer = fs.readFileSync(filePath);
    return buffer.length > 8
      && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  } catch {
    return false;
  }
}

function singleDadFfmpegPath() {
  const candidates = [];
  if (typeof process.resourcesPath === "string") {
    candidates.push(path.join(process.resourcesPath, "bin", "ffmpeg.exe"));
    candidates.push(path.join(process.resourcesPath, "ffmpeg.exe"));
  }
  candidates.push(path.join(__dirname, "..", "resources", "bin", "ffmpeg.exe"));
  const existing = candidates.find(candidate => fs.existsSync(candidate));
  return existing || "ffmpeg";
}

function singleDadPngCacheDir() {
  const dir = path.join(os.tmpdir(), "storybound-single-dad-story", "png-v1");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function ensurePngAsset(characterId) {
  const sourceFile = ASSET_FILES[characterId];
  if (!sourceFile) return "";

  const assetDir = singleDadAssetDir();
  const directPng = path.join(assetDir, `${characterId}.png`);
  if (isReadablePng(directPng)) return directPng;

  const sourcePath = path.join(assetDir, sourceFile);
  if (!fs.existsSync(sourcePath)) return "";

  const sourceStat = fs.statSync(sourcePath);
  const cacheName = `${characterId}-${sourceStat.size}-${Math.trunc(sourceStat.mtimeMs)}.png`;
  const cachePath = path.join(singleDadPngCacheDir(), cacheName);
  if (isReadablePng(cachePath)) return cachePath;

  const result = spawnSync(singleDadFfmpegPath(), [
    "-hide_banner", "-loglevel", "error", "-y",
    "-i", sourcePath,
    "-frames:v", "1",
    cachePath
  ], {
    windowsHide: true,
    encoding: "utf8"
  });

  if (result.error || result.status !== 0 || !isReadablePng(cachePath)) {
    try { if (fs.existsSync(cachePath)) fs.unlinkSync(cachePath); } catch {}
    const detail = String(result.error?.message || result.stderr || result.stdout || "未知错误").trim();
    throw new Error(`父女角色参考图转 PNG 失败（${characterId}）：${detail || "FFmpeg 未生成有效 PNG"}`);
  }
  return cachePath;
}

function assetPath(characterId) {
  return ensurePngAsset(characterId);
}

function normalizeCharacterIds(value) {
  const raw = Array.isArray(value) ? value : String(value || "").split(/[;,\s]+/u);
  const ids = raw
    .map(item => String(item || "").trim().toUpperCase())
    .filter(item => Object.prototype.hasOwnProperty.call(ASSET_FILES, item));
  return [...new Set(ids)];
}

function inferSceneCharacterIds(scene) {
  const explicit = normalizeCharacterIds(scene?.character_ids || scene?.characterIds);
  if (explicit.length) return explicit;

  const text = [
    scene?.narration,
    scene?.visual,
    scene?.desc_prompt,
    scene?.image_prompt,
    scene?.reference_reason
  ].map(item => String(item || "")).join(" ");

  const ids = [];
  if (/(爸爸|父亲|老爸|父女中的父亲|\bdad\b|\bfather\b)/iu.test(text)) ids.push("DAD-001");
  if (/(女儿|小女孩|女孩|闺女|孩子|\bdaughter\b|\bchild\b|\bgirl\b)/iu.test(text)) ids.push("CHILD-001");
  return ids;
}

function singleDadSceneReferencePaths(task, scene) {
  if (!isSingleDadStoryTask(task)) return "";
  const ids = inferSceneCharacterIds(scene);
  if (!ids.length) return "";

  const paths = [];
  if (ids.includes("DAD-001")) paths.push(assetPath("DAD-001"));
  if (ids.includes("CHILD-001")) paths.push(assetPath("CHILD-001"));
  if (ids.includes("DAD-001") && ids.includes("CHILD-001")) paths.push(assetPath("DUO-001"));
  return [...new Set(paths.filter(Boolean))].join(";");
}

function singleDadCoverReferencePaths(task) {
  if (!isSingleDadStoryTask(task)) return "";
  return [assetPath("DAD-001"), assetPath("CHILD-001"), assetPath("DUO-001")]
    .filter(Boolean)
    .join(";");
}

function singleDadReferenceAvailable(task) {
  if (!isSingleDadStoryTask(task)) return false;
  return Boolean(assetPath("DAD-001") && assetPath("CHILD-001") && assetPath("DUO-001"));
}

function seedSingleDadStory(db) {
  const nowIso = new Date().toISOString();
  const now = Date.now();
  db.prepare(`INSERT OR IGNORE INTO custom_styles(
    id,name,tag,prefix,suffix,negative_prompt,description,created_at,updated_at
  ) VALUES(?,?,?,?,?,?,?,?,?)`).run(
    SINGLE_DAD_STYLE_ID,
    "父女日常绘本",
    "温暖2.5D",
    "现代中国家庭治愈系动画绘本，柔和2.5D数字插画，轻度立体角色，真实自然人体比例，普通中国家庭生活感，低饱和暖色，柔和自然光，生活观察式镜头",
    "人物身份稳定，表情克制自然，背景简洁弱化，只保留2到4个生活元素，柔和阴影，细腻但不过度光滑，温暖但不甜腻",
    "真人摄影，照片写实，纯日漫，大眼萌化，Q版，巨头比例，皮克斯电影级夸张3D，迪士尼公主感，偶像脸，商业亲子广告，网红儿童，豪宅样板间，塑料皮肤，过度磨皮，复杂背景，过度戏剧光效，水印，文字，字幕，对话气泡，logo，多余肢体，手部畸形",
    "STYLE-001：现代中国家庭父女日常用的治愈系2.5D动画绘本风。",
    nowIso,
    nowIso
  );

  const rewritePrompt = `你是“父女日常小剧场”的故事编辑。输入通常是一段真实生活记录、几句对话或一个很小的事件。\n\n目标：把素材整理成适合微信公众号连续贴图的短故事，而不是育儿教程、知识文章、广告或鸡汤。\n\n硬规则：\n1. 保留事件核心，不虚构重大经历，不拔高父爱。\n2. 主要人物固定为爸爸和9岁女儿。\n3. 优先写动作与对话，允许笨拙、催促、争执、委屈、沉默、和好。\n4. 一个小事件即可：小冲突 -> 一两句对话 -> 轻微转折 -> 普通收尾。\n5. 语言口语化，少总结、少金句、少“后来我才明白”式AI腔。\n6. 默认服务于7到8张连续图片，故事不要塞太多地点和人物。\n7. 不在图片里依赖长文字，对话由公众号正文承载。\n\n输出JSON，只包含 title、summary、narration。narration应完整、自然、可直接继续拆分镜。`;

  const metadataPrompt = `你是父女日常图文的视觉策划。固定人物资产已经由程序提供，不要重新设计人物，也不要生成新的角色设定图。\n\n爸爸固定ID：DAD-001。\n女儿固定ID：CHILD-001。\n父女同框比例参考：DUO-001。\n视觉风格固定为STYLE-001。\n\n发布文案应像真实生活记录，不做育儿说教，不营销，不卖惨。视觉连续性重点只记录人物身份、服装与故事中真正需要保持的物件，不建立复杂房屋世界观。`;

  const scenePrompt = `你是父女日常连续贴图分镜师。把旁白拆成7到8个清楚、可单独生图、前后连贯的生活镜头。\n\n硬规则：\n1. 每镜只表达一个主要动作或一句关键对话对应的情绪。\n2. 背景必须简单，只保留2到4个必要生活元素，人物永远是主体。\n3. 镜头中出现爸爸时，visual、desc_prompt、image_prompt中明确写“爸爸”；出现女儿时明确写“女儿”；父女同框时明确写“爸爸和女儿”。\n4. 角色出现时 use_reference=true；纯环境/物件空镜才可false。\n5. 如果协议允许额外字段，请输出 character_ids：爸爸=["DAD-001"]，女儿=["CHILD-001"]，父女同框=["DAD-001","CHILD-001"]。即使字段被协议过滤，文字中也必须明确角色称谓，程序会自动识别。\n6. 不让AI在画面中生成中文对白、字幕、标题或对话气泡。\n7. 优先中景、近景、侧面、过肩等生活观察镜头，不摆拍，不做商业亲子广告。\n8. 动作、表情、视线和人物距离承担情绪，不使用夸张戏剧表演。\n9. 不新增第三位固定人物，除非原始素材明确需要。\n10. 每一镜都要能只重生成这一张而不依赖上一张生成图。\n\n最终仍严格遵守系统要求的scenes JSON协议。`;

  const referenceDecisionPrompt = "父女日常模板中，只要镜头出现爸爸或女儿就必须 use_reference=true。程序会根据 character_ids 或镜头文字自动路由 DAD-001、CHILD-001；父女同框时额外加入 DUO-001。纯环境或物件空镜才设为 false。";
  const imagePromptTemplate = "STYLE-001。固定角色身份优先于服装、姿势和背景。保持参考图中的同一位爸爸/女儿，不重新设计五官、眼镜、年龄、发型和体型；父女同框保持DUO-001身高比例。普通中国家庭生活，背景简洁弱化，2到4个生活元素，中近景优先，动作自然，表情克制，无画中文字、无字幕、无对话气泡。";

  db.prepare(`INSERT OR IGNORE INTO user_prompt_templates(
    id,name,description,base_track,step1_rewrite_system_prompt,step1_metadata_system_prompt,step3_system_prompt,
    style_id,image_seed_pools_json,needs_character_card,character_card_mode,step3_skeleton_modules_json,
    reference_kind,reference_decision_prompt,image_prompt_template,created_at,updated_at,used_count
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`).run(
    SINGLE_DAD_TEMPLATE_ID,
    SINGLE_DAD_TEMPLATE_NAME,
    "真实父女小事 -> 7到8镜简单对话故事 -> 固定人物参考图 -> 图片审核",
    "family-emotion",
    rewritePrompt,
    metadataPrompt,
    scenePrompt,
    SINGLE_DAD_STYLE_ID,
    JSON.stringify(["父女双人对话", "爸爸单人反应", "女儿单人反应", "生活动作近景", "门口或餐桌等简单背景"]),
    0,
    "skip",
    JSON.stringify(["事件发生", "小冲突", "动作推进", "关键对话", "轻微转折", "普通收尾"]),
    "character",
    referenceDecisionPrompt,
    imagePromptTemplate,
    now,
    now
  );
}

module.exports = {
  SINGLE_DAD_TEMPLATE_ID,
  SINGLE_DAD_STYLE_ID,
  SINGLE_DAD_TEMPLATE_NAME,
  isSingleDadStoryTask,
  applySingleDadTaskDefaults,
  singleDadAssetDir,
  normalizeCharacterIds,
  inferSceneCharacterIds,
  singleDadSceneReferencePaths,
  singleDadCoverReferencePaths,
  singleDadReferenceAvailable,
  seedSingleDadStory
};
