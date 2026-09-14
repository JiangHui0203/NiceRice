const planStore = require("../../../utils/planStore.js");
const inviteService = require("../../../utils/services/inviteService.js");
const {
  formatPlanForView,
  buildActionState,
  confirmFriendAction,
  parseSharedPlanData,
  selectPlanSnapshot,
} = require("../planDetailHelper.js");
const {
  isPageActive,
  readRouteId,
  showPageToast,
  attachInviteSafely,
  findPlanSafely,
  findCouponSafely,
  reloadPlanSafely,
  samePlanSnapshot,
  restorePlanIfUnchanged,
  reconcileOwnerInvite,
  maybeShowInviteProposal,
  retryTerminalInviteCleanup,
  retryInvalidOwnerInviteCleanup,
} = require("./planLoadSupport.js");

module.exports = {
onLoad(options = {}) {
    this.unloaded = false;
    this.hidden = false;
    const planIdentity = readRouteId(options, ["id", "planId"]);
    const inviteIdentity = readRouteId(options, ["inviteId"]);
    this.planId = planIdentity.value;
    this.inviteId = inviteIdentity.value;
    this.routeIdentityInvalid = planIdentity.invalid || inviteIdentity.invalid;
    this.role = options.role === "recipient" ? "recipient" : "";
    const rawPlanData = typeof options.planData === "string" ? options.planData : "";
    this.planDataRaw = rawPlanData.length <= 8192 ? rawPlanData : "";
    if (rawPlanData && !this.planDataRaw) this.routeIdentityInvalid = true;
    this.missingPlanTimer = null;
    this.actionRedirectTimer = null;
    this.skipNextShowRefresh = true;
    this.loadPlan();
  },

onShow() {
    this.hidden = false;
    if (this.skipNextShowRefresh) {
      this.skipNextShowRefresh = false;
      return;
    }
    this.loadPlan();
  },

onUnload() {
    this.unloaded = true;
    this.hidden = true;
    this.planLoadRequestId = (this.planLoadRequestId || 0) + 1;
    this.inviteRequestId = (this.inviteRequestId || 0) + 1;
    if (this.missingPlanTimer !== null && this.missingPlanTimer !== undefined) {
      clearTimeout(this.missingPlanTimer);
      this.missingPlanTimer = null;
    }
    if (this.actionRedirectTimer !== null && this.actionRedirectTimer !== undefined) {
      clearTimeout(this.actionRedirectTimer);
      this.actionRedirectTimer = null;
    }
  },

onHide() {
    this.hidden = true;
    this.planLoadRequestId = (this.planLoadRequestId || 0) + 1;
    this.inviteRequestId = (this.inviteRequestId || 0) + 1;
    if (this.missingPlanTimer !== null && this.missingPlanTimer !== undefined) {
      clearTimeout(this.missingPlanTimer);
      this.missingPlanTimer = null;
    }
    if (this.actionRedirectTimer !== null && this.actionRedirectTimer !== undefined) {
      clearTimeout(this.actionRedirectTimer);
      this.actionRedirectTimer = null;
    }
  },

loadPlan() {
    const requestId = (this.planLoadRequestId || 0) + 1;
    this.planLoadRequestId = requestId;
    let plan = null;
    let isRecipient = this.role === "recipient";
    let invite = null;
    let coupon = null;
    let sharedPlan = null;
    let sharedInvite = null;
    let localOwnerPlan = null;
    this.planStorageReadFailed = false;
    this.couponStorageReadFailed = false;
    this.sharedPayloadInvalid = false;

    if (this.planDataRaw && !this.routeIdentityInvalid) {
      const parsedPkg = parseSharedPlanData(this.planDataRaw, {
        planId: this.planId,
        inviteId: this.inviteId,
      });
      if (parsedPkg && parsedPkg.plan) {
        sharedPlan = parsedPkg.plan;
        plan = sharedPlan;
        coupon = parsedPkg.coupon || null;
        sharedInvite = parsedPkg.invite || null;
        invite = sharedInvite;
        isRecipient = true;
        if (!this.inviteId && sharedInvite) {
          this.inviteId = sharedInvite.inviteId || sharedInvite.id || "";
        }
      } else {
        this.sharedPayloadInvalid = true;
      }
    } else if (this.planDataRaw || this.routeIdentityInvalid) {
      this.sharedPayloadInvalid = true;
    }

    const resolvePlanSnapshot = (fetchedInvite = null) => {
      const planIds = [
        fetchedInvite && fetchedInvite.planId,
        this.planId,
        sharedPlan && sharedPlan.id,
      ].filter((id, index, list) => id && list.indexOf(id) === index);
      let localPlan = null;
      for (let index = 0; index < planIds.length && !localPlan; index += 1) {
        localPlan = findPlanSafely(this, planIds[index]);
      }
      const selected = selectPlanSnapshot({
        sharedPlan,
        sharedInvite,
        localPlan,
        fetchedInvite,
      });
      plan = selected.plan;
      if (plan && coupon && plan.couponId && coupon.id !== plan.couponId) coupon = null;
      if (plan && selected.source === "local" && plan.couponId) {
        coupon = findCouponSafely(this, plan.couponId) || coupon;
      }
      return selected;
    };

    const renderPlan = () => {
      if (!plan || requestId !== this.planLoadRequestId) return false;
      if (this.missingPlanTimer !== null && this.missingPlanTimer !== undefined) {
        clearTimeout(this.missingPlanTimer);
        this.missingPlanTimer = null;
      }
      if (!coupon && plan.couponId) coupon = findCouponSafely(this, plan.couponId);
      const isOwner = Array.isArray(plan.participants) && plan.participants.some((p) => p && p.id === "self");
      if (!isRecipient) isRecipient = !isOwner && Boolean(plan.inviteId);
      let displayPlan = plan;
      if (isRecipient
        && invite
        && invite.status === "pending"
        && !["completed", "cancelled", "expired"].includes(plan.statusCode)) {
        displayPlan = Object.assign({}, plan, { statusCode: "pending", status: "待确认" });
      } else if (isRecipient && invite && invite.status === "rejected") {
        displayPlan = Object.assign({}, plan, { statusCode: "cancelled", status: "已婉拒" });
      } else if (isRecipient && invite && invite.status === "confirmed") {
        displayPlan = Object.assign({}, plan, {
          statusCode: "confirmed",
          status: invite.respondedByCurrentUser === false ? "已被接受" : "已接受",
        });
      } else if (isRecipient && invite && invite.invalid) {
        displayPlan = Object.assign({}, plan, { statusCode: "cancelled", status: "邀请已失效" });
      } else if (!isRecipient && invite && invite.invalid) {
        displayPlan = Object.assign({}, plan, { inviteSnapshot: invite });
      }
      try {
        this.setData({
          plan: formatPlanForView(displayPlan),
          coupon,
          currentInvite: invite,
          isRecipient,
          actionState: buildActionState(displayPlan, this.data.actionState && this.data.actionState.actionsExpanded, isRecipient),
        });
      } catch (error) {
        console.warn("plan detail render failed:", error);
        showPageToast(this, { title: "计划读取成功，但页面渲染失败，请重新打开", icon: "none" });
      }
      return true;
    };

    const handleMissingPlan = () => {
      if (requestId !== this.planLoadRequestId) return;
      if (this.planStorageReadFailed) {
        showPageToast(this, { title: "本地计划读取失败，请稍后重试", icon: "none" });
        return;
      }
      showPageToast(this, {
        title: this.sharedPayloadInvalid ? "分享口令无效或已损坏" : "计划不存在或已归档",
        icon: "none",
      });
      if (this.missingPlanTimer !== null && this.missingPlanTimer !== undefined) clearTimeout(this.missingPlanTimer);
      try {
        this.missingPlanTimer = setTimeout(() => {
          this.missingPlanTimer = null;
          if (requestId !== this.planLoadRequestId) return;
          const switchToPlanList = () => {
            if (requestId !== this.planLoadRequestId || !isPageActive(this)) return;
            try {
              wx.switchTab({
                url: "/pages/plan/index",
                fail: () => showPageToast(this, { title: "计划列表打开失败，请返回重试", icon: "none" }),
              });
            } catch (error) {
              showPageToast(this, { title: "计划列表打开失败，请返回重试", icon: "none" });
            }
          };
          try {
            wx.navigateBack({
              fail: switchToPlanList,
            });
          } catch (error) {
            switchToPlanList();
          }
        }, 1200);
      } catch (error) {
        this.missingPlanTimer = null;
        showPageToast(this, { title: "返回失败，请手动返回计划列表", icon: "none" });
      }
    };

    if (!this.inviteId && !isRecipient && !this.planDataRaw && this.planId) {
      const linkedPlan = findPlanSafely(this, this.planId);
      if (linkedPlan && linkedPlan.inviteId) this.inviteId = linkedPlan.inviteId;
    }

    if (this.inviteId) {
      localOwnerPlan = this.planId ? findPlanSafely(this, this.planId) : null;
      if (this.planStorageReadFailed && this.role !== "recipient" && !this.planDataRaw) {
        handleMissingPlan();
        return;
      }
      const ownsLinkedInvite = Boolean(
        localOwnerPlan
        && !localOwnerPlan.isImported
        && localOwnerPlan.inviteId === this.inviteId
        && (Array.isArray(localOwnerPlan.participants) ? localOwnerPlan.participants : [])
          .some((participant) => participant && participant.id === "self")
      );
      // Invite links are recipient views unless this device has the original
      // locally-bound owner plan. Cloud public records deliberately omit the
      // creator's identity, so identity comparison cannot decide this safely.
      if (ownsLinkedInvite) isRecipient = false;
      else isRecipient = true;
      const forceCloud = ownsLinkedInvite || isRecipient;
      Promise.resolve().then(() => inviteService.getInviteById(this.inviteId, {
        forceCloud,
        syncLocalNewer: ownsLinkedInvite,
      })).then((fetchedInvite) => {
        if (requestId !== this.planLoadRequestId) return;
        // A service-level invalid result includes durable local tombstones.
        // Never revive that capability from an older embedded share snapshot.
        const effectiveFetchedInvite = fetchedInvite;
        if (effectiveFetchedInvite) {
          invite = effectiveFetchedInvite;
        }
        if (isRecipient && !invite) {
          invite = {
            id: this.inviteId,
            inviteId: this.inviteId,
            status: "invalid",
            invalid: true,
            syncStatus: "cloud",
          };
        }
        const selected = resolvePlanSnapshot(effectiveFetchedInvite);
        if (!isRecipient && invite) {
          const ownerPlan = findPlanSafely(this, invite.planId || this.planId);
          if (ownerPlan) {
            let ownerContent = ownerPlan;
            if (selected.plan && selected.source !== "local") {
              const merged = Object.assign({}, ownerPlan, selected.plan, {
                id: ownerPlan.id,
                participants: selected.plan.participants || ownerPlan.participants,
                inviteId: ownerPlan.inviteId || this.inviteId,
                inviteSnapshot: ownerPlan.inviteSnapshot || null,
                isImported: ownerPlan.isImported,
              });
              try {
                ownerContent = planStore.upsertStoredPlan(merged, { linkCoupon: false }) || ownerPlan;
              } catch (error) {
                console.warn("owner plan snapshot merge failed:", error);
              }
            }
            plan = reconcileOwnerInvite(ownerContent, invite) || ownerContent;
          }
        }
        let acceptedLocalPlan = null;
        if (isRecipient && invite && invite.status === "confirmed"
          && invite.respondedByCurrentUser === true && plan) {
          acceptedLocalPlan = findPlanSafely(this, plan.id);
        }
        if (isRecipient
          && invite
          && invite.status === "confirmed"
          && invite.respondedByCurrentUser === true
          && plan
          && !this.planStorageReadFailed
          && !acceptedLocalPlan) {
          let importedResult = null;
          try {
            importedResult = confirmFriendAction(Object.assign({}, plan, {
              inviteId: this.inviteId,
              inviteSnapshot: invite,
              isImported: true,
            }), coupon);
          } catch (error) {
            importedResult = { success: false, error: error && error.message };
          }
          if ((!importedResult || !importedResult.success)
            && this.lastImportFailureInviteId !== this.inviteId) {
            this.lastImportFailureInviteId = this.inviteId;
            showPageToast(this, {
              title: importedResult && importedResult.error || "邀请已接受，但本地日程恢复失败",
              icon: "none",
            });
          }
        } else if (isRecipient
          && invite
          && invite.status === "confirmed"
          && invite.respondedByCurrentUser === true
          && plan
          && this.planStorageReadFailed
          && this.lastImportFailureInviteId !== this.inviteId) {
          this.lastImportFailureInviteId = this.inviteId;
          showPageToast(this, { title: "邀请已接受，但本地日程读取失败，请重新打开", icon: "none" });
        }
        if (!renderPlan()) {
          handleMissingPlan();
        } else if (!isRecipient && plan && invite) {
          if (invite.invalid) {
            retryInvalidOwnerInviteCleanup(this, plan, invite);
          } else if (["completed", "cancelled", "expired"].includes(plan.statusCode)) {
            retryTerminalInviteCleanup(this, plan);
          } else {
            maybeShowInviteProposal(this, plan, invite);
          }
        }
      }).catch(() => {
        if (requestId !== this.planLoadRequestId) return;
        if (isRecipient && !invite) {
          invite = {
            id: this.inviteId,
            inviteId: this.inviteId,
            status: "invalid",
            invalid: true,
            syncStatus: "cloud",
          };
        }
        resolvePlanSnapshot(null);
        if (!renderPlan()) handleMissingPlan();
      });
      return;
    }

    resolvePlanSnapshot(null);

    if (!plan) {
      handleMissingPlan();
      return;
    }
    if (isRecipient && !invite) {
      invite = {
        id: this.inviteId || "",
        inviteId: this.inviteId || "",
        status: "invalid",
        invalid: true,
        syncStatus: "local",
      };
    }
    renderPlan();
  }
};
