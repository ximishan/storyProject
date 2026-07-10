const { app, BrowserWindow, Menu, ipcMain, shell, dialog, clipboard } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { openDatabase, createTask } = require("./database.cjs");
const {
  runPipeline, preparePipeline, completePipeline, regenerateScene, renderPrepared, taskOutputDir
} = require("./pipeline.cjs");
const { generateSceneImage, synthesizeSpeech, requestVolcengineSpeech, testConnection, spawnAsync, listSystemVoices, ffmpegPath, mediaDuration } = require("./services.cjs");
const { renderMusicVideo, _captionTest } = require("./media.cjs");
const { generateMusicDraft } = require("./draft.cjs");
const crypto = require("node:crypto");
const { atomicWriteJson } = require("./checkpoint.cjs");
const {
  TaskCancelledError, runWithCancellation, isCancellationError
} = require("./cancellation.cjs");
const {
  STYLE_REGISTRY_VERSION, STYLE_REGISTRY_SOURCE_SHA256,
  canonicalStyleId, normalizeVisualStyle,
  resolveVisualStyle, styleSnapshot
} = require("./visual-styles.cjs");

let mainWindow;
let db;
let queueRunning = false;
const activeTaskRuns = new Map();
const APIMART_DEFAULT_BASE_URL = "https://api.apib.ai/v1";

const defaultConfig = {
  config_version: 6,
  llm: {
    provider: "local",
    protocol: "local",
    api_key: "",
    base_url: "https://api.anthropic.com",
    model: "claude-sonnet-4-6",
    proxy_url: ""
  },
  image_provider: "custom_image",
  gpt_image: {
    api_key: "", base_url: "https://api.openai.com/v1", model: "gpt-image-1",
    ratio: "9:16", resolution: "1k", concurrency: 5, proxy_url: ""
  },
  modelscope: {
    api_key: "", base_url: "https://api-inference.modelscope.cn/v1",
    model: "Tongyi-MAI/Z-Image-Turbo", ratio: "9:16", resolution: "1k", concurrency: 1,
    proxy_url: "", custom_models: [], negative_prompt_field: "negative_prompt"
  },
  custom_image: {
    display_name: "foxcode",
    base_url: "https://dm-fox.rjj.cc/codex/v1",
    api_key: "",
    model: "gpt-image-2",
    async_mode: false,
    submit_path: "/images/generations",
    edit_path: "/images/edits",
    quality: "high",
    response_format: "auto",
    edit_response_format: "b64_json",
    moderation: "none",
    policy_fallback: true,
    status_path: "",
    task_id_field: "task_id",
    status_field: "status",
    image_field: "data.0.url",
    success_values: "succeeded,completed,success",
    negative_prompt_field: "",
    extra_body_json: "",
    ratio_mapping_json: "",
    ratio: "9:16",
    resolution: "1k",
    concurrency: 3,
    proxy_url: ""
  },
  apimart: {
    display_name: "Apimart",
    base_url: APIMART_DEFAULT_BASE_URL,
    api_key: "",
    model: "gpt-image-2",
    ratio: "9:16",
    resolution: "1k",
    concurrency: 3,
    official_fallback: false,
    policy_fallback: true,
    poll_interval_ms: 3000,
    poll_timeout_seconds: 600,
    proxy_url: ""
  },
  runninghub: {
    api_key: "", base_url: "https://www.runninghub.cn", model: "rh-image-g2", workflow_id: "",
    prompt_node_id: "", prompt_field_name: "text", node_info_json: "[]",
    ratio: "9:16", resolution: "1k", concurrency: 1, proxy_url: ""
  },
  tts: {
    provider: "system",
    system: {
      voice: "",
      volume: 100
    },
    volcengine: {
      app_id: "", access_key: "", engine_version: "2.0", resource_id: "seed-tts-2.0",
      base_url: "https://openspeech.bytedance.com/api/v3/tts/unidirectional",
      speaker: "zh_female_xiaohe_uranus_bigtts"
    }
  },
  jianying: { draft_path: "" },
  media: { ffmpeg_path: "", bgm_path: "", use_default_bgm: false },
  task_storage_path: "",
  ui: { theme: "dark" }
};

function configPath() {
  return path.join(app.getPath("userData"), "config.json");
}

function readConfig() {
  try {
    const saved = JSON.parse(fs.readFileSync(configPath(), "utf8"));
    const merged = {
      ...defaultConfig, ...saved,
      llm: { ...defaultConfig.llm, ...saved.llm },
      gpt_image: { ...defaultConfig.gpt_image, ...saved.gpt_image },
      modelscope: { ...defaultConfig.modelscope, ...saved.modelscope },
      custom_image: { ...defaultConfig.custom_image, ...saved.custom_image },
      apimart: { ...defaultConfig.apimart, ...saved.apimart },
      runninghub: { ...defaultConfig.runninghub, ...saved.runninghub },
      tts: {
        provider: saved.tts?.provider || (saved.tts?.volcengine?.app_id && saved.tts?.volcengine?.access_key ? "volcengine" : "system"),
        system: { ...defaultConfig.tts.system, ...saved.tts?.system },
        volcengine: { ...defaultConfig.tts.volcengine, ...saved.tts?.volcengine }
      },
      jianying: { ...defaultConfig.jianying, ...saved.jianying },
      media: { ...defaultConfig.media, ...saved.media },
      ui: { ...defaultConfig.ui, ...saved.ui }
    };
    if (!saved.config_version || saved.config_version < 6) {
      if (!merged.llm.api_key && merged.llm.provider !== "local") {
        merged.llm.provider = "local";
        merged.llm.protocol = "local";
      }
      if (!saved.tts?.provider) {
        merged.tts.provider = merged.tts.volcengine.app_id && merged.tts.volcengine.access_key ? "volcengine" : "system";
      }
      merged.custom_image.display_name = merged.custom_image.display_name || "foxcode";
      merged.apimart.display_name = "Apimart";
      merged.config_version = 6;
      fs.writeFileSync(configPath(), JSON.stringify(merged, null, 2), "utf8");
    }
    merged.custom_image.display_name = "foxcode";
    merged.apimart.display_name = "Apimart";
    merged.apimart.model = "gpt-image-2";
    if (merged.image_provider === "gpt_image") {
      merged.custom_image = {
        ...merged.custom_image,
        base_url: merged.custom_image.base_url || merged.gpt_image.base_url,
        api_key: merged.custom_image.api_key || merged.gpt_image.api_key,
        model: merged.custom_image.model || merged.gpt_image.model
      };
      merged.image_provider = "custom_image";
    }
    if (!["custom_image", "apimart", "modelscope", "runninghub", "placeholder"].includes(merged.image_provider)) {
      merged.image_provider = "custom_image";
    }
    if (!["system", "volcengine"].includes(merged.tts.provider)) merged.tts.provider = "system";
    return merged;
  } catch {
    fs.writeFileSync(configPath(), JSON.stringify(defaultConfig, null, 2), "utf8");
    return defaultConfig;
  }
}

