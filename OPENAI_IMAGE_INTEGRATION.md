# OpenAI 兼容生图接口集成说明（Storybound Rebuild 0.7.2）

## 已接入接口

### 文生图

- 请求方式：`POST`
- 默认地址：`{Base URL}/images/generations`
- 请求格式：`application/json`
- 字段：`model`、`prompt`、`size`、`quality`、`n`
- 文生图默认不发送 `response_format`，与用户提供的调用示例一致

### 参考图编辑

- 请求方式：`POST`
- 默认地址：`{Base URL}/images/edits`
- 请求格式：`multipart/form-data`
- 字段：`model`、`prompt`、`size`、`quality`、`response_format`、`image`
- 默认 `response_format=b64_json`
- 后端已支持一张或多张参考图；当前创建页选择器仍以一张主角参考图为主

## 页面配置位置

进入：

`设置 → 图片生成 → OpenAI 兼容接口`

填写：

```text
Base URL: https://dm-fox.rjj.cc/codex/v1
API Key: 你自己的 Key
模型: gpt-image-2
文生图路径: /images/generations
参考图编辑路径: /images/edits
图片质量: high
文生图返回格式: 不传（按接口默认）
参考图返回格式: b64_json
```

Base URL 也兼容直接粘贴完整地址：

```text
https://dm-fox.rjj.cc/codex/v1/images/generations
```

程序在调用参考图编辑时会自动把末尾切换为 `/images/edits`。

## 自动调用规则

- 没有参考图：调用 `/images/generations`
- 已上传参考图：调用 `/images/edits`
- 返回 `b64_json`：直接解码并保存为图片
- 返回 URL：自动下载并保存
- 单张生成失败：任务日志会显示接口返回的错误信息

## API Key 保存位置

Key 不写进项目源码。点击“保存设置”后，由 Electron 保存到当前 Windows 用户的 Storybound 应用数据目录中的 `config.json`。

注意：当前是本机明文配置文件，适合个人电脑使用。不要把自己的配置文件一起发给别人。

## 测试

设置页中的“测试生图（会消耗额度）”会实际调用一次文生图接口，因此会产生一次接口消耗。

项目自带不消耗真实额度的本地 Mock 测试：

```powershell
npm install
npm run test:openai-image
```

本次已经通过：

- Bearer API Key 鉴权
- JSON 文生图请求
- multipart 参考图编辑请求
- `gpt-image-2`
- `quality=high`
- 横图 `1536x1024`
- Base64 图片保存
- 完整 generations 地址自动切换 edits 地址
- 测试生图流程

由于没有用户的真实 API Key，没有对中转站进行真实扣费调用。

## 0.7.3 逐镜参考图路由

上传参考图后，不再默认让所有分镜都调用 `/images/edits`。

文本大模型会为每个分镜生成：

- `use_reference`
- `reference_reason`
- `subject_presence`

只有 `use_reference=true` 的分镜会携带参考图调用编辑接口。环境空镜、建筑、器物或不需要身份一致性的镜头仍调用 `/images/generations`。任务工作台可以手动覆盖该判断。
