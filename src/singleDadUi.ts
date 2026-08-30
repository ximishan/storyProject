const SINGLE_DAD_STYLE_ID = "single-dad-picturebook";

function textOf(element: Element | null) {
  return String(element?.textContent || "").replace(/\s+/g, " ").trim();
}

function optionGroupTitle(group: Element) {
  return textOf(group.querySelector(":scope > .option-label b"));
}

function sectionTitle(section: Element) {
  return textOf(section.querySelector(":scope > header h2"));
}

function setText(element: HTMLElement | null, value: string) {
  if (element && element.textContent !== value) element.textContent = value;
}

function setVisible(element: HTMLElement | null, visible: boolean) {
  if (!element) return;
  const next = visible ? "" : "none";
  if (element.style.display !== next) element.style.display = next;
}

function findOptionGroup(root: HTMLElement, title: string) {
  return Array.from(root.querySelectorAll<HTMLElement>(".option-group"))
    .find(group => optionGroupTitle(group) === title);
}

function chooseOption(root: HTMLElement, groupTitle: string, optionText: string) {
  const group = findOptionGroup(root, groupTitle);
  if (!group) return;
  const button = Array.from(group.querySelectorAll<HTMLButtonElement>("button"))
    .find(item => textOf(item).startsWith(optionText));
  if (button && !button.hasAttribute("data-active")) button.click();
}

function ensureModeNote(root: HTMLElement, enabled: boolean) {
  let note = root.querySelector<HTMLElement>(".single-dad-mode-note");
  if (!enabled) {
    note?.remove();
    return;
  }
  if (note) return;
  note = document.createElement("div");
  note.className = "single-dad-mode-note";
  note.innerHTML = "<b>父女日常图文模式</b><span>只生成故事、分镜和连续图片；配音、BGM、动态视频、MP4、封面和剪映草稿已自动关闭。</span>";
  Object.assign(note.style, {
    display: "flex",
    gap: "12px",
    alignItems: "center",
    padding: "12px 16px",
    margin: "0 0 14px",
    border: "1px solid rgba(46, 211, 154, .35)",
    borderRadius: "12px",
    background: "rgba(21, 125, 91, .12)",
    color: "#d8fff1",
    fontSize: "13px"
  });
  const span = note.querySelector("span");
  if (span instanceof HTMLElement) span.style.color = "#9db7ad";
  const homeCreate = root.querySelector<HTMLElement>(".home-create");
  homeCreate?.prepend(note);
}

function applySingleDadUi() {
  const root = document.querySelector<HTMLElement>(".create-page-root");
  if (!root) return;

  const activeStyle = root.querySelector(
    `.style-choice-wrap[data-style-id="${SINGLE_DAD_STYLE_ID}"] .choice-chip[data-active]`
  );
  const enabled = Boolean(activeStyle);
  root.dataset.singleDadMode = enabled ? "true" : "false";

  // 这两项必须同步到 React 状态，而不只是隐藏 UI：
  // 否则旧的“播客”校验或“全自动”提交路径仍可能在点击生成时生效。
  if (enabled) {
    chooseOption(root, "视频形态", "旁白视频");
    chooseOption(root, "处理模式", "半自动");
  }

  const headingTitle = root.querySelector<HTMLElement>(".create-page-heading h1");
  const headingDesc = root.querySelector<HTMLElement>(".create-page-heading p");
  setText(headingTitle, enabled ? "创建父女日常图文" : "创建视频任务");
  setText(headingDesc, enabled
    ? "记录一件真实小事，生成故事、分镜和连续图片"
    : "粘贴一段人物故事，几分钟后在剪映里打开");

  const textarea = root.querySelector<HTMLTextAreaElement>(".script-field textarea");
  const placeholder = enabled
    ? "写下今天真实发生的一件小事、几句对话或大概经过。AI 会整理成父女日常故事并拆成连续图片。"
    : "粘贴一段人物故事原始文案，AI 会自动改写为口播版、拆分分镜、配图配音。";
  if (textarea && textarea.placeholder !== placeholder) textarea.placeholder = placeholder;

  const hiddenGroupTitles = new Set([
    "视频形态",
    "内容赛道",
    "改写强度",
    "素材来源",
    "动态分镜",
    "时长",
    "人物一致性"
  ]);

  root.querySelectorAll<HTMLElement>(".option-group").forEach(group => {
    const title = optionGroupTitle(group);
    setVisible(group, !enabled || !hiddenGroupTitles.has(title));

    if (title === "草稿模板" || title === "图片比例预设") {
      const label = group.querySelector<HTMLElement>(":scope > .option-label b");
      setText(label, enabled ? "图片比例预设" : "草稿模板");
    }
  });

  root.querySelectorAll<HTMLElement>(".create-section").forEach(section => {
    const title = sectionTitle(section);
    const hide = enabled && (title === "配音" || title === "封面海报");
    setVisible(section, !hide);
  });

  root.querySelectorAll<HTMLElement>(".reference-row").forEach(row => setVisible(row, !enabled));
  setVisible(root.querySelector<HTMLElement>(".advanced-block"), !enabled);
  ensureModeNote(root, enabled);
}

export function installSingleDadUiAdapter() {
  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      applySingleDadUi();
    });
  };

  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["data-active"]
  });
  schedule();
  return () => observer.disconnect();
}