function createWindow() {
  const logPath = path.join(app.getPath("userData"), "renderer.log");
  const log = line => fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${line}\n`, "utf8");
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: "#090b10",
    title: "Storybound",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  Menu.setApplicationMenu(null);
  mainWindow.webContents.on("console-message", details => {
    const { level = "info", message = "", lineNumber = 0, sourceId = "renderer" } = details || {};
    log(`console level=${level} ${message} (${sourceId}:${lineNumber})`);
  });
  mainWindow.webContents.on("did-fail-load", (_event, code, description, url) => {
    log(`load failed code=${code} description=${description} url=${url}`);
  });
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    log(`renderer gone reason=${details.reason} exitCode=${details.exitCode}`);
  });
  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html")).catch(error => {
      log(`loadFile rejected: ${error?.stack || error}`);
    });
  } else {
    mainWindow.loadURL("http://127.0.0.1:5173");
  }
}

app.whenReady().then(() => {
  fs.mkdirSync(app.getPath("userData"), { recursive: true });
  db = openDatabase(path.join(app.getPath("userData"), "data.db"));
  const interruptedAt = Date.now();
  const interruptedRows = db.prepare("SELECT id,current_step FROM tasks WHERE status='running'").all();
  db.prepare(`UPDATE tasks SET status='interrupted',current_stage='interrupted',interrupted_at=?,last_heartbeat_at=?,
    error_message=CASE WHEN error_message='' THEN '检测到上次运行异常中断，可从断点继续' ELSE error_message END
    WHERE status='running'`).run(interruptedAt, interruptedAt);
  const interruptedEvent = db.prepare("INSERT INTO task_events(task_id,type,step,detail,data_json,ts) VALUES(?,?,?,?,?,?)");
  for (const row of interruptedRows) interruptedEvent.run(row.id, "interrupted", row.current_step || 0, "程序上次未正常结束，任务已标记为可恢复", "{}", interruptedAt);
  const config = readConfig();
  const smokeOutput = process.env.STORYBOUND_SMOKE_OUTPUT;
  if (smokeOutput) {
    fs.mkdirSync(smokeOutput, { recursive: true });
    const smokeConfig = {
      ...config,
      llm: { ...config.llm, provider: "local", protocol: "local", api_key: "" },
      image_provider: "placeholder",
      tts: { ...config.tts, provider: "system" },
      media: { ...config.media, ffmpeg_path: "", bgm_path: "", use_default_bgm: false },
      task_storage_path: smokeOutput,
      jianying: { draft_path: "" }
    };
    runPipeline({
      app,
      task: {
        id: "packaged-smoke",
        title: "安装包冒烟测试",
        input_text: "清晨的阳光照进房间。新的一天开始了。",
        track: "character-story",
        style: "cinematic",
        ratio: "9:16",
        target_scenes: 1,
        tts_speed: 1
      },
      config: smokeConfig,
      baseOutputDir: smokeOutput,
      emit: () => {}
    }).then(result => {
      fs.writeFileSync(path.join(smokeOutput, "smoke-result.json"), JSON.stringify({
        success: true,
        finalVideo: result.finalVideo,
        draftDir: result.draftDir
      }, null, 2), "utf8");
      app.quit();
    }).catch(error => {
      fs.writeFileSync(path.join(smokeOutput, "smoke-result.json"), JSON.stringify({
        success: false,
        error: String(error?.stack || error)
      }, null, 2), "utf8");
      app.exit(1);
    });
    return;
  }
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("tasks:list", () =>
  db.prepare("SELECT * FROM tasks ORDER BY datetime(created_at) DESC").all()
    .map(reconcileTaskPipelineLocalAssets)
    .map(restoreStoredTaskPromptLayers)
);
ipcMain.handle("tasks:create", (_event, input) => createTask(db, input));
ipcMain.handle("tasks:delete", (_event, id) => {
  db.prepare("DELETE FROM task_events WHERE task_id=?").run(id);
  db.prepare("DELETE FROM tasks WHERE id=?").run(id);
});
ipcMain.handle("tasks:cancel", (_event, id) => {
  const controller = activeTaskRuns.get(id);
  const state = db.prepare("SELECT status,current_stage,current_step,cancel_requested FROM tasks WHERE id=?").get(id);
  if (!state) throw new Error("任务不存在");
  const active = Boolean(controller && !controller.signal.aborted);
  const stage = String(state.current_stage || "").toLowerCase();
  const drainingImages = active && (stage.startsWith("images") || (Number(state.current_step || 0) === 4 && state.status === "running"));

  if (drainingImages) {
    // Soft cancel while images are being generated: stop scheduling new scenes,
    // but keep the current HTTP requests / remote task polling alive so every
    // already-submitted image is downloaded before the pipeline exits.
    db.prepare(`UPDATE tasks SET cancel_requested=1,status='cancelling',current_stage='images_draining',
      error_message='已停止提交新图片，正在等待已提交图片下载',queue_order=0,queue_batch_id='',last_heartbeat_at=? WHERE id=?`).run(Date.now(), id);
    mainWindow?.webContents.send("task:event", {
      taskId: id,
      status: "cancelling",
      step: 4,
      message: "已停止提交后续图片，正在等待已提交任务生成并下载到本地"
    });
  } else {
    db.prepare(`UPDATE tasks SET cancel_requested=1,status='cancelled',current_stage='cancelled',
      error_message='任务已取消',queue_order=0,queue_batch_id='',last_heartbeat_at=? WHERE id=?`).run(Date.now(), id);
    if (controller && !controller.signal.aborted) controller.abort(new TaskCancelledError());
    mainWindow?.webContents.send("task:event", { taskId: id, status: "cancelled", step: 0, message: "任务已取消，正在停止当前请求和本地进程" });
  }
  return db.prepare("SELECT * FROM tasks WHERE id=?").get(id);
});
ipcMain.handle("tasks:duplicate", (_event, id) => {
  const task = db.prepare("SELECT * FROM tasks WHERE id=?").get(id);
  if (!task) throw new Error("任务不存在");
  return createTask(db, {
    title: `${task.title} - 副本`, inputText: task.input_text, track: task.track, style: task.style,
    ratio: task.ratio, targetScenes: task.target_scenes, ttsProvider: task.tts_provider, ttsSpeed: task.tts_speed,
    promptTemplateId: task.prompt_template_id, rewriteIntensity: task.rewrite_intensity,
    narrativePov: task.narrative_pov, keepPromotion: task.keep_promotion,
    materialSource: task.material_source, targetLength: task.target_length,
    templateId: task.template_id, referenceImagePath: task.reference_image_path,
    productReferenceImagePath: task.product_reference_image_path,
    characterConsistencyMode: task.character_consistency_mode,
    coverImageMode: task.cover_image_mode, coverTemplateId: task.cover_template_id, pauseMode: task.pause_mode,
    sourceMode: task.source_mode, sourceQuery: task.source_query, sourceRequirements: task.source_requirements, bgmId: task.bgm_id,
    speaker: task.speaker, taskType: task.task_type, scriptFormat: task.script_format,
    podcastImageMode: task.podcast_image_mode, podcastSpeakers: task.podcast_speakers,
    processingMode: task.processing_mode, pausePoints: JSON.parse(task.pause_points || "[]"),
    videoIntro: task.video_intro, videoIntroDuration: task.video_intro_duration,
    researchWeb: Boolean(task.research_web), researchAi: Boolean(task.research_ai), researchIma: Boolean(task.research_ima)
  });
});

function assertNoMojibakeQuestionRuns(pipeline) {
  const fields = ["narration", "visual", "desc_prompt", "image_prompt", "image_error", "audio_error", "video_error"];
  const problems = [];
  for (const scene of pipeline?.scenes || []) {
    for (const field of fields) {
      const value = String(scene?.[field] || "");
      if (/\?{5,}/.test(value)) problems.push(`镜头 ${scene.index || "?"} ${field}`);
    }
  }
  if (problems.length) {
    throw new Error(`检测到疑似中文编码损坏的问号串，已阻止保存：${problems.slice(0, 5).join("、")}`);
  }
}

function isUsableLocalFile(filePath, minBytes = 512) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return false;
    const stat = fs.statSync(filePath);
    return stat.isFile() && stat.size >= minBytes;
  } catch {
    return false;
  }
}

function findIndexedLocalAsset(outputDir, folder, index, extensions) {
  if (!outputDir || !index) return "";
  for (const extension of extensions) {
    const candidate = path.join(outputDir, folder, `${index}${extension}`);
    if (isUsableLocalFile(candidate)) return candidate;
  }
  return "";
}

function normalizePipelineLocalAssets(pipeline, outputDir = "") {
  if (!Array.isArray(pipeline?.scenes)) return pipeline;
  for (const scene of pipeline.scenes) {
    if (!scene?.image_path) {
      const recovered = findIndexedLocalAsset(outputDir, "images", scene?.index, [".png", ".jpg", ".jpeg", ".webp"]);
      if (recovered) {
        scene.image_path = recovered;
        scene.image_provider = scene.image_provider || "custom-local";
      }
    }
    if (scene?.image_path) {
      if (isUsableLocalFile(scene.image_path)) {
        scene.image_status = "completed";
        scene.image_error = "";
        if (!scene.image_provider) scene.image_provider = "custom-local";
      } else {
        scene.image_path = "";
        scene.image_status = "pending";
        scene.image_error = "本地图片文件不存在或不可用";
      }
    }
    if (!scene?.audio_path) {
      const recovered = findIndexedLocalAsset(outputDir, "audio", scene?.index, [".mp3", ".wav", ".m4a", ".aac"]);
      if (recovered) scene.audio_path = recovered;
    }
    if (scene?.audio_path) {
      if (isUsableLocalFile(scene.audio_path)) {
        scene.audio_status = "completed";
        scene.audio_error = "";
      } else {
        scene.audio_path = "";
        scene.audio_status = "pending";
        scene.audio_error = "本地配音文件不存在或不可用";
      }
    }
  }
  return pipeline;
}

function reconcileTaskPipelineLocalAssets(task) {
  if (!task?.pipeline_data || !task.output_dir) return task;
  let pipeline;
  try { pipeline = JSON.parse(task.pipeline_data); } catch { return task; }
  const before = JSON.stringify(pipeline?.scenes?.map(scene => ({
    index: scene.index,
    image_path: scene.image_path || "",
    image_status: scene.image_status || "",
    audio_path: scene.audio_path || "",
    audio_status: scene.audio_status || ""
  })) || []);
  pipeline = normalizePipelineLocalAssets(pipeline, task.output_dir);
  const after = JSON.stringify(pipeline?.scenes?.map(scene => ({
    index: scene.index,
    image_path: scene.image_path || "",
    image_status: scene.image_status || "",
    audio_path: scene.audio_path || "",
    audio_status: scene.audio_status || ""
  })) || []);
  if (before === after) return task;
  const pipelineData = JSON.stringify(pipeline);
  db.prepare("UPDATE tasks SET pipeline_data=?,last_checkpoint_at=? WHERE id=?").run(pipelineData, Date.now(), task.id);
  try {
    atomicWriteJson(path.join(task.output_dir, "script.json"), pipeline);
    atomicWriteJson(path.join(task.output_dir, "pipeline.json"), pipeline);
  } catch {}
  return { ...task, pipeline_data: pipelineData };
}

ipcMain.handle("tasks:updatePipeline", (_event, id, pipeline) => {
  const task = db.prepare("SELECT * FROM tasks WHERE id=?").get(id);
  pipeline = normalizePipelineLocalAssets(pipeline, task?.output_dir || "");
  assertNoMojibakeQuestionRuns(pipeline);
  const runtime = pipeline?.runtime || {};
  db.prepare("UPDATE tasks SET pipeline_data=?,current_stage=?,current_step=?,last_checkpoint_at=? WHERE id=?")
    .run(JSON.stringify(pipeline), runtime.current_stage || "review", Number(runtime.current_step || 3), Date.now(), id);
  if (task?.output_dir) {
    atomicWriteJson(path.join(task.output_dir, "script.json"), pipeline);
    atomicWriteJson(path.join(task.output_dir, "pipeline.json"), pipeline);
  }
  return db.prepare("SELECT * FROM tasks WHERE id=?").get(id);
});
ipcMain.handle("templates:list", () =>
  db.prepare("SELECT * FROM draft_templates ORDER BY name").all()
);
ipcMain.handle("templates:save", (_event, input) => {
  const id = input.id || crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO draft_templates(id,name,is_default,config,created_at,updated_at)
    VALUES(?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name,config=excluded.config,updated_at=excluded.updated_at`)
    .run(id, input.name, 0, input.config, input.created_at || now, now);
  return db.prepare("SELECT * FROM draft_templates WHERE id=?").get(id);
});
ipcMain.handle("templates:delete", (_event, id) =>
  db.prepare("DELETE FROM draft_templates WHERE id=? AND is_default=0").run(id)
);
ipcMain.handle("covers:list", () => db.prepare("SELECT * FROM cover_templates ORDER BY name").all());
ipcMain.handle("bgm:list", () => {
  const rows = db.prepare("SELECT * FROM bgm_library ORDER BY is_default DESC,name").all();
  return [{ id: "builtin", name: "内置 BGM", path: "", is_default: 1 }, { id: "none", name: "不使用背景音乐", path: "", is_default: 1 }, ...rows];
});
ipcMain.handle("bgm:add", async () => {
  const selected = await dialog.showOpenDialog(mainWindow, {
    title: "添加背景音乐", properties: ["openFile"],
    filters: [{ name: "音频", extensions: ["mp3", "wav", "m4a", "aac", "flac"] }]
  });
  if (selected.canceled) return null;
  const dir = path.join(app.getPath("userData"), "bgm");
  fs.mkdirSync(dir, { recursive: true });
  const id = crypto.randomUUID();
  const destination = path.join(dir, `${id}${path.extname(selected.filePaths[0])}`);
  fs.copyFileSync(selected.filePaths[0], destination);
  db.prepare("INSERT INTO bgm_library(id,name,path,is_default,created_at) VALUES(?,?,?,?,?)")
    .run(id, path.basename(selected.filePaths[0], path.extname(selected.filePaths[0])), destination, 0, new Date().toISOString());
  return db.prepare("SELECT * FROM bgm_library WHERE id=?").get(id);
});
function applyProfile(profile) {
  const config = readConfig();
  config.llm = {
    ...config.llm,
    provider: profile.provider,
    protocol: profile.protocol,
    base_url: profile.base_url || "",
    api_key: profile.api_key || "",
    model: profile.model || "",
    proxy_url: profile.proxy_url || "",
    active_profile_id: profile.id
  };
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2), "utf8");
  return config;
}

