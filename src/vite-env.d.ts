/// <reference types="vite/client" />

interface StoryboundApi {
  listTasks(): Promise<TaskRecord[]>;
  createTask(input: CreateTaskInput): Promise<TaskRecord>;
  deleteTask(id: string): Promise<void>;
  cancelTask(id: string): Promise<TaskRecord>;
  duplicateTask(id: string): Promise<TaskRecord>;
  runQueue(ids: string[]): Promise<{ running: boolean; count?: number; empty?: boolean }>;
  resumeQueue(): Promise<{ running: boolean; count?: number; empty?: boolean }>;
  prepareTask(id: string): Promise<TaskRecord>;
  continueTask(id: string): Promise<TaskRecord>;
  updatePipeline(id: string, pipeline: PipelineData): Promise<TaskRecord>;
  regenerateScene(id: string, sceneIndex: number, kind: "image" | "audio"): Promise<TaskRecord>;
  replaceSceneImage(id: string, sceneIndex: number): Promise<TaskRecord>;
  renderTask(id: string): Promise<TaskRecord>;
  getConfig(): Promise<AppConfig>;
  saveConfig(config: AppConfig): Promise<AppConfig>;
  testConfig(kind: string, config: AppConfig): Promise<{ ok: boolean; message: string; provider?: string; dataUrl?: string }>;
  runDiagnostics(): Promise<{ checks: Array<{ name: string; ok: boolean }>; logPath: string; dataPath: string }>;
  getTemplates(): Promise<DraftTemplate[]>;
  saveDraftTemplate(input: Partial<DraftTemplate> & { name: string; config: string }): Promise<DraftTemplate>;
  deleteDraftTemplate(id: string): Promise<void>;
  listCoverTemplates(): Promise<CoverTemplate[]>;
  listBgm(): Promise<BgmRecord[]>;
  addBgm(): Promise<BgmRecord | null>;
  listLlmProfiles(): Promise<LlmProfile[]>;
  saveLlmProfile(input: Partial<LlmProfile> & { name: string; provider: string; protocol: string }): Promise<LlmProfile>;
  activateLlmProfile(id: string): Promise<LlmProfile>;
  deleteLlmProfile(id: string): Promise<LlmProfile | null>;
  listSystemVoices(): Promise<SystemVoice[]>;
  listVoicePresets(): Promise<VoicePreset[]>;
  saveVoicePreset(input: Partial<VoicePreset> & { name: string; provider: string; voice_id: string }): Promise<VoicePreset>;
  openPath(target: string): Promise<void>;
  showInFolder(target: string): Promise<void>;
  pathToDataUrl(target: string): Promise<string>;
  writeClipboard(text: string): Promise<boolean>;
  generateImage(input: { prompt: string; style: string; ratio: string; resolution?: string; referenceImagePath?: string }): Promise<{ path: string; dataUrl: string; provider: string }>;
  listPlaygroundJobs(): Promise<PlaygroundJob[]>;
  listStyles(): Promise<StyleRecord[]>;
  saveStyle(input: Partial<StyleRecord> & { name: string }): Promise<StyleRecord>;
  deleteStyle(id: string): Promise<void>;
  listPromptTemplates(): Promise<PromptTemplateRecord[]>;
  savePromptTemplate(input: Partial<PromptTemplateRecord> & { name: string }): Promise<PromptTemplateRecord>;
  deletePromptTemplate(id: string): Promise<void>;
  importPromptTemplates(): Promise<PromptTemplateRecord[]>;
  selectAudio(): Promise<string>;
  selectImages(): Promise<string[]>;
  selectImage(): Promise<string>;
  selectDirectory(title?: string): Promise<string>;
  clearHistory(): Promise<number>;
  researchSource(query: string, requirements?: string, options?: { web?: boolean; ai?: boolean; ima?: boolean }): Promise<{ title: string; text: string; sources: string[] }>;
  synthesizeVoice(input: { text: string; speed: number }): Promise<{ path: string; dataUrl: string; provider: string }>;
  generateMusicMv(input: { title: string; audioPath: string; images: string[]; lyrics: string; ratio: string }): Promise<{ outputDir: string; videoPath: string; draftDir: string }>;
  runTask(id: string): Promise<void>;
  onTaskEvent(callback: (event: TaskEvent) => void): () => void;
}

