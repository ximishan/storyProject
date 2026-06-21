# 首次运行 Invalid JSON 修复说明

## 结论

本次失败发生在文本大模型请求阶段，不是剪映草稿、图片生成或配音阶段。

调用栈中的 `callModelJson (...:275)` 对应 Claude 原生协议分支，即程序当时按 `/v1/messages` 发送请求。服务端返回了 HTTP 错误 JSON，其中错误信息是：

`Invalid JSON in request body`

原代码生成的 JSON 字符串本身使用 `JSON.stringify`，语法上不会因为中文文案而失效。更可能的问题是：

1. 当前中转接口实际使用 OpenAI 兼容 `/chat/completions`，但配置选择了 Claude 原生 `/messages`；
2. 中转站对 Claude 原生请求字段支持不完整，例如不接受 `temperature` 或顶层 `system`；
3. “测试连接”和正式生成使用了两套不同的请求代码，导致测试结果不能真实代表流水线请求。

## 已修改文件

- `electron/llm-planner.cjs`
  - Claude 原生请求默认不再发送 `temperature`。
  - Claude 原生遇到 400 且提示请求体/system 不兼容时，自动使用最小请求体重试一次。
  - 增加协议错误提示，明确告诉用户应该选择 OpenAI 兼容还是 Claude 原生。
  - 增加实际请求体和错误响应日志。
  - 增加真实模型连接测试方法。

- `electron/services.cjs`
  - 设置页“测试连接”改为复用正式流水线请求逻辑，不再使用另一套简化请求。

- `electron/main.cjs`
  - 更新 Electron `console-message` 监听方式，消除弃用警告。

- `src/App.tsx`
  - 修正协议选择说明。不能因为模型名称是 Claude 就默认选择 Claude 原生，必须按中转站文档的接口路径选择。

- `scripts/llm-protocol-test.cjs`
  - 新增 Claude 原生协议兼容性回归测试。

## 配置方式

### 中转站文档提供 `/v1/chat/completions`

- 协议：`OpenAI 兼容`
- Base URL：通常填写到 `/v1`
- 不要选择 Claude 原生，即使模型名称中包含 Claude

### 中转站文档提供 `/v1/messages`

- 协议：`Claude 原生`
- Base URL：填写服务商给出的根地址或 `/v1` 地址

## 新增调试日志

任务目录的 `llm-debug` 中会新增：

- `01-rewrite-request-body.json`
- `01-rewrite-request-body-fallback.json`（发生兼容回退时）
- `01-rewrite-error-response-first.txt`
- `01-rewrite-error-response-final.txt`

后续元数据和分镜阶段也会生成同类文件。

## 已执行测试

- `node scripts/llm-planner-test.cjs`：通过
- `node scripts/llm-protocol-test.cjs`：通过
- 三个修改后的 Electron 主进程 JavaScript 文件语法检查：通过

完整 `npm ci / npm run build` 未在当前沙箱完成，因为沙箱无法联网下载 `better-sqlite3` 的预编译文件和 Node 头文件。请在 Windows 项目目录执行：

```bash
npm install
npm run build
npm run dev
```
