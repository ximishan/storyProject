export type VolcVoiceVersion = "1.0" | "2.0";

export interface VolcVoiceOption {
  id: string;
  name: string;
  tag: string;
  desc: string;
  category: string;
  version: VolcVoiceVersion;
}

export interface VolcVoiceCategory { id: string; name: string; hint: string; }

export function inferVolcVoiceVersion(id: string): VolcVoiceVersion {
  return /_uranus_bigtts$|^saturn_/.test(id) ? "2.0" : "1.0";
}

export const VOLC_VOICE_CATEGORIES: VolcVoiceCategory[] = [
  {
    "id": "narration",
    "name": "视频配音",
    "hint": "解说 / 旁白 / 纪实，最适合人物故事"
  },
  {
    "id": "male",
    "name": "通用男声",
    "hint": "日常对白质感的男声"
  },
  {
    "id": "female",
    "name": "通用女声",
    "hint": "日常对白质感的女声"
  },
  {
    "id": "role",
    "name": "角色扮演",
    "hint": "戏剧感强、情绪鲜明"
  },
  {
    "id": "dialect",
    "name": "方言口音",
    "hint": "各地口音，适合本土题材"
  },
  {
    "id": "emotion",
    "name": "多情感",
    "hint": "情感参数可调（happy/sad/angry 等）"
  }
];