interface Window {
  storybound: StoryboundApi;
}

type TaskStatus = "pending" | "running" | "interrupted" | "review" | "completed" | "failed" | "cancelled";

interface TaskRecord {
  id: string;
  title: string;
  input_text: string;
  status: TaskStatus;
  current_step: number;
  track: string;
  style: string;
  ratio: string;
  created_at: string;
  error_message?: string;
  output_dir?: string;
  video_path?: string;
  draft_dir?: string;
  pipeline_data?: string;
  target_scenes?: number;
  tts_speed?: number;
  prompt_template_id?: string;
  rewrite_intensity?: string;
  narrative_pov?: string;
  keep_promotion?: number;
  material_source?: string;
  target_length?: number;
  template_id?: string;
  reference_image_path?: string;
  cover_image_mode?: string;
  cover_template_id?: string;
  cover_path?: string;
  pause_mode?: string;
  source_mode?: string;
  source_query?: string;
  source_requirements?: string;
  bgm_id?: string;
  speaker?: string;
  task_type?: string;
  script_format?: string;
  podcast_image_mode?: string;
  podcast_speakers?: string;
  processing_mode?: string;
  pause_points?: string;
  video_intro?: number;
  video_intro_duration?: number;
  research_web?: number;
  research_ai?: number;
  research_ima?: number;
  current_stage?: string;
  last_checkpoint_at?: number;
  last_heartbeat_at?: number;
  interrupted_at?: number;
  resume_count?: number;
  queue_order?: number;
  queue_batch_id?: string;
}

interface CreateTaskInput {
  title: string;
  inputText: string;
  track: string;
  style: string;
  ratio: string;
  targetScenes?: number;
  ttsSpeed?: number;
  promptTemplateId?: string;
  rewriteIntensity?: string;
  narrativePov?: string;
  keepPromotion?: boolean | number;
  materialSource?: string;
  targetLength?: number;
  templateId?: string;
  referenceImagePath?: string;
  coverImageMode?: string;
  coverTemplateId?: string;
  pauseMode?: string;
  sourceMode?: string;
  sourceQuery?: string;
  sourceRequirements?: string;
  bgmId?: string;
  speaker?: string;
  taskType?: string;
  scriptFormat?: string;
  podcastImageMode?: string;
  podcastSpeakers?: string;
  processingMode?: string;
  pausePoints?: number[];
  videoIntro?: number;
  videoIntroDuration?: number;
  researchWeb?: boolean;
  researchAi?: boolean;
  researchIma?: boolean;
}

interface TaskEvent {
  taskId: string;
  status: TaskStatus;
  step: number;
  message: string;
}

interface DraftTemplate {
  id: string;
  name: string;
  is_default: number;
  config: string;
}

interface PipelineScene {
  index: number;
  narration: string;
  visual: string;
  desc_prompt?: string;
  image_prompt: string;
  use_reference?: boolean;
  reference_reason?: string;
  subject_presence?: "character" | "product" | "both" | "none";
  era_and_location?: string;
  duration_hint?: number;
  duration?: number;
  image_path?: string;
  audio_path?: string;
  image_provider?: string;
  source_url?: string;
  video_path?: string;
  video_provider?: string;
  video_source_url?: string;
  video_error?: string;
  image_status?: string;
  image_attempts?: number;
  image_error?: string;
  image_remote_task_id?: string;
  image_remote_provider?: string;
  audio_status?: string;
  audio_attempts?: number;
  audio_error?: string;
  video_status?: string;
  video_attempts?: number;
  video_remote_task_id?: string;
  video_remote_model?: string;
  render_clip_status?: string;
}

interface PipelineMetadata {
  character_card?: Record<string, unknown>;
  product_card?: Record<string, unknown>;
  era_and_location?: Array<Record<string, unknown> | string>;
  key_objects?: string[];
  facts?: string[];
  visual_continuity?: string[];
  planner_mode?: string;
  template_id?: string;
  template_name?: string;
  character_card_mode?: string;
  reference_kind?: string;
  reference_available?: boolean;
  step3_skeleton_modules?: string[];
  image_seed_pools?: string[];
  reference_decision_prompt?: string;
}