ipcMain.handle("profiles:list", () => {
  db.prepare(`UPDATE llm_profiles
    SET base_url='',api_key='',model='',proxy_url=''
    WHERE provider='local' OR protocol='local'`).run();
  db.prepare(`UPDATE llm_profiles
    SET provider='custom',
        protocol=CASE WHEN protocol='anthropic' THEN 'anthropic' ELSE 'openai' END`).run();
  let rows = db.prepare("SELECT * FROM llm_profiles ORDER BY is_default DESC,updated_at DESC").all();
  if (!rows.length) {
    const config = readConfig();
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const hasRemoteConfig = config.llm?.provider !== "local"
      && ["openai", "anthropic"].includes(config.llm?.protocol);
    const protocol = hasRemoteConfig && config.llm?.protocol === "anthropic" ? "anthropic" : "openai";
    db.prepare(`INSERT INTO llm_profiles(id,name,provider,protocol,base_url,api_key,model,proxy_url,is_default,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,1,?,?)`).run(
        id, "自定义 / 其他",
        "custom", protocol,
        hasRemoteConfig ? config.llm?.base_url || "" : "",
        hasRemoteConfig ? config.llm?.api_key || "" : "",
        hasRemoteConfig ? config.llm?.model || "" : "",
        hasRemoteConfig ? config.llm?.proxy_url || "" : "",
        now, now
      );
    rows = db.prepare("SELECT * FROM llm_profiles ORDER BY is_default DESC,updated_at DESC").all();
    applyProfile(rows[0]);
  }
  return rows;
});
ipcMain.handle("profiles:save", (_event, input) => {
  const id = input.id || crypto.randomUUID();
  const now = new Date().toISOString();
  const protocol = input.protocol === "anthropic" ? "anthropic" : "openai";
  if (input.is_default) db.prepare("UPDATE llm_profiles SET is_default=0").run();
  db.prepare(`INSERT INTO llm_profiles(id,name,provider,protocol,base_url,api_key,model,proxy_url,is_default,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name,provider=excluded.provider,protocol=excluded.protocol,
    base_url=excluded.base_url,api_key=excluded.api_key,model=excluded.model,proxy_url=excluded.proxy_url,
    is_default=excluded.is_default,updated_at=excluded.updated_at`)
    .run(id, input.name, "custom", protocol, input.base_url || "", input.api_key || "", input.model || "", input.proxy_url || "", input.is_default ? 1 : 0, input.created_at || now, now);
  const saved = db.prepare("SELECT * FROM llm_profiles WHERE id=?").get(id);
  if (saved.is_default) applyProfile(saved);
  return saved;
});
ipcMain.handle("profiles:activate", (_event, id) => {
  const profile = db.prepare("SELECT * FROM llm_profiles WHERE id=?").get(id);
  if (!profile) throw new Error("配置不存在");
  const tx = db.transaction(() => {
    db.prepare("UPDATE llm_profiles SET is_default=0").run();
    db.prepare("UPDATE llm_profiles SET is_default=1,updated_at=? WHERE id=?").run(new Date().toISOString(), id);
  });
  tx();
  const active = db.prepare("SELECT * FROM llm_profiles WHERE id=?").get(id);
  applyProfile(active);
  return active;
});
ipcMain.handle("profiles:delete", (_event, id) => {
  const current = db.prepare("SELECT * FROM llm_profiles WHERE id=?").get(id);
  if (!current) return null;
  db.prepare("DELETE FROM llm_profiles WHERE id=?").run(id);
  let next = db.prepare("SELECT * FROM llm_profiles ORDER BY updated_at DESC LIMIT 1").get();
  if (current.is_default && next) {
    db.prepare("UPDATE llm_profiles SET is_default=1 WHERE id=?").run(next.id);
    next = db.prepare("SELECT * FROM llm_profiles WHERE id=?").get(next.id);
    applyProfile(next);
  }
  return next || null;
});
ipcMain.handle("voices:system-list", async () => listSystemVoices(app));
ipcMain.handle("voices:list", () => db.prepare("SELECT * FROM voice_presets ORDER BY last_used_at DESC,created_at DESC").all());
ipcMain.handle("voices:save", (_event, input) => {
  const id = input.id || crypto.randomUUID();
  db.prepare(`INSERT INTO voice_presets(id,name,provider,voice_id,source_audio_path,created_at,last_used_at)
    VALUES(?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name,provider=excluded.provider,voice_id=excluded.voice_id,
    source_audio_path=excluded.source_audio_path,last_used_at=excluded.last_used_at`)
    .run(id, input.name, input.provider, input.voice_id, input.source_audio_path || "", input.created_at || new Date().toISOString(), new Date().toISOString());
  return db.prepare("SELECT * FROM voice_presets WHERE id=?").get(id);
});
ipcMain.handle("config:get", () => readConfig());
ipcMain.handle("config:save", (_event, config) => {
  const normalized = {
    ...defaultConfig,
    ...config,
    config_version: 6,
    llm: { ...defaultConfig.llm, ...config?.llm },
    gpt_image: { ...defaultConfig.gpt_image, ...config?.gpt_image },
    modelscope: { ...defaultConfig.modelscope, ...config?.modelscope },
    custom_image: { ...defaultConfig.custom_image, ...config?.custom_image, display_name: "foxcode" },
    apimart: {
      ...defaultConfig.apimart,
      ...config?.apimart,
      display_name: "Apimart",
      model: "gpt-image-2"
    },
    runninghub: { ...defaultConfig.runninghub, ...config?.runninghub },
    tts: {
      provider: ["system", "volcengine"].includes(config?.tts?.provider) ? config.tts.provider : "system",
      system: { ...defaultConfig.tts.system, ...config?.tts?.system },
      volcengine: { ...defaultConfig.tts.volcengine, ...config?.tts?.volcengine }
    }
  };
  fs.writeFileSync(configPath(), JSON.stringify(normalized, null, 2), "utf8");
  return normalized;
});
ipcMain.handle("config:test", async (_event, kind, candidate) => testConnection(candidate || readConfig(), kind, app));
ipcMain.handle("diagnostics:run", async () => {
  const config = readConfig();
  const imageSection = config[config.image_provider] || {};
  return {
    checks: [
      { name: `LLM 配置完整性 · ${config.llm?.protocol || "未配置"} · ${config.llm?.model || "未填写模型"}`, ok: Boolean(config.llm?.api_key && config.llm?.model && config.llm?.base_url) },
      { name: `AI 绘图 · ${config.image_provider}`, ok: config.image_provider === "runninghub" ? Boolean(config.runninghub?.api_key) : Boolean(imageSection.api_key && imageSection.base_url && imageSection.model) },
      { name: config.tts?.provider === "system" ? `TTS · 本机系统语音 · ${config.tts?.system?.voice || "系统默认"}` : `TTS · 火山引擎 · ${config.tts?.volcengine?.speaker || "未选择音色"}`, ok: config.tts?.provider === "system" ? process.platform === "win32" : Boolean(config.tts?.volcengine?.app_id && config.tts?.volcengine?.access_key) },
      { name: `剪映草稿目录 · ${config.jianying?.draft_path || "未配置"}`, ok: Boolean(config.jianying?.draft_path && fs.existsSync(config.jianying.draft_path)) },
      { name: "BGM 配置", ok: fs.existsSync(app.isPackaged ? path.join(process.resourcesPath, "default-bgm.mp3") : path.join(__dirname, "..", "resources", "default-bgm.mp3")) },
      { name: `数据目录可写 · ${app.getPath("userData")}`, ok: fs.existsSync(app.getPath("userData")) },
      { name: "FFmpeg 可用", ok: !app.isPackaged || fs.existsSync(path.join(process.resourcesPath, "bin", "ffmpeg.exe")) },
      { name: "剪映草稿生成器可用", ok: fs.existsSync(app.isPackaged ? path.join(process.resourcesPath, "draft-generator.exe") : path.join(__dirname, "..", "resources", "draft-generator.exe")) },
      { name: `任务目录 · ${config.task_storage_path || "使用默认目录"}`, ok: !config.task_storage_path || fs.existsSync(config.task_storage_path) }
    ],
    logPath: path.join(app.getPath("userData"), "renderer.log"),
    dataPath: app.getPath("userData")
  };
});
ipcMain.handle("tests:runNonImage", async (_event, target = "all") => {
  const config = readConfig();
  const targets = target === "all" ? ["storage", "subtitle", "llm", "tts", "ffmpeg"] : [target];
  const results = [];
  const run = async (id, label, action) => {
    if (!targets.includes(id)) return;
    const started = Date.now();
    try {
      const detail = await action();
      results.push({ id, label, ok: true, detail: String(detail || "通过"), elapsed_ms: Date.now() - started });
    } catch (error) {
      results.push({ id, label, ok: false, detail: String(error?.message || error), elapsed_ms: Date.now() - started });
    }
  };
  await run("storage", "数据库与目录", async () => {
    db.prepare("SELECT 1 AS ok").get();
    const testDir = path.join(app.getPath("userData"), "non-image-tests");
    fs.mkdirSync(testDir, { recursive: true });
    const probe = path.join(testDir, "write-probe.txt");
    fs.writeFileSync(probe, "ok", "utf8");
    fs.rmSync(probe, { force: true });
    return "数据库可读，应用数据目录可写";
  });
  await run("subtitle", "语义字幕", async () => {
    const schedule = _captionTest.sceneCaptionSchedule({
      duration: 3,
      caption_segments: ["让所有人都不理解的决定", "带着一支医疗队"],
      caption_timings: [
        { text: "让所有人都不理解的决定", start: 0, end: 1.8 },
        { text: "带着一支医疗队", start: 1.8, end: 3 }
      ]
    }, 12);
    if (schedule.length !== 2 || schedule[1].start !== 1.8) throw new Error("字幕分段或真实时间轴未生效");
    return "语义分段、去标点和真实时间轴正常";
  });
  await run("llm", "语言模型", async () => {
    const result = await testConnection(config, "llm", app);
    if (!result?.ok) throw new Error(result?.message || "LLM 测试失败");
    return result.message;
  });
  await run("tts", "配音服务", async () => {
    const testDir = path.join(app.getPath("userData"), "non-image-tests");
    fs.mkdirSync(testDir, { recursive: true });
    const extension = config.tts?.provider === "system" ? "wav" : "mp3";
    const destination = path.join(testDir, `tts-test.${extension}`);
    await synthesizeSpeech({ app, config, text: "这是一段非图片功能测试语音", speed: 1, destination });
    const duration = await mediaDuration(app, config, destination);
    if (!(duration > 0)) throw new Error("生成的测试音频无有效时长");
    return `配音生成成功，时长 ${duration.toFixed(2)} 秒`;
  });
  await run("ffmpeg", "FFmpeg 与媒体处理", async () => {
    const result = await spawnAsync(ffmpegPath(app, config), ["-version"]);
    const firstLine = String(result.stdout || result.stderr || "").split(/\r?\n/)[0];
    return firstLine || "FFmpeg 可用";
  });
  return { results, skipped: ["图片生成", "参考图编辑", "动态图片/视频接口"], finished_at: Date.now() };
});
ipcMain.handle("path:open", async (_event, target) => {
  if (!target || !fs.existsSync(target)) throw new Error("文件或目录不存在");
  const error = await shell.openPath(target);
  if (error) throw new Error(error);
});
ipcMain.handle("path:show", (_event, target) => {
  if (!target || !fs.existsSync(target)) throw new Error("文件不存在");
  shell.showItemInFolder(target);
});
ipcMain.handle("path:dataUrl", (_event, target) => {
  if (!target || !fs.existsSync(target)) return "";
  const ext = path.extname(target).slice(1).toLowerCase();
  const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "webp" ? "image/webp" : "image/png";
  return `data:${mime};base64,${fs.readFileSync(target).toString("base64")}`;
});
ipcMain.handle("clipboard:write", (_event, text) => {
  clipboard.writeText(String(text || ""));
  return true;
});
ipcMain.handle("image:generate", async (_event, input) => {
  const outputDir = path.join(app.getPath("userData"), "playground");
  fs.mkdirSync(outputDir, { recursive: true });
  const destination = path.join(outputDir, `${Date.now()}-${crypto.randomUUID().slice(0, 8)}.png`);
  const id = crypto.randomUUID();
  const config = readConfig();
  const providerKey = config.image_provider;
  if (config[providerKey]) config[providerKey] = { ...config[providerKey], ratio: input.ratio || "9:16", resolution: input.resolution || "1k" };
  const styleToken = String(input.styleId || input.style || "").trim();
  db.prepare("INSERT INTO playground_jobs(id,prompt,style_id,provider,ratio,resolution,reference_image_path,status,created_at) VALUES(?,?,?,?,?,?,?,?,?)")
    .run(id, input.prompt, styleToken ? canonicalStyleId(styleToken) : "", config.image_provider, input.ratio || "9:16", input.resolution || "1k", input.referenceImagePath || "", "running", Date.now());
  try {
    const customStyle = styleToken ? db.prepare("SELECT * FROM custom_styles WHERE id=?").get(canonicalStyleId(styleToken)) : null;
    const primaryStyle = styleToken ? resolveVisualStyle(styleToken, customStyle) : null;
    const result = await generateSceneImage({
      app, config, prompt: String(input.prompt || ""),
      styleConfig: primaryStyle,
      destination, ratio: input.ratio || "9:16", index: 1,
      referenceImagePath: input.referenceImagePath || ""
    });
    db.prepare("UPDATE playground_jobs SET image_path=?,status='completed',finished_at=? WHERE id=?").run(destination, Date.now(), id);
    return { ...result, dataUrl: `data:image/png;base64,${fs.readFileSync(destination).toString("base64")}` };
  } catch (error) {
    db.prepare("UPDATE playground_jobs SET status='failed',error_msg=?,finished_at=? WHERE id=?").run(error?.message || String(error), Date.now(), id);
    throw error;
  }
});
ipcMain.handle("playground:list", () => db.prepare("SELECT * FROM playground_jobs ORDER BY created_at DESC LIMIT 100").all());
ipcMain.handle("styles:list", () =>
  db.prepare("SELECT * FROM custom_styles ORDER BY datetime(updated_at) DESC").all()
);
ipcMain.handle("styles:save", (_event, input) => {
  const id = input.id || crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO custom_styles(id,name,tag,prefix,suffix,negative_prompt,description,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name,tag=excluded.tag,prefix=excluded.prefix,
    suffix=excluded.suffix,negative_prompt=excluded.negative_prompt,description=excluded.description,
    updated_at=excluded.updated_at`).run(
      id, input.name, input.tag || "", input.prefix || "", input.suffix || "",
      input.negative_prompt || "", input.description || "", input.created_at || now, now
    );
  return db.prepare("SELECT * FROM custom_styles WHERE id=?").get(id);
});
ipcMain.handle("styles:delete", (_event, id) => db.prepare("DELETE FROM custom_styles WHERE id=?").run(id));
ipcMain.handle("prompts:list", () =>
  db.prepare("SELECT * FROM user_prompt_templates ORDER BY updated_at DESC").all()
);
ipcMain.handle("prompts:save", (_event, input) => {
  const id = input.id || crypto.randomUUID();
  const now = Date.now();
  db.prepare(`INSERT INTO user_prompt_templates(id,name,description,base_track,step1_rewrite_system_prompt,step1_metadata_system_prompt,step3_system_prompt,style_id,image_seed_pools_json,needs_character_card,character_card_mode,step3_skeleton_modules_json,reference_kind,reference_decision_prompt,image_prompt_template,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description,
    base_track=excluded.base_track,step1_rewrite_system_prompt=excluded.step1_rewrite_system_prompt,
    step1_metadata_system_prompt=excluded.step1_metadata_system_prompt,step3_system_prompt=excluded.step3_system_prompt,
    style_id=excluded.style_id,image_seed_pools_json=excluded.image_seed_pools_json,
    needs_character_card=excluded.needs_character_card,character_card_mode=excluded.character_card_mode,
    step3_skeleton_modules_json=excluded.step3_skeleton_modules_json,reference_kind=excluded.reference_kind,
    reference_decision_prompt=excluded.reference_decision_prompt,image_prompt_template=excluded.image_prompt_template,updated_at=excluded.updated_at`).run(
      id, input.name, input.description || "", input.base_track || "character-story",
      input.step1_rewrite_system_prompt || "", input.step1_metadata_system_prompt || "", input.step3_system_prompt || "",
      input.style_id || "cinematic", input.image_seed_pools_json || "[]",
      input.needs_character_card == null ? null : Number(Boolean(input.needs_character_card)),
      input.character_card_mode || "follow", input.step3_skeleton_modules_json || "[]", input.reference_kind || "",
      input.reference_decision_prompt || "", input.image_prompt_template || "", input.created_at || now, now
    );
  return db.prepare("SELECT * FROM user_prompt_templates WHERE id=?").get(id);
});
ipcMain.handle("prompts:delete", (_event, id) =>
  db.prepare("DELETE FROM user_prompt_templates WHERE id=?").run(id)
);
ipcMain.handle("prompts:importJson", async () => {
  const selected = await dialog.showOpenDialog(mainWindow, {
    title: "导入提示词模板 JSON",
    properties: ["openFile"],
    filters: [{ name: "JSON", extensions: ["json"] }]
  });
  if (selected.canceled || !selected.filePaths[0]) return [];
  const raw = JSON.parse(fs.readFileSync(selected.filePaths[0], "utf8"));
  const items = Array.isArray(raw) ? raw : Array.isArray(raw.templates) ? raw.templates : [raw];
  const saved = [];
  for (const item of items) {
    if (!item.name) continue;
    const id = crypto.randomUUID();
    const now = Date.now();
    db.prepare(`INSERT INTO user_prompt_templates(id,name,description,base_track,step1_rewrite_system_prompt,step1_metadata_system_prompt,step3_system_prompt,style_id,image_seed_pools_json,needs_character_card,character_card_mode,step3_skeleton_modules_json,reference_kind,reference_decision_prompt,image_prompt_template,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        id, item.name, item.description || "", item.base_track || "character-story",
        item.step1_rewrite_system_prompt || item.rewrite_prompt || "",
        item.step1_metadata_system_prompt || "",
        item.step3_system_prompt || item.scene_prompt || "",
        item.style_id || "cinematic", item.image_seed_pools_json || "[]",
        item.needs_character_card == null ? null : Number(Boolean(item.needs_character_card)),
        item.character_card_mode || "follow", item.step3_skeleton_modules_json || "[]", item.reference_kind || "",
        item.reference_decision_prompt || "", item.image_prompt_template || "", now, now
      );
    saved.push(db.prepare("SELECT * FROM user_prompt_templates WHERE id=?").get(id));
  }
  return saved;
});
ipcMain.handle("files:selectAudio", async () => {
  const selected = await dialog.showOpenDialog(mainWindow, {
    title: "选择音频",
    properties: ["openFile"],
    filters: [{ name: "音频", extensions: ["mp3", "wav", "m4a", "aac", "flac"] }]
  });
  return selected.canceled ? "" : selected.filePaths[0] || "";
});
ipcMain.handle("files:selectImages", async () => {
  const selected = await dialog.showOpenDialog(mainWindow, {
    title: "选择图片",
    properties: ["openFile", "multiSelections"],
    filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "webp", "bmp"] }]
  });
  return selected.canceled ? [] : selected.filePaths;
});
ipcMain.handle("files:selectImage", async () => {
  const selected = await dialog.showOpenDialog(mainWindow, {
    title: "选择图片", properties: ["openFile"],
    filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "webp", "bmp"] }]
  });
  return selected.canceled ? "" : selected.filePaths[0] || "";
});
ipcMain.handle("files:selectDirectory", async (_event, title = "选择目录") => {
  const selected = await dialog.showOpenDialog(mainWindow, { title, properties: ["openDirectory", "createDirectory"] });
  return selected.canceled ? "" : selected.filePaths[0] || "";
});
ipcMain.handle("history:clear", () => {
  const latest = db.prepare("SELECT id FROM tasks WHERE status='completed' ORDER BY completed_at DESC,created_at DESC LIMIT 1").get();
  const result = latest
    ? db.prepare("DELETE FROM tasks WHERE status='completed' AND id<>?").run(latest.id)
    : db.prepare("DELETE FROM tasks WHERE status='completed'").run();
  return result.changes;
});
ipcMain.handle("source:research", async (_event, query, requirements = "", options = {}) => {
  if (!String(query || "").trim()) throw new Error("请输入关键词");
  const endpoint = new URL("https://zh.wikipedia.org/w/api.php");
  endpoint.searchParams.set("action", "query");
  endpoint.searchParams.set("generator", "search");
  endpoint.searchParams.set("gsrsearch", query);
  endpoint.searchParams.set("gsrlimit", "5");
  endpoint.searchParams.set("prop", "extracts");
  endpoint.searchParams.set("exintro", "1");
  endpoint.searchParams.set("explaintext", "1");
  endpoint.searchParams.set("format", "json");
  endpoint.searchParams.set("origin", "*");
  let articles = [];
  if (options.web !== false) try {
    const response = await fetch(endpoint, { headers: { "user-agent": "Storybound-Rebuild/0.5" } });
    if (response.ok) {
      const payload = await response.json();
      articles = Object.values(payload.query?.pages || {}).map(page => `${page.title}\n${page.extract || ""}`).filter(Boolean);
    }
  } catch {}
  if (options.web !== false && !articles.length) {
    try {
      const { stdout } = await spawnAsync("curl.exe", ["-L", "--max-time", "35", "-A", "Storybound-Rebuild/0.4", endpoint.toString()]);
      const payload = JSON.parse(stdout);
      articles = Object.values(payload.query?.pages || {}).map(page => `${page.title}\n${page.extract || ""}`).filter(Boolean);
    } catch {}
  }
  if (options.web !== false && !articles.length) {
    const searchUrl = `https://www.bing.com/search?q=${encodeURIComponent(`${query} 中文 百科`)}&setlang=zh-hans`;
    const { stdout } = await spawnAsync("curl.exe", ["-L", "--max-time", "30", "-A", "Mozilla/5.0", searchUrl]);
    const decode = value => value
      .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&quot;/g, "\"")
      .replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
    articles = [...stdout.matchAll(/<li class="b_algo"[^>]*>[\s\S]*?<h2[^>]*>([\s\S]*?)<\/h2>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/g)]
      .slice(0, 6).map(match => `${decode(match[1])}\n${decode(match[2])}`).filter(item => item.length > 20);
  }
  if (options.ai) {
    const llm = readConfig().llm || {};
    if (llm.provider === "local" || llm.protocol === "local") {
      articles.push(`AI 内置知识补充\n围绕“${query}”整理时间、人物、背景、转折和影响。${requirements || ""}`);
    } else if (llm.api_key && llm.base_url && llm.model) {
      const prompt = `请围绕“${query}”整理一份中文视频创作资料，包含事实背景、关键时间线、人物或概念、争议边界和可讲述细节。额外要求：${requirements || "无"}。只输出资料正文。`;
      try {
        const anthropic = llm.protocol === "anthropic";
        const response = await fetch(`${llm.base_url.replace(/\/$/, "")}${anthropic ? "/v1/messages" : "/chat/completions"}`, {
          method: "POST",
          headers: anthropic
            ? { "content-type": "application/json", "x-api-key": llm.api_key, "anthropic-version": "2023-06-01" }
            : { "content-type": "application/json", authorization: `Bearer ${llm.api_key}` },
          body: JSON.stringify(anthropic
            ? { model: llm.model, max_tokens: 3000, messages: [{ role: "user", content: prompt }] }
            : { model: llm.model, messages: [{ role: "user", content: prompt }] })
        });
        const payload = await response.json();
        if (response.ok) {
          const text = anthropic
            ? payload.content?.filter(item => item.type === "text").map(item => item.text).join("\n")
            : payload.choices?.[0]?.message?.content;
          if (text) articles.push(`AI 内置知识补充\n${text}`);
        }
      } catch {}
    }
  }
  if (!articles.length) throw new Error("未找到可用资料");
  return { title: query, text: `${query}\n${requirements}\n\n${articles.join("\n\n")}`, sources: articles.map(item => item.split("\n")[0]) };
});
ipcMain.handle("voice:preview", async (_event, input = {}) => {
  const config = readConfig();
  const speaker = String(input.speaker || "").trim();
  if (!speaker) throw new Error("请选择要试听的火山音色");
  const text = String(input.text || "他来到江南一个小村庄").trim().slice(0, 80) || "他来到江南一个小村庄";
  const speed = Math.max(0.5, Math.min(2, Number(input.speed || 1)));
  const cacheDir = path.join(app.getPath("userData"), "voice-preview-cache", "v2");
  fs.mkdirSync(cacheDir, { recursive: true });
  const cacheKey = crypto.createHash("sha256").update(`${speaker}|${speed}|${text}`).digest("hex");
  const destination = path.join(cacheDir, `${cacheKey}.mp3`);
  let cached = fs.existsSync(destination) && fs.statSync(destination).size > 256;
  if (!cached) {
    const audio = await requestVolcengineSpeech(config, text, speed, speaker);
    if (!audio.length) throw new Error("试听音频生成失败");
    fs.writeFileSync(destination, audio);
    cached = false;
  }
  const audio = fs.readFileSync(destination);
  return {
    path: destination,
    cached,
    speaker,
    dataUrl: `data:audio/mpeg;base64,${audio.toString("base64")}`
  };
});

