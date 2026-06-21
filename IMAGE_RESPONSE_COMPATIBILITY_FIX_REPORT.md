# Storybound 0.8.0：图片接口返回结构兼容修复

## 本次错误的含义

错误发生在 `saveImageResponse()`，而不是内容审核阶段：

```text
图片接口未返回可识别的图片地址或 Base64 数据
```

这表示图片接口已经返回了 HTTP 成功响应，并且响应内容也能解析成 JSON，但图片数据不在旧程序只支持的这些位置中：

- `data[0].b64_json`
- `data[0].base64`
- `data[0].url`
- `data[0].fileUrl`
- `output.images[0]`

因此，这次不需要继续修改镜头提示词。更可能是中转站返回了非标准字段、额外包装层，或者返回了异步任务 ID。

## 0.8.0 修改

### 1. 自动识别更多图片返回格式

新增递归图片数据解析，兼容：

- `b64_json`、`base64`、`b64`
- `image`、`image_base64`、`imageData`
- `url`、`image_url`、`imageUrl`
- `fileUrl`、`file_url`
- `output_url`、`download_url`
- `data.images[0]`
- `result.images[0]`
- `response.data[0]`
- `output[0].content[0]`
- Chat Completions 返回文本中的 Markdown 图片地址
- Data URL、普通 Base64、URL-safe Base64
- 相对地址和协议相对地址

### 2. 自动识别异步任务响应

如果同步模式下接口只返回 `id`、`task_id` 或 `taskId`，程序会提示：

```text
图片接口返回了任务 ID，但当前配置为同步模式
```

而不是继续报“没有图片数据”。

### 3. 保存原始响应调试文件

如果仍然无法识别，程序会把脱敏后的响应保存到：

```text
任务产物目录/image-debug/镜头编号-response.json
```

调试文件会隐藏：

- API Key、Token、Authorization
- 图片 Base64 正文
- 常见签名 URL 参数

### 4. 验证下载结果

图片 URL 下载完成后，会检查文件头是否确实为 PNG、JPEG、WebP、GIF、BMP、ICO、AVIF 或 HEIC，避免把 HTML 错误页当成图片保存。

### 5. 参考图接口同步修复

`/images/edits` 返回结构也使用同一套兼容解析和调试日志。

## 用户操作

更新到 0.8.0 后：

1. 不要修改旁白。
2. 不需要继续修改已经安全化的图片提示词。
3. 打开原任务，点击镜头 09 的“重做画面”。
4. 如果仍失败，查看错误信息中给出的 `image-debug/09-response.json`。

## 本地验证

已通过：

- OpenAI 兼容图片生成与参考图编辑测试
- `data[0].image` Base64 格式测试
- `result.images[0].image_url` 格式测试
- Chat Completions Markdown 图片地址测试
- 仅返回异步任务 ID 的错误识别测试
- 图片提示词预检测试
- LLM JSON 修复测试