interface PipelineData {
  checkpoint_version?: number;
  runtime?: {
    current_stage?: string; current_step?: number; detail?: string; updated_at?: string;
    render_status?: string; cover_status?: string; draft_status?: string;
    final_video?: string; subtitle_path?: string; draft_dir?: string; cover_path?: string;
    completed_at?: string;
  };
  title: string;
  summary: string;
  narration: string;
  metadata?: PipelineMetadata;
  scenes: PipelineScene[];
}

interface StyleRecord {
  id: string;
  name: string;
  tag: string;
  prefix: string;
  suffix: string;
  negative_prompt: string;
  description: string;
  created_at?: string;
  updated_at?: string;
}

interface PromptTemplateRecord {
  id: string;
  name: string;
  description: string;
  base_track: string;
  step1_rewrite_system_prompt: string;
  step1_metadata_system_prompt?: string;
  step3_system_prompt: string;
  style_id: string;
  image_seed_pools_json?: string;
  needs_character_card?: number | boolean;
  character_card_mode?: "follow" | "force" | "skip";
  step3_skeleton_modules_json?: string;
  reference_kind?: "" | "auto" | "character" | "product" | "none";
  reference_decision_prompt?: string;
  image_prompt_template?: string;
  created_at?: number;
  updated_at?: number;
}

interface CoverTemplate {
  id: string;
  name: string;
  description: string;
  prompt: string;
  title_position: string;
  title_color: string;
}
interface BgmRecord { id: string; name: string; path: string; is_default: number; }
interface LlmProfile { id: string; name: string; provider: string; protocol: string; base_url: string; api_key: string; model: string; proxy_url: string; is_default: number; created_at?: string; }
interface SystemVoice { id: string; name: string; culture: string; gender: string; age: string; enabled: boolean; }

interface VoicePreset { id: string; name: string; provider: string; voice_id: string; source_audio_path: string; created_at?: string; last_used_at?: string; }

interface PlaygroundJob {
  id: string; prompt: string; style_id: string; provider: string; ratio: string;
  resolution: string; image_path: string; reference_image_path: string;
  status: string; error_msg: string; created_at: number;
}

interface AppConfig {
  config_version: number;
  llm: {
    provider: string;
    protocol: string;
    api_key: string;
    base_url: string;
    model: string;
    proxy_url: string;
  };
  image_provider: string;
  gpt_image: {
    api_key: string;
    base_url: string;
    model: string;
    ratio: string;
    resolution: string;
    concurrency: number;
    proxy_url: string;
  };
  modelscope: {
    api_key: string;
    base_url: string;
    model: string;
    ratio: string;
    resolution: string;
    concurrency: number;
    proxy_url: string;
    custom_models: string[];
  };
  custom_image: {
    display_name: string;
    base_url: string;
    api_key: string;
    model: string;
    async_mode: boolean;
    submit_path: string;
    edit_path: string;
    quality: string;
    response_format: string;
    edit_response_format: string;
    status_path: string;
    task_id_field: string;
    status_field: string;
    image_field: string;
    success_values: string;
    extra_body_json: string;
    ratio_mapping_json: string;
    ratio: string;
    resolution: string;
    concurrency: number;
    proxy_url: string;
  };
  runninghub: {
    api_key: string;
    base_url: string;
    model: string;
    workflow_id: string;
    prompt_node_id: string;
    prompt_field_name: string;
    node_info_json: string;
    ratio: string;
    resolution: string;
    concurrency: number;
    proxy_url: string;
  };
  tts: {
    provider: string;
    system: {
      voice: string;
      volume: number;
    };
    volcengine: {
      app_id: string;
      access_key: string;
      engine_version: string;
      resource_id: string;
      base_url: string;
      speaker: string;
    };
  };
  jianying: { draft_path: string };
  media: { ffmpeg_path: string; bgm_path: string; use_default_bgm: boolean };
  task_storage_path: string;
  ui: { theme: string };
}