export const VOLC_VOICES: VolcVoiceOption[] = [
  {
    "id": "zh_female_wenrouxiaoya_moon_bigtts",
    "name": "温柔小雅",
    "tag": "治愈女声",
    "category": "narration",
    "desc": "治愈女声",
    "version": "1.0"
  },
  {
    "id": "zh_male_jieshuonansheng_mars_bigtts",
    "name": "磁性解说男声",
    "tag": "Morgan · 磁性",
    "category": "narration",
    "desc": "Morgan · 磁性",
    "version": "1.0"
  },
  {
    "id": "zh_male_changtianyi_mars_bigtts",
    "name": "悬疑解说",
    "tag": "纪录片感",
    "category": "narration",
    "desc": "纪录片感",
    "version": "1.0"
  },
  {
    "id": "zh_male_ruyaqingnian_mars_bigtts",
    "name": "儒雅青年",
    "tag": "番茄小说常用",
    "category": "narration",
    "desc": "番茄小说常用",
    "version": "1.0"
  },
  {
    "id": "zh_male_baqiqingshu_mars_bigtts",
    "name": "霸气青叔",
    "tag": "成熟有力",
    "category": "narration",
    "desc": "成熟有力",
    "version": "1.0"
  },
  {
    "id": "zh_male_qingcang_mars_bigtts",
    "name": "擎苍",
    "tag": "古风男声",
    "category": "narration",
    "desc": "古风男声",
    "version": "1.0"
  },
  {
    "id": "zh_female_wenroushunv_mars_bigtts",
    "name": "温柔淑女",
    "tag": "知性温暖",
    "category": "narration",
    "desc": "知性温暖",
    "version": "1.0"
  },
  {
    "id": "zh_female_jitangmeimei_mars_bigtts",
    "name": "鸡汤妹妹",
    "tag": "Hope · 治愈",
    "category": "narration",
    "desc": "Hope · 治愈",
    "version": "1.0"
  },
  {
    "id": "zh_female_tiexinnvsheng_mars_bigtts",
    "name": "贴心女声",
    "tag": "Candy · 亲和",
    "category": "narration",
    "desc": "Candy · 亲和",
    "version": "1.0"
  },
  {
    "id": "zh_female_gufengshaoyu_mars_bigtts",
    "name": "古风少御",
    "tag": "古风女声",
    "category": "narration",
    "desc": "古风女声",
    "version": "1.0"
  },
  {
    "id": "zh_male_fanjuanqingnian_mars_bigtts",
    "name": "反卷青年",
    "tag": "佛系叙述",
    "category": "narration",
    "desc": "佛系叙述",
    "version": "1.0"
  },
  {
    "id": "zh_male_dongfanghaoran_moon_bigtts",
    "name": "东方浩然",
    "tag": "沉稳叙述",
    "category": "male",
    "desc": "沉稳叙述",
    "version": "1.0"
  },
  {
    "id": "zh_male_yuanboxiaoshu_moon_bigtts",
    "name": "渊博小叔",
    "tag": "成熟稳重",
    "category": "male",
    "desc": "成熟稳重",
    "version": "1.0"
  },
  {
    "id": "zh_male_yangguangqingnian_moon_bigtts",
    "name": "阳光青年",
    "tag": "明朗有活力",
    "category": "male",
    "desc": "明朗有活力",
    "version": "1.0"
  },
  {
    "id": "zh_male_jieshuoxiaoming_moon_bigtts",
    "name": "解说小明",
    "tag": "节奏明快",
    "category": "male",
    "desc": "节奏明快",
    "version": "1.0"
  },
  {
    "id": "zh_male_linjiananhai_moon_bigtts",
    "name": "邻家男孩",
    "tag": "邻家亲切",
    "category": "male",
    "desc": "邻家亲切",
    "version": "1.0"
  },
  {
    "id": "zh_male_wennuanahu_moon_bigtts",
    "name": "温暖阿虎",
    "tag": "Alvin · 温暖",
    "category": "male",
    "desc": "Alvin · 温暖",
    "version": "1.0"
  },
  {
    "id": "zh_male_shaonianzixin_moon_bigtts",
    "name": "少年梓辛",
    "tag": "Brayan · 清亮",
    "category": "male",
    "desc": "Brayan · 清亮",
    "version": "1.0"
  },
  {
    "id": "zh_male_qingshuangnanda_mars_bigtts",
    "name": "清爽男大",
    "tag": "校园清新",
    "category": "male",
    "desc": "校园清新",
    "version": "1.0"
  },
  {
    "id": "zh_male_wenrouxiaoge_mars_bigtts",
    "name": "温柔小哥",
    "tag": "温和书卷",
    "category": "male",
    "desc": "温和书卷",
    "version": "1.0"
  },
  {
    "id": "zh_female_shuangkuaisisi_moon_bigtts",
    "name": "爽快思思",
    "tag": "Skye · 干练",
    "category": "female",
    "desc": "Skye · 干练",
    "version": "1.0"
  },
  {
    "id": "zh_female_qinqienvsheng_moon_bigtts",
    "name": "亲切女声",
    "tag": "邻家亲切",
    "category": "female",
    "desc": "邻家亲切",
    "version": "1.0"
  },
  {
    "id": "zh_female_linjianvhai_moon_bigtts",
    "name": "邻家女孩",
    "tag": "活泼自然",
    "category": "female",
    "desc": "活泼自然",
    "version": "1.0"
  },
  {
    "id": "zh_female_kailangjiejie_moon_bigtts",
    "name": "开朗姐姐",
    "tag": "开朗温暖",
    "category": "female",
    "desc": "开朗温暖",
    "version": "1.0"
  },
  {
    "id": "zh_female_tianmeixiaoyuan_moon_bigtts",
    "name": "甜美小源",
    "tag": "甜美少女",
    "category": "female",
    "desc": "甜美少女",
    "version": "1.0"
  },
  {
    "id": "zh_female_tianmeiyueyue_moon_bigtts",
    "name": "甜美悦悦",
    "tag": "甜糯",
    "category": "female",
    "desc": "甜糯",
    "version": "1.0"
  },
  {
    "id": "zh_female_qingchezizi_moon_bigtts",
    "name": "清澈梓梓",
    "tag": "清澈通透",
    "category": "female",
    "desc": "清澈通透",
    "version": "1.0"
  },
  {
    "id": "zh_female_xinlingjitang_moon_bigtts",
    "name": "心灵鸡汤",
    "tag": "治愈安抚",
    "category": "female",
    "desc": "治愈安抚",
    "version": "1.0"
  },
  {
    "id": "zh_female_qingxinnvsheng_mars_bigtts",
    "name": "清新女声",
    "tag": "清新自然",
    "category": "female",
    "desc": "清新自然",
    "version": "1.0"
  },
  {
    "id": "zh_female_zhixingnvsheng_mars_bigtts",
    "name": "知性女声",
    "tag": "知性沉稳",
    "category": "female",
    "desc": "知性沉稳",
    "version": "1.0"
  },
  {
    "id": "zh_female_cancan_mars_bigtts",
    "name": "灿灿/Shiny",
    "tag": "明亮活泼",
    "category": "female",
    "desc": "明亮活泼",
    "version": "1.0"
  },
  {
    "id": "zh_female_tianmeitaozi_mars_bigtts",
    "name": "甜美桃子",
    "tag": "软糯甜美",
    "category": "female",
    "desc": "软糯甜美",
    "version": "1.0"
  },
  {
    "id": "zh_male_aojiaobazong_moon_bigtts",
    "name": "傲娇霸总",
    "tag": "戏剧霸总感",
    "category": "role",
    "desc": "戏剧霸总感",
    "version": "1.0"
  },
  {
    "id": "zh_male_shenyeboke_moon_bigtts",
    "name": "深夜播客",
    "tag": "电台磁性",
    "category": "role",
    "desc": "电台磁性",
    "version": "1.0"
  },
  {
    "id": "zh_female_gaolengyujie_moon_bigtts",
    "name": "高冷御姐",
    "tag": "冷艳御姐",
    "category": "role",
    "desc": "冷艳御姐",
    "version": "1.0"
  },
  {
    "id": "zh_female_meilinvyou_moon_bigtts",
    "name": "魅力女友",
    "tag": "撩动情感",
    "category": "role",
    "desc": "撩动情感",
    "version": "1.0"
  },
  {
    "id": "zh_female_sajiaonvyou_moon_bigtts",
    "name": "柔美女友",
    "tag": "柔美撒娇",
    "category": "role",
    "desc": "柔美撒娇",
    "version": "1.0"
  },
  {
    "id": "zh_female_yuanqinvyou_moon_bigtts",
    "name": "撒娇学妹",
    "tag": "学妹活力",
    "category": "role",
    "desc": "学妹活力",
    "version": "1.0"
  },
  {
    "id": "zh_male_naiqimengwa_mars_bigtts",
    "name": "奶气萌娃",
    "tag": "童声萌",
    "category": "role",
    "desc": "童声萌",
    "version": "1.0"
  },
  {
    "id": "zh_female_popo_mars_bigtts",
    "name": "婆婆",
    "tag": "长辈口吻",
    "category": "role",
    "desc": "长辈口吻",
    "version": "1.0"
  },
  {
    "id": "zh_male_sunwukong_mars_bigtts",
    "name": "猴哥",
    "tag": "孙悟空",
    "category": "role",
    "desc": "孙悟空",
    "version": "1.0"
  },
  {
    "id": "zh_male_silang_mars_bigtts",
    "name": "四郎",
    "tag": "深沉中年",
    "category": "role",
    "desc": "深沉中年",
    "version": "1.0"
  },
  {
    "id": "zh_female_wuzetian_mars_bigtts",
    "name": "武则天",
    "tag": "威严女声",
    "category": "role",
    "desc": "威严女声",
    "version": "1.0"
  },
  {
    "id": "zh_female_yingtaowanzi_mars_bigtts",
    "name": "樱桃丸子",
    "tag": "可爱童声",
    "category": "role",
    "desc": "可爱童声",
    "version": "1.0"
  },
  {
    "id": "zh_male_jingqiangkanye_moon_bigtts",
    "name": "京腔侃爷",
    "tag": "Harmony · 京腔",
    "category": "dialect",
    "desc": "Harmony · 京腔",
    "version": "1.0"
  },
  {
    "id": "zh_male_beijingxiaoye_moon_bigtts",
    "name": "北京小爷",
    "tag": "北京口音",
    "category": "dialect",
    "desc": "北京口音",
    "version": "1.0"
  },
  {
    "id": "zh_female_wanwanxiaohe_moon_bigtts",
    "name": "湾湾小何",
    "tag": "台湾腔",
    "category": "dialect",
    "desc": "台湾腔",
    "version": "1.0"
  },
  {
    "id": "zh_female_daimengchuanmei_moon_bigtts",
    "name": "呆萌川妹",
    "tag": "四川口音",
    "category": "dialect",
    "desc": "四川口音",
    "version": "1.0"
  },
  {
    "id": "zh_male_guangxiyuanzhou_moon_bigtts",
    "name": "广西远舟",
    "tag": "广西口音",
    "category": "dialect",
    "desc": "广西口音",
    "version": "1.0"
  },
  {
    "id": "zh_male_yuzhouzixuan_moon_bigtts",
    "name": "豫州子轩",
    "tag": "河南口音",
    "category": "dialect",
    "desc": "河南口音",
    "version": "1.0"
  },
  {
    "id": "zh_male_haoyuxiaoge_moon_bigtts",
    "name": "浩宇小哥",
    "tag": "青岛口音",
    "category": "dialect",
    "desc": "青岛口音",
    "version": "1.0"
  },
  {
    "id": "zh_male_guozhoudege_moon_bigtts",
    "name": "广州德哥",
    "tag": "广东口音",
    "category": "dialect",
    "desc": "广东口音",
    "version": "1.0"
  },
  {
    "id": "zh_female_meituojieer_moon_bigtts",
    "name": "妹坨洁儿",
    "tag": "长沙口音",
    "category": "dialect",
    "desc": "长沙口音",
    "version": "1.0"
  },
  {
    "id": "zh_female_yueyunv_mars_bigtts",
    "name": "粤语小溏",
    "tag": "粤语",
    "category": "dialect",
    "desc": "粤语",
    "version": "1.0"
  },
  {
    "id": "zh_male_hupunan_mars_bigtts",
    "name": "沪普男",
    "tag": "上海普通话",
    "category": "dialect",
    "desc": "上海普通话",
    "version": "1.0"
  },
  {
    "id": "zh_male_lengkugege_emo_v2_mars_bigtts",
    "name": "冷酷哥哥",
    "tag": "多情感 · 戏剧",
    "category": "emotion",
    "desc": "多情感 · 戏剧",
    "version": "1.0"
  },
  {
    "id": "zh_female_gaolengyujie_emo_v2_mars_bigtts",
    "name": "高冷御姐",
    "tag": "多情感 · 御姐",
    "category": "emotion",
    "desc": "多情感 · 御姐",
    "version": "1.0"
  },
  {
    "id": "zh_male_aojiaobazong_emo_v2_mars_bigtts",
    "name": "傲娇霸总",
    "tag": "多情感 · 霸总",
    "category": "emotion",
    "desc": "多情感 · 霸总",
    "version": "1.0"
  },
  {
    "id": "zh_male_yangguangqingnian_emo_v2_mars_bigtts",
    "name": "阳光青年",
    "tag": "多情感 · 阳光",
    "category": "emotion",
    "desc": "多情感 · 阳光",
    "version": "1.0"
  },
  {
    "id": "zh_female_roumeinvyou_emo_v2_mars_bigtts",
    "name": "柔美女友",
    "tag": "多情感 · 柔美",
    "category": "emotion",
    "desc": "多情感 · 柔美",
    "version": "1.0"
  },
  {
    "id": "zh_female_meilinvyou_emo_v2_mars_bigtts",
    "name": "魅力女友",
    "tag": "多情感 · 魅力",
    "category": "emotion",
    "desc": "多情感 · 魅力",
    "version": "1.0"
  },
  {
    "id": "zh_female_shuangkuaisisi_emo_v2_mars_bigtts",
    "name": "爽快思思",
    "tag": "多情感 · 爽快",
    "category": "emotion",
    "desc": "多情感 · 爽快",
    "version": "1.0"
  },
  {
    "id": "zh_male_shenyeboke_emo_v2_mars_bigtts",
    "name": "深夜播客",
    "tag": "多情感 · 电台",
    "category": "emotion",
    "desc": "多情感 · 电台",
    "version": "1.0"
  },
  {
    "id": "zh_male_jieshuoxiaoming_uranus_bigtts",
    "name": "解说小明",
    "tag": "节奏明快",
    "category": "narration",
    "desc": "节奏明快",
    "version": "2.0"
  },
  {
    "id": "zh_male_cixingjieshuonan_uranus_bigtts",
    "name": "磁性解说男声",
    "tag": "Morgan · 磁性",
    "category": "narration",
    "desc": "Morgan · 磁性",
    "version": "2.0"
  },
  {
    "id": "zh_male_xuanyijieshuo_uranus_bigtts",
    "name": "悬疑解说",
    "tag": "纪录片感",
    "category": "narration",
    "desc": "纪录片感",
    "version": "2.0"
  },
  {
    "id": "zh_male_guanggaojieshuo_uranus_bigtts",
    "name": "广告解说",
    "tag": "广告腔",
    "category": "narration",
    "desc": "广告腔",
    "version": "2.0"
  },
  {
    "id": "zh_male_dayi_uranus_bigtts",
    "name": "大壹",
    "tag": "视频配音",
    "category": "narration",
    "desc": "视频配音",
    "version": "2.0"
  },
  {
    "id": "zh_female_mizai_uranus_bigtts",
    "name": "咪仔",
    "tag": "黑猫侦探社",
    "category": "narration",
    "desc": "黑猫侦探社",
    "version": "2.0"
  },
  {
    "id": "zh_female_jitangnv_uranus_bigtts",
    "name": "鸡汤女",
    "tag": "治愈",
    "category": "narration",
    "desc": "治愈",
    "version": "2.0"
  },
  {
    "id": "zh_female_liuchangnv_uranus_bigtts",
    "name": "流畅女声",
    "tag": "顺畅旁白",
    "category": "narration",
    "desc": "顺畅旁白",
    "version": "2.0"
  },
  {
    "id": "zh_male_ruyayichen_uranus_bigtts",
    "name": "儒雅逸辰",
    "tag": "儒雅男声",
    "category": "narration",
    "desc": "儒雅男声",
    "version": "2.0"
  },
  {
    "id": "zh_male_ruyaqingnian_uranus_bigtts",
    "name": "儒雅青年",
    "tag": "番茄小说常用",
    "category": "narration",
    "desc": "番茄小说常用",
    "version": "2.0"
  },
  {
    "id": "zh_male_baqiqingshu_uranus_bigtts",
    "name": "霸气青叔",
    "tag": "成熟有力",
    "category": "narration",
    "desc": "成熟有力",
    "version": "2.0"
  },
  {
    "id": "zh_female_shaoergushi_uranus_bigtts",
    "name": "少儿故事",
    "tag": "童书旁白",
    "category": "narration",
    "desc": "童书旁白",
    "version": "2.0"
  },
  {
    "id": "zh_female_xiaoxue_uranus_bigtts",
    "name": "儿童绘本",
    "tag": "绘本旁白",
    "category": "narration",
    "desc": "绘本旁白",
    "version": "2.0"
  },
  {
    "id": "zh_male_dongfanghaoran_uranus_bigtts",
    "name": "东方浩然",
    "tag": "沉稳叙述",
    "category": "narration",
    "desc": "沉稳叙述",
    "version": "2.0"
  },
  {
    "id": "zh_male_gaolengchenwen_uranus_bigtts",
    "name": "高冷沉稳",
    "tag": "低沉",
    "category": "narration",
    "desc": "低沉",
    "version": "2.0"
  },
  {
    "id": "zh_male_m191_uranus_bigtts",
    "name": "云舟",
    "tag": "沉稳",
    "category": "male",
    "desc": "沉稳",
    "version": "2.0"
  },
  {
    "id": "zh_male_taocheng_uranus_bigtts",
    "name": "小天",
    "tag": "自然",
    "category": "male",
    "desc": "自然",
    "version": "2.0"
  },
  {
    "id": "zh_male_liufei_uranus_bigtts",
    "name": "刘飞",
    "tag": "磁性",
    "category": "male",
    "desc": "磁性",
    "version": "2.0"
  },
  {
    "id": "zh_male_shaonianzixin_uranus_bigtts",
    "name": "少年梓辛",
    "tag": "Brayan · 清亮",
    "category": "male",
    "desc": "Brayan · 清亮",
    "version": "2.0"
  },
  {
    "id": "zh_male_yizhipiannan_uranus_bigtts",
    "name": "译制片男",
    "tag": "译制腔",
    "category": "male",
    "desc": "译制腔",
    "version": "2.0"
  },
  {
    "id": "zh_male_linjiananhai_uranus_bigtts",
    "name": "邻家男孩",
    "tag": "邻家亲切",
    "category": "male",
    "desc": "邻家亲切",
    "version": "2.0"
  },
  {
    "id": "zh_male_wennuanahu_uranus_bigtts",
    "name": "温暖阿虎",
    "tag": "Alvin · 温暖",
    "category": "male",
    "desc": "Alvin · 温暖",
    "version": "2.0"
  },
  {
    "id": "zh_male_naiqimengwa_uranus_bigtts",
    "name": "奶气萌娃",
    "tag": "童声萌",
    "category": "male",
    "desc": "童声萌",
    "version": "2.0"
  },
  {
    "id": "zh_male_huolixiaoge_uranus_bigtts",
    "name": "活力小哥",
    "tag": "活力",
    "category": "male",
    "desc": "活力",
    "version": "2.0"
  },
  {
    "id": "zh_male_liangsangmengzai_uranus_bigtts",
    "name": "亮嗓萌仔",
    "tag": "明亮",
    "category": "male",
    "desc": "明亮",
    "version": "2.0"
  },
  {
    "id": "zh_male_shenyeboke_uranus_bigtts",
    "name": "深夜播客",
    "tag": "电台磁性",
    "category": "male",
    "desc": "电台磁性",
    "version": "2.0"
  },
  {
    "id": "zh_male_kuailexiaodong_uranus_bigtts",
    "name": "快乐小东",
    "tag": "欢快",
    "category": "male",
    "desc": "欢快",
    "version": "2.0"
  },
  {
    "id": "zh_male_kailangxuezhang_uranus_bigtts",
    "name": "开朗学长",
    "tag": "开朗",
    "category": "male",
    "desc": "开朗",
    "version": "2.0"
  },
  {
    "id": "zh_male_youyoujunzi_uranus_bigtts",
    "name": "悠悠君子",
    "tag": "温润",
    "category": "male",
    "desc": "温润",
    "version": "2.0"
  },
  {
    "id": "zh_male_qingshuangnanda_uranus_bigtts",
    "name": "清爽男大",
    "tag": "校园清新",
    "category": "male",
    "desc": "校园清新",
    "version": "2.0"
  },
  {
    "id": "zh_male_yuanboxiaoshu_uranus_bigtts",
    "name": "渊博小叔",
    "tag": "成熟稳重",
    "category": "male",
    "desc": "成熟稳重",
    "version": "2.0"
  },
  {
    "id": "zh_male_yangguangqingnian_uranus_bigtts",
    "name": "阳光青年",
    "tag": "明朗活力",
    "category": "male",
    "desc": "明朗活力",
    "version": "2.0"
  },
  {
    "id": "zh_male_wenrouxiaoge_uranus_bigtts",
    "name": "温柔小哥",
    "tag": "温和书卷",
    "category": "male",
    "desc": "温和书卷",
    "version": "2.0"
  },
  {
    "id": "zh_male_tiancaitongsheng_uranus_bigtts",
    "name": "天才童声",
    "tag": "童声",
    "category": "male",
    "desc": "童声",
    "version": "2.0"
  },
  {
    "id": "zh_male_kailangdidi_uranus_bigtts",
    "name": "开朗弟弟",
    "tag": "活泼",
    "category": "male",
    "desc": "活泼",
    "version": "2.0"
  },
  {
    "id": "zh_male_fanjuanqingnian_uranus_bigtts",
    "name": "反卷青年",
    "tag": "佛系叙述",
    "category": "male",
    "desc": "佛系叙述",
    "version": "2.0"
  },
  {
    "id": "en_male_tim_uranus_bigtts",
    "name": "Tim",
    "tag": "美式英语 · 男",
    "category": "male",
    "desc": "美式英语 · 男",
    "version": "2.0"
  },
  {
    "id": "zh_female_vv_uranus_bigtts",
    "name": "Vivi",
    "tag": "多语种 · 方言",
    "category": "female",
    "desc": "多语种 · 方言",
    "version": "2.0"
  },
  {
    "id": "zh_female_xiaohe_uranus_bigtts",
    "name": "小何",
    "tag": "自然",
    "category": "female",
    "desc": "自然",
    "version": "2.0"
  },
  {
    "id": "zh_female_sophie_uranus_bigtts",
    "name": "魅力苏菲",
    "tag": "知性",
    "category": "female",
    "desc": "知性",
    "version": "2.0"
  },
  {
    "id": "zh_female_qingxinnvsheng_uranus_bigtts",
    "name": "清新女声",
    "tag": "清新自然",
    "category": "female",
    "desc": "清新自然",
    "version": "2.0"
  },
  {
    "id": "zh_female_tianmeixiaoyuan_uranus_bigtts",
    "name": "甜美小源",
    "tag": "甜美少女",
    "category": "female",
    "desc": "甜美少女",
    "version": "2.0"
  },
  {
    "id": "zh_female_tianmeitaozi_uranus_bigtts",
    "name": "甜美桃子",
    "tag": "软糯甜美",
    "category": "female",
    "desc": "软糯甜美",
    "version": "2.0"
  },
  {
    "id": "zh_female_shuangkuaisisi_uranus_bigtts",
    "name": "爽快思思",
    "tag": "Skye · 干练",
    "category": "female",
    "desc": "Skye · 干练",
    "version": "2.0"
  },
  {
    "id": "zh_female_linjianvhai_uranus_bigtts",
    "name": "邻家女孩",
    "tag": "活泼自然",
    "category": "female",
    "desc": "活泼自然",
    "version": "2.0"
  },
  {
    "id": "zh_female_wenroumama_uranus_bigtts",
    "name": "温柔妈妈",
    "tag": "温柔",
    "category": "female",
    "desc": "温柔",
    "version": "2.0"
  },
  {
    "id": "zh_female_tvbnv_uranus_bigtts",
    "name": "TVB女声",
    "tag": "港风",
    "category": "female",
    "desc": "港风",
    "version": "2.0"
  },
  {
    "id": "zh_female_qiaopinv_uranus_bigtts",
    "name": "俏皮女声",
    "tag": "俏皮",
    "category": "female",
    "desc": "俏皮",
    "version": "2.0"
  },
  {
    "id": "zh_female_mengyatou_uranus_bigtts",
    "name": "萌丫头",
    "tag": "Cutey · 萌",
    "category": "female",
    "desc": "Cutey · 萌",
    "version": "2.0"
  },
  {
    "id": "zh_female_tiexinnvsheng_uranus_bigtts",
    "name": "贴心女声",
    "tag": "Candy · 亲和",
    "category": "female",
    "desc": "Candy · 亲和",
    "version": "2.0"
  },
  {
    "id": "zh_female_jitangmei_uranus_bigtts",
    "name": "鸡汤妹妹",
    "tag": "Hope · 治愈",
    "category": "female",
    "desc": "Hope · 治愈",
    "version": "2.0"
  },
  {
    "id": "zh_female_kailangjiejie_uranus_bigtts",
    "name": "开朗姐姐",
    "tag": "开朗温暖",
    "category": "female",
    "desc": "开朗温暖",
    "version": "2.0"
  },
  {
    "id": "zh_female_qinqienv_uranus_bigtts",
    "name": "亲切女声",
    "tag": "邻家亲切",
    "category": "female",
    "desc": "邻家亲切",
    "version": "2.0"
  },
  {
    "id": "zh_female_wenjingmaomao_uranus_bigtts",
    "name": "文静毛毛",
    "tag": "文静",
    "category": "female",
    "desc": "文静",
    "version": "2.0"
  },
  {
    "id": "zh_female_zhixingnv_uranus_bigtts",
    "name": "知性女声",
    "tag": "知性沉稳",
    "category": "female",
    "desc": "知性沉稳",
    "version": "2.0"
  },
  {
    "id": "zh_female_qingchezizi_uranus_bigtts",
    "name": "清澈梓梓",
    "tag": "清澈通透",
    "category": "female",
    "desc": "清澈通透",
    "version": "2.0"
  },
  {
    "id": "zh_female_tianmeiyueyue_uranus_bigtts",
    "name": "甜美悦悦",
    "tag": "甜糯",
    "category": "female",
    "desc": "甜糯",
    "version": "2.0"
  },
  {
    "id": "zh_female_xinlingjitang_uranus_bigtts",
    "name": "心灵鸡汤",
    "tag": "治愈安抚",
    "category": "female",
    "desc": "治愈安抚",
    "version": "2.0"
  },
  {
    "id": "zh_female_wenrouxiaoya_uranus_bigtts",
    "name": "温柔小雅",
    "tag": "治愈女声",
    "category": "female",
    "desc": "治愈女声",
    "version": "2.0"
  },
  {
    "id": "zh_female_wenroushunv_uranus_bigtts",
    "name": "温柔淑女",
    "tag": "知性温暖",
    "category": "female",
    "desc": "知性温暖",
    "version": "2.0"
  },
  {
    "id": "zh_female_gufengshaoyu_uranus_bigtts",
    "name": "古风少御",
    "tag": "古风女声",
    "category": "female",
    "desc": "古风女声",
    "version": "2.0"
  },
  {
    "id": "zh_female_yingyujiaoxue_uranus_bigtts",
    "name": "Tina老师",
    "tag": "英语教学 · 双语",
    "category": "female",
    "desc": "英语教学 · 双语",
    "version": "2.0"
  },
  {
    "id": "zh_female_kefunvsheng_uranus_bigtts",
    "name": "暖阳女声",
    "tag": "客服亲切",
    "category": "female",
    "desc": "客服亲切",
    "version": "2.0"
  },
  {
    "id": "zh_female_chanmeinv_uranus_bigtts",
    "name": "谄媚女声",
    "tag": "嗲甜",
    "category": "female",
    "desc": "嗲甜",
    "version": "2.0"
  },
  {
    "id": "en_female_dacey_uranus_bigtts",
    "name": "Dacey",
    "tag": "美式英语 · 女",
    "category": "female",
    "desc": "美式英语 · 女",
    "version": "2.0"
  },
  {
    "id": "en_female_stokie_uranus_bigtts",
    "name": "Stokie",
    "tag": "美式英语 · 女",
    "category": "female",
    "desc": "美式英语 · 女",
    "version": "2.0"
  },
  {
    "id": "zh_female_cancan_uranus_bigtts",
    "name": "知性灿灿",
    "tag": "知性",
    "category": "role",
    "desc": "知性",
    "version": "2.0"
  },
  {
    "id": "zh_female_sajiaoxuemei_uranus_bigtts",
    "name": "撒娇学妹",
    "tag": "学妹活力",
    "category": "role",
    "desc": "学妹活力",
    "version": "2.0"
  },
  {
    "id": "zh_female_peiqi_uranus_bigtts",
    "name": "佩奇猪",
    "tag": "IP · 童趣",
    "category": "role",
    "desc": "IP · 童趣",
    "version": "2.0"
  },
  {
    "id": "zh_male_sunwukong_uranus_bigtts",
    "name": "猴哥",
    "tag": "孙悟空",
    "category": "role",
    "desc": "孙悟空",
    "version": "2.0"
  },
  {
    "id": "zh_female_zhishuaiyingzi_uranus_bigtts",
    "name": "直率英子",
    "tag": "直率",
    "category": "role",
    "desc": "直率",
    "version": "2.0"
  },
  {
    "id": "zh_male_silang_uranus_bigtts",
    "name": "四郎",
    "tag": "深沉中年",
    "category": "role",
    "desc": "深沉中年",
    "version": "2.0"
  },
  {
    "id": "zh_male_qingcang_uranus_bigtts",
    "name": "擎苍",
    "tag": "古风男声",
    "category": "role",
    "desc": "古风男声",
    "version": "2.0"
  },
  {
    "id": "zh_male_xionger_uranus_bigtts",
    "name": "熊二",
    "tag": "IP · 憨萌",
    "category": "role",
    "desc": "IP · 憨萌",
    "version": "2.0"
  },
  {
    "id": "zh_female_yingtaowanzi_uranus_bigtts",
    "name": "樱桃丸子",
    "tag": "可爱童声",
    "category": "role",
    "desc": "可爱童声",
    "version": "2.0"
  },
  {
    "id": "zh_male_aojiaobazong_uranus_bigtts",
    "name": "傲娇霸总",
    "tag": "戏剧霸总",
    "category": "role",
    "desc": "戏剧霸总",
    "version": "2.0"
  },
  {
    "id": "zh_male_lanyinmianbao_uranus_bigtts",
    "name": "懒音绵宝",
    "tag": "懒萌",
    "category": "role",
    "desc": "懒萌",
    "version": "2.0"
  },
  {
    "id": "zh_male_lubanqihao_uranus_bigtts",
    "name": "鲁班七号",
    "tag": "游戏角色",
    "category": "role",
    "desc": "游戏角色",
    "version": "2.0"
  },
  {
    "id": "zh_female_linxiao_uranus_bigtts",
    "name": "林潇",
    "tag": "古风",
    "category": "role",
    "desc": "古风",
    "version": "2.0"
  },
  {
    "id": "zh_female_lingling_uranus_bigtts",
    "name": "玲玲姐姐",
    "tag": "温婉",
    "category": "role",
    "desc": "温婉",
    "version": "2.0"
  },
  {
    "id": "zh_female_chunribu_uranus_bigtts",
    "name": "春日部姐姐",
    "tag": "动漫",
    "category": "role",
    "desc": "动漫",
    "version": "2.0"
  },
  {
    "id": "zh_male_tangseng_uranus_bigtts",
    "name": "唐僧",
    "tag": "IP",
    "category": "role",
    "desc": "IP",
    "version": "2.0"
  },
  {
    "id": "zh_male_zhuangzhou_uranus_bigtts",
    "name": "庄周",
    "tag": "游戏角色",
    "category": "role",
    "desc": "游戏角色",
    "version": "2.0"
  },
  {
    "id": "zh_male_zhubajie_uranus_bigtts",
    "name": "猪八戒",
    "tag": "IP · 憨",
    "category": "role",
    "desc": "IP · 憨",
    "version": "2.0"
  },
  {
    "id": "zh_female_ganmaodianyin_uranus_bigtts",
    "name": "感冒电音姐姐",
    "tag": "电音",
    "category": "role",
    "desc": "电音",
    "version": "2.0"
  },
  {
    "id": "zh_female_nvleishen_uranus_bigtts",
    "name": "女雷神",
    "tag": "游戏角色",
    "category": "role",
    "desc": "游戏角色",
    "version": "2.0"
  },
  {
    "id": "zh_female_wuzetian_uranus_bigtts",
    "name": "武则天",
    "tag": "威严女声",
    "category": "role",
    "desc": "威严女声",
    "version": "2.0"
  },
  {
    "id": "zh_female_gujie_uranus_bigtts",
    "name": "顾姐",
    "tag": "御姐",
    "category": "role",
    "desc": "御姐",
    "version": "2.0"
  },
  {
    "id": "zh_female_popo_uranus_bigtts",
    "name": "婆婆",
    "tag": "长辈口吻",
    "category": "role",
    "desc": "长辈口吻",
    "version": "2.0"
  },
  {
    "id": "zh_female_meilinvyou_uranus_bigtts",
    "name": "魅力女友",
    "tag": "撩动情感",
    "category": "role",
    "desc": "撩动情感",
    "version": "2.0"
  },
  {
    "id": "zh_female_roumeinvyou_uranus_bigtts",
    "name": "柔美女友",
    "tag": "柔美撒娇",
    "category": "role",
    "desc": "柔美撒娇",
    "version": "2.0"
  },
  {
    "id": "zh_female_gaolengyujie_uranus_bigtts",
    "name": "高冷御姐",
    "tag": "冷艳御姐",
    "category": "role",
    "desc": "冷艳御姐",
    "version": "2.0"
  },
  {
    "id": "zh_female_jiaochuannv_uranus_bigtts",
    "name": "娇喘女声",
    "tag": "特殊音色",
    "category": "role",
    "desc": "特殊音色",
    "version": "2.0"
  },
  {
    "id": "saturn_zh_female_tiaopigongzhu_tob",
    "name": "调皮公主",
    "tag": "COT/QA",
    "category": "role",
    "desc": "COT/QA",
    "version": "2.0"
  },
  {
    "id": "saturn_zh_male_shuanglangshaonian_tob",
    "name": "爽朗少年",
    "tag": "COT/QA",
    "category": "role",
    "desc": "COT/QA",
    "version": "2.0"
  },
  {
    "id": "saturn_zh_male_tiancaitongzhuo_tob",
    "name": "天才同桌",
    "tag": "COT/QA",
    "category": "role",
    "desc": "COT/QA",
    "version": "2.0"
  },
  {
    "id": "saturn_zh_female_cancan_tob",
    "name": "知性灿灿",
    "tag": "COT/QA",
    "category": "role",
    "desc": "COT/QA",
    "version": "2.0"
  },
  {
    "id": "saturn_zh_female_aojiaonvyou_tob",
    "name": "傲娇女友",
    "tag": "COT/QA",
    "category": "role",
    "desc": "COT/QA",
    "version": "2.0"
  },
  {
    "id": "saturn_zh_female_bingjiaojiejie_tob",
    "name": "病娇姐姐",
    "tag": "COT/QA",
    "category": "role",
    "desc": "COT/QA",
    "version": "2.0"
  },
  {
    "id": "saturn_zh_female_chengshujiejie_tob",
    "name": "成熟姐姐",
    "tag": "COT/QA",
    "category": "role",
    "desc": "COT/QA",
    "version": "2.0"
  },
  {
    "id": "saturn_zh_female_keainvsheng_tob",
    "name": "可爱女生",
    "tag": "COT/QA",
    "category": "role",
    "desc": "COT/QA",
    "version": "2.0"
  },
  {
    "id": "saturn_zh_female_nuanxinxuejie_tob",
    "name": "暖心学姐",
    "tag": "COT/QA",
    "category": "role",
    "desc": "COT/QA",
    "version": "2.0"
  },
  {
    "id": "saturn_zh_female_tiexinnvyou_tob",
    "name": "贴心女友",
    "tag": "COT/QA",
    "category": "role",
    "desc": "COT/QA",
    "version": "2.0"
  },
  {
    "id": "saturn_zh_female_wenrouwenya_tob",
    "name": "温柔文雅",
    "tag": "COT/QA",
    "category": "role",
    "desc": "COT/QA",
    "version": "2.0"
  },
  {
    "id": "saturn_zh_female_wumeiyujie_tob",
    "name": "妩媚御姐",
    "tag": "COT/QA",
    "category": "role",
    "desc": "COT/QA",
    "version": "2.0"
  },
  {
    "id": "saturn_zh_female_xingganyujie_tob",
    "name": "性感御姐",
    "tag": "COT/QA",
    "category": "role",
    "desc": "COT/QA",
    "version": "2.0"
  },
  {
    "id": "saturn_zh_male_aiqilingren_tob",
    "name": "傲气凌人",
    "tag": "COT/QA",
    "category": "role",
    "desc": "COT/QA",
    "version": "2.0"
  },
  {
    "id": "saturn_zh_male_aojiaogongzi_tob",
    "name": "傲娇公子",
    "tag": "COT/QA",
    "category": "role",
    "desc": "COT/QA",
    "version": "2.0"
  },
  {
    "id": "saturn_zh_male_aojiaojingying_tob",
    "name": "傲娇精英",
    "tag": "COT/QA",
    "category": "role",
    "desc": "COT/QA",
    "version": "2.0"
  },
  {
    "id": "saturn_zh_male_aomanshaoye_tob",
    "name": "傲慢少爷",
    "tag": "COT/QA",
    "category": "role",
    "desc": "COT/QA",
    "version": "2.0"
  },
  {
    "id": "saturn_zh_male_badaoshaoye_tob",
    "name": "霸道少爷",
    "tag": "COT/QA",
    "category": "role",
    "desc": "COT/QA",
    "version": "2.0"
  },
  {
    "id": "saturn_zh_male_bingjiaobailian_tob",
    "name": "病娇白莲",
    "tag": "COT/QA",
    "category": "role",
    "desc": "COT/QA",
    "version": "2.0"
  },
  {
    "id": "saturn_zh_male_bujiqingnian_tob",
    "name": "不羁青年",
    "tag": "COT/QA",
    "category": "role",
    "desc": "COT/QA",
    "version": "2.0"
  },
  {
    "id": "saturn_zh_male_chengshuzongcai_tob",
    "name": "成熟总裁",
    "tag": "COT/QA",
    "category": "role",
    "desc": "COT/QA",
    "version": "2.0"
  },
  {
    "id": "saturn_zh_male_cixingnansang_tob",
    "name": "磁性男嗓",
    "tag": "COT/QA",
    "category": "role",
    "desc": "COT/QA",
    "version": "2.0"
  },
  {
    "id": "saturn_zh_male_cujingnanyou_tob",
    "name": "醋精男友",
    "tag": "COT/QA",
    "category": "role",
    "desc": "COT/QA",
    "version": "2.0"
  },
  {
    "id": "saturn_zh_male_fengfashaonian_tob",
    "name": "风发少年",
    "tag": "COT/QA",
    "category": "role",
    "desc": "COT/QA",
    "version": "2.0"
  },
  {
    "id": "saturn_zh_male_fuheigongzi_tob",
    "name": "腹黑公子",
    "tag": "COT/QA",
    "category": "role",
    "desc": "COT/QA",
    "version": "2.0"
  },
  {
    "id": "saturn_zh_female_qingyingduoduo_cs_tob",
    "name": "轻盈朵朵",
    "tag": "客服",
    "category": "female",
    "desc": "客服",
    "version": "2.0"
  },
  {
    "id": "saturn_zh_female_wenwanshanshan_cs_tob",
    "name": "温婉珊珊",
    "tag": "客服",
    "category": "female",
    "desc": "客服",
    "version": "2.0"
  },
  {
    "id": "saturn_zh_female_reqingaina_cs_tob",
    "name": "热情艾娜",
    "tag": "客服",
    "category": "female",
    "desc": "客服",
    "version": "2.0"
  },
  {
    "id": "saturn_zh_male_qingxinmumu_cs_tob",
    "name": "清新沐沐",
    "tag": "客服",
    "category": "male",
    "desc": "客服",
    "version": "2.0"
  }
];

export const DEFAULT_VOLC_VOICE_ID = "zh_male_dongfanghaoran_uranus_bigtts";