ipcMain.handle("voice:synthesize", async (_event, input) => {
  const config = readConfig();
  const outputDir = path.join(app.getPath("userData"), "voice-lab");
  fs.mkdirSync(outputDir, { recursive: true });
  const extension = config.tts.provider === "system" ? "wav" : "mp3";
  const destination = path.join(outputDir, `${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${extension}`);
  await synthesizeSpeech({ app, config, text: input.text, speed: input.speed || 1, destination });
  return {
    path: destination,
    provider: config.tts.provider,
    dataUrl: `data:audio/${extension === "wav" ? "wav" : "mpeg"};base64,${fs.readFileSync(destination).toString("base64")}`
  };
});
ipcMain.handle("music:generate", async (_event, input) => {
  const config = readConfig();
  if (!input.audioPath || !fs.existsSync(input.audioPath)) throw new Error("请选择有效音频");
  if (!Array.isArray(input.images) || !input.images.length) throw new Error("请选择至少一张图片");
  const outputBase = config.task_storage_path || path.join(app.getPath("documents"), "Storybound");
  const outputDir = path.join(outputBase, `${String(input.title || "音乐MV").replace(/[<>:"/\\|?*]/g, "_")}_${Date.now()}`);
  fs.mkdirSync(outputDir, { recursive: true });
  const video = await renderMusicVideo({
    app, config, audioPath: input.audioPath, images: input.images,
    lyrics: input.lyrics || "", outputDir, ratio: input.ratio || "9:16"
  });
  let draftDir = "";
  try {
    const draft = await generateMusicDraft({
      app, config, title: input.title || "音乐MV", outputDir,
      audioPath: input.audioPath, audioDuration: video.totalDuration,
      images: input.images, lyrics: input.lyrics || "", ratio: input.ratio || "9:16"
    });
    draftDir = draft.draft_dir || "";
  } catch (error) {
    fs.writeFileSync(path.join(outputDir, "draft-error.txt"), String(error?.stack || error), "utf8");
  }
  return { outputDir, videoPath: video.finalVideo, draftDir };
});

