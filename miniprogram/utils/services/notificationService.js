const SUBSCRIPTION_TEMPLATE_KEY = "life_helper_subscription_templates";
const NOTIFICATION_LOG_KEY = "life_helper_notification_logs";
const privacyService = require("../privacyService.js");
const cloudService = require("./cloudService.js");
const { getWx } = require("../wechatRuntime.js");
const { normalizeExactId } = require("../idUtils.js");

const DEFAULT_TEMPLATE_IDS = {
  couponExpiring: "",
  planDeparture: "",
  friendPending: "",
  reservation: "",
  weatherChanged: "",
};

function boundedText(value, maxLength) {
  return String(value === undefined || value === null ? "" : value).trim().slice(0, maxLength);
}

function sanitizeLogValue(value, depth = 0) {
  if (typeof value === "string") return boundedText(value, 300);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean" || value === null) return value;
  if (depth >= 3) return undefined;
  if (Array.isArray(value)) return value.slice(0, 20)
    .map((item) => sanitizeLogValue(item, depth + 1)).filter((item) => item !== undefined);
  if (!value || typeof value !== "object") return undefined;
  const result = {};
  Object.keys(value).slice(0, 20).forEach((rawKey) => {
    const key = boundedText(rawKey, 48);
    if (!key || ["__proto__", "constructor", "prototype"].includes(key)) return;
    const normalized = sanitizeLogValue(value[rawKey], depth + 1);
    if (normalized !== undefined) result[key] = normalized;
  });
  return result;
}

function normalizeNotificationLog(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  return Object.assign(sanitizeLogValue(item), {
    type: boundedText(item.type, 64) || "unknown",
    planId: boundedText(item.planId, 96),
    createdAt: boundedText(item.createdAt, 40),
  });
}

function normalizeTemplateIds(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return Object.keys(DEFAULT_TEMPLATE_IDS).reduce((result, key) => {
    const raw = source[key];
    result[key] = typeof raw === "string" || typeof raw === "number"
      ? String(raw).trim().slice(0, 128)
      : "";
    return result;
  }, {});
}

function getTemplateIds() {
  try {
    return normalizeTemplateIds(privacyService.readLocalData(SUBSCRIPTION_TEMPLATE_KEY, {}));
  } catch (e) {
    return Object.assign({}, DEFAULT_TEMPLATE_IDS);
  }
}

function saveTemplateIds(templateIds) {
  const saved = privacyService.writeLocalData(
    SUBSCRIPTION_TEMPLATE_KEY,
    normalizeTemplateIds(Object.assign({}, getTemplateIds(), templateIds))
  );
  if (!saved) console.warn("template storage failed");
  return saved;
}

function writeNotificationLog(item) {
  try {
    const stored = privacyService.readLocalData(NOTIFICATION_LOG_KEY, []);
    const logs = (Array.isArray(stored) ? stored.slice(0, 79) : [])
      .map(normalizeNotificationLog).filter(Boolean);
    logs.unshift(normalizeNotificationLog(Object.assign({}, item, { createdAt: new Date().toISOString() })));
    if (!privacyService.writeLocalData(NOTIFICATION_LOG_KEY, logs.slice(0, 80))) {
      console.warn("notification log storage failed");
    }
  } catch (e) {
    console.warn("notification log failed", e);
  }
}

function toRuntimeError(error, fallbackMessage) {
  if (error instanceof Error) return error;
  const normalized = new Error(
    (error && (error.message || error.errMsg)) || fallbackMessage || "操作失败"
  );
  if (error && error.code) normalized.code = error.code;
  return normalized;
}

function buildPlanNotifications(plan) {
  const source = plan && typeof plan === "object" ? plan : {};
  const planId = String(source.id || "plan").trim().slice(0, 96) || "plan";
  return (Array.isArray(source.reminders) ? source.reminders : [])
    .slice(0, 20)
    .map((item, index) => {
      const rawText = typeof item === "string"
        ? item
        : (item && (item.text || item.message || item.label));
      return {
        id: `${planId}_notice_${index}`,
        type: index === 0 ? "departure" : "plan",
        text: String(rawText || "").trim().slice(0, 160),
        status: "placeholder",
      };
    })
    .filter((item) => Boolean(item.text));
}

function getPlanTemplateTypes(plan) {
  if (!plan) return ["planDeparture"];
  const types = ["planDeparture"];
  if (plan.statusCode === "pending") types.push("friendPending");
  if (plan.needReservation && plan.reservationStatus !== "confirmed") types.push("reservation");
  return types;
}

