# Storybound 0.8.4 图片同步请求修复说明

## 已确认的接口行为

使用与中转站文档一致的 Python 请求测试后，接口返回 HTTP 200，并直接在 `data[0].url` 中返回 PNG 地址，图片可以正常下载。

因此该接口当前应按同步接口使用，不应继续查询旧的 `response.poll_url`。

## 本次修改

1. 点击“重做画面”时，始终清除该镜头的旧 `image_remote_task_id` 和旧轮询调试记录，重新提交新的 POST 请求。
2. 不再从历史 `*-download.json` 恢复已经失效的 `poll_url`。
3. 文生图 `response_format` 的缺省值由 `b64_json` 改为 `auto`，即默认不发送该字段，与中转站官方示例保持一致。
4. 新增 `image-debug/<镜头号>-submit.json`，记录实际请求地址、请求体和脱敏后的接口响应，便于核对程序是否真的发送了官方格式。
5. 保持异步轮询支持，仅当一次全新的请求实际返回 `poll_url` 时才进入轮询。

## 推荐设置

- Base URL：`https://dm-fox.rjj.cc/codex/v1`
- 提交路径：`/images/generations`
- 模型：`gpt-image-2`
- 异步模式：关闭
- 文生图返回格式：不传（按接口默认）
- 审核灵敏度：不传
- 额外请求 JSON：留空
- quality：high

## 重做画面后的验证

查看：

`任务目录/image-debug/9-submit.json`

请求体应只包含：`model`、`prompt`、`n`、`size`、`quality`。正常响应应包含 `data[0].url`。
