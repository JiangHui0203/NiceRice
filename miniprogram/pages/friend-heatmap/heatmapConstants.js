const WEEKDAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const WEEKDAY_MAP = { "周一": 1, "周二": 2, "周三": 3, "周四": 4, "周五": 5, "周六": 6, "周日": 0 };
const SELF_PARTICIPANT_ID = "self";
const LEGACY_SELF_PARTICIPANT_ID = "friend_self";
const HEATMAP_SELECTION_KEY = "life_helper_heatmap_selected_ids";
const MAX_HEATMAP_SCENES = 12;
const MAX_VOTE_SLOTS = WEEKDAYS.length * MAX_HEATMAP_SCENES;
const MAX_VOTE_OPTIONS = 20;
const MAX_VOTERS_PER_OPTION = 100;
const MAX_SHARED_AVAILABILITY_SLOTS = 50;
const MAX_SHARE_PATH_LENGTH = 900;

const ICON_EMOJI_MAP = {
  breakfast: "🥐", lunch: "🍱", tea: "☕", dinner: "🍲",
  game: "🎲", sports: "🏃", study: "📖", social: "🍻"
};

const PRESET_SCENES = {
  default: [
    { id: "s1", name: "午餐", icon: "lunch", emoji: "🍱", timeRange: "12:00 - 14:00", start: "12:00", end: "14:00" },
    { id: "s2", name: "下午茶", icon: "tea", emoji: "☕", timeRange: "14:00 - 17:30", start: "14:00", end: "17:30" },
    { id: "s3", name: "晚餐", icon: "dinner", emoji: "🍲", timeRange: "18:00 - 22:00", start: "18:00", end: "22:00" }
  ],
  threeMeals: [
    { id: "s1", name: "早餐", icon: "breakfast", emoji: "🥐", timeRange: "07:30 - 09:30", start: "07:30", end: "09:30" },
    { id: "s2", name: "午餐", icon: "lunch", emoji: "🍱", timeRange: "12:00 - 14:00", start: "12:00", end: "14:00" },
    { id: "s3", name: "下午茶", icon: "tea", emoji: "☕", timeRange: "14:30 - 17:30", start: "14:30", end: "17:30" },
    { id: "s4", name: "晚餐", icon: "dinner", emoji: "🍲", timeRange: "18:30 - 21:30", start: "18:30", end: "21:30" }
  ],
  leisure: [
    { id: "s1", name: "下午茶", icon: "tea", emoji: "☕", timeRange: "13:30 - 17:30", start: "13:30", end: "17:30" },
    { id: "s2", name: "夜间聚会", icon: "social", emoji: "🍻", timeRange: "18:00 - 22:30", start: "18:00", end: "22:30" },
    { id: "s3", name: "深夜桌游", icon: "game", emoji: "🎲", timeRange: "22:30 - 02:00", start: "22:30", end: "02:00" }
  ],
  allDay: [
    { id: "s1", name: "上午", icon: "study", emoji: "📖", timeRange: "08:30 - 12:00", start: "08:30", end: "12:00" },
    { id: "s2", name: "下午", icon: "sports", emoji: "🏃", timeRange: "13:30 - 18:00", start: "13:30", end: "18:00" },
    { id: "s3", name: "晚上", icon: "social", emoji: "🎬", timeRange: "19:00 - 23:00", start: "19:00", end: "23:00" }
  ]
};

const DEFAULT_VOTES_MAP = {
  "下午茶": ["猫咖逗猫", "喝咖啡甜品", "桌游/密室", "看电影/逛街"],
  "午餐": ["吃日式拉面", "川湘菜聚餐", "粤式茶点", "沙拉轻食"],
  "晚餐": ["吃四川火锅", "炭烤烤肉", "吃特色私房菜", "喝点小酒/清吧"],
  "早餐": ["吃街边热干面", "包子铺买早餐", "吃早茶点心", "便利店早餐"],
  "game": ["阿瓦隆/狼人杀", "双人成行/Switch", "硬核烧脑德策", "轻松派对桌游"],
  "sports": ["打羽毛球", "户外夜跑/散步", "健身房撸铁", "打篮球/游水"],
  "study": ["图书馆自习", "宝藏书店探店", "自习室自刷", "读书会交流"],
  "social": ["轰趴馆轰趴", "户外露营烧烤", "看艺术展览", "清吧围炉夜话"]
};

module.exports = {
  WEEKDAYS,
  WEEKDAY_MAP,
  SELF_PARTICIPANT_ID,
  LEGACY_SELF_PARTICIPANT_ID,
  HEATMAP_SELECTION_KEY,
  MAX_HEATMAP_SCENES,
  MAX_VOTE_SLOTS,
  MAX_VOTE_OPTIONS,
  MAX_VOTERS_PER_OPTION,
  MAX_SHARED_AVAILABILITY_SLOTS,
  MAX_SHARE_PATH_LENGTH,
  ICON_EMOJI_MAP,
  PRESET_SCENES,
  DEFAULT_VOTES_MAP,
};
