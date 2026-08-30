const fs = require("node:fs");
const path = require("node:path");
const base = require("./pipeline-video.cjs");
const { atomicWriteJson } = require("./checkpoint.cjs");
const { isSingleDadStoryTask } = require("./single-dad-story.cjs");

function imageFileReady(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return false;
    const stat = fs.statSync(filePath);
    return stat.isFile() && stat.size >= 512;
  } catch {
    return false;
  }
}

function hasAllImages(script) {
  return Boolean(
    Array.isArray(script?.scenes)
    && script.scenes.length
    && script.scenes.every(scene => imageFileReady(scene?.image_path))
  );
}

function isSingleDadRepair(args) {
  const stage = String(args?.script?.runtime?.current_stage || "");
  const taskStep = Number(args?.task?.current_step || 0);
  return isSingleDadStoryTask(args?.task)
    && stage === "review_images_partial"
    && taskStep <= 3;
}

function removeStaleImageDebug(outputDir, sceneIndex) {
  if (!outputDir || sceneIndex === undefined || sceneIndex === null) return;
  const debugDir = path.join(outputDir, "image-debug");
  for (const suffix of ["submit", "poll", "response", "download", "content-policy", "style-audit"]) {
    try { fs.rmSync(path.join(debugDir, `${sceneIndex}-${suffix}.json`), { force: true }); } catch {}
  }
}

function prepareFreshMissingImages(script, outputDir) {
  if (!Array.isArray(script?.scenes)) return 0;
  let count = 0;
  for (const scene of script.scenes) {
    if (imageFileReady(scene?.image_path)) continue;
    count += 1;

    // “补齐缺失画面”必须代表一次全新的生图提交。
    // 旧 task_id、旧 provider、旧错误和旧调试文件都不能参与本次补图。
    scene.image_status = "pending";
    scene.image_attempts = 0;
    scene.image_error = "";
    scene.image_remote_task_id = "";
    scene.image_remote_provider = "";
    scene.image_style_id = "";
    scene.image_style_registry_version = "";
    scene.image_prompt_used = "";
    scene.image_safe_prompt_used = "";
    scene.image_negative_prompt_used = "";
    scene.image_provider = "";
    scene.source_url = "";

    if (scene.image_path && !imageFileReady(scene.image_path)) {
      try { fs.rmSync(scene.image_path, { force: true }); } catch {}
      scene.image_path = "";
    }
    removeStaleImageDebug(outputDir, scene.index);
  }

  if (count > 0) {
    script.runtime = {
      ...(script.runtime || {}),
      current_stage: "repair_images_ready",
      current_step: 3,
      repair_started_at: new Date().toISOString(),
      detail: `补齐缺失画面：已清理 ${count} 张缺失画面的旧远程任务，准备重新提交`
    };
    atomicWriteJson(path.join(outputDir, "pipeline.json"), script);
  }
  return count;
}

function singleDadImageEmit(outputDir, emit = () => {}) {
  return (step, message) => {
    const text = String(message || "");
    const retryMatch = text.match(/^第\s*(\d+)\s*镜(?:网络异常，正在重试|查询异常，继续恢复已提交任务)$/);
    if (Number(step) === 4 && retryMatch) {
      const sceneIndex = Number(retryMatch[1]);
      try {
        const pipelinePath = path.join(outputDir, "pipeline.json");
        const current = JSON.parse(fs.readFileSync(pipelinePath, "utf8"));
        const scene = current?.scenes?.find(item => Number(item.index) === sceneIndex);
        const error = String(scene?.image_error || "").trim();
        if (error) {
          const prefix = text.includes("查询异常") ? "查询已提交任务失败" : "生图提交/处理失败";
          emit(step, `第 ${sceneIndex} 镜${prefix}：${error.slice(0, 220)}，正在重试`);
          return;
        }
      } catch {}
    }
    emit(step, message);
  };
}

