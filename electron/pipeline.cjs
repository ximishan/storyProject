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
  return base.completePipeline({ ...args, task: imageOnlyTask });
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
    hasAllImages
  }
};
