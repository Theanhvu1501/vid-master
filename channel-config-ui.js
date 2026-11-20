/* Sửa cấu hình kênh ngay trong app (cùng dữ liệu với web). Mọi thay đổi đi qua máy chủ: web và app không thể lệch nhau.
 *
 * - Form được dựng từ ĐỊNH NGHĨA TRƯỜNG do máy chủ gửi kèm, nên app không giữ bản sao danh sách trường (không bao giờ lệch với web).
 * - Chỉ sửa kênh của máy này. Không tạo/xóa kênh, không đổi tên hay đổi máy (làm ở web).
 * - Mất mạng: xem được bản đã lưu nhưng khóa nút Lưu. Hai nơi sửa cùng lúc: máy chủ trả 409, app nạp lại bản mới.
 * - Giao diện chỉ dùng textContent / value (không nội suy HTML) vì mọi chuỗi đều đến từ máy chủ.
 *
 * Dùng như script thường (nạp trước renderer.js): window.ChannelConfigUI.open(name) / .onChange(cb).
 */
(function () {
  "use strict";
  const api = () => window.electronAPI && window.electronAPI.sheet;
  const $ = (id) => document.getElementById(id);
  let st = { data: null, offline: false, byName: new Map(), loading: false };
  const listeners = new Set();

  // ---------------------------------------------------------------- dựng phần tử an toàn
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

  // ---------------------------------------------------------------- tải dữ liệu
  async function load() {
    if (!api() || !api().channelsList) return { ok: false, error: "Phiên bản app không hỗ trợ" };
    st.loading = true;
    const r = await api().channelsList().catch((e) => ({ ok: false, error: e.message }));
    st.loading = false;
    if (r && r.ok) {
      st.data = r; st.offline = !!r.offline;
      st.byName = new Map(r.channels.map((c) => [c.name, c]));
    }
    return r;
  }

  // ---------------------------------------------------------------- giá trị <-> ô nhập
  function rawOf(c, schema) {
    const raw = {};
    for (const f of schema.fields) {
      let v = f.section === "core" ? c[f.key] : (c.params || {})[f.key];
      if (v === undefined || v === null) v = "";
      raw[f.key] = typeof v === "boolean" ? (v ? "1" : "0") : Array.isArray(v) ? v.join(", ") : String(v);
    }
    return raw;
  }
  function control(f, value, withDefault) {
    const id = `ccu-${f.key}`;
    const common = { id, "data-k": f.key };
    if (f.type === "bool") {
      const s = el("select", common);
      if (withDefault) s.append(el("option", { value: "", text: "(mặc định)" }));
      s.append(el("option", { value: "1", text: "Bật" }), el("option", { value: "0", text: "Tắt" }));
      s.value = value; return s;
    }
    if (f.type === "enum") {
      const s = el("select", common);
      if (withDefault) s.append(el("option", { value: "", text: "(mặc định)" }));
      for (const o of f.options) { const m = (st.data.schema.modes || []).find((x) => x.id === o); s.append(el("option", { value: o, text: m ? m.label : o })); }
      s.value = value; return s;
    }
    if (f.type === "source") {
      const s = el("select", common, el("option", { value: "download", text: "Tải về từ kênh nguồn" }), el("option", { value: "local", text: "Có sẵn trên máy" }));
      s.value = value === "local" ? "local" : "download"; return s;
    }
    const i = el("input", { ...common, type: "text", autocomplete: "off", spellcheck: "false", placeholder: f.placeholder || (f.min !== undefined ? `${f.min} – ${f.max}` : "") });
    i.value = value; return i;
  }
  const readAll = (root) => { const o = {}; root.querySelectorAll("[data-k]").forEach((e) => { o[e.dataset.k] = e.value; }); return o; };
  const typed = (schema, raw) => {
    const out = {};
    for (const [k, v] of Object.entries(raw)) { const f = schema.fields.find((x) => x.key === k); out[k] = f && f.type === "bool" ? (v === "1" ? true : v === "0" ? false : "") : v; }
    return out;
  };

  // ---------------------------------------------------------------- hộp thoại
  function ensureModal() {
    let m = $("ccu-modal");
    if (m) return m;
    m = el("div", { id: "ccu-modal", class: "modal" });
    document.body.append(m);
    m.addEventListener("click", (e) => { if (e.target === m) close(); });
    return m;
  }
  function close() { const m = $("ccu-modal"); if (m) m.classList.remove("active"); }
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && $("ccu-modal")?.classList.contains("active")) close(); });

  function badge(text, cls) { return el("span", { class: `ccu-badge ${cls || ""}`, text }); }

  async function open(name) {
    const m = ensureModal();
    const spinner = el("div", { class: "ccu-card" }, el("div", { class: "ccu-head" }, el("h3", { text: name || "Kênh" }), el("button", { class: "modal-close", type: "button", onclick: close, "aria-label": "Đóng", text: "×" })), el("div", { class: "ccu-body", text: "Đang tải…" }));
    m.replaceChildren(spinner); m.classList.add("active");
    const r = await load();
    if (!r || !r.ok) {
      m.replaceChildren(el("div", { class: "ccu-card" }, head(name || "Kênh"), el("div", { class: "ccu-body" }, el("p", { class: "ccu-err", text: (r && r.error) || "Không tải được cấu hình kênh" }), el("p", { class: "ccu-muted", text: "Cần có mạng và đăng nhập lần đầu để xem cấu hình kênh." })), el("div", { class: "ccu-foot" }, el("button", { class: "btn btn-secondary", type: "button", onclick: close, text: "Đóng" }))));
      return;
    }
    const c = st.byName.get(name);
    if (!c) {
      m.replaceChildren(el("div", { class: "ccu-card" }, head(name), el("div", { class: "ccu-body" }, el("p", { class: "ccu-err", text: `Không thấy kênh “${name}” trên web cho máy này.` }), el("p", { class: "ccu-muted", text: "Kênh có thể đã bị xóa hoặc chuyển sang máy khác. Hãy kiểm tra ở trang web." })), el("div", { class: "ccu-foot" }, el("button", { class: "btn btn-secondary", type: "button", onclick: close, text: "Đóng" }))));
      return;
    }
    render(c);
  }
  function head(title, sub) {
    return el("div", { class: "ccu-head" }, el("div", {}, el("h3", { text: title }), sub ? el("div", { class: "ccu-sub", text: sub }) : null), el("button", { class: "modal-close", type: "button", onclick: close, "aria-label": "Đóng", text: "×" }));
  }

  function render(c) {
    const m = ensureModal(), schema = st.data.schema;
    let raw = rawOf(c, schema);
    const mode = () => raw.renderMode || "topTransparent";
    const fieldByKey = (k) => schema.fields.find((f) => f.key === k);
    const group = (f, withDefault) => {
      const g = el("div", { class: "ccu-group" }, el("label", { for: `ccu-${f.key}`, text: f.label }));
      g.append(control(f, raw[f.key], withDefault));
      if (f.help) g.append(el("div", { class: "ccu-help", text: f.help }));
      return g;
    };

    const body = el("div", { class: "ccu-body" });
    const form = el("form", { id: "ccu-form", autocomplete: "off", novalidate: true });
    const foot = el("div", { class: "ccu-foot" });

    // đầu: tên + thống kê + cảnh báo
    const vs = c.videoStats || {};
    const sub = [c.proxy ? proxyLine(c) : "", `đã đăng ${vs.posted || 0}/${vs.total || 0} video`].filter(Boolean).join(" · ");
    m.replaceChildren(el("div", { class: "ccu-card" }, head(c.name, sub), body));
    if (st.offline) body.append(el("div", { class: "ccu-note warn", text: "Đang mất kết nối tới máy chủ: chỉ xem được bản đã lưu, chưa sửa được. Có mạng lại hãy mở lại hộp này." }));
    if (c.warnings && c.warnings.length) {
      const ul = el("ul", {}, c.warnings.map((w) => el("li", {}, w.field && fieldByKey(w.field) ? el("b", { text: fieldByKey(w.field).label + ": " }) : null, w.message)));
      body.append(el("div", { class: "ccu-note warn" }, el("strong", { text: `Cần xử lý (${c.warnings.length})` }), ul));
    }
    body.append(form);

    const core = (k) => fieldByKey(k);
    const row = (...fs) => el("div", { class: "ccu-row" }, fs.map((f) => group(core(f), false)));
    form.append(
      row("enabled", "uploadEnabled"), row("videosPerDay", "videoSource"), group(core("sourceHandle"), false), group(core("postTimes"), false),
      row("gpmProfileId", "monetized"), group(core("channelUrl"), false),
    );
    // proxy: địa chỉ + user/mật khẩu + hạn
    form.append(group(core("proxy"), false));
    const pxu = el("input", { id: "ccu-pxuser", "data-k": "proxyUser", type: "text", autocomplete: "off", spellcheck: "false", placeholder: c.proxyPassSet ? "Để trống = giữ nguyên" : "Tên đăng nhập proxy" });
    const pxp = el("input", { id: "ccu-pxpass", "data-k": "proxyPass", type: "password", autocomplete: "new-password", placeholder: c.proxyPassSet ? "Để trống = giữ nguyên" : "Mật khẩu proxy" });
    form.append(el("div", { class: "ccu-row" }, el("div", { class: "ccu-group" }, el("label", { for: "ccu-pxuser", text: "User proxy" }), pxu), el("div", { class: "ccu-group" }, el("label", { for: "ccu-pxpass", text: "Mật khẩu proxy" }), pxp)));
    form.append(el("div", { class: "ccu-help", text: c.proxyPassSet ? `Đã lưu user ${c.proxyUser || ""}. Mật khẩu được mã hóa trên máy chủ, không hiển thị lại.` : "Chưa lưu user/mật khẩu proxy. Mật khẩu được mã hóa trên máy chủ." }));
    if (c.proxyPassSet) form.append(el("label", { class: "ccu-chk" }, el("input", { type: "checkbox", id: "ccu-clearpx" }), el("span", { text: "Xóa user/mật khẩu proxy đã lưu" })));
    if (c.proxy) {
      if (c.proxyExpirySource === "provider") {
        form.append(el("div", { class: "ccu-group" }, el("label", { text: "Ngày hết hạn proxy" }), el("div", { class: "ccu-auto", text: `${new Date(c.proxyExpiresAt).toLocaleDateString("vi-VN")} · tự lấy từ nhà cung cấp proxy (còn ${c.proxyDaysLeft} ngày)` })));
      } else {
        const d = el("input", { id: "ccu-pxexp", "data-k": "proxyExpiresAt", type: "date" }); d.value = c.proxyExpiryManual || "";
        form.append(el("div", { class: "ccu-group" }, el("label", { for: "ccu-pxexp", text: "Ngày hết hạn proxy (nhập tay)" }), d, el("div", { class: "ccu-help", text: "Proxy chưa có trong tài khoản nhà cung cấp nên không tự lấy được hạn. Các kênh dùng chung proxy này cùng thấy số ngày còn lại." })));
      }
    }
    // cách render: đổi kiểu thì dựng lại phần thông số
    form.append(el("div", { class: "ccu-sep", text: "Cách render" }));
    const modeBox = el("div", { class: "ccu-modebox" });
    const drawMode = () => {
      const md = (schema.modes || []).find((x) => x.id === mode());
      const fs = schema.fields.filter((f) => f.section === "mode" && f.modes.includes(mode()));
      modeBox.replaceChildren(
        md ? el("div", { class: "ccu-help", text: md.help }) : null,
        mode() === "composer" ? group(core("presetName"), false) : null,
        fs.length ? el("div", { class: "ccu-grid" }, fs.map((f) => group(f, true))) : el("div", { class: "ccu-help", text: "Kiểu này không có thông số riêng." }),
      );
    };
    form.append(group(core("renderMode"), false), modeBox);
    drawMode();
    form.append(el("div", { class: "ccu-note", text: "Tên kênh, máy chạy và việc tạo hoặc xóa kênh làm ở trang web. Tài khoản Gmail, mật khẩu và 2FA chỉ nhập ở tab Tự động hóa của app." }));

    const msg = el("div", { class: "ccu-msg", role: "alert", "aria-live": "polite" });
    const save = el("button", { class: "btn btn-primary", type: "submit", form: "ccu-form", id: "ccu-save", text: "Lưu thay đổi" });
    if (st.offline) { save.disabled = true; save.title = "Mất kết nối tới máy chủ"; }
    foot.append(msg, el("button", { class: "btn btn-secondary", type: "button", onclick: close, text: "Đóng" }), save);
    m.firstChild.append(foot);

    form.addEventListener("change", (e) => {
      if (e.target.dataset && e.target.dataset.k === "renderMode") { raw = { ...raw, ...readAll(form) }; drawMode(); const f = $("ccu-renderMode"); if (f) f.focus(); }
    });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (st.offline) return;
      raw = { ...raw, ...readAll(form) };
      const out = typed(schema, raw);
      // chỉ gửi tham số của kiểu đang chọn (tham số kiểu khác giữ nguyên trên máy chủ); các khóa không sửa được thì bỏ
      const keep = new Set([...schema.coreKeys, "proxyUser", "proxyPass", "proxyExpiresAt", ...schema.fields.filter((f) => f.section === "mode" && f.modes.includes(mode())).map((f) => f.key)]);
      for (const k of Object.keys(out)) if (!keep.has(k)) delete out[k];
      delete out.name; if (mode() !== "composer") delete out.presetName;
      if (!out.proxyUser) delete out.proxyUser; if (!out.proxyPass) delete out.proxyPass;
      if ($("ccu-clearpx") && $("ccu-clearpx").checked) out.clearProxyAuth = true;
      out.version = c.version;
      save.disabled = true; save.textContent = "Đang lưu…"; msg.textContent = ""; msg.className = "ccu-msg";
      const r = await api().channelsUpdate(c.id, out).catch((er) => ({ ok: false, error: er.message }));
      if (r && r.ok) {
        msg.textContent = "Đã lưu"; msg.className = "ccu-msg ok";
        listeners.forEach((cb) => { try { cb(r.channel); } catch { /* ignore */ } });
        // nạp lại để hiện cảnh báo/hạn proxy mới nhất, giữ hộp thoại mở
        const again = await load(); const nc = again.ok && st.byName.get(c.name);
        if (nc) { render(nc); const mm = $("ccu-modal"); const s2 = mm && mm.querySelector(".ccu-msg"); if (s2) { s2.textContent = "Đã lưu"; s2.className = "ccu-msg ok"; } }
        return;
      }
      save.disabled = false; save.textContent = "Lưu thay đổi";
      msg.className = "ccu-msg err";
      if (r && r.status === 409) {
        msg.textContent = "Kênh vừa được sửa ở nơi khác (web hoặc máy khác). Đã nạp lại bản mới, hãy kiểm tra rồi sửa tiếp.";
        const again = await load(); const nc = again.ok && st.byName.get(c.name);
        if (nc) { render(nc); const s2 = $("ccu-modal").querySelector(".ccu-msg"); if (s2) { s2.textContent = "Kênh vừa được sửa ở nơi khác. Đã nạp lại bản mới."; s2.className = "ccu-msg err"; } }
      } else if (r && r.offline) {
        st.offline = true; msg.textContent = "Mất kết nối tới máy chủ, chưa lưu được. Kiểm tra mạng rồi thử lại."; save.disabled = true;
      } else msg.textContent = (r && r.error) || "Không lưu được";
    });
    setTimeout(() => { const f = $("ccu-videosPerDay") || form.querySelector("input,select"); if (f) f.focus(); }, 50);
  }

  function proxyLine(c) {
    const d = c.proxyDaysLeft;
    if (d === null || d === undefined) return "Proxy: chưa rõ hạn";
    return d <= 0 ? "Proxy đã hết hạn" : `Proxy còn ${d} ngày`;
  }

  // ---------------------------------------------------------------- tiện ích cho thẻ kênh
  /** Thông tin đã lưu của một kênh (để thẻ hiện ngày hết hạn proxy, số video đã đăng) sau lần tải gần nhất. */
  window.ChannelConfigUI = {
    open, load, close,
    get: (name) => st.byName.get(name) || null,
    isOffline: () => st.offline,
    onChange(cb) { listeners.add(cb); return () => listeners.delete(cb); },
    proxyLine,
  };
})();