function finalizeImageStory({ task, outputDir, script, emit = () => {}, checkpoint = () => {} }) {
  const scenes = (script.scenes || []).map(scene => ({
    ...scene,
    image_status: imageFileReady(scene.image_path) ? "completed" : scene.image_status,
    audio_status: "skipped",
    audio_attempts: 0,
    audio_error: "",
    audio_path: "",
    video_status: "skipped",
    video_attempts: 0,
    video_error: "",
    video_path: "",
    video_remote_task_id: "",
    video_remote_model: "",
    render_clip_status: "skipped"
  }));
  const finalScript = {
    ...script,
    scenes,
    runtime: {
      ...(script.runtime || {}),
      output_mode: "image_story",
      current_stage: "completed",
      current_step: 8,
      detail: "父女日常图文完成：图片已确认，已跳过配音、BGM、动态视频、MP4、封面和剪映草稿",
      render_status: "skipped",
      cover_status: "skipped",
      draft_status: "skipped",
      final_video: "",
      subtitle_path: "",
      draft_dir: "",
      cover_path: "",
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }
  };
  atomicWriteJson(path.join(outputDir, "pipeline.json"), finalScript);
  atomicWriteJson(path.join(outputDir, "script.json"), finalScript);
  checkpoint({
    outputDir,
    pipeline: finalScript,
    currentStage: "completed",
    currentStep: 8,
    detail: finalScript.runtime.detail
  });
  emit(8, "父女日常图文已完成，已跳过全部视频相关流程");
  return {
    outputDir,
    script: finalScript,
    finalVideo: "",
    subtitlePath: "",
    draftDir: "",
    coverPath: ""
  };
}

async function completePipeline(args) {
  if (!isSingleDadStoryTask(args.task)) return base.completePipeline(args);

  const currentStep = Number(args.task?.current_step || args.script?.runtime?.current_step || 0);
  if (currentStep >= 4 && hasAllImages(args.script)) {
    return finalizeImageStory(args);
  }

  if (isSingleDadRepair(args)) {
    const cleared = prepareFreshMissingImages(args.script, args.outputDir);
    if (cleared > 0) {
      args.emit?.(4, `补齐缺失画面：已清除 ${cleared} 张旧任务记录，将重新提交新的生图请求`);
    }
  }

  // 父女日常第一阶段只生成图片，并且无论外部任务如何配置，都强制在图片阶段暂停。
  // 这样第一次“继续”只消耗生图接口；用户确认图片后，第二次“继续”直接完成图文任务。
  const imageOnlyTask = {
    ...args.task,
    current_step: Math.min(currentStep, 3),
    pause_mode: "every",
    pause_points: JSON.stringify([4]),
    bgm_id: "none",
    video_intro: 0,
    video_intro_duration: 0,
    cover_image_mode: "off"
  };
  return base.completePipeline({
    ...args,
    task: imageOnlyTask,
    emit: singleDadImageEmit(args.outputDir, args.emit)
  });
}

async function runPipeline(args) {
  if (!isSingleDadStoryTask(args.task)) return base.runPipeline(args);

  const outputDir = base.taskOutputDir(args.task, args.config, args.baseOutputDir);
  let existing = null;
  const pipelinePath = path.join(outputDir, "pipeline.json");
  try {
    if (fs.existsSync(pipelinePath)) existing = JSON.parse(fs.readFileSync(pipelinePath, "utf8"));
  } catch {}

  if (existing?.scenes?.length) {
    args.checkpoint?.({
      outputDir,
      pipeline: existing,
      currentStage: existing.runtime?.current_stage || "resume",
      currentStep: existing.runtime?.current_step || args.task.current_step || 3
    });
    args.emit?.(Math.max(3, Number(existing.runtime?.current_step || args.task.current_step || 3)), "检测到父女图文任务断点，正在继续执行");
    return completePipeline({ ...args, outputDir, script: existing });
  }

  const prepared = await base.preparePipeline(args);
  return completePipeline({ ...args, ...prepared });
}

async function regenerateScene(args) {
  if (isSingleDadStoryTask(args.task) && args.kind === "audio") {
    throw new Error("父女日常为公众号图文模式，不生成配音");
  }
  return base.regenerateScene(args);
}

async function renderPrepared(args) {
  if (isSingleDadStoryTask(args.task)) {
    throw new Error("父女日常为公众号图文模式，不生成视频或剪映草稿");
  }
  return base.renderPrepared(args);
}

module.exports = {
  runPipeline,
  preparePipeline: base.preparePipeline,
  completePipeline,
  regenerateScene,
  renderPrepared,
  taskOutputDir: base.taskOutputDir,
  _pipelineTest: {
    ...(base._pipelineTest || {}),
    hasAllImages,
    isSingleDadRepair,
    prepareFreshMissingImages
  }
};