function restoreStoredTaskPromptLayers(task) {
  if (!task?.pipeline_data) return task;
  let script;
  try { script = JSON.parse(task.pipeline_data); } catch { return task; }
  if (!Array.isArray(script?.scenes)) return task;
  let changed = false;
  for (const scene of script.scenes) {
    // Older builds permanently replaced the base prompt with a temporary policy fallback.
    // Restore both original prompt layers before clearing the legacy flag. Safety is now
    // applied only at request time and must never overwrite persisted scene content.
    const wasSafetyAdjusted = Boolean(scene.image_prompt_safety_adjusted);
    if (!wasSafetyAdjusted) continue;
    if (scene.image_prompt_original) {
      scene.image_prompt = String(scene.image_prompt_original);
      scene.image_prompt_original = "";
      changed = true;
    }
    if (scene.desc_prompt_original) {
      scene.desc_prompt = String(scene.desc_prompt_original);
      scene.desc_prompt_original = "";
      changed = true;
    }
    scene.image_prompt_safety_adjusted = false;
    changed = true;
  }
  if (!changed) return task;
  const pipelineData = JSON.stringify(script);
  task.pipeline_data = pipelineData;
  try {
    db.prepare("UPDATE tasks SET pipeline_data=?,last_checkpoint_at=? WHERE id=?").run(pipelineData, Date.now(), task.id);
    if (task.output_dir) {
      atomicWriteJson(path.join(task.output_dir, "script.json"), script);
      atomicWriteJson(path.join(task.output_dir, "pipeline.json"), script);
    }
  } catch {}
  return task;
}

