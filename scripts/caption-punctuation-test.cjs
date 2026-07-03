const assert = require("node:assert/strict");
const { _captionTest } = require("../electron/media.cjs");

const chunks = _captionTest.splitCaptionChunks(
  "你真的决定了吗？是的！我会继续走下去，直到抵达终点。",
  8,
  1
);

assert.ok(chunks.length >= 3);
assert.ok(chunks.every(item => item.length <= 8), "单行字幕不得超过设定字数");
assert.deepEqual(
  chunks,
  chunks.map(item => item.replace(/[，。！？；：、!?;:]/gu, "").replace(/(?<!\d)[.,]|[.,](?!\d)/gu, "")),
  "成片字幕不应包含标点符号"
);

const schedule = _captionTest.captionSchedule("你好，世界！继续前进。", 4, 8, 1);
assert.equal(schedule[0].start, 0);
assert.equal(schedule.at(-1).end, 4);
assert.ok(schedule.every(item => !/[，。！？；：、!?;:]|(?<!\d)[.,]|[.,](?!\d)/u.test(item.text)));
assert.ok(schedule.every(item => !/[\r\n]/u.test(item.text)), "每条字幕必须保持单行");

assert.deepEqual(
  _captionTest.splitCaptionChunks("他来了，我走了。", 20, 1),
  ["他来了", "我走了"],
  "逗号也必须作为字幕分隔符，不能因为字幕未超长就合并"
);

assert.deepEqual(
  _captionTest.splitCaptionChunks("数据从2.1涨到5.8w，后来达到1,200个样本。", 14, 1),
  ["数据从2.1涨到5.8w", "后来达到1,200个样本"],
  "数字内部的小数点和千位分隔符必须保留"
);

assert.deepEqual(
  _captionTest.splitCaptionChunks("偏偏跑到中国的战场上钻破庙", 12, 1),
  ["偏偏跑到中国的战场上", "钻破庙"],
  "应在方位短语“战场上”之后断句，不能拆开后面的动词短语"
);

const bethune = _captionTest.splitCaptionChunks(
  "他叫诺尔曼·白求恩，三十多岁就已经是北美赫赫有名的胸外科专家，凭他的医术和地位，完全可以过着优渥体面的日子。",
  12,
  1
);
assert.ok(bethune.some(item => item.includes("诺尔曼·白求恩")), "姓名中的间隔点必须保留");
assert.ok(bethune.every(item => !/[，。！？；：,.!?;:]/u.test(item)), "普通显示标点应删除");

assert.deepEqual(
  _captionTest.splitCaptionChunks(
    "他做了一个让所有人都不理解的决定带着一支医疗队奔赴前线",
    12,
    1
  ),
  ["他做了一个", "让所有人都不理解的决定", "带着一支医疗队奔赴前线"],
  "应在新分句和新动作前断开，不能拆开“理解”或粘连“决定带着”"
);

assert.deepEqual(
  _captionTest.sceneCaptionSchedule({
    duration: 3,
    caption_segments: ["诺尔曼·白求恩", "来到中国"],
    caption_timings: [
      { text: "诺尔曼·白求恩", start: 0, end: 1.75 },
      { text: "来到中国", start: 1.75, end: 3 }
    ]
  }, 12),
  [
    { text: "诺尔曼·白求恩", start: 0, end: 1.75 },
    { text: "来到中国", start: 1.75, end: 3 }
  ],
  "字幕必须直接使用分段配音产生的真实时间轴"
);

console.log("Caption punctuation removal and timing test passed");
