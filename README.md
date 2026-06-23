# Storybound Rebuild 0.9.1

一个基于 Electron、React、TypeScript 和 SQLite 的本地 AI 视频创作工作台。本版本重点重做了“开始创作”与动态分镜流程。



## 0.9.1 原版火山音色库与本地试听缓存

- 恢复原版的 185 个火山音色和 6 个分类，支持语音合成 1.0 / 2.0、搜索、收藏和选用。
- “开始创作 → 配音”和“设置 → TTS 配音”都可以打开完整音色库并试听。
- 试听文本与原版一致：`他来到江南一个小村庄`。
- 原版并没有把 185 段 MP3 全部打包进安装程序：第一次试听需要已经配置的火山 App ID / Access Token；成功后音频写入本机缓存，之后相同音色、语速和文本可直接播放。
- 本机缓存目录由 Electron 写入应用数据目录下的 `voice-preview-cache/v2`，关闭或重启程序后仍然保留。
- Windows 本机系统音色仍然是完全离线的，可在配音实验室或 TTS 设置中生成试听，不需要火山凭证。

## 0.9.0 原版创建页差异修正

- 以用户提供的 `source(4).zip` 为唯一代码基线，不替换或回退既有动画、字幕、提示词和接口功能。
- 在“开始创作 → 出图 → 画面风格”加入 12 种原版悬浮预览图；图片来自本次提供的 1.7.0 安装包资源，保持 400×711 原始尺寸。
- 产品类赛道改为显示“产品参考图 · 可选”，人物类赛道继续使用主角参考图/系统九宫格人物卡。
- 新增产品参考图独立数据库字段，并按每个镜头的 `subject_presence` 将人物图、产品图或两者发送给图片接口。
- 兼容旧产品任务：过去保存在 `reference_image_path` 的产品参考图仍可继续使用。
- 选中草稿模板后锁定 AI 出图比例，避免界面显示已跟随模板但仍能误改比例。
- 修正侧栏“画图实验室”名称及底部版本号硬编码。
- 参考图编辑提示改为同时适配人物、产品、书籍、菜品和关键物件，不再只要求保持人物身份。
- 新增 `npm run test:style-previews`、`npm run test:references` 和 `npm run test:parity`。

详细差异与安全应用方法见 [`FEATURE_PARITY_NOTES.md`](./FEATURE_PARITY_NOTES.md)。

## 0.8.9 赛道提示词与发布文案

- 从提示词表格接入人物故事、健康图书、文化科普、绘本故事、电商带货、心灵鸡汤、民间故事、通用故事、美食探店 9 个赛道。
- 保留原提示词的叙事结构、合规边界、人物/产品一致性、年代准确性与画面多样性要求。
- 自动隔离旧提示词中的“纯文本输出”和 `id/cap/desc_prompt` 旧 JSON，统一适配本项目三阶段 JSON 协议。
- 元数据阶段新增发布内容：主标题、副标题、视频简介、标签和种子评论。
- 任务工作台新增“发布文案结果”卡片；产物目录新增 `publish-metadata.json` 与 `publish-copy.txt`。
- 剪映草稿与最终 MP4 优先使用生成的正式主标题和副标题，不再只拿工作摘要充当副标题。
- 新增 `npm run test:prompts`，验证全部赛道提示词与运行时协议适配。


## 0.8.8 剪映风格动画引擎

- 图片动画从 `zoompan + floor/trunc` 整数裁剪改为逐帧浮点透视矩阵。
- 使用 cubic 插值和连续缓入缓出，解决强度变化后停顿、跳像素和高频抖动。
- 左拉镜、右拉镜、缩放、缩放 II、旋转、回弹等 19 种效果统一使用一套参数系统。
- 强度只改变运动幅度，不再因阈值切换渲染算法。
- 限制 FFmpeg 编码线程，降低 1080×1920 合成时的峰值内存占用。
- 草稿模板预览动画与 FFmpeg 成片参数同步。
- 新增 `npm run test:motion`，离线验证全部动画均可正常编码。

