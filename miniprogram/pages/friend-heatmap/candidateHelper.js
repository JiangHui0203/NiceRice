const CANDIDATE_STORAGE_KEY = "life_helper_custom_candidates";
const CANDIDATE_BADGES = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"];
const CANDIDATE_SHARE_VERSION = 1;
const MAX_SHARED_CANDIDATES = 3;
const MAX_SHARED_QUERY_LENGTH = 850;
const MAX_CUSTOM_CANDIDATES = 20;

function normalizeCandidateList(value) {
  return Array.isArray(value)
    ? value.slice(0, MAX_CUSTOM_CANDIDATES)
      .filter((item) => item && typeof item === "object" && !Array.isArray(item))
    : [];
}

function getCandidateBadge(index) {
  return CANDIDATE_BADGES[index] || String(index + 1);
}

function buildCandidateDrawerState(coupons = [], storedCustomCandidates = []) {
  const validCoupons = normalizeCandidateList(coupons)
    .filter((coupon) => coupon.statusCode !== "used" && coupon.statusCode !== "expired")
    .slice(0, 6);
  const customCandidates = normalizeCandidateList(storedCustomCandidates);
  let badgeIndex = 0;

  const couponItems = validCoupons.map((coupon) => {
    const item = Object.assign({}, coupon, {
      badge: getCandidateBadge(badgeIndex),
      selected: coupon.selected !== undefined ? coupon.selected : true,
    });
    badgeIndex += 1;
    return item;
  });

  const customItems = customCandidates.map((candidate) => {
    const item = Object.assign({}, candidate, {
      badge: getCandidateBadge(badgeIndex),
      selected: candidate.selected !== undefined ? candidate.selected : true,
    });
    badgeIndex += 1;
    return item;
  });

  return {
    heatmapCandidates: couponItems,
    customCandidates: customItems,
    totalCandidateCount: couponItems.length + customItems.length,
    selectedCandidateCount: countSelectedCandidates(couponItems, customItems),
  };
}

function appendCustomCandidate(candidates = [], title, options = {}) {
  const normalizedTitle = String(title || "").trim().slice(0, 40);
  if (!normalizedTitle) {
    return { success: false, error: "请输入活动或餐厅名称" };
  }

  const list = normalizeCandidateList(candidates);
  if (list.length >= MAX_CUSTOM_CANDIDATES) {
    return { success: false, error: `最多添加 ${MAX_CUSTOM_CANDIDATES} 个自定义候选` };
  }
  if (list.some((candidate) => String(candidate.title || "").trim().toLowerCase() === normalizedTitle.toLowerCase())) {
    return { success: false, error: "该候选已在列表中" };
  }

  const now = typeof options.now === "function" ? options.now() : Date.now();
  const random = typeof options.random === "function" ? options.random() : Math.random();
  const candidate = {
    id: `custom_${now}_${random.toString(36).substring(2, 6)}`,
    title: normalizedTitle,
    selected: true,
  };
  return { success: true, candidate, candidates: list.concat(candidate) };
}

function removeCustomCandidate(candidates = [], id) {
  return normalizeCandidateList(candidates).filter((candidate) => candidate.id !== id);
}

function toggleCandidateSelection(candidates = [], id) {
  return normalizeCandidateList(candidates).map((candidate) => (
    candidate.id === id
      ? Object.assign({}, candidate, { selected: !candidate.selected })
      : candidate
  ));
}

function countSelectedCandidates(couponCandidates = [], customCandidates = []) {
  return normalizeCandidateList(couponCandidates).filter((candidate) => candidate.selected).length
    + normalizeCandidateList(customCandidates).filter((candidate) => candidate.selected).length;
}

function getCandidateVoteItems(couponCandidates = [], customCandidates = []) {
  const allItems = normalizeCandidateList(couponCandidates).concat(normalizeCandidateList(customCandidates));
  const selectedItems = allItems.filter((candidate) => candidate.selected);
  return selectedItems.length ? selectedItems : allItems;
}

function normalizeSharedText(value, maxLength) {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value).trim().slice(0, maxLength);
}

function normalizeSharedMoney(value) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount >= 0 && amount <= 1000000 ? amount : null;
}

