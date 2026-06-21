const fs = require("node:fs");
const path = require("node:path");
const {
  generateSceneImage, generateRunningHubVideo, synthesizeSpeech,
  mediaDuration, resolveResource
} = require("./services.cjs");
const { renderVideo } = require("./media.cjs");
const { generateJianyingDraft } = require("./draft.cjs");
const { generateCover } = require("./cover.cjs");
const { planVideoScript } = require("./llm-planner.cjs");
const {
  atomicWriteJson, atomicWriteFile, readJsonSafe, fileLooksUsable,
  retryOperation, fingerprint
} = require("./checkpoint.cjs");

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
  return String(value || "").replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").trim().slice(0, 60) || "untitled";
}

function taskOutputDir(task, config, baseOutputDir) {
  return task.output_dir || path.join(
    config.task_storage_path || baseOutputDir,
    `${safeFolderName(task.title)}_${task.id.slice(0, 8)}`
  );
}

function initialSceneState(scene) {
  return {
    image_status: "pending",
    image_attempts: 0,
    image_error: "",
    image_remote_task_id: "",
    image_remote_provider: "",
    audio_status: "pending",
    audio_attempts: 0,
    audio_error: "",
    video_status: "pending",
    video_attempts: 0,
    video_remote_task_id: "",
    video_remote_model: "",
    render_clip_status: "pending",
    ...scene
  };
}

function mergeSceneState(scene, previous) {
  if (!previous || previous.narration !== scene.narration || previous.image_prompt !== scene.image_prompt) {
    return initialSceneState(scene);
  }
  return initialSceneState({ ...scene, ...previous, index: scene.index, narration: scene.narration, image_prompt: scene.image_prompt });
}

function usableAsset(filePath, minBytes = 256) {
  return fileLooksUsable(filePath, minBytes);
}

async function usableMedia(app, config, filePath) {
  if (!usableAsset(filePath, 1024)) return false;
  try {
    const duration = await mediaDuration(app, config, filePath);
    return Number.isFinite(duration) && duration > 0.05;
  } catch {
    return false;
  }
}

function removePartial(filePath) {
  if (!filePath) return;
  try { fs.rmSync(filePath, { force: true }); } catch {}
}

function pipelineSnapshot(script, scenes, runtime) {
  return {
    ...script,
    checkpoint_version: 2,
    runtime: {
      ...runtime,
      checkpoint_version: 2,
      updated_at: new Date().toISOString()
    },
    scenes
  };
}

async function preparePipeline({ task, config, baseOutputDir, emit, checkpoint = () => {} }) {
  const outputDir = taskOutputDir(task, config, baseOutputDir);
  fs.mkdirSync(outputDir, { recursive: true });
  checkpoint({ outputDir, currentStage: "planning", currentStep: 1 });

  const sourceSnapshot = { ...task };
  delete sourceSnapshot.shouldCancel;
  if (sourceSnapshot.prompt_template?.api_key) sourceSnapshot.prompt_template.api_key = "***";
  atomicWriteJson(path.join(outputDir, "source.json"), sourceSnapshot);

  emit(1, "正在分析原始文案与模板规则");
  emit(2, "正在改写文案、提取人物档案并生成分镜");
  const script = await planVideoScript({
    config,
    task,
    outputDir,
    onStage: (stage, status) => checkpoint({
      outputDir,
      currentStage: stage,
      currentStep: stage === "03-scenes" ? 3 : 2,
      detail: status
    })
  });
  atomicWriteJson(path.join(outputDir, "model-response.txt"), script);

  emit(3, "正在校验分镜、提示词和参考图标记");
  if (task.task_type === "podcast") {
    const pair = podcastSpeakerPair(task.podcast_speakers);
    script.scenes = script.scenes.map((scene, index) => {
      const speaker = scene.speaker_role === "B" ? pair[1] : scene.speaker_role === "A" ? pair[0] : pair[index % 2];
      return { ...scene, speaker_role: speaker === pair[1] ? "B" : "A", speaker_name: speaker.name, speaker_id: speaker.id };
    });
    script.narration = script.scenes.map(scene => `${scene.speaker_name}：${scene.narration}`).join("\n");
  }
  script.scenes = script.scenes.map(initialSceneState);
  const runtime = {
    current_stage: "script_ready",
    current_step: 3,
    planning_status: "completed",
    render_status: "pending",
    cover_status: "pending",
    draft_status: "pending",
    final_video: "",
    subtitle_path: "",
    draft_dir: "",
    cover_path: ""
  };
  const prepared = pipelineSnapshot(script, script.scenes, runtime);
  atomicWriteJson(path.join(outputDir, "script.json"), prepared);
  atomicWriteFile(path.join(outputDir, "narration.txt"), script.narration, "utf8");
  atomicWriteJson(path.join(outputDir, "pipeline.json"), prepared);
  checkpoint({ outputDir, pipeline: prepared, currentStage: "script_ready", currentStep: 3 });
  return { outputDir, script: prepared };
}