function requestPlanSubscriptions(plan) {
  const api = getWx();
  const safePlan = plan || {};
  const templateIds = getTemplateIds();
  const tmplIds = [...new Set(
    getPlanTemplateTypes(safePlan).map((type) => templateIds[type]).filter(Boolean)
  )];
  if (!tmplIds.length) {
    return Promise.resolve({
      success: false,
      code: "missing_template",
      message: "还没有配置订阅消息模板 ID",
    });
  }
  if (!api || typeof api.requestSubscribeMessage !== "function") {
    return Promise.resolve({
      success: false,
      code: "unsupported",
      message: "当前环境不支持订阅消息",
    });
  }
  return new Promise((resolve) => {
    try {
      api.requestSubscribeMessage({
        tmplIds,
        success(res) {
          writeNotificationLog({ type: "subscribe_request", planId: safePlan.id || "", result: res });
          const acceptedIds = tmplIds.filter((id) => res && res[id] === "accept");
          const rejectedIds = tmplIds.filter((id) => !res || res[id] !== "accept");
          if (!acceptedIds.length) {
            resolve({
              success: false,
              code: "subscription_rejected",
              message: "未开启提醒，可稍后再次授权",
              result: res,
              rejectedIds,
            });
            return;
          }
          resolve({
            success: true,
            partial: rejectedIds.length > 0,
            message: rejectedIds.length ? "已开启部分提醒" : "已开启提醒",
            result: res,
            acceptedIds,
            rejectedIds,
          });
        },
        fail(error) {
          writeNotificationLog({ type: "subscribe_request_failed", planId: safePlan.id || "", error });
          resolve({
            success: false,
            code: "subscription_request_failed",
            message: "提醒授权失败，请稍后重试",
            error,
          });
        },
      });
    } catch (error) {
      writeNotificationLog({ type: "subscribe_request_failed", planId: safePlan.id || "", error });
      resolve({
        success: false,
        code: "subscription_request_failed",
        message: "提醒授权失败，请稍后重试",
        error,
      });
    }
  });
}

function sendSubscribeMessage(payload) {
  const api = getWx();
  if (!privacyService.isCloudUploadAllowed()) {
    const result = { success: false, code: "privacy_local_only", message: "隐私模式下不会把计划内容发送到云端触发订阅消息。" };
    writeNotificationLog({ type: "subscribe_send_blocked", payload, result });
    return Promise.resolve(result);
  }
  const cloudError = cloudService.getCloudUnavailableError("订阅消息发送");
  if (cloudError) {
    const result = { success: false, code: cloudError.code, message: cloudError.message };
    writeNotificationLog({ type: "subscribe_send_blocked", payload, result });
    return Promise.resolve(result);
  }
  if (!api || !api.cloud || typeof api.cloud.callFunction !== "function") {
    return Promise.resolve({ success: false, code: "unsupported" });
  }
  return new Promise((resolve) => {
    try {
      api.cloud.callFunction({
        name: "lifeServices",
        data: {
          type: "sendSubscribeMessage",
          data: payload,
        },
        success(res) {
          const result = res && res.result || {};
          writeNotificationLog({ type: "subscribe_send", payload, result });
          resolve(result);
        },
        fail(error) {
          writeNotificationLog({ type: "subscribe_send_failed", payload, error });
          resolve({ success: false, code: "subscribe_send_failed", error });
        },
      });
    } catch (error) {
      writeNotificationLog({ type: "subscribe_send_failed", payload, error });
      resolve({ success: false, code: "subscribe_send_failed", error });
    }
  });
}

