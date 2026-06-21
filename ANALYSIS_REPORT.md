# Storybound 1.7.0 静态分析与本地源码完善报告

分析日期：2026-06-20  
分析方式：仅静态解包、资源提取、字符串与前端代码分析；**没有运行未知安装包**。

## 1. 样本信息

| 文件 | SHA-256 |
|---|---|
| Storybound_1.7.0_x64-setup(1).exe | `f3c043a603413ee850f09ca530871a2659ae388e54d848557df56596372e2e59` |
| source(1).zip | `8c35c2bdd693be1d0d0cccb1698a53f538de88d5ac4f62ef59bfadf424e4d317` |
| 安装后的 storybound.exe | `fcf18bee51cdfb323571705f5a82dcd0a8f78251ad2bf9091f33dd2090ec991f` |
| 安装后的 draft-generator.exe | `5a8b3f9d38ca4112df2b60c0a9650066f813417b17424a7007cbf71194d0c63d` |

安装器为 NSIS。解包后主要包含：

- `storybound.exe`：58,127,872 字节
- `draft-generator.exe`：77,053,175 字节
- `resources/default-bgm.mp3`

## 2. 目标程序技术结构

### 主程序

目标主程序是 Tauri/Rust + WebView 前端结构，不是 Electron。前端资源以内嵌 Brotli 资源形式放在主程序中。

静态识别到的原生命令包括：

- 外部路径放行与程序启动
- 密钥保存、读取和删除
- 硬件指纹、许可证验证
- GPT 图片提交、编辑、轮询和测试
- 通用 HTTP 请求与下载
- 更新检查与应用更新
- 外部 sidecar 启动

### 剪映草稿 sidecar

`draft-generator.exe` 是 PyInstaller 打包的 Python sidecar，包含 PIL 等图像处理组件，负责接收任务 JSON 并生成剪映草稿相关文件。

本项目没有复制该第三方二进制，也没有复制目标程序的授权、更新、服务器地址或密钥存储实现。

## 3. 目标程序“开始创作”功能

静态提取出的创建页包含以下主要能力：

1. 粘贴文案或 AI 研究创作
2. 故事旁白、双人播客
3. 全自动、半自动、直接出片
4. 目标字数和目标分镜数
5. 改写强度、叙事视角、推广内容处理
6. AI 图片或网络素材
7. 视觉风格、草稿模板、图片比例
8. 主角参考图
9. 封面关闭、带标题、无标题
10. 配音、语速、背景音乐
11. 暂停确认节点
12. 动态分镜：关闭、前 3 张、全部、自定义数量
13. 动态视频时长：跟随配音或固定 6–30 秒
14. 图生视频失败时回退到静态图片
15. 双人播客半自动/直接模式要求每行以 `[A]` 或 `[B]` 开头

## 4. RunningHub 接口结构

目标 1.7.0 内嵌前端使用 RunningHub V2：

- 查询：`/openapi/v2/query`
- 上传：`/openapi/v2/media/upload/binary`
- 主图生视频：`/openapi/v2/rhart-video-g/image-to-video`
- 兜底图生视频：`/openapi/v2/rhart-video/ltx-2.3/image-to-video`

主模型支持约 6–30 秒，兜底模型支持约 5–20 秒。比例不支持时会选择最接近的可用比例。

图片模型包含：

- `rh-image-g2`
- `rh-image-x`
- `rh-image-v2`

这些接口已按目标 1.7.0 的客户端结构实现，但没有使用真实 API Key 做在线扣费测试，因此以后若平台调整接口，仍需根据最新文档修改。

## 5. 原源码主要问题

原源码已有 Electron + React + TypeScript + SQLite 的完整骨架，但存在以下关键差距：