async function completePipeline({ app, task, config, outputDir, script, emit, checkpoint = () => {} }) {
  const imagesDir = path.join(outputDir, "images");
  const audioDir = path.join(outputDir, "audio");
  fs.mkdirSync(imagesDir, { recursive: true });
  fs.mkdirSync(audioDir, { recursive: true });

  const pipelinePath = path.join(outputDir, "pipeline.json");
  const persisted = readJsonSafe(pipelinePath, null);
  const baseScript = persisted?.scenes?.length ? persisted : script;
  if (!Array.isArray(baseScript?.scenes) || !baseScript.scenes.length) throw new Error("断点数据中没有可用分镜");
  const workingScenes = script.scenes.map(scene => {
    const previous = baseScript?.scenes?.find(item => Number(item.index) === Number(scene.index));
    return mergeSceneState(scene, previous);
  });
  const runtime = {
    current_stage: "images",
    current_step: 4,
    planning_status: "completed",
    render_status: "pending",
    cover_status: "pending",
    draft_status: "pending",
    final_video: "",
    subtitle_path: "",
    draft_dir: "",
    cover_path: "",
    ...(baseScript.runtime || {}),
    ...(script.runtime || {})
  };
  const persist = (patch = {}) => {
    Object.assign(runtime, patch);
    const snapshot = pipelineSnapshot(script, workingScenes, runtime);
    atomicWriteJson(pipelinePath, snapshot);
    checkpoint({
      outputDir,
      pipeline: snapshot,
      currentStage: runtime.current_stage,
      currentStep: runtime.current_step,
      detail: runtime.detail || ""
    });
    return snapshot;
  };
  persist({ current_stage: "images", current_step: 4, detail: "检查图片断点" });

  const singlePodcastImage = task.task_type === "podcast" && task.podcast_image_mode === "single";
  for (const scene of workingScenes) {
    if (usableAsset(scene.image_path, 512)) scene.image_status = "completed";
    else if (scene.image_status === "completed") scene.image_status = scene.image_remote_task_id ? "interrupted" : "pending";
  }
  if (singlePodcastImage && usableAsset(workingScenes[0]?.image_path, 512)) {
    workingScenes.forEach(scene => {
      scene.image_path = workingScenes[0].image_path;
      scene.image_provider = workingScenes[0].image_provider;
      scene.source_url = workingScenes[0].source_url;
      scene.image_status = "completed";
    });
  }
  const pendingImages = singlePodcastImage
    ? ((!usableAsset(workingScenes[0]?.image_path, 512)) ? [workingScenes[0]] : [])
    : workingScenes.filter(scene => !usableAsset(scene.image_path, 512));
  workingScenes.filter(scene => !pendingImages.includes(scene))
    .forEach(scene => emit(4, `复用已生成画面 ${scene.index}/${workingScenes.length}`));

  const imageSection = config[config.image_provider] || {};
  const imageConcurrency = Math.max(1, Math.min(6, Number(imageSection.concurrency || 1)));
  let imageCursor = 0;
  const imageWorker = async () => {
    while (imageCursor < pendingImages.length) {
      const scene = pendingImages[imageCursor++];
      if (!scene) continue;
      if (task.shouldCancel?.()) throw new Error("任务已取消");
      scene.image_status = "running";
      scene.image_attempts = Number(scene.image_attempts || 0) + 1;
      scene.image_error = "";
      persist({ current_stage: "images", current_step: 4, detail: `生成画面 ${scene.index}` });
      emit(4, `${scene.image_remote_task_id ? "恢复远程画面任务" : "正在生成画面"} ${scene.index}/${workingScenes.length}`);
      const imagePath = path.join(imagesDir, `${scene.index}.png`);
      const stylePrefix = task.style_config?.prefix || "";
      const styleSuffix = task.style_config?.suffix || "";
      const requestId = `storybound-${task.id}-image-${scene.index}-${fingerprint(scene.image_prompt).slice(0, 12)}`;
      try {
        const imageResult = await retryOperation(async () => generateSceneImage({
          app,
          config,
          prompt: [stylePrefix, scene.image_prompt, styleSuffix].filter(Boolean).join("，"),
          destination: imagePath,
          ratio: task.ratio,
          index: scene.index,
          materialSource: task.material_source,
          referenceImagePath: scene.use_reference ? (task.reference_image_path || "") : "",
          resumeTaskId: scene.image_remote_task_id || "",
          requestId,
          onRemoteTask: remote => {
            scene.image_remote_task_id = remote.taskId || "";
            scene.image_remote_provider = remote.provider || "";
            scene.image_status = "remote_running";
            persist({ current_stage: "images", current_step: 4, detail: `画面 ${scene.index} 已提交远程任务` });
          }
        }), {
          attempts: 3,
          onRetry: (error, attempt, delay) => {
            scene.image_error = String(error?.message || error);
            persist({ detail: `画面 ${scene.index} 第 ${attempt} 次失败，${delay}ms 后重试` });
            emit(4, `第 ${scene.index} 镜网络异常，正在重试`);
          }
        });
        scene.image_path = imagePath;
        scene.image_provider = imageResult.provider || "";
        scene.source_url = imageResult.sourceUrl || "";
        scene.image_remote_task_id = imageResult.taskId || scene.image_remote_task_id || "";
        scene.image_status = "completed";
        scene.image_error = "";
        persist({ detail: `画面 ${scene.index} 完成` });
      } catch (error) {
        if (!usableAsset(imagePath, 512)) removePartial(imagePath);
        scene.image_status = "failed";
        scene.image_error = String(error?.message || error);
        persist({ detail: `画面 ${scene.index} 失败` });
        throw error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(imageConcurrency, pendingImages.length) }, () => imageWorker()));
  if (singlePodcastImage && workingScenes[0]?.image_path) {
    workingScenes.forEach(scene => {
      scene.image_path = workingScenes[0].image_path;
      scene.image_provider = workingScenes[0].image_provider;
      scene.source_url = workingScenes[0].source_url;
      scene.image_status = "completed";
    });
  }
  persist({ current_stage: "images_completed", current_step: 4, detail: "图片全部完成" });

  if (shouldPauseAfter(task, 4)) {
    emit(4, "图片已全部生成，请检查画廊后继续");
    return {
      paused: true, pauseStep: 4, outputDir,
      script: persist({ current_stage: "review_images", current_step: 4 }),
      finalVideo: "", subtitlePath: "", draftDir: "", coverPath: ""
    };
  }

  const generatedScenes = [];
  persist({ current_stage: "audio", current_step: 5, detail: "检查配音断点" });
  for (const scene of workingScenes) {
    if (task.shouldCancel?.()) throw new Error("任务已取消");
    let audioReady = await usableMedia(app, config, scene.audio_path);
    if (!audioReady && scene.audio_path) {
      removePartial(scene.audio_path);
      scene.audio_path = "";
    }
    if (!audioReady) {
      scene.audio_status = "running";
      scene.audio_attempts = Number(scene.audio_attempts || 0) + 1;
      scene.audio_error = "";
      persist({ current_stage: "audio", current_step: 5, detail: `生成配音 ${scene.index}` });
      emit(5, `正在合成配音 ${scene.index}/${workingScenes.length}`);
      const audioExt = config.tts?.provider === "system" ? "wav" : "mp3";
      const audioPath = path.join(audioDir, `${scene.index}.${audioExt}`);
      try {
        await retryOperation(async () => synthesizeSpeech({
          app,
          config,
          text: scene.narration,
          destination: audioPath,
          speed: Number(task.tts_speed || 1),
          speaker: task.task_type === "podcast" ? scene.speaker_id : task.speaker
        }), {
          attempts: 3,
          onRetry: (error, attempt, delay) => {
            scene.audio_error = String(error?.message || error);
            persist({ detail: `配音 ${scene.index} 第 ${attempt} 次失败，${delay}ms 后重试` });
            emit(5, `第 ${scene.index} 镜配音网络异常，正在重试`);
          }
        });
        scene.audio_path = audioPath;
        scene.duration = await mediaDuration(app, config, audioPath);
        scene.audio_status = "completed";
        scene.audio_error = "";
        persist({ detail: `配音 ${scene.index} 完成` });
      } catch (error) {
        if (!(await usableMedia(app, config, audioPath))) removePartial(audioPath);
        scene.audio_status = "failed";
        scene.audio_error = String(error?.message || error);
        persist({ detail: `配音 ${scene.index} 失败` });
        throw error;
      }
    } else {
      emit(5, `复用已生成配音 ${scene.index}/${workingScenes.length}`);
      scene.audio_status = "completed";
      if (!scene.duration) scene.duration = await mediaDuration(app, config, scene.audio_path);
    }
    generatedScenes.push(scene);
  }
  persist({ current_stage: "audio_completed", current_step: 5, detail: "配音全部完成" });

  if (shouldPauseAfter(task, 5)) {
    emit(5, "配音已全部生成，请检查后继续");
    return {
      paused: true, pauseStep: 5, outputDir,
      script: persist({ current_stage: "review_audio", current_step: 5 }),
      finalVideo: "", subtitlePath: "", draftDir: "", coverPath: ""
    };
  }

  const dynamicLimit = Number(task.video_intro || 0);
  const dynamicEnabled = task.material_source === "ai" && task.task_type !== "podcast" && dynamicLimit !== 0;
  if (dynamicEnabled) {
    persist({ current_stage: "dynamic_video", current_step: 6, detail: "检查动态画面断点" });
    const selectedScenes = generatedScenes.filter(scene => dynamicLimit === -1 || Number(scene.index) <= dynamicLimit);
    if (!config.runninghub?.api_key) {
      selectedScenes.forEach(scene => {
        scene.video_status = "skipped";
        scene.video_error = "未配置 RunningHub API Key，已保留静态图片";
      });
      persist({ detail: "动态画面未配置，使用图片运镜" });
      emit(6, "未配置 RunningHub API Key，动态分镜将使用图片运镜兜底");
    } else {
      const videosDir = path.join(outputDir, "videos");
      fs.mkdirSync(videosDir, { recursive: true });
      for (const scene of selectedScenes) {
        if (task.shouldCancel?.()) throw new Error("任务已取消");
        if (await usableMedia(app, config, scene.video_path)) {
          scene.video_status = "completed";
          emit(6, `复用动态画面 ${scene.index}/${workingScenes.length}`);
          continue;
        }
        if (scene.video_path) removePartial(scene.video_path);
        const videoPath = path.join(videosDir, `${scene.index}.mp4`);
        scene.video_status = "running";
        scene.video_attempts = Number(scene.video_attempts || 0) + 1;
        scene.video_error = "";
        persist({ detail: `生成动态画面 ${scene.index}` });
        emit(6, `${scene.video_remote_task_id ? "恢复动态画面任务" : "正在生成动态画面"} ${scene.index}/${workingScenes.length}`);
        try {
          const videoResult = await retryOperation(async () => generateRunningHubVideo({
            config,
            imagePath: scene.image_path,
            prompt: `${scene.visual || scene.image_prompt || scene.narration}，自然运镜，主体动作连贯，镜头稳定，避免人物变形、闪烁、文字和水印`,
            ratio: task.ratio,
            durationSec: Number(task.video_intro_duration || 0) || Number(scene.duration || scene.duration_hint || 6),
            destination: videoPath,
            resumeTaskId: scene.video_remote_task_id || "",
            resumeModel: scene.video_remote_model || "primary",
            onRemoteTask: remote => {
              scene.video_remote_task_id = remote.taskId || "";
              scene.video_remote_model = remote.model || "primary";
              scene.video_provider = remote.provider || "";
              scene.video_status = "remote_running";
              persist({ detail: `动态画面 ${scene.index} 已提交远程任务` });
            }
          }), {
            attempts: 3,
            onRetry: (error, attempt, delay) => {
              scene.video_error = String(error?.message || error);
              persist({ detail: `动态画面 ${scene.index} 第 ${attempt} 次失败，${delay}ms 后重试` });
            }
          });
          scene.video_path = videoPath;
          scene.video_provider = videoResult.provider || "runninghub-video";
          scene.video_source_url = videoResult.sourceUrl || "";
          scene.video_remote_task_id = videoResult.taskId || scene.video_remote_task_id || "";
          scene.video_status = "completed";
          scene.video_error = "";
        } catch (error) {
          removePartial(videoPath);
          scene.video_path = "";
          scene.video_provider = "";
          scene.video_source_url = "";
          scene.video_status = "failed_fallback";
          scene.video_error = error instanceof Error ? error.message : String(error);
          emit(6, `第 ${scene.index} 镜动态生成失败，已改用图片运镜`);
        }
        persist({ detail: `动态画面 ${scene.index} 处理完成` });
      }
    }
  }

  emit(6, "正在合成字幕与 MP4");
  persist({ current_stage: "render", current_step: 6, render_status: "running", detail: "合成最终视频" });
  const configuredBgm = task.bgm_id === "none" ? "" : task.bgm_path || (config.media?.use_default_bgm
    ? resolveResource(app, "default-bgm.mp3")
    : config.media?.bgm_path || "");
  let video;
  const expectedFinal = runtime.final_video || path.join(outputDir, "final.mp4");
  if (await usableMedia(app, config, expectedFinal)) {
    video = { finalVideo: expectedFinal, subtitlePath: runtime.subtitle_path || path.join(outputDir, "subtitles.srt") };
    emit(6, "复用已完成的视频合成结果");
  } else {
    removePartial(expectedFinal);
    video = await renderVideo({
      app, config, scenes: generatedScenes, outputDir,
      ratio: task.ratio, bgmPath: configuredBgm, template: task.draft_template, videoIntro: task.video_intro
    });
  }
  persist({
    render_status: "completed",
    final_video: video.finalVideo,
    subtitle_path: video.subtitlePath,
    detail: "视频合成完成"
  });

  let coverPath = runtime.cover_path || "";
  if (task.cover_image_mode === "off") {
    runtime.cover_status = "skipped";
    coverPath = "";
  } else if (usableAsset(coverPath, 512)) {
    runtime.cover_status = "completed";
  } else {
    persist({ current_stage: "cover", current_step: 6, cover_status: "running", detail: "生成封面" });
    coverPath = await generateCover({
      app, config, task, outputDir, script: { ...script, scenes: generatedScenes },
      sourceImage: generatedScenes[0]?.image_path, template: task.cover_template
    });
    runtime.cover_status = coverPath ? "completed" : "skipped";
  }
  persist({ cover_status: runtime.cover_status, cover_path: coverPath, detail: "封面处理完成" });

  emit(7, "正在生成剪映草稿");
  let draftDir = runtime.draft_dir || "";
  if (draftDir && fs.existsSync(draftDir)) {
    runtime.draft_status = "completed";
    emit(7, "复用已生成剪映草稿");
  } else {
    persist({ current_stage: "draft", current_step: 7, draft_status: "running", detail: "生成剪映草稿" });
    try {
      const draft = await generateJianyingDraft({
        app,
        config,
        task: { ...task, pipeline_data: JSON.stringify(pipelineSnapshot(script, generatedScenes, runtime)) },
        outputDir,
        scenes: generatedScenes,
        bgmPath: configuredBgm
      });
      draftDir = draft?.draft_dir || "";
      runtime.draft_status = "completed";
    } catch (error) {
      atomicWriteFile(path.join(outputDir, "draft-error.txt"), String(error?.stack || error), "utf8");
      runtime.draft_status = "failed_optional";
    }
  }

  emit(8, "全部生成完成");
  const finalScript = persist({
    current_stage: "completed",
    current_step: 8,
    detail: "全部完成",
    render_status: "completed",
    draft_status: runtime.draft_status,
    final_video: video.finalVideo,
    subtitle_path: video.subtitlePath,
    draft_dir: draftDir,
    cover_path: coverPath,
    completed_at: new Date().toISOString()
  });
  return {
    outputDir,
    script: finalScript,
    finalVideo: video.finalVideo,
    subtitlePath: video.subtitlePath,
    draftDir,
    coverPath
  };
}

