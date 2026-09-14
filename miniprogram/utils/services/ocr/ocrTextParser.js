/**
 * ocrTextParser.js
 * 纯文本优惠券特征提取引擎
 * 管道化提取 17 项卡券特征，消除多层 if 嵌套
 */

const pad = (val) => String(val).padStart(2, "0");
const MAX_OCR_TEXT_LENGTH = 12000;

function safeSourceText(value) {
  return typeof value === "string" ? value.slice(0, MAX_OCR_TEXT_LENGTH) : "";
}

function buildExactDate(yearValue, monthValue, dayValue) {
  const year = Number(yearValue);
  const month = Number(monthValue);
  const day = Number(dayValue);
  const date = new Date(year, month - 1, day);
  if (!Number.isInteger(year) || year < 2000 || year > 2099
    || date.getFullYear() !== year
    || date.getMonth() !== month - 1
    || date.getDate() !== day) return null;
  return { date, text: `${year}-${pad(month)}-${pad(day)}` };
}

const CATEGORY_MATCHERS = [
  { pattern: /火锅|涮/, type: "火锅" },
  { pattern: /烤肉|烧烤|烤鸭|烤串/, type: "烧烤" },
  { pattern: /饺子|包子|面|粉|拉面|米线|馄饨/, type: "粉面" },
  { pattern: /咖啡|奶茶|甜品|茶|星巴克|瑞幸|喜茶|奈雪|库迪/, type: "咖啡甜品" },
  { pattern: /展|馆|博物馆/, type: "展览" },
  { pattern: /公园|游船|户外|游玩|乐园/, type: "公园" },
  { pattern: /温泉|洗浴/, type: "温泉" },
];

const PLATFORM_MATCHERS = [
  { pattern: /美团/, platform: "美团" },
  { pattern: /抖音/, platform: "抖音" },
  { pattern: /大众点评|点评/, platform: "大众点评" },
  { pattern: /口碑|支付宝/, platform: "口碑" },
  { pattern: /小程序/, platform: "小程序" },
];

const DEFAULT_DURATION_MAP = {
  粉面: "60",
  咖啡甜品: "75",
  火锅: "150",
  烧烤: "150",
  展览: "150",
  公园: "180",
  温泉: "240",
};

function extractType(text) {
  const matched = CATEGORY_MATCHERS.find((m) => m.pattern.test(text));
  return matched ? matched.type : "其他";
}

function extractPlatform(text) {
  const matched = PLATFORM_MATCHERS.find((m) => m.pattern.test(text));
  return matched ? matched.platform : "美团";
}

function extractVenue(text) {
  text = safeSourceText(text);
  const explicitMatch = text.match(/(?:商户|商家|门店|店名|商铺)[:：]\s*([^\n\s，。；]+)/);
  if (explicitMatch) return explicitMatch[1].trim().slice(0, 120);

  const meituanMatch = text.match(/^([^\n营业距|]{3,50}?(?:店|烤鸭|饺子|酒楼|餐厅|馆|屋|坊|轩|阁|排档)[^\n营业距|]*?)(?=\s+(?:营业中|营业时间|距你|\||导航|\d+(?:\.\d+)?(?:km|m)))/m);
  if (meituanMatch) return meituanMatch[1].trim().slice(0, 120);

  const fallbackMatch = text.match(/^(.+?)(?=\s+(?:营业中|营业时间|距你|\||导航|\d+(?:\.\d+)?(?:km|m)))/m);
  if (fallbackMatch) return fallbackMatch[1].trim().slice(0, 120);

  // If no match yet, look for common shop suffix line
  const lines = text.split(/\n/).slice(0, 200).map((l) => l.trim().slice(0, 160)).filter(Boolean);
  const shopLine = lines.find((l) => /(?:店|烤鸭|饺子|酒楼|餐厅|馆|屋|坊|轩|阁|咖啡|铜锅|面馆|火锅|料理|烤肉)$/.test(l) || /（.+店）|\(.+店\)/.test(l));
  return (shopLine || "").slice(0, 120);
}

function extractAddress(text) {
  text = safeSourceText(text);
  const addrMatch = text.match(/(?:地址|地点)[:：]\s*([^\n]+)/);
  if (addrMatch) return addrMatch[1].trim().slice(0, 500);

  const mtAddrMatch = text.match(/(?:距你[\d.]+(?:km|m)\s*\|\s*([^.|\n\s]+))/) || text.match(/(?:\|\s*([^.|\n\s]+)\.\s*导航)/);
  return mtAddrMatch ? mtAddrMatch[1].trim().slice(0, 500) : "";
}

