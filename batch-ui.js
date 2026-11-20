/* Menu "Mẻ": làm theo mẻ (render nhiều ngày một lượt, upload tay, thay thumb, lên lịch). Quản lý riêng của máy này.
 *
 * - Mỗi mẻ có nhiều kênh, chọn từ danh sách GPM (theo Profile ID). Một profile chỉ ở MỘT mẻ hoặc là một kênh Auto.
 * - Cấu hình lưu ở server (app > server > web). Web chỉ xem: mẻ nào đang render/thay thumb/lên lịch, kênh nào còn mấy ngày phải đăng.
 * - Hết vòng thì xóa video và làm vòng mới ngay trong mẻ đó: "Lịch tới" của kênh tự dịch lên khi chạy Auto lên lịch.
 * - Giao diện chỉ dùng textContent/value (không nội suy HTML) vì mọi chuỗi đến từ server hoặc GPM.
 * Dùng như script thường: window.BatchUI.mount(root) / .reload().
 */
(function () {
  "use strict";
  const api = () => window.electronAPI && window.electronAPI.sheet;
  const DAY = 86400000;

  function el(tag, props = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
      else if (v === true) n.setAttribute(k, "");
      else if (v !== false && v != null) n.setAttribute(k, String(v));
    }
    for (const kid of kids.flat()) if (kid != null) n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return n;
  }
  const ICONS = {
    edit: ["M12 20h9", "M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"],
    trash: ["M3 6h18", "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6", "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"],
    unlink: ["M18.84 12.25l1.72-1.71a5 5 0 0 0-7.07-7.07l-1.72 1.71", "M5.16 11.75l-1.72 1.71a5 5 0 0 0 7.07 7.07l1.72-1.71", "M8 2v3", "M2 8h3", "M16 22v-3", "M22 16h-3"],
  };
  function icon(name) {
    const NS = "http://www.w3.org/2000/svg", svg = document.createElementNS(NS, "svg");
    for (const [k, v] of Object.entries({ viewBox: "0 0 24 24", width: "16", height: "16", fill: "none", stroke: "currentColor", "stroke-width": "1.75", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" })) svg.setAttribute(k, v);
    for (const d of ICONS[name] || []) { const p = document.createElementNS(NS, "path"); p.setAttribute("d", d); svg.append(p); }
    return svg;
  }
  /** Nút icon dùng chung (cùng lớp .btn-icon với phần còn lại của app). tone: "danger" | "warn" | "". */
  function iconBtn(name, label, tone, onclick, disabled) {
    return el("button", { class: "btn-icon" + (tone ? " " + tone : ""), type: "button", title: label, "aria-label": label, disabled: !!disabled, onclick }, icon(name));
  }
  const toast = (m, kind) => { if (typeof window.appToast === "function") window.appToast(m, { kind: kind || "success" }); };

  // ---------------------------------------------------------------- logic thuần (có test)
  /** Tình trạng lịch của một kênh. Ngưỡng báo (ngày) của mẻ quyết định khi nào "sắp hết". */
  function scheduleStatus(iso, warnDays, now = Date.now()) {
    const t = iso ? Date.parse(iso) : NaN;
    if (!Number.isFinite(t)) return { key: "none", rank: 3, label: "Chưa có lịch", days: null };
    const left = (t - now) / DAY, date = new Date(t).toLocaleDateString("vi-VN");
    if (left <= 0) return { key: "out", rank: 0, label: date + " · đã hết lịch", days: left };
    const d = Math.ceil(left);
    return { key: left <= (Number(warnDays) || 0) ? "soon" : "ok", rank: left <= (Number(warnDays) || 0) ? 1 : 2, label: date + " · còn " + d + " ngày", days: left };
  }
  /** Hạn render vòng tiếp: lần render cuối + chu kỳ. null nếu chưa render lần nào. */
  function renderDue(lastRenderAt, cycleDays, now = Date.now()) {
    const t = lastRenderAt ? Date.parse(lastRenderAt) : NaN;
    if (!Number.isFinite(t)) return null;
    const due = t + Math.max(1, Number(cycleDays) || 1) * DAY, left = Math.ceil((due - now) / DAY);
    return { due, daysLeft: left, overdue: left <= 0 };
  }
  /** Kênh theo độ khẩn: hết lịch trước, rồi sắp hết, rồi còn nhiều, chưa có lịch cuối. */
  function sortChannels(channels, warnDays, now = Date.now()) {
    return (channels || []).map((c) => ({ c, s: scheduleStatus(c.scheduledUntil, warnDays, now) }))
      .sort((a, b) => a.s.rank - b.s.rank || (a.s.days ?? 1e9) - (b.s.days ?? 1e9) || String(a.c.name).localeCompare(String(b.c.name)));
  }

  // ---------------------------------------------------------------- màn hình
  function mount(root) {
    const st = { batches: [], offline: false, loading: false, err: "", open: new Set(), gpm: null };
    try { for (const k of JSON.parse(localStorage.getItem("batch_open") || "[]")) st.open.add(Number(k)); } catch { /* không quan trọng */ }
    const saveOpen = () => { try { localStorage.setItem("batch_open", JSON.stringify([...st.open])); } catch { /* ignore */ } };

    async function load(manual) {
      if (st.loading) return;
      st.loading = true; st.err = ""; paint();
      const r = await (api()?.batchesList?.() || Promise.resolve({ ok: false, error: "Phiên bản app không hỗ trợ mẻ" })).catch((e) => ({ ok: false, error: e.message }));
      st.loading = false;
      if (r && r.ok) { st.batches = r.batches || []; st.offline = !!r.offline; if (manual) toast("Đã làm mới"); }
      else st.err = (r && r.error) || "Không tải được danh sách mẻ";
      paint();
    }

    function paint() {
      const head = el("div", { class: "bt-head" },
        el("div", {}, el("h2", { text: "Mẻ" }), el("p", { class: "bt-sub", text: "Mỗi mẻ gồm nhiều kênh làm chung một đợt: render, thay thumb, lên lịch. Web theo dõi mẻ nào đang chạy và kênh nào sắp hết lịch." })),
        el("div", { class: "bt-actions" },
          el("button", { class: "btn btn-secondary bt-add", type: "button", text: "⟳ Làm mới", onclick: () => load(true) }),
          el("button", { class: "btn btn-primary bt-add", type: "button", text: "＋ Thêm mẻ", disabled: st.offline, onclick: () => batchForm(null) })));
      const kids = [head];
      if (st.offline) kids.push(el("div", { class: "bt-note warn", text: "Mất kết nối tới máy chủ: đang xem bản đã lưu, chưa thêm hoặc sửa được." }));
      if (st.err) kids.push(el("div", { class: "bt-note err", text: st.err }));
      if (st.loading && !st.batches.length) kids.push(el("div", { class: "bt-empty", text: "Đang tải…" }));
      else if (!st.batches.length && !st.err) kids.push(el("div", { class: "bt-empty" }, el("strong", { text: "Chưa có mẻ nào" }), el("span", { text: "Bấm “＋ Thêm mẻ”, rồi thêm kênh từ danh sách GPM vào mẻ." })));
      for (const b of st.batches) kids.push(card(b));
      root.replaceChildren(...kids);
    }

    function card(b) {
      const open = st.open.has(b.id), rows = sortChannels(b.channels, b.warnDays), due = renderDue(b.lastRenderAt, b.cycleDays);
      const out = rows.filter((r) => r.s.key === "out").length, soon = rows.filter((r) => r.s.key === "soon").length;
      const chips = el("div", { class: "bt-chips" },
        el("span", { class: "bt-chip brand", text: b.totalDays + " ngày × " + b.videosPerDay + " video/ngày" }),
        el("span", { class: "bt-chip amber", text: "báo khi còn ≤ " + b.warnDays + " ngày" }),
        due ? el("span", { class: "bt-chip " + (due.overdue ? "err" : due.daysLeft <= 1 ? "warn" : "blue"), text: due.overdue ? "đã tới hạn render vòng mới" : "render vòng mới sau " + due.daysLeft + " ngày" }) : el("span", { class: "bt-chip", text: "chưa render lần nào" }),
        out ? el("span", { class: "bt-chip err", text: out + " kênh hết lịch" }) : null, soon ? el("span", { class: "bt-chip warn", text: soon + " kênh sắp hết" }) : null);
      const top = el("div", { class: "bt-card-head" },
        el("button", { class: "bt-toggle", type: "button", "aria-expanded": open, "aria-label": (open ? "Thu gọn " : "Mở ") + b.name, text: open ? "▾" : "▸", onclick: () => { open ? st.open.delete(b.id) : st.open.add(b.id); saveOpen(); paint(); } }),
        el("div", { class: "bt-title" }, el("strong", { text: b.name }), el("span", { class: "bt-count", text: (b.channels || []).length + " kênh" }), b.description ? el("div", { class: "bt-desc", text: b.description }) : null, chips),
        el("div", { class: "bt-card-actions" },
          el("button", { class: "btn btn-primary bt-add", type: "button", text: "＋ Thêm kênh", disabled: st.offline, onclick: () => pickChannels(b) }),
          iconBtn("edit", "Sửa mẻ", "warn", () => batchForm(b), st.offline),
          iconBtn("trash", "Xóa mẻ", "danger", () => removeBatch(b), st.offline)));
      const body = !open ? null : rows.length
        ? el("table", { class: "cv-table bt-table" }, el("thead", {}, el("tr", {}, ["Kênh", "GPM Profile", "Lịch tới", "Tác vụ gần nhất", ""].map((h) => el("th", { text: h })))),
          el("tbody", {}, rows.map(({ c, s }) => el("tr", {},
            el("td", {}, el("strong", { text: c.name || c.gpmProfileId })),
            el("td", { class: "bt-mono", text: c.gpmProfileId }),
            el("td", {}, el("span", { class: "bt-st " + s.key, text: s.label })),
            el("td", { class: "bt-muted", text: c.lastTask ? c.lastTask + (c.lastTaskAt ? " · " + ago(c.lastTaskAt) : "") : "—" }),
            el("td", { class: "actions" }, iconBtn("unlink", "Bỏ kênh khỏi mẻ (không xóa profile trong GPM)", "danger", () => removeChannel(b, c), st.offline))))))
        : el("div", { class: "bt-empty small" }, el("span", { text: "Mẻ chưa có kênh. Bấm “＋ Thêm kênh” để chọn từ GPM." }));
      return el("section", { class: "bt-card" }, top, body);
    }

    const ago = (iso) => { const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return !Number.isFinite(m) ? "" : m < 1 ? "vừa xong" : m < 60 ? m + " phút trước" : m < 1440 ? Math.round(m / 60) + " giờ trước" : Math.round(m / 1440) + " ngày trước"; };

    // ---- hộp thoại dùng chung (dựng bằng DOM, không nội suy HTML)
    function dialog(title, bodyNode, { ok = "Lưu", onOk }) {
      const msg = el("div", { class: "bt-msg", role: "alert" });
      const yes = el("button", { class: "btn btn-primary", type: "button", text: ok });
      const wrap = el("div", { class: "modal active bt-modal" });
      const close = () => wrap.remove();
      const card = el("div", { class: "modal-content" },
        el("div", { class: "modal-header" }, el("h3", { text: title }), el("button", { class: "modal-close", type: "button", "aria-label": "Đóng", text: "×", onclick: close })),
        el("div", { class: "modal-body" }, bodyNode, msg),
        el("div", { class: "bt-foot" }, el("button", { class: "btn btn-secondary", type: "button", text: "Hủy", onclick: close }), yes));
      wrap.append(card); wrap.addEventListener("click", (e) => { if (e.target === wrap) close(); });
      wrap.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
      yes.addEventListener("click", async () => {
        yes.disabled = true; const old = yes.textContent; yes.textContent = "Đang lưu…"; msg.textContent = "";
        const r = await onOk().catch((e) => ({ ok: false, error: e.message }));
        if (r && r.ok === false) { yes.disabled = false; yes.textContent = old; msg.className = "bt-msg err"; msg.textContent = r.error || "Không lưu được"; return; }
        close(); await load();
      });
      document.body.append(wrap);
      setTimeout(() => wrap.querySelector("input,select,textarea")?.focus(), 30);
    }
    const field = (label, input, help) => el("div", { class: "bt-group" }, el("label", { text: label }), input, help ? el("div", { class: "bt-help", text: help }) : null);
    const num = (v, min, max) => el("input", { type: "number", min, max, value: v });

    function batchForm(b) {
      const name = el("input", { type: "text", maxlength: "100", value: b ? b.name : "", placeholder: "vd: Lofi đợt 1" });
      const days = num(b ? b.totalDays : 19, 1, 365), per = num(b ? b.videosPerDay : 3, 1, 100), cyc = num(b ? b.cycleDays : 19, 1, 365), warn = num(b ? b.warnDays : 1, 0, 30);
      const desc = el("textarea", { rows: "2", maxlength: "500", text: b ? b.description : "" });
      dialog(b ? "Sửa mẻ" : "Thêm mẻ", el("div", {},
        field("Tên mẻ *", name),
        el("div", { class: "bt-row" }, field("Số ngày mỗi vòng", days), field("Video mỗi ngày / kênh", per)),
        el("div", { class: "bt-row" }, field("Chu kỳ render (ngày)", cyc, "Sau bấy nhiêu ngày kể từ lần render cuối thì tới hạn render vòng mới."), field("Báo khi lịch còn ≤ (ngày)", warn, "Kênh còn ít ngày hơn mức này thì cảnh báo, kể cả trên web.")),
        field("Ghi chú", desc)), {
        ok: b ? "Lưu" : "Tạo mẻ",
        onOk: async () => {
          const body = { name: name.value.trim(), description: desc.value, totalDays: Number(days.value), videosPerDay: Number(per.value), cycleDays: Number(cyc.value), warnDays: Number(warn.value) };
          if (!body.name) return { ok: false, error: "Tên mẻ không được để trống" };
          return b ? api().batchesUpdate(b.id, body) : api().batchesCreate(body);
        },
      });
    }

    async function removeBatch(b) {
      if (!(await window.appConfirm({ title: "Xóa mẻ?", message: "Xóa mẻ “" + b.name + "” và " + (b.channels || []).length + " kênh trong mẻ?", detail: "Chỉ xóa khỏi danh sách theo dõi, không đụng tới profile GPM.", confirmText: "Xóa mẻ" }))) return;
      const r = await api().batchesDelete(b.id).catch((e) => ({ ok: false, error: e.message }));
      if (r && r.ok) { toast("Đã xóa mẻ"); load(); } else toast((r && r.error) || "Không xóa được", "error");
    }
    async function removeChannel(b, c) {
      if (!(await window.appConfirm({ title: "Bỏ kênh khỏi mẻ?", message: "Bỏ kênh “" + (c.name || c.gpmProfileId) + "” khỏi mẻ “" + b.name + "”?", detail: "Chỉ bỏ khỏi mẻ, không xóa profile trong GPM.", confirmText: "Bỏ khỏi mẻ", icon: "🔗" }))) return;
      const r = await api().batchesRemoveChannel(b.id, c.gpmProfileId).catch((e) => ({ ok: false, error: e.message }));
      if (r && r.ok) { toast("Đã bỏ kênh khỏi mẻ"); load(); } else toast((r && r.error) || "Không bỏ được", "error");
    }

    // Chọn kênh từ danh sách GPM (nhiều kênh một lượt). Profile đang ở mẻ khác hoặc là kênh Auto bị khóa, ghi rõ lý do.
    async function pickChannels(b) {
      const list = el("div", { class: "bt-pick-list", text: "Đang lấy danh sách GPM…" });
      const search = el("input", { type: "text", placeholder: "Tìm theo tên hoặc group…", autocomplete: "off" });
      const count = el("span", { class: "bt-muted", text: "" });
      const chosen = new Set();
      let profiles = [], groups = {};
      const used = new Map(); // profileId -> lý do không chọn được
      for (const x of st.batches) for (const c of x.channels || []) used.set(c.gpmProfileId, x.id === b.id ? "đã có trong mẻ này" : "đang ở mẻ “" + x.name + "”");
      try {
        const ac = await window.ChannelConfigUI?.load?.();
        for (const c of (ac && ac.channels) || []) if (c.gpmProfileId) used.set(c.gpmProfileId, "đang chạy Auto (“" + c.name + "”)");
      } catch { /* không biết thì để server chặn */ }
      const draw = () => {
        const q = search.value.toLowerCase().trim();
        const rows = profiles.filter((p) => !q || p.name.toLowerCase().includes(q) || (groups[p.groupId] || "").toLowerCase().includes(q) || p.id.toLowerCase().includes(q));
        count.textContent = chosen.size ? "Đã chọn " + chosen.size : "";
        list.replaceChildren(...(rows.length ? rows.map((p) => {
          const why = used.get(p.id), cb = el("input", { type: "checkbox", checked: chosen.has(p.id), disabled: !!why });
          cb.addEventListener("change", () => { cb.checked ? chosen.add(p.id) : chosen.delete(p.id); count.textContent = chosen.size ? "Đã chọn " + chosen.size : ""; });
          return el("label", { class: "bt-pick" + (why ? " off" : "") }, cb, el("span", { class: "bt-pick-name", text: p.name }), el("span", { class: "bt-muted", text: groups[p.groupId] || "Chung" }), why ? el("span", { class: "bt-why", text: why }) : null);
        }) : [el("div", { class: "bt-empty small", text: profiles.length ? "Không có profile nào khớp." : "Không có profile GPM." })]));
      };
      search.addEventListener("input", draw);
      (async () => {
        const r = await api().gpmListProfilesFull?.().catch((e) => ({ ok: false, error: e.message }));
        if (!r || !r.ok) { list.textContent = "Không lấy được danh sách GPM: " + ((r && r.error) || "GPM chưa chạy?"); return; }
        profiles = r.profiles || []; groups = Object.fromEntries((r.groups || []).map((g) => [g.id, g.name])); draw();
      })();
      dialog("Thêm kênh vào “" + b.name + "”", el("div", {}, field("Chọn kênh từ GPM", search, "Mỗi profile chỉ ở một mẻ hoặc một kênh Auto."), list, count), {
        ok: "Thêm vào mẻ",
        onOk: async () => {
          if (!chosen.size) return { ok: false, error: "Chưa chọn kênh nào" };
          const names = new Map(profiles.map((p) => [p.id, p.name])); let added = 0; const fails = [];
          for (const id of chosen) {
            const r = await api().batchesAddChannel(b.id, id, names.get(id) || id).catch((e) => ({ ok: false, error: e.message }));
            if (r && r.ok) added++; else fails.push((names.get(id) || id) + ": " + ((r && r.error) || "lỗi"));
          }
          if (fails.length && !added) return { ok: false, error: fails[0] };
          if (fails.length) toast("Đã thêm " + added + " kênh, " + fails.length + " kênh lỗi: " + fails[0], "error");
          return { ok: true };
        },
      });
    }

    paint(); load();
    return { reload: () => { if (root.offsetParent !== null) load(); } };
  }

  window.BatchUI = { mount, scheduleStatus, renderDue, sortChannels };
})();