| 项目 | 原状态 | 本次处理 |
|---|---|---|
| 动态分镜 | 只是加快静态图片缩放运镜 | 改为真实图生视频，失败自动图片兜底 |
| 处理模式 | `semi` 与目标值不一致 | 统一为 `semi_auto`，保留旧数据迁移 |
| 双人播客格式 | 没有逐行强校验 | 每个非空行必须以 `[A]`/`[B]` 开头 |
| RunningHub 图片 | 仅支持旧 Workflow | 支持 3 个官方模型，Workflow 变为可选 |
| 封面模式 | `title/blank` | 统一为 `titled/plain`，旧值自动迁移 |
| 封面比例 | 跟随视频比例 | 独立输出 3:4 发布封面 |
| 暂停处理 | 直接运行时可能把暂停结果误标完成 | 正确进入“待确认”状态 |
| 替换图片 | 旧动态视频可能继续复用 | 替换/重做图片后清空旧动态视频 |
| 剪映输入 | 没有动态视频路径 | JSON 中增加图片和动态视频路径 |
| 任务复制 | 漏掉研究来源字段，布尔值有偏差 | 已修复 |
| 安装包资源 | ZIP 中缺少 FFmpeg、sidecar、BGM、图标 | 改为可选资源目录，缺失时不影响前端构建 |

## 6. 本次修改内容

### 创建页

- 重做“开始创作”字段联动
- 保存草稿与立即生成分离
- 文案不足 50 字时允许保存但禁止开始生成
- 增加目标字数/分镜平均提示
- 动态分镜只在 AI 素材、故事模式显示
- 动态时长支持跟随配音和固定秒数
- 参考图支持选择、更换和移除
- 自动、半自动、直接出片会正确跳过不适用步骤
- 暂停节点会根据处理模式禁用

### 文案与播客

- 直接出片使用机械分句，不调用语言模型改写
- 半自动保留原文，只生成分镜和视觉描述
- 双人播客严格解析 `[A]`、`[B]`
- 说话人映射和音色 ID 保存在每个分镜中

### 图片与动态视频

- RunningHub 官方图片模型
- 参考图上传和图生图
- RunningHub 图生视频主模型 + 兜底模型
- 单镜失败记录 `video_error`
- 失败时继续使用静态图片运镜合成
- 已生成动态视频会断点复用
- FFmpeg 会把动态素材自动拉伸/压缩到对应配音时长

### 数据与兼容

启动时自动迁移：

- `semi` → `semi_auto`
- `title` → `titled`
- `blank` → `plain`

## 7. 已完成验证

| 验证项 | 结果 |
|---|---|
| TypeScript + Vite 生产构建 | 通过 |
| 所有 Electron/测试 CJS 文件语法检查 | 通过 |
| 双人播客逐行标签校验 | 通过 |
| 半自动保留原文 | 通过 |
| RunningHub 官方图片请求结构（模拟） | 通过 |
| RunningHub 图生视频请求与下载（模拟） | 通过 |
| 4:3 自动映射到视频模型最接近的 3:2 | 通过 |
| 动态视频替换静态图进行 FFmpeg 合成 | 通过 |
| 2 秒动态视频匹配 4 秒配音 | 通过，成片约 4.03 秒 |
| 动态测试脚本 | `npm run test:dynamic` 通过 |
| 脚本模式测试 | `npm run test:script-modes` 通过 |

## 8. 尚未完成或无法在当前环境验证

1. 没有真实 RunningHub API Key，因此没有进行真实扣费生成。
2. 当前 Linux 沙箱中的 `better-sqlite3` 原生绑定编译超时，数据库迁移逻辑完成了静态检查，但未在此沙箱执行完整 SQLite 测试。
3. 用户源码 ZIP 没有 `ffmpeg.exe`、`draft-generator.exe` 和默认 BGM，因此没有制作完整 Windows 安装包。
4. 没有复制目标软件的授权、账号、更新和安全密钥模块。
5. IMA 数据源仍处于禁用状态。
6. 目标程序的“运行中批次追加”等服务端能力尚未实现。

## 9. 需要自行补充的合法资源

把有权分发的文件放到：

- `resources/bin/ffmpeg.exe`
- `resources/draft-generator.exe`
- `resources/default-bgm.mp3`

然后执行：

```powershell
npm install
npm run build
npm run test:script-modes
npm run test:dynamic
npm run dist
```

## 10. 安全边界

本次工作仅用于理解功能结构并完善用户自己的源码。没有绕过许可证、伪造授权、提取密钥、修改目标程序或提供破解方案。