function extractTitle(text, venue, type) {
  if (venue) {
    const cleanVenue = venue.split(/[（(]/)[0].trim();
    return `${cleanVenue} ${type}餐`;
  }
  const firstLine = safeSourceText(text).split(/\n/).slice(0, 200).map((item) => item.trim()).filter(Boolean)[0];
  if (firstLine && firstLine.length <= 24) return firstLine;
  return `${type}券`;
}

function extractExpireDate(text) {
  text = safeSourceText(text);
  // 1. 标准年月日匹配：2026-08-30, 2026年8月30日
  const fullDate = text.match(/(20\d{2})[年./-](\d{1,2})[月./-](\d{1,2})/);
  if (fullDate) {
    const exact = buildExactDate(fullDate[1], fullDate[2], fullDate[3]);
    return exact ? exact.text : "";
  }

  // 2. 8位纯数字：20260830
  const eightDigit = text.match(/(20\d{2})(\d{2})(\d{2})/);
  if (eightDigit) {
    const exact = buildExactDate(eightDigit[1], eightDigit[2], eightDigit[3]);
    return exact ? exact.text : "";
  }

  // 3. 短月日：8月30日
  const shortDate = text.match(/(\d{1,2})[月./-](\d{1,2})/);
  if (!shortDate) return "";

  const m = Number(shortDate[1]);
  const d = Number(shortDate[2]);
  if (m < 1 || m > 12 || d < 1 || d > 31) return "";

  const year = new Date().getFullYear();
  const exact = buildExactDate(year, m, d);
  if (!exact) return "";
  const parsed = new Date(year, m - 1, d, 23, 59, 59, 999);

  // 如果解析出的日期已过去 30 天以上，推断为跨年到次年
  const isPastLongAgo = parsed < new Date() && (Date.now() - parsed.getTime()) > 30 * 24 * 60 * 60 * 1000;
  return `${isPastLongAgo ? year + 1 : year}-${pad(m)}-${pad(d)}`;
}

function extractUsableTime(text) {
  const timeMatch = safeSourceText(text).match(/(\d{1,2}:\d{2})\s*[-至到]\s*(\d{1,2}:\d{2})/);
  if (!timeMatch) return "";
  const normalizeClock = (value) => {
    const matched = value.match(/^(\d{1,2}):(\d{2})$/);
    if (!matched || Number(matched[1]) > 23 || Number(matched[2]) > 59) return "";
    return `${pad(Number(matched[1]))}:${pad(Number(matched[2]))}`;
  };
  const start = normalizeClock(timeMatch[1]);
  const end = normalizeClock(timeMatch[2]);
  return start && end && start !== end ? `${start}-${end}` : "";
}

function extractTravelTime(text) {
  const travelMatch = text.match(/(\d{1,3})\s*分钟/);
  return travelMatch ? `${travelMatch[1]}分钟` : "";
}

function extractPrice(text) {
  const priceMatch = text.match(/[¥￥]\s*(\d+(?:\.\d+)?)/)
    || text.match(/(?:价格|实付|支付|金额|应付|售价)[:：]?\s*(\d+(?:\.\d+)?)/)
    || text.match(/(\d+(?:\.\d+)?)\s*元/);
  return priceMatch ? priceMatch[1] : "";
}

function extractDurationMinutes(text, type) {
  const durationMatch = safeSourceText(text).match(/(?:耗时|用时|时长)[:：]?\s*(\d+)\s*(分钟|分|小时)/);
  if (durationMatch) {
    const minutes = Number(durationMatch[1]) * (durationMatch[2] === "小时" ? 60 : 1);
    return Number.isFinite(minutes) && minutes >= 1 && minutes <= 10080
      ? String(minutes)
      : (DEFAULT_DURATION_MAP[type] || "120");
  }
  return DEFAULT_DURATION_MAP[type] || "120";
}

function extractNote(text) {
  const noteMatch = safeSourceText(text).match(/(?:备注|规则|说明)[:：]\s*([^\n]+)/);
  return noteMatch ? noteMatch[1].trim().slice(0, 1000) : "";
}

function extractDishes(text) {
  const lines = safeSourceText(text).split(/\n/).slice(0, 200).map((l) => l.trim().slice(0, 160)).filter(Boolean);
  const dishesLines = [];
  let isCollecting = false;

  for (const line of lines) {
    if (/套餐内容|套餐明细|包含项目|包含内容|商品明细|团购详情/.test(line)) {
      isCollecting = true;
      continue;
    }
    if (isCollecting && /使用规则|购买须知|温馨提示|注意事项|使用说明|商家服务/.test(line)) {
      break;
    }
    if (isCollecting) {
      if (dishesLines.length < 100) dishesLines.push(line);
    }
  }

  if (dishesLines.length > 0) return dishesLines.join("、").slice(0, 150);

  const qtyLines = lines.filter((line) => /[1-9]份|[1-9]瓶|[1-9]碗|[1-9]个|[1-9]杯|[1-9]盘|[1-9]位|[1-9]客|[1-9]张/.test(line));
  return qtyLines.length > 0 ? qtyLines.join("、").slice(0, 150) : "";
}

function extractRuleNotes(text) {
  text = safeSourceText(text);
  const ruleMatch = text.match(/(?:使用规则|规则|限制)[:：]\s*([^\n]+)/);
  if (ruleMatch) return ruleMatch[1].trim().slice(0, 1000);

  const hints = [];
  if (/周末不可用/.test(text)) hints.push("周末不可用");
  if (/节假日不可用/.test(text)) hints.push("节假日不可用");
  if (/仅限/.test(text)) hints.push("存在门店限制");
  if (/不可退|不退/.test(text)) hints.push("可能不可退款");
  return hints.join("；");
}

function extractReservationInfo(text) {
  const leadMatch = text.match(/提前\s*(\d+)\s*(小时|h|H)/);
  const reservationLeadTimeHours = leadMatch ? leadMatch[1] : "0";
  const reservationRequired = /预约|提前订/.test(text) && !/免预约|无需预约/.test(text);
  return { reservationRequired, reservationLeadTimeHours };
}

function extractPeople(text) {
  if (/多人|四人|4人|3-4人/.test(text)) return "多人";
  if (/三人|3人/.test(text)) return "3-4人";
  if (/双人|2人/.test(text)) return "2人";
  return "1人";
}

function extractRefundType(text) {
  if (/不可退|不退/.test(text)) return "non_refundable";
  if (/自动退/.test(text)) return "auto";
  if (/手动退/.test(text)) return "manual";
  return "unknown";
}

function parseCouponText(text) {
  const sourceText = safeSourceText(text);
  if (!sourceText.trim()) return { success: false, message: "文本为空" };

  const type = extractType(sourceText);
  const platform = extractPlatform(sourceText);
  const venue = extractVenue(sourceText);
  const address = extractAddress(sourceText);
  const title = extractTitle(sourceText, venue, type).slice(0, 120);
  const expireDate = extractExpireDate(sourceText);
  const usableTime = extractUsableTime(sourceText);
  const travelTime = extractTravelTime(sourceText);
  const price = extractPrice(sourceText).slice(0, 32);
  const durationMinutes = extractDurationMinutes(sourceText, type);
  const note = extractNote(sourceText);
  const dishes = extractDishes(sourceText);
  const ruleNotes = extractRuleNotes(sourceText);
  const { reservationRequired, reservationLeadTimeHours } = extractReservationInfo(sourceText);
  const people = extractPeople(sourceText);
  const refundType = extractRefundType(sourceText);

  return {
    success: true,
    title,
    venue,
    type,
    platform,
    reservationRequired,
    people,
    expireDate,
    usableTime,
    address,
    travelTime,
    durationMinutes,
    price,
    note,
    dishes,
    ruleNotes,
    reservationLeadTimeHours,
    refundType,
    source: "local-parser",
    rawText: sourceText,
  };
}

module.exports = {
  extractType,
  extractPlatform,
  extractVenue,
  extractAddress,
  extractTitle,
  extractExpireDate,
  extractUsableTime,
  extractTravelTime,
  extractPrice,
  extractDurationMinutes,
  extractNote,
  extractDishes,
  extractRuleNotes,
  extractReservationInfo,
  extractPeople,
  extractRefundType,
  parseCouponText,
};
