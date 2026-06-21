# 文本大模型视觉规划功能说明

## 功能目标

文本大模型不负责真正生成图片，而是把原始文案转换成图片接口可以直接使用的结构化数据：

```text
原始文案
→ 文案处理
→ 主角/产品档案
→ 分镜
→ desc_prompt
→ use_reference
→ images/generations 或 images/edits
```

## 三阶段请求

### Step 1：文案处理

全自动模式调用大模型，输出：

```json
{
  "title": "视频标题",
  "summary": "摘要",
  "narration": "完整旁白"
}
```

半自动模式跳过改写，完整保留用户原文；但仍会继续执行 Step 2 和 Step 3。

### Step 2：元数据提取

输出主角档案、产品档案、年代地点、关键物件、事实清单和一致性规则。主角档案中的 `stable_prompt` 会注入所有真正出现主角的分镜提示词。

### Step 3：分镜和参考图判断

每个分镜输出：

```json
{
  "index": 1,
  "narration": "本镜旁白",
  "visual": "简洁画面说明",
  "desc_prompt": "主体、动作、环境、镜头和光线",
  "use_reference": true,
  "reference_reason": "主角清晰出现",
  "subject_presence": "character",
  "era_and_location": "1930年代上海",
  "duration_hint": 5
}
```

程序随后根据提示词模板合成最终 `image_prompt`。

## 参考图路由

- `use_reference=true` 且已上传参考图：调用 `/images/edits`。
- `use_reference=false`：调用 `/images/generations`。
- 未上传参考图：无论模型返回什么，都会强制按 `false` 处理。
- 模板参考图类型为 `none`：所有镜头强制不用参考图。
- 任务工作台可人工覆盖每镜的判断。

## 提示词模板配置

进入 `提示词模板` 页面，可以设置：

- 主角档案：跟随赛道、强制提取、强制跳过。
- Step 3 模块：跨年代、防台词文字、人物一致性、产品一致性。
- 参考图类型：禁用、自动、人物、产品/菜品。
- `use_reference` 判断标准。
- 文案重写要求、元数据提取要求、分镜生成要求。
- 最终图片提示词模板。

图片模板支持变量：

```text
{character_card}
{product_card}
{era_and_location}
{visual_action}
{ratio}
```

## 查看实际请求

生成脚本后，打开任务详情，点击 `查看模型请求日志`。日志位于：

```text
任务输出目录/llm-debug
```

日志包含完整 system/user 提示词、模型原始响应和解析后的 JSON，但不会保存 Authorization 或 API Key。

## 调用次数和费用

- 全自动：通常 3 次文本模型请求。
- 半自动：通常 2 次文本模型请求，因为跳过文案改写。
- 直接出片：0 次文本模型请求。

图片和配音接口费用另行计算。
