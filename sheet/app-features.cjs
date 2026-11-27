// Phân quyền tab app Electron: map tab-id sang permission key.
// Hàm THUẦN (không đụng DOM/mạng): renderer (<script> thường, gắn window.AppFeatures) và test.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.AppFeatures = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /**
   * Map 17 tab-id sang "app:<id>" permission key.
   * Tab không có trong map (vd: "normalize") luôn được hiển thị (không gated).
   */
  const TAB_PERMISSIONS = Object.freeze({
    "channel-stats": "app:channel-stats",
    "sheet-watch": "app:sheet-watch",
    "batches": "app:batches",
    "veo3-image": "app:veo3-image",
    "trend-research": "app:trend-research",
    "render": "app:render",
    "composer": "app:composer",
    "video-snow": "app:video-snow",
    "bg-video": "app:bg-video",
    "download": "app:download",
    "stock-download": "app:stock-download",
    "get-url": "app:get-url",
    "trim": "app:trim",
    "cut-bg": "app:cut-bg",
    "concat": "app:concat",
    "thumb": "app:thumb",
    "automation": "app:automation",
  });

  /**
   * Kiểm tra xem payload có hợp lệ không.
   * Payload hợp lệ: { enforced: true, appFeatures: string[] }
   * Garbage payload (undefined/null/{}/appFeatures không phải array) → false (fail open).
   */
  function isValidPayload(payload) {
    if (!payload || typeof payload !== "object") return false;
    if (payload.enforced !== true) return false;
    if (!Array.isArray(payload.appFeatures)) return false;
    return true;
  }

  /**
   * Kiểm tra tab có được phép hiển thị không.
   * @param {string} tabId - ID của tab (vd: "render", "automation")
   * @param {object} payload - { enforced: boolean, appFeatures: string[] }
   * @returns {boolean} - true nếu tab được phép, false nếu không
   *
   * Rules:
   * - Payload không hợp lệ (garbage) → true (fail open)
   * - enforced=false → true (fail open, server cũ hoặc unknown)
   * - Tab không có trong TAB_PERMISSIONS → true (không gated, luôn hiển thị)
   * - enforced=true + key có trong appFeatures → true
   * - enforced=true + key không có trong appFeatures → false
   */
  function isTabAllowed(tabId, payload) {
    // Garbage payload → fail open
    if (!isValidPayload(payload)) return true;
    // Tab không gated
    const permKey = TAB_PERMISSIONS[tabId];
    if (!permKey) return true;
    // Check key
    return payload.appFeatures.includes(permKey);
  }

  /**
   * Lọc danh sách tab ID, trả về những tab được phép.
   * @param {string[]} allTabIds - Tất cả tab ID cần kiểm tra
   * @param {object} payload - { enforced: boolean, appFeatures: string[] }
   * @returns {string[]} - Các tab được phép
   */
  function visibleTabs(allTabIds, payload) {
    if (!Array.isArray(allTabIds)) return [];
    return allTabIds.filter((tabId) => isTabAllowed(tabId, payload));
  }

  /**
   * Tính toán tab và group nào bị ẩn, dựa trên DOM description.
   * Pure function: nhận mô tả DOM, trả về Set hidden.
   * @param {Array<{tabId: string, group: string}>} tabDescriptions - Mô tả các tab (tabId, group)
   * @param {object} payload - { enforced: boolean, appFeatures: string[] }
   * @returns {{ hiddenTabs: Set<string>, hiddenGroups: Set<string> }}
   */
  function computeHidden(tabDescriptions, payload) {
    const hiddenTabs = new Set();
    const hiddenGroups = new Set();
    if (!Array.isArray(tabDescriptions) || tabDescriptions.length === 0) {
      return { hiddenTabs, hiddenGroups };
    }

    // Đếm số tab mỗi group và số tab bị ẩn mỗi group
    const groupTotalCount = new Map();
    const groupHiddenCount = new Map();

    for (const desc of tabDescriptions) {
      if (!desc || typeof desc !== "object") continue;
      const { tabId, group } = desc;
      if (typeof tabId !== "string") continue;

      // Đếm theo group
      if (typeof group === "string" && group) {
        groupTotalCount.set(group, (groupTotalCount.get(group) || 0) + 1);
      }

      // Kiểm tra permission
      if (!isTabAllowed(tabId, payload)) {
        hiddenTabs.add(tabId);
        if (typeof group === "string" && group) {
          groupHiddenCount.set(group, (groupHiddenCount.get(group) || 0) + 1);
        }
      }
    }

    // Group bị ẩn khi TẤT CẢ tab của nó bị ẩn
    for (const [group, total] of groupTotalCount) {
      const hiddenCount = groupHiddenCount.get(group) || 0;
      if (hiddenCount > 0 && hiddenCount === total) {
        hiddenGroups.add(group);
      }
    }

    return { hiddenTabs, hiddenGroups };
  }

  return {
    TAB_PERMISSIONS,
    isTabAllowed,
    visibleTabs,
    computeHidden,
  };
});
