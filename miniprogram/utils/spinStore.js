const couponStore = require("./couponStore.js");
const planStore = require("./planStore.js");
const recommendation = require("./recommendation.js");
const privacyService = require("./privacyService.js");
const { isActivePlanStatus } = require("./plan/planStatus.js");

const SPIN_KEY = "life_helper_food_wheel";
const MAX_CUSTOM_CANDIDATES = 200;
const MAX_DISABLED_IDS = 500;
const MAX_HISTORY = 20;
const MAX_CANDIDATE_ID_LENGTH = 128;
const RESERVED_IDS = new Set(["__proto__", "constructor", "prototype"]);

const DEFAULT_CUSTOMS = ["拉面", "烧烤", "食堂", "外卖", "随便吃点"];
const CATEGORY_LABELS = {
  food: "美食",
  drink: "饮品",
  play: "娱乐",
  outdoor: "户外",
  life: "生活",
  other: "其他",
};

function clipText(value, maxLength = 80) {
  return String(value === undefined || value === null ? "" : value).trim().slice(0, maxLength);
}

function exactId(value, maxLength = MAX_CANDIDATE_ID_LENGTH) {
  if (typeof value !== "string") return "";
  const id = value.trim();
  return id && id === value && Array.from(id).length <= maxLength && !RESERVED_IDS.has(id)
    ? id
    : "";
}

function exactInputText(value, maxLength) {
  if (typeof value !== "string") return "";
  const text = value.trim();
  return text && Array.from(text).length <= maxLength ? text : "";
}

function normalizeStoredCandidate(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const id = exactId(item.id);
  const title = clipText(item.title, 80);
  if (!id || !title) return null;
  const weight = Number(item.weight);
  return {
    id,
    source: "custom",
    title,
    enabled: item.enabled !== false,
    weight: Number.isFinite(weight) ? Math.max(1, Math.min(10, weight)) : 2,
    createdAt: clipText(item.createdAt, 40),
  };
}

function normalizeHistoryRecord(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const title = clipText(item.title, 80);
  if (!title) return null;
  const id = item.id ? exactId(item.id) : "";
  const couponId = item.couponId ? exactId(item.couponId, 96) : "";
  if ((item.id && !id) || (item.couponId && !couponId)) return null;
  const score = Number(item.score);
  const weight = Number(item.weight);
  return {
    id,
    source: item.source === "coupon" ? "coupon" : "custom",
    couponId,
    title,
    subtitle: clipText(item.subtitle, 120),
    reason: clipText(item.reason, 160),
    reasons: (Array.isArray(item.reasons) ? item.reasons : [])
      .map((entry) => clipText(entry, 160)).filter(Boolean).slice(0, 10),
    score: Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : 0,
    level: clipText(item.level, 32),
    categoryKey: clipText(item.categoryKey, 32),
    categoryLabel: clipText(item.categoryLabel, 48),
    stateClass: clipText(item.stateClass, 32),
    tags: (Array.isArray(item.tags) ? item.tags : [])
      .map((entry) => clipText(entry, 32)).filter(Boolean).slice(0, 10),
    weight: Number.isFinite(weight) ? Math.max(1, Math.min(10, weight)) : 1,
    enabled: item.enabled !== false,
    blocked: item.blocked === true,
    selectedAt: clipText(item.selectedAt, 40),
    timeText: clipText(item.timeText, 48),
  };
}

function readState() {
  try {
    const stored = privacyService.readLocalData(SPIN_KEY, {});
    const state = stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
    const defaultCandidates = DEFAULT_CUSTOMS.map((title, index) => ({
      id: `custom_default_${index}`,
      title,
      source: "custom",
      enabled: true,
      weight: 2,
      createdAt: "",
    }));
    const customCandidates = (Array.isArray(state.customCandidates)
      ? state.customCandidates
      : defaultCandidates).slice(0, MAX_CUSTOM_CANDIDATES).map(normalizeStoredCandidate).filter(Boolean);
    const history = (Array.isArray(state.history) ? state.history : [])
      .slice(0, MAX_HISTORY).map(normalizeHistoryRecord).filter(Boolean);
    return {
      customCandidates,
      disabledIds: [...new Set((Array.isArray(state.disabledIds) ? state.disabledIds : [])
        .map((item) => exactId(item)).filter(Boolean))]
        .slice(0, MAX_DISABLED_IDS),
      lastResult: normalizeHistoryRecord(state.lastResult),
      history,
    };
  } catch (e) {
    return {
      customCandidates: [],
      disabledIds: [],
      lastResult: null,
      history: [],
    };
  }
}

