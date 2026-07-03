const GRAPHIC_PATTERNS = [
  /鲜血四溅|血流成河|血肉模糊|血淋淋|大量出血|喷血|流血不止|鲜血|血液|血迹|染血|暗红色[^，。；]{0,16}(?:渗出|滴落|流淌)/i,
  /开放性伤口|伤口特写|创口特写|伤口清晰可见|创口清晰可见|新鲜割口|割口清晰可见|器官外露|内脏|断肢|残肢|肢解|爆头|尸体特写|遗体特写|尸骸/i,
  /切开皮肤|剖开身体|解剖过程|缝合伤口|取出子弹|清创过程|伤口进行缝合|患处进行缝合/i,
  /痛苦特写|濒死|挣扎特写|面目狰狞/i
];

const PROCEDURE_PATTERN = /正在做手术|实施手术|外科手术现场|手术过程|手术操作|缝合操作|清创|解剖|急救过程|处理伤口|处理创口/i;
const VIOLENCE_PATTERN = /处决|虐杀|残杀|刺杀|枪杀|砍杀|爆头|肢解|枪击过程|刀刺过程|爆炸冲击|战斗特写/i;
const CLOSEUP_PATTERN = /极近景|微距特写|超近景|伤口特写|创口特写|细节清晰|清晰可见/i;
const REAL_PERSON_HARM_PATTERN = /(?:白求恩|诺尔曼·白求恩|名人|真实人物|本人)[^，。；]{0,30}(?:受伤|流血|伤口|割口|死亡|尸体|手术)/i;
const MINOR_RESTRAINT_PATTERN = /(?:孩子|儿童|小孩|幼童|病童)[\s\S]{0,80}(?:只露出|外露|露出)[\s\S]{0,24}(?:头部|脑袋|头)[\s\S]{0,80}(?:铁肺|圆筒|金属圆筒|机器|病房)|(?:铁肺|圆筒|金属圆筒|机器)[\s\S]{0,80}(?:孩子|儿童|小孩|幼童|病童)[\s\S]{0,80}(?:只露出|外露|露出)[\s\S]{0,24}(?:头部|脑袋|头)|(?:铁肺|圆筒|金属圆筒|机器)[\s\S]{0,80}(?:只露出|外露出|外露|露出)[\s\S]{0,24}(?:孩子|儿童|小孩|幼童|病童)[\s\S]{0,24}(?:头部|脑袋|头)/i;

function normalizePromptText(prompt) {
  return String(prompt || "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[，,]{2,}/g, "，")
    .replace(/[。]{2,}/g, "。")
    .trim();
}

function analyzeImagePromptRisk(prompt) {
  const text = normalizePromptText(prompt);
  const reasons = [];
  let score = 0;
  for (const pattern of GRAPHIC_PATTERNS) {
    if (pattern.test(text)) {
      score += 4;
      reasons.push("graphic-detail");
      break;
    }
  }
  if (PROCEDURE_PATTERN.test(text)) {
    score += 2;
    reasons.push("medical-procedure");
  }
  if (VIOLENCE_PATTERN.test(text)) {
    score += 4;
    reasons.push("explicit-violence");
  }
  if (CLOSEUP_PATTERN.test(text) && score > 0) {
    score += 2;
    reasons.push("risky-closeup");
  }
  if (REAL_PERSON_HARM_PATTERN.test(text)) {
    score += 3;
    reasons.push("real-person-harm");
  }
  const minorMedicalRestraint = MINOR_RESTRAINT_PATTERN.test(text);
  if (minorMedicalRestraint) {
    score += 3;
    reasons.push("minor-medical-restraint");
  }
  const category = /手术|医生|医疗|伤员|患者|感染|纱布|缝合|割口|伤口|创口/i.test(text)
    ? "medical"
    : minorMedicalRestraint
      ? "minor-medical-restraint"
    : /战争|战斗|枪|刀|爆炸|处决|虐杀|残杀|刺杀|枪杀/i.test(text)
      ? "violence"
      : /死亡|逝世|遗体|葬礼|墓地|追悼/i.test(text)
        ? "loss"
        : "general";
  return { risky: score >= 2, score, reasons: [...new Set(reasons)], category, text };
}

function extractFirst(text, patterns, fallback = "") {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[0]) return match[0].trim();
  }
  return fallback;
}

