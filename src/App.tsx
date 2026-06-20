import { useEffect, useMemo, useState } from "react";
import {
  AudioLines, BookOpenText, Boxes, CheckCircle2, ChevronRight, CircleHelp, Clapperboard,
  Copy, ExternalLink, Eye, FileText, FolderOpen, History, Image,
  LayoutList, LayoutTemplate, LoaderCircle, Mic2, MoreHorizontal, Music,
  Palette, Play, Plus, RefreshCw, Save, Search, Settings, Sparkles, Trash2, Upload,
  Video, Volume2, WandSparkles, X
} from "lucide-react";
import systemPromptTemplatesData from "../shared/system-prompt-templates.json";

type Page = "tasks" | "history" | "create" | "playground" | "voice" | "music" | "templates" | "styles" | "drafts" | "settings";
type SettingsTab = "llm" | "image" | "tts" | "output" | "diagnostics";

const nav = [
  { page: "create" as Page, label: "开始创作", icon: WandSparkles },
  { page: "tasks" as Page, label: "任务队列", icon: LayoutList },
  { page: "history" as Page, label: "历史任务", icon: History },
  { page: "playground" as Page, label: "图片实验室", icon: Image },
  { page: "voice" as Page, label: "配音实验室", icon: Mic2 },
  { page: "music" as Page, label: "音乐 MV", icon: Music },
  { page: "templates" as Page, label: "提示词模板", icon: FileText },
  { page: "styles" as Page, label: "视觉风格", icon: Palette },
  { page: "drafts" as Page, label: "草稿模板", icon: LayoutTemplate }
];

const tracks = [
  { id: "character-story", name: "人物故事", desc: "人物经历、传奇故事与成长轨迹", icon: BookOpenText },
  { id: "health-book", name: "健康图书", desc: "健康养生与医学知识", icon: Boxes },
  { id: "culture-knowledge", name: "文化科普", desc: "传统民俗与国学智慧", icon: Boxes },
  { id: "picture-book", name: "绘本故事", desc: "儿童绘本与睡前故事", icon: BookOpenText },
  { id: "ecommerce", name: "电商带货", desc: "产品种草与好物推荐", icon: Sparkles },
  { id: "inspiration", name: "心灵鸡汤", desc: "情感治愈与励志感悟", icon: Sparkles },
  { id: "folk-tale", name: "民间故事", desc: "虚构传说与因果寓言", icon: BookOpenText },
  { id: "general", name: "通用故事", desc: "通用写实叙事内容", icon: FileText },
  { id: "food-vlog", name: "美食探店", desc: "小店烟火气与真实故事", icon: Clapperboard }
];

const systemPromptTemplates = systemPromptTemplatesData as PromptTemplateRecord[];

export default function App() {
  const [page, setPage] = useState<Page>("tasks");
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [notice, setNotice] = useState("");

  const refreshTasks = async () => setTasks(await window.storybound.listTasks());
  useEffect(() => {
    refreshTasks();
    window.storybound.getConfig().then(setConfig);
    return window.storybound.onTaskEvent(event => {
      setNotice(event.message);
      refreshTasks();
    });
  }, []);

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark"><Sparkles size={18} /></div>
        <div><strong>Storybound</strong><span>AI VIDEO STUDIO</span></div>
      </div>
      <nav>{nav.map(({ page: target, label, icon: Icon }) =>
        <button className={page === target ? "active" : ""} onClick={() => setPage(target)} key={target}>
          <Icon size={18} /><span>{label}</span>
        </button>)}
        </nav>
        <div className="sidebar-bottom">
          <button className={page === "settings" ? "active" : ""} onClick={() => setPage("settings")}>
          <Settings size={18} /><span>设置</span>
        </button>
        <button><CircleHelp size={18} /><span>使用帮助</span></button>
        <div className="version">Storybound Rebuild · v0.6.0</div>
      </div>
      </aside>
      <main className="main">
        {notice && <div className="toast" onClick={() => setNotice("")}>{notice}</div>}
      {page === "tasks" && <Tasks tasks={tasks.filter(task => task.status !== "completed")} onCreate={() => setPage("create")} onRefresh={refreshTasks} title="任务队列" desc="查看等待、运行中和失败的任务。" />}
      {page === "history" && <Tasks tasks={tasks} onCreate={() => setPage("create")} onRefresh={refreshTasks} title="历史任务" desc="按草稿、运行、完成、失败和取消状态查看全部任务。" history />}
      {page === "create" && <CreateTask onCreated={async () => { await refreshTasks(); setPage("tasks"); }} onManageTemplates={() => setPage("drafts")} onManageStyles={() => setPage("styles")} />}
      {page === "settings" && config && <SettingsPage config={config} onSave={async next => {
        setConfig(await window.storybound.saveConfig(next));
        setNotice("设置已保存");
      }} />}
      {page === "drafts" && <DraftTemplates />}
      {page === "playground" && <ImagePlayground />}
      {page === "voice" && <VoiceLab />}
      {page === "music" && <MusicMv />}
      {page === "templates" && <PromptTemplates />}
      {page === "styles" && <VisualStyles />}
    </main>
  </div>;
}

function PageHeader({ eyebrow, title, desc, actions }: {
  eyebrow: string; title: string; desc: string; actions?: React.ReactNode;
}) {
  return <header className="page-header">
    <div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{desc}</p></div>
    {actions && <div className="header-actions">{actions}</div>}
  </header>;
}

