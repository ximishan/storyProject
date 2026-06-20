# Storybound Rebuild

Storybound 的可维护功能级复刻版本。应用默认可以完全离线运行，也可以接入云端语言模型、图片和语音服务。

## 已实现

- 创作任务创建、搜索、运行、失败重试和产物查看
- SQLite 本地数据库与 JSON 设置
- 本地规则或 Anthropic/OpenAI 兼容文案改写与结构化分镜
- 本地占位画面、OpenAI Images、ModelScope 和自定义兼容图片接口
- Windows 系统语音、火山引擎和 MiniMax TTS
- 分镜音频、SRT 字幕、动态画面与硬字幕 MP4
- 背景音乐混音与淡出
- 剪映草稿生成和指定草稿目录输出
- 图片实验室
- 自定义视觉风格
- 自定义提示词模板
- 三种内置草稿画布模板

## 开发运行

```powershell
npm install
npm run dev
```

## 构建

```powershell
npm run build
npm run dist
```

安装包会包含 FFmpeg、剪映草稿生成器和默认背景音乐，不依赖用户额外安装这些组件。

## 默认离线配置

- 文案：本地规则模式
- 图片：本地渐变占位图
- 配音：Windows 系统语音
- 输出：MP4、SRT、脚本 JSON 和剪映草稿

要获得正式 AI 图片，只需在设置中选择图片服务并填写 API Key。
