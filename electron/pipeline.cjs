const fs = require("node:fs");
const path = require("node:path");
const { ProxyAgent } = require("undici");
const { generateSceneImage, synthesizeSpeech, mediaDuration, resolveResource } = require("./services.cjs");
const { renderVideo } = require("./media.cjs");
const { generateJianyingDraft } = require("./draft.cjs");
const { generateCover } = require("./cover.cjs");

const systemPromptTemplates = Object.fromEntries(
  require("../shared/system-prompt-templates.json").map(item => [item.id, item])
);

const systemPrompt = `你是一名专业短视频编导。请把用户提供的原始文案整理成可制作的视频脚本。
必须只返回合法 JSON，不要使用 Markdown 代码块。JSON 结构如下：
{
  "title": "视频标题",
  "summary": "一句话简介",
  "narration": "优化后的完整旁白",
  "scenes": [
    {
      "index": 1,
      "narration": "本镜头对应旁白",
      "visual": "画面内容说明",
      "image_prompt": "详细的中文图片生成提示词",
      "duration_hint": 5
    }
  ]
}
旁白应自然、有节奏；每个镜头只表达一个明确视觉重点；保持原文核心事实，不编造具体数据。`;

function llmFetch(url, options, proxyUrl) {
  return fetch(url, {
    ...options,
    ...(proxyUrl ? { dispatcher: new ProxyAgent(proxyUrl) } : {})
  });
}

