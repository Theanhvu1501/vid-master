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
    m = el("div", { id: "ccu-modal", class: "modal ccu-host" });
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

  // opts.host: vẽ thẳng vào phần tử này (khung chi tiết bên phải); không có thì dùng hộp thoại
  function render(c, opts = {}) {
    const inline = !!opts.host;
    const m = opts.host || ensureModal(), schema = st.data.schema;
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
    const sub = [c.proxy ? proxyLine(c) : "", `hôm nay ${vs.today || 0}/${vs.perDay || 0}`, vs.errors ? `${vs.errors} lỗi` : "", `đã đăng ${vs.posted || 0}/${vs.total || 0} video`].filter(Boolean).join(" · ");
    if (inline) m.replaceChildren(el("div", { class: "ccu-inline" }, body));
    else m.replaceChildren(el("div", { class: "ccu-card" }, head(c.name, sub), body));
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
    );

    // GPM Profile: custom dropdown với tìm kiếm, hiện "Tên (Group)"
    const gpmGroup = el("div", { class: "ccu-group" });
    const gpmLabel = el("label", { for: "ccu-gpmProfileId-input", text: "GPM Profile" });
    const gpmHidden = el("input", { type: "hidden", id: "ccu-gpmProfileId", "data-k": "gpmProfileId", value: raw.gpmProfileId || "" });
    const gpmWrap = el("div", { class: "ccu-gpm-wrap" });
    const gpmInput = el("input", { type: "text", id: "ccu-gpmProfileId-input", class: "ccu-gpm-input", autocomplete: "off", placeholder: "Tìm hoặc chọn profile..." });
    const gpmClear = el("button", { type: "button", class: "ccu-gpm-clear", title: "Xóa", text: "×" });
    const gpmDropdown = el("div", { class: "ccu-gpm-dropdown" });
    gpmWrap.append(gpmInput, gpmClear, gpmDropdown);
    const gpmHelp = el("div", { class: "ccu-help", text: "Profile GPM để chạy kênh này. Gõ để tìm, click để chọn." });
    gpmGroup.append(gpmLabel, gpmHidden, gpmWrap, gpmHelp);
    form.append(el("div", { class: "ccu-row" }, gpmGroup, group(core("monetized"), false)));
    form.append(group(core("channelUrl"), false));

    // GPM Profile dropdown logic
    let gpmProfiles = [], gpmGroups = {}, gpmSelected = null;
    let proxyAutoFilled = null; // giá trị ô Proxy do app tự điền từ profile (khác giá trị người dùng tự gõ)
    const setGpmDisplay = (p) => {
      gpmSelected = p;
      if (p) {
        gpmHidden.value = p.id;
        gpmInput.value = `${p.name} (${gpmGroups[p.groupId] || "Chung"})`;
        gpmClear.style.display = "block";
      } else {
        gpmHidden.value = "";
        gpmInput.value = "";
        gpmClear.style.display = "none";
      }
    };
    const renderGpmDropdown = (filter = "") => {
      const q = filter.toLowerCase().trim();
      const filtered = gpmProfiles.filter(p => {
        const grp = gpmGroups[p.groupId] || "Chung";
        return p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q) || grp.toLowerCase().includes(q);
      });
      gpmDropdown.innerHTML = "";
      if (!filtered.length) {
        gpmDropdown.append(el("div", { class: "ccu-gpm-empty", text: q ? "Không tìm thấy profile" : "Không có profile GPM" }));
        return;
      }
      // Group by group_id, sort groups alphabetically
      const byGroup = new Map();
      for (const p of filtered) {
        const gid = p.groupId || "__none";
        if (!byGroup.has(gid)) byGroup.set(gid, []);
        byGroup.get(gid).push(p);
      }
      const sortedGroups = [...byGroup.entries()].sort((a, b) => {
        const na = gpmGroups[a[0]] || "Chung", nb = gpmGroups[b[0]] || "Chung";
        return na.localeCompare(nb);
      });
      for (const [gid, ps] of sortedGroups) {
        const grpName = gpmGroups[gid] || "Chung";
        gpmDropdown.append(el("div", { class: "ccu-gpm-grp", text: grpName }));
        for (const p of ps) {
          const item = el("div", { class: "ccu-gpm-item" + (p.id === gpmHidden.value ? " active" : ""), "data-id": p.id });
          item.append(el("span", { class: "ccu-gpm-name", text: p.name }), el("span", { class: "ccu-gpm-id", text: p.id }));
          item.addEventListener("click", () => {
            setGpmDisplay(p);
            // Tự động điền địa chỉ proxy của profile (proxyMasked chỉ có scheme://host:port, không có user/mật khẩu).
            // Profile không dùng proxy thì để trống: kênh không có hạn proxy.
            proxyAutoFilled = p.hasProxy ? (p.proxyMasked || "") : "";
            proxyInput.value = proxyAutoFilled;
            proxyInput.dispatchEvent(new Event("input", { bubbles: true }));
            // Báo rõ kết quả: profile không có proxy thì ô để trống là đúng, không phải lỗi
            proxyHelpEl.textContent = p.hasProxy
              ? `Đã điền proxy của profile "${p.name}". Bấm Lưu để gửi địa chỉ lên web (user/mật khẩu ở lại trong GPM).`
              : `Profile "${p.name}" không dùng proxy trong GPM nên ô này để trống (kênh sẽ không có hạn proxy).`;
            gpmDropdown.classList.remove("open");
          });
          gpmDropdown.append(item);
        }
      }
    };
    // Focus: mở dropdown, nếu đã có giá trị thì xóa để tìm
    gpmInput.addEventListener("focus", () => {
      gpmDropdown.classList.add("open");
      if (gpmSelected) {
        gpmInput.value = "";  // Clear để tìm kiếm
        gpmInput.placeholder = `Đang chọn: ${gpmSelected.name}. Gõ để tìm...`;
      }
      renderGpmDropdown("");
    });
    gpmInput.addEventListener("input", () => renderGpmDropdown(gpmInput.value));
    gpmInput.addEventListener("blur", () => {
      setTimeout(() => {
        gpmDropdown.classList.remove("open");
        // Restore display nếu không chọn gì mới
        if (gpmSelected) {
          gpmInput.value = `${gpmSelected.name} (${gpmGroups[gpmSelected.groupId] || "Chung"})`;
          gpmInput.placeholder = "Tìm hoặc chọn profile...";
        }
      }, 180);
    });
    gpmInput.addEventListener("keydown", (e) => { if (e.key === "Escape") { gpmDropdown.classList.remove("open"); gpmInput.blur(); } });
    gpmClear.addEventListener("click", (e) => { e.preventDefault(); setGpmDisplay(null); gpmInput.focus(); });
    gpmClear.style.display = raw.gpmProfileId ? "block" : "none";

    // Async load GPM profiles
    (async () => {
      try {
        const gpmApi = window.electronAPI?.sheet?.gpmListProfilesFull;
        if (!gpmApi) { gpmHelp.textContent = "Phiên bản app không hỗ trợ lấy danh sách GPM Profile."; return; }
        const r = await gpmApi();
        if (!r || !r.ok) { gpmHelp.textContent = "Không lấy được danh sách GPM Profile: " + (r?.error || "lỗi"); return; }
        gpmProfiles = r.profiles || [];
        gpmGroups = Object.fromEntries((r.groups || []).map(g => [g.id, g.name]));
        // Set display value
        const cur = gpmProfiles.find(p => p.id === raw.gpmProfileId);
        if (cur) {
          setGpmDisplay(cur);
        } else if (raw.gpmProfileId) {
          gpmInput.value = `${raw.gpmProfileId} (không tìm thấy)`;
          gpmClear.style.display = "block";
        }
        gpmHelp.textContent = `${gpmProfiles.length} profile GPM. Click vào ô để tìm và chọn.`;
        renderGpmDropdown();
      } catch (e) { gpmHelp.textContent = "Lỗi khi lấy danh sách GPM: " + e.message; }
    })();

    // Proxy: web chỉ giữ địa chỉ (để tra hạn). Chọn GPM Profile thì tự điền địa chỉ proxy của profile đó.
    // Muốn đổi proxy: nhập đủ ip:port:user:pass, app ghi vào GPM profile (user/mật khẩu không lên web).
    const pxHelp = "Tự điền khi chọn GPM Profile. Muốn đổi proxy: nhập ip:port:user:pass, app lưu vào GPM trên máy này, web chỉ nhận địa chỉ ip:port để tra hạn.";
    const proxyInput = el("input", { id: "ccu-proxy", "data-k": "proxy", type: "text", autocomplete: "off", spellcheck: "false", class: "ccu-mono", value: raw.proxy || "", placeholder: "Chọn GPM Profile để tự điền, hoặc ip:port:user:pass" });
    const proxyHelpEl = el("div", { class: "ccu-help", text: pxHelp });
    form.append(el("div", { class: "ccu-group" }, el("label", { for: "ccu-proxy", text: "Proxy tải" }), proxyInput, proxyHelpEl));
    if (c.proxy) {
      const st2 = c.proxyExpiryState || "unknown";
      if (c.proxyExpiresAt) form.append(el("div", { class: "ccu-auto" }, `Hết hạn ${new Date(c.proxyExpiresAt).toLocaleDateString("vi-VN")} · còn ${c.proxyDaysLeft} ngày${c.proxyExpiryProvider ? " · theo " + c.proxyExpiryProvider : ""}`));
      else form.append(el("div", { class: "ccu-expwait" }, st2 === "searching" ? "Đang hỏi lần lượt các nhà cung cấp proxy…" : st2 === "notfound" ? "Không nhà cung cấp nào đã kết nối có IP này." : "Chưa tra được hạn proxy."));
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
    form.append(el("div", { class: "ccu-note", text: "Tên kênh, máy chạy và việc tạo hoặc xóa kênh làm ở trang web. Telegram đã cấu hình trên web." }));

    const msg = el("div", { class: "ccu-msg", role: "alert", "aria-live": "polite" });
    const save = el("button", { class: "btn btn-primary", type: "submit", form: "ccu-form", id: "ccu-save", text: "Lưu thay đổi" });
    if (st.offline) { save.disabled = true; save.title = "Mất kết nối tới máy chủ"; }
    foot.append(msg, el("button", { class: "btn btn-secondary", type: "button", onclick: close, text: "Đóng" }), save);
    m.firstChild.append(foot);
    const rerender = (nc) => render(nc, opts);

    form.addEventListener("change", (e) => {
      if (e.target.dataset && e.target.dataset.k === "renderMode") { raw = { ...raw, ...readAll(form) }; drawMode(); const f = $("ccu-renderMode"); if (f) f.focus(); }
    });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (st.offline) return;
      raw = { ...raw, ...readAll(form) };
      const out = typed(schema, raw);
      // chỉ gửi tham số của kiểu đang chọn (tham số kiểu khác giữ nguyên trên máy chủ); các khóa không sửa được thì bỏ
      const keep = new Set([...schema.coreKeys, ...schema.fields.filter((f) => f.section === "mode" && f.modes.includes(mode())).map((f) => f.key)]);
      for (const k of Object.keys(out)) if (!keep.has(k)) delete out[k];
      delete out.name; if (mode() !== "composer") delete out.presetName;
      // Proxy: web chỉ nhận địa chỉ (scheme://host:port). Nếu người dùng gõ proxy đầy đủ có user/mật khẩu thì ghi vào
      // GPM profile trên máy này (main process), phần gửi lên web đã bị cắt user/mật khẩu.
      const typedProxy = String(out.proxy || "").trim();
      let gpmWrite = null;
      if (typedProxy === (c.proxy || "") || (proxyAutoFilled !== null && typedProxy === proxyAutoFilled)) delete out.proxy; // không đổi / app tự điền: không gửi lại
      else if (typedProxy) {
        const hasAuth = /@|^[^/]+:\d+:[^:]+:/.test(typedProxy.replace(/^[a-z0-9]+:\/\//i, ""));
        if (hasAuth) gpmWrite = typedProxy;
      }
      out.version = c.version;
      save.disabled = true; save.textContent = "Đang lưu…"; msg.textContent = ""; msg.className = "ccu-msg";
      if (gpmWrite) {
        const pid = String(out.gpmProfileId || raw.gpmProfileId || "").trim();
        if (!pid) { save.disabled = false; save.textContent = "Lưu thay đổi"; msg.className = "ccu-msg err"; msg.textContent = "Chọn GPM Profile trước khi nhập proxy có user/mật khẩu (proxy được lưu vào profile)."; return; }
        const w = await api().gpmSetProfileProxy(pid, gpmWrite).catch((er) => ({ ok: false, error: er.message }));
        if (!w || !w.ok) { save.disabled = false; save.textContent = "Lưu thay đổi"; msg.className = "ccu-msg err"; msg.textContent = "Không ghi được proxy vào GPM: " + ((w && w.error) || "lỗi"); return; }
        out.proxy = w.addr; // chỉ scheme://host:port
      }
      const r = await api().channelsUpdate(c.id, out).catch((er) => ({ ok: false, error: er.message }));
      if (r && r.ok) {
        msg.textContent = "Đã lưu"; msg.className = "ccu-msg ok";
        listeners.forEach((cb) => { try { cb(r.channel); } catch { /* ignore */ } });
        // nạp lại để hiện cảnh báo/hạn proxy mới nhất, giữ hộp thoại mở
        const again = await load(); const nc = again.ok && st.byName.get(c.name);
        if (nc) { rerender(nc); const s2 = m.querySelector(".ccu-msg"); if (s2) { s2.textContent = "Đã lưu"; s2.className = "ccu-msg ok"; } }
        return;
      }
      save.disabled = false; save.textContent = "Lưu thay đổi";
      msg.className = "ccu-msg err";
      if (r && r.status === 409) {
        msg.textContent = "Kênh vừa được sửa ở nơi khác (web hoặc máy khác). Đã nạp lại bản mới, hãy kiểm tra rồi sửa tiếp.";
        const again = await load(); const nc = again.ok && st.byName.get(c.name);
        if (nc) { rerender(nc); const s2 = m.querySelector(".ccu-msg"); if (s2) { s2.textContent = "Kênh vừa được sửa ở nơi khác. Đã nạp lại bản mới."; s2.className = "ccu-msg err"; } }
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
  async function mount(host, name, { refresh = false } = {}) {
    if (refresh || !st.data) { host.replaceChildren(el("div", { class: "cv-empty", text: "Đang tải…" })); const r = await load(); if (!r || !r.ok) { host.replaceChildren(el("div", { class: "cv-empty", text: (r && r.error) || "Không tải được cấu hình kênh" })); return false; } }
    const c = st.byName.get(name);
    if (!c) { host.replaceChildren(el("div", { class: "cv-empty", text: "Không thấy kênh này trên web cho máy này. Có thể đã bị xóa hoặc chuyển máy." })); return false; }
    render(c, { host }); return true;
  }
  window.ChannelConfigUI = {
    open, load, close, mount,
    get: (name) => st.byName.get(name) || null,
    isOffline: () => st.offline,
    onChange(cb) { listeners.add(cb); return () => listeners.delete(cb); },
    proxyLine,
  };
})();
