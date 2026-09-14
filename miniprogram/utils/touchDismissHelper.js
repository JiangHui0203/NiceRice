/**
 * 通用向下滑动手势收起工具 (Swipe-to-Dismiss Helper)
 * 专为小程序各类弹窗、半屏抽屉设计的自然阻尼跟手与松手判定
 */

class TouchDismissHelper {
  constructor(options = {}) {
    this.thresholdY = options.thresholdY || 70; // 触发收起的最小下拉距离 (px)
    this.velocityThreshold = options.velocityThreshold || 0.45; // 触发收起的最小下划速度 (px/ms)
    this.damping = options.damping || 0.78; // 跟手阻尼系数
    this.reset();
  }

  reset() {
    this.startY = 0;
    this.startX = 0;
    this.currentY = 0;
    this.startTime = 0;
    this.hasStarted = false;
    this.isDragging = false;
    this.isLocked = false;
  }

  onTouchStart(e) {
    const touch = e.touches && e.touches[0];
    if (!touch) {
      this.reset();
      return null;
    }

    this.startY = touch.clientY;
    this.startX = touch.clientX;
    this.currentY = touch.clientY;
    this.startTime = Date.now();
    this.hasStarted = true;
    this.isDragging = false;
    this.isLocked = false;

    return {
      dragOffsetY: 0,
      isDragging: false,
    };
  }

  onTouchMove(e) {
    const touch = e.touches && e.touches[0];
    if (!touch || !this.hasStarted) return null;

    const deltaY = touch.clientY - this.startY;
    const deltaX = touch.clientX - this.startX;

    // 水平滑动意图大于垂直意图时，不触发下拉手势
    if (!this.isLocked && Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 10) {
      this.hasStarted = false;
      return null;
    }

    // 仅允许向下拖拽 (deltaY > 0)
    if (deltaY > 5) {
      this.isLocked = true;
      this.isDragging = true;
      this.currentY = touch.clientY;

      const visualOffsetY = Math.round(deltaY * this.damping);
      return {
        dragOffsetY: visualOffsetY,
        isDragging: true,
      };
    }

    return {
      dragOffsetY: 0,
      isDragging: false,
    };
  }

  onTouchEnd(e, onDismiss) {
    if (!this.isDragging || !this.hasStarted) {
      this.reset();
      return {
        dragOffsetY: 0,
        isDragging: false,
        dismissed: false,
      };
    }

    const duration = Math.max(1, Date.now() - this.startTime);
    const totalDeltaY = this.currentY - this.startY;
    const velocityY = totalDeltaY / duration;

    const shouldDismiss = totalDeltaY >= this.thresholdY || velocityY >= this.velocityThreshold;

    this.reset();

    if (shouldDismiss && typeof onDismiss === "function") {
      onDismiss();
      return {
        dragOffsetY: 0,
        isDragging: false,
        dismissed: true,
      };
    }

    return {
      dragOffsetY: 0,
      isDragging: false,
      dismissed: false,
    };
  }
}

module.exports = TouchDismissHelper;
