const store = require("../../utils/couponStore.js");
const planStore = require("../../utils/planStore.js");
const recommendation = require("../../utils/recommendation.js");
const weatherService = require("../../utils/services/weatherService.js");
const routeService = require("../../utils/services/routeService.js");
const { isActivePlanStatus } = require("../../utils/plan/planStatus.js");

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const WEEK_DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

const SCENE_TYPE_MAP = {
  粉面: "午餐", 火锅: "晚餐", 烧烤: "晚餐", 咖啡甜品: "下午茶",
  展览: "下午", 公园: "下午", 户外: "上午", 温泉: "下午",
};

function formatDateStr(date) {
  const pad = (val) => String(val).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function getBriefLabel(item) {
  if (!item) return "";
  const type = item.coupon ? item.coupon.type : (item.type || "");
  if (type && type !== "其他") return type.substring(0, 4);
  const title = item.title || "";
  for (const key of ["涮羊肉", "牛肉面", "下午茶", "博物馆", "游船"]) {
    if (title.includes(key)) return key === "游船" ? "游船票" : key;
  }
  return title.substring(0, 4);
}

Page({
  data: {
    dateRangeLabel: "",
    days: [],
    viewMode: "calendar",
    selectedDateIndex: 0,
    weekOffset: 0,
    errorMsg: null,
  },

  onLoad() {
    this.hidden = false;
    this.unloaded = false;
    this.forecastRequestToken = 0;
    this.touchStartX = null;
    this.touchStartY = null;
  },

  onTouchStart(e) {
    if (e.touches && e.touches.length) {
      this.touchStartX = e.touches[0].clientX;
      this.touchStartY = e.touches[0].clientY;
    }
  },

  onTouchEnd(e) {
    if (!Number.isFinite(this.touchStartX) || !Number.isFinite(this.touchStartY)) return;
    if (e.changedTouches && e.changedTouches.length) {
      const deltaX = e.changedTouches[0].clientX - this.touchStartX;
      const deltaY = e.changedTouches[0].clientY - this.touchStartY;
      if (Math.abs(deltaX) > 50 && Math.abs(deltaX) > Math.abs(deltaY) * 1.3) {
        if (deltaX < 0) this.nextWeek();
        else this.prevWeek();
      }
    }
    this.touchStartX = null;
    this.touchStartY = null;
  },

  onShow() {
    if (this.unloaded) return;
    this.hidden = false;
    this.renderCalendar();

    // 异步拉取最新 7 天天气预报
    const requestToken = (this.forecastRequestToken || 0) + 1;
    this.forecastRequestToken = requestToken;
    const origin = routeService.getActiveRouteOrigin();
    weatherService.fetchWeeklyForecast(origin, false).then((liveForecast) => {
      if (!this.hidden && !this.unloaded && requestToken === this.forecastRequestToken && liveForecast && liveForecast.length) {
        this.renderCalendar();
      }
    }).catch(() => {});
  },

  onHide() {
    this.hidden = true;
    this.forecastRequestToken = (this.forecastRequestToken || 0) + 1;
  },

  onUnload() {
    this.unloaded = true;
    this.onHide();
  },

  renderCalendar() {
    if (this.hidden || this.unloaded) return;
    try {
      const coupons = store.getAllCoupons() || [];
      const plans = planStore.getPlans() || [];
      const couponById = new Map(coupons.map((coupon) => [coupon.id, coupon]));
      const activeCouponIds = new Set(
        plans
          .filter((plan) => isActivePlanStatus(plan.statusCode))
          .map((plan) => plan.couponId)
          .filter(Boolean),
      );
      const recommendableCoupons = coupons.filter(
        (coupon) => !["planned", "used", "expired"].includes(coupon.statusCode) && !activeCouponIds.has(coupon.id)
      );
      const weekOffset = this.data.weekOffset || 0;
      const baseDate = new Date();
      const day = baseDate.getDay();
      const diffToMonday = day === 0 ? -6 : 1 - day;
      baseDate.setDate(baseDate.getDate() + diffToMonday + weekOffset * 7);

      const todayStr = formatDateStr(new Date());
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowStr = formatDateStr(tomorrow);

      const weather = weatherService.getWeather();
      const weeklyWeather = weatherService.getWeeklyWeather(baseDate);
      const context = recommendation.buildRecommendationContext({
        now: baseDate,
        weather,
        weeklyWeather,
        existingPlans: plans,
        allCoupons: coupons,
      });
      const weeklyArrangement = recommendation.generateWeeklyArrangement(recommendableCoupons, context);

      const items = weeklyArrangement.items.map((item) => {
        const coupon = couponById.get(item.couponId);
        return Object.assign({}, item, {
          title: coupon ? coupon.title : (item.title || "待安排"),
          coupon: coupon || null,
        });
      });

      const now = context.now instanceof Date ? context.now : new Date(context.now);
      const days = [];

      for (let i = 0; i < 7; i++) {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        d.setDate(d.getDate() + i);

        const dateStr = formatDateStr(d);
        const weekday = WEEKDAYS[d.getDay()];
        const dayOfWeekKey = WEEK_DAY_KEYS[d.getDay()];

        const dayItems = items.filter((item) => item.planTime && item.planTime.date === dateStr);
        const hasPlan = dayItems.some((item) => item.isPlanned);
        const hasRecommend = dayItems.some((item) => !item.isPlanned);

        const alternativeCoupons = recommendableCoupons.filter((coupon) => {
          if (dayItems.some((item) => item.couponId === coupon.id)) return false;
          const rules = coupon.usageRules || {};
          const availableDays = rules.availableDays || [];
          const unavailableDays = rules.unavailableDays || [];
          if (availableDays.length && !availableDays.includes(dayOfWeekKey)) return false;
          if (unavailableDays.length && unavailableDays.includes(dayOfWeekKey)) return false;
          return true;
        }).sort((a, b) => (!a.expireDate ? 1 : !b.expireDate ? -1 : a.expireDate.localeCompare(b.expireDate)));

        const suggestions = alternativeCoupons.slice(0, 2).map((coupon) => ({
          id: coupon.id,
          title: coupon.title,
          score: coupon.recommendationScore !== ""
            && coupon.recommendationScore !== null
            && coupon.recommendationScore !== undefined
            && Number.isFinite(Number(coupon.recommendationScore))
            ? Number(coupon.recommendationScore)
            : null,
          scene: SCENE_TYPE_MAP[coupon.type] || "晚餐",
          expiresIn: coupon.expiresIn || "近期过期",
          price: coupon.price,
          type: coupon.type,
        }));

        const briefLabels = dayItems.map((item) => ({ label: getBriefLabel(item), isPlanned: item.isPlanned }));
        const dayWeather = weeklyWeather.find((w) => w.date === dateStr) || weeklyWeather[i] || weather;
        const hasWeatherData = Boolean(dayWeather
          && !["local", "forecast"].includes(dayWeather.source)
          && (
          dayWeather.condition
          || dayWeather.mainCondition
          || dayWeather.temperature !== undefined
          || dayWeather.temperatureRange !== undefined
          ));
        const weatherIcon = hasWeatherData
          ? (dayWeather.icon || weatherService.getWeatherIcon(dayWeather.mainCondition, "day") || "▫️")
          : "▫️";
        const temperature = hasWeatherData && dayWeather.temperature !== undefined && dayWeather.temperature !== null && dayWeather.temperature !== ""
          ? dayWeather.temperature
          : (hasWeatherData && dayWeather.temperatureRange !== undefined && dayWeather.temperatureRange !== null && dayWeather.temperatureRange !== "" ? dayWeather.temperatureRange : "--");
        const tempSimple = temperature === "--"
          ? "--"
          : `${String(temperature).replace(/°/g, "").split("-")[0]}°`;
        const weatherTips = Array.isArray(dayWeather.tips) ? dayWeather.tips : [];
        const weatherModifiers = Array.isArray(dayWeather.modifiers) ? dayWeather.modifiers : [];

        days.push({
          dateStr,
          month: d.getMonth() + 1,
          date: d.getDate(),
          weekday,
          isToday: dateStr === todayStr,
          isTomorrow: dateStr === tomorrowStr,
          items: dayItems,
          hasPlan,
          hasRecommend,
          suggestions,
          briefLabels,
          weather: {
            icon: weatherIcon,
            condition: hasWeatherData ? (dayWeather.condition || "天气待更新") : "天气待更新",
            temperature,
            tempSimple,
            summary: hasWeatherData ? (dayWeather.summary || "暂无对应日期的天气数据") : "暂无对应日期的实况天气数据",
            tips: hasWeatherData ? weatherTips.slice(0, 2) : [],
            isRain: hasWeatherData && (dayWeather.mainCondition === "rain" || weatherModifiers.includes("rain_mix")),
          },
        });
      }

      const [startYear, startMonth, startDay] = weeklyArrangement.range.startDate.split("-");
      const [endYear, endMonth, endDay] = weeklyArrangement.range.endDate.split("-");
      const dateLabelLine1 = startYear !== endYear ? `${startYear}.${startMonth}.${startDay} -` : startYear;
      const dateLabelLine2 = startYear !== endYear ? `${endYear}.${endMonth}.${endDay}` : `${startMonth}.${startDay} - ${endMonth}.${endDay}`;

      this.setData({ errorMsg: null, dateLabelLine1, dateLabelLine2, days });
    } catch (e) {
      console.error("Weekly calendar onShow error:", e);
      if (!this.hidden && !this.unloaded) {
        this.setData({ errorMsg: "周历加载失败，请稍后重试" });
      }
    }
  },

  prevWeek() {
    this.setData({ weekOffset: (this.data.weekOffset || 0) - 1, selectedDateIndex: 0 }, () => {
      if (!this.hidden && !this.unloaded) this.renderCalendar();
    });
  },

  nextWeek() {
    this.setData({ weekOffset: (this.data.weekOffset || 0) + 1, selectedDateIndex: 0 }, () => {
      if (!this.hidden && !this.unloaded) this.renderCalendar();
    });
  },

  jumpToToday() {
    const todayDay = new Date().getDay();
    const todayIndex = todayDay === 0 ? 6 : todayDay - 1;
    this.setData({ weekOffset: 0, selectedDateIndex: todayIndex }, () => {
      if (!this.hidden && !this.unloaded) this.renderCalendar();
    });
  },

  switchViewMode(e) {
    const mode = e.currentTarget.dataset.mode;
    if (mode && mode !== this.data.viewMode) {
      this.setData({ viewMode: mode });
    }
  },

  selectDate(e) {
    const index = parseInt(e.currentTarget.dataset.index, 10);
    if (Number.isInteger(index) && index !== this.data.selectedDateIndex) {
      this.setData({ selectedDateIndex: index });
    }
  },

  goPlanConfirm(e) {
    const id = e.currentTarget.dataset.id;
    if (id) wx.navigateTo({ url: `/pages/plan-confirm/index?id=${encodeURIComponent(id)}` });
  },

  onItemTap(e) {
    const { id, planId, planned } = e.currentTarget.dataset;
    if (planned && planId) {
      wx.navigateTo({ url: `/pages/plan-detail/index?id=${encodeURIComponent(planId)}` });
    } else if (id) {
      wx.navigateTo({ url: `/pages/coupon-detail/index?id=${encodeURIComponent(id)}` });
    }
  },

  goCoupons() {
    wx.switchTab({ url: "/pages/coupons/index" });
  },

  goFoodWheel() {
    wx.navigateTo({ url: "/pages/food-wheel/index" });
  },

  onShareAppMessage() {
    return {
      title: "📅 这是我本周的美食与生活安排，看看哪天有空一起！",
      path: "/pages/weekly-calendar/index",
    };
  },

  onShareTimeline() {
    return {
      title: "📅 有时好饭 · 我的本周生活与美食日历",
      query: "",
    };
  },
});