// Safety works only on the scene-content layer. Visual style is never inferred here.
function extractSceneContext(text) {
  const era = extractFirst(text, [/(?:18|19|20)\d{2}年(?:\d{1,2}月)?/, /(?:民国|抗战|二战|古代|近代)[^，。；]{0,12}/]);
  const location = extractFirst(text, [/(?:中国)?华北前线/, /(?:中国)?(?:东北|华北|华东|华中|西北|西南|华南)[^，。；]{0,10}/, /[^，。；]{0,12}(?:医院|医疗站|诊所|营地|战地)/]);
  const ratio = extractFirst(text, [/(?:9:16|16:9|1:1|4:3|3:4|2:3|3:2)(?:竖构图|横构图|构图)?/], "9:16竖构图");
  const light = extractFirst(text, [/煤油灯[^，。；]{0,28}/, /自然光[^，。；]{0,20}/, /侧光[^，。；]{0,20}/, /柔和光线[^，。；]{0,20}/], "柔和光线");
  return { era, location, ratio, light };
}

function joinPrompt(parts) {
  return parts
    .flatMap(item => Array.isArray(item) ? item : [item])
    .map(item => normalizePromptText(item))
    .filter(Boolean)
    .join("，")
    .replace(/[，,]{2,}/g, "，")
    .replace(/^，|，$/g, "")
    .trim();
}

function medicalSafePrompt(text, level) {
  const context = extractSceneContext(text);
  const scene = level === "ultra"
    ? "一位医生站在简朴医疗站内，医护人员安静整理医疗器械，人物神情专注而疲惫"
    : level === "minimal"
      ? "一位医生站在简朴医疗站内，低头查看已经妥善包扎好的手指，身后医护人员安静整理医疗器械，人物神情专注而疲惫"
      : "一位医生站在简朴医疗站内，低头查看已经用干净纱布妥善包扎好的手指，身后医护人员整理医疗器械，患者区域由布帘自然遮挡，人物神情专注而疲惫";
  return joinPrompt([
    context.era,
    context.location,
    scene,
    context.light,
    "中近景叙事构图",
    "情绪克制",
    "适合大众观看",
    context.ratio,
    "主体明确，构图完整，无文字无水印"
  ]);
}

function violenceSafePrompt(text, level) {
  const context = extractSceneContext(text);
  const scene = level === "ultra"
    ? "安静的历史环境，远处人物有序行走，画面聚焦建筑、道路与时代氛围"
    : level === "minimal"
      ? "几名人物在远处穿行，画面聚焦环境、神情与时代氛围"
      : "历史事件发生后的安静环境，远处人群有序行动，画面聚焦环境、神情、尘土与光影";
  return joinPrompt([
    context.era,
    context.location,
    scene,
    context.light,
    "中远景叙事构图",
    "情绪克制",
    "适合大众观看",
    context.ratio,
    "主体明确，构图完整，无文字无水印"
  ]);
}

function lossSafePrompt(text) {
  const context = extractSceneContext(text);
  return joinPrompt([
    context.era,
    context.location,
    "安静的纪念场景，空椅、旧照片、桌面物件与窗边光线传达人物离去后的情绪",
    context.light,
    "中景叙事构图",
    "情绪克制",
    "适合大众观看",
    context.ratio,
    "主体明确，构图完整，无文字无水印"
  ]);
}

function minorMedicalRestraintSafePrompt(text, level) {
  const context = extractSceneContext(text);
  const scene = level === "ultra"
    ? "一间安静的1950年代医院病房，数台银灰色铁肺设备整齐排列，画面聚焦历史医疗设备、走廊光线和安静氛围，不直接呈现儿童"
    : "一间安静的1950年代医院病房，数台银灰色铁肺设备整齐排列，白衣护士在设备间查看仪表，远处父母坐在长椅上安静守候，画面聚焦医疗设备和家属忧虑的氛围，不直接呈现儿童身体";
  return joinPrompt([
    context.era,
    context.location,
    scene,
    context.light,
    "中远景叙事构图",
    "情绪克制",
    "适合大众观看",
    context.ratio,
    "主体明确，构图完整，无文字无水印"
  ]);
}