function resolveTaskVisualStyle(task) {
  const rawStyle = String(task.style || "").trim();
  if (!rawStyle) {
    throw new Error("任务没有保存画面风格。为避免错误回退成黑白摄影，请在任务中重新选择画面风格后再运行。");
  }
  const requested = canonicalStyleId(rawStyle);
  const customStyle = db.prepare("SELECT * FROM custom_styles WHERE id=?").get(requested);
  let snapshot = null;
  try { snapshot = task.style_snapshot_json ? JSON.parse(task.style_snapshot_json) : null; } catch {}

  let resolved;
  const snapshotMatches = snapshot && canonicalStyleId(snapshot.id) === requested;
  const snapshotIsCustom = snapshotMatches && snapshot.origin === "custom";
  const snapshotIsVerifiedBuiltin = snapshotMatches
    && snapshot.origin !== "custom"
    && snapshot.registry_version === STYLE_REGISTRY_VERSION
    && snapshot.registry_source_sha256 === STYLE_REGISTRY_SOURCE_SHA256;
  if (snapshotIsCustom || snapshotIsVerifiedBuiltin) {
    resolved = normalizeVisualStyle(snapshot, snapshot.origin || "snapshot");
  } else {
    // Discard snapshots created by earlier unverified rebuilds. A stale/fake
    // snapshot must never override the registry extracted from the original EXE.
    resolved = resolveVisualStyle(requested, customStyle);
  }

  const snapshotJson = JSON.stringify(styleSnapshot(resolved));
  if (task.style !== resolved.id || task.style_snapshot_json !== snapshotJson || task.style_registry_version !== resolved.registry_version) {
    db.prepare("UPDATE tasks SET style=?,style_snapshot_json=?,style_registry_version=? WHERE id=?")
      .run(resolved.id, snapshotJson, resolved.registry_version || "", task.id);
    task.style = resolved.id;
    task.style_snapshot_json = snapshotJson;
    task.style_registry_version = resolved.registry_version || "";
  }
  return resolved;
}

function loadTask(id) {
  const task = restoreStoredTaskPromptLayers(db.prepare("SELECT * FROM tasks WHERE id=?").get(id));
  if (!task) throw new Error("任务不存在");
  if (task.prompt_template_id) {
    task.prompt_template = db.prepare("SELECT * FROM user_prompt_templates WHERE id=?").get(task.prompt_template_id);
  }
  task.style_config = resolveTaskVisualStyle(task);
  const draft = db.prepare("SELECT config FROM draft_templates WHERE id=?").get(task.template_id);
  task.draft_template = draft ? JSON.parse(draft.config) : null;
  task.cover_template = db.prepare("SELECT * FROM cover_templates WHERE id=?").get(task.cover_template_id);
  if (task.bgm_id === "builtin") task.bgm_path = app.isPackaged ? path.join(process.resourcesPath, "default-bgm.mp3") : path.join(__dirname, "..", "resources", "default-bgm.mp3");
  else if (task.bgm_id && task.bgm_id !== "none") task.bgm_path = db.prepare("SELECT path FROM bgm_library WHERE id=?").get(task.bgm_id)?.path || "";
  task.shouldCancel = () => Boolean(activeTaskRuns.get(id)?.signal.aborted || db.prepare("SELECT cancel_requested FROM tasks WHERE id=?").get(id)?.cancel_requested);
  return task;
}

ipcMain.handle("tasks:replaceSceneImage", async (_event, id, sceneIndex) => {
  const selected = await dialog.showOpenDialog(mainWindow, {
    title: "替换分镜图片", properties: ["openFile"],
    filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "webp", "bmp"] }]
  });
  const task = loadTask(id);
  if (selected.canceled) return task;
  const script = JSON.parse(task.pipeline_data || "{}");
  const scene = script.scenes?.find(item => Number(item.index) === Number(sceneIndex));
  if (!scene) throw new Error("分镜不存在");
  const imagesDir = path.join(task.output_dir, "images");
  fs.mkdirSync(imagesDir, { recursive: true });
  const destination = path.join(imagesDir, `${scene.index}-custom${path.extname(selected.filePaths[0]) || ".png"}`);
  fs.copyFileSync(selected.filePaths[0], destination);
  scene.image_path = destination;
  scene.image_provider = "custom-local";
  scene.image_status = "completed";
  scene.image_error = "";
  scene.image_remote_task_id = "";
  scene.image_remote_provider = "";
  scene.video_path = "";
  scene.video_provider = "";
  scene.video_source_url = "";
  scene.video_remote_task_id = "";
  scene.video_remote_model = "";
  scene.video_status = "pending";
  scene.video_error = "图片已替换，动态画面将在继续任务时重新生成";
  script.runtime = {
    ...(script.runtime || {}),
    current_stage: "review",
    current_step: 4,
    render_status: "pending",
    cover_status: "pending",
    draft_status: "pending",
    final_video: "",
    subtitle_path: "",
    draft_dir: "",
    cover_path: ""
  };
  atomicWriteJson(path.join(task.output_dir, "pipeline.json"), script);
  db.prepare("UPDATE tasks SET pipeline_data=?,status='review',current_stage='review',current_step=4,last_checkpoint_at=? WHERE id=?")
    .run(JSON.stringify(script), Date.now(), id);
  return db.prepare("SELECT * FROM tasks WHERE id=?").get(id);
});

