# 0.7.7 模型返回 JSON 格式错误修复说明

## 本次错误与上一次不同

上一次错误：

`Invalid JSON in request body`

表示发送给中转接口的请求体或协议不兼容。

本次错误：

`Expected ',' or '}' after property value in JSON at position 344`

表示接口已经成功返回内容，但模型生成的正文不是严格合法的 JSON。当前调用栈已经进入 `cleanJsonText -> JSON.parse`，说明请求协议问题已越过。

最常见原因是模型在 `narration` 等字符串中直接输出了未转义的英文双引号，例如：

```text
{"narration":"他说："努力吧！"然后走了。"}
```

其中“努力吧”外面的英文双引号必须写成 `\"`，否则 JSON 会在该位置中断。原始文案中包含人物原话时，部分模型或中转站即使收到“只返回 JSON”的要求，仍可能产生这种格式。

## 已完成修改

### `electron/llm-planner.cjs`

1. 强化三阶段系统提示词：
   - 引用原话优先使用中文引号“”；
   - 禁止在 JSON 字符串中直接插入未转义英文双引号。

2. 扩展本地 JSON 容错修复：
   - 自动去除 Markdown 代码块；
   - 自动提取正文中的 JSON 对象或数组；
   - 修复字符串中的未转义英文双引号；
   - 修复字符串中的真实换行、回车和制表符；
   - 清理尾逗号；
   - 兼容部分单引号 JSON、Python 布尔值和全角 JSON 标点；
   - 修复失败时记录错误位置及附近内容。

3. 增加一次性模型修复机制：
   - 本地仍无法修复时，自动调用同一模型进行一次“只修 JSON 格式”的请求；
   - 仅允许重试一次，避免无限循环；
   - 修复成功后继续原流水线，不需要用户重新创建任务。

4. 新增调试文件：
   - `<阶段>-json-parse-error.json`
   - `<阶段>-json-repair-request.json`
   - `<阶段>-json-repair-response.txt`
   - `<阶段>-repaired.json`

### 版本与测试

- 项目版本更新为 `0.7.7`。
- 新增 `scripts/llm-json-repair-test.cjs`。
- 新增命令：`npm run test:llm-json-repair`。

## 已通过测试

- `node --check electron/llm-planner.cjs`
- `node scripts/llm-planner-test.cjs`
- `node scripts/llm-protocol-test.cjs`
- `node scripts/llm-json-repair-test.cjs`

## Windows 使用步骤

建议不要只复制单个文件，直接用 0.7.7 完整项目覆盖旧项目，保留你原来的数据库、任务产物和本地配置文件备份。

进入项目目录后执行：

```powershell
npm install
npm run dev
```

测试前可删除本次失败任务产物目录中的旧检查点，或者新建一个任务再次测试。旧任务如果没有生成 `01-rewrite-checkpoint.json`，通常可以直接重新运行。

若仍失败，请打开该任务产物目录下的 `llm-debug`，重点查看：

- `01-rewrite-response.txt`
- `01-rewrite-json-parse-error.json`
- `01-rewrite-json-repair-response.txt`