验证命令：

```powershell
npm run test:motion
npm run test:dynamic
npm run build
```

## 主要功能

- 粘贴文案或按关键词研究后创建任务
- 故事旁白、双人播客两种形态
- 全自动、半自动、直接出片三种处理模式
- 目标字数、目标分镜数、视角、改写强度和推广内容控制
- AI 图片、网络素材、参考图、视觉风格和草稿模板
- RunningHub 官方图片模型与可选自定义 Workflow
- RunningHub 图生视频动态分镜；单镜失败自动退回图片运镜
- 火山引擎 TTS；开发环境可使用 Windows SAPI
- FFmpeg 分镜合成、字幕、BGM、封面海报和剪映草稿接口
- SQLite 任务记录、暂停确认、断点复用和失败恢复




## 0.7.4 断点续跑与停电恢复

本版本把任务执行状态从“整条任务结束后保存”改为按阶段、按分镜实时保存：

- 软件启动时会把上次遗留的 `running` 任务自动标记为 `interrupted（已中断）`。
- 任务卡片和详情页新增“从断点继续”。
- 文案改写、元数据提取、分镜规划分别保存带输入指纹的缓存；输入未变化时不会重复调用大模型。
- 图片、配音、动态视频和逐镜渲染片段分别保存完成状态、失败原因、重试次数和远程任务 ID。
- RunningHub 及异步自定义图片接口会优先查询上次的远程任务，不直接重复提交。
- `pipeline.json` 和重要中间文件改为原子写入，降低突然断电造成文件损坏的概率。
- 已完成的分镜片段会被复用；最终 FFmpeg 拼接中断时只重新执行最后拼接。
- 批量队列顺序写入 SQLite，重启后可点击“恢复上次队列”。
- 新增 `npm run test:checkpoint`，模拟处理中断后继续，并验证已完成素材不被重做。

完整说明见：[`CHECKPOINT_RECOVERY.md`](./CHECKPOINT_RECOVERY.md)。

验证命令：

```powershell
npm run build
npm run test:llm-planner
npm run test:reference-routing
npm run test:openai-image
npm run test:dynamic
npm run test:checkpoint
```

需要注意：同步图片接口在服务端已处理、但电脑尚未收到响应时突然断电，能否避免重复扣费还取决于服务商是否支持幂等请求标识。

## 0.7.3 文本大模型视觉规划层

本版本补齐了“原始文案 → 可直接生图的结构化分镜”流程。全自动和半自动模式现在会执行三阶段大模型请求：

1. **Step 1 文案处理**：改写或保留原文，输出标题、摘要和完整旁白。
2. **Step 2 元数据提取**：提取主角档案、产品/关键物件档案、年代地域、不可改动事实和跨镜头一致性规则。
3. **Step 3 分镜规划**：输出每镜旁白、画面描述、`desc_prompt`、最终 `image_prompt`、`use_reference`、判断原因和主体类型。

关键变化：

- 参考图不再无差别传给所有分镜，只有 `use_reference=true` 的镜头才调用 `/images/edits`；其他镜头调用 `/images/generations`。
- 任务工作台可逐镜查看并手动修改“是否使用参考图”。修改后旧图片会自动失效，避免错误复用。
- 提示词模板新增“主角档案模式”：跟随赛道、强制提取、强制跳过。
- 提示词模板新增可视化 Step 3 模块：跨年代、防台词文字、人物一致性、产品一致性。
- 提示词模板新增参考图类型和 `use_reference` 判断标准。
- 系统模板会自动回退到当前内容赛道，即使创建任务时没有显式选择模板也能生效。
- 每次模型调用都会在任务目录的 `llm-debug` 中保存请求、原始响应和解析结果；不记录 API Key。
- OpenAI 兼容模型不支持 `response_format=json_object` 时会自动重试普通 JSON 提示方式。

模型请求日志示例：