function taskCheckpoint(id) {
  return ({ outputDir = "", pipeline = null, currentStage = "", currentStep = 0, detail = "" } = {}) => {
    const now = Date.now();
    const task = db.prepare("SELECT output_dir,pipeline_data,current_step,current_stage,cancel_requested,status FROM tasks WHERE id=?").get(id);
    if (!task || task.status === "cancelled") return;
    const nextOutputDir = outputDir || task.output_dir || "";
    const nextPipeline = pipeline ? JSON.stringify(pipeline) : task.pipeline_data;
    const nextStep = Number(currentStep || task.current_step || 0);
    const nextStage = currentStage || task.current_stage || "running";
    db.prepare(`UPDATE tasks SET output_dir=?,pipeline_data=?,current_step=?,current_stage=?,last_checkpoint_at=?,last_heartbeat_at=? WHERE id=?`)
      .run(nextOutputDir, nextPipeline, nextStep, nextStage, now, now, id);
    if (detail) {
      db.prepare("INSERT INTO task_events(task_id,type,step,detail,data_json,ts) VALUES(?,?,?,?,?,?)")
        .run(id, "checkpoint", nextStep, detail, JSON.stringify({ stage: nextStage }), now);
    }
  };
}

function taskEmitter(id) {
  return (step, message) => {
    const state = db.prepare("SELECT cancel_requested,status FROM tasks WHERE id=?").get(id);
    if (!state || state.status === "cancelled" || activeTaskRuns.get(id)?.signal.aborted) return;
    const now = Date.now();
    db.prepare("UPDATE tasks SET current_step=?,last_heartbeat_at=? WHERE id=?").run(step, now, id);
    db.prepare("INSERT INTO task_events(task_id,type,step,detail,data_json,ts) VALUES(?,?,?,?,?,?)")
      .run(id, "progress", step, message, "{}", now);
    const eventStatus = state.status === "cancelling" ? "cancelling" : "running";
    mainWindow?.webContents.send("task:event", { taskId: id, status: eventStatus, step, message });
  };
}

function beginTaskRun(id, { keepStep = false } = {}) {
  const before = db.prepare("SELECT status,current_step FROM tasks WHERE id=?").get(id);
  const previous = activeTaskRuns.get(id);
  if (previous && !previous.signal.aborted) throw new Error("任务正在运行，请勿重复启动");
  const controller = new AbortController();
  activeTaskRuns.set(id, controller);
  const task = loadTask(id);
  const config = readConfig();
  const outputDir = taskOutputDir(task, config, path.join(app.getPath("documents"), "Storybound"));
  fs.mkdirSync(outputDir, { recursive: true });
  const resume = ["interrupted", "failed", "review"].includes(before?.status) || Boolean(task.pipeline_data) || fs.existsSync(path.join(outputDir, "pipeline.json"));
  db.prepare(`UPDATE tasks SET status='running',output_dir=?,current_stage=?,current_step=?,cancel_requested=0,error_message='',
    resume_count=resume_count+?,last_heartbeat_at=? WHERE id=?`)
    .run(outputDir, resume ? "resuming" : "planning", keepStep ? Number(before?.current_step || 0) : (resume ? Number(before?.current_step || 0) : 0), resume ? 1 : 0, Date.now(), id);
  task.output_dir = outputDir;
  task.status = "running";
  task.abortSignal = controller.signal;
  task.shouldCancel = () => Boolean(controller.signal.aborted || db.prepare("SELECT cancel_requested FROM tasks WHERE id=?").get(id)?.cancel_requested);
  return { task, config, outputDir, resume, controller };
}

function assertTaskRunActive(id, controller) {
  const row = db.prepare("SELECT cancel_requested,status FROM tasks WHERE id=?").get(id);
  if (controller?.signal.aborted || row?.cancel_requested || row?.status === "cancelled") throw new TaskCancelledError();
}

function finishTaskRun(id, controller) {
  if (activeTaskRuns.get(id) === controller) activeTaskRuns.delete(id);
}

function taskFailure(id, error) {
  const message = error instanceof Error ? error.message : String(error);
  const cancelRequested = Boolean(db.prepare("SELECT cancel_requested FROM tasks WHERE id=?").get(id)?.cancel_requested);
  if (cancelRequested || isCancellationError(error) || message.includes("取消")) {
    db.prepare("UPDATE tasks SET status='cancelled',current_stage='cancelled',error_message='任务已取消',queue_order=0,queue_batch_id='',last_heartbeat_at=? WHERE id=?").run(Date.now(), id);
    mainWindow?.webContents.send("task:event", { taskId: id, status: "cancelled", step: 0, message: "任务已取消" });
    return;
  }
  const task = db.prepare("SELECT output_dir FROM tasks WHERE id=?").get(id);
  const pipelinePath = task?.output_dir ? path.join(task.output_dir, "pipeline.json") : "";
  if (pipelinePath && fs.existsSync(pipelinePath)) {
    db.prepare("UPDATE tasks SET status='failed',current_stage='failed',error_message=?,pipeline_data=?,last_heartbeat_at=? WHERE id=?")
      .run(message, fs.readFileSync(pipelinePath, "utf8"), Date.now(), id);
  } else {
    db.prepare("UPDATE tasks SET status='failed',current_stage='failed',error_message=?,last_heartbeat_at=? WHERE id=?").run(message, Date.now(), id);
  }
  mainWindow?.webContents.send("task:event", { taskId: id, status: "failed", step: 0, message });
}

ipcMain.handle("tasks:prepare", async (_event, id) => {
  const { task, config, controller } = beginTaskRun(id);
  try {
    return await runWithCancellation(controller.signal, async () => {
      const result = await preparePipeline({
        task,
        config,
        baseOutputDir: path.join(app.getPath("documents"), "Storybound"),
        emit: taskEmitter(id),
        checkpoint: taskCheckpoint(id)
      });
      assertTaskRunActive(id, controller);
      db.prepare("UPDATE tasks SET status='review',current_stage='review_script',current_step=3,output_dir=?,pipeline_data=?,last_checkpoint_at=? WHERE id=?")
        .run(result.outputDir, JSON.stringify(result.script), Date.now(), id);
      mainWindow?.webContents.send("task:event", { taskId: id, status: "review", step: 3, message: "脚本和分镜已生成，请确认后继续" });
      return db.prepare("SELECT * FROM tasks WHERE id=?").get(id);
    });
  } catch (error) {
    taskFailure(id, error);
    throw error;
  } finally {
    finishTaskRun(id, controller);
  }
});

ipcMain.handle("tasks:continue", async (_event, id) => {
  const { task, config, outputDir, controller } = beginTaskRun(id, { keepStep: true });
  try {
    return await runWithCancellation(controller.signal, async () => {
      let script = null;
      try { script = task.pipeline_data ? JSON.parse(task.pipeline_data) : null; } catch {}
      if (!script?.scenes?.length && fs.existsSync(path.join(outputDir, "pipeline.json"))) {
        try { script = JSON.parse(fs.readFileSync(path.join(outputDir, "pipeline.json"), "utf8")); } catch {}
      }
      if (!Array.isArray(script?.scenes)) throw new Error("请先生成并确认脚本");
      const result = await completePipeline({
        app, task, config, outputDir, script,
        emit: taskEmitter(id), checkpoint: taskCheckpoint(id)
      });
      assertTaskRunActive(id, controller);
      if (result.paused) {
        const reviewStage = result.partialImages
          ? "review_images_partial"
          : (result.pauseStep === 5 ? "review_audio" : "review_images");
        db.prepare("UPDATE tasks SET status='review',current_stage=?,current_step=?,pipeline_data=?,last_checkpoint_at=? WHERE id=?")
          .run(reviewStage, result.pauseStep || 4, JSON.stringify(result.script), Date.now(), id);
        const message = result.partialImages
          ? `图片已完成 ${result.script.scenes.length - Number(result.missingImageCount || 0)}/${result.script.scenes.length}，仍有 ${Number(result.missingImageCount || 0)} 张需要补齐`
          : (result.pauseStep === 5 ? "配音已生成，请试听后继续" : "图片已生成，请检查画廊后继续");
        mainWindow?.webContents.send("task:event", { taskId: id, status: "review", step: result.pauseStep || 4, message });
        return db.prepare("SELECT * FROM tasks WHERE id=?").get(id);
      }
      db.prepare("UPDATE tasks SET status='completed',current_stage='completed',current_step=8,video_path=?,draft_dir=?,cover_path=?,pipeline_data=?,queue_order=0,queue_batch_id='',completed_at=datetime('now','localtime'),last_checkpoint_at=? WHERE id=?")
        .run(result.finalVideo, result.draftDir, result.coverPath || "", JSON.stringify(result.script), Date.now(), id);
      return db.prepare("SELECT * FROM tasks WHERE id=?").get(id);
    });
  } catch (error) {
    taskFailure(id, error);
    throw error;
  } finally {
    finishTaskRun(id, controller);
  }
});