function Tasks({ tasks, onCreate, onRefresh, title = "任务队列", desc = "查看等待、运行中和失败的任务。", history = false }: {
  tasks: TaskRecord[]; onCreate: () => void; onRefresh: () => void;
  title?: string; desc?: string; history?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<TaskRecord | null>(null);
  const [checked, setChecked] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState("all");
  const filtered = useMemo(() => tasks.filter(task =>
    `${task.title} ${task.input_text}`.toLowerCase().includes(query.toLowerCase())
    && (statusFilter === "all" || task.status === statusFilter)
  ), [tasks, query, statusFilter]);

  return <section>
    <PageHeader eyebrow={history ? "HISTORY" : "WORKSPACE"} title={title} desc={desc}
      actions={<button className="primary" onClick={onCreate}><Plus size={17} />新建任务</button>} />
    <div className="toolbar">
      <label className="search"><Search size={17} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索任务…" /></label>
      <div className="toolbar-actions">
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="all">全部状态</option><option value="pending">草稿</option><option value="review">待确认</option>
          <option value="running">运行中</option><option value="completed">已完成</option><option value="failed">失败</option><option value="cancelled">已取消</option>
        </select>
        {!history && checked.length > 0 && <button className="primary" onClick={async () => { await window.storybound.runQueue(checked); setChecked([]); onRefresh(); }}><Play size={15} />串行执行 {checked.length} 项</button>}
        <div className="stat"><span>{tasks.length}</span> 全部任务</div>
      </div>
    </div>
    {filtered.length === 0 ? <div className="empty">
      <div className="empty-orbit"><Clapperboard size={34} /></div>
      <h2>{history ? "还没有完成的任务" : "任务队列为空"}</h2>
      <p>{history ? "完成视频生成后，会在这里保留产物入口。" : "完成 LLM、外部生图与火山配音配置后，即可运行完整视频流水线。"}</p>
      <button className="primary" onClick={onCreate}><Sparkles size={17} />创建第一个任务</button>
    </div> : <div className="task-grid">{filtered.map(task =>
      <article className="task-card" key={task.id} onClick={() => setSelected(task)}>
        <div className="task-top">
          <div className="task-check"><input type="checkbox" checked={checked.includes(task.id)} onClick={e => e.stopPropagation()} onChange={e => setChecked(current => e.target.checked ? [...current, task.id] : current.filter(id => id !== task.id))} /><span className={`status ${task.status}`}>{task.status === "running" && <LoaderCircle size={13} className="spin" />}{statusText(task.status)}</span></div>
          <button className="icon-btn"><MoreHorizontal size={18} /></button>
        </div>
        <h3>{task.title || "未命名任务"}</h3>
        <p>{task.error_message || task.input_text}</p>
        <div className="task-meta"><span>{trackName(task.track)}</span><span>{task.ratio}</span><span>{task.style}</span></div>
        <div className="progress"><i style={{ width: `${Math.min(task.current_step / 8 * 100, 100)}%` }} /></div>
        <div className="task-actions">
          <button onClick={async e => {
            e.stopPropagation();
            if (task.status === "review" || task.pipeline_data) {
              setSelected(task);
              return;
            }
            if (task.pause_mode === "none") await window.storybound.runTask(task.id);
            else await window.storybound.prepareTask(task.id);
            onRefresh();
          }} disabled={task.status === "running"}>
            <Play size={15} />{task.status === "review" ? "确认分镜" : task.status === "completed" ? "打开工作台" : task.pipeline_data ? "继续处理" : task.status === "failed" ? "从失败处继续" : "生成脚本"}
          </button>
          {task.status === "running" && <button onClick={async e => { e.stopPropagation(); await window.storybound.cancelTask(task.id); onRefresh(); }}>取消</button>}
          <button title="复制任务" onClick={async e => { e.stopPropagation(); await window.storybound.duplicateTask(task.id); onRefresh(); }}><Copy size={15} /></button>
          <button className="danger" onClick={async e => { e.stopPropagation(); await window.storybound.deleteTask(task.id); onRefresh(); }}>
            <Trash2 size={15} />
          </button>
        </div>
      </article>)}</div>}
    {selected && <TaskDetail task={tasks.find(task => task.id === selected.id) || selected} onClose={() => setSelected(null)} onRefresh={onRefresh} />}
  </section>;
}

function TaskDetail({ task, onClose, onRefresh }: { task: TaskRecord; onClose: () => void; onRefresh: () => void }) {
  const parsePipeline = () => {
    try { return task.pipeline_data ? JSON.parse(task.pipeline_data) as PipelineData : null; }
    catch { return null; }
  };
  const [pipeline, setPipeline] = useState<PipelineData | null>(parsePipeline);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [imageUrls, setImageUrls] = useState<Record<number, string>>({});

  useEffect(() => setPipeline(parsePipeline()), [task.pipeline_data]);
  useEffect(() => {
    const paths = pipeline?.scenes?.filter(scene => scene.image_path) || [];
    Promise.all(paths.map(async scene => [scene.index, await window.storybound.pathToDataUrl(scene.image_path!)] as const))
      .then(entries => setImageUrls(Object.fromEntries(entries)));
  }, [task.pipeline_data, pipeline?.scenes?.length]);

  const run = async (label: string, action: () => Promise<unknown>) => {
    setBusy(label);
    setMessage("");
    try {
      await action();
      await onRefresh();
      setMessage(`${label}完成`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy("");
    }
  };
  const save = () => pipeline
    ? run("保存脚本", () => window.storybound.updatePipeline(task.id, pipeline))
    : Promise.resolve();
  const updateScene = (index: number, patch: Partial<PipelineScene>) => setPipeline(current => {
    if (!current) return current;
    const scenes = current.scenes.map(scene => {
      if (scene.index !== index) return scene;
      const next = { ...scene, ...patch };
      if (patch.narration !== undefined && patch.narration !== scene.narration) {
        next.audio_path = undefined;
        next.duration = undefined;
      }
      if (patch.image_prompt !== undefined && patch.image_prompt !== scene.image_prompt) {
        next.image_path = undefined;
      }
      return next;
    });
    return { ...current, narration: scenes.map(scene => scene.narration).join(""), scenes };
  });
  const hasAssets = Boolean(pipeline?.scenes?.length && pipeline.scenes.every(scene => scene.image_path && scene.audio_path));
  const stages = ["分析文案", "改写脚本", "拆分分镜", "生成画面", "生成配音", "合成视频", "剪映草稿", "完成"];

  return <div className="modal-backdrop" onClick={onClose}>
    <div className="task-detail" onClick={e => e.stopPropagation()}>
      <button className="modal-close" onClick={onClose}><X size={18} /></button>
      <span className={`status ${task.status}`}>{statusText(task.status)}</span>
      <h2>{task.title}</h2>
      <p className="detail-source">{task.input_text}</p>
      {task.error_message && <div className="error-box">{task.error_message}</div>}
      <div className="stage-strip">{stages.map((stage, index) => <div className={task.current_step >= index + 1 ? "done" : task.status === "review" && index === 3 ? "next" : ""} key={stage}>
        <span>{task.current_step > index ? <CheckCircle2 size={13} /> : index + 1}</span><small>{stage}</small>
      </div>)}</div>
      {message && <div className="workbench-message">{message}</div>}
      <div className="workflow-actions">
        {!pipeline && <button className="primary" disabled={Boolean(busy)} onClick={() => run("生成脚本", () => window.storybound.prepareTask(task.id))}><Sparkles size={16} />生成脚本与分镜</button>}
        {pipeline && <button disabled={Boolean(busy)} onClick={save}><Save size={16} />保存修改</button>}
        {pipeline && !hasAssets && <button className="primary" disabled={Boolean(busy)} onClick={async () => {
          await save();
          await run("生成全部素材与视频", () => window.storybound.continueTask(task.id));
        }}><Play size={16} />确认并补齐素材生成视频</button>}
        {hasAssets && <button className="primary" disabled={Boolean(busy)} onClick={async () => {
          await save();
          await run("重新合成视频", () => window.storybound.renderTask(task.id));
        }}><RefreshCw size={16} />使用现有素材重新合成</button>}
      </div>
      <div className="artifact-actions">
        {task.video_path && <button className="primary" onClick={() => window.storybound.openPath(task.video_path!)}><Video size={16} />播放视频</button>}
        {task.output_dir && <button onClick={() => window.storybound.openPath(task.output_dir!)}><FolderOpen size={16} />打开产物目录</button>}
        {task.draft_dir && <button onClick={() => window.storybound.openPath(task.draft_dir!)}><ExternalLink size={16} />打开剪映草稿</button>}
        {task.cover_path && <button onClick={() => window.storybound.openPath(task.cover_path!)}><Image size={16} />查看封面海报</button>}
      </div>
      {pipeline?.scenes?.length ? <div className="scene-list">
        <h3>分镜工作台 · {pipeline.scenes.length} 镜</h3>
        {pipeline.scenes.map(scene => <div className="scene-editor" key={scene.index}>
          <div className="scene-editor-head">
            <strong>镜头 {String(scene.index).padStart(2, "0")}</strong>
            <span>{scene.duration?.toFixed(1) || "—"}s</span>
            <div>
              <button disabled={Boolean(busy)} onClick={() => run(`重做镜头 ${scene.index} 画面`, () => window.storybound.regenerateScene(task.id, scene.index, "image"))}><RefreshCw size={13} />重做画面</button>
              <button disabled={Boolean(busy)} onClick={() => run(`替换镜头 ${scene.index} 画面`, () => window.storybound.replaceSceneImage(task.id, scene.index))}><Upload size={13} />上传替换</button>
              <button disabled={Boolean(busy)} onClick={() => run(`重做镜头 ${scene.index} 配音`, () => window.storybound.regenerateScene(task.id, scene.index, "audio"))}><Volume2 size={13} />重做配音</button>
            </div>
          </div>
          {imageUrls[scene.index] && <div className="scene-preview"><img src={imageUrls[scene.index]} alt={`镜头 ${scene.index}`} /></div>}
          <label>旁白<textarea value={scene.narration} onChange={e => updateScene(scene.index, { narration: e.target.value })} /></label>
          <label>画面描述<textarea value={scene.visual} onChange={e => updateScene(scene.index, { visual: e.target.value })} /></label>
          <label>图片提示词<textarea value={scene.image_prompt} onChange={e => updateScene(scene.index, { image_prompt: e.target.value })} /></label>
          <div className="scene-assets">
            <span className={scene.image_path ? "ready" : ""}>画面 {scene.image_path ? "已生成" : "未生成"}</span>
            <span className={scene.audio_path ? "ready" : ""}>配音 {scene.audio_path ? "已生成" : "未生成"}</span>
            {scene.image_provider && <span className="ready">{scene.image_provider}</span>}
            {scene.source_url && <button onClick={() => window.open(scene.source_url, "_blank")}>素材来源</button>}
          </div>
        </div>)}
      </div> : <div className="detail-empty">先生成脚本与分镜，在确认内容后再消耗时间生成图片、配音和视频。</div>}
    </div>
  </div>;
}

function CreateTask({ onCreated, onManageTemplates, onManageStyles }: { onCreated: () => void; onManageTemplates: () => void; onManageStyles: () => void }) {
  const [track, setTrack] = useState("character-story");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const trackStyles: Record<string, string> = {
    "character-story": "black-white", "health-book": "oil-painting", "culture-knowledge": "ancient-cinematic",
    "picture-book": "pixar-3d", ecommerce: "realistic", inspiration: "cinematic",
    "folk-tale": "folk-illustration", general: "realistic", "food-vlog": "retro-film"
  };
  const visualStyles = [
    ["black-white", "黑白摄影", "纪实感"], ["realistic", "写实彩色", "质感胶片"],
    ["oil-painting", "油画风格", "印象写意"], ["cinematic", "现代电影", "宽屏调色"],
    ["ancient-cinematic", "古风电影", "古代史诗"], ["retro-film", "复古胶片", "80年代柯达"],
    ["watercolor", "水彩治愈", "柔和晕染"], ["magazine", "杂志插画", "极简色块"],
    ["pixar-3d", "皮克斯 3D", "动画质感"], ["ink-wash", "中国水墨", "文人意境"],
    ["folk-illustration", "民间故事工笔风", "工笔叙事"], ["ghibli", "吉卜力", "治愈日漫"]
  ];
  const voices = [
    ["zh_male_dongfanghaoran_uranus_bigtts", "东方浩然", "2.0"],
    ["zh_male_xuanyijieshuo_uranus_bigtts", "悬疑解说", "2.0"],
    ["zh_female_wenrouxiaoya_uranus_bigtts", "温柔小雅", "2.0"],
    ["zh_female_wenroumama_uranus_bigtts", "温柔妈妈", "2.0"]
  ];
  const [style, setStyle] = useState(trackStyles["character-story"]);
  const [ratio, setRatio] = useState("9:16");
  const [targetScenes, setTargetScenes] = useState(0);
  const [targetLength, setTargetLength] = useState(0);
  const [ttsSpeed, setTtsSpeed] = useState(1);
  const [speaker, setSpeaker] = useState(voices[0][0]);
  const [taskType, setTaskType] = useState("story");
  const [podcastImageMode, setPodcastImageMode] = useState("multi");
  const [podcastSpeakers, setPodcastSpeakers] = useState("mizai-dayi");
  const [rewriteIntensity, setRewriteIntensity] = useState("standard");
  const [narrativePov, setNarrativePov] = useState("original");
  const [keepPromotion, setKeepPromotion] = useState(false);
  const [materialSource, setMaterialSource] = useState("ai");
  const [videoIntro, setVideoIntro] = useState(0);
  const [customIntroCount, setCustomIntroCount] = useState(5);
  const [templateId, setTemplateId] = useState("default-portrait-9-16");
  const [referenceImagePath, setReferenceImagePath] = useState("");
  const [coverImageMode, setCoverImageMode] = useState("off");
  const [coverTemplateId, setCoverTemplateId] = useState("cinematic-poster");
  const [processingMode, setProcessingMode] = useState("auto");
  const [pauseMode, setPauseMode] = useState("none");
  const [pausePoints, setPausePoints] = useState<number[]>([]);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [sourceMode, setSourceMode] = useState("paste");
  const [sourceQuery, setSourceQuery] = useState("");
  const [sourceRequirements, setSourceRequirements] = useState("");
  const [researchWeb, setResearchWeb] = useState(true);
  const [researchAi, setResearchAi] = useState(false);
  const [researchIma, setResearchIma] = useState(false);
  const [researching, setResearching] = useState(false);
  const [promptTemplateId, setPromptTemplateId] = useState("");
  const [customStyles, setCustomStyles] = useState<StyleRecord[]>([]);
  const [promptTemplates, setPromptTemplates] = useState<PromptTemplateRecord[]>([]);
  const [draftTemplates, setDraftTemplates] = useState<DraftTemplate[]>([]);
  const [coverTemplates, setCoverTemplates] = useState<CoverTemplate[]>([]);
  const [bgmItems, setBgmItems] = useState<BgmRecord[]>([]);
  const [bgmId, setBgmId] = useState("builtin");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    window.storybound.listStyles().then(setCustomStyles);
    window.storybound.listPromptTemplates().then(setPromptTemplates);
    window.storybound.getTemplates().then(setDraftTemplates);
    window.storybound.listCoverTemplates().then(setCoverTemplates);
    window.storybound.listBgm().then(setBgmItems);
  }, []);

  const chooseTrack = (id: string) => {
    setTrack(id);
    setStyle(trackStyles[id] || "realistic");
    setPromptTemplateId(id);
  };
  const chooseTemplate = (id: string) => {
    setTemplateId(id);
    const selected = draftTemplates.find(item => item.id === id);
    if (!selected) return;
    const config = JSON.parse(selected.config);
    setRatio(config.image?.ratio || config.canvas?.ratio || "9:16");
    if (config.audio?.defaultBgmId) setBgmId(config.audio.defaultBgmId);
  };
  const submit = async (start: boolean) => {
    if (!text.trim()) return;
    setSaving(true);
    const effectivePause = pauseMode === "custom"
      ? (pausePoints.some(step => step <= 3) ? "script" : pausePoints.length ? "every" : "none")
      : pauseMode === "critical" ? "script" : pauseMode;
    const task = await window.storybound.createTask({
      title: title.trim() || text.trim().slice(0, 18),
      inputText: text.trim(), track, style, ratio, targetScenes: targetScenes || undefined, targetLength: targetLength || undefined,
      ttsSpeed, promptTemplateId, rewriteIntensity, narrativePov, keepPromotion,
      materialSource, templateId, referenceImagePath, coverImageMode, coverTemplateId,
      pauseMode: effectivePause, sourceMode, sourceQuery, sourceRequirements, bgmId, speaker,
      taskType, scriptFormat: taskType === "podcast" ? "dialogue" : "narration",
      podcastImageMode, podcastSpeakers, processingMode, pausePoints,
      videoIntro: videoIntro === -2 ? customIntroCount : videoIntro, videoIntroDuration: 5,
      researchWeb, researchAi, researchIma
    });
    onCreated();
    if (start) {
      const action = effectivePause === "script" ? window.storybound.prepareTask(task.id) : window.storybound.runTask(task.id);
      void action.catch(error => console.error(error));
    }
  };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key === "Enter" && text.trim() && !saving) {
        event.preventDefault();
        void submit(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  return <section>
    <PageHeader eyebrow="NEW CREATION" title="创建视频任务" desc="粘贴一段人物故事，几分钟后在剪映里打开" />
    <div className="home-create">
      <CreateSection title="文案" desc="改写 · 叙事视角 · 目标字数">
        <label className="field-title">标题 <span>可选</span><input value={title} onChange={e => setTitle(e.target.value)} placeholder="留空会从文案自动提取" /></label>
        <div className="source-tabs">
          <button data-active={sourceMode === "paste"} onClick={() => setSourceMode("paste")}><b>粘贴文案</b><span>已有对标文案，直接贴进来改写</span></button>
          <button data-active={sourceMode === "research"} onClick={() => setSourceMode("research")}><b>AI 创作 <em>NEW</em></b><span>输入关键词，AI 自动搜资料并创作原稿</span></button>
        </div>
        {sourceMode === "research" ? <div className="research-box">
          <label>关键词<input value={sourceQuery} onChange={e => setSourceQuery(e.target.value)} placeholder="例如：钱学森回国 / 张桂梅 / 苹果秋季发布会" /></label>
          <div><strong>数据源 <small>至少选一个</small></strong>
            <label className="source-check"><input type="checkbox" checked={researchWeb} onChange={e => setResearchWeb(e.target.checked)} /><span><b>全网搜索</b><small>从公开网页抓取相关文章作为参考素材</small></span></label>
            <label className="source-check"><input type="checkbox" checked={researchAi} onChange={e => setResearchAi(e.target.checked)} /><span><b>AI 内置知识补充</b><small>允许 AI 用已有知识补全细节</small></span></label>
            <label className="source-check muted"><input type="checkbox" disabled checked={researchIma} onChange={e => setResearchIma(e.target.checked)} /><span><b>IMA 知识库</b><small>当前未配置</small></span></label>
          </div>
          <label>额外要求 <span>可选</span><textarea value={sourceRequirements} onChange={e => setSourceRequirements(e.target.value)} placeholder="例如：字数控制在 500 字左右；聚焦人物的转折经历；语气偏感性" /></label>
          <button disabled={!sourceQuery.trim() || (!researchWeb && !researchAi && !researchIma) || researching} onClick={async () => {
            setResearching(true);
            try {
              const result = await window.storybound.researchSource(sourceQuery, sourceRequirements, { web: researchWeb, ai: researchAi, ima: researchIma });
              setTitle(current => current || result.title);
              setText(result.text);
            } finally { setResearching(false); }
          }}>{researching ? <LoaderCircle size={15} className="spin" /> : <Search size={15} />}搜索</button>
        </div> : <label className="script-field">文案内容<textarea value={text} onChange={e => setText(e.target.value)} placeholder="粘贴一段人物故事原始文案，AI 会自动改写为口播版、拆分分镜、配图配音。" /><small>{text.length.toLocaleString()} 字</small></label>}
        {sourceMode === "research" && text && <label className="script-field">已生成原稿<textarea value={text} onChange={e => setText(e.target.value)} /></label>}
        <OptionGroup title="视频形态"><Choice active={taskType === "story"} onClick={() => setTaskType("story")} title="旁白视频" desc="单人配音讲述（默认）" /><Choice active={taskType === "podcast"} onClick={() => setTaskType("podcast")} title="双人播客" desc="两位主播一问一答聊内容" /></OptionGroup>
        {taskType === "podcast" && <div className="podcast-options">
          <OptionGroup title="配图方式"><Choice active={podcastImageMode === "multi"} onClick={() => setPodcastImageMode("multi")} title="按分镜配图" desc="每轮对话一张图" /><Choice active={podcastImageMode === "single"} onClick={() => setPodcastImageMode("single")} title="单图封面" desc="一张主题图铺满全程，最快出片" /></OptionGroup>
          <OptionGroup title="主播组合"><Choice active={podcastSpeakers === "mizai-dayi"} onClick={() => setPodcastSpeakers("mizai-dayi")} title="咪仔 × 大壹（默认）" /><Choice active={podcastSpeakers === "liufei-xiaolei"} onClick={() => setPodcastSpeakers("liufei-xiaolei")} title="刘飞 × 潇磊" /></OptionGroup>
          <p className="form-hint">播客使用专属双人音色，常规配音员与语速选项会自动隐藏。</p>
        </div>}
        <OptionGroup title="内容赛道"><div className="home-chip-grid">{tracks.map(({ id, name, desc }) => <Choice key={id} active={track === id} onClick={() => chooseTrack(id)} title={name} desc={desc} />)}</div></OptionGroup>
        <OptionGroup title="改写强度" hint="强度越高原创度越高，但与对标结构差异越大"><Choice active={rewriteIntensity === "standard"} onClick={() => setRewriteIntensity("standard")} title="标准改写" badge="推荐" /><Choice active={rewriteIntensity === "deep"} onClick={() => setRewriteIntensity("deep")} title="深度改写" /><Choice active={rewriteIntensity === "original"} onClick={() => setRewriteIntensity("original")} title="高度原创" /></OptionGroup>
        <OptionGroup title="叙事视角" hint="切换人称可大幅提升原创度"><Choice active={narrativePov === "original"} onClick={() => setNarrativePov("original")} title="保持原文" badge="默认" /><Choice active={narrativePov === "first"} onClick={() => setNarrativePov("first")} title="第一人称" /><Choice active={narrativePov === "third"} onClick={() => setNarrativePov("third")} title="第三人称" /></OptionGroup>
        <label className="toggle-line"><span><b>带货模式</b><small>{keepPromotion ? "改写时保留带货段落" : "改写时删除带货段落"}</small></span><input type="checkbox" checked={keepPromotion} onChange={e => setKeepPromotion(e.target.checked)} /></label>
        <div className="number-pair"><label>目标字数<input type="number" min={100} step={50} value={targetLength || ""} onChange={e => setTargetLength(Number(e.target.value))} placeholder="自动" /><small>字（±15%，留空跟随原文）</small></label><label>目标分镜数<input type="number" min={3} step={1} value={targetScenes || ""} onChange={e => setTargetScenes(Number(e.target.value))} placeholder="自动" /><small>个（±10%，建议每镜 25-45 字）</small></label></div>
      </CreateSection>

      <CreateSection title="出图" desc="素材来源 · 画面风格 · 比例 · 参考图">
        <OptionGroup title="素材来源"><Choice active={materialSource === "ai"} onClick={() => setMaterialSource("ai")} title="AI 绘图" desc="按画面风格生成插画/写实图" /><Choice active={materialSource === "network"} onClick={() => setMaterialSource("network")} title="网络素材" desc="真实视频画面，免版税可商用" /></OptionGroup>
        {taskType !== "podcast" && <OptionGroup title="动态分镜"><Choice active={videoIntro === 0} onClick={() => setVideoIntro(0)} title="关闭" /><Choice active={videoIntro === 3} onClick={() => setVideoIntro(3)} title="前 3 张" /><Choice active={videoIntro === -1} onClick={() => setVideoIntro(-1)} title="全部" /><Choice active={videoIntro === -2} onClick={() => setVideoIntro(-2)} title="自定义" />{videoIntro === -2 && <input className="inline-number" type="number" min={1} value={customIntroCount} onChange={e => setCustomIntroCount(Number(e.target.value))} />}</OptionGroup>}
        <OptionGroup title="画面风格"><div className="style-chip-grid">{visualStyles.map(([id, name, desc]) => <Choice key={id} active={style === id} onClick={() => setStyle(id)} title={name} desc={desc} />)}{customStyles.map(item => <Choice key={item.id} active={style === item.id} onClick={() => setStyle(item.id)} title={item.name} desc={item.tag} />)}<button className="choice-chip" onClick={onManageStyles}><Plus size={14} />自定义</button></div></OptionGroup>
        <OptionGroup title="草稿模板"><div className="template-choice-grid">{draftTemplates.map(item => { const cfg = JSON.parse(item.config); return <Choice key={item.id} active={templateId === item.id} onClick={() => chooseTemplate(item.id)} title={`${item.is_default ? "★ " : ""}${item.name}`} desc={`出图 ${cfg.image?.ratio || cfg.canvas?.ratio}`} />; })}<button className="choice-chip" onClick={onManageTemplates}><Plus size={14} />管理模板</button></div></OptionGroup>
        <OptionGroup title="AI 出图比例" hint="已跟随草稿模板"><Choice active={ratio === "9:16"} onClick={() => setRatio("9:16")} title="9:16" desc="竖屏" /><Choice active={ratio === "4:3"} onClick={() => setRatio("4:3")} title="4:3" desc="标准" /><Choice active={ratio === "1:1"} onClick={() => setRatio("1:1")} title="1:1" desc="方形" /><Choice active={ratio === "16:9"} onClick={() => setRatio("16:9")} title="16:9" desc="横屏" /></OptionGroup>
        <p className="form-hint">选模板时自动同步图片比例。如需自定义，请去草稿模板编辑器调整图片区域比例。</p>
        <div className="reference-row"><div><b>主角参考图</b><small>可选 · 出现主角的分镜会以参考图保持人物一致</small></div><button className="reference-upload-empty" onClick={async () => setReferenceImagePath(await window.storybound.selectImage())}><Upload size={15} />{referenceImagePath ? "已选择参考图" : "上传主角参考图"}</button></div>
        <OptionGroup title="封面海报" hint="发布时上传的封面，独立于正片"><Choice active={coverImageMode === "off"} onClick={() => setCoverImageMode("off")} title="不生成" /><Choice active={coverImageMode === "title"} onClick={() => setCoverImageMode("title")} title="带标题文字" /><Choice active={coverImageMode === "blank"} onClick={() => setCoverImageMode("blank")} title="留白不带字" /></OptionGroup>
        {coverImageMode !== "off" && <label>封面模板<select value={coverTemplateId} onChange={e => setCoverTemplateId(e.target.value)}>{coverTemplates.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
      </CreateSection>

      <CreateSection title="配音" desc="音色 · 语速 · 背景音乐">
        {taskType === "story" && <><OptionGroup title="配音员"><div className="voice-tabs"><button data-active>豆包</button><button disabled>MiniMax</button></div>{voices.map(([id, name, version]) => <Choice key={id} active={speaker === id} onClick={() => setSpeaker(id)} title={name} badge={version} />)}</OptionGroup>
          <OptionGroup title="配音语速"><Choice active={ttsSpeed === .85} onClick={() => setTtsSpeed(.85)} title="慢速" desc="0.85×" /><Choice active={ttsSpeed === 1} onClick={() => setTtsSpeed(1)} title="默认" desc="1.0×" /><Choice active={ttsSpeed === 1.15} onClick={() => setTtsSpeed(1.15)} title="快速" desc="1.15×" /><Choice active={ttsSpeed === 1.3} onClick={() => setTtsSpeed(1.3)} title="更快" desc="1.3×" /></OptionGroup></>}
        <OptionGroup title="背景音乐">{bgmItems.map(item => <Choice key={item.id} active={bgmId === item.id} onClick={() => setBgmId(item.id)} title={item.id === "builtin" ? "🎵 内置 BGM" : item.name} />)}<button className="choice-chip" onClick={async () => { const added = await window.storybound.addBgm(); if (added) { setBgmItems(await window.storybound.listBgm()); setBgmId(added.id); } }}><Plus size={14} />添加</button></OptionGroup>
      </CreateSection>

      <div className="advanced-block">
        <button className="advanced-trigger" onClick={() => setAdvancedOpen(!advancedOpen)}>{advancedOpen ? "▼" : "▶"} <span><b>高级选项</b><small>处理模式 · 暂停确认（默认值通常已足够）</small></span></button>
        {advancedOpen && <div className="advanced-content">
          <OptionGroup title="处理模式" hint="后续提示词、生图、配音和剪映草稿都会继续执行"><Choice active={processingMode === "auto"} onClick={() => setProcessingMode("auto")} title="全自动" badge="推荐" /><Choice active={processingMode === "semi"} onClick={() => setProcessingMode("semi")} title="半自动" /><Choice active={processingMode === "direct"} onClick={() => setProcessingMode("direct")} title="直接出片" /></OptionGroup>
          <OptionGroup title="暂停确认" hint="选择流水线在哪些步骤后暂停，等你确认再继续"><Choice active={pauseMode === "none"} onClick={() => setPauseMode("none")} title="不暂停" /><Choice active={pauseMode === "critical"} onClick={() => setPauseMode("critical")} title="关键节点" badge="推荐" /><Choice active={pauseMode === "every"} onClick={() => setPauseMode("every")} title="每步确认" /><Choice active={pauseMode === "custom"} onClick={() => setPauseMode("custom")} title="自定义" /></OptionGroup>
          {pauseMode === "custom" && <div className="pause-points"><b>勾选“哪些步骤后暂停让我确认”</b>{["文案预审", "智能改写", "分句分镜", "提示词生成", "批量生图", "TTS 配音"].map((name, index) => <label key={name}><input type="checkbox" checked={pausePoints.includes(index)} onChange={e => setPausePoints(current => e.target.checked ? [...current, index] : current.filter(item => item !== index))} />Step {index} · {name}</label>)}</div>}
          <label>提示词模板<select value={promptTemplateId} onChange={e => setPromptTemplateId(e.target.value)}><option value="">跟随赛道默认</option><optgroup label="系统模板">{systemPromptTemplates.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</optgroup>{promptTemplates.length > 0 && <optgroup label="自定义模板">{promptTemplates.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</optgroup>}</select></label>
        </div>}
      </div>
      <div className="create-submit-bar"><div><b>自定义 / 其他</b><small>当前语言模型 · 预计 3–6 分钟完成</small></div><button disabled={!text.trim() || saving} onClick={() => submit(false)}>保存为草稿</button><button className="primary" disabled={!text.trim() || saving} onClick={() => submit(true)}>{saving ? <LoaderCircle className="spin" size={17} /> : <Sparkles size={17} />}开始生成 <kbd>Ctrl+Enter</kbd></button></div>
    </div>
  </section>;
}

function CreateSection({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return <section className="create-section"><header><h2>{title}</h2><span>{desc}</span></header><div className="create-section-body">{children}</div></section>;
}

function OptionGroup({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return <div className="option-group"><div className="option-label"><b>{title}</b>{hint && <small>{hint}</small>}</div><div className="choice-row">{children}</div></div>;
}

function Choice({ active, onClick, title, desc, badge }: { active: boolean; onClick: () => void; title: string; desc?: string; badge?: string }) {
  return <button type="button" className="choice-chip" data-active={active || undefined} onClick={onClick}><b>{title}</b>{badge && <em>{badge}</em>}{desc && <small>· {desc}</small>}</button>;
}

function SettingsPage({ config, onSave }: { config: AppConfig; onSave: (config: AppConfig) => void }) {
  const [draft, setDraft] = useState(config);
  const [tab, setTab] = useState<SettingsTab>("llm");
  const setSection = <K extends keyof AppConfig>(section: K, value: AppConfig[K]) =>
    setDraft({ ...draft, [section]: value });

  return <section>
    <PageHeader eyebrow="PREFERENCES" title="设置" desc="配置语言模型、外部生图、火山配音、剪映草稿与本地路径。"
      actions={<button className="primary" onClick={() => onSave(draft)}>保存设置</button>} />
    <div className="settings-grid">
      <div className="settings-nav">
        <SettingsNavButton active={tab === "llm"} onClick={() => setTab("llm")} icon={Sparkles} label="语言模型" />
        <SettingsNavButton active={tab === "image"} onClick={() => setTab("image")} icon={Image} label="图片生成" />
        <SettingsNavButton active={tab === "tts"} onClick={() => setTab("tts")} icon={Mic2} label="TTS 配音" />
        <SettingsNavButton active={tab === "output"} onClick={() => setTab("output")} icon={Clapperboard} label="视频与草稿" />
        <SettingsNavButton active={tab === "diagnostics"} onClick={() => setTab("diagnostics")} icon={CircleHelp} label="关于与诊断" />
      </div>
      <div className="settings-panel">
        {tab === "llm" && <LlmSettings draft={draft} setDraft={setDraft} />}
        {tab === "image" && <ImageSettings draft={draft} setDraft={setDraft} />}
        {tab === "tts" && <TtsSettings draft={draft} setDraft={setDraft} />}
        {tab === "output" && <OutputSettings draft={draft} setSection={setSection} />}
        {tab === "diagnostics" && <DiagnosticsPage />}
      </div>
    </div>
  </section>;
}

function SettingsNavButton({ active, onClick, icon: Icon, label }: {
  active: boolean; onClick: () => void; icon: typeof Sparkles; label: string;
}) {
  return <button className={active ? "active" : ""} onClick={onClick}><Icon size={17} />{label}<ChevronRight size={15} /></button>;
}

function PanelHeading({ icon: Icon, title, desc }: { icon: typeof Sparkles; title: string; desc: string }) {
  return <div className="panel-heading"><div className="panel-icon"><Icon size={21} /></div><div><h3>{title}</h3><p>{desc}</p></div></div>;
}

function LlmSettings({ draft, setDraft }: { draft: AppConfig; setDraft: (next: AppConfig) => void }) {
  const [testMessage, setTestMessage] = useState("");
  const [profiles, setProfiles] = useState<LlmProfile[]>([]);
  const [editing, setEditing] = useState<Partial<LlmProfile> | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const refresh = async () => setProfiles(await window.storybound.listLlmProfiles());
  useEffect(() => { refresh(); }, []);

  const startCreate = () => {
    setTestMessage("");
    setShowKey(false);
    setEditing({ name: "", provider: "custom", protocol: "openai", api_key: "", model: "", base_url: "", proxy_url: "", is_default: profiles.length ? 0 : 1 });
  };
  const activate = async (profile: LlmProfile) => {
    const active = await window.storybound.activateLlmProfile(profile.id);
    setDraft({ ...draft, llm: { ...draft.llm, provider: active.provider, protocol: active.protocol, base_url: active.base_url, api_key: active.api_key, model: active.model, proxy_url: active.proxy_url } });
    await refresh();
  };
  const save = async () => {
    if (!editing?.name?.trim()) return;
    if (!editing.api_key?.trim() || !editing.model?.trim() || !editing.base_url?.trim()) {
      setTestMessage("请填写 API Key、模型和 Base URL");
      return;
    }
    setSaving(true);
    try {
      const saved = await window.storybound.saveLlmProfile(editing as Partial<LlmProfile> & { name: string; provider: string; protocol: string });
      if (saved.is_default) {
        setDraft({ ...draft, llm: { ...draft.llm, provider: saved.provider, protocol: saved.protocol, base_url: saved.base_url, api_key: saved.api_key, model: saved.model, proxy_url: saved.proxy_url } });
      }
      setEditing(null);
      await refresh();
    } finally { setSaving(false); }
  };
  const remove = async () => {
    if (!editing?.id) return;
    const next = await window.storybound.deleteLlmProfile(editing.id);
    if (next) setDraft({ ...draft, llm: { ...draft.llm, provider: next.provider, protocol: next.protocol, base_url: next.base_url, api_key: next.api_key, model: next.model, proxy_url: next.proxy_url } });
    setEditing(null);
    await refresh();
  };

  if (editing) {
    return <div className="llm-editor-page">
      <div className="llm-editor-top">
        <button onClick={() => { setEditing(null); setTestMessage(""); }}>‹ 返回</button>
        {editing.id && <button className="delete-profile" onClick={remove}><Trash2 size={15} />删除此配置</button>}
      </div>
      <div className="llm-editor-card">
        <label className="llm-field"><span>配置名称<small>给这个配置起个好记的名字</small></span><input autoFocus value={editing.name || ""} onChange={e => setEditing({ ...editing, name: e.target.value })} placeholder="例如：Claude 中转配置" /></label>
        <div className="llm-field"><span>服务商</span><div className="provider-grid single-provider">
          <button className="selected" disabled><strong>自定义 / 其他</strong><small>OpenAI / Claude</small></button>
        </div>
          <p className="field-help">兼容 OpenAI 或 Claude 协议的直连 / 中转 API（含 OpenAI 官方、Anthropic 官方及各种中转站）</p>
        </div>
        <div className="llm-field"><span>协议<small>必选</small></span><div className="protocol-grid">
          <button className={editing.protocol === "openai" ? "selected" : ""} onClick={() => setEditing({ ...editing, protocol: "openai" })}><strong>OpenAI 兼容</strong><small>/chat/completions</small></button>
          <button className={editing.protocol === "anthropic" ? "selected" : ""} onClick={() => setEditing({ ...editing, protocol: "anthropic" })}><strong>Claude 原生</strong><small>/messages</small></button>
        </div><p className="field-help">走 OpenAI 兼容 /chat/completions 还是 Claude 原生 /messages。Claude 中转站通常选择 Claude 原生。</p></div>
        <label className="llm-field"><span>API Key<small>必填</small></span><div className="secret-input">
          <input type={showKey ? "text" : "password"} value={editing.api_key || ""} onChange={e => setEditing({ ...editing, api_key: e.target.value })} />
          <button title="显示或隐藏" onClick={() => setShowKey(value => !value)}><Eye size={16} /></button>
          <button title="复制" onClick={() => window.storybound.writeClipboard(editing.api_key || "")}><Copy size={16} /></button>
        </div><p className="field-help">仅用于本地调用，保存在本机配置中</p></label>
        <label className="llm-field"><span>模型<small>必填</small></span><input value={editing.model || ""} onChange={e => setEditing({ ...editing, model: e.target.value })} placeholder="例如 claude-opus-4-6" /></label>
        <label className="llm-field"><span>Base URL<small>必填</small></span><input value={editing.base_url || ""} onChange={e => setEditing({ ...editing, base_url: e.target.value })} placeholder="https://api.example.com/v1" /><p className="field-help">自定义 API 端点；留空使用服务商默认地址</p></label>
        <label className="llm-field"><span>代理 URL<small>可选</small></span><input value={editing.proxy_url || ""} onChange={e => setEditing({ ...editing, proxy_url: e.target.value })} placeholder="http://127.0.0.1:7890" /><p className="field-help">仅此配置生效，绘图和 TTS 不受影响。留空则直连。</p></label>
        <div className="llm-editor-actions">
          <button className="secondary" onClick={async () => {
            const candidate = { ...draft, llm: { ...draft.llm, provider: editing.provider || "custom", protocol: editing.protocol || "openai", api_key: editing.api_key || "", base_url: editing.base_url || "", model: editing.model || "", proxy_url: editing.proxy_url || "" } };
            const result = await window.storybound.testConfig("llm", candidate);
            setTestMessage(result.message);
          }}><Sparkles size={15} />测试连接</button>
          <button className="primary" disabled={saving} onClick={save}><Save size={15} />{saving ? "保存中…" : "保存配置"}</button>
        </div>
        {testMessage && <div className="connection-result">{testMessage}</div>}
      </div>
    </div>;
  }

  return <>
    <div className="llm-list-heading">
      <PanelHeading icon={Sparkles} title="LLM 配置" desc="保存多个配置，创建任务时一键切换" />
      <button className="secondary" onClick={startCreate}><Plus size={16} />新建配置</button>
    </div>
    <div className="profile-count">已保存 <strong>{profiles.length}</strong> 个配置</div>
    <div className="llm-profile-list">{profiles.map(profile => <article className={profile.is_default ? "active" : ""} key={profile.id}>
      <button className="profile-radio" onClick={() => activate(profile)} aria-label={`启用 ${profile.name}`}><i /></button>
      <div className="profile-main">
        <h3>{profile.name}{profile.is_default ? <span>使用中</span> : null}</h3>
        <p>{providerName(profile.provider)} · {profile.model || "未填写模型"} · {maskKey(profile.api_key)}</p>
      </div>
      <button className="edit-profile" onClick={() => { setEditing({ ...profile, provider: "custom", protocol: profile.protocol === "anthropic" ? "anthropic" : "openai" }); setTestMessage(""); setShowKey(false); }}><Settings size={15} />编辑</button>
      <button className="icon-btn" onClick={() => setEditing({ ...profile, provider: "custom", protocol: profile.protocol === "anthropic" ? "anthropic" : "openai" })}><MoreHorizontal size={17} /></button>
    </article>)}</div>
    <div className="llm-tip">创建任务时可在「使用模型」下拉里秒切 · 不同配置可以使用不同代理、Base URL 和 API Key</div>
  </>;
}

const providerName = (provider: string) => ({
  custom: "自定义"
}[provider] || provider);
const maskKey = (key: string) => key ? `${key.slice(0, 4)}••••${key.slice(-4)}` : "未填写 Key";

function ImageSettings({ draft, setDraft }: { draft: AppConfig; setDraft: (next: AppConfig) => void }) {
  const provider = draft.image_provider;
  const [testMessage, setTestMessage] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const ratios = ["9:16", "4:3", "1:1", "16:9"];
  const setProvider = (next: string) => setDraft({ ...draft, image_provider: next });
  const updateCustom = (patch: Partial<AppConfig["custom_image"]>) => setDraft({ ...draft, custom_image: { ...draft.custom_image, ...patch } });
  const updateModelscope = (patch: Partial<AppConfig["modelscope"]>) => setDraft({ ...draft, modelscope: { ...draft.modelscope, ...patch } });
  const updateRunningHub = (patch: Partial<AppConfig["runninghub"]>) => setDraft({ ...draft, runninghub: { ...draft.runninghub, ...patch } });
  const common = provider === "modelscope" ? draft.modelscope : provider === "runninghub" ? draft.runninghub : draft.custom_image;
  return <>
    <PanelHeading icon={Image} title="AI 绘图" desc="分镜图片生成 · 支持自定义外部生图 API、魔搭与 RunningHub" />
    <div className="image-provider-tabs">
      <button className={provider === "custom_image" ? "active" : ""} onClick={() => setProvider("custom_image")}>外部生图 API{provider === "custom_image" && <small>使用中</small>}</button>
      <button className={provider === "modelscope" ? "active" : ""} onClick={() => setProvider("modelscope")}>魔搭免费{provider === "modelscope" && <small>使用中</small>}</button>
      <button className={provider === "runninghub" ? "active" : ""} onClick={() => setProvider("runninghub")}>RunningHub{provider === "runninghub" && <small>使用中</small>}</button>
    </div>
    <div className="image-settings-card">
      {provider === "custom_image" && <>
        <div className="info-box">接入你自己的生图工具。默认兼容 OpenAI Images API，也支持异步“提交任务 → 轮询结果”接口。</div>
        <div className="form-grid">
          <label>显示名称<input value={draft.custom_image.display_name} onChange={e => updateCustom({ display_name: e.target.value })} placeholder="例如：公司生图服务" /></label>
          <label>模型<input value={draft.custom_image.model} onChange={e => updateCustom({ model: e.target.value })} /></label>
          <label className="full">Base URL<input value={draft.custom_image.base_url} onChange={e => updateCustom({ base_url: e.target.value })} placeholder="https://api.example.com/v1" /></label>
          <label className="full">API Key<input type="password" value={draft.custom_image.api_key} onChange={e => updateCustom({ api_key: e.target.value })} /></label>
          <label className="full">提交路径<input value={draft.custom_image.submit_path} onChange={e => updateCustom({ submit_path: e.target.value })} placeholder="/images/generations" /></label>
          <label className="check-label"><input type="checkbox" checked={draft.custom_image.async_mode} onChange={e => updateCustom({ async_mode: e.target.checked })} />异步任务模式</label>
          <label className="full">代理地址（可选）<input value={draft.custom_image.proxy_url} onChange={e => updateCustom({ proxy_url: e.target.value })} /></label>
        </div>
        <button className="text-action" onClick={() => setShowAdvanced(value => !value)}>{showAdvanced ? "收起高级映射" : "展开异步与字段映射"}</button>
        {showAdvanced && <div className="form-grid advanced-image-fields">
          <label className="full">状态查询路径<input value={draft.custom_image.status_path} onChange={e => updateCustom({ status_path: e.target.value })} placeholder="/tasks/{task_id}" /></label>
          <label>任务 ID 字段<input value={draft.custom_image.task_id_field} onChange={e => updateCustom({ task_id_field: e.target.value })} /></label>
          <label>状态字段<input value={draft.custom_image.status_field} onChange={e => updateCustom({ status_field: e.target.value })} /></label>
          <label>图片字段<input value={draft.custom_image.image_field} onChange={e => updateCustom({ image_field: e.target.value })} /></label>
          <label>成功状态<input value={draft.custom_image.success_values} onChange={e => updateCustom({ success_values: e.target.value })} /></label>
          <label className="full">比例映射 JSON<textarea value={draft.custom_image.ratio_mapping_json} onChange={e => updateCustom({ ratio_mapping_json: e.target.value })} placeholder={'{"9:16":"1024x1792","16:9":"1792x1024"}'} /></label>
          <label className="full">额外请求体 JSON<textarea value={draft.custom_image.extra_body_json} onChange={e => updateCustom({ extra_body_json: e.target.value })} placeholder='{"quality":"high"}' /></label>
        </div>}
      </>}
      {provider === "modelscope" && <div className="form-grid">
        <label className="full">Access Token<input type="password" value={draft.modelscope.api_key} onChange={e => updateModelscope({ api_key: e.target.value })} /></label>
        <label className="full">API 地址<input value={draft.modelscope.base_url} onChange={e => updateModelscope({ base_url: e.target.value })} /></label>
        <label className="full">模型<input value={draft.modelscope.model} onChange={e => updateModelscope({ model: e.target.value })} list="modelscope-models" /><datalist id="modelscope-models"><option value="Tongyi-MAI/Z-Image-Turbo" /><option value="Tongyi-MAI/Z-Image" /><option value="Qwen/Qwen-Image-2512" /></datalist></label>
        <label>并发数<input type="number" min={1} max={6} value={draft.modelscope.concurrency} onChange={e => updateModelscope({ concurrency: Number(e.target.value) })} /></label>
        <label>代理地址<input value={draft.modelscope.proxy_url} onChange={e => updateModelscope({ proxy_url: e.target.value })} /></label>
      </div>}
      {provider === "runninghub" && <div className="form-grid">
        <label className="full">API Key<input type="password" value={draft.runninghub.api_key} onChange={e => updateRunningHub({ api_key: e.target.value })} /></label>
        <label>Workflow ID<input value={draft.runninghub.workflow_id} onChange={e => updateRunningHub({ workflow_id: e.target.value })} /></label>
        <label>提示词节点 ID<input value={draft.runninghub.prompt_node_id} onChange={e => updateRunningHub({ prompt_node_id: e.target.value })} /></label>
        <label>提示词字段名<input value={draft.runninghub.prompt_field_name} onChange={e => updateRunningHub({ prompt_field_name: e.target.value })} /></label>
        <label>代理地址<input value={draft.runninghub.proxy_url} onChange={e => updateRunningHub({ proxy_url: e.target.value })} /></label>
        <label className="full">固定节点参数 JSON<textarea value={draft.runninghub.node_info_json} onChange={e => updateRunningHub({ node_info_json: e.target.value })} placeholder='[{"nodeId":"5","fieldName":"width","fieldValue":"1024"}]' /><small>参考图节点的 fieldValue 可填写 {"{{reference_image}}"}，生成时会自动上传并替换。</small></label>
      </div>}
      <div className="image-common-settings">
        <strong>画面比例</strong><div>{ratios.map(ratio => <button className={common.ratio === ratio ? "selected" : ""} onClick={() => provider === "modelscope" ? updateModelscope({ ratio }) : provider === "runninghub" ? updateRunningHub({ ratio }) : updateCustom({ ratio })} key={ratio}>{ratio}</button>)}</div>
        <label>并发数<input type="number" min={1} max={6} value={common.concurrency} onChange={e => provider === "modelscope" ? updateModelscope({ concurrency: Number(e.target.value) }) : provider === "runninghub" ? updateRunningHub({ concurrency: Number(e.target.value) }) : updateCustom({ concurrency: Number(e.target.value) })} /></label>
      </div>
      <div className="tts-test-row"><button onClick={async () => { try { const result = await window.storybound.testConfig("image", draft); setTestMessage(result.message); } catch (error) { setTestMessage(error instanceof Error ? error.message : String(error)); } }}><RefreshCw size={15} />测试连接</button>{testMessage && <span className={/成功|完整|可用/.test(testMessage) ? "success" : "failed"}>{testMessage}</span>}</div>
    </div>
  </>;
}

function TtsSettings({ draft, setDraft }: { draft: AppConfig; setDraft: (next: AppConfig) => void }) {
  const voices = [
    { id: "zh_female_xiaohe_uranus_bigtts", name: "小何", desc: "甜美活泼", version: "2.0" },
    { id: "zh_male_yunzhou_jupiter_bigtts", name: "云舟", desc: "清爽沉稳", version: "2.0" },
    { id: "zh_male_xiaotian_jupiter_bigtts", name: "小天", desc: "清爽磁性", version: "2.0" },
    { id: "zh_male_dayixiansheng_v2_saturn_bigtts", name: "大壹先生", desc: "沉稳叙述", version: "2.0" },
    { id: "zh_male_dongfanghaoran_moon_bigtts", name: "东方浩然", desc: "沉稳叙述", version: "1.0" },
    { id: "zh_male_jieshuonansheng_moon_bigtts", name: "悬疑解说", desc: "纪录片感", version: "1.0" },
    { id: "zh_female_wenrouxiaoya_moon_bigtts", name: "温柔小雅", desc: "治愈女声", version: "1.0" },
    { id: "zh_female_wenrou_moon_bigtts", name: "温柔妈妈", desc: "温柔", version: "1.0" }
  ];
  const [presets, setPresets] = useState<VoicePreset[]>([]);
  const [presetName, setPresetName] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [testMessage, setTestMessage] = useState("");
  const [testing, setTesting] = useState(false);
  useEffect(() => { window.storybound.listVoicePresets().then(setPresets); }, []);
  const section = draft.tts.volcengine;
  const update = (patch: Partial<AppConfig["tts"]["volcengine"]>) =>
    setDraft({ ...draft, tts: { ...draft.tts, provider: "volcengine", volcengine: { ...section, ...patch } } });
  const chooseVersion = (version: string) => {
    const firstVoice = voices.find(item => item.version === version);
    update({
      engine_version: version,
      resource_id: version === "1.0" ? "seed-tts-1.0" : "seed-tts-2.0",
      speaker: firstVoice?.id || section.speaker
    });
    setTestMessage("");
  };
  const visibleVoices = voices.filter(item => item.version === section.engine_version);
  return <>
    <PanelHeading icon={Volume2} title="TTS 配音" desc="每镜语音生成 · 仅支持火山引擎" />
    <div className="tts-card">
      <div className="tts-field"><span>引擎</span><div className="tts-engine-grid">
        <button className="selected" disabled><strong>火山引擎</strong><small>音色丰富 · 情感自然</small></button>
      </div><p>火山引擎按字符付费，支持语音合成模型 2.0 与 1.0。</p></div>
      <label className="tts-field"><span>App ID <small>必填</small></span>
        <input value={section.app_id} onChange={e => update({ app_id: e.target.value })} />
        <p>请填写火山引擎控制台中的 App ID。</p>
      </label>
      <label className="tts-field"><span>Access Token <small>必填</small></span><div className="secret-input">
        <input type={showKey ? "text" : "password"} value={section.access_key} onChange={e => update({ access_key: e.target.value })} />
        <button title="显示或隐藏" onClick={() => setShowKey(value => !value)}><Eye size={16} /></button>
        <button title="复制" onClick={() => window.storybound.writeClipboard(section.access_key)}><Copy size={16} /></button>
      </div></label>
      <div className="tts-field"><span>默认配音员</span>
        <div className="tts-version-row">
          <button className={section.engine_version === "2.0" ? "selected" : ""} onClick={() => chooseVersion("2.0")}><strong>语音合成 2.0</strong><small>情感更自然</small></button>
          <button className={section.engine_version === "1.0" ? "selected" : ""} onClick={() => chooseVersion("1.0")}><strong>语音合成 1.0</strong><small>经典音色</small></button>
          <button className="more-voices" onClick={() => setShowMore(value => !value)}>更多音色…</button>
        </div>
        <div className="tts-voice-grid">{visibleVoices.slice(0, 4).map(item =>
          <button key={item.id} className={section.speaker === item.id ? "selected" : ""} onClick={() => update({ speaker: item.id })}>
            <strong>{item.name}</strong><small>{item.desc}</small>
          </button>)}
        </div>
        <p>创建任务时以此为默认音色；收藏或自定义音色也可以直接使用。</p>
      </div>
      {showMore && <div className="tts-more-panel">
        <label>自定义音色 ID<input value={section.speaker} onChange={e => update({ speaker: e.target.value })} placeholder="从火山引擎控制台复制 Speaker ID" /></label>
        <div className="tts-preset-row">
          <select onChange={e => {
            const item = presets.find(preset => preset.id === e.target.value);
            if (item) update({ speaker: item.voice_id });
          }}><option value="">选择已收藏音色</option>{presets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
          <input value={presetName} onChange={e => setPresetName(e.target.value)} placeholder="收藏名称" />
          <button onClick={async () => {
            if (!presetName.trim() || !section.speaker.trim()) return;
            await window.storybound.saveVoicePreset({ name: presetName, provider: "volcengine", voice_id: section.speaker });
            setPresets(await window.storybound.listVoicePresets()); setPresetName("");
          }}><Save size={14} />收藏当前音色</button>
        </div>
      </div>}
      <div className="tts-test-row">
        <button disabled={testing} onClick={async () => {
          setTesting(true); setTestMessage("");
          try {
            const candidate = { ...draft, tts: { ...draft.tts, provider: "volcengine" } };
            const result = await window.storybound.testConfig("tts", candidate);
            setTestMessage(result.message);
          } catch (error) {
            setTestMessage(error instanceof Error ? error.message : String(error));
          } finally { setTesting(false); }
        }}>{testing ? <LoaderCircle size={15} className="spin" /> : <RefreshCw size={15} />}{testing ? "测试中…" : "测试连接"}</button>
        {testMessage && <span className={testMessage.startsWith("连接成功") ? "success" : "failed"}>{testMessage}</span>}
      </div>
    </div>
  </>;
}

function OutputSettings({ draft, setSection }: {
  draft: AppConfig; setSection: <K extends keyof AppConfig>(section: K, value: AppConfig[K]) => void;
}) {
  return <>
    <PanelHeading icon={FolderOpen} title="剪映" desc="任务存储 · 草稿目录 · 背景音乐" />
    <div className="output-card">
      <div className="path-setting"><span>任务存储路径<small>新任务会保存到此路径，旧任务不会自动迁移</small></span><div><input value={draft.task_storage_path} onChange={e => setSection("task_storage_path", e.target.value)} placeholder="留空则使用文档/Storybound" /><button onClick={async () => { const selected = await window.storybound.selectDirectory("选择任务存储目录"); if (selected) setSection("task_storage_path", selected); }}><FolderOpen size={15} />浏览…</button><button onClick={() => setSection("task_storage_path", "")}>恢复默认</button></div></div>
      <div className="path-setting"><span>剪映草稿目录<small>任务完成后草稿会写入此目录</small></span><div><input value={draft.jianying.draft_path} onChange={e => setSection("jianying", { draft_path: e.target.value })} /><button onClick={async () => { const selected = await window.storybound.selectDirectory("选择剪映草稿目录"); if (selected) setSection("jianying", { draft_path: selected }); }}><FolderOpen size={15} />浏览…</button></div></div>
      <div className="bgm-library"><strong>BGM 库</strong><article><Music size={23} /><div><b>内置 BGM</b><small>随应用内置</small></div><em>内置</em></article><button onClick={async () => { const item = await window.storybound.addBgm(); if (item) setSection("media", { ...draft.media, bgm_path: item.path, use_default_bgm: false }); }}>＋ 添加 BGM 文件</button><p>新建任务时可选择不同背景音乐，导入文件会复制到应用数据目录。</p></div>
    </div>
  </>;
}

function DiagnosticsPage() {
  const [result, setResult] = useState<{ checks: Array<{ name: string; ok: boolean }>; logPath: string; dataPath: string } | null>(null);
  useEffect(() => { window.storybound.runDiagnostics().then(setResult); }, []);
  return <>
    <PanelHeading icon={CircleHelp} title="关于 · 诊断" desc="配置完整性 · 目录可写 · 草稿生成器可用性" />
    <div className="diagnostic-actions"><button className="primary" onClick={async () => setResult(await window.storybound.runDiagnostics())}>重新检查</button>{result && <button onClick={() => window.storybound.writeClipboard(result.checks.map(item => `${item.ok ? "✓" : "×"} ${item.name}`).join("\n"))}><Copy size={15} />复制诊断报告</button>}<button className="danger-action" onClick={async () => { await window.storybound.clearHistory(); }}>清理历史（保留最近完成 1 条）</button></div>
    {result && <div className="diagnostics-list diagnostic-grid">
      {result.checks.map(item => <div key={item.name} className={item.ok ? "ok" : "bad"}><span>{item.ok ? "✓" : "×"}</span>{item.name}</div>)}
      <button onClick={() => window.storybound.openPath(result.dataPath)}><FolderOpen size={15} />打开应用数据目录</button>
      {result.logPath && <button onClick={() => window.storybound.showInFolder(result.logPath)}><FileText size={15} />定位运行日志</button>}
    </div>}
  </>;
}

function VoiceLab() {
  const [text, setText] = useState("");
  const [speed, setSpeed] = useState(1);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ path: string; dataUrl: string; provider: string } | null>(null);
  const [error, setError] = useState("");
  const generate = async () => {
    if (!text.trim()) return;
    setLoading(true); setError("");
    try { setResult(await window.storybound.synthesizeVoice({ text: text.trim(), speed })); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setLoading(false); }
  };
  return <section>
    <PageHeader eyebrow="VOICE LAB" title="配音实验室" desc="单独测试当前语音服务、语速和长文本分段效果。" />
    <div className="lab-layout">
      <div className="lab-form">
        <label>配音文本<textarea value={text} onChange={e => setText(e.target.value)} placeholder="输入要试听的旁白文本…" /></label>
        <label>语速<select value={speed} onChange={e => setSpeed(Number(e.target.value))}><option value={0.8}>0.8×</option><option value={1}>1.0×</option><option value={1.2}>1.2×</option><option value={1.5}>1.5×</option></select></label>
        <button className="primary wide" disabled={!text.trim() || loading} onClick={generate}>
          {loading ? <LoaderCircle className="spin" size={17} /> : <AudioLines size={17} />}生成试听
        </button>
        {error && <div className="error-box">{error}</div>}
      </div>
      <div className="voice-result">
        {result ? <>
          <div className="voice-orbit"><Mic2 size={34} /></div>
          <h3>配音生成完成</h3><p>{result.provider}</p>
          <audio controls src={result.dataUrl} />
          <button onClick={() => window.storybound.showInFolder(result.path)}><FolderOpen size={15} />定位音频文件</button>
        </> : <div className="preview-empty"><Mic2 size={35} /><p>生成后可直接试听并定位文件</p></div>}
      </div>
    </div>
  </section>;
}

function MusicMv() {
  const [title, setTitle] = useState("");
  const [audioPath, setAudioPath] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [lyrics, setLyrics] = useState("");
  const [ratio, setRatio] = useState("9:16");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ outputDir: string; videoPath: string; draftDir: string } | null>(null);
  const [error, setError] = useState("");
  const generate = async () => {
    setLoading(true); setError("");
    try { setResult(await window.storybound.generateMusicMv({ title: title || "音乐MV", audioPath, images, lyrics, ratio })); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setLoading(false); }
  };
  return <section>
    <PageHeader eyebrow="MUSIC VIDEO" title="音乐 MV" desc="选择歌曲和图片，自动生成卡点相册视频、歌词字幕与剪映草稿。" />
    <div className="music-layout">
      <div className="lab-form">
        <label>项目名称<input value={title} onChange={e => setTitle(e.target.value)} placeholder="例如：夏日旅行 MV" /></label>
        <label>画面比例<select value={ratio} onChange={e => setRatio(e.target.value)}><option>9:16</option><option>16:9</option><option>1:1</option></select></label>
        <button className="picker" onClick={async () => setAudioPath(await window.storybound.selectAudio())}><Music size={17} />{audioPath ? audioPath.split(/[\\/]/).pop() : "选择歌曲"}</button>
        <button className="picker" onClick={async () => setImages(await window.storybound.selectImages())}><Image size={17} />{images.length ? `已选择 ${images.length} 张图片` : "选择图片素材"}</button>
        <label>歌词（每行一句）<textarea value={lyrics} onChange={e => setLyrics(e.target.value)} placeholder="可选。每行歌词会自动平均分配时间。" /></label>
        <button className="primary wide" disabled={!audioPath || !images.length || loading} onClick={generate}>
          {loading ? <LoaderCircle className="spin" size={17} /> : <Clapperboard size={17} />}生成音乐 MV
        </button>
        {error && <div className="error-box">{error}</div>}
      </div>
      <div className="music-summary">
        <div><strong>{images.length}</strong><span>图片素材</span></div>
        <div><strong>{audioPath ? "1" : "0"}</strong><span>音频轨道</span></div>
        <div><strong>{lyrics.split(/\r?\n/).filter(Boolean).length}</strong><span>歌词行数</span></div>
        {result && <div className="mv-result">
          <h3>生成完成</h3>
          <button className="primary" onClick={() => window.storybound.openPath(result.videoPath)}><Play size={15} />播放视频</button>
          <button onClick={() => window.storybound.openPath(result.outputDir)}><FolderOpen size={15} />打开目录</button>
          {result.draftDir && <button onClick={() => window.storybound.openPath(result.draftDir)}><ExternalLink size={15} />剪映草稿</button>}
        </div>}
      </div>
    </div>
  </section>;
}

function ImagePlayground() {
  const styles = ["黑白摄影", "写实彩色", "油画风格", "现代电影", "古风电影", "复古胶片", "水彩治愈", "杂志插画", "皮克斯 3D", "中国水墨", "民间故事工笔", "吉卜力"];
  const ratios = ["21:9", "16:9", "3:2", "4:3", "1:1", "3:4", "2:3", "9:16"];
  const [mode, setMode] = useState<"text" | "reference" | "smart">("text");
  const [prompt, setPrompt] = useState("");
  const [selectedStyles, setSelectedStyles] = useState<string[]>([]);
  const [ratio, setRatio] = useState("9:16");
  const [resolution, setResolution] = useState("1k");
  const [referenceImagePath, setReferenceImagePath] = useState("");
  const [history, setHistory] = useState<PlaygroundJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ path: string; dataUrl: string; provider: string } | null>(null);
  const [error, setError] = useState("");
  const refreshHistory = () => window.storybound.listPlaygroundJobs().then(setHistory);
  useEffect(() => { refreshHistory(); }, []);
  const generate = async () => {
    if (!prompt.trim()) return;
    if (mode === "reference" && !referenceImagePath) { setError("图像参考模式需要先选择参考图"); return; }
    setLoading(true); setError("");
    const style = selectedStyles.join("，") + (mode === "smart" ? "，智能补全主体、环境、光线、镜头与构图细节" : "");
    try { setResult(await window.storybound.generateImage({ prompt, style, ratio, resolution, referenceImagePath: mode === "text" ? "" : referenceImagePath })); await refreshHistory(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setLoading(false); }
  };
  return <section>
    <PageHeader eyebrow="IMAGE LAB" title="画图实验室" desc="输入提示词、选择风格与比例直接出图；不写入任务历史，也不启动视频流水线。" />
    <div className="playground-panel">
      <div className="playground-modes">
        <button className={mode === "text" ? "selected" : ""} onClick={() => setMode("text")}>✍️ 文生图</button>
        <button className={mode === "reference" ? "selected" : ""} onClick={() => setMode("reference")}>🖼️ 图像参考</button>
        <button className={mode === "smart" ? "selected" : ""} onClick={() => setMode("smart")}>🪄 智能模式</button>
      </div>
      <label className="playground-prompt">提示词<textarea value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="例如：一位老者站在书房窗前，望向远方，金色阳光透过窗帘洒在脸上" /></label>
      {mode !== "text" && <button className="picker" onClick={async () => setReferenceImagePath(await window.storybound.selectImage())}><Upload size={15} />{referenceImagePath ? referenceImagePath.split(/[\\/]/).pop() : "选择图像参考"}</button>}
      <div className="playground-group"><strong>画面风格 <small>不选 = 使用原始提示词出图</small></strong><div className="chip-list">{styles.map(item =>
        <button className={selectedStyles.includes(item) ? "selected" : ""} key={item} onClick={() => setSelectedStyles(values => values.includes(item) ? values.filter(value => value !== item) : [...values, item])}>{item}</button>)}</div></div>
      <div className="playground-group"><strong>比例 <small>可多选界面；当前生成选择 {ratio}</small></strong><div className="ratio-chip-list">{ratios.map(item => <button className={ratio === item ? "selected" : ""} key={item} onClick={() => setRatio(item)}>{item}</button>)}</div></div>
      <div className="playground-group"><strong>分辨率</strong><div className="chip-list">{["1k", "2k", "4k"].map(item => <button className={resolution === item ? "selected" : ""} key={item} onClick={() => setResolution(item)}>{item.toUpperCase()}</button>)}</div></div>
      <div className="playground-generate-row"><button className="primary" disabled={!prompt.trim() || loading} onClick={generate}>
          {loading ? <LoaderCircle className="spin" size={17} /> : <Image size={17} />}生成测试图片
        </button>
        <span>当前 Provider：由“系统设置 → AI 绘图”决定</span></div>
      {error && <div className="error-box">{error}</div>}
    </div>
    <div className="lab-layout playground-results">
      <div className="lab-preview">
        {result?.dataUrl ? <><img src={result.dataUrl} /><footer><span>{result.provider}</span><button onClick={() => window.storybound.showInFolder(result.path)}><FolderOpen size={15} />定位文件</button></footer></>
          : <div className="preview-empty"><Image size={35} /><p>生成结果会显示在这里</p></div>}
      </div>
      <div className="playground-history"><h2 className="group-heading">最近生成 · {history.length}</h2>{history.map(job => <article key={job.id}>
        <div><strong>{job.prompt}</strong><span>{job.provider} · {job.ratio} · {job.resolution}</span></div>
        {job.image_path && <button onClick={() => window.storybound.openPath(job.image_path)}>查看</button>}
      </article>)}</div>
    </div>
  </section>;
}

function VisualStyles() {
  const builtins = [
    { id: "cinematic", name: "电影质感", tag: "内置", prefix: "电影级光影，叙事构图", suffix: "高细节，无文字无水印", negative_prompt: "", description: "适合人物故事与情绪叙事" },
    { id: "black-white", name: "黑白纪实", tag: "内置", prefix: "黑白纪实摄影，真实颗粒", suffix: "新闻摄影构图", negative_prompt: "彩色，卡通", description: "适合历史与人物纪实" },
    { id: "illustration", name: "叙事插画", tag: "内置", prefix: "精致叙事插画，统一角色设计", suffix: "细腻色彩", negative_prompt: "照片，水印", description: "适合故事与知识内容" }
  ];
  const [styles, setStyles] = useState<StyleRecord[]>([]);
  const [editing, setEditing] = useState<Partial<StyleRecord> | null>(null);
  const refresh = () => window.storybound.listStyles().then(setStyles);
  useEffect(() => { refresh(); }, []);
  const save = async () => {
    if (!editing?.name) return;
    await window.storybound.saveStyle(editing as Partial<StyleRecord> & { name: string });
    setEditing(null); refresh();
  };
  return <section>
    <PageHeader eyebrow="STYLE LIBRARY" title="视觉风格" desc="统一图片提示词的视觉语言与负向约束。"
      actions={<button className="primary" onClick={() => setEditing({ name: "", tag: "自定义", prefix: "", suffix: "", negative_prompt: "", description: "" })}><Plus size={16} />新增风格</button>} />
    <div className="library-grid">{[...builtins, ...styles].map(item =>
      <article className="library-card" key={item.id}>
        <div className="style-swatch" style={{ background: styleGradient(item.id) }} />
        <span>{item.tag}</span><h3>{item.name}</h3><p>{item.description}</p>
        <small>{item.prefix}</small>
        {!builtins.some(builtin => builtin.id === item.id) && <div className="library-actions">
          <button onClick={() => setEditing(item)}>编辑</button>
          <button onClick={async () => { await window.storybound.deleteStyle(item.id); refresh(); }}>删除</button>
        </div>}
      </article>)}</div>
    {editing && <EditorModal title="编辑视觉风格" onClose={() => setEditing(null)} onSave={save}>
      <label>名称<input value={editing.name || ""} onChange={e => setEditing({ ...editing, name: e.target.value })} /></label>
      <label>描述<input value={editing.description || ""} onChange={e => setEditing({ ...editing, description: e.target.value })} /></label>
      <label>提示词前缀<textarea value={editing.prefix || ""} onChange={e => setEditing({ ...editing, prefix: e.target.value })} /></label>
      <label>提示词后缀<textarea value={editing.suffix || ""} onChange={e => setEditing({ ...editing, suffix: e.target.value })} /></label>
      <label>负向提示词<textarea value={editing.negative_prompt || ""} onChange={e => setEditing({ ...editing, negative_prompt: e.target.value })} /></label>
    </EditorModal>}
  </section>;
}

function PromptTemplates() {
  const [items, setItems] = useState<PromptTemplateRecord[]>([]);
  const [editing, setEditing] = useState<Partial<PromptTemplateRecord> | null>(null);
  const [viewing, setViewing] = useState<PromptTemplateRecord | null>(null);
  const refresh = () => window.storybound.listPromptTemplates().then(setItems);
  useEffect(() => { refresh(); }, []);
  const save = async () => {
    if (!editing?.name) return;
    await window.storybound.savePromptTemplate(editing as Partial<PromptTemplateRecord> & { name: string });
    setEditing(null); refresh();
  };
  const clone = async (item: PromptTemplateRecord) => {
    await window.storybound.savePromptTemplate({
      ...item, id: undefined, name: `${item.name} - 副本`
    });
    refresh();
  };
  return <section>
    <PageHeader eyebrow="PROMPT SYSTEM" title="提示词模板" desc="模板决定 AI 如何改写文案、生成元数据和编写画面提示词。"
      actions={<><button className="secondary" onClick={async () => { await window.storybound.importPromptTemplates(); refresh(); }}><Upload size={16} />导入 JSON</button><button className="primary" onClick={() => setEditing({ name: "", base_track: "character-story", description: "", step1_rewrite_system_prompt: "", step1_metadata_system_prompt: "", step3_system_prompt: "", style_id: "cinematic", image_seed_pools_json: "[]", step3_skeleton_modules_json: "[]", reference_kind: "" })}><Plus size={16} />新建自定义模板</button></>} />
    <h2 className="group-heading">⭐ 系统模板（{systemPromptTemplates.length}）</h2>
    <div className="system-template-list">{systemPromptTemplates.map(item =>
      <article className="system-template-card" key={item.id}>
        <div><h3>{item.name}</h3><p>{item.description}</p><small>默认画风：{item.style_id} · id: {item.id}</small></div>
        <div className="template-row-actions"><button onClick={() => setViewing(item)}><Eye size={15} />查看</button><button onClick={() => clone(item)}><Copy size={15} />克隆</button></div>
      </article>)}</div>
    <h2 className="group-heading">自定义模板（{items.length}）</h2>
    {items.length ? <div className="system-template-list">{items.map(item =>
      <article className="system-template-card" key={item.id}>
        <div><h3>{item.name}</h3><p>{item.description || "暂无描述"}</p><small>{trackName(item.base_track)} · {item.style_id}</small></div>
        <div className="template-row-actions"><button onClick={() => setViewing(item)}><Eye size={15} />查看</button><button onClick={() => setEditing(item)}>编辑</button><button onClick={async () => { await window.storybound.deletePromptTemplate(item.id); refresh(); }}>删除</button></div>
      </article>)}</div> : <div className="inline-empty">还没有自定义模板，可克隆系统模板后修改。</div>}
    {editing && <EditorModal title="编辑提示词模板" onClose={() => setEditing(null)} onSave={save}>
      <label>名称<input value={editing.name || ""} onChange={e => setEditing({ ...editing, name: e.target.value })} /></label>
      <label>内容类型<select value={editing.base_track || "character-story"} onChange={e => setEditing({ ...editing, base_track: e.target.value })}>{tracks.map(track => <option key={track.id} value={track.id}>{track.name}</option>)}</select></label>
      <label>描述<input value={editing.description || ""} onChange={e => setEditing({ ...editing, description: e.target.value })} /></label>
      <label>文案重写要求<textarea value={editing.step1_rewrite_system_prompt || ""} onChange={e => setEditing({ ...editing, step1_rewrite_system_prompt: e.target.value })} /></label>
      <label>元数据提取要求<textarea value={editing.step1_metadata_system_prompt || ""} onChange={e => setEditing({ ...editing, step1_metadata_system_prompt: e.target.value })} /></label>
      <label>分镜生成要求<textarea value={editing.step3_system_prompt || ""} onChange={e => setEditing({ ...editing, step3_system_prompt: e.target.value })} /></label>
      <label>最终图片提示词模板<textarea value={editing.image_prompt_template || ""} onChange={e => setEditing({ ...editing, image_prompt_template: e.target.value })} /></label>
      <label>图片种子池 JSON<textarea value={editing.image_seed_pools_json || "[]"} onChange={e => setEditing({ ...editing, image_seed_pools_json: e.target.value })} /></label>
      <label>分镜骨架模块 JSON<textarea value={editing.step3_skeleton_modules_json || "[]"} onChange={e => setEditing({ ...editing, step3_skeleton_modules_json: e.target.value })} /></label>
      <label>参考图类型<select value={editing.reference_kind || ""} onChange={e => setEditing({ ...editing, reference_kind: e.target.value })}><option value="">自动</option><option value="character">人物</option><option value="product">产品</option></select></label>
      <label className="check-label"><input type="checkbox" checked={Boolean(editing.needs_character_card)} onChange={e => setEditing({ ...editing, needs_character_card: e.target.checked })} />提取主角档案</label>
    </EditorModal>}
    {viewing && <div className="modal-backdrop" onClick={() => setViewing(null)}><div className="template-view" onClick={e => e.stopPropagation()}>
      <button className="modal-close" onClick={() => setViewing(null)}><X size={18} /></button>
      <span>{trackName(viewing.base_track)}</span><h2>{viewing.name}</h2><p>{viewing.description}</p>
      <div className="template-config-summary">
        <div><b>默认画风</b><span>{viewing.style_id}</span></div>
        <div><b>主角档案</b><span>{viewing.needs_character_card ? "跟随赛道 / 强制提取" : "不强制"}</span></div>
        <div><b>Step 3 骨架模块</b><span>{viewing.step3_skeleton_modules_json || "[]"}</span></div>
        <div><b>参考图类型</b><span>{viewing.reference_kind || "自动"}</span></div>
        <div><b>图片种子池</b><span>{viewing.image_seed_pools_json || "[]"}</span></div>
      </div>
      <h3>文案重写要求</h3><pre>{viewing.step1_rewrite_system_prompt || "使用系统默认规则"}</pre>
      <h3>元数据提取要求</h3><pre>{viewing.step1_metadata_system_prompt || "使用系统默认规则"}</pre>
      <h3>分镜生成要求</h3><pre>{viewing.step3_system_prompt || "使用系统默认规则"}</pre>
      <h3>最终图片提示词模板</h3><pre>{viewing.image_prompt_template || "由分镜提示词直接生成"}</pre>
      <button className="primary" onClick={async () => { await clone(viewing); setViewing(null); }}>克隆为自定义模板</button>
    </div></div>}
  </section>;
}

function EditorModal({ title, children, onClose, onSave }: { title: string; children: React.ReactNode; onClose: () => void; onSave: () => void }) {
  return <div className="modal-backdrop" onClick={onClose}><div className="editor-modal" onClick={e => e.stopPropagation()}>
    <button className="modal-close" onClick={onClose}><X size={18} /></button><h2>{title}</h2>
    <div className="editor-form">{children}</div>
    <button className="primary wide" onClick={onSave}>保存</button>
  </div></div>;
}

function DraftTemplates() {
  const [templates, setTemplates] = useState<DraftTemplate[]>([]);
  const [editing, setEditing] = useState<{ id?: string; name: string; config: any } | null>(null);
  const [openSections, setOpenSections] = useState<string[]>(["canvas"]);
  const [bgmItems, setBgmItems] = useState<BgmRecord[]>([]);
  const refresh = () => window.storybound.getTemplates().then(setTemplates);
  useEffect(() => { refresh(); window.storybound.listBgm().then(setBgmItems); }, []);
  const defaultLayer = (overrides: Record<string, unknown> = {}) => ({
    visible: true, x: 0, y: 0, fontSize: 20, color: "#FFFFFF", alpha: 1,
    bold: false, underline: false, align: 1, letterSpacing: 0, lineSpacing: 0,
    border: { color: "#000000", width: 0, alpha: 0 }, ...overrides
  });
  const newConfig = () => ({
    canvas: { width: 1080, height: 1920, ratio: "9:16", backgroundColor: "#000000", backgroundImage: "" },
    image: { ratio: "9:16", fit: "cover", top: 0, height: 1, animation: "缩放", motionStrength: 1 },
    title: defaultLayer({ y: .047, fontSize: 25, color: "#FFDE00", bold: true, underline: true, border: { color: "#000000", width: 40, alpha: 1 } }),
    subtitle: defaultLayer({ y: -.216, fontSize: 12, letterSpacing: 2, lineSpacing: 4, border: { color: "#000000", width: 40, alpha: 1 } }),
    caption: { ...defaultLayer({ y: -.215, fontSize: 12, color: "#FFDE00" }), maxCharsPerLine: 12, background: { color: "#000000", alpha: .5, roundRadius: .3 } },
    disclaimer: { ...defaultLayer({ y: -.903, fontSize: 8, alpha: .26, lineSpacing: 5, border: { color: "#000000", width: 40, alpha: 1 } }), text: "图片由AI生成与网络下载\n科普视频，无不良引导" },
    audio: { narrationVolume: 10, bgmVolume: 3, bgmFadeOutMs: 2000, defaultBgmId: "" }
  });
  const editTemplate = (template?: DraftTemplate) => {
    setOpenSections(["canvas"]);
    if (!template) return setEditing({ name: "", config: newConfig() });
    const config = { ...newConfig(), ...JSON.parse(template.config) };
    setEditing({ id: template.id, name: template.name, config });
  };
  const save = async () => {
    if (!editing?.name) return;
    await window.storybound.saveDraftTemplate({
      id: editing.id, name: editing.name,
      config: JSON.stringify(editing.config)
    });
    setEditing(null); refresh();
  };
  const setConfig = (section: string, patch: Record<string, unknown>) => setEditing(current => current ? ({
    ...current, config: { ...current.config, [section]: { ...current.config[section], ...patch } }
  }) : current);
  const toggleSection = (id: string) => setOpenSections(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
  return <section>
    <PageHeader eyebrow="DRAFT SYSTEM" title="草稿模板" desc="控制画布比例、标题、字幕、背景和音量。"
      actions={<button className="primary" onClick={() => editTemplate()}><Plus size={16} />新建草稿模板</button>} />
    <div className="template-grid">{templates.map(template => {
      const config = JSON.parse(template.config);
      return <article className="template-card" key={template.id}>
        <div className={`template-preview ${["16:9", "4:3"].includes(config.canvas.ratio) ? "landscape" : ""}`} style={{ backgroundColor: config.canvas.backgroundColor }}>
          {config.title?.visible !== false && <span className="mock-title" style={{ color: config.title?.color }}>标题</span>}
          {config.caption?.visible !== false && <span className="mock-caption" style={{ color: config.caption?.color }}>字幕</span>}
          {config.subtitle?.visible !== false && <span className="mock-subtitle">副标题</span>}
          {config.disclaimer?.visible !== false && <span className="mock-disclaimer">免责</span>}
        </div>
        <div><h3>{template.name}</h3><p>{config.canvas.width} × {config.canvas.height} · {config.canvas.ratio}</p></div>
        <div className="library-actions"><button onClick={() => editTemplate(template)}>编辑</button><button onClick={() => { editTemplate(template); setTimeout(() => setEditing(current => current ? { ...current, id: undefined, name: `${template.name} (副本)` } : current), 0); }}>复制</button>{!template.is_default && <button onClick={async () => { await window.storybound.deleteDraftTemplate(template.id); refresh(); }}>删除</button>}</div>
      </article>;
    })}</div>
    {editing && <div className="modal-backdrop"><div className="draft-editor-modal">
      <header><input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} placeholder="模板名称" /><div><button onClick={() => setEditing(null)}>取消</button><button className="primary" onClick={save}>保存</button></div></header>
      <div className="draft-editor-layout">
        <DraftCanvasPreview config={editing.config} />
        <div className="draft-controls">
          <DraftAccordion title="画布设置" open={openSections.includes("canvas")} onToggle={() => toggleSection("canvas")}>
            <span className="control-label">比例</span><div className="ratio-buttons">{["9:16", "3:4", "1:1", "4:3", "16:9"].map(ratio => <button data-active={editing.config.canvas.ratio === ratio || undefined} onClick={() => {
              const [rw, rh] = ratio.split(":").map(Number); const landscape = rw > rh;
              setConfig("canvas", { ratio, width: landscape ? 1920 : 1080, height: landscape ? 1080 : ratio === "1:1" ? 1080 : 1920 });
            }} key={ratio}>{ratio}</button>)}</div>
            <div className="dimension-line"><input type="number" value={editing.config.canvas.width} onChange={e => setConfig("canvas", { width: Number(e.target.value) })} /><span>×</span><input type="number" value={editing.config.canvas.height} onChange={e => setConfig("canvas", { height: Number(e.target.value) })} /></div>
            <ColorControl label="底色" value={editing.config.canvas.backgroundColor} onChange={value => setConfig("canvas", { backgroundColor: value })} />
            <label>背景图<div className="inline-picker"><input value={editing.config.canvas.backgroundImage || ""} onChange={e => setConfig("canvas", { backgroundImage: e.target.value })} placeholder="留空 = 无背景图" /><button onClick={async () => setConfig("canvas", { backgroundImage: await window.storybound.selectImage() })}>浏览</button></div></label>
          </DraftAccordion>
          <DraftAccordion title="图片区域" open={openSections.includes("image")} onToggle={() => toggleSection("image")}>
            <label>出图比例<select value={editing.config.image.ratio} onChange={e => setConfig("image", { ratio: e.target.value })}><option>9:16</option><option>3:4</option><option>1:1</option><option>4:3</option><option>16:9</option></select></label>
            <label>填充方式<select value={editing.config.image.fit || "cover"} onChange={e => setConfig("image", { fit: e.target.value })}><option value="cover">裁切铺满</option><option value="contain">完整显示</option></select></label>
            <RangeControl label="垂直位置" value={editing.config.image.top} min={0} max={1} step={.01} onChange={value => setConfig("image", { top: value })} />
            <RangeControl label="高度占比" value={editing.config.image.height} min={.1} max={1} step={.01} onChange={value => setConfig("image", { height: value })} />
            <label>图片动画<select value={editing.config.image.animation || "缩放"} onChange={e => setConfig("image", { animation: e.target.value })}><option>缩放</option><option>向左缩小</option><option>向右缩小</option><option>无</option></select></label>
          </DraftAccordion>
          <TextLayerEditor title="主标题" section="title" canvasHeight={editing.config.canvas.height} config={editing.config.title} open={openSections.includes("title")} onToggle={() => toggleSection("title")} onChange={patch => setConfig("title", patch)} />
          <TextLayerEditor title="副标题" section="subtitle" canvasHeight={editing.config.canvas.height} config={editing.config.subtitle} open={openSections.includes("subtitle")} onToggle={() => toggleSection("subtitle")} onChange={patch => setConfig("subtitle", patch)} />
          <TextLayerEditor title="字幕" section="caption" canvasHeight={editing.config.canvas.height} config={editing.config.caption} open={openSections.includes("caption")} onToggle={() => toggleSection("caption")} onChange={patch => setConfig("caption", patch)} caption />
          <TextLayerEditor title="免责声明" section="disclaimer" canvasHeight={editing.config.canvas.height} config={editing.config.disclaimer} open={openSections.includes("disclaimer")} onToggle={() => toggleSection("disclaimer")} onChange={patch => setConfig("disclaimer", patch)} disclaimer />
          <DraftAccordion title="音频设置" open={openSections.includes("audio")} onToggle={() => toggleSection("audio")}>
            <RangeControl label="配音音量" suffix="dB" value={20 * Math.log10(Math.max(.316, editing.config.audio.narrationVolume || 1))} min={-10} max={20} step={.5} onChange={value => setConfig("audio", { narrationVolume: Math.pow(10, value / 20) })} />
            <RangeControl label="BGM 音量" suffix="dB" value={20 * Math.log10(Math.max(.316, editing.config.audio.bgmVolume || 1))} min={-10} max={20} step={.5} onChange={value => setConfig("audio", { bgmVolume: Math.pow(10, value / 20) })} />
            <label>BGM 淡出(ms)<input type="number" min={0} max={10000} step={100} value={editing.config.audio.bgmFadeOutMs} onChange={e => setConfig("audio", { bgmFadeOutMs: Number(e.target.value) })} /></label>
            <label>默认 BGM<select value={editing.config.audio.defaultBgmId || ""} onChange={e => setConfig("audio", { defaultBgmId: e.target.value })}><option value="">不指定 · 用新建任务当前选择</option>{bgmItems.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          </DraftAccordion>
        </div>
      </div>
    </div></div>}
  </section>;
}

function DraftCanvasPreview({ config }: { config: any }) {
  const landscape = Number(config.canvas.width) > Number(config.canvas.height);
  const layerStyle = (layer: any): React.CSSProperties => ({
    display: layer?.visible === false ? "none" : undefined,
    top: `${50 - Number(layer?.y || 0) * 48}%`, color: layer?.color,
    opacity: layer?.alpha ?? 1, fontSize: `${Math.max(7, Number(layer?.fontSize || 12) * .42)}px`,
    fontWeight: layer?.bold ? 800 : 400, textDecoration: layer?.underline ? "underline" : "none",
    WebkitTextStroke: `${Math.max(0, Number(layer?.border?.width || 0) / 20)}px ${layer?.border?.color || "transparent"}`
  });
  return <div className="draft-preview-pane"><div className={`draft-live-canvas ${landscape ? "landscape" : ""}`} style={{ backgroundColor: config.canvas.backgroundColor, backgroundImage: config.canvas.backgroundImage ? `url("${config.canvas.backgroundImage}")` : undefined }}>
    <div className="draft-image-area" style={{ top: `${Number(config.image.top || 0) * 100}%`, height: `${Number(config.image.height || 1) * 100}%` }}>图片区域</div>
    <span className="preview-layer" style={layerStyle(config.title)}>主标题示例</span>
    <span className="preview-layer" style={layerStyle(config.subtitle)}>副标题示例文字</span>
    <span className="preview-layer caption" style={{ ...layerStyle(config.caption), background: config.caption?.background ? `${config.caption.background.color}${Math.round((config.caption.background.alpha || 0) * 255).toString(16).padStart(2, "0")}` : undefined }}>字幕示例文字</span>
    <span className="preview-layer disclaimer" style={layerStyle(config.disclaimer)}>{config.disclaimer?.text || "免责声明"}</span>
  </div><p>{config.canvas.ratio} · {config.canvas.width}×{config.canvas.height}</p></div>;
}

function DraftAccordion({ title, open, onToggle, children }: { title: string; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return <div className="draft-accordion"><button className="draft-accordion-head" onClick={onToggle}><ChevronRight className={open ? "open" : ""} size={15} />{title}</button>{open && <div className="draft-accordion-body">{children}</div>}</div>;
}

function RangeControl({ label, value, min, max, step, suffix = "", onChange }: { label: string; value: number; min: number; max: number; step: number; suffix?: string; onChange: (value: number) => void }) {
  return <label className="range-control"><span>{label}<b>{Number(value).toFixed(step < 1 ? 2 : 0)}{suffix}</b></span><input type="range" value={value} min={min} max={max} step={step} onChange={e => onChange(Number(e.target.value))} /></label>;
}

function ColorControl({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label>{label}<div className="color-control"><input type="color" value={value} onChange={e => onChange(e.target.value.toUpperCase())} /><input value={value} onChange={e => onChange(e.target.value)} /></div></label>;
}

function TextLayerEditor({ title, config, canvasHeight, open, onToggle, onChange, caption = false, disclaimer = false }: {
  title: string; section: string; config: any; canvasHeight: number; open: boolean; onToggle: () => void;
  onChange: (patch: Record<string, unknown>) => void; caption?: boolean; disclaimer?: boolean;
}) {
  const setBorder = (patch: Record<string, unknown>) => onChange({ border: { ...(config.border || {}), ...patch } });
  const setBackground = (patch: Record<string, unknown>) => onChange({ background: { ...(config.background || {}), ...patch } });
  return <DraftAccordion title={title} open={open} onToggle={onToggle}>
    <label className="toggle-line"><span>显示</span><input type="checkbox" checked={config.visible !== false} onChange={e => onChange({ visible: e.target.checked })} /></label>
    <label>垂直位置<input type="number" step={1} value={Math.round(Number(config.y || 0) * canvasHeight)} onChange={e => onChange({ y: Number(e.target.value) / canvasHeight })} /></label>
    <label>字号<input type="number" min={4} max={100} value={config.fontSize} onChange={e => onChange({ fontSize: Number(e.target.value) })} /></label>
    <ColorControl label="颜色" value={config.color} onChange={color => onChange({ color })} />
    <RangeControl label="透明度" suffix="%" value={Math.round((config.alpha ?? 1) * 100)} min={0} max={100} step={1} onChange={value => onChange({ alpha: value / 100 })} />
    {!caption && !disclaimer && <div className="check-row"><label><input type="checkbox" checked={Boolean(config.bold)} onChange={e => onChange({ bold: e.target.checked })} />粗体</label><label><input type="checkbox" checked={Boolean(config.underline)} onChange={e => onChange({ underline: e.target.checked })} />下划线</label></div>}
    {(title === "副标题") && <div className="number-pair"><label>字间距<input type="number" min={0} max={20} value={config.letterSpacing || 0} onChange={e => onChange({ letterSpacing: Number(e.target.value) })} /></label><label>行间距<input type="number" min={0} max={20} value={config.lineSpacing || 0} onChange={e => onChange({ lineSpacing: Number(e.target.value) })} /></label></div>}
    <ColorControl label="描边色" value={config.border?.color || "#000000"} onChange={color => setBorder({ color })} />
    <RangeControl label="描边宽度" value={config.border?.width || 0} min={0} max={100} step={1} onChange={value => setBorder({ width: value })} />
    <RangeControl label="描边透明" suffix="%" value={Math.round((config.border?.alpha || 0) * 100)} min={0} max={100} step={1} onChange={value => setBorder({ alpha: value / 100 })} />
    {caption && <><label>每行字数<input type="number" min={4} max={30} value={config.maxCharsPerLine || 12} onChange={e => onChange({ maxCharsPerLine: Number(e.target.value) })} /></label><ColorControl label="背景色" value={config.background?.color || "#000000"} onChange={color => setBackground({ color })} /><RangeControl label="背景透明" suffix="%" value={Math.round((config.background?.alpha || 0) * 100)} min={0} max={100} step={1} onChange={value => setBackground({ alpha: value / 100 })} /><RangeControl label="圆角" value={config.background?.roundRadius || 0} min={0} max={1} step={.01} onChange={value => setBackground({ roundRadius: value })} /></>}
    {disclaimer && <label>文案内容<textarea value={config.text || ""} onChange={e => onChange({ text: e.target.value })} /></label>}
  </DraftAccordion>;
}

const statusText = (status: TaskStatus) => ({ pending: "待处理", running: "进行中", review: "待确认脚本", completed: "已完成", failed: "失败", cancelled: "已取消" }[status]);
const trackName = (track: string) => tracks.find(item => item.id === track)?.name || track;
const styleGradient = (id: string) => {
  const hue = [...id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 360;
  return `linear-gradient(145deg,hsl(${hue} 48% 38%),hsl(${(hue + 55) % 360} 50% 16%))`;
};