function parseCalendarDate(dateValue) {
  const matched = String(dateValue || "").trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (!matched) return null;
  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const day = Number(matched[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return { year, month, day };
}

function parseCalendarTime(timeValue) {
  const matched = String(timeValue || "").trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!matched) return null;
  const hour = Number(matched[1]);
  const minute = Number(matched[2]);
  const second = Number(matched[3] || 0);
  if (hour > 23 || minute > 59 || second > 59) return null;
  return { hour, minute, second };
}

function buildCalendarDate(dateParts, timeParts) {
  if (!dateParts || !timeParts) return null;
  return new Date(
    dateParts.year,
    dateParts.month - 1,
    dateParts.day,
    timeParts.hour,
    timeParts.minute,
    timeParts.second
  );
}

function addPlanToPhoneCalendar(plan) {
  const api = getWx();
  if (!api || typeof api.addPhoneCalendar !== "function") {
    return Promise.reject(new Error("当前环境不支持加入系统日历"));
  }
  const sourcePlan = plan || {};
  const selectedTime = sourcePlan.selectedTime || {};
  const dateParts = parseCalendarDate(selectedTime.date || sourcePlan.date);
  const startTimeParts = parseCalendarTime(selectedTime.startTime || sourcePlan.time);
  if (!dateParts || !startTimeParts) {
    return Promise.reject(new Error("计划日期或开始时间不完整，暂不能加入日历"));
  }
  const start = buildCalendarDate(dateParts, startTimeParts);

  let end;
  if (selectedTime.endTime) {
    const endTimeParts = parseCalendarTime(selectedTime.endTime);
    if (!endTimeParts) {
      return Promise.reject(new Error("计划结束时间格式不正确"));
    }
    end = buildCalendarDate(dateParts, endTimeParts);
    if (end.getTime() === start.getTime()) {
      return Promise.reject(new Error("计划开始和结束时间不能相同"));
    }
    if (end.getTime() < start.getTime()) {
      end = new Date(end.getTime() + 24 * 60 * 60 * 1000);
    }
  } else {
    const storedDuration = Number(
      sourcePlan.durationMinutes
      || (sourcePlan.timeBlock && sourcePlan.timeBlock.actTime)
    );
    if (!Number.isFinite(storedDuration) || storedDuration <= 0 || storedDuration > 24 * 60) {
      return Promise.reject(new Error("计划缺少结束时间或预计时长，暂不能加入日历"));
    }
    end = new Date(start.getTime() + storedDuration * 60 * 1000);
  }

  const calendarDurationMinutes = Math.round((end.getTime() - start.getTime()) / (60 * 1000));

  const safeTitle = boundedText(sourcePlan.title, 80) || "就餐安排";
  const safeLocationText = boundedText(
    sourcePlan.locationText || (sourcePlan.location
      ? `${boundedText(sourcePlan.location.name, 80)} ${boundedText(sourcePlan.location.address, 180)}`.trim()
      : ""),
    220,
  );
  const description = [
    `活动名称：${safeTitle}`,
    calendarDurationMinutes > 0 ? `日历时段：${calendarDurationMinutes} 分钟` : "",
    safeLocationText ? `活动地点：${safeLocationText}` : "",
    sourcePlan.reservationText ? `预约信息：${boundedText(sourcePlan.reservationText, 160)}` : "",
    (Array.isArray(sourcePlan.reminders) ? sourcePlan.reminders : [])
      .slice(0, 20)
      .map((r) => (typeof r === "string" ? r : (r && (r.text || r.message || r.label)) || ""))
      .map((item) => boundedText(item, 160)).filter(Boolean)
      .join("；"),
    "来自「有时好饭」智能餐饮生活助手",
  ].filter(Boolean).join("\n");

  return new Promise((resolve, reject) => {
    api.addPhoneCalendar({
      title: `【有时好饭】${safeTitle}`,
      startTime: Math.floor(start.getTime() / 1000),
      endTime: Math.floor(end.getTime() / 1000),
      location: safeLocationText,
      description,
      alarm: true,
      alarmOffset: 3600, // 提前 1 小时响铃提醒
      success: resolve,
      fail: reject,
    });
  });
}

function addPlanToCalendar(plan) {
  return addPlanToPhoneCalendar(plan)
    .then(() => ({
      mode: "system_calendar",
      message: `已成功将「${(plan && plan.title) || "计划"}」写入手机系统日历，将在出发前自动提醒！`,
    }))
    .catch((calendarError) => {
      const sourcePlan = plan || {};
      const selectedTime = sourcePlan.selectedTime || {};
      const timeStr = boundedText(
        `${selectedTime.date || sourcePlan.date || ""} ${selectedTime.weekday || ""} ${selectedTime.startTime || sourcePlan.time || ""}`,
        100,
      );
      const title = boundedText(sourcePlan.title, 80) || "安排";
      const location = boundedText(
        sourcePlan.locationText || (sourcePlan.location && sourcePlan.location.name),
        160,
      ) || "目的地";
      const text = `【有时好饭聚餐日程】\n活动：${title}\n时间：${timeStr || "待定"}\n地点：${location}\n备注：记得提前出发，祝用餐愉快！`;
      const api = getWx();
      if (!api || typeof api.setClipboardData !== "function") {
        throw new Error("系统日历不可用，且当前环境无法复制行程");
      }
      return new Promise((resolve, reject) => {
        api.setClipboardData({
          data: text,
          success() {
            resolve({
              mode: "clipboard",
              message: "系统日历暂不可用，已将行程详情复制到剪贴板。",
            });
          },
          fail(error) {
            reject(toRuntimeError(error || calendarError, "系统日历不可用，行程复制也失败了"));
          },
        });
      });
    });
}

function buildClipboardInvite(plan, invite = {}) {
  const sourcePlan = plan || {};
  const sourceInvite = invite || {};
  const bounded = (value, length) => String(value || "").trim().slice(0, length);
  const sourceTime = sourcePlan.selectedTime || {};
  const planId = normalizeExactId(sourcePlan.id);
  const couponId = sourcePlan.couponId ? normalizeExactId(sourcePlan.couponId) : "";
  if (!planId || (sourcePlan.couponId && !couponId)) {
    throw new Error("计划标识无效，请重新打开计划后再邀请");
  }
  const selectedTime = {};
  ["date", "weekday", "startTime", "endTime", "scene", "label"].forEach((key) => {
    if (sourceTime[key] !== undefined && sourceTime[key] !== null) {
      selectedTime[key] = bounded(sourceTime[key], key === "label" ? 48 : 24);
    }
  });
  const safePlan = {
    id: planId,
    couponId,
    title: bounded(sourcePlan.title || "美味聚餐", 48),
    category: bounded(sourcePlan.category, 24),
    statusCode: ["pending", "confirmed", "rescheduled", "risky"].includes(sourcePlan.statusCode)
      ? sourcePlan.statusCode
      : "pending",
    venue: bounded(sourcePlan.venue || (sourcePlan.location && sourcePlan.location.name), 48),
    address: bounded(sourcePlan.address || (sourcePlan.location && sourcePlan.location.address), 96),
    selectedTime,
    revision: sourcePlan.revision !== undefined
      && sourcePlan.revision !== null
      && sourcePlan.revision !== ""
      && Number.isFinite(Number(sourcePlan.revision))
      ? Number(sourcePlan.revision)
      : undefined,
    updatedAt: bounded(sourcePlan.updatedAt, 40),
  };
  const inviteId = normalizeExactId(sourceInvite.inviteId || sourceInvite.id);
  if (!inviteId || !/^[A-Za-z0-9_-]{6,96}$/.test(inviteId)) {
    throw new Error("邀请尚未准备好，请稍后重试");
  }
  const linkedPlanId = sourceInvite.planId ? normalizeExactId(sourceInvite.planId) : planId;
  if (!linkedPlanId || linkedPlanId !== planId) {
    throw new Error("邀请与当前计划不一致，请重新生成邀请");
  }
  const safeInvite = {
    id: inviteId,
    inviteId,
    planId: linkedPlanId,
    status: ["pending", "confirmed", "rejected"].includes(sourceInvite.status) ? sourceInvite.status : "pending",
    syncStatus: sourceInvite.syncStatus === "cloud" ? "cloud" : "local",
    planUpdatedAt: bounded(sourceInvite.planUpdatedAt, 40),
  };
  const timeParts = [selectedTime.weekday, selectedTime.startTime].filter(Boolean).join(" ");
  const time = selectedTime.label || timeParts || bounded(sourcePlan.date, 24) || "待定";
  const venue = safePlan.venue || "美食门店";
  const dataPackage = { plan: safePlan, invite: safeInvite };
  const encodedData = encodeURIComponent(JSON.stringify(dataPackage));

  return `【有时好饭·聚餐邀约】\n约你一起去吃：${safePlan.title}\n时间：${time}\n地点：${venue}\n专属口令：#YS_INVITE#${inviteId}#${encodedData}#\n复制整段内容后打开「有时好饭」小程序即可一键查看并加入日程！`;
}

module.exports = {
  addPlanToCalendar,
  addPlanToPhoneCalendar,
  buildClipboardInvite,
  buildPlanNotifications,
  getTemplateIds,
  requestPlanSubscriptions,
  requestPlanReminder: requestPlanSubscriptions,
  saveTemplateIds,
  sendSubscribeMessage,
};