ipcMain.handle("tasks:repairMissingImages", async (_event, id) => {
  const { task, config, outputDir, controller } = beginTaskRun(id, { keepStep: true });
  try {
    return await runWithCancellation(controller.signal, async () => {
      let script = null;
      try { script = task.pipeline_data ? JSON.parse(task.pipeline_data) : null; } catch {}
      if (!script?.scenes?.length && fs.existsSync(path.join(outputDir, "pipeline.json"))) {
        try { script = JSON.parse(fs.readFileSync(path.join(outputDir, "pipeline.json"), "utf8")); } catch {}
      }
      if (!Array.isArray(script?.scenes)) throw new Error("请先生成并确认脚本");

      // Force a pause immediately after the image stage. This action only fills
      // missing/failed images and never starts TTS or video rendering.
      const repairTask = {
        ...task,
        current_step: 3,
        pause_mode: "every",
        pause_points: JSON.stringify([4])
      };
      const result = await completePipeline({
        app, task: repairTask, config, outputDir, script,
        emit: taskEmitter(id), checkpoint: taskCheckpoint(id)
      });
      assertTaskRunActive(id, controller);
      const missingCount = Number(result.missingImageCount || 0);
      const reviewStage = result.partialImages ? "review_images_partial" : "review_images";
      db.prepare("UPDATE tasks SET status='review',current_stage=?,current_step=4,pipeline_data=?,error_message='',last_checkpoint_at=? WHERE id=?")
        .run(reviewStage, JSON.stringify(result.script), Date.now(), id);
      const total = result.script.scenes.length;
      const message = missingCount
        ? `已继续处理全部缺失画面，当前完成 ${total - missingCount}/${total}，仍有 ${missingCount} 张失败`
        : `缺失画面已全部补齐，共 ${total} 张`;
      mainWindow?.webContents.send("task:event", { taskId: id, status: "review", step: 4, message });
      return db.prepare("SELECT * FROM tasks WHERE id=?").get(id);
    });
  } catch (error) {
    taskFailure(id, error);
    throw error;
  } finally {
    finishTaskRun(id, controller);
  }
});

ipcMain.handle("tasks:regenerateScene", async (_event, id, sceneIndex, kind) => {
  const { task, config, outputDir, controller } = beginTaskRun(id, { keepStep: true });
  try {
    return await runWithCancellation(controller.signal, async () => {
      const script = JSON.parse(task.pipeline_data || "{}");
      const updated = await regenerateScene({
        app, task, config, outputDir,
        script, sceneIndex, kind, emit: taskEmitter(id)
      });
      assertTaskRunActive(id, controller);
      db.prepare("UPDATE tasks SET pipeline_data=?,status='review',current_stage='review',error_message='',last_checkpoint_at=? WHERE id=?")
        .run(JSON.stringify(updated), Date.now(), id);
      mainWindow?.webContents.send("task:event", {
        taskId: id,
        status: "review",
        step: kind === "image" ? 4 : 5,
        message: kind === "image" ? `第 ${sceneIndex} 镜画面重新生成完成` : `第 ${sceneIndex} 镜配音重新生成完成`
      });
      return db.prepare("SELECT * FROM tasks WHERE id=?").get(id);
    });
  } catch (error) {
    taskFailure(id, error);
    throw error;
  } finally {
    finishTaskRun(id, controller);
  }
});

ipcMain.handle("tasks:render", async (_event, id, options = {}) => {
  const { task, config, outputDir, controller } = beginTaskRun(id, { keepStep: true });
  try {
    return await runWithCancellation(controller.signal, async () => {
      const script = JSON.parse(task.pipeline_data || "{}");
      const result = await renderPrepared({ app, task, config, outputDir, script, emit: taskEmitter(id), options });
      assertTaskRunActive(id, controller);
      db.prepare("UPDATE tasks SET status='completed',current_stage='completed',current_step=8,video_path=?,draft_dir=?,cover_path=?,pipeline_data=?,completed_at=datetime('now','localtime'),last_checkpoint_at=? WHERE id=?")
        .run(result.finalVideo, result.draftDir, result.coverPath || "", JSON.stringify(result.script), Date.now(), id);
      return db.prepare("SELECT * FROM tasks WHERE id=?").get(id);
    });
  } catch (error) {
    taskFailure(id, error);
    throw error;
  } finally {
    finishTaskRun(id, controller);
  }
});

ipcMain.handle("tasks:run", async (_event, id) => {
  const { task, config, controller } = beginTaskRun(id);
  try {
    return await runWithCancellation(controller.signal, async () => {
      const result = await runPipeline({
        app,
        task,
        config,
        baseOutputDir: path.join(app.getPath("documents"), "Storybound"),
        emit: taskEmitter(id),
        checkpoint: taskCheckpoint(id)
      });
      assertTaskRunActive(id, controller);
      if (result.paused) {
        const reviewStage = result.partialImages
          ? "review_images_partial"
          : (result.pauseStep === 5 ? "review_audio" : "review_images");
        db.prepare("UPDATE tasks SET status='review',current_stage=?,current_step=?,output_dir=?,pipeline_data=?,last_checkpoint_at=? WHERE id=?")
          .run(reviewStage, result.pauseStep || 4, result.outputDir, JSON.stringify(result.script), Date.now(), id);
        const message = result.partialImages
          ? `图片已完成 ${result.script.scenes.length - Number(result.missingImageCount || 0)}/${result.script.scenes.length}，仍有 ${Number(result.missingImageCount || 0)} 张需要补齐`
          : (result.pauseStep === 5 ? "配音已生成，请试听后继续" : "图片已生成，请检查画廊后继续");
        mainWindow?.webContents.send("task:event", {
          taskId: id, status: "review", step: result.pauseStep || 4, message
        });
        return db.prepare("SELECT * FROM tasks WHERE id=?").get(id);
      }
      db.prepare(`UPDATE tasks SET status='completed',current_stage='completed',current_step=8,output_dir=?,video_path=?,draft_dir=?,cover_path=?,
        pipeline_data=?,queue_order=0,queue_batch_id='',completed_at=datetime('now','localtime'),last_checkpoint_at=? WHERE id=?`)
        .run(result.outputDir, result.finalVideo, result.draftDir, result.coverPath || "", JSON.stringify(result.script), Date.now(), id);
      mainWindow?.webContents.send("task:event", {
        taskId: id, status: "completed", step: 8, message: `视频已生成：${result.finalVideo}`
      });
      return db.prepare("SELECT * FROM tasks WHERE id=?").get(id);
    });
  } catch (error) {
    taskFailure(id, error);
    throw error;
  } finally {
    finishTaskRun(id, controller);
  }
});

async function runQueuedTask(id) {
  const { task, config, controller } = beginTaskRun(id);
  task.pause_mode = "none";
  try {
    await runWithCancellation(controller.signal, async () => {
      const result = await runPipeline({
        app,
        task,
        config,
        baseOutputDir: path.join(app.getPath("documents"), "Storybound"),
        emit: taskEmitter(id),
        checkpoint: taskCheckpoint(id)
      });
      assertTaskRunActive(id, controller);
      db.prepare(`UPDATE tasks SET status='completed',current_stage='completed',current_step=8,output_dir=?,video_path=?,draft_dir=?,cover_path=?,
        pipeline_data=?,queue_order=0,queue_batch_id='',completed_at=datetime('now','localtime'),last_checkpoint_at=? WHERE id=?`)
        .run(result.outputDir, result.finalVideo, result.draftDir, result.coverPath || "", JSON.stringify(result.script), Date.now(), id);
    });
  } catch (error) {
    taskFailure(id, error);
  } finally {
    finishTaskRun(id, controller);
  }
}

async function startPersistedQueue(ids) {
  if (queueRunning) return { running: true };
  let queueIds = Array.isArray(ids) ? ids.filter(Boolean) : [];
  if (!queueIds.length) {
    queueIds = db.prepare(`SELECT id FROM tasks WHERE queue_order>0 AND status NOT IN ('completed','cancelled') ORDER BY queue_order ASC`).all().map(row => row.id);
  }
  if (!queueIds.length) return { running: false, empty: true };
  const batchId = crypto.randomUUID();
  const setQueue = db.prepare("UPDATE tasks SET queue_order=?,queue_batch_id=? WHERE id=?");
  const transaction = db.transaction(items => items.forEach((id, index) => setQueue.run(index + 1, batchId, id)));
  transaction(queueIds);
  queueRunning = true;
  setImmediate(async () => {
    try {
      for (const id of queueIds) {
        const row = db.prepare("SELECT status,cancel_requested FROM tasks WHERE id=?").get(id);
        if (!row || row.status === "completed" || row.status === "cancelled" || row.cancel_requested) continue;
        await runQueuedTask(id);
      }
    } finally {
      queueRunning = false;
      mainWindow?.webContents.send("queue:event", { running: false });
    }
  });
  return { running: true, count: queueIds.length };
}

ipcMain.handle("queue:run", async (_event, ids) => startPersistedQueue(ids));
ipcMain.handle("queue:resume", async () => startPersistedQueue([]));
