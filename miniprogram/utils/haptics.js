/**
 * Haptics Sensory Feedback Utility for "有时好饭"
 * Provides unified 3-level physical touch feedback conforming to iOS/Android ergonomics.
 */

let lastHapticTime = 0;
const HAPTIC_THROTTLE_MS = 60; // Prevent rapid buzzing

function canTriggerHaptic() {
  const now = Date.now();
  if (now - lastHapticTime < HAPTIC_THROTTLE_MS) {
    return false;
  }
  lastHapticTime = now;
  return true;
}

function isDevtools() {
  try {
    if (wx.getDeviceInfo && typeof wx.getDeviceInfo === "function") {
      return wx.getDeviceInfo().platform === "devtools";
    }
  } catch (e) {}
  return false;
}

function light() {
  if (!canTriggerHaptic() || isDevtools()) return;
  try {
    wx.vibrateShort({
      type: "light",
      fail: () => {},
    });
  } catch (e) {}
}

function medium() {
  if (!canTriggerHaptic() || isDevtools()) return;
  try {
    wx.vibrateShort({
      type: "medium",
      fail: () => {
        try {
          wx.vibrateShort();
        } catch (e) {}
      },
    });
  } catch (e) {}
}

function heavy() {
  if (!canTriggerHaptic() || isDevtools()) return;
  try {
    wx.vibrateShort({
      type: "heavy",
      fail: () => {
        try {
          wx.vibrateLong();
        } catch (e) {}
      },
    });
  } catch (e) {}
}

function warning() {
  heavy();
}

function success() {
  medium();
}

module.exports = {
  light,
  medium,
  heavy,
  success,
  warning,
};