async function runPipeline({ app, task, config, baseOutputDir, emit, checkpoint = () => {} }) {
  const outputDir = taskOutputDir(task, config, baseOutputDir);
  const existing = readJsonSafe(path.join(outputDir, "pipeline.json"), null);
  if (existing?.scenes?.length) {
    checkpoint({ outputDir, pipeline: existing, currentStage: existing.runtime?.current_stage || "resume", currentStep: existing.runtime?.current_step || task.current_step || 3 });
    emit(Math.max(3, Number(existing.runtime?.current_step || task.current_step || 3)), "检测到上次断点，正在继续执行");
    return completePipeline({ app, task, config, outputDir, script: existing, emit, checkpoint });
  }
  const prepared = await preparePipeline({ task, config, baseOutputDir, emit, checkpoint });
  return completePipeline({ app, task, config, ...prepared, emit, checkpoint });
}

async function regenerateScene({ app, task, config, outputDir, script, sceneIndex, kind, emit = () => {} }) {
  const scene = script.scenes.find(item => Number(item.index) === Number(sceneIndex));
  if (!scene) throw new Error("分镜不存在");
  if (kind === "image") {
    emit(4, `正在重新生成第 ${scene.index} 镜画面`);
    fs.mkdirSync(path.join(outputDir, "images"), { recursive: true });
    const imagePath = path.join(outputDir, "images", `${scene.index}.png`);
    scene.image_status = "running";
    scene.image_remote_task_id = "";
    scene.image_error = "";
    const imageResult = await generateSceneImage({
      app, config,
      prompt: [task.style_config?.prefix, scene.image_prompt, task.style_config?.suffix].filter(Boolean).join("，"),
      destination: imagePath, ratio: task.ratio, index: scene.index,
      materialSource: task.material_source, referenceImagePath: scene.use_reference ? (task.reference_image_path || "") : "",
      requestId: `storybound-${task.id}-image-${scene.index}-${Date.now()}`
    });
    scene.image_path = imagePath;
    scene.image_provider = imageResult.provider || "";
    scene.source_url = imageResult.sourceUrl || "";
    scene.image_status = "completed";
    scene.video_path = "";
    scene.video_provider = "";
    scene.video_source_url = "";
    scene.video_remote_task_id = "";
    scene.video_status = "pending";
    scene.video_error = "图片已更新，动态画面将在继续任务时重新生成";
  } else if (kind === "audio") {
    emit(5, `正在重新生成第 ${scene.index} 镜配音`);
    fs.mkdirSync(path.join(outputDir, "audio"), { recursive: true });
    const extension = config.tts?.provider === "system" ? "wav" : "mp3";
    const audioPath = path.join(outputDir, "audio", `${scene.index}.${extension}`);
    scene.audio_status = "running";
    await synthesizeSpeech({ app, config, text: scene.narration, destination: audioPath, speed: Number(task.tts_speed || 1), speaker: task.task_type === "podcast" ? scene.speaker_id : task.speaker });
    scene.audio_path = audioPath;
    scene.duration = await mediaDuration(app, config, audioPath);
    scene.audio_status = "completed";
    scene.audio_error = "";
  }
  script.runtime = {
    ...(script.runtime || {}),
    current_stage: "review",
    current_step: kind === "image" ? 4 : 5,
    render_status: "pending",
    final_video: "",
    updated_at: new Date().toISOString()
  };
  atomicWriteJson(path.join(outputDir, "pipeline.json"), script);
  return script;
}

async function renderPrepared({ app, task, config, outputDir, script, emit }) {
  for (const scene of script.scenes) {
    if (!usableAsset(scene.image_path, 512) || !(await usableMedia(app, config, scene.audio_path))) {
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
    atomicWriteFile(path.join(outputDir, "draft-error.txt"), String(error?.stack || error), "utf8");
  }
  emit(8, "重新合成完成");
  const coverPath = await generateCover({
    app, config, task, outputDir, script,
    sourceImage: script.scenes[0]?.image_path, template: task.cover_template
  });
  script.runtime = {
    ...(script.runtime || {}),
    current_stage: "completed",
    current_step: 8,
    render_status: "completed",
    final_video: video.finalVideo,
    subtitle_path: video.subtitlePath,
    draft_dir: draftDir,
    cover_path: coverPath,
    completed_at: new Date().toISOString()
  };
  atomicWriteJson(path.join(outputDir, "pipeline.json"), script);
  return { outputDir, script, finalVideo: video.finalVideo, subtitlePath: video.subtitlePath, draftDir, coverPath };
}

module.exports = {
  runPipeline,
  preparePipeline,
  completePipeline,
  regenerateScene,
  renderPrepared,
  taskOutputDir
};