function buildSharedSnapshot(item, sourceType) {
  if (!item || typeof item !== "object") return null;
  const title = normalizeSharedText(item.title, 40);
  if (!title) return null;

  const snapshot = { t: title, s: sourceType === "custom" ? "u" : "c" };
  if (snapshot.s === "u") return snapshot;

  const venue = normalizeSharedText(item.venue || item.merchantName, 40);
  const people = normalizeSharedText(item.people, 16);
  const expiresIn = normalizeSharedText(item.expiresIn, 24);
  const dishes = normalizeSharedText(item.dishes, 60);
  const type = normalizeSharedText(item.type, 20);
  const category = normalizeSharedText(item.category, 20);
  const platform = normalizeSharedText(item.platform, 20);
  const price = normalizeSharedMoney(item.price);
  const originalPrice = normalizeSharedMoney(item.originalPrice);
  if (venue) snapshot.v = venue;
  if (people && people !== "人数待补充") snapshot.n = people;
  if (expiresIn) snapshot.e = expiresIn;
  if (dishes) snapshot.d = dishes;
  if (type) snapshot.y = type;
  if (category) snapshot.c = category;
  if (platform && platform !== "平台待补充") snapshot.a = platform;
  if (price !== null) snapshot.p = price;
  if (originalPrice !== null) snapshot.o = originalPrice;
  return snapshot;
}

function encodeSharedCandidates(items) {
  const snapshots = items.slice(0, MAX_SHARED_CANDIDATES);
  const encode = () => encodeURIComponent(JSON.stringify({
    v: CANDIDATE_SHARE_VERSION,
    i: snapshots,
  }));
  let encoded = encode();

  // 微信分享 path 有长度限制：先移除长描述，再逐步压缩可选字段，
  // 最后减少候选数量；标题与候选类型始终保留。
  if (encoded.length > MAX_SHARED_QUERY_LENGTH) {
    snapshots.forEach((item) => { delete item.d; });
    encoded = encode();
  }
  if (encoded.length > MAX_SHARED_QUERY_LENGTH) {
    snapshots.forEach((item) => {
      ["e", "n", "o", "y", "c", "a"].forEach((key) => { delete item[key]; });
    });
    encoded = encode();
  }
  while (encoded.length > MAX_SHARED_QUERY_LENGTH && snapshots.length > 1) {
    snapshots.pop();
    encoded = encode();
  }
  if (encoded.length > MAX_SHARED_QUERY_LENGTH) {
    snapshots.forEach((item) => {
      Object.keys(item).forEach((key) => {
        if (key !== "t" && key !== "s") delete item[key];
      });
      item.t = item.t.slice(0, 24);
    });
    encoded = encode();
  }
  return encoded;
}

function decodeSharedPayload(rawValue) {
  if (typeof rawValue !== "string" || !rawValue || rawValue.length > 4000) return null;
  const attempts = [rawValue];
  let decoded = rawValue;
  for (let index = 0; index < 2; index += 1) {
    try {
      decoded = decodeURIComponent(decoded);
      if (!attempts.includes(decoded)) attempts.push(decoded);
    } catch (error) {
      break;
    }
  }
  for (const candidate of attempts) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object") return parsed;
    } catch (error) {}
  }
  return null;
}

function parseSharedCandidatePayload(rawValue) {
  const payload = decodeSharedPayload(rawValue);
  if (!payload || payload.v !== CANDIDATE_SHARE_VERSION
    || !Array.isArray(payload.i) || !payload.i.length
    || payload.i.length > MAX_SHARED_CANDIDATES) return null;

  const couponCandidates = [];
  const customCandidates = [];
  for (let index = 0; index < payload.i.length; index += 1) {
    const item = payload.i[index];
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const title = normalizeSharedText(item.t, 40);
    if (!title || (item.s !== "c" && item.s !== "u")) return null;

    const candidate = {
      id: `shared_${item.s}_${index}`,
      title,
      selected: true,
      isSharedCandidate: true,
    };
    if (item.s === "u") {
      customCandidates.push(candidate);
      continue;
    }

    const price = normalizeSharedMoney(item.p);
    const originalPrice = normalizeSharedMoney(item.o);
    Object.assign(candidate, {
      venue: normalizeSharedText(item.v, 40),
      people: normalizeSharedText(item.n, 16),
      expiresIn: normalizeSharedText(item.e, 24),
      dishes: normalizeSharedText(item.d, 60),
      type: normalizeSharedText(item.y, 20),
      category: normalizeSharedText(item.c, 20),
      platform: normalizeSharedText(item.a, 20),
      price: price === null ? "" : price,
      originalPrice: originalPrice === null ? "" : originalPrice,
      statusCode: "active",
    });
    couponCandidates.push(candidate);
  }

  return { couponCandidates, customCandidates };
}