function writeState(state) {
  const success = privacyService.writeLocalData(SPIN_KEY, state || {});
  if (!success) console.warn("spin storage failed");
  return Boolean(success);
}

function isAvailableCoupon(coupon) {
  if (!coupon) return false;
  const status = coupon.statusCode || coupon.status;
  if (status === "draft" || status === "planned" || status === "used" || status === "expired") {
    return false;
  }
  if (typeof coupon.days === "number" && coupon.days < 0) {
    return false;
  }
  return true;
}

function getWeightFromRecommendation(rec, coupon) {
  if (!rec || rec.level === "blocked") return 0;
  let weight = Math.max(1, Math.ceil((rec.score || coupon.score || 60) / 25));
  if (coupon.stateClass === "urgent") weight += 2;
  if (coupon.refundInfo && coupon.refundInfo.refundType === "non_refundable") weight += 1;
  return Math.min(6, weight);
}

function getCouponCategory(coupon = {}) {
  const key = coupon.category || "other";
  return {
    key,
    label: CATEGORY_LABELS[key] || CATEGORY_LABELS.other,
  };
}

function inferCustomCategory(title) {
  const text = String(title || "");
  if (/咖啡|奶茶|茶|饮料|果汁|酒/.test(text)) return { key: "drink", label: CATEGORY_LABELS.drink };
  if (/电影|展|馆|博物馆|唱歌|KTV|密室|桌游|游戏/.test(text)) return { key: "play", label: CATEGORY_LABELS.play };
  if (/公园|爬山|露营|游船|徒步|户外/.test(text)) return { key: "outdoor", label: CATEGORY_LABELS.outdoor };
  if (/温泉|按摩|洗浴|美甲|理发/.test(text)) return { key: "life", label: CATEGORY_LABELS.life };
  if (/饭|面|粉|火锅|烧烤|烤肉|拉面|外卖|食堂|披萨|汉堡|寿司|麻辣烫|饺子|包子|粥|小吃|吃/.test(text)) {
    return { key: "food", label: CATEGORY_LABELS.food };
  }
  return { key: "other", label: CATEGORY_LABELS.other };
}

function buildCouponCandidate(coupon, disabledIds, context, precomputedRecommendation = null) {
  const rec = precomputedRecommendation || recommendation.generateRecommendation(coupon, context);
  const id = `coupon_${coupon.id}`;
  const blocked = rec.level === "blocked";
  const tags = (coupon.tags || []).slice(0, 5);
  const category = getCouponCategory(coupon);
  return {
    id,
    source: "coupon",
    couponId: coupon.id,
    title: coupon.title,
    subtitle: `${coupon.expiresIn} · ${coupon.travelTime || "路程待估算"}`,
    reason: rec.blockers[0] || rec.reasons[0] || coupon.shortReason || "可作为候选",
    score: rec.score,
    level: rec.level,
    categoryKey: category.key,
    categoryLabel: category.label,
    stateClass: coupon.stateClass || (rec.level === "high" ? "priority" : "ready"),
    tags: tags.slice(0, 3),
    weight: getWeightFromRecommendation(rec, coupon),
    enabled: disabledIds.indexOf(id) === -1 && !blocked,
    blocked,
  };
}

function normalizeCustom(item, disabledIds) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const id = exactId(item.id);
  const title = String(item.title || "").trim().slice(0, 80);
  if (!id || !title) return null;
  const category = inferCustomCategory(title);
  const rawWeight = Number(item.weight);
  return {
    id,
    source: "custom",
    title,
    subtitle: "自定义想法",
    reason: "手动加入转盘",
    score: 60,
    level: "custom",
    categoryKey: category.key,
    categoryLabel: category.label,
    stateClass: "ready",
    tags: ["自定义"],
    weight: Number.isFinite(rawWeight) ? Math.max(1, Math.min(10, rawWeight)) : 2,
    enabled: disabledIds.indexOf(id) === -1 && item.enabled !== false,
    blocked: false,
  };
}

