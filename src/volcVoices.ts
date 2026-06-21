export interface VolcVoiceOption {
  id: string;
  name: string;
  desc: string;
  version: "1.0" | "2.0";
  previewUrl?: string;
  previewLabel?: string;
}

/**
 * 火山引擎音色目录。
 * previewUrl 只保存火山引擎官网公开可试听的样音地址；正式合成仍使用用户自己的 App ID / Access Token。
 */
export const VOLC_VOICES: VolcVoiceOption[] = [
  {
    id: "zh_male_dongfanghaoran_uranus_bigtts",
    name: "东方浩然",
    desc: "沉稳叙述",
    version: "2.0",
    previewLabel: "官方样音",
    previewUrl: "https://lf3-static.bytednsdoc.com/obj/eden-cn/lm_hz_ihsph/ljhwZthlaukjlkulzlp/portal/bigtts/zh_male_dongfanghaoran_uranus_bigtts.mp3"
  },
  { id: "zh_female_xiaohe_uranus_bigtts", name: "小何", desc: "甜美活泼", version: "2.0" },
  { id: "zh_male_yunzhou_jupiter_bigtts", name: "云舟", desc: "清爽沉稳", version: "2.0" },
  { id: "zh_male_xiaotian_jupiter_bigtts", name: "小天", desc: "清爽磁性", version: "2.0" },
  { id: "zh_male_dayixiansheng_v2_saturn_bigtts", name: "大壹先生", desc: "沉稳叙述", version: "2.0" },
  {
    id: "zh_male_qingcang_mars_bigtts",
    name: "擎苍",
    desc: "有声阅读",
    version: "1.0",
    previewLabel: "官方样音",
    previewUrl: "https://lf3-static.bytednsdoc.com/obj/eden-cn/lm_hz_ihsph/ljhwZthlaukjlkulzlp/console/bigtts/zh_male_qingcang_mars_bigtts.mp3"
  },
  { id: "zh_male_dongfanghaoran_moon_bigtts", name: "东方浩然", desc: "经典沉稳", version: "1.0" },
  { id: "zh_male_jieshuonansheng_moon_bigtts", name: "悬疑解说", desc: "纪录片感", version: "1.0" },
  { id: "zh_female_wenrouxiaoya_moon_bigtts", name: "温柔小雅", desc: "治愈女声", version: "1.0" },
  { id: "zh_female_wenrou_moon_bigtts", name: "温柔妈妈", desc: "温柔", version: "1.0" }
];

export const DEFAULT_VOLC_VOICE_ID = VOLC_VOICES[0].id;
