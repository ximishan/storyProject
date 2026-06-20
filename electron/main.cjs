const { app, BrowserWindow, ipcMain, shell, dialog, clipboard } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { openDatabase, createTask } = require("./database.cjs");
const {
  runPipeline, preparePipeline, completePipeline, regenerateScene, renderPrepared
} = require("./pipeline.cjs");
const { generateSceneImage, synthesizeSpeech, testConnection, spawnAsync } = require("./services.cjs");
const { renderMusicVideo } = require("./media.cjs");
const { generateMusicDraft } = require("./draft.cjs");
const crypto = require("node:crypto");

let mainWindow;
let db;
let queueRunning = false;

const defaultConfig = {
  config_version: 2,
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
    proxy_url: "", custom_models: []
  },
  custom_image: {
    display_name: "", base_url: "", api_key: "", model: "gpt-image-1",
    async_mode: false, submit_path: "/images/generations", status_path: "",
    task_id_field: "task_id", status_field: "status", image_field: "data.0.url",
    success_values: "succeeded,completed,success", extra_body_json: "",
    ratio_mapping_json: "", ratio: "9:16", resolution: "1k", concurrency: 3, proxy_url: ""
  },
  runninghub: {
    api_key: "", base_url: "https://www.runninghub.cn", workflow_id: "",
    prompt_node_id: "", prompt_field_name: "text", node_info_json: "[]",
    ratio: "9:16", resolution: "1k", concurrency: 1, proxy_url: ""
  },
  tts: {
    provider: "volcengine",
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
      runninghub: { ...defaultConfig.runninghub, ...saved.runninghub },
      tts: {
        provider: "volcengine",
        volcengine: { ...defaultConfig.tts.volcengine, ...saved.tts?.volcengine }
      },
      jianying: { ...defaultConfig.jianying, ...saved.jianying },
      media: { ...defaultConfig.media, ...saved.media },
      ui: { ...defaultConfig.ui, ...saved.ui }
    };
    if (!saved.config_version || saved.config_version < 2) {
      if (!merged.llm.api_key && merged.llm.provider !== "local") {
        merged.llm.provider = "local";
        merged.llm.protocol = "local";
      }
      const imageSection = merged.image_provider === "modelscope"
        ? merged.modelscope : merged.image_provider === "custom_image"
          ? merged.custom_image : merged.gpt_image;
      if (merged.image_provider !== "placeholder" && !imageSection?.api_key) {
        merged.image_provider = "placeholder";
      }
      merged.tts.provider = "volcengine";
      merged.config_version = 2;
      fs.writeFileSync(configPath(), JSON.stringify(merged, null, 2), "utf8");
    }
    if (merged.image_provider === "gpt_image") {
      merged.custom_image = {
        ...merged.custom_image,
        base_url: merged.custom_image.base_url || merged.gpt_image.base_url,
        api_key: merged.custom_image.api_key || merged.gpt_image.api_key,
        model: merged.custom_image.model || merged.gpt_image.model
      };
      merged.image_provider = "custom_image";
    }
    if (!["custom_image", "modelscope", "runninghub", "placeholder"].includes(merged.image_provider)) {
      merged.image_provider = "custom_image";
    }
    merged.tts.provider = "volcengine";
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
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    log(`console level=${level} ${message} (${sourceId}:${line})`);
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
);
ipcMain.handle("tasks:create", (_event, input) => createTask(db, input));
ipcMain.handle("tasks:delete", (_event, id) => {
  db.prepare("DELETE FROM task_events WHERE task_id=?").run(id);
  db.prepare("DELETE FROM tasks WHERE id=?").run(id);
});
ipcMain.handle("tasks:cancel", (_event, id) => {
  db.prepare("UPDATE tasks SET cancel_requested=1,status=CASE WHEN status='pending' THEN 'cancelled' ELSE status END WHERE id=?").run(id);
  return db.prepare("SELECT * FROM tasks WHERE id=?").get(id);
});
ipcMain.handle("tasks:duplicate", (_event, id) => {
  const task = db.prepare("SELECT * FROM tasks WHERE id=?").get(id);
  if (!task) throw new Error("任务不存在");
  return createTask(db, {
    title: `${task.title} - 副本`, inputText: task.input_text, track: task.track, style: task.style,
    ratio: task.ratio, targetScenes: task.target_scenes, ttsSpeed: task.tts_speed,
    promptTemplateId: task.prompt_template_id, rewriteIntensity: task.rewrite_intensity,
    narrativePov: task.narrative_pov, keepPromotion: task.keep_promotion,
    materialSource: task.material_source, targetLength: task.target_length,
    templateId: task.template_id, referenceImagePath: task.reference_image_path,
    coverImageMode: task.cover_image_mode, coverTemplateId: task.cover_template_id, pauseMode: task.pause_mode, bgmId: task.bgm_id,
    speaker: task.speaker, taskType: task.task_type, scriptFormat: task.script_format,
    podcastImageMode: task.podcast_image_mode, podcastSpeakers: task.podcast_speakers,
    processingMode: task.processing_mode, pausePoints: JSON.parse(task.pause_points || "[]"),
    videoIntro: task.video_intro, videoIntroDuration: task.video_intro_duration,
    researchWeb: task.research_web, researchAi: task.research_ai, researchIma: task.research_ima
  });
});
ipcMain.handle("tasks:updatePipeline", (_event, id, pipeline) => {
  db.prepare("UPDATE tasks SET pipeline_data=? WHERE id=?").run(JSON.stringify(pipeline), id);
  const task = db.prepare("SELECT * FROM tasks WHERE id=?").get(id);
  if (task.output_dir) {
    fs.writeFileSync(path.join(task.output_dir, "script.json"), JSON.stringify(pipeline, null, 2), "utf8");
    fs.writeFileSync(path.join(task.output_dir, "pipeline.json"), JSON.stringify(pipeline, null, 2), "utf8");
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
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2), "utf8");
  return config;
});
ipcMain.handle("config:test", async (_event, kind, candidate) => testConnection(candidate || readConfig(), kind));
ipcMain.handle("diagnostics:run", async () => {
  const config = readConfig();
  const imageSection = config[config.image_provider] || {};
  return {
    checks: [
      { name: `LLM 配置完整性 · ${config.llm?.protocol || "未配置"} · ${config.llm?.model || "未填写模型"}`, ok: Boolean(config.llm?.api_key && config.llm?.model && config.llm?.base_url) },
      { name: `AI 绘图 · ${config.image_provider}`, ok: config.image_provider === "runninghub" ? Boolean(config.runninghub?.api_key && config.runninghub?.workflow_id) : Boolean(imageSection.api_key && imageSection.base_url) },
      { name: `TTS · ${config.tts?.volcengine?.speaker || "未选择音色"}`, ok: Boolean(config.tts?.volcengine?.app_id && config.tts?.volcengine?.access_key) },
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
  db.prepare("INSERT INTO playground_jobs(id,prompt,style_id,provider,ratio,resolution,reference_image_path,status,created_at) VALUES(?,?,?,?,?,?,?,?,?)")
    .run(id, input.prompt, input.style || "", config.image_provider, input.ratio || "9:16", input.resolution || "1k", input.referenceImagePath || "", "running", Date.now());
  try {
    const result = await generateSceneImage({
      app, config, prompt: `${input.style ? `${input.style}，` : ""}${input.prompt}`,
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
  db.prepare(`INSERT INTO user_prompt_templates(id,name,description,base_track,step1_rewrite_system_prompt,step1_metadata_system_prompt,step3_system_prompt,style_id,image_seed_pools_json,needs_character_card,step3_skeleton_modules_json,reference_kind,image_prompt_template,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description,
    base_track=excluded.base_track,step1_rewrite_system_prompt=excluded.step1_rewrite_system_prompt,
    step1_metadata_system_prompt=excluded.step1_metadata_system_prompt,step3_system_prompt=excluded.step3_system_prompt,
    style_id=excluded.style_id,image_seed_pools_json=excluded.image_seed_pools_json,
    needs_character_card=excluded.needs_character_card,step3_skeleton_modules_json=excluded.step3_skeleton_modules_json,
    reference_kind=excluded.reference_kind,image_prompt_template=excluded.image_prompt_template,updated_at=excluded.updated_at`).run(
      id, input.name, input.description || "", input.base_track || "character-story",
      input.step1_rewrite_system_prompt || "", input.step1_metadata_system_prompt || "", input.step3_system_prompt || "",
      input.style_id || "cinematic", input.image_seed_pools_json || "[]",
      input.needs_character_card == null ? null : Number(Boolean(input.needs_character_card)),
      input.step3_skeleton_modules_json || "[]", input.reference_kind || "", input.image_prompt_template || "", input.created_at || now, now
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
    db.prepare(`INSERT INTO user_prompt_templates(id,name,description,base_track,step1_rewrite_system_prompt,step1_metadata_system_prompt,step3_system_prompt,style_id,image_seed_pools_json,needs_character_card,step3_skeleton_modules_json,reference_kind,image_prompt_template,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        id, item.name, item.description || "", item.base_track || "character-story",
        item.step1_rewrite_system_prompt || item.rewrite_prompt || "",
        item.step1_metadata_system_prompt || "",
        item.step3_system_prompt || item.scene_prompt || "",
        item.style_id || "cinematic", item.image_seed_pools_json || "[]",
        item.needs_character_card == null ? null : Number(Boolean(item.needs_character_card)),
        item.step3_skeleton_modules_json || "[]", item.reference_kind || "", item.image_prompt_template || "", now, now
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

function loadTask(id) {
  const task = db.prepare("SELECT * FROM tasks WHERE id=?").get(id);
  if (!task) throw new Error("任务不存在");
  if (task.prompt_template_id) {
    task.prompt_template = db.prepare("SELECT * FROM user_prompt_templates WHERE id=?").get(task.prompt_template_id);
  }
  task.style_config = db.prepare("SELECT * FROM custom_styles WHERE id=?").get(task.style);
  const draft = db.prepare("SELECT config FROM draft_templates WHERE id=?").get(task.template_id);
  task.draft_template = draft ? JSON.parse(draft.config) : null;
  task.cover_template = db.prepare("SELECT * FROM cover_templates WHERE id=?").get(task.cover_template_id);
  if (task.bgm_id === "builtin") task.bgm_path = app.isPackaged ? path.join(process.resourcesPath, "default-bgm.mp3") : path.join(__dirname, "..", "resources", "default-bgm.mp3");
  else if (task.bgm_id && task.bgm_id !== "none") task.bgm_path = db.prepare("SELECT path FROM bgm_library WHERE id=?").get(task.bgm_id)?.path || "";
  task.shouldCancel = () => Boolean(db.prepare("SELECT cancel_requested FROM tasks WHERE id=?").get(id)?.cancel_requested);
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
  fs.writeFileSync(path.join(task.output_dir, "pipeline.json"), JSON.stringify(script, null, 2), "utf8");
  db.prepare("UPDATE tasks SET pipeline_data=?,status='review' WHERE id=?").run(JSON.stringify(script), id);
  return db.prepare("SELECT * FROM tasks WHERE id=?").get(id);
});

function taskEmitter(id) {
  return (step, message) => {
    db.prepare("UPDATE tasks SET current_step=? WHERE id=?").run(step, id);
    db.prepare("INSERT INTO task_events(task_id,type,step,detail,data_json,ts) VALUES(?,?,?,?,?,?)")
      .run(id, "progress", step, message, "{}", Date.now());
    mainWindow?.webContents.send("task:event", { taskId: id, status: "running", step, message });
  };
}

function taskFailure(id, error) {
  const message = error instanceof Error ? error.message : String(error);
  const cancelRequested = Boolean(db.prepare("SELECT cancel_requested FROM tasks WHERE id=?").get(id)?.cancel_requested);
  if (cancelRequested || message.includes("取消")) {
    db.prepare("UPDATE tasks SET status='cancelled',error_message='任务已取消' WHERE id=?").run(id);
    mainWindow?.webContents.send("task:event", { taskId: id, status: "cancelled", step: 0, message: "任务已取消" });
    return;
  }
  const task = db.prepare("SELECT output_dir FROM tasks WHERE id=?").get(id);
  const pipelinePath = task?.output_dir ? path.join(task.output_dir, "pipeline.json") : "";
  if (pipelinePath && fs.existsSync(pipelinePath)) {
    db.prepare("UPDATE tasks SET status='failed',error_message=?,pipeline_data=? WHERE id=?")
      .run(message, fs.readFileSync(pipelinePath, "utf8"), id);
  } else {
    db.prepare("UPDATE tasks SET status='failed',error_message=? WHERE id=?").run(message, id);
  }
  mainWindow?.webContents.send("task:event", { taskId: id, status: "failed", step: 0, message });
}

ipcMain.handle("tasks:prepare", async (_event, id) => {
  db.prepare("UPDATE tasks SET status='running',current_step=0,error_message='' WHERE id=?").run(id);
  const task = loadTask(id);
  try {
    const result = await preparePipeline({
      task, config: readConfig(),
      baseOutputDir: path.join(app.getPath("documents"), "Storybound"),
      emit: taskEmitter(id)
    });
    db.prepare("UPDATE tasks SET status='review',current_step=3,output_dir=?,pipeline_data=? WHERE id=?")
      .run(result.outputDir, JSON.stringify(result.script), id);
    mainWindow?.webContents.send("task:event", { taskId: id, status: "review", step: 3, message: "脚本和分镜已生成，请确认后继续" });
    return db.prepare("SELECT * FROM tasks WHERE id=?").get(id);
  } catch (error) {
    taskFailure(id, error);
    throw error;
  }
});

ipcMain.handle("tasks:continue", async (_event, id) => {
  const task = loadTask(id);
  const script = JSON.parse(task.pipeline_data || "{}");
  if (!Array.isArray(script.scenes)) throw new Error("请先生成并确认脚本");
  db.prepare("UPDATE tasks SET status='running',error_message='' WHERE id=?").run(id);
  try {
    const result = await completePipeline({ app, task, config: readConfig(), outputDir: task.output_dir, script, emit: taskEmitter(id) });
    if (result.paused) {
      db.prepare("UPDATE tasks SET status='review',current_step=?,pipeline_data=? WHERE id=?")
        .run(result.pauseStep || 4, JSON.stringify(result.script), id);
      const message = result.pauseStep === 5 ? "配音已生成，请试听后继续" : "图片已生成，请检查画廊后继续";
      mainWindow?.webContents.send("task:event", { taskId: id, status: "review", step: result.pauseStep || 4, message });
      return db.prepare("SELECT * FROM tasks WHERE id=?").get(id);
    }
    db.prepare("UPDATE tasks SET status='completed',current_step=8,video_path=?,draft_dir=?,cover_path=?,pipeline_data=?,completed_at=datetime('now','localtime') WHERE id=?")
      .run(result.finalVideo, result.draftDir, result.coverPath || "", JSON.stringify(result.script), id);
    return db.prepare("SELECT * FROM tasks WHERE id=?").get(id);
  } catch (error) {
    taskFailure(id, error);
    throw error;
  }
});

ipcMain.handle("tasks:regenerateScene", async (_event, id, sceneIndex, kind) => {
  const task = loadTask(id);
  const script = JSON.parse(task.pipeline_data || "{}");
  db.prepare("UPDATE tasks SET status='running',error_message='' WHERE id=?").run(id);
  try {
    const updated = await regenerateScene({
      app, task, config: readConfig(), outputDir: task.output_dir,
      script, sceneIndex, kind, emit: taskEmitter(id)
    });
    db.prepare("UPDATE tasks SET pipeline_data=?,status='review',error_message='' WHERE id=?")
      .run(JSON.stringify(updated), id);
    return db.prepare("SELECT * FROM tasks WHERE id=?").get(id);
  } catch (error) {
    taskFailure(id, error);
    throw error;
  }
});

ipcMain.handle("tasks:render", async (_event, id) => {
  const task = loadTask(id);
  const script = JSON.parse(task.pipeline_data || "{}");
  db.prepare("UPDATE tasks SET status='running',error_message='' WHERE id=?").run(id);
  try {
    const result = await renderPrepared({ app, task, config: readConfig(), outputDir: task.output_dir, script, emit: taskEmitter(id) });
    db.prepare("UPDATE tasks SET status='completed',current_step=8,video_path=?,draft_dir=?,cover_path=?,completed_at=datetime('now','localtime') WHERE id=?")
      .run(result.finalVideo, result.draftDir, result.coverPath || "", id);
    return db.prepare("SELECT * FROM tasks WHERE id=?").get(id);
  } catch (error) {
    taskFailure(id, error);
    throw error;
  }
});

ipcMain.handle("tasks:run", async (_event, id) => {
  db.prepare("UPDATE tasks SET status='running', current_step=0, error_message='' WHERE id=?").run(id);
  const task = loadTask(id);
  const emit = (step, message) => {
    db.prepare("UPDATE tasks SET current_step=? WHERE id=?").run(step, id);
    db.prepare(
      "INSERT INTO task_events(task_id,type,step,detail,data_json,ts) VALUES(?,?,?,?,?,?)"
    ).run(id, "progress", step, message, "{}", Date.now());
    mainWindow?.webContents.send("task:event", {
      taskId: id, status: "running", step, message
    });
  };
  try {
    const result = await runPipeline({
      app,
      task,
      config: readConfig(),
      baseOutputDir: path.join(app.getPath("documents"), "Storybound"),
      emit
    });
    db.prepare(
      "UPDATE tasks SET status='completed', current_step=8, output_dir=?, video_path=?, draft_dir=?, cover_path=?, pipeline_data=?, completed_at=datetime('now','localtime') WHERE id=?"
    ).run(result.outputDir, result.finalVideo, result.draftDir, result.coverPath || "", JSON.stringify(result.script), id);
    mainWindow?.webContents.send("task:event", {
      taskId: id, status: "completed", step: 8, message: `视频已生成：${result.finalVideo}`
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    db.prepare("UPDATE tasks SET status='failed', error_message=? WHERE id=?").run(message, id);
    db.prepare(
      "INSERT INTO task_events(task_id,type,step,detail,data_json,ts) VALUES(?,?,?,?,?,?)"
    ).run(id, "error", 0, message, "{}", Date.now());
    mainWindow?.webContents.send("task:event", {
      taskId: id, status: "failed", step: 0, message
    });
  }
});

async function runQueuedTask(id) {
  let task = loadTask(id);
  db.prepare("UPDATE tasks SET status='running',cancel_requested=0,error_message='' WHERE id=?").run(id);
  try {
    let script = task.pipeline_data ? JSON.parse(task.pipeline_data) : null;
    let outputDir = task.output_dir;
    if (!script?.scenes?.length) {
      const prepared = await preparePipeline({
        task, config: readConfig(), baseOutputDir: path.join(app.getPath("documents"), "Storybound"), emit: taskEmitter(id)
      });
      script = prepared.script;
      outputDir = prepared.outputDir;
      db.prepare("UPDATE tasks SET output_dir=?,pipeline_data=? WHERE id=?").run(outputDir, JSON.stringify(script), id);
    }
    task = loadTask(id);
    task.pause_mode = "none";
    const result = await completePipeline({ app, task, config: readConfig(), outputDir, script, emit: taskEmitter(id) });
    db.prepare("UPDATE tasks SET status='completed',current_step=8,video_path=?,draft_dir=?,cover_path=?,pipeline_data=?,completed_at=datetime('now','localtime') WHERE id=?")
      .run(result.finalVideo, result.draftDir, result.coverPath || "", JSON.stringify(result.script), id);
  } catch (error) {
    if (String(error?.message || error).includes("取消")) {
      db.prepare("UPDATE tasks SET status='cancelled',error_message='任务已取消' WHERE id=?").run(id);
    } else taskFailure(id, error);
  }
}

ipcMain.handle("queue:run", async (_event, ids) => {
  if (queueRunning) return { running: true };
  queueRunning = true;
  setImmediate(async () => {
    try {
      for (const id of ids || []) await runQueuedTask(id);
    } finally {
      queueRunning = false;
      mainWindow?.webContents.send("queue:event", { running: false });
    }
  });
  return { running: true };
});