function getCandidates(options = {}) {
  const settings = options && typeof options === "object" && !Array.isArray(options) ? options : {};
  const state = readState();
  const plans = Array.isArray(settings.plans) ? settings.plans : planStore.getPlans();
  const allCoupons = Array.isArray(settings.coupons) ? settings.coupons : couponStore.getAllCoupons();
  const context = settings.context || recommendation.buildRecommendationContext({
    existingPlans: plans,
    allCoupons,
  });
  const precomputedByCouponId = new Map(
    (Array.isArray(settings.precomputedRecommendations) ? settings.precomputedRecommendations : [])
      .filter((item) => item && item.couponId)
      .map((item) => [item.couponId, item]),
  );
  const activeCouponIds = new Set(
    plans.filter((plan) => plan && plan.couponId && isActivePlanStatus(plan.statusCode))
      .map((plan) => plan.couponId),
  );
  const coupons = allCoupons
    .filter(isAvailableCoupon)
    .filter((coupon) => !activeCouponIds.has(coupon.id))
    .map((coupon) => buildCouponCandidate(
      coupon,
      state.disabledIds,
      context,
      precomputedByCouponId.get(coupon.id) || null,
    ));
  const customs = state.customCandidates
    .map((item) => normalizeCustom(item, state.disabledIds))
    .filter(Boolean);
  return coupons.concat(customs);
}

function getSummary(options = {}) {
  const settings = options && typeof options === "object" && !Array.isArray(options) ? options : {};
  if (Array.isArray(settings.precomputedRecommendations)
    && Array.isArray(settings.coupons)
    && Array.isArray(settings.plans)) {
    const state = readState();
    const disabledIds = new Set(state.disabledIds || []);
    const activeCouponIds = new Set(
      settings.plans
        .filter((plan) => plan && plan.couponId && isActivePlanStatus(plan.statusCode))
        .map((plan) => plan.couponId),
    );
    const recommendationByCouponId = new Map(
      settings.precomputedRecommendations
        .filter((item) => item && item.couponId)
        .map((item) => [item.couponId, item]),
    );
    const availableCoupons = settings.coupons
      .filter(isAvailableCoupon)
      .filter((coupon) => !activeCouponIds.has(coupon.id));
    const customCandidates = state.customCandidates
      .map((item) => normalizeCustom(item, state.disabledIds))
      .filter(Boolean);
    const topTitles = [];
    let enabled = 0;
    availableCoupons.forEach((coupon) => {
      const rec = recommendationByCouponId.get(coupon.id);
      const candidateId = `coupon_${coupon.id}`;
      if (!rec || rec.level === "blocked" || disabledIds.has(candidateId)) return;
      enabled += 1;
      if (topTitles.length < 3) topTitles.push(coupon.title);
    });
    customCandidates.forEach((candidate) => {
      if (!candidate.enabled || candidate.blocked) return;
      enabled += 1;
      if (topTitles.length < 3) topTitles.push(candidate.title);
    });
    return {
      total: availableCoupons.length + customCandidates.length,
      enabled,
      couponCount: availableCoupons.length,
      customCount: customCandidates.length,
      topTitles: topTitles.join("、") || "先添加候选",
    };
  }
  const candidates = getCandidates(options);
  const enabled = candidates.filter((item) => item.enabled && !item.blocked);
  return {
    total: candidates.length,
    enabled: enabled.length,
    couponCount: candidates.filter((item) => item.source === "coupon").length,
    customCount: candidates.filter((item) => item.source === "custom").length,
    topTitles: enabled.slice(0, 3).map((item) => item.title).join("、") || "先添加候选",
  };
}