function genericSafePrompt(text) {
  const context = extractSceneContext(text);
  return joinPrompt([
    context.era,
    context.location,
    "人物置身于与故事相符的环境中，画面聚焦人物神情、环境与具有叙事作用的物件",
    context.light,
    "中景叙事构图",
    "情绪克制",
    "适合大众观看",
    context.ratio,
    "主体明确，构图完整，无文字无水印"
  ]);
}

function scrubResidualRisk(prompt) {
  let text = normalizePromptText(prompt);
  const replacements = [
    [/简陋手术室|手术室/gi, "简朴医疗站"],
    [/极近景特写|极近景|微距特写|超近景|伤口特写|创口特写/gi, "中近景叙事构图"],
    [/白求恩|诺尔曼·白求恩/gi, "一位外国医生的历史形象"],
    [/左手食指[^，。；]*(?:割口|伤口|创口|流血|渗出|滴落)[^，。；]*/gi, "手指已经用干净纱布妥善包扎，人物低头查看手指"],
    [/(?:暗红色|鲜红色)?(?:血液|鲜血|血迹)[^，。；]*(?:滴落|渗出|流淌)?/gi, "画面情绪保持克制"],
    [/(?:正在|为|对)[^，。；]{0,36}(?:伤员|患者)[^，。；]{0,18}(?:伤口|创口|患处)[^，。；]{0,18}(?:缝合|清创|处理)[^，。；]*/gi, "在医疗台旁专注救治，患者区域由医护人员和布帘自然遮挡"],
    [/伤口进行缝合操作|创口进行缝合操作|缝合伤口|清创过程|切开皮肤|剖开身体|解剖过程|取出子弹/gi, "专注救治"],
    [/染血纱布|沾血纱布/gi, "干净纱布"],
    [/金属手术钳|缝合针|解剖刀|手术刀/gi, "金属医疗器械"],
    [/开放性伤口|伤口清晰可见|创口清晰可见|新鲜割口|割口清晰可见|器官外露|内脏|断肢|残肢|肢解|爆头|尸体特写|遗体特写|尸骸/gi, ""],
    [/鲜血四溅|血流成河|血肉模糊|血淋淋|大量出血|喷血|流血不止|鲜血|血液|血迹|染血/gi, ""],
    [/正在做手术|实施手术|外科手术现场|手术过程|手术操作|缝合操作|处理伤口|处理创口/gi, "在简朴医疗站专注工作"],
    [/处决|虐杀|残杀|刺杀|枪杀|砍杀|爆头|肢解/gi, "紧张的历史事件"]
  ];
  for (const [pattern, replacement] of replacements) text = text.replace(pattern, replacement);
  return joinPrompt(text.split(/[，。；;\n]+/).filter(Boolean));
}

function buildPolicySafeImagePrompt(prompt, level = "safe") {
  const analysis = analyzeImagePromptRisk(prompt);
  if (!analysis.risky && level === "preflight") {
    return { prompt: analysis.text, adjusted: false, reasons: [], category: analysis.category, level };
  }

  let safePrompt;
  if (analysis.category === "medical") safePrompt = medicalSafePrompt(analysis.text, level);
  else if (analysis.category === "minor-medical-restraint") safePrompt = minorMedicalRestraintSafePrompt(analysis.text, level);
  else if (analysis.category === "violence") safePrompt = violenceSafePrompt(analysis.text, level);
  else if (analysis.category === "loss") safePrompt = lossSafePrompt(analysis.text);
  else safePrompt = genericSafePrompt(analysis.text);

  safePrompt = scrubResidualRisk(safePrompt);
  const remaining = analyzeImagePromptRisk(safePrompt);
  if (remaining.risky) {
    safePrompt = analysis.category === "medical"
      ? medicalSafePrompt("9:16竖构图", "minimal")
      : analysis.category === "minor-medical-restraint"
        ? minorMedicalRestraintSafePrompt("9:16竖构图", "ultra")
      : genericSafePrompt("9:16竖构图");
  }
  return {
    prompt: safePrompt,
    adjusted: safePrompt !== analysis.text,
    reasons: analysis.reasons,
    category: analysis.category,
    level
  };
}

module.exports = {
  normalizePromptText,
  analyzeImagePromptRisk,
  buildPolicySafeImagePrompt,
  scrubResidualRisk
};
