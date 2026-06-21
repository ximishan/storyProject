const defaultConfig: AppConfig = {
  config_version: 4,
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
    display_name: "OpenAI 兼容图片接口",
    base_url: "https://dm-fox.rjj.cc/codex/v1",
    api_key: "",
    model: "gpt-image-2",
    async_mode: false,
    submit_path: "/images/generations",
    edit_path: "/images/edits",
    quality: "high",
    response_format: "auto",
    edit_response_format: "b64_json",
    status_path: "",
    task_id_field: "task_id",
    status_field: "status",
    image_field: "data.0.url",
    success_values: "succeeded,completed,success",
    extra_body_json: "",
    ratio_mapping_json: "",
    ratio: "9:16",
    resolution: "1k",
    concurrency: 3,
    proxy_url: ""
  },
  runninghub: {
    api_key: "", base_url: "https://www.runninghub.cn", model: "rh-image-g2", workflow_id: "",
    prompt_node_id: "", prompt_field_name: "text", node_info_json: "[]",
    ratio: "9:16", resolution: "1k", concurrency: 1, proxy_url: ""
  },
  tts: {
    provider: "system",
    system: { voice: "", volume: 100 },
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

const template = (id: string, name: string, width: number, height: number, ratio: string, imageRatio = ratio): DraftTemplate => ({
  id,
  name,
  is_default: 1,
  config: JSON.stringify({
    canvas: { width, height, ratio, backgroundColor: "#000000" },
    image: { ratio: imageRatio, fit: "cover", top: imageRatio === "4:3" ? .289 : 0, height: imageRatio === "4:3" ? .422 : 1, animation: "缩放" },
    title: { visible: true, x: 0, y: .047, fontSize: 25, color: "#FFDE00", alpha: 1, bold: true, underline: true, border: { color: "#000000", width: 40, alpha: 1 } },
    subtitle: { visible: true, x: 0, y: -.216, fontSize: 12, color: "#FFFFFF", alpha: 1, letterSpacing: 2, lineSpacing: 4, border: { color: "#000000", width: 40, alpha: 1 } },
    caption: { visible: true, x: 0, y: -.215, fontSize: 12, color: "#FFDE00", alpha: 1, maxCharsPerLine: 12, background: { color: "#000000", alpha: .5, roundRadius: .3 }, border: { color: "#000000", width: 0, alpha: 0 } },
    disclaimer: { visible: true, x: 0, y: -.903, fontSize: 8, color: "#FFFFFF", alpha: .26, text: "图片由AI生成与网络下载\n科普视频，无不良引导", border: { color: "#000000", width: 40, alpha: 1 } },
    audio: { narrationVolume: 10, bgmVolume: 3, bgmFadeOutMs: 2000, defaultBgmId: "" }
  })
});

export function installBrowserMock() {
  if (window.storybound) return;
  let tasks: TaskRecord[] = location.search.includes("demo=workflow") ? [{
    id: "workflow-preview",
    title: "雨后回家",
    input_text: "雨停以后，少年走出车站。远方的灯光亮起，他终于找到了回家的路。",
    status: "review",
    current_step: 3,
    track: "character-story",
    style: "cinematic",
    ratio: "9:16",
    target_scenes: 2,
    tts_speed: 1,
    created_at: new Date().toISOString(),
    output_dir: "C:\\demo\\雨后回家",
    pipeline_data: JSON.stringify({
      title: "雨后回家",
      summary: "少年在雨后踏上回家之路。",
      narration: "雨停以后，少年走出车站。远方的灯光亮起，他终于找到了回家的路。",
      scenes: [
        {
          index: 1,
          narration: "雨停以后，少年走出车站。",
          visual: "雨后的旧车站，少年推门而出。",
          image_prompt: "雨后车站，少年推门而出，电影感光影",
          duration_hint: 5
        },
        {
          index: 2,
          narration: "远方的灯光亮起，他终于找到了回家的路。",
          visual: "夜色里的道路尽头亮起温暖灯光。",
          image_prompt: "夜色道路，远方暖色灯光，少年背影，电影感",
          duration_hint: 6
        }
      ]
    })
  }] : [];
  let config = defaultConfig;
  let llmProfiles: LlmProfile[] = [{
    id: crypto.randomUUID(),
    name: "自定义 / 其他",
    provider: "custom",
    protocol: "openai",
    base_url: "",
    api_key: "",
    model: "",
    proxy_url: "",
    is_default: 1
  }];
  let styles: StyleRecord[] = [];
  let prompts: PromptTemplateRecord[] = [];
  let draftTemplates = [
    template("default-portrait-9-16", "默认竖屏", 1080, 1920, "9:16"),
    template("builtin-portrait-4-3", "竖屏4:3", 1080, 1920, "9:16", "4:3"),
    template("builtin-landscape-16-9", "横屏16:9", 1920, 1080, "16:9")
  ];
  const listeners = new Set<(event: TaskEvent) => void>();

  window.storybound = {
    listTasks: async () => [...tasks],
    createTask: async (input) => {
      const task: TaskRecord = {
        id: crypto.randomUUID(),
        title: input.title,
        input_text: input.inputText,
        status: "pending",
        current_step: 0,
        track: input.track,
        style: input.style,
        ratio: input.ratio,
        target_scenes: input.targetScenes,
        tts_speed: input.ttsSpeed,
        prompt_template_id: input.promptTemplateId,
        rewrite_intensity: input.rewriteIntensity,
        narrative_pov: input.narrativePov,
        keep_promotion: input.keepPromotion ? 1 : 0,
        material_source: input.materialSource,
        target_length: input.targetLength,
        template_id: input.templateId,
        reference_image_path: input.referenceImagePath,
        cover_image_mode: input.coverImageMode,
        cover_template_id: input.coverTemplateId,
        pause_mode: input.pauseMode,
        source_mode: input.sourceMode,
        source_query: input.sourceQuery,
        source_requirements: input.sourceRequirements,
        bgm_id: input.bgmId,
        speaker: input.speaker,
        task_type: input.taskType,
        script_format: input.scriptFormat,
        podcast_image_mode: input.podcastImageMode,
        podcast_speakers: input.podcastSpeakers,
        processing_mode: input.processingMode,
        pause_points: JSON.stringify(input.pausePoints || []),
        video_intro: input.videoIntro,
        video_intro_duration: input.videoIntroDuration,
        research_web: input.researchWeb === false ? 0 : 1,
        research_ai: input.researchAi ? 1 : 0,
        research_ima: input.researchIma ? 1 : 0,
        created_at: new Date().toISOString()
      };
      tasks = [task, ...tasks];
      return task;
    },
    deleteTask: async (id) => { tasks = tasks.filter(task => task.id !== id); },
    cancelTask: async id => {
      tasks = tasks.map(task => task.id === id ? { ...task, status: "cancelled" } : task);
      return tasks.find(task => task.id === id)!;
    },
    duplicateTask: async id => {
      const source = tasks.find(task => task.id === id)!;
      const copy = { ...source, id: crypto.randomUUID(), title: `${source.title} - 副本`, status: "pending" as TaskStatus, current_step: 0 };
      tasks = [copy, ...tasks];
      return copy;
    },
    runQueue: async ids => {
      tasks = tasks.map(task => ids.includes(task.id) ? { ...task, status: "completed", current_step: 8 } : task);
      return { running: true };
    },
    resumeQueue: async () => {
      tasks = tasks.map(task => Number(task.queue_order || 0) > 0 ? { ...task, status: "running" } : task);
      return { running: true };
    },
    prepareTask: async id => {
      tasks = tasks.map(task => task.id === id ? {
        ...task, status: "review", current_step: 3,
        pipeline_data: JSON.stringify({
          title: task.title, summary: task.input_text,
          narration: task.input_text,
          scenes: [{ index: 1, narration: task.input_text, visual: task.input_text, image_prompt: task.input_text }]
        })
      } : task);
      return tasks.find(task => task.id === id)!;
    },
    continueTask: async id => {
      tasks = tasks.map(task => {
        if (task.id !== id) return task;
        const pipeline = JSON.parse(task.pipeline_data || "{}") as PipelineData;
        pipeline.scenes = pipeline.scenes.map(scene => ({
          ...scene,
          image_path: scene.image_path || `C:\\demo\\images\\${scene.index}.png`,
          audio_path: scene.audio_path || `C:\\demo\\audio\\${scene.index}.wav`,
          duration: scene.duration || scene.duration_hint || 5
        }));
        return {
          ...task, status: "completed", current_step: 8,
          video_path: "C:\\demo\\final.mp4", draft_dir: "C:\\demo\\draft",
          pipeline_data: JSON.stringify(pipeline)
        };
      });
      return tasks.find(task => task.id === id)!;
    },
    updatePipeline: async (id, pipeline) => {
      tasks = tasks.map(task => task.id === id ? { ...task, pipeline_data: JSON.stringify(pipeline) } : task);
      return tasks.find(task => task.id === id)!;
    },
    regenerateScene: async (id, sceneIndex, kind) => {
      tasks = tasks.map(task => {
        if (task.id !== id) return task;
        const pipeline = JSON.parse(task.pipeline_data || "{}") as PipelineData;
        pipeline.scenes = pipeline.scenes.map(scene => scene.index === sceneIndex ? {
          ...scene,
          ...(kind === "image" ? { image_path: `C:\\demo\\images\\${scene.index}.png` } : {
            audio_path: `C:\\demo\\audio\\${scene.index}.wav`, duration: scene.duration_hint || 5
          })
        } : scene);
        return { ...task, status: "review", pipeline_data: JSON.stringify(pipeline) };
      });
      return tasks.find(task => task.id === id)!;
    },
    replaceSceneImage: async id => tasks.find(task => task.id === id)!,
    renderTask: async id => {
      tasks = tasks.map(task => task.id === id ? {
        ...task, status: "completed", current_step: 8,
        video_path: "C:\\demo\\final.mp4", draft_dir: "C:\\demo\\draft"
      } : task);
      return tasks.find(task => task.id === id)!;
    },
    runTask: async (id) => {
      tasks = tasks.map(task => task.id === id ? { ...task, status: "running" } : task);
      listeners.forEach(listener => listener({ taskId: id, status: "running", step: 1, message: "浏览器预览：流水线已启动" }));
    },
    getConfig: async () => config,
    saveConfig: async (next) => (config = next),
    testConfig: async () => ({ ok: true, message: "浏览器预览连接正常" }),
    runDiagnostics: async () => ({ checks: [{ name: "浏览器预览", ok: true }], logPath: "", dataPath: "" }),
    getTemplates: async () => [...draftTemplates],
    saveDraftTemplate: async input => {
      const item = { id: input.id || crypto.randomUUID(), is_default: 0, ...input } as DraftTemplate;
      draftTemplates = [item, ...draftTemplates.filter(template => template.id !== item.id)];
      return item;
    },
    deleteDraftTemplate: async id => { draftTemplates = draftTemplates.filter(template => template.id !== id || template.is_default); },
    listCoverTemplates: async () => [{ id: "cinematic-poster", name: "电影海报感", description: "", prompt: "", title_position: "center", title_color: "#FFFFFF" }],
    listBgm: async () => [{ id: "builtin", name: "内置 BGM", path: "", is_default: 1 }, { id: "none", name: "不使用背景音乐", path: "", is_default: 1 }],
    addBgm: async () => null,
    listLlmProfiles: async () => [...llmProfiles],
    saveLlmProfile: async input => {
      const item = { id: input.id || crypto.randomUUID(), base_url: "", api_key: "", model: "", proxy_url: "", is_default: 0, ...input } as LlmProfile;
      if (item.is_default) llmProfiles = llmProfiles.map(profile => ({ ...profile, is_default: 0 }));
      llmProfiles = [item, ...llmProfiles.filter(profile => profile.id !== item.id)];
      return item;
    },
    activateLlmProfile: async id => {
      llmProfiles = llmProfiles.map(profile => ({ ...profile, is_default: profile.id === id ? 1 : 0 }));
      return llmProfiles.find(profile => profile.id === id)!;
    },
    deleteLlmProfile: async id => {
      llmProfiles = llmProfiles.filter(profile => profile.id !== id);
      if (llmProfiles.length && !llmProfiles.some(profile => profile.is_default)) llmProfiles[0].is_default = 1;
      return llmProfiles.find(profile => profile.is_default) || null;
    },
    listSystemVoices: async () => [{ id: "Microsoft Huihui Desktop", name: "Microsoft Huihui Desktop", culture: "zh-CN", gender: "Female", age: "Adult", enabled: true }],
    listVoicePresets: async () => [],
    saveVoicePreset: async input => ({ id: input.id || crypto.randomUUID(), source_audio_path: "", ...input } as VoicePreset),
    openPath: async () => undefined,
    showInFolder: async () => undefined,
    pathToDataUrl: async () => "",
    writeClipboard: async () => true,
    generateImage: async input => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#6d4fc7"/><stop offset="1" stop-color="#173f72"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><text x="50%" y="48%" fill="white" text-anchor="middle" font-family="sans-serif" font-size="28">${input.style}</text><text x="50%" y="54%" fill="#ddd" text-anchor="middle" font-family="sans-serif" font-size="18">${input.prompt.slice(0, 24)}</text></svg>`;
      return { path: "", dataUrl: `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`, provider: "browser-preview" };
    },
    listPlaygroundJobs: async () => [],
    listStyles: async () => [...styles],
    saveStyle: async input => {
      const item = { id: input.id || crypto.randomUUID(), tag: "", prefix: "", suffix: "", negative_prompt: "", description: "", ...input } as StyleRecord;
      styles = [item, ...styles.filter(style => style.id !== item.id)];
      return item;
    },
    deleteStyle: async id => { styles = styles.filter(style => style.id !== id); },
    listPromptTemplates: async () => [...prompts],
    savePromptTemplate: async input => {
      const item = { id: input.id || crypto.randomUUID(), description: "", base_track: "character-story", step1_rewrite_system_prompt: "", step3_system_prompt: "", style_id: "cinematic", ...input } as PromptTemplateRecord;
      prompts = [item, ...prompts.filter(prompt => prompt.id !== item.id)];
      return item;
    },
    deletePromptTemplate: async id => { prompts = prompts.filter(prompt => prompt.id !== id); },
    importPromptTemplates: async () => [],
    selectAudio: async () => "C:\\demo\\music.mp3",
    selectImages: async () => ["C:\\demo\\1.png", "C:\\demo\\2.png"],
    selectImage: async () => "C:\\demo\\reference.png",
    selectDirectory: async () => "C:\\demo\\output",
    clearHistory: async () => 0,
    researchSource: async (query, requirements, options) => ({ title: query, text: `${query} 的资料整理稿。\n${requirements || ""}\n数据源：${options?.web ? "全网" : ""}${options?.ai ? " AI知识" : ""}`, sources: ["浏览器预览资料"] }),
    synthesizeVoice: async input => ({
      path: "voice.wav",
      provider: "browser-preview",
      dataUrl: `data:audio/wav;base64,${btoa(input.text)}`
    }),
    generateMusicMv: async () => ({ outputDir: "C:\\demo\\mv", videoPath: "C:\\demo\\mv\\music-mv.mp4", draftDir: "C:\\demo\\mv\\draft" }),
    onTaskEvent: (callback) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    }
  };
}