function addCustomCandidate(title) {
  const value = exactInputText(title, 80);
  if (!value) return null;
  const state = readState();
  if (state.customCandidates.length >= MAX_CUSTOM_CANDIDATES) return null;
  if (state.customCandidates.some((item) => item.title.toLocaleLowerCase() === value.toLocaleLowerCase())) return null;
  const candidate = {
    id: `custom_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    source: "custom",
    title: value,
    enabled: true,
    weight: 2,
    createdAt: new Date().toISOString(),
  };
  state.customCandidates.unshift(candidate);
  return writeState(state) ? candidate : null;
}

function removeCustomCandidate(id) {
  const targetId = exactId(id);
  if (!targetId) return false;
  const state = readState();
  state.customCandidates = state.customCandidates.filter((item) => item.id !== targetId);
  state.disabledIds = state.disabledIds.filter((item) => item !== targetId);
  return writeState(state);
}

function clearCustomCandidates() {
  const state = readState();
  const customIds = new Set((state.customCandidates || []).map((item) => item.id).filter(Boolean));
  state.customCandidates = [];
  state.disabledIds = (state.disabledIds || []).filter((id) => !customIds.has(id) && !String(id).startsWith("custom_"));
  return writeState(state);
}

function setCandidateEnabled(id, enabled) {
  const targetId = exactId(id);
  if (!targetId) return false;
  const state = readState();
  const disabled = state.disabledIds.filter((item) => item !== targetId);
  if (!enabled && disabled.length < MAX_DISABLED_IDS) disabled.push(targetId);
  state.disabledIds = disabled.slice(0, MAX_DISABLED_IDS);
  return writeState(state);
}

function setCandidatesEnabled(ids = [], enabled) {
  if (!Array.isArray(ids) || !ids.length || ids.length > MAX_DISABLED_IDS) return false;
  const normalizedIds = ids.map((item) => exactId(item));
  if (normalizedIds.some((id) => !id) || new Set(normalizedIds).size !== normalizedIds.length) return false;
  const targets = new Set(normalizedIds);
  const state = readState();
  const disabled = (state.disabledIds || []).filter((id) => !targets.has(id));
  if (!enabled) targets.forEach((id) => disabled.push(id));
  state.disabledIds = [...new Set(disabled)];
  if (state.disabledIds.length > MAX_DISABLED_IDS) return false;
  return writeState(state);
}

function replaceCustomCandidates(titles = []) {
  if (!Array.isArray(titles) || titles.length > MAX_CUSTOM_CANDIDATES) return false;
  const seenTitles = new Set();
  const values = titles.reduce((result, title) => {
    const value = exactInputText(title, 80);
    const key = value.toLocaleLowerCase();
    if (!value || seenTitles.has(key)) return result;
    seenTitles.add(key);
    result.push(value);
    return result;
  }, []);
  if (values.length !== titles.length) return false;
  const state = readState();
  const previousCustomIds = new Set((state.customCandidates || []).map((item) => item.id).filter(Boolean));
  const now = Date.now();
  state.customCandidates = values.map((title, index) => ({
    id: `custom_${now}_${index}_${Math.random().toString(36).slice(2, 6)}`,
    source: "custom",
    title,
    enabled: true,
    weight: 2,
    createdAt: new Date(now).toISOString(),
  }));
  state.disabledIds = (state.disabledIds || []).filter((id) => (
    !previousCustomIds.has(id) && !String(id).startsWith("custom_")
  ));
  return writeState(state);
}

function saveLastResult(candidate) {
  const normalizedCandidate = normalizeHistoryRecord(candidate);
  if (!normalizedCandidate) return null;
  const state = readState();
  const pad = (n) => String(n).padStart(2, "0");
  const now = new Date();
  const timeText = `${now.getMonth() + 1}月${now.getDate()}日 ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const record = Object.assign({}, normalizedCandidate, {
    selectedAt: now.toISOString(),
    timeText,
  });
  state.lastResult = record;
  if (!Array.isArray(state.history)) state.history = [];
  state.history.unshift(record);
  if (state.history.length > MAX_HISTORY) state.history = state.history.slice(0, MAX_HISTORY);
  return writeState(state) ? record : null;
}

function getSpinHistory() {
  return readState().history || [];
}

function clearSpinHistory() {
  const state = readState();
  state.history = [];
  return writeState(state);
}

function pickCandidate(candidates, mode = "weighted") {
  const enabled = (Array.isArray(candidates) ? candidates : [])
    .filter((item) => item && item.enabled && !item.blocked && item.weight > 0);
  if (!enabled.length) return null;
  if (mode === "random") {
    return enabled[Math.floor(Math.random() * enabled.length)];
  }
  const total = enabled.reduce((sum, item) => sum + item.weight, 0);
  let random = Math.random() * total;
  for (let index = 0; index < enabled.length; index += 1) {
    random -= enabled[index].weight;
    if (random <= 0) return enabled[index];
  }
  return enabled[enabled.length - 1];
}

module.exports = {
  addCustomCandidate,
  clearCustomCandidates,
  getCandidates,
  getSummary,
  getSpinHistory,
  clearSpinHistory,
  pickCandidate,
  removeCustomCandidate,
  saveLastResult,
  setCandidatesEnabled,
  setCandidateEnabled,
  replaceCustomCandidates,
};