function buildCandidateShareData(couponCandidates = [], customCandidates = []) {
  const items = getCandidateVoteItems(couponCandidates, customCandidates);
  const titles = items.map((item) => normalizeSharedText(item && item.title, 24)).filter(Boolean).slice(0, 3);
  const snapshots = normalizeCandidateList(couponCandidates)
    .filter((item) => item && item.selected)
    .map((item) => buildSharedSnapshot(item, "coupon"))
    .concat(normalizeCandidateList(customCandidates)
      .filter((item) => item && item.selected)
      .map((item) => buildSharedSnapshot(item, "custom")))
    .filter(Boolean);
  const fallbackSnapshots = snapshots.length ? snapshots : items.map((item) => (
    buildSharedSnapshot(item, customCandidates.includes(item) ? "custom" : "coupon")
  )).filter(Boolean);
  const encoded = fallbackSnapshots.length ? encodeSharedCandidates(fallbackSnapshots) : "";
  const shareTitle = titles.length > 0
    ? `🍔 约局投票：${titles.join(" vs ")} — 快来投票！`
    : "📊 一起添加约局候选方案";
  return {
    title: shareTitle.slice(0, 80),
    path: encoded
      ? `/pages/friend-heatmap/index?mode=candidates&candidates=${encoded}`
      : "/pages/friend-heatmap/index",
  };
}

function buildCandidateVoteText(items = []) {
  const candidates = normalizeCandidateList(items).filter((item) => normalizeSharedText(item.title, 40));
  if (!candidates.length) return "";

  let text = "📢 【有时好饭】聚餐与出行候选投票卡 — 大家来投吃/玩哪个？\n";
  text += "================================\n";
  candidates.forEach((item, index) => {
    const badge = getCandidateBadge(index);
    const title = normalizeSharedText(item.title, 40);
    const venue = normalizeSharedText(item.venue || item.merchantName, 40);
    const price = normalizeSharedMoney(item.price);
    const originalPrice = normalizeSharedMoney(item.originalPrice);
    const people = normalizeSharedText(item.people, 16).replace(/人+$/, "");
    const expiresIn = normalizeSharedText(item.expiresIn, 24);
    const dishes = normalizeSharedText(item.dishes, 60);
    text += `\n选项 ${badge}：${title}\n`;
    if (venue) {
      text += `   📍 店铺：${venue}\n`;
    }
    if (price !== null) {
      text += `   💰 实付 ¥${price}`;
      if (originalPrice !== null) text += ` (原价¥${originalPrice})`;
      text += "\n";
    }
    if (people) {
      text += `   👥 ${people && people !== "人数待补充" ? `适合 ${people}人` : "适用人数待补充"}`;
      if (expiresIn) text += ` · ⏰ ${expiresIn}`;
      text += "\n";
    }
    if (dishes) {
      const dishSummary = dishes.length > 30 ? `${dishes.slice(0, 30)}...` : dishes;
      text += `   🍽️ 菜品：${dishSummary}\n`;
    }
  });
  text += "\n================================\n";
  text += `请回复选项字母 (${candidates.map((item, index) => getCandidateBadge(index)).join(" / ")}) 投票！\n`;
  text += "来自小程序「有时好饭」🎯";
  return text;
}

module.exports = {
  CANDIDATE_STORAGE_KEY,
  appendCustomCandidate,
  buildCandidateDrawerState,
  buildCandidateShareData,
  buildCandidateVoteText,
  countSelectedCandidates,
  getCandidateVoteItems,
  parseSharedCandidatePayload,
  removeCustomCandidate,
  toggleCandidateSelection,
};
