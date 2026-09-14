const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

const SLOT_CONFIGS = {
  today_lunch: { offset: 0, startTime: "12:00", endTime: "13:30", scene: "午餐", label: "今天午餐" },
  today_dinner: { offset: 0, startTime: "18:30", endTime: "20:30", scene: "晚餐", label: "今天晚餐" },
  tomorrow_dinner: { offset: 1, startTime: "18:30", endTime: "20:30", scene: "晚餐", label: "明天晚餐" },
};

function buildSelectedTime(slotType, now = new Date()) {
  const sourceDate = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
  const targetDate = new Date(sourceDate.getTime());
  const config = SLOT_CONFIGS[slotType] || SLOT_CONFIGS.today_lunch;
  if (config.offset) targetDate.setDate(targetDate.getDate() + config.offset);

  const pad = (value) => String(value).padStart(2, "0");
  return {
    date: `${targetDate.getFullYear()}-${pad(targetDate.getMonth() + 1)}-${pad(targetDate.getDate())}`,
    weekday: WEEKDAYS[targetDate.getDay()],
    startTime: config.startTime,
    endTime: config.endTime,
    scene: config.scene,
    label: config.label,
  };
}

module.exports = {
  SLOT_CONFIGS,
  WEEKDAYS,
  buildSelectedTime,
};