async function callLanguageModel(config, task) {
  const llm = config.llm;
  if (llm?.provider === "local" || llm?.protocol === "local") {
    let sourceText = task.input_text;
    const processingMode = task.processing_mode || "auto";
    if (processingMode !== "direct") {
      if (!task.keep_promotion) sourceText = sourceText.replace(/(?:点击|下单|购买|链接|橱窗|优惠|关注)[^。！？]*[。！？]?/g, "");
      if (task.narrative_pov === "first") sourceText = sourceText.replace(/(?:他|她|主人公|这个人)/g, "我");
      if (task.narrative_pov === "third") sourceText = sourceText.replace(/\b我\b/g, "他");
    }
    if (processingMode === "auto" && task.rewrite_intensity === "deep") {
      sourceText = sourceText.replace(/后来/g, "此后").replace(/但是/g, "然而").replace(/因为/g, "缘由在于");
    } else if (processingMode === "auto" && task.rewrite_intensity === "original") {
      sourceText = `故事要从一个容易被忽略的瞬间说起。${sourceText}回头看，这段经历真正留下的，是选择背后的意义。`;
    }
    if (task.target_length && sourceText.length > Number(task.target_length) * 1.15) {
      sourceText = sourceText.slice(0, Number(task.target_length));
    }
    const pieces = sourceText
      .split(/(?<=[。！？!?；;])|\n+/)
      .map(item => item.trim())
      .filter(Boolean);
    const targetFromLength = task.target_length ? Math.max(1, Math.round(Number(task.target_length) / 35)) : 0;
    const target = Math.max(1, Number(task.target_scenes || targetFromLength || 8));
    let scenes = [];
    const chunkSize = Math.max(1, Math.ceil(pieces.length / target));
    for (let i = 0; i < pieces.length; i += chunkSize) {
      const narration = pieces.slice(i, i + chunkSize).join("");
      scenes.push({
        index: scenes.length + 1,
        narration,
        visual: narration,
        image_prompt: `${task.style}风格，${narration}，主体明确，构图完整，适合${task.ratio}短视频画面，无文字无水印`,
        duration_hint: Math.max(3, Math.min(12, narration.length / 4.2))
      });
    }
    if (!scenes.length) throw new Error("原始文案为空");
    if (task.task_type === "podcast") {
      const pair = podcastSpeakerPair(task.podcast_speakers);
      scenes = scenes.map((scene, index) => ({
        ...scene,
        speaker_role: index % 2 ? "B" : "A",
        speaker_name: index % 2 ? pair[1].name : pair[0].name,
        speaker_id: index % 2 ? pair[1].id : pair[0].id
      }));
    }
    const narration = scenes.map(scene => scene.narration).join("");
    return JSON.stringify({
      title: task.title,
      summary: task.input_text.slice(0, 80),
      narration,
      scenes
    });
  }
  if (!llm?.api_key) throw new Error("尚未配置语言模型 API Key，请先前往设置");
  const systemTemplate = systemPromptTemplates[task.prompt_template_id] || {};
  const customRewrite = task.prompt_template?.step1_rewrite_system_prompt || systemTemplate.step1_rewrite_system_prompt || "";
  const customMetadata = task.prompt_template?.step1_metadata_system_prompt || systemTemplate.step1_metadata_system_prompt || "";
  const customScenes = task.prompt_template?.step3_system_prompt || systemTemplate.step3_system_prompt || "";
  const skeletonModules = task.prompt_template?.step3_skeleton_modules_json || systemTemplate.step3_skeleton_modules_json || "[]";
  const imageSeedPools = task.prompt_template?.image_seed_pools_json || systemTemplate.image_seed_pools_json || "[]";
  const referenceKind = task.prompt_template?.reference_kind || systemTemplate.reference_kind || "";
  const userPrompt = `内容类型：${task.track}
视频形态：${task.task_type === "podcast" ? "双人播客，两位主播轮流对话；每个 scenes 项必须提供 speaker_role(A/B)" : "单人旁白"}
处理模式：${task.processing_mode || "auto"}（auto=完整改写，semi=保留原文仅智能分句，direct=机械分句）
视觉风格：${task.style}
画面比例：${task.ratio}
改写强度：${task.rewrite_intensity || "standard"}
叙事视角：${task.narrative_pov || "original"}
目标字数：${task.target_length || "跟随原文"}
目标分镜数：${task.target_scenes || "根据篇幅自动决定"}
是否保留推广内容：${task.keep_promotion ? "保留" : "删除"}
${customRewrite ? `\n自定义文案要求：${customRewrite}` : ""}
${customMetadata ? `\n元数据提取要求：${customMetadata}` : ""}
${customScenes ? `\n自定义分镜要求：${customScenes}` : ""}
分镜骨架模块：${skeletonModules}
图片种子池：${imageSeedPools}
参考图类型：${referenceKind || "自动"}

原始文案：
${task.input_text}`;

  if (llm.protocol === "anthropic") {
    const endpoint = `${llm.base_url.replace(/\/$/, "")}/v1/messages`;
    const response = await llmFetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": llm.api_key,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: llm.model,
        max_tokens: 8192,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }]
      })
    }, llm.proxy_url);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.error?.message || `模型请求失败 (${response.status})`);
    return payload.content?.filter(item => item.type === "text").map(item => item.text).join("\n") || "";
  }

  const endpoint = `${llm.base_url.replace(/\/$/, "")}/chat/completions`;
  const response = await llmFetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${llm.api_key}`
    },
    body: JSON.stringify({
      model: llm.model,
      temperature: 0.7,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]
    })
  }, llm.proxy_url);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message || `模型请求失败 (${response.status})`);
  return payload.choices?.[0]?.message?.content || "";
}

function parseModelJson(text) {
  const cleaned = text.trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const data = JSON.parse(cleaned);
  if (!data.title || !data.narration || !Array.isArray(data.scenes)) {
    throw new Error("语言模型返回的数据结构不完整");
  }
  data.scenes = data.scenes.map((scene, index) => ({
    index: index + 1,
    narration: String(scene.narration || ""),
    visual: String(scene.visual || ""),
    image_prompt: String(scene.image_prompt || scene.visual || ""),
    duration_hint: Number(scene.duration_hint) || 5,
    speaker_role: scene.speaker_role === "B" ? "B" : "A",
    speaker_name: String(scene.speaker_name || ""),
    speaker_id: String(scene.speaker_id || "")
  }));
  return data;
}

function podcastSpeakerPair(id) {
  if (id === "liufei-xiaolei") {
    return [
      { name: "刘飞", id: "zh_male_liufei_v2_saturn_bigtts" },
      { name: "潇磊", id: "zh_male_xiaolei_v2_saturn_bigtts" }
    ];
  }
  return [
    { name: "咪仔", id: "zh_female_mizaitongxue_v2_saturn_bigtts" },
    { name: "大壹", id: "zh_male_dayixiansheng_v2_saturn_bigtts" }
  ];
}

function shouldPauseAfter(task, step) {
  let points = [];
  try { points = JSON.parse(task.pause_points || "[]"); } catch {}
  if (points.includes(step) && Number(task.current_step || 0) < step) return true;
  return task.pause_mode === "every" && Number(task.current_step || 0) < step;
}

function safeFolderName(value) {
  return value.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").trim().slice(0, 60) || "untitled";
}

function taskOutputDir(task, config, baseOutputDir) {
  return task.output_dir || path.join(
    config.task_storage_path || baseOutputDir,
    `${safeFolderName(task.title)}_${task.id.slice(0, 8)}`
  );
}

async function preparePipeline({ task, config, baseOutputDir, emit }) {
  const outputDir = taskOutputDir(task, config, baseOutputDir);
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, "source.json"), JSON.stringify(task, null, 2), "utf8");

  emit(1, "正在分析原始文案");
  emit(2, "正在重写旁白并拆分镜头");
  const raw = await callLanguageModel(config, task);
  fs.writeFileSync(path.join(outputDir, "model-response.txt"), raw, "utf8");

  emit(3, "正在校验脚本结构");
  const script = parseModelJson(raw);
  if (task.task_type === "podcast") {
    const pair = podcastSpeakerPair(task.podcast_speakers);
    script.scenes = script.scenes.map((scene, index) => {
      const speaker = scene.speaker_role === "B" ? pair[1] : scene.speaker_role === "A" ? pair[0] : pair[index % 2];
      return { ...scene, speaker_role: speaker === pair[1] ? "B" : "A", speaker_name: speaker.name, speaker_id: speaker.id };
    });
    script.narration = script.scenes.map(scene => `${scene.speaker_name}：${scene.narration}`).join("\n");
  }
  const selectedSystemTemplate = systemPromptTemplates[task.prompt_template_id] || {};
  const imagePromptTemplate = task.prompt_template?.image_prompt_template || selectedSystemTemplate.image_prompt_template || "";
  if (imagePromptTemplate) {
    script.scenes = script.scenes.map(scene => ({
      ...scene,
      image_prompt: imagePromptTemplate
        .replaceAll("{visual_action}", scene.image_prompt || scene.visual)
        .replaceAll("{ratio}", task.ratio || "9:16")
        .replaceAll("{character_card}", "")
        .replaceAll("{product_card}", "")
        .replaceAll("{era_and_location}", "")
        .replace(/\s*，\s*，+/g, "，")
    }));
  }
  fs.writeFileSync(path.join(outputDir, "script.json"), JSON.stringify(script, null, 2), "utf8");
  fs.writeFileSync(path.join(outputDir, "narration.txt"), script.narration, "utf8");
  return { outputDir, script };
}

async function completePipeline({ app, task, config, outputDir, script, emit }) {
  const imagesDir = path.join(outputDir, "images");
  const audioDir = path.join(outputDir, "audio");
  fs.mkdirSync(imagesDir, { recursive: true });
  fs.mkdirSync(audioDir, { recursive: true });

  const pipelinePath = path.join(outputDir, "pipeline.json");
  let persisted = null;
  if (fs.existsSync(pipelinePath)) {
    try { persisted = JSON.parse(fs.readFileSync(pipelinePath, "utf8")); } catch {}
  }
  const workingScenes = script.scenes.map(scene => {
    const previous = persisted?.scenes?.find(item => Number(item.index) === Number(scene.index));
    if (!previous || previous.narration !== scene.narration || previous.image_prompt !== scene.image_prompt) {
      return { ...scene };
    }
    return {
      ...scene, image_path: previous.image_path, image_provider: previous.image_provider,
      source_url: previous.source_url, audio_path: previous.audio_path, duration: previous.duration
    };
  });
  const persist = () => fs.writeFileSync(
    pipelinePath,
    JSON.stringify({ ...script, scenes: workingScenes }, null, 2),
    "utf8"
  );

  const singlePodcastImage = task.task_type === "podcast" && task.podcast_image_mode === "single";
  if (singlePodcastImage && workingScenes[0]?.image_path && fs.existsSync(workingScenes[0].image_path)) {
    workingScenes.forEach(scene => { scene.image_path = workingScenes[0].image_path; });
  }
  const pendingImages = singlePodcastImage
    ? ((!workingScenes[0]?.image_path || !fs.existsSync(workingScenes[0].image_path)) ? [workingScenes[0]] : [])
    : workingScenes.filter(scene => !scene.image_path || !fs.existsSync(scene.image_path));
  workingScenes.filter(scene => !pendingImages.includes(scene))
    .forEach(scene => emit(4, `复用已生成画面 ${scene.index}/${workingScenes.length}`));
  const imageSection = config[config.image_provider] || {};
  const imageConcurrency = Math.max(1, Math.min(6, Number(imageSection.concurrency || 1)));
  let imageCursor = 0;
  const imageWorker = async () => {
    while (imageCursor < pendingImages.length) {
      const scene = pendingImages[imageCursor++];
      if (task.shouldCancel?.()) throw new Error("任务已取消");
      emit(4, `正在生成画面 ${scene.index}/${workingScenes.length}`);
      const imagePath = path.join(imagesDir, `${scene.index}.png`);
      const stylePrefix = task.style_config?.prefix || "";
      const styleSuffix = task.style_config?.suffix || "";
      const imageResult = await generateSceneImage({
        app, config, prompt: [stylePrefix, scene.image_prompt, styleSuffix].filter(Boolean).join("，"), destination: imagePath,
        ratio: task.ratio, index: scene.index, materialSource: task.material_source,
        referenceImagePath: task.reference_image_path || ""
      });
      scene.image_path = imagePath;
      scene.image_provider = imageResult.provider || "";
      scene.source_url = imageResult.sourceUrl || "";
      persist();
    }
  };
  await Promise.all(Array.from({ length: Math.min(imageConcurrency, pendingImages.length) }, () => imageWorker()));
  if (singlePodcastImage && workingScenes[0]?.image_path) {
    workingScenes.forEach(scene => {
      scene.image_path = workingScenes[0].image_path;
      scene.image_provider = workingScenes[0].image_provider;
      scene.source_url = workingScenes[0].source_url;
    });
  }
  persist();

  if (shouldPauseAfter(task, 4)) {
    emit(4, "图片已全部生成，请检查画廊后继续");
    return {
      paused: true, pauseStep: 4, outputDir,
      script: { ...script, scenes: workingScenes },
      finalVideo: "", subtitlePath: "", draftDir: "", coverPath: ""
    };
  }

  const generatedScenes = [];
  for (const scene of workingScenes) {
    if (task.shouldCancel?.()) throw new Error("任务已取消");
    if (!scene.audio_path || !fs.existsSync(scene.audio_path)) {
      emit(5, `正在合成配音 ${scene.index}/${workingScenes.length}`);
      const audioExt = config.tts?.provider === "system" ? "wav" : "mp3";
      const audioPath = path.join(audioDir, `${scene.index}.${audioExt}`);
      await synthesizeSpeech({
        app, config, text: scene.narration, destination: audioPath,
        speed: Number(task.tts_speed || 1),
        speaker: task.task_type === "podcast" ? scene.speaker_id : task.speaker
      });
      scene.audio_path = audioPath;
      scene.duration = await mediaDuration(app, config, audioPath);
      persist();
    } else {
      emit(5, `复用已生成配音 ${scene.index}/${workingScenes.length}`);
      if (!scene.duration) scene.duration = await mediaDuration(app, config, scene.audio_path);
    }
    generatedScenes.push(scene);
  }
  persist();

  if (shouldPauseAfter(task, 5)) {
    emit(5, "配音已全部生成，请检查后继续");
    return {
      paused: true, pauseStep: 5, outputDir,
      script: { ...script, scenes: workingScenes },
      finalVideo: "", subtitlePath: "", draftDir: "", coverPath: ""
    };
  }

  emit(6, "正在合成字幕与 MP4");
  const configuredBgm = task.bgm_id === "none" ? "" : task.bgm_path || (config.media?.use_default_bgm
    ? resolveResource(app, "default-bgm.mp3")
    : config.media?.bgm_path || "");
  const video = await renderVideo({
    app, config, scenes: generatedScenes, outputDir,
    ratio: task.ratio, bgmPath: configuredBgm, template: task.draft_template, videoIntro: task.video_intro
  });

  const coverPath = await generateCover({
    app, config, task, outputDir, script: { ...script, scenes: generatedScenes },
    sourceImage: generatedScenes[0]?.image_path, template: task.cover_template
  });

  emit(7, "正在生成剪映草稿");
  let draft = null;
  try {
    draft = await generateJianyingDraft({
      app, config, task: { ...task, pipeline_data: JSON.stringify({ ...script, scenes: generatedScenes }) }, outputDir, scenes: generatedScenes, bgmPath: configuredBgm
    });
  } catch (error) {
    fs.writeFileSync(path.join(outputDir, "draft-error.txt"), String(error?.stack || error), "utf8");
  }

  emit(8, "全部生成完成");
  return {
    outputDir,
    script: { ...script, scenes: generatedScenes },
    finalVideo: video.finalVideo,
    subtitlePath: video.subtitlePath,
    draftDir: draft?.draft_dir || "",
    coverPath
  };
}

async function runPipeline({ app, task, config, baseOutputDir, emit }) {
  const prepared = await preparePipeline({ task, config, baseOutputDir, emit });
  return completePipeline({ app, task, config, ...prepared, emit });
}

async function regenerateScene({ app, task, config, outputDir, script, sceneIndex, kind, emit = () => {} }) {
  const scene = script.scenes.find(item => Number(item.index) === Number(sceneIndex));
  if (!scene) throw new Error("分镜不存在");
  if (kind === "image") {
    emit(4, `正在重新生成第 ${scene.index} 镜画面`);
    fs.mkdirSync(path.join(outputDir, "images"), { recursive: true });
    const imagePath = path.join(outputDir, "images", `${scene.index}.png`);
    const imageResult = await generateSceneImage({
      app, config,
      prompt: [task.style_config?.prefix, scene.image_prompt, task.style_config?.suffix].filter(Boolean).join("，"),
      destination: imagePath, ratio: task.ratio, index: scene.index,
      materialSource: task.material_source, referenceImagePath: task.reference_image_path || ""
    });
    scene.image_path = imagePath;
    scene.image_provider = imageResult.provider || "";
    scene.source_url = imageResult.sourceUrl || "";
  } else if (kind === "audio") {
    emit(5, `正在重新生成第 ${scene.index} 镜配音`);
    fs.mkdirSync(path.join(outputDir, "audio"), { recursive: true });
    const extension = config.tts?.provider === "system" ? "wav" : "mp3";
    const audioPath = path.join(outputDir, "audio", `${scene.index}.${extension}`);
    await synthesizeSpeech({ app, config, text: scene.narration, destination: audioPath, speed: Number(task.tts_speed || 1) });
    scene.audio_path = audioPath;
    scene.duration = await mediaDuration(app, config, audioPath);
  }
  fs.writeFileSync(path.join(outputDir, "pipeline.json"), JSON.stringify(script, null, 2), "utf8");
  return script;
}

async function renderPrepared({ app, task, config, outputDir, script, emit }) {
  for (const scene of script.scenes) {
    if (!scene.image_path || !fs.existsSync(scene.image_path) || !scene.audio_path || !fs.existsSync(scene.audio_path)) {
      throw new Error(`第 ${scene.index} 镜素材不完整，请先生成图片和配音`);
    }
  }
  emit(6, "正在重新合成字幕与 MP4");
  const bgmPath = task.bgm_id === "none" ? "" : task.bgm_path || (config.media?.use_default_bgm
    ? resolveResource(app, "default-bgm.mp3")
    : config.media?.bgm_path || "");
  const video = await renderVideo({ app, config, scenes: script.scenes, outputDir, ratio: task.ratio, bgmPath, template: task.draft_template });
  emit(7, "正在重新生成剪映草稿");
  let draftDir = "";
  try {
    const draft = await generateJianyingDraft({ app, config, task, outputDir, scenes: script.scenes, bgmPath });
    draftDir = draft.draft_dir || "";
  } catch (error) {
    fs.writeFileSync(path.join(outputDir, "draft-error.txt"), String(error?.stack || error), "utf8");
  }
  emit(8, "重新合成完成");
  const coverPath = await generateCover({
    app, config, task, outputDir, script,
    sourceImage: script.scenes[0]?.image_path, template: task.cover_template
  });
  return { outputDir, script, finalVideo: video.finalVideo, subtitlePath: video.subtitlePath, draftDir, coverPath };
}

module.exports = { runPipeline, preparePipeline, completePipeline, regenerateScene, renderPrepared };