## 11. 0.7.2 OpenAI 兼容图片接口补充

本版本新增并验证了用户提供的 OpenAI Images API 对接方式：

- `/images/generations`：使用 JSON 发送 `model`、`prompt`、`size`、`quality`、`n` 和可选 `response_format`。
- `/images/edits`：使用 multipart 表单发送模型、提示词、尺寸、质量、返回格式和一张或多张参考图。
- 支持接口返回 `data[0].b64_json`、`data[0].url`、data URL，以及常见自定义字段。
- 设置页可填写 Base URL、API Key、模型、路径、质量、返回格式、代理和额外参数。
- API Key 不写入项目源码，仅由 Electron 写入用户本机的 `config.json`。
- 新增本地 Mock 测试，已确认文生图、参考图编辑、Bearer 鉴权、完整 generations URL 自动切换 edits URL、Base64 落盘和测试生图流程。

由于用户未提供真实 API Key，本次没有对第三方中转站进行实际扣费调用。

## 12. 0.7.3 文本大模型规划层补充

本版本进一步补齐了目标软件中“提示词模板 + 大语言模型”的核心作用，不再只用一次模型请求同时完成所有工作。

新增流程：

1. 文案改写或保留原文。
2. 提取主角档案、产品档案、年代地点、事实和一致性规则。
3. 生成分镜、`desc_prompt`、最终图片提示词与逐镜 `use_reference`。
4. 只有标记为使用参考图的镜头才调用图片编辑接口，其他镜头走普通文生图。

新增模板字段：

- `character_card_mode`
- `reference_decision_prompt`
- 可视化 `step3_skeleton_modules_json`

新增任务产物：

- `llm-debug/01-rewrite-*`
- `llm-debug/02-metadata-*`
- `llm-debug/03-scenes-*`
- `llm-debug/00-planner-result.json`

这些日志不包含 API Key，可用于核对软件实际发送给大模型的提示词和返回内容。

验证结果：

- 三阶段 OpenAI 兼容请求 Mock 测试通过。
- 主角档案注入最终图片提示词通过。
- 人物镜头 `use_reference=true`、环境空镜 `false` 路由测试通过。
- 提示词模板 SQLite 新字段和 INSERT 结构通过 Python SQLite 验证。
- TypeScript + Vite 生产构建通过。
- OpenAI 兼容图片 generations/edits 测试继续通过。


## 13. 0.7.4 断点续跑与停电恢复

本版本新增了正式的任务检查点机制：

- 启动时自动将遗留的 `running` 任务转换为 `interrupted`。
- 在开始执行前立即持久化 `output_dir`，避免停电后数据库找不到任务目录。
- 每个大模型阶段使用输入指纹缓存，恢复时只复用输入完全一致的结果。
- 每个分镜独立保存图片、配音、动态视频和渲染片段的状态、失败信息、重试次数及远程任务 ID。
- RunningHub 图片和视频任务、异步自定义图片任务可根据已保存的远程任务 ID 继续轮询。
- 重要 JSON 使用临时文件加替换的原子写入策略。
- 任务队列顺序和批次 ID 写入 SQLite，软件重启后可恢复队列。
- 新增前端“已中断”“从断点继续”“恢复上次队列”和检查点状态显示。
- 新增 `scripts/checkpoint-recovery-test.cjs`。测试模拟图片阶段中断后继续，验证已完成图片不重做、缺失图片自动补齐。

已通过：

- `npm run build`
- `npm run test:script-modes`
- `npm run test:llm-planner`
- `npm run test:reference-routing`
- `npm run test:openai-image`
- `npm run test:dynamic`
- `npm run test:checkpoint`

环境限制：

- `npm run test:workflow` 在当前 Linux 沙箱中停在 Windows SAPI 调用，因为没有 `powershell.exe`，不能据此判断 Windows 配音失败。
- 没有真实第三方 API Key，所以异步远程任务恢复仍需在用户本机实际验证。
- 对同步 OpenAI 兼容接口已发送稳定幂等请求标识，但服务商不支持幂等时，极端断电窗口仍可能造成重复计费。