```text
任务目录/llm-debug/
├─ 01-rewrite-request.json
├─ 01-rewrite-response.txt
├─ 01-rewrite-parsed.json
├─ 02-metadata-request.json
├─ 02-metadata-response.txt
├─ 02-metadata-parsed.json
├─ 03-scenes-request.json
├─ 03-scenes-response.txt
├─ 03-scenes-parsed.json
└─ 00-planner-result.json
```

直接出片模式仍然不调用大模型，使用本地机械分句和保守的参考图关键词判断。

验证命令：

```powershell
npm run test:llm-planner
npm run test:reference-routing
npm run test:script-modes
npm run test:openai-image
npm run build
```

## 0.7.2 OpenAI 兼容图片接口

已按用户提供的 OpenAI Images API 形式完成接入：

- 文生图：`POST /images/generations`，JSON 请求体
- 参考图编辑：`POST /images/edits`，`multipart/form-data` 请求体
- 默认模型：`gpt-image-2`
- 默认质量：`high`
- 文生图默认不传 `response_format`；参考图编辑默认使用 `b64_json`，也支持 URL 返回
- 支持自定义 Base URL、API Key、模型、生成路径、编辑路径、质量、比例映射、代理和额外参数
- 没有参考图时自动调用 generations；有参考图时自动调用 edits
- Base URL 既可填写到 `/v1`，也可直接粘贴完整 `/images/generations` 地址
- “测试生图”会真实请求一次接口，因此会消耗少量接口额度

在软件中进入：`设置 → 图片生成 → OpenAI 兼容接口`，填写自己的 API Key 后保存。Key 只写入当前电脑的应用配置，不包含在源码中。

默认示例：

```text
Base URL: https://dm-fox.rjj.cc/codex/v1
模型: gpt-image-2
文生图路径: /images/generations
参考图编辑路径: /images/edits
质量: high
文生图返回格式: 不传（接口默认）
参考图返回格式: b64_json
```

验证命令：

```powershell
npm run test:openai-image
```

## 0.7.1 界面修复

- 修复“开始创作”中各功能区宽度不一致、卡片忽宽忽窄的问题
- 改为与目标程序一致的单张主卡片结构，文案、出图、封面、配音按分隔线排列
- 去掉遮挡内容的悬浮底栏，保存和开始生成按钮回到底部正常文档流
- 修复全局 `section` 样式误作用于内部组件导致的居中收缩问题
- 页面标题、区块图标、间距与最大宽度重新统一

## 开发运行

```powershell
npm install
npm run dev
```

## 构建前检查

项目源码可以直接执行前端构建：

```powershell
npm run build
```

要生成具备完整本地视频和剪映草稿能力的 Windows 安装包，请把你有权分发的运行资源放入：

- `resources/bin/ffmpeg.exe`
- `resources/draft-generator.exe`
- `resources/default-bgm.mp3`

随后执行：

```powershell
npm run dist
```

未放置 FFmpeg 时，程序会尝试调用系统 PATH 中的 `ffmpeg`。未放置草稿生成器时，MP4 仍会生成，但剪映草稿步骤会写入 `draft-error.txt`。

## RunningHub

在“设置 → 图片生成”里填写 API Key，可选择：

- 全能图片 G-2.0
- 全能图片 X
- 全能图片 V2

`Workflow ID` 留空时使用官方模型；填写后使用自定义工作流。动态分镜始终通过图生视频接口处理，并自动使用兜底模型。

## 兼容迁移

启动时会自动迁移旧任务值：

- `semi` → `semi_auto`
- `title` → `titled`
- `blank` → `plain`

## 0.7.5 本机默认语音

本版本新增 Windows 本机系统语音作为默认测试配音：无需 Key、无需联网，可在“设置 → TTS 配音”中选择音色并直接生成试听。详细说明见 `SYSTEM_TTS.md`。

### 火山音色试听说明

0.9.1 已改为与原版一致的完整音色选择与试听流程。公开样音链接不再作为主要方案；第一次试听使用用户自己的火山 TTS 配置生成并缓存，后续本地秒播。
