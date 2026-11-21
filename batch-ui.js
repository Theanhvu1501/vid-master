/* Menu "Mẻ": làm theo mẻ (render nhiều ngày một lượt, upload tay, thay thumb, lên lịch). Quản lý riêng của máy này.
 *
 * - Bố cục hai cột như màn Kênh: danh sách mẻ bên trái; bấm một mẻ thì chi tiết hiện bên phải, sửa và lưu ngay tại đó (không mở hộp thoại).
 * - Mỗi mẻ có cấu hình render RIÊNG (kiểu render + thông số như tab Render) và nhiều kênh chọn từ GPM theo Profile ID.
 *   Một profile chỉ ở MỘT mẻ hoặc là một kênh Auto.
 * - Cấu hình lưu ở server (app > server > web). Web chỉ xem: mẻ nào đang render/thay thumb/lên lịch, kênh nào sắp hết lịch.
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
    check: ["M20 6 9 17l-5-5"],
    x: ["M18 6 6 18", "M6 6l12 12"],
    ban: ["M4.9 4.9l14.2 14.2", "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z"],
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
  const ago = (iso) => { const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return !Number.isFinite(m) ? "" : m < 1 ? "vừa xong" : m < 60 ? m + " phút trước" : m < 1440 ? Math.round(m / 60) + " giờ trước" : Math.round(m / 1440) + " ngày trước"; };
  const field = (label, input, help) => el("div", { class: "form-group bt-group" }, el("label", { text: label }), input, help ? el("small", { text: help }) : null);
  const numInput = (v, min, max, step) => el("input", { type: "number", min, max, step: step || "1", value: v });

  function mount(root) {
    const st = { batches: [], offline: false, loading: false, err: "", sel: null /* id | "new" | null */, schema: null, dirty: false, live: new Map() /* "batchId:kind" -> đang chạy trên máy này */, stopFor: null, machineDefs: {}, actTab: "render", renderCtx: null };
    const byId = (id) => st.batches.find((x) => x.id === id);

    async function loadSchema() {
      if (st.schema) return st.schema;
      const r = await api()?.batchesSchema?.().catch(() => null);
      if (r && r.ok) st.schema = r.schema;
      return st.schema;
    }
    async function load(manual) {
      if (st.loading) return;
      st.loading = true; st.err = ""; paint();
      const r = await (api()?.batchesList?.() || Promise.resolve({ ok: false, error: "Phiên bản app không hỗ trợ mẻ" })).catch((e) => ({ ok: false, error: e.message }));
      st.loading = false;
      if (r && r.ok) { st.batches = r.batches || []; st.offline = !!r.offline; if (manual) toast("Đã làm mới"); }
      else st.err = (r && r.error) || "Không tải được danh sách mẻ";
      if (typeof st.sel === "number" && !byId(st.sel)) st.sel = null;     // mẻ đang xem đã bị xóa (vd ở máy khác)
      paint();
    }
    async function confirmLeave() {
      if (!st.dirty) return true;
      return window.appConfirm({ title: "Bỏ thay đổi?", message: "Mẻ đang sửa có thay đổi chưa lưu.", detail: "Chuyển sang mục khác sẽ mất những chỗ bạn vừa sửa.", confirmText: "Bỏ thay đổi", icon: "✏️" });
    }
    async function select(id) {
      if (st.sel === id) return;
      if (!(await confirmLeave())) return;
      st.sel = id; st.dirty = false; paint();
    }

    function paint() {
      const head = el("div", { class: "bt-head" },
        el("div", {}, el("h2", { text: "Mẻ" }), el("p", { class: "bt-sub", text: "Mỗi mẻ gồm nhiều kênh làm chung một đợt: render, thay thumb, lên lịch. Bấm một mẻ để xem và sửa bên phải. Web theo dõi mẻ nào đang chạy và kênh nào sắp hết lịch." })),
        el("div", { class: "bt-actions" },
          el("button", { class: "btn btn-secondary bt-add", type: "button", text: "⟳ Làm mới", onclick: () => load(true) }),
          el("button", { class: "btn btn-primary bt-add", type: "button", text: "＋ Thêm mẻ", disabled: st.offline, onclick: () => select("new") })));
      const kids = [head];
      if (st.offline) kids.push(el("div", { class: "bt-note warn", text: "Mất kết nối tới máy chủ: đang xem bản đã lưu, chưa thêm hoặc sửa được." }));
      if (st.err) kids.push(el("div", { class: "bt-note err", text: st.err }));
      const list = el("div", { class: "bt-list" });
      if (st.loading && !st.batches.length) list.append(el("div", { class: "bt-empty", text: "Đang tải…" }));
      else if (!st.batches.length && !st.err) list.append(el("div", { class: "bt-empty" }, el("strong", { text: "Chưa có mẻ nào" }), el("span", { text: "Bấm “＋ Thêm mẻ” để tạo mẻ đầu tiên." })));
      for (const b of st.batches) list.append(item(b));
      const side = el("aside", { class: "bt-side", "aria-label": "Chi tiết mẻ" });
      kids.push(el("div", { class: "bt-layout" }, list, side));
      root.replaceChildren(...kids);
      renderSide(side);
    }

    // một dòng trong danh sách: tên + thẻ tóm tắt + ba chấm trạng thái hành động; bấm để mở bên phải
    function item(b) {
      const rows = sortChannels(b.channels, b.warnDays), due = renderDue(b.lastRenderAt, b.cycleDays);
      const out = rows.filter((r) => r.s.key === "out").length, soon = rows.filter((r) => r.s.key === "soon").length;
      const cur = st.sel === b.id;
      const node = el("div", { class: "bt-item" + (cur ? " cur" : ""), role: "button", tabindex: "0", "aria-current": cur ? "true" : null, onclick: () => select(b.id),
        onkeydown: (ev) => { if ((ev.key === "Enter" || ev.key === " ") && ev.target === node) { ev.preventDefault(); select(b.id); } } },
        el("div", { class: "bt-item-top" }, el("strong", { text: b.name }), el("span", { class: "bt-count", text: (b.channels || []).length + " kênh" })),
        el("div", { class: "bt-chips" },
          el("span", { class: "bt-chip brand", text: b.totalDays + " ngày × " + b.videosPerDay + " video/ngày" }),
          b.currentDay ? el("span", { class: "bt-chip blue", text: "ngày " + b.currentDay + "/" + b.totalDays + " · vòng " + (b.roundNo || 1) }) : null,
          due ? el("span", { class: "bt-chip " + (due.overdue ? "err" : due.daysLeft <= 1 ? "warn" : "blue"), text: due.overdue ? "tới hạn render vòng mới" : "render sau " + due.daysLeft + " ngày" }) : el("span", { class: "bt-chip", text: "chưa render" }),
          out ? el("span", { class: "bt-chip err", text: out + " hết lịch" }) : null, soon ? el("span", { class: "bt-chip warn", text: soon + " sắp hết" }) : null),
        actionDots(b));
      return node;
    }

    // ---- khung bên phải: form sửa tại chỗ
    async function renderSide(side) {
      if (st.sel === null) { side.replaceChildren(el("div", { class: "bt-empty" }, el("strong", { text: "Chưa chọn mẻ" }), el("span", { text: "Bấm một mẻ ở bên trái để xem và sửa, hoặc “＋ Thêm mẻ”." }))); return; }
      const isNew = st.sel === "new", b = isNew ? null : byId(st.sel);
      if (!isNew && !b) { side.replaceChildren(); return; }
      const schema = await loadSchema();
      if (!schema) { side.replaceChildren(el("div", { class: "bt-note err", text: "Không tải được định nghĩa cấu hình render (app cũ?). Hãy cập nhật app." })); return; }
      if (st.sel !== (isNew ? "new" : b.id)) return; // người dùng đã bấm mục khác trong lúc chờ

      const rd = (b && b.render) || {};
      const name = el("input", { type: "text", maxlength: "100", value: b ? b.name : "", placeholder: "vd: Lofi đợt 1" });
      const days = numInput(b ? b.totalDays : 19, 1, 365), per = numInput(b ? b.videosPerDay : 3, 1, 100), cyc = numInput(b ? b.cycleDays : 19, 1, 365), warn = numInput(b ? b.warnDays : 1, 0, 30);
      const desc = el("textarea", { rows: "2", maxlength: "500", text: b ? b.description : "" });
      const curDay = numInput(b ? b.currentDay || 1 : 1, 1, 365);
      const mode = el("select", {}, schema.modes.map((m) => el("option", { value: m.id, text: m.label })));
      mode.value = schema.byMode[rd.renderMode] ? rd.renderMode : "topTransparent";

      // thông số render: dựng lại khi đổi kiểu; giữ giá trị đang nhập của từng kiểu trong bộ nhớ để đổi qua lại không mất
      const typed = {};
      const renderBox = el("div", { class: "bt-render" });
      const control = (f) => {
        const val = typed[f.key] ?? (rd[f.key] !== undefined ? rd[f.key] : f.def);
        let c;
        if (f.type === "bool") { c = el("input", { type: "checkbox", checked: val === true || val === "true" }); c.addEventListener("change", () => { typed[f.key] = c.checked; st.dirty = true; }); return el("label", { class: "bt-check" }, c, el("span", { text: f.label })); }
        if (f.type === "select") { c = el("select", {}, f.options.map((o) => el("option", { value: o, text: o }))); c.value = f.options.includes(String(val)) ? String(val) : f.def; }
        else if (f.type === "text") c = el("input", { type: "text", maxlength: "80", value: String(val), placeholder: f.def });
        else c = numInput(String(val), f.min, f.max, f.step);
        c.addEventListener("input", () => { typed[f.key] = c.value; st.dirty = true; });
        return field(f.label, c, f.help);
      };
      const drawRender = () => {
        const fs = [...schema.common, ...(schema.byMode[mode.value] || [])];
        renderBox.replaceChildren(el("div", { class: "bt-grid" }, fs.map(control)));
      };
      mode.addEventListener("change", () => { st.dirty = true; drawRender(); });
      drawRender();
      const collectRender = () => ({ renderMode: mode.value, renderValues: Object.fromEntries([...schema.common, ...(schema.byMode[mode.value] || [])].map((f) => [f.key, typed[f.key] ?? (rd[f.key] !== undefined ? rd[f.key] : f.def)])), renderBase: rd });
      // Mẻ đã tạo: ngày hiện tại + kiểu render + thông số render nằm trong tab Render (xem actionCard), không nằm ở form cài đặt
      st.renderCtx = isNew ? null : { id: b.id, curDay, mode, renderBox, collectRender };

      const msg = el("div", { class: "bt-msg", role: "alert" });
      const save = el("button", { class: "btn btn-primary", type: "button", text: isNew ? "Tạo mẻ" : "Lưu thay đổi", disabled: st.offline });
      const formKids = [
        field("Tên mẻ *", name),
        el("div", { class: "bt-row" }, field("Số ngày mỗi vòng", days), field("Video mỗi ngày / kênh", per)),
        el("div", { class: "bt-row" }, field("Chu kỳ render (ngày)", cyc, "Sau bấy nhiêu ngày kể từ lần render cuối thì tới hạn render vòng mới."), field("Báo khi lịch còn ≤ (ngày)", warn, "Kênh còn ít ngày hơn mức này thì cảnh báo, kể cả trên web.")),
        field("Ghi chú", desc)];
      if (isNew) formKids.push(el("div", { class: "bt-sep", text: "Cách render" }), field("Kiểu render", mode, "Giống mục Render. Đường dẫn thư mục, GPU, khóa API ở lại máy này, không lưu theo mẻ."), renderBox);
      formKids.push(msg);
      const form = el("div", { class: "bt-form" }, ...formKids);
      for (const x of [name, days, per, cyc, warn, desc, curDay]) x.addEventListener("input", () => { st.dirty = true; });

      save.addEventListener("click", async () => {
        const body = { name: name.value.trim(), description: desc.value, totalDays: Number(days.value), videosPerDay: Number(per.value), cycleDays: Number(cyc.value), warnDays: Number(warn.value),
          ...(isNew ? {} : { currentDay: Number(curDay.value) }), ...collectRender() };
        if (!body.name) { msg.className = "bt-msg err"; msg.textContent = "Tên mẻ không được để trống"; name.focus(); return; }
        save.disabled = true; const old = save.textContent; save.textContent = "Đang lưu…"; msg.textContent = "";
        const r = await (isNew ? api().batchesCreate(body) : api().batchesUpdate(b.id, body)).catch((e) => ({ ok: false, error: e.message }));
        if (!r || r.ok === false) { save.disabled = false; save.textContent = old; msg.className = "bt-msg err"; msg.textContent = (r && r.error) || "Không lưu được"; return; }
        st.dirty = false; if (isNew && r.batch) st.sel = r.batch.id;
        await load(); toast(isNew ? "Đã tạo mẻ" : "Đã lưu mẻ");
      });

      const head = el("div", { class: "bt-side-head" }, el("h3", { text: isNew ? "Thêm mẻ" : b.name }),
        isNew ? null : el("div", { class: "bt-side-actions" }, iconBtn("trash", "Xóa mẻ", "danger", () => removeBatch(b), st.offline)));
      const footer = el("div", { class: "bt-foot-row" }, isNew ? el("button", { class: "btn btn-secondary", type: "button", text: "Hủy", onclick: async () => { if (await confirmLeave()) { st.sel = null; st.dirty = false; paint(); } } }) : null, save);
      if (isNew) { side.replaceChildren(head, form, footer); return; }
      // hành động dùng nhiều nên ở trên cùng; cài đặt mẻ làm một lần nên gấp lại ở cuối
      const tog = el("button", { class: "bt-toggle", type: "button", "aria-expanded": "false", text: "▸ Cài đặt mẻ", onclick: () => {
        const o = tog.getAttribute("aria-expanded") === "true"; tog.setAttribute("aria-expanded", o ? "false" : "true"); tog.textContent = (o ? "▸" : "▾") + " Cài đặt mẻ"; wrap.classList.toggle("open", !o); } });
      const wrap = el("div", { class: "bt-collapse" }, el("div", { class: "bt-sep bt-sep-inside" }, tog), el("div", { class: "bt-collapse-body" }, form, footer));
      side.replaceChildren(head, actionsBlock(b), channelsBlock(b), wrap);
    }

    function channelsBlock(b) {
      const rows = sortChannels(b.channels, b.warnDays);
      const head = el("div", { class: "bt-ch-head" }, el("div", { class: "bt-sep", text: "Kênh trong mẻ (" + rows.length + ")" }),
        el("button", { class: "btn btn-primary bt-add", type: "button", text: "＋ Thêm kênh", disabled: st.offline, onclick: () => pickChannels(b) }));
      const body = rows.length
        ? el("table", { class: "cv-table bt-table" }, el("thead", {}, el("tr", {}, ["Kênh", "Lịch tới", "Tác vụ gần nhất", ""].map((h) => el("th", { text: h })))),
          el("tbody", {}, rows.map(({ c, s }) => el("tr", {},
            el("td", {}, el("strong", { text: c.name || c.gpmProfileId }), el("div", { class: "bt-mono", text: c.gpmProfileId })),
            el("td", {}, el("span", { class: "bt-st " + s.key, text: s.label })),
            el("td", { class: "bt-muted", text: c.lastTask ? c.lastTask + (c.lastTaskAt ? " · " + ago(c.lastTaskAt) : "") : "—" }),
            el("td", { class: "actions" }, iconBtn("unlink", "Bỏ kênh khỏi mẻ (không xóa profile trong GPM)", "danger", () => removeChannel(b, c), st.offline))))))
        : el("div", { class: "bt-empty small" }, el("span", { text: "Mẻ chưa có kênh. Bấm “＋ Thêm kênh” để chọn từ GPM." }));
      return el("div", { class: "bt-channels" }, head, body);
    }

    // ================= Hành động của mẻ =================
    // Mỗi hành động (Render / Thay thumbnail / Lên lịch) có cài đặt riêng, nút chạy riêng, kết quả riêng. KHÔNG nối liền nhau:
    // giữa chúng người dùng phải upload video bằng tay lên YouTube nên mỗi hành động được bấm khi tới lúc.
    const BA = () => window.BatchActions;
    const STATUS_TEXT = { running: "Đang chạy", success: "Thành công", failed: "Thất bại", canceled: "Đã dừng" };
    const STATUS_ICON = { success: "check", failed: "x", canceled: "ban" };
    const liveKey = (id, kind) => id + ":" + kind;
    const anyLive = () => st.live.size > 0;

    // trạng thái hiển thị: ưu tiên "đang chạy" trên máy này, rồi tới kết quả lần gần nhất lấy từ server
    function actionState(b, kind) {
      if (st.live.has(liveKey(b.id, kind))) return { status: "running", message: "", at: null };
      const r = (b.runs || {})[kind];
      return r && r.status ? r : { status: "none", message: "", at: null };
    }
    const SHORT = { render: "Render", thumb: "Thumbnail", schedule: "Lên lịch" };
    function dotNode(kind, s, withName) {
      const dot = el("span", { class: "bt-dot" }, STATUS_ICON[s.status] ? icon(STATUS_ICON[s.status]) : null);
      return el("div", { class: "bt-stage " + (s.status === "none" ? "pending" : s.status), title: BA().ACTION_LABEL[kind] + ": " + (STATUS_TEXT[s.status] || "Chưa chạy") + (s.message ? " · " + s.message : "") },
        dot, withName ? el("span", { class: "bt-stage-name", text: SHORT[kind] || kind }) : null);
    }
    // ba chấm nhỏ trong danh sách bên trái: nhìn lướt biết hành động nào xong/lỗi/đang chạy
    function actionDots(b) {
      const box = el("div", { class: "bt-pipe compact", "data-dots": b.id });
      BA().ACTION_IDS.forEach((k) => box.append(dotNode(k, actionState(b, k), true)));
      return box;
    }

    // cài đặt riêng của từng hành động: lấy từ server (đã lưu cho mẻ), thiếu thì lấy mặc định từ máy; gửi lên server khi bấm Chạy
    const drafts = new Map();
    const settingsFor = (b) => { if (!drafts.has(b.id)) drafts.set(b.id, BA().mergeSettings(b.actions, st.machineDefs || {})); return drafts.get(b.id); };

    // Tự lưu cài đặt hành động ngay khi gõ/chọn, không cần bấm Chạy:
    //  - đường dẫn thư mục: ghi ngay xuống đĩa của máy này (không bao giờ lên server)
    //  - phần còn lại (số ngày, ngày bắt đầu, giờ đăng, số video): gửi server sau khi ngừng gõ ~0,8 giây
    const saveTimers = new Map();
    function autosave(b) {
      const set = settingsFor(b), bl = window.BatchLocal;
      if (bl) { const { local } = bl.splitSettings(set); api().batchesSaveLocal?.(b.id, local).catch(() => {}); }
      clearTimeout(saveTimers.get(b.id));
      saveTimers.set(b.id, setTimeout(() => {
        saveTimers.delete(b.id);
        const remote = bl ? bl.splitSettings(settingsFor(b)).remote : null;
        if (remote && Object.keys(remote).length && !st.offline) api().batchesUpdate(b.id, { actions: remote }).catch(() => {}); // mất mạng thì thôi, lần Chạy sau sẽ gửi lại
      }, 800));
    }

    // một thẻ hành động: tiêu đề + trạng thái, cài đặt riêng, nút Chạy
    function actionCard(b, kind, saved) {
      const def = BA().ACTIONS.find((a) => a.id === kind), s = actionState(b, kind), running = s.status === "running";
      const set = saved[kind], inputs = {}, rows = [];
      const touch = () => autosave(b);
      const text = (key, label, ph, help) => { inputs[key] = el("input", { type: "text", value: set[key] || "", placeholder: ph || "" }); inputs[key].addEventListener("input", () => { set[key] = inputs[key].value; touch(); }); rows.push(field(label, inputs[key], help)); };
      const pickRow = (key, label, help) => {
        inputs[key] = el("input", { type: "text", value: set[key] || "", placeholder: "Chưa chọn (dùng thư mục đang chọn ở tab Render)", readonly: true });
        const clear = el("button", { class: "folder-clear", type: "button", title: "Bỏ chọn", "aria-label": "Bỏ chọn", text: "×", onclick: () => { inputs[key].value = ""; set[key] = ""; touch(); } });
        const pick = el("button", { class: "btn btn-secondary", type: "button", text: "Chọn", onclick: async () => { const p = await window.__batchPickFolder?.(); if (p) { inputs[key].value = p; set[key] = p; touch(); } } });
        rows.push(field(label, el("div", { class: "folder-select" }, el("div", { class: "folder-input-wrap" }, inputs[key], clear), pick), help));
      };
      const numField = (key, label, min, max, help) => { inputs[key] = numInput(set[key] || "", min, max); inputs[key].addEventListener("input", () => { set[key] = inputs[key].value; touch(); }); rows.push(field(label, inputs[key], help)); };

      if (kind === "render") {
        // Mọi thiết lập của render nằm ở đây: ngày hiện tại, thư mục nguồn/nền/đích, kiểu render và thông số (gấp lại cho gọn)
        const ctx = st.renderCtx && st.renderCtx.id === b.id ? st.renderCtx : null;
        if (ctx) rows.push(field("Ngày hiện tại của vòng", ctx.curDay, "Lần render kế sẽ render ngày này (" + b.videosPerDay + " video/kênh), vòng " + (b.roundNo || 1) + ". Tự tăng sau mỗi lần render xong; sửa nếu muốn render lại."));
        pickRow("overlayFolder", "Thư mục video nguồn (overlay)", "Ổ/thư mục chứa video nguồn của mẻ này.");
        pickRow("backgroundFolder", "Thư mục video nền", "Để trống nếu kiểu render không dùng nền.");
        pickRow("outputFolder", "Thư mục lưu video đã render (đích)", "Ổ/thư mục nhận video render xong.");
        if (ctx) {
          const tog = el("button", { class: "bt-toggle", type: "button", "aria-expanded": "false", text: "▸ Cách render", onclick: () => {
            const o = tog.getAttribute("aria-expanded") === "true"; tog.setAttribute("aria-expanded", o ? "false" : "true"); tog.textContent = (o ? "▸" : "▾") + " Cách render"; wrap.classList.toggle("open", !o); } });
          const wrap = el("div", { class: "bt-collapse" }, el("div", { class: "bt-sep bt-sep-inside" }, tog),
            el("div", { class: "bt-collapse-body" }, field("Kiểu render", ctx.mode, "Giống mục Render. GPU, khóa API ở lại máy này, không lưu theo mẻ."), ctx.renderBox));
          rows.push(wrap);
        }
      } else if (kind === "thumb") {
        pickRow("thumbFolder", "Thư mục ảnh thumbnail", "Dùng cho mọi kênh trong mẻ. Đường dẫn chỉ áp dụng trên máy này.");
        numField("numVideos", "Số video đổi thumbnail mỗi kênh", 1, 200, "Áp cho các video nháp (Draft) bạn đã upload tay.");
      } else {
        numField("numDays", "Số ngày lên lịch", 1, 60, "Mỗi ngày dùng hết các khung giờ bên dưới.");
        inputs.startDate = el("input", { type: "date", value: set.startDate || "" }); inputs.startDate.addEventListener("input", () => { set.startDate = inputs.startDate.value; touch(); });
        rows.push(field("Ngày bắt đầu (tuỳ chọn)", inputs.startDate, "Để trống = hôm nay. Video đầu tiên được đặt vào ngày kế tiếp."));
        text("postTimes", "Giờ đăng mỗi ngày", "8:00, 12:00, 18:00", "Nhiều khung giờ cách nhau bằng dấu phẩy.");
      }

      const msg = el("div", { class: "bt-msg", role: "alert" });
      const run = el("button", { class: "btn btn-primary bt-add", type: "button", text: running ? "Đang chạy…" : "▶ Chạy " + def.label.toLowerCase(), disabled: st.offline || running || anyLive(), onclick: () => runAction(b, kind, msg) });
      const stop = running ? el("button", { class: "btn btn-secondary bt-add", type: "button", text: "⏹ Dừng", onclick: () => stopAction(b, kind) }) : null;
      const status = el("div", { class: "bt-act-status " + (s.status === "none" ? "" : s.status) },
        s.status === "none" ? el("span", { text: "Chưa chạy" }) : el("span", { class: "bt-pbadge " + s.status, text: STATUS_TEXT[s.status] }),
        el("span", { class: "bt-help", text: [s.message, s.at ? ago(s.at) : ""].filter(Boolean).join(" · ") }));
      return el("div", { class: "bt-act " + (running ? "running" : ""), "data-act": kind },
        el("div", { class: "bt-act-head" }, dotNode(kind, s), el("div", { class: "bt-act-title" }, el("strong", { text: def.label }), el("div", { class: "bt-help", text: def.hint })), status),
        el("div", { class: "bt-act-body" }, ...rows), el("div", { class: "bt-act-foot" }, msg, stop, run));
    }

    // ba tab Render | Thay thumbnail | Lên lịch: chỉ hiện một thẻ, không phải kéo xuống
    function actionsBlock(b) {
      const saved = settingsFor(b);
      const tab = BA().ACTION_IDS.includes(st.actTab) ? st.actTab : "render";
      const tabs = el("div", { class: "bt-tabs", role: "tablist", "aria-label": "Hành động của mẻ" }, BA().ACTIONS.map((a) => {
        const s2 = actionState(b, a.id), on = a.id === tab;
        return el("button", { type: "button", role: "tab", class: "bt-tab" + (on ? " active" : ""), "aria-selected": on ? "true" : "false", title: a.label + ": " + (STATUS_TEXT[s2.status] || "Chưa chạy"),
          onclick: () => { st.actTab = a.id; try { localStorage.setItem("batch_act_tab", a.id); } catch { /* không quan trọng */ } refreshActionViews(); } },
          el("span", { class: "bt-tabdot " + (s2.status === "none" ? "pending" : s2.status) }), el("span", { text: a.label }));
      }));
      return el("div", { class: "bt-actions-block", "data-actions": b.id },
        tabs, actionCard(b, tab, saved),
        el("div", { class: "bt-help bt-actnote", text: "Mỗi hành động chạy riêng khi bạn bấm: giữa các bước bạn upload video bằng tay lên YouTube nên chúng không chạy nối tiếp." }));
    }
    // cập nhật tại chỗ khi trạng thái đổi, KHÔNG vẽ lại phần còn lại của form đang sửa
    function refreshActionViews() {
      for (const box of root.querySelectorAll("[data-dots]")) { const b = byId(Number(box.dataset.dots)); if (b) box.replaceWith(actionDots(b)); }
      const blk = root.querySelector("[data-actions]");
      if (blk) { const b = byId(Number(blk.dataset.actions)); if (b) blk.replaceWith(actionsBlock(b)); }
    }

    async function reportRun(b, kind, status, message, day) {
      try { await api().batchesActionRun?.(b.id, { kind, status, message, day, at: new Date().toISOString() }); } catch { /* báo web không được làm hỏng việc chạy */ }
    }
    async function runAction(b, kind, msgEl) {
      const fresh = byId(b.id) || b, set = settingsFor(fresh)[kind];
      const plan = BA().planAction(kind, fresh, set);
      if (!plan.ok) { msgEl.className = "bt-msg err"; msgEl.textContent = plan.errors.join(". "); return; }
      if (anyLive()) { toast("Đang chạy một hành động, đợi xong hoặc bấm Dừng.", "error"); return; }
      msgEl.textContent = "";
      // lưu cài đặt hành động lên server (web thấy ổ nguồn/đích, số ngày, ngày bắt đầu...). Với render còn lưu ngày hiện tại và cách render
      // vì render lấy chúng từ server: không lưu được thì KHÔNG chạy để khỏi render nhầm ngày hoặc nhầm kiểu.
      const ctx = kind === "render" && st.renderCtx && st.renderCtx.id === fresh.id ? st.renderCtx : null;
      const body = { ...(ctx ? { ...ctx.collectRender(), currentDay: Number(ctx.curDay.value) } : {}), actions: { [kind]: set } };
      const sv = await api().batchesUpdate(fresh.id, body).catch((e) => ({ ok: false, error: e.message }));
      if (ctx && (!sv || sv.ok === false)) { msgEl.className = "bt-msg err"; msgEl.textContent = "Không lưu được cấu hình render: " + ((sv && sv.error) || "lỗi"); return; }
      const key = liveKey(fresh.id, kind);
      st.live.set(key, true); st.stopFor = null; refreshActionViews();
      await reportRun(fresh, kind, "running", "");
      let r;
      try {
        r = kind === "render" ? await window.runBatchRenderAction(fresh, set) : await window.runBatchAutomationAction(kind, fresh, set);
        if (st.stopFor === key && !(r && r.ok)) r = { ok: false, canceled: true, message: "Đã dừng" };
      } catch (e) { r = { ok: false, message: String((e && e.message) || e) }; }
      const out = BA().normalizeOutcome(r);
      st.live.delete(key); st.stopFor = null;
      await reportRun(fresh, kind, out.status, out.message, r && r.day);
      toast(BA().ACTION_LABEL[kind] + ": " + (STATUS_TEXT[out.status] || out.status) + (out.message ? " · " + out.message : ""), out.status === "success" ? "success" : "error");
      st.dirty = false; await load(); // lấy ngày/vòng và kết quả mới từ server
    }
    function stopAction(b, kind) {
      st.stopFor = liveKey(b.id, kind);
      try { window.electronAPI.automation.stop(); } catch { /* không có tác vụ tự động hóa đang chạy */ }
      toast("Đã yêu cầu dừng. Render không dừng giữa chừng được; thay thumbnail và lên lịch dừng ở kênh kế tiếp.");
    }

    async function removeBatch(b) {
      if (!(await window.appConfirm({ title: "Xóa mẻ?", message: "Xóa mẻ “" + b.name + "” và " + (b.channels || []).length + " kênh trong mẻ?", detail: "Chỉ xóa khỏi danh sách theo dõi, không đụng tới profile GPM.", confirmText: "Xóa mẻ" }))) return;
      const r = await api().batchesDelete(b.id).catch((e) => ({ ok: false, error: e.message }));
      if (r && r.ok) { st.sel = null; st.dirty = false; toast("Đã xóa mẻ"); load(); } else toast((r && r.error) || "Không xóa được", "error");
    }
    async function removeChannel(b, c) {
      if (!(await window.appConfirm({ title: "Bỏ kênh khỏi mẻ?", message: "Bỏ kênh “" + (c.name || c.gpmProfileId) + "” khỏi mẻ “" + b.name + "”?", detail: "Chỉ bỏ khỏi mẻ, không xóa profile trong GPM.", confirmText: "Bỏ khỏi mẻ", icon: "🔗" }))) return;
      const r = await api().batchesRemoveChannel(b.id, c.gpmProfileId).catch((e) => ({ ok: false, error: e.message }));
      if (r && r.ok) { toast("Đã bỏ kênh khỏi mẻ"); st.dirty = false; load(); } else toast((r && r.error) || "Không bỏ được", "error");
    }

    // Chọn kênh từ danh sách GPM (nhiều kênh một lượt). Hộp thoại nhỏ vì đây là thao tác chọn, không phải sửa thông tin mẻ.
    function modal(title, bodyNode, { ok, onOk }) {
      const msg = el("div", { class: "bt-msg", role: "alert" });
      const yes = el("button", { class: "btn btn-primary", type: "button", text: ok });
      const wrap = el("div", { class: "modal active bt-modal" });
      const close = () => wrap.remove();
      wrap.append(el("div", { class: "modal-content" },
        el("div", { class: "modal-header" }, el("h3", { text: title }), el("button", { class: "modal-close", type: "button", "aria-label": "Đóng", text: "×", onclick: close })),
        el("div", { class: "modal-body" }, bodyNode, msg),
        el("div", { class: "bt-foot" }, el("button", { class: "btn btn-secondary", type: "button", text: "Hủy", onclick: close }), yes)));
      wrap.addEventListener("click", (e) => { if (e.target === wrap) close(); });
      wrap.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
      yes.addEventListener("click", async () => {
        yes.disabled = true; const old = yes.textContent; yes.textContent = "Đang thêm…"; msg.textContent = "";
        const r = await onOk().catch((e) => ({ ok: false, error: e.message }));
        if (r && r.ok === false) { yes.disabled = false; yes.textContent = old; msg.className = "bt-msg err"; msg.textContent = r.error || "Không thêm được"; return; }
        close(); await load();
      });
      document.body.append(wrap);
      setTimeout(() => wrap.querySelector("input")?.focus(), 30);
    }
    async function pickChannels(b) {
      const list = el("div", { class: "bt-pick-list", text: "Đang lấy danh sách GPM…" });
      const search = el("input", { type: "text", placeholder: "Tìm theo tên hoặc Profile ID…", autocomplete: "off" });
      const groupSel = el("select", { "aria-label": "Lọc theo group" }, el("option", { value: "", text: "Tất cả group" }));
      const count = el("span", { class: "bt-muted", text: "" });
      const chosen = new Set();
      let profiles = [], groups = {}, shown = [];
      const used = new Map(); // profileId -> lý do không chọn được
      for (const x of st.batches) for (const c of x.channels || []) used.set(c.gpmProfileId, x.id === b.id ? "đã có trong mẻ này" : "đang ở mẻ “" + x.name + "”");
      try {
        const ac = await window.ChannelConfigUI?.load?.();
        for (const c of (ac && ac.channels) || []) if (c.gpmProfileId) used.set(c.gpmProfileId, "đang chạy Auto (“" + c.name + "”)");
      } catch { /* không biết thì để server chặn */ }
      // groupId từ GPM có thể là số còn giá trị của <select> luôn là chuỗi: so sánh bằng chuỗi (so sánh trực tiếp làm lọc group không ra profile nào)
      const gkey = (p) => (p.groupId === undefined || p.groupId === null || p.groupId === "" ? "__none" : String(p.groupId));
      const draw = () => {
        const q = search.value.toLowerCase().trim(), g = groupSel.value;
        const rows = profiles.filter((p) => (!g || gkey(p) === g) && (!q || p.name.toLowerCase().includes(q) || (groups[p.groupId] || "").toLowerCase().includes(q) || p.id.toLowerCase().includes(q)));
        shown = rows;
        const free = rows.filter((p) => !used.has(p.id)).length;
        count.textContent = rows.length + (profiles.length !== rows.length ? " / " + profiles.length : "") + " kênh · " + free + " chọn được" + (chosen.size ? " · đã chọn " + chosen.size : "");
        list.replaceChildren(...(rows.length ? rows.map((p) => {
          const why = used.get(p.id), cb = el("input", { type: "checkbox", checked: chosen.has(p.id), disabled: !!why });
          cb.addEventListener("change", () => { cb.checked ? chosen.add(p.id) : chosen.delete(p.id); draw(); });
          return el("label", { class: "bt-pick" + (why ? " off" : "") }, cb, el("span", { class: "bt-pick-name", text: p.name }), el("span", { class: "bt-muted", text: groups[p.groupId] || "Chung" }), why ? el("span", { class: "bt-why", text: why }) : null);
        }) : [el("div", { class: "bt-empty small", text: profiles.length ? "Không có profile nào khớp." : "Không có profile GPM." })]));
      };
      search.addEventListener("input", draw);
      groupSel.addEventListener("change", draw);
      const selectAll = el("button", { class: "btn btn-secondary bt-add", type: "button", text: "Chọn hết kết quả", onclick: () => { for (const p of shown) if (!used.has(p.id)) chosen.add(p.id); draw(); } });
      const clearAll = el("button", { class: "btn btn-secondary bt-add", type: "button", text: "Bỏ chọn", onclick: () => { chosen.clear(); draw(); } });
      (async () => {
        const r = await api().gpmListProfilesFull?.().catch((e) => ({ ok: false, error: e.message }));
        if (!r || !r.ok) { list.textContent = "Không lấy được danh sách GPM: " + ((r && r.error) || "GPM chưa chạy?"); return; }
        profiles = r.profiles || []; groups = Object.fromEntries((r.groups || []).map((gr) => [gr.id, gr.name]));
        const per = new Map(); for (const p of profiles) per.set(gkey(p), (per.get(gkey(p)) || 0) + 1);
        [...per].sort((x, y) => String(x[0] === "__none" ? "Chung" : groups[x[0]] || x[0]).localeCompare(String(y[0] === "__none" ? "Chung" : groups[y[0]] || y[0]), "vi"))
          .forEach(([k, n]) => groupSel.append(el("option", { value: k, text: (k === "__none" ? "Chung" : groups[k] || k) + " (" + n + ")" })));
        draw();
      })();
      modal("Thêm kênh vào “" + b.name + "”", el("div", {}, field("Chọn kênh từ GPM", el("div", { class: "bt-pickrow" }, search, groupSel), "Mỗi profile chỉ ở một mẻ hoặc một kênh Auto."), list,
        el("div", { class: "bt-pick-foot" }, count, el("span", { class: "bt-pick-btns" }, selectAll, clearAll))), {
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

    try { st.actTab = localStorage.getItem("batch_act_tab") || "render"; } catch { st.actTab = "render"; }
    try { st.machineDefs = window.__batchMachineDefaults ? window.__batchMachineDefaults() : {}; } catch { st.machineDefs = {}; }
    paint(); load();
    return { reload: () => { if (root.offsetParent !== null && !st.dirty) load(); } };
  }

  window.BatchUI = { mount, scheduleStatus, renderDue, sortChannels };
})();
